#!/usr/bin/env node
/**
 * 简书文章发布 —— playwright-core 直连 CDP 版（2026-09-27 实战验证，支持插图）
 *
 * 前置：先用 isolated-browser skill 拉起隔离 Chrome（run_in_background + sleep 保活）：
 *   node ~/.workbuddy/skills/isolated-browser/scripts/launch.js "https://www.jianshu.com/writer#/" && sleep 7200
 *
 * 用法：
 *   node scripts/jianshu_publish_pw.js \
 *     --title "文章标题" \
 *     --body-file article.txt \
 *     --keyword "婚车租车" --tags "婚庆用车,婚庆婚车车队"   # 配图默认 3 张（按标签从素材库自动挑）
 *   # 也可手动指定多张：--image a.jpg --image b.jpg --image c.jpg
 *   # 不想要配图：--no-image；改张数：--image-top N
 *   node scripts/jianshu_publish_pw.js --title "..." --body-file a.txt --no-publish   # 只存草稿
 *
 * 退出码：0=发布成功 | 2=每日上限拦截(草稿留存) | 3=编辑器非空白且无法新建 | 1=其他错误
 *
 * 环境：Windows + 正式版 Chrome + isolated-browser 隔离实例（CDP 默认 9222）
 * 依赖：playwright-core —— 路径由 ../../isolated-browser/scripts/pathkit.js 运行时探测，
 *       也可设 OPENCLAW_NODE_MODULES 覆盖
 */

const fs = require('fs');
const path = require('path');

const NODE_MODULES = process.env.OPENCLAW_NODE_MODULES || null;

function loadPlaywright() {
  // 首选：公共解析器（不写死用户名 / 盘符 / 版本号）
  try {
    return require(path.resolve(__dirname, '..', '..', 'isolated-browser', 'scripts', 'pathkit.js')).resolvePlaywright();
  } catch (e) { /* 回退本地探测 */ }
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cands = [NODE_MODULES, home && path.join(home, '.workbuddy/binaries/node/workspace/node_modules')].filter(Boolean);
  for (const c of cands) {
    try { return require(path.join(c, 'playwright-core')); } catch (e) { /* next */ }
  }
  throw new Error('未找到 playwright-core，请设置 OPENCLAW_NODE_MODULES');
}

const { chromium } = loadPlaywright();

const CDP_PORT = process.env.ISOB_CDP_PORT || '9222';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { title: '', bodyFile: '', image: [], cdpPort: CDP_PORT, noPublish: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--title') a.title = argv[++i] || '';
    else if (k === '--body-file') a.bodyFile = argv[++i] || '';
    else if (k === '--image') a.image.push(argv[++i] || '');       // 可重复：多张配图
    else if (k === '--keyword') a.keyword = argv[++i] || '';
    else if (k === '--tags') a.tags = argv[++i] || '';
    else if (k === '--image-top') a.imageTop = argv[++i] || '';
    else if (k === '--image-dir') a.imageDir = argv[++i] || '';
    else if (k === '--no-image') a.noImage = true;
    else if (k === '--cdp-port') a.cdpPort = argv[++i] || CDP_PORT;
    else if (k === '--no-publish') a.noPublish = true;
  }
  return a;
}

async function closeImageDialog(page) {
  // 插图弹窗：div[role=dialog]，右上角关闭按钮 .ZTNas
  const dlg = await page.$('div[role=dialog]');
  if (!dlg) return;
  await page.evaluate(() => {
    const c = document.querySelector('div[role=dialog] .ZTNas');
    if (c) c.click();
  }).catch(() => {});
  await sleep(1000);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title || !args.bodyFile) { console.error('缺少 --title 或 --body-file'); process.exit(1); }
  const body = fs.readFileSync(args.bodyFile, 'utf8');
  const paragraphs = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  // 配图：显式 --image（可重复）优先；否则按「标签 → 素材库」自动挑 Top-N（默认 3 张）
  const { planImages } = require(path.resolve(__dirname, '..', '..', 'isolated-browser', 'scripts', 'post_images.js'));
  const plan = planImages({
    explicit: args.image, noImage: args.noImage, keyword: args.keyword || args.title, tags: args.tags,
    top: args.imageTop, layout: args.imageLayout, at: args.imageAt, dir: args.imageDir, paraCount: paragraphs.length,
  });
  const IMAGES = plan.images;
  console.log(`[配图] ${IMAGES.length} 张（来源 ${plan.source} | 布局 ${plan.layout}）`);
  if (plan.detail) plan.detail.chosen.forEach((c, i) => console.log(`  ${i + 1}) 图${c.number} ${c.name || ''} → ${c.image}`));

  console.log('连接 CDP:', args.cdpPort);
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + args.cdpPort);
  const ctx = browser.contexts()[0];
  if (!ctx) { console.error('无浏览器上下文'); process.exit(1); }

  // ---- 找 writer 页或新开 ----
  let page = ctx.pages().find(p => /jianshu\.com\/writer/.test(p.url()));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://www.jianshu.com/writer#/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await sleep(3000);

  // ---- 登录检查（不填密码，未登录则人工处理）----
  if (/sign_in|login/.test(page.url())) {
    console.error('NOT_LOGGED_IN: 请在隔离浏览器中手动登录简书后重试。URL:', page.url());
    process.exit(1);
  }
  console.log('已登录');

  // ---- 等编辑器加载 ----
  for (let i = 0; i < 20; i++) {
    if (await page.$('input._24i7u') && await page.$('div.kalamu-area')) break;
    await sleep(1000);
    if (i === 19) { console.error('EDITOR_LOAD_TIMEOUT: 编辑器未加载'); process.exit(1); }
  }
  await sleep(1000);

  // ---- 覆盖守卫：旧笔记有内容则新建文章，绝不覆盖 ----
  const bodyText = await page.$eval('div.kalamu-area', el => (el.innerText || '').trim());
  if (bodyText.length > 0) {
    console.log('编辑器已有内容, 尝试新建文章...');
    const btns = await page.$$('a, button, li, div');
    let created = false;
    for (const b of btns) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (t === '新建文章' || t === '+ 新建文章') { await b.click().catch(() => {}); created = true; break; }
    }
    if (!created) { console.error('EDITOR_NOT_BLANK: 请手动点“新建文章”后重试'); process.exit(3); }
    await sleep(3000);
    const t2 = await page.$eval('div.kalamu-area', el => (el.innerText || '').trim()).catch(() => 'x');
    if (t2.length > 0) { console.error('EDITOR_NOT_BLANK: 新建后仍有内容'); process.exit(3); }
    console.log('已自动新建空白笔记');
  }

  // ---- 填标题（React 受控组件：必须真实键盘输入）----
  console.log('填写标题:', args.title);
  await page.click('input._24i7u', { timeout: 10000 });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.type('input._24i7u', args.title, { delay: 15 });
  const titleVal = await page.$eval('input._24i7u', el => (el.value || '').trim());
  if (titleVal !== args.title) { console.error('TITLE_MISMATCH:', titleVal); process.exit(1); }
  console.log('标题 OK');

  // ---- 填正文（kalamu contenteditable：逐段输入，段间回车）----
  console.log('填写正文:', paragraphs.length, '段');
  await page.click('div.kalamu-area');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  for (let i = 0; i < paragraphs.length; i++) {
    await page.keyboard.type(paragraphs[i], { delay: 8 });
    if (i < paragraphs.length - 1) { await page.keyboard.press('Enter'); await sleep(120); }
  }
  await sleep(800);
  const len = await page.$eval('div.kalamu-area', el => (el.innerText || '').trim().length);
  console.log('正文确认字数:', len);
  if (len <= 0) { console.error('BODY_EMPTY'); process.exit(1); }

  // ---- 插入配图（文末，支持多张：弹窗 file input 带 multiple，可一次传数组）----
  if (IMAGES.length) {
    console.log(`插入配图（${IMAGES.length} 张）:`, IMAGES.join(' , '));
    await page.focus('div.kalamu-area');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await sleep(200);

    let uploaded = false;
    // 方案A：页面已有可见的隐藏 file input（accept 含 image）
    const fis = await page.$$('input[type=file]');
    for (const fi of fis) {
      const acc = (await fi.getAttribute('accept')) || '';
      if (/image/i.test(acc)) { await fi.setInputFiles(IMAGES); uploaded = true; break; }
    }
    // 方案B（简书实际路径）：点工具栏图片按钮 a.fa.fa-picture-o → 网页弹窗内 #kalamu-upload-image
    if (!uploaded) {
      await page.click('a.fa.fa-picture-o').catch(async () => {
        // 兜底：class 可能带 fa-picture-o 之外前缀
        await page.click('a[class*="picture"]');
      });
      await sleep(1500);
      const fi = await page.$('#kalamu-upload-image');
      if (!fi) { console.error('NO_UPLOAD_INPUT: 插图弹窗未出现'); process.exit(1); }
      await fi.setInputFiles(IMAGES);
    }
    // 等待上传完成：编辑器内 img 数达到期望且稳定
    const deadline = Date.now() + 120000;
    let cnt0 = 0, stable = 0, ok = false;
    while (Date.now() < deadline) {
      await sleep(2000);
      const cnt = await page.$$eval('div.kalamu-area img', els => els.length).catch(() => 0);
      if (cnt >= IMAGES.length && cnt === cnt0) { stable++; if (stable >= 1) { ok = true; break; } }
      else stable = 0;
      cnt0 = cnt;
    }
    console.log(ok ? `配图上传完成, img数:${cnt0}/${IMAGES.length}` : `IMAGE_UPLOAD_TIMEOUT (img数 ${cnt0}/${IMAGES.length})`);
    // ⚠️ 必须关掉插图弹窗，否则挡住发布按钮（intercepts pointer events）
    await closeImageDialog(page);
    if (!ok) process.exit(1);
  }

  if (args.noPublish) { console.log('--no-publish 模式, 停在草稿。'); process.exit(0); }

  // ---- 发布：publicize → 直接发布 → 确 认文集 ----
  console.log('点击发布...');
  const pub = await page.$('a[data-action="publicize"]');
  if (!pub) { console.error('NO_PUBLISH_BTN'); process.exit(1); }
  // 实测（2026-10-12）：点击生效后简书直接弹「发布成功」层，publicize 随 DOM 消失，
  // click 的 actionability 复检会超时报错——超时≠失败，不重试、不退出，交给下方成功判定
  try {
    await pub.click({ timeout: 5000 });
  } catch (e) {
    console.log('  发布按钮点击超时（按钮已随发布弹层消失，视为已触发）');
  }
  await sleep(1500);
  const direct = await page.$('li._2po2r.cRfUr');
  if (direct) {
    await direct.click().catch(() => {});
    await sleep(1500);
    const btns = await page.$$('button');
    for (const b of btns) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (t === '确 认' || t === '确认') { await b.click().catch(() => {}); console.log('文集确认: CONFIRMED'); break; }
    }
  }
  await sleep(3000);

  // ---- 成功判定（2026-09-27 实测：发布成功后 a[data-action=publicize] 从 DOM 消失）----
  // 成功标志：① li._2po2r.cRfUr 文字变「已发布」 ② 出现 a._2ajaT「发布成功，点击查看文章」(href=/p/xxx)
  //           ③ URL 含 /p/  ④ 每日上限提示 → QUOTA
  const st = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    const quota = /(每天|今日|当天).{0,6}(只能|仅能|最多|已达|剩).{0,6}(篇|文章)/.test(txt)
      || /(发表|发布|发文).{0,4}(已达|超过|上限|限制)/.test(txt);
    const successLink = document.querySelector('a._2ajaT');
    const publishedLi = Array.from(document.querySelectorAll('li._2po2r.cRfUr'))
      .some(e => (e.innerText || '').trim() === '已发布');
    return { quota, url: successLink ? successLink.href : '', publishedLi, loc: location.href };
  });
  const shot = path.join(__dirname, '..', `publish_result_${Date.now()}.png`);
  await page.screenshot({ path: shot });
  console.log('截图:', shot);

  if (st.url || st.publishedLi || /\/p\//.test(st.loc || '')) {
    console.log('PUBLISH_SUCCESS 文章链接:', st.url || st.loc);
    process.exit(0);
  } else if (st.quota) {
    console.log('QUOTA: 被每日发文上限拦截(2篇/天), 文章已存草稿, 次日重发');
    process.exit(2);
  } else {
    console.log('UNKNOWN: 状态未知, 请手动确认', JSON.stringify(st));
    process.exit(1);
  }
}

main().catch(e => { console.error('发布失败:', e.message); process.exit(1); });

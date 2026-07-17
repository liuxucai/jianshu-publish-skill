#!/usr/bin/env node
/**
 * 简书文章发布 - 独立实例模式（agent-browser --cdp 直连）
 *
 * 适用场景：用户 Chrome 已在运行、不想关闭、想用隔离实例发布。
 * 与默认 xb 路径（scripts/publish.js + lib.js）互斥互补：
 *   - publish.js 走 xb（xb 托管 Chrome），会触发安全锁，要求先关用户浏览器；
 *   - 本脚本走 agent-browser --cdp，直连一个【手动拉起】的独立 Chrome 实例，
 *     完全不碰用户已开的浏览器，绕开 xb 安全锁。
 *
 * 前置：先运行 scripts/launch_isolated_chrome.js 拉起实例并手动登录简书。
 *
 * 用法：
 *   node scripts/publish_cdp.js --cdp-port 9222 --title "标题" --body-file article.txt
 *   node scripts/publish_cdp.js --cdp-port 9222 --title "标题" --body "第一段。\n第二段。"
 *   node scripts/publish_cdp.js --cdp-port 9222 --login-only
 *   node scripts/publish_cdp.js --cdp-port 9222 --title "标题" --body-file a.txt --no-login-check
 *
 * 退出码：0=成功, 2=被每日上限拦截(草稿留存), 3=编辑器非空白且无法新建(已保护原文), 1=其他错误
 *
 * 依赖：agent-browser CLI（全局）、已运行的独立 Chrome（带 CDP）。
 * 不依赖 xb CLI。
 */

const fs = require('fs');
const os = require('os');
const { spawnSync, execSync } = require('child_process');

// ============================================================
// 解析 agent-browser 可执行文件（不写死路径）
// ============================================================
function resolveAgentBrowser() {
  try {
    const out = execSync('where agent-browser', { encoding: 'utf8', shell: true })
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (out && fs.existsSync(out)) return out;
  } catch (e) { /* 继续兜底 */ }
  const cands = [
    path.join(os.homedir(), 'AppData/Roaming/QClaw/npm-global/agent-browser'),
    path.join(os.homedir(), 'AppData/Roaming/QClaw/npm-global/agent-browser.cmd'),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return 'agent-browser'; // 期望在 PATH
}

const AB = resolveAgentBrowser();
// CDP 端口取一个未被占用的即可；9222 是 agent-browser / Chrome 的常用默认。
const DEFAULT_CDP_PORT = 9222;

// ============================================================
// agent-browser 封装（始终带 --cdp）
// ============================================================
function ab(args, opts = {}) {
  const cdp = ['--cdp', String(opts.cdpPort || DEFAULT_CDP_PORT)];
  const r = spawnSync(AB, [...cdp, ...args], {
    encoding: 'utf8',
    timeout: opts.timeout || 28000,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function evalJS(js, cdpPort) {
  const r = ab(['eval', '--base64', Buffer.from(js, 'utf8').toString('base64')], { cdpPort, timeout: 15000 });
  const out = (r.out || '').trim();
  if (!out) return '';
  try {
    const j = JSON.parse(out);
    if (j && typeof j === 'object') {
      if ('result' in j) return j.result;
      if ('value' in j) return j.value;
      if (j.data && 'result' in j.data) return j.data.result;
    }
    return out;
  } catch (e) {
    return out;
  }
}

function screenshot(name, cdpPort) {
  const filepath = path.join(os.homedir(), '.qclaw', `jianshu-${name}-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const r = ab(['screenshot', filepath], { cdpPort });
  if (r.code === 0) console.log('  截图已保存:', filepath);
  return r.code === 0 ? filepath : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// 登录 / 编辑器 / 覆盖守卫
// ============================================================
async function checkLogin(cdpPort) {
  console.log('  检查登录状态...');
  ab(['open', 'https://www.jianshu.com/writer#/'], { cdpPort, timeout: 25000 });
  await sleep(4000);
  const url = evalJS('location.href', cdpPort);
  const ok = !/sign_in|login/.test(url || '');
  console.log(ok ? '  已登录' : '  未登录（请在浏览器手动登录）');
  return ok;
}

async function getEditorContent(cdpPort) {
  const raw = evalJS(`(function(){
    var i=document.querySelector('input._24i7u');
    var b=document.querySelector('div.kalamu-area');
    return JSON.stringify({ title: i?(i.value||'').trim():'', bodyLen: b?((b.innerText||'').trim().length):0 });
  })()`, cdpPort);
  try { return JSON.parse(raw); } catch (e) { return { title: '', bodyLen: 0 }; }
}

async function isExistingArticle(cdpPort) {
  const c = await getEditorContent(cdpPort);
  return c.bodyLen > 0;
}

async function tryCreateNewNote(cdpPort) {
  const r = evalJS(`(function(){
    var els=document.querySelectorAll('a,button,li,div');
    for(var i=0;i<els.length;i++){
      var t=(els[i].innerText||'').trim();
      if(t==='新建文章'||t==='+ 新建文章'){ els[i].click(); return 'CLICKED'; }
    }
    return 'NOBTN';
  })()`, cdpPort);
  if (r !== 'CLICKED') return false;
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    if (!(await isExistingArticle(cdpPort))) return true;
  }
  return false;
}

async function openPublishPage(cdpPort) {
  console.log('  打开发布页...');
  ab(['open', 'https://www.jianshu.com/writer#/'], { cdpPort, timeout: 25000 });
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const ok = evalJS(`(function(){return JSON.stringify({
      t:!!document.querySelector('input._24i7u'),
      b:!!document.querySelector('div.kalamu-area')});})()`, cdpPort);
    try { if (JSON.parse(ok).t && JSON.parse(ok).b) break; } catch (e) {}
    if (i === 14) throw new Error('EDITOR_LOAD_TIMEOUT');
  }
  console.log('  编辑器已加载，执行覆盖守卫...');
  if (await isExistingArticle(cdpPort)) {
    console.log('  当前笔记已有内容，拒绝自动清空覆盖');
    const created = await tryCreateNewNote(cdpPort);
    if (!created) {
      throw new Error('EDITOR_NOT_BLANK: 当前笔记含已有内容且无法自动新建空白笔记。请手动点“新建文章”后重试。');
    }
    console.log('  已自动新建空白笔记');
  } else {
    console.log('  当前为空白新笔记，可安全写入');
  }
  return true;
}

// ============================================================
// 填写（agent-browser 原生 type = 真实键盘事件，React 受控组件同步）
// ============================================================
async function fillTitle(title, cdpPort) {
  console.log('  填写标题:', title);
  if (await isExistingArticle(cdpPort)) throw new Error('REFUSE_FILL: 编辑器已有内容，拒绝覆盖。请先新建空白笔记。');
  ab(['focus', 'input._24i7u'], { cdpPort });
  ab(['press', 'Control+a'], { cdpPort });
  ab(['press', 'Delete'], { cdpPort });
  const r = ab(['type', 'input._24i7u', title], { cdpPort, timeout: 30000 });
  if (r.code !== 0) throw new Error('标题输入失败: ' + (r.err || '').slice(0, 120));
  await sleep(400);
  const val = evalJS(`(function(){var i=document.querySelector('input._24i7u');return i?(i.value||'').trim():'';})()`, cdpPort);
  console.log('  标题确认值:', val);
  return val === title;
}

async function fillBody(body, cdpPort) {
  console.log('  填写正文...');
  if (await isExistingArticle(cdpPort)) throw new Error('REFUSE_FILL: 编辑器已有内容，拒绝覆盖。请先新建空白笔记。');
  const text = Array.isArray(body) ? body.join('\n') : String(body);
  ab(['focus', 'div.kalamu-area'], { cdpPort });
  ab(['press', 'Control+a'], { cdpPort });
  ab(['press', 'Delete'], { cdpPort });
  const r = ab(['type', 'div.kalamu-area', text], { cdpPort, timeout: 30000 });
  if (r.code !== 0) throw new Error('正文输入失败: ' + (r.err || '').slice(0, 120));
  await sleep(600);
  const len = evalJS(`(function(){var el=document.querySelector('div.kalamu-area');return el?((el.innerText||'').trim().length):0;})()`, cdpPort);
  console.log('  正文确认字数:', len);
  return parseInt(len, 10) > 0;
}

// ============================================================
// 发布（两步）+ 状态判定
// ============================================================
function clickPublishBtn(cdpPort) {
  const r = evalJS(`(function(){
    var a=document.querySelector('a[data-action="publicize"]');
    if(!a) return 'NOT_FOUND'; a.click(); return 'CLICKED';
  })()`, cdpPort);
  console.log('  点击发布按钮:', r);
  return r === 'CLICKED';
}

function clickDirectPublish(cdpPort) {
  const r = evalJS(`(function(){
    var li=document.querySelector('li._2po2r.cRfUr');
    if(!li) return 'NOT_FOUND';
    li.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    return 'CLICKED';
  })()`, cdpPort);
  console.log('  点击直接发布:', r);
  return r === 'CLICKED';
}

async function confirmNotebookDialog(cdpPort) {
  await sleep(1200);
  const r = evalJS(`(function(){
    var b=Array.from(document.querySelectorAll('button')).find(function(x){
      return (x.textContent||'').trim()==='确 认';
    });
    if(!b) return 'NOBTN';
    b.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    return 'CONFIRMED';
  })()`, cdpPort);
  console.log('  文集确认:', r);
  return r === 'CONFIRMED';
}

async function getPublishStatus(cdpPort) {
  await sleep(2500);
  const info = evalJS(`(function(){
    var txt=(document.body.innerText||'');
    var quota=/(每天|今日|当天).{0,6}(只能|仅能|最多|已发表|已达|剩).{0,6}(篇|文章)/.test(txt)
      || /(发表|发布|发文).{0,4}(已达|超过|上限|限制)/.test(txt)
      || /(篇数|数量).{0,4}(已达|上限)/.test(txt);
    var published=Array.from(document.querySelectorAll('*')).some(function(e){
      if(e.children.length===0){ var t=(e.innerText||'').trim(); return t==='已发布'; }
      return false;
    });
    return JSON.stringify({ quota:quota, published:published, url:location.href });
  })()`, cdpPort);
  let d = {};
  try { d = JSON.parse(info); } catch (e) {}
  if (d.published || (d.url && /\/p\//.test(d.url))) return 'SUCCESS';
  if (d.quota) return 'QUOTA';
  return 'UNKNOWN';
}

async function publish(cdpPort) {
  console.log('  发布流程...');
  if (!clickPublishBtn(cdpPort)) throw new Error('未找到“发布文章”按钮');
  await sleep(1000);
  if (!clickDirectPublish(cdpPort)) throw new Error('未找到“直接发布”选项');
  await confirmNotebookDialog(cdpPort);
  return await getPublishStatus(cdpPort);
}

// ============================================================
// 入口
// ============================================================
function parseArgs(argv) {
  const a = { title: '', body: '', bodyFile: '', loginOnly: false, noLoginCheck: false, cdpPort: DEFAULT_CDP_PORT };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--title') a.title = argv[++i] || '';
    else if (k === '--body') a.body = argv[++i] || '';
    else if (k === '--body-file') a.bodyFile = argv[++i] || '';
    else if (k === '--cdp-port') a.cdpPort = parseInt(argv[++i], 10) || DEFAULT_CDP_PORT;
    else if (k === '--login-only') a.loginOnly = true;
    else if (k === '--no-login-check') a.noLoginCheck = true;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cdpPort = args.cdpPort;

  if (!args.loginOnly && !args.title) {
    console.error('缺少 --title'); process.exit(1);
  }
  let body = args.body;
  if (args.bodyFile) {
    try { body = fs.readFileSync(args.bodyFile, 'utf8'); }
    catch (e) { console.error('正文文件读取失败:', e.message); process.exit(1); }
  }
  if (!args.loginOnly && !body.trim()) {
    console.error('正文为空（需 --body 或 --body-file）'); process.exit(1);
  }
  const paragraphs = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  console.log('=== 简书文章发布（独立实例模式 / agent-browser --cdp）===\n');
  console.log('CDP端口:', cdpPort);
  console.log('标题:', args.title);
  console.log('正文:', paragraphs.length, '段\n');

  try {
    // 0. 连通性检查
    console.log('[0/5] 连接独立 Chrome 实例...');
    const probe = ab(['get', 'url'], { cdpPort, timeout: 10000 });
    if (probe.code !== 0) {
      console.error('\n无法通过 CDP 端口', cdpPort, '连接到 Chrome。');
      console.error('   请先运行: node scripts/launch_isolated_chrome.js');
      console.error('   确认独立实例已启动且手动登录简书。');
      process.exit(1);
    }
    console.log('  已连接, 当前 URL:', (probe.out || '').trim());

    // 1. 登录
    if (!args.noLoginCheck && !args.loginOnly) {
      console.log('\n[1/5] 检查登录状态...');
      if (!await checkLogin(cdpPort)) {
        console.log('  需要登录：请在浏览器手动登录简书后重跑本命令。');
        process.exit(1);
      }
    }

    if (args.loginOnly) {
      console.log('\n已连接、登录页已开，等待你手动登录。');
      process.exit(0);
    }

    // 2. 发布页 + 覆盖守卫
    console.log('\n[2/5] 打开发布页...');
    await openPublishPage(cdpPort);
    console.log('  发布页已加载');

    // 3. 填写
    console.log('\n[3/5] 填写内容...');
    await fillTitle(args.title, cdpPort);
    await fillBody(paragraphs, cdpPort);
    console.log('  内容已填写');

    // 4. 发布
    console.log('\n[4/5] 发布...');
    const status = await publish(cdpPort);
    if (status === 'SUCCESS') {
      console.log('  发布成功!');
      screenshot('jianshu-publish-result', cdpPort);
      process.exit(0);
    }
    if (status === 'QUOTA') {
      console.log('  被每日发文上限拦截（简书 2 篇/天）。文章已存为草稿，明日配额重置后可重发。');
      screenshot('jianshu-publish-quota', cdpPort);
      process.exit(2);
    }
    console.log('  发布状态未知，请手动确认（截图已存）。');
    screenshot('jianshu-publish-unknown', cdpPort);
    process.exit(1);

  } catch (e) {
    console.error('\n发布失败:', e.message);
    if (/EDITOR_NOT_BLANK|REFUSE_FILL/.test(e.message)) { process.exit(3); }
    try { screenshot('jianshu-publish-error', args.cdpPort); } catch (_) {}
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

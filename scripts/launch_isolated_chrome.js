#!/usr/bin/env node
/**
 * 启动一个与用户默认 Chrome 完全隔离的独立 Chrome 实例（简书发布·独立实例模式）
 *
 * 用途：当用户已开着自己的 Chrome、又不想关闭时，用本脚本拉起一个
 *      全新 profile + 独立 CDP 端口的 Chrome，由 agent-browser --cdp 直连驱动，
 *      绕开 xb 的安全锁（xb 见 Chrome 在跑就拒绝另起实例）。
 *
 * 用法：
 *   node scripts/launch_isolated_chrome.js
 *   JIANSHU_CDP_PORT=9222 JIANSHU_PROFILE_DIR="C:\path\to\profile" node scripts/launch_isolated_chrome.js
 *
 * 启动后会自动打开简书 writer 页，请在打开的窗口中手动登录简书，
 * 再用 scripts/publish_cdp.js 连接并发布。
 *
 * 依赖：系统稳定版 Chrome（非 cft 测试版）、Node.js。
 * 不依赖 xb CLI。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- 默认参数（均可用环境变量覆盖，避免硬编码）----
// CDP 端口取一个未被占用的即可；9222 是 agent-browser / Chrome 的常用默认。
const CDP_PORT = process.env.JIANSHU_CDP_PORT || 9222;
const PROFILE_DIR = process.env.JIANSHU_PROFILE_DIR
  || path.join(os.homedir(), '.qclaw_isolated_chrome');

// ---- 解析 Chrome 可执行文件 ----
function findChrome() {
  const cands = [
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'chrome'; // 期望在 PATH 中
}

const chrome = findChrome();

if (!fs.existsSync(chrome)) {
  console.error('找不到 Chrome 可执行文件:', chrome);
  console.error('   请设置 AGENT_BROWSER_EXECUTABLE_PATH 指向稳定版 Chrome，或把 Chrome 加入 PATH。');
  process.exit(1);
}

fs.mkdirSync(PROFILE_DIR, { recursive: true });

const args = [
  '--new-instance',                                  // 独立进程（Chrome 启动参数，非 xb 参数）
  `--user-data-dir=${PROFILE_DIR}`,                  // 全新隔离 profile，与默认 User Data 互不串
  `--remote-debugging-port=${CDP_PORT}`,             // 开放 CDP，供 agent-browser --cdp 直连
  '--no-first-run',
  '--no-default-browser-check',
  'https://www.jianshu.com/writer#/',
];

console.log('=== 启动独立 Chrome 实例 ===');
console.log('Chrome  :', chrome);
console.log('Profile :', PROFILE_DIR);
console.log('CDP端口 :', CDP_PORT);
console.log('');

const child = spawn(chrome, args, { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();

child.on('error', (e) => {
  console.error('启动失败:', e.message);
  process.exit(1);
});

// 给一点时间让进程起来
setTimeout(() => {
  console.log(`已发起独立 Chrome（PID ${child.pid}）。`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 在打开的窗口中手动登录简书（不填密码，由用户操作）');
  console.log('  2. 运行发布脚本：');
  console.log(`     node scripts/publish_cdp.js --cdp-port ${CDP_PORT} --title "标题" --body-file 文章.txt`);
  console.log('');
  console.log('注意：该实例与你的默认 Chrome 登录态互不串，可长期使用、免重复登录。');
}, 1500);

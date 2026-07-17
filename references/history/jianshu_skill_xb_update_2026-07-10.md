# 简书发布 Skill 更新记录（2026-07-10）

## 背景
用户明确要求：**用 xb 方式启动浏览器**（拒绝 agent-browser）。
此前 skill 仍指向失效的旧 xb 路径（`v0.2.23.532`）、且 `ensureChrome` 错误地手动 `exec chrome.exe`，
正文/标题填写用的是 nativeSetter/innerHTML 老机制。本次统一改为 xb 托管 + 键盘逐字输入。

## 关键事实（本次实测确认）
- **xb 路径**：`F:\qclaw\v0.2.32.610\resources\openclaw\config\skills\xbrowser\scripts\xb.cjs`
- **Node 二进制**：`F:\qclaw\v0.2.32.610\resources\node\node.exe`（qclaw 自带，系统 PATH 的 node 是 .cmd 包装会报「内置 node 未启用」）
- **启动流程**：`xb init` → 若已有 Chrome 未开 CDP → `xb guide close-browser`（决策点，需用户确认）→ `xb stop chrome --force` → `xb run --browser chrome open <url>`
- **填写机制（用户要求 + 实测通过）**：`xb type <sel> <text>` 发送真实键盘事件，React 受控组件正确同步。
  - 实测：TITLE_VALUE=TEST_键盘输入_标题，BODY_TEXT=14 字 ✅
  - 不再需要 nativeSetter / innerHTML / React fiber 黑魔法

## 修改的文件
1. **scripts/lib.js**（重写）
   - 路径写死正确 NODE+XB
   - `ensureChrome()` 走 xb（init→复用→open），不再手动 exec
   - 新增 `requestCloseChrome()` / `closeChromeForce()`（处理已有 Chrome 占用决策点）
   - `fillTitle` / `fillBody` 改用 `xb type` 键盘输入 + 校验
   - 移除 React fiber 黑魔法；保留 eval（base64）用于点击发布/确认弹窗
   - `parseXb` 修正三层嵌套解析

2. **SKILL.md**
   - 环境要求表：更新 xb 路径、Node 二进制、浏览器托管说明
   - 浏览器原则：改为「必须由 xb 托管（带 CDP）」，补充关闭用户 Chrome 决策点流程
   - 新增「浏览器启动流程」段落
   - 填写规则：标题/正文改为 `xb type` 键盘输入
   - 失败处理表：CDP 冲突、node 路径、字数 0 等

3. **references/commands.md**（重写）
   - 固定路径、Node 调用模板、启动命令、键盘输入命令、base64 eval、返回值解析

4. **references/workflow.md**
   - 标题/正文填写改为 `xb type` 键盘输入（删除 nativeSetter / innerHTML / fiber 黑魔法）
   - Node.js 模板改为 xb type 版本

5. **scripts/publish.js / quick_publish.js**
   - ensureChrome 增加 CHROME_NEEDS_CLOSE 异常处理 → 触发关闭浏览器决策点提示

## 清理
- 删除临时探测脚本：ab.js（agent-browser 封装，已弃用）、_probe_*、_test_kb*、_verify_kb*、_diag.js、_retry.js、_check*.js、_shot*、_open.js、_reset.js、_nav.js、_inspect.js、_cancel.js、_republish.js、_ss.js

## 验证
- lib.js 加载无报错，所有导出齐全
- 活浏览器实测：xb type 标题/正文均正确同步
- 浏览器当前由 xb 托管、已登录简书、停在编辑器页（notebooks/57155929/notes/140429004）

## 待用户确认
- 是否需要用 quick_publish.js 跑一篇真实文章做端到端发布验证（之前只验证了填写机制，未跑完整发布）

# 简书发布 - 问题排查（独立实例路线）

> 本 skill 走 **isolated-browser + agent-browser --cdp** 路线。以下条目均为该路线下的真实坑位与解法。旧 xb CLI 路线已废弃，相关问题不再列出。

## Q1. 标题填写后内容消失 / input 值为空

**原因**：简书用 React 受控组件，直接 `input.value=` 或 `innerHTML` 不触发同步。

**解决**：用 `agent-browser type` 发真实键盘事件（脚本 `fillTitle` 已封装：focus → Ctrl+A → Delete → type）。
选择器必须是 `input._24i7u`。

## Q2. 误用 `input._1CtV4` 创建了同名新文集（致命坑）

`input._1CtV4` 是**文集确认弹窗**输入框（placeholder "请输入文集名..."），不是标题框。
`input._24i7u` 才是标题框（默认值日期）。标题务必用 `_24i7u`。

| 选择器 | 元素 | 用途 |
|--------|------|------|
| `input._24i7u` | 标题输入框 | ✅ 填标题 |
| `input._1CtV4` | 文集确认弹窗 | ❌ 别碰 |

## Q3. 正文字数始终为 0

**原因**：用 `innerHTML`/`execCommand` 写 DOM 不触发 store 同步，发布读到空值。

**解决**：往 `div.kalamu-area` 用 `agent-browser type` 真实输入。校验 `innerText.length > 0`。

## Q4. 点"发布文章"后菜单不展开

发布按钮是 `<a data-action="publicize">`（工具栏图标），不是 `<li>`。

## Q5. "直接发布"找不到

用精确 class：`li._2po2r.cRfUr`（菜单 li 有嵌套，文本遍历不稳）。

## Q6. "确 认"按钮找不到（中间有空格）

按钮文字是"确 认"（中间空格），`textContent.trim()==='确 认'`。

## Q7. 发布后 URL 没跳转，疑似失败

正常现象。判定以左侧列表第一项"已发布"为准，或 URL 含 `/p/`。

## Q8. 导航到 `/notebooks/{id}/notes/new` 只显示文集列表

那是文集列表页。正确地址：`https://www.jianshu.com/writer#/`（自动创建/恢复笔记）。

## Q9. 隔离 Chrome 连接失败（CDP 无响应）

**现象**：`agent-browser --cdp 9222` 连不上。
**原因**：isolated-browser 实例未拉起，或端口被占用/不一致。
**解决**：
- 确认已先跑 `node skills/isolated-browser/scripts/launch.js`（或本 skill 的 `launch_isolated_chrome.js`）。
- 确认 `publish_cdp.js` 的 `--cdp-port` 与实例端口一致（默认 9222）。
- 只传 `--cdp`，**不要**同时传 `--profile`（会挂起）。

## Q10. PowerShell 中文乱码 / `&&` 不支持

所有 agent-browser 调用封装进 Node 脚本；JS 里的 eval 走 `--base64`。不要直接在 PowerShell 拼中文参数。

## Q11. 每次发布都弹"请输入文集名"

正常。直接点"确 认"保留默认文集即可；除非用户指令否则不改。

## Q12. 误覆盖已有文章（事故恢复）

`/writer#/` 会恢复上次笔记，旧流程 Ctrl+A+Delete 会原地清空原文。
防护（已写进发布脚本）：`openPublishPage()` 覆盖守卫 + `fillTitle/fillBody` 的 `isExistingArticle()` 检查，发现已有内容立即 `REFUSE_FILL` 或 `EDITOR_NOT_BLANK` 中止。
恢复：编辑器"历史版本"回滚到覆盖前快照。

## Q13. 被"每天只能发 2 篇"拦截（高频）

**现象**：第 3 篇发布后 URL 不跳转，文章留在编辑器/存为草稿。
**处理**：发布脚本会识别限流提示并返回 `QUOTA`（退出码 2）。文章已成草稿，次日配额重置后重跑同一命令即可，无需重填。
**不要**反复点击发布——只会重复命中上限。

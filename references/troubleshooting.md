# 简书发布 - 问题排查（playwright-core 直连 CDP 路线）

> 2026-09-27 改版：agent-browser 路线已彻底废弃（本机无 CLI 且 type 卡死），
> 统一为 **isolated-browser + playwright-core 直连 CDP**。
> Q1–Q5 为 2026-09-27 真实发布中遇到的新问题，Q6–Q13 为历史验证仍有效的坑位。

## Q1.【新】agent-browser CLI 不存在 / 命令卡死

**现象**：`where agent-browser` 找不到；`qclaw npm-global` 下也没有；旧路线键盘 type 还会卡死。

**解决**：彻底放弃 agent-browser，改用 playwright-core 直连：
`chromium.connectOverCDP('http://127.0.0.1:9222')`，环境变量
`OPENCLAW_NODE_MODULES=~/.workbuddy/binaries/node/workspace/node_modules`。
脚本内所有 agent-browser 调用已全部移除。

## Q2.【新】工具栏图片按钮点击后不是系统文件选择器，是网页弹窗

**现象**：点 `a.fa.fa-picture-o` 后出现 `div[role=dialog]` 弹窗，
playwright 的 `filechooser` 事件**永远不触发**（8 秒超时），插图失败。

**原因**：简书插图是网页内弹窗（「点击上传（可多张）」「图片私密性」「取 消」），
不是原生文件选择框。

**解决**：弹窗内自带文件控件 `#kalamu-upload-image`
（accept=image/gif,jpeg,jpg,png,svg，multiple），直接：
```js
await page.click('a.fa.fa-picture-o');
await page.waitForSelector('#kalamu-upload-image');
await page.setInputFiles('#kalamu-upload-image', imgPath);
```
上传完成判定：`div.kalamu-area img` 数量增加且稳定（轮询 2s）。

## Q3.【新】插图弹窗挡住发布按钮（intercepts pointer events）

**现象**：插图后点 `a[data-action="publicize"]` 超时，报
`<div role="dialog" ...> from <div> subtree intercepts pointer events`。

**解决**：插图后必须先关弹窗再发布：
```js
await page.evaluate(() => document.querySelector('div[role=dialog] .ZTNas')?.click());
```
脚本已内置 `closeImageDialog()` + 发布点击被遮挡时的兜底重试。

## Q4.【新】发布成功后发布按钮从 DOM 消失

**现象**：发布成功后 `a[data-action="publicize"]` 查不到了，不能用"按钮消失"判断失败。

**解决**：成功判定改用（按优先级）：
1. `a._2ajaT`（文字「发布成功，点击查看文章」）——href 就是文章 `/p/` 链接
2. `li._2po2r.cRfUr` 文字变「已发布」
3. URL 含 `/p/`

## Q5.【新】进入 writer 时旧笔记有内容（实测 bodyLen 778）

**现象**：`/writer#/` 会恢复上次编辑的笔记，直接写入会追加到旧文后面。

**解决**：覆盖守卫——`div.kalamu-area` innerText 长度 >0 时，遍历点击文字为
「新建文章」的元素，等编辑器清空后再填；拿不到空白笔记就退出码 3 人工处理。
**绝不 Ctrl+A+Delete 清空有内容的笔记。** 事故恢复见 Q12。

## Q6.【历史有效】React 受控组件必须真实键盘输入

`input.value=` / `innerHTML` / `execCommand` 都不触发 store 同步，发布读到的字数为 0。
必须 `page.type()` / `page.keyboard.type()` 逐字输入：
- 标题：`input._24i7u`（❌ `_1CtV4` 是文集弹窗输入框，误用会创建同名文集）
- 正文：`div.kalamu-area`，逐段输入、段间 `Enter`（kalamu 不认 \n 字符）
- 填完校验：标题 `input.value` 等于目标值；正文 `innerText.length > 0`

## Q7.【历史有效】每日发文上限（2 篇/天）

第 3 篇会被平台拒绝：URL 不跳转、文章留在编辑器存为草稿。
QUOTA 正则：`/(每天|今日|当天).{0,6}(只能|仅能|最多|已达|剩).{0,6}(篇|文章)/`。
被拦截时草稿已留存，次日配额重置后重跑同一命令即可，无需重填。

## Q8.【历史有效】发布后 URL 不跳转是正常现象

以 Q4 的三个成功标志为准，不要等 location 变化。

## Q9.【历史有效】"直接发布"菜单项与文集确认

发布按钮 `a[data-action="publicize"]` 点击后展开下拉，菜单项用精确 class
`li._2po2r.cRfUr`（菜单 li 有嵌套，文本遍历不稳）。之后弹"请输入文集名"，
按钮文字是"确 认"（中间有空格），保留默认文集直接点，除非用户指令否则不改。

## Q10.【历史有效】编辑器加载

必须导航到 `https://www.jianshu.com/writer#/`（自动恢复/新建笔记）；
`/notebooks/{id}/notes/new` 是文集列表页，不是编辑器。

## Q11.【历史有效】沙箱回收 detached 子进程

Agent 环境下脚本 spawn 的隔离 Chrome（detached+unref）会在命令结束后被杀。
拉起 Chrome 必须用 `run_in_background: true` 跑
`node launch.js <url> && sleep 7200` 保活。

## Q12.【历史有效】误覆盖已有文章（事故恢复）

旧流程 Ctrl+A+Delete 会原地清空原文。现脚本覆盖守卫见 Q5。
恢复：编辑器"历史版本"回滚到覆盖前快照。

## Q13.【历史有效】Agent 环境写 D 盘

沙箱会直接杀掉写 `D:\` 的进程（exit 1、日志戛然而止）。
对 `D:\skills\...` 的批量删除/复制/git 操作需关闭沙箱执行；
通过 `~/.workbuddy/skills/` 下的符号链接用文件工具读写则不受影响。

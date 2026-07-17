---
name: jianshu-publisher
description: 简书（jianshu.com）文章自动发布流程。通过 isolated-browser 拉起隔离 Chrome，再用 agent-browser --cdp 直连驱动完成登录检查、填标题、填正文、发布，并正确识别"每日发文上限"等真实结果。适用于 Windows + Chrome + isolated-browser 环境。触发词：简书发布、jianshu、发布文章到简书。
---

# 简书文章自动发布 Skill（独立实例路线）

## 适用场景

- 把文章自动发布到简书
- 复用同一流程处理多篇文章（通过命令行传参，无需改源码）
- 处理发布被"每日 2 篇上限"拦截的情况（文章留作草稿，次日可重发）
- 用户 Chrome 正在使用、不想关闭时，用隔离实例发布，不碰用户浏览器

## 浏览器方案（关键选型）

本 skill 的浏览器启动与驱动**复用 [isolated-browser](../isolated-browser/SKILL.md) skill**，而不是 xb CLI：

| 路线 | 说明 |
|------|------|
| **isolated-browser（本 skill 采用）** | 拉起一个与用户默认 Chrome 完全隔离的独立 Chrome 实例（固定 `--user-data-dir`=~/.chrome_qclaw_stable + 独立 CDP 端口），用 `agent-browser --cdp` 直连驱动，绕开 xb 安全锁，不打扰用户现有浏览器。 |
| xb 托管（不采用） | xb 有安全锁：检测到用户 Chrome/Edge 在跑会拒绝另起实例，必须先关用户浏览器。该路线已废弃。 |

> **若 `isolated-browser` skill 未安装**：从 GitHub 安装 `https://github.com/liuxucai/isolated-browser-skill`（clone 或下载 ZIP 解压到 skills/isolated-browser），再调用其 `scripts/launch.js` 拉起隔离实例。

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | 正式版 Chrome（isolated-browser 找 `C:\Program Files\Google\Chrome\Application\chrome.exe`） |
| 控制工具 | 全局 `agent-browser` CLI（qclaw 自带，`.cmd` 优先） |
| 依赖 skill | `isolated-browser`（同工作区 `skills/isolated-browser`） |
| 运行环境 | Windows PowerShell，**不**支持 `&&` 链式语法 |
| 脚本语言 | Node.js（封装所有 agent-browser 调用，规避 PowerShell 中文乱码） |

## 核心原则

### ⚠️ 登录原则
需要登录时，**不填任何账号密码**，直接打开登录页让用户手动操作。

### ⚠️ 浏览器原则
启用浏览器统一调用 `isolated-browser` skill（拉起隔离 Chrome + CDP 直连），不混用用户自己的 Chrome。
- 隔离实例由 isolated-browser 拉起（固定 profile `~/.chrome_qclaw_stable` + 独立 CDP 端口），用 `agent-browser --cdp` 直连驱动。
- **绝不直接 `exec chrome.exe`** 拿用户实例。

### ⚠️ 文集确认原则
除非用户明确指令，否则不新建/不指定文集。发布后弹"请输入文集名" → 保留默认，点"确 认"。

### ⚠️ 禁止覆盖已有文章原则（最高优先级）
绝不用 Ctrl+A+Delete 清空一篇"有内容的笔记"。`/writer#/` 会恢复上次编辑的笔记，`openPublishPage()` 先跑覆盖守卫：检测到正文非空 → 自动点"新建文章"；得不到空白笔记就抛 `EDITOR_NOT_BLANK` 中止，绝不写入。若 `REFUSE_FILL`：停下告知用户手动新建空白笔记。原文可经编辑器"历史版本"回滚（见 troubleshooting.md）。

### ⚠️ 每日发文上限原则（重要）
简书**每天只能发 2 篇**。第 3 篇会被平台拒绝，表现为"发布后 URL 不跳转、文章留在编辑器/存为草稿"。
- 本 skill 的 `publish()` 会检测限流提示，返回 `QUOTA`（退出码 2），**不再伪装成"状态未知"**。
- 被拦截时文章已存为草稿，次日配额重置后可重发，无需重填。

## 直接用法（推荐）

> **启用浏览器**：先调用 `isolated-browser` skill 拉起隔离 Chrome（未安装则从 `https://github.com/liuxucai/isolated-browser-skill` 安装），再跑本 skill 的发布脚本。

```bash
# 1) 拉起隔离 Chrome（固定 profile ~/.chrome_qclaw_stable + CDP 端口 9222 常驻）
node skills/isolated-browser/scripts/launch.js
#    打开简书 writer 页后，在弹出的浏览器窗口中手动登录

# 2) 发布文章（脚本内 CDP 直连 9222，无需再过 isolated-browser）
#    正文来自文件（UTF-8，按换行分段）
node skills/jianshu-publisher/scripts/publish_cdp.js \
  --cdp-port 9222 \
  --title "差异对比：让每一次决策都更聪明的 5 个方法" \
  --body-file "./article.txt"

# 正文直接给（\n 分段）
node skills/jianshu-publisher/scripts/publish_cdp.js \
  --cdp-port 9222 --title "标题" --body "第一段。\n第二段。"

# 已知已登录，跳过登录检查提速
node skills/jianshu-publisher/scripts/publish_cdp.js --cdp-port 9222 --title "标题" --body-file a.txt --no-login-check

# 仅开 Chrome + 登录页，不发布
node skills/jianshu-publisher/scripts/publish_cdp.js --cdp-port 9222 --login-only
```

也可直接调用本 skill 自带的 `scripts/launch_isolated_chrome.js`（与 isolated-browser 参数一致）拉起实例，再用 `publish_cdp.js` 连接发布。

退出码：`0`=成功，`2`=被每日上限拦截（草稿留存），`3`=编辑器非空白且无法新建（已保护原文中止），`1`=其他错误。

## 发布流程（脚本内部）

```
1. ensureChrome()     连接 isolated-browser 拉起的隔离 Chrome（agent-browser --cdp）
2. checkLogin()       未登录 → 开登录页让用户手动登（不填密码）
3. openPublishPage()  打开 /writer#/，覆盖守卫确保空白新笔记
4. fillTitle()        input._24i7u + agent-browser type 逐字输入（React 受控组件同步）
5. fillBody()         div.kalamu-area + agent-browser type 逐字输入（真实 keystroke）
6. publish()          发布文章(a[data-action=publicize]) → 直接发布(li._2po2r.cRfUr) → 确 认文集
7. getPublishStatus() 三态判定 SUCCESS / QUOTA / UNKNOWN
```

## 选择器（已验证，勿改）

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 标题输入框 | `input._24i7u` | ✅ 默认值是日期；勿用 `_1CtV4`（那是文集弹窗） |
| 正文编辑器 | `div.kalamu-area` | contenteditable，kalamu 编辑器 |
| 发布文章按钮 | `a[data-action="publicize"]` | 工具栏按钮，点开展下拉 |
| 直接发布项 | `li._2po2r.cRfUr` | 下拉菜单项 |
| 文集确认按钮 | `button`（文字"确 认"，中间有空格） | 保留默认文集 |

## 填写机制（实测有效）

`agent-browser type <selector> <text>` 发送真实键盘事件，React 受控组件自动同步 value / store。
- ❌ 不用 `input.value=` 直接赋值（React 不感知）
- ❌ 不用 `innerHTML` / `execCommand`（字数 0 发布必败）
- 填充后校验：`input._24i7u.value` 应等于标题；`div.kalamu-area.innerText.length` 应 > 0

## 发布成功判定（三态）

- ✅ **SUCCESS**：左侧笔记列表出现"已发布"，或 URL 含 `/p/`
- ⛔ **QUOTA**：出现"每天只能发 N 篇"等上限提示（未发布，草稿留存）
- ❓ **UNKNOWN**：无法判定，需手动确认

⚠️ URL **不一定跳转**（常停在编辑器页），以左侧"已发布"状态为准。

## 失败处理

| 错误 | 解决 |
|------|------|
| 隔离 Chrome 启动超时 | CDP 端口无响应 / Chrome 路径错；确认 isolated-browser 已拉起实例 |
| agent-browser 命令挂起 | 同时传了 `--cdp` 和 `--profile`；只传 `--cdp`，不传 `--profile` |
| 编辑器加载超时 | 导航到 `/writer#/`（不是 `/notes/new`） |
| 标题填后值不对 | 确认用 `input._24i7u`，不是 `_1CtV4` |
| 正文字数 0 | 用 `agent-browser type` 真实输入，非 innerHTML |
| 被每日上限拦截（退出码 2） | 文章已存草稿，次日配额重置后重跑同一命令 |
| EDITOR_NOT_BLANK（退出码 3） | 编辑器有内容且无法自动新建；手动点"新建文章"后再发 |

详见 [references/troubleshooting.md](references/troubleshooting.md)。

## 文件结构

```
jianshu-publisher/
├── SKILL.md                         ← 本文件
├── scripts/
│   ├── publish_cdp.js              ← ✅ 主发布脚本（agent-browser --cdp 直连隔离实例）
│   ├── launch_isolated_chrome.js   ← ✅ 拉起隔离 Chrome 实例（参数同 isolated-browser）
│   └── lib.js / publish.js         ← ❌ 已废弃（旧 xb 路线，行不通，已删除）
├── references/
│   └── troubleshooting.md          ← 问题排查（独立实例路线）
└── templates/
    └── example_article.txt         ← 示例正文
```

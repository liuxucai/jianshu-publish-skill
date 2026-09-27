---
name: jianshu-publisher
description: 简书（jianshu.com）文章自动发布流程。通过 isolated-browser 拉起隔离 Chrome，再用 playwright-core 直连 CDP 完成登录检查、填标题、填正文、上传插图、发布，并正确识别"每日发文上限"等真实结果。适用于 Windows + Chrome + isolated-browser 环境。触发词：简书发布、jianshu、发布文章到简书。
---

# 简书文章自动发布 Skill（playwright-core 直连 CDP 路线）

> 2026-09-27 全面改版：agent-browser CLI 本机不存在（且键盘 type 卡死）已彻底废弃，
> 统一改用 **playwright-core 直连 CDP**（与知乎/搜狐 skill 同路线），新增 **插图** 能力。
> 全流程已在真实发布中验证：https://www.jianshu.com/p/d757100b45d4

## 适用场景

- 把文章（含配图）自动发布到简书
- 复用同一流程处理多篇文章（命令行传参，无需改源码）
- 处理发布被"每日 2 篇上限"拦截的情况（文章留作草稿，次日重发）
- 用户 Chrome 正在使用、不想关闭时，用隔离实例发布，不碰用户浏览器

## 浏览器方案

复用 [isolated-browser](../isolated-browser/SKILL.md) skill 拉起隔离 Chrome
（固定 `--user-data-dir=~/.chrome_qclaw_stable` + CDP 端口 9222，登录态持久化），
驱动层用 **playwright-core 直连 CDP**。

> 若 isolated-browser 未安装：从 `https://github.com/liuxucai/isolated-browser-skill` 安装。

## 环境要求

| 项目 | 要求 |
|------|------|
| 浏览器 | 正式版 Chrome（isolated-browser 自动定位） |
| 驱动 | playwright-core，装在 `~/.workbuddy/binaries/node/workspace/node_modules` |
| 运行时 | managed Node 22（`~/.workbuddy/binaries/node/versions/.../node.exe`，或 bash 里直接 `node`） |
| 依赖 skill | `isolated-browser`（拉起隔离实例） |

## 使用步骤

```bash
# 1) 后台拉起隔离 Chrome 并保活（必须 run_in_background，沙箱会回收 detached 子进程）
node ~/.workbuddy/skills/isolated-browser/scripts/launch.js "https://www.jianshu.com/writer#/" && sleep 7200

# 2) 发布（正文 UTF-8 txt 按换行分段；配图可选）
export OPENCLAW_NODE_MODULES="$HOME/.workbuddy/binaries/node/workspace/node_modules"
node ~/.workbuddy/skills/jianshu-publisher/scripts/jianshu_publish_pw.js \
  --title "婚车租车全攻略：如何选到心仪的婚庆婚车车队？" \
  --body-file ./article.txt \
  --image "D:/skills/car/11.jpg"

# 只填不发布（存草稿）：加 --no-publish
# 指定端口：--cdp-port 9222
```

退出码：`0`=发布成功 | `2`=每日上限拦截（草稿留存，次日重发） | `3`=编辑器非空白且无法新建 | `1`=其他错误。

## 核心原则

1. **登录不填密码**——检测到未登录直接报 `NOT_LOGGED_IN` 退出，人工在隔离浏览器里登录后重跑。
2. **绝不碰用户自己的 Chrome**——只用 isolated-browser 拉起的隔离实例。
3. **禁止覆盖已有文章**——进入 writer 时若旧笔记有内容，先自动点「新建文章」；
   得不到空白笔记即抛 `EDITOR_NOT_BLANK` 中止，绝不 Ctrl+A 清空。
4. **保留默认文集**——发布弹"请输入文集名"时点「确 认」，不新建文集。
5. **插图后必须关弹窗**——插图弹窗会挡住发布按钮（详见 troubleshooting Q4）。

## 脚本内部流程

```
连接 CDP → 找/开 writer 页 → 登录检查
→ 等编辑器(input._24i7u + div.kalamu-area)
→ 覆盖守卫(bodyLen>0 → 点「新建文章」)
→ 填标题(type delay=15, React 受控组件同步)
→ 填正文(逐段 keyboard.type, 段间 Enter, delay=8)
→ 插图: 点 a.fa.fa-picture-o → 弹窗内 #kalamu-upload-image setInputFiles
        → 等 div.kalamu-area img 数量稳定 → 关弹窗(.ZTNas)
→ 发布: a[data-action=publicize] → li._2po2r.cRfUr → 「确 认」
→ 判定: a._2ajaT 链接 / li「已发布」/ URL 含 /p/ → SUCCESS
        每日上限正则 → QUOTA(退出码 2)
```

## 选择器速查（2026-09-27 实测）

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 标题输入框 | `input._24i7u` | ✅ 默认值是日期 |
| 正文编辑器 | `div.kalamu-area` | contenteditable（kalamu） |
| 工具栏图片按钮 | `a.fa.fa-picture-o` | 点击弹出网页内弹窗 |
| 插图弹窗 | `div[role=dialog]` | 关闭按钮 `.ZTNas` |
| 上传文件控件 | `#kalamu-upload-image` | 弹窗内 input[type=file]，直接 setInputFiles |
| 发布文章按钮 | `a[data-action="publicize"]` | ⚠️ 发布成功后从 DOM 消失 |
| 直接发布菜单项 | `li._2po2r.cRfUr` | 成功后文字变「已发布」 |
| 文集确认按钮 | `button`（文字"确 认"，中间有空格） | 保留默认文集 |
| 发布成功链接 | `a._2ajaT` | 文字「发布成功，点击查看文章」，href 为文章 `/p/` 链接 |

## 发布成功判定（优先级从高到低）

1. `a._2ajaT` 出现且 href 含 `/p/` —— 最可靠，直接拿到文章链接
2. `li._2po2r.cRfUr` 文字为「已发布」
3. URL 含 `/p/`

⚠️ 发布成功后 `a[data-action="publicize"]` 会**从 DOM 消失**，不要用它判定。
每日上限提示匹配 QUOTA 正则（troubleshooting Q7）。

## 失败处理

| 错误/现象 | 解决 |
|------|------|
| `NOT_LOGGED_IN` | 在隔离浏览器手动登录后重跑（profile 已持久化，通常只需一次） |
| `EDITOR_LOAD_TIMEOUT` | 确认导航到 `/writer#/`；CDP 端口与实例一致 |
| `EDITOR_NOT_BLANK`（退出码 3） | 手动点「新建文章」后重发 |
| `NO_UPLOAD_INPUT` | 图片按钮没弹出弹窗，重试或截图排查 |
| `IMAGE_UPLOAD_TIMEOUT` | 图片过大/网络慢；检查 `div.kalamu-area img` |
| 点击 publicize 报 "intercepts pointer events" | 插图弹窗未关；脚本已内置 closeImageDialog 兜底 |
| 退出码 2（QUOTA） | 草稿已存，次日配额重置后重跑同一命令 |

更多坑位见 [references/troubleshooting.md](references/troubleshooting.md)。

## 文件结构

```
jianshu-publish-skill/
├── SKILL.md                        ← 本文件（playwright 直连路线）
├── VERSION
├── scripts/
│   └── jianshu_publish_pw.js       ← ✅ 主发布脚本（含插图，实战验证）
├── templates/
│   ├── example_article.txt         ← 示例正文格式
│   └── 婚车租车_article_2026-09-27.txt ← 实战发布原文（标题+13段）
├── references/
│   ├── troubleshooting.md          ← 问题排查（playwright 路线 + 历史有效坑位）
│   └── history/                    ← 历史事件记录（只读存档）
```

> 旧 agent-browser 路线的 `publish_cdp.js`、`launch_isolated_chrome.js` 已删除
> （本机无 agent-browser CLI，启动统一走 isolated-browser skill 的 launch.js）。

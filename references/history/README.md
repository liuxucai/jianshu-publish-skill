# 历史存档（简书发布 skill）

> 本目录只保留「仍有借鉴价值」的历史结论。2026-07-10 之前基于 **xb CLI** 的更新记录
> （`jianshu_publisher_update_2026-07-03.md`、`jianshu_skill_xb_update_2026-07-10.md`）
> 已**删除**——xb 路线在本机不可用（本机无 CLI、type 卡死），相关脚本亦已移除，
> 其内容不再有任何可执行参考价值。下面是合并后的结论摘要。

## 一、已废弃：xb CLI 路线（2026-07-03 / 2026-07-10）

- 曾用 `xb type` 逐字输入标题/正文（选择器 `[role="group"] input._1CtV4`、`.kalamu-area`），
  并用 `xb run --browser chrome open <url>` 托管浏览器。
- **废弃原因**：① 本机没有可用的 xb CLI，且其路径写死在原作者机器上；② `xb type` 对
  kalamu 富文本编辑器易卡死；③ xb 有安全锁，用户 Chrome 在跑时会拒绝托管。
- **替代**：isolated-browser 隔离 Chrome + playwright-core 直连 CDP 9222（现行方案，见 SKILL.md）。
- 结论仍然有效的部分：**简书正文必须走真实键盘输入**（`page.type`/`keyboard.type`），
  `innerHTML` / `execCommand` 不触发 React store 同步（现行 troubleshooting Q6）。

## 二、覆盖事故（2026-07-10 13:16）— 教训已固化到现行脚本

- **事故**：发布流程把用户**正在编辑的既有文章**整篇 `Ctrl+A + Delete` 清空并覆盖，且已落盘保存。
- **根因**：`openPublishPage()` 导航到 `/writer#/` 时简书会**恢复上次编辑的笔记**（不保证空白），
  而 `fillTitle`/`fillBody` 写入前无条件整篇清空。
- **修复（已落地）**：现行 `jianshu_publish_pw.js` 内置**覆盖守卫**——
  编辑器 `div.kalamu-area` 非空时，先遍历点击「新建文章」等编辑器清空，拿不到空白笔记就退出码 3 交人工；
  **绝不 Ctrl+A+Delete 清空有内容的笔记**。见现行 troubleshooting **Q5 / Q12**。
- **人工补救**：简书编辑页「历史版本」可回滚到覆盖前快照。

## 三、发布被拒诊断（2026-07-10）— 每日发文上限

- **现象**：多次点「发布文章 → 直接发布」后页面不跳转、URL 与标题均不变。
- **结论**：**不是技能故障**，而是简书**每日发文上限（2 篇/天）**已用尽；内容已安全存为草稿。
- **现行处理**：脚本用 QUOTA 正则识别该情形并**退出码 2**（草稿留存，次日配额重置后重跑同一命令即可）。
  见现行 troubleshooting **Q7**。

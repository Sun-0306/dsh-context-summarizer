# dsh-context-summarizer · 上下文归纳

DeepSeek Harness (DSH) 插件：把过长的对话**一键归纳**成一段摘要，释放上下文窗口，然后继续聊。
两个入口：**对话框输入框左侧的圆形按钮**（最快）和**左侧栏的「上下文归纳」页面**。
适用于会话越来越长、回复变慢、上下文快满、或模型开始「忘记」早前约定的场景。

> 英文名：Context Summarizer · 按包名 `dsh-context-summarizer` 安装。

## 入口与界面

| 位置 | 形态 |
| --- | --- |
| **对话框工具行左侧**（`+` 按钮旁，输入框内） | 圆形「归纳」按钮：**一次点击直接归纳当前会话** |
| **输入框下方**（状态条，与上下文计量同一行） | 运行中 / 完成 / 无历史 / 失败 的即时反馈，可重试或关闭 |
| 左侧栏全局面板列表（与「插件」「定时任务」「上下文洞察」同级） | **上下文归纳** 页面入口：占用条、一键按钮、结果与摘要详情 |

### 对话框内的一键入口（最快）

打开任意会话，输入框左下角（`+` 旁边）有一个圆形图标：

1. 点击它 → 立即对当前会话执行一次归纳；按钮变成旋转状态，输入框下方出现「正在归纳上下文…」。
2. 完成后状态条显示：**归纳完成 · N 条历史 · 释放 ≈X tokens**，约 14 秒后自动收起（可手动关闭）。
3. 失败时状态条显示原因和**重试**；会话正在跑时会先禁用，等这一轮结束即可。

归纳过程由当前模型生成摘要，通常十几秒；状态条不挡住聊天，完成后摘要作为会话记录里的
一条「已归纳」出现在对话中，可以继续正常聊天。

### 左侧栏的归纳页面

左侧栏点「上下文归纳」进入整页视图：

- **当前上下文占用**：`≈已用 / 窗口大小 · 百分比`，占用偏高时进度条转为警示色；
- **一键归纳上下文**：完成后显示 *归纳条目 / 释放的 tokens / 归纳后占用* + 摘要全文，可「回到对话」；
- 运行中的会话按钮禁用；没有打开会话时显示空状态。

> 归纳是持久化写入会话日志，**不能撤销**（与内置 `/compact` 相同语义）；需要会话空闲时执行。

## 它到底做了什么

归纳复用的是 DSH **自带的手动压缩能力**（`/compact` 命令背后的同一操作）：压缩较早的一段
历史 → 由当前会话模型写成摘要 → 摘要作为新节点写入会话日志、旧节点归档保留 → 上下文释放。

当前 Web/Desktop 组合里有一个容易踩的坑：`dsh-web-app` 会**在 Host 根上禁用**
`compaction-basic` / `command-compact`，把它们移进**每个 Agent preset 的隔离分组**。所以插件
不能只查 `ctx.compaction`（那会是 `undefined`），而是按下面的顺序解析当前 Agent 的能力：

1. 该 Agent 的 `/compact` 命令 —— 它拥有 preset 内的压缩后端，并会留下人类命令的生命周期
   记录（对话里因此显示「手动归纳」行）；结构化结果从它写入的 `compaction/summary` 日志事件中读取；
2. `agentPresets.serviceFor(agent, 'compaction')` —— preset 隔离域内压缩服务的正式读取入口；
3. `agent.ctx.get('compaction')` —— 同一隔离域的直达查找；
4. `ctx.get('compaction')` —— SDK/headless 等根上挂载的组合。

所以「一键」在这些组合下都能工作，也始终和 `/compact` 是同一个持久化操作。

## 安装

在本机工作区构建目录后，用插件管理器安装（写入当前 DSH profile，所有会话生效）：

```text
plugin_manager install_bundle  target = <本目录的绝对路径>
```

或在 Web GUI 的 **插件 → 添加插件** 中选择本地目录。安装后刷新页面：

- 输入框左下角出现圆形「归纳」按钮；
- 左侧栏出现「上下文归纳」入口。

要求：Host 提供 `webServer`、`agents`、`tokenMeter`，并具备以下之一：Agent preset 隔离域内
的 `compaction`、根上挂载的 `compaction`、或可用的 `/compact` 命令（标准 DSH Web/Desktop
组合均满足第一种）。缺能力时按钮仍然显示，点击后用状态条说明原因。

## 工作原理与安全边界

- **Host 半**（`index.js`）注册 `/dsh-ctx-summary` 前缀路由：
  - `POST /dsh-ctx-summary/api/usage`：返回当前会话的上下文计量；
  - `POST /dsh-ctx-summary/api/compact`：执行手动归纳，返回释放量、摘要与前后占用。
  路由只接受本机页面：每次进程启动生成随机令牌、通过 index 注入页面，校验令牌、
  `Origin`/`Host`（仅 loopback）与 `Sec-Fetch-Site`；同一会话同时只允许一个归纳。
- **Client 半**（`client.js`）只通过标准插槽扩展：`conversation.input.left`（输入框按钮）、
  `conversation.composer.dock`（状态条）、`sidebar.panellist`（左侧栏入口）与 `main`
  （归纳页面）。不读别的插件 DOM、不替换应用根、样式只用 `--dsw-alias-*` 主题变量，
  深浅色与窄屏都已适配。
- 归纳是**用户操作**：Agent 正在跑一轮对话时不空闲，Host 会拒绝；因此模型不能借它「给自己
  压缩上下文」，保持与 `/compact` 一致的权限语义。

## 接口契约（Host）

```jsonc
// POST /dsh-ctx-summary/api/usage  { "sessionId": "..." }
{ "ok": true, "sessionId": "...", "usage": {
  "tokens": 132000, "surfaceTokens": 130000, "contextWindow": 1000000,
  "ratio": 0.132, "provider": "deepseek-account", "model": "deepseek-flash" } }

// POST /dsh-ctx-summary/api/compact  { "sessionId": "..." }
{ "ok": true, "noop": false, "before": { "...usage..." }, "after": { "...usage..." },
  "result": { "shadowedCount": 12, "shadowedTokens": 9800,
              "summary": "…", "summarySeq": 321 } }

// 失败（HTTP 4xx/5xx，页面按 code 本地化并给出下一步）
{ "ok": false, "error": { "code": "busy", "message": "..." } }
```

失败码：`unauthorized` / `forbidden` / `bad-request` / `not-found` / `method-not-allowed` /
`session-not-live` / `unsupported` / `busy` / `cancelled` / `changed` / `summary` /
`commit` / `persistence` / `timeout` / `internal`。

## 常见问题

| 现象 | 原因与下一步 |
| --- | --- |
| 输入框旁没有圆形按钮 / 左侧栏没有入口 | 插件未加载或页面是旧版本：刷新页面；在「插件」页确认 `dsh-context-summarizer` 已启用 |
| 状态条提示「这个会话在主机上不活跃」 | 该会话还没在主机上打开：先在左侧栏点开它，再归纳 |
| 提示「归纳暂时不可用：有别的归纳正在进行，或者这一轮对话还没结束」 | 等这一轮回答结束/另一个归纳完成再试 |
| 提示「当前环境不支持手动归纳」 | 当前组合上找不到 preset 内/根上的 `compaction`，也没有 `/compact` 命令 |
| 点了后只看到「正在归纳…」很久 | 归纳要调用一次模型；超时上限 10 分钟，超时后状态条会给出可重试的错误 |
| 摘要内容不满意 | 归纳由内置压缩提示词生成；本次摘要已写入日志，不能撤销。重试一次会基于新的上下文再归纳 |

## 本地测试

无第三方依赖，Node ≥ 22：

```sh
node --check index.js
node --check client.js
node --test tests/*.test.mjs
```

- `tests/host.test.mjs`：在假 Cordis 上下文上跑真实 `apply()`，覆盖令牌注入、鉴权、usage、
  归纳能力来源（`/compact` 命令优先、preset 服务 / Agent ctx / 根服务回退）、错误码映射、
  并发拒绝、卸载中止与日志事件解析。
- `tests/client.test.mjs`：最小 React/Hook/槽位替身跑真实 `apply()` 与首渲染，覆盖四个插槽、
  输入框按钮（空闲/运行中）、状态条（隐藏/成功/失败+重试）、中英文字典键一致。

## 兼容性

面向 `@deepseek-ai/dsh` 0.2.1 客户端契约（四个插槽、标准 `useSessions`/`useSessionStatus`
钩子、`sessionId` 标准属性、`ctx.locale`、`ctx.slots`）与 Host `agentPresets` /
`compaction` / `commands` / `tokenMeter` / `agents` / `webServer`。任一可选能力缺失时按上面的
顺序降级并给出可读说明，不会让整页崩溃。

## 文件

| 文件 | 作用 |
| --- | --- |
| `package.json` | bundle 清单：`dsh.bundle.patch` + `dsh.client`（双半插件） |
| `cordis.patch.yml` | 把插件行插入 profile |
| `index.js` | Host 半：令牌注入、HTTP 路由、上下文计量、preset 归纳能力解析 |
| `client.js` | Client 半：输入框按钮、状态条、左侧栏入口、归纳页面 |
| `locale/{zh,en}.json` | 插件管理器中显示的标题与说明 |
| `icon.svg` | 原创图标（长历史折成一段摘要） |
| `tests/` | 本地测试 |

## License

MIT

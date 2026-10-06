# dsh-model-status —— 模型连通状态指示灯

在 DSH 聊天框的**模型选择器左侧**实时显示当前所选模型是否连通。纯客户端插件，
不替换任何产品组件、不新增 host RPC。

> **开发纪律**：遵循[开发-制品闭环](DEV-DISCIPLINE.md)——每次变更 bump 版本 + CHANGELOG + tag，重启 DSH Desktop 验证后才算闭环。

## 版本与 DSH 适配

| 插件版本 | DSH Desktop | @deepseek-ai/dsh | 说明 |
| --- | --- | --- | --- |
| 0.6.0 | ✅ 0.3.4 | ✅ 0.1.2-alpha.4 | 路由失败记忆：额度耗尽不再绿灯（当前） |
| 0.5.0 | ✅ 0.3.4 | ✅ 0.1.2-alpha.4 | 首个可用版本（修复 scope.interval 陷阱） |
| 0.2.0 – 0.4.0 | ⚠️ 0.3.4 | ⚠️ 0.1.2-alpha.4 | **不可用**：scope.interval 属性访问炸死 apply 作用域（无 UI 无报错），仅存档 |

适配声明同时写入 `package.json` 的 `dsh.compat` 字段（desktop/backend 为最低版本，
verified 为实测组合），可程序化读取。历史版本以带 DSH 适配注解的 git 标签
（`v0.2.0` … `v0.6.0`）留档。

## 状态语义（三层合成，按优先级）

**第 1 层 · 会话实时失败**（`snapshot.lastAgentError`，宿主"无回合位置"的实时错误）：

| 灯 | 含义 |
| --- | --- |
| 🔴 连通异常 | 宿主刚报了无回合位置的实时错误（悬停看消息） |

**第 2 层 · 路由失败记忆**（扫描会话事件日志，按 provider 记住最近一次**真实请求**失败）：

| 灯 | 含义 | 判据 |
| --- | --- | --- |
| 🔴 额度耗尽 | 该 provider 最近一次请求以 QUOTA 终止 | `turn/end.reason.error.code === 'QUOTA'` 等 |
| 🔴 密钥无效 | 凭据失败 | `AUTH` / `INVALID_CREDENTIAL` / `MISSING_CREDENTIAL` |
| 🔴 上下文超限 | 请求超出模型上下文窗口 | `CONTEXT_WINDOW_EXCEEDED` |
| 🟡 限流 | 被限流（通常瞬时，重试中） | `RATE_LIMIT`（经 `llm/retry` 事件） |
| 🟡 空响应 | 供应商返回了空补全 | `EMPTY_RESPONSE` |
| 🔴 连通异常 | 其他未识别失败码 | 悬停看原始消息 |

失败归属：`request/header` / `request/context` 事件滚动跟踪会话当前请求路由，
`turn/end` 终止失败归属当时的路由 provider；`llm/retry` 自带 provider。
**清除规则**：该 provider 成功服务完一轮（非错误 `turn/end`）即恢复 —— 一次成功
足以证明账号/通道可用。悬停可见失败时的模型名与时间。

**第 3 层 · 目录层状态**（产品 `modelDirectories` 共享 store，listModels 视角）：

| 灯 | 含义 | 判据 |
| --- | --- | --- |
| 🟢 已连通 | 当前 provider 的模型目录加载成功 | `current.provider` ∈ `groups` |
| 🔴 连通异常 | 该 provider 目录加载失败（悬停看具体报错） | `current.provider` ∈ `failures`，或整体 `status==='error'` |
| 🔴 不可用 | 当前选择没有活动适配器（与产品拦截输入的判据一致） | `routable === false` |
| ⚪ 检测中 | 正在加载 / 正在切换（脉动） | `status==='loading' \| 'selecting'` |
| ⚪ 未知 | 尚无当前模型，或模型目录服务不可用（悬停看原因） | `current == null` / `modelDirectories` 缺失 |

交互：悬停显示原因与 provider 名；**点击重新检测**；另有 60s 周期刷新。
产品自身的适配器/设置变更也会刷新同一份 store，故指示灯与下拉菜单内容天然一致。

## 工作原理

**目录层**复用产品客户端服务 `modelDirectories`：每个会话一份共享的 `ModelDirectory`
store（快照 `{ current, routable, groups, failures, status, error }`），由 host 的
`session.models` 填充 —— 逐个已注册 provider 调 `llm.listModels`，成功进 `groups`、
失败进 `failures`（带 `message`），`routable` 表示当前选择是否被活动适配器服务。
本插件用 `useSyncExternalStore` 订阅同一份 store，因此**零额外网络往返**。

**路由失败记忆**复用产品事件日志：`Session.events`（经 `sessions.binding(id).session`
纯解析读取，渲染安全）按序扫描 `request/header` / `request/context` / `llm/retry` /
`turn/end` 四类事件。响应性由会话快照对象驱动（每次 flush 新快照 → 重渲染 → 重扫描），
`llm` 层的规范失败码（`QUOTA` / `AUTH` / `RATE_LIMIT` / `CONTEXT_WINDOW_EXCEEDED` /
`EMPTY_RESPONSE`）直接来自产品错误分类，无需自己解析供应商文案。

挂载点 `conversation.input.right`（`list` 槽、会话作用域），渲染在 composer 尾部行、
模型选择器触发器正左侧。

> **语义说明（为何需要第 2 层）**：`listModels` 对多数 provider 是免费接口，**额度耗尽
> 时目录列表依然成功**，绿灯照常 —— 只有真实请求才暴露 `QUOTA`。第 2 层把"最近一次
> 真实请求失败"记住并按 provider 隔离：切到别的模型立即恢复目录层状态，切回死额度
> 模型则红灯直到底层恢复（同 provider 成功服务一轮）。无法做到**事前**探知额度耗尽
> （那需要真实计费请求），这是零成本下的最优解。

## 接线（务必放家级补丁层）

行写在 **`$DSH_HOME/cordis.patch.yml`**（家级），**不要**写 `profiles/web/cordis.patch.yml`：

> DSH Desktop 桌面壳在后端启动失败时会把整个 `profiles` 目录隔离为
> `profiles.broken-<时间戳>` 并重建，**profile 层补丁会随之丢失**（本项目就因此在一次
> 重启后"指示灯消失"）。家级补丁不受该隔离影响。

```yaml
- insert:
    - id: dsh-model-status
      name: dsh-model-status          # 裸包名：宿主 client-modules 靠
                                      # require.resolve('dsh-model-status/package.json')
                                      # 读到 dsh.client 声明才会托管 client.js
```

包需能从 `baseUrl` 解析，故用 junction（Windows）指向本目录：

| junction | 供谁解析 |
| --- | --- |
| `$DSH_HOME/node_modules/dsh-model-status` | 家级补丁行（baseUrl = `$DSH_HOME`）**必需** |
| `$DSH_HOME/profiles/node_modules/dsh-model-status` | profile 层兜底 |
| `$DSH_HOME/profiles/web/node_modules/dsh-model-status` | web profile 稳定解析 |

一键（重）建：`pwsh -File install.ps1`（幂等；隔离重建后跑一次即可）。

## 改完怎么生效

- 改 `lib/client.js`：**刷新浏览器即可**（`serveBundle` 每次请求从磁盘读且
  `cache-control: no-cache`，无需重启后端）。
- 改 `lib/index.js`（host 半，含诊断信标路由）：需重启后端（桌面版=重启 App）。

## 自查（诊断信标 —— 桌面版排障首选）

桌面版不方便开 DevTools，插件若在渲染端失败则界面什么都不出现。host 半边提供
信标端点：客户端 bundle 在**每个里程碑**（module → applied → injected →
registered → session → render，以及 factory-error / render-error / session-error）
POST `/dsh-model-status/beacon` 上报；排障时直接：

```powershell
# 端口 = 当前 DSH web 后端监听口（桌面版每次重启会变）
(Invoke-WebRequest "http://127.0.0.1:<port>/dsh-model-status/health" -UseBasicParsing).Content
```

`marks` 逐级读（`reading` 字段有中文释义表）：

| 最后到达的 mark | 结论 |
| --- | --- |
| 无任何 mark | 渲染端从未执行本插件 bundle（页面用了旧清单 / 插件未被加载） |
| `module` | 工厂执行了，但模块级 `exports.inject` 的服务没解析 → apply 没跑 |
| `applied` | `ctx.inject(["slots"])` 没触发（slots 服务缺失） |
| `injected` | 槽位未声明（会话 UI 未挂载 / 槽位名不对） |
| `registered` | 注册成功但组件没被渲染（composer 没渲染 rightItems？） |
| `session` / `render` | 组件真的渲染了 —— 灯应当在界面上；没有则查 `events` 里的 error 条目与 CSS |

事件里还带 `href`/`ua`，可直接确认桌面窗口加载的页面地址。

浏览器侧（网页版或开了 DevTools 时）也可读 `window.__dshModelStatus`，字段含义同上
（`rendered`/`sessions` 为计数，`lastError` 为最近错误）。

服务端侧验证（把端口换成当前 GUI 端口）：

```powershell
# 条目是否进入浏览器花名册
(Invoke-WebRequest "http://127.0.0.1:<port>/" -UseBasicParsing).Content -match 'dsh-model-status'
# 下发的 bundle 是哪一版
(Invoke-WebRequest "http://127.0.0.1:<port>/plugins/dsh-model-status/client.js" -UseBasicParsing).Content.Length
```

## 踩坑记录（改代码前先读）

1. **客户端没有 `timer` 服务**。曾在模块级 `inject` 里写 `"timer"`，导致插件永远
   pending —— apply 不执行、无 UI 也无报错。模块级只注入 `slots`，其余服务
   （`modelDirectories`/`sessions`）一律 `ctx.get` 惰性取用并容许缺失。
2. **组件永不返回 `null`**（子代理会话除外）。曾用"`props.t` 缺失就返回 null"，
   于是清单/bundle/注册全部正常却界面空白，是最难查的失败形态。现在缺数据就显示
   灰色"未知"并在 title 写明原因 —— 故障必须可见。
3. **`list` 槽必须给唯一 `id`**：SlotCore 对 list 用 `options.id` 作单元键，缺 id 的
   条目会互相去重；`order` 决定同槽排序。
4. **不依赖 locale 座位给 list 槽传 `t`**（未证实的契约），文案自带 zh/en 字典，
   跟随 `document.documentElement.lang`。
5. Hook 必须**无条件调用**：条件式调用会在 props 变化时破坏 hooks 顺序，被槽位
   错误边界静默摘除。
6. **【致命坑】绝不触碰客户端 ctx/scope 的 `interval`（timer mixin）**。信标实证
   v0.2.0~v0.4.0 全部死在同一行：`typeof scope.interval === "function"` ——
   `typeof` 不保护属性访问本身，Cordis 上下文对未注册服务的属性访问直接抛错，
   炸死整个 apply 作用域：注册、探针全不执行，界面零显示、控制台零报错。
   之前误判为"slots.inject 等待回调不触发"——其实是作用域根本没活到那一步。
   周期刷新只用原生 `setInterval`（agy-indicator 注释同样警告过 ctx.interval
   的析构形态差异"抛错导致对话窗口空白"）。冒烟测试用抛错 Proxy 复现此陷阱。
7. **apply 作用域整体 try/catch + 错误信标**：任何静默杀手必须被上报，否则
   桌面版无从排查。
8. 注册策略：优先直接 `slots.register`（本插件加载在产品模块之后，apply 时
   槽位规范通常已存在），失败回退 `slots.inject` 等待 + 1.5s/6s 延迟重试兜底。
   客户端内置探针：上报 `specDynamic`/`entries` 真实状态与对照组槽位的
   inject 触发情况，health 端点可查。

## 目录结构

```
dsh-model-status/
├─ package.json      dsh.client 声明（platform: web + exports["./client"]）
├─ install.ps1       幂等重建三处 junction 并检查家级补丁行
├─ smoke-test.mjs    Node 模拟浏览器环境的全链路冒烟测试（含 Cordis 抛错陷阱复现）
├─ lib/index.js      host 半：诊断信标（POST /beacon + GET /health）
└─ lib/client.js     client 半：状态推导 + 指示灯组件 + 槽位注册 + 里程碑信标
```

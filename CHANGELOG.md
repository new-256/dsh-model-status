# 更新日志

每个版本条目都标注 **DSH 适配版本**（DSH Desktop / @deepseek-ai/dsh），供安装前核对。
适配声明同时可从 `package.json` 的 `dsh.compat` 字段程序化读取。

## v0.6.0 —— 路由失败记忆

**DSH 适配：DSH Desktop 0.3.4 / @deepseek-ai/dsh 0.1.2-alpha.4 ✅ 实测可用**

- 解决"额度耗尽的模型仍报绿灯"：`listModels` 对多数 provider 是免费接口，余额耗尽时
  目录列表依然成功；只有真实请求才暴露 `QUOTA`。
- 三层状态合成（按优先级）：
  1. 会话实时失败（`snapshot.lastAgentError`）；
  2. **路由失败记忆**：扫描会话事件日志（`request/header`/`request/context` 滚动
     跟踪请求路由，`llm/retry` 与 `turn/end` 终止失败按 provider 记住最近一次真实
     请求失败），非错误 `turn/end` 且当前路由即该 provider 时清除记忆；
  3. 目录层状态（原逻辑）。
- 新状态：🔴 额度耗尽（QUOTA）、🔴 密钥无效（AUTH/INVALID_CREDENTIAL）、
  🔴 上下文超限（CONTEXT_WINDOW_EXCEEDED）、🟡 限流（RATE_LIMIT）、
  🟡 空响应（EMPTY_RESPONSE）——失败码直接采用产品 `llm` 层的规范分类。
- 悬停可见：供应商原始报错 + 失败时的模型名 + 时间。
- 零新增 host RPC、零额外网络请求；冒烟测试扩至 8 场景。

## v0.5.0 —— 首个可用版本

**DSH 适配：DSH Desktop 0.3.4 / @deepseek-ai/dsh 0.1.2-alpha.4 ✅ 实测可用**

- 修复致命陷阱：`typeof scope.interval === "function"` 的**属性访问本身**在客户端
  Cordis 上下文上抛错，炸死整个 apply 作用域——注册、探针全部静默不执行，无 UI
  无报错。周期刷新改用原生 `setInterval`。
- apply 作用域整体 try/catch + `apply-scope-error` 信标：静默杀手必须被上报。
- 冒烟测试的 scope 桩改为抛错 Proxy，复现该陷阱防止回归。

## v0.4.0 —— 直连注册（不可用，存档）

**DSH 适配：DSH Desktop 0.3.4 / @deepseek-ai/dsh 0.1.2-alpha.4 ⚠️ 在该组合上不可用**

- 改为优先直接 `slots.register`（回退 `slots.inject` 等待 + 延迟重试）。
- 加入槽位状态探针（`specDynamic`/`entries`/对照组槽位）。信标显示作用域死于
  注册之前——真凶（interval 访问）此时尚未定位。

## v0.3.0 —— 诊断信标（不可用，存档）

**DSH 适配：DSH Desktop 0.3.4 / @deepseek-ai/dsh 0.1.2-alpha.4 ⚠️ 在该组合上不可用**

- 诊断信标：客户端在 module/applied/injected/registered/session/render 每个里程碑
  POST `/dsh-model-status/beacon`，host 半边 `GET /dsh-model-status/health` 汇总——
  桌面版无 DevTools 时的唯一观测手段。
- Node 模拟浏览器环境的全链路冒烟测试（smoke-test.mjs）。

## v0.2.0 —— 首个版本（不可用，存档）

**DSH 适配：DSH Desktop 0.3.4 / @deepseek-ai/dsh 0.1.2-alpha.4 ⚠️ 在该组合上不可用**

- 模型选择器旁状态灯：目录层三态（已连通/连通异常/检测中）+ 点击重测 + 60s 刷新。
- 挂载 `conversation.input.right`（list 槽）、`useSyncExternalStore` 订阅产品
  `modelDirectories` 共享 store。
- 已包含 interval 陷阱（当时未定位），界面零显示、控制台零报错。

window.__ModuleLoader__.load({
	id: "dsh-model-status",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ── 诊断信标（必须最先定义、最先上报：任何一步失败前先证明 bundle 被执行）──
		const diag = {
			module: "loaded",
			applied: false,
			injected: false,
			registered: false,
			rendered: 0,
			sessions: 0,
			lastError: null,
			beacons: 0
		};
		if (typeof window !== "undefined") window.__dshModelStatus = diag;
		function beacon(stage, extra) {
			diag.beacons += 1;
			try {
				const payload = Object.assign({
					stage: stage,
					href: String((typeof location !== "undefined" && location.href) || ""),
					ua: String((typeof navigator !== "undefined" && navigator.userAgent) || "").slice(0, 120)
				}, extra || {});
				if (typeof fetch === "function") {
					fetch("/dsh-model-status/beacon", {
						method: "POST",
						headers: { "content-type": "text/plain" },
						body: JSON.stringify(payload),
						keepalive: true
					}).catch(function () {});
				}
			} catch {
				// 信标失败不得影响插件本体。
			}
		}
		beacon("module");

		try {
			let react = require("react");

			/**
			 * 模型连通状态指示灯（纯客户端）。
			 *
			 * 状态语义（三层，按优先级）：
			 *  1. 会话级实时失败：snapshot.lastAgentError（宿主"无回合位置"的实时错误）。
			 *  2. 路由失败记忆：扫描会话事件日志（request/context + llm/retry +
			 *     turn/end），按 provider 记住最近一次真实请求失败（额度耗尽/密钥
			 *     无效/限流/上下文超限…），直到该 provider 成功服务完一轮才清除。
			 *     —— 解决"额度耗尽仍报绿灯"：listModels 对多数 provider 是免费
			 *     接口，余额耗尽时列表依然成功，只有真实请求才暴露 QUOTA。
			 *  3. 目录层状态：产品 modelDirectories 共享 store（listModels 层面的
			 *     成功/失败/路由可用性）。
			 *
			 * 数据来源均为产品已有管道，不新增业务 host RPC。
			 * 挂载点：conversation.input.right（list 槽、session 作用域；产品
			 * InputBar 在 trailing 行、模型选择器正左侧无条件渲染 rightItems）。
			 *
			 * 设计纪律（踩过的坑，改代码前务必读）：
			 *  1) 模块级 inject 只写 "slots" —— 客户端没有 timer 服务，误列会让
			 *     插件永远停在 pending（apply 不执行、无 UI 也无报错）。
			 *  2) 【致命坑】绝不触碰 ctx/scope 的 interval（timer mixin）——即使
			 *     只在 typeof 检查里访问该属性也会抛错，炸死整个 apply 作用域，
			 *     后续注册/探针全部不执行且无任何报错。信标实证：v0.2.0~v0.4.0
			 *     全部死在这一行。周期刷新只用原生 setInterval。
			 *  3) 组件除子代理会话外永不返回 null —— 缺数据显示灰色"未知"并写明
			 *     原因，让故障可见。
			 *  4) 文案自带 zh/en 字典，不依赖 locale 座位契约。
			 *  5) 每个里程碑上报 beacon（host 半边 GET /dsh-model-status/health
			 *     可查）—— 桌面版无 DevTools 时的唯一观测手段。
			 *  6) 渲染错误由 Guard 错误边界捕获并上报，而非被槽位边界静默摘除。
			 *  7) apply 作用域整体 try/catch：任何静默杀手必须被上报。
			 *  8) 注册策略：优先直接 slots.register（本插件加载在产品模块之后，
			 *     apply 时槽位规范通常已存在），失败回退 slots.inject 等待 +
			 *     1.5s/6s 延迟重试。
			 *  9) 事件扫描只在渲染期读取（sessions.binding 是纯解析、渲染安全）；
			 *     响应性由 props.session 快照对象驱动（会话每次 flush 都产生新
			 *     快照对象，ConversationRoot 重渲染会把新 props 传进来）。
			 */
			const CSS = [
				".dms-status{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 6px;margin:0;border:0;border-radius:24px;background:transparent;color:var(--dsw-alias-label-caption,#8b8b8b);cursor:pointer;font:inherit;font-size:12px;line-height:18px;font-weight:500;flex:none;white-space:nowrap}",
				".dms-status:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}",
				".dms-status:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l4,rgba(127,127,127,.5))}",
				".dms-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-caption,#8b8b8b);transition:background-color .15s ease}",
				".dms-dot--ok{background:var(--dsw-alias-state-success-primary,#2ea043)}",
				".dms-dot--warn{background:var(--dsw-alias-state-warning-primary,#f5a623)}",
				".dms-dot--error{background:var(--dsw-alias-state-error-primary,#e5484d)}",
				".dms-dot--checking{animation:dms-pulse 1.2s ease-in-out infinite}",
				"@keyframes dms-pulse{0%,100%{opacity:.35}50%{opacity:1}}"
			].join("");
			if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-model-status\"]") === null) {
				const tag = document.createElement("style");
				tag.setAttribute("data-plugin", "dsh-model-status");
				tag.setAttribute("data-plugin-css", "dsh-model-status");
				tag.textContent = CSS;
				document.head.appendChild(tag);
			}

			const SLOT = "conversation.input.right";
			const zh = {
				checking: "检测中",
				ok: "已连通",
				error: "连通异常",
				unavailable: "不可用",
				unknown: "未知",
				noService: "模型目录服务不可用（modelDirectories 未注册）",
				hint: "点击重新检测",
				quota: "额度耗尽",
				invalidKey: "密钥无效",
				rateLimited: "限流",
				contextOverflow: "上下文超限",
				emptyResponse: "空响应",
				lastFailure: "上次请求失败"
			};
			const en = {
				checking: "Checking",
				ok: "Connected",
				error: "Unreachable",
				unavailable: "Unavailable",
				unknown: "Unknown",
				noService: "model directory service unavailable (modelDirectories not registered)",
				hint: "click to re-check",
				quota: "Quota exhausted",
				invalidKey: "Invalid key",
				rateLimited: "Rate limited",
				contextOverflow: "Context overflow",
				emptyResponse: "Empty response",
				lastFailure: "last request failed"
			};
			/** 自带 i18n：跟随页面语言。 */
			function dictOf() {
				const lang = (typeof document !== "undefined" && document.documentElement.lang) || (typeof navigator !== "undefined" && navigator.language) || "zh";
				return /^zh/i.test(lang) ? zh : en;
			}

			/** 失败码 → 展示文案（未识别码回落到通用"连通异常"）。 */
			function codeLabel(code, d) {
				switch (code) {
					case "QUOTA": return d.quota;
					case "AUTH":
					case "INVALID_CREDENTIAL":
					case "MISSING_CREDENTIAL": return d.invalidKey;
					case "RATE_LIMIT": return d.rateLimited;
					case "CONTEXT_WINDOW_EXCEEDED": return d.contextOverflow;
					case "EMPTY_RESPONSE": return d.emptyResponse;
					default: return d.error;
				}
			}
			/** 失败对象 → 人类可读消息（与产品 displayFailureMessage 同规则：AUTH 特判，否则 message）。 */
			function failureMessage(failure, d) {
				if (failure === null || typeof failure !== "object") return String(failure ?? "");
				if (failure.code === "AUTH" || failure.code === "INVALID_CREDENTIAL") return d.invalidKey;
				return typeof failure.message === "string" ? failure.message : String(failure.code ?? "");
			}
			/** 事件时间 → HH:MM（解析失败给原串前 5 段）。 */
			function shortTime(time) {
				if (typeof time !== "string" || time === "") return void 0;
				const date = new Date(time);
				if (!Number.isNaN(date.getTime())) {
					const pad = (n) => String(n).padStart(2, "0");
					return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
				}
				return time.slice(11, 16);
			}

			/**
			 * 扫描会话事件日志，按 provider 记住最近一次真实请求失败。
			 *
			 * 事件契约（产品已有，无需新增）：
			 *  - request/header：data.header.config = {provider, model, ...}（路由变化时追加）
			 *  - request/context：data = {provider, model, ...}（请求上下文变化时追加）
			 *  - llm/retry：data = {provider, failure, ...}（可重试失败；自带 provider）
			 *  - turn/end：data = {turn, reason}；reason.kind === "error" 时
			 *    reason.error = {code, message}（终止失败，归属 = 当时滚动路由）
			 *
			 * 清除规则：某 provider 成功服务完一轮（非错误 turn/end 且当前滚动
			 * 路由就是它）即清除其失败记忆 —— 一次成功足以证明该账号/通道可用。
			 *
			 * @param {Array} events - Session.events（已加载窗口，含尾部最新事件）
			 * @returns {{failures: Map<string, {seq, time, failure, model?}>, route: {provider?, model?}}}
			 */
			function scanRouteFailures(events) {
				const failures = new Map();
				let route = { provider: void 0, model: void 0 };
				if (!Array.isArray(events)) return { failures, route };
				for (const event of events) {
					const type = event?.type;
					const data = event?.data;
					if (type === "request/header") {
						const config = data?.header?.config;
						if (config != null && config.provider !== void 0) route = { provider: config.provider, model: config.model };
					} else if (type === "request/context") {
						if (data != null && data.provider !== void 0) route = { provider: data.provider, model: data.model };
					} else if (type === "llm/retry") {
						if (data?.provider === void 0) continue;
						failures.set(data.provider, { seq: event.seq, time: event.time, failure: data.failure, model: route.model });
					} else if (type === "turn/end") {
						const reason = data?.reason;
						if (reason?.kind === "error") {
							const failure = reason.error;
							const provider = failure?.provider ?? route.provider;
							if (provider !== void 0) failures.set(provider, { seq: event.seq, time: event.time, failure, model: route.model });
						} else if (route.provider !== void 0) {
							failures.delete(route.provider);
						}
					}
				}
				return { failures, route };
			}

			/**
			 * 从共享目录快照推导连通状态（目录层：listModels 视角）。
			 * @returns tone（ok/error/checking/unknown）、label、可选 detail 与 providerName。
			 */
			function derive(state, d) {
				if (state === null || state === void 0) return { tone: "checking", label: d.checking };
				if (state.status === "loading" || state.status === "selecting") return { tone: "checking", label: d.checking };
				const groups = state.groups ?? [];
				const failures = state.failures ?? [];
				const current = state.current;
				if (state.status === "error") return {
					tone: "error",
					label: d.error,
					detail: state.error ?? void 0,
					providerName: current == null ? void 0 : nameOf(groups, failures, current.provider)
				};
				if (current == null) return { tone: "unknown", label: d.unknown };
				const group = groups.find((g) => g.id === current.provider);
				const failure = failures.find((f) => f.id === current.provider);
				if (state.routable === false) return { tone: "error", label: d.unavailable, providerName: group?.name };
				if (failure !== void 0) return { tone: "error", label: d.error, detail: failure.message ?? void 0, providerName: failure.name };
				if (group !== void 0) return { tone: "ok", label: d.ok, providerName: group.name };
				return { tone: "unknown", label: d.unknown };
			}
			/** 在 groups/failures 里找 provider 展示名。 */
			function nameOf(groups, failures, provider) {
				return groups.find((g) => g.id === provider)?.name ?? failures.find((f) => f.id === provider)?.name;
			}

			/** directory 缺失时的稳定空 store（Hook 必须无条件调用）。 */
			const NO_SUBSCRIBE = () => () => {};
			const NO_SNAPSHOT = () => null;

			/**
			 * 三层状态合成（会话实时失败 → 路由失败记忆 → 目录层）。
			 * @param props - 槽位 props（含 session 快照与 readEvents）。
			 * @param state - 目录快照（可能为 null）。
			 */
			function deriveStatus(props, state, d) {
				// 1) 会话级实时失败（宿主"无回合位置"的实时错误出口）。
				const lastAgentError = props.session?.lastAgentError;
				if (typeof lastAgentError === "string" && lastAgentError !== "") {
					return { tone: "error", label: d.error, detail: lastAgentError.slice(0, 200) };
				}
				// 2) 路由失败记忆：当前 provider 最近一次真实请求失败。
				const provider = state?.current?.provider;
				if (provider !== void 0 && typeof props.readEvents === "function") {
					let remembered;
					try {
						remembered = scanRouteFailures(props.readEvents()).failures.get(provider);
					} catch {
						remembered = void 0;
					}
					if (remembered !== void 0) {
						const code = remembered.failure?.code;
						const tone = code === "RATE_LIMIT" || code === "EMPTY_RESPONSE" ? "warn" : "error";
						const bits = [];
						if (remembered.model != null && remembered.model !== "") bits.push(remembered.model);
						const time = shortTime(remembered.time);
						if (time !== void 0) bits.push(time);
						return {
							tone,
							label: codeLabel(code, d),
							detail: failureMessage(remembered.failure, d),
							meta: bits.length > 0 ? `${d.lastFailure} · ${bits.join(" · ")}` : d.lastFailure
						};
					}
				}
				// 3) 目录层状态（listModels 视角）。
				return derive(state, d);
			}

			/**
			 * 状态灯：圆点 + 短标签，title 说明详情，点击重新检测。
			 * 仅子代理会话（产品自身也隐藏模型选择器）返回 null；其余一律渲染。
			 */
			function StatusLight(props) {
				const directory = props.directory;
				// Hook 无条件调用：条件式调用会破坏 hooks 顺序。
				const state = react.useSyncExternalStore(
					directory === void 0 ? NO_SUBSCRIBE : (fn) => directory.subscribe(fn),
					directory === void 0 ? NO_SNAPSHOT : () => directory.getSnapshot()
				);
				if (props.hidden === true) return null;
				diag.rendered += 1;
				const d = dictOf();
				const status = directory === void 0
					? { tone: "unknown", label: d.unknown, detail: props.reason ?? d.noService }
					: deriveStatus(props, state, d);
				if (diag.rendered === 1) beacon("render", { tone: status.tone, label: status.label, hasDirectory: directory !== void 0 });
				let title = status.label;
				if (status.detail !== void 0 && status.detail !== "") title = `${status.label}：${status.detail}`;
				else if (status.providerName !== void 0) title = `${status.label} · ${status.providerName}`;
				if (status.meta !== void 0) title = `${title}（${status.meta}）`;
				return react.createElement(
					"button",
					{
						type: "button",
						className: "dms-status",
						title: `${title}（${d.hint}）`,
						"aria-label": title,
						onClick: () => {
							try {
								props.refresh?.();
							} catch {
								// 刷新失败落在共享 store，指示灯随快照归位。
							}
						}
					},
					react.createElement("span", { className: `dms-dot dms-dot--${status.tone}`, "aria-hidden": true }),
					react.createElement("span", { className: "dms-text" }, status.label)
				);
			}

			/** 渲染错误边界：捕获并上报，而不是被槽位边界静默摘除。 */
			class Guard extends react.Component {
				constructor(props) {
					super(props);
					this.state = { failed: false };
				}
				static getDerivedStateFromError() {
					return { failed: true };
				}
				componentDidCatch(err) {
					diag.lastError = String((err && err.message) || err);
					beacon("render-error", {
						message: diag.lastError,
						stack: String((err && err.stack) || "").slice(0, 400)
					});
				}
				render() {
					return this.state.failed ? null : this.props.children;
				}
			}

			/** 客户端插件主体：只注入 slots，其余服务惰性取用且允许缺失。 */
			function apply(ctx) {
				diag.applied = true;
				beacon("applied");
				ctx.inject(["slots"], (scope) => {
					try {
						const slots = scope.get("slots");
						if (slots === void 0) {
							beacon("injected-no-slots");
							return;
						}
						diag.injected = true;
						beacon("injected");
						/** 每会话刷新器（inject 结果按会话缓存，故每会话恰好登记一次）。 */
						const refreshers = new Set();
						// 周期刷新：只用原生 setInterval（见文件头纪律 2 —— 绝不触碰
						// scope.interval，访问即抛错并炸死整个作用域）。
						scope.effect(() => {
							const id = setInterval(() => {
								for (const refresh of [...refreshers]) {
									try {
										refresh();
									} catch {
										// 静默：失败落在共享 store。
									}
								}
							}, 60000);
							return () => clearInterval(id);
						}, "dsh-model-status: periodic refresh");

						/**
						 * 槽位状态探针：把 specDynamic / entries 的真实状态报回来。
						 * 背景：信标曾显示 slots.inject("conversation.input.right") 的
						 * 回调不触发——但那其实是 interval 访问把作用域炸死所致。
						 * 探针用于确认修复后的真实状态。
						 */
						function probeSlots(when) {
							const out = { when };
							const tryIt = (k, fn) => {
								try {
									const v = fn();
									out[k] = v === void 0 ? "undefined" : v;
								} catch (e) {
									out[k] = "ERR:" + String((e && e.message) || e);
								}
							};
							const core = slots._core ?? slots;
							tryIt("hasSpecDynamic", () => typeof core.specDynamic === "function");
							tryIt("specRight", () => (typeof core.specDynamic === "function" ? core.specDynamic(SLOT) !== void 0 : "n/a"));
							tryIt("entriesRight", () => (typeof slots.entries === "function" ? slots.entries(SLOT).length : "no-api"));
							beacon("probe", out);
						}
						probeSlots("at-apply");

						/**
						 * 注册策略：优先直接 register（会话模块注册自身槽位就是直接调用；
						 * 本插件加载在所有产品模块之后，apply 时槽位规范通常已存在）。
						 * 失败则回退 slots.inject 等待声明，再加两次延迟重试兜底。
						 */
						let disposeEntry = null;
						function tryRegister(path) {
							if (disposeEntry !== null) return true;
							try {
								const dispose = slots.register({
									name: SLOT,
									id: "dsh-model-status",
									order: 0,
									inject: (sessionId) => {
										try {
											const models = scope.get("modelDirectories");
											const sessions = scope.get("sessions");
											if (sessions !== void 0 && sessions.subagentAddress(sessionId) !== void 0) return { hidden: true };
											if (models === void 0) {
												diag.lastError = "modelDirectories service unavailable";
												beacon("session", { ok: false, reason: "modelDirectories unavailable" });
												return { reason: dictOf().noService };
											}
											const directory = models.directoryFor(sessionId);
											const refresh = () => directory.load().catch(() => {});
											refreshers.add(refresh);
											diag.sessions += 1;
											beacon("session", { ok: true });
											return {
												directory: directory.store,
												refresh,
												/** 渲染期读取会话事件日志（sessions.binding 是纯解析，渲染安全）。 */
												readEvents: () => {
													try {
														const svc = scope.get("sessions");
														const session = svc?.binding?.(sessionId)?.session;
														return Array.isArray(session?.events) ? session.events : [];
													} catch {
														return [];
													}
												}
											};
										} catch (error) {
											diag.lastError = String((error && error.message) || error);
											beacon("session-error", { message: diag.lastError });
											return { reason: diag.lastError };
										}
									}
								}, function (props) {
									return react.createElement(Guard, null, react.createElement(StatusLight, props));
								});
								disposeEntry = typeof dispose === "function" ? dispose : () => {};
								diag.registered = true;
								beacon("registered", { path });
								return true;
							} catch (e) {
								beacon("register-failed", { path, message: String((e && e.message) || e) });
								return false;
							}
						}
						if (tryRegister("direct")) {
							scope.effect(() => () => {
								try {
									disposeEntry();
								} catch {
									// 卸载失败静默。
								}
							}, "dsh-model-status: slot entry");
						} else {
							try {
								slots.inject(SLOT, () => {
									tryRegister("inject");
									return () => {
										try {
											disposeEntry();
										} catch {
											// 卸载失败静默。
										}
									};
								});
							} catch (e) {
								beacon("inject-call-error", { message: String((e && e.message) || e) });
							}
							setTimeout(() => {
								probeSlots("t+1.5s");
								tryRegister("retry-1.5s");
							}, 1500);
							setTimeout(() => {
								probeSlots("t+6s");
								tryRegister("retry-6s");
							}, 6000);
						}
					} catch (e) {
						beacon("apply-scope-error", {
							message: String((e && e.message) || e),
							stack: String((e && e.stack) || "").slice(0, 400)
						});
					}
				});
			}
			exports.apply = apply;
			exports.inject = ["slots"];
		} catch (e) {
			beacon("factory-error", {
				message: String((e && e.message) || e),
				stack: String((e && e.stack) || "").slice(0, 400)
			});
			throw e;
		}
		return module.exports;
	}
});

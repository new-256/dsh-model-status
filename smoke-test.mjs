// dsh-model-status 客户端 bundle 冒烟测试（Node 模拟浏览器环境）
// 用法：node smoke-test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, "lib", "client.js"), "utf8");

// —— 浏览器全局桩 ——
const fetchCalls = [];
globalThis.window = { __ModuleLoader__: { load: (m) => { globalThis.__captured = m; } } };
globalThis.document = {
	querySelector: () => null,
	createElement: () => ({ setAttribute() {}, textContent: "" }),
	head: { appendChild() {} },
	documentElement: { lang: "zh" }
};
Object.defineProperty(globalThis, "navigator", { value: { language: "zh-CN", userAgent: "smoke-test" }, configurable: true });
globalThis.location = { href: "http://127.0.0.1:65021/" };
globalThis.fetch = (url, opts) => {
	fetchCalls.push({ url, method: opts?.method, body: opts?.body });
	return Promise.resolve({ ok: true });
};

// 执行 bundle：注册工厂
(0, eval)(src);
const mod = globalThis.__captured;
if (!mod || mod.id !== "dsh-model-status") throw new Error("bundle 未注册到 __ModuleLoader__");

// —— React 桩（最小 createElement/hooks/Component）——
const react = {
	createElement(type, props, ...children) {
		const merged = { ...(props ?? {}) };
		if (children.length === 1) merged.children = children[0];
		else if (children.length > 1) merged.children = children;
		return { type, props: merged };
	},
	useSyncExternalStore(subscribe, getSnapshot) {
		return getSnapshot();
	},
	Component: class Component { constructor(props) { this.props = props; } }
};

// 跑工厂
const plugin = mod.factory((name) => {
	if (name === "react") return react;
	throw new Error(`unknown require: ${name}`);
});
if (plugin.inject?.[0] !== "slots") throw new Error(`exports.inject 应为 ["slots"]，实际 ${JSON.stringify(plugin.inject)}`);
if (typeof plugin.apply !== "function") throw new Error("exports.apply 缺失");

// —— Cordis ctx / slots / sessions / modelDirectories 服务桩 ——
const registrations = [];
const slots = {
	inject(slotName, cb) {
		if (slotName !== "conversation.input.right") throw new Error(`注入了未知槽位 ${slotName}`);
		cb();
		return () => {};
	},
	register(opts, component) {
		registrations.push({ opts, component });
		return () => {};
	}
};
// 会话事件日志（可变数组：模拟真实 Session.events 的渐进追加）
const sessionEvents = [];
const sessions = {
	subagentAddress: (id) => (id === "session-sub" ? "agent-1" : undefined),
	binding: (id) => (id === "session-smoke" ? { session: { events: sessionEvents } } : undefined)
};
const modelDirectories = {
	directoryFor(sessionId) {
		return {
			store: {
				subscribe() { return () => {}; },
				getSnapshot() {
					return { status: "ready", current: { provider: "openrouter" }, routable: true, groups: [{ id: "openrouter", name: "OpenRouter" }], failures: [], error: null };
				}
			},
			load() { return Promise.resolve(); }
		};
	}
};
const scopeBase = {
	get(name) {
		if (name === "slots") return slots;
		if (name === "modelDirectories") return modelDirectories;
		if (name === "sessions") return sessions;
		return undefined;
	},
	effect(fn) { return fn(); }
};
// 模拟真实 Cordis 上下文：访问未注册的服务属性（如 timer mixin 的 interval）
// 直接抛错 —— 曾经炸死整个 apply 作用域的致命坑，冒烟测试必须复现它。
const scope = new Proxy(scopeBase, {
	get(target, prop) {
		if (prop === "interval") throw new Error("simulated cordis: service \"timer\" is not registered");
		return target[prop];
	}
});
const ctx = {
	inject(deps, cb) { return cb(scope); },
	effect(fn) { return fn(); }
};

// 跑 apply
plugin.apply(ctx);
if (registrations.length !== 1) throw new Error(`应注册 1 个槽位条目，实际 ${registrations.length}`);
const { opts, component } = registrations[0];
if (opts.id !== "dsh-model-status") throw new Error(`list 槽条目缺 id: ${JSON.stringify(opts)}`);
if (typeof opts.inject !== "function") throw new Error("条目缺 inject 回调");

// 模拟渲染：槽位系统先调 inject(sessionId) 合并 props，再渲染组件
const injected = opts.inject("session-smoke");
if (injected.directory === undefined || typeof injected.refresh !== "function" || typeof injected.readEvents !== "function") {
	throw new Error(`inject 返回异常: ${JSON.stringify(Object.keys(injected))}`);
}
// 迷你渲染器：像真 React 一样逐层调用函数/类组件，直到宿主元素
function renderDeep(node) {
	for (let i = 0; i < 10 && node && typeof node === "object"; i++) {
		if (Array.isArray(node)) {
			if (node.length === 1) { node = node[0]; continue; }
			break;
		}
		if (typeof node.type === "function") {
			if (node.type.prototype && typeof node.type.prototype.render === "function") {
				const inst = new node.type(node.props);
				node = inst.render();
			} else {
				node = node.type(node.props);
			}
		} else {
			break;
		}
	}
	return node;
}
/** 渲染当前 props 下的状态灯，返回 {dot, title}。 */
function renderLight(props) {
	const light = renderDeep(component(props));
	if (light === null) return { null: true };
	const kids = light.props.children;
	const dot = Array.isArray(kids) ? kids[0] : kids;
	return { dot: dot?.props?.className, title: String(light.props.title), text: Array.isArray(kids) ? kids[1]?.props?.children : undefined };
}
function assertEq(actual, expected, what) {
	if (actual !== expected) throw new Error(`${what}: 期望 ${expected}，实际 ${actual}`);
}

// ── 场景 1：无事件历史 → 目录层绿色 ──
let r = renderLight(injected);
assertEq(r.dot, "dms-dot dms-dot--ok", "场景1 圆点");
if (!r.title.includes("已连通")) throw new Error(`场景1 title 未含已连通: ${r.title}`);

// ── 场景 2：额度耗尽（QUOTA 终止失败，归属滚动路由 openrouter）──
sessionEvents.push(
	{ seq: 1, time: "2026-08-29T13:00:00Z", type: "request/context", data: { provider: "openrouter", model: "m-dead" } },
	{ seq: 2, time: "2026-08-29T13:00:05Z", type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { code: "QUOTA", message: "402 你账户余额不足" } } } }
);
r = renderLight(injected);
assertEq(r.dot, "dms-dot dms-dot--error", "场景2 圆点");
assertEq(r.text, "额度耗尽", "场景2 标签");
if (!r.title.includes("402 你账户余额不足")) throw new Error(`场景2 title 未含失败消息: ${r.title}`);
if (!r.title.includes("m-dead")) throw new Error(`场景2 title 未含失败时模型: ${r.title}`);

// ── 场景 3：同 provider 成功服务一轮 → 记忆清除，恢复绿 ──
sessionEvents.push(
	{ seq: 3, time: "2026-08-29T13:05:00Z", type: "turn/end", data: { turn: 2, reason: { kind: "stop" } } }
);
r = renderLight(injected);
assertEq(r.dot, "dms-dot dms-dot--ok", "场景3 圆点");

// ── 场景 4：限流（llm/retry 事件，warn 黄）──
sessionEvents.push(
	{ seq: 4, time: "2026-08-29T13:10:00Z", type: "llm/retry", data: { retryId: "r1", turn: 3, provider: "openrouter", failure: { code: "RATE_LIMIT", message: "429 too many requests" }, retry: 1 } }
);
r = renderLight(injected);
assertEq(r.dot, "dms-dot dms-dot--warn", "场景4 圆点");
assertEq(r.text, "限流", "场景4 标签");

// ── 场景 5：别的 provider 失败（deepseek）不影响当前 provider（openrouter）──
sessionEvents.length = 0;
sessionEvents.push(
	{ seq: 1, time: "2026-08-29T13:20:00Z", type: "request/context", data: { provider: "deepseek", model: "m-x" } },
	{ seq: 2, time: "2026-08-29T13:20:05Z", type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { code: "QUOTA", message: "402" } } } },
	{ seq: 3, time: "2026-08-29T13:21:00Z", type: "request/context", data: { provider: "openrouter", model: "m-y" } }
);
r = renderLight(injected);
assertEq(r.dot, "dms-dot dms-dot--ok", "场景5 圆点（deepseek 的失败不该染红 openrouter）");

// ── 场景 6：request/header 路由跟踪 + 会话级实时失败（lastAgentError）──
sessionEvents.length = 0;
sessionEvents.push(
	{ seq: 1, time: "2026-08-29T13:30:00Z", type: "request/header", data: { header: { config: { provider: "openrouter", model: "m-h" } } } },
	{ seq: 2, time: "2026-08-29T13:30:05Z", type: "turn/end", data: { turn: 1, reason: { kind: "error", error: { code: "AUTH" } } } }
);
r = renderLight(injected);
assertEq(r.text, "密钥无效", "场景6 标签（AUTH 特判）");
r = renderLight({ ...injected, session: { lastAgentError: "boom: connection reset" } });
assertEq(r.dot, "dms-dot dms-dot--error", "场景6b 圆点（lastAgentError）");
if (!r.title.includes("connection reset")) throw new Error(`场景6b title 未含实时错误: ${r.title}`);

// ── 场景 7：无目录时的降级渲染（缺服务 → 灰色未知，绝不 null）──
if (renderDeep(component({ reason: "smoke" })) === null) throw new Error("无 directory 时渲染成了 null —— 违反可见性纪律");

// ── 场景 8：子代理会话 → hidden → null（唯一允许 null 的路径）──
if (opts.inject("session-sub")?.hidden !== true) throw new Error("子代理会话未返回 hidden");

// —— 信标核查 ——
const stages = fetchCalls.map((c) => { try { return JSON.parse(c.body).stage; } catch { return "?"; } });
const need = ["module", "applied", "injected", "registered", "session", "render"];
for (const s of need) {
	if (!stages.includes(s)) throw new Error(`缺少信标阶段 ${s}（实际: ${stages.join(",")}）`);
}
if (!fetchCalls.every((c) => c.url === "/dsh-model-status/beacon" && c.method === "POST")) {
	throw new Error("存在非 beacon 的 fetch 调用");
}

console.log("SMOKE OK");
console.log("  注册槽位   :", opts.name, "id=" + opts.id, "order=" + opts.order);
console.log("  场景通过   : 1绿 → 2额度红 → 3成功转绿 → 4限流黄 → 5跨provider隔离 → 6AUTH/实时错误 → 7降级 → 8隐藏");
console.log("  信标阶段   :", stages.join(" → "));
console.log("  window.__dshModelStatus.rendered =", globalThis.window.__dshModelStatus.rendered);
// 周期刷新的 setInterval 回退会挂住事件循环，显式退出
process.exit(0);

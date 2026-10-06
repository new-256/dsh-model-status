// dsh-model-status — host half.
//
// 本包的功能主体在客户端一半（lib/client.js）：状态数据复用产品已有的
// modelDirectories 服务（每个会话共享的模型目录 store），无需新的业务 host
// RPC。host 一半提供「诊断信标」：
//
//   POST /dsh-model-status/beacon  客户端在 bundle 执行的每个里程碑上报
//                                  （module → applied → injected → registered
//                                   → session → render，以及各类 error）。
//   GET  /dsh-model-status/health  返回各阶段计数与最近事件，排障时一眼
//                                  定位渲染端卡在哪一步。
//
// 背景：桌面版无法方便地打开 DevTools，插件若在渲染端失败（bundle 未被执行、
// 服务注入不解析、组件渲染抛错被错误边界静默摘除）则界面上什么都不出现、
// 也无处看报错。信标把这些盲区变成服务端可观测事实。
export const name = "dsh-model-status";
export const inject = [];

const startedAt = new Date().toISOString();
/** stage -> { count, first, last } */
const marks = Object.create(null);
const events = [];
const MAX_EVENTS = 120;

function record(stage, info) {
	const now = new Date().toISOString();
	const m = marks[stage] ?? (marks[stage] = { count: 0, first: now, last: now });
	m.count += 1;
	m.last = now;
	events.push({ ts: now, stage, info: info ?? null });
	if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

function sendJson(res, code, value) {
	const body = JSON.stringify(value, null, 2);
	res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	res.end(body);
}

/** 读取（有上限的）请求体后回调文本。 */
function readBody(req, cb) {
	const chunks = [];
	req.on("data", (c) => {
		if (chunks.length < 16) chunks.push(c);
	});
	req.on("end", () => cb(Buffer.concat(chunks).toString("utf8")));
	req.on("error", () => cb(""));
}

export function apply(ctx) {
	if (typeof ctx.inject !== "function") return;
	ctx.inject(["webServer"], (webCtx) => {
		const ws = webCtx.get("webServer");
		if (!ws || typeof ws.register !== "function") return;
		webCtx.effect(() => ws.register({
			kind: "exact",
			path: "/dsh-model-status/health",
			handler: (req, res) => {
				try {
					sendJson(res, 200, {
						ok: true,
						hostStartedAt: startedAt,
						marks,
						events: events.slice(-40),
						reading: {
							module: "bundle 工厂已执行（浏览器确实下载并运行了 client.js）",
							applied: "apply 已执行（模块级 exports.inject 的服务全部解析）",
							injected: "ctx.inject(['slots']) 已触发（客户端 slots 服务就绪）",
							registered: "已注册进 conversation.input.right（槽位已声明）",
							session: "槽位 inject 已为某会话取到目录 store",
							render: "组件确实渲染（信标到这一步 = 灯应当出现在界面上）"
						},
						hint: "无任何 mark = 渲染端从未执行本插件 bundle（页面用了旧清单/未加载插件）；只有 module = 模块级服务注入卡住；依次类推。"
					});
				} catch (e) {
					sendJson(res, 500, { error: String((e && e.message) || e) });
				}
			}
		}), "dsh-model-status: health route");
		webCtx.effect(() => ws.register({
			kind: "exact",
			path: "/dsh-model-status/beacon",
			handler: (req, res) => {
				if (req.method !== "POST") {
					res.writeHead(405, { "Cache-Control": "no-store" });
					res.end();
					return;
				}
				readBody(req, (text) => {
					try {
						const payload = text ? JSON.parse(text) : {};
						const stage = String(payload.stage || "unknown");
						const info = { ...payload };
						delete info.stage;
						record(stage, info);
					} catch {
						record("bad-beacon", { raw: String(text).slice(0, 200) });
					}
					res.writeHead(204, { "Cache-Control": "no-store" });
					res.end();
				});
			}
		}), "dsh-model-status: beacon route");
	});
}

// metrics/index.tsx
import { useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var NAME = "Metrics";
var STALE_HOURS = 26;
var CACHE_KEY = "lastMetrics";
var HISTORY_DIR = "history";
var MAX_DAYS = 90;
var DEFAULT_BUCKET = "boxopher-metrics-429357724212";
var state = { data: null, history: [], error: null, loading: false };
var listeners = /* @__PURE__ */ new Set();
function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
var isErrorNode = (v) => v !== null && typeof v === "object" && typeof v.error === "string";
function hasErrorNode(v) {
  if (isErrorNode(v)) return true;
  if (Array.isArray(v)) return v.some(hasErrorNode);
  if (v && typeof v === "object") return Object.values(v).some(hasErrorNode);
  return false;
}
var money = new Intl.NumberFormat(void 0, { style: "currency", currency: "USD" });
var compact = new Intl.NumberFormat(void 0, { notation: "compact", maximumFractionDigits: 1 });
var MONEY_KEY = /(mrr|profit|cost|amount|revenue)/i;
function fmt(v, key = "") {
  if (v === null || v === void 0) return "Unknown";
  if (isErrorNode(v)) return `Unknown (${v.error})`;
  if (typeof v === "number") {
    if (MONEY_KEY.test(key)) return money.format(v);
    if (/latencyms/i.test(key)) return `${Math.round(v)} ms`;
    return v.toLocaleString();
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
var cell = (v, key = "") => v === void 0 ? "-" : fmt(v, key);
var axisFmt = (key) => (n) => MONEY_KEY.test(key) ? money.format(n) : compact.format(n);
function ageHours(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : (Date.now() - t) / 36e5;
}
var shortDate = (d) => (/* @__PURE__ */ new Date(`${d}T00:00:00Z`)).toLocaleDateString(void 0, { month: "short", day: "numeric", timeZone: "UTC" });
var appsOf = (doc) => doc && Array.isArray(doc.apps) ? doc.apps : [];
function metric(o, path) {
  let v = o;
  for (const k of path.split(".")) {
    if (v === void 0) return void 0;
    if (v === null || isErrorNode(v)) return null;
    v = v[k];
  }
  if (v === void 0) return void 0;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function sumApps(doc, path) {
  if (!doc || isErrorNode(doc.apps)) return null;
  const vals = appsOf(doc).map((a) => metric(a, path)).filter((v) => v !== void 0);
  if (vals.length === 0) return void 0;
  return vals.some((v) => v === null) ? null : vals.reduce((a, b) => a + b, 0);
}
function appStatus(app) {
  if (hasErrorNode(app)) return "warning";
  if ((app.health?.alarms?.inAlarm ?? 0) > 0) return "warning";
  if ((app.health?.freshness?.staleStates ?? 0) > 0) return "warning";
  return "success";
}
var WORST = ["idle", "success", "warning", "error"];
var worst = (cs) => cs.reduce((a, b) => WORST.indexOf(b) > WORST.indexOf(a) ? b : a, "success");
function docStatus(doc) {
  const age = ageHours(doc.generatedAt);
  const stale = age === null || age > STALE_HOURS;
  const status = worst(appsOf(doc).map(appStatus));
  return stale || hasErrorNode(doc) ? worst([status, "warning"]) : status;
}
function allDays() {
  const m = new Map(state.history.map((d) => [d.date, d.doc]));
  if (typeof state.data?.generatedAt === "string") m.set(state.data.generatedAt.slice(0, 10), state.data);
  return [...m.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([date, doc]) => ({ date, doc }));
}
async function awsArgs(api, args) {
  const s = await api.settings.get();
  const out = [...args, "--cli-connect-timeout", "10", "--cli-read-timeout", "15"];
  if (s.awsProfile) out.push("--profile", s.awsProfile);
  return out;
}
async function aws(api, args) {
  const res = await api.shell.exec("aws", await awsArgs(api, args));
  if (res.code !== 0) throw new Error(res.stderr.trim() || `aws exited with code ${res.code}`);
  return res.stdout;
}
async function loadHistory(api) {
  const entries = await api.fs.listDir(HISTORY_DIR);
  const files = entries.filter((e) => !e.isDir && /^\d{4}-\d{2}-\d{2}\.json$/.test(e.name)).map((e) => e.name).sort().slice(-MAX_DAYS);
  const docs = await Promise.all(
    files.map(async (f) => {
      try {
        return JSON.parse(await api.fs.readTextFile(`${HISTORY_DIR}/${f}`));
      } catch {
        return null;
      }
    })
  );
  setState({ history: files.map((f, i) => ({ date: f.slice(0, 10), doc: docs[i] })).filter((d) => d.doc) });
}
async function syncHistory(api, bucket) {
  const root = (await api.fs.getRootPath()).replace(/[\\/]+$/, "");
  await aws(api, ["s3", "sync", `s3://${bucket}/${HISTORY_DIR}/`, `${root}/${HISTORY_DIR}`, "--only-show-errors"]);
  await loadHistory(api);
}
async function refresh(api, signal) {
  if (state.loading) return;
  setState({ loading: true });
  const setIcon = (c, tip) => {
    if (signal?.aborted) return;
    try {
      api.statusIcon.set(c, tip);
    } catch {
    }
  };
  const log = (level, msg) => {
    if (signal?.aborted) return;
    try {
      api.log[level](`${NAME}: ${msg}`);
    } catch {
    }
  };
  setIcon("in-progress", "Refreshing");
  try {
    const bucket = (await api.settings.get()).bucket || DEFAULT_BUCKET;
    const data = JSON.parse(await aws(api, ["s3", "cp", `s3://${bucket}/metrics.json`, "-"]));
    await api.storage.set(CACHE_KEY, data);
    setState({ data, error: null });
    let status = docStatus(data);
    let tip = status === "success" ? "Metrics up to date" : "Metrics need attention";
    try {
      await syncHistory(api, bucket);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("warn", `history sync failed: ${msg}`);
      status = worst([status, "warning"]);
      tip = `History sync failed: ${msg}`;
    }
    setState({ loading: false });
    setIcon(status, tip);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setState({ error: msg, loading: false });
    setIcon("error", msg);
    log("error", msg);
  }
}
async function activate(ctx) {
  ctx.api.statusIcon.set("idle");
  const s = await ctx.api.settings.get();
  const minutes = Math.max(1, s.refreshMinutes ?? 60);
  ctx.tick.register(() => refresh(ctx.api, ctx.signal));
  ctx.tick.setInterval(minutes * 6e4);
  ctx.api.log.info(`${NAME} activated`);
  void loadHistory(ctx.api).catch(() => void 0);
  void refresh(ctx.api, ctx.signal);
}
var scrollbarStyle = (p) => ({ scrollbarWidth: "thin", scrollbarColor: `${p.border} ${p.surface}` });
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function Tooltip({ p, x, y, flip, children }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        position: "absolute",
        left: x,
        top: y,
        transform: flip ? "translateX(-100%)" : void 0,
        background: p.background,
        color: p.text,
        border: `1px solid ${p.border}`,
        borderRadius: 4,
        padding: "4px 8px",
        fontSize: 12,
        lineHeight: "18px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 1
      },
      children
    }
  );
}
function LineChart({ api, points, format, height = 150 }) {
  const p = api.theme.palette;
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const L = 56, R = 12, T = 10, B = 22;
  const w = Math.max(1, width - L - R);
  const h = height - T - B;
  const n = points.length;
  const max = niceMax(Math.max(0, ...points.map((pt) => pt.value ?? 0)));
  const x = (i) => L + (n <= 1 ? w / 2 : i * w / (n - 1));
  const y = (v) => T + h - v / max * h;
  const runs = [];
  let cur = [];
  points.forEach((pt, i) => {
    if (pt.value === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) runs.push(cur);
  const line = (run) => run.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(points[i].value)}`).join("");
  const lastKnown = [...points.keys()].reverse().find((i) => points[i].value !== null);
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = n <= 1 ? 0 : Math.round((e.clientX - r.left) / r.width * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };
  const xLabels = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
  const anchor = (i) => n <= 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle";
  return /* @__PURE__ */ jsxs("div", { ref, style: { position: "relative", height }, children: [
    width > 0 && /* @__PURE__ */ jsxs("svg", { width, height, style: { display: "block", fontSize: 12 }, children: [
      [0, 0.5, 1].map((f) => /* @__PURE__ */ jsxs("g", { children: [
        /* @__PURE__ */ jsx("line", { x1: L, x2: L + w, y1: y(max * f), y2: y(max * f), stroke: p.border, strokeWidth: 1, strokeDasharray: f ? "2 4" : void 0 }),
        /* @__PURE__ */ jsx("text", { x: L - 6, y: y(max * f), dy: "0.32em", textAnchor: "end", fill: p.textMuted, children: format(max * f) })
      ] }, f)),
      xLabels.map((i) => /* @__PURE__ */ jsx("text", { x: x(i), y: height - 4, textAnchor: anchor(i), fill: p.textMuted, children: points[i]?.label }, i)),
      runs.map(
        (run) => run.length > 1 ? /* @__PURE__ */ jsxs("g", { children: [
          /* @__PURE__ */ jsx("path", { d: `${line(run)}L${x(run[run.length - 1])},${y(0)}L${x(run[0])},${y(0)}Z`, fill: p.accent, fillOpacity: 0.12 }),
          /* @__PURE__ */ jsx("path", { d: line(run), fill: "none", stroke: p.accent, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" })
        ] }, run[0]) : null
      ),
      runs.filter((run) => run.length === 1).map((run) => /* @__PURE__ */ jsx("circle", { cx: x(run[0]), cy: y(points[run[0]].value), r: 3, fill: p.accent }, run[0])),
      lastKnown !== void 0 && hover === null && /* @__PURE__ */ jsx("circle", { cx: x(lastKnown), cy: y(points[lastKnown].value), r: 3.5, fill: p.accent, stroke: p.surface, strokeWidth: 2 }),
      hover !== null && /* @__PURE__ */ jsxs("g", { pointerEvents: "none", children: [
        /* @__PURE__ */ jsx("line", { x1: x(hover), x2: x(hover), y1: T, y2: T + h, stroke: p.textMuted, strokeWidth: 1 }),
        points[hover].value !== null && /* @__PURE__ */ jsx("circle", { cx: x(hover), cy: y(points[hover].value), r: 4.5, fill: p.accent, stroke: p.surface, strokeWidth: 2 })
      ] }),
      /* @__PURE__ */ jsx("rect", { x: L, y: 0, width: w, height, fill: "transparent", onMouseMove: onMove, onMouseLeave: () => setHover(null) })
    ] }),
    hover !== null && /* @__PURE__ */ jsxs(Tooltip, { p, x: x(hover) + (x(hover) > width - 140 ? -10 : 10), y: T, flip: x(hover) > width - 140, children: [
      /* @__PURE__ */ jsx("div", { style: { color: p.textMuted }, children: points[hover].label }),
      /* @__PURE__ */ jsx("div", { children: points[hover].value === null ? "Unknown" : format(points[hover].value) })
    ] })
  ] });
}
function Legend({ api, items }) {
  const p = api.theme.palette;
  return /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: p.textMuted }, children: items.map((it) => /* @__PURE__ */ jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, children: [
    /* @__PURE__ */ jsx("span", { style: { width: 10, height: 10, borderRadius: 2, background: it.color } }),
    it.name
  ] }, it.name)) });
}
function BarList({ api, rows }) {
  const p = api.theme.palette;
  const [hover, setHover] = useState(null);
  const max = Math.max(0, ...rows.map((r) => r.segments.reduce((a, s) => a + s.value, 0))) || 1;
  if (rows.length === 0) return /* @__PURE__ */ jsx("span", { style: { color: p.textMuted }, children: "None" });
  return /* @__PURE__ */ jsxs("div", { style: { position: "relative" }, onMouseLeave: () => setHover(null), children: [
    /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "minmax(0, max-content) 1fr max-content", gap: "2px 12px", alignItems: "center", fontSize: 14 }, children: rows.map((r, i) => {
      const total = r.segments.reduce((a, s) => a + s.value, 0);
      const hot = hover?.i === i;
      const cell2 = { background: hot ? p.surfaceHover : void 0, padding: "2px 0" };
      return /* @__PURE__ */ jsxs(
        "div",
        {
          style: { display: "contents" },
          onMouseMove: (e) => {
            const box = e.currentTarget.parentElement.getBoundingClientRect();
            setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top, w: box.width });
          },
          children: [
            /* @__PURE__ */ jsx("span", { style: { ...cell2, color: hot ? p.accent : p.text, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: r.label, children: r.label }),
            /* @__PURE__ */ jsx("div", { style: { ...cell2, display: "flex", height: 22, alignItems: "center" }, children: /* @__PURE__ */ jsx("div", { style: { display: "flex", width: `${total / max * 100}%`, height: 12, gap: 1, minWidth: total > 0 ? 2 : 0 }, children: r.segments.filter((s) => s.value > 0).map((s, k, arr) => /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  flex: s.value,
                  background: s.color,
                  borderRadius: `${k === 0 ? 2 : 0}px ${k === arr.length - 1 ? 2 : 0}px ${k === arr.length - 1 ? 2 : 0}px ${k === 0 ? 2 : 0}px`
                }
              },
              s.name
            )) }) }),
            /* @__PURE__ */ jsx("span", { style: { ...cell2, textAlign: "right", fontVariantNumeric: "tabular-nums" }, children: r.valueText })
          ]
        },
        r.label
      );
    }) }),
    hover && rows[hover.i] && /* @__PURE__ */ jsxs(Tooltip, { p, x: hover.x + (hover.x > hover.w - 180 ? -12 : 12), y: hover.y + 12, flip: hover.x > hover.w - 180, children: [
      /* @__PURE__ */ jsx("div", { style: { fontWeight: 600 }, children: rows[hover.i].label }),
      rows[hover.i].tip.map((t) => /* @__PURE__ */ jsx("div", { children: t }, t))
    ] })
  ] });
}
function Tile({ api, label, value, delta }) {
  const p = api.theme.palette;
  return /* @__PURE__ */ jsxs("div", { style: { background: p.surface, border: `1px solid ${p.border}`, borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }, children: [
    /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: label }),
    /* @__PURE__ */ jsx("span", { style: { fontSize: 22, lineHeight: "30px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }, children: value }),
    delta && /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: delta })
  ] });
}
var Tiles = ({ children }) => /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }, children });
var ChartGrid = ({ children }) => /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12, alignItems: "start" }, children });
function Section({ api, title, extra, children }) {
  const p = api.theme.palette;
  return /* @__PURE__ */ jsxs("div", { style: { background: p.surface, border: `1px solid ${p.border}`, borderRadius: 6, padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ jsx("strong", { style: { flex: 1 }, children: title }),
      extra
    ] }),
    children
  ] });
}
function trendTile(api, days, t) {
  const vals = days.map((d) => t.get(d.doc));
  const cur = vals[vals.length - 1];
  const prev = vals.length > 1 ? vals[vals.length - 2] : void 0;
  let delta = null;
  if (typeof cur === "number" && typeof prev === "number") {
    const d = cur - prev;
    const abs = MONEY_KEY.test(t.key) ? money.format(Math.abs(d)) : Math.abs(d).toLocaleString();
    delta = `${d > 0 ? "+" : d < 0 ? "-" : "\xB1"}${abs} vs ${shortDate(days[days.length - 2].date)}`;
  }
  return /* @__PURE__ */ jsx(Tile, { api, label: t.title, value: fmt(cur, t.key), delta }, t.title);
}
function TrendCharts({ api, days, trends }) {
  const p = api.theme.palette;
  const shown = trends.map((t) => ({ t, points: days.map((d) => ({ label: shortDate(d.date), raw: t.get(d.doc) })) })).filter(({ points }) => points.some((pt) => pt.raw !== void 0));
  if (shown.length === 0) return null;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    days.length < 2 && /* @__PURE__ */ jsxs("span", { style: { color: p.textMuted, fontSize: 12 }, children: [
      "Trends fill in as daily history accumulates (",
      days.length,
      " day so far)."
    ] }),
    /* @__PURE__ */ jsx(ChartGrid, { children: shown.map(({ t, points }) => /* @__PURE__ */ jsx(Section, { api, title: `${t.title} Trend`, children: /* @__PURE__ */ jsx(LineChart, { api, points: points.map((pt) => ({ label: pt.label, value: pt.raw ?? null })), format: axisFmt(t.key) }) }, t.title)) })
  ] });
}
function costRows(api, cost) {
  const p = api.theme.palette;
  return Object.entries(cost?.byTag ?? {}).filter(([, v]) => typeof v === "number").sort(([, a], [, b]) => b - a).map(([k, v]) => ({
    label: k,
    segments: [{ name: "Cost", value: v, color: p.accent }],
    valueText: money.format(v),
    tip: [`${money.format(v)} (${cost.total ? (v / cost.total * 100).toFixed(1) : "0"}% of total)`]
  }));
}
var OVERVIEW_TRENDS = [
  { title: "AWS Cost (30d)", key: "cost", get: (d) => metric(d, "awsCost.total") },
  { title: "Requests (24h)", key: "", get: (d) => sumApps(d, "monitoring.totals.requests") },
  { title: "Lambda Errors (24h)", key: "", get: (d) => sumApps(d, "monitoring.totals.lambdaErrors") },
  { title: "5xx Errors (24h)", key: "", get: (d) => sumApps(d, "monitoring.totals.errors5xx") },
  { title: "Alarms Firing", key: "", get: (d) => sumApps(d, "health.alarms.inAlarm") },
  { title: "Paying Customers", key: "", get: (d) => sumApps(d, "customers.paying") }
];
function Overview({ api, doc, days }) {
  const { StatusDot } = api.ui;
  const p = api.theme.palette;
  const apps = appsOf(doc);
  const cost = doc.awsCost;
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
    /* @__PURE__ */ jsx(Tiles, { children: OVERVIEW_TRENDS.filter((t) => t.get(doc) !== void 0).map((t) => trendTile(api, days, t)) }),
    /* @__PURE__ */ jsx(TrendCharts, { api, days, trends: OVERVIEW_TRENDS.slice(0, 3) }),
    /* @__PURE__ */ jsxs(ChartGrid, { children: [
      /* @__PURE__ */ jsx(Section, { api, title: "Apps", children: /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "auto 1fr max-content max-content max-content", gap: "4px 16px", alignItems: "center" }, children: [
        ["", "App", "Requests", "Errors", "Profit (30d)"].map((h) => /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: h }, h || "dot")),
        apps.map((a) => /* @__PURE__ */ jsxs("div", { style: { display: "contents" }, children: [
          /* @__PURE__ */ jsx(StatusDot, { color: appStatus(a) }),
          /* @__PURE__ */ jsx("span", { children: a.name }),
          /* @__PURE__ */ jsx("span", { children: cell(metric(a, "monitoring.totals.requests")) }),
          /* @__PURE__ */ jsx("span", { children: cell(metric(a, "monitoring.totals.lambdaErrors")) }),
          /* @__PURE__ */ jsx("span", { children: cell(metric(a, "money.profit30d"), "profit") })
        ] }, a.name))
      ] }) }),
      /* @__PURE__ */ jsx(Section, { api, title: `AWS Cost By Project${cost && !isErrorNode(cost) ? ` (${shortDate(cost.windowStart)} To ${shortDate(cost.windowEnd)})` : ""}`, children: !cost || isErrorNode(cost) ? /* @__PURE__ */ jsx("span", { children: fmt(cost) }) : /* @__PURE__ */ jsx(BarList, { api, rows: costRows(api, cost) }) })
    ] })
  ] });
}
function lambdaRows(api, lambdas) {
  const p = api.theme.palette;
  const rows = [];
  const unknown = [];
  let idle = 0;
  for (const [fn, v] of Object.entries(lambdas ?? {})) {
    const inv = metric(v, "invocations");
    if (typeof inv !== "number") {
      unknown.push(fn);
      continue;
    }
    if (inv === 0) {
      idle++;
      continue;
    }
    const err = metric(v, "errors") ?? 0;
    const thr = metric(v, "throttles") ?? 0;
    rows.push({
      label: fn,
      segments: [
        { name: "Succeeded", value: Math.max(0, inv - err), color: p.accent },
        { name: "Errors", value: err, color: p.status.error }
      ],
      valueText: err ? `${inv.toLocaleString()} (${(err / inv * 100).toFixed(0)}% Err)` : inv.toLocaleString(),
      tip: [`${inv.toLocaleString()} invocations`, `${err.toLocaleString()} errors`, `${thr.toLocaleString()} throttles`]
    });
  }
  rows.sort((a, b) => b.segments[0].value + b.segments[1].value - (a.segments[0].value + a.segments[1].value));
  return { rows, idle, unknown };
}
function apiRows(api, apis) {
  const p = api.theme.palette;
  return Object.entries(apis ?? {}).filter(([, v]) => typeof metric(v, "requests") === "number").map(([name, v]) => {
    const req = metric(v, "requests");
    const e4 = metric(v, "errors4xx") ?? 0;
    const e5 = metric(v, "errors5xx") ?? 0;
    return {
      label: name,
      segments: [
        { name: "OK", value: Math.max(0, req - e4 - e5), color: p.accent },
        { name: "4xx", value: e4, color: p.status.warning },
        { name: "5xx", value: e5, color: p.status.error }
      ],
      valueText: req.toLocaleString(),
      tip: [`${req.toLocaleString()} requests`, `${e4.toLocaleString()} 4xx, ${e5.toLocaleString()} 5xx`, `p95 latency: ${fmt(v.p95LatencyMs, "latencyms")}`]
    };
  }).sort((a, b) => b.segments.reduce((s, x) => s + x.value, 0) - a.segments.reduce((s, x) => s + x.value, 0));
}
function Rows({ api, value, path = "" }) {
  const p = api.theme.palette;
  if (value === null || typeof value !== "object" || isErrorNode(value)) {
    return /* @__PURE__ */ jsx("span", { children: fmt(value, path) });
  }
  const entries = Object.entries(value).filter(([, v]) => !(typeof v === "string" && (v.length > 80 || v.includes("\n"))));
  if (entries.length === 0) return /* @__PURE__ */ jsx("span", { style: { color: p.textMuted }, children: "None" });
  return /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 16px" }, children: entries.map(([k, v]) => {
    const nested = v !== null && typeof v === "object" && !isErrorNode(v);
    return /* @__PURE__ */ jsxs("div", { style: { display: "contents" }, children: [
      /* @__PURE__ */ jsx("span", { style: { color: p.textMuted }, children: titleCase(k) }),
      /* @__PURE__ */ jsx("span", { children: nested ? Array.isArray(v) ? /* @__PURE__ */ jsx("span", { children: v.length ? v.join(", ") : "None" }) : /* @__PURE__ */ jsx(Rows, { api, value: v, path: k }) : fmt(v, k) })
    ] }, k);
  }) });
}
var titleCase = (s) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
var APP_TRENDS = [
  { title: "Requests (24h)", key: "", get: (a) => metric(a, "monitoring.totals.requests") },
  { title: "Lambda Errors (24h)", key: "", get: (a) => metric(a, "monitoring.totals.lambdaErrors") },
  { title: "Paying Customers", key: "", get: (a) => metric(a, "customers.paying") },
  { title: "MRR", key: "mrr", get: (a) => metric(a, "money.mrr") },
  { title: "Profit (30d)", key: "profit", get: (a) => metric(a, "money.profit30d") }
];
function AppView({ api, app, days }) {
  const p = api.theme.palette;
  const appDays = days.map((d) => ({ date: d.date, doc: appsOf(d.doc).find((a) => a.name === app.name) })).filter((d) => d.doc);
  const mon = app.monitoring;
  const aud = app.audience;
  const audDays = aud && Array.isArray(aud.days) ? aud.days : [];
  const audKeys = audDays.length ? Object.keys(audDays[0]).filter((k) => k !== "date" && typeof audDays[0][k] === "number") : [];
  const lambdas = mon && !isErrorNode(mon) && !isErrorNode(mon.lambdas) ? lambdaRows(api, mon.lambdas) : null;
  const apis = mon && !isErrorNode(mon) && !isErrorNode(mon.apis) ? apiRows(api, mon.apis) : null;
  const details = Object.entries(app).filter(([k]) => k !== "name" && k !== "monitoring");
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
    /* @__PURE__ */ jsx(Tiles, { children: APP_TRENDS.filter((t) => t.get(app) !== void 0).map((t) => trendTile(api, appDays, t)) }),
    /* @__PURE__ */ jsx(TrendCharts, { api, days: appDays, trends: APP_TRENDS }),
    mon && isErrorNode(mon) && /* @__PURE__ */ jsx(Section, { api, title: "Monitoring (24h)", children: /* @__PURE__ */ jsx("span", { children: fmt(mon) }) }),
    apis?.length || lambdas?.rows.length ? /* @__PURE__ */ jsxs(ChartGrid, { children: [
      apis && apis.length > 0 && /* @__PURE__ */ jsx(
        Section,
        {
          api,
          title: "API Requests (24h)",
          extra: /* @__PURE__ */ jsx(Legend, { api, items: [{ name: "OK", color: p.accent }, { name: "4xx", color: p.status.warning }, { name: "5xx", color: p.status.error }] }),
          children: /* @__PURE__ */ jsx(BarList, { api, rows: apis })
        }
      ),
      lambdas && lambdas.rows.length > 0 && /* @__PURE__ */ jsxs(Section, { api, title: "Lambda Invocations (24h)", extra: /* @__PURE__ */ jsx(Legend, { api, items: [{ name: "Succeeded", color: p.accent }, { name: "Errors", color: p.status.error }] }), children: [
        /* @__PURE__ */ jsx(BarList, { api, rows: lambdas.rows }),
        (lambdas.idle > 0 || lambdas.unknown.length > 0) && /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: [lambdas.idle ? `${lambdas.idle} idle function${lambdas.idle > 1 ? "s" : ""} hidden` : "", lambdas.unknown.length ? `Unknown: ${lambdas.unknown.join(", ")}` : ""].filter(Boolean).join(". ") })
      ] })
    ] }) : null,
    audKeys.length > 0 && /* @__PURE__ */ jsxs(ChartGrid, { children: [
      audKeys.map((k) => /* @__PURE__ */ jsx(Section, { api, title: `Daily ${titleCase(k)}`, children: /* @__PURE__ */ jsx(
        LineChart,
        {
          api,
          points: audDays.map((d) => ({ label: shortDate(String(d.date)), value: typeof d[k] === "number" ? d[k] : null })),
          format: axisFmt(k)
        }
      ) }, k)),
      aud.sources30d && !isErrorNode(aud.sources30d) && /* @__PURE__ */ jsx(Section, { api, title: "Traffic Sources (30d)", children: /* @__PURE__ */ jsx(
        BarList,
        {
          api,
          rows: Object.entries(aud.sources30d).filter(([, v]) => typeof v === "number").sort(([, a], [, b]) => b - a).map(([k, v]) => ({ label: titleCase(k), segments: [{ name: "Views", value: v, color: p.accent }], valueText: v.toLocaleString(), tip: [`${v.toLocaleString()} views`] }))
        }
      ) })
    ] }),
    /* @__PURE__ */ jsx(ChartGrid, { children: details.map(([k, v]) => /* @__PURE__ */ jsx(Section, { api, title: titleCase(k), children: /* @__PURE__ */ jsx(Rows, { api, value: k === "audience" && v && !isErrorNode(v) ? Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== "days" && kk !== "sources30d")) : v, path: k }) }, k)) })
  ] });
}
function Component({ api }) {
  const { TextButton, Tabs, Banner, Spinner } = api.ui;
  const palette = api.theme.palette;
  const [, force] = useState(0);
  const [tab, setTab] = useState("overview");
  const [, setTheme] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    const unsub = api.theme.subscribe(() => setTheme((n) => n + 1));
    if (!state.data) {
      void api.storage.get(CACHE_KEY).then((cached) => {
        if (cached && !state.data) setState({ data: cached });
      });
    }
    return () => {
      listeners.delete(l);
      unsub();
    };
  }, [api]);
  const { data, error, loading } = state;
  const apps = appsOf(data);
  const days = allDays();
  const age = data ? ageHours(data.generatedAt) : null;
  const stale = data && (age === null || age > STALE_HOURS);
  const current = tab === "overview" ? null : apps.find((a) => a.name === tab);
  return /* @__PURE__ */ jsxs("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, color: palette.text }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, paddingRight: 24 }, children: [
      /* @__PURE__ */ jsx("h2", { style: { margin: 0 }, children: NAME }),
      /* @__PURE__ */ jsx("span", { style: { color: palette.textMuted, flex: 1 }, children: data ? `Generated ${data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "Unknown"} \xB7 ${days.length} Day${days.length === 1 ? "" : "s"} Of History` : "No Data Yet" }),
      loading && /* @__PURE__ */ jsx(Spinner, { size: 16 }),
      /* @__PURE__ */ jsx(TextButton, { label: "Refresh", variant: "primary", disabled: loading, onClick: () => void refresh(api) })
    ] }),
    error && /* @__PURE__ */ jsx(Banner, { message: `Could Not Load Metrics: ${error}`, tone: "error" }),
    stale && /* @__PURE__ */ jsx(Banner, { message: `Metrics Are Older Than ${STALE_HOURS} Hours; The Daily Collector May Have Failed`, tone: "warning" }),
    data && /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(
        Tabs,
        {
          tabs: [{ label: "Overview", value: "overview" }, ...apps.map((a) => ({ label: a.name, value: a.name }))],
          value: current ? tab : "overview",
          onChange: setTab
        }
      ),
      /* @__PURE__ */ jsx("div", { style: { ...scrollbarStyle(palette), flex: 1, minHeight: 0, overflow: "auto" }, children: current ? /* @__PURE__ */ jsx(AppView, { api, app: current, days }) : /* @__PURE__ */ jsx(Overview, { api, doc: data, days }) })
    ] })
  ] });
}
export {
  Component,
  activate
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIGxvYWRpbmc6IGJvb2xlYW47XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UgfTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIHN0YXRlID0geyAuLi5zdGF0ZSwgLi4ucGF0Y2ggfTtcbiAgbGlzdGVuZXJzLmZvckVhY2goKGwpID0+IGwoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tXG5cbmNvbnN0IGlzRXJyb3JOb2RlID0gKHY6IEpzb24pOiBib29sZWFuID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHYuZXJyb3IgPT09IFwic3RyaW5nXCI7XG5cbmZ1bmN0aW9uIGhhc0Vycm9yTm9kZSh2OiBKc29uKTogYm9vbGVhbiB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIHRydWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIGlmICh2ICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiKSByZXR1cm4gT2JqZWN0LnZhbHVlcyh2KS5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgbW9uZXkgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IHN0eWxlOiBcImN1cnJlbmN5XCIsIGN1cnJlbmN5OiBcIlVTRFwiIH0pO1xuY29uc3QgY29tcGFjdCA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgbm90YXRpb246IFwiY29tcGFjdFwiLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG5jb25zdCBNT05FWV9LRVkgPSAvKG1ycnxwcm9maXR8Y29zdHxhbW91bnR8cmV2ZW51ZSkvaTtcblxuLyoqIFNpbmdsZSBmb3JtYXR0ZXI6IG51bGwvdW5kZWZpbmVkL2Vycm9yIG5vZGVzIGFyZSBcIlVua25vd25cIiwgbmV2ZXIgemVyby4gKi9cbmZ1bmN0aW9uIGZtdCh2OiBKc29uLCBrZXkgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gXCJVbmtub3duXCI7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIGBVbmtub3duICgke3YuZXJyb3J9KWA7XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChNT05FWV9LRVkudGVzdChrZXkpKSByZXR1cm4gbW9uZXkuZm9ybWF0KHYpO1xuICAgIGlmICgvbGF0ZW5jeW1zL2kudGVzdChrZXkpKSByZXR1cm4gYCR7TWF0aC5yb3VuZCh2KX0gbXNgO1xuICAgIHJldHVybiB2LnRvTG9jYWxlU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHR5cGVvZiB2ID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xuICByZXR1cm4gU3RyaW5nKHYpO1xufVxuXG4vKiogVGFibGUgY2VsbDogXCItXCIgd2hlbiB0aGUgYXBwIGhhcyBubyBzdWNoIG1ldHJpYywgb3RoZXJ3aXNlIGZtdCAoc28gdW5rbm93biBzdGF5cyBcIlVua25vd25cIikuICovXG5jb25zdCBjZWxsID0gKHY6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIGtleSA9IFwiXCIpID0+ICh2ID09PSB1bmRlZmluZWQgPyBcIi1cIiA6IGZtdCh2LCBrZXkpKTtcblxuY29uc3QgYXhpc0ZtdCA9KGtleTogc3RyaW5nKSA9PiAobjogbnVtYmVyKSA9PiAoTU9ORVlfS0VZLnRlc3Qoa2V5KSA/IG1vbmV5LmZvcm1hdChuKSA6IGNvbXBhY3QuZm9ybWF0KG4pKTtcblxuZnVuY3Rpb24gYWdlSG91cnMoaXNvOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBudW1iZXIgfCBudWxsIHtcbiAgY29uc3QgdCA9IGlzbyA/IERhdGUucGFyc2UoaXNvKSA6IE5hTjtcbiAgcmV0dXJuIE51bWJlci5pc05hTih0KSA/IG51bGwgOiAoRGF0ZS5ub3coKSAtIHQpIC8gM182MDBfMDAwO1xufVxuXG5jb25zdCBzaG9ydERhdGUgPSAoZDogc3RyaW5nKSA9PiBuZXcgRGF0ZShgJHtkfVQwMDowMDowMFpgKS50b0xvY2FsZURhdGVTdHJpbmcodW5kZWZpbmVkLCB7IG1vbnRoOiBcInNob3J0XCIsIGRheTogXCJudW1lcmljXCIsIHRpbWVab25lOiBcIlVUQ1wiIH0pO1xuXG5jb25zdCBhcHBzT2YgPSAoZG9jOiBKc29uKTogSnNvbltdID0+IChkb2MgJiYgQXJyYXkuaXNBcnJheShkb2MuYXBwcykgPyBkb2MuYXBwcyA6IFtdKTtcblxuLyoqIFdhbGtzIGEgZG90dGVkIHBhdGguIHVuZGVmaW5lZCA9IG5vdCBwcmVzZW50LCBudWxsID0gdW5rbm93biAoZXJyb3Igbm9kZSBvciBudWxsKSwgbnVtYmVyID0gdmFsdWUuICovXG5mdW5jdGlvbiBtZXRyaWMobzogSnNvbiwgcGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCB7XG4gIGxldCB2ID0gbztcbiAgZm9yIChjb25zdCBrIG9mIHBhdGguc3BsaXQoXCIuXCIpKSB7XG4gICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAodiA9PT0gbnVsbCB8fCBpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIG51bGw7XG4gICAgdiA9IHZba107XG4gIH1cbiAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHR5cGVvZiB2ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2KSA/IHYgOiBudWxsO1xufVxuXG4vKiogU3VtcyBhIG1ldHJpYyBhY3Jvc3MgYXBwczsgYW55IHVua25vd24gYXBwIHZhbHVlIG1ha2VzIHRoZSB0b3RhbCB1bmtub3duLiAqL1xuZnVuY3Rpb24gc3VtQXBwcyhkb2M6IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBpZiAoIWRvYyB8fCBpc0Vycm9yTm9kZShkb2MuYXBwcykpIHJldHVybiBudWxsO1xuICBjb25zdCB2YWxzID0gYXBwc09mKGRvYykubWFwKChhKSA9PiBtZXRyaWMoYSwgcGF0aCkpLmZpbHRlcigodikgPT4gdiAhPT0gdW5kZWZpbmVkKTtcbiAgaWYgKHZhbHMubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gdmFscy5zb21lKCh2KSA9PiB2ID09PSBudWxsKSA/IG51bGwgOiAodmFscyBhcyBudW1iZXJbXSkucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG59XG5cbmZ1bmN0aW9uIGFwcFN0YXR1cyhhcHA6IEpzb24pOiBTdGF0dXNDb2xvciB7XG4gIGlmIChoYXNFcnJvck5vZGUoYXBwKSkgcmV0dXJuIFwid2FybmluZ1wiO1xuICBpZiAoKGFwcC5oZWFsdGg/LmFsYXJtcz8uaW5BbGFybSA/PyAwKSA+IDApIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKChhcHAuaGVhbHRoPy5mcmVzaG5lc3M/LnN0YWxlU3RhdGVzID8/IDApID4gMCkgcmV0dXJuIFwid2FybmluZ1wiO1xuICByZXR1cm4gXCJzdWNjZXNzXCI7XG59XG5cbmNvbnN0IFdPUlNUOiBTdGF0dXNDb2xvcltdID0gW1wiaWRsZVwiLCBcInN1Y2Nlc3NcIiwgXCJ3YXJuaW5nXCIsIFwiZXJyb3JcIl07XG5jb25zdCB3b3JzdCA9IChjczogU3RhdHVzQ29sb3JbXSk6IFN0YXR1c0NvbG9yID0+IGNzLnJlZHVjZSgoYSwgYikgPT4gKFdPUlNULmluZGV4T2YoYikgPiBXT1JTVC5pbmRleE9mKGEpID8gYiA6IGEpLCBcInN1Y2Nlc3NcIiBhcyBTdGF0dXNDb2xvcik7XG5cbmZ1bmN0aW9uIGRvY1N0YXR1cyhkb2M6IEpzb24pOiBTdGF0dXNDb2xvciB7XG4gIGNvbnN0IGFnZSA9IGFnZUhvdXJzKGRvYy5nZW5lcmF0ZWRBdCk7XG4gIGNvbnN0IHN0YWxlID0gYWdlID09PSBudWxsIHx8IGFnZSA+IFNUQUxFX0hPVVJTO1xuICBjb25zdCBzdGF0dXMgPSB3b3JzdChhcHBzT2YoZG9jKS5tYXAoYXBwU3RhdHVzKSk7XG4gIHJldHVybiBzdGFsZSB8fCBoYXNFcnJvck5vZGUoZG9jKSA/IHdvcnN0KFtzdGF0dXMsIFwid2FybmluZ1wiXSkgOiBzdGF0dXM7XG59XG5cbi8qKiBIaXN0b3J5IHBsdXMgdGhlIGxhdGVzdCBkb2N1bWVudCwgb25lIGVudHJ5IHBlciBVVEMgZGF0ZSwgb2xkZXN0IGZpcnN0LiAqL1xuZnVuY3Rpb24gYWxsRGF5cygpOiBEYXlbXSB7XG4gIGNvbnN0IG0gPSBuZXcgTWFwKHN0YXRlLmhpc3RvcnkubWFwKChkKSA9PiBbZC5kYXRlLCBkLmRvY10pKTtcbiAgaWYgKHR5cGVvZiBzdGF0ZS5kYXRhPy5nZW5lcmF0ZWRBdCA9PT0gXCJzdHJpbmdcIikgbS5zZXQoc3RhdGUuZGF0YS5nZW5lcmF0ZWRBdC5zbGljZSgwLCAxMCksIHN0YXRlLmRhdGEpO1xuICByZXR1cm4gWy4uLm0uZW50cmllcygpXS5zb3J0KChbYV0sIFtiXSkgPT4gKGEgPCBiID8gLTEgOiAxKSkubWFwKChbZGF0ZSwgZG9jXSkgPT4gKHsgZGF0ZSwgZG9jIH0pKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBmZXRjaGluZyAtLS0tLS0tLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIGF3c0FyZ3MoYXBpOiBQbHVnaW5BcGksIGFyZ3M6IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBjb25zdCBzID0gYXdhaXQgYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKTtcbiAgY29uc3Qgb3V0ID0gWy4uLmFyZ3MsIFwiLS1jbGktY29ubmVjdC10aW1lb3V0XCIsIFwiMTBcIiwgXCItLWNsaS1yZWFkLXRpbWVvdXRcIiwgXCIxNVwiXTtcbiAgaWYgKHMuYXdzUHJvZmlsZSkgb3V0LnB1c2goXCItLXByb2ZpbGVcIiwgcy5hd3NQcm9maWxlKTtcbiAgcmV0dXJuIG91dDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYXdzKGFwaTogUGx1Z2luQXBpLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGFwaS5zaGVsbC5leGVjKFwiYXdzXCIsIGF3YWl0IGF3c0FyZ3MoYXBpLCBhcmdzKSk7XG4gIGlmIChyZXMuY29kZSAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKHJlcy5zdGRlcnIudHJpbSgpIHx8IGBhd3MgZXhpdGVkIHdpdGggY29kZSAke3Jlcy5jb2RlfWApO1xuICByZXR1cm4gcmVzLnN0ZG91dDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEhpc3RvcnkoYXBpOiBQbHVnaW5BcGkpIHtcbiAgY29uc3QgZW50cmllcyA9IGF3YWl0IGFwaS5mcy5saXN0RGlyKEhJU1RPUllfRElSKTtcbiAgY29uc3QgZmlsZXMgPSBlbnRyaWVzXG4gICAgLmZpbHRlcigoZSkgPT4gIWUuaXNEaXIgJiYgL15cXGR7NH0tXFxkezJ9LVxcZHsyfVxcLmpzb24kLy50ZXN0KGUubmFtZSkpXG4gICAgLm1hcCgoZSkgPT4gZS5uYW1lKVxuICAgIC5zb3J0KClcbiAgICAuc2xpY2UoLU1BWF9EQVlTKTtcbiAgY29uc3QgZG9jcyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgIGZpbGVzLm1hcChhc3luYyAoZikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYXdhaXQgYXBpLmZzLnJlYWRUZXh0RmlsZShgJHtISVNUT1JZX0RJUn0vJHtmfWApKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9KSxcbiAgKTtcbiAgc2V0U3RhdGUoeyBoaXN0b3J5OiBmaWxlcy5tYXAoKGYsIGkpID0+ICh7IGRhdGU6IGYuc2xpY2UoMCwgMTApLCBkb2M6IGRvY3NbaV0gfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzeW5jSGlzdG9yeShhcGk6IFBsdWdpbkFwaSwgYnVja2V0OiBzdHJpbmcpIHtcbiAgY29uc3Qgcm9vdCA9IChhd2FpdCBhcGkuZnMuZ2V0Um9vdFBhdGgoKSkucmVwbGFjZSgvW1xcXFwvXSskLywgXCJcIik7XG4gIGF3YWl0IGF3cyhhcGksIFtcInMzXCIsIFwic3luY1wiLCBgczM6Ly8ke2J1Y2tldH0vJHtISVNUT1JZX0RJUn0vYCwgYCR7cm9vdH0vJHtISVNUT1JZX0RJUn1gLCBcIi0tb25seS1zaG93LWVycm9yc1wiXSk7XG4gIGF3YWl0IGxvYWRIaXN0b3J5KGFwaSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2goYXBpOiBQbHVnaW5BcGksIHNpZ25hbD86IEFib3J0U2lnbmFsKSB7XG4gIGlmIChzdGF0ZS5sb2FkaW5nKSByZXR1cm47XG4gIHNldFN0YXRlKHsgbG9hZGluZzogdHJ1ZSB9KTtcbiAgY29uc3Qgc2V0SWNvbiA9IChjOiBTdGF0dXNDb2xvciwgdGlwPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKHNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhcGkuc3RhdHVzSWNvbi5zZXQoYywgdGlwKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGRlYWN0aXZhdGVkICovXG4gICAgfVxuICB9O1xuICBjb25zdCBsb2cgPSAobGV2ZWw6IFwid2FyblwiIHwgXCJlcnJvclwiLCBtc2c6IHN0cmluZykgPT4ge1xuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXBpLmxvZ1tsZXZlbF0oYCR7TkFNRX06ICR7bXNnfWApO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogZGVhY3RpdmF0ZWQgKi9cbiAgICB9XG4gIH07XG4gIHNldEljb24oXCJpbi1wcm9ncmVzc1wiLCBcIlJlZnJlc2hpbmdcIik7XG4gIHRyeSB7XG4gICAgY29uc3QgYnVja2V0ID0gKGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCkpLmJ1Y2tldCB8fCBERUZBVUxUX0JVQ0tFVDtcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcImNwXCIsIGBzMzovLyR7YnVja2V0fS9tZXRyaWNzLmpzb25gLCBcIi1cIl0pKTtcbiAgICBhd2FpdCBhcGkuc3RvcmFnZS5zZXQoQ0FDSEVfS0VZLCBkYXRhKTtcbiAgICBzZXRTdGF0ZSh7IGRhdGEsIGVycm9yOiBudWxsIH0pO1xuICAgIGxldCBzdGF0dXMgPSBkb2NTdGF0dXMoZGF0YSk7XG4gICAgbGV0IHRpcCA9IHN0YXR1cyA9PT0gXCJzdWNjZXNzXCIgPyBcIk1ldHJpY3MgdXAgdG8gZGF0ZVwiIDogXCJNZXRyaWNzIG5lZWQgYXR0ZW50aW9uXCI7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNIaXN0b3J5KGFwaSwgYnVja2V0KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zdCBtc2cgPSBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSk7XG4gICAgICBsb2coXCJ3YXJuXCIsIGBoaXN0b3J5IHN5bmMgZmFpbGVkOiAke21zZ31gKTtcbiAgICAgIHN0YXR1cyA9IHdvcnN0KFtzdGF0dXMsIFwid2FybmluZ1wiXSk7XG4gICAgICB0aXAgPSBgSGlzdG9yeSBzeW5jIGZhaWxlZDogJHttc2d9YDtcbiAgICB9XG4gICAgc2V0U3RhdGUoeyBsb2FkaW5nOiBmYWxzZSB9KTtcbiAgICBzZXRJY29uKHN0YXR1cywgdGlwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IGUgaW5zdGFuY2VvZiBFcnJvciA/IGUubWVzc2FnZSA6IFN0cmluZyhlKTtcbiAgICBzZXRTdGF0ZSh7IGVycm9yOiBtc2csIGxvYWRpbmc6IGZhbHNlIH0pO1xuICAgIHNldEljb24oXCJlcnJvclwiLCBtc2cpO1xuICAgIGxvZyhcImVycm9yXCIsIG1zZyk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlKGN0eDogUGx1Z2luQ29udGV4dCkge1xuICBjdHguYXBpLnN0YXR1c0ljb24uc2V0KFwiaWRsZVwiKTtcbiAgY29uc3QgcyA9IGF3YWl0IGN0eC5hcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpO1xuICBjb25zdCBtaW51dGVzID0gTWF0aC5tYXgoMSwgcy5yZWZyZXNoTWludXRlcyA/PyA2MCk7XG4gIGN0eC50aWNrLnJlZ2lzdGVyKCgpID0+IHJlZnJlc2goY3R4LmFwaSwgY3R4LnNpZ25hbCkpO1xuICBjdHgudGljay5zZXRJbnRlcnZhbChtaW51dGVzICogNjBfMDAwKTtcbiAgY3R4LmFwaS5sb2cuaW5mbyhgJHtOQU1FfSBhY3RpdmF0ZWRgKTtcbiAgdm9pZCBsb2FkSGlzdG9yeShjdHguYXBpKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICB2b2lkIHJlZnJlc2goY3R4LmFwaSwgY3R4LnNpZ25hbCk7XG59XG5cbi8vIC0tLS0tLS0tLS0gY2hhcnQgcHJpbWl0aXZlcyAtLS0tLS0tLS0tXG5cbmNvbnN0IHNjcm9sbGJhclN0eWxlID0gKHA6IFBhbGV0dGUpOiBDU1NQcm9wZXJ0aWVzID0+ICh7IHNjcm9sbGJhcldpZHRoOiBcInRoaW5cIiwgc2Nyb2xsYmFyQ29sb3I6IGAke3AuYm9yZGVyfSAke3Auc3VyZmFjZX1gIH0pO1xuXG5mdW5jdGlvbiB1c2VXaWR0aCgpIHtcbiAgY29uc3QgcmVmID0gdXNlUmVmPEhUTUxEaXZFbGVtZW50PihudWxsKTtcbiAgY29uc3QgW3dpZHRoLCBzZXRXaWR0aF0gPSB1c2VTdGF0ZSgwKTtcbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBlbCA9IHJlZi5jdXJyZW50O1xuICAgIGlmICghZWwpIHJldHVybjtcbiAgICBjb25zdCBybyA9IG5ldyBSZXNpemVPYnNlcnZlcigoW2VdKSA9PiBzZXRXaWR0aChlLmNvbnRlbnRSZWN0LndpZHRoKSk7XG4gICAgcm8ub2JzZXJ2ZShlbCk7XG4gICAgcmV0dXJuICgpID0+IHJvLmRpc2Nvbm5lY3QoKTtcbiAgfSwgW10pO1xuICByZXR1cm4gW3JlZiwgd2lkdGhdIGFzIGNvbnN0O1xufVxuXG5mdW5jdGlvbiBuaWNlTWF4KHY6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICh2IDw9IDApIHJldHVybiAxO1xuICBjb25zdCBwID0gMTAgKiogTWF0aC5mbG9vcihNYXRoLmxvZzEwKHYpKTtcbiAgY29uc3QgbiA9IHYgLyBwO1xuICByZXR1cm4gKG4gPD0gMSA/IDEgOiBuIDw9IDIgPyAyIDogbiA8PSA1ID8gNSA6IDEwKSAqIHA7XG59XG5cbmZ1bmN0aW9uIFRvb2x0aXAoeyBwLCB4LCB5LCBmbGlwLCBjaGlsZHJlbiB9OiB7IHA6IFBhbGV0dGU7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBmbGlwOiBib29sZWFuOyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBwb3NpdGlvbjogXCJhYnNvbHV0ZVwiLFxuICAgICAgICBsZWZ0OiB4LFxuICAgICAgICB0b3A6IHksXG4gICAgICAgIHRyYW5zZm9ybTogZmxpcCA/IFwidHJhbnNsYXRlWCgtMTAwJSlcIiA6IHVuZGVmaW5lZCxcbiAgICAgICAgYmFja2dyb3VuZDogcC5iYWNrZ3JvdW5kLFxuICAgICAgICBjb2xvcjogcC50ZXh0LFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHtwLmJvcmRlcn1gLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDQsXG4gICAgICAgIHBhZGRpbmc6IFwiNHB4IDhweFwiLFxuICAgICAgICBmb250U2l6ZTogMTIsXG4gICAgICAgIGxpbmVIZWlnaHQ6IFwiMThweFwiLFxuICAgICAgICB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiLFxuICAgICAgICBwb2ludGVyRXZlbnRzOiBcIm5vbmVcIixcbiAgICAgICAgekluZGV4OiAxLFxuICAgICAgfX1cbiAgICA+XG4gICAgICB7Y2hpbGRyZW59XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmludGVyZmFjZSBQdCB7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHZhbHVlOiBudW1iZXIgfCBudWxsO1xufVxuXG4vKiogU2luZ2xlLXNlcmllcyBsaW5lIG92ZXIgdGltZS4gVW5rbm93biAobnVsbCkgcG9pbnRzIGJyZWFrIHRoZSBsaW5lIGluc3RlYWQgb2YgZHJvcHBpbmcgdG8gemVyby4gKi9cbmZ1bmN0aW9uIExpbmVDaGFydCh7IGFwaSwgcG9pbnRzLCBmb3JtYXQsIGhlaWdodCA9IDE1MCB9OiB7IGFwaTogUGx1Z2luQXBpOyBwb2ludHM6IFB0W107IGZvcm1hdDogKG46IG51bWJlcikgPT4gc3RyaW5nOyBoZWlnaHQ/OiBudW1iZXIgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IFtob3Zlciwgc2V0SG92ZXJdID0gdXNlU3RhdGU8bnVtYmVyIHwgbnVsbD4obnVsbCk7XG4gIGNvbnN0IEwgPSA1NiwgUiA9IDEyLCBUID0gMTAsIEIgPSAyMjtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDEsIHdpZHRoIC0gTCAtIFIpO1xuICBjb25zdCBoID0gaGVpZ2h0IC0gVCAtIEI7XG4gIGNvbnN0IG4gPSBwb2ludHMubGVuZ3RoO1xuICBjb25zdCBtYXggPSBuaWNlTWF4KE1hdGgubWF4KDAsIC4uLnBvaW50cy5tYXAoKHB0KSA9PiBwdC52YWx1ZSA/PyAwKSkpO1xuICBjb25zdCB4ID0gKGk6IG51bWJlcikgPT4gTCArIChuIDw9IDEgPyB3IC8gMiA6IChpICogdykgLyAobiAtIDEpKTtcbiAgY29uc3QgeSA9ICh2OiBudW1iZXIpID0+IFQgKyBoIC0gKHYgLyBtYXgpICogaDtcblxuICBjb25zdCBydW5zOiBudW1iZXJbXVtdID0gW107XG4gIGxldCBjdXI6IG51bWJlcltdID0gW107XG4gIHBvaW50cy5mb3JFYWNoKChwdCwgaSkgPT4ge1xuICAgIGlmIChwdC52YWx1ZSA9PT0gbnVsbCkge1xuICAgICAgaWYgKGN1ci5sZW5ndGgpIHJ1bnMucHVzaChjdXIpO1xuICAgICAgY3VyID0gW107XG4gICAgfSBlbHNlIGN1ci5wdXNoKGkpO1xuICB9KTtcbiAgaWYgKGN1ci5sZW5ndGgpIHJ1bnMucHVzaChjdXIpO1xuICBjb25zdCBsaW5lID0gKHJ1bjogbnVtYmVyW10pID0+IHJ1bi5tYXAoKGksIGspID0+IGAke2sgPyBcIkxcIiA6IFwiTVwifSR7eChpKX0sJHt5KHBvaW50c1tpXS52YWx1ZSBhcyBudW1iZXIpfWApLmpvaW4oXCJcIik7XG4gIGNvbnN0IGxhc3RLbm93biA9IFsuLi5wb2ludHMua2V5cygpXS5yZXZlcnNlKCkuZmluZCgoaSkgPT4gcG9pbnRzW2ldLnZhbHVlICE9PSBudWxsKTtcblxuICBjb25zdCBvbk1vdmUgPSAoZTogTW91c2VFdmVudDxTVkdSZWN0RWxlbWVudD4pID0+IHtcbiAgICBjb25zdCByID0gZS5jdXJyZW50VGFyZ2V0LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGNvbnN0IGkgPSBuIDw9IDEgPyAwIDogTWF0aC5yb3VuZCgoKGUuY2xpZW50WCAtIHIubGVmdCkgLyByLndpZHRoKSAqIChuIC0gMSkpO1xuICAgIHNldEhvdmVyKE1hdGgubWluKG4gLSAxLCBNYXRoLm1heCgwLCBpKSkpO1xuICB9O1xuXG4gIGNvbnN0IHhMYWJlbHMgPSBuIDw9IDEgPyBbMF0gOiBuID09PSAyID8gWzAsIDFdIDogWzAsIE1hdGguZmxvb3IoKG4gLSAxKSAvIDIpLCBuIC0gMV07XG4gIGNvbnN0IGFuY2hvciA9IChpOiBudW1iZXIpID0+IChuIDw9IDEgPyBcIm1pZGRsZVwiIDogaSA9PT0gMCA/IFwic3RhcnRcIiA6IGkgPT09IG4gLSAxID8gXCJlbmRcIiA6IFwibWlkZGxlXCIpO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiByZWY9e3JlZn0gc3R5bGU9e3sgcG9zaXRpb246IFwicmVsYXRpdmVcIiwgaGVpZ2h0IH19PlxuICAgICAge3dpZHRoID4gMCAmJiAoXG4gICAgICAgIDxzdmcgd2lkdGg9e3dpZHRofSBoZWlnaHQ9e2hlaWdodH0gc3R5bGU9e3sgZGlzcGxheTogXCJibG9ja1wiLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAge1swLCAwLjUsIDFdLm1hcCgoZikgPT4gKFxuICAgICAgICAgICAgPGcga2V5PXtmfT5cbiAgICAgICAgICAgICAgPGxpbmUgeDE9e0x9IHgyPXtMICsgd30geTE9e3kobWF4ICogZil9IHkyPXt5KG1heCAqIGYpfSBzdHJva2U9e3AuYm9yZGVyfSBzdHJva2VXaWR0aD17MX0gc3Ryb2tlRGFzaGFycmF5PXtmID8gXCIyIDRcIiA6IHVuZGVmaW5lZH0gLz5cbiAgICAgICAgICAgICAgPHRleHQgeD17TCAtIDZ9IHk9e3kobWF4ICogZil9IGR5PVwiMC4zMmVtXCIgdGV4dEFuY2hvcj1cImVuZFwiIGZpbGw9e3AudGV4dE11dGVkfT5cbiAgICAgICAgICAgICAgICB7Zm9ybWF0KG1heCAqIGYpfVxuICAgICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgICA8L2c+XG4gICAgICAgICAgKSl9XG4gICAgICAgICAge3hMYWJlbHMubWFwKChpKSA9PiAoXG4gICAgICAgICAgICA8dGV4dCBrZXk9e2l9IHg9e3goaSl9IHk9e2hlaWdodCAtIDR9IHRleHRBbmNob3I9e2FuY2hvcihpKX0gZmlsbD17cC50ZXh0TXV0ZWR9PlxuICAgICAgICAgICAgICB7cG9pbnRzW2ldPy5sYWJlbH1cbiAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICApKX1cbiAgICAgICAgICB7cnVucy5tYXAoKHJ1bikgPT5cbiAgICAgICAgICAgIHJ1bi5sZW5ndGggPiAxID8gKFxuICAgICAgICAgICAgICA8ZyBrZXk9e3J1blswXX0+XG4gICAgICAgICAgICAgICAgPHBhdGggZD17YCR7bGluZShydW4pfUwke3gocnVuW3J1bi5sZW5ndGggLSAxXSl9LCR7eSgwKX1MJHt4KHJ1blswXSl9LCR7eSgwKX1aYH0gZmlsbD17cC5hY2NlbnR9IGZpbGxPcGFjaXR5PXswLjEyfSAvPlxuICAgICAgICAgICAgICAgIDxwYXRoIGQ9e2xpbmUocnVuKX0gZmlsbD1cIm5vbmVcIiBzdHJva2U9e3AuYWNjZW50fSBzdHJva2VXaWR0aD17Mn0gc3Ryb2tlTGluZWpvaW49XCJyb3VuZFwiIHN0cm9rZUxpbmVjYXA9XCJyb3VuZFwiIC8+XG4gICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICkgOiBudWxsLFxuICAgICAgICAgICl9XG4gICAgICAgICAge3J1bnNcbiAgICAgICAgICAgIC5maWx0ZXIoKHJ1bikgPT4gcnVuLmxlbmd0aCA9PT0gMSlcbiAgICAgICAgICAgIC5tYXAoKHJ1bikgPT4gKFxuICAgICAgICAgICAgICA8Y2lyY2xlIGtleT17cnVuWzBdfSBjeD17eChydW5bMF0pfSBjeT17eShwb2ludHNbcnVuWzBdXS52YWx1ZSBhcyBudW1iZXIpfSByPXszfSBmaWxsPXtwLmFjY2VudH0gLz5cbiAgICAgICAgICAgICkpfVxuICAgICAgICAgIHtsYXN0S25vd24gIT09IHVuZGVmaW5lZCAmJiBob3ZlciA9PT0gbnVsbCAmJiAoXG4gICAgICAgICAgICA8Y2lyY2xlIGN4PXt4KGxhc3RLbm93bil9IGN5PXt5KHBvaW50c1tsYXN0S25vd25dLnZhbHVlIGFzIG51bWJlcil9IHI9ezMuNX0gZmlsbD17cC5hY2NlbnR9IHN0cm9rZT17cC5zdXJmYWNlfSBzdHJva2VXaWR0aD17Mn0gLz5cbiAgICAgICAgICApfVxuICAgICAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiAoXG4gICAgICAgICAgICA8ZyBwb2ludGVyRXZlbnRzPVwibm9uZVwiPlxuICAgICAgICAgICAgICA8bGluZSB4MT17eChob3Zlcil9IHgyPXt4KGhvdmVyKX0geTE9e1R9IHkyPXtUICsgaH0gc3Ryb2tlPXtwLnRleHRNdXRlZH0gc3Ryb2tlV2lkdGg9ezF9IC8+XG4gICAgICAgICAgICAgIHtwb2ludHNbaG92ZXJdLnZhbHVlICE9PSBudWxsICYmIChcbiAgICAgICAgICAgICAgICA8Y2lyY2xlIGN4PXt4KGhvdmVyKX0gY3k9e3kocG9pbnRzW2hvdmVyXS52YWx1ZSBhcyBudW1iZXIpfSByPXs0LjV9IGZpbGw9e3AuYWNjZW50fSBzdHJva2U9e3Auc3VyZmFjZX0gc3Ryb2tlV2lkdGg9ezJ9IC8+XG4gICAgICAgICAgICAgICl9XG4gICAgICAgICAgICA8L2c+XG4gICAgICAgICAgKX1cbiAgICAgICAgICA8cmVjdCB4PXtMfSB5PXswfSB3aWR0aD17d30gaGVpZ2h0PXtoZWlnaHR9IGZpbGw9XCJ0cmFuc3BhcmVudFwiIG9uTW91c2VNb3ZlPXtvbk1vdmV9IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9IC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICAgKX1cbiAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e3goaG92ZXIpICsgKHgoaG92ZXIpID4gd2lkdGggLSAxNDAgPyAtMTAgOiAxMCl9IHk9e1R9IGZsaXA9e3goaG92ZXIpID4gd2lkdGggLSAxNDB9PlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pntwb2ludHNbaG92ZXJdLmxhYmVsfTwvZGl2PlxuICAgICAgICAgIDxkaXY+e3BvaW50c1tob3Zlcl0udmFsdWUgPT09IG51bGwgPyBcIlVua25vd25cIiA6IGZvcm1hdChwb2ludHNbaG92ZXJdLnZhbHVlIGFzIG51bWJlcil9PC9kaXY+XG4gICAgICAgIDwvVG9vbHRpcD5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmludGVyZmFjZSBTZWcge1xuICBuYW1lOiBzdHJpbmc7XG4gIHZhbHVlOiBudW1iZXI7XG4gIGNvbG9yOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBCYXJSb3cge1xuICBsYWJlbDogc3RyaW5nO1xuICBzZWdtZW50czogU2VnW107XG4gIHZhbHVlVGV4dDogc3RyaW5nO1xuICB0aXA6IHN0cmluZ1tdO1xufVxuXG5mdW5jdGlvbiBMZWdlbmQoeyBhcGksIGl0ZW1zIH06IHsgYXBpOiBQbHVnaW5BcGk7IGl0ZW1zOiB7IG5hbWU6IHN0cmluZzsgY29sb3I6IHN0cmluZyB9W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZ2FwOiAxNiwgZmxleFdyYXA6IFwid3JhcFwiLCBmb250U2l6ZTogMTIsIGNvbG9yOiBwLnRleHRNdXRlZCB9fT5cbiAgICAgIHtpdGVtcy5tYXAoKGl0KSA9PiAoXG4gICAgICAgIDxzcGFuIGtleT17aXQubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJpbmxpbmUtZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDYgfX0+XG4gICAgICAgICAgPHNwYW4gc3R5bGU9e3sgd2lkdGg6IDEwLCBoZWlnaHQ6IDEwLCBib3JkZXJSYWRpdXM6IDIsIGJhY2tncm91bmQ6IGl0LmNvbG9yIH19IC8+XG4gICAgICAgICAge2l0Lm5hbWV9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICkpfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogSG9yaXpvbnRhbCAob3B0aW9uYWxseSBzdGFja2VkKSBiYXJzIHNoYXJpbmcgb25lIHNjYWxlLCB2YWx1ZSBsYWJlbHMgYXQgdGhlIGVuZC4gKi9cbmZ1bmN0aW9uIEJhckxpc3QoeyBhcGksIHJvd3MgfTogeyBhcGk6IFBsdWdpbkFwaTsgcm93czogQmFyUm93W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFtob3Zlciwgc2V0SG92ZXJdID0gdXNlU3RhdGU8eyBpOiBudW1iZXI7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB3OiBudW1iZXIgfSB8IG51bGw+KG51bGwpO1xuICBjb25zdCBtYXggPSBNYXRoLm1heCgwLCAuLi5yb3dzLm1hcCgocikgPT4gci5zZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKSkpIHx8IDE7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT5Ob25lPC9zcGFuPjtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IHBvc2l0aW9uOiBcInJlbGF0aXZlXCIgfX0gb25Nb3VzZUxlYXZlPXsoKSA9PiBzZXRIb3ZlcihudWxsKX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBcIm1pbm1heCgwLCBtYXgtY29udGVudCkgMWZyIG1heC1jb250ZW50XCIsIGdhcDogXCIycHggMTJweFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBmb250U2l6ZTogMTQgfX0+XG4gICAgICAgIHtyb3dzLm1hcCgociwgaSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHRvdGFsID0gci5zZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKTtcbiAgICAgICAgICBjb25zdCBob3QgPSBob3Zlcj8uaSA9PT0gaTtcbiAgICAgICAgICBjb25zdCBjZWxsOiBDU1NQcm9wZXJ0aWVzID0geyBiYWNrZ3JvdW5kOiBob3QgPyBwLnN1cmZhY2VIb3ZlciA6IHVuZGVmaW5lZCwgcGFkZGluZzogXCIycHggMFwiIH07XG4gICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgICAga2V5PXtyLmxhYmVsfVxuICAgICAgICAgICAgICBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX1cbiAgICAgICAgICAgICAgb25Nb3VzZU1vdmU9eyhlKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYm94ID0gKGUuY3VycmVudFRhcmdldC5wYXJlbnRFbGVtZW50IGFzIEhUTUxFbGVtZW50KS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgICAgICAgICBzZXRIb3Zlcih7IGksIHg6IGUuY2xpZW50WCAtIGJveC5sZWZ0LCB5OiBlLmNsaWVudFkgLSBib3gudG9wLCB3OiBib3gud2lkdGggfSk7XG4gICAgICAgICAgICAgIH19XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIGNvbG9yOiBob3QgPyBwLmFjY2VudCA6IHAudGV4dCwgbWF4V2lkdGg6IDIyMCwgb3ZlcmZsb3c6IFwiaGlkZGVuXCIsIHRleHRPdmVyZmxvdzogXCJlbGxpcHNpc1wiLCB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiIH19IHRpdGxlPXtyLmxhYmVsfT5cbiAgICAgICAgICAgICAgICB7ci5sYWJlbH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLmNlbGwsIGRpc3BsYXk6IFwiZmxleFwiLCBoZWlnaHQ6IDIyLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiIH19PlxuICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIHdpZHRoOiBgJHsodG90YWwgLyBtYXgpICogMTAwfSVgLCBoZWlnaHQ6IDEyLCBnYXA6IDEsIG1pbldpZHRoOiB0b3RhbCA+IDAgPyAyIDogMCB9fT5cbiAgICAgICAgICAgICAgICAgIHtyLnNlZ21lbnRzXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKHMpID0+IHMudmFsdWUgPiAwKVxuICAgICAgICAgICAgICAgICAgICAubWFwKChzLCBrLCBhcnIpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXk9e3MubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZsZXg6IHMudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHMuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJvcmRlclJhZGl1czogYCR7ayA9PT0gMCA/IDIgOiAwfXB4ICR7ayA9PT0gYXJyLmxlbmd0aCAtIDEgPyAyIDogMH1weCAke2sgPT09IGFyci5sZW5ndGggLSAxID8gMiA6IDB9cHggJHtrID09PSAwID8gMiA6IDB9cHhgLFxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIHRleHRBbGlnbjogXCJyaWdodFwiLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIgfX0+e3IudmFsdWVUZXh0fTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICk7XG4gICAgICAgIH0pfVxuICAgICAgPC9kaXY+XG4gICAgICB7aG92ZXIgJiYgcm93c1tob3Zlci5pXSAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e2hvdmVyLnggKyAoaG92ZXIueCA+IGhvdmVyLncgLSAxODAgPyAtMTIgOiAxMil9IHk9e2hvdmVyLnkgKyAxMn0gZmxpcD17aG92ZXIueCA+IGhvdmVyLncgLSAxODB9PlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZm9udFdlaWdodDogNjAwIH19Pntyb3dzW2hvdmVyLmldLmxhYmVsfTwvZGl2PlxuICAgICAgICAgIHtyb3dzW2hvdmVyLmldLnRpcC5tYXAoKHQpID0+IChcbiAgICAgICAgICAgIDxkaXYga2V5PXt0fT57dH08L2Rpdj5cbiAgICAgICAgICApKX1cbiAgICAgICAgPC9Ub29sdGlwPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gVGlsZSh7IGFwaSwgbGFiZWwsIHZhbHVlLCBkZWx0YSB9OiB7IGFwaTogUGx1Z2luQXBpOyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogc3RyaW5nOyBkZWx0YT86IHN0cmluZyB8IG51bGwgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsIGJvcmRlclJhZGl1czogNiwgcGFkZGluZzogXCIxMHB4IDEycHhcIiwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMiB9fT5cbiAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PntsYWJlbH08L3NwYW4+XG4gICAgICA8c3BhbiBzdHlsZT17eyBmb250U2l6ZTogMjIsIGxpbmVIZWlnaHQ6IFwiMzBweFwiLCBmb250V2VpZ2h0OiA2MDAsIGZvbnRWYXJpYW50TnVtZXJpYzogXCJ0YWJ1bGFyLW51bXNcIiB9fT57dmFsdWV9PC9zcGFuPlxuICAgICAge2RlbHRhICYmIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PntkZWx0YX08L3NwYW4+fVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5jb25zdCBUaWxlcyA9ICh7IGNoaWxkcmVuIH06IHsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSA9PiAoXG4gIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwicmVwZWF0KGF1dG8tZmlsbCwgbWlubWF4KDE1MHB4LCAxZnIpKVwiLCBnYXA6IDEyIH19PntjaGlsZHJlbn08L2Rpdj5cbik7XG5cbmNvbnN0IENoYXJ0R3JpZCA9ICh7IGNoaWxkcmVuIH06IHsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSA9PiAoXG4gIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwicmVwZWF0KGF1dG8tZmlsbCwgbWlubWF4KDMyMHB4LCAxZnIpKVwiLCBnYXA6IDEyLCBhbGlnbkl0ZW1zOiBcInN0YXJ0XCIgfX0+e2NoaWxkcmVufTwvZGl2PlxuKTtcblxuZnVuY3Rpb24gU2VjdGlvbih7IGFwaSwgdGl0bGUsIGV4dHJhLCBjaGlsZHJlbiB9OiB7IGFwaTogUGx1Z2luQXBpOyB0aXRsZTogc3RyaW5nOyBleHRyYT86IFJlYWN0Tm9kZTsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGJhY2tncm91bmQ6IHAuc3VyZmFjZSwgYm9yZGVyOiBgMXB4IHNvbGlkICR7cC5ib3JkZXJ9YCwgYm9yZGVyUmFkaXVzOiA2LCBwYWRkaW5nOiAxMiwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogOCwgbWluV2lkdGg6IDAgfX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBmbGV4V3JhcDogXCJ3cmFwXCIgfX0+XG4gICAgICAgIDxzdHJvbmcgc3R5bGU9e3sgZmxleDogMSB9fT57dGl0bGV9PC9zdHJvbmc+XG4gICAgICAgIHtleHRyYX1cbiAgICAgIDwvZGl2PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1ldHJpYyB2aWV3cyAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBUcmVuZCB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGtleTogc3RyaW5nO1xuICBnZXQ6IChkb2M6IEpzb24pID0+IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ7XG59XG5cbi8qKiBUaWxlIHZhbHVlIGZyb20gdGhlIGxhdGVzdCBkb2MsIGRlbHRhIGFnYWluc3QgdGhlIHByZXZpb3VzIGRheSBpbiBoaXN0b3J5LiAqL1xuZnVuY3Rpb24gdHJlbmRUaWxlKGFwaTogUGx1Z2luQXBpLCBkYXlzOiBEYXlbXSwgdDogVHJlbmQpIHtcbiAgY29uc3QgdmFscyA9IGRheXMubWFwKChkKSA9PiB0LmdldChkLmRvYykpO1xuICBjb25zdCBjdXIgPSB2YWxzW3ZhbHMubGVuZ3RoIC0gMV07XG4gIGNvbnN0IHByZXYgPSB2YWxzLmxlbmd0aCA+IDEgPyB2YWxzW3ZhbHMubGVuZ3RoIC0gMl0gOiB1bmRlZmluZWQ7XG4gIGxldCBkZWx0YTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY3VyID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBwcmV2ID09PSBcIm51bWJlclwiKSB7XG4gICAgY29uc3QgZCA9IGN1ciAtIHByZXY7XG4gICAgY29uc3QgYWJzID0gTU9ORVlfS0VZLnRlc3QodC5rZXkpID8gbW9uZXkuZm9ybWF0KE1hdGguYWJzKGQpKSA6IE1hdGguYWJzKGQpLnRvTG9jYWxlU3RyaW5nKCk7XG4gICAgZGVsdGEgPSBgJHtkID4gMCA/IFwiK1wiIDogZCA8IDAgPyBcIi1cIiA6IFwiXHUwMEIxXCJ9JHthYnN9IHZzICR7c2hvcnREYXRlKGRheXNbZGF5cy5sZW5ndGggLSAyXS5kYXRlKX1gO1xuICB9XG4gIHJldHVybiA8VGlsZSBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSBsYWJlbD17dC50aXRsZX0gdmFsdWU9e2ZtdChjdXIsIHQua2V5KX0gZGVsdGE9e2RlbHRhfSAvPjtcbn1cblxuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBzaG93biA9IHRyZW5kc1xuICAgIC5tYXAoKHQpID0+ICh7IHQsIHBvaW50czogZGF5cy5tYXAoKGQpID0+ICh7IGxhYmVsOiBzaG9ydERhdGUoZC5kYXRlKSwgcmF3OiB0LmdldChkLmRvYykgfSkpIH0pKVxuICAgIC5maWx0ZXIoKHsgcG9pbnRzIH0pID0+IHBvaW50cy5zb21lKChwdCkgPT4gcHQucmF3ICE9PSB1bmRlZmluZWQpKTtcbiAgaWYgKHNob3duLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiAoXG4gICAgPD5cbiAgICAgIHtkYXlzLmxlbmd0aCA8IDIgJiYgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+VHJlbmRzIGZpbGwgaW4gYXMgZGFpbHkgaGlzdG9yeSBhY2N1bXVsYXRlcyAoe2RheXMubGVuZ3RofSBkYXkgc28gZmFyKS48L3NwYW4+fVxuICAgICAgPENoYXJ0R3JpZD5cbiAgICAgICAge3Nob3duLm1hcCgoeyB0LCBwb2ludHMgfSkgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17dC50aXRsZX0gYXBpPXthcGl9IHRpdGxlPXtgJHt0LnRpdGxlfSBUcmVuZGB9PlxuICAgICAgICAgICAgPExpbmVDaGFydCBhcGk9e2FwaX0gcG9pbnRzPXtwb2ludHMubWFwKChwdCkgPT4gKHsgbGFiZWw6IHB0LmxhYmVsLCB2YWx1ZTogcHQucmF3ID8/IG51bGwgfSkpfSBmb3JtYXQ9e2F4aXNGbXQodC5rZXkpfSAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgICA8L0NoYXJ0R3JpZD5cbiAgICA8Lz5cbiAgKTtcbn1cblxuZnVuY3Rpb24gY29zdFJvd3MoYXBpOiBQbHVnaW5BcGksIGNvc3Q6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKGNvc3Q/LmJ5VGFnID8/IHt9KVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAuc29ydCgoWywgYV0sIFssIGJdKSA9PiAoYiBhcyBudW1iZXIpIC0gKGEgYXMgbnVtYmVyKSlcbiAgICAubWFwKChbaywgdl0pID0+ICh7XG4gICAgICBsYWJlbDogayxcbiAgICAgIHNlZ21lbnRzOiBbeyBuYW1lOiBcIkNvc3RcIiwgdmFsdWU6IHYgYXMgbnVtYmVyLCBjb2xvcjogcC5hY2NlbnQgfV0sXG4gICAgICB2YWx1ZVRleHQ6IG1vbmV5LmZvcm1hdCh2IGFzIG51bWJlciksXG4gICAgICB0aXA6IFtgJHttb25leS5mb3JtYXQodiBhcyBudW1iZXIpfSAoJHtjb3N0LnRvdGFsID8gKCgodiBhcyBudW1iZXIpIC8gY29zdC50b3RhbCkgKiAxMDApLnRvRml4ZWQoMSkgOiBcIjBcIn0lIG9mIHRvdGFsKWBdLFxuICAgIH0pKTtcbn1cblxuY29uc3QgT1ZFUlZJRVdfVFJFTkRTOiBUcmVuZFtdID0gW1xuICB7IHRpdGxlOiBcIkFXUyBDb3N0ICgzMGQpXCIsIGtleTogXCJjb3N0XCIsIGdldDogKGQpID0+IG1ldHJpYyhkLCBcImF3c0Nvc3QudG90YWxcIikgfSxcbiAgeyB0aXRsZTogXCJSZXF1ZXN0cyAoMjRoKVwiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpIH0sXG4gIHsgdGl0bGU6IFwiNXh4IEVycm9ycyAoMjRoKVwiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5lcnJvcnM1eHhcIikgfSxcbiAgeyB0aXRsZTogXCJBbGFybXMgRmlyaW5nXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcImhlYWx0aC5hbGFybXMuaW5BbGFybVwiKSB9LFxuICB7IHRpdGxlOiBcIlBheWluZyBDdXN0b21lcnNcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuXTtcblxuZnVuY3Rpb24gT3ZlcnZpZXcoeyBhcGksIGRvYywgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkb2M6IEpzb247IGRheXM6IERheVtdIH0pIHtcbiAgY29uc3QgeyBTdGF0dXNEb3QgfSA9IGFwaS51aTtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBhcHBzID0gYXBwc09mKGRvYyk7XG4gIGNvbnN0IGNvc3QgPSBkb2MuYXdzQ29zdDtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVzPntPVkVSVklFV19UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChkb2MpICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgZGF5cywgdCkpfTwvVGlsZXM+XG4gICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2RheXN9IHRyZW5kcz17T1ZFUlZJRVdfVFJFTkRTLnNsaWNlKDAsIDMpfSAvPlxuICAgICAgPENoYXJ0R3JpZD5cbiAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiQXBwc1wiPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwiYXV0byAxZnIgbWF4LWNvbnRlbnQgbWF4LWNvbnRlbnQgbWF4LWNvbnRlbnRcIiwgZ2FwOiBcIjRweCAxNnB4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIgfX0+XG4gICAgICAgICAgICB7W1wiXCIsIFwiQXBwXCIsIFwiUmVxdWVzdHNcIiwgXCJFcnJvcnNcIiwgXCJQcm9maXQgKDMwZClcIl0ubWFwKChoKSA9PiAoXG4gICAgICAgICAgICAgIDxzcGFuIGtleT17aCB8fCBcImRvdFwifSBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICAgICAgICB7aH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICB7YXBwcy5tYXAoKGEpID0+IChcbiAgICAgICAgICAgICAgPGRpdiBrZXk9e2EubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19PlxuICAgICAgICAgICAgICAgIDxTdGF0dXNEb3QgY29sb3I9e2FwcFN0YXR1cyhhKX0gLz5cbiAgICAgICAgICAgICAgICA8c3Bhbj57YS5uYW1lfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3Bhbj57Y2VsbChtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSwgXCJwcm9maXRcIil9PC9zcGFuPlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICkpfVxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT17YEFXUyBDb3N0IEJ5IFByb2plY3Qke2Nvc3QgJiYgIWlzRXJyb3JOb2RlKGNvc3QpID8gYCAoJHtzaG9ydERhdGUoY29zdC53aW5kb3dTdGFydCl9IFRvICR7c2hvcnREYXRlKGNvc3Qud2luZG93RW5kKX0pYCA6IFwiXCJ9YH0+XG4gICAgICAgICAgeyFjb3N0IHx8IGlzRXJyb3JOb2RlKGNvc3QpID8gPHNwYW4+e2ZtdChjb3N0KX08L3NwYW4+IDogPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2Nvc3RSb3dzKGFwaSwgY29zdCl9IC8+fVxuICAgICAgICA8L1NlY3Rpb24+XG4gICAgICA8L0NoYXJ0R3JpZD5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gbGFtYmRhUm93cyhhcGk6IFBsdWdpbkFwaSwgbGFtYmRhczogSnNvbik6IHsgcm93czogQmFyUm93W107IGlkbGU6IG51bWJlcjsgdW5rbm93bjogc3RyaW5nW10gfSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3Qgcm93czogQmFyUm93W10gPSBbXTtcbiAgY29uc3QgdW5rbm93bjogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGlkbGUgPSAwO1xuICBmb3IgKGNvbnN0IFtmbiwgdl0gb2YgT2JqZWN0LmVudHJpZXMobGFtYmRhcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSkge1xuICAgIGNvbnN0IGludiA9IG1ldHJpYyh2LCBcImludm9jYXRpb25zXCIpO1xuICAgIGlmICh0eXBlb2YgaW52ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB1bmtub3duLnB1c2goZm4pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbnYgPT09IDApIHtcbiAgICAgIGlkbGUrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBlcnIgPSBtZXRyaWModiwgXCJlcnJvcnNcIikgPz8gMDtcbiAgICBjb25zdCB0aHIgPSBtZXRyaWModiwgXCJ0aHJvdHRsZXNcIikgPz8gMDtcbiAgICByb3dzLnB1c2goe1xuICAgICAgbGFiZWw6IGZuLFxuICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgeyBuYW1lOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogTWF0aC5tYXgoMCwgaW52IC0gZXJyKSwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgdmFsdWU6IGVyciwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICBdLFxuICAgICAgdmFsdWVUZXh0OiBlcnIgPyBgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gKCR7KChlcnIgLyBpbnYpICogMTAwKS50b0ZpeGVkKDApfSUgRXJyKWAgOiBpbnYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgIHRpcDogW2Ake2ludi50b0xvY2FsZVN0cmluZygpfSBpbnZvY2F0aW9uc2AsIGAke2Vyci50b0xvY2FsZVN0cmluZygpfSBlcnJvcnNgLCBgJHt0aHIudG9Mb2NhbGVTdHJpbmcoKX0gdGhyb3R0bGVzYF0sXG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzWzBdLnZhbHVlICsgYi5zZWdtZW50c1sxXS52YWx1ZSAtIChhLnNlZ21lbnRzWzBdLnZhbHVlICsgYS5zZWdtZW50c1sxXS52YWx1ZSkpO1xuICByZXR1cm4geyByb3dzLCBpZGxlLCB1bmtub3duIH07XG59XG5cbmZ1bmN0aW9uIGFwaVJvd3MoYXBpOiBQbHVnaW5BcGksIGFwaXM6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChPYmplY3QuZW50cmllcyhhcGlzID8/IHt9KSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgbWV0cmljKHYsIFwicmVxdWVzdHNcIikgPT09IFwibnVtYmVyXCIpXG4gICAgLm1hcCgoW25hbWUsIHZdKSA9PiB7XG4gICAgICBjb25zdCByZXEgPSBtZXRyaWModiwgXCJyZXF1ZXN0c1wiKSBhcyBudW1iZXI7XG4gICAgICBjb25zdCBlNCA9IG1ldHJpYyh2LCBcImVycm9yczR4eFwiKSA/PyAwO1xuICAgICAgY29uc3QgZTUgPSBtZXRyaWModiwgXCJlcnJvcnM1eHhcIikgPz8gMDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGxhYmVsOiBuYW1lLFxuICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgIHsgbmFtZTogXCJPS1wiLCB2YWx1ZTogTWF0aC5tYXgoMCwgcmVxIC0gZTQgLSBlNSksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgIHsgbmFtZTogXCI0eHhcIiwgdmFsdWU6IGU0LCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgIHsgbmFtZTogXCI1eHhcIiwgdmFsdWU6IGU1LCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgXSxcbiAgICAgICAgdmFsdWVUZXh0OiByZXEudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgdGlwOiBbYCR7cmVxLnRvTG9jYWxlU3RyaW5nKCl9IHJlcXVlc3RzYCwgYCR7ZTQudG9Mb2NhbGVTdHJpbmcoKX0gNHh4LCAke2U1LnRvTG9jYWxlU3RyaW5nKCl9IDV4eGAsIGBwOTUgbGF0ZW5jeTogJHtmbXQodi5wOTVMYXRlbmN5TXMsIFwibGF0ZW5jeW1zXCIpfWBdLFxuICAgICAgfTtcbiAgICB9KVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzLnJlZHVjZSgocywgeCkgPT4gcyArIHgudmFsdWUsIDApIC0gYS5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSk7XG59XG5cbmZ1bmN0aW9uIFJvd3MoeyBhcGksIHZhbHVlLCBwYXRoID0gXCJcIiB9OiB7IGFwaTogUGx1Z2luQXBpOyB2YWx1ZTogSnNvbjsgcGF0aD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBpc0Vycm9yTm9kZSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gPHNwYW4+e2ZtdCh2YWx1ZSwgcGF0aCl9PC9zcGFuPjtcbiAgfVxuICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgdl0pID0+ICEodHlwZW9mIHYgPT09IFwic3RyaW5nXCIgJiYgKHYubGVuZ3RoID4gODAgfHwgdi5pbmNsdWRlcyhcIlxcblwiKSkpKTtcbiAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwibWF4LWNvbnRlbnQgMWZyXCIsIGdhcDogXCIycHggMTZweFwiIH19PlxuICAgICAge2VudHJpZXMubWFwKChbaywgdl0pID0+IHtcbiAgICAgICAgY29uc3QgbmVzdGVkID0gdiAhPT0gbnVsbCAmJiB0eXBlb2YgdiA9PT0gXCJvYmplY3RcIiAmJiAhaXNFcnJvck5vZGUodik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPGRpdiBrZXk9e2t9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fT5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57dGl0bGVDYXNlKGspfTwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuPntuZXN0ZWQgPyBBcnJheS5pc0FycmF5KHYpID8gPHNwYW4+e3YubGVuZ3RoID8gdi5qb2luKFwiLCBcIikgOiBcIk5vbmVcIn08L3NwYW4+IDogPFJvd3MgYXBpPXthcGl9IHZhbHVlPXt2fSBwYXRoPXtrfSAvPiA6IGZtdCh2LCBrKX08L3NwYW4+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICk7XG4gICAgICB9KX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgdGl0bGVDYXNlID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC8oW0EtWl0pL2csIFwiICQxXCIpLnJlcGxhY2UoL14uLywgKGMpID0+IGMudG9VcHBlckNhc2UoKSk7XG5cbmNvbnN0IEFQUF9UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuICB7IHRpdGxlOiBcIk1SUlwiLCBrZXk6IFwibXJyXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5Lm1yclwiKSB9LFxuICB7IHRpdGxlOiBcIlByb2ZpdCAoMzBkKVwiLCBrZXk6IFwicHJvZml0XCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSB9LFxuXTtcblxuZnVuY3Rpb24gQXBwVmlldyh7IGFwaSwgYXBwLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGFwcDogSnNvbjsgZGF5czogRGF5W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBkb2M6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHAubmFtZSkgfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpO1xuICBjb25zdCBtb24gPSBhcHAubW9uaXRvcmluZztcbiAgY29uc3QgYXVkID0gYXBwLmF1ZGllbmNlO1xuICBjb25zdCBhdWREYXlzOiBKc29uW10gPSBhdWQgJiYgQXJyYXkuaXNBcnJheShhdWQuZGF5cykgPyBhdWQuZGF5cyA6IFtdO1xuICBjb25zdCBhdWRLZXlzID0gYXVkRGF5cy5sZW5ndGggPyBPYmplY3Qua2V5cyhhdWREYXlzWzBdKS5maWx0ZXIoKGspID0+IGsgIT09IFwiZGF0ZVwiICYmIHR5cGVvZiBhdWREYXlzWzBdW2tdID09PSBcIm51bWJlclwiKSA6IFtdO1xuICBjb25zdCBsYW1iZGFzID0gbW9uICYmICFpc0Vycm9yTm9kZShtb24pICYmICFpc0Vycm9yTm9kZShtb24ubGFtYmRhcykgPyBsYW1iZGFSb3dzKGFwaSwgbW9uLmxhbWJkYXMpIDogbnVsbDtcbiAgY29uc3QgYXBpcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmFwaXMpID8gYXBpUm93cyhhcGksIG1vbi5hcGlzKSA6IG51bGw7XG4gIGNvbnN0IGRldGFpbHMgPSBPYmplY3QuZW50cmllcyhhcHApLmZpbHRlcigoW2tdKSA9PiBrICE9PSBcIm5hbWVcIiAmJiBrICE9PSBcIm1vbml0b3JpbmdcIik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVzPntBUFBfVFJFTkRTLmZpbHRlcigodCkgPT4gdC5nZXQoYXBwKSAhPT0gdW5kZWZpbmVkKS5tYXAoKHQpID0+IHRyZW5kVGlsZShhcGksIGFwcERheXMsIHQpKX08L1RpbGVzPlxuICAgICAgPFRyZW5kQ2hhcnRzIGFwaT17YXBpfSBkYXlzPXthcHBEYXlzfSB0cmVuZHM9e0FQUF9UUkVORFN9IC8+XG4gICAgICB7bW9uICYmIGlzRXJyb3JOb2RlKG1vbikgJiYgKFxuICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJNb25pdG9yaW5nICgyNGgpXCI+XG4gICAgICAgICAgPHNwYW4+e2ZtdChtb24pfTwvc3Bhbj5cbiAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgKX1cbiAgICAgIHsoYXBpcz8ubGVuZ3RoIHx8IGxhbWJkYXM/LnJvd3MubGVuZ3RoKSA/IChcbiAgICAgICAgPENoYXJ0R3JpZD5cbiAgICAgICAgICB7YXBpcyAmJiBhcGlzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgICAgPFNlY3Rpb25cbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHRpdGxlPVwiQVBJIFJlcXVlc3RzICgyNGgpXCJcbiAgICAgICAgICAgICAgZXh0cmE9ezxMZWdlbmQgYXBpPXthcGl9IGl0ZW1zPXtbeyBuYW1lOiBcIk9LXCIsIGNvbG9yOiBwLmFjY2VudCB9LCB7IG5hbWU6IFwiNHh4XCIsIGNvbG9yOiBwLnN0YXR1cy53YXJuaW5nIH0sIHsgbmFtZTogXCI1eHhcIiwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH1dfSAvPn1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2FwaXN9IC8+XG4gICAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICAgKX1cbiAgICAgICAgICB7bGFtYmRhcyAmJiBsYW1iZGFzLnJvd3MubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJMYW1iZGEgSW52b2NhdGlvbnMgKDI0aClcIiBleHRyYT17PExlZ2VuZCBhcGk9e2FwaX0gaXRlbXM9e1t7IG5hbWU6IFwiU3VjY2VlZGVkXCIsIGNvbG9yOiBwLmFjY2VudCB9LCB7IG5hbWU6IFwiRXJyb3JzXCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9XX0gLz59PlxuICAgICAgICAgICAgICA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17bGFtYmRhcy5yb3dzfSAvPlxuICAgICAgICAgICAgICB7KGxhbWJkYXMuaWRsZSA+IDAgfHwgbGFtYmRhcy51bmtub3duLmxlbmd0aCA+IDApICYmIChcbiAgICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICAgICAgICAgIHtbbGFtYmRhcy5pZGxlID8gYCR7bGFtYmRhcy5pZGxlfSBpZGxlIGZ1bmN0aW9uJHtsYW1iZGFzLmlkbGUgPiAxID8gXCJzXCIgOiBcIlwifSBoaWRkZW5gIDogXCJcIiwgbGFtYmRhcy51bmtub3duLmxlbmd0aCA/IGBVbmtub3duOiAke2xhbWJkYXMudW5rbm93bi5qb2luKFwiLCBcIil9YCA6IFwiXCJdXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgICAgICAgICAgICAgICAgLmpvaW4oXCIuIFwiKX1cbiAgICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICAgICl9XG4gICAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICAgKX1cbiAgICAgICAgPC9DaGFydEdyaWQ+XG4gICAgICApIDogbnVsbH1cbiAgICAgIHthdWRLZXlzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICA8Q2hhcnRHcmlkPlxuICAgICAgICAgIHthdWRLZXlzLm1hcCgoaykgPT4gKFxuICAgICAgICAgICAgPFNlY3Rpb24ga2V5PXtrfSBhcGk9e2FwaX0gdGl0bGU9e2BEYWlseSAke3RpdGxlQ2FzZShrKX1gfT5cbiAgICAgICAgICAgICAgPExpbmVDaGFydFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIHBvaW50cz17YXVkRGF5cy5tYXAoKGQpID0+ICh7IGxhYmVsOiBzaG9ydERhdGUoU3RyaW5nKGQuZGF0ZSkpLCB2YWx1ZTogdHlwZW9mIGRba10gPT09IFwibnVtYmVyXCIgPyBkW2tdIDogbnVsbCB9KSl9XG4gICAgICAgICAgICAgICAgZm9ybWF0PXtheGlzRm10KGspfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICAgICkpfVxuICAgICAgICAgIHthdWQuc291cmNlczMwZCAmJiAhaXNFcnJvck5vZGUoYXVkLnNvdXJjZXMzMGQpICYmIChcbiAgICAgICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT1cIlRyYWZmaWMgU291cmNlcyAoMzBkKVwiPlxuICAgICAgICAgICAgICA8QmFyTGlzdFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIHJvd3M9eyhPYmplY3QuZW50cmllcyhhdWQuc291cmNlczMwZCkgYXMgW3N0cmluZywgSnNvbl1bXSlcbiAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAgICAgICAgICAgICAgIC5zb3J0KChbLCBhXSwgWywgYl0pID0+IGIgLSBhKVxuICAgICAgICAgICAgICAgICAgLm1hcCgoW2ssIHZdKSA9PiAoeyBsYWJlbDogdGl0bGVDYXNlKGspLCBzZWdtZW50czogW3sgbmFtZTogXCJWaWV3c1wiLCB2YWx1ZTogdiwgY29sb3I6IHAuYWNjZW50IH1dLCB2YWx1ZVRleHQ6IHYudG9Mb2NhbGVTdHJpbmcoKSwgdGlwOiBbYCR7di50b0xvY2FsZVN0cmluZygpfSB2aWV3c2BdIH0pKX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgICApfVxuICAgICAgICA8L0NoYXJ0R3JpZD5cbiAgICAgICl9XG4gICAgICA8Q2hhcnRHcmlkPlxuICAgICAgICB7ZGV0YWlscy5tYXAoKFtrLCB2XSkgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17a30gYXBpPXthcGl9IHRpdGxlPXt0aXRsZUNhc2Uoayl9PlxuICAgICAgICAgICAgPFJvd3MgYXBpPXthcGl9IHZhbHVlPXtrID09PSBcImF1ZGllbmNlXCIgJiYgdiAmJiAhaXNFcnJvck5vZGUodikgPyBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModikuZmlsdGVyKChba2tdKSA9PiBrayAhPT0gXCJkYXlzXCIgJiYga2sgIT09IFwic291cmNlczMwZFwiKSkgOiB2fSBwYXRoPXtrfSAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgICA8L0NoYXJ0R3JpZD5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIENvbXBvbmVudCh7IGFwaSB9OiB7IGFwaTogUGx1Z2luQXBpOyBwYW5lSWQ/OiBzdHJpbmcgfSkge1xuICBjb25zdCB7IFRleHRCdXR0b24sIFRhYnMsIEJhbm5lciwgU3Bpbm5lciB9ID0gYXBpLnVpO1xuICBjb25zdCBwYWxldHRlID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFssIGZvcmNlXSA9IHVzZVN0YXRlKDApO1xuICBjb25zdCBbdGFiLCBzZXRUYWJdID0gdXNlU3RhdGUoXCJvdmVydmlld1wiKTtcbiAgY29uc3QgWywgc2V0VGhlbWVdID0gdXNlU3RhdGUoMCk7XG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBsID0gKCkgPT4gZm9yY2UoKG4pID0+IG4gKyAxKTtcbiAgICBsaXN0ZW5lcnMuYWRkKGwpO1xuICAgIGNvbnN0IHVuc3ViID0gYXBpLnRoZW1lLnN1YnNjcmliZSgoKSA9PiBzZXRUaGVtZSgobikgPT4gbiArIDEpKTtcbiAgICBpZiAoIXN0YXRlLmRhdGEpIHtcbiAgICAgIHZvaWQgYXBpLnN0b3JhZ2UuZ2V0PEpzb24+KENBQ0hFX0tFWSkudGhlbigoY2FjaGVkKSA9PiB7XG4gICAgICAgIGlmIChjYWNoZWQgJiYgIXN0YXRlLmRhdGEpIHNldFN0YXRlKHsgZGF0YTogY2FjaGVkIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBsaXN0ZW5lcnMuZGVsZXRlKGwpO1xuICAgICAgdW5zdWIoKTtcbiAgICB9O1xuICB9LCBbYXBpXSk7XG5cbiAgY29uc3QgeyBkYXRhLCBlcnJvciwgbG9hZGluZyB9ID0gc3RhdGU7XG4gIGNvbnN0IGFwcHMgPSBhcHBzT2YoZGF0YSk7XG4gIGNvbnN0IGRheXMgPSBhbGxEYXlzKCk7XG4gIGNvbnN0IGFnZSA9IGRhdGEgPyBhZ2VIb3VycyhkYXRhLmdlbmVyYXRlZEF0KSA6IG51bGw7XG4gIGNvbnN0IHN0YWxlID0gZGF0YSAmJiAoYWdlID09PSBudWxsIHx8IGFnZSA+IFNUQUxFX0hPVVJTKTtcbiAgY29uc3QgY3VycmVudCA9IHRhYiA9PT0gXCJvdmVydmlld1wiID8gbnVsbCA6IGFwcHMuZmluZCgoYSkgPT4gYS5uYW1lID09PSB0YWIpO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBmbGV4OiAxLCBtaW5IZWlnaHQ6IDAsIGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyLCBjb2xvcjogcGFsZXR0ZS50ZXh0IH19PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiAxMiwgcGFkZGluZ1JpZ2h0OiAyNCB9fT5cbiAgICAgICAgPGgyIHN0eWxlPXt7IG1hcmdpbjogMCB9fT57TkFNRX08L2gyPlxuICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcGFsZXR0ZS50ZXh0TXV0ZWQsIGZsZXg6IDEgfX0+XG4gICAgICAgICAge2RhdGEgPyBgR2VuZXJhdGVkICR7ZGF0YS5nZW5lcmF0ZWRBdCA/IG5ldyBEYXRlKGRhdGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCkgOiBcIlVua25vd25cIn0gXHUwMEI3ICR7ZGF5cy5sZW5ndGh9IERheSR7ZGF5cy5sZW5ndGggPT09IDEgPyBcIlwiIDogXCJzXCJ9IE9mIEhpc3RvcnlgIDogXCJObyBEYXRhIFlldFwifVxuICAgICAgICA8L3NwYW4+XG4gICAgICAgIHtsb2FkaW5nICYmIDxTcGlubmVyIHNpemU9ezE2fSAvPn1cbiAgICAgICAgPFRleHRCdXR0b24gbGFiZWw9XCJSZWZyZXNoXCIgdmFyaWFudD1cInByaW1hcnlcIiBkaXNhYmxlZD17bG9hZGluZ30gb25DbGljaz17KCkgPT4gdm9pZCByZWZyZXNoKGFwaSl9IC8+XG4gICAgICA8L2Rpdj5cbiAgICAgIHtlcnJvciAmJiA8QmFubmVyIG1lc3NhZ2U9e2BDb3VsZCBOb3QgTG9hZCBNZXRyaWNzOiAke2Vycm9yfWB9IHRvbmU9XCJlcnJvclwiIC8+fVxuICAgICAge3N0YWxlICYmIDxCYW5uZXIgbWVzc2FnZT17YE1ldHJpY3MgQXJlIE9sZGVyIFRoYW4gJHtTVEFMRV9IT1VSU30gSG91cnM7IFRoZSBEYWlseSBDb2xsZWN0b3IgTWF5IEhhdmUgRmFpbGVkYH0gdG9uZT1cIndhcm5pbmdcIiAvPn1cbiAgICAgIHtkYXRhICYmIChcbiAgICAgICAgPD5cbiAgICAgICAgICA8VGFic1xuICAgICAgICAgICAgdGFicz17W3sgbGFiZWw6IFwiT3ZlcnZpZXdcIiwgdmFsdWU6IFwib3ZlcnZpZXdcIiB9LCAuLi5hcHBzLm1hcCgoYSkgPT4gKHsgbGFiZWw6IGEubmFtZSBhcyBzdHJpbmcsIHZhbHVlOiBhLm5hbWUgYXMgc3RyaW5nIH0pKV19XG4gICAgICAgICAgICB2YWx1ZT17Y3VycmVudCA/IHRhYiA6IFwib3ZlcnZpZXdcIn1cbiAgICAgICAgICAgIG9uQ2hhbmdlPXtzZXRUYWJ9XG4gICAgICAgICAgLz5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLnNjcm9sbGJhclN0eWxlKHBhbGV0dGUpLCBmbGV4OiAxLCBtaW5IZWlnaHQ6IDAsIG92ZXJmbG93OiBcImF1dG9cIiB9fT5cbiAgICAgICAgICAgIHtjdXJyZW50ID8gPEFwcFZpZXcgYXBpPXthcGl9IGFwcD17Y3VycmVudH0gZGF5cz17ZGF5c30gLz4gOiA8T3ZlcnZpZXcgYXBpPXthcGl9IGRvYz17ZGF0YX0gZGF5cz17ZGF5c30gLz59XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFDQSxTQUFTLFdBQVcsUUFBUSxnQkFBZ0I7QUEwUHhDLFNBc1FBLFVBdFFBLEtBbUVRLFlBbkVSO0FBdFBKLElBQU0sT0FBTztBQUNiLElBQU0sY0FBYztBQUNwQixJQUFNLFlBQVk7QUFDbEIsSUFBTSxjQUFjO0FBQ3BCLElBQU0sV0FBVztBQUNqQixJQUFNLGlCQUFpQjtBQXlCdkIsSUFBSSxR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

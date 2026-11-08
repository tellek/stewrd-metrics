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
var CHART_HEIGHT = 170;
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
function Tooltip({ p, x, y, flip, fixed, children }) {
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        position: fixed ? "fixed" : "absolute",
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
function LineChart({ api, points, format, height = CHART_HEIGHT }) {
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
  const flip = hover !== null && hover.x > window.innerWidth - 200;
  return /* @__PURE__ */ jsxs("div", { style: { ...scrollbarStyle(p), maxHeight: CHART_HEIGHT, overflowY: "auto", overflowX: "hidden" }, onMouseLeave: () => setHover(null), children: [
    /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "minmax(0, max-content) 1fr max-content", gap: "2px 12px", alignItems: "center", fontSize: 14 }, children: rows.map((r, i) => {
      const total = r.segments.reduce((a, s) => a + s.value, 0);
      const hot = hover?.i === i;
      const cell2 = { background: hot ? p.surfaceHover : void 0, padding: "2px 0" };
      return /* @__PURE__ */ jsxs("div", { style: { display: "contents" }, onMouseMove: (e) => setHover({ i, x: e.clientX, y: e.clientY }), children: [
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
      ] }, r.label);
    }) }),
    hover && rows[hover.i] && /* @__PURE__ */ jsxs(Tooltip, { p, x: hover.x + (flip ? -12 : 12), y: hover.y + 12, flip, fixed: true, children: [
      /* @__PURE__ */ jsx("div", { style: { fontWeight: 600 }, children: rows[hover.i].label }),
      rows[hover.i].tip.map((t) => /* @__PURE__ */ jsx("div", { children: t }, t))
    ] })
  ] });
}
function Tile({ api, label, value, delta }) {
  const p = api.theme.palette;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: { minWidth: 0, boxSizing: "border-box", background: p.surface, border: `1px solid ${p.border}`, borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 },
      children: [
        /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: label }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: 22, lineHeight: "30px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }, children: value }),
        delta && /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: delta })
      ]
    }
  );
}
var TILE_MIN = 130;
var GAP = 12;
function TileRow({ children }) {
  const [ref, width] = useWidth();
  const n = Math.max(1, children.length);
  const fit = Math.max(1, Math.floor((width + GAP) / (TILE_MIN + GAP)));
  const cols = width ? Math.ceil(n / Math.ceil(n / Math.min(fit, n))) : n;
  return /* @__PURE__ */ jsx("div", { ref, style: { display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }, children });
}
var Flow = ({ children }) => /* @__PURE__ */ jsx("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 12 }, children });
function Section({ api, title, extra, children }) {
  const p = api.theme.palette;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        flex: "1 1 320px",
        boxSizing: "border-box",
        background: p.surface,
        border: `1px solid ${p.border}`,
        borderRadius: 6,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0
      },
      children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [
          /* @__PURE__ */ jsx("strong", { style: { flex: 1 }, children: title }),
          extra
        ] }),
        children
      ]
    }
  );
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
  return /* @__PURE__ */ jsx(Fragment, { children: trends.map((t) => ({ t, points: days.map((d) => ({ label: shortDate(d.date), raw: t.get(d.doc) })) })).filter(({ points }) => points.some((pt) => pt.raw !== void 0)).map(({ t, points }) => /* @__PURE__ */ jsx(Section, { api, title: `${t.title} Trend`, children: /* @__PURE__ */ jsx(LineChart, { api, points: points.map((pt) => ({ label: pt.label, value: pt.raw ?? null })), format: axisFmt(t.key) }) }, t.title)) });
}
function HistoryHint({ api, days }) {
  if (days.length >= 2) return null;
  return /* @__PURE__ */ jsxs("span", { style: { color: api.theme.palette.textMuted, fontSize: 12 }, children: [
    "Trends fill in as daily history accumulates (",
    days.length,
    " day so far)."
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
    /* @__PURE__ */ jsx(TileRow, { children: OVERVIEW_TRENDS.filter((t) => t.get(doc) !== void 0).map((t) => trendTile(api, days, t)) }),
    /* @__PURE__ */ jsx(HistoryHint, { api, days }),
    /* @__PURE__ */ jsxs(Flow, { children: [
      /* @__PURE__ */ jsx(TrendCharts, { api, days, trends: OVERVIEW_TRENDS.slice(0, 3) }),
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
    /* @__PURE__ */ jsx(TileRow, { children: APP_TRENDS.filter((t) => t.get(app) !== void 0).map((t) => trendTile(api, appDays, t)) }),
    /* @__PURE__ */ jsx(HistoryHint, { api, days: appDays }),
    /* @__PURE__ */ jsxs(Flow, { children: [
      /* @__PURE__ */ jsx(TrendCharts, { api, days: appDays, trends: APP_TRENDS }),
      mon && isErrorNode(mon) && /* @__PURE__ */ jsx(Section, { api, title: "Monitoring (24h)", children: /* @__PURE__ */ jsx("span", { children: fmt(mon) }) }),
      apis && apis.length > 0 && /* @__PURE__ */ jsx(
        Section,
        {
          api,
          title: "API Requests (24h)",
          extra: /* @__PURE__ */ jsx(
            Legend,
            {
              api,
              items: [
                { name: "OK", color: p.accent },
                { name: "4xx", color: p.status.warning },
                { name: "5xx", color: p.status.error }
              ]
            }
          ),
          children: /* @__PURE__ */ jsx(BarList, { api, rows: apis })
        }
      ),
      lambdas && lambdas.rows.length > 0 && /* @__PURE__ */ jsxs(
        Section,
        {
          api,
          title: "Lambda Invocations (24h)",
          extra: /* @__PURE__ */ jsx(
            Legend,
            {
              api,
              items: [
                { name: "Succeeded", color: p.accent },
                { name: "Errors", color: p.status.error }
              ]
            }
          ),
          children: [
            /* @__PURE__ */ jsx(BarList, { api, rows: lambdas.rows }),
            (lambdas.idle > 0 || lambdas.unknown.length > 0) && /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: [lambdas.idle ? `${lambdas.idle} idle function${lambdas.idle > 1 ? "s" : ""} hidden` : "", lambdas.unknown.length ? `Unknown: ${lambdas.unknown.join(", ")}` : ""].filter(Boolean).join(". ") })
          ]
        }
      ),
      audKeys.map((k) => /* @__PURE__ */ jsx(Section, { api, title: `Daily ${titleCase(k)}`, children: /* @__PURE__ */ jsx(LineChart, { api, points: audDays.map((d) => ({ label: shortDate(String(d.date)), value: typeof d[k] === "number" ? d[k] : null })), format: axisFmt(k) }) }, k)),
      aud?.sources30d && !isErrorNode(aud.sources30d) && /* @__PURE__ */ jsx(Section, { api, title: "Traffic Sources (30d)", children: /* @__PURE__ */ jsx(
        BarList,
        {
          api,
          rows: Object.entries(aud.sources30d).filter(([, v]) => typeof v === "number").sort(([, a], [, b]) => b - a).map(([k, v]) => ({
            label: titleCase(k),
            segments: [{ name: "Views", value: v, color: p.accent }],
            valueText: v.toLocaleString(),
            tip: [`${v.toLocaleString()} views`]
          }))
        }
      ) }),
      details.map(([k, v]) => /* @__PURE__ */ jsx(Section, { api, title: titleCase(k), children: /* @__PURE__ */ jsx(
        Rows,
        {
          api,
          value: k === "audience" && v && !isErrorNode(v) ? Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== "days" && kk !== "sources30d")) : v,
          path: k
        }
      ) }, k))
    ] })
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
      /* @__PURE__ */ jsx("div", { style: { ...scrollbarStyle(palette), flex: 1, minHeight: 0, overflow: "auto", paddingRight: GAP }, children: current ? /* @__PURE__ */ jsx(AppView, { api, app: current, days }) : /* @__PURE__ */ jsx(Overview, { api, doc: data, days }) })
    ] })
  ] });
}
export {
  Component,
  activate
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIGxvYWRpbmc6IGJvb2xlYW47XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UgfTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIHN0YXRlID0geyAuLi5zdGF0ZSwgLi4ucGF0Y2ggfTtcbiAgbGlzdGVuZXJzLmZvckVhY2goKGwpID0+IGwoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tXG5cbmNvbnN0IGlzRXJyb3JOb2RlID0gKHY6IEpzb24pOiBib29sZWFuID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHYuZXJyb3IgPT09IFwic3RyaW5nXCI7XG5cbmZ1bmN0aW9uIGhhc0Vycm9yTm9kZSh2OiBKc29uKTogYm9vbGVhbiB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIHRydWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIGlmICh2ICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiKSByZXR1cm4gT2JqZWN0LnZhbHVlcyh2KS5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgbW9uZXkgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IHN0eWxlOiBcImN1cnJlbmN5XCIsIGN1cnJlbmN5OiBcIlVTRFwiIH0pO1xuY29uc3QgY29tcGFjdCA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgbm90YXRpb246IFwiY29tcGFjdFwiLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG5jb25zdCBNT05FWV9LRVkgPSAvKG1ycnxwcm9maXR8Y29zdHxhbW91bnR8cmV2ZW51ZSkvaTtcblxuLyoqIFNpbmdsZSBmb3JtYXR0ZXI6IG51bGwvdW5kZWZpbmVkL2Vycm9yIG5vZGVzIGFyZSBcIlVua25vd25cIiwgbmV2ZXIgemVyby4gKi9cbmZ1bmN0aW9uIGZtdCh2OiBKc29uLCBrZXkgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gXCJVbmtub3duXCI7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIGBVbmtub3duICgke3YuZXJyb3J9KWA7XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChNT05FWV9LRVkudGVzdChrZXkpKSByZXR1cm4gbW9uZXkuZm9ybWF0KHYpO1xuICAgIGlmICgvbGF0ZW5jeW1zL2kudGVzdChrZXkpKSByZXR1cm4gYCR7TWF0aC5yb3VuZCh2KX0gbXNgO1xuICAgIHJldHVybiB2LnRvTG9jYWxlU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHR5cGVvZiB2ID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xuICByZXR1cm4gU3RyaW5nKHYpO1xufVxuXG4vKiogVGFibGUgY2VsbDogXCItXCIgd2hlbiB0aGUgYXBwIGhhcyBubyBzdWNoIG1ldHJpYywgb3RoZXJ3aXNlIGZtdCAoc28gdW5rbm93biBzdGF5cyBcIlVua25vd25cIikuICovXG5jb25zdCBjZWxsID0gKHY6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIGtleSA9IFwiXCIpID0+ICh2ID09PSB1bmRlZmluZWQgPyBcIi1cIiA6IGZtdCh2LCBrZXkpKTtcblxuY29uc3QgYXhpc0ZtdCA9IChrZXk6IHN0cmluZykgPT4gKG46IG51bWJlcikgPT4gKE1PTkVZX0tFWS50ZXN0KGtleSkgPyBtb25leS5mb3JtYXQobikgOiBjb21wYWN0LmZvcm1hdChuKSk7XG5cbmZ1bmN0aW9uIGFnZUhvdXJzKGlzbzogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgbnVsbCB7XG4gIGNvbnN0IHQgPSBpc28gPyBEYXRlLnBhcnNlKGlzbykgOiBOYU47XG4gIHJldHVybiBOdW1iZXIuaXNOYU4odCkgPyBudWxsIDogKERhdGUubm93KCkgLSB0KSAvIDNfNjAwXzAwMDtcbn1cblxuY29uc3Qgc2hvcnREYXRlID0gKGQ6IHN0cmluZykgPT4gbmV3IERhdGUoYCR7ZH1UMDA6MDA6MDBaYCkudG9Mb2NhbGVEYXRlU3RyaW5nKHVuZGVmaW5lZCwgeyBtb250aDogXCJzaG9ydFwiLCBkYXk6IFwibnVtZXJpY1wiLCB0aW1lWm9uZTogXCJVVENcIiB9KTtcblxuY29uc3QgYXBwc09mID0gKGRvYzogSnNvbik6IEpzb25bXSA9PiAoZG9jICYmIEFycmF5LmlzQXJyYXkoZG9jLmFwcHMpID8gZG9jLmFwcHMgOiBbXSk7XG5cbi8qKiBXYWxrcyBhIGRvdHRlZCBwYXRoLiB1bmRlZmluZWQgPSBub3QgcHJlc2VudCwgbnVsbCA9IHVua25vd24gKGVycm9yIG5vZGUgb3IgbnVsbCksIG51bWJlciA9IHZhbHVlLiAqL1xuZnVuY3Rpb24gbWV0cmljKG86IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBsZXQgdiA9IG87XG4gIGZvciAoY29uc3QgayBvZiBwYXRoLnNwbGl0KFwiLlwiKSkge1xuICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHYgPT09IG51bGwgfHwgaXNFcnJvck5vZGUodikpIHJldHVybiBudWxsO1xuICAgIHYgPSB2W2tdO1xuICB9XG4gIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodikgPyB2IDogbnVsbDtcbn1cblxuLyoqIFN1bXMgYSBtZXRyaWMgYWNyb3NzIGFwcHM7IGFueSB1bmtub3duIGFwcCB2YWx1ZSBtYWtlcyB0aGUgdG90YWwgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIHN1bUFwcHMoZG9jOiBKc29uLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFkb2MgfHwgaXNFcnJvck5vZGUoZG9jLmFwcHMpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IGFwcHNPZihkb2MpXG4gICAgLm1hcCgoYSkgPT4gbWV0cmljKGEsIHBhdGgpKVxuICAgIC5maWx0ZXIoKHYpID0+IHYgIT09IHVuZGVmaW5lZCk7XG4gIGlmICh2YWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdiA9PT0gbnVsbCkgPyBudWxsIDogKHZhbHMgYXMgbnVtYmVyW10pLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xufVxuXG5mdW5jdGlvbiBhcHBTdGF0dXMoYXBwOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBpZiAoaGFzRXJyb3JOb2RlKGFwcCkpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKChhcHAuaGVhbHRoPy5hbGFybXM/LmluQWxhcm0gPz8gMCkgPiAwKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICgoYXBwLmhlYWx0aD8uZnJlc2huZXNzPy5zdGFsZVN0YXRlcyA/PyAwKSA+IDApIHJldHVybiBcIndhcm5pbmdcIjtcbiAgcmV0dXJuIFwic3VjY2Vzc1wiO1xufVxuXG5jb25zdCBXT1JTVDogU3RhdHVzQ29sb3JbXSA9IFtcImlkbGVcIiwgXCJzdWNjZXNzXCIsIFwid2FybmluZ1wiLCBcImVycm9yXCJdO1xuY29uc3Qgd29yc3QgPSAoY3M6IFN0YXR1c0NvbG9yW10pOiBTdGF0dXNDb2xvciA9PiBjcy5yZWR1Y2UoKGEsIGIpID0+IChXT1JTVC5pbmRleE9mKGIpID4gV09SU1QuaW5kZXhPZihhKSA/IGIgOiBhKSwgXCJzdWNjZXNzXCIgYXMgU3RhdHVzQ29sb3IpO1xuXG5mdW5jdGlvbiBkb2NTdGF0dXMoZG9jOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBjb25zdCBhZ2UgPSBhZ2VIb3Vycyhkb2MuZ2VuZXJhdGVkQXQpO1xuICBjb25zdCBzdGFsZSA9IGFnZSA9PT0gbnVsbCB8fCBhZ2UgPiBTVEFMRV9IT1VSUztcbiAgY29uc3Qgc3RhdHVzID0gd29yc3QoYXBwc09mKGRvYykubWFwKGFwcFN0YXR1cykpO1xuICByZXR1cm4gc3RhbGUgfHwgaGFzRXJyb3JOb2RlKGRvYykgPyB3b3JzdChbc3RhdHVzLCBcIndhcm5pbmdcIl0pIDogc3RhdHVzO1xufVxuXG4vKiogSGlzdG9yeSBwbHVzIHRoZSBsYXRlc3QgZG9jdW1lbnQsIG9uZSBlbnRyeSBwZXIgVVRDIGRhdGUsIG9sZGVzdCBmaXJzdC4gKi9cbmZ1bmN0aW9uIGFsbERheXMoKTogRGF5W10ge1xuICBjb25zdCBtID0gbmV3IE1hcChzdGF0ZS5oaXN0b3J5Lm1hcCgoZCkgPT4gW2QuZGF0ZSwgZC5kb2NdKSk7XG4gIGlmICh0eXBlb2Ygc3RhdGUuZGF0YT8uZ2VuZXJhdGVkQXQgPT09IFwic3RyaW5nXCIpIG0uc2V0KHN0YXRlLmRhdGEuZ2VuZXJhdGVkQXQuc2xpY2UoMCwgMTApLCBzdGF0ZS5kYXRhKTtcbiAgcmV0dXJuIFsuLi5tLmVudHJpZXMoKV0uc29ydCgoW2FdLCBbYl0pID0+IChhIDwgYiA/IC0xIDogMSkpLm1hcCgoW2RhdGUsIGRvY10pID0+ICh7IGRhdGUsIGRvYyB9KSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gZmV0Y2hpbmcgLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBhd3NBcmdzKGFwaTogUGx1Z2luQXBpLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgcyA9IGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCk7XG4gIGNvbnN0IG91dCA9IFsuLi5hcmdzLCBcIi0tY2xpLWNvbm5lY3QtdGltZW91dFwiLCBcIjEwXCIsIFwiLS1jbGktcmVhZC10aW1lb3V0XCIsIFwiMTVcIl07XG4gIGlmIChzLmF3c1Byb2ZpbGUpIG91dC5wdXNoKFwiLS1wcm9maWxlXCIsIHMuYXdzUHJvZmlsZSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGF3cyhhcGk6IFBsdWdpbkFwaSwgYXJnczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXMgPSBhd2FpdCBhcGkuc2hlbGwuZXhlYyhcImF3c1wiLCBhd2FpdCBhd3NBcmdzKGFwaSwgYXJncykpO1xuICBpZiAocmVzLmNvZGUgIT09IDApIHRocm93IG5ldyBFcnJvcihyZXMuc3RkZXJyLnRyaW0oKSB8fCBgYXdzIGV4aXRlZCB3aXRoIGNvZGUgJHtyZXMuY29kZX1gKTtcbiAgcmV0dXJuIHJlcy5zdGRvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRIaXN0b3J5KGFwaTogUGx1Z2luQXBpKSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhcGkuZnMubGlzdERpcihISVNUT1JZX0RJUik7XG4gIGNvbnN0IGZpbGVzID0gZW50cmllc1xuICAgIC5maWx0ZXIoKGUpID0+ICFlLmlzRGlyICYmIC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1cXC5qc29uJC8udGVzdChlLm5hbWUpKVxuICAgIC5tYXAoKGUpID0+IGUubmFtZSlcbiAgICAuc29ydCgpXG4gICAgLnNsaWNlKC1NQVhfREFZUyk7XG4gIGNvbnN0IGRvY3MgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBmaWxlcy5tYXAoYXN5bmMgKGYpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IGFwaS5mcy5yZWFkVGV4dEZpbGUoYCR7SElTVE9SWV9ESVJ9LyR7Zn1gKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSksXG4gICk7XG4gIHNldFN0YXRlKHsgaGlzdG9yeTogZmlsZXMubWFwKChmLCBpKSA9PiAoeyBkYXRlOiBmLnNsaWNlKDAsIDEwKSwgZG9jOiBkb2NzW2ldIH0pKS5maWx0ZXIoKGQpID0+IGQuZG9jKSB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY0hpc3RvcnkoYXBpOiBQbHVnaW5BcGksIGJ1Y2tldDogc3RyaW5nKSB7XG4gIGNvbnN0IHJvb3QgPSAoYXdhaXQgYXBpLmZzLmdldFJvb3RQYXRoKCkpLnJlcGxhY2UoL1tcXFxcL10rJC8sIFwiXCIpO1xuICBhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcInN5bmNcIiwgYHMzOi8vJHtidWNrZXR9LyR7SElTVE9SWV9ESVJ9L2AsIGAke3Jvb3R9LyR7SElTVE9SWV9ESVJ9YCwgXCItLW9ubHktc2hvdy1lcnJvcnNcIl0pO1xuICBhd2FpdCBsb2FkSGlzdG9yeShhcGkpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoKGFwaTogUGx1Z2luQXBpLCBzaWduYWw/OiBBYm9ydFNpZ25hbCkge1xuICBpZiAoc3RhdGUubG9hZGluZykgcmV0dXJuO1xuICBzZXRTdGF0ZSh7IGxvYWRpbmc6IHRydWUgfSk7XG4gIGNvbnN0IHNldEljb24gPSAoYzogU3RhdHVzQ29sb3IsIHRpcD86IHN0cmluZykgPT4ge1xuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXBpLnN0YXR1c0ljb24uc2V0KGMsIHRpcCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBkZWFjdGl2YXRlZCAqL1xuICAgIH1cbiAgfTtcbiAgY29uc3QgbG9nID0gKGxldmVsOiBcIndhcm5cIiB8IFwiZXJyb3JcIiwgbXNnOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoc2lnbmFsPy5hYm9ydGVkKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGFwaS5sb2dbbGV2ZWxdKGAke05BTUV9OiAke21zZ31gKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGRlYWN0aXZhdGVkICovXG4gICAgfVxuICB9O1xuICBzZXRJY29uKFwiaW4tcHJvZ3Jlc3NcIiwgXCJSZWZyZXNoaW5nXCIpO1xuICB0cnkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IChhd2FpdCBhcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpKS5idWNrZXQgfHwgREVGQVVMVF9CVUNLRVQ7XG4gICAgY29uc3QgZGF0YSA9IEpTT04ucGFyc2UoYXdhaXQgYXdzKGFwaSwgW1wiczNcIiwgXCJjcFwiLCBgczM6Ly8ke2J1Y2tldH0vbWV0cmljcy5qc29uYCwgXCItXCJdKSk7XG4gICAgYXdhaXQgYXBpLnN0b3JhZ2Uuc2V0KENBQ0hFX0tFWSwgZGF0YSk7XG4gICAgc2V0U3RhdGUoeyBkYXRhLCBlcnJvcjogbnVsbCB9KTtcbiAgICBsZXQgc3RhdHVzID0gZG9jU3RhdHVzKGRhdGEpO1xuICAgIGxldCB0aXAgPSBzdGF0dXMgPT09IFwic3VjY2Vzc1wiID8gXCJNZXRyaWNzIHVwIHRvIGRhdGVcIiA6IFwiTWV0cmljcyBuZWVkIGF0dGVudGlvblwiO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzeW5jSGlzdG9yeShhcGksIGJ1Y2tldCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc3QgbXNnID0gZSBpbnN0YW5jZW9mIEVycm9yID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpO1xuICAgICAgbG9nKFwid2FyblwiLCBgaGlzdG9yeSBzeW5jIGZhaWxlZDogJHttc2d9YCk7XG4gICAgICBzdGF0dXMgPSB3b3JzdChbc3RhdHVzLCBcIndhcm5pbmdcIl0pO1xuICAgICAgdGlwID0gYEhpc3Rvcnkgc3luYyBmYWlsZWQ6ICR7bXNnfWA7XG4gICAgfVxuICAgIHNldFN0YXRlKHsgbG9hZGluZzogZmFsc2UgfSk7XG4gICAgc2V0SWNvbihzdGF0dXMsIHRpcCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCBtc2cgPSBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSk7XG4gICAgc2V0U3RhdGUoeyBlcnJvcjogbXNnLCBsb2FkaW5nOiBmYWxzZSB9KTtcbiAgICBzZXRJY29uKFwiZXJyb3JcIiwgbXNnKTtcbiAgICBsb2coXCJlcnJvclwiLCBtc2cpO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhY3RpdmF0ZShjdHg6IFBsdWdpbkNvbnRleHQpIHtcbiAgY3R4LmFwaS5zdGF0dXNJY29uLnNldChcImlkbGVcIik7XG4gIGNvbnN0IHMgPSBhd2FpdCBjdHguYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKTtcbiAgY29uc3QgbWludXRlcyA9IE1hdGgubWF4KDEsIHMucmVmcmVzaE1pbnV0ZXMgPz8gNjApO1xuICBjdHgudGljay5yZWdpc3RlcigoKSA9PiByZWZyZXNoKGN0eC5hcGksIGN0eC5zaWduYWwpKTtcbiAgY3R4LnRpY2suc2V0SW50ZXJ2YWwobWludXRlcyAqIDYwXzAwMCk7XG4gIGN0eC5hcGkubG9nLmluZm8oYCR7TkFNRX0gYWN0aXZhdGVkYCk7XG4gIHZvaWQgbG9hZEhpc3RvcnkoY3R4LmFwaSkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgdm9pZCByZWZyZXNoKGN0eC5hcGksIGN0eC5zaWduYWwpO1xufVxuXG4vLyAtLS0tLS0tLS0tIGNoYXJ0IHByaW1pdGl2ZXMgLS0tLS0tLS0tLVxuXG5jb25zdCBDSEFSVF9IRUlHSFQgPSAxNzA7XG5cbmNvbnN0IHNjcm9sbGJhclN0eWxlID0gKHA6IFBhbGV0dGUpOiBDU1NQcm9wZXJ0aWVzID0+ICh7IHNjcm9sbGJhcldpZHRoOiBcInRoaW5cIiwgc2Nyb2xsYmFyQ29sb3I6IGAke3AuYm9yZGVyfSAke3Auc3VyZmFjZX1gIH0pO1xuXG5mdW5jdGlvbiB1c2VXaWR0aCgpIHtcbiAgY29uc3QgcmVmID0gdXNlUmVmPEhUTUxEaXZFbGVtZW50PihudWxsKTtcbiAgY29uc3QgW3dpZHRoLCBzZXRXaWR0aF0gPSB1c2VTdGF0ZSgwKTtcbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBlbCA9IHJlZi5jdXJyZW50O1xuICAgIGlmICghZWwpIHJldHVybjtcbiAgICBjb25zdCBybyA9IG5ldyBSZXNpemVPYnNlcnZlcigoW2VdKSA9PiBzZXRXaWR0aChlLmNvbnRlbnRSZWN0LndpZHRoKSk7XG4gICAgcm8ub2JzZXJ2ZShlbCk7XG4gICAgcmV0dXJuICgpID0+IHJvLmRpc2Nvbm5lY3QoKTtcbiAgfSwgW10pO1xuICByZXR1cm4gW3JlZiwgd2lkdGhdIGFzIGNvbnN0O1xufVxuXG5mdW5jdGlvbiBuaWNlTWF4KHY6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICh2IDw9IDApIHJldHVybiAxO1xuICBjb25zdCBwID0gMTAgKiogTWF0aC5mbG9vcihNYXRoLmxvZzEwKHYpKTtcbiAgY29uc3QgbiA9IHYgLyBwO1xuICByZXR1cm4gKG4gPD0gMSA/IDEgOiBuIDw9IDIgPyAyIDogbiA8PSA1ID8gNSA6IDEwKSAqIHA7XG59XG5cbmZ1bmN0aW9uIFRvb2x0aXAoeyBwLCB4LCB5LCBmbGlwLCBmaXhlZCwgY2hpbGRyZW4gfTogeyBwOiBQYWxldHRlOyB4OiBudW1iZXI7IHk6IG51bWJlcjsgZmxpcDogYm9vbGVhbjsgZml4ZWQ/OiBib29sZWFuOyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBwb3NpdGlvbjogZml4ZWQgPyBcImZpeGVkXCIgOiBcImFic29sdXRlXCIsXG4gICAgICAgIGxlZnQ6IHgsXG4gICAgICAgIHRvcDogeSxcbiAgICAgICAgdHJhbnNmb3JtOiBmbGlwID8gXCJ0cmFuc2xhdGVYKC0xMDAlKVwiIDogdW5kZWZpbmVkLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLmJhY2tncm91bmQsXG4gICAgICAgIGNvbG9yOiBwLnRleHQsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNCxcbiAgICAgICAgcGFkZGluZzogXCI0cHggOHB4XCIsXG4gICAgICAgIGZvbnRTaXplOiAxMixcbiAgICAgICAgbGluZUhlaWdodDogXCIxOHB4XCIsXG4gICAgICAgIHdoaXRlU3BhY2U6IFwibm93cmFwXCIsXG4gICAgICAgIHBvaW50ZXJFdmVudHM6IFwibm9uZVwiLFxuICAgICAgICB6SW5kZXg6IDEsXG4gICAgICB9fVxuICAgID5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuaW50ZXJmYWNlIFB0IHtcbiAgbGFiZWw6IHN0cmluZztcbiAgdmFsdWU6IG51bWJlciB8IG51bGw7XG59XG5cbi8qKiBTaW5nbGUtc2VyaWVzIGxpbmUgb3ZlciB0aW1lLiBVbmtub3duIChudWxsKSBwb2ludHMgYnJlYWsgdGhlIGxpbmUgaW5zdGVhZCBvZiBkcm9wcGluZyB0byB6ZXJvLiAqL1xuZnVuY3Rpb24gTGluZUNoYXJ0KHsgYXBpLCBwb2ludHMsIGZvcm1hdCwgaGVpZ2h0ID0gQ0hBUlRfSEVJR0hUIH06IHsgYXBpOiBQbHVnaW5BcGk7IHBvaW50czogUHRbXTsgZm9ybWF0OiAobjogbnVtYmVyKSA9PiBzdHJpbmc7IGhlaWdodD86IG51bWJlciB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW3JlZiwgd2lkdGhdID0gdXNlV2lkdGgoKTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTxudW1iZXIgfCBudWxsPihudWxsKTtcbiAgY29uc3QgTCA9IDU2LFxuICAgIFIgPSAxMixcbiAgICBUID0gMTAsXG4gICAgQiA9IDIyO1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgd2lkdGggLSBMIC0gUik7XG4gIGNvbnN0IGggPSBoZWlnaHQgLSBUIC0gQjtcbiAgY29uc3QgbiA9IHBvaW50cy5sZW5ndGg7XG4gIGNvbnN0IG1heCA9IG5pY2VNYXgoTWF0aC5tYXgoMCwgLi4ucG9pbnRzLm1hcCgocHQpID0+IHB0LnZhbHVlID8/IDApKSk7XG4gIGNvbnN0IHggPSAoaTogbnVtYmVyKSA9PiBMICsgKG4gPD0gMSA/IHcgLyAyIDogKGkgKiB3KSAvIChuIC0gMSkpO1xuICBjb25zdCB5ID0gKHY6IG51bWJlcikgPT4gVCArIGggLSAodiAvIG1heCkgKiBoO1xuXG4gIGNvbnN0IHJ1bnM6IG51bWJlcltdW10gPSBbXTtcbiAgbGV0IGN1cjogbnVtYmVyW10gPSBbXTtcbiAgcG9pbnRzLmZvckVhY2goKHB0LCBpKSA9PiB7XG4gICAgaWYgKHB0LnZhbHVlID09PSBudWxsKSB7XG4gICAgICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gICAgICBjdXIgPSBbXTtcbiAgICB9IGVsc2UgY3VyLnB1c2goaSk7XG4gIH0pO1xuICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gIGNvbnN0IGxpbmUgPSAocnVuOiBudW1iZXJbXSkgPT4gcnVuLm1hcCgoaSwgaykgPT4gYCR7ayA/IFwiTFwiIDogXCJNXCJ9JHt4KGkpfSwke3kocG9pbnRzW2ldLnZhbHVlIGFzIG51bWJlcil9YCkuam9pbihcIlwiKTtcbiAgY29uc3QgbGFzdEtub3duID0gWy4uLnBvaW50cy5rZXlzKCldLnJldmVyc2UoKS5maW5kKChpKSA9PiBwb2ludHNbaV0udmFsdWUgIT09IG51bGwpO1xuXG4gIGNvbnN0IG9uTW92ZSA9IChlOiBNb3VzZUV2ZW50PFNWR1JlY3RFbGVtZW50PikgPT4ge1xuICAgIGNvbnN0IHIgPSBlLmN1cnJlbnRUYXJnZXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgaSA9IG4gPD0gMSA/IDAgOiBNYXRoLnJvdW5kKCgoZS5jbGllbnRYIC0gci5sZWZ0KSAvIHIud2lkdGgpICogKG4gLSAxKSk7XG4gICAgc2V0SG92ZXIoTWF0aC5taW4obiAtIDEsIE1hdGgubWF4KDAsIGkpKSk7XG4gIH07XG5cbiAgY29uc3QgeExhYmVscyA9IG4gPD0gMSA/IFswXSA6IG4gPT09IDIgPyBbMCwgMV0gOiBbMCwgTWF0aC5mbG9vcigobiAtIDEpIC8gMiksIG4gLSAxXTtcbiAgY29uc3QgYW5jaG9yID0gKGk6IG51bWJlcikgPT4gKG4gPD0gMSA/IFwibWlkZGxlXCIgOiBpID09PSAwID8gXCJzdGFydFwiIDogaSA9PT0gbiAtIDEgPyBcImVuZFwiIDogXCJtaWRkbGVcIik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHJlZj17cmVmfSBzdHlsZT17eyBwb3NpdGlvbjogXCJyZWxhdGl2ZVwiLCBoZWlnaHQgfX0+XG4gICAgICB7d2lkdGggPiAwICYmIChcbiAgICAgICAgPHN2ZyB3aWR0aD17d2lkdGh9IGhlaWdodD17aGVpZ2h0fSBzdHlsZT17eyBkaXNwbGF5OiBcImJsb2NrXCIsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICB7WzAsIDAuNSwgMV0ubWFwKChmKSA9PiAoXG4gICAgICAgICAgICA8ZyBrZXk9e2Z9PlxuICAgICAgICAgICAgICA8bGluZSB4MT17TH0geDI9e0wgKyB3fSB5MT17eShtYXggKiBmKX0geTI9e3kobWF4ICogZil9IHN0cm9rZT17cC5ib3JkZXJ9IHN0cm9rZVdpZHRoPXsxfSBzdHJva2VEYXNoYXJyYXk9e2YgPyBcIjIgNFwiIDogdW5kZWZpbmVkfSAvPlxuICAgICAgICAgICAgICA8dGV4dCB4PXtMIC0gNn0geT17eShtYXggKiBmKX0gZHk9XCIwLjMyZW1cIiB0ZXh0QW5jaG9yPVwiZW5kXCIgZmlsbD17cC50ZXh0TXV0ZWR9PlxuICAgICAgICAgICAgICAgIHtmb3JtYXQobWF4ICogZil9XG4gICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICApKX1cbiAgICAgICAgICB7eExhYmVscy5tYXAoKGkpID0+IChcbiAgICAgICAgICAgIDx0ZXh0IGtleT17aX0geD17eChpKX0geT17aGVpZ2h0IC0gNH0gdGV4dEFuY2hvcj17YW5jaG9yKGkpfSBmaWxsPXtwLnRleHRNdXRlZH0+XG4gICAgICAgICAgICAgIHtwb2ludHNbaV0/LmxhYmVsfVxuICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICkpfVxuICAgICAgICAgIHtydW5zLm1hcCgocnVuKSA9PlxuICAgICAgICAgICAgcnVuLmxlbmd0aCA+IDEgPyAoXG4gICAgICAgICAgICAgIDxnIGtleT17cnVuWzBdfT5cbiAgICAgICAgICAgICAgICA8cGF0aCBkPXtgJHtsaW5lKHJ1bil9TCR7eChydW5bcnVuLmxlbmd0aCAtIDFdKX0sJHt5KDApfUwke3gocnVuWzBdKX0sJHt5KDApfVpgfSBmaWxsPXtwLmFjY2VudH0gZmlsbE9wYWNpdHk9ezAuMTJ9IC8+XG4gICAgICAgICAgICAgICAgPHBhdGggZD17bGluZShydW4pfSBmaWxsPVwibm9uZVwiIHN0cm9rZT17cC5hY2NlbnR9IHN0cm9rZVdpZHRoPXsyfSBzdHJva2VMaW5lam9pbj1cInJvdW5kXCIgc3Ryb2tlTGluZWNhcD1cInJvdW5kXCIgLz5cbiAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKSA6IG51bGwsXG4gICAgICAgICAgKX1cbiAgICAgICAgICB7cnVuc1xuICAgICAgICAgICAgLmZpbHRlcigocnVuKSA9PiBydW4ubGVuZ3RoID09PSAxKVxuICAgICAgICAgICAgLm1hcCgocnVuKSA9PiAoXG4gICAgICAgICAgICAgIDxjaXJjbGUga2V5PXtydW5bMF19IGN4PXt4KHJ1blswXSl9IGN5PXt5KHBvaW50c1tydW5bMF1dLnZhbHVlIGFzIG51bWJlcil9IHI9ezN9IGZpbGw9e3AuYWNjZW50fSAvPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAge2xhc3RLbm93biAhPT0gdW5kZWZpbmVkICYmIGhvdmVyID09PSBudWxsICYmIChcbiAgICAgICAgICAgIDxjaXJjbGUgY3g9e3gobGFzdEtub3duKX0gY3k9e3kocG9pbnRzW2xhc3RLbm93bl0udmFsdWUgYXMgbnVtYmVyKX0gcj17My41fSBmaWxsPXtwLmFjY2VudH0gc3Ryb2tlPXtwLnN1cmZhY2V9IHN0cm9rZVdpZHRoPXsyfSAvPlxuICAgICAgICAgICl9XG4gICAgICAgICAge2hvdmVyICE9PSBudWxsICYmIChcbiAgICAgICAgICAgIDxnIHBvaW50ZXJFdmVudHM9XCJub25lXCI+XG4gICAgICAgICAgICAgIDxsaW5lIHgxPXt4KGhvdmVyKX0geDI9e3goaG92ZXIpfSB5MT17VH0geTI9e1QgKyBofSBzdHJva2U9e3AudGV4dE11dGVkfSBzdHJva2VXaWR0aD17MX0gLz5cbiAgICAgICAgICAgICAge3BvaW50c1tob3Zlcl0udmFsdWUgIT09IG51bGwgJiYgPGNpcmNsZSBjeD17eChob3Zlcil9IGN5PXt5KHBvaW50c1tob3Zlcl0udmFsdWUgYXMgbnVtYmVyKX0gcj17NC41fSBmaWxsPXtwLmFjY2VudH0gc3Ryb2tlPXtwLnN1cmZhY2V9IHN0cm9rZVdpZHRoPXsyfSAvPn1cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICApfVxuICAgICAgICAgIDxyZWN0IHg9e0x9IHk9ezB9IHdpZHRoPXt3fSBoZWlnaHQ9e2hlaWdodH0gZmlsbD1cInRyYW5zcGFyZW50XCIgb25Nb3VzZU1vdmU9e29uTW92ZX0gb25Nb3VzZUxlYXZlPXsoKSA9PiBzZXRIb3ZlcihudWxsKX0gLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICApfVxuICAgICAge2hvdmVyICE9PSBudWxsICYmIChcbiAgICAgICAgPFRvb2x0aXAgcD17cH0geD17eChob3ZlcikgKyAoeChob3ZlcikgPiB3aWR0aCAtIDE0MCA/IC0xMCA6IDEwKX0geT17VH0gZmxpcD17eChob3ZlcikgPiB3aWR0aCAtIDE0MH0+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e3BvaW50c1tob3Zlcl0ubGFiZWx9PC9kaXY+XG4gICAgICAgICAgPGRpdj57cG9pbnRzW2hvdmVyXS52YWx1ZSA9PT0gbnVsbCA/IFwiVW5rbm93blwiIDogZm9ybWF0KHBvaW50c1tob3Zlcl0udmFsdWUgYXMgbnVtYmVyKX08L2Rpdj5cbiAgICAgICAgPC9Ub29sdGlwPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuaW50ZXJmYWNlIFNlZyB7XG4gIG5hbWU6IHN0cmluZztcbiAgdmFsdWU6IG51bWJlcjtcbiAgY29sb3I6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEJhclJvdyB7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHNlZ21lbnRzOiBTZWdbXTtcbiAgdmFsdWVUZXh0OiBzdHJpbmc7XG4gIHRpcDogc3RyaW5nW107XG59XG5cbmZ1bmN0aW9uIExlZ2VuZCh7IGFwaSwgaXRlbXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgaXRlbXM6IHsgbmFtZTogc3RyaW5nOyBjb2xvcjogc3RyaW5nIH1bXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBnYXA6IDE2LCBmbGV4V3JhcDogXCJ3cmFwXCIsIGZvbnRTaXplOiAxMiwgY29sb3I6IHAudGV4dE11dGVkIH19PlxuICAgICAge2l0ZW1zLm1hcCgoaXQpID0+IChcbiAgICAgICAgPHNwYW4ga2V5PXtpdC5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImlubGluZS1mbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGdhcDogNiB9fT5cbiAgICAgICAgICA8c3BhbiBzdHlsZT17eyB3aWR0aDogMTAsIGhlaWdodDogMTAsIGJvcmRlclJhZGl1czogMiwgYmFja2dyb3VuZDogaXQuY29sb3IgfX0gLz5cbiAgICAgICAgICB7aXQubmFtZX1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgKSl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbi8qKiBIb3Jpem9udGFsIChvcHRpb25hbGx5IHN0YWNrZWQpIGJhcnMgc2hhcmluZyBvbmUgc2NhbGUsIHZhbHVlIGxhYmVscyBhdCB0aGUgZW5kLiBTY3JvbGxzIHBhc3QgQkFSX0xJU1RfSEVJR0hULiAqL1xuZnVuY3Rpb24gQmFyTGlzdCh7IGFwaSwgcm93cyB9OiB7IGFwaTogUGx1Z2luQXBpOyByb3dzOiBCYXJSb3dbXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTx7IGk6IG51bWJlcjsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSB8IG51bGw+KG51bGwpO1xuICBjb25zdCBtYXggPSBNYXRoLm1heCgwLCAuLi5yb3dzLm1hcCgocikgPT4gci5zZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKSkpIHx8IDE7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT5Ob25lPC9zcGFuPjtcbiAgY29uc3QgZmxpcCA9IGhvdmVyICE9PSBudWxsICYmIGhvdmVyLnggPiB3aW5kb3cuaW5uZXJXaWR0aCAtIDIwMDtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IC4uLnNjcm9sbGJhclN0eWxlKHApLCBtYXhIZWlnaHQ6IENIQVJUX0hFSUdIVCwgb3ZlcmZsb3dZOiBcImF1dG9cIiwgb3ZlcmZsb3dYOiBcImhpZGRlblwiIH19IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJtaW5tYXgoMCwgbWF4LWNvbnRlbnQpIDFmciBtYXgtY29udGVudFwiLCBnYXA6IFwiMnB4IDEycHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZm9udFNpemU6IDE0IH19PlxuICAgICAgICB7cm93cy5tYXAoKHIsIGkpID0+IHtcbiAgICAgICAgICBjb25zdCB0b3RhbCA9IHIuc2VnbWVudHMucmVkdWNlKChhLCBzKSA9PiBhICsgcy52YWx1ZSwgMCk7XG4gICAgICAgICAgY29uc3QgaG90ID0gaG92ZXI/LmkgPT09IGk7XG4gICAgICAgICAgY29uc3QgY2VsbDogQ1NTUHJvcGVydGllcyA9IHsgYmFja2dyb3VuZDogaG90ID8gcC5zdXJmYWNlSG92ZXIgOiB1bmRlZmluZWQsIHBhZGRpbmc6IFwiMnB4IDBcIiB9O1xuICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17ci5sYWJlbH0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19IG9uTW91c2VNb3ZlPXsoZSkgPT4gc2V0SG92ZXIoeyBpLCB4OiBlLmNsaWVudFgsIHk6IGUuY2xpZW50WSB9KX0+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIGNvbG9yOiBob3QgPyBwLmFjY2VudCA6IHAudGV4dCwgbWF4V2lkdGg6IDIyMCwgb3ZlcmZsb3c6IFwiaGlkZGVuXCIsIHRleHRPdmVyZmxvdzogXCJlbGxpcHNpc1wiLCB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiIH19IHRpdGxlPXtyLmxhYmVsfT5cbiAgICAgICAgICAgICAgICB7ci5sYWJlbH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLmNlbGwsIGRpc3BsYXk6IFwiZmxleFwiLCBoZWlnaHQ6IDIyLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiIH19PlxuICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIHdpZHRoOiBgJHsodG90YWwgLyBtYXgpICogMTAwfSVgLCBoZWlnaHQ6IDEyLCBnYXA6IDEsIG1pbldpZHRoOiB0b3RhbCA+IDAgPyAyIDogMCB9fT5cbiAgICAgICAgICAgICAgICAgIHtyLnNlZ21lbnRzXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKHMpID0+IHMudmFsdWUgPiAwKVxuICAgICAgICAgICAgICAgICAgICAubWFwKChzLCBrLCBhcnIpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXk9e3MubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZsZXg6IHMudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHMuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJvcmRlclJhZGl1czogYCR7ayA9PT0gMCA/IDIgOiAwfXB4ICR7ayA9PT0gYXJyLmxlbmd0aCAtIDEgPyAyIDogMH1weCAke2sgPT09IGFyci5sZW5ndGggLSAxID8gMiA6IDB9cHggJHtrID09PSAwID8gMiA6IDB9cHhgLFxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIHRleHRBbGlnbjogXCJyaWdodFwiLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIgfX0+e3IudmFsdWVUZXh0fTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICk7XG4gICAgICAgIH0pfVxuICAgICAgPC9kaXY+XG4gICAgICB7aG92ZXIgJiYgcm93c1tob3Zlci5pXSAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e2hvdmVyLnggKyAoZmxpcCA/IC0xMiA6IDEyKX0geT17aG92ZXIueSArIDEyfSBmbGlwPXtmbGlwfSBmaXhlZD5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRXZWlnaHQ6IDYwMCB9fT57cm93c1tob3Zlci5pXS5sYWJlbH08L2Rpdj5cbiAgICAgICAgICB7cm93c1tob3Zlci5pXS50aXAubWFwKCh0KSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17dH0+e3R9PC9kaXY+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvVG9vbHRpcD5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmZ1bmN0aW9uIFRpbGUoeyBhcGksIGxhYmVsLCB2YWx1ZSwgZGVsdGEgfTogeyBhcGk6IFBsdWdpbkFwaTsgbGFiZWw6IHN0cmluZzsgdmFsdWU6IHN0cmluZzsgZGVsdGE/OiBzdHJpbmcgfCBudWxsIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICByZXR1cm4gKFxuICAgIDxkaXZcbiAgICAgIHN0eWxlPXt7IG1pbldpZHRoOiAwLCBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiLCBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsIGJvcmRlclJhZGl1czogNiwgcGFkZGluZzogXCIxMHB4IDEycHhcIiwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMiB9fVxuICAgID5cbiAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PntsYWJlbH08L3NwYW4+XG4gICAgICA8c3BhbiBzdHlsZT17eyBmb250U2l6ZTogMjIsIGxpbmVIZWlnaHQ6IFwiMzBweFwiLCBmb250V2VpZ2h0OiA2MDAsIGZvbnRWYXJpYW50TnVtZXJpYzogXCJ0YWJ1bGFyLW51bXNcIiB9fT57dmFsdWV9PC9zcGFuPlxuICAgICAge2RlbHRhICYmIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PntkZWx0YX08L3NwYW4+fVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogV3JhcHBpbmcgcm93IG9mIGNhcmRzOiBldmVyeSByb3cgaXMgZmlsbGVkIGVkZ2UgdG8gZWRnZSBhbmQgaXRzIGNhcmRzIHNoYXJlIG9uZSBoZWlnaHQuICovXG5jb25zdCBUSUxFX01JTiA9IDEzMDtcbmNvbnN0IEdBUCA9IDEyO1xuXG4vKiogU3RhdCB0aWxlcyBpbiBlcXVhbCBjb2x1bW5zOyB3aGVuIHRoZXkgZG9uJ3QgZml0IG9uIG9uZSByb3cgdGhleSBzcGxpdCBpbnRvIGJhbGFuY2VkIHJvd3MgKDYgLT4gMyszIC0+IDIrMisyKS4gKi9cbmZ1bmN0aW9uIFRpbGVSb3coeyBjaGlsZHJlbiB9OiB7IGNoaWxkcmVuOiBSZWFjdE5vZGVbXSB9KSB7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IG4gPSBNYXRoLm1heCgxLCBjaGlsZHJlbi5sZW5ndGgpO1xuICBjb25zdCBmaXQgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKCh3aWR0aCArIEdBUCkgLyAoVElMRV9NSU4gKyBHQVApKSk7XG4gIGNvbnN0IGNvbHMgPSB3aWR0aCA/IE1hdGguY2VpbChuIC8gTWF0aC5jZWlsKG4gLyBNYXRoLm1pbihmaXQsIG4pKSkgOiBuO1xuICByZXR1cm4gKFxuICAgIDxkaXYgcmVmPXtyZWZ9IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBgcmVwZWF0KCR7Y29sc30sIG1pbm1heCgwLCAxZnIpKWAsIGdhcDogR0FQIH19PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5jb25zdCBGbG93ID0gKHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pID0+IDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhXcmFwOiBcIndyYXBcIiwgYWxpZ25JdGVtczogXCJzdHJldGNoXCIsIGdhcDogMTIgfX0+e2NoaWxkcmVufTwvZGl2PjtcblxuZnVuY3Rpb24gU2VjdGlvbih7IGFwaSwgdGl0bGUsIGV4dHJhLCBjaGlsZHJlbiB9OiB7IGFwaTogUGx1Z2luQXBpOyB0aXRsZTogc3RyaW5nOyBleHRyYT86IFJlYWN0Tm9kZTsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBmbGV4OiBcIjEgMSAzMjBweFwiLFxuICAgICAgICBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNixcbiAgICAgICAgcGFkZGluZzogMTIsXG4gICAgICAgIGRpc3BsYXk6IFwiZmxleFwiLFxuICAgICAgICBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLFxuICAgICAgICBnYXA6IDgsXG4gICAgICAgIG1pbldpZHRoOiAwLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBmbGV4V3JhcDogXCJ3cmFwXCIgfX0+XG4gICAgICAgIDxzdHJvbmcgc3R5bGU9e3sgZmxleDogMSB9fT57dGl0bGV9PC9zdHJvbmc+XG4gICAgICAgIHtleHRyYX1cbiAgICAgIDwvZGl2PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1ldHJpYyB2aWV3cyAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBUcmVuZCB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGtleTogc3RyaW5nO1xuICBnZXQ6IChkb2M6IEpzb24pID0+IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ7XG59XG5cbi8qKiBUaWxlIHZhbHVlIGZyb20gdGhlIGxhdGVzdCBkb2MsIGRlbHRhIGFnYWluc3QgdGhlIHByZXZpb3VzIGRheSBpbiBoaXN0b3J5LiAqL1xuZnVuY3Rpb24gdHJlbmRUaWxlKGFwaTogUGx1Z2luQXBpLCBkYXlzOiBEYXlbXSwgdDogVHJlbmQpIHtcbiAgY29uc3QgdmFscyA9IGRheXMubWFwKChkKSA9PiB0LmdldChkLmRvYykpO1xuICBjb25zdCBjdXIgPSB2YWxzW3ZhbHMubGVuZ3RoIC0gMV07XG4gIGNvbnN0IHByZXYgPSB2YWxzLmxlbmd0aCA+IDEgPyB2YWxzW3ZhbHMubGVuZ3RoIC0gMl0gOiB1bmRlZmluZWQ7XG4gIGxldCBkZWx0YTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY3VyID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBwcmV2ID09PSBcIm51bWJlclwiKSB7XG4gICAgY29uc3QgZCA9IGN1ciAtIHByZXY7XG4gICAgY29uc3QgYWJzID0gTU9ORVlfS0VZLnRlc3QodC5rZXkpID8gbW9uZXkuZm9ybWF0KE1hdGguYWJzKGQpKSA6IE1hdGguYWJzKGQpLnRvTG9jYWxlU3RyaW5nKCk7XG4gICAgZGVsdGEgPSBgJHtkID4gMCA/IFwiK1wiIDogZCA8IDAgPyBcIi1cIiA6IFwiXHUwMEIxXCJ9JHthYnN9IHZzICR7c2hvcnREYXRlKGRheXNbZGF5cy5sZW5ndGggLSAyXS5kYXRlKX1gO1xuICB9XG4gIHJldHVybiA8VGlsZSBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSBsYWJlbD17dC50aXRsZX0gdmFsdWU9e2ZtdChjdXIsIHQua2V5KX0gZGVsdGE9e2RlbHRhfSAvPjtcbn1cblxuLyoqIE9uZSBjYXJkIHBlciB0cmVuZCB0aGF0IGhhcyBkYXRhOyByZW5kZXJlZCBhcyBhIGZyYWdtZW50IHNvIHRoZSBjYXJkcyBqb2luIHRoZSBzdXJyb3VuZGluZyBGbG93LiAqL1xuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RyZW5kc1xuICAgICAgICAubWFwKCh0KSA9PiAoeyB0LCBwb2ludHM6IGRheXMubWFwKChkKSA9PiAoeyBsYWJlbDogc2hvcnREYXRlKGQuZGF0ZSksIHJhdzogdC5nZXQoZC5kb2MpIH0pKSB9KSlcbiAgICAgICAgLmZpbHRlcigoeyBwb2ludHMgfSkgPT4gcG9pbnRzLnNvbWUoKHB0KSA9PiBwdC5yYXcgIT09IHVuZGVmaW5lZCkpXG4gICAgICAgIC5tYXAoKHsgdCwgcG9pbnRzIH0pID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSB0aXRsZT17YCR7dC50aXRsZX0gVHJlbmRgfT5cbiAgICAgICAgICAgIDxMaW5lQ2hhcnQgYXBpPXthcGl9IHBvaW50cz17cG9pbnRzLm1hcCgocHQpID0+ICh7IGxhYmVsOiBwdC5sYWJlbCwgdmFsdWU6IHB0LnJhdyA/PyBudWxsIH0pKX0gZm9ybWF0PXtheGlzRm10KHQua2V5KX0gLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgIDwvPlxuICApO1xufVxuXG5mdW5jdGlvbiBIaXN0b3J5SGludCh7IGFwaSwgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGlmIChkYXlzLmxlbmd0aCA+PSAyKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBhcGkudGhlbWUucGFsZXR0ZS50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5UcmVuZHMgZmlsbCBpbiBhcyBkYWlseSBoaXN0b3J5IGFjY3VtdWxhdGVzICh7ZGF5cy5sZW5ndGh9IGRheSBzbyBmYXIpLjwvc3Bhbj47XG59XG5cbmZ1bmN0aW9uIGNvc3RSb3dzKGFwaTogUGx1Z2luQXBpLCBjb3N0OiBKc29uKTogQmFyUm93W10ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiBPYmplY3QuZW50cmllcyhjb3N0Py5ieVRhZyA/PyB7fSlcbiAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpXG4gICAgLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gKGIgYXMgbnVtYmVyKSAtIChhIGFzIG51bWJlcikpXG4gICAgLm1hcCgoW2ssIHZdKSA9PiAoe1xuICAgICAgbGFiZWw6IGssXG4gICAgICBzZWdtZW50czogW3sgbmFtZTogXCJDb3N0XCIsIHZhbHVlOiB2IGFzIG51bWJlciwgY29sb3I6IHAuYWNjZW50IH1dLFxuICAgICAgdmFsdWVUZXh0OiBtb25leS5mb3JtYXQodiBhcyBudW1iZXIpLFxuICAgICAgdGlwOiBbYCR7bW9uZXkuZm9ybWF0KHYgYXMgbnVtYmVyKX0gKCR7Y29zdC50b3RhbCA/ICgoKHYgYXMgbnVtYmVyKSAvIGNvc3QudG90YWwpICogMTAwKS50b0ZpeGVkKDEpIDogXCIwXCJ9JSBvZiB0b3RhbClgXSxcbiAgICB9KSk7XG59XG5cbmNvbnN0IE9WRVJWSUVXX1RSRU5EUzogVHJlbmRbXSA9IFtcbiAgeyB0aXRsZTogXCJBV1MgQ29zdCAoMzBkKVwiLCBrZXk6IFwiY29zdFwiLCBnZXQ6IChkKSA9PiBtZXRyaWMoZCwgXCJhd3NDb3N0LnRvdGFsXCIpIH0sXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMucmVxdWVzdHNcIikgfSxcbiAgeyB0aXRsZTogXCJMYW1iZGEgRXJyb3JzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSB9LFxuICB7IHRpdGxlOiBcIjV4eCBFcnJvcnMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMuZXJyb3JzNXh4XCIpIH0sXG4gIHsgdGl0bGU6IFwiQWxhcm1zIEZpcmluZ1wiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJoZWFsdGguYWxhcm1zLmluQWxhcm1cIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcImN1c3RvbWVycy5wYXlpbmdcIikgfSxcbl07XG5cbmZ1bmN0aW9uIE92ZXJ2aWV3KHsgYXBpLCBkb2MsIGRheXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgZG9jOiBKc29uOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGNvbnN0IHsgU3RhdHVzRG90IH0gPSBhcGkudWk7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkb2MpO1xuICBjb25zdCBjb3N0ID0gZG9jLmF3c0Nvc3Q7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIiwgZ2FwOiAxMiB9fT5cbiAgICAgIDxUaWxlUm93PntPVkVSVklFV19UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChkb2MpICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgZGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17ZGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2RheXN9IHRyZW5kcz17T1ZFUlZJRVdfVFJFTkRTLnNsaWNlKDAsIDMpfSAvPlxuICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJBcHBzXCI+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJhdXRvIDFmciBtYXgtY29udGVudCBtYXgtY29udGVudCBtYXgtY29udGVudFwiLCBnYXA6IFwiNHB4IDE2cHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiB9fT5cbiAgICAgICAgICAgIHtbXCJcIiwgXCJBcHBcIiwgXCJSZXF1ZXN0c1wiLCBcIkVycm9yc1wiLCBcIlByb2ZpdCAoMzBkKVwiXS5tYXAoKGgpID0+IChcbiAgICAgICAgICAgICAgPHNwYW4ga2V5PXtoIHx8IFwiZG90XCJ9IHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgICAgICAgIHtofVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgICAgIHthcHBzLm1hcCgoYSkgPT4gKFxuICAgICAgICAgICAgICA8ZGl2IGtleT17YS5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0+XG4gICAgICAgICAgICAgICAgPFN0YXR1c0RvdCBjb2xvcj17YXBwU3RhdHVzKGEpfSAvPlxuICAgICAgICAgICAgICAgIDxzcGFuPnthLm5hbWV9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uZXkucHJvZml0MzBkXCIpLCBcInByb2ZpdFwiKX08L3NwYW4+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPXtgQVdTIENvc3QgQnkgUHJvamVjdCR7Y29zdCAmJiAhaXNFcnJvck5vZGUoY29zdCkgPyBgICgke3Nob3J0RGF0ZShjb3N0LndpbmRvd1N0YXJ0KX0gVG8gJHtzaG9ydERhdGUoY29zdC53aW5kb3dFbmQpfSlgIDogXCJcIn1gfT5cbiAgICAgICAgICB7IWNvc3QgfHwgaXNFcnJvck5vZGUoY29zdCkgPyA8c3Bhbj57Zm10KGNvc3QpfTwvc3Bhbj4gOiA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17Y29zdFJvd3MoYXBpLCBjb3N0KX0gLz59XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgIDwvRmxvdz5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gbGFtYmRhUm93cyhhcGk6IFBsdWdpbkFwaSwgbGFtYmRhczogSnNvbik6IHsgcm93czogQmFyUm93W107IGlkbGU6IG51bWJlcjsgdW5rbm93bjogc3RyaW5nW10gfSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3Qgcm93czogQmFyUm93W10gPSBbXTtcbiAgY29uc3QgdW5rbm93bjogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGlkbGUgPSAwO1xuICBmb3IgKGNvbnN0IFtmbiwgdl0gb2YgT2JqZWN0LmVudHJpZXMobGFtYmRhcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSkge1xuICAgIGNvbnN0IGludiA9IG1ldHJpYyh2LCBcImludm9jYXRpb25zXCIpO1xuICAgIGlmICh0eXBlb2YgaW52ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB1bmtub3duLnB1c2goZm4pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbnYgPT09IDApIHtcbiAgICAgIGlkbGUrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBlcnIgPSBtZXRyaWModiwgXCJlcnJvcnNcIikgPz8gMDtcbiAgICBjb25zdCB0aHIgPSBtZXRyaWModiwgXCJ0aHJvdHRsZXNcIikgPz8gMDtcbiAgICByb3dzLnB1c2goe1xuICAgICAgbGFiZWw6IGZuLFxuICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgeyBuYW1lOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogTWF0aC5tYXgoMCwgaW52IC0gZXJyKSwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgdmFsdWU6IGVyciwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICBdLFxuICAgICAgdmFsdWVUZXh0OiBlcnIgPyBgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gKCR7KChlcnIgLyBpbnYpICogMTAwKS50b0ZpeGVkKDApfSUgRXJyKWAgOiBpbnYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgIHRpcDogW2Ake2ludi50b0xvY2FsZVN0cmluZygpfSBpbnZvY2F0aW9uc2AsIGAke2Vyci50b0xvY2FsZVN0cmluZygpfSBlcnJvcnNgLCBgJHt0aHIudG9Mb2NhbGVTdHJpbmcoKX0gdGhyb3R0bGVzYF0sXG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzWzBdLnZhbHVlICsgYi5zZWdtZW50c1sxXS52YWx1ZSAtIChhLnNlZ21lbnRzWzBdLnZhbHVlICsgYS5zZWdtZW50c1sxXS52YWx1ZSkpO1xuICByZXR1cm4geyByb3dzLCBpZGxlLCB1bmtub3duIH07XG59XG5cbmZ1bmN0aW9uIGFwaVJvd3MoYXBpOiBQbHVnaW5BcGksIGFwaXM6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChPYmplY3QuZW50cmllcyhhcGlzID8/IHt9KSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgbWV0cmljKHYsIFwicmVxdWVzdHNcIikgPT09IFwibnVtYmVyXCIpXG4gICAgLm1hcCgoW25hbWUsIHZdKSA9PiB7XG4gICAgICBjb25zdCByZXEgPSBtZXRyaWModiwgXCJyZXF1ZXN0c1wiKSBhcyBudW1iZXI7XG4gICAgICBjb25zdCBlNCA9IG1ldHJpYyh2LCBcImVycm9yczR4eFwiKSA/PyAwO1xuICAgICAgY29uc3QgZTUgPSBtZXRyaWModiwgXCJlcnJvcnM1eHhcIikgPz8gMDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGxhYmVsOiBuYW1lLFxuICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgIHsgbmFtZTogXCJPS1wiLCB2YWx1ZTogTWF0aC5tYXgoMCwgcmVxIC0gZTQgLSBlNSksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgIHsgbmFtZTogXCI0eHhcIiwgdmFsdWU6IGU0LCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgIHsgbmFtZTogXCI1eHhcIiwgdmFsdWU6IGU1LCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgXSxcbiAgICAgICAgdmFsdWVUZXh0OiByZXEudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgdGlwOiBbYCR7cmVxLnRvTG9jYWxlU3RyaW5nKCl9IHJlcXVlc3RzYCwgYCR7ZTQudG9Mb2NhbGVTdHJpbmcoKX0gNHh4LCAke2U1LnRvTG9jYWxlU3RyaW5nKCl9IDV4eGAsIGBwOTUgbGF0ZW5jeTogJHtmbXQodi5wOTVMYXRlbmN5TXMsIFwibGF0ZW5jeW1zXCIpfWBdLFxuICAgICAgfTtcbiAgICB9KVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzLnJlZHVjZSgocywgeCkgPT4gcyArIHgudmFsdWUsIDApIC0gYS5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSk7XG59XG5cbmZ1bmN0aW9uIFJvd3MoeyBhcGksIHZhbHVlLCBwYXRoID0gXCJcIiB9OiB7IGFwaTogUGx1Z2luQXBpOyB2YWx1ZTogSnNvbjsgcGF0aD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBpc0Vycm9yTm9kZSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gPHNwYW4+e2ZtdCh2YWx1ZSwgcGF0aCl9PC9zcGFuPjtcbiAgfVxuICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgdl0pID0+ICEodHlwZW9mIHYgPT09IFwic3RyaW5nXCIgJiYgKHYubGVuZ3RoID4gODAgfHwgdi5pbmNsdWRlcyhcIlxcblwiKSkpKTtcbiAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwibWF4LWNvbnRlbnQgMWZyXCIsIGdhcDogXCIycHggMTZweFwiIH19PlxuICAgICAge2VudHJpZXMubWFwKChbaywgdl0pID0+IHtcbiAgICAgICAgY29uc3QgbmVzdGVkID0gdiAhPT0gbnVsbCAmJiB0eXBlb2YgdiA9PT0gXCJvYmplY3RcIiAmJiAhaXNFcnJvck5vZGUodik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPGRpdiBrZXk9e2t9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fT5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57dGl0bGVDYXNlKGspfTwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuPntuZXN0ZWQgPyBBcnJheS5pc0FycmF5KHYpID8gPHNwYW4+e3YubGVuZ3RoID8gdi5qb2luKFwiLCBcIikgOiBcIk5vbmVcIn08L3NwYW4+IDogPFJvd3MgYXBpPXthcGl9IHZhbHVlPXt2fSBwYXRoPXtrfSAvPiA6IGZtdCh2LCBrKX08L3NwYW4+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICk7XG4gICAgICB9KX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgdGl0bGVDYXNlID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC8oW0EtWl0pL2csIFwiICQxXCIpLnJlcGxhY2UoL14uLywgKGMpID0+IGMudG9VcHBlckNhc2UoKSk7XG5cbmNvbnN0IEFQUF9UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuICB7IHRpdGxlOiBcIk1SUlwiLCBrZXk6IFwibXJyXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5Lm1yclwiKSB9LFxuICB7IHRpdGxlOiBcIlByb2ZpdCAoMzBkKVwiLCBrZXk6IFwicHJvZml0XCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSB9LFxuXTtcblxuZnVuY3Rpb24gQXBwVmlldyh7IGFwaSwgYXBwLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGFwcDogSnNvbjsgZGF5czogRGF5W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBkb2M6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHAubmFtZSkgfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpO1xuICBjb25zdCBtb24gPSBhcHAubW9uaXRvcmluZztcbiAgY29uc3QgYXVkID0gYXBwLmF1ZGllbmNlO1xuICBjb25zdCBhdWREYXlzOiBKc29uW10gPSBhdWQgJiYgQXJyYXkuaXNBcnJheShhdWQuZGF5cykgPyBhdWQuZGF5cyA6IFtdO1xuICBjb25zdCBhdWRLZXlzID0gYXVkRGF5cy5sZW5ndGggPyBPYmplY3Qua2V5cyhhdWREYXlzWzBdKS5maWx0ZXIoKGspID0+IGsgIT09IFwiZGF0ZVwiICYmIHR5cGVvZiBhdWREYXlzWzBdW2tdID09PSBcIm51bWJlclwiKSA6IFtdO1xuICBjb25zdCBsYW1iZGFzID0gbW9uICYmICFpc0Vycm9yTm9kZShtb24pICYmICFpc0Vycm9yTm9kZShtb24ubGFtYmRhcykgPyBsYW1iZGFSb3dzKGFwaSwgbW9uLmxhbWJkYXMpIDogbnVsbDtcbiAgY29uc3QgYXBpcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmFwaXMpID8gYXBpUm93cyhhcGksIG1vbi5hcGlzKSA6IG51bGw7XG4gIGNvbnN0IGRldGFpbHMgPSBPYmplY3QuZW50cmllcyhhcHApLmZpbHRlcigoW2tdKSA9PiBrICE9PSBcIm5hbWVcIiAmJiBrICE9PSBcIm1vbml0b3JpbmdcIik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVSb3c+e0FQUF9UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChhcHApICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgYXBwRGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17YXBwRGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2FwcERheXN9IHRyZW5kcz17QVBQX1RSRU5EU30gLz5cbiAgICAgICAge21vbiAmJiBpc0Vycm9yTm9kZShtb24pICYmIChcbiAgICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJNb25pdG9yaW5nICgyNGgpXCI+XG4gICAgICAgICAgICA8c3Bhbj57Zm10KG1vbil9PC9zcGFuPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2FwaXMgJiYgYXBpcy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT1cIkFQSSBSZXF1ZXN0cyAoMjRoKVwiXG4gICAgICAgICAgICBleHRyYT17XG4gICAgICAgICAgICAgIDxMZWdlbmRcbiAgICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgICBpdGVtcz17W1xuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIk9LXCIsIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIjR4eFwiLCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIjV4eFwiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgICAgICAgICBdfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXthcGlzfSAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2xhbWJkYXMgJiYgbGFtYmRhcy5yb3dzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uXG4gICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgIHRpdGxlPVwiTGFtYmRhIEludm9jYXRpb25zICgyNGgpXCJcbiAgICAgICAgICAgIGV4dHJhPXtcbiAgICAgICAgICAgICAgPExlZ2VuZFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIGl0ZW1zPXtbXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiU3VjY2VlZGVkXCIsIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIkVycm9yc1wiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgICAgICAgICBdfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXtsYW1iZGFzLnJvd3N9IC8+XG4gICAgICAgICAgICB7KGxhbWJkYXMuaWRsZSA+IDAgfHwgbGFtYmRhcy51bmtub3duLmxlbmd0aCA+IDApICYmIChcbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAgICAgICAge1tsYW1iZGFzLmlkbGUgPyBgJHtsYW1iZGFzLmlkbGV9IGlkbGUgZnVuY3Rpb24ke2xhbWJkYXMuaWRsZSA+IDEgPyBcInNcIiA6IFwiXCJ9IGhpZGRlbmAgOiBcIlwiLCBsYW1iZGFzLnVua25vd24ubGVuZ3RoID8gYFVua25vd246ICR7bGFtYmRhcy51bmtub3duLmpvaW4oXCIsIFwiKX1gIDogXCJcIl1cbiAgICAgICAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgICAgICAgICAgICAgIC5qb2luKFwiLiBcIil9XG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7YXVkS2V5cy5tYXAoKGspID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e2t9IGFwaT17YXBpfSB0aXRsZT17YERhaWx5ICR7dGl0bGVDYXNlKGspfWB9PlxuICAgICAgICAgICAgPExpbmVDaGFydCBhcGk9e2FwaX0gcG9pbnRzPXthdWREYXlzLm1hcCgoZCkgPT4gKHsgbGFiZWw6IHNob3J0RGF0ZShTdHJpbmcoZC5kYXRlKSksIHZhbHVlOiB0eXBlb2YgZFtrXSA9PT0gXCJudW1iZXJcIiA/IGRba10gOiBudWxsIH0pKX0gZm9ybWF0PXtheGlzRm10KGspfSAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgICAgIHthdWQ/LnNvdXJjZXMzMGQgJiYgIWlzRXJyb3JOb2RlKGF1ZC5zb3VyY2VzMzBkKSAmJiAoXG4gICAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiVHJhZmZpYyBTb3VyY2VzICgzMGQpXCI+XG4gICAgICAgICAgICA8QmFyTGlzdFxuICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgcm93cz17KE9iamVjdC5lbnRyaWVzKGF1ZC5zb3VyY2VzMzBkKSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAgICAgICAgICAgICAuc29ydCgoWywgYV0sIFssIGJdKSA9PiBiIC0gYSlcbiAgICAgICAgICAgICAgICAubWFwKChbaywgdl0pID0+ICh7XG4gICAgICAgICAgICAgICAgICBsYWJlbDogdGl0bGVDYXNlKGspLFxuICAgICAgICAgICAgICAgICAgc2VnbWVudHM6IFt7IG5hbWU6IFwiVmlld3NcIiwgdmFsdWU6IHYsIGNvbG9yOiBwLmFjY2VudCB9XSxcbiAgICAgICAgICAgICAgICAgIHZhbHVlVGV4dDogdi50b0xvY2FsZVN0cmluZygpLFxuICAgICAgICAgICAgICAgICAgdGlwOiBbYCR7di50b0xvY2FsZVN0cmluZygpfSB2aWV3c2BdLFxuICAgICAgICAgICAgICAgIH0pKX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7ZGV0YWlscy5tYXAoKFtrLCB2XSkgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17a30gYXBpPXthcGl9IHRpdGxlPXt0aXRsZUNhc2Uoayl9PlxuICAgICAgICAgICAgPFJvd3NcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHZhbHVlPXtrID09PSBcImF1ZGllbmNlXCIgJiYgdiAmJiAhaXNFcnJvck5vZGUodikgPyBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModikuZmlsdGVyKChba2tdKSA9PiBrayAhPT0gXCJkYXlzXCIgJiYga2sgIT09IFwic291cmNlczMwZFwiKSkgOiB2fVxuICAgICAgICAgICAgICBwYXRoPXtrfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgPC9GbG93PlxuICAgIDwvZGl2PlxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gQ29tcG9uZW50KHsgYXBpIH06IHsgYXBpOiBQbHVnaW5BcGk7IHBhbmVJZD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHsgVGV4dEJ1dHRvbiwgVGFicywgQmFubmVyLCBTcGlubmVyIH0gPSBhcGkudWk7XG4gIGNvbnN0IHBhbGV0dGUgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgWywgZm9yY2VdID0gdXNlU3RhdGUoMCk7XG4gIGNvbnN0IFt0YWIsIHNldFRhYl0gPSB1c2VTdGF0ZShcIm92ZXJ2aWV3XCIpO1xuICBjb25zdCBbLCBzZXRUaGVtZV0gPSB1c2VTdGF0ZSgwKTtcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGwgPSAoKSA9PiBmb3JjZSgobikgPT4gbiArIDEpO1xuICAgIGxpc3RlbmVycy5hZGQobCk7XG4gICAgY29uc3QgdW5zdWIgPSBhcGkudGhlbWUuc3Vic2NyaWJlKCgpID0+IHNldFRoZW1lKChuKSA9PiBuICsgMSkpO1xuICAgIGlmICghc3RhdGUuZGF0YSkge1xuICAgICAgdm9pZCBhcGkuc3RvcmFnZS5nZXQ8SnNvbj4oQ0FDSEVfS0VZKS50aGVuKChjYWNoZWQpID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhc3RhdGUuZGF0YSkgc2V0U3RhdGUoeyBkYXRhOiBjYWNoZWQgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGxpc3RlbmVycy5kZWxldGUobCk7XG4gICAgICB1bnN1YigpO1xuICAgIH07XG4gIH0sIFthcGldKTtcblxuICBjb25zdCB7IGRhdGEsIGVycm9yLCBsb2FkaW5nIH0gPSBzdGF0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkYXRhKTtcbiAgY29uc3QgZGF5cyA9IGFsbERheXMoKTtcbiAgY29uc3QgYWdlID0gZGF0YSA/IGFnZUhvdXJzKGRhdGEuZ2VuZXJhdGVkQXQpIDogbnVsbDtcbiAgY29uc3Qgc3RhbGUgPSBkYXRhICYmIChhZ2UgPT09IG51bGwgfHwgYWdlID4gU1RBTEVfSE9VUlMpO1xuICBjb25zdCBjdXJyZW50ID0gdGFiID09PSBcIm92ZXJ2aWV3XCIgPyBudWxsIDogYXBwcy5maW5kKChhKSA9PiBhLm5hbWUgPT09IHRhYik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGZsZXg6IDEsIG1pbkhlaWdodDogMCwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMTIsIGNvbG9yOiBwYWxldHRlLnRleHQgfX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBwYWRkaW5nUmlnaHQ6IDI0IH19PlxuICAgICAgICA8aDIgc3R5bGU9e3sgbWFyZ2luOiAwIH19PntOQU1FfTwvaDI+XG4gICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwYWxldHRlLnRleHRNdXRlZCwgZmxleDogMSB9fT5cbiAgICAgICAgICB7ZGF0YVxuICAgICAgICAgICAgPyBgR2VuZXJhdGVkICR7ZGF0YS5nZW5lcmF0ZWRBdCA/IG5ldyBEYXRlKGRhdGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCkgOiBcIlVua25vd25cIn0gXHUwMEI3ICR7ZGF5cy5sZW5ndGh9IERheSR7ZGF5cy5sZW5ndGggPT09IDEgPyBcIlwiIDogXCJzXCJ9IE9mIEhpc3RvcnlgXG4gICAgICAgICAgICA6IFwiTm8gRGF0YSBZZXRcIn1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgICB7bG9hZGluZyAmJiA8U3Bpbm5lciBzaXplPXsxNn0gLz59XG4gICAgICAgIDxUZXh0QnV0dG9uIGxhYmVsPVwiUmVmcmVzaFwiIHZhcmlhbnQ9XCJwcmltYXJ5XCIgZGlzYWJsZWQ9e2xvYWRpbmd9IG9uQ2xpY2s9eygpID0+IHZvaWQgcmVmcmVzaChhcGkpfSAvPlxuICAgICAgPC9kaXY+XG4gICAgICB7ZXJyb3IgJiYgPEJhbm5lciBtZXNzYWdlPXtgQ291bGQgTm90IExvYWQgTWV0cmljczogJHtlcnJvcn1gfSB0b25lPVwiZXJyb3JcIiAvPn1cbiAgICAgIHtzdGFsZSAmJiA8QmFubmVyIG1lc3NhZ2U9e2BNZXRyaWNzIEFyZSBPbGRlciBUaGFuICR7U1RBTEVfSE9VUlN9IEhvdXJzOyBUaGUgRGFpbHkgQ29sbGVjdG9yIE1heSBIYXZlIEZhaWxlZGB9IHRvbmU9XCJ3YXJuaW5nXCIgLz59XG4gICAgICB7ZGF0YSAmJiAoXG4gICAgICAgIDw+XG4gICAgICAgICAgPFRhYnNcbiAgICAgICAgICAgIHRhYnM9e1t7IGxhYmVsOiBcIk92ZXJ2aWV3XCIsIHZhbHVlOiBcIm92ZXJ2aWV3XCIgfSwgLi4uYXBwcy5tYXAoKGEpID0+ICh7IGxhYmVsOiBhLm5hbWUgYXMgc3RyaW5nLCB2YWx1ZTogYS5uYW1lIGFzIHN0cmluZyB9KSldfVxuICAgICAgICAgICAgdmFsdWU9e2N1cnJlbnQgPyB0YWIgOiBcIm92ZXJ2aWV3XCJ9XG4gICAgICAgICAgICBvbkNoYW5nZT17c2V0VGFifVxuICAgICAgICAgIC8+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyAuLi5zY3JvbGxiYXJTdHlsZShwYWxldHRlKSwgZmxleDogMSwgbWluSGVpZ2h0OiAwLCBvdmVyZmxvdzogXCJhdXRvXCIsIHBhZGRpbmdSaWdodDogR0FQIH19PlxuICAgICAgICAgICAge2N1cnJlbnQgPyA8QXBwVmlldyBhcGk9e2FwaX0gYXBwPXtjdXJyZW50fSBkYXlzPXtkYXlzfSAvPiA6IDxPdmVydmlldyBhcGk9e2FwaX0gZG9jPXtkYXRhfSBkYXlzPXtkYXlzfSAvPn1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC8+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUNBLFNBQVMsV0FBVyxRQUFRLGdC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

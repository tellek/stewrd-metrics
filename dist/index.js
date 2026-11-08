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
      /* @__PURE__ */ jsx("div", { style: { ...scrollbarStyle(palette), flex: 1, minHeight: 0, overflow: "auto" }, children: current ? /* @__PURE__ */ jsx(AppView, { api, app: current, days }) : /* @__PURE__ */ jsx(Overview, { api, doc: data, days }) })
    ] })
  ] });
}
export {
  Component,
  activate
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIGxvYWRpbmc6IGJvb2xlYW47XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UgfTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIHN0YXRlID0geyAuLi5zdGF0ZSwgLi4ucGF0Y2ggfTtcbiAgbGlzdGVuZXJzLmZvckVhY2goKGwpID0+IGwoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tXG5cbmNvbnN0IGlzRXJyb3JOb2RlID0gKHY6IEpzb24pOiBib29sZWFuID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHYuZXJyb3IgPT09IFwic3RyaW5nXCI7XG5cbmZ1bmN0aW9uIGhhc0Vycm9yTm9kZSh2OiBKc29uKTogYm9vbGVhbiB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIHRydWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIGlmICh2ICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiKSByZXR1cm4gT2JqZWN0LnZhbHVlcyh2KS5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgbW9uZXkgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IHN0eWxlOiBcImN1cnJlbmN5XCIsIGN1cnJlbmN5OiBcIlVTRFwiIH0pO1xuY29uc3QgY29tcGFjdCA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgbm90YXRpb246IFwiY29tcGFjdFwiLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG5jb25zdCBNT05FWV9LRVkgPSAvKG1ycnxwcm9maXR8Y29zdHxhbW91bnR8cmV2ZW51ZSkvaTtcblxuLyoqIFNpbmdsZSBmb3JtYXR0ZXI6IG51bGwvdW5kZWZpbmVkL2Vycm9yIG5vZGVzIGFyZSBcIlVua25vd25cIiwgbmV2ZXIgemVyby4gKi9cbmZ1bmN0aW9uIGZtdCh2OiBKc29uLCBrZXkgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gXCJVbmtub3duXCI7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIGBVbmtub3duICgke3YuZXJyb3J9KWA7XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChNT05FWV9LRVkudGVzdChrZXkpKSByZXR1cm4gbW9uZXkuZm9ybWF0KHYpO1xuICAgIGlmICgvbGF0ZW5jeW1zL2kudGVzdChrZXkpKSByZXR1cm4gYCR7TWF0aC5yb3VuZCh2KX0gbXNgO1xuICAgIHJldHVybiB2LnRvTG9jYWxlU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHR5cGVvZiB2ID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xuICByZXR1cm4gU3RyaW5nKHYpO1xufVxuXG4vKiogVGFibGUgY2VsbDogXCItXCIgd2hlbiB0aGUgYXBwIGhhcyBubyBzdWNoIG1ldHJpYywgb3RoZXJ3aXNlIGZtdCAoc28gdW5rbm93biBzdGF5cyBcIlVua25vd25cIikuICovXG5jb25zdCBjZWxsID0gKHY6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIGtleSA9IFwiXCIpID0+ICh2ID09PSB1bmRlZmluZWQgPyBcIi1cIiA6IGZtdCh2LCBrZXkpKTtcblxuY29uc3QgYXhpc0ZtdCA9IChrZXk6IHN0cmluZykgPT4gKG46IG51bWJlcikgPT4gKE1PTkVZX0tFWS50ZXN0KGtleSkgPyBtb25leS5mb3JtYXQobikgOiBjb21wYWN0LmZvcm1hdChuKSk7XG5cbmZ1bmN0aW9uIGFnZUhvdXJzKGlzbzogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgbnVsbCB7XG4gIGNvbnN0IHQgPSBpc28gPyBEYXRlLnBhcnNlKGlzbykgOiBOYU47XG4gIHJldHVybiBOdW1iZXIuaXNOYU4odCkgPyBudWxsIDogKERhdGUubm93KCkgLSB0KSAvIDNfNjAwXzAwMDtcbn1cblxuY29uc3Qgc2hvcnREYXRlID0gKGQ6IHN0cmluZykgPT4gbmV3IERhdGUoYCR7ZH1UMDA6MDA6MDBaYCkudG9Mb2NhbGVEYXRlU3RyaW5nKHVuZGVmaW5lZCwgeyBtb250aDogXCJzaG9ydFwiLCBkYXk6IFwibnVtZXJpY1wiLCB0aW1lWm9uZTogXCJVVENcIiB9KTtcblxuY29uc3QgYXBwc09mID0gKGRvYzogSnNvbik6IEpzb25bXSA9PiAoZG9jICYmIEFycmF5LmlzQXJyYXkoZG9jLmFwcHMpID8gZG9jLmFwcHMgOiBbXSk7XG5cbi8qKiBXYWxrcyBhIGRvdHRlZCBwYXRoLiB1bmRlZmluZWQgPSBub3QgcHJlc2VudCwgbnVsbCA9IHVua25vd24gKGVycm9yIG5vZGUgb3IgbnVsbCksIG51bWJlciA9IHZhbHVlLiAqL1xuZnVuY3Rpb24gbWV0cmljKG86IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBsZXQgdiA9IG87XG4gIGZvciAoY29uc3QgayBvZiBwYXRoLnNwbGl0KFwiLlwiKSkge1xuICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHYgPT09IG51bGwgfHwgaXNFcnJvck5vZGUodikpIHJldHVybiBudWxsO1xuICAgIHYgPSB2W2tdO1xuICB9XG4gIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodikgPyB2IDogbnVsbDtcbn1cblxuLyoqIFN1bXMgYSBtZXRyaWMgYWNyb3NzIGFwcHM7IGFueSB1bmtub3duIGFwcCB2YWx1ZSBtYWtlcyB0aGUgdG90YWwgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIHN1bUFwcHMoZG9jOiBKc29uLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFkb2MgfHwgaXNFcnJvck5vZGUoZG9jLmFwcHMpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IGFwcHNPZihkb2MpXG4gICAgLm1hcCgoYSkgPT4gbWV0cmljKGEsIHBhdGgpKVxuICAgIC5maWx0ZXIoKHYpID0+IHYgIT09IHVuZGVmaW5lZCk7XG4gIGlmICh2YWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdiA9PT0gbnVsbCkgPyBudWxsIDogKHZhbHMgYXMgbnVtYmVyW10pLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xufVxuXG5mdW5jdGlvbiBhcHBTdGF0dXMoYXBwOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBpZiAoaGFzRXJyb3JOb2RlKGFwcCkpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKChhcHAuaGVhbHRoPy5hbGFybXM/LmluQWxhcm0gPz8gMCkgPiAwKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICgoYXBwLmhlYWx0aD8uZnJlc2huZXNzPy5zdGFsZVN0YXRlcyA/PyAwKSA+IDApIHJldHVybiBcIndhcm5pbmdcIjtcbiAgcmV0dXJuIFwic3VjY2Vzc1wiO1xufVxuXG5jb25zdCBXT1JTVDogU3RhdHVzQ29sb3JbXSA9IFtcImlkbGVcIiwgXCJzdWNjZXNzXCIsIFwid2FybmluZ1wiLCBcImVycm9yXCJdO1xuY29uc3Qgd29yc3QgPSAoY3M6IFN0YXR1c0NvbG9yW10pOiBTdGF0dXNDb2xvciA9PiBjcy5yZWR1Y2UoKGEsIGIpID0+IChXT1JTVC5pbmRleE9mKGIpID4gV09SU1QuaW5kZXhPZihhKSA/IGIgOiBhKSwgXCJzdWNjZXNzXCIgYXMgU3RhdHVzQ29sb3IpO1xuXG5mdW5jdGlvbiBkb2NTdGF0dXMoZG9jOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBjb25zdCBhZ2UgPSBhZ2VIb3Vycyhkb2MuZ2VuZXJhdGVkQXQpO1xuICBjb25zdCBzdGFsZSA9IGFnZSA9PT0gbnVsbCB8fCBhZ2UgPiBTVEFMRV9IT1VSUztcbiAgY29uc3Qgc3RhdHVzID0gd29yc3QoYXBwc09mKGRvYykubWFwKGFwcFN0YXR1cykpO1xuICByZXR1cm4gc3RhbGUgfHwgaGFzRXJyb3JOb2RlKGRvYykgPyB3b3JzdChbc3RhdHVzLCBcIndhcm5pbmdcIl0pIDogc3RhdHVzO1xufVxuXG4vKiogSGlzdG9yeSBwbHVzIHRoZSBsYXRlc3QgZG9jdW1lbnQsIG9uZSBlbnRyeSBwZXIgVVRDIGRhdGUsIG9sZGVzdCBmaXJzdC4gKi9cbmZ1bmN0aW9uIGFsbERheXMoKTogRGF5W10ge1xuICBjb25zdCBtID0gbmV3IE1hcChzdGF0ZS5oaXN0b3J5Lm1hcCgoZCkgPT4gW2QuZGF0ZSwgZC5kb2NdKSk7XG4gIGlmICh0eXBlb2Ygc3RhdGUuZGF0YT8uZ2VuZXJhdGVkQXQgPT09IFwic3RyaW5nXCIpIG0uc2V0KHN0YXRlLmRhdGEuZ2VuZXJhdGVkQXQuc2xpY2UoMCwgMTApLCBzdGF0ZS5kYXRhKTtcbiAgcmV0dXJuIFsuLi5tLmVudHJpZXMoKV0uc29ydCgoW2FdLCBbYl0pID0+IChhIDwgYiA/IC0xIDogMSkpLm1hcCgoW2RhdGUsIGRvY10pID0+ICh7IGRhdGUsIGRvYyB9KSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gZmV0Y2hpbmcgLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBhd3NBcmdzKGFwaTogUGx1Z2luQXBpLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgcyA9IGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCk7XG4gIGNvbnN0IG91dCA9IFsuLi5hcmdzLCBcIi0tY2xpLWNvbm5lY3QtdGltZW91dFwiLCBcIjEwXCIsIFwiLS1jbGktcmVhZC10aW1lb3V0XCIsIFwiMTVcIl07XG4gIGlmIChzLmF3c1Byb2ZpbGUpIG91dC5wdXNoKFwiLS1wcm9maWxlXCIsIHMuYXdzUHJvZmlsZSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGF3cyhhcGk6IFBsdWdpbkFwaSwgYXJnczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXMgPSBhd2FpdCBhcGkuc2hlbGwuZXhlYyhcImF3c1wiLCBhd2FpdCBhd3NBcmdzKGFwaSwgYXJncykpO1xuICBpZiAocmVzLmNvZGUgIT09IDApIHRocm93IG5ldyBFcnJvcihyZXMuc3RkZXJyLnRyaW0oKSB8fCBgYXdzIGV4aXRlZCB3aXRoIGNvZGUgJHtyZXMuY29kZX1gKTtcbiAgcmV0dXJuIHJlcy5zdGRvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRIaXN0b3J5KGFwaTogUGx1Z2luQXBpKSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhcGkuZnMubGlzdERpcihISVNUT1JZX0RJUik7XG4gIGNvbnN0IGZpbGVzID0gZW50cmllc1xuICAgIC5maWx0ZXIoKGUpID0+ICFlLmlzRGlyICYmIC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1cXC5qc29uJC8udGVzdChlLm5hbWUpKVxuICAgIC5tYXAoKGUpID0+IGUubmFtZSlcbiAgICAuc29ydCgpXG4gICAgLnNsaWNlKC1NQVhfREFZUyk7XG4gIGNvbnN0IGRvY3MgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBmaWxlcy5tYXAoYXN5bmMgKGYpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IGFwaS5mcy5yZWFkVGV4dEZpbGUoYCR7SElTVE9SWV9ESVJ9LyR7Zn1gKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSksXG4gICk7XG4gIHNldFN0YXRlKHsgaGlzdG9yeTogZmlsZXMubWFwKChmLCBpKSA9PiAoeyBkYXRlOiBmLnNsaWNlKDAsIDEwKSwgZG9jOiBkb2NzW2ldIH0pKS5maWx0ZXIoKGQpID0+IGQuZG9jKSB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY0hpc3RvcnkoYXBpOiBQbHVnaW5BcGksIGJ1Y2tldDogc3RyaW5nKSB7XG4gIGNvbnN0IHJvb3QgPSAoYXdhaXQgYXBpLmZzLmdldFJvb3RQYXRoKCkpLnJlcGxhY2UoL1tcXFxcL10rJC8sIFwiXCIpO1xuICBhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcInN5bmNcIiwgYHMzOi8vJHtidWNrZXR9LyR7SElTVE9SWV9ESVJ9L2AsIGAke3Jvb3R9LyR7SElTVE9SWV9ESVJ9YCwgXCItLW9ubHktc2hvdy1lcnJvcnNcIl0pO1xuICBhd2FpdCBsb2FkSGlzdG9yeShhcGkpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoKGFwaTogUGx1Z2luQXBpLCBzaWduYWw/OiBBYm9ydFNpZ25hbCkge1xuICBpZiAoc3RhdGUubG9hZGluZykgcmV0dXJuO1xuICBzZXRTdGF0ZSh7IGxvYWRpbmc6IHRydWUgfSk7XG4gIGNvbnN0IHNldEljb24gPSAoYzogU3RhdHVzQ29sb3IsIHRpcD86IHN0cmluZykgPT4ge1xuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXBpLnN0YXR1c0ljb24uc2V0KGMsIHRpcCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBkZWFjdGl2YXRlZCAqL1xuICAgIH1cbiAgfTtcbiAgY29uc3QgbG9nID0gKGxldmVsOiBcIndhcm5cIiB8IFwiZXJyb3JcIiwgbXNnOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoc2lnbmFsPy5hYm9ydGVkKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGFwaS5sb2dbbGV2ZWxdKGAke05BTUV9OiAke21zZ31gKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGRlYWN0aXZhdGVkICovXG4gICAgfVxuICB9O1xuICBzZXRJY29uKFwiaW4tcHJvZ3Jlc3NcIiwgXCJSZWZyZXNoaW5nXCIpO1xuICB0cnkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IChhd2FpdCBhcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpKS5idWNrZXQgfHwgREVGQVVMVF9CVUNLRVQ7XG4gICAgY29uc3QgZGF0YSA9IEpTT04ucGFyc2UoYXdhaXQgYXdzKGFwaSwgW1wiczNcIiwgXCJjcFwiLCBgczM6Ly8ke2J1Y2tldH0vbWV0cmljcy5qc29uYCwgXCItXCJdKSk7XG4gICAgYXdhaXQgYXBpLnN0b3JhZ2Uuc2V0KENBQ0hFX0tFWSwgZGF0YSk7XG4gICAgc2V0U3RhdGUoeyBkYXRhLCBlcnJvcjogbnVsbCB9KTtcbiAgICBsZXQgc3RhdHVzID0gZG9jU3RhdHVzKGRhdGEpO1xuICAgIGxldCB0aXAgPSBzdGF0dXMgPT09IFwic3VjY2Vzc1wiID8gXCJNZXRyaWNzIHVwIHRvIGRhdGVcIiA6IFwiTWV0cmljcyBuZWVkIGF0dGVudGlvblwiO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzeW5jSGlzdG9yeShhcGksIGJ1Y2tldCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc3QgbXNnID0gZSBpbnN0YW5jZW9mIEVycm9yID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpO1xuICAgICAgbG9nKFwid2FyblwiLCBgaGlzdG9yeSBzeW5jIGZhaWxlZDogJHttc2d9YCk7XG4gICAgICBzdGF0dXMgPSB3b3JzdChbc3RhdHVzLCBcIndhcm5pbmdcIl0pO1xuICAgICAgdGlwID0gYEhpc3Rvcnkgc3luYyBmYWlsZWQ6ICR7bXNnfWA7XG4gICAgfVxuICAgIHNldFN0YXRlKHsgbG9hZGluZzogZmFsc2UgfSk7XG4gICAgc2V0SWNvbihzdGF0dXMsIHRpcCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCBtc2cgPSBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSk7XG4gICAgc2V0U3RhdGUoeyBlcnJvcjogbXNnLCBsb2FkaW5nOiBmYWxzZSB9KTtcbiAgICBzZXRJY29uKFwiZXJyb3JcIiwgbXNnKTtcbiAgICBsb2coXCJlcnJvclwiLCBtc2cpO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhY3RpdmF0ZShjdHg6IFBsdWdpbkNvbnRleHQpIHtcbiAgY3R4LmFwaS5zdGF0dXNJY29uLnNldChcImlkbGVcIik7XG4gIGNvbnN0IHMgPSBhd2FpdCBjdHguYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKTtcbiAgY29uc3QgbWludXRlcyA9IE1hdGgubWF4KDEsIHMucmVmcmVzaE1pbnV0ZXMgPz8gNjApO1xuICBjdHgudGljay5yZWdpc3RlcigoKSA9PiByZWZyZXNoKGN0eC5hcGksIGN0eC5zaWduYWwpKTtcbiAgY3R4LnRpY2suc2V0SW50ZXJ2YWwobWludXRlcyAqIDYwXzAwMCk7XG4gIGN0eC5hcGkubG9nLmluZm8oYCR7TkFNRX0gYWN0aXZhdGVkYCk7XG4gIHZvaWQgbG9hZEhpc3RvcnkoY3R4LmFwaSkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgdm9pZCByZWZyZXNoKGN0eC5hcGksIGN0eC5zaWduYWwpO1xufVxuXG4vLyAtLS0tLS0tLS0tIGNoYXJ0IHByaW1pdGl2ZXMgLS0tLS0tLS0tLVxuXG5jb25zdCBDSEFSVF9IRUlHSFQgPSAxNzA7XG5cbmNvbnN0IHNjcm9sbGJhclN0eWxlID0gKHA6IFBhbGV0dGUpOiBDU1NQcm9wZXJ0aWVzID0+ICh7IHNjcm9sbGJhcldpZHRoOiBcInRoaW5cIiwgc2Nyb2xsYmFyQ29sb3I6IGAke3AuYm9yZGVyfSAke3Auc3VyZmFjZX1gIH0pO1xuXG5mdW5jdGlvbiB1c2VXaWR0aCgpIHtcbiAgY29uc3QgcmVmID0gdXNlUmVmPEhUTUxEaXZFbGVtZW50PihudWxsKTtcbiAgY29uc3QgW3dpZHRoLCBzZXRXaWR0aF0gPSB1c2VTdGF0ZSgwKTtcbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBlbCA9IHJlZi5jdXJyZW50O1xuICAgIGlmICghZWwpIHJldHVybjtcbiAgICBjb25zdCBybyA9IG5ldyBSZXNpemVPYnNlcnZlcigoW2VdKSA9PiBzZXRXaWR0aChlLmNvbnRlbnRSZWN0LndpZHRoKSk7XG4gICAgcm8ub2JzZXJ2ZShlbCk7XG4gICAgcmV0dXJuICgpID0+IHJvLmRpc2Nvbm5lY3QoKTtcbiAgfSwgW10pO1xuICByZXR1cm4gW3JlZiwgd2lkdGhdIGFzIGNvbnN0O1xufVxuXG5mdW5jdGlvbiBuaWNlTWF4KHY6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICh2IDw9IDApIHJldHVybiAxO1xuICBjb25zdCBwID0gMTAgKiogTWF0aC5mbG9vcihNYXRoLmxvZzEwKHYpKTtcbiAgY29uc3QgbiA9IHYgLyBwO1xuICByZXR1cm4gKG4gPD0gMSA/IDEgOiBuIDw9IDIgPyAyIDogbiA8PSA1ID8gNSA6IDEwKSAqIHA7XG59XG5cbmZ1bmN0aW9uIFRvb2x0aXAoeyBwLCB4LCB5LCBmbGlwLCBmaXhlZCwgY2hpbGRyZW4gfTogeyBwOiBQYWxldHRlOyB4OiBudW1iZXI7IHk6IG51bWJlcjsgZmxpcDogYm9vbGVhbjsgZml4ZWQ/OiBib29sZWFuOyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBwb3NpdGlvbjogZml4ZWQgPyBcImZpeGVkXCIgOiBcImFic29sdXRlXCIsXG4gICAgICAgIGxlZnQ6IHgsXG4gICAgICAgIHRvcDogeSxcbiAgICAgICAgdHJhbnNmb3JtOiBmbGlwID8gXCJ0cmFuc2xhdGVYKC0xMDAlKVwiIDogdW5kZWZpbmVkLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLmJhY2tncm91bmQsXG4gICAgICAgIGNvbG9yOiBwLnRleHQsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNCxcbiAgICAgICAgcGFkZGluZzogXCI0cHggOHB4XCIsXG4gICAgICAgIGZvbnRTaXplOiAxMixcbiAgICAgICAgbGluZUhlaWdodDogXCIxOHB4XCIsXG4gICAgICAgIHdoaXRlU3BhY2U6IFwibm93cmFwXCIsXG4gICAgICAgIHBvaW50ZXJFdmVudHM6IFwibm9uZVwiLFxuICAgICAgICB6SW5kZXg6IDEsXG4gICAgICB9fVxuICAgID5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuaW50ZXJmYWNlIFB0IHtcbiAgbGFiZWw6IHN0cmluZztcbiAgdmFsdWU6IG51bWJlciB8IG51bGw7XG59XG5cbi8qKiBTaW5nbGUtc2VyaWVzIGxpbmUgb3ZlciB0aW1lLiBVbmtub3duIChudWxsKSBwb2ludHMgYnJlYWsgdGhlIGxpbmUgaW5zdGVhZCBvZiBkcm9wcGluZyB0byB6ZXJvLiAqL1xuZnVuY3Rpb24gTGluZUNoYXJ0KHsgYXBpLCBwb2ludHMsIGZvcm1hdCwgaGVpZ2h0ID0gQ0hBUlRfSEVJR0hUIH06IHsgYXBpOiBQbHVnaW5BcGk7IHBvaW50czogUHRbXTsgZm9ybWF0OiAobjogbnVtYmVyKSA9PiBzdHJpbmc7IGhlaWdodD86IG51bWJlciB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW3JlZiwgd2lkdGhdID0gdXNlV2lkdGgoKTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTxudW1iZXIgfCBudWxsPihudWxsKTtcbiAgY29uc3QgTCA9IDU2LFxuICAgIFIgPSAxMixcbiAgICBUID0gMTAsXG4gICAgQiA9IDIyO1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgd2lkdGggLSBMIC0gUik7XG4gIGNvbnN0IGggPSBoZWlnaHQgLSBUIC0gQjtcbiAgY29uc3QgbiA9IHBvaW50cy5sZW5ndGg7XG4gIGNvbnN0IG1heCA9IG5pY2VNYXgoTWF0aC5tYXgoMCwgLi4ucG9pbnRzLm1hcCgocHQpID0+IHB0LnZhbHVlID8/IDApKSk7XG4gIGNvbnN0IHggPSAoaTogbnVtYmVyKSA9PiBMICsgKG4gPD0gMSA/IHcgLyAyIDogKGkgKiB3KSAvIChuIC0gMSkpO1xuICBjb25zdCB5ID0gKHY6IG51bWJlcikgPT4gVCArIGggLSAodiAvIG1heCkgKiBoO1xuXG4gIGNvbnN0IHJ1bnM6IG51bWJlcltdW10gPSBbXTtcbiAgbGV0IGN1cjogbnVtYmVyW10gPSBbXTtcbiAgcG9pbnRzLmZvckVhY2goKHB0LCBpKSA9PiB7XG4gICAgaWYgKHB0LnZhbHVlID09PSBudWxsKSB7XG4gICAgICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gICAgICBjdXIgPSBbXTtcbiAgICB9IGVsc2UgY3VyLnB1c2goaSk7XG4gIH0pO1xuICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gIGNvbnN0IGxpbmUgPSAocnVuOiBudW1iZXJbXSkgPT4gcnVuLm1hcCgoaSwgaykgPT4gYCR7ayA/IFwiTFwiIDogXCJNXCJ9JHt4KGkpfSwke3kocG9pbnRzW2ldLnZhbHVlIGFzIG51bWJlcil9YCkuam9pbihcIlwiKTtcbiAgY29uc3QgbGFzdEtub3duID0gWy4uLnBvaW50cy5rZXlzKCldLnJldmVyc2UoKS5maW5kKChpKSA9PiBwb2ludHNbaV0udmFsdWUgIT09IG51bGwpO1xuXG4gIGNvbnN0IG9uTW92ZSA9IChlOiBNb3VzZUV2ZW50PFNWR1JlY3RFbGVtZW50PikgPT4ge1xuICAgIGNvbnN0IHIgPSBlLmN1cnJlbnRUYXJnZXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgaSA9IG4gPD0gMSA/IDAgOiBNYXRoLnJvdW5kKCgoZS5jbGllbnRYIC0gci5sZWZ0KSAvIHIud2lkdGgpICogKG4gLSAxKSk7XG4gICAgc2V0SG92ZXIoTWF0aC5taW4obiAtIDEsIE1hdGgubWF4KDAsIGkpKSk7XG4gIH07XG5cbiAgY29uc3QgeExhYmVscyA9IG4gPD0gMSA/IFswXSA6IG4gPT09IDIgPyBbMCwgMV0gOiBbMCwgTWF0aC5mbG9vcigobiAtIDEpIC8gMiksIG4gLSAxXTtcbiAgY29uc3QgYW5jaG9yID0gKGk6IG51bWJlcikgPT4gKG4gPD0gMSA/IFwibWlkZGxlXCIgOiBpID09PSAwID8gXCJzdGFydFwiIDogaSA9PT0gbiAtIDEgPyBcImVuZFwiIDogXCJtaWRkbGVcIik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHJlZj17cmVmfSBzdHlsZT17eyBwb3NpdGlvbjogXCJyZWxhdGl2ZVwiLCBoZWlnaHQgfX0+XG4gICAgICB7d2lkdGggPiAwICYmIChcbiAgICAgICAgPHN2ZyB3aWR0aD17d2lkdGh9IGhlaWdodD17aGVpZ2h0fSBzdHlsZT17eyBkaXNwbGF5OiBcImJsb2NrXCIsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICB7WzAsIDAuNSwgMV0ubWFwKChmKSA9PiAoXG4gICAgICAgICAgICA8ZyBrZXk9e2Z9PlxuICAgICAgICAgICAgICA8bGluZSB4MT17TH0geDI9e0wgKyB3fSB5MT17eShtYXggKiBmKX0geTI9e3kobWF4ICogZil9IHN0cm9rZT17cC5ib3JkZXJ9IHN0cm9rZVdpZHRoPXsxfSBzdHJva2VEYXNoYXJyYXk9e2YgPyBcIjIgNFwiIDogdW5kZWZpbmVkfSAvPlxuICAgICAgICAgICAgICA8dGV4dCB4PXtMIC0gNn0geT17eShtYXggKiBmKX0gZHk9XCIwLjMyZW1cIiB0ZXh0QW5jaG9yPVwiZW5kXCIgZmlsbD17cC50ZXh0TXV0ZWR9PlxuICAgICAgICAgICAgICAgIHtmb3JtYXQobWF4ICogZil9XG4gICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICApKX1cbiAgICAgICAgICB7eExhYmVscy5tYXAoKGkpID0+IChcbiAgICAgICAgICAgIDx0ZXh0IGtleT17aX0geD17eChpKX0geT17aGVpZ2h0IC0gNH0gdGV4dEFuY2hvcj17YW5jaG9yKGkpfSBmaWxsPXtwLnRleHRNdXRlZH0+XG4gICAgICAgICAgICAgIHtwb2ludHNbaV0/LmxhYmVsfVxuICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICkpfVxuICAgICAgICAgIHtydW5zLm1hcCgocnVuKSA9PlxuICAgICAgICAgICAgcnVuLmxlbmd0aCA+IDEgPyAoXG4gICAgICAgICAgICAgIDxnIGtleT17cnVuWzBdfT5cbiAgICAgICAgICAgICAgICA8cGF0aCBkPXtgJHtsaW5lKHJ1bil9TCR7eChydW5bcnVuLmxlbmd0aCAtIDFdKX0sJHt5KDApfUwke3gocnVuWzBdKX0sJHt5KDApfVpgfSBmaWxsPXtwLmFjY2VudH0gZmlsbE9wYWNpdHk9ezAuMTJ9IC8+XG4gICAgICAgICAgICAgICAgPHBhdGggZD17bGluZShydW4pfSBmaWxsPVwibm9uZVwiIHN0cm9rZT17cC5hY2NlbnR9IHN0cm9rZVdpZHRoPXsyfSBzdHJva2VMaW5lam9pbj1cInJvdW5kXCIgc3Ryb2tlTGluZWNhcD1cInJvdW5kXCIgLz5cbiAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKSA6IG51bGwsXG4gICAgICAgICAgKX1cbiAgICAgICAgICB7cnVuc1xuICAgICAgICAgICAgLmZpbHRlcigocnVuKSA9PiBydW4ubGVuZ3RoID09PSAxKVxuICAgICAgICAgICAgLm1hcCgocnVuKSA9PiAoXG4gICAgICAgICAgICAgIDxjaXJjbGUga2V5PXtydW5bMF19IGN4PXt4KHJ1blswXSl9IGN5PXt5KHBvaW50c1tydW5bMF1dLnZhbHVlIGFzIG51bWJlcil9IHI9ezN9IGZpbGw9e3AuYWNjZW50fSAvPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAge2xhc3RLbm93biAhPT0gdW5kZWZpbmVkICYmIGhvdmVyID09PSBudWxsICYmIChcbiAgICAgICAgICAgIDxjaXJjbGUgY3g9e3gobGFzdEtub3duKX0gY3k9e3kocG9pbnRzW2xhc3RLbm93bl0udmFsdWUgYXMgbnVtYmVyKX0gcj17My41fSBmaWxsPXtwLmFjY2VudH0gc3Ryb2tlPXtwLnN1cmZhY2V9IHN0cm9rZVdpZHRoPXsyfSAvPlxuICAgICAgICAgICl9XG4gICAgICAgICAge2hvdmVyICE9PSBudWxsICYmIChcbiAgICAgICAgICAgIDxnIHBvaW50ZXJFdmVudHM9XCJub25lXCI+XG4gICAgICAgICAgICAgIDxsaW5lIHgxPXt4KGhvdmVyKX0geDI9e3goaG92ZXIpfSB5MT17VH0geTI9e1QgKyBofSBzdHJva2U9e3AudGV4dE11dGVkfSBzdHJva2VXaWR0aD17MX0gLz5cbiAgICAgICAgICAgICAge3BvaW50c1tob3Zlcl0udmFsdWUgIT09IG51bGwgJiYgPGNpcmNsZSBjeD17eChob3Zlcil9IGN5PXt5KHBvaW50c1tob3Zlcl0udmFsdWUgYXMgbnVtYmVyKX0gcj17NC41fSBmaWxsPXtwLmFjY2VudH0gc3Ryb2tlPXtwLnN1cmZhY2V9IHN0cm9rZVdpZHRoPXsyfSAvPn1cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICApfVxuICAgICAgICAgIDxyZWN0IHg9e0x9IHk9ezB9IHdpZHRoPXt3fSBoZWlnaHQ9e2hlaWdodH0gZmlsbD1cInRyYW5zcGFyZW50XCIgb25Nb3VzZU1vdmU9e29uTW92ZX0gb25Nb3VzZUxlYXZlPXsoKSA9PiBzZXRIb3ZlcihudWxsKX0gLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICApfVxuICAgICAge2hvdmVyICE9PSBudWxsICYmIChcbiAgICAgICAgPFRvb2x0aXAgcD17cH0geD17eChob3ZlcikgKyAoeChob3ZlcikgPiB3aWR0aCAtIDE0MCA/IC0xMCA6IDEwKX0geT17VH0gZmxpcD17eChob3ZlcikgPiB3aWR0aCAtIDE0MH0+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e3BvaW50c1tob3Zlcl0ubGFiZWx9PC9kaXY+XG4gICAgICAgICAgPGRpdj57cG9pbnRzW2hvdmVyXS52YWx1ZSA9PT0gbnVsbCA/IFwiVW5rbm93blwiIDogZm9ybWF0KHBvaW50c1tob3Zlcl0udmFsdWUgYXMgbnVtYmVyKX08L2Rpdj5cbiAgICAgICAgPC9Ub29sdGlwPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuaW50ZXJmYWNlIFNlZyB7XG4gIG5hbWU6IHN0cmluZztcbiAgdmFsdWU6IG51bWJlcjtcbiAgY29sb3I6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEJhclJvdyB7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHNlZ21lbnRzOiBTZWdbXTtcbiAgdmFsdWVUZXh0OiBzdHJpbmc7XG4gIHRpcDogc3RyaW5nW107XG59XG5cbmZ1bmN0aW9uIExlZ2VuZCh7IGFwaSwgaXRlbXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgaXRlbXM6IHsgbmFtZTogc3RyaW5nOyBjb2xvcjogc3RyaW5nIH1bXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBnYXA6IDE2LCBmbGV4V3JhcDogXCJ3cmFwXCIsIGZvbnRTaXplOiAxMiwgY29sb3I6IHAudGV4dE11dGVkIH19PlxuICAgICAge2l0ZW1zLm1hcCgoaXQpID0+IChcbiAgICAgICAgPHNwYW4ga2V5PXtpdC5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImlubGluZS1mbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGdhcDogNiB9fT5cbiAgICAgICAgICA8c3BhbiBzdHlsZT17eyB3aWR0aDogMTAsIGhlaWdodDogMTAsIGJvcmRlclJhZGl1czogMiwgYmFja2dyb3VuZDogaXQuY29sb3IgfX0gLz5cbiAgICAgICAgICB7aXQubmFtZX1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgKSl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbi8qKiBIb3Jpem9udGFsIChvcHRpb25hbGx5IHN0YWNrZWQpIGJhcnMgc2hhcmluZyBvbmUgc2NhbGUsIHZhbHVlIGxhYmVscyBhdCB0aGUgZW5kLiBTY3JvbGxzIHBhc3QgQkFSX0xJU1RfSEVJR0hULiAqL1xuZnVuY3Rpb24gQmFyTGlzdCh7IGFwaSwgcm93cyB9OiB7IGFwaTogUGx1Z2luQXBpOyByb3dzOiBCYXJSb3dbXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTx7IGk6IG51bWJlcjsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSB8IG51bGw+KG51bGwpO1xuICBjb25zdCBtYXggPSBNYXRoLm1heCgwLCAuLi5yb3dzLm1hcCgocikgPT4gci5zZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKSkpIHx8IDE7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT5Ob25lPC9zcGFuPjtcbiAgY29uc3QgZmxpcCA9IGhvdmVyICE9PSBudWxsICYmIGhvdmVyLnggPiB3aW5kb3cuaW5uZXJXaWR0aCAtIDIwMDtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IC4uLnNjcm9sbGJhclN0eWxlKHApLCBtYXhIZWlnaHQ6IENIQVJUX0hFSUdIVCwgb3ZlcmZsb3dZOiBcImF1dG9cIiwgb3ZlcmZsb3dYOiBcImhpZGRlblwiIH19IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJtaW5tYXgoMCwgbWF4LWNvbnRlbnQpIDFmciBtYXgtY29udGVudFwiLCBnYXA6IFwiMnB4IDEycHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZm9udFNpemU6IDE0IH19PlxuICAgICAgICB7cm93cy5tYXAoKHIsIGkpID0+IHtcbiAgICAgICAgICBjb25zdCB0b3RhbCA9IHIuc2VnbWVudHMucmVkdWNlKChhLCBzKSA9PiBhICsgcy52YWx1ZSwgMCk7XG4gICAgICAgICAgY29uc3QgaG90ID0gaG92ZXI/LmkgPT09IGk7XG4gICAgICAgICAgY29uc3QgY2VsbDogQ1NTUHJvcGVydGllcyA9IHsgYmFja2dyb3VuZDogaG90ID8gcC5zdXJmYWNlSG92ZXIgOiB1bmRlZmluZWQsIHBhZGRpbmc6IFwiMnB4IDBcIiB9O1xuICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17ci5sYWJlbH0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19IG9uTW91c2VNb3ZlPXsoZSkgPT4gc2V0SG92ZXIoeyBpLCB4OiBlLmNsaWVudFgsIHk6IGUuY2xpZW50WSB9KX0+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIGNvbG9yOiBob3QgPyBwLmFjY2VudCA6IHAudGV4dCwgbWF4V2lkdGg6IDIyMCwgb3ZlcmZsb3c6IFwiaGlkZGVuXCIsIHRleHRPdmVyZmxvdzogXCJlbGxpcHNpc1wiLCB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiIH19IHRpdGxlPXtyLmxhYmVsfT5cbiAgICAgICAgICAgICAgICB7ci5sYWJlbH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLmNlbGwsIGRpc3BsYXk6IFwiZmxleFwiLCBoZWlnaHQ6IDIyLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiIH19PlxuICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIHdpZHRoOiBgJHsodG90YWwgLyBtYXgpICogMTAwfSVgLCBoZWlnaHQ6IDEyLCBnYXA6IDEsIG1pbldpZHRoOiB0b3RhbCA+IDAgPyAyIDogMCB9fT5cbiAgICAgICAgICAgICAgICAgIHtyLnNlZ21lbnRzXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKHMpID0+IHMudmFsdWUgPiAwKVxuICAgICAgICAgICAgICAgICAgICAubWFwKChzLCBrLCBhcnIpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXk9e3MubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZsZXg6IHMudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHMuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJvcmRlclJhZGl1czogYCR7ayA9PT0gMCA/IDIgOiAwfXB4ICR7ayA9PT0gYXJyLmxlbmd0aCAtIDEgPyAyIDogMH1weCAke2sgPT09IGFyci5sZW5ndGggLSAxID8gMiA6IDB9cHggJHtrID09PSAwID8gMiA6IDB9cHhgLFxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIHRleHRBbGlnbjogXCJyaWdodFwiLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIgfX0+e3IudmFsdWVUZXh0fTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICk7XG4gICAgICAgIH0pfVxuICAgICAgPC9kaXY+XG4gICAgICB7aG92ZXIgJiYgcm93c1tob3Zlci5pXSAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e2hvdmVyLnggKyAoZmxpcCA/IC0xMiA6IDEyKX0geT17aG92ZXIueSArIDEyfSBmbGlwPXtmbGlwfSBmaXhlZD5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRXZWlnaHQ6IDYwMCB9fT57cm93c1tob3Zlci5pXS5sYWJlbH08L2Rpdj5cbiAgICAgICAgICB7cm93c1tob3Zlci5pXS50aXAubWFwKCh0KSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17dH0+e3R9PC9kaXY+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvVG9vbHRpcD5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmZ1bmN0aW9uIFRpbGUoeyBhcGksIGxhYmVsLCB2YWx1ZSwgZGVsdGEgfTogeyBhcGk6IFBsdWdpbkFwaTsgbGFiZWw6IHN0cmluZzsgdmFsdWU6IHN0cmluZzsgZGVsdGE/OiBzdHJpbmcgfCBudWxsIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICByZXR1cm4gKFxuICAgIDxkaXZcbiAgICAgIHN0eWxlPXt7IG1pbldpZHRoOiAwLCBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiLCBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsIGJvcmRlclJhZGl1czogNiwgcGFkZGluZzogXCIxMHB4IDEycHhcIiwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMiB9fVxuICAgID5cbiAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PntsYWJlbH08L3NwYW4+XG4gICAgICA8c3BhbiBzdHlsZT17eyBmb250U2l6ZTogMjIsIGxpbmVIZWlnaHQ6IFwiMzBweFwiLCBmb250V2VpZ2h0OiA2MDAsIGZvbnRWYXJpYW50TnVtZXJpYzogXCJ0YWJ1bGFyLW51bXNcIiB9fT57dmFsdWV9PC9zcGFuPlxuICAgICAge2RlbHRhICYmIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PntkZWx0YX08L3NwYW4+fVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogV3JhcHBpbmcgcm93IG9mIGNhcmRzOiBldmVyeSByb3cgaXMgZmlsbGVkIGVkZ2UgdG8gZWRnZSBhbmQgaXRzIGNhcmRzIHNoYXJlIG9uZSBoZWlnaHQuICovXG5jb25zdCBUSUxFX01JTiA9IDEzMDtcbmNvbnN0IEdBUCA9IDEyO1xuXG4vKiogU3RhdCB0aWxlcyBpbiBlcXVhbCBjb2x1bW5zOyB3aGVuIHRoZXkgZG9uJ3QgZml0IG9uIG9uZSByb3cgdGhleSBzcGxpdCBpbnRvIGJhbGFuY2VkIHJvd3MgKDYgLT4gMyszIC0+IDIrMisyKS4gKi9cbmZ1bmN0aW9uIFRpbGVSb3coeyBjaGlsZHJlbiB9OiB7IGNoaWxkcmVuOiBSZWFjdE5vZGVbXSB9KSB7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IG4gPSBNYXRoLm1heCgxLCBjaGlsZHJlbi5sZW5ndGgpO1xuICBjb25zdCBmaXQgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKCh3aWR0aCArIEdBUCkgLyAoVElMRV9NSU4gKyBHQVApKSk7XG4gIGNvbnN0IGNvbHMgPSB3aWR0aCA/IE1hdGguY2VpbChuIC8gTWF0aC5jZWlsKG4gLyBNYXRoLm1pbihmaXQsIG4pKSkgOiBuO1xuICByZXR1cm4gKFxuICAgIDxkaXYgcmVmPXtyZWZ9IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBgcmVwZWF0KCR7Y29sc30sIG1pbm1heCgwLCAxZnIpKWAsIGdhcDogR0FQIH19PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5jb25zdCBGbG93ID0gKHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pID0+IDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhXcmFwOiBcIndyYXBcIiwgYWxpZ25JdGVtczogXCJzdHJldGNoXCIsIGdhcDogMTIgfX0+e2NoaWxkcmVufTwvZGl2PjtcblxuZnVuY3Rpb24gU2VjdGlvbih7IGFwaSwgdGl0bGUsIGV4dHJhLCBjaGlsZHJlbiB9OiB7IGFwaTogUGx1Z2luQXBpOyB0aXRsZTogc3RyaW5nOyBleHRyYT86IFJlYWN0Tm9kZTsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBmbGV4OiBcIjEgMSAzMjBweFwiLFxuICAgICAgICBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNixcbiAgICAgICAgcGFkZGluZzogMTIsXG4gICAgICAgIGRpc3BsYXk6IFwiZmxleFwiLFxuICAgICAgICBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLFxuICAgICAgICBnYXA6IDgsXG4gICAgICAgIG1pbldpZHRoOiAwLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBmbGV4V3JhcDogXCJ3cmFwXCIgfX0+XG4gICAgICAgIDxzdHJvbmcgc3R5bGU9e3sgZmxleDogMSB9fT57dGl0bGV9PC9zdHJvbmc+XG4gICAgICAgIHtleHRyYX1cbiAgICAgIDwvZGl2PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1ldHJpYyB2aWV3cyAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBUcmVuZCB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGtleTogc3RyaW5nO1xuICBnZXQ6IChkb2M6IEpzb24pID0+IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ7XG59XG5cbi8qKiBUaWxlIHZhbHVlIGZyb20gdGhlIGxhdGVzdCBkb2MsIGRlbHRhIGFnYWluc3QgdGhlIHByZXZpb3VzIGRheSBpbiBoaXN0b3J5LiAqL1xuZnVuY3Rpb24gdHJlbmRUaWxlKGFwaTogUGx1Z2luQXBpLCBkYXlzOiBEYXlbXSwgdDogVHJlbmQpIHtcbiAgY29uc3QgdmFscyA9IGRheXMubWFwKChkKSA9PiB0LmdldChkLmRvYykpO1xuICBjb25zdCBjdXIgPSB2YWxzW3ZhbHMubGVuZ3RoIC0gMV07XG4gIGNvbnN0IHByZXYgPSB2YWxzLmxlbmd0aCA+IDEgPyB2YWxzW3ZhbHMubGVuZ3RoIC0gMl0gOiB1bmRlZmluZWQ7XG4gIGxldCBkZWx0YTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY3VyID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBwcmV2ID09PSBcIm51bWJlclwiKSB7XG4gICAgY29uc3QgZCA9IGN1ciAtIHByZXY7XG4gICAgY29uc3QgYWJzID0gTU9ORVlfS0VZLnRlc3QodC5rZXkpID8gbW9uZXkuZm9ybWF0KE1hdGguYWJzKGQpKSA6IE1hdGguYWJzKGQpLnRvTG9jYWxlU3RyaW5nKCk7XG4gICAgZGVsdGEgPSBgJHtkID4gMCA/IFwiK1wiIDogZCA8IDAgPyBcIi1cIiA6IFwiXHUwMEIxXCJ9JHthYnN9IHZzICR7c2hvcnREYXRlKGRheXNbZGF5cy5sZW5ndGggLSAyXS5kYXRlKX1gO1xuICB9XG4gIHJldHVybiA8VGlsZSBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSBsYWJlbD17dC50aXRsZX0gdmFsdWU9e2ZtdChjdXIsIHQua2V5KX0gZGVsdGE9e2RlbHRhfSAvPjtcbn1cblxuLyoqIE9uZSBjYXJkIHBlciB0cmVuZCB0aGF0IGhhcyBkYXRhOyByZW5kZXJlZCBhcyBhIGZyYWdtZW50IHNvIHRoZSBjYXJkcyBqb2luIHRoZSBzdXJyb3VuZGluZyBGbG93LiAqL1xuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RyZW5kc1xuICAgICAgICAubWFwKCh0KSA9PiAoeyB0LCBwb2ludHM6IGRheXMubWFwKChkKSA9PiAoeyBsYWJlbDogc2hvcnREYXRlKGQuZGF0ZSksIHJhdzogdC5nZXQoZC5kb2MpIH0pKSB9KSlcbiAgICAgICAgLmZpbHRlcigoeyBwb2ludHMgfSkgPT4gcG9pbnRzLnNvbWUoKHB0KSA9PiBwdC5yYXcgIT09IHVuZGVmaW5lZCkpXG4gICAgICAgIC5tYXAoKHsgdCwgcG9pbnRzIH0pID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSB0aXRsZT17YCR7dC50aXRsZX0gVHJlbmRgfT5cbiAgICAgICAgICAgIDxMaW5lQ2hhcnQgYXBpPXthcGl9IHBvaW50cz17cG9pbnRzLm1hcCgocHQpID0+ICh7IGxhYmVsOiBwdC5sYWJlbCwgdmFsdWU6IHB0LnJhdyA/PyBudWxsIH0pKX0gZm9ybWF0PXtheGlzRm10KHQua2V5KX0gLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgIDwvPlxuICApO1xufVxuXG5mdW5jdGlvbiBIaXN0b3J5SGludCh7IGFwaSwgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGlmIChkYXlzLmxlbmd0aCA+PSAyKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBhcGkudGhlbWUucGFsZXR0ZS50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5UcmVuZHMgZmlsbCBpbiBhcyBkYWlseSBoaXN0b3J5IGFjY3VtdWxhdGVzICh7ZGF5cy5sZW5ndGh9IGRheSBzbyBmYXIpLjwvc3Bhbj47XG59XG5cbmZ1bmN0aW9uIGNvc3RSb3dzKGFwaTogUGx1Z2luQXBpLCBjb3N0OiBKc29uKTogQmFyUm93W10ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiBPYmplY3QuZW50cmllcyhjb3N0Py5ieVRhZyA/PyB7fSlcbiAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpXG4gICAgLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gKGIgYXMgbnVtYmVyKSAtIChhIGFzIG51bWJlcikpXG4gICAgLm1hcCgoW2ssIHZdKSA9PiAoe1xuICAgICAgbGFiZWw6IGssXG4gICAgICBzZWdtZW50czogW3sgbmFtZTogXCJDb3N0XCIsIHZhbHVlOiB2IGFzIG51bWJlciwgY29sb3I6IHAuYWNjZW50IH1dLFxuICAgICAgdmFsdWVUZXh0OiBtb25leS5mb3JtYXQodiBhcyBudW1iZXIpLFxuICAgICAgdGlwOiBbYCR7bW9uZXkuZm9ybWF0KHYgYXMgbnVtYmVyKX0gKCR7Y29zdC50b3RhbCA/ICgoKHYgYXMgbnVtYmVyKSAvIGNvc3QudG90YWwpICogMTAwKS50b0ZpeGVkKDEpIDogXCIwXCJ9JSBvZiB0b3RhbClgXSxcbiAgICB9KSk7XG59XG5cbmNvbnN0IE9WRVJWSUVXX1RSRU5EUzogVHJlbmRbXSA9IFtcbiAgeyB0aXRsZTogXCJBV1MgQ29zdCAoMzBkKVwiLCBrZXk6IFwiY29zdFwiLCBnZXQ6IChkKSA9PiBtZXRyaWMoZCwgXCJhd3NDb3N0LnRvdGFsXCIpIH0sXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMucmVxdWVzdHNcIikgfSxcbiAgeyB0aXRsZTogXCJMYW1iZGEgRXJyb3JzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSB9LFxuICB7IHRpdGxlOiBcIjV4eCBFcnJvcnMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMuZXJyb3JzNXh4XCIpIH0sXG4gIHsgdGl0bGU6IFwiQWxhcm1zIEZpcmluZ1wiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJoZWFsdGguYWxhcm1zLmluQWxhcm1cIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcImN1c3RvbWVycy5wYXlpbmdcIikgfSxcbl07XG5cbmZ1bmN0aW9uIE92ZXJ2aWV3KHsgYXBpLCBkb2MsIGRheXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgZG9jOiBKc29uOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGNvbnN0IHsgU3RhdHVzRG90IH0gPSBhcGkudWk7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkb2MpO1xuICBjb25zdCBjb3N0ID0gZG9jLmF3c0Nvc3Q7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIiwgZ2FwOiAxMiB9fT5cbiAgICAgIDxUaWxlUm93PntPVkVSVklFV19UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChkb2MpICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgZGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17ZGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2RheXN9IHRyZW5kcz17T1ZFUlZJRVdfVFJFTkRTLnNsaWNlKDAsIDMpfSAvPlxuICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJBcHBzXCI+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJhdXRvIDFmciBtYXgtY29udGVudCBtYXgtY29udGVudCBtYXgtY29udGVudFwiLCBnYXA6IFwiNHB4IDE2cHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiB9fT5cbiAgICAgICAgICAgIHtbXCJcIiwgXCJBcHBcIiwgXCJSZXF1ZXN0c1wiLCBcIkVycm9yc1wiLCBcIlByb2ZpdCAoMzBkKVwiXS5tYXAoKGgpID0+IChcbiAgICAgICAgICAgICAgPHNwYW4ga2V5PXtoIHx8IFwiZG90XCJ9IHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgICAgICAgIHtofVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgICAgIHthcHBzLm1hcCgoYSkgPT4gKFxuICAgICAgICAgICAgICA8ZGl2IGtleT17YS5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0+XG4gICAgICAgICAgICAgICAgPFN0YXR1c0RvdCBjb2xvcj17YXBwU3RhdHVzKGEpfSAvPlxuICAgICAgICAgICAgICAgIDxzcGFuPnthLm5hbWV9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uZXkucHJvZml0MzBkXCIpLCBcInByb2ZpdFwiKX08L3NwYW4+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPXtgQVdTIENvc3QgQnkgUHJvamVjdCR7Y29zdCAmJiAhaXNFcnJvck5vZGUoY29zdCkgPyBgICgke3Nob3J0RGF0ZShjb3N0LndpbmRvd1N0YXJ0KX0gVG8gJHtzaG9ydERhdGUoY29zdC53aW5kb3dFbmQpfSlgIDogXCJcIn1gfT5cbiAgICAgICAgICB7IWNvc3QgfHwgaXNFcnJvck5vZGUoY29zdCkgPyA8c3Bhbj57Zm10KGNvc3QpfTwvc3Bhbj4gOiA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17Y29zdFJvd3MoYXBpLCBjb3N0KX0gLz59XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgIDwvRmxvdz5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gbGFtYmRhUm93cyhhcGk6IFBsdWdpbkFwaSwgbGFtYmRhczogSnNvbik6IHsgcm93czogQmFyUm93W107IGlkbGU6IG51bWJlcjsgdW5rbm93bjogc3RyaW5nW10gfSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3Qgcm93czogQmFyUm93W10gPSBbXTtcbiAgY29uc3QgdW5rbm93bjogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGlkbGUgPSAwO1xuICBmb3IgKGNvbnN0IFtmbiwgdl0gb2YgT2JqZWN0LmVudHJpZXMobGFtYmRhcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSkge1xuICAgIGNvbnN0IGludiA9IG1ldHJpYyh2LCBcImludm9jYXRpb25zXCIpO1xuICAgIGlmICh0eXBlb2YgaW52ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB1bmtub3duLnB1c2goZm4pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbnYgPT09IDApIHtcbiAgICAgIGlkbGUrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBlcnIgPSBtZXRyaWModiwgXCJlcnJvcnNcIikgPz8gMDtcbiAgICBjb25zdCB0aHIgPSBtZXRyaWModiwgXCJ0aHJvdHRsZXNcIikgPz8gMDtcbiAgICByb3dzLnB1c2goe1xuICAgICAgbGFiZWw6IGZuLFxuICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgeyBuYW1lOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogTWF0aC5tYXgoMCwgaW52IC0gZXJyKSwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgdmFsdWU6IGVyciwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICBdLFxuICAgICAgdmFsdWVUZXh0OiBlcnIgPyBgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gKCR7KChlcnIgLyBpbnYpICogMTAwKS50b0ZpeGVkKDApfSUgRXJyKWAgOiBpbnYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgIHRpcDogW2Ake2ludi50b0xvY2FsZVN0cmluZygpfSBpbnZvY2F0aW9uc2AsIGAke2Vyci50b0xvY2FsZVN0cmluZygpfSBlcnJvcnNgLCBgJHt0aHIudG9Mb2NhbGVTdHJpbmcoKX0gdGhyb3R0bGVzYF0sXG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzWzBdLnZhbHVlICsgYi5zZWdtZW50c1sxXS52YWx1ZSAtIChhLnNlZ21lbnRzWzBdLnZhbHVlICsgYS5zZWdtZW50c1sxXS52YWx1ZSkpO1xuICByZXR1cm4geyByb3dzLCBpZGxlLCB1bmtub3duIH07XG59XG5cbmZ1bmN0aW9uIGFwaVJvd3MoYXBpOiBQbHVnaW5BcGksIGFwaXM6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChPYmplY3QuZW50cmllcyhhcGlzID8/IHt9KSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgbWV0cmljKHYsIFwicmVxdWVzdHNcIikgPT09IFwibnVtYmVyXCIpXG4gICAgLm1hcCgoW25hbWUsIHZdKSA9PiB7XG4gICAgICBjb25zdCByZXEgPSBtZXRyaWModiwgXCJyZXF1ZXN0c1wiKSBhcyBudW1iZXI7XG4gICAgICBjb25zdCBlNCA9IG1ldHJpYyh2LCBcImVycm9yczR4eFwiKSA/PyAwO1xuICAgICAgY29uc3QgZTUgPSBtZXRyaWModiwgXCJlcnJvcnM1eHhcIikgPz8gMDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGxhYmVsOiBuYW1lLFxuICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgIHsgbmFtZTogXCJPS1wiLCB2YWx1ZTogTWF0aC5tYXgoMCwgcmVxIC0gZTQgLSBlNSksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgIHsgbmFtZTogXCI0eHhcIiwgdmFsdWU6IGU0LCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgIHsgbmFtZTogXCI1eHhcIiwgdmFsdWU6IGU1LCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgXSxcbiAgICAgICAgdmFsdWVUZXh0OiByZXEudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgdGlwOiBbYCR7cmVxLnRvTG9jYWxlU3RyaW5nKCl9IHJlcXVlc3RzYCwgYCR7ZTQudG9Mb2NhbGVTdHJpbmcoKX0gNHh4LCAke2U1LnRvTG9jYWxlU3RyaW5nKCl9IDV4eGAsIGBwOTUgbGF0ZW5jeTogJHtmbXQodi5wOTVMYXRlbmN5TXMsIFwibGF0ZW5jeW1zXCIpfWBdLFxuICAgICAgfTtcbiAgICB9KVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzLnJlZHVjZSgocywgeCkgPT4gcyArIHgudmFsdWUsIDApIC0gYS5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSk7XG59XG5cbmZ1bmN0aW9uIFJvd3MoeyBhcGksIHZhbHVlLCBwYXRoID0gXCJcIiB9OiB7IGFwaTogUGx1Z2luQXBpOyB2YWx1ZTogSnNvbjsgcGF0aD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBpc0Vycm9yTm9kZSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gPHNwYW4+e2ZtdCh2YWx1ZSwgcGF0aCl9PC9zcGFuPjtcbiAgfVxuICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgdl0pID0+ICEodHlwZW9mIHYgPT09IFwic3RyaW5nXCIgJiYgKHYubGVuZ3RoID4gODAgfHwgdi5pbmNsdWRlcyhcIlxcblwiKSkpKTtcbiAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwibWF4LWNvbnRlbnQgMWZyXCIsIGdhcDogXCIycHggMTZweFwiIH19PlxuICAgICAge2VudHJpZXMubWFwKChbaywgdl0pID0+IHtcbiAgICAgICAgY29uc3QgbmVzdGVkID0gdiAhPT0gbnVsbCAmJiB0eXBlb2YgdiA9PT0gXCJvYmplY3RcIiAmJiAhaXNFcnJvck5vZGUodik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPGRpdiBrZXk9e2t9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fT5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57dGl0bGVDYXNlKGspfTwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuPntuZXN0ZWQgPyBBcnJheS5pc0FycmF5KHYpID8gPHNwYW4+e3YubGVuZ3RoID8gdi5qb2luKFwiLCBcIikgOiBcIk5vbmVcIn08L3NwYW4+IDogPFJvd3MgYXBpPXthcGl9IHZhbHVlPXt2fSBwYXRoPXtrfSAvPiA6IGZtdCh2LCBrKX08L3NwYW4+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICk7XG4gICAgICB9KX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgdGl0bGVDYXNlID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC8oW0EtWl0pL2csIFwiICQxXCIpLnJlcGxhY2UoL14uLywgKGMpID0+IGMudG9VcHBlckNhc2UoKSk7XG5cbmNvbnN0IEFQUF9UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuICB7IHRpdGxlOiBcIk1SUlwiLCBrZXk6IFwibXJyXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5Lm1yclwiKSB9LFxuICB7IHRpdGxlOiBcIlByb2ZpdCAoMzBkKVwiLCBrZXk6IFwicHJvZml0XCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSB9LFxuXTtcblxuZnVuY3Rpb24gQXBwVmlldyh7IGFwaSwgYXBwLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGFwcDogSnNvbjsgZGF5czogRGF5W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBkb2M6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHAubmFtZSkgfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpO1xuICBjb25zdCBtb24gPSBhcHAubW9uaXRvcmluZztcbiAgY29uc3QgYXVkID0gYXBwLmF1ZGllbmNlO1xuICBjb25zdCBhdWREYXlzOiBKc29uW10gPSBhdWQgJiYgQXJyYXkuaXNBcnJheShhdWQuZGF5cykgPyBhdWQuZGF5cyA6IFtdO1xuICBjb25zdCBhdWRLZXlzID0gYXVkRGF5cy5sZW5ndGggPyBPYmplY3Qua2V5cyhhdWREYXlzWzBdKS5maWx0ZXIoKGspID0+IGsgIT09IFwiZGF0ZVwiICYmIHR5cGVvZiBhdWREYXlzWzBdW2tdID09PSBcIm51bWJlclwiKSA6IFtdO1xuICBjb25zdCBsYW1iZGFzID0gbW9uICYmICFpc0Vycm9yTm9kZShtb24pICYmICFpc0Vycm9yTm9kZShtb24ubGFtYmRhcykgPyBsYW1iZGFSb3dzKGFwaSwgbW9uLmxhbWJkYXMpIDogbnVsbDtcbiAgY29uc3QgYXBpcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmFwaXMpID8gYXBpUm93cyhhcGksIG1vbi5hcGlzKSA6IG51bGw7XG4gIGNvbnN0IGRldGFpbHMgPSBPYmplY3QuZW50cmllcyhhcHApLmZpbHRlcigoW2tdKSA9PiBrICE9PSBcIm5hbWVcIiAmJiBrICE9PSBcIm1vbml0b3JpbmdcIik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVSb3c+e0FQUF9UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChhcHApICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgYXBwRGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17YXBwRGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2FwcERheXN9IHRyZW5kcz17QVBQX1RSRU5EU30gLz5cbiAgICAgICAge21vbiAmJiBpc0Vycm9yTm9kZShtb24pICYmIChcbiAgICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJNb25pdG9yaW5nICgyNGgpXCI+XG4gICAgICAgICAgICA8c3Bhbj57Zm10KG1vbil9PC9zcGFuPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2FwaXMgJiYgYXBpcy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT1cIkFQSSBSZXF1ZXN0cyAoMjRoKVwiXG4gICAgICAgICAgICBleHRyYT17XG4gICAgICAgICAgICAgIDxMZWdlbmRcbiAgICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgICBpdGVtcz17W1xuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIk9LXCIsIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIjR4eFwiLCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIjV4eFwiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgICAgICAgICBdfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXthcGlzfSAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2xhbWJkYXMgJiYgbGFtYmRhcy5yb3dzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uXG4gICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgIHRpdGxlPVwiTGFtYmRhIEludm9jYXRpb25zICgyNGgpXCJcbiAgICAgICAgICAgIGV4dHJhPXtcbiAgICAgICAgICAgICAgPExlZ2VuZFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIGl0ZW1zPXtbXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiU3VjY2VlZGVkXCIsIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIkVycm9yc1wiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgICAgICAgICBdfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXtsYW1iZGFzLnJvd3N9IC8+XG4gICAgICAgICAgICB7KGxhbWJkYXMuaWRsZSA+IDAgfHwgbGFtYmRhcy51bmtub3duLmxlbmd0aCA+IDApICYmIChcbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAgICAgICAge1tsYW1iZGFzLmlkbGUgPyBgJHtsYW1iZGFzLmlkbGV9IGlkbGUgZnVuY3Rpb24ke2xhbWJkYXMuaWRsZSA+IDEgPyBcInNcIiA6IFwiXCJ9IGhpZGRlbmAgOiBcIlwiLCBsYW1iZGFzLnVua25vd24ubGVuZ3RoID8gYFVua25vd246ICR7bGFtYmRhcy51bmtub3duLmpvaW4oXCIsIFwiKX1gIDogXCJcIl1cbiAgICAgICAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgICAgICAgICAgICAgIC5qb2luKFwiLiBcIil9XG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7YXVkS2V5cy5tYXAoKGspID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e2t9IGFwaT17YXBpfSB0aXRsZT17YERhaWx5ICR7dGl0bGVDYXNlKGspfWB9PlxuICAgICAgICAgICAgPExpbmVDaGFydCBhcGk9e2FwaX0gcG9pbnRzPXthdWREYXlzLm1hcCgoZCkgPT4gKHsgbGFiZWw6IHNob3J0RGF0ZShTdHJpbmcoZC5kYXRlKSksIHZhbHVlOiB0eXBlb2YgZFtrXSA9PT0gXCJudW1iZXJcIiA/IGRba10gOiBudWxsIH0pKX0gZm9ybWF0PXtheGlzRm10KGspfSAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgICAgIHthdWQ/LnNvdXJjZXMzMGQgJiYgIWlzRXJyb3JOb2RlKGF1ZC5zb3VyY2VzMzBkKSAmJiAoXG4gICAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiVHJhZmZpYyBTb3VyY2VzICgzMGQpXCI+XG4gICAgICAgICAgICA8QmFyTGlzdFxuICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgcm93cz17KE9iamVjdC5lbnRyaWVzKGF1ZC5zb3VyY2VzMzBkKSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAgICAgICAgICAgICAuc29ydCgoWywgYV0sIFssIGJdKSA9PiBiIC0gYSlcbiAgICAgICAgICAgICAgICAubWFwKChbaywgdl0pID0+ICh7XG4gICAgICAgICAgICAgICAgICBsYWJlbDogdGl0bGVDYXNlKGspLFxuICAgICAgICAgICAgICAgICAgc2VnbWVudHM6IFt7IG5hbWU6IFwiVmlld3NcIiwgdmFsdWU6IHYsIGNvbG9yOiBwLmFjY2VudCB9XSxcbiAgICAgICAgICAgICAgICAgIHZhbHVlVGV4dDogdi50b0xvY2FsZVN0cmluZygpLFxuICAgICAgICAgICAgICAgICAgdGlwOiBbYCR7di50b0xvY2FsZVN0cmluZygpfSB2aWV3c2BdLFxuICAgICAgICAgICAgICAgIH0pKX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7ZGV0YWlscy5tYXAoKFtrLCB2XSkgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17a30gYXBpPXthcGl9IHRpdGxlPXt0aXRsZUNhc2Uoayl9PlxuICAgICAgICAgICAgPFJvd3NcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHZhbHVlPXtrID09PSBcImF1ZGllbmNlXCIgJiYgdiAmJiAhaXNFcnJvck5vZGUodikgPyBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModikuZmlsdGVyKChba2tdKSA9PiBrayAhPT0gXCJkYXlzXCIgJiYga2sgIT09IFwic291cmNlczMwZFwiKSkgOiB2fVxuICAgICAgICAgICAgICBwYXRoPXtrfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgPC9GbG93PlxuICAgIDwvZGl2PlxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gQ29tcG9uZW50KHsgYXBpIH06IHsgYXBpOiBQbHVnaW5BcGk7IHBhbmVJZD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHsgVGV4dEJ1dHRvbiwgVGFicywgQmFubmVyLCBTcGlubmVyIH0gPSBhcGkudWk7XG4gIGNvbnN0IHBhbGV0dGUgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgWywgZm9yY2VdID0gdXNlU3RhdGUoMCk7XG4gIGNvbnN0IFt0YWIsIHNldFRhYl0gPSB1c2VTdGF0ZShcIm92ZXJ2aWV3XCIpO1xuICBjb25zdCBbLCBzZXRUaGVtZV0gPSB1c2VTdGF0ZSgwKTtcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGwgPSAoKSA9PiBmb3JjZSgobikgPT4gbiArIDEpO1xuICAgIGxpc3RlbmVycy5hZGQobCk7XG4gICAgY29uc3QgdW5zdWIgPSBhcGkudGhlbWUuc3Vic2NyaWJlKCgpID0+IHNldFRoZW1lKChuKSA9PiBuICsgMSkpO1xuICAgIGlmICghc3RhdGUuZGF0YSkge1xuICAgICAgdm9pZCBhcGkuc3RvcmFnZS5nZXQ8SnNvbj4oQ0FDSEVfS0VZKS50aGVuKChjYWNoZWQpID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhc3RhdGUuZGF0YSkgc2V0U3RhdGUoeyBkYXRhOiBjYWNoZWQgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGxpc3RlbmVycy5kZWxldGUobCk7XG4gICAgICB1bnN1YigpO1xuICAgIH07XG4gIH0sIFthcGldKTtcblxuICBjb25zdCB7IGRhdGEsIGVycm9yLCBsb2FkaW5nIH0gPSBzdGF0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkYXRhKTtcbiAgY29uc3QgZGF5cyA9IGFsbERheXMoKTtcbiAgY29uc3QgYWdlID0gZGF0YSA/IGFnZUhvdXJzKGRhdGEuZ2VuZXJhdGVkQXQpIDogbnVsbDtcbiAgY29uc3Qgc3RhbGUgPSBkYXRhICYmIChhZ2UgPT09IG51bGwgfHwgYWdlID4gU1RBTEVfSE9VUlMpO1xuICBjb25zdCBjdXJyZW50ID0gdGFiID09PSBcIm92ZXJ2aWV3XCIgPyBudWxsIDogYXBwcy5maW5kKChhKSA9PiBhLm5hbWUgPT09IHRhYik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGZsZXg6IDEsIG1pbkhlaWdodDogMCwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMTIsIGNvbG9yOiBwYWxldHRlLnRleHQgfX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBwYWRkaW5nUmlnaHQ6IDI0IH19PlxuICAgICAgICA8aDIgc3R5bGU9e3sgbWFyZ2luOiAwIH19PntOQU1FfTwvaDI+XG4gICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwYWxldHRlLnRleHRNdXRlZCwgZmxleDogMSB9fT5cbiAgICAgICAgICB7ZGF0YVxuICAgICAgICAgICAgPyBgR2VuZXJhdGVkICR7ZGF0YS5nZW5lcmF0ZWRBdCA/IG5ldyBEYXRlKGRhdGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCkgOiBcIlVua25vd25cIn0gXHUwMEI3ICR7ZGF5cy5sZW5ndGh9IERheSR7ZGF5cy5sZW5ndGggPT09IDEgPyBcIlwiIDogXCJzXCJ9IE9mIEhpc3RvcnlgXG4gICAgICAgICAgICA6IFwiTm8gRGF0YSBZZXRcIn1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgICB7bG9hZGluZyAmJiA8U3Bpbm5lciBzaXplPXsxNn0gLz59XG4gICAgICAgIDxUZXh0QnV0dG9uIGxhYmVsPVwiUmVmcmVzaFwiIHZhcmlhbnQ9XCJwcmltYXJ5XCIgZGlzYWJsZWQ9e2xvYWRpbmd9IG9uQ2xpY2s9eygpID0+IHZvaWQgcmVmcmVzaChhcGkpfSAvPlxuICAgICAgPC9kaXY+XG4gICAgICB7ZXJyb3IgJiYgPEJhbm5lciBtZXNzYWdlPXtgQ291bGQgTm90IExvYWQgTWV0cmljczogJHtlcnJvcn1gfSB0b25lPVwiZXJyb3JcIiAvPn1cbiAgICAgIHtzdGFsZSAmJiA8QmFubmVyIG1lc3NhZ2U9e2BNZXRyaWNzIEFyZSBPbGRlciBUaGFuICR7U1RBTEVfSE9VUlN9IEhvdXJzOyBUaGUgRGFpbHkgQ29sbGVjdG9yIE1heSBIYXZlIEZhaWxlZGB9IHRvbmU9XCJ3YXJuaW5nXCIgLz59XG4gICAgICB7ZGF0YSAmJiAoXG4gICAgICAgIDw+XG4gICAgICAgICAgPFRhYnNcbiAgICAgICAgICAgIHRhYnM9e1t7IGxhYmVsOiBcIk92ZXJ2aWV3XCIsIHZhbHVlOiBcIm92ZXJ2aWV3XCIgfSwgLi4uYXBwcy5tYXAoKGEpID0+ICh7IGxhYmVsOiBhLm5hbWUgYXMgc3RyaW5nLCB2YWx1ZTogYS5uYW1lIGFzIHN0cmluZyB9KSldfVxuICAgICAgICAgICAgdmFsdWU9e2N1cnJlbnQgPyB0YWIgOiBcIm92ZXJ2aWV3XCJ9XG4gICAgICAgICAgICBvbkNoYW5nZT17c2V0VGFifVxuICAgICAgICAgIC8+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyAuLi5zY3JvbGxiYXJTdHlsZShwYWxldHRlKSwgZmxleDogMSwgbWluSGVpZ2h0OiAwLCBvdmVyZmxvdzogXCJhdXRvXCIgfX0+XG4gICAgICAgICAgICB7Y3VycmVudCA/IDxBcHBWaWV3IGFwaT17YXBpfSBhcHA9e2N1cnJlbnR9IGRheXM9e2RheXN9IC8+IDogPE92ZXJ2aWV3IGFwaT17YXBpfSBkb2M9e2RhdGF9IGRheXM9e2RheXN9IC8+fVxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8Lz5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQ0EsU0FBUyxXQUFXLFFBQVEsZ0JBQWdCO0FBOFB4QyxTQXVSQSxV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

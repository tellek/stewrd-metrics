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
function LineChart({ api, labels, series, format, height = CHART_HEIGHT }) {
  const p = api.theme.palette;
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const L = 56, R = 12, T = 10, B = 22;
  const w = Math.max(1, width - L - R);
  const h = height - T - B;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const x = (i) => L + (n <= 1 ? w / 2 : i * w / (n - 1));
  const y = (v) => T + h - v / max * h;
  const runsOf = (values) => {
    const runs = [];
    let cur = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push(i);
    });
    if (cur.length) runs.push(cur);
    return runs;
  };
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = n <= 1 ? 0 : Math.round((e.clientX - r.left) / r.width * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };
  const xLabels = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
  const anchor = (i) => n <= 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle";
  const flip = hover !== null && x(hover) > width - 160;
  return /* @__PURE__ */ jsxs("div", { ref, style: { position: "relative", height }, children: [
    width > 0 && /* @__PURE__ */ jsxs("svg", { width, height, style: { display: "block", fontSize: 12 }, children: [
      [0, 0.5, 1].map((f) => /* @__PURE__ */ jsxs("g", { children: [
        /* @__PURE__ */ jsx("line", { x1: L, x2: L + w, y1: y(max * f), y2: y(max * f), stroke: p.border, strokeWidth: 1, strokeDasharray: f ? "2 4" : void 0 }),
        /* @__PURE__ */ jsx("text", { x: L - 6, y: y(max * f), dy: "0.32em", textAnchor: "end", fill: p.textMuted, children: format(max * f) })
      ] }, f)),
      xLabels.map((i) => /* @__PURE__ */ jsx("text", { x: x(i), y: height - 4, textAnchor: anchor(i), fill: p.textMuted, children: labels[i] }, i)),
      series.map((s) => {
        const runs = runsOf(s.values);
        const line = (run) => run.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(s.values[i])}`).join("");
        const lastKnown = [...s.values.keys()].reverse().find((i) => s.values[i] !== null);
        return /* @__PURE__ */ jsxs("g", { children: [
          runs.map(
            (run) => run.length > 1 ? /* @__PURE__ */ jsxs("g", { children: [
              series.length === 1 && /* @__PURE__ */ jsx("path", { d: `${line(run)}L${x(run[run.length - 1])},${y(0)}L${x(run[0])},${y(0)}Z`, fill: s.color, fillOpacity: 0.12 }),
              /* @__PURE__ */ jsx("path", { d: line(run), fill: "none", stroke: s.color, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" })
            ] }, run[0]) : /* @__PURE__ */ jsx("circle", { cx: x(run[0]), cy: y(s.values[run[0]]), r: 3, fill: s.color }, run[0])
          ),
          lastKnown !== void 0 && hover === null && /* @__PURE__ */ jsx("circle", { cx: x(lastKnown), cy: y(s.values[lastKnown]), r: 3.5, fill: s.color, stroke: p.surface, strokeWidth: 2 }),
          hover !== null && s.values[hover] !== null && /* @__PURE__ */ jsx("circle", { cx: x(hover), cy: y(s.values[hover]), r: 4.5, fill: s.color, stroke: p.surface, strokeWidth: 2, pointerEvents: "none" })
        ] }, s.name);
      }),
      hover !== null && /* @__PURE__ */ jsx("line", { x1: x(hover), x2: x(hover), y1: T, y2: T + h, stroke: p.textMuted, strokeWidth: 1, pointerEvents: "none" }),
      /* @__PURE__ */ jsx("rect", { x: L, y: 0, width: w, height, fill: "transparent", onMouseMove: onMove, onMouseLeave: () => setHover(null) })
    ] }),
    hover !== null && /* @__PURE__ */ jsxs(Tooltip, { p, x: x(hover) + (flip ? -10 : 10), y: T, flip, children: [
      /* @__PURE__ */ jsx("div", { style: { color: p.textMuted }, children: labels[hover] }),
      series.map((s) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
        series.length > 1 && /* @__PURE__ */ jsx("span", { style: { width: 8, height: 8, borderRadius: 2, background: s.color } }),
        series.length > 1 && /* @__PURE__ */ jsx("span", { style: { color: p.textMuted }, children: s.name }),
        /* @__PURE__ */ jsx("span", { children: s.values[hover] === null ? "Unknown" : format(s.values[hover]) })
      ] }, s.name))
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
  return /* @__PURE__ */ jsxs("div", { style: { ...scrollbarStyle(p), maxHeight: CHART_HEIGHT, overflowY: "auto", overflowX: "hidden", paddingRight: GAP }, onMouseLeave: () => setHover(null), children: [
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
      style: {
        minWidth: 0,
        boxSizing: "border-box",
        background: p.surface,
        border: `1px solid ${p.border}`,
        borderRadius: 6,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2
      },
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
  return /* @__PURE__ */ jsx(Fragment, { children: trends.map((t) => ({ t, points: days.map((d) => ({ label: shortDate(d.date), raw: t.get(d.doc) })) })).filter(({ points }) => points.some((pt) => pt.raw !== void 0)).map(({ t, points }) => /* @__PURE__ */ jsx(Section, { api, title: `${t.title} Trend`, children: /* @__PURE__ */ jsx(
    LineChart,
    {
      api,
      labels: points.map((pt) => pt.label),
      series: [{ name: t.title, color: api.theme.palette.accent, values: points.map((pt) => pt.raw ?? null) }],
      format: axisFmt(t.key)
    }
  ) }, t.title)) });
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
var OVERVIEW_ONLY_APPS = { SecretsManager: "Global Secrets Trend" };
function lambdaSum(app, field) {
  const lambdas = app?.monitoring?.lambdas;
  if (lambdas === void 0) return void 0;
  if (lambdas === null || isErrorNode(lambdas) || isErrorNode(app.monitoring)) return null;
  const vals = Object.values(lambdas).map((v) => metric(v, field));
  return vals.some((v) => typeof v !== "number") ? null : vals.reduce((a, b) => a + b, 0);
}
function InvocationsTrend({ api, days, appName, title }) {
  const p = api.theme.palette;
  const appDays = days.map((d) => ({ date: d.date, app: appsOf(d.doc).find((a) => a.name === appName) })).filter((d) => d.app);
  if (appDays.length === 0) return null;
  const series = [
    { name: "Invocations", color: p.accent, values: appDays.map((d) => lambdaSum(d.app, "invocations") ?? null) },
    { name: "Errors", color: p.status.error, values: appDays.map((d) => lambdaSum(d.app, "errors") ?? null) }
  ];
  return /* @__PURE__ */ jsx(Section, { api, title, extra: /* @__PURE__ */ jsx(Legend, { api, items: series }), children: /* @__PURE__ */ jsx(LineChart, { api, labels: appDays.map((d) => shortDate(d.date)), series, format: axisFmt("") }) });
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
      Object.entries(OVERVIEW_ONLY_APPS).map(([name, title]) => /* @__PURE__ */ jsx(InvocationsTrend, { api, days, appName: name, title }, name)),
      /* @__PURE__ */ jsx(Section, { api, title: "Apps", children: /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "auto 1fr max-content max-content max-content", gap: "4px 12px", alignItems: "center" }, children: [
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
      audKeys.map((k) => /* @__PURE__ */ jsx(Section, { api, title: `Daily ${titleCase(k)}`, children: /* @__PURE__ */ jsx(
        LineChart,
        {
          api,
          labels: audDays.map((d) => shortDate(String(d.date))),
          series: [{ name: titleCase(k), color: p.accent, values: audDays.map((d) => typeof d[k] === "number" ? d[k] : null) }],
          format: axisFmt(k)
        }
      ) }, k)),
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
  const tabApps = apps.filter((a) => !(a.name in OVERVIEW_ONLY_APPS));
  const current = tab === "overview" ? null : tabApps.find((a) => a.name === tab);
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
          tabs: [{ label: "Overview", value: "overview" }, ...tabApps.map((a) => ({ label: a.name, value: a.name }))],
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIGxvYWRpbmc6IGJvb2xlYW47XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UgfTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIHN0YXRlID0geyAuLi5zdGF0ZSwgLi4ucGF0Y2ggfTtcbiAgbGlzdGVuZXJzLmZvckVhY2goKGwpID0+IGwoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tXG5cbmNvbnN0IGlzRXJyb3JOb2RlID0gKHY6IEpzb24pOiBib29sZWFuID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHYuZXJyb3IgPT09IFwic3RyaW5nXCI7XG5cbmZ1bmN0aW9uIGhhc0Vycm9yTm9kZSh2OiBKc29uKTogYm9vbGVhbiB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIHRydWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIGlmICh2ICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiKSByZXR1cm4gT2JqZWN0LnZhbHVlcyh2KS5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgbW9uZXkgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IHN0eWxlOiBcImN1cnJlbmN5XCIsIGN1cnJlbmN5OiBcIlVTRFwiIH0pO1xuY29uc3QgY29tcGFjdCA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgbm90YXRpb246IFwiY29tcGFjdFwiLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG5jb25zdCBNT05FWV9LRVkgPSAvKG1ycnxwcm9maXR8Y29zdHxhbW91bnR8cmV2ZW51ZSkvaTtcblxuLyoqIFNpbmdsZSBmb3JtYXR0ZXI6IG51bGwvdW5kZWZpbmVkL2Vycm9yIG5vZGVzIGFyZSBcIlVua25vd25cIiwgbmV2ZXIgemVyby4gKi9cbmZ1bmN0aW9uIGZtdCh2OiBKc29uLCBrZXkgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gXCJVbmtub3duXCI7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIGBVbmtub3duICgke3YuZXJyb3J9KWA7XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChNT05FWV9LRVkudGVzdChrZXkpKSByZXR1cm4gbW9uZXkuZm9ybWF0KHYpO1xuICAgIGlmICgvbGF0ZW5jeW1zL2kudGVzdChrZXkpKSByZXR1cm4gYCR7TWF0aC5yb3VuZCh2KX0gbXNgO1xuICAgIHJldHVybiB2LnRvTG9jYWxlU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHR5cGVvZiB2ID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xuICByZXR1cm4gU3RyaW5nKHYpO1xufVxuXG4vKiogVGFibGUgY2VsbDogXCItXCIgd2hlbiB0aGUgYXBwIGhhcyBubyBzdWNoIG1ldHJpYywgb3RoZXJ3aXNlIGZtdCAoc28gdW5rbm93biBzdGF5cyBcIlVua25vd25cIikuICovXG5jb25zdCBjZWxsID0gKHY6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIGtleSA9IFwiXCIpID0+ICh2ID09PSB1bmRlZmluZWQgPyBcIi1cIiA6IGZtdCh2LCBrZXkpKTtcblxuY29uc3QgYXhpc0ZtdCA9IChrZXk6IHN0cmluZykgPT4gKG46IG51bWJlcikgPT4gKE1PTkVZX0tFWS50ZXN0KGtleSkgPyBtb25leS5mb3JtYXQobikgOiBjb21wYWN0LmZvcm1hdChuKSk7XG5cbmZ1bmN0aW9uIGFnZUhvdXJzKGlzbzogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgbnVsbCB7XG4gIGNvbnN0IHQgPSBpc28gPyBEYXRlLnBhcnNlKGlzbykgOiBOYU47XG4gIHJldHVybiBOdW1iZXIuaXNOYU4odCkgPyBudWxsIDogKERhdGUubm93KCkgLSB0KSAvIDNfNjAwXzAwMDtcbn1cblxuY29uc3Qgc2hvcnREYXRlID0gKGQ6IHN0cmluZykgPT4gbmV3IERhdGUoYCR7ZH1UMDA6MDA6MDBaYCkudG9Mb2NhbGVEYXRlU3RyaW5nKHVuZGVmaW5lZCwgeyBtb250aDogXCJzaG9ydFwiLCBkYXk6IFwibnVtZXJpY1wiLCB0aW1lWm9uZTogXCJVVENcIiB9KTtcblxuY29uc3QgYXBwc09mID0gKGRvYzogSnNvbik6IEpzb25bXSA9PiAoZG9jICYmIEFycmF5LmlzQXJyYXkoZG9jLmFwcHMpID8gZG9jLmFwcHMgOiBbXSk7XG5cbi8qKiBXYWxrcyBhIGRvdHRlZCBwYXRoLiB1bmRlZmluZWQgPSBub3QgcHJlc2VudCwgbnVsbCA9IHVua25vd24gKGVycm9yIG5vZGUgb3IgbnVsbCksIG51bWJlciA9IHZhbHVlLiAqL1xuZnVuY3Rpb24gbWV0cmljKG86IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBsZXQgdiA9IG87XG4gIGZvciAoY29uc3QgayBvZiBwYXRoLnNwbGl0KFwiLlwiKSkge1xuICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHYgPT09IG51bGwgfHwgaXNFcnJvck5vZGUodikpIHJldHVybiBudWxsO1xuICAgIHYgPSB2W2tdO1xuICB9XG4gIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodikgPyB2IDogbnVsbDtcbn1cblxuLyoqIFN1bXMgYSBtZXRyaWMgYWNyb3NzIGFwcHM7IGFueSB1bmtub3duIGFwcCB2YWx1ZSBtYWtlcyB0aGUgdG90YWwgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIHN1bUFwcHMoZG9jOiBKc29uLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFkb2MgfHwgaXNFcnJvck5vZGUoZG9jLmFwcHMpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IGFwcHNPZihkb2MpXG4gICAgLm1hcCgoYSkgPT4gbWV0cmljKGEsIHBhdGgpKVxuICAgIC5maWx0ZXIoKHYpID0+IHYgIT09IHVuZGVmaW5lZCk7XG4gIGlmICh2YWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdiA9PT0gbnVsbCkgPyBudWxsIDogKHZhbHMgYXMgbnVtYmVyW10pLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xufVxuXG5mdW5jdGlvbiBhcHBTdGF0dXMoYXBwOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBpZiAoaGFzRXJyb3JOb2RlKGFwcCkpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKChhcHAuaGVhbHRoPy5hbGFybXM/LmluQWxhcm0gPz8gMCkgPiAwKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICgoYXBwLmhlYWx0aD8uZnJlc2huZXNzPy5zdGFsZVN0YXRlcyA/PyAwKSA+IDApIHJldHVybiBcIndhcm5pbmdcIjtcbiAgcmV0dXJuIFwic3VjY2Vzc1wiO1xufVxuXG5jb25zdCBXT1JTVDogU3RhdHVzQ29sb3JbXSA9IFtcImlkbGVcIiwgXCJzdWNjZXNzXCIsIFwid2FybmluZ1wiLCBcImVycm9yXCJdO1xuY29uc3Qgd29yc3QgPSAoY3M6IFN0YXR1c0NvbG9yW10pOiBTdGF0dXNDb2xvciA9PiBjcy5yZWR1Y2UoKGEsIGIpID0+IChXT1JTVC5pbmRleE9mKGIpID4gV09SU1QuaW5kZXhPZihhKSA/IGIgOiBhKSwgXCJzdWNjZXNzXCIgYXMgU3RhdHVzQ29sb3IpO1xuXG5mdW5jdGlvbiBkb2NTdGF0dXMoZG9jOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBjb25zdCBhZ2UgPSBhZ2VIb3Vycyhkb2MuZ2VuZXJhdGVkQXQpO1xuICBjb25zdCBzdGFsZSA9IGFnZSA9PT0gbnVsbCB8fCBhZ2UgPiBTVEFMRV9IT1VSUztcbiAgY29uc3Qgc3RhdHVzID0gd29yc3QoYXBwc09mKGRvYykubWFwKGFwcFN0YXR1cykpO1xuICByZXR1cm4gc3RhbGUgfHwgaGFzRXJyb3JOb2RlKGRvYykgPyB3b3JzdChbc3RhdHVzLCBcIndhcm5pbmdcIl0pIDogc3RhdHVzO1xufVxuXG4vKiogSGlzdG9yeSBwbHVzIHRoZSBsYXRlc3QgZG9jdW1lbnQsIG9uZSBlbnRyeSBwZXIgVVRDIGRhdGUsIG9sZGVzdCBmaXJzdC4gKi9cbmZ1bmN0aW9uIGFsbERheXMoKTogRGF5W10ge1xuICBjb25zdCBtID0gbmV3IE1hcChzdGF0ZS5oaXN0b3J5Lm1hcCgoZCkgPT4gW2QuZGF0ZSwgZC5kb2NdKSk7XG4gIGlmICh0eXBlb2Ygc3RhdGUuZGF0YT8uZ2VuZXJhdGVkQXQgPT09IFwic3RyaW5nXCIpIG0uc2V0KHN0YXRlLmRhdGEuZ2VuZXJhdGVkQXQuc2xpY2UoMCwgMTApLCBzdGF0ZS5kYXRhKTtcbiAgcmV0dXJuIFsuLi5tLmVudHJpZXMoKV0uc29ydCgoW2FdLCBbYl0pID0+IChhIDwgYiA/IC0xIDogMSkpLm1hcCgoW2RhdGUsIGRvY10pID0+ICh7IGRhdGUsIGRvYyB9KSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gZmV0Y2hpbmcgLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBhd3NBcmdzKGFwaTogUGx1Z2luQXBpLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgcyA9IGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCk7XG4gIGNvbnN0IG91dCA9IFsuLi5hcmdzLCBcIi0tY2xpLWNvbm5lY3QtdGltZW91dFwiLCBcIjEwXCIsIFwiLS1jbGktcmVhZC10aW1lb3V0XCIsIFwiMTVcIl07XG4gIGlmIChzLmF3c1Byb2ZpbGUpIG91dC5wdXNoKFwiLS1wcm9maWxlXCIsIHMuYXdzUHJvZmlsZSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGF3cyhhcGk6IFBsdWdpbkFwaSwgYXJnczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXMgPSBhd2FpdCBhcGkuc2hlbGwuZXhlYyhcImF3c1wiLCBhd2FpdCBhd3NBcmdzKGFwaSwgYXJncykpO1xuICBpZiAocmVzLmNvZGUgIT09IDApIHRocm93IG5ldyBFcnJvcihyZXMuc3RkZXJyLnRyaW0oKSB8fCBgYXdzIGV4aXRlZCB3aXRoIGNvZGUgJHtyZXMuY29kZX1gKTtcbiAgcmV0dXJuIHJlcy5zdGRvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRIaXN0b3J5KGFwaTogUGx1Z2luQXBpKSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhcGkuZnMubGlzdERpcihISVNUT1JZX0RJUik7XG4gIGNvbnN0IGZpbGVzID0gZW50cmllc1xuICAgIC5maWx0ZXIoKGUpID0+ICFlLmlzRGlyICYmIC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1cXC5qc29uJC8udGVzdChlLm5hbWUpKVxuICAgIC5tYXAoKGUpID0+IGUubmFtZSlcbiAgICAuc29ydCgpXG4gICAgLnNsaWNlKC1NQVhfREFZUyk7XG4gIGNvbnN0IGRvY3MgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBmaWxlcy5tYXAoYXN5bmMgKGYpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IGFwaS5mcy5yZWFkVGV4dEZpbGUoYCR7SElTVE9SWV9ESVJ9LyR7Zn1gKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSksXG4gICk7XG4gIHNldFN0YXRlKHsgaGlzdG9yeTogZmlsZXMubWFwKChmLCBpKSA9PiAoeyBkYXRlOiBmLnNsaWNlKDAsIDEwKSwgZG9jOiBkb2NzW2ldIH0pKS5maWx0ZXIoKGQpID0+IGQuZG9jKSB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY0hpc3RvcnkoYXBpOiBQbHVnaW5BcGksIGJ1Y2tldDogc3RyaW5nKSB7XG4gIGNvbnN0IHJvb3QgPSAoYXdhaXQgYXBpLmZzLmdldFJvb3RQYXRoKCkpLnJlcGxhY2UoL1tcXFxcL10rJC8sIFwiXCIpO1xuICBhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcInN5bmNcIiwgYHMzOi8vJHtidWNrZXR9LyR7SElTVE9SWV9ESVJ9L2AsIGAke3Jvb3R9LyR7SElTVE9SWV9ESVJ9YCwgXCItLW9ubHktc2hvdy1lcnJvcnNcIl0pO1xuICBhd2FpdCBsb2FkSGlzdG9yeShhcGkpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoKGFwaTogUGx1Z2luQXBpLCBzaWduYWw/OiBBYm9ydFNpZ25hbCkge1xuICBpZiAoc3RhdGUubG9hZGluZykgcmV0dXJuO1xuICBzZXRTdGF0ZSh7IGxvYWRpbmc6IHRydWUgfSk7XG4gIGNvbnN0IHNldEljb24gPSAoYzogU3RhdHVzQ29sb3IsIHRpcD86IHN0cmluZykgPT4ge1xuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXBpLnN0YXR1c0ljb24uc2V0KGMsIHRpcCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBkZWFjdGl2YXRlZCAqL1xuICAgIH1cbiAgfTtcbiAgY29uc3QgbG9nID0gKGxldmVsOiBcIndhcm5cIiB8IFwiZXJyb3JcIiwgbXNnOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoc2lnbmFsPy5hYm9ydGVkKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGFwaS5sb2dbbGV2ZWxdKGAke05BTUV9OiAke21zZ31gKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGRlYWN0aXZhdGVkICovXG4gICAgfVxuICB9O1xuICBzZXRJY29uKFwiaW4tcHJvZ3Jlc3NcIiwgXCJSZWZyZXNoaW5nXCIpO1xuICB0cnkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IChhd2FpdCBhcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpKS5idWNrZXQgfHwgREVGQVVMVF9CVUNLRVQ7XG4gICAgY29uc3QgZGF0YSA9IEpTT04ucGFyc2UoYXdhaXQgYXdzKGFwaSwgW1wiczNcIiwgXCJjcFwiLCBgczM6Ly8ke2J1Y2tldH0vbWV0cmljcy5qc29uYCwgXCItXCJdKSk7XG4gICAgYXdhaXQgYXBpLnN0b3JhZ2Uuc2V0KENBQ0hFX0tFWSwgZGF0YSk7XG4gICAgc2V0U3RhdGUoeyBkYXRhLCBlcnJvcjogbnVsbCB9KTtcbiAgICBsZXQgc3RhdHVzID0gZG9jU3RhdHVzKGRhdGEpO1xuICAgIGxldCB0aXAgPSBzdGF0dXMgPT09IFwic3VjY2Vzc1wiID8gXCJNZXRyaWNzIHVwIHRvIGRhdGVcIiA6IFwiTWV0cmljcyBuZWVkIGF0dGVudGlvblwiO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzeW5jSGlzdG9yeShhcGksIGJ1Y2tldCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc3QgbXNnID0gZSBpbnN0YW5jZW9mIEVycm9yID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpO1xuICAgICAgbG9nKFwid2FyblwiLCBgaGlzdG9yeSBzeW5jIGZhaWxlZDogJHttc2d9YCk7XG4gICAgICBzdGF0dXMgPSB3b3JzdChbc3RhdHVzLCBcIndhcm5pbmdcIl0pO1xuICAgICAgdGlwID0gYEhpc3Rvcnkgc3luYyBmYWlsZWQ6ICR7bXNnfWA7XG4gICAgfVxuICAgIHNldFN0YXRlKHsgbG9hZGluZzogZmFsc2UgfSk7XG4gICAgc2V0SWNvbihzdGF0dXMsIHRpcCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCBtc2cgPSBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSk7XG4gICAgc2V0U3RhdGUoeyBlcnJvcjogbXNnLCBsb2FkaW5nOiBmYWxzZSB9KTtcbiAgICBzZXRJY29uKFwiZXJyb3JcIiwgbXNnKTtcbiAgICBsb2coXCJlcnJvclwiLCBtc2cpO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhY3RpdmF0ZShjdHg6IFBsdWdpbkNvbnRleHQpIHtcbiAgY3R4LmFwaS5zdGF0dXNJY29uLnNldChcImlkbGVcIik7XG4gIGNvbnN0IHMgPSBhd2FpdCBjdHguYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKTtcbiAgY29uc3QgbWludXRlcyA9IE1hdGgubWF4KDEsIHMucmVmcmVzaE1pbnV0ZXMgPz8gNjApO1xuICBjdHgudGljay5yZWdpc3RlcigoKSA9PiByZWZyZXNoKGN0eC5hcGksIGN0eC5zaWduYWwpKTtcbiAgY3R4LnRpY2suc2V0SW50ZXJ2YWwobWludXRlcyAqIDYwXzAwMCk7XG4gIGN0eC5hcGkubG9nLmluZm8oYCR7TkFNRX0gYWN0aXZhdGVkYCk7XG4gIHZvaWQgbG9hZEhpc3RvcnkoY3R4LmFwaSkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgdm9pZCByZWZyZXNoKGN0eC5hcGksIGN0eC5zaWduYWwpO1xufVxuXG4vLyAtLS0tLS0tLS0tIGNoYXJ0IHByaW1pdGl2ZXMgLS0tLS0tLS0tLVxuXG5jb25zdCBDSEFSVF9IRUlHSFQgPSAxNzA7XG5cbmNvbnN0IHNjcm9sbGJhclN0eWxlID0gKHA6IFBhbGV0dGUpOiBDU1NQcm9wZXJ0aWVzID0+ICh7IHNjcm9sbGJhcldpZHRoOiBcInRoaW5cIiwgc2Nyb2xsYmFyQ29sb3I6IGAke3AuYm9yZGVyfSAke3Auc3VyZmFjZX1gIH0pO1xuXG5mdW5jdGlvbiB1c2VXaWR0aCgpIHtcbiAgY29uc3QgcmVmID0gdXNlUmVmPEhUTUxEaXZFbGVtZW50PihudWxsKTtcbiAgY29uc3QgW3dpZHRoLCBzZXRXaWR0aF0gPSB1c2VTdGF0ZSgwKTtcbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBlbCA9IHJlZi5jdXJyZW50O1xuICAgIGlmICghZWwpIHJldHVybjtcbiAgICBjb25zdCBybyA9IG5ldyBSZXNpemVPYnNlcnZlcigoW2VdKSA9PiBzZXRXaWR0aChlLmNvbnRlbnRSZWN0LndpZHRoKSk7XG4gICAgcm8ub2JzZXJ2ZShlbCk7XG4gICAgcmV0dXJuICgpID0+IHJvLmRpc2Nvbm5lY3QoKTtcbiAgfSwgW10pO1xuICByZXR1cm4gW3JlZiwgd2lkdGhdIGFzIGNvbnN0O1xufVxuXG5mdW5jdGlvbiBuaWNlTWF4KHY6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICh2IDw9IDApIHJldHVybiAxO1xuICBjb25zdCBwID0gMTAgKiogTWF0aC5mbG9vcihNYXRoLmxvZzEwKHYpKTtcbiAgY29uc3QgbiA9IHYgLyBwO1xuICByZXR1cm4gKG4gPD0gMSA/IDEgOiBuIDw9IDIgPyAyIDogbiA8PSA1ID8gNSA6IDEwKSAqIHA7XG59XG5cbmZ1bmN0aW9uIFRvb2x0aXAoeyBwLCB4LCB5LCBmbGlwLCBmaXhlZCwgY2hpbGRyZW4gfTogeyBwOiBQYWxldHRlOyB4OiBudW1iZXI7IHk6IG51bWJlcjsgZmxpcDogYm9vbGVhbjsgZml4ZWQ/OiBib29sZWFuOyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBwb3NpdGlvbjogZml4ZWQgPyBcImZpeGVkXCIgOiBcImFic29sdXRlXCIsXG4gICAgICAgIGxlZnQ6IHgsXG4gICAgICAgIHRvcDogeSxcbiAgICAgICAgdHJhbnNmb3JtOiBmbGlwID8gXCJ0cmFuc2xhdGVYKC0xMDAlKVwiIDogdW5kZWZpbmVkLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLmJhY2tncm91bmQsXG4gICAgICAgIGNvbG9yOiBwLnRleHQsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNCxcbiAgICAgICAgcGFkZGluZzogXCI0cHggOHB4XCIsXG4gICAgICAgIGZvbnRTaXplOiAxMixcbiAgICAgICAgbGluZUhlaWdodDogXCIxOHB4XCIsXG4gICAgICAgIHdoaXRlU3BhY2U6IFwibm93cmFwXCIsXG4gICAgICAgIHBvaW50ZXJFdmVudHM6IFwibm9uZVwiLFxuICAgICAgICB6SW5kZXg6IDEsXG4gICAgICB9fVxuICAgID5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuaW50ZXJmYWNlIFNlcmllcyB7XG4gIG5hbWU6IHN0cmluZztcbiAgY29sb3I6IHN0cmluZztcbiAgdmFsdWVzOiAobnVtYmVyIHwgbnVsbClbXTtcbn1cblxuLyoqIExpbmUgY2hhcnQgb3ZlciB0aW1lIG9uIG9uZSBzaGFyZWQgYXhpcy4gVW5rbm93biAobnVsbCkgcG9pbnRzIGJyZWFrIGEgbGluZSBpbnN0ZWFkIG9mIGRyb3BwaW5nIHRvIHplcm87IGEgbG9uZSBzZXJpZXMgYWxzbyBnZXRzIGFuIGFyZWEgZmlsbC4gKi9cbmZ1bmN0aW9uIExpbmVDaGFydCh7IGFwaSwgbGFiZWxzLCBzZXJpZXMsIGZvcm1hdCwgaGVpZ2h0ID0gQ0hBUlRfSEVJR0hUIH06IHsgYXBpOiBQbHVnaW5BcGk7IGxhYmVsczogc3RyaW5nW107IHNlcmllczogU2VyaWVzW107IGZvcm1hdDogKG46IG51bWJlcikgPT4gc3RyaW5nOyBoZWlnaHQ/OiBudW1iZXIgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IFtob3Zlciwgc2V0SG92ZXJdID0gdXNlU3RhdGU8bnVtYmVyIHwgbnVsbD4obnVsbCk7XG4gIGNvbnN0IEwgPSA1NixcbiAgICBSID0gMTIsXG4gICAgVCA9IDEwLFxuICAgIEIgPSAyMjtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDEsIHdpZHRoIC0gTCAtIFIpO1xuICBjb25zdCBoID0gaGVpZ2h0IC0gVCAtIEI7XG4gIGNvbnN0IG4gPSBsYWJlbHMubGVuZ3RoO1xuICBjb25zdCBtYXggPSBuaWNlTWF4KE1hdGgubWF4KDAsIC4uLnNlcmllcy5mbGF0TWFwKChzKSA9PiBzLnZhbHVlcy5tYXAoKHYpID0+IHYgPz8gMCkpKSk7XG4gIGNvbnN0IHggPSAoaTogbnVtYmVyKSA9PiBMICsgKG4gPD0gMSA/IHcgLyAyIDogKGkgKiB3KSAvIChuIC0gMSkpO1xuICBjb25zdCB5ID0gKHY6IG51bWJlcikgPT4gVCArIGggLSAodiAvIG1heCkgKiBoO1xuXG4gIGNvbnN0IHJ1bnNPZiA9ICh2YWx1ZXM6IChudW1iZXIgfCBudWxsKVtdKSA9PiB7XG4gICAgY29uc3QgcnVuczogbnVtYmVyW11bXSA9IFtdO1xuICAgIGxldCBjdXI6IG51bWJlcltdID0gW107XG4gICAgdmFsdWVzLmZvckVhY2goKHYsIGkpID0+IHtcbiAgICAgIGlmICh2ID09PSBudWxsKSB7XG4gICAgICAgIGlmIChjdXIubGVuZ3RoKSBydW5zLnB1c2goY3VyKTtcbiAgICAgICAgY3VyID0gW107XG4gICAgICB9IGVsc2UgY3VyLnB1c2goaSk7XG4gICAgfSk7XG4gICAgaWYgKGN1ci5sZW5ndGgpIHJ1bnMucHVzaChjdXIpO1xuICAgIHJldHVybiBydW5zO1xuICB9O1xuXG4gIGNvbnN0IG9uTW92ZSA9IChlOiBNb3VzZUV2ZW50PFNWR1JlY3RFbGVtZW50PikgPT4ge1xuICAgIGNvbnN0IHIgPSBlLmN1cnJlbnRUYXJnZXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgaSA9IG4gPD0gMSA/IDAgOiBNYXRoLnJvdW5kKCgoZS5jbGllbnRYIC0gci5sZWZ0KSAvIHIud2lkdGgpICogKG4gLSAxKSk7XG4gICAgc2V0SG92ZXIoTWF0aC5taW4obiAtIDEsIE1hdGgubWF4KDAsIGkpKSk7XG4gIH07XG5cbiAgY29uc3QgeExhYmVscyA9IG4gPD0gMSA/IFswXSA6IG4gPT09IDIgPyBbMCwgMV0gOiBbMCwgTWF0aC5mbG9vcigobiAtIDEpIC8gMiksIG4gLSAxXTtcbiAgY29uc3QgYW5jaG9yID0gKGk6IG51bWJlcikgPT4gKG4gPD0gMSA/IFwibWlkZGxlXCIgOiBpID09PSAwID8gXCJzdGFydFwiIDogaSA9PT0gbiAtIDEgPyBcImVuZFwiIDogXCJtaWRkbGVcIik7XG4gIGNvbnN0IGZsaXAgPSBob3ZlciAhPT0gbnVsbCAmJiB4KGhvdmVyKSA+IHdpZHRoIC0gMTYwO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiByZWY9e3JlZn0gc3R5bGU9e3sgcG9zaXRpb246IFwicmVsYXRpdmVcIiwgaGVpZ2h0IH19PlxuICAgICAge3dpZHRoID4gMCAmJiAoXG4gICAgICAgIDxzdmcgd2lkdGg9e3dpZHRofSBoZWlnaHQ9e2hlaWdodH0gc3R5bGU9e3sgZGlzcGxheTogXCJibG9ja1wiLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAge1swLCAwLjUsIDFdLm1hcCgoZikgPT4gKFxuICAgICAgICAgICAgPGcga2V5PXtmfT5cbiAgICAgICAgICAgICAgPGxpbmUgeDE9e0x9IHgyPXtMICsgd30geTE9e3kobWF4ICogZil9IHkyPXt5KG1heCAqIGYpfSBzdHJva2U9e3AuYm9yZGVyfSBzdHJva2VXaWR0aD17MX0gc3Ryb2tlRGFzaGFycmF5PXtmID8gXCIyIDRcIiA6IHVuZGVmaW5lZH0gLz5cbiAgICAgICAgICAgICAgPHRleHQgeD17TCAtIDZ9IHk9e3kobWF4ICogZil9IGR5PVwiMC4zMmVtXCIgdGV4dEFuY2hvcj1cImVuZFwiIGZpbGw9e3AudGV4dE11dGVkfT5cbiAgICAgICAgICAgICAgICB7Zm9ybWF0KG1heCAqIGYpfVxuICAgICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgICA8L2c+XG4gICAgICAgICAgKSl9XG4gICAgICAgICAge3hMYWJlbHMubWFwKChpKSA9PiAoXG4gICAgICAgICAgICA8dGV4dCBrZXk9e2l9IHg9e3goaSl9IHk9e2hlaWdodCAtIDR9IHRleHRBbmNob3I9e2FuY2hvcihpKX0gZmlsbD17cC50ZXh0TXV0ZWR9PlxuICAgICAgICAgICAgICB7bGFiZWxzW2ldfVxuICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICkpfVxuICAgICAgICAgIHtzZXJpZXMubWFwKChzKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBydW5zID0gcnVuc09mKHMudmFsdWVzKTtcbiAgICAgICAgICAgIGNvbnN0IGxpbmUgPSAocnVuOiBudW1iZXJbXSkgPT4gcnVuLm1hcCgoaSwgaykgPT4gYCR7ayA/IFwiTFwiIDogXCJNXCJ9JHt4KGkpfSwke3kocy52YWx1ZXNbaV0gYXMgbnVtYmVyKX1gKS5qb2luKFwiXCIpO1xuICAgICAgICAgICAgY29uc3QgbGFzdEtub3duID0gWy4uLnMudmFsdWVzLmtleXMoKV0ucmV2ZXJzZSgpLmZpbmQoKGkpID0+IHMudmFsdWVzW2ldICE9PSBudWxsKTtcbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgIDxnIGtleT17cy5uYW1lfT5cbiAgICAgICAgICAgICAgICB7cnVucy5tYXAoKHJ1bikgPT5cbiAgICAgICAgICAgICAgICAgIHJ1bi5sZW5ndGggPiAxID8gKFxuICAgICAgICAgICAgICAgICAgICA8ZyBrZXk9e3J1blswXX0+XG4gICAgICAgICAgICAgICAgICAgICAge3Nlcmllcy5sZW5ndGggPT09IDEgJiYgPHBhdGggZD17YCR7bGluZShydW4pfUwke3gocnVuW3J1bi5sZW5ndGggLSAxXSl9LCR7eSgwKX1MJHt4KHJ1blswXSl9LCR7eSgwKX1aYH0gZmlsbD17cy5jb2xvcn0gZmlsbE9wYWNpdHk9ezAuMTJ9IC8+fVxuICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9e2xpbmUocnVuKX0gZmlsbD1cIm5vbmVcIiBzdHJva2U9e3MuY29sb3J9IHN0cm9rZVdpZHRoPXsyfSBzdHJva2VMaW5lam9pbj1cInJvdW5kXCIgc3Ryb2tlTGluZWNhcD1cInJvdW5kXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgPGNpcmNsZSBrZXk9e3J1blswXX0gY3g9e3gocnVuWzBdKX0gY3k9e3kocy52YWx1ZXNbcnVuWzBdXSBhcyBudW1iZXIpfSByPXszfSBmaWxsPXtzLmNvbG9yfSAvPlxuICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIHtsYXN0S25vd24gIT09IHVuZGVmaW5lZCAmJiBob3ZlciA9PT0gbnVsbCAmJiAoXG4gICAgICAgICAgICAgICAgICA8Y2lyY2xlIGN4PXt4KGxhc3RLbm93bil9IGN5PXt5KHMudmFsdWVzW2xhc3RLbm93bl0gYXMgbnVtYmVyKX0gcj17My41fSBmaWxsPXtzLmNvbG9yfSBzdHJva2U9e3Auc3VyZmFjZX0gc3Ryb2tlV2lkdGg9ezJ9IC8+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICB7aG92ZXIgIT09IG51bGwgJiYgcy52YWx1ZXNbaG92ZXJdICE9PSBudWxsICYmIChcbiAgICAgICAgICAgICAgICAgIDxjaXJjbGUgY3g9e3goaG92ZXIpfSBjeT17eShzLnZhbHVlc1tob3Zlcl0gYXMgbnVtYmVyKX0gcj17NC41fSBmaWxsPXtzLmNvbG9yfSBzdHJva2U9e3Auc3VyZmFjZX0gc3Ryb2tlV2lkdGg9ezJ9IHBvaW50ZXJFdmVudHM9XCJub25lXCIgLz5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pfVxuICAgICAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiA8bGluZSB4MT17eChob3Zlcil9IHgyPXt4KGhvdmVyKX0geTE9e1R9IHkyPXtUICsgaH0gc3Ryb2tlPXtwLnRleHRNdXRlZH0gc3Ryb2tlV2lkdGg9ezF9IHBvaW50ZXJFdmVudHM9XCJub25lXCIgLz59XG4gICAgICAgICAgPHJlY3QgeD17TH0geT17MH0gd2lkdGg9e3d9IGhlaWdodD17aGVpZ2h0fSBmaWxsPVwidHJhbnNwYXJlbnRcIiBvbk1vdXNlTW92ZT17b25Nb3ZlfSBvbk1vdXNlTGVhdmU9eygpID0+IHNldEhvdmVyKG51bGwpfSAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgICl9XG4gICAgICB7aG92ZXIgIT09IG51bGwgJiYgKFxuICAgICAgICA8VG9vbHRpcCBwPXtwfSB4PXt4KGhvdmVyKSArIChmbGlwID8gLTEwIDogMTApfSB5PXtUfSBmbGlwPXtmbGlwfT5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57bGFiZWxzW2hvdmVyXX08L2Rpdj5cbiAgICAgICAgICB7c2VyaWVzLm1hcCgocykgPT4gKFxuICAgICAgICAgICAgPGRpdiBrZXk9e3MubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGdhcDogNiB9fT5cbiAgICAgICAgICAgICAge3Nlcmllcy5sZW5ndGggPiAxICYmIDxzcGFuIHN0eWxlPXt7IHdpZHRoOiA4LCBoZWlnaHQ6IDgsIGJvcmRlclJhZGl1czogMiwgYmFja2dyb3VuZDogcy5jb2xvciB9fSAvPn1cbiAgICAgICAgICAgICAge3Nlcmllcy5sZW5ndGggPiAxICYmIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57cy5uYW1lfTwvc3Bhbj59XG4gICAgICAgICAgICAgIDxzcGFuPntzLnZhbHVlc1tob3Zlcl0gPT09IG51bGwgPyBcIlVua25vd25cIiA6IGZvcm1hdChzLnZhbHVlc1tob3Zlcl0gYXMgbnVtYmVyKX08L3NwYW4+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICApKX1cbiAgICAgICAgPC9Ub29sdGlwPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuaW50ZXJmYWNlIFNlZyB7XG4gIG5hbWU6IHN0cmluZztcbiAgdmFsdWU6IG51bWJlcjtcbiAgY29sb3I6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEJhclJvdyB7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHNlZ21lbnRzOiBTZWdbXTtcbiAgdmFsdWVUZXh0OiBzdHJpbmc7XG4gIHRpcDogc3RyaW5nW107XG59XG5cbmZ1bmN0aW9uIExlZ2VuZCh7IGFwaSwgaXRlbXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgaXRlbXM6IHsgbmFtZTogc3RyaW5nOyBjb2xvcjogc3RyaW5nIH1bXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBnYXA6IDE2LCBmbGV4V3JhcDogXCJ3cmFwXCIsIGZvbnRTaXplOiAxMiwgY29sb3I6IHAudGV4dE11dGVkIH19PlxuICAgICAge2l0ZW1zLm1hcCgoaXQpID0+IChcbiAgICAgICAgPHNwYW4ga2V5PXtpdC5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImlubGluZS1mbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGdhcDogNiB9fT5cbiAgICAgICAgICA8c3BhbiBzdHlsZT17eyB3aWR0aDogMTAsIGhlaWdodDogMTAsIGJvcmRlclJhZGl1czogMiwgYmFja2dyb3VuZDogaXQuY29sb3IgfX0gLz5cbiAgICAgICAgICB7aXQubmFtZX1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgKSl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbi8qKiBIb3Jpem9udGFsIChvcHRpb25hbGx5IHN0YWNrZWQpIGJhcnMgc2hhcmluZyBvbmUgc2NhbGUsIHZhbHVlIGxhYmVscyBhdCB0aGUgZW5kLiBTY3JvbGxzIHBhc3QgQkFSX0xJU1RfSEVJR0hULiAqL1xuZnVuY3Rpb24gQmFyTGlzdCh7IGFwaSwgcm93cyB9OiB7IGFwaTogUGx1Z2luQXBpOyByb3dzOiBCYXJSb3dbXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTx7IGk6IG51bWJlcjsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSB8IG51bGw+KG51bGwpO1xuICBjb25zdCBtYXggPSBNYXRoLm1heCgwLCAuLi5yb3dzLm1hcCgocikgPT4gci5zZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKSkpIHx8IDE7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT5Ob25lPC9zcGFuPjtcbiAgY29uc3QgZmxpcCA9IGhvdmVyICE9PSBudWxsICYmIGhvdmVyLnggPiB3aW5kb3cuaW5uZXJXaWR0aCAtIDIwMDtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IC4uLnNjcm9sbGJhclN0eWxlKHApLCBtYXhIZWlnaHQ6IENIQVJUX0hFSUdIVCwgb3ZlcmZsb3dZOiBcImF1dG9cIiwgb3ZlcmZsb3dYOiBcImhpZGRlblwiLCBwYWRkaW5nUmlnaHQ6IEdBUCB9fSBvbk1vdXNlTGVhdmU9eygpID0+IHNldEhvdmVyKG51bGwpfT5cbiAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwibWlubWF4KDAsIG1heC1jb250ZW50KSAxZnIgbWF4LWNvbnRlbnRcIiwgZ2FwOiBcIjJweCAxMnB4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGZvbnRTaXplOiAxNCB9fT5cbiAgICAgICAge3Jvd3MubWFwKChyLCBpKSA9PiB7XG4gICAgICAgICAgY29uc3QgdG90YWwgPSByLnNlZ21lbnRzLnJlZHVjZSgoYSwgcykgPT4gYSArIHMudmFsdWUsIDApO1xuICAgICAgICAgIGNvbnN0IGhvdCA9IGhvdmVyPy5pID09PSBpO1xuICAgICAgICAgIGNvbnN0IGNlbGw6IENTU1Byb3BlcnRpZXMgPSB7IGJhY2tncm91bmQ6IGhvdCA/IHAuc3VyZmFjZUhvdmVyIDogdW5kZWZpbmVkLCBwYWRkaW5nOiBcIjJweCAwXCIgfTtcbiAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgPGRpdiBrZXk9e3IubGFiZWx9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fSBvbk1vdXNlTW92ZT17KGUpID0+IHNldEhvdmVyKHsgaSwgeDogZS5jbGllbnRYLCB5OiBlLmNsaWVudFkgfSl9PlxuICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyAuLi5jZWxsLCBjb2xvcjogaG90ID8gcC5hY2NlbnQgOiBwLnRleHQsIG1heFdpZHRoOiAyMjAsIG92ZXJmbG93OiBcImhpZGRlblwiLCB0ZXh0T3ZlcmZsb3c6IFwiZWxsaXBzaXNcIiwgd2hpdGVTcGFjZTogXCJub3dyYXBcIiB9fSB0aXRsZT17ci5sYWJlbH0+XG4gICAgICAgICAgICAgICAge3IubGFiZWx9XG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICAgPGRpdiBzdHlsZT17eyAuLi5jZWxsLCBkaXNwbGF5OiBcImZsZXhcIiwgaGVpZ2h0OiAyMiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiB9fT5cbiAgICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCB3aWR0aDogYCR7KHRvdGFsIC8gbWF4KSAqIDEwMH0lYCwgaGVpZ2h0OiAxMiwgZ2FwOiAxLCBtaW5XaWR0aDogdG90YWwgPiAwID8gMiA6IDAgfX0+XG4gICAgICAgICAgICAgICAgICB7ci5zZWdtZW50c1xuICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKChzKSA9PiBzLnZhbHVlID4gMClcbiAgICAgICAgICAgICAgICAgICAgLm1hcCgocywgaywgYXJyKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdlxuICAgICAgICAgICAgICAgICAgICAgICAga2V5PXtzLm5hbWV9XG4gICAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17e1xuICAgICAgICAgICAgICAgICAgICAgICAgICBmbGV4OiBzLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBiYWNrZ3JvdW5kOiBzLmNvbG9yLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBib3JkZXJSYWRpdXM6IGAke2sgPT09IDAgPyAyIDogMH1weCAke2sgPT09IGFyci5sZW5ndGggLSAxID8gMiA6IDB9cHggJHtrID09PSBhcnIubGVuZ3RoIC0gMSA/IDIgOiAwfXB4ICR7ayA9PT0gMCA/IDIgOiAwfXB4YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyAuLi5jZWxsLCB0ZXh0QWxpZ246IFwicmlnaHRcIiwgZm9udFZhcmlhbnROdW1lcmljOiBcInRhYnVsYXItbnVtc1wiIH19PntyLnZhbHVlVGV4dH08L3NwYW4+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICApO1xuICAgICAgICB9KX1cbiAgICAgIDwvZGl2PlxuICAgICAge2hvdmVyICYmIHJvd3NbaG92ZXIuaV0gJiYgKFxuICAgICAgICA8VG9vbHRpcCBwPXtwfSB4PXtob3Zlci54ICsgKGZsaXAgPyAtMTIgOiAxMil9IHk9e2hvdmVyLnkgKyAxMn0gZmxpcD17ZmxpcH0gZml4ZWQ+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBmb250V2VpZ2h0OiA2MDAgfX0+e3Jvd3NbaG92ZXIuaV0ubGFiZWx9PC9kaXY+XG4gICAgICAgICAge3Jvd3NbaG92ZXIuaV0udGlwLm1hcCgodCkgPT4gKFxuICAgICAgICAgICAgPGRpdiBrZXk9e3R9Pnt0fTwvZGl2PlxuICAgICAgICAgICkpfVxuICAgICAgICA8L1Rvb2x0aXA+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5mdW5jdGlvbiBUaWxlKHsgYXBpLCBsYWJlbCwgdmFsdWUsIGRlbHRhIH06IHsgYXBpOiBQbHVnaW5BcGk7IGxhYmVsOiBzdHJpbmc7IHZhbHVlOiBzdHJpbmc7IGRlbHRhPzogc3RyaW5nIHwgbnVsbCB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBtaW5XaWR0aDogMCxcbiAgICAgICAgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIixcbiAgICAgICAgYmFja2dyb3VuZDogcC5zdXJmYWNlLFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHtwLmJvcmRlcn1gLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDYsXG4gICAgICAgIHBhZGRpbmc6IFwiMTBweCAxMnB4XCIsXG4gICAgICAgIGRpc3BsYXk6IFwiZmxleFwiLFxuICAgICAgICBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLFxuICAgICAgICBnYXA6IDIsXG4gICAgICB9fVxuICAgID5cbiAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PntsYWJlbH08L3NwYW4+XG4gICAgICA8c3BhbiBzdHlsZT17eyBmb250U2l6ZTogMjIsIGxpbmVIZWlnaHQ6IFwiMzBweFwiLCBmb250V2VpZ2h0OiA2MDAsIGZvbnRWYXJpYW50TnVtZXJpYzogXCJ0YWJ1bGFyLW51bXNcIiB9fT57dmFsdWV9PC9zcGFuPlxuICAgICAge2RlbHRhICYmIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PntkZWx0YX08L3NwYW4+fVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogV3JhcHBpbmcgcm93IG9mIGNhcmRzOiBldmVyeSByb3cgaXMgZmlsbGVkIGVkZ2UgdG8gZWRnZSBhbmQgaXRzIGNhcmRzIHNoYXJlIG9uZSBoZWlnaHQuICovXG5jb25zdCBUSUxFX01JTiA9IDEzMDtcbmNvbnN0IEdBUCA9IDEyO1xuXG4vKiogU3RhdCB0aWxlcyBpbiBlcXVhbCBjb2x1bW5zOyB3aGVuIHRoZXkgZG9uJ3QgZml0IG9uIG9uZSByb3cgdGhleSBzcGxpdCBpbnRvIGJhbGFuY2VkIHJvd3MgKDYgLT4gMyszIC0+IDIrMisyKS4gKi9cbmZ1bmN0aW9uIFRpbGVSb3coeyBjaGlsZHJlbiB9OiB7IGNoaWxkcmVuOiBSZWFjdE5vZGVbXSB9KSB7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IG4gPSBNYXRoLm1heCgxLCBjaGlsZHJlbi5sZW5ndGgpO1xuICBjb25zdCBmaXQgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKCh3aWR0aCArIEdBUCkgLyAoVElMRV9NSU4gKyBHQVApKSk7XG4gIGNvbnN0IGNvbHMgPSB3aWR0aCA/IE1hdGguY2VpbChuIC8gTWF0aC5jZWlsKG4gLyBNYXRoLm1pbihmaXQsIG4pKSkgOiBuO1xuICByZXR1cm4gKFxuICAgIDxkaXYgcmVmPXtyZWZ9IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBgcmVwZWF0KCR7Y29sc30sIG1pbm1heCgwLCAxZnIpKWAsIGdhcDogR0FQIH19PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5jb25zdCBGbG93ID0gKHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pID0+IDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhXcmFwOiBcIndyYXBcIiwgYWxpZ25JdGVtczogXCJzdHJldGNoXCIsIGdhcDogMTIgfX0+e2NoaWxkcmVufTwvZGl2PjtcblxuZnVuY3Rpb24gU2VjdGlvbih7IGFwaSwgdGl0bGUsIGV4dHJhLCBjaGlsZHJlbiB9OiB7IGFwaTogUGx1Z2luQXBpOyB0aXRsZTogc3RyaW5nOyBleHRyYT86IFJlYWN0Tm9kZTsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBmbGV4OiBcIjEgMSAzMjBweFwiLFxuICAgICAgICBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNixcbiAgICAgICAgcGFkZGluZzogMTIsXG4gICAgICAgIGRpc3BsYXk6IFwiZmxleFwiLFxuICAgICAgICBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLFxuICAgICAgICBnYXA6IDgsXG4gICAgICAgIG1pbldpZHRoOiAwLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBmbGV4V3JhcDogXCJ3cmFwXCIgfX0+XG4gICAgICAgIDxzdHJvbmcgc3R5bGU9e3sgZmxleDogMSB9fT57dGl0bGV9PC9zdHJvbmc+XG4gICAgICAgIHtleHRyYX1cbiAgICAgIDwvZGl2PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1ldHJpYyB2aWV3cyAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBUcmVuZCB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGtleTogc3RyaW5nO1xuICBnZXQ6IChkb2M6IEpzb24pID0+IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ7XG59XG5cbi8qKiBUaWxlIHZhbHVlIGZyb20gdGhlIGxhdGVzdCBkb2MsIGRlbHRhIGFnYWluc3QgdGhlIHByZXZpb3VzIGRheSBpbiBoaXN0b3J5LiAqL1xuZnVuY3Rpb24gdHJlbmRUaWxlKGFwaTogUGx1Z2luQXBpLCBkYXlzOiBEYXlbXSwgdDogVHJlbmQpIHtcbiAgY29uc3QgdmFscyA9IGRheXMubWFwKChkKSA9PiB0LmdldChkLmRvYykpO1xuICBjb25zdCBjdXIgPSB2YWxzW3ZhbHMubGVuZ3RoIC0gMV07XG4gIGNvbnN0IHByZXYgPSB2YWxzLmxlbmd0aCA+IDEgPyB2YWxzW3ZhbHMubGVuZ3RoIC0gMl0gOiB1bmRlZmluZWQ7XG4gIGxldCBkZWx0YTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY3VyID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBwcmV2ID09PSBcIm51bWJlclwiKSB7XG4gICAgY29uc3QgZCA9IGN1ciAtIHByZXY7XG4gICAgY29uc3QgYWJzID0gTU9ORVlfS0VZLnRlc3QodC5rZXkpID8gbW9uZXkuZm9ybWF0KE1hdGguYWJzKGQpKSA6IE1hdGguYWJzKGQpLnRvTG9jYWxlU3RyaW5nKCk7XG4gICAgZGVsdGEgPSBgJHtkID4gMCA/IFwiK1wiIDogZCA8IDAgPyBcIi1cIiA6IFwiXHUwMEIxXCJ9JHthYnN9IHZzICR7c2hvcnREYXRlKGRheXNbZGF5cy5sZW5ndGggLSAyXS5kYXRlKX1gO1xuICB9XG4gIHJldHVybiA8VGlsZSBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSBsYWJlbD17dC50aXRsZX0gdmFsdWU9e2ZtdChjdXIsIHQua2V5KX0gZGVsdGE9e2RlbHRhfSAvPjtcbn1cblxuLyoqIE9uZSBjYXJkIHBlciB0cmVuZCB0aGF0IGhhcyBkYXRhOyByZW5kZXJlZCBhcyBhIGZyYWdtZW50IHNvIHRoZSBjYXJkcyBqb2luIHRoZSBzdXJyb3VuZGluZyBGbG93LiAqL1xuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RyZW5kc1xuICAgICAgICAubWFwKCh0KSA9PiAoeyB0LCBwb2ludHM6IGRheXMubWFwKChkKSA9PiAoeyBsYWJlbDogc2hvcnREYXRlKGQuZGF0ZSksIHJhdzogdC5nZXQoZC5kb2MpIH0pKSB9KSlcbiAgICAgICAgLmZpbHRlcigoeyBwb2ludHMgfSkgPT4gcG9pbnRzLnNvbWUoKHB0KSA9PiBwdC5yYXcgIT09IHVuZGVmaW5lZCkpXG4gICAgICAgIC5tYXAoKHsgdCwgcG9pbnRzIH0pID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSB0aXRsZT17YCR7dC50aXRsZX0gVHJlbmRgfT5cbiAgICAgICAgICAgIDxMaW5lQ2hhcnRcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIGxhYmVscz17cG9pbnRzLm1hcCgocHQpID0+IHB0LmxhYmVsKX1cbiAgICAgICAgICAgICAgc2VyaWVzPXtbeyBuYW1lOiB0LnRpdGxlLCBjb2xvcjogYXBpLnRoZW1lLnBhbGV0dGUuYWNjZW50LCB2YWx1ZXM6IHBvaW50cy5tYXAoKHB0KSA9PiBwdC5yYXcgPz8gbnVsbCkgfV19XG4gICAgICAgICAgICAgIGZvcm1hdD17YXhpc0ZtdCh0LmtleSl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgPC8+XG4gICk7XG59XG5cbmZ1bmN0aW9uIEhpc3RvcnlIaW50KHsgYXBpLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGRheXM6IERheVtdIH0pIHtcbiAgaWYgKGRheXMubGVuZ3RoID49IDIpIHJldHVybiBudWxsO1xuICByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IGFwaS50aGVtZS5wYWxldHRlLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlRyZW5kcyBmaWxsIGluIGFzIGRhaWx5IGhpc3RvcnkgYWNjdW11bGF0ZXMgKHtkYXlzLmxlbmd0aH0gZGF5IHNvIGZhcikuPC9zcGFuPjtcbn1cblxuZnVuY3Rpb24gY29zdFJvd3MoYXBpOiBQbHVnaW5BcGksIGNvc3Q6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKGNvc3Q/LmJ5VGFnID8/IHt9KVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAuc29ydCgoWywgYV0sIFssIGJdKSA9PiAoYiBhcyBudW1iZXIpIC0gKGEgYXMgbnVtYmVyKSlcbiAgICAubWFwKChbaywgdl0pID0+ICh7XG4gICAgICBsYWJlbDogayxcbiAgICAgIHNlZ21lbnRzOiBbeyBuYW1lOiBcIkNvc3RcIiwgdmFsdWU6IHYgYXMgbnVtYmVyLCBjb2xvcjogcC5hY2NlbnQgfV0sXG4gICAgICB2YWx1ZVRleHQ6IG1vbmV5LmZvcm1hdCh2IGFzIG51bWJlciksXG4gICAgICB0aXA6IFtgJHttb25leS5mb3JtYXQodiBhcyBudW1iZXIpfSAoJHtjb3N0LnRvdGFsID8gKCgodiBhcyBudW1iZXIpIC8gY29zdC50b3RhbCkgKiAxMDApLnRvRml4ZWQoMSkgOiBcIjBcIn0lIG9mIHRvdGFsKWBdLFxuICAgIH0pKTtcbn1cblxuLyoqIEFwcHMgdG9vIHNtYWxsIGZvciB0aGVpciBvd24gdGFiOyB0aGV5IGdldCBvbmUgaW52b2NhdGlvbnMtdnMtZXJyb3JzIGNhcmQgb24gdGhlIE92ZXJ2aWV3IGluc3RlYWQuICovXG5jb25zdCBPVkVSVklFV19PTkxZX0FQUFM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IFNlY3JldHNNYW5hZ2VyOiBcIkdsb2JhbCBTZWNyZXRzIFRyZW5kXCIgfTtcblxuLyoqIFN1bSBvZiBhIExhbWJkYSBtZXRyaWMgYWNyb3NzIGFuIGFwcCdzIGZ1bmN0aW9uczsgdW5rbm93biBpZiBhbnkgZnVuY3Rpb24ncyB2YWx1ZSBpcyB1bmtub3duLiAqL1xuZnVuY3Rpb24gbGFtYmRhU3VtKGFwcDogSnNvbiwgZmllbGQ6IFwiaW52b2NhdGlvbnNcIiB8IFwiZXJyb3JzXCIpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbGFtYmRhcyA9IGFwcD8ubW9uaXRvcmluZz8ubGFtYmRhcztcbiAgaWYgKGxhbWJkYXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGxhbWJkYXMgPT09IG51bGwgfHwgaXNFcnJvck5vZGUobGFtYmRhcykgfHwgaXNFcnJvck5vZGUoYXBwLm1vbml0b3JpbmcpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IE9iamVjdC52YWx1ZXMobGFtYmRhcykubWFwKCh2KSA9PiBtZXRyaWModiwgZmllbGQpKTtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdHlwZW9mIHYgIT09IFwibnVtYmVyXCIpID8gbnVsbCA6ICh2YWxzIGFzIG51bWJlcltdKS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcbn1cblxuZnVuY3Rpb24gSW52b2NhdGlvbnNUcmVuZCh7IGFwaSwgZGF5cywgYXBwTmFtZSwgdGl0bGUgfTogeyBhcGk6IFBsdWdpbkFwaTsgZGF5czogRGF5W107IGFwcE5hbWU6IHN0cmluZzsgdGl0bGU6IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgYXBwRGF5cyA9IGRheXMubWFwKChkKSA9PiAoeyBkYXRlOiBkLmRhdGUsIGFwcDogYXBwc09mKGQuZG9jKS5maW5kKChhKSA9PiBhLm5hbWUgPT09IGFwcE5hbWUpIH0pKS5maWx0ZXIoKGQpID0+IGQuYXBwKTtcbiAgaWYgKGFwcERheXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VyaWVzOiBTZXJpZXNbXSA9IFtcbiAgICB7IG5hbWU6IFwiSW52b2NhdGlvbnNcIiwgY29sb3I6IHAuYWNjZW50LCB2YWx1ZXM6IGFwcERheXMubWFwKChkKSA9PiBsYW1iZGFTdW0oZC5hcHAsIFwiaW52b2NhdGlvbnNcIikgPz8gbnVsbCkgfSxcbiAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciwgdmFsdWVzOiBhcHBEYXlzLm1hcCgoZCkgPT4gbGFtYmRhU3VtKGQuYXBwLCBcImVycm9yc1wiKSA/PyBudWxsKSB9LFxuICBdO1xuICByZXR1cm4gKFxuICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT17dGl0bGV9IGV4dHJhPXs8TGVnZW5kIGFwaT17YXBpfSBpdGVtcz17c2VyaWVzfSAvPn0+XG4gICAgICA8TGluZUNoYXJ0IGFwaT17YXBpfSBsYWJlbHM9e2FwcERheXMubWFwKChkKSA9PiBzaG9ydERhdGUoZC5kYXRlKSl9IHNlcmllcz17c2VyaWVzfSBmb3JtYXQ9e2F4aXNGbXQoXCJcIil9IC8+XG4gICAgPC9TZWN0aW9uPlxuICApO1xufVxuXG5jb25zdCBPVkVSVklFV19UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiQVdTIENvc3QgKDMwZClcIiwga2V5OiBcImNvc3RcIiwgZ2V0OiAoZCkgPT4gbWV0cmljKGQsIFwiYXdzQ29zdC50b3RhbFwiKSB9LFxuICB7IHRpdGxlOiBcIlJlcXVlc3RzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpIH0sXG4gIHsgdGl0bGU6IFwiTGFtYmRhIEVycm9ycyAoMjRoKVwiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCI1eHggRXJyb3JzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLmVycm9yczV4eFwiKSB9LFxuICB7IHRpdGxlOiBcIkFsYXJtcyBGaXJpbmdcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwiaGVhbHRoLmFsYXJtcy5pbkFsYXJtXCIpIH0sXG4gIHsgdGl0bGU6IFwiUGF5aW5nIEN1c3RvbWVyc1wiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJjdXN0b21lcnMucGF5aW5nXCIpIH0sXG5dO1xuXG5mdW5jdGlvbiBPdmVydmlldyh7IGFwaSwgZG9jLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGRvYzogSnNvbjsgZGF5czogRGF5W10gfSkge1xuICBjb25zdCB7IFN0YXR1c0RvdCB9ID0gYXBpLnVpO1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcHMgPSBhcHBzT2YoZG9jKTtcbiAgY29uc3QgY29zdCA9IGRvYy5hd3NDb3N0O1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMTIgfX0+XG4gICAgICA8VGlsZVJvdz57T1ZFUlZJRVdfVFJFTkRTLmZpbHRlcigodCkgPT4gdC5nZXQoZG9jKSAhPT0gdW5kZWZpbmVkKS5tYXAoKHQpID0+IHRyZW5kVGlsZShhcGksIGRheXMsIHQpKX08L1RpbGVSb3c+XG4gICAgICA8SGlzdG9yeUhpbnQgYXBpPXthcGl9IGRheXM9e2RheXN9IC8+XG4gICAgICA8Rmxvdz5cbiAgICAgICAgPFRyZW5kQ2hhcnRzIGFwaT17YXBpfSBkYXlzPXtkYXlzfSB0cmVuZHM9e09WRVJWSUVXX1RSRU5EUy5zbGljZSgwLCAzKX0gLz5cbiAgICAgICAge09iamVjdC5lbnRyaWVzKE9WRVJWSUVXX09OTFlfQVBQUykubWFwKChbbmFtZSwgdGl0bGVdKSA9PiAoXG4gICAgICAgICAgPEludm9jYXRpb25zVHJlbmQga2V5PXtuYW1lfSBhcGk9e2FwaX0gZGF5cz17ZGF5c30gYXBwTmFtZT17bmFtZX0gdGl0bGU9e3RpdGxlfSAvPlxuICAgICAgICApKX1cbiAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiQXBwc1wiPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwiYXV0byAxZnIgbWF4LWNvbnRlbnQgbWF4LWNvbnRlbnQgbWF4LWNvbnRlbnRcIiwgZ2FwOiBcIjRweCAxMnB4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIgfX0+XG4gICAgICAgICAgICB7W1wiXCIsIFwiQXBwXCIsIFwiUmVxdWVzdHNcIiwgXCJFcnJvcnNcIiwgXCJQcm9maXQgKDMwZClcIl0ubWFwKChoKSA9PiAoXG4gICAgICAgICAgICAgIDxzcGFuIGtleT17aCB8fCBcImRvdFwifSBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICAgICAgICB7aH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICB7YXBwcy5tYXAoKGEpID0+IChcbiAgICAgICAgICAgICAgPGRpdiBrZXk9e2EubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19PlxuICAgICAgICAgICAgICAgIDxTdGF0dXNEb3QgY29sb3I9e2FwcFN0YXR1cyhhKX0gLz5cbiAgICAgICAgICAgICAgICA8c3Bhbj57YS5uYW1lfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3Bhbj57Y2VsbChtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSwgXCJwcm9maXRcIil9PC9zcGFuPlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICkpfVxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT17YEFXUyBDb3N0IEJ5IFByb2plY3Qke2Nvc3QgJiYgIWlzRXJyb3JOb2RlKGNvc3QpID8gYCAoJHtzaG9ydERhdGUoY29zdC53aW5kb3dTdGFydCl9IFRvICR7c2hvcnREYXRlKGNvc3Qud2luZG93RW5kKX0pYCA6IFwiXCJ9YH0+XG4gICAgICAgICAgeyFjb3N0IHx8IGlzRXJyb3JOb2RlKGNvc3QpID8gPHNwYW4+e2ZtdChjb3N0KX08L3NwYW4+IDogPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2Nvc3RSb3dzKGFwaSwgY29zdCl9IC8+fVxuICAgICAgICA8L1NlY3Rpb24+XG4gICAgICA8L0Zsb3c+XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmZ1bmN0aW9uIGxhbWJkYVJvd3MoYXBpOiBQbHVnaW5BcGksIGxhbWJkYXM6IEpzb24pOiB7IHJvd3M6IEJhclJvd1tdOyBpZGxlOiBudW1iZXI7IHVua25vd246IHN0cmluZ1tdIH0ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IHJvd3M6IEJhclJvd1tdID0gW107XG4gIGNvbnN0IHVua25vd246IHN0cmluZ1tdID0gW107XG4gIGxldCBpZGxlID0gMDtcbiAgZm9yIChjb25zdCBbZm4sIHZdIG9mIE9iamVjdC5lbnRyaWVzKGxhbWJkYXMgPz8ge30pIGFzIFtzdHJpbmcsIEpzb25dW10pIHtcbiAgICBjb25zdCBpbnYgPSBtZXRyaWModiwgXCJpbnZvY2F0aW9uc1wiKTtcbiAgICBpZiAodHlwZW9mIGludiAhPT0gXCJudW1iZXJcIikge1xuICAgICAgdW5rbm93bi5wdXNoKGZuKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW52ID09PSAwKSB7XG4gICAgICBpZGxlKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgZXJyID0gbWV0cmljKHYsIFwiZXJyb3JzXCIpID8/IDA7XG4gICAgY29uc3QgdGhyID0gbWV0cmljKHYsIFwidGhyb3R0bGVzXCIpID8/IDA7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIGxhYmVsOiBmbixcbiAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgIHsgbmFtZTogXCJTdWNjZWVkZWRcIiwgdmFsdWU6IE1hdGgubWF4KDAsIGludiAtIGVyciksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIHZhbHVlOiBlcnIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgXSxcbiAgICAgIHZhbHVlVGV4dDogZXJyID8gYCR7aW52LnRvTG9jYWxlU3RyaW5nKCl9ICgkeygoZXJyIC8gaW52KSAqIDEwMCkudG9GaXhlZCgwKX0lIEVycilgIDogaW52LnRvTG9jYWxlU3RyaW5nKCksXG4gICAgICB0aXA6IFtgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gaW52b2NhdGlvbnNgLCBgJHtlcnIudG9Mb2NhbGVTdHJpbmcoKX0gZXJyb3JzYCwgYCR7dGhyLnRvTG9jYWxlU3RyaW5nKCl9IHRocm90dGxlc2BdLFxuICAgIH0pO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gYi5zZWdtZW50c1swXS52YWx1ZSArIGIuc2VnbWVudHNbMV0udmFsdWUgLSAoYS5zZWdtZW50c1swXS52YWx1ZSArIGEuc2VnbWVudHNbMV0udmFsdWUpKTtcbiAgcmV0dXJuIHsgcm93cywgaWRsZSwgdW5rbm93biB9O1xufVxuXG5mdW5jdGlvbiBhcGlSb3dzKGFwaTogUGx1Z2luQXBpLCBhcGlzOiBKc29uKTogQmFyUm93W10ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoT2JqZWN0LmVudHJpZXMoYXBpcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSlcbiAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIG1ldHJpYyh2LCBcInJlcXVlc3RzXCIpID09PSBcIm51bWJlclwiKVxuICAgIC5tYXAoKFtuYW1lLCB2XSkgPT4ge1xuICAgICAgY29uc3QgcmVxID0gbWV0cmljKHYsIFwicmVxdWVzdHNcIikgYXMgbnVtYmVyO1xuICAgICAgY29uc3QgZTQgPSBtZXRyaWModiwgXCJlcnJvcnM0eHhcIikgPz8gMDtcbiAgICAgIGNvbnN0IGU1ID0gbWV0cmljKHYsIFwiZXJyb3JzNXh4XCIpID8/IDA7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBsYWJlbDogbmFtZSxcbiAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICB7IG5hbWU6IFwiT0tcIiwgdmFsdWU6IE1hdGgubWF4KDAsIHJlcSAtIGU0IC0gZTUpLCBjb2xvcjogcC5hY2NlbnQgfSxcbiAgICAgICAgICB7IG5hbWU6IFwiNHh4XCIsIHZhbHVlOiBlNCwgY29sb3I6IHAuc3RhdHVzLndhcm5pbmcgfSxcbiAgICAgICAgICB7IG5hbWU6IFwiNXh4XCIsIHZhbHVlOiBlNSwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICAgIF0sXG4gICAgICAgIHZhbHVlVGV4dDogcmVxLnRvTG9jYWxlU3RyaW5nKCksXG4gICAgICAgIHRpcDogW2Ake3JlcS50b0xvY2FsZVN0cmluZygpfSByZXF1ZXN0c2AsIGAke2U0LnRvTG9jYWxlU3RyaW5nKCl9IDR4eCwgJHtlNS50b0xvY2FsZVN0cmluZygpfSA1eHhgLCBgcDk1IGxhdGVuY3k6ICR7Zm10KHYucDk1TGF0ZW5jeU1zLCBcImxhdGVuY3ltc1wiKX1gXSxcbiAgICAgIH07XG4gICAgfSlcbiAgICAuc29ydCgoYSwgYikgPT4gYi5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSAtIGEuc2VnbWVudHMucmVkdWNlKChzLCB4KSA9PiBzICsgeC52YWx1ZSwgMCkpO1xufVxuXG5mdW5jdGlvbiBSb3dzKHsgYXBpLCB2YWx1ZSwgcGF0aCA9IFwiXCIgfTogeyBhcGk6IFBsdWdpbkFwaTsgdmFsdWU6IEpzb247IHBhdGg/OiBzdHJpbmcgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgaXNFcnJvck5vZGUodmFsdWUpKSB7XG4gICAgcmV0dXJuIDxzcGFuPntmbXQodmFsdWUsIHBhdGgpfTwvc3Bhbj47XG4gIH1cbiAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKHZhbHVlKS5maWx0ZXIoKFssIHZdKSA9PiAhKHR5cGVvZiB2ID09PSBcInN0cmluZ1wiICYmICh2Lmxlbmd0aCA+IDgwIHx8IHYuaW5jbHVkZXMoXCJcXG5cIikpKSk7XG4gIGlmIChlbnRyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT5Ob25lPC9zcGFuPjtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBcIm1heC1jb250ZW50IDFmclwiLCBnYXA6IFwiMnB4IDE2cHhcIiB9fT5cbiAgICAgIHtlbnRyaWVzLm1hcCgoW2ssIHZdKSA9PiB7XG4gICAgICAgIGNvbnN0IG5lc3RlZCA9IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgIWlzRXJyb3JOb2RlKHYpO1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIDxkaXYga2V5PXtrfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0+XG4gICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e3RpdGxlQ2FzZShrKX08L3NwYW4+XG4gICAgICAgICAgICA8c3Bhbj57bmVzdGVkID8gQXJyYXkuaXNBcnJheSh2KSA/IDxzcGFuPnt2Lmxlbmd0aCA/IHYuam9pbihcIiwgXCIpIDogXCJOb25lXCJ9PC9zcGFuPiA6IDxSb3dzIGFwaT17YXBpfSB2YWx1ZT17dn0gcGF0aD17a30gLz4gOiBmbXQodiwgayl9PC9zcGFuPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICApO1xuICAgICAgfSl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmNvbnN0IHRpdGxlQ2FzZSA9IChzOiBzdHJpbmcpID0+IHMucmVwbGFjZSgvKFtBLVpdKS9nLCBcIiAkMVwiKS5yZXBsYWNlKC9eLi8sIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkpO1xuXG5jb25zdCBBUFBfVFJFTkRTOiBUcmVuZFtdID0gW1xuICB7IHRpdGxlOiBcIlJlcXVlc3RzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMucmVxdWVzdHNcIikgfSxcbiAgeyB0aXRsZTogXCJMYW1iZGEgRXJyb3JzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpIH0sXG4gIHsgdGl0bGU6IFwiUGF5aW5nIEN1c3RvbWVyc1wiLCBrZXk6IFwiXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcImN1c3RvbWVycy5wYXlpbmdcIikgfSxcbiAgeyB0aXRsZTogXCJNUlJcIiwga2V5OiBcIm1yclwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25leS5tcnJcIikgfSxcbiAgeyB0aXRsZTogXCJQcm9maXQgKDMwZClcIiwga2V5OiBcInByb2ZpdFwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25leS5wcm9maXQzMGRcIikgfSxcbl07XG5cbmZ1bmN0aW9uIEFwcFZpZXcoeyBhcGksIGFwcCwgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBhcHA6IEpzb247IGRheXM6IERheVtdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBhcHBEYXlzID0gZGF5cy5tYXAoKGQpID0+ICh7IGRhdGU6IGQuZGF0ZSwgZG9jOiBhcHBzT2YoZC5kb2MpLmZpbmQoKGEpID0+IGEubmFtZSA9PT0gYXBwLm5hbWUpIH0pKS5maWx0ZXIoKGQpID0+IGQuZG9jKTtcbiAgY29uc3QgbW9uID0gYXBwLm1vbml0b3Jpbmc7XG4gIGNvbnN0IGF1ZCA9IGFwcC5hdWRpZW5jZTtcbiAgY29uc3QgYXVkRGF5czogSnNvbltdID0gYXVkICYmIEFycmF5LmlzQXJyYXkoYXVkLmRheXMpID8gYXVkLmRheXMgOiBbXTtcbiAgY29uc3QgYXVkS2V5cyA9IGF1ZERheXMubGVuZ3RoID8gT2JqZWN0LmtleXMoYXVkRGF5c1swXSkuZmlsdGVyKChrKSA9PiBrICE9PSBcImRhdGVcIiAmJiB0eXBlb2YgYXVkRGF5c1swXVtrXSA9PT0gXCJudW1iZXJcIikgOiBbXTtcbiAgY29uc3QgbGFtYmRhcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmxhbWJkYXMpID8gbGFtYmRhUm93cyhhcGksIG1vbi5sYW1iZGFzKSA6IG51bGw7XG4gIGNvbnN0IGFwaXMgPSBtb24gJiYgIWlzRXJyb3JOb2RlKG1vbikgJiYgIWlzRXJyb3JOb2RlKG1vbi5hcGlzKSA/IGFwaVJvd3MoYXBpLCBtb24uYXBpcykgOiBudWxsO1xuICBjb25zdCBkZXRhaWxzID0gT2JqZWN0LmVudHJpZXMoYXBwKS5maWx0ZXIoKFtrXSkgPT4gayAhPT0gXCJuYW1lXCIgJiYgayAhPT0gXCJtb25pdG9yaW5nXCIpO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIiwgZ2FwOiAxMiB9fT5cbiAgICAgIDxUaWxlUm93PntBUFBfVFJFTkRTLmZpbHRlcigodCkgPT4gdC5nZXQoYXBwKSAhPT0gdW5kZWZpbmVkKS5tYXAoKHQpID0+IHRyZW5kVGlsZShhcGksIGFwcERheXMsIHQpKX08L1RpbGVSb3c+XG4gICAgICA8SGlzdG9yeUhpbnQgYXBpPXthcGl9IGRheXM9e2FwcERheXN9IC8+XG4gICAgICA8Rmxvdz5cbiAgICAgICAgPFRyZW5kQ2hhcnRzIGFwaT17YXBpfSBkYXlzPXthcHBEYXlzfSB0cmVuZHM9e0FQUF9UUkVORFN9IC8+XG4gICAgICAgIHttb24gJiYgaXNFcnJvck5vZGUobW9uKSAmJiAoXG4gICAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiTW9uaXRvcmluZyAoMjRoKVwiPlxuICAgICAgICAgICAgPHNwYW4+e2ZtdChtb24pfTwvc3Bhbj5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHthcGlzICYmIGFwaXMubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgPFNlY3Rpb25cbiAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgdGl0bGU9XCJBUEkgUmVxdWVzdHMgKDI0aClcIlxuICAgICAgICAgICAgZXh0cmE9e1xuICAgICAgICAgICAgICA8TGVnZW5kXG4gICAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgICAgaXRlbXM9e1tcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCJPS1wiLCBjb2xvcjogcC5hY2NlbnQgfSxcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCI0eHhcIiwgY29sb3I6IHAuc3RhdHVzLndhcm5pbmcgfSxcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCI1eHhcIiwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICAgICAgICAgICAgXX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICA+XG4gICAgICAgICAgICA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17YXBpc30gLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHtsYW1iZGFzICYmIGxhbWJkYXMucm93cy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT1cIkxhbWJkYSBJbnZvY2F0aW9ucyAoMjRoKVwiXG4gICAgICAgICAgICBleHRyYT17XG4gICAgICAgICAgICAgIDxMZWdlbmRcbiAgICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgICBpdGVtcz17W1xuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIlN1Y2NlZWRlZFwiLCBjb2xvcjogcC5hY2NlbnQgfSxcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICAgICAgICAgICAgXX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICA+XG4gICAgICAgICAgICA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17bGFtYmRhcy5yb3dzfSAvPlxuICAgICAgICAgICAgeyhsYW1iZGFzLmlkbGUgPiAwIHx8IGxhbWJkYXMudW5rbm93bi5sZW5ndGggPiAwKSAmJiAoXG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgICAgICAgIHtbbGFtYmRhcy5pZGxlID8gYCR7bGFtYmRhcy5pZGxlfSBpZGxlIGZ1bmN0aW9uJHtsYW1iZGFzLmlkbGUgPiAxID8gXCJzXCIgOiBcIlwifSBoaWRkZW5gIDogXCJcIiwgbGFtYmRhcy51bmtub3duLmxlbmd0aCA/IGBVbmtub3duOiAke2xhbWJkYXMudW5rbm93bi5qb2luKFwiLCBcIil9YCA6IFwiXCJdXG4gICAgICAgICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAgICAgICAgICAgICAuam9pbihcIi4gXCIpfVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICApfVxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2F1ZEtleXMubWFwKChrKSA9PiAoXG4gICAgICAgICAgPFNlY3Rpb24ga2V5PXtrfSBhcGk9e2FwaX0gdGl0bGU9e2BEYWlseSAke3RpdGxlQ2FzZShrKX1gfT5cbiAgICAgICAgICAgIDxMaW5lQ2hhcnRcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIGxhYmVscz17YXVkRGF5cy5tYXAoKGQpID0+IHNob3J0RGF0ZShTdHJpbmcoZC5kYXRlKSkpfVxuICAgICAgICAgICAgICBzZXJpZXM9e1t7IG5hbWU6IHRpdGxlQ2FzZShrKSwgY29sb3I6IHAuYWNjZW50LCB2YWx1ZXM6IGF1ZERheXMubWFwKChkKSA9PiAodHlwZW9mIGRba10gPT09IFwibnVtYmVyXCIgPyBkW2tdIDogbnVsbCkpIH1dfVxuICAgICAgICAgICAgICBmb3JtYXQ9e2F4aXNGbXQoayl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgICAgIHthdWQ/LnNvdXJjZXMzMGQgJiYgIWlzRXJyb3JOb2RlKGF1ZC5zb3VyY2VzMzBkKSAmJiAoXG4gICAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiVHJhZmZpYyBTb3VyY2VzICgzMGQpXCI+XG4gICAgICAgICAgICA8QmFyTGlzdFxuICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgcm93cz17KE9iamVjdC5lbnRyaWVzKGF1ZC5zb3VyY2VzMzBkKSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAgICAgICAgICAgICAuc29ydCgoWywgYV0sIFssIGJdKSA9PiBiIC0gYSlcbiAgICAgICAgICAgICAgICAubWFwKChbaywgdl0pID0+ICh7XG4gICAgICAgICAgICAgICAgICBsYWJlbDogdGl0bGVDYXNlKGspLFxuICAgICAgICAgICAgICAgICAgc2VnbWVudHM6IFt7IG5hbWU6IFwiVmlld3NcIiwgdmFsdWU6IHYsIGNvbG9yOiBwLmFjY2VudCB9XSxcbiAgICAgICAgICAgICAgICAgIHZhbHVlVGV4dDogdi50b0xvY2FsZVN0cmluZygpLFxuICAgICAgICAgICAgICAgICAgdGlwOiBbYCR7di50b0xvY2FsZVN0cmluZygpfSB2aWV3c2BdLFxuICAgICAgICAgICAgICAgIH0pKX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7ZGV0YWlscy5tYXAoKFtrLCB2XSkgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17a30gYXBpPXthcGl9IHRpdGxlPXt0aXRsZUNhc2Uoayl9PlxuICAgICAgICAgICAgPFJvd3NcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHZhbHVlPXtrID09PSBcImF1ZGllbmNlXCIgJiYgdiAmJiAhaXNFcnJvck5vZGUodikgPyBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModikuZmlsdGVyKChba2tdKSA9PiBrayAhPT0gXCJkYXlzXCIgJiYga2sgIT09IFwic291cmNlczMwZFwiKSkgOiB2fVxuICAgICAgICAgICAgICBwYXRoPXtrfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgPC9GbG93PlxuICAgIDwvZGl2PlxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gQ29tcG9uZW50KHsgYXBpIH06IHsgYXBpOiBQbHVnaW5BcGk7IHBhbmVJZD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHsgVGV4dEJ1dHRvbiwgVGFicywgQmFubmVyLCBTcGlubmVyIH0gPSBhcGkudWk7XG4gIGNvbnN0IHBhbGV0dGUgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgWywgZm9yY2VdID0gdXNlU3RhdGUoMCk7XG4gIGNvbnN0IFt0YWIsIHNldFRhYl0gPSB1c2VTdGF0ZShcIm92ZXJ2aWV3XCIpO1xuICBjb25zdCBbLCBzZXRUaGVtZV0gPSB1c2VTdGF0ZSgwKTtcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGwgPSAoKSA9PiBmb3JjZSgobikgPT4gbiArIDEpO1xuICAgIGxpc3RlbmVycy5hZGQobCk7XG4gICAgY29uc3QgdW5zdWIgPSBhcGkudGhlbWUuc3Vic2NyaWJlKCgpID0+IHNldFRoZW1lKChuKSA9PiBuICsgMSkpO1xuICAgIGlmICghc3RhdGUuZGF0YSkge1xuICAgICAgdm9pZCBhcGkuc3RvcmFnZS5nZXQ8SnNvbj4oQ0FDSEVfS0VZKS50aGVuKChjYWNoZWQpID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhc3RhdGUuZGF0YSkgc2V0U3RhdGUoeyBkYXRhOiBjYWNoZWQgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGxpc3RlbmVycy5kZWxldGUobCk7XG4gICAgICB1bnN1YigpO1xuICAgIH07XG4gIH0sIFthcGldKTtcblxuICBjb25zdCB7IGRhdGEsIGVycm9yLCBsb2FkaW5nIH0gPSBzdGF0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkYXRhKTtcbiAgY29uc3QgZGF5cyA9IGFsbERheXMoKTtcbiAgY29uc3QgYWdlID0gZGF0YSA/IGFnZUhvdXJzKGRhdGEuZ2VuZXJhdGVkQXQpIDogbnVsbDtcbiAgY29uc3Qgc3RhbGUgPSBkYXRhICYmIChhZ2UgPT09IG51bGwgfHwgYWdlID4gU1RBTEVfSE9VUlMpO1xuICBjb25zdCB0YWJBcHBzID0gYXBwcy5maWx0ZXIoKGEpID0+ICEoYS5uYW1lIGluIE9WRVJWSUVXX09OTFlfQVBQUykpO1xuICBjb25zdCBjdXJyZW50ID0gdGFiID09PSBcIm92ZXJ2aWV3XCIgPyBudWxsIDogdGFiQXBwcy5maW5kKChhKSA9PiBhLm5hbWUgPT09IHRhYik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGZsZXg6IDEsIG1pbkhlaWdodDogMCwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMTIsIGNvbG9yOiBwYWxldHRlLnRleHQgfX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBwYWRkaW5nUmlnaHQ6IDI0IH19PlxuICAgICAgICA8aDIgc3R5bGU9e3sgbWFyZ2luOiAwIH19PntOQU1FfTwvaDI+XG4gICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwYWxldHRlLnRleHRNdXRlZCwgZmxleDogMSB9fT5cbiAgICAgICAgICB7ZGF0YVxuICAgICAgICAgICAgPyBgR2VuZXJhdGVkICR7ZGF0YS5nZW5lcmF0ZWRBdCA/IG5ldyBEYXRlKGRhdGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCkgOiBcIlVua25vd25cIn0gXHUwMEI3ICR7ZGF5cy5sZW5ndGh9IERheSR7ZGF5cy5sZW5ndGggPT09IDEgPyBcIlwiIDogXCJzXCJ9IE9mIEhpc3RvcnlgXG4gICAgICAgICAgICA6IFwiTm8gRGF0YSBZZXRcIn1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgICB7bG9hZGluZyAmJiA8U3Bpbm5lciBzaXplPXsxNn0gLz59XG4gICAgICAgIDxUZXh0QnV0dG9uIGxhYmVsPVwiUmVmcmVzaFwiIHZhcmlhbnQ9XCJwcmltYXJ5XCIgZGlzYWJsZWQ9e2xvYWRpbmd9IG9uQ2xpY2s9eygpID0+IHZvaWQgcmVmcmVzaChhcGkpfSAvPlxuICAgICAgPC9kaXY+XG4gICAgICB7ZXJyb3IgJiYgPEJhbm5lciBtZXNzYWdlPXtgQ291bGQgTm90IExvYWQgTWV0cmljczogJHtlcnJvcn1gfSB0b25lPVwiZXJyb3JcIiAvPn1cbiAgICAgIHtzdGFsZSAmJiA8QmFubmVyIG1lc3NhZ2U9e2BNZXRyaWNzIEFyZSBPbGRlciBUaGFuICR7U1RBTEVfSE9VUlN9IEhvdXJzOyBUaGUgRGFpbHkgQ29sbGVjdG9yIE1heSBIYXZlIEZhaWxlZGB9IHRvbmU9XCJ3YXJuaW5nXCIgLz59XG4gICAgICB7ZGF0YSAmJiAoXG4gICAgICAgIDw+XG4gICAgICAgICAgPFRhYnNcbiAgICAgICAgICAgIHRhYnM9e1t7IGxhYmVsOiBcIk92ZXJ2aWV3XCIsIHZhbHVlOiBcIm92ZXJ2aWV3XCIgfSwgLi4udGFiQXBwcy5tYXAoKGEpID0+ICh7IGxhYmVsOiBhLm5hbWUgYXMgc3RyaW5nLCB2YWx1ZTogYS5uYW1lIGFzIHN0cmluZyB9KSldfVxuICAgICAgICAgICAgdmFsdWU9e2N1cnJlbnQgPyB0YWIgOiBcIm92ZXJ2aWV3XCJ9XG4gICAgICAgICAgICBvbkNoYW5nZT17c2V0VGFifVxuICAgICAgICAgIC8+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyAuLi5zY3JvbGxiYXJTdHlsZShwYWxldHRlKSwgZmxleDogMSwgbWluSGVpZ2h0OiAwLCBvdmVyZmxvdzogXCJhdXRvXCIsIHBhZGRpbmdSaWdodDogR0FQIH19PlxuICAgICAgICAgICAge2N1cnJlbnQgPyA8QXBwVmlldyBhcGk9e2FwaX0gYXBwPXtjdXJyZW50fSBkYXlzPXtkYXlzfSAvPiA6IDxPdmVydmlldyBhcGk9e2FwaX0gZG9jPXtkYXRhfSBkYXlzPXtkYXlzfSAvPn1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC8+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUNBLFNBQVMsV0FBVyxRQUFRLGdCQUFnQjtBQThQeEMsU0E4U0EsVUE5U0EsS0F5RVEsWUF6RVI7QUExUEosSUFBTSxPQUFPO0FBQ2IsSUFBTSxjQUFjO0FBQ3BCLElBQU0sWUFBWTtBQUNsQixJQUFNLGNBQWM7QUFDcEIsSUFBTSxXQUFXO0FBQ2pCLElBQU0saUJBQWlCO0FBeUJ2QixJQUFJLFFBQWUsRUFBRSxNQUFNLE1BQU0sU0FBUyxDQUFDLEdBQUcsT0FBTyxNQUFNLFNBQVMsTUFBTTtBQUMxRSxJQUFNLFlBQVksb0JBQUksSUFBZ0I7QUFFdEMsU0FBUyxTQUFTLE9BQXVCO0FBQ3ZDLFVBQVEsRUFBRSxHQUFHLE9BQU8sR0FBRyxNQUFNO0FBQzdCLFlBQVUsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDO0FBQzlCO0FBSUEsSUFBTSxjQUFjLENBQUMsTUFBcUIsTUFBTSxRQUFRLE9BQU8sTUFBTSxZQUFZLE9BQU8sRUFBRSxVQUFVO0FBRXBHLFNBQVMsYUFBYSxHQUFrQjtBQUN0QyxNQUFJLFlBQVksQ0FBQyxFQUFHLFFBQU87QUFDM0IsTUFBSSxNQUFNLFFBQVEsQ0FBQyxFQUFHLFFBQU8sRUFBRSxLQUFLLFlBQVk7QUFDaEQsTUFBSSxLQUFLLE9BQU8sTUFBTSxTQUFVLFFBQU8sT0FBTyxPQUFPLENBQUMsRUFBRSxLQUFLLFlBQVk7QUFDekUs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

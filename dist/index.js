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
function valueTone(key, v) {
  if (typeof v !== "number" || v <= 0) return null;
  if (key === "inAlarm") return "error";
  if (key === "errors5xx") return "warning";
  return null;
}
function groupTone(v) {
  if (isErrorNode(v)) return "warning";
  if (!v || typeof v !== "object") return null;
  const tones = [];
  const walk = (o) => Object.entries(o).forEach(([k, x]) => {
    const t = valueTone(k, x) ?? (k === "staleStates" && typeof x === "number" && x > 0 ? "warning" : null) ?? (isErrorNode(x) ? "warning" : null);
    if (t) tones.push(t);
    else if (x && typeof x === "object") walk(x);
  });
  walk(v);
  return tones.length ? worst(tones) : null;
}
function appStatus(app) {
  if (valueTone("inAlarm", metric(app, "health.alarms.inAlarm"))) return "error";
  if (hasErrorNode(app)) return "warning";
  if (valueTone("errors5xx", metric(app, "monitoring.totals.errors5xx"))) return "warning";
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
  try {
    const bucket = (await api.settings.get()).bucket || DEFAULT_BUCKET;
    const data = JSON.parse(await aws(api, ["s3", "cp", `s3://${bucket}/metrics.json`, "-"]));
    await api.storage.set(CACHE_KEY, data);
    setState({ data, error: null });
    let status = docStatus(data);
    let tip = status === "success" ? "Metrics up to date" : status === "error" ? "Alarms firing" : "Metrics need attention";
    try {
      await syncHistory(api, bucket);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("warn", `history sync failed: ${msg}`);
      status = worst([status, "warning"]);
      tip = `History sync failed: ${msg}`;
    }
    setState({ loading: false });
    setIcon(status === "warning" || status === "error" ? status : "idle", tip);
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
function Tile({ api, label, value, delta, tone }) {
  const p = api.theme.palette;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        minWidth: 0,
        boxSizing: "border-box",
        background: p.surface,
        border: `1px solid ${tone ? p.status[tone] : p.border}`,
        borderRadius: 6,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2
      },
      children: [
        /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: label }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: 22, lineHeight: "30px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: tone ? p.status[tone] : void 0 }, children: value }),
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
var alertTone = (s) => s === "warning" || s === "error" ? s : null;
function Section({ api, title, extra, tone, children }) {
  const p = api.theme.palette;
  const t = alertTone(tone);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        flex: "1 1 320px",
        boxSizing: "border-box",
        background: p.surface,
        border: `1px solid ${t ? p.status[t] : p.border}`,
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
  return /* @__PURE__ */ jsx(Tile, { api, label: t.title, value: fmt(cur, t.key), delta, tone: valueTone(t.key, cur) }, t.title);
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
  { title: "5xx Errors (24h)", key: "errors5xx", get: (d) => sumApps(d, "monitoring.totals.errors5xx") },
  { title: "Alarms Firing", key: "inAlarm", get: (d) => sumApps(d, "health.alarms.inAlarm") },
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
      /* @__PURE__ */ jsx(Section, { api, title: "Apps", tone: worst(apps.map(appStatus)), children: /* @__PURE__ */ jsxs("div", { style: { display: "grid", gridTemplateColumns: "auto 1fr max-content max-content max-content", gap: "4px 12px", alignItems: "center" }, children: [
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
      /* @__PURE__ */ jsx("span", { style: { color: valueTone(k, v) ? p.status[valueTone(k, v)] : void 0 }, children: nested ? Array.isArray(v) ? /* @__PURE__ */ jsx("span", { children: v.length ? v.join(", ") : "None" }) : /* @__PURE__ */ jsx(Rows, { api, value: v, path: k }) : fmt(v, k) })
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
      mon && isErrorNode(mon) && /* @__PURE__ */ jsx(Section, { api, title: "Monitoring (24h)", tone: "warning", children: /* @__PURE__ */ jsx("span", { children: fmt(mon) }) }),
      apis && apis.length > 0 && /* @__PURE__ */ jsx(
        Section,
        {
          api,
          title: "API Requests (24h)",
          tone: apis.some((r) => r.segments.some((s) => s.name === "5xx" && s.value > 0)) ? "warning" : null,
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
      details.map(([k, v]) => /* @__PURE__ */ jsx(Section, { api, title: titleCase(k), tone: groupTone(v), children: /* @__PURE__ */ jsx(
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIGxvYWRpbmc6IGJvb2xlYW47XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UgfTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIHN0YXRlID0geyAuLi5zdGF0ZSwgLi4ucGF0Y2ggfTtcbiAgbGlzdGVuZXJzLmZvckVhY2goKGwpID0+IGwoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tXG5cbmNvbnN0IGlzRXJyb3JOb2RlID0gKHY6IEpzb24pOiBib29sZWFuID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHYuZXJyb3IgPT09IFwic3RyaW5nXCI7XG5cbmZ1bmN0aW9uIGhhc0Vycm9yTm9kZSh2OiBKc29uKTogYm9vbGVhbiB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIHRydWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIGlmICh2ICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiKSByZXR1cm4gT2JqZWN0LnZhbHVlcyh2KS5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgbW9uZXkgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IHN0eWxlOiBcImN1cnJlbmN5XCIsIGN1cnJlbmN5OiBcIlVTRFwiIH0pO1xuY29uc3QgY29tcGFjdCA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgbm90YXRpb246IFwiY29tcGFjdFwiLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG5jb25zdCBNT05FWV9LRVkgPSAvKG1ycnxwcm9maXR8Y29zdHxhbW91bnR8cmV2ZW51ZSkvaTtcblxuLyoqIFNpbmdsZSBmb3JtYXR0ZXI6IG51bGwvdW5kZWZpbmVkL2Vycm9yIG5vZGVzIGFyZSBcIlVua25vd25cIiwgbmV2ZXIgemVyby4gKi9cbmZ1bmN0aW9uIGZtdCh2OiBKc29uLCBrZXkgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gXCJVbmtub3duXCI7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIGBVbmtub3duICgke3YuZXJyb3J9KWA7XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChNT05FWV9LRVkudGVzdChrZXkpKSByZXR1cm4gbW9uZXkuZm9ybWF0KHYpO1xuICAgIGlmICgvbGF0ZW5jeW1zL2kudGVzdChrZXkpKSByZXR1cm4gYCR7TWF0aC5yb3VuZCh2KX0gbXNgO1xuICAgIHJldHVybiB2LnRvTG9jYWxlU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHR5cGVvZiB2ID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xuICByZXR1cm4gU3RyaW5nKHYpO1xufVxuXG4vKiogVGFibGUgY2VsbDogXCItXCIgd2hlbiB0aGUgYXBwIGhhcyBubyBzdWNoIG1ldHJpYywgb3RoZXJ3aXNlIGZtdCAoc28gdW5rbm93biBzdGF5cyBcIlVua25vd25cIikuICovXG5jb25zdCBjZWxsID0gKHY6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIGtleSA9IFwiXCIpID0+ICh2ID09PSB1bmRlZmluZWQgPyBcIi1cIiA6IGZtdCh2LCBrZXkpKTtcblxuY29uc3QgYXhpc0ZtdCA9IChrZXk6IHN0cmluZykgPT4gKG46IG51bWJlcikgPT4gKE1PTkVZX0tFWS50ZXN0KGtleSkgPyBtb25leS5mb3JtYXQobikgOiBjb21wYWN0LmZvcm1hdChuKSk7XG5cbmZ1bmN0aW9uIGFnZUhvdXJzKGlzbzogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgbnVsbCB7XG4gIGNvbnN0IHQgPSBpc28gPyBEYXRlLnBhcnNlKGlzbykgOiBOYU47XG4gIHJldHVybiBOdW1iZXIuaXNOYU4odCkgPyBudWxsIDogKERhdGUubm93KCkgLSB0KSAvIDNfNjAwXzAwMDtcbn1cblxuY29uc3Qgc2hvcnREYXRlID0gKGQ6IHN0cmluZykgPT4gbmV3IERhdGUoYCR7ZH1UMDA6MDA6MDBaYCkudG9Mb2NhbGVEYXRlU3RyaW5nKHVuZGVmaW5lZCwgeyBtb250aDogXCJzaG9ydFwiLCBkYXk6IFwibnVtZXJpY1wiLCB0aW1lWm9uZTogXCJVVENcIiB9KTtcblxuY29uc3QgYXBwc09mID0gKGRvYzogSnNvbik6IEpzb25bXSA9PiAoZG9jICYmIEFycmF5LmlzQXJyYXkoZG9jLmFwcHMpID8gZG9jLmFwcHMgOiBbXSk7XG5cbi8qKiBXYWxrcyBhIGRvdHRlZCBwYXRoLiB1bmRlZmluZWQgPSBub3QgcHJlc2VudCwgbnVsbCA9IHVua25vd24gKGVycm9yIG5vZGUgb3IgbnVsbCksIG51bWJlciA9IHZhbHVlLiAqL1xuZnVuY3Rpb24gbWV0cmljKG86IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBsZXQgdiA9IG87XG4gIGZvciAoY29uc3QgayBvZiBwYXRoLnNwbGl0KFwiLlwiKSkge1xuICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHYgPT09IG51bGwgfHwgaXNFcnJvck5vZGUodikpIHJldHVybiBudWxsO1xuICAgIHYgPSB2W2tdO1xuICB9XG4gIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodikgPyB2IDogbnVsbDtcbn1cblxuLyoqIFN1bXMgYSBtZXRyaWMgYWNyb3NzIGFwcHM7IGFueSB1bmtub3duIGFwcCB2YWx1ZSBtYWtlcyB0aGUgdG90YWwgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIHN1bUFwcHMoZG9jOiBKc29uLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFkb2MgfHwgaXNFcnJvck5vZGUoZG9jLmFwcHMpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IGFwcHNPZihkb2MpXG4gICAgLm1hcCgoYSkgPT4gbWV0cmljKGEsIHBhdGgpKVxuICAgIC5maWx0ZXIoKHYpID0+IHYgIT09IHVuZGVmaW5lZCk7XG4gIGlmICh2YWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdiA9PT0gbnVsbCkgPyBudWxsIDogKHZhbHMgYXMgbnVtYmVyW10pLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xufVxuXG4vKiogU3RhdHVzIGEgc2luZ2xlIHZhbHVlIHNpZ25hbHM6IGZpcmluZyBhbGFybXMgYXJlIGFuIGVycm9yLCA1eHggcmVzcG9uc2VzIGEgd2FybmluZy4gKi9cbmZ1bmN0aW9uIHZhbHVlVG9uZShrZXk6IHN0cmluZywgdjogSnNvbik6IFN0YXR1c0NvbG9yIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdiAhPT0gXCJudW1iZXJcIiB8fCB2IDw9IDApIHJldHVybiBudWxsO1xuICBpZiAoa2V5ID09PSBcImluQWxhcm1cIikgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGtleSA9PT0gXCJlcnJvcnM1eHhcIikgcmV0dXJuIFwid2FybmluZ1wiO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIFdvcnN0IHRvbmUgb2YgYW55IHZhbHVlIGluIGEgZ3JvdXA6IGZpcmluZyBhbGFybXMgLT4gZXJyb3I7IDV4eCwgc3RhbGUgc3RhdGVzIG9yIHVua25vd24gc2VjdGlvbnMgLT4gd2FybmluZy4gKi9cbmZ1bmN0aW9uIGdyb3VwVG9uZSh2OiBKc29uKTogU3RhdHVzQ29sb3IgfCBudWxsIHtcbiAgaWYgKGlzRXJyb3JOb2RlKHYpKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICghdiB8fCB0eXBlb2YgdiAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRvbmVzOiBTdGF0dXNDb2xvcltdID0gW107XG4gIGNvbnN0IHdhbGsgPSAobzogSnNvbikgPT5cbiAgICBPYmplY3QuZW50cmllcyhvKS5mb3JFYWNoKChbaywgeF0pID0+IHtcbiAgICAgIGNvbnN0IHQgPSB2YWx1ZVRvbmUoaywgeCkgPz8gKGsgPT09IFwic3RhbGVTdGF0ZXNcIiAmJiB0eXBlb2YgeCA9PT0gXCJudW1iZXJcIiAmJiB4ID4gMCA/IFwid2FybmluZ1wiIDogbnVsbCkgPz8gKGlzRXJyb3JOb2RlKHgpID8gXCJ3YXJuaW5nXCIgOiBudWxsKTtcbiAgICAgIGlmICh0KSB0b25lcy5wdXNoKHQpO1xuICAgICAgZWxzZSBpZiAoeCAmJiB0eXBlb2YgeCA9PT0gXCJvYmplY3RcIikgd2Fsayh4KTtcbiAgICB9KTtcbiAgd2Fsayh2KTtcbiAgcmV0dXJuIHRvbmVzLmxlbmd0aCA/IHdvcnN0KHRvbmVzKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGFwcFN0YXR1cyhhcHA6IEpzb24pOiBTdGF0dXNDb2xvciB7XG4gIGlmICh2YWx1ZVRvbmUoXCJpbkFsYXJtXCIsIG1ldHJpYyhhcHAsIFwiaGVhbHRoLmFsYXJtcy5pbkFsYXJtXCIpKSkgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGhhc0Vycm9yTm9kZShhcHApKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICh2YWx1ZVRvbmUoXCJlcnJvcnM1eHhcIiwgbWV0cmljKGFwcCwgXCJtb25pdG9yaW5nLnRvdGFscy5lcnJvcnM1eHhcIikpKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICgoYXBwLmhlYWx0aD8uZnJlc2huZXNzPy5zdGFsZVN0YXRlcyA/PyAwKSA+IDApIHJldHVybiBcIndhcm5pbmdcIjtcbiAgcmV0dXJuIFwic3VjY2Vzc1wiO1xufVxuXG5jb25zdCBXT1JTVDogU3RhdHVzQ29sb3JbXSA9IFtcImlkbGVcIiwgXCJzdWNjZXNzXCIsIFwid2FybmluZ1wiLCBcImVycm9yXCJdO1xuY29uc3Qgd29yc3QgPSAoY3M6IFN0YXR1c0NvbG9yW10pOiBTdGF0dXNDb2xvciA9PiBjcy5yZWR1Y2UoKGEsIGIpID0+IChXT1JTVC5pbmRleE9mKGIpID4gV09SU1QuaW5kZXhPZihhKSA/IGIgOiBhKSwgXCJzdWNjZXNzXCIgYXMgU3RhdHVzQ29sb3IpO1xuXG5mdW5jdGlvbiBkb2NTdGF0dXMoZG9jOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBjb25zdCBhZ2UgPSBhZ2VIb3Vycyhkb2MuZ2VuZXJhdGVkQXQpO1xuICBjb25zdCBzdGFsZSA9IGFnZSA9PT0gbnVsbCB8fCBhZ2UgPiBTVEFMRV9IT1VSUztcbiAgY29uc3Qgc3RhdHVzID0gd29yc3QoYXBwc09mKGRvYykubWFwKGFwcFN0YXR1cykpO1xuICByZXR1cm4gc3RhbGUgfHwgaGFzRXJyb3JOb2RlKGRvYykgPyB3b3JzdChbc3RhdHVzLCBcIndhcm5pbmdcIl0pIDogc3RhdHVzO1xufVxuXG4vKiogSGlzdG9yeSBwbHVzIHRoZSBsYXRlc3QgZG9jdW1lbnQsIG9uZSBlbnRyeSBwZXIgVVRDIGRhdGUsIG9sZGVzdCBmaXJzdC4gKi9cbmZ1bmN0aW9uIGFsbERheXMoKTogRGF5W10ge1xuICBjb25zdCBtID0gbmV3IE1hcChzdGF0ZS5oaXN0b3J5Lm1hcCgoZCkgPT4gW2QuZGF0ZSwgZC5kb2NdKSk7XG4gIGlmICh0eXBlb2Ygc3RhdGUuZGF0YT8uZ2VuZXJhdGVkQXQgPT09IFwic3RyaW5nXCIpIG0uc2V0KHN0YXRlLmRhdGEuZ2VuZXJhdGVkQXQuc2xpY2UoMCwgMTApLCBzdGF0ZS5kYXRhKTtcbiAgcmV0dXJuIFsuLi5tLmVudHJpZXMoKV0uc29ydCgoW2FdLCBbYl0pID0+IChhIDwgYiA/IC0xIDogMSkpLm1hcCgoW2RhdGUsIGRvY10pID0+ICh7IGRhdGUsIGRvYyB9KSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gZmV0Y2hpbmcgLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBhd3NBcmdzKGFwaTogUGx1Z2luQXBpLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgcyA9IGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCk7XG4gIGNvbnN0IG91dCA9IFsuLi5hcmdzLCBcIi0tY2xpLWNvbm5lY3QtdGltZW91dFwiLCBcIjEwXCIsIFwiLS1jbGktcmVhZC10aW1lb3V0XCIsIFwiMTVcIl07XG4gIGlmIChzLmF3c1Byb2ZpbGUpIG91dC5wdXNoKFwiLS1wcm9maWxlXCIsIHMuYXdzUHJvZmlsZSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGF3cyhhcGk6IFBsdWdpbkFwaSwgYXJnczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXMgPSBhd2FpdCBhcGkuc2hlbGwuZXhlYyhcImF3c1wiLCBhd2FpdCBhd3NBcmdzKGFwaSwgYXJncykpO1xuICBpZiAocmVzLmNvZGUgIT09IDApIHRocm93IG5ldyBFcnJvcihyZXMuc3RkZXJyLnRyaW0oKSB8fCBgYXdzIGV4aXRlZCB3aXRoIGNvZGUgJHtyZXMuY29kZX1gKTtcbiAgcmV0dXJuIHJlcy5zdGRvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRIaXN0b3J5KGFwaTogUGx1Z2luQXBpKSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhcGkuZnMubGlzdERpcihISVNUT1JZX0RJUik7XG4gIGNvbnN0IGZpbGVzID0gZW50cmllc1xuICAgIC5maWx0ZXIoKGUpID0+ICFlLmlzRGlyICYmIC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1cXC5qc29uJC8udGVzdChlLm5hbWUpKVxuICAgIC5tYXAoKGUpID0+IGUubmFtZSlcbiAgICAuc29ydCgpXG4gICAgLnNsaWNlKC1NQVhfREFZUyk7XG4gIGNvbnN0IGRvY3MgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBmaWxlcy5tYXAoYXN5bmMgKGYpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IGFwaS5mcy5yZWFkVGV4dEZpbGUoYCR7SElTVE9SWV9ESVJ9LyR7Zn1gKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSksXG4gICk7XG4gIHNldFN0YXRlKHsgaGlzdG9yeTogZmlsZXMubWFwKChmLCBpKSA9PiAoeyBkYXRlOiBmLnNsaWNlKDAsIDEwKSwgZG9jOiBkb2NzW2ldIH0pKS5maWx0ZXIoKGQpID0+IGQuZG9jKSB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY0hpc3RvcnkoYXBpOiBQbHVnaW5BcGksIGJ1Y2tldDogc3RyaW5nKSB7XG4gIGNvbnN0IHJvb3QgPSAoYXdhaXQgYXBpLmZzLmdldFJvb3RQYXRoKCkpLnJlcGxhY2UoL1tcXFxcL10rJC8sIFwiXCIpO1xuICBhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcInN5bmNcIiwgYHMzOi8vJHtidWNrZXR9LyR7SElTVE9SWV9ESVJ9L2AsIGAke3Jvb3R9LyR7SElTVE9SWV9ESVJ9YCwgXCItLW9ubHktc2hvdy1lcnJvcnNcIl0pO1xuICBhd2FpdCBsb2FkSGlzdG9yeShhcGkpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoKGFwaTogUGx1Z2luQXBpLCBzaWduYWw/OiBBYm9ydFNpZ25hbCkge1xuICBpZiAoc3RhdGUubG9hZGluZykgcmV0dXJuO1xuICBzZXRTdGF0ZSh7IGxvYWRpbmc6IHRydWUgfSk7XG4gIGNvbnN0IHNldEljb24gPSAoYzogU3RhdHVzQ29sb3IsIHRpcD86IHN0cmluZykgPT4ge1xuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXBpLnN0YXR1c0ljb24uc2V0KGMsIHRpcCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBkZWFjdGl2YXRlZCAqL1xuICAgIH1cbiAgfTtcbiAgY29uc3QgbG9nID0gKGxldmVsOiBcIndhcm5cIiB8IFwiZXJyb3JcIiwgbXNnOiBzdHJpbmcpID0+IHtcbiAgICBpZiAoc2lnbmFsPy5hYm9ydGVkKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGFwaS5sb2dbbGV2ZWxdKGAke05BTUV9OiAke21zZ31gKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGRlYWN0aXZhdGVkICovXG4gICAgfVxuICB9O1xuICB0cnkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IChhd2FpdCBhcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpKS5idWNrZXQgfHwgREVGQVVMVF9CVUNLRVQ7XG4gICAgY29uc3QgZGF0YSA9IEpTT04ucGFyc2UoYXdhaXQgYXdzKGFwaSwgW1wiczNcIiwgXCJjcFwiLCBgczM6Ly8ke2J1Y2tldH0vbWV0cmljcy5qc29uYCwgXCItXCJdKSk7XG4gICAgYXdhaXQgYXBpLnN0b3JhZ2Uuc2V0KENBQ0hFX0tFWSwgZGF0YSk7XG4gICAgc2V0U3RhdGUoeyBkYXRhLCBlcnJvcjogbnVsbCB9KTtcbiAgICBsZXQgc3RhdHVzID0gZG9jU3RhdHVzKGRhdGEpO1xuICAgIGxldCB0aXAgPSBzdGF0dXMgPT09IFwic3VjY2Vzc1wiID8gXCJNZXRyaWNzIHVwIHRvIGRhdGVcIiA6IHN0YXR1cyA9PT0gXCJlcnJvclwiID8gXCJBbGFybXMgZmlyaW5nXCIgOiBcIk1ldHJpY3MgbmVlZCBhdHRlbnRpb25cIjtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3luY0hpc3RvcnkoYXBpLCBidWNrZXQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnN0IG1zZyA9IGUgaW5zdGFuY2VvZiBFcnJvciA/IGUubWVzc2FnZSA6IFN0cmluZyhlKTtcbiAgICAgIGxvZyhcIndhcm5cIiwgYGhpc3Rvcnkgc3luYyBmYWlsZWQ6ICR7bXNnfWApO1xuICAgICAgc3RhdHVzID0gd29yc3QoW3N0YXR1cywgXCJ3YXJuaW5nXCJdKTtcbiAgICAgIHRpcCA9IGBIaXN0b3J5IHN5bmMgZmFpbGVkOiAke21zZ31gO1xuICAgIH1cbiAgICBzZXRTdGF0ZSh7IGxvYWRpbmc6IGZhbHNlIH0pO1xuICAgIC8vIFRoZSBpY29uIG9ubHkgc2lnbmFscyBwcm9ibGVtczsgYW55dGhpbmcgc2hvcnQgb2Ygd2FybmluZyBzdGF5cyBpZGxlIChkZWZhdWx0IHRpbnQpLlxuICAgIHNldEljb24oc3RhdHVzID09PSBcIndhcm5pbmdcIiB8fCBzdGF0dXMgPT09IFwiZXJyb3JcIiA/IHN0YXR1cyA6IFwiaWRsZVwiLCB0aXApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgbXNnID0gZSBpbnN0YW5jZW9mIEVycm9yID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpO1xuICAgIHNldFN0YXRlKHsgZXJyb3I6IG1zZywgbG9hZGluZzogZmFsc2UgfSk7XG4gICAgc2V0SWNvbihcImVycm9yXCIsIG1zZyk7XG4gICAgbG9nKFwiZXJyb3JcIiwgbXNnKTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGUoY3R4OiBQbHVnaW5Db250ZXh0KSB7XG4gIGN0eC5hcGkuc3RhdHVzSWNvbi5zZXQoXCJpZGxlXCIpO1xuICBjb25zdCBzID0gYXdhaXQgY3R4LmFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCk7XG4gIGNvbnN0IG1pbnV0ZXMgPSBNYXRoLm1heCgxLCBzLnJlZnJlc2hNaW51dGVzID8/IDYwKTtcbiAgY3R4LnRpY2sucmVnaXN0ZXIoKCkgPT4gcmVmcmVzaChjdHguYXBpLCBjdHguc2lnbmFsKSk7XG4gIGN0eC50aWNrLnNldEludGVydmFsKG1pbnV0ZXMgKiA2MF8wMDApO1xuICBjdHguYXBpLmxvZy5pbmZvKGAke05BTUV9IGFjdGl2YXRlZGApO1xuICB2b2lkIGxvYWRIaXN0b3J5KGN0eC5hcGkpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gIHZvaWQgcmVmcmVzaChjdHguYXBpLCBjdHguc2lnbmFsKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBjaGFydCBwcmltaXRpdmVzIC0tLS0tLS0tLS1cblxuY29uc3QgQ0hBUlRfSEVJR0hUID0gMTcwO1xuXG5jb25zdCBzY3JvbGxiYXJTdHlsZSA9IChwOiBQYWxldHRlKTogQ1NTUHJvcGVydGllcyA9PiAoeyBzY3JvbGxiYXJXaWR0aDogXCJ0aGluXCIsIHNjcm9sbGJhckNvbG9yOiBgJHtwLmJvcmRlcn0gJHtwLnN1cmZhY2V9YCB9KTtcblxuZnVuY3Rpb24gdXNlV2lkdGgoKSB7XG4gIGNvbnN0IHJlZiA9IHVzZVJlZjxIVE1MRGl2RWxlbWVudD4obnVsbCk7XG4gIGNvbnN0IFt3aWR0aCwgc2V0V2lkdGhdID0gdXNlU3RhdGUoMCk7XG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgY29uc3QgZWwgPSByZWYuY3VycmVudDtcbiAgICBpZiAoIWVsKSByZXR1cm47XG4gICAgY29uc3Qgcm8gPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKFtlXSkgPT4gc2V0V2lkdGgoZS5jb250ZW50UmVjdC53aWR0aCkpO1xuICAgIHJvLm9ic2VydmUoZWwpO1xuICAgIHJldHVybiAoKSA9PiByby5kaXNjb25uZWN0KCk7XG4gIH0sIFtdKTtcbiAgcmV0dXJuIFtyZWYsIHdpZHRoXSBhcyBjb25zdDtcbn1cblxuZnVuY3Rpb24gbmljZU1heCh2OiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAodiA8PSAwKSByZXR1cm4gMTtcbiAgY29uc3QgcCA9IDEwICoqIE1hdGguZmxvb3IoTWF0aC5sb2cxMCh2KSk7XG4gIGNvbnN0IG4gPSB2IC8gcDtcbiAgcmV0dXJuIChuIDw9IDEgPyAxIDogbiA8PSAyID8gMiA6IG4gPD0gNSA/IDUgOiAxMCkgKiBwO1xufVxuXG5mdW5jdGlvbiBUb29sdGlwKHsgcCwgeCwgeSwgZmxpcCwgZml4ZWQsIGNoaWxkcmVuIH06IHsgcDogUGFsZXR0ZTsgeDogbnVtYmVyOyB5OiBudW1iZXI7IGZsaXA6IGJvb2xlYW47IGZpeGVkPzogYm9vbGVhbjsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIHJldHVybiAoXG4gICAgPGRpdlxuICAgICAgc3R5bGU9e3tcbiAgICAgICAgcG9zaXRpb246IGZpeGVkID8gXCJmaXhlZFwiIDogXCJhYnNvbHV0ZVwiLFxuICAgICAgICBsZWZ0OiB4LFxuICAgICAgICB0b3A6IHksXG4gICAgICAgIHRyYW5zZm9ybTogZmxpcCA/IFwidHJhbnNsYXRlWCgtMTAwJSlcIiA6IHVuZGVmaW5lZCxcbiAgICAgICAgYmFja2dyb3VuZDogcC5iYWNrZ3JvdW5kLFxuICAgICAgICBjb2xvcjogcC50ZXh0LFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHtwLmJvcmRlcn1gLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDQsXG4gICAgICAgIHBhZGRpbmc6IFwiNHB4IDhweFwiLFxuICAgICAgICBmb250U2l6ZTogMTIsXG4gICAgICAgIGxpbmVIZWlnaHQ6IFwiMThweFwiLFxuICAgICAgICB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiLFxuICAgICAgICBwb2ludGVyRXZlbnRzOiBcIm5vbmVcIixcbiAgICAgICAgekluZGV4OiAxLFxuICAgICAgfX1cbiAgICA+XG4gICAgICB7Y2hpbGRyZW59XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmludGVyZmFjZSBTZXJpZXMge1xuICBuYW1lOiBzdHJpbmc7XG4gIGNvbG9yOiBzdHJpbmc7XG4gIHZhbHVlczogKG51bWJlciB8IG51bGwpW107XG59XG5cbi8qKiBMaW5lIGNoYXJ0IG92ZXIgdGltZSBvbiBvbmUgc2hhcmVkIGF4aXMuIFVua25vd24gKG51bGwpIHBvaW50cyBicmVhayBhIGxpbmUgaW5zdGVhZCBvZiBkcm9wcGluZyB0byB6ZXJvOyBhIGxvbmUgc2VyaWVzIGFsc28gZ2V0cyBhbiBhcmVhIGZpbGwuICovXG5mdW5jdGlvbiBMaW5lQ2hhcnQoeyBhcGksIGxhYmVscywgc2VyaWVzLCBmb3JtYXQsIGhlaWdodCA9IENIQVJUX0hFSUdIVCB9OiB7IGFwaTogUGx1Z2luQXBpOyBsYWJlbHM6IHN0cmluZ1tdOyBzZXJpZXM6IFNlcmllc1tdOyBmb3JtYXQ6IChuOiBudW1iZXIpID0+IHN0cmluZzsgaGVpZ2h0PzogbnVtYmVyIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBbcmVmLCB3aWR0aF0gPSB1c2VXaWR0aCgpO1xuICBjb25zdCBbaG92ZXIsIHNldEhvdmVyXSA9IHVzZVN0YXRlPG51bWJlciB8IG51bGw+KG51bGwpO1xuICBjb25zdCBMID0gNTYsXG4gICAgUiA9IDEyLFxuICAgIFQgPSAxMCxcbiAgICBCID0gMjI7XG4gIGNvbnN0IHcgPSBNYXRoLm1heCgxLCB3aWR0aCAtIEwgLSBSKTtcbiAgY29uc3QgaCA9IGhlaWdodCAtIFQgLSBCO1xuICBjb25zdCBuID0gbGFiZWxzLmxlbmd0aDtcbiAgY29uc3QgbWF4ID0gbmljZU1heChNYXRoLm1heCgwLCAuLi5zZXJpZXMuZmxhdE1hcCgocykgPT4gcy52YWx1ZXMubWFwKCh2KSA9PiB2ID8/IDApKSkpO1xuICBjb25zdCB4ID0gKGk6IG51bWJlcikgPT4gTCArIChuIDw9IDEgPyB3IC8gMiA6IChpICogdykgLyAobiAtIDEpKTtcbiAgY29uc3QgeSA9ICh2OiBudW1iZXIpID0+IFQgKyBoIC0gKHYgLyBtYXgpICogaDtcblxuICBjb25zdCBydW5zT2YgPSAodmFsdWVzOiAobnVtYmVyIHwgbnVsbClbXSkgPT4ge1xuICAgIGNvbnN0IHJ1bnM6IG51bWJlcltdW10gPSBbXTtcbiAgICBsZXQgY3VyOiBudW1iZXJbXSA9IFtdO1xuICAgIHZhbHVlcy5mb3JFYWNoKCh2LCBpKSA9PiB7XG4gICAgICBpZiAodiA9PT0gbnVsbCkge1xuICAgICAgICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gICAgICAgIGN1ciA9IFtdO1xuICAgICAgfSBlbHNlIGN1ci5wdXNoKGkpO1xuICAgIH0pO1xuICAgIGlmIChjdXIubGVuZ3RoKSBydW5zLnB1c2goY3VyKTtcbiAgICByZXR1cm4gcnVucztcbiAgfTtcblxuICBjb25zdCBvbk1vdmUgPSAoZTogTW91c2VFdmVudDxTVkdSZWN0RWxlbWVudD4pID0+IHtcbiAgICBjb25zdCByID0gZS5jdXJyZW50VGFyZ2V0LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGNvbnN0IGkgPSBuIDw9IDEgPyAwIDogTWF0aC5yb3VuZCgoKGUuY2xpZW50WCAtIHIubGVmdCkgLyByLndpZHRoKSAqIChuIC0gMSkpO1xuICAgIHNldEhvdmVyKE1hdGgubWluKG4gLSAxLCBNYXRoLm1heCgwLCBpKSkpO1xuICB9O1xuXG4gIGNvbnN0IHhMYWJlbHMgPSBuIDw9IDEgPyBbMF0gOiBuID09PSAyID8gWzAsIDFdIDogWzAsIE1hdGguZmxvb3IoKG4gLSAxKSAvIDIpLCBuIC0gMV07XG4gIGNvbnN0IGFuY2hvciA9IChpOiBudW1iZXIpID0+IChuIDw9IDEgPyBcIm1pZGRsZVwiIDogaSA9PT0gMCA/IFwic3RhcnRcIiA6IGkgPT09IG4gLSAxID8gXCJlbmRcIiA6IFwibWlkZGxlXCIpO1xuICBjb25zdCBmbGlwID0gaG92ZXIgIT09IG51bGwgJiYgeChob3ZlcikgPiB3aWR0aCAtIDE2MDtcblxuICByZXR1cm4gKFxuICAgIDxkaXYgcmVmPXtyZWZ9IHN0eWxlPXt7IHBvc2l0aW9uOiBcInJlbGF0aXZlXCIsIGhlaWdodCB9fT5cbiAgICAgIHt3aWR0aCA+IDAgJiYgKFxuICAgICAgICA8c3ZnIHdpZHRoPXt3aWR0aH0gaGVpZ2h0PXtoZWlnaHR9IHN0eWxlPXt7IGRpc3BsYXk6IFwiYmxvY2tcIiwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgIHtbMCwgMC41LCAxXS5tYXAoKGYpID0+IChcbiAgICAgICAgICAgIDxnIGtleT17Zn0+XG4gICAgICAgICAgICAgIDxsaW5lIHgxPXtMfSB4Mj17TCArIHd9IHkxPXt5KG1heCAqIGYpfSB5Mj17eShtYXggKiBmKX0gc3Ryb2tlPXtwLmJvcmRlcn0gc3Ryb2tlV2lkdGg9ezF9IHN0cm9rZURhc2hhcnJheT17ZiA/IFwiMiA0XCIgOiB1bmRlZmluZWR9IC8+XG4gICAgICAgICAgICAgIDx0ZXh0IHg9e0wgLSA2fSB5PXt5KG1heCAqIGYpfSBkeT1cIjAuMzJlbVwiIHRleHRBbmNob3I9XCJlbmRcIiBmaWxsPXtwLnRleHRNdXRlZH0+XG4gICAgICAgICAgICAgICAge2Zvcm1hdChtYXggKiBmKX1cbiAgICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICkpfVxuICAgICAgICAgIHt4TGFiZWxzLm1hcCgoaSkgPT4gKFxuICAgICAgICAgICAgPHRleHQga2V5PXtpfSB4PXt4KGkpfSB5PXtoZWlnaHQgLSA0fSB0ZXh0QW5jaG9yPXthbmNob3IoaSl9IGZpbGw9e3AudGV4dE11dGVkfT5cbiAgICAgICAgICAgICAge2xhYmVsc1tpXX1cbiAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICApKX1cbiAgICAgICAgICB7c2VyaWVzLm1hcCgocykgPT4ge1xuICAgICAgICAgICAgY29uc3QgcnVucyA9IHJ1bnNPZihzLnZhbHVlcyk7XG4gICAgICAgICAgICBjb25zdCBsaW5lID0gKHJ1bjogbnVtYmVyW10pID0+IHJ1bi5tYXAoKGksIGspID0+IGAke2sgPyBcIkxcIiA6IFwiTVwifSR7eChpKX0sJHt5KHMudmFsdWVzW2ldIGFzIG51bWJlcil9YCkuam9pbihcIlwiKTtcbiAgICAgICAgICAgIGNvbnN0IGxhc3RLbm93biA9IFsuLi5zLnZhbHVlcy5rZXlzKCldLnJldmVyc2UoKS5maW5kKChpKSA9PiBzLnZhbHVlc1tpXSAhPT0gbnVsbCk7XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICA8ZyBrZXk9e3MubmFtZX0+XG4gICAgICAgICAgICAgICAge3J1bnMubWFwKChydW4pID0+XG4gICAgICAgICAgICAgICAgICBydW4ubGVuZ3RoID4gMSA/IChcbiAgICAgICAgICAgICAgICAgICAgPGcga2V5PXtydW5bMF19PlxuICAgICAgICAgICAgICAgICAgICAgIHtzZXJpZXMubGVuZ3RoID09PSAxICYmIDxwYXRoIGQ9e2Ake2xpbmUocnVuKX1MJHt4KHJ1bltydW4ubGVuZ3RoIC0gMV0pfSwke3koMCl9TCR7eChydW5bMF0pfSwke3koMCl9WmB9IGZpbGw9e3MuY29sb3J9IGZpbGxPcGFjaXR5PXswLjEyfSAvPn1cbiAgICAgICAgICAgICAgICAgICAgICA8cGF0aCBkPXtsaW5lKHJ1bil9IGZpbGw9XCJub25lXCIgc3Ryb2tlPXtzLmNvbG9yfSBzdHJva2VXaWR0aD17Mn0gc3Ryb2tlTGluZWpvaW49XCJyb3VuZFwiIHN0cm9rZUxpbmVjYXA9XCJyb3VuZFwiIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICAgIDxjaXJjbGUga2V5PXtydW5bMF19IGN4PXt4KHJ1blswXSl9IGN5PXt5KHMudmFsdWVzW3J1blswXV0gYXMgbnVtYmVyKX0gcj17M30gZmlsbD17cy5jb2xvcn0gLz5cbiAgICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICB7bGFzdEtub3duICE9PSB1bmRlZmluZWQgJiYgaG92ZXIgPT09IG51bGwgJiYgKFxuICAgICAgICAgICAgICAgICAgPGNpcmNsZSBjeD17eChsYXN0S25vd24pfSBjeT17eShzLnZhbHVlc1tsYXN0S25vd25dIGFzIG51bWJlcil9IHI9ezMuNX0gZmlsbD17cy5jb2xvcn0gc3Ryb2tlPXtwLnN1cmZhY2V9IHN0cm9rZVdpZHRoPXsyfSAvPlxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAge2hvdmVyICE9PSBudWxsICYmIHMudmFsdWVzW2hvdmVyXSAhPT0gbnVsbCAmJiAoXG4gICAgICAgICAgICAgICAgICA8Y2lyY2xlIGN4PXt4KGhvdmVyKX0gY3k9e3kocy52YWx1ZXNbaG92ZXJdIGFzIG51bWJlcil9IHI9ezQuNX0gZmlsbD17cy5jb2xvcn0gc3Ryb2tlPXtwLnN1cmZhY2V9IHN0cm9rZVdpZHRoPXsyfSBwb2ludGVyRXZlbnRzPVwibm9uZVwiIC8+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KX1cbiAgICAgICAgICB7aG92ZXIgIT09IG51bGwgJiYgPGxpbmUgeDE9e3goaG92ZXIpfSB4Mj17eChob3Zlcil9IHkxPXtUfSB5Mj17VCArIGh9IHN0cm9rZT17cC50ZXh0TXV0ZWR9IHN0cm9rZVdpZHRoPXsxfSBwb2ludGVyRXZlbnRzPVwibm9uZVwiIC8+fVxuICAgICAgICAgIDxyZWN0IHg9e0x9IHk9ezB9IHdpZHRoPXt3fSBoZWlnaHQ9e2hlaWdodH0gZmlsbD1cInRyYW5zcGFyZW50XCIgb25Nb3VzZU1vdmU9e29uTW92ZX0gb25Nb3VzZUxlYXZlPXsoKSA9PiBzZXRIb3ZlcihudWxsKX0gLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICApfVxuICAgICAge2hvdmVyICE9PSBudWxsICYmIChcbiAgICAgICAgPFRvb2x0aXAgcD17cH0geD17eChob3ZlcikgKyAoZmxpcCA/IC0xMCA6IDEwKX0geT17VH0gZmxpcD17ZmxpcH0+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e2xhYmVsc1tob3Zlcl19PC9kaXY+XG4gICAgICAgICAge3Nlcmllcy5tYXAoKHMpID0+IChcbiAgICAgICAgICAgIDxkaXYga2V5PXtzLm5hbWV9IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDYgfX0+XG4gICAgICAgICAgICAgIHtzZXJpZXMubGVuZ3RoID4gMSAmJiA8c3BhbiBzdHlsZT17eyB3aWR0aDogOCwgaGVpZ2h0OiA4LCBib3JkZXJSYWRpdXM6IDIsIGJhY2tncm91bmQ6IHMuY29sb3IgfX0gLz59XG4gICAgICAgICAgICAgIHtzZXJpZXMubGVuZ3RoID4gMSAmJiA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e3MubmFtZX08L3NwYW4+fVxuICAgICAgICAgICAgICA8c3Bhbj57cy52YWx1ZXNbaG92ZXJdID09PSBudWxsID8gXCJVbmtub3duXCIgOiBmb3JtYXQocy52YWx1ZXNbaG92ZXJdIGFzIG51bWJlcil9PC9zcGFuPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvVG9vbHRpcD5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmludGVyZmFjZSBTZWcge1xuICBuYW1lOiBzdHJpbmc7XG4gIHZhbHVlOiBudW1iZXI7XG4gIGNvbG9yOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBCYXJSb3cge1xuICBsYWJlbDogc3RyaW5nO1xuICBzZWdtZW50czogU2VnW107XG4gIHZhbHVlVGV4dDogc3RyaW5nO1xuICB0aXA6IHN0cmluZ1tdO1xufVxuXG5mdW5jdGlvbiBMZWdlbmQoeyBhcGksIGl0ZW1zIH06IHsgYXBpOiBQbHVnaW5BcGk7IGl0ZW1zOiB7IG5hbWU6IHN0cmluZzsgY29sb3I6IHN0cmluZyB9W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZ2FwOiAxNiwgZmxleFdyYXA6IFwid3JhcFwiLCBmb250U2l6ZTogMTIsIGNvbG9yOiBwLnRleHRNdXRlZCB9fT5cbiAgICAgIHtpdGVtcy5tYXAoKGl0KSA9PiAoXG4gICAgICAgIDxzcGFuIGtleT17aXQubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJpbmxpbmUtZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDYgfX0+XG4gICAgICAgICAgPHNwYW4gc3R5bGU9e3sgd2lkdGg6IDEwLCBoZWlnaHQ6IDEwLCBib3JkZXJSYWRpdXM6IDIsIGJhY2tncm91bmQ6IGl0LmNvbG9yIH19IC8+XG4gICAgICAgICAge2l0Lm5hbWV9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICkpfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogSG9yaXpvbnRhbCAob3B0aW9uYWxseSBzdGFja2VkKSBiYXJzIHNoYXJpbmcgb25lIHNjYWxlLCB2YWx1ZSBsYWJlbHMgYXQgdGhlIGVuZC4gU2Nyb2xscyBwYXN0IEJBUl9MSVNUX0hFSUdIVC4gKi9cbmZ1bmN0aW9uIEJhckxpc3QoeyBhcGksIHJvd3MgfTogeyBhcGk6IFBsdWdpbkFwaTsgcm93czogQmFyUm93W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFtob3Zlciwgc2V0SG92ZXJdID0gdXNlU3RhdGU8eyBpOiBudW1iZXI7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0gfCBudWxsPihudWxsKTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgoMCwgLi4ucm93cy5tYXAoKHIpID0+IHIuc2VnbWVudHMucmVkdWNlKChhLCBzKSA9PiBhICsgcy52YWx1ZSwgMCkpKSB8fCAxO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHJldHVybiA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+Tm9uZTwvc3Bhbj47XG4gIGNvbnN0IGZsaXAgPSBob3ZlciAhPT0gbnVsbCAmJiBob3Zlci54ID4gd2luZG93LmlubmVyV2lkdGggLSAyMDA7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyAuLi5zY3JvbGxiYXJTdHlsZShwKSwgbWF4SGVpZ2h0OiBDSEFSVF9IRUlHSFQsIG92ZXJmbG93WTogXCJhdXRvXCIsIG92ZXJmbG93WDogXCJoaWRkZW5cIiwgcGFkZGluZ1JpZ2h0OiBHQVAgfX0gb25Nb3VzZUxlYXZlPXsoKSA9PiBzZXRIb3ZlcihudWxsKX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBcIm1pbm1heCgwLCBtYXgtY29udGVudCkgMWZyIG1heC1jb250ZW50XCIsIGdhcDogXCIycHggMTJweFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBmb250U2l6ZTogMTQgfX0+XG4gICAgICAgIHtyb3dzLm1hcCgociwgaSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHRvdGFsID0gci5zZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKTtcbiAgICAgICAgICBjb25zdCBob3QgPSBob3Zlcj8uaSA9PT0gaTtcbiAgICAgICAgICBjb25zdCBjZWxsOiBDU1NQcm9wZXJ0aWVzID0geyBiYWNrZ3JvdW5kOiBob3QgPyBwLnN1cmZhY2VIb3ZlciA6IHVuZGVmaW5lZCwgcGFkZGluZzogXCIycHggMFwiIH07XG4gICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIDxkaXYga2V5PXtyLmxhYmVsfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0gb25Nb3VzZU1vdmU9eyhlKSA9PiBzZXRIb3Zlcih7IGksIHg6IGUuY2xpZW50WCwgeTogZS5jbGllbnRZIH0pfT5cbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgLi4uY2VsbCwgY29sb3I6IGhvdCA/IHAuYWNjZW50IDogcC50ZXh0LCBtYXhXaWR0aDogMjIwLCBvdmVyZmxvdzogXCJoaWRkZW5cIiwgdGV4dE92ZXJmbG93OiBcImVsbGlwc2lzXCIsIHdoaXRlU3BhY2U6IFwibm93cmFwXCIgfX0gdGl0bGU9e3IubGFiZWx9PlxuICAgICAgICAgICAgICAgIHtyLmxhYmVsfVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgLi4uY2VsbCwgZGlzcGxheTogXCJmbGV4XCIsIGhlaWdodDogMjIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIgfX0+XG4gICAgICAgICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgd2lkdGg6IGAkeyh0b3RhbCAvIG1heCkgKiAxMDB9JWAsIGhlaWdodDogMTIsIGdhcDogMSwgbWluV2lkdGg6IHRvdGFsID4gMCA/IDIgOiAwIH19PlxuICAgICAgICAgICAgICAgICAge3Iuc2VnbWVudHNcbiAgICAgICAgICAgICAgICAgICAgLmZpbHRlcigocykgPT4gcy52YWx1ZSA+IDApXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoKHMsIGssIGFycikgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleT17cy5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3tcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZmxleDogcy52YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYmFja2dyb3VuZDogcy5jb2xvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYm9yZGVyUmFkaXVzOiBgJHtrID09PSAwID8gMiA6IDB9cHggJHtrID09PSBhcnIubGVuZ3RoIC0gMSA/IDIgOiAwfXB4ICR7ayA9PT0gYXJyLmxlbmd0aCAtIDEgPyAyIDogMH1weCAke2sgPT09IDAgPyAyIDogMH1weGAsXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgLi4uY2VsbCwgdGV4dEFsaWduOiBcInJpZ2h0XCIsIGZvbnRWYXJpYW50TnVtZXJpYzogXCJ0YWJ1bGFyLW51bXNcIiB9fT57ci52YWx1ZVRleHR9PC9zcGFuPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgKTtcbiAgICAgICAgfSl9XG4gICAgICA8L2Rpdj5cbiAgICAgIHtob3ZlciAmJiByb3dzW2hvdmVyLmldICYmIChcbiAgICAgICAgPFRvb2x0aXAgcD17cH0geD17aG92ZXIueCArIChmbGlwID8gLTEyIDogMTIpfSB5PXtob3Zlci55ICsgMTJ9IGZsaXA9e2ZsaXB9IGZpeGVkPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZm9udFdlaWdodDogNjAwIH19Pntyb3dzW2hvdmVyLmldLmxhYmVsfTwvZGl2PlxuICAgICAgICAgIHtyb3dzW2hvdmVyLmldLnRpcC5tYXAoKHQpID0+IChcbiAgICAgICAgICAgIDxkaXYga2V5PXt0fT57dH08L2Rpdj5cbiAgICAgICAgICApKX1cbiAgICAgICAgPC9Ub29sdGlwPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gVGlsZSh7IGFwaSwgbGFiZWwsIHZhbHVlLCBkZWx0YSwgdG9uZSB9OiB7IGFwaTogUGx1Z2luQXBpOyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogc3RyaW5nOyBkZWx0YT86IHN0cmluZyB8IG51bGw7IHRvbmU/OiBTdGF0dXNDb2xvciB8IG51bGwgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoXG4gICAgPGRpdlxuICAgICAgc3R5bGU9e3tcbiAgICAgICAgbWluV2lkdGg6IDAsXG4gICAgICAgIGJveFNpemluZzogXCJib3JkZXItYm94XCIsXG4gICAgICAgIGJhY2tncm91bmQ6IHAuc3VyZmFjZSxcbiAgICAgICAgYm9yZGVyOiBgMXB4IHNvbGlkICR7dG9uZSA/IHAuc3RhdHVzW3RvbmVdIDogcC5ib3JkZXJ9YCxcbiAgICAgICAgYm9yZGVyUmFkaXVzOiA2LFxuICAgICAgICBwYWRkaW5nOiBcIjEwcHggMTJweFwiLFxuICAgICAgICBkaXNwbGF5OiBcImZsZXhcIixcbiAgICAgICAgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIixcbiAgICAgICAgZ2FwOiAyLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT57bGFiZWx9PC9zcGFuPlxuICAgICAgPHNwYW4gc3R5bGU9e3sgZm9udFNpemU6IDIyLCBsaW5lSGVpZ2h0OiBcIjMwcHhcIiwgZm9udFdlaWdodDogNjAwLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIsIGNvbG9yOiB0b25lID8gcC5zdGF0dXNbdG9uZV0gOiB1bmRlZmluZWQgfX0+e3ZhbHVlfTwvc3Bhbj5cbiAgICAgIHtkZWx0YSAmJiA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT57ZGVsdGF9PC9zcGFuPn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLyoqIFdyYXBwaW5nIHJvdyBvZiBjYXJkczogZXZlcnkgcm93IGlzIGZpbGxlZCBlZGdlIHRvIGVkZ2UgYW5kIGl0cyBjYXJkcyBzaGFyZSBvbmUgaGVpZ2h0LiAqL1xuY29uc3QgVElMRV9NSU4gPSAxMzA7XG5jb25zdCBHQVAgPSAxMjtcblxuLyoqIFN0YXQgdGlsZXMgaW4gZXF1YWwgY29sdW1uczsgd2hlbiB0aGV5IGRvbid0IGZpdCBvbiBvbmUgcm93IHRoZXkgc3BsaXQgaW50byBiYWxhbmNlZCByb3dzICg2IC0+IDMrMyAtPiAyKzIrMikuICovXG5mdW5jdGlvbiBUaWxlUm93KHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlW10gfSkge1xuICBjb25zdCBbcmVmLCB3aWR0aF0gPSB1c2VXaWR0aCgpO1xuICBjb25zdCBuID0gTWF0aC5tYXgoMSwgY2hpbGRyZW4ubGVuZ3RoKTtcbiAgY29uc3QgZml0ID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcigod2lkdGggKyBHQVApIC8gKFRJTEVfTUlOICsgR0FQKSkpO1xuICBjb25zdCBjb2xzID0gd2lkdGggPyBNYXRoLmNlaWwobiAvIE1hdGguY2VpbChuIC8gTWF0aC5taW4oZml0LCBuKSkpIDogbjtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHJlZj17cmVmfSBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogYHJlcGVhdCgke2NvbHN9LCBtaW5tYXgoMCwgMWZyKSlgLCBnYXA6IEdBUCB9fT5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgRmxvdyA9ICh7IGNoaWxkcmVuIH06IHsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSA9PiA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4V3JhcDogXCJ3cmFwXCIsIGFsaWduSXRlbXM6IFwic3RyZXRjaFwiLCBnYXA6IDEyIH19PntjaGlsZHJlbn08L2Rpdj47XG5cbi8qKiBPbmx5IHdhcm5pbmcvZXJyb3IgdG9uZXMgb3V0bGluZSBhIGNhcmQ7IGFueXRoaW5nIGVsc2Uga2VlcHMgdGhlIG5vcm1hbCBib3JkZXIuICovXG5jb25zdCBhbGVydFRvbmUgPSAoczogU3RhdHVzQ29sb3IgfCBudWxsIHwgdW5kZWZpbmVkKTogU3RhdHVzQ29sb3IgfCBudWxsID0+IChzID09PSBcIndhcm5pbmdcIiB8fCBzID09PSBcImVycm9yXCIgPyBzIDogbnVsbCk7XG5cbmZ1bmN0aW9uIFNlY3Rpb24oeyBhcGksIHRpdGxlLCBleHRyYSwgdG9uZSwgY2hpbGRyZW4gfTogeyBhcGk6IFBsdWdpbkFwaTsgdGl0bGU6IHN0cmluZzsgZXh0cmE/OiBSZWFjdE5vZGU7IHRvbmU/OiBTdGF0dXNDb2xvciB8IG51bGw7IGNoaWxkcmVuOiBSZWFjdE5vZGUgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IHQgPSBhbGVydFRvbmUodG9uZSk7XG4gIHJldHVybiAoXG4gICAgPGRpdlxuICAgICAgc3R5bGU9e3tcbiAgICAgICAgZmxleDogXCIxIDEgMzIwcHhcIixcbiAgICAgICAgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIixcbiAgICAgICAgYmFja2dyb3VuZDogcC5zdXJmYWNlLFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHt0ID8gcC5zdGF0dXNbdF0gOiBwLmJvcmRlcn1gLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDYsXG4gICAgICAgIHBhZGRpbmc6IDEyLFxuICAgICAgICBkaXNwbGF5OiBcImZsZXhcIixcbiAgICAgICAgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIixcbiAgICAgICAgZ2FwOiA4LFxuICAgICAgICBtaW5XaWR0aDogMCxcbiAgICAgIH19XG4gICAgPlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiAxMiwgZmxleFdyYXA6IFwid3JhcFwiIH19PlxuICAgICAgICA8c3Ryb25nIHN0eWxlPXt7IGZsZXg6IDEgfX0+e3RpdGxlfTwvc3Ryb25nPlxuICAgICAgICB7ZXh0cmF9XG4gICAgICA8L2Rpdj5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBtZXRyaWMgdmlld3MgLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgVHJlbmQge1xuICB0aXRsZTogc3RyaW5nO1xuICBrZXk6IHN0cmluZztcbiAgZ2V0OiAoZG9jOiBKc29uKSA9PiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkO1xufVxuXG4vKiogVGlsZSB2YWx1ZSBmcm9tIHRoZSBsYXRlc3QgZG9jLCBkZWx0YSBhZ2FpbnN0IHRoZSBwcmV2aW91cyBkYXkgaW4gaGlzdG9yeS4gKi9cbmZ1bmN0aW9uIHRyZW5kVGlsZShhcGk6IFBsdWdpbkFwaSwgZGF5czogRGF5W10sIHQ6IFRyZW5kKSB7XG4gIGNvbnN0IHZhbHMgPSBkYXlzLm1hcCgoZCkgPT4gdC5nZXQoZC5kb2MpKTtcbiAgY29uc3QgY3VyID0gdmFsc1t2YWxzLmxlbmd0aCAtIDFdO1xuICBjb25zdCBwcmV2ID0gdmFscy5sZW5ndGggPiAxID8gdmFsc1t2YWxzLmxlbmd0aCAtIDJdIDogdW5kZWZpbmVkO1xuICBsZXQgZGVsdGE6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBpZiAodHlwZW9mIGN1ciA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgcHJldiA9PT0gXCJudW1iZXJcIikge1xuICAgIGNvbnN0IGQgPSBjdXIgLSBwcmV2O1xuICAgIGNvbnN0IGFicyA9IE1PTkVZX0tFWS50ZXN0KHQua2V5KSA/IG1vbmV5LmZvcm1hdChNYXRoLmFicyhkKSkgOiBNYXRoLmFicyhkKS50b0xvY2FsZVN0cmluZygpO1xuICAgIGRlbHRhID0gYCR7ZCA+IDAgPyBcIitcIiA6IGQgPCAwID8gXCItXCIgOiBcIlx1MDBCMVwifSR7YWJzfSB2cyAke3Nob3J0RGF0ZShkYXlzW2RheXMubGVuZ3RoIC0gMl0uZGF0ZSl9YDtcbiAgfVxuICByZXR1cm4gPFRpbGUga2V5PXt0LnRpdGxlfSBhcGk9e2FwaX0gbGFiZWw9e3QudGl0bGV9IHZhbHVlPXtmbXQoY3VyLCB0LmtleSl9IGRlbHRhPXtkZWx0YX0gdG9uZT17dmFsdWVUb25lKHQua2V5LCBjdXIpfSAvPjtcbn1cblxuLyoqIE9uZSBjYXJkIHBlciB0cmVuZCB0aGF0IGhhcyBkYXRhOyByZW5kZXJlZCBhcyBhIGZyYWdtZW50IHNvIHRoZSBjYXJkcyBqb2luIHRoZSBzdXJyb3VuZGluZyBGbG93LiAqL1xuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RyZW5kc1xuICAgICAgICAubWFwKCh0KSA9PiAoeyB0LCBwb2ludHM6IGRheXMubWFwKChkKSA9PiAoeyBsYWJlbDogc2hvcnREYXRlKGQuZGF0ZSksIHJhdzogdC5nZXQoZC5kb2MpIH0pKSB9KSlcbiAgICAgICAgLmZpbHRlcigoeyBwb2ludHMgfSkgPT4gcG9pbnRzLnNvbWUoKHB0KSA9PiBwdC5yYXcgIT09IHVuZGVmaW5lZCkpXG4gICAgICAgIC5tYXAoKHsgdCwgcG9pbnRzIH0pID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSB0aXRsZT17YCR7dC50aXRsZX0gVHJlbmRgfT5cbiAgICAgICAgICAgIDxMaW5lQ2hhcnRcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIGxhYmVscz17cG9pbnRzLm1hcCgocHQpID0+IHB0LmxhYmVsKX1cbiAgICAgICAgICAgICAgc2VyaWVzPXtbeyBuYW1lOiB0LnRpdGxlLCBjb2xvcjogYXBpLnRoZW1lLnBhbGV0dGUuYWNjZW50LCB2YWx1ZXM6IHBvaW50cy5tYXAoKHB0KSA9PiBwdC5yYXcgPz8gbnVsbCkgfV19XG4gICAgICAgICAgICAgIGZvcm1hdD17YXhpc0ZtdCh0LmtleSl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgPC8+XG4gICk7XG59XG5cbmZ1bmN0aW9uIEhpc3RvcnlIaW50KHsgYXBpLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGRheXM6IERheVtdIH0pIHtcbiAgaWYgKGRheXMubGVuZ3RoID49IDIpIHJldHVybiBudWxsO1xuICByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IGFwaS50aGVtZS5wYWxldHRlLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlRyZW5kcyBmaWxsIGluIGFzIGRhaWx5IGhpc3RvcnkgYWNjdW11bGF0ZXMgKHtkYXlzLmxlbmd0aH0gZGF5IHNvIGZhcikuPC9zcGFuPjtcbn1cblxuZnVuY3Rpb24gY29zdFJvd3MoYXBpOiBQbHVnaW5BcGksIGNvc3Q6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKGNvc3Q/LmJ5VGFnID8/IHt9KVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAuc29ydCgoWywgYV0sIFssIGJdKSA9PiAoYiBhcyBudW1iZXIpIC0gKGEgYXMgbnVtYmVyKSlcbiAgICAubWFwKChbaywgdl0pID0+ICh7XG4gICAgICBsYWJlbDogayxcbiAgICAgIHNlZ21lbnRzOiBbeyBuYW1lOiBcIkNvc3RcIiwgdmFsdWU6IHYgYXMgbnVtYmVyLCBjb2xvcjogcC5hY2NlbnQgfV0sXG4gICAgICB2YWx1ZVRleHQ6IG1vbmV5LmZvcm1hdCh2IGFzIG51bWJlciksXG4gICAgICB0aXA6IFtgJHttb25leS5mb3JtYXQodiBhcyBudW1iZXIpfSAoJHtjb3N0LnRvdGFsID8gKCgodiBhcyBudW1iZXIpIC8gY29zdC50b3RhbCkgKiAxMDApLnRvRml4ZWQoMSkgOiBcIjBcIn0lIG9mIHRvdGFsKWBdLFxuICAgIH0pKTtcbn1cblxuLyoqIEFwcHMgdG9vIHNtYWxsIGZvciB0aGVpciBvd24gdGFiOyB0aGV5IGdldCBvbmUgaW52b2NhdGlvbnMtdnMtZXJyb3JzIGNhcmQgb24gdGhlIE92ZXJ2aWV3IGluc3RlYWQuICovXG5jb25zdCBPVkVSVklFV19PTkxZX0FQUFM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IFNlY3JldHNNYW5hZ2VyOiBcIkdsb2JhbCBTZWNyZXRzIFRyZW5kXCIgfTtcblxuLyoqIFN1bSBvZiBhIExhbWJkYSBtZXRyaWMgYWNyb3NzIGFuIGFwcCdzIGZ1bmN0aW9uczsgdW5rbm93biBpZiBhbnkgZnVuY3Rpb24ncyB2YWx1ZSBpcyB1bmtub3duLiAqL1xuZnVuY3Rpb24gbGFtYmRhU3VtKGFwcDogSnNvbiwgZmllbGQ6IFwiaW52b2NhdGlvbnNcIiB8IFwiZXJyb3JzXCIpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbGFtYmRhcyA9IGFwcD8ubW9uaXRvcmluZz8ubGFtYmRhcztcbiAgaWYgKGxhbWJkYXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGxhbWJkYXMgPT09IG51bGwgfHwgaXNFcnJvck5vZGUobGFtYmRhcykgfHwgaXNFcnJvck5vZGUoYXBwLm1vbml0b3JpbmcpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IE9iamVjdC52YWx1ZXMobGFtYmRhcykubWFwKCh2KSA9PiBtZXRyaWModiwgZmllbGQpKTtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdHlwZW9mIHYgIT09IFwibnVtYmVyXCIpID8gbnVsbCA6ICh2YWxzIGFzIG51bWJlcltdKS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcbn1cblxuZnVuY3Rpb24gSW52b2NhdGlvbnNUcmVuZCh7IGFwaSwgZGF5cywgYXBwTmFtZSwgdGl0bGUgfTogeyBhcGk6IFBsdWdpbkFwaTsgZGF5czogRGF5W107IGFwcE5hbWU6IHN0cmluZzsgdGl0bGU6IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgYXBwRGF5cyA9IGRheXMubWFwKChkKSA9PiAoeyBkYXRlOiBkLmRhdGUsIGFwcDogYXBwc09mKGQuZG9jKS5maW5kKChhKSA9PiBhLm5hbWUgPT09IGFwcE5hbWUpIH0pKS5maWx0ZXIoKGQpID0+IGQuYXBwKTtcbiAgaWYgKGFwcERheXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VyaWVzOiBTZXJpZXNbXSA9IFtcbiAgICB7IG5hbWU6IFwiSW52b2NhdGlvbnNcIiwgY29sb3I6IHAuYWNjZW50LCB2YWx1ZXM6IGFwcERheXMubWFwKChkKSA9PiBsYW1iZGFTdW0oZC5hcHAsIFwiaW52b2NhdGlvbnNcIikgPz8gbnVsbCkgfSxcbiAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciwgdmFsdWVzOiBhcHBEYXlzLm1hcCgoZCkgPT4gbGFtYmRhU3VtKGQuYXBwLCBcImVycm9yc1wiKSA/PyBudWxsKSB9LFxuICBdO1xuICByZXR1cm4gKFxuICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT17dGl0bGV9IGV4dHJhPXs8TGVnZW5kIGFwaT17YXBpfSBpdGVtcz17c2VyaWVzfSAvPn0+XG4gICAgICA8TGluZUNoYXJ0IGFwaT17YXBpfSBsYWJlbHM9e2FwcERheXMubWFwKChkKSA9PiBzaG9ydERhdGUoZC5kYXRlKSl9IHNlcmllcz17c2VyaWVzfSBmb3JtYXQ9e2F4aXNGbXQoXCJcIil9IC8+XG4gICAgPC9TZWN0aW9uPlxuICApO1xufVxuXG5jb25zdCBPVkVSVklFV19UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiQVdTIENvc3QgKDMwZClcIiwga2V5OiBcImNvc3RcIiwgZ2V0OiAoZCkgPT4gbWV0cmljKGQsIFwiYXdzQ29zdC50b3RhbFwiKSB9LFxuICB7IHRpdGxlOiBcIlJlcXVlc3RzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpIH0sXG4gIHsgdGl0bGU6IFwiTGFtYmRhIEVycm9ycyAoMjRoKVwiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCI1eHggRXJyb3JzICgyNGgpXCIsIGtleTogXCJlcnJvcnM1eHhcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLmVycm9yczV4eFwiKSB9LFxuICB7IHRpdGxlOiBcIkFsYXJtcyBGaXJpbmdcIiwga2V5OiBcImluQWxhcm1cIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcImhlYWx0aC5hbGFybXMuaW5BbGFybVwiKSB9LFxuICB7IHRpdGxlOiBcIlBheWluZyBDdXN0b21lcnNcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuXTtcblxuZnVuY3Rpb24gT3ZlcnZpZXcoeyBhcGksIGRvYywgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkb2M6IEpzb247IGRheXM6IERheVtdIH0pIHtcbiAgY29uc3QgeyBTdGF0dXNEb3QgfSA9IGFwaS51aTtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBhcHBzID0gYXBwc09mKGRvYyk7XG4gIGNvbnN0IGNvc3QgPSBkb2MuYXdzQ29zdDtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVSb3c+e09WRVJWSUVXX1RSRU5EUy5maWx0ZXIoKHQpID0+IHQuZ2V0KGRvYykgIT09IHVuZGVmaW5lZCkubWFwKCh0KSA9PiB0cmVuZFRpbGUoYXBpLCBkYXlzLCB0KSl9PC9UaWxlUm93PlxuICAgICAgPEhpc3RvcnlIaW50IGFwaT17YXBpfSBkYXlzPXtkYXlzfSAvPlxuICAgICAgPEZsb3c+XG4gICAgICAgIDxUcmVuZENoYXJ0cyBhcGk9e2FwaX0gZGF5cz17ZGF5c30gdHJlbmRzPXtPVkVSVklFV19UUkVORFMuc2xpY2UoMCwgMyl9IC8+XG4gICAgICAgIHtPYmplY3QuZW50cmllcyhPVkVSVklFV19PTkxZX0FQUFMpLm1hcCgoW25hbWUsIHRpdGxlXSkgPT4gKFxuICAgICAgICAgIDxJbnZvY2F0aW9uc1RyZW5kIGtleT17bmFtZX0gYXBpPXthcGl9IGRheXM9e2RheXN9IGFwcE5hbWU9e25hbWV9IHRpdGxlPXt0aXRsZX0gLz5cbiAgICAgICAgKSl9XG4gICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT1cIkFwcHNcIiB0b25lPXt3b3JzdChhcHBzLm1hcChhcHBTdGF0dXMpKX0+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJhdXRvIDFmciBtYXgtY29udGVudCBtYXgtY29udGVudCBtYXgtY29udGVudFwiLCBnYXA6IFwiNHB4IDEycHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiB9fT5cbiAgICAgICAgICAgIHtbXCJcIiwgXCJBcHBcIiwgXCJSZXF1ZXN0c1wiLCBcIkVycm9yc1wiLCBcIlByb2ZpdCAoMzBkKVwiXS5tYXAoKGgpID0+IChcbiAgICAgICAgICAgICAgPHNwYW4ga2V5PXtoIHx8IFwiZG90XCJ9IHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgICAgICAgIHtofVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgICAgIHthcHBzLm1hcCgoYSkgPT4gKFxuICAgICAgICAgICAgICA8ZGl2IGtleT17YS5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0+XG4gICAgICAgICAgICAgICAgPFN0YXR1c0RvdCBjb2xvcj17YXBwU3RhdHVzKGEpfSAvPlxuICAgICAgICAgICAgICAgIDxzcGFuPnthLm5hbWV9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uZXkucHJvZml0MzBkXCIpLCBcInByb2ZpdFwiKX08L3NwYW4+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPXtgQVdTIENvc3QgQnkgUHJvamVjdCR7Y29zdCAmJiAhaXNFcnJvck5vZGUoY29zdCkgPyBgICgke3Nob3J0RGF0ZShjb3N0LndpbmRvd1N0YXJ0KX0gVG8gJHtzaG9ydERhdGUoY29zdC53aW5kb3dFbmQpfSlgIDogXCJcIn1gfT5cbiAgICAgICAgICB7IWNvc3QgfHwgaXNFcnJvck5vZGUoY29zdCkgPyA8c3Bhbj57Zm10KGNvc3QpfTwvc3Bhbj4gOiA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17Y29zdFJvd3MoYXBpLCBjb3N0KX0gLz59XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgIDwvRmxvdz5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gbGFtYmRhUm93cyhhcGk6IFBsdWdpbkFwaSwgbGFtYmRhczogSnNvbik6IHsgcm93czogQmFyUm93W107IGlkbGU6IG51bWJlcjsgdW5rbm93bjogc3RyaW5nW10gfSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3Qgcm93czogQmFyUm93W10gPSBbXTtcbiAgY29uc3QgdW5rbm93bjogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGlkbGUgPSAwO1xuICBmb3IgKGNvbnN0IFtmbiwgdl0gb2YgT2JqZWN0LmVudHJpZXMobGFtYmRhcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSkge1xuICAgIGNvbnN0IGludiA9IG1ldHJpYyh2LCBcImludm9jYXRpb25zXCIpO1xuICAgIGlmICh0eXBlb2YgaW52ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB1bmtub3duLnB1c2goZm4pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbnYgPT09IDApIHtcbiAgICAgIGlkbGUrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBlcnIgPSBtZXRyaWModiwgXCJlcnJvcnNcIikgPz8gMDtcbiAgICBjb25zdCB0aHIgPSBtZXRyaWModiwgXCJ0aHJvdHRsZXNcIikgPz8gMDtcbiAgICByb3dzLnB1c2goe1xuICAgICAgbGFiZWw6IGZuLFxuICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgeyBuYW1lOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogTWF0aC5tYXgoMCwgaW52IC0gZXJyKSwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgdmFsdWU6IGVyciwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICBdLFxuICAgICAgdmFsdWVUZXh0OiBlcnIgPyBgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gKCR7KChlcnIgLyBpbnYpICogMTAwKS50b0ZpeGVkKDApfSUgRXJyKWAgOiBpbnYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgIHRpcDogW2Ake2ludi50b0xvY2FsZVN0cmluZygpfSBpbnZvY2F0aW9uc2AsIGAke2Vyci50b0xvY2FsZVN0cmluZygpfSBlcnJvcnNgLCBgJHt0aHIudG9Mb2NhbGVTdHJpbmcoKX0gdGhyb3R0bGVzYF0sXG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzWzBdLnZhbHVlICsgYi5zZWdtZW50c1sxXS52YWx1ZSAtIChhLnNlZ21lbnRzWzBdLnZhbHVlICsgYS5zZWdtZW50c1sxXS52YWx1ZSkpO1xuICByZXR1cm4geyByb3dzLCBpZGxlLCB1bmtub3duIH07XG59XG5cbmZ1bmN0aW9uIGFwaVJvd3MoYXBpOiBQbHVnaW5BcGksIGFwaXM6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChPYmplY3QuZW50cmllcyhhcGlzID8/IHt9KSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgbWV0cmljKHYsIFwicmVxdWVzdHNcIikgPT09IFwibnVtYmVyXCIpXG4gICAgLm1hcCgoW25hbWUsIHZdKSA9PiB7XG4gICAgICBjb25zdCByZXEgPSBtZXRyaWModiwgXCJyZXF1ZXN0c1wiKSBhcyBudW1iZXI7XG4gICAgICBjb25zdCBlNCA9IG1ldHJpYyh2LCBcImVycm9yczR4eFwiKSA/PyAwO1xuICAgICAgY29uc3QgZTUgPSBtZXRyaWModiwgXCJlcnJvcnM1eHhcIikgPz8gMDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGxhYmVsOiBuYW1lLFxuICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgIHsgbmFtZTogXCJPS1wiLCB2YWx1ZTogTWF0aC5tYXgoMCwgcmVxIC0gZTQgLSBlNSksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgIHsgbmFtZTogXCI0eHhcIiwgdmFsdWU6IGU0LCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgIHsgbmFtZTogXCI1eHhcIiwgdmFsdWU6IGU1LCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgXSxcbiAgICAgICAgdmFsdWVUZXh0OiByZXEudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgdGlwOiBbYCR7cmVxLnRvTG9jYWxlU3RyaW5nKCl9IHJlcXVlc3RzYCwgYCR7ZTQudG9Mb2NhbGVTdHJpbmcoKX0gNHh4LCAke2U1LnRvTG9jYWxlU3RyaW5nKCl9IDV4eGAsIGBwOTUgbGF0ZW5jeTogJHtmbXQodi5wOTVMYXRlbmN5TXMsIFwibGF0ZW5jeW1zXCIpfWBdLFxuICAgICAgfTtcbiAgICB9KVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzLnJlZHVjZSgocywgeCkgPT4gcyArIHgudmFsdWUsIDApIC0gYS5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSk7XG59XG5cbmZ1bmN0aW9uIFJvd3MoeyBhcGksIHZhbHVlLCBwYXRoID0gXCJcIiB9OiB7IGFwaTogUGx1Z2luQXBpOyB2YWx1ZTogSnNvbjsgcGF0aD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBpc0Vycm9yTm9kZSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gPHNwYW4+e2ZtdCh2YWx1ZSwgcGF0aCl9PC9zcGFuPjtcbiAgfVxuICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgdl0pID0+ICEodHlwZW9mIHYgPT09IFwic3RyaW5nXCIgJiYgKHYubGVuZ3RoID4gODAgfHwgdi5pbmNsdWRlcyhcIlxcblwiKSkpKTtcbiAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwibWF4LWNvbnRlbnQgMWZyXCIsIGdhcDogXCIycHggMTZweFwiIH19PlxuICAgICAge2VudHJpZXMubWFwKChbaywgdl0pID0+IHtcbiAgICAgICAgY29uc3QgbmVzdGVkID0gdiAhPT0gbnVsbCAmJiB0eXBlb2YgdiA9PT0gXCJvYmplY3RcIiAmJiAhaXNFcnJvck5vZGUodik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPGRpdiBrZXk9e2t9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fT5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57dGl0bGVDYXNlKGspfTwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiB2YWx1ZVRvbmUoaywgdikgPyBwLnN0YXR1c1t2YWx1ZVRvbmUoaywgdikgYXMgU3RhdHVzQ29sb3JdIDogdW5kZWZpbmVkIH19PlxuICAgICAgICAgICAgICB7bmVzdGVkID8gQXJyYXkuaXNBcnJheSh2KSA/IDxzcGFuPnt2Lmxlbmd0aCA/IHYuam9pbihcIiwgXCIpIDogXCJOb25lXCJ9PC9zcGFuPiA6IDxSb3dzIGFwaT17YXBpfSB2YWx1ZT17dn0gcGF0aD17a30gLz4gOiBmbXQodiwgayl9XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICk7XG4gICAgICB9KX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgdGl0bGVDYXNlID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC8oW0EtWl0pL2csIFwiICQxXCIpLnJlcGxhY2UoL14uLywgKGMpID0+IGMudG9VcHBlckNhc2UoKSk7XG5cbmNvbnN0IEFQUF9UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuICB7IHRpdGxlOiBcIk1SUlwiLCBrZXk6IFwibXJyXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5Lm1yclwiKSB9LFxuICB7IHRpdGxlOiBcIlByb2ZpdCAoMzBkKVwiLCBrZXk6IFwicHJvZml0XCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSB9LFxuXTtcblxuZnVuY3Rpb24gQXBwVmlldyh7IGFwaSwgYXBwLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGFwcDogSnNvbjsgZGF5czogRGF5W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBkb2M6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHAubmFtZSkgfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpO1xuICBjb25zdCBtb24gPSBhcHAubW9uaXRvcmluZztcbiAgY29uc3QgYXVkID0gYXBwLmF1ZGllbmNlO1xuICBjb25zdCBhdWREYXlzOiBKc29uW10gPSBhdWQgJiYgQXJyYXkuaXNBcnJheShhdWQuZGF5cykgPyBhdWQuZGF5cyA6IFtdO1xuICBjb25zdCBhdWRLZXlzID0gYXVkRGF5cy5sZW5ndGggPyBPYmplY3Qua2V5cyhhdWREYXlzWzBdKS5maWx0ZXIoKGspID0+IGsgIT09IFwiZGF0ZVwiICYmIHR5cGVvZiBhdWREYXlzWzBdW2tdID09PSBcIm51bWJlclwiKSA6IFtdO1xuICBjb25zdCBsYW1iZGFzID0gbW9uICYmICFpc0Vycm9yTm9kZShtb24pICYmICFpc0Vycm9yTm9kZShtb24ubGFtYmRhcykgPyBsYW1iZGFSb3dzKGFwaSwgbW9uLmxhbWJkYXMpIDogbnVsbDtcbiAgY29uc3QgYXBpcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmFwaXMpID8gYXBpUm93cyhhcGksIG1vbi5hcGlzKSA6IG51bGw7XG4gIGNvbnN0IGRldGFpbHMgPSBPYmplY3QuZW50cmllcyhhcHApLmZpbHRlcigoW2tdKSA9PiBrICE9PSBcIm5hbWVcIiAmJiBrICE9PSBcIm1vbml0b3JpbmdcIik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVSb3c+e0FQUF9UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChhcHApICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgYXBwRGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17YXBwRGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2FwcERheXN9IHRyZW5kcz17QVBQX1RSRU5EU30gLz5cbiAgICAgICAge21vbiAmJiBpc0Vycm9yTm9kZShtb24pICYmIChcbiAgICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJNb25pdG9yaW5nICgyNGgpXCIgdG9uZT1cIndhcm5pbmdcIj5cbiAgICAgICAgICAgIDxzcGFuPntmbXQobW9uKX08L3NwYW4+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7YXBpcyAmJiBhcGlzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uXG4gICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgIHRpdGxlPVwiQVBJIFJlcXVlc3RzICgyNGgpXCJcbiAgICAgICAgICAgIHRvbmU9e2FwaXMuc29tZSgocikgPT4gci5zZWdtZW50cy5zb21lKChzKSA9PiBzLm5hbWUgPT09IFwiNXh4XCIgJiYgcy52YWx1ZSA+IDApKSA/IFwid2FybmluZ1wiIDogbnVsbH1cbiAgICAgICAgICAgIGV4dHJhPXtcbiAgICAgICAgICAgICAgPExlZ2VuZFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIGl0ZW1zPXtbXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiT0tcIiwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiNHh4XCIsIGNvbG9yOiBwLnN0YXR1cy53YXJuaW5nIH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiNXh4XCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgICAgICAgICAgIF19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICB9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2FwaXN9IC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7bGFtYmRhcyAmJiBsYW1iZGFzLnJvd3MubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgPFNlY3Rpb25cbiAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgdGl0bGU9XCJMYW1iZGEgSW52b2NhdGlvbnMgKDI0aClcIlxuICAgICAgICAgICAgZXh0cmE9e1xuICAgICAgICAgICAgICA8TGVnZW5kXG4gICAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgICAgaXRlbXM9e1tcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCJTdWNjZWVkZWRcIiwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgICAgICAgICAgIF19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICB9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2xhbWJkYXMucm93c30gLz5cbiAgICAgICAgICAgIHsobGFtYmRhcy5pZGxlID4gMCB8fCBsYW1iZGFzLnVua25vd24ubGVuZ3RoID4gMCkgJiYgKFxuICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICAgICAgICB7W2xhbWJkYXMuaWRsZSA/IGAke2xhbWJkYXMuaWRsZX0gaWRsZSBmdW5jdGlvbiR7bGFtYmRhcy5pZGxlID4gMSA/IFwic1wiIDogXCJcIn0gaGlkZGVuYCA6IFwiXCIsIGxhbWJkYXMudW5rbm93bi5sZW5ndGggPyBgVW5rbm93bjogJHtsYW1iZGFzLnVua25vd24uam9pbihcIiwgXCIpfWAgOiBcIlwiXVxuICAgICAgICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgICAgICAgICAgICAgLmpvaW4oXCIuIFwiKX1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHthdWRLZXlzLm1hcCgoaykgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17a30gYXBpPXthcGl9IHRpdGxlPXtgRGFpbHkgJHt0aXRsZUNhc2Uoayl9YH0+XG4gICAgICAgICAgICA8TGluZUNoYXJ0XG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICBsYWJlbHM9e2F1ZERheXMubWFwKChkKSA9PiBzaG9ydERhdGUoU3RyaW5nKGQuZGF0ZSkpKX1cbiAgICAgICAgICAgICAgc2VyaWVzPXtbeyBuYW1lOiB0aXRsZUNhc2UoayksIGNvbG9yOiBwLmFjY2VudCwgdmFsdWVzOiBhdWREYXlzLm1hcCgoZCkgPT4gKHR5cGVvZiBkW2tdID09PSBcIm51bWJlclwiID8gZFtrXSA6IG51bGwpKSB9XX1cbiAgICAgICAgICAgICAgZm9ybWF0PXtheGlzRm10KGspfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgICB7YXVkPy5zb3VyY2VzMzBkICYmICFpc0Vycm9yTm9kZShhdWQuc291cmNlczMwZCkgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT1cIlRyYWZmaWMgU291cmNlcyAoMzBkKVwiPlxuICAgICAgICAgICAgPEJhckxpc3RcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHJvd3M9eyhPYmplY3QuZW50cmllcyhhdWQuc291cmNlczMwZCkgYXMgW3N0cmluZywgSnNvbl1bXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpXG4gICAgICAgICAgICAgICAgLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gYiAtIGEpXG4gICAgICAgICAgICAgICAgLm1hcCgoW2ssIHZdKSA9PiAoe1xuICAgICAgICAgICAgICAgICAgbGFiZWw6IHRpdGxlQ2FzZShrKSxcbiAgICAgICAgICAgICAgICAgIHNlZ21lbnRzOiBbeyBuYW1lOiBcIlZpZXdzXCIsIHZhbHVlOiB2LCBjb2xvcjogcC5hY2NlbnQgfV0sXG4gICAgICAgICAgICAgICAgICB2YWx1ZVRleHQ6IHYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgICAgICAgICAgIHRpcDogW2Ake3YudG9Mb2NhbGVTdHJpbmcoKX0gdmlld3NgXSxcbiAgICAgICAgICAgICAgICB9KSl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2RldGFpbHMubWFwKChbaywgdl0pID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e2t9IGFwaT17YXBpfSB0aXRsZT17dGl0bGVDYXNlKGspfSB0b25lPXtncm91cFRvbmUodil9PlxuICAgICAgICAgICAgPFJvd3NcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHZhbHVlPXtrID09PSBcImF1ZGllbmNlXCIgJiYgdiAmJiAhaXNFcnJvck5vZGUodikgPyBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModikuZmlsdGVyKChba2tdKSA9PiBrayAhPT0gXCJkYXlzXCIgJiYga2sgIT09IFwic291cmNlczMwZFwiKSkgOiB2fVxuICAgICAgICAgICAgICBwYXRoPXtrfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgPC9GbG93PlxuICAgIDwvZGl2PlxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gQ29tcG9uZW50KHsgYXBpIH06IHsgYXBpOiBQbHVnaW5BcGk7IHBhbmVJZD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHsgVGV4dEJ1dHRvbiwgVGFicywgQmFubmVyLCBTcGlubmVyIH0gPSBhcGkudWk7XG4gIGNvbnN0IHBhbGV0dGUgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgWywgZm9yY2VdID0gdXNlU3RhdGUoMCk7XG4gIGNvbnN0IFt0YWIsIHNldFRhYl0gPSB1c2VTdGF0ZShcIm92ZXJ2aWV3XCIpO1xuICBjb25zdCBbLCBzZXRUaGVtZV0gPSB1c2VTdGF0ZSgwKTtcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGwgPSAoKSA9PiBmb3JjZSgobikgPT4gbiArIDEpO1xuICAgIGxpc3RlbmVycy5hZGQobCk7XG4gICAgY29uc3QgdW5zdWIgPSBhcGkudGhlbWUuc3Vic2NyaWJlKCgpID0+IHNldFRoZW1lKChuKSA9PiBuICsgMSkpO1xuICAgIGlmICghc3RhdGUuZGF0YSkge1xuICAgICAgdm9pZCBhcGkuc3RvcmFnZS5nZXQ8SnNvbj4oQ0FDSEVfS0VZKS50aGVuKChjYWNoZWQpID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhc3RhdGUuZGF0YSkgc2V0U3RhdGUoeyBkYXRhOiBjYWNoZWQgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGxpc3RlbmVycy5kZWxldGUobCk7XG4gICAgICB1bnN1YigpO1xuICAgIH07XG4gIH0sIFthcGldKTtcblxuICBjb25zdCB7IGRhdGEsIGVycm9yLCBsb2FkaW5nIH0gPSBzdGF0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkYXRhKTtcbiAgY29uc3QgZGF5cyA9IGFsbERheXMoKTtcbiAgY29uc3QgYWdlID0gZGF0YSA/IGFnZUhvdXJzKGRhdGEuZ2VuZXJhdGVkQXQpIDogbnVsbDtcbiAgY29uc3Qgc3RhbGUgPSBkYXRhICYmIChhZ2UgPT09IG51bGwgfHwgYWdlID4gU1RBTEVfSE9VUlMpO1xuICBjb25zdCB0YWJBcHBzID0gYXBwcy5maWx0ZXIoKGEpID0+ICEoYS5uYW1lIGluIE9WRVJWSUVXX09OTFlfQVBQUykpO1xuICBjb25zdCBjdXJyZW50ID0gdGFiID09PSBcIm92ZXJ2aWV3XCIgPyBudWxsIDogdGFiQXBwcy5maW5kKChhKSA9PiBhLm5hbWUgPT09IHRhYik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGZsZXg6IDEsIG1pbkhlaWdodDogMCwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMTIsIGNvbG9yOiBwYWxldHRlLnRleHQgfX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBwYWRkaW5nUmlnaHQ6IDI0IH19PlxuICAgICAgICA8aDIgc3R5bGU9e3sgbWFyZ2luOiAwIH19PntOQU1FfTwvaDI+XG4gICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwYWxldHRlLnRleHRNdXRlZCwgZmxleDogMSB9fT5cbiAgICAgICAgICB7ZGF0YVxuICAgICAgICAgICAgPyBgR2VuZXJhdGVkICR7ZGF0YS5nZW5lcmF0ZWRBdCA/IG5ldyBEYXRlKGRhdGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCkgOiBcIlVua25vd25cIn0gXHUwMEI3ICR7ZGF5cy5sZW5ndGh9IERheSR7ZGF5cy5sZW5ndGggPT09IDEgPyBcIlwiIDogXCJzXCJ9IE9mIEhpc3RvcnlgXG4gICAgICAgICAgICA6IFwiTm8gRGF0YSBZZXRcIn1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgICB7bG9hZGluZyAmJiA8U3Bpbm5lciBzaXplPXsxNn0gLz59XG4gICAgICAgIDxUZXh0QnV0dG9uIGxhYmVsPVwiUmVmcmVzaFwiIHZhcmlhbnQ9XCJwcmltYXJ5XCIgZGlzYWJsZWQ9e2xvYWRpbmd9IG9uQ2xpY2s9eygpID0+IHZvaWQgcmVmcmVzaChhcGkpfSAvPlxuICAgICAgPC9kaXY+XG4gICAgICB7ZXJyb3IgJiYgPEJhbm5lciBtZXNzYWdlPXtgQ291bGQgTm90IExvYWQgTWV0cmljczogJHtlcnJvcn1gfSB0b25lPVwiZXJyb3JcIiAvPn1cbiAgICAgIHtzdGFsZSAmJiA8QmFubmVyIG1lc3NhZ2U9e2BNZXRyaWNzIEFyZSBPbGRlciBUaGFuICR7U1RBTEVfSE9VUlN9IEhvdXJzOyBUaGUgRGFpbHkgQ29sbGVjdG9yIE1heSBIYXZlIEZhaWxlZGB9IHRvbmU9XCJ3YXJuaW5nXCIgLz59XG4gICAgICB7ZGF0YSAmJiAoXG4gICAgICAgIDw+XG4gICAgICAgICAgPFRhYnNcbiAgICAgICAgICAgIHRhYnM9e1t7IGxhYmVsOiBcIk92ZXJ2aWV3XCIsIHZhbHVlOiBcIm92ZXJ2aWV3XCIgfSwgLi4udGFiQXBwcy5tYXAoKGEpID0+ICh7IGxhYmVsOiBhLm5hbWUgYXMgc3RyaW5nLCB2YWx1ZTogYS5uYW1lIGFzIHN0cmluZyB9KSldfVxuICAgICAgICAgICAgdmFsdWU9e2N1cnJlbnQgPyB0YWIgOiBcIm92ZXJ2aWV3XCJ9XG4gICAgICAgICAgICBvbkNoYW5nZT17c2V0VGFifVxuICAgICAgICAgIC8+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyAuLi5zY3JvbGxiYXJTdHlsZShwYWxldHRlKSwgZmxleDogMSwgbWluSGVpZ2h0OiAwLCBvdmVyZmxvdzogXCJhdXRvXCIsIHBhZGRpbmdSaWdodDogR0FQIH19PlxuICAgICAgICAgICAge2N1cnJlbnQgPyA8QXBwVmlldyBhcGk9e2FwaX0gYXBwPXtjdXJyZW50fSBkYXlzPXtkYXlzfSAvPiA6IDxPdmVydmlldyBhcGk9e2FwaX0gZG9jPXtkYXRhfSBkYXlzPXtkYXlzfSAvPn1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC8+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUNBLFNBQVMsV0FBVyxRQUFRLGdCQUFnQjtBQXNSeEMsU0FrVEEsVUFsVEEsS0F5RVEsWUF6RVI7QUFsUkosSUFBTSxPQUFPO0FBQ2IsSUFBTSxjQUFjO0FBQ3BCLElBQU0sWUFBWTtBQUNsQixJQUFNLGNBQWM7QUFDcEIsSUFBTSxXQUFXO0FBQ2pCLElBQU0saUJBQWlCO0FBeUJ2QixJQUFJLFFBQWUsRUFBRSxNQUFNLE1BQU0sU0FBUyxDQUFDLEdBQUcsT0FBTyxNQUFNLFNBQVMsTUFBTTtBQUMxRSxJQUFNLFlBQVksb0JBQUksSUFBZ0I7QUFFdEMsU0FBUyxTQUFTLE9BQXVCO0FBQ3ZDLFVBQVEsRUFBRSxHQUFHLE9BQU8sR0FBRyxNQUFNO0FBQzdCLFlBQVUsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDO0FBQzlCO0FB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

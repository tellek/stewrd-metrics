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
  if (key === "lambdaErrors") return "error";
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
  if (valueTone("lambdaErrors", metric(app, "monitoring.totals.lambdaErrors"))) return "error";
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
    let tip = status === "success" ? "Metrics up to date" : status === "error" ? "Alarms firing or Lambda errors" : "Metrics need attention";
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
  return /* @__PURE__ */ jsx(Section, { api, title, tone: valueTone("lambdaErrors", series[1].values[series[1].values.length - 1]), extra: /* @__PURE__ */ jsx(Legend, { api, items: series }), children: /* @__PURE__ */ jsx(LineChart, { api, labels: appDays.map((d) => shortDate(d.date)), series, format: axisFmt("") }) });
}
var OVERVIEW_TRENDS = [
  { title: "AWS Cost (30d)", key: "cost", get: (d) => metric(d, "awsCost.total") },
  { title: "Requests (24h)", key: "", get: (d) => sumApps(d, "monitoring.totals.requests") },
  { title: "Lambda Errors (24h)", key: "lambdaErrors", get: (d) => sumApps(d, "monitoring.totals.lambdaErrors") },
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
  { title: "Lambda Errors (24h)", key: "lambdaErrors", get: (a) => metric(a, "monitoring.totals.lambdaErrors") },
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
          tone: lambdas.rows.some((r) => r.segments.some((s) => s.name === "Errors" && s.value > 0)) ? "error" : null,
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIGxvYWRpbmc6IGJvb2xlYW47XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UgfTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIHN0YXRlID0geyAuLi5zdGF0ZSwgLi4ucGF0Y2ggfTtcbiAgbGlzdGVuZXJzLmZvckVhY2goKGwpID0+IGwoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tXG5cbmNvbnN0IGlzRXJyb3JOb2RlID0gKHY6IEpzb24pOiBib29sZWFuID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHYuZXJyb3IgPT09IFwic3RyaW5nXCI7XG5cbmZ1bmN0aW9uIGhhc0Vycm9yTm9kZSh2OiBKc29uKTogYm9vbGVhbiB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIHRydWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIGlmICh2ICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiKSByZXR1cm4gT2JqZWN0LnZhbHVlcyh2KS5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgbW9uZXkgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IHN0eWxlOiBcImN1cnJlbmN5XCIsIGN1cnJlbmN5OiBcIlVTRFwiIH0pO1xuY29uc3QgY29tcGFjdCA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgbm90YXRpb246IFwiY29tcGFjdFwiLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG5jb25zdCBNT05FWV9LRVkgPSAvKG1ycnxwcm9maXR8Y29zdHxhbW91bnR8cmV2ZW51ZSkvaTtcblxuLyoqIFNpbmdsZSBmb3JtYXR0ZXI6IG51bGwvdW5kZWZpbmVkL2Vycm9yIG5vZGVzIGFyZSBcIlVua25vd25cIiwgbmV2ZXIgemVyby4gKi9cbmZ1bmN0aW9uIGZtdCh2OiBKc29uLCBrZXkgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gXCJVbmtub3duXCI7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIGBVbmtub3duICgke3YuZXJyb3J9KWA7XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChNT05FWV9LRVkudGVzdChrZXkpKSByZXR1cm4gbW9uZXkuZm9ybWF0KHYpO1xuICAgIGlmICgvbGF0ZW5jeW1zL2kudGVzdChrZXkpKSByZXR1cm4gYCR7TWF0aC5yb3VuZCh2KX0gbXNgO1xuICAgIHJldHVybiB2LnRvTG9jYWxlU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHR5cGVvZiB2ID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xuICByZXR1cm4gU3RyaW5nKHYpO1xufVxuXG4vKiogVGFibGUgY2VsbDogXCItXCIgd2hlbiB0aGUgYXBwIGhhcyBubyBzdWNoIG1ldHJpYywgb3RoZXJ3aXNlIGZtdCAoc28gdW5rbm93biBzdGF5cyBcIlVua25vd25cIikuICovXG5jb25zdCBjZWxsID0gKHY6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIGtleSA9IFwiXCIpID0+ICh2ID09PSB1bmRlZmluZWQgPyBcIi1cIiA6IGZtdCh2LCBrZXkpKTtcblxuY29uc3QgYXhpc0ZtdCA9IChrZXk6IHN0cmluZykgPT4gKG46IG51bWJlcikgPT4gKE1PTkVZX0tFWS50ZXN0KGtleSkgPyBtb25leS5mb3JtYXQobikgOiBjb21wYWN0LmZvcm1hdChuKSk7XG5cbmZ1bmN0aW9uIGFnZUhvdXJzKGlzbzogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgbnVsbCB7XG4gIGNvbnN0IHQgPSBpc28gPyBEYXRlLnBhcnNlKGlzbykgOiBOYU47XG4gIHJldHVybiBOdW1iZXIuaXNOYU4odCkgPyBudWxsIDogKERhdGUubm93KCkgLSB0KSAvIDNfNjAwXzAwMDtcbn1cblxuY29uc3Qgc2hvcnREYXRlID0gKGQ6IHN0cmluZykgPT4gbmV3IERhdGUoYCR7ZH1UMDA6MDA6MDBaYCkudG9Mb2NhbGVEYXRlU3RyaW5nKHVuZGVmaW5lZCwgeyBtb250aDogXCJzaG9ydFwiLCBkYXk6IFwibnVtZXJpY1wiLCB0aW1lWm9uZTogXCJVVENcIiB9KTtcblxuY29uc3QgYXBwc09mID0gKGRvYzogSnNvbik6IEpzb25bXSA9PiAoZG9jICYmIEFycmF5LmlzQXJyYXkoZG9jLmFwcHMpID8gZG9jLmFwcHMgOiBbXSk7XG5cbi8qKiBXYWxrcyBhIGRvdHRlZCBwYXRoLiB1bmRlZmluZWQgPSBub3QgcHJlc2VudCwgbnVsbCA9IHVua25vd24gKGVycm9yIG5vZGUgb3IgbnVsbCksIG51bWJlciA9IHZhbHVlLiAqL1xuZnVuY3Rpb24gbWV0cmljKG86IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBsZXQgdiA9IG87XG4gIGZvciAoY29uc3QgayBvZiBwYXRoLnNwbGl0KFwiLlwiKSkge1xuICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHYgPT09IG51bGwgfHwgaXNFcnJvck5vZGUodikpIHJldHVybiBudWxsO1xuICAgIHYgPSB2W2tdO1xuICB9XG4gIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodikgPyB2IDogbnVsbDtcbn1cblxuLyoqIFN1bXMgYSBtZXRyaWMgYWNyb3NzIGFwcHM7IGFueSB1bmtub3duIGFwcCB2YWx1ZSBtYWtlcyB0aGUgdG90YWwgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIHN1bUFwcHMoZG9jOiBKc29uLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFkb2MgfHwgaXNFcnJvck5vZGUoZG9jLmFwcHMpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IGFwcHNPZihkb2MpXG4gICAgLm1hcCgoYSkgPT4gbWV0cmljKGEsIHBhdGgpKVxuICAgIC5maWx0ZXIoKHYpID0+IHYgIT09IHVuZGVmaW5lZCk7XG4gIGlmICh2YWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdiA9PT0gbnVsbCkgPyBudWxsIDogKHZhbHMgYXMgbnVtYmVyW10pLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xufVxuXG4vKiogU3RhdHVzIGEgc2luZ2xlIHZhbHVlIHNpZ25hbHM6IGZpcmluZyBhbGFybXMgYXJlIGFuIGVycm9yLCA1eHggcmVzcG9uc2VzIGEgd2FybmluZy4gKi9cbmZ1bmN0aW9uIHZhbHVlVG9uZShrZXk6IHN0cmluZywgdjogSnNvbik6IFN0YXR1c0NvbG9yIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdiAhPT0gXCJudW1iZXJcIiB8fCB2IDw9IDApIHJldHVybiBudWxsO1xuICBpZiAoa2V5ID09PSBcImluQWxhcm1cIikgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGtleSA9PT0gXCJsYW1iZGFFcnJvcnNcIikgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGtleSA9PT0gXCJlcnJvcnM1eHhcIikgcmV0dXJuIFwid2FybmluZ1wiO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIFdvcnN0IHRvbmUgb2YgYW55IHZhbHVlIGluIGEgZ3JvdXA6IGZpcmluZyBhbGFybXMgLT4gZXJyb3I7IDV4eCwgc3RhbGUgc3RhdGVzIG9yIHVua25vd24gc2VjdGlvbnMgLT4gd2FybmluZy4gKi9cbmZ1bmN0aW9uIGdyb3VwVG9uZSh2OiBKc29uKTogU3RhdHVzQ29sb3IgfCBudWxsIHtcbiAgaWYgKGlzRXJyb3JOb2RlKHYpKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICghdiB8fCB0eXBlb2YgdiAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRvbmVzOiBTdGF0dXNDb2xvcltdID0gW107XG4gIGNvbnN0IHdhbGsgPSAobzogSnNvbikgPT5cbiAgICBPYmplY3QuZW50cmllcyhvKS5mb3JFYWNoKChbaywgeF0pID0+IHtcbiAgICAgIGNvbnN0IHQgPSB2YWx1ZVRvbmUoaywgeCkgPz8gKGsgPT09IFwic3RhbGVTdGF0ZXNcIiAmJiB0eXBlb2YgeCA9PT0gXCJudW1iZXJcIiAmJiB4ID4gMCA/IFwid2FybmluZ1wiIDogbnVsbCkgPz8gKGlzRXJyb3JOb2RlKHgpID8gXCJ3YXJuaW5nXCIgOiBudWxsKTtcbiAgICAgIGlmICh0KSB0b25lcy5wdXNoKHQpO1xuICAgICAgZWxzZSBpZiAoeCAmJiB0eXBlb2YgeCA9PT0gXCJvYmplY3RcIikgd2Fsayh4KTtcbiAgICB9KTtcbiAgd2Fsayh2KTtcbiAgcmV0dXJuIHRvbmVzLmxlbmd0aCA/IHdvcnN0KHRvbmVzKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGFwcFN0YXR1cyhhcHA6IEpzb24pOiBTdGF0dXNDb2xvciB7XG4gIGlmICh2YWx1ZVRvbmUoXCJpbkFsYXJtXCIsIG1ldHJpYyhhcHAsIFwiaGVhbHRoLmFsYXJtcy5pbkFsYXJtXCIpKSkgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKHZhbHVlVG9uZShcImxhbWJkYUVycm9yc1wiLCBtZXRyaWMoYXBwLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSkpIHJldHVybiBcImVycm9yXCI7XG4gIGlmIChoYXNFcnJvck5vZGUoYXBwKSkgcmV0dXJuIFwid2FybmluZ1wiO1xuICBpZiAodmFsdWVUb25lKFwiZXJyb3JzNXh4XCIsIG1ldHJpYyhhcHAsIFwibW9uaXRvcmluZy50b3RhbHMuZXJyb3JzNXh4XCIpKSkgcmV0dXJuIFwid2FybmluZ1wiO1xuICBpZiAoKGFwcC5oZWFsdGg/LmZyZXNobmVzcz8uc3RhbGVTdGF0ZXMgPz8gMCkgPiAwKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIHJldHVybiBcInN1Y2Nlc3NcIjtcbn1cblxuY29uc3QgV09SU1Q6IFN0YXR1c0NvbG9yW10gPSBbXCJpZGxlXCIsIFwic3VjY2Vzc1wiLCBcIndhcm5pbmdcIiwgXCJlcnJvclwiXTtcbmNvbnN0IHdvcnN0ID0gKGNzOiBTdGF0dXNDb2xvcltdKTogU3RhdHVzQ29sb3IgPT4gY3MucmVkdWNlKChhLCBiKSA9PiAoV09SU1QuaW5kZXhPZihiKSA+IFdPUlNULmluZGV4T2YoYSkgPyBiIDogYSksIFwic3VjY2Vzc1wiIGFzIFN0YXR1c0NvbG9yKTtcblxuZnVuY3Rpb24gZG9jU3RhdHVzKGRvYzogSnNvbik6IFN0YXR1c0NvbG9yIHtcbiAgY29uc3QgYWdlID0gYWdlSG91cnMoZG9jLmdlbmVyYXRlZEF0KTtcbiAgY29uc3Qgc3RhbGUgPSBhZ2UgPT09IG51bGwgfHwgYWdlID4gU1RBTEVfSE9VUlM7XG4gIGNvbnN0IHN0YXR1cyA9IHdvcnN0KGFwcHNPZihkb2MpLm1hcChhcHBTdGF0dXMpKTtcbiAgcmV0dXJuIHN0YWxlIHx8IGhhc0Vycm9yTm9kZShkb2MpID8gd29yc3QoW3N0YXR1cywgXCJ3YXJuaW5nXCJdKSA6IHN0YXR1cztcbn1cblxuLyoqIEhpc3RvcnkgcGx1cyB0aGUgbGF0ZXN0IGRvY3VtZW50LCBvbmUgZW50cnkgcGVyIFVUQyBkYXRlLCBvbGRlc3QgZmlyc3QuICovXG5mdW5jdGlvbiBhbGxEYXlzKCk6IERheVtdIHtcbiAgY29uc3QgbSA9IG5ldyBNYXAoc3RhdGUuaGlzdG9yeS5tYXAoKGQpID0+IFtkLmRhdGUsIGQuZG9jXSkpO1xuICBpZiAodHlwZW9mIHN0YXRlLmRhdGE/LmdlbmVyYXRlZEF0ID09PSBcInN0cmluZ1wiKSBtLnNldChzdGF0ZS5kYXRhLmdlbmVyYXRlZEF0LnNsaWNlKDAsIDEwKSwgc3RhdGUuZGF0YSk7XG4gIHJldHVybiBbLi4ubS5lbnRyaWVzKCldLnNvcnQoKFthXSwgW2JdKSA9PiAoYSA8IGIgPyAtMSA6IDEpKS5tYXAoKFtkYXRlLCBkb2NdKSA9PiAoeyBkYXRlLCBkb2MgfSkpO1xufVxuXG4vLyAtLS0tLS0tLS0tIGZldGNoaW5nIC0tLS0tLS0tLS1cblxuYXN5bmMgZnVuY3Rpb24gYXdzQXJncyhhcGk6IFBsdWdpbkFwaSwgYXJnczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IHMgPSBhd2FpdCBhcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpO1xuICBjb25zdCBvdXQgPSBbLi4uYXJncywgXCItLWNsaS1jb25uZWN0LXRpbWVvdXRcIiwgXCIxMFwiLCBcIi0tY2xpLXJlYWQtdGltZW91dFwiLCBcIjE1XCJdO1xuICBpZiAocy5hd3NQcm9maWxlKSBvdXQucHVzaChcIi0tcHJvZmlsZVwiLCBzLmF3c1Byb2ZpbGUpO1xuICByZXR1cm4gb3V0O1xufVxuXG5hc3luYyBmdW5jdGlvbiBhd3MoYXBpOiBQbHVnaW5BcGksIGFyZ3M6IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcmVzID0gYXdhaXQgYXBpLnNoZWxsLmV4ZWMoXCJhd3NcIiwgYXdhaXQgYXdzQXJncyhhcGksIGFyZ3MpKTtcbiAgaWYgKHJlcy5jb2RlICE9PSAwKSB0aHJvdyBuZXcgRXJyb3IocmVzLnN0ZGVyci50cmltKCkgfHwgYGF3cyBleGl0ZWQgd2l0aCBjb2RlICR7cmVzLmNvZGV9YCk7XG4gIHJldHVybiByZXMuc3Rkb3V0O1xufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkSGlzdG9yeShhcGk6IFBsdWdpbkFwaSkge1xuICBjb25zdCBlbnRyaWVzID0gYXdhaXQgYXBpLmZzLmxpc3REaXIoSElTVE9SWV9ESVIpO1xuICBjb25zdCBmaWxlcyA9IGVudHJpZXNcbiAgICAuZmlsdGVyKChlKSA9PiAhZS5pc0RpciAmJiAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9XFwuanNvbiQvLnRlc3QoZS5uYW1lKSlcbiAgICAubWFwKChlKSA9PiBlLm5hbWUpXG4gICAgLnNvcnQoKVxuICAgIC5zbGljZSgtTUFYX0RBWVMpO1xuICBjb25zdCBkb2NzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgZmlsZXMubWFwKGFzeW5jIChmKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShhd2FpdCBhcGkuZnMucmVhZFRleHRGaWxlKGAke0hJU1RPUllfRElSfS8ke2Z9YCkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH0pLFxuICApO1xuICBzZXRTdGF0ZSh7IGhpc3Rvcnk6IGZpbGVzLm1hcCgoZiwgaSkgPT4gKHsgZGF0ZTogZi5zbGljZSgwLCAxMCksIGRvYzogZG9jc1tpXSB9KSkuZmlsdGVyKChkKSA9PiBkLmRvYykgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN5bmNIaXN0b3J5KGFwaTogUGx1Z2luQXBpLCBidWNrZXQ6IHN0cmluZykge1xuICBjb25zdCByb290ID0gKGF3YWl0IGFwaS5mcy5nZXRSb290UGF0aCgpKS5yZXBsYWNlKC9bXFxcXC9dKyQvLCBcIlwiKTtcbiAgYXdhaXQgYXdzKGFwaSwgW1wiczNcIiwgXCJzeW5jXCIsIGBzMzovLyR7YnVja2V0fS8ke0hJU1RPUllfRElSfS9gLCBgJHtyb290fS8ke0hJU1RPUllfRElSfWAsIFwiLS1vbmx5LXNob3ctZXJyb3JzXCJdKTtcbiAgYXdhaXQgbG9hZEhpc3RvcnkoYXBpKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVmcmVzaChhcGk6IFBsdWdpbkFwaSwgc2lnbmFsPzogQWJvcnRTaWduYWwpIHtcbiAgaWYgKHN0YXRlLmxvYWRpbmcpIHJldHVybjtcbiAgc2V0U3RhdGUoeyBsb2FkaW5nOiB0cnVlIH0pO1xuICBjb25zdCBzZXRJY29uID0gKGM6IFN0YXR1c0NvbG9yLCB0aXA/OiBzdHJpbmcpID0+IHtcbiAgICBpZiAoc2lnbmFsPy5hYm9ydGVkKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGFwaS5zdGF0dXNJY29uLnNldChjLCB0aXApO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogZGVhY3RpdmF0ZWQgKi9cbiAgICB9XG4gIH07XG4gIGNvbnN0IGxvZyA9IChsZXZlbDogXCJ3YXJuXCIgfCBcImVycm9yXCIsIG1zZzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKHNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhcGkubG9nW2xldmVsXShgJHtOQU1FfTogJHttc2d9YCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBkZWFjdGl2YXRlZCAqL1xuICAgIH1cbiAgfTtcbiAgdHJ5IHtcbiAgICBjb25zdCBidWNrZXQgPSAoYXdhaXQgYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKSkuYnVja2V0IHx8IERFRkFVTFRfQlVDS0VUO1xuICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKGF3YWl0IGF3cyhhcGksIFtcInMzXCIsIFwiY3BcIiwgYHMzOi8vJHtidWNrZXR9L21ldHJpY3MuanNvbmAsIFwiLVwiXSkpO1xuICAgIGF3YWl0IGFwaS5zdG9yYWdlLnNldChDQUNIRV9LRVksIGRhdGEpO1xuICAgIHNldFN0YXRlKHsgZGF0YSwgZXJyb3I6IG51bGwgfSk7XG4gICAgbGV0IHN0YXR1cyA9IGRvY1N0YXR1cyhkYXRhKTtcbiAgICBsZXQgdGlwID0gc3RhdHVzID09PSBcInN1Y2Nlc3NcIiA/IFwiTWV0cmljcyB1cCB0byBkYXRlXCIgOiBzdGF0dXMgPT09IFwiZXJyb3JcIiA/IFwiQWxhcm1zIGZpcmluZyBvciBMYW1iZGEgZXJyb3JzXCIgOiBcIk1ldHJpY3MgbmVlZCBhdHRlbnRpb25cIjtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3luY0hpc3RvcnkoYXBpLCBidWNrZXQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnN0IG1zZyA9IGUgaW5zdGFuY2VvZiBFcnJvciA/IGUubWVzc2FnZSA6IFN0cmluZyhlKTtcbiAgICAgIGxvZyhcIndhcm5cIiwgYGhpc3Rvcnkgc3luYyBmYWlsZWQ6ICR7bXNnfWApO1xuICAgICAgc3RhdHVzID0gd29yc3QoW3N0YXR1cywgXCJ3YXJuaW5nXCJdKTtcbiAgICAgIHRpcCA9IGBIaXN0b3J5IHN5bmMgZmFpbGVkOiAke21zZ31gO1xuICAgIH1cbiAgICBzZXRTdGF0ZSh7IGxvYWRpbmc6IGZhbHNlIH0pO1xuICAgIC8vIFRoZSBpY29uIG9ubHkgc2lnbmFscyBwcm9ibGVtczsgYW55dGhpbmcgc2hvcnQgb2Ygd2FybmluZyBzdGF5cyBpZGxlIChkZWZhdWx0IHRpbnQpLlxuICAgIHNldEljb24oc3RhdHVzID09PSBcIndhcm5pbmdcIiB8fCBzdGF0dXMgPT09IFwiZXJyb3JcIiA/IHN0YXR1cyA6IFwiaWRsZVwiLCB0aXApO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgbXNnID0gZSBpbnN0YW5jZW9mIEVycm9yID8gZS5tZXNzYWdlIDogU3RyaW5nKGUpO1xuICAgIHNldFN0YXRlKHsgZXJyb3I6IG1zZywgbG9hZGluZzogZmFsc2UgfSk7XG4gICAgc2V0SWNvbihcImVycm9yXCIsIG1zZyk7XG4gICAgbG9nKFwiZXJyb3JcIiwgbXNnKTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGUoY3R4OiBQbHVnaW5Db250ZXh0KSB7XG4gIGN0eC5hcGkuc3RhdHVzSWNvbi5zZXQoXCJpZGxlXCIpO1xuICBjb25zdCBzID0gYXdhaXQgY3R4LmFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCk7XG4gIGNvbnN0IG1pbnV0ZXMgPSBNYXRoLm1heCgxLCBzLnJlZnJlc2hNaW51dGVzID8/IDYwKTtcbiAgY3R4LnRpY2sucmVnaXN0ZXIoKCkgPT4gcmVmcmVzaChjdHguYXBpLCBjdHguc2lnbmFsKSk7XG4gIGN0eC50aWNrLnNldEludGVydmFsKG1pbnV0ZXMgKiA2MF8wMDApO1xuICBjdHguYXBpLmxvZy5pbmZvKGAke05BTUV9IGFjdGl2YXRlZGApO1xuICB2b2lkIGxvYWRIaXN0b3J5KGN0eC5hcGkpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gIHZvaWQgcmVmcmVzaChjdHguYXBpLCBjdHguc2lnbmFsKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBjaGFydCBwcmltaXRpdmVzIC0tLS0tLS0tLS1cblxuY29uc3QgQ0hBUlRfSEVJR0hUID0gMTcwO1xuXG5jb25zdCBzY3JvbGxiYXJTdHlsZSA9IChwOiBQYWxldHRlKTogQ1NTUHJvcGVydGllcyA9PiAoeyBzY3JvbGxiYXJXaWR0aDogXCJ0aGluXCIsIHNjcm9sbGJhckNvbG9yOiBgJHtwLmJvcmRlcn0gJHtwLnN1cmZhY2V9YCB9KTtcblxuZnVuY3Rpb24gdXNlV2lkdGgoKSB7XG4gIGNvbnN0IHJlZiA9IHVzZVJlZjxIVE1MRGl2RWxlbWVudD4obnVsbCk7XG4gIGNvbnN0IFt3aWR0aCwgc2V0V2lkdGhdID0gdXNlU3RhdGUoMCk7XG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgY29uc3QgZWwgPSByZWYuY3VycmVudDtcbiAgICBpZiAoIWVsKSByZXR1cm47XG4gICAgY29uc3Qgcm8gPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKFtlXSkgPT4gc2V0V2lkdGgoZS5jb250ZW50UmVjdC53aWR0aCkpO1xuICAgIHJvLm9ic2VydmUoZWwpO1xuICAgIHJldHVybiAoKSA9PiByby5kaXNjb25uZWN0KCk7XG4gIH0sIFtdKTtcbiAgcmV0dXJuIFtyZWYsIHdpZHRoXSBhcyBjb25zdDtcbn1cblxuZnVuY3Rpb24gbmljZU1heCh2OiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAodiA8PSAwKSByZXR1cm4gMTtcbiAgY29uc3QgcCA9IDEwICoqIE1hdGguZmxvb3IoTWF0aC5sb2cxMCh2KSk7XG4gIGNvbnN0IG4gPSB2IC8gcDtcbiAgcmV0dXJuIChuIDw9IDEgPyAxIDogbiA8PSAyID8gMiA6IG4gPD0gNSA/IDUgOiAxMCkgKiBwO1xufVxuXG5mdW5jdGlvbiBUb29sdGlwKHsgcCwgeCwgeSwgZmxpcCwgZml4ZWQsIGNoaWxkcmVuIH06IHsgcDogUGFsZXR0ZTsgeDogbnVtYmVyOyB5OiBudW1iZXI7IGZsaXA6IGJvb2xlYW47IGZpeGVkPzogYm9vbGVhbjsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIHJldHVybiAoXG4gICAgPGRpdlxuICAgICAgc3R5bGU9e3tcbiAgICAgICAgcG9zaXRpb246IGZpeGVkID8gXCJmaXhlZFwiIDogXCJhYnNvbHV0ZVwiLFxuICAgICAgICBsZWZ0OiB4LFxuICAgICAgICB0b3A6IHksXG4gICAgICAgIHRyYW5zZm9ybTogZmxpcCA/IFwidHJhbnNsYXRlWCgtMTAwJSlcIiA6IHVuZGVmaW5lZCxcbiAgICAgICAgYmFja2dyb3VuZDogcC5iYWNrZ3JvdW5kLFxuICAgICAgICBjb2xvcjogcC50ZXh0LFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHtwLmJvcmRlcn1gLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDQsXG4gICAgICAgIHBhZGRpbmc6IFwiNHB4IDhweFwiLFxuICAgICAgICBmb250U2l6ZTogMTIsXG4gICAgICAgIGxpbmVIZWlnaHQ6IFwiMThweFwiLFxuICAgICAgICB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiLFxuICAgICAgICBwb2ludGVyRXZlbnRzOiBcIm5vbmVcIixcbiAgICAgICAgekluZGV4OiAxLFxuICAgICAgfX1cbiAgICA+XG4gICAgICB7Y2hpbGRyZW59XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmludGVyZmFjZSBTZXJpZXMge1xuICBuYW1lOiBzdHJpbmc7XG4gIGNvbG9yOiBzdHJpbmc7XG4gIHZhbHVlczogKG51bWJlciB8IG51bGwpW107XG59XG5cbi8qKiBMaW5lIGNoYXJ0IG92ZXIgdGltZSBvbiBvbmUgc2hhcmVkIGF4aXMuIFVua25vd24gKG51bGwpIHBvaW50cyBicmVhayBhIGxpbmUgaW5zdGVhZCBvZiBkcm9wcGluZyB0byB6ZXJvOyBhIGxvbmUgc2VyaWVzIGFsc28gZ2V0cyBhbiBhcmVhIGZpbGwuICovXG5mdW5jdGlvbiBMaW5lQ2hhcnQoeyBhcGksIGxhYmVscywgc2VyaWVzLCBmb3JtYXQsIGhlaWdodCA9IENIQVJUX0hFSUdIVCB9OiB7IGFwaTogUGx1Z2luQXBpOyBsYWJlbHM6IHN0cmluZ1tdOyBzZXJpZXM6IFNlcmllc1tdOyBmb3JtYXQ6IChuOiBudW1iZXIpID0+IHN0cmluZzsgaGVpZ2h0PzogbnVtYmVyIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBbcmVmLCB3aWR0aF0gPSB1c2VXaWR0aCgpO1xuICBjb25zdCBbaG92ZXIsIHNldEhvdmVyXSA9IHVzZVN0YXRlPG51bWJlciB8IG51bGw+KG51bGwpO1xuICBjb25zdCBMID0gNTYsXG4gICAgUiA9IDEyLFxuICAgIFQgPSAxMCxcbiAgICBCID0gMjI7XG4gIGNvbnN0IHcgPSBNYXRoLm1heCgxLCB3aWR0aCAtIEwgLSBSKTtcbiAgY29uc3QgaCA9IGhlaWdodCAtIFQgLSBCO1xuICBjb25zdCBuID0gbGFiZWxzLmxlbmd0aDtcbiAgY29uc3QgbWF4ID0gbmljZU1heChNYXRoLm1heCgwLCAuLi5zZXJpZXMuZmxhdE1hcCgocykgPT4gcy52YWx1ZXMubWFwKCh2KSA9PiB2ID8/IDApKSkpO1xuICBjb25zdCB4ID0gKGk6IG51bWJlcikgPT4gTCArIChuIDw9IDEgPyB3IC8gMiA6IChpICogdykgLyAobiAtIDEpKTtcbiAgY29uc3QgeSA9ICh2OiBudW1iZXIpID0+IFQgKyBoIC0gKHYgLyBtYXgpICogaDtcblxuICBjb25zdCBydW5zT2YgPSAodmFsdWVzOiAobnVtYmVyIHwgbnVsbClbXSkgPT4ge1xuICAgIGNvbnN0IHJ1bnM6IG51bWJlcltdW10gPSBbXTtcbiAgICBsZXQgY3VyOiBudW1iZXJbXSA9IFtdO1xuICAgIHZhbHVlcy5mb3JFYWNoKCh2LCBpKSA9PiB7XG4gICAgICBpZiAodiA9PT0gbnVsbCkge1xuICAgICAgICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gICAgICAgIGN1ciA9IFtdO1xuICAgICAgfSBlbHNlIGN1ci5wdXNoKGkpO1xuICAgIH0pO1xuICAgIGlmIChjdXIubGVuZ3RoKSBydW5zLnB1c2goY3VyKTtcbiAgICByZXR1cm4gcnVucztcbiAgfTtcblxuICBjb25zdCBvbk1vdmUgPSAoZTogTW91c2VFdmVudDxTVkdSZWN0RWxlbWVudD4pID0+IHtcbiAgICBjb25zdCByID0gZS5jdXJyZW50VGFyZ2V0LmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGNvbnN0IGkgPSBuIDw9IDEgPyAwIDogTWF0aC5yb3VuZCgoKGUuY2xpZW50WCAtIHIubGVmdCkgLyByLndpZHRoKSAqIChuIC0gMSkpO1xuICAgIHNldEhvdmVyKE1hdGgubWluKG4gLSAxLCBNYXRoLm1heCgwLCBpKSkpO1xuICB9O1xuXG4gIGNvbnN0IHhMYWJlbHMgPSBuIDw9IDEgPyBbMF0gOiBuID09PSAyID8gWzAsIDFdIDogWzAsIE1hdGguZmxvb3IoKG4gLSAxKSAvIDIpLCBuIC0gMV07XG4gIGNvbnN0IGFuY2hvciA9IChpOiBudW1iZXIpID0+IChuIDw9IDEgPyBcIm1pZGRsZVwiIDogaSA9PT0gMCA/IFwic3RhcnRcIiA6IGkgPT09IG4gLSAxID8gXCJlbmRcIiA6IFwibWlkZGxlXCIpO1xuICBjb25zdCBmbGlwID0gaG92ZXIgIT09IG51bGwgJiYgeChob3ZlcikgPiB3aWR0aCAtIDE2MDtcblxuICByZXR1cm4gKFxuICAgIDxkaXYgcmVmPXtyZWZ9IHN0eWxlPXt7IHBvc2l0aW9uOiBcInJlbGF0aXZlXCIsIGhlaWdodCB9fT5cbiAgICAgIHt3aWR0aCA+IDAgJiYgKFxuICAgICAgICA8c3ZnIHdpZHRoPXt3aWR0aH0gaGVpZ2h0PXtoZWlnaHR9IHN0eWxlPXt7IGRpc3BsYXk6IFwiYmxvY2tcIiwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgIHtbMCwgMC41LCAxXS5tYXAoKGYpID0+IChcbiAgICAgICAgICAgIDxnIGtleT17Zn0+XG4gICAgICAgICAgICAgIDxsaW5lIHgxPXtMfSB4Mj17TCArIHd9IHkxPXt5KG1heCAqIGYpfSB5Mj17eShtYXggKiBmKX0gc3Ryb2tlPXtwLmJvcmRlcn0gc3Ryb2tlV2lkdGg9ezF9IHN0cm9rZURhc2hhcnJheT17ZiA/IFwiMiA0XCIgOiB1bmRlZmluZWR9IC8+XG4gICAgICAgICAgICAgIDx0ZXh0IHg9e0wgLSA2fSB5PXt5KG1heCAqIGYpfSBkeT1cIjAuMzJlbVwiIHRleHRBbmNob3I9XCJlbmRcIiBmaWxsPXtwLnRleHRNdXRlZH0+XG4gICAgICAgICAgICAgICAge2Zvcm1hdChtYXggKiBmKX1cbiAgICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICkpfVxuICAgICAgICAgIHt4TGFiZWxzLm1hcCgoaSkgPT4gKFxuICAgICAgICAgICAgPHRleHQga2V5PXtpfSB4PXt4KGkpfSB5PXtoZWlnaHQgLSA0fSB0ZXh0QW5jaG9yPXthbmNob3IoaSl9IGZpbGw9e3AudGV4dE11dGVkfT5cbiAgICAgICAgICAgICAge2xhYmVsc1tpXX1cbiAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICApKX1cbiAgICAgICAgICB7c2VyaWVzLm1hcCgocykgPT4ge1xuICAgICAgICAgICAgY29uc3QgcnVucyA9IHJ1bnNPZihzLnZhbHVlcyk7XG4gICAgICAgICAgICBjb25zdCBsaW5lID0gKHJ1bjogbnVtYmVyW10pID0+IHJ1bi5tYXAoKGksIGspID0+IGAke2sgPyBcIkxcIiA6IFwiTVwifSR7eChpKX0sJHt5KHMudmFsdWVzW2ldIGFzIG51bWJlcil9YCkuam9pbihcIlwiKTtcbiAgICAgICAgICAgIGNvbnN0IGxhc3RLbm93biA9IFsuLi5zLnZhbHVlcy5rZXlzKCldLnJldmVyc2UoKS5maW5kKChpKSA9PiBzLnZhbHVlc1tpXSAhPT0gbnVsbCk7XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICA8ZyBrZXk9e3MubmFtZX0+XG4gICAgICAgICAgICAgICAge3J1bnMubWFwKChydW4pID0+XG4gICAgICAgICAgICAgICAgICBydW4ubGVuZ3RoID4gMSA/IChcbiAgICAgICAgICAgICAgICAgICAgPGcga2V5PXtydW5bMF19PlxuICAgICAgICAgICAgICAgICAgICAgIHtzZXJpZXMubGVuZ3RoID09PSAxICYmIDxwYXRoIGQ9e2Ake2xpbmUocnVuKX1MJHt4KHJ1bltydW4ubGVuZ3RoIC0gMV0pfSwke3koMCl9TCR7eChydW5bMF0pfSwke3koMCl9WmB9IGZpbGw9e3MuY29sb3J9IGZpbGxPcGFjaXR5PXswLjEyfSAvPn1cbiAgICAgICAgICAgICAgICAgICAgICA8cGF0aCBkPXtsaW5lKHJ1bil9IGZpbGw9XCJub25lXCIgc3Ryb2tlPXtzLmNvbG9yfSBzdHJva2VXaWR0aD17Mn0gc3Ryb2tlTGluZWpvaW49XCJyb3VuZFwiIHN0cm9rZUxpbmVjYXA9XCJyb3VuZFwiIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICAgIDxjaXJjbGUga2V5PXtydW5bMF19IGN4PXt4KHJ1blswXSl9IGN5PXt5KHMudmFsdWVzW3J1blswXV0gYXMgbnVtYmVyKX0gcj17M30gZmlsbD17cy5jb2xvcn0gLz5cbiAgICAgICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICB7bGFzdEtub3duICE9PSB1bmRlZmluZWQgJiYgaG92ZXIgPT09IG51bGwgJiYgKFxuICAgICAgICAgICAgICAgICAgPGNpcmNsZSBjeD17eChsYXN0S25vd24pfSBjeT17eShzLnZhbHVlc1tsYXN0S25vd25dIGFzIG51bWJlcil9IHI9ezMuNX0gZmlsbD17cy5jb2xvcn0gc3Ryb2tlPXtwLnN1cmZhY2V9IHN0cm9rZVdpZHRoPXsyfSAvPlxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAge2hvdmVyICE9PSBudWxsICYmIHMudmFsdWVzW2hvdmVyXSAhPT0gbnVsbCAmJiAoXG4gICAgICAgICAgICAgICAgICA8Y2lyY2xlIGN4PXt4KGhvdmVyKX0gY3k9e3kocy52YWx1ZXNbaG92ZXJdIGFzIG51bWJlcil9IHI9ezQuNX0gZmlsbD17cy5jb2xvcn0gc3Ryb2tlPXtwLnN1cmZhY2V9IHN0cm9rZVdpZHRoPXsyfSBwb2ludGVyRXZlbnRzPVwibm9uZVwiIC8+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KX1cbiAgICAgICAgICB7aG92ZXIgIT09IG51bGwgJiYgPGxpbmUgeDE9e3goaG92ZXIpfSB4Mj17eChob3Zlcil9IHkxPXtUfSB5Mj17VCArIGh9IHN0cm9rZT17cC50ZXh0TXV0ZWR9IHN0cm9rZVdpZHRoPXsxfSBwb2ludGVyRXZlbnRzPVwibm9uZVwiIC8+fVxuICAgICAgICAgIDxyZWN0IHg9e0x9IHk9ezB9IHdpZHRoPXt3fSBoZWlnaHQ9e2hlaWdodH0gZmlsbD1cInRyYW5zcGFyZW50XCIgb25Nb3VzZU1vdmU9e29uTW92ZX0gb25Nb3VzZUxlYXZlPXsoKSA9PiBzZXRIb3ZlcihudWxsKX0gLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICApfVxuICAgICAge2hvdmVyICE9PSBudWxsICYmIChcbiAgICAgICAgPFRvb2x0aXAgcD17cH0geD17eChob3ZlcikgKyAoZmxpcCA/IC0xMCA6IDEwKX0geT17VH0gZmxpcD17ZmxpcH0+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e2xhYmVsc1tob3Zlcl19PC9kaXY+XG4gICAgICAgICAge3Nlcmllcy5tYXAoKHMpID0+IChcbiAgICAgICAgICAgIDxkaXYga2V5PXtzLm5hbWV9IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDYgfX0+XG4gICAgICAgICAgICAgIHtzZXJpZXMubGVuZ3RoID4gMSAmJiA8c3BhbiBzdHlsZT17eyB3aWR0aDogOCwgaGVpZ2h0OiA4LCBib3JkZXJSYWRpdXM6IDIsIGJhY2tncm91bmQ6IHMuY29sb3IgfX0gLz59XG4gICAgICAgICAgICAgIHtzZXJpZXMubGVuZ3RoID4gMSAmJiA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e3MubmFtZX08L3NwYW4+fVxuICAgICAgICAgICAgICA8c3Bhbj57cy52YWx1ZXNbaG92ZXJdID09PSBudWxsID8gXCJVbmtub3duXCIgOiBmb3JtYXQocy52YWx1ZXNbaG92ZXJdIGFzIG51bWJlcil9PC9zcGFuPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvVG9vbHRpcD5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmludGVyZmFjZSBTZWcge1xuICBuYW1lOiBzdHJpbmc7XG4gIHZhbHVlOiBudW1iZXI7XG4gIGNvbG9yOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBCYXJSb3cge1xuICBsYWJlbDogc3RyaW5nO1xuICBzZWdtZW50czogU2VnW107XG4gIHZhbHVlVGV4dDogc3RyaW5nO1xuICB0aXA6IHN0cmluZ1tdO1xufVxuXG5mdW5jdGlvbiBMZWdlbmQoeyBhcGksIGl0ZW1zIH06IHsgYXBpOiBQbHVnaW5BcGk7IGl0ZW1zOiB7IG5hbWU6IHN0cmluZzsgY29sb3I6IHN0cmluZyB9W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZ2FwOiAxNiwgZmxleFdyYXA6IFwid3JhcFwiLCBmb250U2l6ZTogMTIsIGNvbG9yOiBwLnRleHRNdXRlZCB9fT5cbiAgICAgIHtpdGVtcy5tYXAoKGl0KSA9PiAoXG4gICAgICAgIDxzcGFuIGtleT17aXQubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJpbmxpbmUtZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDYgfX0+XG4gICAgICAgICAgPHNwYW4gc3R5bGU9e3sgd2lkdGg6IDEwLCBoZWlnaHQ6IDEwLCBib3JkZXJSYWRpdXM6IDIsIGJhY2tncm91bmQ6IGl0LmNvbG9yIH19IC8+XG4gICAgICAgICAge2l0Lm5hbWV9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICkpfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogSG9yaXpvbnRhbCAob3B0aW9uYWxseSBzdGFja2VkKSBiYXJzIHNoYXJpbmcgb25lIHNjYWxlLCB2YWx1ZSBsYWJlbHMgYXQgdGhlIGVuZC4gU2Nyb2xscyBwYXN0IEJBUl9MSVNUX0hFSUdIVC4gKi9cbmZ1bmN0aW9uIEJhckxpc3QoeyBhcGksIHJvd3MgfTogeyBhcGk6IFBsdWdpbkFwaTsgcm93czogQmFyUm93W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFtob3Zlciwgc2V0SG92ZXJdID0gdXNlU3RhdGU8eyBpOiBudW1iZXI7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0gfCBudWxsPihudWxsKTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgoMCwgLi4ucm93cy5tYXAoKHIpID0+IHIuc2VnbWVudHMucmVkdWNlKChhLCBzKSA9PiBhICsgcy52YWx1ZSwgMCkpKSB8fCAxO1xuICBpZiAocm93cy5sZW5ndGggPT09IDApIHJldHVybiA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+Tm9uZTwvc3Bhbj47XG4gIGNvbnN0IGZsaXAgPSBob3ZlciAhPT0gbnVsbCAmJiBob3Zlci54ID4gd2luZG93LmlubmVyV2lkdGggLSAyMDA7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyAuLi5zY3JvbGxiYXJTdHlsZShwKSwgbWF4SGVpZ2h0OiBDSEFSVF9IRUlHSFQsIG92ZXJmbG93WTogXCJhdXRvXCIsIG92ZXJmbG93WDogXCJoaWRkZW5cIiwgcGFkZGluZ1JpZ2h0OiBHQVAgfX0gb25Nb3VzZUxlYXZlPXsoKSA9PiBzZXRIb3ZlcihudWxsKX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBcIm1pbm1heCgwLCBtYXgtY29udGVudCkgMWZyIG1heC1jb250ZW50XCIsIGdhcDogXCIycHggMTJweFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBmb250U2l6ZTogMTQgfX0+XG4gICAgICAgIHtyb3dzLm1hcCgociwgaSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHRvdGFsID0gci5zZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKTtcbiAgICAgICAgICBjb25zdCBob3QgPSBob3Zlcj8uaSA9PT0gaTtcbiAgICAgICAgICBjb25zdCBjZWxsOiBDU1NQcm9wZXJ0aWVzID0geyBiYWNrZ3JvdW5kOiBob3QgPyBwLnN1cmZhY2VIb3ZlciA6IHVuZGVmaW5lZCwgcGFkZGluZzogXCIycHggMFwiIH07XG4gICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIDxkaXYga2V5PXtyLmxhYmVsfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0gb25Nb3VzZU1vdmU9eyhlKSA9PiBzZXRIb3Zlcih7IGksIHg6IGUuY2xpZW50WCwgeTogZS5jbGllbnRZIH0pfT5cbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgLi4uY2VsbCwgY29sb3I6IGhvdCA/IHAuYWNjZW50IDogcC50ZXh0LCBtYXhXaWR0aDogMjIwLCBvdmVyZmxvdzogXCJoaWRkZW5cIiwgdGV4dE92ZXJmbG93OiBcImVsbGlwc2lzXCIsIHdoaXRlU3BhY2U6IFwibm93cmFwXCIgfX0gdGl0bGU9e3IubGFiZWx9PlxuICAgICAgICAgICAgICAgIHtyLmxhYmVsfVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgLi4uY2VsbCwgZGlzcGxheTogXCJmbGV4XCIsIGhlaWdodDogMjIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIgfX0+XG4gICAgICAgICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgd2lkdGg6IGAkeyh0b3RhbCAvIG1heCkgKiAxMDB9JWAsIGhlaWdodDogMTIsIGdhcDogMSwgbWluV2lkdGg6IHRvdGFsID4gMCA/IDIgOiAwIH19PlxuICAgICAgICAgICAgICAgICAge3Iuc2VnbWVudHNcbiAgICAgICAgICAgICAgICAgICAgLmZpbHRlcigocykgPT4gcy52YWx1ZSA+IDApXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoKHMsIGssIGFycikgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgICAgICAgICAgICAgIGtleT17cy5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU9e3tcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZmxleDogcy52YWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYmFja2dyb3VuZDogcy5jb2xvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgYm9yZGVyUmFkaXVzOiBgJHtrID09PSAwID8gMiA6IDB9cHggJHtrID09PSBhcnIubGVuZ3RoIC0gMSA/IDIgOiAwfXB4ICR7ayA9PT0gYXJyLmxlbmd0aCAtIDEgPyAyIDogMH1weCAke2sgPT09IDAgPyAyIDogMH1weGAsXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgLi4uY2VsbCwgdGV4dEFsaWduOiBcInJpZ2h0XCIsIGZvbnRWYXJpYW50TnVtZXJpYzogXCJ0YWJ1bGFyLW51bXNcIiB9fT57ci52YWx1ZVRleHR9PC9zcGFuPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgKTtcbiAgICAgICAgfSl9XG4gICAgICA8L2Rpdj5cbiAgICAgIHtob3ZlciAmJiByb3dzW2hvdmVyLmldICYmIChcbiAgICAgICAgPFRvb2x0aXAgcD17cH0geD17aG92ZXIueCArIChmbGlwID8gLTEyIDogMTIpfSB5PXtob3Zlci55ICsgMTJ9IGZsaXA9e2ZsaXB9IGZpeGVkPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZm9udFdlaWdodDogNjAwIH19Pntyb3dzW2hvdmVyLmldLmxhYmVsfTwvZGl2PlxuICAgICAgICAgIHtyb3dzW2hvdmVyLmldLnRpcC5tYXAoKHQpID0+IChcbiAgICAgICAgICAgIDxkaXYga2V5PXt0fT57dH08L2Rpdj5cbiAgICAgICAgICApKX1cbiAgICAgICAgPC9Ub29sdGlwPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gVGlsZSh7IGFwaSwgbGFiZWwsIHZhbHVlLCBkZWx0YSwgdG9uZSB9OiB7IGFwaTogUGx1Z2luQXBpOyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogc3RyaW5nOyBkZWx0YT86IHN0cmluZyB8IG51bGw7IHRvbmU/OiBTdGF0dXNDb2xvciB8IG51bGwgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoXG4gICAgPGRpdlxuICAgICAgc3R5bGU9e3tcbiAgICAgICAgbWluV2lkdGg6IDAsXG4gICAgICAgIGJveFNpemluZzogXCJib3JkZXItYm94XCIsXG4gICAgICAgIGJhY2tncm91bmQ6IHAuc3VyZmFjZSxcbiAgICAgICAgYm9yZGVyOiBgMXB4IHNvbGlkICR7dG9uZSA/IHAuc3RhdHVzW3RvbmVdIDogcC5ib3JkZXJ9YCxcbiAgICAgICAgYm9yZGVyUmFkaXVzOiA2LFxuICAgICAgICBwYWRkaW5nOiBcIjEwcHggMTJweFwiLFxuICAgICAgICBkaXNwbGF5OiBcImZsZXhcIixcbiAgICAgICAgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIixcbiAgICAgICAgZ2FwOiAyLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT57bGFiZWx9PC9zcGFuPlxuICAgICAgPHNwYW4gc3R5bGU9e3sgZm9udFNpemU6IDIyLCBsaW5lSGVpZ2h0OiBcIjMwcHhcIiwgZm9udFdlaWdodDogNjAwLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIsIGNvbG9yOiB0b25lID8gcC5zdGF0dXNbdG9uZV0gOiB1bmRlZmluZWQgfX0+e3ZhbHVlfTwvc3Bhbj5cbiAgICAgIHtkZWx0YSAmJiA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT57ZGVsdGF9PC9zcGFuPn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLyoqIFdyYXBwaW5nIHJvdyBvZiBjYXJkczogZXZlcnkgcm93IGlzIGZpbGxlZCBlZGdlIHRvIGVkZ2UgYW5kIGl0cyBjYXJkcyBzaGFyZSBvbmUgaGVpZ2h0LiAqL1xuY29uc3QgVElMRV9NSU4gPSAxMzA7XG5jb25zdCBHQVAgPSAxMjtcblxuLyoqIFN0YXQgdGlsZXMgaW4gZXF1YWwgY29sdW1uczsgd2hlbiB0aGV5IGRvbid0IGZpdCBvbiBvbmUgcm93IHRoZXkgc3BsaXQgaW50byBiYWxhbmNlZCByb3dzICg2IC0+IDMrMyAtPiAyKzIrMikuICovXG5mdW5jdGlvbiBUaWxlUm93KHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlW10gfSkge1xuICBjb25zdCBbcmVmLCB3aWR0aF0gPSB1c2VXaWR0aCgpO1xuICBjb25zdCBuID0gTWF0aC5tYXgoMSwgY2hpbGRyZW4ubGVuZ3RoKTtcbiAgY29uc3QgZml0ID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcigod2lkdGggKyBHQVApIC8gKFRJTEVfTUlOICsgR0FQKSkpO1xuICBjb25zdCBjb2xzID0gd2lkdGggPyBNYXRoLmNlaWwobiAvIE1hdGguY2VpbChuIC8gTWF0aC5taW4oZml0LCBuKSkpIDogbjtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHJlZj17cmVmfSBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogYHJlcGVhdCgke2NvbHN9LCBtaW5tYXgoMCwgMWZyKSlgLCBnYXA6IEdBUCB9fT5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgRmxvdyA9ICh7IGNoaWxkcmVuIH06IHsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSA9PiA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4V3JhcDogXCJ3cmFwXCIsIGFsaWduSXRlbXM6IFwic3RyZXRjaFwiLCBnYXA6IDEyIH19PntjaGlsZHJlbn08L2Rpdj47XG5cbi8qKiBPbmx5IHdhcm5pbmcvZXJyb3IgdG9uZXMgb3V0bGluZSBhIGNhcmQ7IGFueXRoaW5nIGVsc2Uga2VlcHMgdGhlIG5vcm1hbCBib3JkZXIuICovXG5jb25zdCBhbGVydFRvbmUgPSAoczogU3RhdHVzQ29sb3IgfCBudWxsIHwgdW5kZWZpbmVkKTogU3RhdHVzQ29sb3IgfCBudWxsID0+IChzID09PSBcIndhcm5pbmdcIiB8fCBzID09PSBcImVycm9yXCIgPyBzIDogbnVsbCk7XG5cbmZ1bmN0aW9uIFNlY3Rpb24oeyBhcGksIHRpdGxlLCBleHRyYSwgdG9uZSwgY2hpbGRyZW4gfTogeyBhcGk6IFBsdWdpbkFwaTsgdGl0bGU6IHN0cmluZzsgZXh0cmE/OiBSZWFjdE5vZGU7IHRvbmU/OiBTdGF0dXNDb2xvciB8IG51bGw7IGNoaWxkcmVuOiBSZWFjdE5vZGUgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IHQgPSBhbGVydFRvbmUodG9uZSk7XG4gIHJldHVybiAoXG4gICAgPGRpdlxuICAgICAgc3R5bGU9e3tcbiAgICAgICAgZmxleDogXCIxIDEgMzIwcHhcIixcbiAgICAgICAgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIixcbiAgICAgICAgYmFja2dyb3VuZDogcC5zdXJmYWNlLFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHt0ID8gcC5zdGF0dXNbdF0gOiBwLmJvcmRlcn1gLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDYsXG4gICAgICAgIHBhZGRpbmc6IDEyLFxuICAgICAgICBkaXNwbGF5OiBcImZsZXhcIixcbiAgICAgICAgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIixcbiAgICAgICAgZ2FwOiA4LFxuICAgICAgICBtaW5XaWR0aDogMCxcbiAgICAgIH19XG4gICAgPlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiAxMiwgZmxleFdyYXA6IFwid3JhcFwiIH19PlxuICAgICAgICA8c3Ryb25nIHN0eWxlPXt7IGZsZXg6IDEgfX0+e3RpdGxlfTwvc3Ryb25nPlxuICAgICAgICB7ZXh0cmF9XG4gICAgICA8L2Rpdj5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBtZXRyaWMgdmlld3MgLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgVHJlbmQge1xuICB0aXRsZTogc3RyaW5nO1xuICBrZXk6IHN0cmluZztcbiAgZ2V0OiAoZG9jOiBKc29uKSA9PiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkO1xufVxuXG4vKiogVGlsZSB2YWx1ZSBmcm9tIHRoZSBsYXRlc3QgZG9jLCBkZWx0YSBhZ2FpbnN0IHRoZSBwcmV2aW91cyBkYXkgaW4gaGlzdG9yeS4gKi9cbmZ1bmN0aW9uIHRyZW5kVGlsZShhcGk6IFBsdWdpbkFwaSwgZGF5czogRGF5W10sIHQ6IFRyZW5kKSB7XG4gIGNvbnN0IHZhbHMgPSBkYXlzLm1hcCgoZCkgPT4gdC5nZXQoZC5kb2MpKTtcbiAgY29uc3QgY3VyID0gdmFsc1t2YWxzLmxlbmd0aCAtIDFdO1xuICBjb25zdCBwcmV2ID0gdmFscy5sZW5ndGggPiAxID8gdmFsc1t2YWxzLmxlbmd0aCAtIDJdIDogdW5kZWZpbmVkO1xuICBsZXQgZGVsdGE6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBpZiAodHlwZW9mIGN1ciA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgcHJldiA9PT0gXCJudW1iZXJcIikge1xuICAgIGNvbnN0IGQgPSBjdXIgLSBwcmV2O1xuICAgIGNvbnN0IGFicyA9IE1PTkVZX0tFWS50ZXN0KHQua2V5KSA/IG1vbmV5LmZvcm1hdChNYXRoLmFicyhkKSkgOiBNYXRoLmFicyhkKS50b0xvY2FsZVN0cmluZygpO1xuICAgIGRlbHRhID0gYCR7ZCA+IDAgPyBcIitcIiA6IGQgPCAwID8gXCItXCIgOiBcIlx1MDBCMVwifSR7YWJzfSB2cyAke3Nob3J0RGF0ZShkYXlzW2RheXMubGVuZ3RoIC0gMl0uZGF0ZSl9YDtcbiAgfVxuICByZXR1cm4gPFRpbGUga2V5PXt0LnRpdGxlfSBhcGk9e2FwaX0gbGFiZWw9e3QudGl0bGV9IHZhbHVlPXtmbXQoY3VyLCB0LmtleSl9IGRlbHRhPXtkZWx0YX0gdG9uZT17dmFsdWVUb25lKHQua2V5LCBjdXIpfSAvPjtcbn1cblxuLyoqIE9uZSBjYXJkIHBlciB0cmVuZCB0aGF0IGhhcyBkYXRhOyByZW5kZXJlZCBhcyBhIGZyYWdtZW50IHNvIHRoZSBjYXJkcyBqb2luIHRoZSBzdXJyb3VuZGluZyBGbG93LiAqL1xuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RyZW5kc1xuICAgICAgICAubWFwKCh0KSA9PiAoeyB0LCBwb2ludHM6IGRheXMubWFwKChkKSA9PiAoeyBsYWJlbDogc2hvcnREYXRlKGQuZGF0ZSksIHJhdzogdC5nZXQoZC5kb2MpIH0pKSB9KSlcbiAgICAgICAgLmZpbHRlcigoeyBwb2ludHMgfSkgPT4gcG9pbnRzLnNvbWUoKHB0KSA9PiBwdC5yYXcgIT09IHVuZGVmaW5lZCkpXG4gICAgICAgIC5tYXAoKHsgdCwgcG9pbnRzIH0pID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e3QudGl0bGV9IGFwaT17YXBpfSB0aXRsZT17YCR7dC50aXRsZX0gVHJlbmRgfT5cbiAgICAgICAgICAgIDxMaW5lQ2hhcnRcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIGxhYmVscz17cG9pbnRzLm1hcCgocHQpID0+IHB0LmxhYmVsKX1cbiAgICAgICAgICAgICAgc2VyaWVzPXtbeyBuYW1lOiB0LnRpdGxlLCBjb2xvcjogYXBpLnRoZW1lLnBhbGV0dGUuYWNjZW50LCB2YWx1ZXM6IHBvaW50cy5tYXAoKHB0KSA9PiBwdC5yYXcgPz8gbnVsbCkgfV19XG4gICAgICAgICAgICAgIGZvcm1hdD17YXhpc0ZtdCh0LmtleSl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgPC8+XG4gICk7XG59XG5cbmZ1bmN0aW9uIEhpc3RvcnlIaW50KHsgYXBpLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGRheXM6IERheVtdIH0pIHtcbiAgaWYgKGRheXMubGVuZ3RoID49IDIpIHJldHVybiBudWxsO1xuICByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IGFwaS50aGVtZS5wYWxldHRlLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlRyZW5kcyBmaWxsIGluIGFzIGRhaWx5IGhpc3RvcnkgYWNjdW11bGF0ZXMgKHtkYXlzLmxlbmd0aH0gZGF5IHNvIGZhcikuPC9zcGFuPjtcbn1cblxuZnVuY3Rpb24gY29zdFJvd3MoYXBpOiBQbHVnaW5BcGksIGNvc3Q6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKGNvc3Q/LmJ5VGFnID8/IHt9KVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAuc29ydCgoWywgYV0sIFssIGJdKSA9PiAoYiBhcyBudW1iZXIpIC0gKGEgYXMgbnVtYmVyKSlcbiAgICAubWFwKChbaywgdl0pID0+ICh7XG4gICAgICBsYWJlbDogayxcbiAgICAgIHNlZ21lbnRzOiBbeyBuYW1lOiBcIkNvc3RcIiwgdmFsdWU6IHYgYXMgbnVtYmVyLCBjb2xvcjogcC5hY2NlbnQgfV0sXG4gICAgICB2YWx1ZVRleHQ6IG1vbmV5LmZvcm1hdCh2IGFzIG51bWJlciksXG4gICAgICB0aXA6IFtgJHttb25leS5mb3JtYXQodiBhcyBudW1iZXIpfSAoJHtjb3N0LnRvdGFsID8gKCgodiBhcyBudW1iZXIpIC8gY29zdC50b3RhbCkgKiAxMDApLnRvRml4ZWQoMSkgOiBcIjBcIn0lIG9mIHRvdGFsKWBdLFxuICAgIH0pKTtcbn1cblxuLyoqIEFwcHMgdG9vIHNtYWxsIGZvciB0aGVpciBvd24gdGFiOyB0aGV5IGdldCBvbmUgaW52b2NhdGlvbnMtdnMtZXJyb3JzIGNhcmQgb24gdGhlIE92ZXJ2aWV3IGluc3RlYWQuICovXG5jb25zdCBPVkVSVklFV19PTkxZX0FQUFM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IFNlY3JldHNNYW5hZ2VyOiBcIkdsb2JhbCBTZWNyZXRzIFRyZW5kXCIgfTtcblxuLyoqIFN1bSBvZiBhIExhbWJkYSBtZXRyaWMgYWNyb3NzIGFuIGFwcCdzIGZ1bmN0aW9uczsgdW5rbm93biBpZiBhbnkgZnVuY3Rpb24ncyB2YWx1ZSBpcyB1bmtub3duLiAqL1xuZnVuY3Rpb24gbGFtYmRhU3VtKGFwcDogSnNvbiwgZmllbGQ6IFwiaW52b2NhdGlvbnNcIiB8IFwiZXJyb3JzXCIpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbGFtYmRhcyA9IGFwcD8ubW9uaXRvcmluZz8ubGFtYmRhcztcbiAgaWYgKGxhbWJkYXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGxhbWJkYXMgPT09IG51bGwgfHwgaXNFcnJvck5vZGUobGFtYmRhcykgfHwgaXNFcnJvck5vZGUoYXBwLm1vbml0b3JpbmcpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IE9iamVjdC52YWx1ZXMobGFtYmRhcykubWFwKCh2KSA9PiBtZXRyaWModiwgZmllbGQpKTtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdHlwZW9mIHYgIT09IFwibnVtYmVyXCIpID8gbnVsbCA6ICh2YWxzIGFzIG51bWJlcltdKS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcbn1cblxuZnVuY3Rpb24gSW52b2NhdGlvbnNUcmVuZCh7IGFwaSwgZGF5cywgYXBwTmFtZSwgdGl0bGUgfTogeyBhcGk6IFBsdWdpbkFwaTsgZGF5czogRGF5W107IGFwcE5hbWU6IHN0cmluZzsgdGl0bGU6IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgYXBwRGF5cyA9IGRheXMubWFwKChkKSA9PiAoeyBkYXRlOiBkLmRhdGUsIGFwcDogYXBwc09mKGQuZG9jKS5maW5kKChhKSA9PiBhLm5hbWUgPT09IGFwcE5hbWUpIH0pKS5maWx0ZXIoKGQpID0+IGQuYXBwKTtcbiAgaWYgKGFwcERheXMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc2VyaWVzOiBTZXJpZXNbXSA9IFtcbiAgICB7IG5hbWU6IFwiSW52b2NhdGlvbnNcIiwgY29sb3I6IHAuYWNjZW50LCB2YWx1ZXM6IGFwcERheXMubWFwKChkKSA9PiBsYW1iZGFTdW0oZC5hcHAsIFwiaW52b2NhdGlvbnNcIikgPz8gbnVsbCkgfSxcbiAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciwgdmFsdWVzOiBhcHBEYXlzLm1hcCgoZCkgPT4gbGFtYmRhU3VtKGQuYXBwLCBcImVycm9yc1wiKSA/PyBudWxsKSB9LFxuICBdO1xuICByZXR1cm4gKFxuICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT17dGl0bGV9IHRvbmU9e3ZhbHVlVG9uZShcImxhbWJkYUVycm9yc1wiLCBzZXJpZXNbMV0udmFsdWVzW3Nlcmllc1sxXS52YWx1ZXMubGVuZ3RoIC0gMV0pfSBleHRyYT17PExlZ2VuZCBhcGk9e2FwaX0gaXRlbXM9e3Nlcmllc30gLz59PlxuICAgICAgPExpbmVDaGFydCBhcGk9e2FwaX0gbGFiZWxzPXthcHBEYXlzLm1hcCgoZCkgPT4gc2hvcnREYXRlKGQuZGF0ZSkpfSBzZXJpZXM9e3Nlcmllc30gZm9ybWF0PXtheGlzRm10KFwiXCIpfSAvPlxuICAgIDwvU2VjdGlvbj5cbiAgKTtcbn1cblxuY29uc3QgT1ZFUlZJRVdfVFJFTkRTOiBUcmVuZFtdID0gW1xuICB7IHRpdGxlOiBcIkFXUyBDb3N0ICgzMGQpXCIsIGtleTogXCJjb3N0XCIsIGdldDogKGQpID0+IG1ldHJpYyhkLCBcImF3c0Nvc3QudG90YWxcIikgfSxcbiAgeyB0aXRsZTogXCJSZXF1ZXN0cyAoMjRoKVwiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcImxhbWJkYUVycm9yc1wiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpIH0sXG4gIHsgdGl0bGU6IFwiNXh4IEVycm9ycyAoMjRoKVwiLCBrZXk6IFwiZXJyb3JzNXh4XCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5lcnJvcnM1eHhcIikgfSxcbiAgeyB0aXRsZTogXCJBbGFybXMgRmlyaW5nXCIsIGtleTogXCJpbkFsYXJtXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJoZWFsdGguYWxhcm1zLmluQWxhcm1cIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcImN1c3RvbWVycy5wYXlpbmdcIikgfSxcbl07XG5cbmZ1bmN0aW9uIE92ZXJ2aWV3KHsgYXBpLCBkb2MsIGRheXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgZG9jOiBKc29uOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGNvbnN0IHsgU3RhdHVzRG90IH0gPSBhcGkudWk7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkb2MpO1xuICBjb25zdCBjb3N0ID0gZG9jLmF3c0Nvc3Q7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIiwgZ2FwOiAxMiB9fT5cbiAgICAgIDxUaWxlUm93PntPVkVSVklFV19UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChkb2MpICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgZGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17ZGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2RheXN9IHRyZW5kcz17T1ZFUlZJRVdfVFJFTkRTLnNsaWNlKDAsIDMpfSAvPlxuICAgICAgICB7T2JqZWN0LmVudHJpZXMoT1ZFUlZJRVdfT05MWV9BUFBTKS5tYXAoKFtuYW1lLCB0aXRsZV0pID0+IChcbiAgICAgICAgICA8SW52b2NhdGlvbnNUcmVuZCBrZXk9e25hbWV9IGFwaT17YXBpfSBkYXlzPXtkYXlzfSBhcHBOYW1lPXtuYW1lfSB0aXRsZT17dGl0bGV9IC8+XG4gICAgICAgICkpfVxuICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJBcHBzXCIgdG9uZT17d29yc3QoYXBwcy5tYXAoYXBwU3RhdHVzKSl9PlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwiYXV0byAxZnIgbWF4LWNvbnRlbnQgbWF4LWNvbnRlbnQgbWF4LWNvbnRlbnRcIiwgZ2FwOiBcIjRweCAxMnB4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIgfX0+XG4gICAgICAgICAgICB7W1wiXCIsIFwiQXBwXCIsIFwiUmVxdWVzdHNcIiwgXCJFcnJvcnNcIiwgXCJQcm9maXQgKDMwZClcIl0ubWFwKChoKSA9PiAoXG4gICAgICAgICAgICAgIDxzcGFuIGtleT17aCB8fCBcImRvdFwifSBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICAgICAgICB7aH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICB7YXBwcy5tYXAoKGEpID0+IChcbiAgICAgICAgICAgICAgPGRpdiBrZXk9e2EubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19PlxuICAgICAgICAgICAgICAgIDxTdGF0dXNEb3QgY29sb3I9e2FwcFN0YXR1cyhhKX0gLz5cbiAgICAgICAgICAgICAgICA8c3Bhbj57YS5uYW1lfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3Bhbj57Y2VsbChtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSwgXCJwcm9maXRcIil9PC9zcGFuPlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICkpfVxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT17YEFXUyBDb3N0IEJ5IFByb2plY3Qke2Nvc3QgJiYgIWlzRXJyb3JOb2RlKGNvc3QpID8gYCAoJHtzaG9ydERhdGUoY29zdC53aW5kb3dTdGFydCl9IFRvICR7c2hvcnREYXRlKGNvc3Qud2luZG93RW5kKX0pYCA6IFwiXCJ9YH0+XG4gICAgICAgICAgeyFjb3N0IHx8IGlzRXJyb3JOb2RlKGNvc3QpID8gPHNwYW4+e2ZtdChjb3N0KX08L3NwYW4+IDogPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2Nvc3RSb3dzKGFwaSwgY29zdCl9IC8+fVxuICAgICAgICA8L1NlY3Rpb24+XG4gICAgICA8L0Zsb3c+XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmZ1bmN0aW9uIGxhbWJkYVJvd3MoYXBpOiBQbHVnaW5BcGksIGxhbWJkYXM6IEpzb24pOiB7IHJvd3M6IEJhclJvd1tdOyBpZGxlOiBudW1iZXI7IHVua25vd246IHN0cmluZ1tdIH0ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IHJvd3M6IEJhclJvd1tdID0gW107XG4gIGNvbnN0IHVua25vd246IHN0cmluZ1tdID0gW107XG4gIGxldCBpZGxlID0gMDtcbiAgZm9yIChjb25zdCBbZm4sIHZdIG9mIE9iamVjdC5lbnRyaWVzKGxhbWJkYXMgPz8ge30pIGFzIFtzdHJpbmcsIEpzb25dW10pIHtcbiAgICBjb25zdCBpbnYgPSBtZXRyaWModiwgXCJpbnZvY2F0aW9uc1wiKTtcbiAgICBpZiAodHlwZW9mIGludiAhPT0gXCJudW1iZXJcIikge1xuICAgICAgdW5rbm93bi5wdXNoKGZuKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW52ID09PSAwKSB7XG4gICAgICBpZGxlKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgZXJyID0gbWV0cmljKHYsIFwiZXJyb3JzXCIpID8/IDA7XG4gICAgY29uc3QgdGhyID0gbWV0cmljKHYsIFwidGhyb3R0bGVzXCIpID8/IDA7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIGxhYmVsOiBmbixcbiAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgIHsgbmFtZTogXCJTdWNjZWVkZWRcIiwgdmFsdWU6IE1hdGgubWF4KDAsIGludiAtIGVyciksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIHZhbHVlOiBlcnIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgXSxcbiAgICAgIHZhbHVlVGV4dDogZXJyID8gYCR7aW52LnRvTG9jYWxlU3RyaW5nKCl9ICgkeygoZXJyIC8gaW52KSAqIDEwMCkudG9GaXhlZCgwKX0lIEVycilgIDogaW52LnRvTG9jYWxlU3RyaW5nKCksXG4gICAgICB0aXA6IFtgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gaW52b2NhdGlvbnNgLCBgJHtlcnIudG9Mb2NhbGVTdHJpbmcoKX0gZXJyb3JzYCwgYCR7dGhyLnRvTG9jYWxlU3RyaW5nKCl9IHRocm90dGxlc2BdLFxuICAgIH0pO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gYi5zZWdtZW50c1swXS52YWx1ZSArIGIuc2VnbWVudHNbMV0udmFsdWUgLSAoYS5zZWdtZW50c1swXS52YWx1ZSArIGEuc2VnbWVudHNbMV0udmFsdWUpKTtcbiAgcmV0dXJuIHsgcm93cywgaWRsZSwgdW5rbm93biB9O1xufVxuXG5mdW5jdGlvbiBhcGlSb3dzKGFwaTogUGx1Z2luQXBpLCBhcGlzOiBKc29uKTogQmFyUm93W10ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoT2JqZWN0LmVudHJpZXMoYXBpcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSlcbiAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIG1ldHJpYyh2LCBcInJlcXVlc3RzXCIpID09PSBcIm51bWJlclwiKVxuICAgIC5tYXAoKFtuYW1lLCB2XSkgPT4ge1xuICAgICAgY29uc3QgcmVxID0gbWV0cmljKHYsIFwicmVxdWVzdHNcIikgYXMgbnVtYmVyO1xuICAgICAgY29uc3QgZTQgPSBtZXRyaWModiwgXCJlcnJvcnM0eHhcIikgPz8gMDtcbiAgICAgIGNvbnN0IGU1ID0gbWV0cmljKHYsIFwiZXJyb3JzNXh4XCIpID8/IDA7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBsYWJlbDogbmFtZSxcbiAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICB7IG5hbWU6IFwiT0tcIiwgdmFsdWU6IE1hdGgubWF4KDAsIHJlcSAtIGU0IC0gZTUpLCBjb2xvcjogcC5hY2NlbnQgfSxcbiAgICAgICAgICB7IG5hbWU6IFwiNHh4XCIsIHZhbHVlOiBlNCwgY29sb3I6IHAuc3RhdHVzLndhcm5pbmcgfSxcbiAgICAgICAgICB7IG5hbWU6IFwiNXh4XCIsIHZhbHVlOiBlNSwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICAgIF0sXG4gICAgICAgIHZhbHVlVGV4dDogcmVxLnRvTG9jYWxlU3RyaW5nKCksXG4gICAgICAgIHRpcDogW2Ake3JlcS50b0xvY2FsZVN0cmluZygpfSByZXF1ZXN0c2AsIGAke2U0LnRvTG9jYWxlU3RyaW5nKCl9IDR4eCwgJHtlNS50b0xvY2FsZVN0cmluZygpfSA1eHhgLCBgcDk1IGxhdGVuY3k6ICR7Zm10KHYucDk1TGF0ZW5jeU1zLCBcImxhdGVuY3ltc1wiKX1gXSxcbiAgICAgIH07XG4gICAgfSlcbiAgICAuc29ydCgoYSwgYikgPT4gYi5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSAtIGEuc2VnbWVudHMucmVkdWNlKChzLCB4KSA9PiBzICsgeC52YWx1ZSwgMCkpO1xufVxuXG5mdW5jdGlvbiBSb3dzKHsgYXBpLCB2YWx1ZSwgcGF0aCA9IFwiXCIgfTogeyBhcGk6IFBsdWdpbkFwaTsgdmFsdWU6IEpzb247IHBhdGg/OiBzdHJpbmcgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgaXNFcnJvck5vZGUodmFsdWUpKSB7XG4gICAgcmV0dXJuIDxzcGFuPntmbXQodmFsdWUsIHBhdGgpfTwvc3Bhbj47XG4gIH1cbiAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKHZhbHVlKS5maWx0ZXIoKFssIHZdKSA9PiAhKHR5cGVvZiB2ID09PSBcInN0cmluZ1wiICYmICh2Lmxlbmd0aCA+IDgwIHx8IHYuaW5jbHVkZXMoXCJcXG5cIikpKSk7XG4gIGlmIChlbnRyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT5Ob25lPC9zcGFuPjtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBcIm1heC1jb250ZW50IDFmclwiLCBnYXA6IFwiMnB4IDE2cHhcIiB9fT5cbiAgICAgIHtlbnRyaWVzLm1hcCgoW2ssIHZdKSA9PiB7XG4gICAgICAgIGNvbnN0IG5lc3RlZCA9IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgIWlzRXJyb3JOb2RlKHYpO1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIDxkaXYga2V5PXtrfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0+XG4gICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e3RpdGxlQ2FzZShrKX08L3NwYW4+XG4gICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogdmFsdWVUb25lKGssIHYpID8gcC5zdGF0dXNbdmFsdWVUb25lKGssIHYpIGFzIFN0YXR1c0NvbG9yXSA6IHVuZGVmaW5lZCB9fT5cbiAgICAgICAgICAgICAge25lc3RlZCA/IEFycmF5LmlzQXJyYXkodikgPyA8c3Bhbj57di5sZW5ndGggPyB2LmpvaW4oXCIsIFwiKSA6IFwiTm9uZVwifTwvc3Bhbj4gOiA8Um93cyBhcGk9e2FwaX0gdmFsdWU9e3Z9IHBhdGg9e2t9IC8+IDogZm10KHYsIGspfVxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICApO1xuICAgICAgfSl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmNvbnN0IHRpdGxlQ2FzZSA9IChzOiBzdHJpbmcpID0+IHMucmVwbGFjZSgvKFtBLVpdKS9nLCBcIiAkMVwiKS5yZXBsYWNlKC9eLi8sIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkpO1xuXG5jb25zdCBBUFBfVFJFTkRTOiBUcmVuZFtdID0gW1xuICB7IHRpdGxlOiBcIlJlcXVlc3RzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMucmVxdWVzdHNcIikgfSxcbiAgeyB0aXRsZTogXCJMYW1iZGEgRXJyb3JzICgyNGgpXCIsIGtleTogXCJsYW1iZGFFcnJvcnNcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpIH0sXG4gIHsgdGl0bGU6IFwiUGF5aW5nIEN1c3RvbWVyc1wiLCBrZXk6IFwiXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcImN1c3RvbWVycy5wYXlpbmdcIikgfSxcbiAgeyB0aXRsZTogXCJNUlJcIiwga2V5OiBcIm1yclwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25leS5tcnJcIikgfSxcbiAgeyB0aXRsZTogXCJQcm9maXQgKDMwZClcIiwga2V5OiBcInByb2ZpdFwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25leS5wcm9maXQzMGRcIikgfSxcbl07XG5cbmZ1bmN0aW9uIEFwcFZpZXcoeyBhcGksIGFwcCwgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBhcHA6IEpzb247IGRheXM6IERheVtdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBhcHBEYXlzID0gZGF5cy5tYXAoKGQpID0+ICh7IGRhdGU6IGQuZGF0ZSwgZG9jOiBhcHBzT2YoZC5kb2MpLmZpbmQoKGEpID0+IGEubmFtZSA9PT0gYXBwLm5hbWUpIH0pKS5maWx0ZXIoKGQpID0+IGQuZG9jKTtcbiAgY29uc3QgbW9uID0gYXBwLm1vbml0b3Jpbmc7XG4gIGNvbnN0IGF1ZCA9IGFwcC5hdWRpZW5jZTtcbiAgY29uc3QgYXVkRGF5czogSnNvbltdID0gYXVkICYmIEFycmF5LmlzQXJyYXkoYXVkLmRheXMpID8gYXVkLmRheXMgOiBbXTtcbiAgY29uc3QgYXVkS2V5cyA9IGF1ZERheXMubGVuZ3RoID8gT2JqZWN0LmtleXMoYXVkRGF5c1swXSkuZmlsdGVyKChrKSA9PiBrICE9PSBcImRhdGVcIiAmJiB0eXBlb2YgYXVkRGF5c1swXVtrXSA9PT0gXCJudW1iZXJcIikgOiBbXTtcbiAgY29uc3QgbGFtYmRhcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmxhbWJkYXMpID8gbGFtYmRhUm93cyhhcGksIG1vbi5sYW1iZGFzKSA6IG51bGw7XG4gIGNvbnN0IGFwaXMgPSBtb24gJiYgIWlzRXJyb3JOb2RlKG1vbikgJiYgIWlzRXJyb3JOb2RlKG1vbi5hcGlzKSA/IGFwaVJvd3MoYXBpLCBtb24uYXBpcykgOiBudWxsO1xuICBjb25zdCBkZXRhaWxzID0gT2JqZWN0LmVudHJpZXMoYXBwKS5maWx0ZXIoKFtrXSkgPT4gayAhPT0gXCJuYW1lXCIgJiYgayAhPT0gXCJtb25pdG9yaW5nXCIpO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIiwgZ2FwOiAxMiB9fT5cbiAgICAgIDxUaWxlUm93PntBUFBfVFJFTkRTLmZpbHRlcigodCkgPT4gdC5nZXQoYXBwKSAhPT0gdW5kZWZpbmVkKS5tYXAoKHQpID0+IHRyZW5kVGlsZShhcGksIGFwcERheXMsIHQpKX08L1RpbGVSb3c+XG4gICAgICA8SGlzdG9yeUhpbnQgYXBpPXthcGl9IGRheXM9e2FwcERheXN9IC8+XG4gICAgICA8Rmxvdz5cbiAgICAgICAgPFRyZW5kQ2hhcnRzIGFwaT17YXBpfSBkYXlzPXthcHBEYXlzfSB0cmVuZHM9e0FQUF9UUkVORFN9IC8+XG4gICAgICAgIHttb24gJiYgaXNFcnJvck5vZGUobW9uKSAmJiAoXG4gICAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiTW9uaXRvcmluZyAoMjRoKVwiIHRvbmU9XCJ3YXJuaW5nXCI+XG4gICAgICAgICAgICA8c3Bhbj57Zm10KG1vbil9PC9zcGFuPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2FwaXMgJiYgYXBpcy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT1cIkFQSSBSZXF1ZXN0cyAoMjRoKVwiXG4gICAgICAgICAgICB0b25lPXthcGlzLnNvbWUoKHIpID0+IHIuc2VnbWVudHMuc29tZSgocykgPT4gcy5uYW1lID09PSBcIjV4eFwiICYmIHMudmFsdWUgPiAwKSkgPyBcIndhcm5pbmdcIiA6IG51bGx9XG4gICAgICAgICAgICBleHRyYT17XG4gICAgICAgICAgICAgIDxMZWdlbmRcbiAgICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgICBpdGVtcz17W1xuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIk9LXCIsIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIjR4eFwiLCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIjV4eFwiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgICAgICAgICBdfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXthcGlzfSAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2xhbWJkYXMgJiYgbGFtYmRhcy5yb3dzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uXG4gICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgIHRpdGxlPVwiTGFtYmRhIEludm9jYXRpb25zICgyNGgpXCJcbiAgICAgICAgICAgIHRvbmU9e2xhbWJkYXMucm93cy5zb21lKChyKSA9PiByLnNlZ21lbnRzLnNvbWUoKHMpID0+IHMubmFtZSA9PT0gXCJFcnJvcnNcIiAmJiBzLnZhbHVlID4gMCkpID8gXCJlcnJvclwiIDogbnVsbH1cbiAgICAgICAgICAgIGV4dHJhPXtcbiAgICAgICAgICAgICAgPExlZ2VuZFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIGl0ZW1zPXtbXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiU3VjY2VlZGVkXCIsIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIkVycm9yc1wiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgICAgICAgICBdfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXtsYW1iZGFzLnJvd3N9IC8+XG4gICAgICAgICAgICB7KGxhbWJkYXMuaWRsZSA+IDAgfHwgbGFtYmRhcy51bmtub3duLmxlbmd0aCA+IDApICYmIChcbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAgICAgICAge1tsYW1iZGFzLmlkbGUgPyBgJHtsYW1iZGFzLmlkbGV9IGlkbGUgZnVuY3Rpb24ke2xhbWJkYXMuaWRsZSA+IDEgPyBcInNcIiA6IFwiXCJ9IGhpZGRlbmAgOiBcIlwiLCBsYW1iZGFzLnVua25vd24ubGVuZ3RoID8gYFVua25vd246ICR7bGFtYmRhcy51bmtub3duLmpvaW4oXCIsIFwiKX1gIDogXCJcIl1cbiAgICAgICAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgICAgICAgICAgICAgIC5qb2luKFwiLiBcIil9XG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7YXVkS2V5cy5tYXAoKGspID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e2t9IGFwaT17YXBpfSB0aXRsZT17YERhaWx5ICR7dGl0bGVDYXNlKGspfWB9PlxuICAgICAgICAgICAgPExpbmVDaGFydFxuICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgbGFiZWxzPXthdWREYXlzLm1hcCgoZCkgPT4gc2hvcnREYXRlKFN0cmluZyhkLmRhdGUpKSl9XG4gICAgICAgICAgICAgIHNlcmllcz17W3sgbmFtZTogdGl0bGVDYXNlKGspLCBjb2xvcjogcC5hY2NlbnQsIHZhbHVlczogYXVkRGF5cy5tYXAoKGQpID0+ICh0eXBlb2YgZFtrXSA9PT0gXCJudW1iZXJcIiA/IGRba10gOiBudWxsKSkgfV19XG4gICAgICAgICAgICAgIGZvcm1hdD17YXhpc0ZtdChrKX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApKX1cbiAgICAgICAge2F1ZD8uc291cmNlczMwZCAmJiAhaXNFcnJvck5vZGUoYXVkLnNvdXJjZXMzMGQpICYmIChcbiAgICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJUcmFmZmljIFNvdXJjZXMgKDMwZClcIj5cbiAgICAgICAgICAgIDxCYXJMaXN0XG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICByb3dzPXsoT2JqZWN0LmVudHJpZXMoYXVkLnNvdXJjZXMzMGQpIGFzIFtzdHJpbmcsIEpzb25dW10pXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWywgdl0pID0+IHR5cGVvZiB2ID09PSBcIm51bWJlclwiKVxuICAgICAgICAgICAgICAgIC5zb3J0KChbLCBhXSwgWywgYl0pID0+IGIgLSBhKVxuICAgICAgICAgICAgICAgIC5tYXAoKFtrLCB2XSkgPT4gKHtcbiAgICAgICAgICAgICAgICAgIGxhYmVsOiB0aXRsZUNhc2UoayksXG4gICAgICAgICAgICAgICAgICBzZWdtZW50czogW3sgbmFtZTogXCJWaWV3c1wiLCB2YWx1ZTogdiwgY29sb3I6IHAuYWNjZW50IH1dLFxuICAgICAgICAgICAgICAgICAgdmFsdWVUZXh0OiB2LnRvTG9jYWxlU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICB0aXA6IFtgJHt2LnRvTG9jYWxlU3RyaW5nKCl9IHZpZXdzYF0sXG4gICAgICAgICAgICAgICAgfSkpfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHtkZXRhaWxzLm1hcCgoW2ssIHZdKSA9PiAoXG4gICAgICAgICAgPFNlY3Rpb24ga2V5PXtrfSBhcGk9e2FwaX0gdGl0bGU9e3RpdGxlQ2FzZShrKX0gdG9uZT17Z3JvdXBUb25lKHYpfT5cbiAgICAgICAgICAgIDxSb3dzXG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICB2YWx1ZT17ayA9PT0gXCJhdWRpZW5jZVwiICYmIHYgJiYgIWlzRXJyb3JOb2RlKHYpID8gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHYpLmZpbHRlcigoW2trXSkgPT4ga2sgIT09IFwiZGF5c1wiICYmIGtrICE9PSBcInNvdXJjZXMzMGRcIikpIDogdn1cbiAgICAgICAgICAgICAgcGF0aD17a31cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApKX1cbiAgICAgIDwvRmxvdz5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIENvbXBvbmVudCh7IGFwaSB9OiB7IGFwaTogUGx1Z2luQXBpOyBwYW5lSWQ/OiBzdHJpbmcgfSkge1xuICBjb25zdCB7IFRleHRCdXR0b24sIFRhYnMsIEJhbm5lciwgU3Bpbm5lciB9ID0gYXBpLnVpO1xuICBjb25zdCBwYWxldHRlID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFssIGZvcmNlXSA9IHVzZVN0YXRlKDApO1xuICBjb25zdCBbdGFiLCBzZXRUYWJdID0gdXNlU3RhdGUoXCJvdmVydmlld1wiKTtcbiAgY29uc3QgWywgc2V0VGhlbWVdID0gdXNlU3RhdGUoMCk7XG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBsID0gKCkgPT4gZm9yY2UoKG4pID0+IG4gKyAxKTtcbiAgICBsaXN0ZW5lcnMuYWRkKGwpO1xuICAgIGNvbnN0IHVuc3ViID0gYXBpLnRoZW1lLnN1YnNjcmliZSgoKSA9PiBzZXRUaGVtZSgobikgPT4gbiArIDEpKTtcbiAgICBpZiAoIXN0YXRlLmRhdGEpIHtcbiAgICAgIHZvaWQgYXBpLnN0b3JhZ2UuZ2V0PEpzb24+KENBQ0hFX0tFWSkudGhlbigoY2FjaGVkKSA9PiB7XG4gICAgICAgIGlmIChjYWNoZWQgJiYgIXN0YXRlLmRhdGEpIHNldFN0YXRlKHsgZGF0YTogY2FjaGVkIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBsaXN0ZW5lcnMuZGVsZXRlKGwpO1xuICAgICAgdW5zdWIoKTtcbiAgICB9O1xuICB9LCBbYXBpXSk7XG5cbiAgY29uc3QgeyBkYXRhLCBlcnJvciwgbG9hZGluZyB9ID0gc3RhdGU7XG4gIGNvbnN0IGFwcHMgPSBhcHBzT2YoZGF0YSk7XG4gIGNvbnN0IGRheXMgPSBhbGxEYXlzKCk7XG4gIGNvbnN0IGFnZSA9IGRhdGEgPyBhZ2VIb3VycyhkYXRhLmdlbmVyYXRlZEF0KSA6IG51bGw7XG4gIGNvbnN0IHN0YWxlID0gZGF0YSAmJiAoYWdlID09PSBudWxsIHx8IGFnZSA+IFNUQUxFX0hPVVJTKTtcbiAgY29uc3QgdGFiQXBwcyA9IGFwcHMuZmlsdGVyKChhKSA9PiAhKGEubmFtZSBpbiBPVkVSVklFV19PTkxZX0FQUFMpKTtcbiAgY29uc3QgY3VycmVudCA9IHRhYiA9PT0gXCJvdmVydmlld1wiID8gbnVsbCA6IHRhYkFwcHMuZmluZCgoYSkgPT4gYS5uYW1lID09PSB0YWIpO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBmbGV4OiAxLCBtaW5IZWlnaHQ6IDAsIGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyLCBjb2xvcjogcGFsZXR0ZS50ZXh0IH19PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiAxMiwgcGFkZGluZ1JpZ2h0OiAyNCB9fT5cbiAgICAgICAgPGgyIHN0eWxlPXt7IG1hcmdpbjogMCB9fT57TkFNRX08L2gyPlxuICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcGFsZXR0ZS50ZXh0TXV0ZWQsIGZsZXg6IDEgfX0+XG4gICAgICAgICAge2RhdGFcbiAgICAgICAgICAgID8gYEdlbmVyYXRlZCAke2RhdGEuZ2VuZXJhdGVkQXQgPyBuZXcgRGF0ZShkYXRhLmdlbmVyYXRlZEF0KS50b0xvY2FsZVN0cmluZygpIDogXCJVbmtub3duXCJ9IFx1MDBCNyAke2RheXMubGVuZ3RofSBEYXkke2RheXMubGVuZ3RoID09PSAxID8gXCJcIiA6IFwic1wifSBPZiBIaXN0b3J5YFxuICAgICAgICAgICAgOiBcIk5vIERhdGEgWWV0XCJ9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICAge2xvYWRpbmcgJiYgPFNwaW5uZXIgc2l6ZT17MTZ9IC8+fVxuICAgICAgICA8VGV4dEJ1dHRvbiBsYWJlbD1cIlJlZnJlc2hcIiB2YXJpYW50PVwicHJpbWFyeVwiIGRpc2FibGVkPXtsb2FkaW5nfSBvbkNsaWNrPXsoKSA9PiB2b2lkIHJlZnJlc2goYXBpKX0gLz5cbiAgICAgIDwvZGl2PlxuICAgICAge2Vycm9yICYmIDxCYW5uZXIgbWVzc2FnZT17YENvdWxkIE5vdCBMb2FkIE1ldHJpY3M6ICR7ZXJyb3J9YH0gdG9uZT1cImVycm9yXCIgLz59XG4gICAgICB7c3RhbGUgJiYgPEJhbm5lciBtZXNzYWdlPXtgTWV0cmljcyBBcmUgT2xkZXIgVGhhbiAke1NUQUxFX0hPVVJTfSBIb3VyczsgVGhlIERhaWx5IENvbGxlY3RvciBNYXkgSGF2ZSBGYWlsZWRgfSB0b25lPVwid2FybmluZ1wiIC8+fVxuICAgICAge2RhdGEgJiYgKFxuICAgICAgICA8PlxuICAgICAgICAgIDxUYWJzXG4gICAgICAgICAgICB0YWJzPXtbeyBsYWJlbDogXCJPdmVydmlld1wiLCB2YWx1ZTogXCJvdmVydmlld1wiIH0sIC4uLnRhYkFwcHMubWFwKChhKSA9PiAoeyBsYWJlbDogYS5uYW1lIGFzIHN0cmluZywgdmFsdWU6IGEubmFtZSBhcyBzdHJpbmcgfSkpXX1cbiAgICAgICAgICAgIHZhbHVlPXtjdXJyZW50ID8gdGFiIDogXCJvdmVydmlld1wifVxuICAgICAgICAgICAgb25DaGFuZ2U9e3NldFRhYn1cbiAgICAgICAgICAvPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgLi4uc2Nyb2xsYmFyU3R5bGUocGFsZXR0ZSksIGZsZXg6IDEsIG1pbkhlaWdodDogMCwgb3ZlcmZsb3c6IFwiYXV0b1wiLCBwYWRkaW5nUmlnaHQ6IEdBUCB9fT5cbiAgICAgICAgICAgIHtjdXJyZW50ID8gPEFwcFZpZXcgYXBpPXthcGl9IGFwcD17Y3VycmVudH0gZGF5cz17ZGF5c30gLz4gOiA8T3ZlcnZpZXcgYXBpPXthcGl9IGRvYz17ZGF0YX0gZGF5cz17ZGF5c30gLz59XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvPlxu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

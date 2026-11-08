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
function worstTone(tones) {
  const set = tones.filter((t) => !!t);
  return set.length ? worst(set) : null;
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
function Tile({
  api,
  label,
  value,
  delta,
  tone,
  outline
}) {
  const border = worstTone([tone, outline]);
  const p = api.theme.palette;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        minWidth: 0,
        boxSizing: "border-box",
        background: p.surface,
        border: `1px solid ${border ? p.status[border] : p.border}`,
        borderRadius: 6,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2
      },
      children: [
        /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: label }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: 22, lineHeight: "30px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: tone ? p.status[tone] : void 0 }, children: value }),
        delta?.map((d) => /* @__PURE__ */ jsx("span", { style: { color: p.textMuted, fontSize: 12 }, children: d }, d))
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
  const avg = averageCheck(vals);
  const avgText = avg ? `${avg.change >= 0 ? "+" : "-"}${Math.round(Math.abs(avg.change) * 100)}% vs ${axisFmt(t.key)(avg.avg)} avg` : null;
  return /* @__PURE__ */ jsx(
    Tile,
    {
      api,
      label: t.title,
      value: fmt(cur, t.key),
      delta: [delta, avgText].filter((d) => !!d),
      tone: valueTone(t.key, cur),
      outline: avg?.tone
    },
    t.title
  );
}
var AVG_MIN_DAYS = 3;
var AVG_WARNING = 1;
var AVG_ERROR = 5;
function averageCheck(vals) {
  const cur = vals[vals.length - 1];
  const prev = vals.slice(0, -1).filter((v) => typeof v === "number");
  if (typeof cur !== "number" || prev.length < AVG_MIN_DAYS) return null;
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  if (avg === 0) return null;
  const change = (cur - avg) / Math.abs(avg);
  const dev = Math.abs(change);
  return { avg, change, tone: dev >= AVG_ERROR ? "error" : dev >= AVG_WARNING ? "warning" : null };
}
function TrendCharts({ api, days, trends }) {
  return /* @__PURE__ */ jsx(Fragment, { children: trends.map((t) => ({ t, points: days.map((d) => ({ label: shortDate(d.date), raw: t.get(d.doc) })) })).filter(({ points }) => points.some((pt) => pt.raw !== void 0)).map(({ t, points }) => /* @__PURE__ */ jsx(
    Section,
    {
      api,
      title: `${t.title} Trend`,
      tone: worstTone([valueTone(t.key, points[points.length - 1]?.raw), averageCheck(points.map((pt) => pt.raw))?.tone]),
      children: /* @__PURE__ */ jsx(
        LineChart,
        {
          api,
          labels: points.map((pt) => pt.label),
          series: [{ name: t.title, color: api.theme.palette.accent, values: points.map((pt) => pt.raw ?? null) }],
          format: axisFmt(t.key)
        }
      )
    },
    t.title
  )) });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIGxvYWRpbmc6IGJvb2xlYW47XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UgfTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIHN0YXRlID0geyAuLi5zdGF0ZSwgLi4ucGF0Y2ggfTtcbiAgbGlzdGVuZXJzLmZvckVhY2goKGwpID0+IGwoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tXG5cbmNvbnN0IGlzRXJyb3JOb2RlID0gKHY6IEpzb24pOiBib29sZWFuID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHYuZXJyb3IgPT09IFwic3RyaW5nXCI7XG5cbmZ1bmN0aW9uIGhhc0Vycm9yTm9kZSh2OiBKc29uKTogYm9vbGVhbiB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIHRydWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIGlmICh2ICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiKSByZXR1cm4gT2JqZWN0LnZhbHVlcyh2KS5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgbW9uZXkgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IHN0eWxlOiBcImN1cnJlbmN5XCIsIGN1cnJlbmN5OiBcIlVTRFwiIH0pO1xuY29uc3QgY29tcGFjdCA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgbm90YXRpb246IFwiY29tcGFjdFwiLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG5jb25zdCBNT05FWV9LRVkgPSAvKG1ycnxwcm9maXR8Y29zdHxhbW91bnR8cmV2ZW51ZSkvaTtcblxuLyoqIFNpbmdsZSBmb3JtYXR0ZXI6IG51bGwvdW5kZWZpbmVkL2Vycm9yIG5vZGVzIGFyZSBcIlVua25vd25cIiwgbmV2ZXIgemVyby4gKi9cbmZ1bmN0aW9uIGZtdCh2OiBKc29uLCBrZXkgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gXCJVbmtub3duXCI7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIGBVbmtub3duICgke3YuZXJyb3J9KWA7XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChNT05FWV9LRVkudGVzdChrZXkpKSByZXR1cm4gbW9uZXkuZm9ybWF0KHYpO1xuICAgIGlmICgvbGF0ZW5jeW1zL2kudGVzdChrZXkpKSByZXR1cm4gYCR7TWF0aC5yb3VuZCh2KX0gbXNgO1xuICAgIHJldHVybiB2LnRvTG9jYWxlU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHR5cGVvZiB2ID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xuICByZXR1cm4gU3RyaW5nKHYpO1xufVxuXG4vKiogVGFibGUgY2VsbDogXCItXCIgd2hlbiB0aGUgYXBwIGhhcyBubyBzdWNoIG1ldHJpYywgb3RoZXJ3aXNlIGZtdCAoc28gdW5rbm93biBzdGF5cyBcIlVua25vd25cIikuICovXG5jb25zdCBjZWxsID0gKHY6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIGtleSA9IFwiXCIpID0+ICh2ID09PSB1bmRlZmluZWQgPyBcIi1cIiA6IGZtdCh2LCBrZXkpKTtcblxuY29uc3QgYXhpc0ZtdCA9IChrZXk6IHN0cmluZykgPT4gKG46IG51bWJlcikgPT4gKE1PTkVZX0tFWS50ZXN0KGtleSkgPyBtb25leS5mb3JtYXQobikgOiBjb21wYWN0LmZvcm1hdChuKSk7XG5cbmZ1bmN0aW9uIGFnZUhvdXJzKGlzbzogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgbnVsbCB7XG4gIGNvbnN0IHQgPSBpc28gPyBEYXRlLnBhcnNlKGlzbykgOiBOYU47XG4gIHJldHVybiBOdW1iZXIuaXNOYU4odCkgPyBudWxsIDogKERhdGUubm93KCkgLSB0KSAvIDNfNjAwXzAwMDtcbn1cblxuY29uc3Qgc2hvcnREYXRlID0gKGQ6IHN0cmluZykgPT4gbmV3IERhdGUoYCR7ZH1UMDA6MDA6MDBaYCkudG9Mb2NhbGVEYXRlU3RyaW5nKHVuZGVmaW5lZCwgeyBtb250aDogXCJzaG9ydFwiLCBkYXk6IFwibnVtZXJpY1wiLCB0aW1lWm9uZTogXCJVVENcIiB9KTtcblxuY29uc3QgYXBwc09mID0gKGRvYzogSnNvbik6IEpzb25bXSA9PiAoZG9jICYmIEFycmF5LmlzQXJyYXkoZG9jLmFwcHMpID8gZG9jLmFwcHMgOiBbXSk7XG5cbi8qKiBXYWxrcyBhIGRvdHRlZCBwYXRoLiB1bmRlZmluZWQgPSBub3QgcHJlc2VudCwgbnVsbCA9IHVua25vd24gKGVycm9yIG5vZGUgb3IgbnVsbCksIG51bWJlciA9IHZhbHVlLiAqL1xuZnVuY3Rpb24gbWV0cmljKG86IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBsZXQgdiA9IG87XG4gIGZvciAoY29uc3QgayBvZiBwYXRoLnNwbGl0KFwiLlwiKSkge1xuICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHYgPT09IG51bGwgfHwgaXNFcnJvck5vZGUodikpIHJldHVybiBudWxsO1xuICAgIHYgPSB2W2tdO1xuICB9XG4gIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodikgPyB2IDogbnVsbDtcbn1cblxuLyoqIFN1bXMgYSBtZXRyaWMgYWNyb3NzIGFwcHM7IGFueSB1bmtub3duIGFwcCB2YWx1ZSBtYWtlcyB0aGUgdG90YWwgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIHN1bUFwcHMoZG9jOiBKc29uLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFkb2MgfHwgaXNFcnJvck5vZGUoZG9jLmFwcHMpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IGFwcHNPZihkb2MpXG4gICAgLm1hcCgoYSkgPT4gbWV0cmljKGEsIHBhdGgpKVxuICAgIC5maWx0ZXIoKHYpID0+IHYgIT09IHVuZGVmaW5lZCk7XG4gIGlmICh2YWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdiA9PT0gbnVsbCkgPyBudWxsIDogKHZhbHMgYXMgbnVtYmVyW10pLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xufVxuXG4vKiogU3RhdHVzIGEgc2luZ2xlIHZhbHVlIHNpZ25hbHM6IGZpcmluZyBhbGFybXMgYXJlIGFuIGVycm9yLCA1eHggcmVzcG9uc2VzIGEgd2FybmluZy4gKi9cbmZ1bmN0aW9uIHZhbHVlVG9uZShrZXk6IHN0cmluZywgdjogSnNvbik6IFN0YXR1c0NvbG9yIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdiAhPT0gXCJudW1iZXJcIiB8fCB2IDw9IDApIHJldHVybiBudWxsO1xuICBpZiAoa2V5ID09PSBcImluQWxhcm1cIikgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGtleSA9PT0gXCJsYW1iZGFFcnJvcnNcIikgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGtleSA9PT0gXCJlcnJvcnM1eHhcIikgcmV0dXJuIFwid2FybmluZ1wiO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIFdvcnN0IG9mIHRoZSBnaXZlbiB0b25lcywgaWdub3JpbmcgbnVsbHM7IG51bGwgd2hlbiBub25lIGFyZSBzZXQuICovXG5mdW5jdGlvbiB3b3JzdFRvbmUodG9uZXM6IChTdGF0dXNDb2xvciB8IG51bGwgfCB1bmRlZmluZWQpW10pOiBTdGF0dXNDb2xvciB8IG51bGwge1xuICBjb25zdCBzZXQgPSB0b25lcy5maWx0ZXIoKHQpOiB0IGlzIFN0YXR1c0NvbG9yID0+ICEhdCk7XG4gIHJldHVybiBzZXQubGVuZ3RoID8gd29yc3Qoc2V0KSA6IG51bGw7XG59XG5cbi8qKiBXb3JzdCB0b25lIG9mIGFueSB2YWx1ZSBpbiBhIGdyb3VwOiBmaXJpbmcgYWxhcm1zIC0+IGVycm9yOyA1eHgsIHN0YWxlIHN0YXRlcyBvciB1bmtub3duIHNlY3Rpb25zIC0+IHdhcm5pbmcuICovXG5mdW5jdGlvbiBncm91cFRvbmUodjogSnNvbik6IFN0YXR1c0NvbG9yIHwgbnVsbCB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIFwid2FybmluZ1wiO1xuICBpZiAoIXYgfHwgdHlwZW9mIHYgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsO1xuICBjb25zdCB0b25lczogU3RhdHVzQ29sb3JbXSA9IFtdO1xuICBjb25zdCB3YWxrID0gKG86IEpzb24pID0+XG4gICAgT2JqZWN0LmVudHJpZXMobykuZm9yRWFjaCgoW2ssIHhdKSA9PiB7XG4gICAgICBjb25zdCB0ID0gdmFsdWVUb25lKGssIHgpID8/IChrID09PSBcInN0YWxlU3RhdGVzXCIgJiYgdHlwZW9mIHggPT09IFwibnVtYmVyXCIgJiYgeCA+IDAgPyBcIndhcm5pbmdcIiA6IG51bGwpID8/IChpc0Vycm9yTm9kZSh4KSA/IFwid2FybmluZ1wiIDogbnVsbCk7XG4gICAgICBpZiAodCkgdG9uZXMucHVzaCh0KTtcbiAgICAgIGVsc2UgaWYgKHggJiYgdHlwZW9mIHggPT09IFwib2JqZWN0XCIpIHdhbGsoeCk7XG4gICAgfSk7XG4gIHdhbGsodik7XG4gIHJldHVybiB0b25lcy5sZW5ndGggPyB3b3JzdCh0b25lcykgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBhcHBTdGF0dXMoYXBwOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBpZiAodmFsdWVUb25lKFwiaW5BbGFybVwiLCBtZXRyaWMoYXBwLCBcImhlYWx0aC5hbGFybXMuaW5BbGFybVwiKSkpIHJldHVybiBcImVycm9yXCI7XG4gIGlmICh2YWx1ZVRvbmUoXCJsYW1iZGFFcnJvcnNcIiwgbWV0cmljKGFwcCwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikpKSByZXR1cm4gXCJlcnJvclwiO1xuICBpZiAoaGFzRXJyb3JOb2RlKGFwcCkpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKHZhbHVlVG9uZShcImVycm9yczV4eFwiLCBtZXRyaWMoYXBwLCBcIm1vbml0b3JpbmcudG90YWxzLmVycm9yczV4eFwiKSkpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKChhcHAuaGVhbHRoPy5mcmVzaG5lc3M/LnN0YWxlU3RhdGVzID8/IDApID4gMCkgcmV0dXJuIFwid2FybmluZ1wiO1xuICByZXR1cm4gXCJzdWNjZXNzXCI7XG59XG5cbmNvbnN0IFdPUlNUOiBTdGF0dXNDb2xvcltdID0gW1wiaWRsZVwiLCBcInN1Y2Nlc3NcIiwgXCJ3YXJuaW5nXCIsIFwiZXJyb3JcIl07XG5jb25zdCB3b3JzdCA9IChjczogU3RhdHVzQ29sb3JbXSk6IFN0YXR1c0NvbG9yID0+IGNzLnJlZHVjZSgoYSwgYikgPT4gKFdPUlNULmluZGV4T2YoYikgPiBXT1JTVC5pbmRleE9mKGEpID8gYiA6IGEpLCBcInN1Y2Nlc3NcIiBhcyBTdGF0dXNDb2xvcik7XG5cbmZ1bmN0aW9uIGRvY1N0YXR1cyhkb2M6IEpzb24pOiBTdGF0dXNDb2xvciB7XG4gIGNvbnN0IGFnZSA9IGFnZUhvdXJzKGRvYy5nZW5lcmF0ZWRBdCk7XG4gIGNvbnN0IHN0YWxlID0gYWdlID09PSBudWxsIHx8IGFnZSA+IFNUQUxFX0hPVVJTO1xuICBjb25zdCBzdGF0dXMgPSB3b3JzdChhcHBzT2YoZG9jKS5tYXAoYXBwU3RhdHVzKSk7XG4gIHJldHVybiBzdGFsZSB8fCBoYXNFcnJvck5vZGUoZG9jKSA/IHdvcnN0KFtzdGF0dXMsIFwid2FybmluZ1wiXSkgOiBzdGF0dXM7XG59XG5cbi8qKiBIaXN0b3J5IHBsdXMgdGhlIGxhdGVzdCBkb2N1bWVudCwgb25lIGVudHJ5IHBlciBVVEMgZGF0ZSwgb2xkZXN0IGZpcnN0LiAqL1xuZnVuY3Rpb24gYWxsRGF5cygpOiBEYXlbXSB7XG4gIGNvbnN0IG0gPSBuZXcgTWFwKHN0YXRlLmhpc3RvcnkubWFwKChkKSA9PiBbZC5kYXRlLCBkLmRvY10pKTtcbiAgaWYgKHR5cGVvZiBzdGF0ZS5kYXRhPy5nZW5lcmF0ZWRBdCA9PT0gXCJzdHJpbmdcIikgbS5zZXQoc3RhdGUuZGF0YS5nZW5lcmF0ZWRBdC5zbGljZSgwLCAxMCksIHN0YXRlLmRhdGEpO1xuICByZXR1cm4gWy4uLm0uZW50cmllcygpXS5zb3J0KChbYV0sIFtiXSkgPT4gKGEgPCBiID8gLTEgOiAxKSkubWFwKChbZGF0ZSwgZG9jXSkgPT4gKHsgZGF0ZSwgZG9jIH0pKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBmZXRjaGluZyAtLS0tLS0tLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIGF3c0FyZ3MoYXBpOiBQbHVnaW5BcGksIGFyZ3M6IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBjb25zdCBzID0gYXdhaXQgYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKTtcbiAgY29uc3Qgb3V0ID0gWy4uLmFyZ3MsIFwiLS1jbGktY29ubmVjdC10aW1lb3V0XCIsIFwiMTBcIiwgXCItLWNsaS1yZWFkLXRpbWVvdXRcIiwgXCIxNVwiXTtcbiAgaWYgKHMuYXdzUHJvZmlsZSkgb3V0LnB1c2goXCItLXByb2ZpbGVcIiwgcy5hd3NQcm9maWxlKTtcbiAgcmV0dXJuIG91dDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYXdzKGFwaTogUGx1Z2luQXBpLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGFwaS5zaGVsbC5leGVjKFwiYXdzXCIsIGF3YWl0IGF3c0FyZ3MoYXBpLCBhcmdzKSk7XG4gIGlmIChyZXMuY29kZSAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKHJlcy5zdGRlcnIudHJpbSgpIHx8IGBhd3MgZXhpdGVkIHdpdGggY29kZSAke3Jlcy5jb2RlfWApO1xuICByZXR1cm4gcmVzLnN0ZG91dDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEhpc3RvcnkoYXBpOiBQbHVnaW5BcGkpIHtcbiAgY29uc3QgZW50cmllcyA9IGF3YWl0IGFwaS5mcy5saXN0RGlyKEhJU1RPUllfRElSKTtcbiAgY29uc3QgZmlsZXMgPSBlbnRyaWVzXG4gICAgLmZpbHRlcigoZSkgPT4gIWUuaXNEaXIgJiYgL15cXGR7NH0tXFxkezJ9LVxcZHsyfVxcLmpzb24kLy50ZXN0KGUubmFtZSkpXG4gICAgLm1hcCgoZSkgPT4gZS5uYW1lKVxuICAgIC5zb3J0KClcbiAgICAuc2xpY2UoLU1BWF9EQVlTKTtcbiAgY29uc3QgZG9jcyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgIGZpbGVzLm1hcChhc3luYyAoZikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYXdhaXQgYXBpLmZzLnJlYWRUZXh0RmlsZShgJHtISVNUT1JZX0RJUn0vJHtmfWApKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9KSxcbiAgKTtcbiAgc2V0U3RhdGUoeyBoaXN0b3J5OiBmaWxlcy5tYXAoKGYsIGkpID0+ICh7IGRhdGU6IGYuc2xpY2UoMCwgMTApLCBkb2M6IGRvY3NbaV0gfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzeW5jSGlzdG9yeShhcGk6IFBsdWdpbkFwaSwgYnVja2V0OiBzdHJpbmcpIHtcbiAgY29uc3Qgcm9vdCA9IChhd2FpdCBhcGkuZnMuZ2V0Um9vdFBhdGgoKSkucmVwbGFjZSgvW1xcXFwvXSskLywgXCJcIik7XG4gIGF3YWl0IGF3cyhhcGksIFtcInMzXCIsIFwic3luY1wiLCBgczM6Ly8ke2J1Y2tldH0vJHtISVNUT1JZX0RJUn0vYCwgYCR7cm9vdH0vJHtISVNUT1JZX0RJUn1gLCBcIi0tb25seS1zaG93LWVycm9yc1wiXSk7XG4gIGF3YWl0IGxvYWRIaXN0b3J5KGFwaSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2goYXBpOiBQbHVnaW5BcGksIHNpZ25hbD86IEFib3J0U2lnbmFsKSB7XG4gIGlmIChzdGF0ZS5sb2FkaW5nKSByZXR1cm47XG4gIHNldFN0YXRlKHsgbG9hZGluZzogdHJ1ZSB9KTtcbiAgY29uc3Qgc2V0SWNvbiA9IChjOiBTdGF0dXNDb2xvciwgdGlwPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKHNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhcGkuc3RhdHVzSWNvbi5zZXQoYywgdGlwKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGRlYWN0aXZhdGVkICovXG4gICAgfVxuICB9O1xuICBjb25zdCBsb2cgPSAobGV2ZWw6IFwid2FyblwiIHwgXCJlcnJvclwiLCBtc2c6IHN0cmluZykgPT4ge1xuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXBpLmxvZ1tsZXZlbF0oYCR7TkFNRX06ICR7bXNnfWApO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogZGVhY3RpdmF0ZWQgKi9cbiAgICB9XG4gIH07XG4gIHRyeSB7XG4gICAgY29uc3QgYnVja2V0ID0gKGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCkpLmJ1Y2tldCB8fCBERUZBVUxUX0JVQ0tFVDtcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcImNwXCIsIGBzMzovLyR7YnVja2V0fS9tZXRyaWNzLmpzb25gLCBcIi1cIl0pKTtcbiAgICBhd2FpdCBhcGkuc3RvcmFnZS5zZXQoQ0FDSEVfS0VZLCBkYXRhKTtcbiAgICBzZXRTdGF0ZSh7IGRhdGEsIGVycm9yOiBudWxsIH0pO1xuICAgIGxldCBzdGF0dXMgPSBkb2NTdGF0dXMoZGF0YSk7XG4gICAgbGV0IHRpcCA9IHN0YXR1cyA9PT0gXCJzdWNjZXNzXCIgPyBcIk1ldHJpY3MgdXAgdG8gZGF0ZVwiIDogc3RhdHVzID09PSBcImVycm9yXCIgPyBcIkFsYXJtcyBmaXJpbmcgb3IgTGFtYmRhIGVycm9yc1wiIDogXCJNZXRyaWNzIG5lZWQgYXR0ZW50aW9uXCI7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNIaXN0b3J5KGFwaSwgYnVja2V0KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zdCBtc2cgPSBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSk7XG4gICAgICBsb2coXCJ3YXJuXCIsIGBoaXN0b3J5IHN5bmMgZmFpbGVkOiAke21zZ31gKTtcbiAgICAgIHN0YXR1cyA9IHdvcnN0KFtzdGF0dXMsIFwid2FybmluZ1wiXSk7XG4gICAgICB0aXAgPSBgSGlzdG9yeSBzeW5jIGZhaWxlZDogJHttc2d9YDtcbiAgICB9XG4gICAgc2V0U3RhdGUoeyBsb2FkaW5nOiBmYWxzZSB9KTtcbiAgICAvLyBUaGUgaWNvbiBvbmx5IHNpZ25hbHMgcHJvYmxlbXM7IGFueXRoaW5nIHNob3J0IG9mIHdhcm5pbmcgc3RheXMgaWRsZSAoZGVmYXVsdCB0aW50KS5cbiAgICBzZXRJY29uKHN0YXR1cyA9PT0gXCJ3YXJuaW5nXCIgfHwgc3RhdHVzID09PSBcImVycm9yXCIgPyBzdGF0dXMgOiBcImlkbGVcIiwgdGlwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IGUgaW5zdGFuY2VvZiBFcnJvciA/IGUubWVzc2FnZSA6IFN0cmluZyhlKTtcbiAgICBzZXRTdGF0ZSh7IGVycm9yOiBtc2csIGxvYWRpbmc6IGZhbHNlIH0pO1xuICAgIHNldEljb24oXCJlcnJvclwiLCBtc2cpO1xuICAgIGxvZyhcImVycm9yXCIsIG1zZyk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlKGN0eDogUGx1Z2luQ29udGV4dCkge1xuICBjdHguYXBpLnN0YXR1c0ljb24uc2V0KFwiaWRsZVwiKTtcbiAgY29uc3QgcyA9IGF3YWl0IGN0eC5hcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpO1xuICBjb25zdCBtaW51dGVzID0gTWF0aC5tYXgoMSwgcy5yZWZyZXNoTWludXRlcyA/PyA2MCk7XG4gIGN0eC50aWNrLnJlZ2lzdGVyKCgpID0+IHJlZnJlc2goY3R4LmFwaSwgY3R4LnNpZ25hbCkpO1xuICBjdHgudGljay5zZXRJbnRlcnZhbChtaW51dGVzICogNjBfMDAwKTtcbiAgY3R4LmFwaS5sb2cuaW5mbyhgJHtOQU1FfSBhY3RpdmF0ZWRgKTtcbiAgdm9pZCBsb2FkSGlzdG9yeShjdHguYXBpKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICB2b2lkIHJlZnJlc2goY3R4LmFwaSwgY3R4LnNpZ25hbCk7XG59XG5cbi8vIC0tLS0tLS0tLS0gY2hhcnQgcHJpbWl0aXZlcyAtLS0tLS0tLS0tXG5cbmNvbnN0IENIQVJUX0hFSUdIVCA9IDE3MDtcblxuY29uc3Qgc2Nyb2xsYmFyU3R5bGUgPSAocDogUGFsZXR0ZSk6IENTU1Byb3BlcnRpZXMgPT4gKHsgc2Nyb2xsYmFyV2lkdGg6IFwidGhpblwiLCBzY3JvbGxiYXJDb2xvcjogYCR7cC5ib3JkZXJ9ICR7cC5zdXJmYWNlfWAgfSk7XG5cbmZ1bmN0aW9uIHVzZVdpZHRoKCkge1xuICBjb25zdCByZWYgPSB1c2VSZWY8SFRNTERpdkVsZW1lbnQ+KG51bGwpO1xuICBjb25zdCBbd2lkdGgsIHNldFdpZHRoXSA9IHVzZVN0YXRlKDApO1xuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGVsID0gcmVmLmN1cnJlbnQ7XG4gICAgaWYgKCFlbCkgcmV0dXJuO1xuICAgIGNvbnN0IHJvID0gbmV3IFJlc2l6ZU9ic2VydmVyKChbZV0pID0+IHNldFdpZHRoKGUuY29udGVudFJlY3Qud2lkdGgpKTtcbiAgICByby5vYnNlcnZlKGVsKTtcbiAgICByZXR1cm4gKCkgPT4gcm8uZGlzY29ubmVjdCgpO1xuICB9LCBbXSk7XG4gIHJldHVybiBbcmVmLCB3aWR0aF0gYXMgY29uc3Q7XG59XG5cbmZ1bmN0aW9uIG5pY2VNYXgodjogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKHYgPD0gMCkgcmV0dXJuIDE7XG4gIGNvbnN0IHAgPSAxMCAqKiBNYXRoLmZsb29yKE1hdGgubG9nMTAodikpO1xuICBjb25zdCBuID0gdiAvIHA7XG4gIHJldHVybiAobiA8PSAxID8gMSA6IG4gPD0gMiA/IDIgOiBuIDw9IDUgPyA1IDogMTApICogcDtcbn1cblxuZnVuY3Rpb24gVG9vbHRpcCh7IHAsIHgsIHksIGZsaXAsIGZpeGVkLCBjaGlsZHJlbiB9OiB7IHA6IFBhbGV0dGU7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBmbGlwOiBib29sZWFuOyBmaXhlZD86IGJvb2xlYW47IGNoaWxkcmVuOiBSZWFjdE5vZGUgfSkge1xuICByZXR1cm4gKFxuICAgIDxkaXZcbiAgICAgIHN0eWxlPXt7XG4gICAgICAgIHBvc2l0aW9uOiBmaXhlZCA/IFwiZml4ZWRcIiA6IFwiYWJzb2x1dGVcIixcbiAgICAgICAgbGVmdDogeCxcbiAgICAgICAgdG9wOiB5LFxuICAgICAgICB0cmFuc2Zvcm06IGZsaXAgPyBcInRyYW5zbGF0ZVgoLTEwMCUpXCIgOiB1bmRlZmluZWQsXG4gICAgICAgIGJhY2tncm91bmQ6IHAuYmFja2dyb3VuZCxcbiAgICAgICAgY29sb3I6IHAudGV4dCxcbiAgICAgICAgYm9yZGVyOiBgMXB4IHNvbGlkICR7cC5ib3JkZXJ9YCxcbiAgICAgICAgYm9yZGVyUmFkaXVzOiA0LFxuICAgICAgICBwYWRkaW5nOiBcIjRweCA4cHhcIixcbiAgICAgICAgZm9udFNpemU6IDEyLFxuICAgICAgICBsaW5lSGVpZ2h0OiBcIjE4cHhcIixcbiAgICAgICAgd2hpdGVTcGFjZTogXCJub3dyYXBcIixcbiAgICAgICAgcG9pbnRlckV2ZW50czogXCJub25lXCIsXG4gICAgICAgIHpJbmRleDogMSxcbiAgICAgIH19XG4gICAgPlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5pbnRlcmZhY2UgU2VyaWVzIHtcbiAgbmFtZTogc3RyaW5nO1xuICBjb2xvcjogc3RyaW5nO1xuICB2YWx1ZXM6IChudW1iZXIgfCBudWxsKVtdO1xufVxuXG4vKiogTGluZSBjaGFydCBvdmVyIHRpbWUgb24gb25lIHNoYXJlZCBheGlzLiBVbmtub3duIChudWxsKSBwb2ludHMgYnJlYWsgYSBsaW5lIGluc3RlYWQgb2YgZHJvcHBpbmcgdG8gemVybzsgYSBsb25lIHNlcmllcyBhbHNvIGdldHMgYW4gYXJlYSBmaWxsLiAqL1xuZnVuY3Rpb24gTGluZUNoYXJ0KHsgYXBpLCBsYWJlbHMsIHNlcmllcywgZm9ybWF0LCBoZWlnaHQgPSBDSEFSVF9IRUlHSFQgfTogeyBhcGk6IFBsdWdpbkFwaTsgbGFiZWxzOiBzdHJpbmdbXTsgc2VyaWVzOiBTZXJpZXNbXTsgZm9ybWF0OiAobjogbnVtYmVyKSA9PiBzdHJpbmc7IGhlaWdodD86IG51bWJlciB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW3JlZiwgd2lkdGhdID0gdXNlV2lkdGgoKTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTxudW1iZXIgfCBudWxsPihudWxsKTtcbiAgY29uc3QgTCA9IDU2LFxuICAgIFIgPSAxMixcbiAgICBUID0gMTAsXG4gICAgQiA9IDIyO1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgd2lkdGggLSBMIC0gUik7XG4gIGNvbnN0IGggPSBoZWlnaHQgLSBUIC0gQjtcbiAgY29uc3QgbiA9IGxhYmVscy5sZW5ndGg7XG4gIGNvbnN0IG1heCA9IG5pY2VNYXgoTWF0aC5tYXgoMCwgLi4uc2VyaWVzLmZsYXRNYXAoKHMpID0+IHMudmFsdWVzLm1hcCgodikgPT4gdiA/PyAwKSkpKTtcbiAgY29uc3QgeCA9IChpOiBudW1iZXIpID0+IEwgKyAobiA8PSAxID8gdyAvIDIgOiAoaSAqIHcpIC8gKG4gLSAxKSk7XG4gIGNvbnN0IHkgPSAodjogbnVtYmVyKSA9PiBUICsgaCAtICh2IC8gbWF4KSAqIGg7XG5cbiAgY29uc3QgcnVuc09mID0gKHZhbHVlczogKG51bWJlciB8IG51bGwpW10pID0+IHtcbiAgICBjb25zdCBydW5zOiBudW1iZXJbXVtdID0gW107XG4gICAgbGV0IGN1cjogbnVtYmVyW10gPSBbXTtcbiAgICB2YWx1ZXMuZm9yRWFjaCgodiwgaSkgPT4ge1xuICAgICAgaWYgKHYgPT09IG51bGwpIHtcbiAgICAgICAgaWYgKGN1ci5sZW5ndGgpIHJ1bnMucHVzaChjdXIpO1xuICAgICAgICBjdXIgPSBbXTtcbiAgICAgIH0gZWxzZSBjdXIucHVzaChpKTtcbiAgICB9KTtcbiAgICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gICAgcmV0dXJuIHJ1bnM7XG4gIH07XG5cbiAgY29uc3Qgb25Nb3ZlID0gKGU6IE1vdXNlRXZlbnQ8U1ZHUmVjdEVsZW1lbnQ+KSA9PiB7XG4gICAgY29uc3QgciA9IGUuY3VycmVudFRhcmdldC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBjb25zdCBpID0gbiA8PSAxID8gMCA6IE1hdGgucm91bmQoKChlLmNsaWVudFggLSByLmxlZnQpIC8gci53aWR0aCkgKiAobiAtIDEpKTtcbiAgICBzZXRIb3ZlcihNYXRoLm1pbihuIC0gMSwgTWF0aC5tYXgoMCwgaSkpKTtcbiAgfTtcblxuICBjb25zdCB4TGFiZWxzID0gbiA8PSAxID8gWzBdIDogbiA9PT0gMiA/IFswLCAxXSA6IFswLCBNYXRoLmZsb29yKChuIC0gMSkgLyAyKSwgbiAtIDFdO1xuICBjb25zdCBhbmNob3IgPSAoaTogbnVtYmVyKSA9PiAobiA8PSAxID8gXCJtaWRkbGVcIiA6IGkgPT09IDAgPyBcInN0YXJ0XCIgOiBpID09PSBuIC0gMSA/IFwiZW5kXCIgOiBcIm1pZGRsZVwiKTtcbiAgY29uc3QgZmxpcCA9IGhvdmVyICE9PSBudWxsICYmIHgoaG92ZXIpID4gd2lkdGggLSAxNjA7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHJlZj17cmVmfSBzdHlsZT17eyBwb3NpdGlvbjogXCJyZWxhdGl2ZVwiLCBoZWlnaHQgfX0+XG4gICAgICB7d2lkdGggPiAwICYmIChcbiAgICAgICAgPHN2ZyB3aWR0aD17d2lkdGh9IGhlaWdodD17aGVpZ2h0fSBzdHlsZT17eyBkaXNwbGF5OiBcImJsb2NrXCIsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICB7WzAsIDAuNSwgMV0ubWFwKChmKSA9PiAoXG4gICAgICAgICAgICA8ZyBrZXk9e2Z9PlxuICAgICAgICAgICAgICA8bGluZSB4MT17TH0geDI9e0wgKyB3fSB5MT17eShtYXggKiBmKX0geTI9e3kobWF4ICogZil9IHN0cm9rZT17cC5ib3JkZXJ9IHN0cm9rZVdpZHRoPXsxfSBzdHJva2VEYXNoYXJyYXk9e2YgPyBcIjIgNFwiIDogdW5kZWZpbmVkfSAvPlxuICAgICAgICAgICAgICA8dGV4dCB4PXtMIC0gNn0geT17eShtYXggKiBmKX0gZHk9XCIwLjMyZW1cIiB0ZXh0QW5jaG9yPVwiZW5kXCIgZmlsbD17cC50ZXh0TXV0ZWR9PlxuICAgICAgICAgICAgICAgIHtmb3JtYXQobWF4ICogZil9XG4gICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICApKX1cbiAgICAgICAgICB7eExhYmVscy5tYXAoKGkpID0+IChcbiAgICAgICAgICAgIDx0ZXh0IGtleT17aX0geD17eChpKX0geT17aGVpZ2h0IC0gNH0gdGV4dEFuY2hvcj17YW5jaG9yKGkpfSBmaWxsPXtwLnRleHRNdXRlZH0+XG4gICAgICAgICAgICAgIHtsYWJlbHNbaV19XG4gICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgKSl9XG4gICAgICAgICAge3Nlcmllcy5tYXAoKHMpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJ1bnMgPSBydW5zT2Yocy52YWx1ZXMpO1xuICAgICAgICAgICAgY29uc3QgbGluZSA9IChydW46IG51bWJlcltdKSA9PiBydW4ubWFwKChpLCBrKSA9PiBgJHtrID8gXCJMXCIgOiBcIk1cIn0ke3goaSl9LCR7eShzLnZhbHVlc1tpXSBhcyBudW1iZXIpfWApLmpvaW4oXCJcIik7XG4gICAgICAgICAgICBjb25zdCBsYXN0S25vd24gPSBbLi4ucy52YWx1ZXMua2V5cygpXS5yZXZlcnNlKCkuZmluZCgoaSkgPT4gcy52YWx1ZXNbaV0gIT09IG51bGwpO1xuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgPGcga2V5PXtzLm5hbWV9PlxuICAgICAgICAgICAgICAgIHtydW5zLm1hcCgocnVuKSA9PlxuICAgICAgICAgICAgICAgICAgcnVuLmxlbmd0aCA+IDEgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxnIGtleT17cnVuWzBdfT5cbiAgICAgICAgICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA9PT0gMSAmJiA8cGF0aCBkPXtgJHtsaW5lKHJ1bil9TCR7eChydW5bcnVuLmxlbmd0aCAtIDFdKX0sJHt5KDApfUwke3gocnVuWzBdKX0sJHt5KDApfVpgfSBmaWxsPXtzLmNvbG9yfSBmaWxsT3BhY2l0eT17MC4xMn0gLz59XG4gICAgICAgICAgICAgICAgICAgICAgPHBhdGggZD17bGluZShydW4pfSBmaWxsPVwibm9uZVwiIHN0cm9rZT17cy5jb2xvcn0gc3Ryb2tlV2lkdGg9ezJ9IHN0cm9rZUxpbmVqb2luPVwicm91bmRcIiBzdHJva2VMaW5lY2FwPVwicm91bmRcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICA8Y2lyY2xlIGtleT17cnVuWzBdfSBjeD17eChydW5bMF0pfSBjeT17eShzLnZhbHVlc1tydW5bMF1dIGFzIG51bWJlcil9IHI9ezN9IGZpbGw9e3MuY29sb3J9IC8+XG4gICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAge2xhc3RLbm93biAhPT0gdW5kZWZpbmVkICYmIGhvdmVyID09PSBudWxsICYmIChcbiAgICAgICAgICAgICAgICAgIDxjaXJjbGUgY3g9e3gobGFzdEtub3duKX0gY3k9e3kocy52YWx1ZXNbbGFzdEtub3duXSBhcyBudW1iZXIpfSByPXszLjV9IGZpbGw9e3MuY29sb3J9IHN0cm9rZT17cC5zdXJmYWNlfSBzdHJva2VXaWR0aD17Mn0gLz5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiBzLnZhbHVlc1tob3Zlcl0gIT09IG51bGwgJiYgKFxuICAgICAgICAgICAgICAgICAgPGNpcmNsZSBjeD17eChob3Zlcil9IGN5PXt5KHMudmFsdWVzW2hvdmVyXSBhcyBudW1iZXIpfSByPXs0LjV9IGZpbGw9e3MuY29sb3J9IHN0cm9rZT17cC5zdXJmYWNlfSBzdHJva2VXaWR0aD17Mn0gcG9pbnRlckV2ZW50cz1cIm5vbmVcIiAvPlxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSl9XG4gICAgICAgICAge2hvdmVyICE9PSBudWxsICYmIDxsaW5lIHgxPXt4KGhvdmVyKX0geDI9e3goaG92ZXIpfSB5MT17VH0geTI9e1QgKyBofSBzdHJva2U9e3AudGV4dE11dGVkfSBzdHJva2VXaWR0aD17MX0gcG9pbnRlckV2ZW50cz1cIm5vbmVcIiAvPn1cbiAgICAgICAgICA8cmVjdCB4PXtMfSB5PXswfSB3aWR0aD17d30gaGVpZ2h0PXtoZWlnaHR9IGZpbGw9XCJ0cmFuc3BhcmVudFwiIG9uTW91c2VNb3ZlPXtvbk1vdmV9IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9IC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICAgKX1cbiAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e3goaG92ZXIpICsgKGZsaXAgPyAtMTAgOiAxMCl9IHk9e1R9IGZsaXA9e2ZsaXB9PlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19PntsYWJlbHNbaG92ZXJdfTwvZGl2PlxuICAgICAgICAgIHtzZXJpZXMubWFwKChzKSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17cy5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiA2IH19PlxuICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA+IDEgJiYgPHNwYW4gc3R5bGU9e3sgd2lkdGg6IDgsIGhlaWdodDogOCwgYm9yZGVyUmFkaXVzOiAyLCBiYWNrZ3JvdW5kOiBzLmNvbG9yIH19IC8+fVxuICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA+IDEgJiYgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19PntzLm5hbWV9PC9zcGFuPn1cbiAgICAgICAgICAgICAgPHNwYW4+e3MudmFsdWVzW2hvdmVyXSA9PT0gbnVsbCA/IFwiVW5rbm93blwiIDogZm9ybWF0KHMudmFsdWVzW2hvdmVyXSBhcyBudW1iZXIpfTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICkpfVxuICAgICAgICA8L1Rvb2x0aXA+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5pbnRlcmZhY2UgU2VnIHtcbiAgbmFtZTogc3RyaW5nO1xuICB2YWx1ZTogbnVtYmVyO1xuICBjb2xvcjogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgQmFyUm93IHtcbiAgbGFiZWw6IHN0cmluZztcbiAgc2VnbWVudHM6IFNlZ1tdO1xuICB2YWx1ZVRleHQ6IHN0cmluZztcbiAgdGlwOiBzdHJpbmdbXTtcbn1cblxuZnVuY3Rpb24gTGVnZW5kKHsgYXBpLCBpdGVtcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBpdGVtczogeyBuYW1lOiBzdHJpbmc7IGNvbG9yOiBzdHJpbmcgfVtdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGdhcDogMTYsIGZsZXhXcmFwOiBcIndyYXBcIiwgZm9udFNpemU6IDEyLCBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+XG4gICAgICB7aXRlbXMubWFwKChpdCkgPT4gKFxuICAgICAgICA8c3BhbiBrZXk9e2l0Lm5hbWV9IHN0eWxlPXt7IGRpc3BsYXk6IFwiaW5saW5lLWZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiA2IH19PlxuICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IHdpZHRoOiAxMCwgaGVpZ2h0OiAxMCwgYm9yZGVyUmFkaXVzOiAyLCBiYWNrZ3JvdW5kOiBpdC5jb2xvciB9fSAvPlxuICAgICAgICAgIHtpdC5uYW1lfVxuICAgICAgICA8L3NwYW4+XG4gICAgICApKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLyoqIEhvcml6b250YWwgKG9wdGlvbmFsbHkgc3RhY2tlZCkgYmFycyBzaGFyaW5nIG9uZSBzY2FsZSwgdmFsdWUgbGFiZWxzIGF0IHRoZSBlbmQuIFNjcm9sbHMgcGFzdCBCQVJfTElTVF9IRUlHSFQuICovXG5mdW5jdGlvbiBCYXJMaXN0KHsgYXBpLCByb3dzIH06IHsgYXBpOiBQbHVnaW5BcGk7IHJvd3M6IEJhclJvd1tdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBbaG92ZXIsIHNldEhvdmVyXSA9IHVzZVN0YXRlPHsgaTogbnVtYmVyOyB4OiBudW1iZXI7IHk6IG51bWJlciB9IHwgbnVsbD4obnVsbCk7XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KDAsIC4uLnJvd3MubWFwKChyKSA9PiByLnNlZ21lbnRzLnJlZHVjZSgoYSwgcykgPT4gYSArIHMudmFsdWUsIDApKSkgfHwgMTtcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICBjb25zdCBmbGlwID0gaG92ZXIgIT09IG51bGwgJiYgaG92ZXIueCA+IHdpbmRvdy5pbm5lcldpZHRoIC0gMjAwO1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgLi4uc2Nyb2xsYmFyU3R5bGUocCksIG1heEhlaWdodDogQ0hBUlRfSEVJR0hULCBvdmVyZmxvd1k6IFwiYXV0b1wiLCBvdmVyZmxvd1g6IFwiaGlkZGVuXCIsIHBhZGRpbmdSaWdodDogR0FQIH19IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJtaW5tYXgoMCwgbWF4LWNvbnRlbnQpIDFmciBtYXgtY29udGVudFwiLCBnYXA6IFwiMnB4IDEycHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZm9udFNpemU6IDE0IH19PlxuICAgICAgICB7cm93cy5tYXAoKHIsIGkpID0+IHtcbiAgICAgICAgICBjb25zdCB0b3RhbCA9IHIuc2VnbWVudHMucmVkdWNlKChhLCBzKSA9PiBhICsgcy52YWx1ZSwgMCk7XG4gICAgICAgICAgY29uc3QgaG90ID0gaG92ZXI/LmkgPT09IGk7XG4gICAgICAgICAgY29uc3QgY2VsbDogQ1NTUHJvcGVydGllcyA9IHsgYmFja2dyb3VuZDogaG90ID8gcC5zdXJmYWNlSG92ZXIgOiB1bmRlZmluZWQsIHBhZGRpbmc6IFwiMnB4IDBcIiB9O1xuICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17ci5sYWJlbH0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19IG9uTW91c2VNb3ZlPXsoZSkgPT4gc2V0SG92ZXIoeyBpLCB4OiBlLmNsaWVudFgsIHk6IGUuY2xpZW50WSB9KX0+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIGNvbG9yOiBob3QgPyBwLmFjY2VudCA6IHAudGV4dCwgbWF4V2lkdGg6IDIyMCwgb3ZlcmZsb3c6IFwiaGlkZGVuXCIsIHRleHRPdmVyZmxvdzogXCJlbGxpcHNpc1wiLCB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiIH19IHRpdGxlPXtyLmxhYmVsfT5cbiAgICAgICAgICAgICAgICB7ci5sYWJlbH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLmNlbGwsIGRpc3BsYXk6IFwiZmxleFwiLCBoZWlnaHQ6IDIyLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiIH19PlxuICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIHdpZHRoOiBgJHsodG90YWwgLyBtYXgpICogMTAwfSVgLCBoZWlnaHQ6IDEyLCBnYXA6IDEsIG1pbldpZHRoOiB0b3RhbCA+IDAgPyAyIDogMCB9fT5cbiAgICAgICAgICAgICAgICAgIHtyLnNlZ21lbnRzXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKHMpID0+IHMudmFsdWUgPiAwKVxuICAgICAgICAgICAgICAgICAgICAubWFwKChzLCBrLCBhcnIpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXk9e3MubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZsZXg6IHMudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHMuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJvcmRlclJhZGl1czogYCR7ayA9PT0gMCA/IDIgOiAwfXB4ICR7ayA9PT0gYXJyLmxlbmd0aCAtIDEgPyAyIDogMH1weCAke2sgPT09IGFyci5sZW5ndGggLSAxID8gMiA6IDB9cHggJHtrID09PSAwID8gMiA6IDB9cHhgLFxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIHRleHRBbGlnbjogXCJyaWdodFwiLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIgfX0+e3IudmFsdWVUZXh0fTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICk7XG4gICAgICAgIH0pfVxuICAgICAgPC9kaXY+XG4gICAgICB7aG92ZXIgJiYgcm93c1tob3Zlci5pXSAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e2hvdmVyLnggKyAoZmxpcCA/IC0xMiA6IDEyKX0geT17aG92ZXIueSArIDEyfSBmbGlwPXtmbGlwfSBmaXhlZD5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRXZWlnaHQ6IDYwMCB9fT57cm93c1tob3Zlci5pXS5sYWJlbH08L2Rpdj5cbiAgICAgICAgICB7cm93c1tob3Zlci5pXS50aXAubWFwKCh0KSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17dH0+e3R9PC9kaXY+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvVG9vbHRpcD5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbi8qKiBgdG9uZWAgY29sb3JzIHRoZSB2YWx1ZSBhbmQgYm9yZGVyIChmaXhlZCBydWxlcyk7IGBvdXRsaW5lYCBvbmx5IGNvbG9ycyB0aGUgYm9yZGVyIChhdmVyYWdlIGRldmlhdGlvbikuICovXG5mdW5jdGlvbiBUaWxlKHtcbiAgYXBpLFxuICBsYWJlbCxcbiAgdmFsdWUsXG4gIGRlbHRhLFxuICB0b25lLFxuICBvdXRsaW5lLFxufToge1xuICBhcGk6IFBsdWdpbkFwaTtcbiAgbGFiZWw6IHN0cmluZztcbiAgdmFsdWU6IHN0cmluZztcbiAgZGVsdGE/OiBzdHJpbmdbXTtcbiAgdG9uZT86IFN0YXR1c0NvbG9yIHwgbnVsbDtcbiAgb3V0bGluZT86IFN0YXR1c0NvbG9yIHwgbnVsbDtcbn0pIHtcbiAgY29uc3QgYm9yZGVyID0gd29yc3RUb25lKFt0b25lLCBvdXRsaW5lXSk7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBtaW5XaWR0aDogMCxcbiAgICAgICAgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIixcbiAgICAgICAgYmFja2dyb3VuZDogcC5zdXJmYWNlLFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHtib3JkZXIgPyBwLnN0YXR1c1tib3JkZXJdIDogcC5ib3JkZXJ9YCxcbiAgICAgICAgYm9yZGVyUmFkaXVzOiA2LFxuICAgICAgICBwYWRkaW5nOiBcIjEwcHggMTJweFwiLFxuICAgICAgICBkaXNwbGF5OiBcImZsZXhcIixcbiAgICAgICAgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIixcbiAgICAgICAgZ2FwOiAyLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT57bGFiZWx9PC9zcGFuPlxuICAgICAgPHNwYW4gc3R5bGU9e3sgZm9udFNpemU6IDIyLCBsaW5lSGVpZ2h0OiBcIjMwcHhcIiwgZm9udFdlaWdodDogNjAwLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIsIGNvbG9yOiB0b25lID8gcC5zdGF0dXNbdG9uZV0gOiB1bmRlZmluZWQgfX0+e3ZhbHVlfTwvc3Bhbj5cbiAgICAgIHtkZWx0YT8ubWFwKChkKSA9PiAoXG4gICAgICAgIDxzcGFuIGtleT17ZH0gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAge2R9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICkpfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogV3JhcHBpbmcgcm93IG9mIGNhcmRzOiBldmVyeSByb3cgaXMgZmlsbGVkIGVkZ2UgdG8gZWRnZSBhbmQgaXRzIGNhcmRzIHNoYXJlIG9uZSBoZWlnaHQuICovXG5jb25zdCBUSUxFX01JTiA9IDEzMDtcbmNvbnN0IEdBUCA9IDEyO1xuXG4vKiogU3RhdCB0aWxlcyBpbiBlcXVhbCBjb2x1bW5zOyB3aGVuIHRoZXkgZG9uJ3QgZml0IG9uIG9uZSByb3cgdGhleSBzcGxpdCBpbnRvIGJhbGFuY2VkIHJvd3MgKDYgLT4gMyszIC0+IDIrMisyKS4gKi9cbmZ1bmN0aW9uIFRpbGVSb3coeyBjaGlsZHJlbiB9OiB7IGNoaWxkcmVuOiBSZWFjdE5vZGVbXSB9KSB7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IG4gPSBNYXRoLm1heCgxLCBjaGlsZHJlbi5sZW5ndGgpO1xuICBjb25zdCBmaXQgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKCh3aWR0aCArIEdBUCkgLyAoVElMRV9NSU4gKyBHQVApKSk7XG4gIGNvbnN0IGNvbHMgPSB3aWR0aCA/IE1hdGguY2VpbChuIC8gTWF0aC5jZWlsKG4gLyBNYXRoLm1pbihmaXQsIG4pKSkgOiBuO1xuICByZXR1cm4gKFxuICAgIDxkaXYgcmVmPXtyZWZ9IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBgcmVwZWF0KCR7Y29sc30sIG1pbm1heCgwLCAxZnIpKWAsIGdhcDogR0FQIH19PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5jb25zdCBGbG93ID0gKHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pID0+IDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhXcmFwOiBcIndyYXBcIiwgYWxpZ25JdGVtczogXCJzdHJldGNoXCIsIGdhcDogMTIgfX0+e2NoaWxkcmVufTwvZGl2PjtcblxuLyoqIE9ubHkgd2FybmluZy9lcnJvciB0b25lcyBvdXRsaW5lIGEgY2FyZDsgYW55dGhpbmcgZWxzZSBrZWVwcyB0aGUgbm9ybWFsIGJvcmRlci4gKi9cbmNvbnN0IGFsZXJ0VG9uZSA9IChzOiBTdGF0dXNDb2xvciB8IG51bGwgfCB1bmRlZmluZWQpOiBTdGF0dXNDb2xvciB8IG51bGwgPT4gKHMgPT09IFwid2FybmluZ1wiIHx8IHMgPT09IFwiZXJyb3JcIiA/IHMgOiBudWxsKTtcblxuZnVuY3Rpb24gU2VjdGlvbih7IGFwaSwgdGl0bGUsIGV4dHJhLCB0b25lLCBjaGlsZHJlbiB9OiB7IGFwaTogUGx1Z2luQXBpOyB0aXRsZTogc3RyaW5nOyBleHRyYT86IFJlYWN0Tm9kZTsgdG9uZT86IFN0YXR1c0NvbG9yIHwgbnVsbDsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgdCA9IGFsZXJ0VG9uZSh0b25lKTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBmbGV4OiBcIjEgMSAzMjBweFwiLFxuICAgICAgICBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3QgPyBwLnN0YXR1c1t0XSA6IHAuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNixcbiAgICAgICAgcGFkZGluZzogMTIsXG4gICAgICAgIGRpc3BsYXk6IFwiZmxleFwiLFxuICAgICAgICBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLFxuICAgICAgICBnYXA6IDgsXG4gICAgICAgIG1pbldpZHRoOiAwLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBmbGV4V3JhcDogXCJ3cmFwXCIgfX0+XG4gICAgICAgIDxzdHJvbmcgc3R5bGU9e3sgZmxleDogMSB9fT57dGl0bGV9PC9zdHJvbmc+XG4gICAgICAgIHtleHRyYX1cbiAgICAgIDwvZGl2PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1ldHJpYyB2aWV3cyAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBUcmVuZCB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGtleTogc3RyaW5nO1xuICBnZXQ6IChkb2M6IEpzb24pID0+IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ7XG59XG5cbi8qKiBUaWxlIHZhbHVlIGZyb20gdGhlIGxhdGVzdCBkb2MsIGRlbHRhIGFnYWluc3QgdGhlIHByZXZpb3VzIGRheSBpbiBoaXN0b3J5LiAqL1xuZnVuY3Rpb24gdHJlbmRUaWxlKGFwaTogUGx1Z2luQXBpLCBkYXlzOiBEYXlbXSwgdDogVHJlbmQpIHtcbiAgY29uc3QgdmFscyA9IGRheXMubWFwKChkKSA9PiB0LmdldChkLmRvYykpO1xuICBjb25zdCBjdXIgPSB2YWxzW3ZhbHMubGVuZ3RoIC0gMV07XG4gIGNvbnN0IHByZXYgPSB2YWxzLmxlbmd0aCA+IDEgPyB2YWxzW3ZhbHMubGVuZ3RoIC0gMl0gOiB1bmRlZmluZWQ7XG4gIGxldCBkZWx0YTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY3VyID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBwcmV2ID09PSBcIm51bWJlclwiKSB7XG4gICAgY29uc3QgZCA9IGN1ciAtIHByZXY7XG4gICAgY29uc3QgYWJzID0gTU9ORVlfS0VZLnRlc3QodC5rZXkpID8gbW9uZXkuZm9ybWF0KE1hdGguYWJzKGQpKSA6IE1hdGguYWJzKGQpLnRvTG9jYWxlU3RyaW5nKCk7XG4gICAgZGVsdGEgPSBgJHtkID4gMCA/IFwiK1wiIDogZCA8IDAgPyBcIi1cIiA6IFwiXHUwMEIxXCJ9JHthYnN9IHZzICR7c2hvcnREYXRlKGRheXNbZGF5cy5sZW5ndGggLSAyXS5kYXRlKX1gO1xuICB9XG4gIGNvbnN0IGF2ZyA9IGF2ZXJhZ2VDaGVjayh2YWxzKTtcbiAgY29uc3QgYXZnVGV4dCA9IGF2ZyA/IGAke2F2Zy5jaGFuZ2UgPj0gMCA/IFwiK1wiIDogXCItXCJ9JHtNYXRoLnJvdW5kKE1hdGguYWJzKGF2Zy5jaGFuZ2UpICogMTAwKX0lIHZzICR7YXhpc0ZtdCh0LmtleSkoYXZnLmF2Zyl9IGF2Z2AgOiBudWxsO1xuICByZXR1cm4gKFxuICAgIDxUaWxlXG4gICAgICBrZXk9e3QudGl0bGV9XG4gICAgICBhcGk9e2FwaX1cbiAgICAgIGxhYmVsPXt0LnRpdGxlfVxuICAgICAgdmFsdWU9e2ZtdChjdXIsIHQua2V5KX1cbiAgICAgIGRlbHRhPXtbZGVsdGEsIGF2Z1RleHRdLmZpbHRlcigoZCk6IGQgaXMgc3RyaW5nID0+ICEhZCl9XG4gICAgICB0b25lPXt2YWx1ZVRvbmUodC5rZXksIGN1cil9XG4gICAgICBvdXRsaW5lPXthdmc/LnRvbmV9XG4gICAgLz5cbiAgKTtcbn1cblxuY29uc3QgQVZHX01JTl9EQVlTID0gMztcbmNvbnN0IEFWR19XQVJOSU5HID0gMTsgLy8gMTAwJSBhd2F5IGZyb20gdGhlIGF2ZXJhZ2VcbmNvbnN0IEFWR19FUlJPUiA9IDU7IC8vIDUwMCUgYXdheSBmcm9tIHRoZSBhdmVyYWdlXG5cbi8qKlxuICogQ29tcGFyZXMgdGhlIGxhdGVzdCB2YWx1ZSB3aXRoIHRoZSBhdmVyYWdlIG9mIGV2ZXJ5IGVhcmxpZXIgZGF5IGluIGhpc3RvcnkuXG4gKiBOdWxsIHVudGlsIHRoZXJlIGFyZSBBVkdfTUlOX0RBWVMgZWFybGllciBrbm93biB2YWx1ZXMsIG9yIHdoZW4gdGhlIGF2ZXJhZ2UgaXMgMCAobm8gcGVyY2VudGFnZSBleGlzdHMpLlxuICovXG5mdW5jdGlvbiBhdmVyYWdlQ2hlY2sodmFsczogKG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQpW10pOiB7IGF2ZzogbnVtYmVyOyBjaGFuZ2U6IG51bWJlcjsgdG9uZTogU3RhdHVzQ29sb3IgfCBudWxsIH0gfCBudWxsIHtcbiAgY29uc3QgY3VyID0gdmFsc1t2YWxzLmxlbmd0aCAtIDFdO1xuICBjb25zdCBwcmV2ID0gdmFscy5zbGljZSgwLCAtMSkuZmlsdGVyKCh2KTogdiBpcyBudW1iZXIgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpO1xuICBpZiAodHlwZW9mIGN1ciAhPT0gXCJudW1iZXJcIiB8fCBwcmV2Lmxlbmd0aCA8IEFWR19NSU5fREFZUykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGF2ZyA9IHByZXYucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgLyBwcmV2Lmxlbmd0aDtcbiAgaWYgKGF2ZyA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGNoYW5nZSA9IChjdXIgLSBhdmcpIC8gTWF0aC5hYnMoYXZnKTtcbiAgY29uc3QgZGV2ID0gTWF0aC5hYnMoY2hhbmdlKTtcbiAgcmV0dXJuIHsgYXZnLCBjaGFuZ2UsIHRvbmU6IGRldiA+PSBBVkdfRVJST1IgPyBcImVycm9yXCIgOiBkZXYgPj0gQVZHX1dBUk5JTkcgPyBcIndhcm5pbmdcIiA6IG51bGwgfTtcbn1cblxuLyoqIE9uZSBjYXJkIHBlciB0cmVuZCB0aGF0IGhhcyBkYXRhOyByZW5kZXJlZCBhcyBhIGZyYWdtZW50IHNvIHRoZSBjYXJkcyBqb2luIHRoZSBzdXJyb3VuZGluZyBGbG93LiAqL1xuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RyZW5kc1xuICAgICAgICAubWFwKCh0KSA9PiAoeyB0LCBwb2ludHM6IGRheXMubWFwKChkKSA9PiAoeyBsYWJlbDogc2hvcnREYXRlKGQuZGF0ZSksIHJhdzogdC5nZXQoZC5kb2MpIH0pKSB9KSlcbiAgICAgICAgLmZpbHRlcigoeyBwb2ludHMgfSkgPT4gcG9pbnRzLnNvbWUoKHB0KSA9PiBwdC5yYXcgIT09IHVuZGVmaW5lZCkpXG4gICAgICAgIC5tYXAoKHsgdCwgcG9pbnRzIH0pID0+IChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAga2V5PXt0LnRpdGxlfVxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT17YCR7dC50aXRsZX0gVHJlbmRgfVxuICAgICAgICAgICAgdG9uZT17d29yc3RUb25lKFt2YWx1ZVRvbmUodC5rZXksIHBvaW50c1twb2ludHMubGVuZ3RoIC0gMV0/LnJhdyksIGF2ZXJhZ2VDaGVjayhwb2ludHMubWFwKChwdCkgPT4gcHQucmF3KSk/LnRvbmVdKX1cbiAgICAgICAgICA+XG4gICAgICAgICAgICA8TGluZUNoYXJ0XG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICBsYWJlbHM9e3BvaW50cy5tYXAoKHB0KSA9PiBwdC5sYWJlbCl9XG4gICAgICAgICAgICAgIHNlcmllcz17W3sgbmFtZTogdC50aXRsZSwgY29sb3I6IGFwaS50aGVtZS5wYWxldHRlLmFjY2VudCwgdmFsdWVzOiBwb2ludHMubWFwKChwdCkgPT4gcHQucmF3ID8/IG51bGwpIH1dfVxuICAgICAgICAgICAgICBmb3JtYXQ9e2F4aXNGbXQodC5rZXkpfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgIDwvPlxuICApO1xufVxuXG5mdW5jdGlvbiBIaXN0b3J5SGludCh7IGFwaSwgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGlmIChkYXlzLmxlbmd0aCA+PSAyKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBhcGkudGhlbWUucGFsZXR0ZS50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5UcmVuZHMgZmlsbCBpbiBhcyBkYWlseSBoaXN0b3J5IGFjY3VtdWxhdGVzICh7ZGF5cy5sZW5ndGh9IGRheSBzbyBmYXIpLjwvc3Bhbj47XG59XG5cbmZ1bmN0aW9uIGNvc3RSb3dzKGFwaTogUGx1Z2luQXBpLCBjb3N0OiBKc29uKTogQmFyUm93W10ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiBPYmplY3QuZW50cmllcyhjb3N0Py5ieVRhZyA/PyB7fSlcbiAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpXG4gICAgLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gKGIgYXMgbnVtYmVyKSAtIChhIGFzIG51bWJlcikpXG4gICAgLm1hcCgoW2ssIHZdKSA9PiAoe1xuICAgICAgbGFiZWw6IGssXG4gICAgICBzZWdtZW50czogW3sgbmFtZTogXCJDb3N0XCIsIHZhbHVlOiB2IGFzIG51bWJlciwgY29sb3I6IHAuYWNjZW50IH1dLFxuICAgICAgdmFsdWVUZXh0OiBtb25leS5mb3JtYXQodiBhcyBudW1iZXIpLFxuICAgICAgdGlwOiBbYCR7bW9uZXkuZm9ybWF0KHYgYXMgbnVtYmVyKX0gKCR7Y29zdC50b3RhbCA/ICgoKHYgYXMgbnVtYmVyKSAvIGNvc3QudG90YWwpICogMTAwKS50b0ZpeGVkKDEpIDogXCIwXCJ9JSBvZiB0b3RhbClgXSxcbiAgICB9KSk7XG59XG5cbi8qKiBBcHBzIHRvbyBzbWFsbCBmb3IgdGhlaXIgb3duIHRhYjsgdGhleSBnZXQgb25lIGludm9jYXRpb25zLXZzLWVycm9ycyBjYXJkIG9uIHRoZSBPdmVydmlldyBpbnN0ZWFkLiAqL1xuY29uc3QgT1ZFUlZJRVdfT05MWV9BUFBTOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBTZWNyZXRzTWFuYWdlcjogXCJHbG9iYWwgU2VjcmV0cyBUcmVuZFwiIH07XG5cbi8qKiBTdW0gb2YgYSBMYW1iZGEgbWV0cmljIGFjcm9zcyBhbiBhcHAncyBmdW5jdGlvbnM7IHVua25vd24gaWYgYW55IGZ1bmN0aW9uJ3MgdmFsdWUgaXMgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIGxhbWJkYVN1bShhcHA6IEpzb24sIGZpZWxkOiBcImludm9jYXRpb25zXCIgfCBcImVycm9yc1wiKTogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGxhbWJkYXMgPSBhcHA/Lm1vbml0b3Jpbmc/LmxhbWJkYXM7XG4gIGlmIChsYW1iZGFzID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChsYW1iZGFzID09PSBudWxsIHx8IGlzRXJyb3JOb2RlKGxhbWJkYXMpIHx8IGlzRXJyb3JOb2RlKGFwcC5tb25pdG9yaW5nKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHZhbHMgPSBPYmplY3QudmFsdWVzKGxhbWJkYXMpLm1hcCgodikgPT4gbWV0cmljKHYsIGZpZWxkKSk7XG4gIHJldHVybiB2YWxzLnNvbWUoKHYpID0+IHR5cGVvZiB2ICE9PSBcIm51bWJlclwiKSA/IG51bGwgOiAodmFscyBhcyBudW1iZXJbXSkucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG59XG5cbmZ1bmN0aW9uIEludm9jYXRpb25zVHJlbmQoeyBhcGksIGRheXMsIGFwcE5hbWUsIHRpdGxlIH06IHsgYXBpOiBQbHVnaW5BcGk7IGRheXM6IERheVtdOyBhcHBOYW1lOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmcgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBhcHA6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHBOYW1lKSB9KSkuZmlsdGVyKChkKSA9PiBkLmFwcCk7XG4gIGlmIChhcHBEYXlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNlcmllczogU2VyaWVzW10gPSBbXG4gICAgeyBuYW1lOiBcIkludm9jYXRpb25zXCIsIGNvbG9yOiBwLmFjY2VudCwgdmFsdWVzOiBhcHBEYXlzLm1hcCgoZCkgPT4gbGFtYmRhU3VtKGQuYXBwLCBcImludm9jYXRpb25zXCIpID8/IG51bGwpIH0sXG4gICAgeyBuYW1lOiBcIkVycm9yc1wiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IsIHZhbHVlczogYXBwRGF5cy5tYXAoKGQpID0+IGxhbWJkYVN1bShkLmFwcCwgXCJlcnJvcnNcIikgPz8gbnVsbCkgfSxcbiAgXTtcbiAgcmV0dXJuIChcbiAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9e3RpdGxlfSB0b25lPXt2YWx1ZVRvbmUoXCJsYW1iZGFFcnJvcnNcIiwgc2VyaWVzWzFdLnZhbHVlc1tzZXJpZXNbMV0udmFsdWVzLmxlbmd0aCAtIDFdKX0gZXh0cmE9ezxMZWdlbmQgYXBpPXthcGl9IGl0ZW1zPXtzZXJpZXN9IC8+fT5cbiAgICAgIDxMaW5lQ2hhcnQgYXBpPXthcGl9IGxhYmVscz17YXBwRGF5cy5tYXAoKGQpID0+IHNob3J0RGF0ZShkLmRhdGUpKX0gc2VyaWVzPXtzZXJpZXN9IGZvcm1hdD17YXhpc0ZtdChcIlwiKX0gLz5cbiAgICA8L1NlY3Rpb24+XG4gICk7XG59XG5cbmNvbnN0IE9WRVJWSUVXX1RSRU5EUzogVHJlbmRbXSA9IFtcbiAgeyB0aXRsZTogXCJBV1MgQ29zdCAoMzBkKVwiLCBrZXk6IFwiY29zdFwiLCBnZXQ6IChkKSA9PiBtZXRyaWMoZCwgXCJhd3NDb3N0LnRvdGFsXCIpIH0sXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMucmVxdWVzdHNcIikgfSxcbiAgeyB0aXRsZTogXCJMYW1iZGEgRXJyb3JzICgyNGgpXCIsIGtleTogXCJsYW1iZGFFcnJvcnNcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSB9LFxuICB7IHRpdGxlOiBcIjV4eCBFcnJvcnMgKDI0aClcIiwga2V5OiBcImVycm9yczV4eFwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMuZXJyb3JzNXh4XCIpIH0sXG4gIHsgdGl0bGU6IFwiQWxhcm1zIEZpcmluZ1wiLCBrZXk6IFwiaW5BbGFybVwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwiaGVhbHRoLmFsYXJtcy5pbkFsYXJtXCIpIH0sXG4gIHsgdGl0bGU6IFwiUGF5aW5nIEN1c3RvbWVyc1wiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJjdXN0b21lcnMucGF5aW5nXCIpIH0sXG5dO1xuXG5mdW5jdGlvbiBPdmVydmlldyh7IGFwaSwgZG9jLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGRvYzogSnNvbjsgZGF5czogRGF5W10gfSkge1xuICBjb25zdCB7IFN0YXR1c0RvdCB9ID0gYXBpLnVpO1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcHMgPSBhcHBzT2YoZG9jKTtcbiAgY29uc3QgY29zdCA9IGRvYy5hd3NDb3N0O1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMTIgfX0+XG4gICAgICA8VGlsZVJvdz57T1ZFUlZJRVdfVFJFTkRTLmZpbHRlcigodCkgPT4gdC5nZXQoZG9jKSAhPT0gdW5kZWZpbmVkKS5tYXAoKHQpID0+IHRyZW5kVGlsZShhcGksIGRheXMsIHQpKX08L1RpbGVSb3c+XG4gICAgICA8SGlzdG9yeUhpbnQgYXBpPXthcGl9IGRheXM9e2RheXN9IC8+XG4gICAgICA8Rmxvdz5cbiAgICAgICAgPFRyZW5kQ2hhcnRzIGFwaT17YXBpfSBkYXlzPXtkYXlzfSB0cmVuZHM9e09WRVJWSUVXX1RSRU5EUy5zbGljZSgwLCAzKX0gLz5cbiAgICAgICAge09iamVjdC5lbnRyaWVzKE9WRVJWSUVXX09OTFlfQVBQUykubWFwKChbbmFtZSwgdGl0bGVdKSA9PiAoXG4gICAgICAgICAgPEludm9jYXRpb25zVHJlbmQga2V5PXtuYW1lfSBhcGk9e2FwaX0gZGF5cz17ZGF5c30gYXBwTmFtZT17bmFtZX0gdGl0bGU9e3RpdGxlfSAvPlxuICAgICAgICApKX1cbiAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiQXBwc1wiIHRvbmU9e3dvcnN0KGFwcHMubWFwKGFwcFN0YXR1cykpfT5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBcImF1dG8gMWZyIG1heC1jb250ZW50IG1heC1jb250ZW50IG1heC1jb250ZW50XCIsIGdhcDogXCI0cHggMTJweFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiIH19PlxuICAgICAgICAgICAge1tcIlwiLCBcIkFwcFwiLCBcIlJlcXVlc3RzXCIsIFwiRXJyb3JzXCIsIFwiUHJvZml0ICgzMGQpXCJdLm1hcCgoaCkgPT4gKFxuICAgICAgICAgICAgICA8c3BhbiBrZXk9e2ggfHwgXCJkb3RcIn0gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAgICAgICAge2h9XG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICkpfVxuICAgICAgICAgICAge2FwcHMubWFwKChhKSA9PiAoXG4gICAgICAgICAgICAgIDxkaXYga2V5PXthLm5hbWV9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fT5cbiAgICAgICAgICAgICAgICA8U3RhdHVzRG90IGNvbG9yPXthcHBTdGF0dXMoYSl9IC8+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2EubmFtZX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMucmVxdWVzdHNcIikpfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3Bhbj57Y2VsbChtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikpfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3Bhbj57Y2VsbChtZXRyaWMoYSwgXCJtb25leS5wcm9maXQzMGRcIiksIFwicHJvZml0XCIpfTwvc3Bhbj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9e2BBV1MgQ29zdCBCeSBQcm9qZWN0JHtjb3N0ICYmICFpc0Vycm9yTm9kZShjb3N0KSA/IGAgKCR7c2hvcnREYXRlKGNvc3Qud2luZG93U3RhcnQpfSBUbyAke3Nob3J0RGF0ZShjb3N0LndpbmRvd0VuZCl9KWAgOiBcIlwifWB9PlxuICAgICAgICAgIHshY29zdCB8fCBpc0Vycm9yTm9kZShjb3N0KSA/IDxzcGFuPntmbXQoY29zdCl9PC9zcGFuPiA6IDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXtjb3N0Um93cyhhcGksIGNvc3QpfSAvPn1cbiAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgPC9GbG93PlxuICAgIDwvZGl2PlxuICApO1xufVxuXG5mdW5jdGlvbiBsYW1iZGFSb3dzKGFwaTogUGx1Z2luQXBpLCBsYW1iZGFzOiBKc29uKTogeyByb3dzOiBCYXJSb3dbXTsgaWRsZTogbnVtYmVyOyB1bmtub3duOiBzdHJpbmdbXSB9IHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCByb3dzOiBCYXJSb3dbXSA9IFtdO1xuICBjb25zdCB1bmtub3duOiBzdHJpbmdbXSA9IFtdO1xuICBsZXQgaWRsZSA9IDA7XG4gIGZvciAoY29uc3QgW2ZuLCB2XSBvZiBPYmplY3QuZW50cmllcyhsYW1iZGFzID8/IHt9KSBhcyBbc3RyaW5nLCBKc29uXVtdKSB7XG4gICAgY29uc3QgaW52ID0gbWV0cmljKHYsIFwiaW52b2NhdGlvbnNcIik7XG4gICAgaWYgKHR5cGVvZiBpbnYgIT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHVua25vd24ucHVzaChmbik7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGludiA9PT0gMCkge1xuICAgICAgaWRsZSsrO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGVyciA9IG1ldHJpYyh2LCBcImVycm9yc1wiKSA/PyAwO1xuICAgIGNvbnN0IHRociA9IG1ldHJpYyh2LCBcInRocm90dGxlc1wiKSA/PyAwO1xuICAgIHJvd3MucHVzaCh7XG4gICAgICBsYWJlbDogZm4sXG4gICAgICBzZWdtZW50czogW1xuICAgICAgICB7IG5hbWU6IFwiU3VjY2VlZGVkXCIsIHZhbHVlOiBNYXRoLm1heCgwLCBpbnYgLSBlcnIpLCBjb2xvcjogcC5hY2NlbnQgfSxcbiAgICAgICAgeyBuYW1lOiBcIkVycm9yc1wiLCB2YWx1ZTogZXJyLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgIF0sXG4gICAgICB2YWx1ZVRleHQ6IGVyciA/IGAke2ludi50b0xvY2FsZVN0cmluZygpfSAoJHsoKGVyciAvIGludikgKiAxMDApLnRvRml4ZWQoMCl9JSBFcnIpYCA6IGludi50b0xvY2FsZVN0cmluZygpLFxuICAgICAgdGlwOiBbYCR7aW52LnRvTG9jYWxlU3RyaW5nKCl9IGludm9jYXRpb25zYCwgYCR7ZXJyLnRvTG9jYWxlU3RyaW5nKCl9IGVycm9yc2AsIGAke3Roci50b0xvY2FsZVN0cmluZygpfSB0aHJvdHRsZXNgXSxcbiAgICB9KTtcbiAgfVxuICByb3dzLnNvcnQoKGEsIGIpID0+IGIuc2VnbWVudHNbMF0udmFsdWUgKyBiLnNlZ21lbnRzWzFdLnZhbHVlIC0gKGEuc2VnbWVudHNbMF0udmFsdWUgKyBhLnNlZ21lbnRzWzFdLnZhbHVlKSk7XG4gIHJldHVybiB7IHJvd3MsIGlkbGUsIHVua25vd24gfTtcbn1cblxuZnVuY3Rpb24gYXBpUm93cyhhcGk6IFBsdWdpbkFwaSwgYXBpczogSnNvbik6IEJhclJvd1tdIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICByZXR1cm4gKE9iamVjdC5lbnRyaWVzKGFwaXMgPz8ge30pIGFzIFtzdHJpbmcsIEpzb25dW10pXG4gICAgLmZpbHRlcigoWywgdl0pID0+IHR5cGVvZiBtZXRyaWModiwgXCJyZXF1ZXN0c1wiKSA9PT0gXCJudW1iZXJcIilcbiAgICAubWFwKChbbmFtZSwgdl0pID0+IHtcbiAgICAgIGNvbnN0IHJlcSA9IG1ldHJpYyh2LCBcInJlcXVlc3RzXCIpIGFzIG51bWJlcjtcbiAgICAgIGNvbnN0IGU0ID0gbWV0cmljKHYsIFwiZXJyb3JzNHh4XCIpID8/IDA7XG4gICAgICBjb25zdCBlNSA9IG1ldHJpYyh2LCBcImVycm9yczV4eFwiKSA/PyAwO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbGFiZWw6IG5hbWUsXG4gICAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgICAgeyBuYW1lOiBcIk9LXCIsIHZhbHVlOiBNYXRoLm1heCgwLCByZXEgLSBlNCAtIGU1KSwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgICAgeyBuYW1lOiBcIjR4eFwiLCB2YWx1ZTogZTQsIGNvbG9yOiBwLnN0YXR1cy53YXJuaW5nIH0sXG4gICAgICAgICAgeyBuYW1lOiBcIjV4eFwiLCB2YWx1ZTogZTUsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgICBdLFxuICAgICAgICB2YWx1ZVRleHQ6IHJlcS50b0xvY2FsZVN0cmluZygpLFxuICAgICAgICB0aXA6IFtgJHtyZXEudG9Mb2NhbGVTdHJpbmcoKX0gcmVxdWVzdHNgLCBgJHtlNC50b0xvY2FsZVN0cmluZygpfSA0eHgsICR7ZTUudG9Mb2NhbGVTdHJpbmcoKX0gNXh4YCwgYHA5NSBsYXRlbmN5OiAke2ZtdCh2LnA5NUxhdGVuY3lNcywgXCJsYXRlbmN5bXNcIil9YF0sXG4gICAgICB9O1xuICAgIH0pXG4gICAgLnNvcnQoKGEsIGIpID0+IGIuc2VnbWVudHMucmVkdWNlKChzLCB4KSA9PiBzICsgeC52YWx1ZSwgMCkgLSBhLnNlZ21lbnRzLnJlZHVjZSgocywgeCkgPT4gcyArIHgudmFsdWUsIDApKTtcbn1cblxuZnVuY3Rpb24gUm93cyh7IGFwaSwgdmFsdWUsIHBhdGggPSBcIlwiIH06IHsgYXBpOiBQbHVnaW5BcGk7IHZhbHVlOiBKc29uOyBwYXRoPzogc3RyaW5nIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBpZiAodmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiIHx8IGlzRXJyb3JOb2RlKHZhbHVlKSkge1xuICAgIHJldHVybiA8c3Bhbj57Zm10KHZhbHVlLCBwYXRoKX08L3NwYW4+O1xuICB9XG4gIGNvbnN0IGVudHJpZXMgPSBPYmplY3QuZW50cmllcyh2YWx1ZSkuZmlsdGVyKChbLCB2XSkgPT4gISh0eXBlb2YgdiA9PT0gXCJzdHJpbmdcIiAmJiAodi5sZW5ndGggPiA4MCB8fCB2LmluY2x1ZGVzKFwiXFxuXCIpKSkpO1xuICBpZiAoZW50cmllcy5sZW5ndGggPT09IDApIHJldHVybiA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+Tm9uZTwvc3Bhbj47XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJtYXgtY29udGVudCAxZnJcIiwgZ2FwOiBcIjJweCAxNnB4XCIgfX0+XG4gICAgICB7ZW50cmllcy5tYXAoKFtrLCB2XSkgPT4ge1xuICAgICAgICBjb25zdCBuZXN0ZWQgPSB2ICE9PSBudWxsICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiICYmICFpc0Vycm9yTm9kZSh2KTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICA8ZGl2IGtleT17a30gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19PlxuICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pnt0aXRsZUNhc2Uoayl9PC9zcGFuPlxuICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHZhbHVlVG9uZShrLCB2KSA/IHAuc3RhdHVzW3ZhbHVlVG9uZShrLCB2KSBhcyBTdGF0dXNDb2xvcl0gOiB1bmRlZmluZWQgfX0+XG4gICAgICAgICAgICAgIHtuZXN0ZWQgPyBBcnJheS5pc0FycmF5KHYpID8gPHNwYW4+e3YubGVuZ3RoID8gdi5qb2luKFwiLCBcIikgOiBcIk5vbmVcIn08L3NwYW4+IDogPFJvd3MgYXBpPXthcGl9IHZhbHVlPXt2fSBwYXRoPXtrfSAvPiA6IGZtdCh2LCBrKX1cbiAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgKTtcbiAgICAgIH0pfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5jb25zdCB0aXRsZUNhc2UgPSAoczogc3RyaW5nKSA9PiBzLnJlcGxhY2UoLyhbQS1aXSkvZywgXCIgJDFcIikucmVwbGFjZSgvXi4vLCAoYykgPT4gYy50b1VwcGVyQ2FzZSgpKTtcblxuY29uc3QgQVBQX1RSRU5EUzogVHJlbmRbXSA9IFtcbiAgeyB0aXRsZTogXCJSZXF1ZXN0cyAoMjRoKVwiLCBrZXk6IFwiXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpIH0sXG4gIHsgdGl0bGU6IFwiTGFtYmRhIEVycm9ycyAoMjRoKVwiLCBrZXk6IFwibGFtYmRhRXJyb3JzXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSB9LFxuICB7IHRpdGxlOiBcIlBheWluZyBDdXN0b21lcnNcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJjdXN0b21lcnMucGF5aW5nXCIpIH0sXG4gIHsgdGl0bGU6IFwiTVJSXCIsIGtleTogXCJtcnJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwibW9uZXkubXJyXCIpIH0sXG4gIHsgdGl0bGU6IFwiUHJvZml0ICgzMGQpXCIsIGtleTogXCJwcm9maXRcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwibW9uZXkucHJvZml0MzBkXCIpIH0sXG5dO1xuXG5mdW5jdGlvbiBBcHBWaWV3KHsgYXBpLCBhcHAsIGRheXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgYXBwOiBKc29uOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgYXBwRGF5cyA9IGRheXMubWFwKChkKSA9PiAoeyBkYXRlOiBkLmRhdGUsIGRvYzogYXBwc09mKGQuZG9jKS5maW5kKChhKSA9PiBhLm5hbWUgPT09IGFwcC5uYW1lKSB9KSkuZmlsdGVyKChkKSA9PiBkLmRvYyk7XG4gIGNvbnN0IG1vbiA9IGFwcC5tb25pdG9yaW5nO1xuICBjb25zdCBhdWQgPSBhcHAuYXVkaWVuY2U7XG4gIGNvbnN0IGF1ZERheXM6IEpzb25bXSA9IGF1ZCAmJiBBcnJheS5pc0FycmF5KGF1ZC5kYXlzKSA/IGF1ZC5kYXlzIDogW107XG4gIGNvbnN0IGF1ZEtleXMgPSBhdWREYXlzLmxlbmd0aCA/IE9iamVjdC5rZXlzKGF1ZERheXNbMF0pLmZpbHRlcigoaykgPT4gayAhPT0gXCJkYXRlXCIgJiYgdHlwZW9mIGF1ZERheXNbMF1ba10gPT09IFwibnVtYmVyXCIpIDogW107XG4gIGNvbnN0IGxhbWJkYXMgPSBtb24gJiYgIWlzRXJyb3JOb2RlKG1vbikgJiYgIWlzRXJyb3JOb2RlKG1vbi5sYW1iZGFzKSA/IGxhbWJkYVJvd3MoYXBpLCBtb24ubGFtYmRhcykgOiBudWxsO1xuICBjb25zdCBhcGlzID0gbW9uICYmICFpc0Vycm9yTm9kZShtb24pICYmICFpc0Vycm9yTm9kZShtb24uYXBpcykgPyBhcGlSb3dzKGFwaSwgbW9uLmFwaXMpIDogbnVsbDtcbiAgY29uc3QgZGV0YWlscyA9IE9iamVjdC5lbnRyaWVzKGFwcCkuZmlsdGVyKChba10pID0+IGsgIT09IFwibmFtZVwiICYmIGsgIT09IFwibW9uaXRvcmluZ1wiKTtcblxuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMTIgfX0+XG4gICAgICA8VGlsZVJvdz57QVBQX1RSRU5EUy5maWx0ZXIoKHQpID0+IHQuZ2V0KGFwcCkgIT09IHVuZGVmaW5lZCkubWFwKCh0KSA9PiB0cmVuZFRpbGUoYXBpLCBhcHBEYXlzLCB0KSl9PC9UaWxlUm93PlxuICAgICAgPEhpc3RvcnlIaW50IGFwaT17YXBpfSBkYXlzPXthcHBEYXlzfSAvPlxuICAgICAgPEZsb3c+XG4gICAgICAgIDxUcmVuZENoYXJ0cyBhcGk9e2FwaX0gZGF5cz17YXBwRGF5c30gdHJlbmRzPXtBUFBfVFJFTkRTfSAvPlxuICAgICAgICB7bW9uICYmIGlzRXJyb3JOb2RlKG1vbikgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT1cIk1vbml0b3JpbmcgKDI0aClcIiB0b25lPVwid2FybmluZ1wiPlxuICAgICAgICAgICAgPHNwYW4+e2ZtdChtb24pfTwvc3Bhbj5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHthcGlzICYmIGFwaXMubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgPFNlY3Rpb25cbiAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgdGl0bGU9XCJBUEkgUmVxdWVzdHMgKDI0aClcIlxuICAgICAgICAgICAgdG9uZT17YXBpcy5zb21lKChyKSA9PiByLnNlZ21lbnRzLnNvbWUoKHMpID0+IHMubmFtZSA9PT0gXCI1eHhcIiAmJiBzLnZhbHVlID4gMCkpID8gXCJ3YXJuaW5nXCIgOiBudWxsfVxuICAgICAgICAgICAgZXh0cmE9e1xuICAgICAgICAgICAgICA8TGVnZW5kXG4gICAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgICAgaXRlbXM9e1tcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCJPS1wiLCBjb2xvcjogcC5hY2NlbnQgfSxcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCI0eHhcIiwgY29sb3I6IHAuc3RhdHVzLndhcm5pbmcgfSxcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCI1eHhcIiwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICAgICAgICAgICAgXX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICA+XG4gICAgICAgICAgICA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17YXBpc30gLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHtsYW1iZGFzICYmIGxhbWJkYXMucm93cy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT1cIkxhbWJkYSBJbnZvY2F0aW9ucyAoMjRoKVwiXG4gICAgICAgICAgICB0b25lPXtsYW1iZGFzLnJvd3Muc29tZSgocikgPT4gci5zZWdtZW50cy5zb21lKChzKSA9PiBzLm5hbWUgPT09IFwiRXJyb3JzXCIgJiYgcy52YWx1ZSA+IDApKSA/IFwiZXJyb3JcIiA6IG51bGx9XG4gICAgICAgICAgICBleHRyYT17XG4gICAgICAgICAgICAgIDxMZWdlbmRcbiAgICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgICBpdGVtcz17W1xuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIlN1Y2NlZWRlZFwiLCBjb2xvcjogcC5hY2NlbnQgfSxcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICAgICAgICAgICAgXX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICA+XG4gICAgICAgICAgICA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17bGFtYmRhcy5yb3dzfSAvPlxuICAgICAgICAgICAgeyhsYW1iZGFzLmlkbGUgPiAwIHx8IGxhbWJkYXMudW5rbm93bi5sZW5ndGggPiAwKSAmJiAoXG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgICAgICAgIHtbbGFtYmRhcy5pZGxlID8gYCR7bGFtYmRhcy5pZGxlfSBpZGxlIGZ1bmN0aW9uJHtsYW1iZGFzLmlkbGUgPiAxID8gXCJzXCIgOiBcIlwifSBoaWRkZW5gIDogXCJcIiwgbGFtYmRhcy51bmtub3duLmxlbmd0aCA/IGBVbmtub3duOiAke2xhbWJkYXMudW5rbm93bi5qb2luKFwiLCBcIil9YCA6IFwiXCJdXG4gICAgICAgICAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAgICAgICAgICAgICAuam9pbihcIi4gXCIpfVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICApfVxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2F1ZEtleXMubWFwKChrKSA9PiAoXG4gICAgICAgICAgPFNlY3Rpb24ga2V5PXtrfSBhcGk9e2FwaX0gdGl0bGU9e2BEYWlseSAke3RpdGxlQ2FzZShrKX1gfT5cbiAgICAgICAgICAgIDxMaW5lQ2hhcnRcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIGxhYmVscz17YXVkRGF5cy5tYXAoKGQpID0+IHNob3J0RGF0ZShTdHJpbmcoZC5kYXRlKSkpfVxuICAgICAgICAgICAgICBzZXJpZXM9e1t7IG5hbWU6IHRpdGxlQ2FzZShrKSwgY29sb3I6IHAuYWNjZW50LCB2YWx1ZXM6IGF1ZERheXMubWFwKChkKSA9PiAodHlwZW9mIGRba10gPT09IFwibnVtYmVyXCIgPyBkW2tdIDogbnVsbCkpIH1dfVxuICAgICAgICAgICAgICBmb3JtYXQ9e2F4aXNGbXQoayl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgICAgIHthdWQ/LnNvdXJjZXMzMGQgJiYgIWlzRXJyb3JOb2RlKGF1ZC5zb3VyY2VzMzBkKSAmJiAoXG4gICAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiVHJhZmZpYyBTb3VyY2VzICgzMGQpXCI+XG4gICAgICAgICAgICA8QmFyTGlzdFxuICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgcm93cz17KE9iamVjdC5lbnRyaWVzKGF1ZC5zb3VyY2VzMzBkKSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIilcbiAgICAgICAgICAgICAgICAuc29ydCgoWywgYV0sIFssIGJdKSA9PiBiIC0gYSlcbiAgICAgICAgICAgICAgICAubWFwKChbaywgdl0pID0+ICh7XG4gICAgICAgICAgICAgICAgICBsYWJlbDogdGl0bGVDYXNlKGspLFxuICAgICAgICAgICAgICAgICAgc2VnbWVudHM6IFt7IG5hbWU6IFwiVmlld3NcIiwgdmFsdWU6IHYsIGNvbG9yOiBwLmFjY2VudCB9XSxcbiAgICAgICAgICAgICAgICAgIHZhbHVlVGV4dDogdi50b0xvY2FsZVN0cmluZygpLFxuICAgICAgICAgICAgICAgICAgdGlwOiBbYCR7di50b0xvY2FsZVN0cmluZygpfSB2aWV3c2BdLFxuICAgICAgICAgICAgICAgIH0pKX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7ZGV0YWlscy5tYXAoKFtrLCB2XSkgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17a30gYXBpPXthcGl9IHRpdGxlPXt0aXRsZUNhc2Uoayl9IHRvbmU9e2dyb3VwVG9uZSh2KX0+XG4gICAgICAgICAgICA8Um93c1xuICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgdmFsdWU9e2sgPT09IFwiYXVkaWVuY2VcIiAmJiB2ICYmICFpc0Vycm9yTm9kZSh2KSA/IE9iamVjdC5mcm9tRW50cmllcyhPYmplY3QuZW50cmllcyh2KS5maWx0ZXIoKFtra10pID0+IGtrICE9PSBcImRheXNcIiAmJiBrayAhPT0gXCJzb3VyY2VzMzBkXCIpKSA6IHZ9XG4gICAgICAgICAgICAgIHBhdGg9e2t9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKSl9XG4gICAgICA8L0Zsb3c+XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBDb21wb25lbnQoeyBhcGkgfTogeyBhcGk6IFBsdWdpbkFwaTsgcGFuZUlkPzogc3RyaW5nIH0pIHtcbiAgY29uc3QgeyBUZXh0QnV0dG9uLCBUYWJzLCBCYW5uZXIsIFNwaW5uZXIgfSA9IGFwaS51aTtcbiAgY29uc3QgcGFsZXR0ZSA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBbLCBmb3JjZV0gPSB1c2VTdGF0ZSgwKTtcbiAgY29uc3QgW3RhYiwgc2V0VGFiXSA9IHVzZVN0YXRlKFwib3ZlcnZpZXdcIik7XG4gIGNvbnN0IFssIHNldFRoZW1lXSA9IHVzZVN0YXRlKDApO1xuXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgY29uc3QgbCA9ICgpID0+IGZvcmNlKChuKSA9PiBuICsgMSk7XG4gICAgbGlzdGVuZXJzLmFkZChsKTtcbiAgICBjb25zdCB1bnN1YiA9IGFwaS50aGVtZS5zdWJzY3JpYmUoKCkgPT4gc2V0VGhlbWUoKG4pID0+IG4gKyAxKSk7XG4gICAgaWYgKCFzdGF0ZS5kYXRhKSB7XG4gICAgICB2b2lkIGFwaS5zdG9yYWdlLmdldDxKc29uPihDQUNIRV9LRVkpLnRoZW4oKGNhY2hlZCkgPT4ge1xuICAgICAgICBpZiAoY2FjaGVkICYmICFzdGF0ZS5kYXRhKSBzZXRTdGF0ZSh7IGRhdGE6IGNhY2hlZCB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgbGlzdGVuZXJzLmRlbGV0ZShsKTtcbiAgICAgIHVuc3ViKCk7XG4gICAgfTtcbiAgfSwgW2FwaV0pO1xuXG4gIGNvbnN0IHsgZGF0YSwgZXJyb3IsIGxvYWRpbmcgfSA9IHN0YXRlO1xuICBjb25zdCBhcHBzID0gYXBwc09mKGRhdGEpO1xuICBjb25zdCBkYXlzID0gYWxsRGF5cygpO1xuICBjb25zdCBhZ2UgPSBkYXRhID8gYWdlSG91cnMoZGF0YS5nZW5lcmF0ZWRBdCkgOiBudWxsO1xuICBjb25zdCBzdGFsZSA9IGRhdGEgJiYgKGFnZSA9PT0gbnVsbCB8fCBhZ2UgPiBTVEFMRV9IT1VSUyk7XG4gIGNvbnN0IHRhYkFwcHMgPSBhcHBzLmZpbHRlcigoYSkgPT4gIShhLm5hbWUgaW4gT1ZFUlZJRVdfT05MWV9BUFBTKSk7XG4gIGNvbnN0IGN1cnJlbnQgPSB0YWIgPT09IFwib3ZlcnZpZXdcIiA/IG51bGwgOiB0YWJBcHBzLmZpbmQoKGEpID0+IGEubmFtZSA9PT0gdGFiKTtcblxuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZmxleDogMSwgbWluSGVpZ2h0OiAwLCBkaXNwbGF5OiBcImZsZXhcIiwgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIiwgZ2FwOiAxMiwgY29sb3I6IHBhbGV0dGUudGV4dCB9fT5cbiAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGdhcDogMTIsIHBhZGRpbmdSaWdodDogMjQgfX0+XG4gICAgICAgIDxoMiBzdHlsZT17eyBtYXJnaW46IDAgfX0+e05BTUV9PC9oMj5cbiAgICAgICAgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHBhbGV0dGUudGV4dE11dGVkLCBmbGV4OiAxIH19PlxuICAgICAgICAgIHtkYXRhXG4gICAgICAgICAgICA/IGBHZW5lcmF0ZWQgJHtkYXRhLmdlbmVyYXRlZEF0ID8gbmV3IERhdGUoZGF0YS5nZW5lcmF0ZWRBdCkudG9Mb2NhbGVTdHJpbmcoKSA6IFwiVW5rbm93blwifSBcdTAwQjcgJHtkYXlzLmxlbmd0aH0gRGF5JHtkYXlzLmxlbmd0aCA9PT0gMSA/IFwiXCIgOiBcInNcIn0gT2YgSGlzdG9yeWBcbiAgICAgICAgICAgIDogXCJObyBEYXRhIFlldFwifVxuICAgICAgICA8L3NwYW4+XG4gICAgICAgIHtsb2FkaW5nICYmIDxTcGlubmVyIHNpemU9ezE2fSAvPn1cbiAgICAgICAgPFRleHRCdXR0b24gbGFiZWw9XCJSZWZyZXNoXCIgdmFyaWFudD1cInByaW1hcnlcIiBkaXNhYmxlZD17bG9hZGluZ30gb25DbGljaz17KCkgPT4gdm9pZCByZWZyZXNoKGFwaSl9IC8+XG4gICAgICA8L2Rpdj5cbiAgICAgIHtlcnJvciAmJiA8QmFubmVyIG1lc3NhZ2U9e2BDb3VsZCBOb3QgTG9hZCBNZXRyaWNzOiAke2Vycm9yfWB9IHRvbmU9XCJlcnJvclwiIC8+fVxuICAgICAge3N0YWxlICYmIDxCYW5uZXIgbWVzc2FnZT17YE1ldHJpY3MgQXJlIE9sZGVyIFRoYW4gJHtTVEFMRV9IT1VSU30gSG91cnM7IFRoZSBEYWlseSBDb2xsZWN0b3IgTWF5IEhhdmUgRmFpbGVkYH0gdG9uZT1cIndhcm5pbmdcIiAvPn1cbiAgICAgIHtkYXRhICYmIChcbiAgICAgICAgPD5cbiAgICAgICAgICA8VGFic1xuICAgICAgICAgICAgdGFicz17W3sgbGFiZWw6IFwiT3ZlcnZpZXdcIiwgdmFsdWU6IFwib3ZlcnZpZXdcIiB9LCAuLi50YWJBcHBzLm1hcCgoYSkgPT4gKHsgbGFiZWw6IGEubmFtZSBhcyBzdHJpbmcsIHZhbHVlOiBhLm5hbWUgYXMgc3RyaW5nIH0pKV19XG4gICAgICAgICAgICB2YWx1ZT17Y3VycmVudCA/IHRhYiA6IFwib3ZlcnZpZXdcIn1cbiAgICAgICAgICAgIG9uQ2hhbmdlPXtzZXRUYWJ9XG4gICAgICAgICAgLz5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLnNjcm9sbGJhclN0eWxlKHBhbGV0dGUpLCBmbGV4OiAxLCBtaW5IZWlnaHQ6IDAsIG92ZXJmbG93OiBcImF1dG9cIiwgcGFkZGluZ1JpZ2h0OiBHQVAgfX0+XG4gICAgICAgICAgICB7Y3VycmVudCA/IDxBcHBWaWV3IGFwaT17YXBpfSBhcHA9e2N1cnJlbnR9IGRheXM9e2RheXN9IC8+IDogPE92ZXJ2aWV3IGFwaT17YXBpfSBkb2M9e2RhdGF9IGRheXM9e2RheXN9IC8+fVxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8Lz5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQ0EsU0FBUyxXQUFXLFFBQVEsZ0JBQWdCO0FBOFJ4QyxTQXFXQSxVQXJXQSxLQXlFUSxZQXpFUjtBQTFSSixJQUFNLE9BQU87QUFDYixJQUFNLGNBQWM7QUFDcEIsSUFBTSxZQUFZO0FBQ2xCLElBQU0sY0FBYztBQUNwQixJQUFNLFdBQVc7QUFDakIsSUFBTSxpQkFBaUI7QUF5QnZCLElBQUksUUFBZSxFQUFFLE1BQU0sTUFBTSxTQUFTLENBQUMsR0FBRyxPQUFPLE1BQU0sU0FBUyxNQUFNO0FBQzFFLElBQU0sWUFBWSxvQkFBSSxJQUFnQjtBQUV0QyxTQUFTLFNBQVMsT0FBdUI7QUFDdkMsVUFBUSxFQUFFLEdBQUcsT0FBTyxHQUFHLE1BQU07QUFDN0IsWUFBVSxRQUFRLENBQUMsTUFBTSxFQUFFLENBQUM7QUFDOUI7QUFJQSxJQUFNLGNBQWMsQ0FBQyxNQUFxQixNQUFNLFFBQVEsT0FBTyxNQUFNLFlBQVksT0FBTyxFQUFFLFVBQVU7QUFFcEcsU0FBUyxhQUFhLEdBQWtCO0FBQ3RDLE1BQUksWUFBWSxDQUFDLEVBQUcsUUFBTztBQUMzQixNQUFJLE1BQU0sUUFBUSxDQUFDLEVBQUcsUUFBTyxFQUFFLEtBQUssWUFBWTtBQUNoRCxNQUFJLEtBQUssT0FBTyxNQUFNLFNBQVUsUUFBTyxPQUFPLE9BQU8sQ0FBQyxFQUFFLEtBQUssWUFBWTtBQUN6RSxTQUFPO0FBQ1Q7QUFFQSxJQUFNLFFBQVEsSUFBSSxLQUFLLGFBQWEsUUFBVyxFQUFFLE9BQU8sWUFBWSxVQUFV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

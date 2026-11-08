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
  const avg = averageCheck(vals, ERROR_KEYS.has(t.key));
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
var ERROR_KEYS = /* @__PURE__ */ new Set(["inAlarm", "lambdaErrors", "errors5xx"]);
var AVG_MIN_DAYS = 3;
var AVG_WARNING = 1;
var AVG_ERROR = 5;
function averageCheck(vals, upOnly = false) {
  const cur = vals[vals.length - 1];
  const prev = vals.slice(0, -1).filter((v) => typeof v === "number");
  if (typeof cur !== "number" || prev.length < AVG_MIN_DAYS) return null;
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  if (avg === 0) return null;
  const change = (cur - avg) / Math.abs(avg);
  const dev = upOnly ? change : Math.abs(change);
  return { avg, change, tone: dev >= AVG_ERROR ? "error" : dev >= AVG_WARNING ? "warning" : null };
}
function TrendCharts({ api, days, trends }) {
  return /* @__PURE__ */ jsx(Fragment, { children: trends.map((t) => ({ t, points: days.map((d) => ({ label: shortDate(d.date), raw: t.get(d.doc) })) })).filter(({ points }) => points.some((pt) => pt.raw !== void 0)).map(({ t, points }) => /* @__PURE__ */ jsx(
    Section,
    {
      api,
      title: `${t.title} Trend`,
      tone: averageCheck(
        points.map((pt) => pt.raw),
        ERROR_KEYS.has(t.key)
      )?.tone,
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
  return /* @__PURE__ */ jsx(Section, { api, title, tone: averageCheck(series[1].values, true)?.tone, extra: /* @__PURE__ */ jsx(Legend, { api, items: series }), children: /* @__PURE__ */ jsx(LineChart, { api, labels: appDays.map((d) => shortDate(d.date)), series, format: axisFmt("") }) });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIGxvYWRpbmc6IGJvb2xlYW47XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCwgbG9hZGluZzogZmFsc2UgfTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIHN0YXRlID0geyAuLi5zdGF0ZSwgLi4ucGF0Y2ggfTtcbiAgbGlzdGVuZXJzLmZvckVhY2goKGwpID0+IGwoKSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gaGVscGVycyAtLS0tLS0tLS0tXG5cbmNvbnN0IGlzRXJyb3JOb2RlID0gKHY6IEpzb24pOiBib29sZWFuID0+IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHYuZXJyb3IgPT09IFwic3RyaW5nXCI7XG5cbmZ1bmN0aW9uIGhhc0Vycm9yTm9kZSh2OiBKc29uKTogYm9vbGVhbiB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIHRydWU7XG4gIGlmIChBcnJheS5pc0FycmF5KHYpKSByZXR1cm4gdi5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIGlmICh2ICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiKSByZXR1cm4gT2JqZWN0LnZhbHVlcyh2KS5zb21lKGhhc0Vycm9yTm9kZSk7XG4gIHJldHVybiBmYWxzZTtcbn1cblxuY29uc3QgbW9uZXkgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IHN0eWxlOiBcImN1cnJlbmN5XCIsIGN1cnJlbmN5OiBcIlVTRFwiIH0pO1xuY29uc3QgY29tcGFjdCA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgbm90YXRpb246IFwiY29tcGFjdFwiLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDEgfSk7XG5jb25zdCBNT05FWV9LRVkgPSAvKG1ycnxwcm9maXR8Y29zdHxhbW91bnR8cmV2ZW51ZSkvaTtcblxuLyoqIFNpbmdsZSBmb3JtYXR0ZXI6IG51bGwvdW5kZWZpbmVkL2Vycm9yIG5vZGVzIGFyZSBcIlVua25vd25cIiwgbmV2ZXIgemVyby4gKi9cbmZ1bmN0aW9uIGZtdCh2OiBKc29uLCBrZXkgPSBcIlwiKTogc3RyaW5nIHtcbiAgaWYgKHYgPT09IG51bGwgfHwgdiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gXCJVbmtub3duXCI7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIGBVbmtub3duICgke3YuZXJyb3J9KWA7XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIGlmIChNT05FWV9LRVkudGVzdChrZXkpKSByZXR1cm4gbW9uZXkuZm9ybWF0KHYpO1xuICAgIGlmICgvbGF0ZW5jeW1zL2kudGVzdChrZXkpKSByZXR1cm4gYCR7TWF0aC5yb3VuZCh2KX0gbXNgO1xuICAgIHJldHVybiB2LnRvTG9jYWxlU3RyaW5nKCk7XG4gIH1cbiAgaWYgKHR5cGVvZiB2ID09PSBcImJvb2xlYW5cIikgcmV0dXJuIHYgPyBcIlllc1wiIDogXCJOb1wiO1xuICByZXR1cm4gU3RyaW5nKHYpO1xufVxuXG4vKiogVGFibGUgY2VsbDogXCItXCIgd2hlbiB0aGUgYXBwIGhhcyBubyBzdWNoIG1ldHJpYywgb3RoZXJ3aXNlIGZtdCAoc28gdW5rbm93biBzdGF5cyBcIlVua25vd25cIikuICovXG5jb25zdCBjZWxsID0gKHY6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsIGtleSA9IFwiXCIpID0+ICh2ID09PSB1bmRlZmluZWQgPyBcIi1cIiA6IGZtdCh2LCBrZXkpKTtcblxuY29uc3QgYXhpc0ZtdCA9IChrZXk6IHN0cmluZykgPT4gKG46IG51bWJlcikgPT4gKE1PTkVZX0tFWS50ZXN0KGtleSkgPyBtb25leS5mb3JtYXQobikgOiBjb21wYWN0LmZvcm1hdChuKSk7XG5cbmZ1bmN0aW9uIGFnZUhvdXJzKGlzbzogc3RyaW5nIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgbnVsbCB7XG4gIGNvbnN0IHQgPSBpc28gPyBEYXRlLnBhcnNlKGlzbykgOiBOYU47XG4gIHJldHVybiBOdW1iZXIuaXNOYU4odCkgPyBudWxsIDogKERhdGUubm93KCkgLSB0KSAvIDNfNjAwXzAwMDtcbn1cblxuY29uc3Qgc2hvcnREYXRlID0gKGQ6IHN0cmluZykgPT4gbmV3IERhdGUoYCR7ZH1UMDA6MDA6MDBaYCkudG9Mb2NhbGVEYXRlU3RyaW5nKHVuZGVmaW5lZCwgeyBtb250aDogXCJzaG9ydFwiLCBkYXk6IFwibnVtZXJpY1wiLCB0aW1lWm9uZTogXCJVVENcIiB9KTtcblxuY29uc3QgYXBwc09mID0gKGRvYzogSnNvbik6IEpzb25bXSA9PiAoZG9jICYmIEFycmF5LmlzQXJyYXkoZG9jLmFwcHMpID8gZG9jLmFwcHMgOiBbXSk7XG5cbi8qKiBXYWxrcyBhIGRvdHRlZCBwYXRoLiB1bmRlZmluZWQgPSBub3QgcHJlc2VudCwgbnVsbCA9IHVua25vd24gKGVycm9yIG5vZGUgb3IgbnVsbCksIG51bWJlciA9IHZhbHVlLiAqL1xuZnVuY3Rpb24gbWV0cmljKG86IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBsZXQgdiA9IG87XG4gIGZvciAoY29uc3QgayBvZiBwYXRoLnNwbGl0KFwiLlwiKSkge1xuICAgIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKHYgPT09IG51bGwgfHwgaXNFcnJvck5vZGUodikpIHJldHVybiBudWxsO1xuICAgIHYgPSB2W2tdO1xuICB9XG4gIGlmICh2ID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB0eXBlb2YgdiA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodikgPyB2IDogbnVsbDtcbn1cblxuLyoqIFN1bXMgYSBtZXRyaWMgYWNyb3NzIGFwcHM7IGFueSB1bmtub3duIGFwcCB2YWx1ZSBtYWtlcyB0aGUgdG90YWwgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIHN1bUFwcHMoZG9jOiBKc29uLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCFkb2MgfHwgaXNFcnJvck5vZGUoZG9jLmFwcHMpKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdmFscyA9IGFwcHNPZihkb2MpXG4gICAgLm1hcCgoYSkgPT4gbWV0cmljKGEsIHBhdGgpKVxuICAgIC5maWx0ZXIoKHYpID0+IHYgIT09IHVuZGVmaW5lZCk7XG4gIGlmICh2YWxzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHZhbHMuc29tZSgodikgPT4gdiA9PT0gbnVsbCkgPyBudWxsIDogKHZhbHMgYXMgbnVtYmVyW10pLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xufVxuXG4vKiogU3RhdHVzIGEgc2luZ2xlIHZhbHVlIHNpZ25hbHM6IGZpcmluZyBhbGFybXMgYXJlIGFuIGVycm9yLCA1eHggcmVzcG9uc2VzIGEgd2FybmluZy4gKi9cbmZ1bmN0aW9uIHZhbHVlVG9uZShrZXk6IHN0cmluZywgdjogSnNvbik6IFN0YXR1c0NvbG9yIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdiAhPT0gXCJudW1iZXJcIiB8fCB2IDw9IDApIHJldHVybiBudWxsO1xuICBpZiAoa2V5ID09PSBcImluQWxhcm1cIikgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGtleSA9PT0gXCJsYW1iZGFFcnJvcnNcIikgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGtleSA9PT0gXCJlcnJvcnM1eHhcIikgcmV0dXJuIFwid2FybmluZ1wiO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIFdvcnN0IG9mIHRoZSBnaXZlbiB0b25lcywgaWdub3JpbmcgbnVsbHM7IG51bGwgd2hlbiBub25lIGFyZSBzZXQuICovXG5mdW5jdGlvbiB3b3JzdFRvbmUodG9uZXM6IChTdGF0dXNDb2xvciB8IG51bGwgfCB1bmRlZmluZWQpW10pOiBTdGF0dXNDb2xvciB8IG51bGwge1xuICBjb25zdCBzZXQgPSB0b25lcy5maWx0ZXIoKHQpOiB0IGlzIFN0YXR1c0NvbG9yID0+ICEhdCk7XG4gIHJldHVybiBzZXQubGVuZ3RoID8gd29yc3Qoc2V0KSA6IG51bGw7XG59XG5cbi8qKiBXb3JzdCB0b25lIG9mIGFueSB2YWx1ZSBpbiBhIGdyb3VwOiBmaXJpbmcgYWxhcm1zIC0+IGVycm9yOyA1eHgsIHN0YWxlIHN0YXRlcyBvciB1bmtub3duIHNlY3Rpb25zIC0+IHdhcm5pbmcuICovXG5mdW5jdGlvbiBncm91cFRvbmUodjogSnNvbik6IFN0YXR1c0NvbG9yIHwgbnVsbCB7XG4gIGlmIChpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIFwid2FybmluZ1wiO1xuICBpZiAoIXYgfHwgdHlwZW9mIHYgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsO1xuICBjb25zdCB0b25lczogU3RhdHVzQ29sb3JbXSA9IFtdO1xuICBjb25zdCB3YWxrID0gKG86IEpzb24pID0+XG4gICAgT2JqZWN0LmVudHJpZXMobykuZm9yRWFjaCgoW2ssIHhdKSA9PiB7XG4gICAgICBjb25zdCB0ID0gdmFsdWVUb25lKGssIHgpID8/IChrID09PSBcInN0YWxlU3RhdGVzXCIgJiYgdHlwZW9mIHggPT09IFwibnVtYmVyXCIgJiYgeCA+IDAgPyBcIndhcm5pbmdcIiA6IG51bGwpID8/IChpc0Vycm9yTm9kZSh4KSA/IFwid2FybmluZ1wiIDogbnVsbCk7XG4gICAgICBpZiAodCkgdG9uZXMucHVzaCh0KTtcbiAgICAgIGVsc2UgaWYgKHggJiYgdHlwZW9mIHggPT09IFwib2JqZWN0XCIpIHdhbGsoeCk7XG4gICAgfSk7XG4gIHdhbGsodik7XG4gIHJldHVybiB0b25lcy5sZW5ndGggPyB3b3JzdCh0b25lcykgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBhcHBTdGF0dXMoYXBwOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBpZiAodmFsdWVUb25lKFwiaW5BbGFybVwiLCBtZXRyaWMoYXBwLCBcImhlYWx0aC5hbGFybXMuaW5BbGFybVwiKSkpIHJldHVybiBcImVycm9yXCI7XG4gIGlmICh2YWx1ZVRvbmUoXCJsYW1iZGFFcnJvcnNcIiwgbWV0cmljKGFwcCwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikpKSByZXR1cm4gXCJlcnJvclwiO1xuICBpZiAoaGFzRXJyb3JOb2RlKGFwcCkpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKHZhbHVlVG9uZShcImVycm9yczV4eFwiLCBtZXRyaWMoYXBwLCBcIm1vbml0b3JpbmcudG90YWxzLmVycm9yczV4eFwiKSkpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKChhcHAuaGVhbHRoPy5mcmVzaG5lc3M/LnN0YWxlU3RhdGVzID8/IDApID4gMCkgcmV0dXJuIFwid2FybmluZ1wiO1xuICByZXR1cm4gXCJzdWNjZXNzXCI7XG59XG5cbmNvbnN0IFdPUlNUOiBTdGF0dXNDb2xvcltdID0gW1wiaWRsZVwiLCBcInN1Y2Nlc3NcIiwgXCJ3YXJuaW5nXCIsIFwiZXJyb3JcIl07XG5jb25zdCB3b3JzdCA9IChjczogU3RhdHVzQ29sb3JbXSk6IFN0YXR1c0NvbG9yID0+IGNzLnJlZHVjZSgoYSwgYikgPT4gKFdPUlNULmluZGV4T2YoYikgPiBXT1JTVC5pbmRleE9mKGEpID8gYiA6IGEpLCBcInN1Y2Nlc3NcIiBhcyBTdGF0dXNDb2xvcik7XG5cbmZ1bmN0aW9uIGRvY1N0YXR1cyhkb2M6IEpzb24pOiBTdGF0dXNDb2xvciB7XG4gIGNvbnN0IGFnZSA9IGFnZUhvdXJzKGRvYy5nZW5lcmF0ZWRBdCk7XG4gIGNvbnN0IHN0YWxlID0gYWdlID09PSBudWxsIHx8IGFnZSA+IFNUQUxFX0hPVVJTO1xuICBjb25zdCBzdGF0dXMgPSB3b3JzdChhcHBzT2YoZG9jKS5tYXAoYXBwU3RhdHVzKSk7XG4gIHJldHVybiBzdGFsZSB8fCBoYXNFcnJvck5vZGUoZG9jKSA/IHdvcnN0KFtzdGF0dXMsIFwid2FybmluZ1wiXSkgOiBzdGF0dXM7XG59XG5cbi8qKiBIaXN0b3J5IHBsdXMgdGhlIGxhdGVzdCBkb2N1bWVudCwgb25lIGVudHJ5IHBlciBVVEMgZGF0ZSwgb2xkZXN0IGZpcnN0LiAqL1xuZnVuY3Rpb24gYWxsRGF5cygpOiBEYXlbXSB7XG4gIGNvbnN0IG0gPSBuZXcgTWFwKHN0YXRlLmhpc3RvcnkubWFwKChkKSA9PiBbZC5kYXRlLCBkLmRvY10pKTtcbiAgaWYgKHR5cGVvZiBzdGF0ZS5kYXRhPy5nZW5lcmF0ZWRBdCA9PT0gXCJzdHJpbmdcIikgbS5zZXQoc3RhdGUuZGF0YS5nZW5lcmF0ZWRBdC5zbGljZSgwLCAxMCksIHN0YXRlLmRhdGEpO1xuICByZXR1cm4gWy4uLm0uZW50cmllcygpXS5zb3J0KChbYV0sIFtiXSkgPT4gKGEgPCBiID8gLTEgOiAxKSkubWFwKChbZGF0ZSwgZG9jXSkgPT4gKHsgZGF0ZSwgZG9jIH0pKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBmZXRjaGluZyAtLS0tLS0tLS0tXG5cbmFzeW5jIGZ1bmN0aW9uIGF3c0FyZ3MoYXBpOiBQbHVnaW5BcGksIGFyZ3M6IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBjb25zdCBzID0gYXdhaXQgYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKTtcbiAgY29uc3Qgb3V0ID0gWy4uLmFyZ3MsIFwiLS1jbGktY29ubmVjdC10aW1lb3V0XCIsIFwiMTBcIiwgXCItLWNsaS1yZWFkLXRpbWVvdXRcIiwgXCIxNVwiXTtcbiAgaWYgKHMuYXdzUHJvZmlsZSkgb3V0LnB1c2goXCItLXByb2ZpbGVcIiwgcy5hd3NQcm9maWxlKTtcbiAgcmV0dXJuIG91dDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYXdzKGFwaTogUGx1Z2luQXBpLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHJlcyA9IGF3YWl0IGFwaS5zaGVsbC5leGVjKFwiYXdzXCIsIGF3YWl0IGF3c0FyZ3MoYXBpLCBhcmdzKSk7XG4gIGlmIChyZXMuY29kZSAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKHJlcy5zdGRlcnIudHJpbSgpIHx8IGBhd3MgZXhpdGVkIHdpdGggY29kZSAke3Jlcy5jb2RlfWApO1xuICByZXR1cm4gcmVzLnN0ZG91dDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEhpc3RvcnkoYXBpOiBQbHVnaW5BcGkpIHtcbiAgY29uc3QgZW50cmllcyA9IGF3YWl0IGFwaS5mcy5saXN0RGlyKEhJU1RPUllfRElSKTtcbiAgY29uc3QgZmlsZXMgPSBlbnRyaWVzXG4gICAgLmZpbHRlcigoZSkgPT4gIWUuaXNEaXIgJiYgL15cXGR7NH0tXFxkezJ9LVxcZHsyfVxcLmpzb24kLy50ZXN0KGUubmFtZSkpXG4gICAgLm1hcCgoZSkgPT4gZS5uYW1lKVxuICAgIC5zb3J0KClcbiAgICAuc2xpY2UoLU1BWF9EQVlTKTtcbiAgY29uc3QgZG9jcyA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgIGZpbGVzLm1hcChhc3luYyAoZikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYXdhaXQgYXBpLmZzLnJlYWRUZXh0RmlsZShgJHtISVNUT1JZX0RJUn0vJHtmfWApKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9KSxcbiAgKTtcbiAgc2V0U3RhdGUoeyBoaXN0b3J5OiBmaWxlcy5tYXAoKGYsIGkpID0+ICh7IGRhdGU6IGYuc2xpY2UoMCwgMTApLCBkb2M6IGRvY3NbaV0gfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzeW5jSGlzdG9yeShhcGk6IFBsdWdpbkFwaSwgYnVja2V0OiBzdHJpbmcpIHtcbiAgY29uc3Qgcm9vdCA9IChhd2FpdCBhcGkuZnMuZ2V0Um9vdFBhdGgoKSkucmVwbGFjZSgvW1xcXFwvXSskLywgXCJcIik7XG4gIGF3YWl0IGF3cyhhcGksIFtcInMzXCIsIFwic3luY1wiLCBgczM6Ly8ke2J1Y2tldH0vJHtISVNUT1JZX0RJUn0vYCwgYCR7cm9vdH0vJHtISVNUT1JZX0RJUn1gLCBcIi0tb25seS1zaG93LWVycm9yc1wiXSk7XG4gIGF3YWl0IGxvYWRIaXN0b3J5KGFwaSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlZnJlc2goYXBpOiBQbHVnaW5BcGksIHNpZ25hbD86IEFib3J0U2lnbmFsKSB7XG4gIGlmIChzdGF0ZS5sb2FkaW5nKSByZXR1cm47XG4gIHNldFN0YXRlKHsgbG9hZGluZzogdHJ1ZSB9KTtcbiAgY29uc3Qgc2V0SWNvbiA9IChjOiBTdGF0dXNDb2xvciwgdGlwPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKHNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhcGkuc3RhdHVzSWNvbi5zZXQoYywgdGlwKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGRlYWN0aXZhdGVkICovXG4gICAgfVxuICB9O1xuICBjb25zdCBsb2cgPSAobGV2ZWw6IFwid2FyblwiIHwgXCJlcnJvclwiLCBtc2c6IHN0cmluZykgPT4ge1xuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXBpLmxvZ1tsZXZlbF0oYCR7TkFNRX06ICR7bXNnfWApO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogZGVhY3RpdmF0ZWQgKi9cbiAgICB9XG4gIH07XG4gIHRyeSB7XG4gICAgY29uc3QgYnVja2V0ID0gKGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCkpLmJ1Y2tldCB8fCBERUZBVUxUX0JVQ0tFVDtcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcImNwXCIsIGBzMzovLyR7YnVja2V0fS9tZXRyaWNzLmpzb25gLCBcIi1cIl0pKTtcbiAgICBhd2FpdCBhcGkuc3RvcmFnZS5zZXQoQ0FDSEVfS0VZLCBkYXRhKTtcbiAgICBzZXRTdGF0ZSh7IGRhdGEsIGVycm9yOiBudWxsIH0pO1xuICAgIGxldCBzdGF0dXMgPSBkb2NTdGF0dXMoZGF0YSk7XG4gICAgbGV0IHRpcCA9IHN0YXR1cyA9PT0gXCJzdWNjZXNzXCIgPyBcIk1ldHJpY3MgdXAgdG8gZGF0ZVwiIDogc3RhdHVzID09PSBcImVycm9yXCIgPyBcIkFsYXJtcyBmaXJpbmcgb3IgTGFtYmRhIGVycm9yc1wiIDogXCJNZXRyaWNzIG5lZWQgYXR0ZW50aW9uXCI7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNIaXN0b3J5KGFwaSwgYnVja2V0KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zdCBtc2cgPSBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSk7XG4gICAgICBsb2coXCJ3YXJuXCIsIGBoaXN0b3J5IHN5bmMgZmFpbGVkOiAke21zZ31gKTtcbiAgICAgIHN0YXR1cyA9IHdvcnN0KFtzdGF0dXMsIFwid2FybmluZ1wiXSk7XG4gICAgICB0aXAgPSBgSGlzdG9yeSBzeW5jIGZhaWxlZDogJHttc2d9YDtcbiAgICB9XG4gICAgc2V0U3RhdGUoeyBsb2FkaW5nOiBmYWxzZSB9KTtcbiAgICAvLyBUaGUgaWNvbiBvbmx5IHNpZ25hbHMgcHJvYmxlbXM7IGFueXRoaW5nIHNob3J0IG9mIHdhcm5pbmcgc3RheXMgaWRsZSAoZGVmYXVsdCB0aW50KS5cbiAgICBzZXRJY29uKHN0YXR1cyA9PT0gXCJ3YXJuaW5nXCIgfHwgc3RhdHVzID09PSBcImVycm9yXCIgPyBzdGF0dXMgOiBcImlkbGVcIiwgdGlwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IGUgaW5zdGFuY2VvZiBFcnJvciA/IGUubWVzc2FnZSA6IFN0cmluZyhlKTtcbiAgICBzZXRTdGF0ZSh7IGVycm9yOiBtc2csIGxvYWRpbmc6IGZhbHNlIH0pO1xuICAgIHNldEljb24oXCJlcnJvclwiLCBtc2cpO1xuICAgIGxvZyhcImVycm9yXCIsIG1zZyk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlKGN0eDogUGx1Z2luQ29udGV4dCkge1xuICBjdHguYXBpLnN0YXR1c0ljb24uc2V0KFwiaWRsZVwiKTtcbiAgY29uc3QgcyA9IGF3YWl0IGN0eC5hcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpO1xuICBjb25zdCBtaW51dGVzID0gTWF0aC5tYXgoMSwgcy5yZWZyZXNoTWludXRlcyA/PyA2MCk7XG4gIGN0eC50aWNrLnJlZ2lzdGVyKCgpID0+IHJlZnJlc2goY3R4LmFwaSwgY3R4LnNpZ25hbCkpO1xuICBjdHgudGljay5zZXRJbnRlcnZhbChtaW51dGVzICogNjBfMDAwKTtcbiAgY3R4LmFwaS5sb2cuaW5mbyhgJHtOQU1FfSBhY3RpdmF0ZWRgKTtcbiAgdm9pZCBsb2FkSGlzdG9yeShjdHguYXBpKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICB2b2lkIHJlZnJlc2goY3R4LmFwaSwgY3R4LnNpZ25hbCk7XG59XG5cbi8vIC0tLS0tLS0tLS0gY2hhcnQgcHJpbWl0aXZlcyAtLS0tLS0tLS0tXG5cbmNvbnN0IENIQVJUX0hFSUdIVCA9IDE3MDtcblxuY29uc3Qgc2Nyb2xsYmFyU3R5bGUgPSAocDogUGFsZXR0ZSk6IENTU1Byb3BlcnRpZXMgPT4gKHsgc2Nyb2xsYmFyV2lkdGg6IFwidGhpblwiLCBzY3JvbGxiYXJDb2xvcjogYCR7cC5ib3JkZXJ9ICR7cC5zdXJmYWNlfWAgfSk7XG5cbmZ1bmN0aW9uIHVzZVdpZHRoKCkge1xuICBjb25zdCByZWYgPSB1c2VSZWY8SFRNTERpdkVsZW1lbnQ+KG51bGwpO1xuICBjb25zdCBbd2lkdGgsIHNldFdpZHRoXSA9IHVzZVN0YXRlKDApO1xuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGVsID0gcmVmLmN1cnJlbnQ7XG4gICAgaWYgKCFlbCkgcmV0dXJuO1xuICAgIGNvbnN0IHJvID0gbmV3IFJlc2l6ZU9ic2VydmVyKChbZV0pID0+IHNldFdpZHRoKGUuY29udGVudFJlY3Qud2lkdGgpKTtcbiAgICByby5vYnNlcnZlKGVsKTtcbiAgICByZXR1cm4gKCkgPT4gcm8uZGlzY29ubmVjdCgpO1xuICB9LCBbXSk7XG4gIHJldHVybiBbcmVmLCB3aWR0aF0gYXMgY29uc3Q7XG59XG5cbmZ1bmN0aW9uIG5pY2VNYXgodjogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKHYgPD0gMCkgcmV0dXJuIDE7XG4gIGNvbnN0IHAgPSAxMCAqKiBNYXRoLmZsb29yKE1hdGgubG9nMTAodikpO1xuICBjb25zdCBuID0gdiAvIHA7XG4gIHJldHVybiAobiA8PSAxID8gMSA6IG4gPD0gMiA/IDIgOiBuIDw9IDUgPyA1IDogMTApICogcDtcbn1cblxuZnVuY3Rpb24gVG9vbHRpcCh7IHAsIHgsIHksIGZsaXAsIGZpeGVkLCBjaGlsZHJlbiB9OiB7IHA6IFBhbGV0dGU7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBmbGlwOiBib29sZWFuOyBmaXhlZD86IGJvb2xlYW47IGNoaWxkcmVuOiBSZWFjdE5vZGUgfSkge1xuICByZXR1cm4gKFxuICAgIDxkaXZcbiAgICAgIHN0eWxlPXt7XG4gICAgICAgIHBvc2l0aW9uOiBmaXhlZCA/IFwiZml4ZWRcIiA6IFwiYWJzb2x1dGVcIixcbiAgICAgICAgbGVmdDogeCxcbiAgICAgICAgdG9wOiB5LFxuICAgICAgICB0cmFuc2Zvcm06IGZsaXAgPyBcInRyYW5zbGF0ZVgoLTEwMCUpXCIgOiB1bmRlZmluZWQsXG4gICAgICAgIGJhY2tncm91bmQ6IHAuYmFja2dyb3VuZCxcbiAgICAgICAgY29sb3I6IHAudGV4dCxcbiAgICAgICAgYm9yZGVyOiBgMXB4IHNvbGlkICR7cC5ib3JkZXJ9YCxcbiAgICAgICAgYm9yZGVyUmFkaXVzOiA0LFxuICAgICAgICBwYWRkaW5nOiBcIjRweCA4cHhcIixcbiAgICAgICAgZm9udFNpemU6IDEyLFxuICAgICAgICBsaW5lSGVpZ2h0OiBcIjE4cHhcIixcbiAgICAgICAgd2hpdGVTcGFjZTogXCJub3dyYXBcIixcbiAgICAgICAgcG9pbnRlckV2ZW50czogXCJub25lXCIsXG4gICAgICAgIHpJbmRleDogMSxcbiAgICAgIH19XG4gICAgPlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5pbnRlcmZhY2UgU2VyaWVzIHtcbiAgbmFtZTogc3RyaW5nO1xuICBjb2xvcjogc3RyaW5nO1xuICB2YWx1ZXM6IChudW1iZXIgfCBudWxsKVtdO1xufVxuXG4vKiogTGluZSBjaGFydCBvdmVyIHRpbWUgb24gb25lIHNoYXJlZCBheGlzLiBVbmtub3duIChudWxsKSBwb2ludHMgYnJlYWsgYSBsaW5lIGluc3RlYWQgb2YgZHJvcHBpbmcgdG8gemVybzsgYSBsb25lIHNlcmllcyBhbHNvIGdldHMgYW4gYXJlYSBmaWxsLiAqL1xuZnVuY3Rpb24gTGluZUNoYXJ0KHsgYXBpLCBsYWJlbHMsIHNlcmllcywgZm9ybWF0LCBoZWlnaHQgPSBDSEFSVF9IRUlHSFQgfTogeyBhcGk6IFBsdWdpbkFwaTsgbGFiZWxzOiBzdHJpbmdbXTsgc2VyaWVzOiBTZXJpZXNbXTsgZm9ybWF0OiAobjogbnVtYmVyKSA9PiBzdHJpbmc7IGhlaWdodD86IG51bWJlciB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW3JlZiwgd2lkdGhdID0gdXNlV2lkdGgoKTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTxudW1iZXIgfCBudWxsPihudWxsKTtcbiAgY29uc3QgTCA9IDU2LFxuICAgIFIgPSAxMixcbiAgICBUID0gMTAsXG4gICAgQiA9IDIyO1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgd2lkdGggLSBMIC0gUik7XG4gIGNvbnN0IGggPSBoZWlnaHQgLSBUIC0gQjtcbiAgY29uc3QgbiA9IGxhYmVscy5sZW5ndGg7XG4gIGNvbnN0IG1heCA9IG5pY2VNYXgoTWF0aC5tYXgoMCwgLi4uc2VyaWVzLmZsYXRNYXAoKHMpID0+IHMudmFsdWVzLm1hcCgodikgPT4gdiA/PyAwKSkpKTtcbiAgY29uc3QgeCA9IChpOiBudW1iZXIpID0+IEwgKyAobiA8PSAxID8gdyAvIDIgOiAoaSAqIHcpIC8gKG4gLSAxKSk7XG4gIGNvbnN0IHkgPSAodjogbnVtYmVyKSA9PiBUICsgaCAtICh2IC8gbWF4KSAqIGg7XG5cbiAgY29uc3QgcnVuc09mID0gKHZhbHVlczogKG51bWJlciB8IG51bGwpW10pID0+IHtcbiAgICBjb25zdCBydW5zOiBudW1iZXJbXVtdID0gW107XG4gICAgbGV0IGN1cjogbnVtYmVyW10gPSBbXTtcbiAgICB2YWx1ZXMuZm9yRWFjaCgodiwgaSkgPT4ge1xuICAgICAgaWYgKHYgPT09IG51bGwpIHtcbiAgICAgICAgaWYgKGN1ci5sZW5ndGgpIHJ1bnMucHVzaChjdXIpO1xuICAgICAgICBjdXIgPSBbXTtcbiAgICAgIH0gZWxzZSBjdXIucHVzaChpKTtcbiAgICB9KTtcbiAgICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gICAgcmV0dXJuIHJ1bnM7XG4gIH07XG5cbiAgY29uc3Qgb25Nb3ZlID0gKGU6IE1vdXNlRXZlbnQ8U1ZHUmVjdEVsZW1lbnQ+KSA9PiB7XG4gICAgY29uc3QgciA9IGUuY3VycmVudFRhcmdldC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBjb25zdCBpID0gbiA8PSAxID8gMCA6IE1hdGgucm91bmQoKChlLmNsaWVudFggLSByLmxlZnQpIC8gci53aWR0aCkgKiAobiAtIDEpKTtcbiAgICBzZXRIb3ZlcihNYXRoLm1pbihuIC0gMSwgTWF0aC5tYXgoMCwgaSkpKTtcbiAgfTtcblxuICBjb25zdCB4TGFiZWxzID0gbiA8PSAxID8gWzBdIDogbiA9PT0gMiA/IFswLCAxXSA6IFswLCBNYXRoLmZsb29yKChuIC0gMSkgLyAyKSwgbiAtIDFdO1xuICBjb25zdCBhbmNob3IgPSAoaTogbnVtYmVyKSA9PiAobiA8PSAxID8gXCJtaWRkbGVcIiA6IGkgPT09IDAgPyBcInN0YXJ0XCIgOiBpID09PSBuIC0gMSA/IFwiZW5kXCIgOiBcIm1pZGRsZVwiKTtcbiAgY29uc3QgZmxpcCA9IGhvdmVyICE9PSBudWxsICYmIHgoaG92ZXIpID4gd2lkdGggLSAxNjA7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHJlZj17cmVmfSBzdHlsZT17eyBwb3NpdGlvbjogXCJyZWxhdGl2ZVwiLCBoZWlnaHQgfX0+XG4gICAgICB7d2lkdGggPiAwICYmIChcbiAgICAgICAgPHN2ZyB3aWR0aD17d2lkdGh9IGhlaWdodD17aGVpZ2h0fSBzdHlsZT17eyBkaXNwbGF5OiBcImJsb2NrXCIsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICB7WzAsIDAuNSwgMV0ubWFwKChmKSA9PiAoXG4gICAgICAgICAgICA8ZyBrZXk9e2Z9PlxuICAgICAgICAgICAgICA8bGluZSB4MT17TH0geDI9e0wgKyB3fSB5MT17eShtYXggKiBmKX0geTI9e3kobWF4ICogZil9IHN0cm9rZT17cC5ib3JkZXJ9IHN0cm9rZVdpZHRoPXsxfSBzdHJva2VEYXNoYXJyYXk9e2YgPyBcIjIgNFwiIDogdW5kZWZpbmVkfSAvPlxuICAgICAgICAgICAgICA8dGV4dCB4PXtMIC0gNn0geT17eShtYXggKiBmKX0gZHk9XCIwLjMyZW1cIiB0ZXh0QW5jaG9yPVwiZW5kXCIgZmlsbD17cC50ZXh0TXV0ZWR9PlxuICAgICAgICAgICAgICAgIHtmb3JtYXQobWF4ICogZil9XG4gICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICApKX1cbiAgICAgICAgICB7eExhYmVscy5tYXAoKGkpID0+IChcbiAgICAgICAgICAgIDx0ZXh0IGtleT17aX0geD17eChpKX0geT17aGVpZ2h0IC0gNH0gdGV4dEFuY2hvcj17YW5jaG9yKGkpfSBmaWxsPXtwLnRleHRNdXRlZH0+XG4gICAgICAgICAgICAgIHtsYWJlbHNbaV19XG4gICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgKSl9XG4gICAgICAgICAge3Nlcmllcy5tYXAoKHMpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJ1bnMgPSBydW5zT2Yocy52YWx1ZXMpO1xuICAgICAgICAgICAgY29uc3QgbGluZSA9IChydW46IG51bWJlcltdKSA9PiBydW4ubWFwKChpLCBrKSA9PiBgJHtrID8gXCJMXCIgOiBcIk1cIn0ke3goaSl9LCR7eShzLnZhbHVlc1tpXSBhcyBudW1iZXIpfWApLmpvaW4oXCJcIik7XG4gICAgICAgICAgICBjb25zdCBsYXN0S25vd24gPSBbLi4ucy52YWx1ZXMua2V5cygpXS5yZXZlcnNlKCkuZmluZCgoaSkgPT4gcy52YWx1ZXNbaV0gIT09IG51bGwpO1xuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgPGcga2V5PXtzLm5hbWV9PlxuICAgICAgICAgICAgICAgIHtydW5zLm1hcCgocnVuKSA9PlxuICAgICAgICAgICAgICAgICAgcnVuLmxlbmd0aCA+IDEgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxnIGtleT17cnVuWzBdfT5cbiAgICAgICAgICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA9PT0gMSAmJiA8cGF0aCBkPXtgJHtsaW5lKHJ1bil9TCR7eChydW5bcnVuLmxlbmd0aCAtIDFdKX0sJHt5KDApfUwke3gocnVuWzBdKX0sJHt5KDApfVpgfSBmaWxsPXtzLmNvbG9yfSBmaWxsT3BhY2l0eT17MC4xMn0gLz59XG4gICAgICAgICAgICAgICAgICAgICAgPHBhdGggZD17bGluZShydW4pfSBmaWxsPVwibm9uZVwiIHN0cm9rZT17cy5jb2xvcn0gc3Ryb2tlV2lkdGg9ezJ9IHN0cm9rZUxpbmVqb2luPVwicm91bmRcIiBzdHJva2VMaW5lY2FwPVwicm91bmRcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICA8Y2lyY2xlIGtleT17cnVuWzBdfSBjeD17eChydW5bMF0pfSBjeT17eShzLnZhbHVlc1tydW5bMF1dIGFzIG51bWJlcil9IHI9ezN9IGZpbGw9e3MuY29sb3J9IC8+XG4gICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAge2xhc3RLbm93biAhPT0gdW5kZWZpbmVkICYmIGhvdmVyID09PSBudWxsICYmIChcbiAgICAgICAgICAgICAgICAgIDxjaXJjbGUgY3g9e3gobGFzdEtub3duKX0gY3k9e3kocy52YWx1ZXNbbGFzdEtub3duXSBhcyBudW1iZXIpfSByPXszLjV9IGZpbGw9e3MuY29sb3J9IHN0cm9rZT17cC5zdXJmYWNlfSBzdHJva2VXaWR0aD17Mn0gLz5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiBzLnZhbHVlc1tob3Zlcl0gIT09IG51bGwgJiYgKFxuICAgICAgICAgICAgICAgICAgPGNpcmNsZSBjeD17eChob3Zlcil9IGN5PXt5KHMudmFsdWVzW2hvdmVyXSBhcyBudW1iZXIpfSByPXs0LjV9IGZpbGw9e3MuY29sb3J9IHN0cm9rZT17cC5zdXJmYWNlfSBzdHJva2VXaWR0aD17Mn0gcG9pbnRlckV2ZW50cz1cIm5vbmVcIiAvPlxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSl9XG4gICAgICAgICAge2hvdmVyICE9PSBudWxsICYmIDxsaW5lIHgxPXt4KGhvdmVyKX0geDI9e3goaG92ZXIpfSB5MT17VH0geTI9e1QgKyBofSBzdHJva2U9e3AudGV4dE11dGVkfSBzdHJva2VXaWR0aD17MX0gcG9pbnRlckV2ZW50cz1cIm5vbmVcIiAvPn1cbiAgICAgICAgICA8cmVjdCB4PXtMfSB5PXswfSB3aWR0aD17d30gaGVpZ2h0PXtoZWlnaHR9IGZpbGw9XCJ0cmFuc3BhcmVudFwiIG9uTW91c2VNb3ZlPXtvbk1vdmV9IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9IC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICAgKX1cbiAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e3goaG92ZXIpICsgKGZsaXAgPyAtMTAgOiAxMCl9IHk9e1R9IGZsaXA9e2ZsaXB9PlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19PntsYWJlbHNbaG92ZXJdfTwvZGl2PlxuICAgICAgICAgIHtzZXJpZXMubWFwKChzKSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17cy5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiA2IH19PlxuICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA+IDEgJiYgPHNwYW4gc3R5bGU9e3sgd2lkdGg6IDgsIGhlaWdodDogOCwgYm9yZGVyUmFkaXVzOiAyLCBiYWNrZ3JvdW5kOiBzLmNvbG9yIH19IC8+fVxuICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA+IDEgJiYgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19PntzLm5hbWV9PC9zcGFuPn1cbiAgICAgICAgICAgICAgPHNwYW4+e3MudmFsdWVzW2hvdmVyXSA9PT0gbnVsbCA/IFwiVW5rbm93blwiIDogZm9ybWF0KHMudmFsdWVzW2hvdmVyXSBhcyBudW1iZXIpfTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICkpfVxuICAgICAgICA8L1Rvb2x0aXA+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5pbnRlcmZhY2UgU2VnIHtcbiAgbmFtZTogc3RyaW5nO1xuICB2YWx1ZTogbnVtYmVyO1xuICBjb2xvcjogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgQmFyUm93IHtcbiAgbGFiZWw6IHN0cmluZztcbiAgc2VnbWVudHM6IFNlZ1tdO1xuICB2YWx1ZVRleHQ6IHN0cmluZztcbiAgdGlwOiBzdHJpbmdbXTtcbn1cblxuZnVuY3Rpb24gTGVnZW5kKHsgYXBpLCBpdGVtcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBpdGVtczogeyBuYW1lOiBzdHJpbmc7IGNvbG9yOiBzdHJpbmcgfVtdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGdhcDogMTYsIGZsZXhXcmFwOiBcIndyYXBcIiwgZm9udFNpemU6IDEyLCBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+XG4gICAgICB7aXRlbXMubWFwKChpdCkgPT4gKFxuICAgICAgICA8c3BhbiBrZXk9e2l0Lm5hbWV9IHN0eWxlPXt7IGRpc3BsYXk6IFwiaW5saW5lLWZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiA2IH19PlxuICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IHdpZHRoOiAxMCwgaGVpZ2h0OiAxMCwgYm9yZGVyUmFkaXVzOiAyLCBiYWNrZ3JvdW5kOiBpdC5jb2xvciB9fSAvPlxuICAgICAgICAgIHtpdC5uYW1lfVxuICAgICAgICA8L3NwYW4+XG4gICAgICApKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLyoqIEhvcml6b250YWwgKG9wdGlvbmFsbHkgc3RhY2tlZCkgYmFycyBzaGFyaW5nIG9uZSBzY2FsZSwgdmFsdWUgbGFiZWxzIGF0IHRoZSBlbmQuIFNjcm9sbHMgcGFzdCBCQVJfTElTVF9IRUlHSFQuICovXG5mdW5jdGlvbiBCYXJMaXN0KHsgYXBpLCByb3dzIH06IHsgYXBpOiBQbHVnaW5BcGk7IHJvd3M6IEJhclJvd1tdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBbaG92ZXIsIHNldEhvdmVyXSA9IHVzZVN0YXRlPHsgaTogbnVtYmVyOyB4OiBudW1iZXI7IHk6IG51bWJlciB9IHwgbnVsbD4obnVsbCk7XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KDAsIC4uLnJvd3MubWFwKChyKSA9PiByLnNlZ21lbnRzLnJlZHVjZSgoYSwgcykgPT4gYSArIHMudmFsdWUsIDApKSkgfHwgMTtcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICBjb25zdCBmbGlwID0gaG92ZXIgIT09IG51bGwgJiYgaG92ZXIueCA+IHdpbmRvdy5pbm5lcldpZHRoIC0gMjAwO1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgLi4uc2Nyb2xsYmFyU3R5bGUocCksIG1heEhlaWdodDogQ0hBUlRfSEVJR0hULCBvdmVyZmxvd1k6IFwiYXV0b1wiLCBvdmVyZmxvd1g6IFwiaGlkZGVuXCIsIHBhZGRpbmdSaWdodDogR0FQIH19IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJtaW5tYXgoMCwgbWF4LWNvbnRlbnQpIDFmciBtYXgtY29udGVudFwiLCBnYXA6IFwiMnB4IDEycHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZm9udFNpemU6IDE0IH19PlxuICAgICAgICB7cm93cy5tYXAoKHIsIGkpID0+IHtcbiAgICAgICAgICBjb25zdCB0b3RhbCA9IHIuc2VnbWVudHMucmVkdWNlKChhLCBzKSA9PiBhICsgcy52YWx1ZSwgMCk7XG4gICAgICAgICAgY29uc3QgaG90ID0gaG92ZXI/LmkgPT09IGk7XG4gICAgICAgICAgY29uc3QgY2VsbDogQ1NTUHJvcGVydGllcyA9IHsgYmFja2dyb3VuZDogaG90ID8gcC5zdXJmYWNlSG92ZXIgOiB1bmRlZmluZWQsIHBhZGRpbmc6IFwiMnB4IDBcIiB9O1xuICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17ci5sYWJlbH0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19IG9uTW91c2VNb3ZlPXsoZSkgPT4gc2V0SG92ZXIoeyBpLCB4OiBlLmNsaWVudFgsIHk6IGUuY2xpZW50WSB9KX0+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIGNvbG9yOiBob3QgPyBwLmFjY2VudCA6IHAudGV4dCwgbWF4V2lkdGg6IDIyMCwgb3ZlcmZsb3c6IFwiaGlkZGVuXCIsIHRleHRPdmVyZmxvdzogXCJlbGxpcHNpc1wiLCB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiIH19IHRpdGxlPXtyLmxhYmVsfT5cbiAgICAgICAgICAgICAgICB7ci5sYWJlbH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLmNlbGwsIGRpc3BsYXk6IFwiZmxleFwiLCBoZWlnaHQ6IDIyLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiIH19PlxuICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIHdpZHRoOiBgJHsodG90YWwgLyBtYXgpICogMTAwfSVgLCBoZWlnaHQ6IDEyLCBnYXA6IDEsIG1pbldpZHRoOiB0b3RhbCA+IDAgPyAyIDogMCB9fT5cbiAgICAgICAgICAgICAgICAgIHtyLnNlZ21lbnRzXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKHMpID0+IHMudmFsdWUgPiAwKVxuICAgICAgICAgICAgICAgICAgICAubWFwKChzLCBrLCBhcnIpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXk9e3MubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZsZXg6IHMudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHMuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJvcmRlclJhZGl1czogYCR7ayA9PT0gMCA/IDIgOiAwfXB4ICR7ayA9PT0gYXJyLmxlbmd0aCAtIDEgPyAyIDogMH1weCAke2sgPT09IGFyci5sZW5ndGggLSAxID8gMiA6IDB9cHggJHtrID09PSAwID8gMiA6IDB9cHhgLFxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIHRleHRBbGlnbjogXCJyaWdodFwiLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIgfX0+e3IudmFsdWVUZXh0fTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICk7XG4gICAgICAgIH0pfVxuICAgICAgPC9kaXY+XG4gICAgICB7aG92ZXIgJiYgcm93c1tob3Zlci5pXSAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e2hvdmVyLnggKyAoZmxpcCA/IC0xMiA6IDEyKX0geT17aG92ZXIueSArIDEyfSBmbGlwPXtmbGlwfSBmaXhlZD5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRXZWlnaHQ6IDYwMCB9fT57cm93c1tob3Zlci5pXS5sYWJlbH08L2Rpdj5cbiAgICAgICAgICB7cm93c1tob3Zlci5pXS50aXAubWFwKCh0KSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17dH0+e3R9PC9kaXY+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvVG9vbHRpcD5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbi8qKiBgdG9uZWAgY29sb3JzIHRoZSB2YWx1ZSBhbmQgYm9yZGVyIChmaXhlZCBydWxlcyk7IGBvdXRsaW5lYCBvbmx5IGNvbG9ycyB0aGUgYm9yZGVyIChhdmVyYWdlIGRldmlhdGlvbikuICovXG5mdW5jdGlvbiBUaWxlKHtcbiAgYXBpLFxuICBsYWJlbCxcbiAgdmFsdWUsXG4gIGRlbHRhLFxuICB0b25lLFxuICBvdXRsaW5lLFxufToge1xuICBhcGk6IFBsdWdpbkFwaTtcbiAgbGFiZWw6IHN0cmluZztcbiAgdmFsdWU6IHN0cmluZztcbiAgZGVsdGE/OiBzdHJpbmdbXTtcbiAgdG9uZT86IFN0YXR1c0NvbG9yIHwgbnVsbDtcbiAgb3V0bGluZT86IFN0YXR1c0NvbG9yIHwgbnVsbDtcbn0pIHtcbiAgY29uc3QgYm9yZGVyID0gd29yc3RUb25lKFt0b25lLCBvdXRsaW5lXSk7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBtaW5XaWR0aDogMCxcbiAgICAgICAgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIixcbiAgICAgICAgYmFja2dyb3VuZDogcC5zdXJmYWNlLFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHtib3JkZXIgPyBwLnN0YXR1c1tib3JkZXJdIDogcC5ib3JkZXJ9YCxcbiAgICAgICAgYm9yZGVyUmFkaXVzOiA2LFxuICAgICAgICBwYWRkaW5nOiBcIjEwcHggMTJweFwiLFxuICAgICAgICBkaXNwbGF5OiBcImZsZXhcIixcbiAgICAgICAgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIixcbiAgICAgICAgZ2FwOiAyLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT57bGFiZWx9PC9zcGFuPlxuICAgICAgPHNwYW4gc3R5bGU9e3sgZm9udFNpemU6IDIyLCBsaW5lSGVpZ2h0OiBcIjMwcHhcIiwgZm9udFdlaWdodDogNjAwLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIsIGNvbG9yOiB0b25lID8gcC5zdGF0dXNbdG9uZV0gOiB1bmRlZmluZWQgfX0+e3ZhbHVlfTwvc3Bhbj5cbiAgICAgIHtkZWx0YT8ubWFwKChkKSA9PiAoXG4gICAgICAgIDxzcGFuIGtleT17ZH0gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAge2R9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICkpfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogV3JhcHBpbmcgcm93IG9mIGNhcmRzOiBldmVyeSByb3cgaXMgZmlsbGVkIGVkZ2UgdG8gZWRnZSBhbmQgaXRzIGNhcmRzIHNoYXJlIG9uZSBoZWlnaHQuICovXG5jb25zdCBUSUxFX01JTiA9IDEzMDtcbmNvbnN0IEdBUCA9IDEyO1xuXG4vKiogU3RhdCB0aWxlcyBpbiBlcXVhbCBjb2x1bW5zOyB3aGVuIHRoZXkgZG9uJ3QgZml0IG9uIG9uZSByb3cgdGhleSBzcGxpdCBpbnRvIGJhbGFuY2VkIHJvd3MgKDYgLT4gMyszIC0+IDIrMisyKS4gKi9cbmZ1bmN0aW9uIFRpbGVSb3coeyBjaGlsZHJlbiB9OiB7IGNoaWxkcmVuOiBSZWFjdE5vZGVbXSB9KSB7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IG4gPSBNYXRoLm1heCgxLCBjaGlsZHJlbi5sZW5ndGgpO1xuICBjb25zdCBmaXQgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKCh3aWR0aCArIEdBUCkgLyAoVElMRV9NSU4gKyBHQVApKSk7XG4gIGNvbnN0IGNvbHMgPSB3aWR0aCA/IE1hdGguY2VpbChuIC8gTWF0aC5jZWlsKG4gLyBNYXRoLm1pbihmaXQsIG4pKSkgOiBuO1xuICByZXR1cm4gKFxuICAgIDxkaXYgcmVmPXtyZWZ9IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBgcmVwZWF0KCR7Y29sc30sIG1pbm1heCgwLCAxZnIpKWAsIGdhcDogR0FQIH19PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5jb25zdCBGbG93ID0gKHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pID0+IDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhXcmFwOiBcIndyYXBcIiwgYWxpZ25JdGVtczogXCJzdHJldGNoXCIsIGdhcDogMTIgfX0+e2NoaWxkcmVufTwvZGl2PjtcblxuLyoqIE9ubHkgd2FybmluZy9lcnJvciB0b25lcyBvdXRsaW5lIGEgY2FyZDsgYW55dGhpbmcgZWxzZSBrZWVwcyB0aGUgbm9ybWFsIGJvcmRlci4gKi9cbmNvbnN0IGFsZXJ0VG9uZSA9IChzOiBTdGF0dXNDb2xvciB8IG51bGwgfCB1bmRlZmluZWQpOiBTdGF0dXNDb2xvciB8IG51bGwgPT4gKHMgPT09IFwid2FybmluZ1wiIHx8IHMgPT09IFwiZXJyb3JcIiA/IHMgOiBudWxsKTtcblxuZnVuY3Rpb24gU2VjdGlvbih7IGFwaSwgdGl0bGUsIGV4dHJhLCB0b25lLCBjaGlsZHJlbiB9OiB7IGFwaTogUGx1Z2luQXBpOyB0aXRsZTogc3RyaW5nOyBleHRyYT86IFJlYWN0Tm9kZTsgdG9uZT86IFN0YXR1c0NvbG9yIHwgbnVsbDsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgdCA9IGFsZXJ0VG9uZSh0b25lKTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBmbGV4OiBcIjEgMSAzMjBweFwiLFxuICAgICAgICBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3QgPyBwLnN0YXR1c1t0XSA6IHAuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNixcbiAgICAgICAgcGFkZGluZzogMTIsXG4gICAgICAgIGRpc3BsYXk6IFwiZmxleFwiLFxuICAgICAgICBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLFxuICAgICAgICBnYXA6IDgsXG4gICAgICAgIG1pbldpZHRoOiAwLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBmbGV4V3JhcDogXCJ3cmFwXCIgfX0+XG4gICAgICAgIDxzdHJvbmcgc3R5bGU9e3sgZmxleDogMSB9fT57dGl0bGV9PC9zdHJvbmc+XG4gICAgICAgIHtleHRyYX1cbiAgICAgIDwvZGl2PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1ldHJpYyB2aWV3cyAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBUcmVuZCB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGtleTogc3RyaW5nO1xuICBnZXQ6IChkb2M6IEpzb24pID0+IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ7XG59XG5cbi8qKiBUaWxlIHZhbHVlIGZyb20gdGhlIGxhdGVzdCBkb2MsIGRlbHRhIGFnYWluc3QgdGhlIHByZXZpb3VzIGRheSBpbiBoaXN0b3J5LiAqL1xuZnVuY3Rpb24gdHJlbmRUaWxlKGFwaTogUGx1Z2luQXBpLCBkYXlzOiBEYXlbXSwgdDogVHJlbmQpIHtcbiAgY29uc3QgdmFscyA9IGRheXMubWFwKChkKSA9PiB0LmdldChkLmRvYykpO1xuICBjb25zdCBjdXIgPSB2YWxzW3ZhbHMubGVuZ3RoIC0gMV07XG4gIGNvbnN0IHByZXYgPSB2YWxzLmxlbmd0aCA+IDEgPyB2YWxzW3ZhbHMubGVuZ3RoIC0gMl0gOiB1bmRlZmluZWQ7XG4gIGxldCBkZWx0YTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY3VyID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBwcmV2ID09PSBcIm51bWJlclwiKSB7XG4gICAgY29uc3QgZCA9IGN1ciAtIHByZXY7XG4gICAgY29uc3QgYWJzID0gTU9ORVlfS0VZLnRlc3QodC5rZXkpID8gbW9uZXkuZm9ybWF0KE1hdGguYWJzKGQpKSA6IE1hdGguYWJzKGQpLnRvTG9jYWxlU3RyaW5nKCk7XG4gICAgZGVsdGEgPSBgJHtkID4gMCA/IFwiK1wiIDogZCA8IDAgPyBcIi1cIiA6IFwiXHUwMEIxXCJ9JHthYnN9IHZzICR7c2hvcnREYXRlKGRheXNbZGF5cy5sZW5ndGggLSAyXS5kYXRlKX1gO1xuICB9XG4gIGNvbnN0IGF2ZyA9IGF2ZXJhZ2VDaGVjayh2YWxzLCBFUlJPUl9LRVlTLmhhcyh0LmtleSkpO1xuICBjb25zdCBhdmdUZXh0ID0gYXZnID8gYCR7YXZnLmNoYW5nZSA+PSAwID8gXCIrXCIgOiBcIi1cIn0ke01hdGgucm91bmQoTWF0aC5hYnMoYXZnLmNoYW5nZSkgKiAxMDApfSUgdnMgJHtheGlzRm10KHQua2V5KShhdmcuYXZnKX0gYXZnYCA6IG51bGw7XG4gIHJldHVybiAoXG4gICAgPFRpbGVcbiAgICAgIGtleT17dC50aXRsZX1cbiAgICAgIGFwaT17YXBpfVxuICAgICAgbGFiZWw9e3QudGl0bGV9XG4gICAgICB2YWx1ZT17Zm10KGN1ciwgdC5rZXkpfVxuICAgICAgZGVsdGE9e1tkZWx0YSwgYXZnVGV4dF0uZmlsdGVyKChkKTogZCBpcyBzdHJpbmcgPT4gISFkKX1cbiAgICAgIHRvbmU9e3ZhbHVlVG9uZSh0LmtleSwgY3VyKX1cbiAgICAgIG91dGxpbmU9e2F2Zz8udG9uZX1cbiAgICAvPlxuICApO1xufVxuXG4vKiogTWV0cmljcyB3aGVyZSBoaWdoZXIgaXMgd29yc2U7IHZhbHVlVG9uZSBjb2xvcnMgYW55IG5vbi16ZXJvIHZhbHVlIG9mIHRoZXNlLiAqL1xuY29uc3QgRVJST1JfS0VZUyA9IG5ldyBTZXQoW1wiaW5BbGFybVwiLCBcImxhbWJkYUVycm9yc1wiLCBcImVycm9yczV4eFwiXSk7XG5cbmNvbnN0IEFWR19NSU5fREFZUyA9IDM7XG5jb25zdCBBVkdfV0FSTklORyA9IDE7IC8vIDEwMCUgYXdheSBmcm9tIHRoZSBhdmVyYWdlXG5jb25zdCBBVkdfRVJST1IgPSA1OyAvLyA1MDAlIGF3YXkgZnJvbSB0aGUgYXZlcmFnZVxuXG4vKipcbiAqIENvbXBhcmVzIHRoZSBsYXRlc3QgdmFsdWUgd2l0aCB0aGUgYXZlcmFnZSBvZiBldmVyeSBlYXJsaWVyIGRheSBpbiBoaXN0b3J5LlxuICogTnVsbCB1bnRpbCB0aGVyZSBhcmUgQVZHX01JTl9EQVlTIGVhcmxpZXIga25vd24gdmFsdWVzLCBvciB3aGVuIHRoZSBhdmVyYWdlIGlzIDAgKG5vIHBlcmNlbnRhZ2UgZXhpc3RzKS5cbiAqIGB1cE9ubHlgIChlcnJvci10eXBlIG1ldHJpY3MpOiBvbmx5IGEgcmlzZSBhYm92ZSB0aGUgYXZlcmFnZSBjb3VudHM7IGZhbGxpbmcgZXJyb3JzIGFyZSBnb29kIG5ld3MuXG4gKi9cbmZ1bmN0aW9uIGF2ZXJhZ2VDaGVjayh2YWxzOiAobnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZClbXSwgdXBPbmx5ID0gZmFsc2UpOiB7IGF2ZzogbnVtYmVyOyBjaGFuZ2U6IG51bWJlcjsgdG9uZTogU3RhdHVzQ29sb3IgfCBudWxsIH0gfCBudWxsIHtcbiAgY29uc3QgY3VyID0gdmFsc1t2YWxzLmxlbmd0aCAtIDFdO1xuICBjb25zdCBwcmV2ID0gdmFscy5zbGljZSgwLCAtMSkuZmlsdGVyKCh2KTogdiBpcyBudW1iZXIgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpO1xuICBpZiAodHlwZW9mIGN1ciAhPT0gXCJudW1iZXJcIiB8fCBwcmV2Lmxlbmd0aCA8IEFWR19NSU5fREFZUykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGF2ZyA9IHByZXYucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgLyBwcmV2Lmxlbmd0aDtcbiAgaWYgKGF2ZyA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGNoYW5nZSA9IChjdXIgLSBhdmcpIC8gTWF0aC5hYnMoYXZnKTtcbiAgY29uc3QgZGV2ID0gdXBPbmx5ID8gY2hhbmdlIDogTWF0aC5hYnMoY2hhbmdlKTtcbiAgcmV0dXJuIHsgYXZnLCBjaGFuZ2UsIHRvbmU6IGRldiA+PSBBVkdfRVJST1IgPyBcImVycm9yXCIgOiBkZXYgPj0gQVZHX1dBUk5JTkcgPyBcIndhcm5pbmdcIiA6IG51bGwgfTtcbn1cblxuLyoqIE9uZSBjYXJkIHBlciB0cmVuZCB0aGF0IGhhcyBkYXRhOyByZW5kZXJlZCBhcyBhIGZyYWdtZW50IHNvIHRoZSBjYXJkcyBqb2luIHRoZSBzdXJyb3VuZGluZyBGbG93LiAqL1xuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RyZW5kc1xuICAgICAgICAubWFwKCh0KSA9PiAoeyB0LCBwb2ludHM6IGRheXMubWFwKChkKSA9PiAoeyBsYWJlbDogc2hvcnREYXRlKGQuZGF0ZSksIHJhdzogdC5nZXQoZC5kb2MpIH0pKSB9KSlcbiAgICAgICAgLmZpbHRlcigoeyBwb2ludHMgfSkgPT4gcG9pbnRzLnNvbWUoKHB0KSA9PiBwdC5yYXcgIT09IHVuZGVmaW5lZCkpXG4gICAgICAgIC5tYXAoKHsgdCwgcG9pbnRzIH0pID0+IChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAga2V5PXt0LnRpdGxlfVxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT17YCR7dC50aXRsZX0gVHJlbmRgfVxuICAgICAgICAgICAgdG9uZT17XG4gICAgICAgICAgICAgIGF2ZXJhZ2VDaGVjayhcbiAgICAgICAgICAgICAgICBwb2ludHMubWFwKChwdCkgPT4gcHQucmF3KSxcbiAgICAgICAgICAgICAgICBFUlJPUl9LRVlTLmhhcyh0LmtleSksXG4gICAgICAgICAgICAgICk/LnRvbmVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA+XG4gICAgICAgICAgICA8TGluZUNoYXJ0XG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICBsYWJlbHM9e3BvaW50cy5tYXAoKHB0KSA9PiBwdC5sYWJlbCl9XG4gICAgICAgICAgICAgIHNlcmllcz17W3sgbmFtZTogdC50aXRsZSwgY29sb3I6IGFwaS50aGVtZS5wYWxldHRlLmFjY2VudCwgdmFsdWVzOiBwb2ludHMubWFwKChwdCkgPT4gcHQucmF3ID8/IG51bGwpIH1dfVxuICAgICAgICAgICAgICBmb3JtYXQ9e2F4aXNGbXQodC5rZXkpfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgIDwvPlxuICApO1xufVxuXG5mdW5jdGlvbiBIaXN0b3J5SGludCh7IGFwaSwgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGlmIChkYXlzLmxlbmd0aCA+PSAyKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBhcGkudGhlbWUucGFsZXR0ZS50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5UcmVuZHMgZmlsbCBpbiBhcyBkYWlseSBoaXN0b3J5IGFjY3VtdWxhdGVzICh7ZGF5cy5sZW5ndGh9IGRheSBzbyBmYXIpLjwvc3Bhbj47XG59XG5cbmZ1bmN0aW9uIGNvc3RSb3dzKGFwaTogUGx1Z2luQXBpLCBjb3N0OiBKc29uKTogQmFyUm93W10ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiBPYmplY3QuZW50cmllcyhjb3N0Py5ieVRhZyA/PyB7fSlcbiAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpXG4gICAgLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gKGIgYXMgbnVtYmVyKSAtIChhIGFzIG51bWJlcikpXG4gICAgLm1hcCgoW2ssIHZdKSA9PiAoe1xuICAgICAgbGFiZWw6IGssXG4gICAgICBzZWdtZW50czogW3sgbmFtZTogXCJDb3N0XCIsIHZhbHVlOiB2IGFzIG51bWJlciwgY29sb3I6IHAuYWNjZW50IH1dLFxuICAgICAgdmFsdWVUZXh0OiBtb25leS5mb3JtYXQodiBhcyBudW1iZXIpLFxuICAgICAgdGlwOiBbYCR7bW9uZXkuZm9ybWF0KHYgYXMgbnVtYmVyKX0gKCR7Y29zdC50b3RhbCA/ICgoKHYgYXMgbnVtYmVyKSAvIGNvc3QudG90YWwpICogMTAwKS50b0ZpeGVkKDEpIDogXCIwXCJ9JSBvZiB0b3RhbClgXSxcbiAgICB9KSk7XG59XG5cbi8qKiBBcHBzIHRvbyBzbWFsbCBmb3IgdGhlaXIgb3duIHRhYjsgdGhleSBnZXQgb25lIGludm9jYXRpb25zLXZzLWVycm9ycyBjYXJkIG9uIHRoZSBPdmVydmlldyBpbnN0ZWFkLiAqL1xuY29uc3QgT1ZFUlZJRVdfT05MWV9BUFBTOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBTZWNyZXRzTWFuYWdlcjogXCJHbG9iYWwgU2VjcmV0cyBUcmVuZFwiIH07XG5cbi8qKiBTdW0gb2YgYSBMYW1iZGEgbWV0cmljIGFjcm9zcyBhbiBhcHAncyBmdW5jdGlvbnM7IHVua25vd24gaWYgYW55IGZ1bmN0aW9uJ3MgdmFsdWUgaXMgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIGxhbWJkYVN1bShhcHA6IEpzb24sIGZpZWxkOiBcImludm9jYXRpb25zXCIgfCBcImVycm9yc1wiKTogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGxhbWJkYXMgPSBhcHA/Lm1vbml0b3Jpbmc/LmxhbWJkYXM7XG4gIGlmIChsYW1iZGFzID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChsYW1iZGFzID09PSBudWxsIHx8IGlzRXJyb3JOb2RlKGxhbWJkYXMpIHx8IGlzRXJyb3JOb2RlKGFwcC5tb25pdG9yaW5nKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHZhbHMgPSBPYmplY3QudmFsdWVzKGxhbWJkYXMpLm1hcCgodikgPT4gbWV0cmljKHYsIGZpZWxkKSk7XG4gIHJldHVybiB2YWxzLnNvbWUoKHYpID0+IHR5cGVvZiB2ICE9PSBcIm51bWJlclwiKSA/IG51bGwgOiAodmFscyBhcyBudW1iZXJbXSkucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG59XG5cbmZ1bmN0aW9uIEludm9jYXRpb25zVHJlbmQoeyBhcGksIGRheXMsIGFwcE5hbWUsIHRpdGxlIH06IHsgYXBpOiBQbHVnaW5BcGk7IGRheXM6IERheVtdOyBhcHBOYW1lOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmcgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBhcHA6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHBOYW1lKSB9KSkuZmlsdGVyKChkKSA9PiBkLmFwcCk7XG4gIGlmIChhcHBEYXlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNlcmllczogU2VyaWVzW10gPSBbXG4gICAgeyBuYW1lOiBcIkludm9jYXRpb25zXCIsIGNvbG9yOiBwLmFjY2VudCwgdmFsdWVzOiBhcHBEYXlzLm1hcCgoZCkgPT4gbGFtYmRhU3VtKGQuYXBwLCBcImludm9jYXRpb25zXCIpID8/IG51bGwpIH0sXG4gICAgeyBuYW1lOiBcIkVycm9yc1wiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IsIHZhbHVlczogYXBwRGF5cy5tYXAoKGQpID0+IGxhbWJkYVN1bShkLmFwcCwgXCJlcnJvcnNcIikgPz8gbnVsbCkgfSxcbiAgXTtcbiAgcmV0dXJuIChcbiAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9e3RpdGxlfSB0b25lPXthdmVyYWdlQ2hlY2soc2VyaWVzWzFdLnZhbHVlcywgdHJ1ZSk/LnRvbmV9IGV4dHJhPXs8TGVnZW5kIGFwaT17YXBpfSBpdGVtcz17c2VyaWVzfSAvPn0+XG4gICAgICA8TGluZUNoYXJ0IGFwaT17YXBpfSBsYWJlbHM9e2FwcERheXMubWFwKChkKSA9PiBzaG9ydERhdGUoZC5kYXRlKSl9IHNlcmllcz17c2VyaWVzfSBmb3JtYXQ9e2F4aXNGbXQoXCJcIil9IC8+XG4gICAgPC9TZWN0aW9uPlxuICApO1xufVxuXG5jb25zdCBPVkVSVklFV19UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiQVdTIENvc3QgKDMwZClcIiwga2V5OiBcImNvc3RcIiwgZ2V0OiAoZCkgPT4gbWV0cmljKGQsIFwiYXdzQ29zdC50b3RhbFwiKSB9LFxuICB7IHRpdGxlOiBcIlJlcXVlc3RzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpIH0sXG4gIHsgdGl0bGU6IFwiTGFtYmRhIEVycm9ycyAoMjRoKVwiLCBrZXk6IFwibGFtYmRhRXJyb3JzXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCI1eHggRXJyb3JzICgyNGgpXCIsIGtleTogXCJlcnJvcnM1eHhcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLmVycm9yczV4eFwiKSB9LFxuICB7IHRpdGxlOiBcIkFsYXJtcyBGaXJpbmdcIiwga2V5OiBcImluQWxhcm1cIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcImhlYWx0aC5hbGFybXMuaW5BbGFybVwiKSB9LFxuICB7IHRpdGxlOiBcIlBheWluZyBDdXN0b21lcnNcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuXTtcblxuZnVuY3Rpb24gT3ZlcnZpZXcoeyBhcGksIGRvYywgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkb2M6IEpzb247IGRheXM6IERheVtdIH0pIHtcbiAgY29uc3QgeyBTdGF0dXNEb3QgfSA9IGFwaS51aTtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBhcHBzID0gYXBwc09mKGRvYyk7XG4gIGNvbnN0IGNvc3QgPSBkb2MuYXdzQ29zdDtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVSb3c+e09WRVJWSUVXX1RSRU5EUy5maWx0ZXIoKHQpID0+IHQuZ2V0KGRvYykgIT09IHVuZGVmaW5lZCkubWFwKCh0KSA9PiB0cmVuZFRpbGUoYXBpLCBkYXlzLCB0KSl9PC9UaWxlUm93PlxuICAgICAgPEhpc3RvcnlIaW50IGFwaT17YXBpfSBkYXlzPXtkYXlzfSAvPlxuICAgICAgPEZsb3c+XG4gICAgICAgIDxUcmVuZENoYXJ0cyBhcGk9e2FwaX0gZGF5cz17ZGF5c30gdHJlbmRzPXtPVkVSVklFV19UUkVORFMuc2xpY2UoMCwgMyl9IC8+XG4gICAgICAgIHtPYmplY3QuZW50cmllcyhPVkVSVklFV19PTkxZX0FQUFMpLm1hcCgoW25hbWUsIHRpdGxlXSkgPT4gKFxuICAgICAgICAgIDxJbnZvY2F0aW9uc1RyZW5kIGtleT17bmFtZX0gYXBpPXthcGl9IGRheXM9e2RheXN9IGFwcE5hbWU9e25hbWV9IHRpdGxlPXt0aXRsZX0gLz5cbiAgICAgICAgKSl9XG4gICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT1cIkFwcHNcIiB0b25lPXt3b3JzdChhcHBzLm1hcChhcHBTdGF0dXMpKX0+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJhdXRvIDFmciBtYXgtY29udGVudCBtYXgtY29udGVudCBtYXgtY29udGVudFwiLCBnYXA6IFwiNHB4IDEycHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiB9fT5cbiAgICAgICAgICAgIHtbXCJcIiwgXCJBcHBcIiwgXCJSZXF1ZXN0c1wiLCBcIkVycm9yc1wiLCBcIlByb2ZpdCAoMzBkKVwiXS5tYXAoKGgpID0+IChcbiAgICAgICAgICAgICAgPHNwYW4ga2V5PXtoIHx8IFwiZG90XCJ9IHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgICAgICAgIHtofVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgICAgIHthcHBzLm1hcCgoYSkgPT4gKFxuICAgICAgICAgICAgICA8ZGl2IGtleT17YS5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0+XG4gICAgICAgICAgICAgICAgPFN0YXR1c0RvdCBjb2xvcj17YXBwU3RhdHVzKGEpfSAvPlxuICAgICAgICAgICAgICAgIDxzcGFuPnthLm5hbWV9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uZXkucHJvZml0MzBkXCIpLCBcInByb2ZpdFwiKX08L3NwYW4+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPXtgQVdTIENvc3QgQnkgUHJvamVjdCR7Y29zdCAmJiAhaXNFcnJvck5vZGUoY29zdCkgPyBgICgke3Nob3J0RGF0ZShjb3N0LndpbmRvd1N0YXJ0KX0gVG8gJHtzaG9ydERhdGUoY29zdC53aW5kb3dFbmQpfSlgIDogXCJcIn1gfT5cbiAgICAgICAgICB7IWNvc3QgfHwgaXNFcnJvck5vZGUoY29zdCkgPyA8c3Bhbj57Zm10KGNvc3QpfTwvc3Bhbj4gOiA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17Y29zdFJvd3MoYXBpLCBjb3N0KX0gLz59XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgIDwvRmxvdz5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gbGFtYmRhUm93cyhhcGk6IFBsdWdpbkFwaSwgbGFtYmRhczogSnNvbik6IHsgcm93czogQmFyUm93W107IGlkbGU6IG51bWJlcjsgdW5rbm93bjogc3RyaW5nW10gfSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3Qgcm93czogQmFyUm93W10gPSBbXTtcbiAgY29uc3QgdW5rbm93bjogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGlkbGUgPSAwO1xuICBmb3IgKGNvbnN0IFtmbiwgdl0gb2YgT2JqZWN0LmVudHJpZXMobGFtYmRhcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSkge1xuICAgIGNvbnN0IGludiA9IG1ldHJpYyh2LCBcImludm9jYXRpb25zXCIpO1xuICAgIGlmICh0eXBlb2YgaW52ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB1bmtub3duLnB1c2goZm4pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbnYgPT09IDApIHtcbiAgICAgIGlkbGUrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBlcnIgPSBtZXRyaWModiwgXCJlcnJvcnNcIikgPz8gMDtcbiAgICBjb25zdCB0aHIgPSBtZXRyaWModiwgXCJ0aHJvdHRsZXNcIikgPz8gMDtcbiAgICByb3dzLnB1c2goe1xuICAgICAgbGFiZWw6IGZuLFxuICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgeyBuYW1lOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogTWF0aC5tYXgoMCwgaW52IC0gZXJyKSwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgdmFsdWU6IGVyciwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICBdLFxuICAgICAgdmFsdWVUZXh0OiBlcnIgPyBgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gKCR7KChlcnIgLyBpbnYpICogMTAwKS50b0ZpeGVkKDApfSUgRXJyKWAgOiBpbnYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgIHRpcDogW2Ake2ludi50b0xvY2FsZVN0cmluZygpfSBpbnZvY2F0aW9uc2AsIGAke2Vyci50b0xvY2FsZVN0cmluZygpfSBlcnJvcnNgLCBgJHt0aHIudG9Mb2NhbGVTdHJpbmcoKX0gdGhyb3R0bGVzYF0sXG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzWzBdLnZhbHVlICsgYi5zZWdtZW50c1sxXS52YWx1ZSAtIChhLnNlZ21lbnRzWzBdLnZhbHVlICsgYS5zZWdtZW50c1sxXS52YWx1ZSkpO1xuICByZXR1cm4geyByb3dzLCBpZGxlLCB1bmtub3duIH07XG59XG5cbmZ1bmN0aW9uIGFwaVJvd3MoYXBpOiBQbHVnaW5BcGksIGFwaXM6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChPYmplY3QuZW50cmllcyhhcGlzID8/IHt9KSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgbWV0cmljKHYsIFwicmVxdWVzdHNcIikgPT09IFwibnVtYmVyXCIpXG4gICAgLm1hcCgoW25hbWUsIHZdKSA9PiB7XG4gICAgICBjb25zdCByZXEgPSBtZXRyaWModiwgXCJyZXF1ZXN0c1wiKSBhcyBudW1iZXI7XG4gICAgICBjb25zdCBlNCA9IG1ldHJpYyh2LCBcImVycm9yczR4eFwiKSA/PyAwO1xuICAgICAgY29uc3QgZTUgPSBtZXRyaWModiwgXCJlcnJvcnM1eHhcIikgPz8gMDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGxhYmVsOiBuYW1lLFxuICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgIHsgbmFtZTogXCJPS1wiLCB2YWx1ZTogTWF0aC5tYXgoMCwgcmVxIC0gZTQgLSBlNSksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgIHsgbmFtZTogXCI0eHhcIiwgdmFsdWU6IGU0LCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgIHsgbmFtZTogXCI1eHhcIiwgdmFsdWU6IGU1LCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgXSxcbiAgICAgICAgdmFsdWVUZXh0OiByZXEudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgdGlwOiBbYCR7cmVxLnRvTG9jYWxlU3RyaW5nKCl9IHJlcXVlc3RzYCwgYCR7ZTQudG9Mb2NhbGVTdHJpbmcoKX0gNHh4LCAke2U1LnRvTG9jYWxlU3RyaW5nKCl9IDV4eGAsIGBwOTUgbGF0ZW5jeTogJHtmbXQodi5wOTVMYXRlbmN5TXMsIFwibGF0ZW5jeW1zXCIpfWBdLFxuICAgICAgfTtcbiAgICB9KVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzLnJlZHVjZSgocywgeCkgPT4gcyArIHgudmFsdWUsIDApIC0gYS5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSk7XG59XG5cbmZ1bmN0aW9uIFJvd3MoeyBhcGksIHZhbHVlLCBwYXRoID0gXCJcIiB9OiB7IGFwaTogUGx1Z2luQXBpOyB2YWx1ZTogSnNvbjsgcGF0aD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBpc0Vycm9yTm9kZSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gPHNwYW4+e2ZtdCh2YWx1ZSwgcGF0aCl9PC9zcGFuPjtcbiAgfVxuICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgdl0pID0+ICEodHlwZW9mIHYgPT09IFwic3RyaW5nXCIgJiYgKHYubGVuZ3RoID4gODAgfHwgdi5pbmNsdWRlcyhcIlxcblwiKSkpKTtcbiAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwibWF4LWNvbnRlbnQgMWZyXCIsIGdhcDogXCIycHggMTZweFwiIH19PlxuICAgICAge2VudHJpZXMubWFwKChbaywgdl0pID0+IHtcbiAgICAgICAgY29uc3QgbmVzdGVkID0gdiAhPT0gbnVsbCAmJiB0eXBlb2YgdiA9PT0gXCJvYmplY3RcIiAmJiAhaXNFcnJvck5vZGUodik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPGRpdiBrZXk9e2t9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fT5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57dGl0bGVDYXNlKGspfTwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiB2YWx1ZVRvbmUoaywgdikgPyBwLnN0YXR1c1t2YWx1ZVRvbmUoaywgdikgYXMgU3RhdHVzQ29sb3JdIDogdW5kZWZpbmVkIH19PlxuICAgICAgICAgICAgICB7bmVzdGVkID8gQXJyYXkuaXNBcnJheSh2KSA/IDxzcGFuPnt2Lmxlbmd0aCA/IHYuam9pbihcIiwgXCIpIDogXCJOb25lXCJ9PC9zcGFuPiA6IDxSb3dzIGFwaT17YXBpfSB2YWx1ZT17dn0gcGF0aD17a30gLz4gOiBmbXQodiwgayl9XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICk7XG4gICAgICB9KX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgdGl0bGVDYXNlID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC8oW0EtWl0pL2csIFwiICQxXCIpLnJlcGxhY2UoL14uLywgKGMpID0+IGMudG9VcHBlckNhc2UoKSk7XG5cbmNvbnN0IEFQUF9UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcImxhbWJkYUVycm9yc1wiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuICB7IHRpdGxlOiBcIk1SUlwiLCBrZXk6IFwibXJyXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5Lm1yclwiKSB9LFxuICB7IHRpdGxlOiBcIlByb2ZpdCAoMzBkKVwiLCBrZXk6IFwicHJvZml0XCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSB9LFxuXTtcblxuZnVuY3Rpb24gQXBwVmlldyh7IGFwaSwgYXBwLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGFwcDogSnNvbjsgZGF5czogRGF5W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBkb2M6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHAubmFtZSkgfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpO1xuICBjb25zdCBtb24gPSBhcHAubW9uaXRvcmluZztcbiAgY29uc3QgYXVkID0gYXBwLmF1ZGllbmNlO1xuICBjb25zdCBhdWREYXlzOiBKc29uW10gPSBhdWQgJiYgQXJyYXkuaXNBcnJheShhdWQuZGF5cykgPyBhdWQuZGF5cyA6IFtdO1xuICBjb25zdCBhdWRLZXlzID0gYXVkRGF5cy5sZW5ndGggPyBPYmplY3Qua2V5cyhhdWREYXlzWzBdKS5maWx0ZXIoKGspID0+IGsgIT09IFwiZGF0ZVwiICYmIHR5cGVvZiBhdWREYXlzWzBdW2tdID09PSBcIm51bWJlclwiKSA6IFtdO1xuICBjb25zdCBsYW1iZGFzID0gbW9uICYmICFpc0Vycm9yTm9kZShtb24pICYmICFpc0Vycm9yTm9kZShtb24ubGFtYmRhcykgPyBsYW1iZGFSb3dzKGFwaSwgbW9uLmxhbWJkYXMpIDogbnVsbDtcbiAgY29uc3QgYXBpcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmFwaXMpID8gYXBpUm93cyhhcGksIG1vbi5hcGlzKSA6IG51bGw7XG4gIGNvbnN0IGRldGFpbHMgPSBPYmplY3QuZW50cmllcyhhcHApLmZpbHRlcigoW2tdKSA9PiBrICE9PSBcIm5hbWVcIiAmJiBrICE9PSBcIm1vbml0b3JpbmdcIik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVSb3c+e0FQUF9UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChhcHApICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgYXBwRGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17YXBwRGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2FwcERheXN9IHRyZW5kcz17QVBQX1RSRU5EU30gLz5cbiAgICAgICAge21vbiAmJiBpc0Vycm9yTm9kZShtb24pICYmIChcbiAgICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJNb25pdG9yaW5nICgyNGgpXCIgdG9uZT1cIndhcm5pbmdcIj5cbiAgICAgICAgICAgIDxzcGFuPntmbXQobW9uKX08L3NwYW4+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7YXBpcyAmJiBhcGlzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uXG4gICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgIHRpdGxlPVwiQVBJIFJlcXVlc3RzICgyNGgpXCJcbiAgICAgICAgICAgIHRvbmU9e2FwaXMuc29tZSgocikgPT4gci5zZWdtZW50cy5zb21lKChzKSA9PiBzLm5hbWUgPT09IFwiNXh4XCIgJiYgcy52YWx1ZSA+IDApKSA/IFwid2FybmluZ1wiIDogbnVsbH1cbiAgICAgICAgICAgIGV4dHJhPXtcbiAgICAgICAgICAgICAgPExlZ2VuZFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIGl0ZW1zPXtbXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiT0tcIiwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiNHh4XCIsIGNvbG9yOiBwLnN0YXR1cy53YXJuaW5nIH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiNXh4XCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgICAgICAgICAgIF19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICB9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2FwaXN9IC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7bGFtYmRhcyAmJiBsYW1iZGFzLnJvd3MubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgPFNlY3Rpb25cbiAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgdGl0bGU9XCJMYW1iZGEgSW52b2NhdGlvbnMgKDI0aClcIlxuICAgICAgICAgICAgdG9uZT17bGFtYmRhcy5yb3dzLnNvbWUoKHIpID0+IHIuc2VnbWVudHMuc29tZSgocykgPT4gcy5uYW1lID09PSBcIkVycm9yc1wiICYmIHMudmFsdWUgPiAwKSkgPyBcImVycm9yXCIgOiBudWxsfVxuICAgICAgICAgICAgZXh0cmE9e1xuICAgICAgICAgICAgICA8TGVnZW5kXG4gICAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgICAgaXRlbXM9e1tcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCJTdWNjZWVkZWRcIiwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgICAgICAgICAgIF19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICB9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2xhbWJkYXMucm93c30gLz5cbiAgICAgICAgICAgIHsobGFtYmRhcy5pZGxlID4gMCB8fCBsYW1iZGFzLnVua25vd24ubGVuZ3RoID4gMCkgJiYgKFxuICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICAgICAgICB7W2xhbWJkYXMuaWRsZSA/IGAke2xhbWJkYXMuaWRsZX0gaWRsZSBmdW5jdGlvbiR7bGFtYmRhcy5pZGxlID4gMSA/IFwic1wiIDogXCJcIn0gaGlkZGVuYCA6IFwiXCIsIGxhbWJkYXMudW5rbm93bi5sZW5ndGggPyBgVW5rbm93bjogJHtsYW1iZGFzLnVua25vd24uam9pbihcIiwgXCIpfWAgOiBcIlwiXVxuICAgICAgICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgICAgICAgICAgICAgLmpvaW4oXCIuIFwiKX1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHthdWRLZXlzLm1hcCgoaykgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17a30gYXBpPXthcGl9IHRpdGxlPXtgRGFpbHkgJHt0aXRsZUNhc2Uoayl9YH0+XG4gICAgICAgICAgICA8TGluZUNoYXJ0XG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICBsYWJlbHM9e2F1ZERheXMubWFwKChkKSA9PiBzaG9ydERhdGUoU3RyaW5nKGQuZGF0ZSkpKX1cbiAgICAgICAgICAgICAgc2VyaWVzPXtbeyBuYW1lOiB0aXRsZUNhc2UoayksIGNvbG9yOiBwLmFjY2VudCwgdmFsdWVzOiBhdWREYXlzLm1hcCgoZCkgPT4gKHR5cGVvZiBkW2tdID09PSBcIm51bWJlclwiID8gZFtrXSA6IG51bGwpKSB9XX1cbiAgICAgICAgICAgICAgZm9ybWF0PXtheGlzRm10KGspfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgICB7YXVkPy5zb3VyY2VzMzBkICYmICFpc0Vycm9yTm9kZShhdWQuc291cmNlczMwZCkgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT1cIlRyYWZmaWMgU291cmNlcyAoMzBkKVwiPlxuICAgICAgICAgICAgPEJhckxpc3RcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHJvd3M9eyhPYmplY3QuZW50cmllcyhhdWQuc291cmNlczMwZCkgYXMgW3N0cmluZywgSnNvbl1bXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpXG4gICAgICAgICAgICAgICAgLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gYiAtIGEpXG4gICAgICAgICAgICAgICAgLm1hcCgoW2ssIHZdKSA9PiAoe1xuICAgICAgICAgICAgICAgICAgbGFiZWw6IHRpdGxlQ2FzZShrKSxcbiAgICAgICAgICAgICAgICAgIHNlZ21lbnRzOiBbeyBuYW1lOiBcIlZpZXdzXCIsIHZhbHVlOiB2LCBjb2xvcjogcC5hY2NlbnQgfV0sXG4gICAgICAgICAgICAgICAgICB2YWx1ZVRleHQ6IHYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgICAgICAgICAgIHRpcDogW2Ake3YudG9Mb2NhbGVTdHJpbmcoKX0gdmlld3NgXSxcbiAgICAgICAgICAgICAgICB9KSl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2RldGFpbHMubWFwKChbaywgdl0pID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e2t9IGFwaT17YXBpfSB0aXRsZT17dGl0bGVDYXNlKGspfSB0b25lPXtncm91cFRvbmUodil9PlxuICAgICAgICAgICAgPFJvd3NcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHZhbHVlPXtrID09PSBcImF1ZGllbmNlXCIgJiYgdiAmJiAhaXNFcnJvck5vZGUodikgPyBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModikuZmlsdGVyKChba2tdKSA9PiBrayAhPT0gXCJkYXlzXCIgJiYga2sgIT09IFwic291cmNlczMwZFwiKSkgOiB2fVxuICAgICAgICAgICAgICBwYXRoPXtrfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgPC9GbG93PlxuICAgIDwvZGl2PlxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gQ29tcG9uZW50KHsgYXBpIH06IHsgYXBpOiBQbHVnaW5BcGk7IHBhbmVJZD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHsgVGV4dEJ1dHRvbiwgVGFicywgQmFubmVyLCBTcGlubmVyIH0gPSBhcGkudWk7XG4gIGNvbnN0IHBhbGV0dGUgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgWywgZm9yY2VdID0gdXNlU3RhdGUoMCk7XG4gIGNvbnN0IFt0YWIsIHNldFRhYl0gPSB1c2VTdGF0ZShcIm92ZXJ2aWV3XCIpO1xuICBjb25zdCBbLCBzZXRUaGVtZV0gPSB1c2VTdGF0ZSgwKTtcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGwgPSAoKSA9PiBmb3JjZSgobikgPT4gbiArIDEpO1xuICAgIGxpc3RlbmVycy5hZGQobCk7XG4gICAgY29uc3QgdW5zdWIgPSBhcGkudGhlbWUuc3Vic2NyaWJlKCgpID0+IHNldFRoZW1lKChuKSA9PiBuICsgMSkpO1xuICAgIGlmICghc3RhdGUuZGF0YSkge1xuICAgICAgdm9pZCBhcGkuc3RvcmFnZS5nZXQ8SnNvbj4oQ0FDSEVfS0VZKS50aGVuKChjYWNoZWQpID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhc3RhdGUuZGF0YSkgc2V0U3RhdGUoeyBkYXRhOiBjYWNoZWQgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGxpc3RlbmVycy5kZWxldGUobCk7XG4gICAgICB1bnN1YigpO1xuICAgIH07XG4gIH0sIFthcGldKTtcblxuICBjb25zdCB7IGRhdGEsIGVycm9yLCBsb2FkaW5nIH0gPSBzdGF0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkYXRhKTtcbiAgY29uc3QgZGF5cyA9IGFsbERheXMoKTtcbiAgY29uc3QgYWdlID0gZGF0YSA/IGFnZUhvdXJzKGRhdGEuZ2VuZXJhdGVkQXQpIDogbnVsbDtcbiAgY29uc3Qgc3RhbGUgPSBkYXRhICYmIChhZ2UgPT09IG51bGwgfHwgYWdlID4gU1RBTEVfSE9VUlMpO1xuICBjb25zdCB0YWJBcHBzID0gYXBwcy5maWx0ZXIoKGEpID0+ICEoYS5uYW1lIGluIE9WRVJWSUVXX09OTFlfQVBQUykpO1xuICBjb25zdCBjdXJyZW50ID0gdGFiID09PSBcIm92ZXJ2aWV3XCIgPyBudWxsIDogdGFiQXBwcy5maW5kKChhKSA9PiBhLm5hbWUgPT09IHRhYik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGZsZXg6IDEsIG1pbkhlaWdodDogMCwgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsIGdhcDogMTIsIGNvbG9yOiBwYWxldHRlLnRleHQgfX0+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBwYWRkaW5nUmlnaHQ6IDI0IH19PlxuICAgICAgICA8aDIgc3R5bGU9e3sgbWFyZ2luOiAwIH19PntOQU1FfTwvaDI+XG4gICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwYWxldHRlLnRleHRNdXRlZCwgZmxleDogMSB9fT5cbiAgICAgICAgICB7ZGF0YVxuICAgICAgICAgICAgPyBgR2VuZXJhdGVkICR7ZGF0YS5nZW5lcmF0ZWRBdCA/IG5ldyBEYXRlKGRhdGEuZ2VuZXJhdGVkQXQpLnRvTG9jYWxlU3RyaW5nKCkgOiBcIlVua25vd25cIn0gXHUwMEI3ICR7ZGF5cy5sZW5ndGh9IERheSR7ZGF5cy5sZW5ndGggPT09IDEgPyBcIlwiIDogXCJzXCJ9IE9mIEhpc3RvcnlgXG4gICAgICAgICAgICA6IFwiTm8gRGF0YSBZZXRcIn1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgICB7bG9hZGluZyAmJiA8U3Bpbm5lciBzaXplPXsxNn0gLz59XG4gICAgICAgIDxUZXh0QnV0dG9uIGxhYmVsPVwiUmVmcmVzaFwiIHZhcmlhbnQ9XCJwcmltYXJ5XCIgZGlzYWJsZWQ9e2xvYWRpbmd9IG9uQ2xpY2s9eygpID0+IHZvaWQgcmVmcmVzaChhcGkpfSAvPlxuICAgICAgPC9kaXY+XG4gICAgICB7ZXJyb3IgJiYgPEJhbm5lciBtZXNzYWdlPXtgQ291bGQgTm90IExvYWQgTWV0cmljczogJHtlcnJvcn1gfSB0b25lPVwiZXJyb3JcIiAvPn1cbiAgICAgIHtzdGFsZSAmJiA8QmFubmVyIG1lc3NhZ2U9e2BNZXRyaWNzIEFyZSBPbGRlciBUaGFuICR7U1RBTEVfSE9VUlN9IEhvdXJzOyBUaGUgRGFpbHkgQ29sbGVjdG9yIE1heSBIYXZlIEZhaWxlZGB9IHRvbmU9XCJ3YXJuaW5nXCIgLz59XG4gICAgICB7ZGF0YSAmJiAoXG4gICAgICAgIDw+XG4gICAgICAgICAgPFRhYnNcbiAgICAgICAgICAgIHRhYnM9e1t7IGxhYmVsOiBcIk92ZXJ2aWV3XCIsIHZhbHVlOiBcIm92ZXJ2aWV3XCIgfSwgLi4udGFiQXBwcy5tYXAoKGEpID0+ICh7IGxhYmVsOiBhLm5hbWUgYXMgc3RyaW5nLCB2YWx1ZTogYS5uYW1lIGFzIHN0cmluZyB9KSldfVxuICAgICAgICAgICAgdmFsdWU9e2N1cnJlbnQgPyB0YWIgOiBcIm92ZXJ2aWV3XCJ9XG4gICAgICAgICAgICBvbkNoYW5nZT17c2V0VGFifVxuICAgICAgICAgIC8+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyAuLi5zY3JvbGxiYXJTdHlsZShwYWxldHRlKSwgZmxleDogMSwgbWluSGVpZ2h0OiAwLCBvdmVyZmxvdzogXCJhdXRvXCIsIHBhZGRpbmdSaWdodDogR0FQIH19PlxuICAgICAgICAgICAge2N1cnJlbnQgPyA8QXBwVmlldyBhcGk9e2FwaX0gYXBwPXtjdXJyZW50fSBkYXlzPXtkYXlzfSAvPiA6IDxPdmVydmlldyBhcGk9e2FwaX0gZG9jPXtkYXRhfSBkYXlzPXtkYXlzfSAvPn1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC8+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUNBLFNBQVMsV0FBVyxRQUFRLGdCQUFnQjtBQThSeEMsU0F5V0EsVUF6V0EsS0F5RVEsWUF6RVI7QUExUkosSUFBTSxPQUFPO0FBQ2IsSUFBTSxjQUFjO0FBQ3BCLElBQU0sWUFBWTtBQUNsQixJQUFNLGNBQWM7QUFDcEIsSUFBTSxXQUFXO0FBQ2pCLElBQU0saUJBQWlCO0FBeUJ2QixJQUFJLFFBQWUsRUFBRSxNQUFNLE1BQU0sU0FBUyxDQUFDLEdBQUcsT0FBTyxNQUFNLFNBQVMsTUFBTTtBQUMxRSxJQUFNLFlBQVksb0JBQUksSUFBZ0I7QUFFdEMsU0FBUyxTQUFTLE9BQXVCO0FBQ3ZDLFVBQVEsRUFBRSxHQUFHLE9BQU8sR0FBRyxNQUFNO0FBQzdCLFlBQVUsUUFB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

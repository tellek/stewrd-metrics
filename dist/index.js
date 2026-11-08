// metrics/index.tsx
import { useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var NAME = "Metrics";
var STALE_HOURS = 26;
var CACHE_KEY = "lastMetrics";
var HISTORY_DIR = "history";
var MAX_DAYS = 90;
var DEFAULT_BUCKET = "boxopher-metrics-429357724212";
var state = { data: null, history: [], error: null };
var refreshing = false;
var listeners = /* @__PURE__ */ new Set();
function setState(patch) {
  if (Object.keys(patch).every((k) => JSON.stringify(patch[k]) === JSON.stringify(state[k]))) return;
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
  if (refreshing) return;
  refreshing = true;
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
    setIcon(status === "warning" || status === "error" ? status : "idle", tip);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setState({ error: msg });
    setIcon("error", msg);
    log("error", msg);
  } finally {
    refreshing = false;
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
  const { TextButton, Tabs, Banner } = api.ui;
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
  const { data, error } = state;
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
      /* @__PURE__ */ jsx(TextButton, { label: "Refresh", variant: "primary", onClick: () => void refresh(api) })
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG59XG5cbmxldCBzdGF0ZTogU3RhdGUgPSB7IGRhdGE6IG51bGwsIGhpc3Rvcnk6IFtdLCBlcnJvcjogbnVsbCB9O1xubGV0IHJlZnJlc2hpbmcgPSBmYWxzZTtcbmNvbnN0IGxpc3RlbmVycyA9IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKTtcblxuLyoqIFNraXBzIHVuY2hhbmdlZCB2YWx1ZXMgc28gYmFja2dyb3VuZCByZWZyZXNoZXMgZG9uJ3QgcmUtcmVuZGVyIHRoZSBwYW5lLiAqL1xuZnVuY3Rpb24gc2V0U3RhdGUocGF0Y2g6IFBhcnRpYWw8U3RhdGU+KSB7XG4gIGlmICgoT2JqZWN0LmtleXMocGF0Y2gpIGFzIChrZXlvZiBTdGF0ZSlbXSkuZXZlcnkoKGspID0+IEpTT04uc3RyaW5naWZ5KHBhdGNoW2tdKSA9PT0gSlNPTi5zdHJpbmdpZnkoc3RhdGVba10pKSkgcmV0dXJuO1xuICBzdGF0ZSA9IHsgLi4uc3RhdGUsIC4uLnBhdGNoIH07XG4gIGxpc3RlbmVycy5mb3JFYWNoKChsKSA9PiBsKCkpO1xufVxuXG4vLyAtLS0tLS0tLS0tIGhlbHBlcnMgLS0tLS0tLS0tLVxuXG5jb25zdCBpc0Vycm9yTm9kZSA9ICh2OiBKc29uKTogYm9vbGVhbiA9PiB2ICE9PSBudWxsICYmIHR5cGVvZiB2ID09PSBcIm9iamVjdFwiICYmIHR5cGVvZiB2LmVycm9yID09PSBcInN0cmluZ1wiO1xuXG5mdW5jdGlvbiBoYXNFcnJvck5vZGUodjogSnNvbik6IGJvb2xlYW4ge1xuICBpZiAoaXNFcnJvck5vZGUodikpIHJldHVybiB0cnVlO1xuICBpZiAoQXJyYXkuaXNBcnJheSh2KSkgcmV0dXJuIHYuc29tZShoYXNFcnJvck5vZGUpO1xuICBpZiAodiAmJiB0eXBlb2YgdiA9PT0gXCJvYmplY3RcIikgcmV0dXJuIE9iamVjdC52YWx1ZXModikuc29tZShoYXNFcnJvck5vZGUpO1xuICByZXR1cm4gZmFsc2U7XG59XG5cbmNvbnN0IG1vbmV5ID0gbmV3IEludGwuTnVtYmVyRm9ybWF0KHVuZGVmaW5lZCwgeyBzdHlsZTogXCJjdXJyZW5jeVwiLCBjdXJyZW5jeTogXCJVU0RcIiB9KTtcbmNvbnN0IGNvbXBhY3QgPSBuZXcgSW50bC5OdW1iZXJGb3JtYXQodW5kZWZpbmVkLCB7IG5vdGF0aW9uOiBcImNvbXBhY3RcIiwgbWF4aW11bUZyYWN0aW9uRGlnaXRzOiAxIH0pO1xuY29uc3QgTU9ORVlfS0VZID0gLyhtcnJ8cHJvZml0fGNvc3R8YW1vdW50fHJldmVudWUpL2k7XG5cbi8qKiBTaW5nbGUgZm9ybWF0dGVyOiBudWxsL3VuZGVmaW5lZC9lcnJvciBub2RlcyBhcmUgXCJVbmtub3duXCIsIG5ldmVyIHplcm8uICovXG5mdW5jdGlvbiBmbXQodjogSnNvbiwga2V5ID0gXCJcIik6IHN0cmluZyB7XG4gIGlmICh2ID09PSBudWxsIHx8IHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFwiVW5rbm93blwiO1xuICBpZiAoaXNFcnJvck5vZGUodikpIHJldHVybiBgVW5rbm93biAoJHt2LmVycm9yfSlgO1xuICBpZiAodHlwZW9mIHYgPT09IFwibnVtYmVyXCIpIHtcbiAgICBpZiAoTU9ORVlfS0VZLnRlc3Qoa2V5KSkgcmV0dXJuIG1vbmV5LmZvcm1hdCh2KTtcbiAgICBpZiAoL2xhdGVuY3ltcy9pLnRlc3Qoa2V5KSkgcmV0dXJuIGAke01hdGgucm91bmQodil9IG1zYDtcbiAgICByZXR1cm4gdi50b0xvY2FsZVN0cmluZygpO1xuICB9XG4gIGlmICh0eXBlb2YgdiA9PT0gXCJib29sZWFuXCIpIHJldHVybiB2ID8gXCJZZXNcIiA6IFwiTm9cIjtcbiAgcmV0dXJuIFN0cmluZyh2KTtcbn1cblxuLyoqIFRhYmxlIGNlbGw6IFwiLVwiIHdoZW4gdGhlIGFwcCBoYXMgbm8gc3VjaCBtZXRyaWMsIG90aGVyd2lzZSBmbXQgKHNvIHVua25vd24gc3RheXMgXCJVbmtub3duXCIpLiAqL1xuY29uc3QgY2VsbCA9ICh2OiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkLCBrZXkgPSBcIlwiKSA9PiAodiA9PT0gdW5kZWZpbmVkID8gXCItXCIgOiBmbXQodiwga2V5KSk7XG5cbmNvbnN0IGF4aXNGbXQgPSAoa2V5OiBzdHJpbmcpID0+IChuOiBudW1iZXIpID0+IChNT05FWV9LRVkudGVzdChrZXkpID8gbW9uZXkuZm9ybWF0KG4pIDogY29tcGFjdC5mb3JtYXQobikpO1xuXG5mdW5jdGlvbiBhZ2VIb3Vycyhpc286IHN0cmluZyB8IHVuZGVmaW5lZCk6IG51bWJlciB8IG51bGwge1xuICBjb25zdCB0ID0gaXNvID8gRGF0ZS5wYXJzZShpc28pIDogTmFOO1xuICByZXR1cm4gTnVtYmVyLmlzTmFOKHQpID8gbnVsbCA6IChEYXRlLm5vdygpIC0gdCkgLyAzXzYwMF8wMDA7XG59XG5cbmNvbnN0IHNob3J0RGF0ZSA9IChkOiBzdHJpbmcpID0+IG5ldyBEYXRlKGAke2R9VDAwOjAwOjAwWmApLnRvTG9jYWxlRGF0ZVN0cmluZyh1bmRlZmluZWQsIHsgbW9udGg6IFwic2hvcnRcIiwgZGF5OiBcIm51bWVyaWNcIiwgdGltZVpvbmU6IFwiVVRDXCIgfSk7XG5cbmNvbnN0IGFwcHNPZiA9IChkb2M6IEpzb24pOiBKc29uW10gPT4gKGRvYyAmJiBBcnJheS5pc0FycmF5KGRvYy5hcHBzKSA/IGRvYy5hcHBzIDogW10pO1xuXG4vKiogV2Fsa3MgYSBkb3R0ZWQgcGF0aC4gdW5kZWZpbmVkID0gbm90IHByZXNlbnQsIG51bGwgPSB1bmtub3duIChlcnJvciBub2RlIG9yIG51bGwpLCBudW1iZXIgPSB2YWx1ZS4gKi9cbmZ1bmN0aW9uIG1ldHJpYyhvOiBKc29uLCBwYXRoOiBzdHJpbmcpOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkIHtcbiAgbGV0IHYgPSBvO1xuICBmb3IgKGNvbnN0IGsgb2YgcGF0aC5zcGxpdChcIi5cIikpIHtcbiAgICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmICh2ID09PSBudWxsIHx8IGlzRXJyb3JOb2RlKHYpKSByZXR1cm4gbnVsbDtcbiAgICB2ID0gdltrXTtcbiAgfVxuICBpZiAodiA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHYpID8gdiA6IG51bGw7XG59XG5cbi8qKiBTdW1zIGEgbWV0cmljIGFjcm9zcyBhcHBzOyBhbnkgdW5rbm93biBhcHAgdmFsdWUgbWFrZXMgdGhlIHRvdGFsIHVua25vd24uICovXG5mdW5jdGlvbiBzdW1BcHBzKGRvYzogSnNvbiwgcGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCB7XG4gIGlmICghZG9jIHx8IGlzRXJyb3JOb2RlKGRvYy5hcHBzKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHZhbHMgPSBhcHBzT2YoZG9jKVxuICAgIC5tYXAoKGEpID0+IG1ldHJpYyhhLCBwYXRoKSlcbiAgICAuZmlsdGVyKCh2KSA9PiB2ICE9PSB1bmRlZmluZWQpO1xuICBpZiAodmFscy5sZW5ndGggPT09IDApIHJldHVybiB1bmRlZmluZWQ7XG4gIHJldHVybiB2YWxzLnNvbWUoKHYpID0+IHYgPT09IG51bGwpID8gbnVsbCA6ICh2YWxzIGFzIG51bWJlcltdKS5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcbn1cblxuLyoqIFN0YXR1cyBhIHNpbmdsZSB2YWx1ZSBzaWduYWxzOiBmaXJpbmcgYWxhcm1zIGFyZSBhbiBlcnJvciwgNXh4IHJlc3BvbnNlcyBhIHdhcm5pbmcuICovXG5mdW5jdGlvbiB2YWx1ZVRvbmUoa2V5OiBzdHJpbmcsIHY6IEpzb24pOiBTdGF0dXNDb2xvciB8IG51bGwge1xuICBpZiAodHlwZW9mIHYgIT09IFwibnVtYmVyXCIgfHwgdiA8PSAwKSByZXR1cm4gbnVsbDtcbiAgaWYgKGtleSA9PT0gXCJpbkFsYXJtXCIpIHJldHVybiBcImVycm9yXCI7XG4gIGlmIChrZXkgPT09IFwibGFtYmRhRXJyb3JzXCIpIHJldHVybiBcImVycm9yXCI7XG4gIGlmIChrZXkgPT09IFwiZXJyb3JzNXh4XCIpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKiBXb3JzdCBvZiB0aGUgZ2l2ZW4gdG9uZXMsIGlnbm9yaW5nIG51bGxzOyBudWxsIHdoZW4gbm9uZSBhcmUgc2V0LiAqL1xuZnVuY3Rpb24gd29yc3RUb25lKHRvbmVzOiAoU3RhdHVzQ29sb3IgfCBudWxsIHwgdW5kZWZpbmVkKVtdKTogU3RhdHVzQ29sb3IgfCBudWxsIHtcbiAgY29uc3Qgc2V0ID0gdG9uZXMuZmlsdGVyKCh0KTogdCBpcyBTdGF0dXNDb2xvciA9PiAhIXQpO1xuICByZXR1cm4gc2V0Lmxlbmd0aCA/IHdvcnN0KHNldCkgOiBudWxsO1xufVxuXG4vKiogV29yc3QgdG9uZSBvZiBhbnkgdmFsdWUgaW4gYSBncm91cDogZmlyaW5nIGFsYXJtcyAtPiBlcnJvcjsgNXh4LCBzdGFsZSBzdGF0ZXMgb3IgdW5rbm93biBzZWN0aW9ucyAtPiB3YXJuaW5nLiAqL1xuZnVuY3Rpb24gZ3JvdXBUb25lKHY6IEpzb24pOiBTdGF0dXNDb2xvciB8IG51bGwge1xuICBpZiAoaXNFcnJvck5vZGUodikpIHJldHVybiBcIndhcm5pbmdcIjtcbiAgaWYgKCF2IHx8IHR5cGVvZiB2ICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgdG9uZXM6IFN0YXR1c0NvbG9yW10gPSBbXTtcbiAgY29uc3Qgd2FsayA9IChvOiBKc29uKSA9PlxuICAgIE9iamVjdC5lbnRyaWVzKG8pLmZvckVhY2goKFtrLCB4XSkgPT4ge1xuICAgICAgY29uc3QgdCA9IHZhbHVlVG9uZShrLCB4KSA/PyAoayA9PT0gXCJzdGFsZVN0YXRlc1wiICYmIHR5cGVvZiB4ID09PSBcIm51bWJlclwiICYmIHggPiAwID8gXCJ3YXJuaW5nXCIgOiBudWxsKSA/PyAoaXNFcnJvck5vZGUoeCkgPyBcIndhcm5pbmdcIiA6IG51bGwpO1xuICAgICAgaWYgKHQpIHRvbmVzLnB1c2godCk7XG4gICAgICBlbHNlIGlmICh4ICYmIHR5cGVvZiB4ID09PSBcIm9iamVjdFwiKSB3YWxrKHgpO1xuICAgIH0pO1xuICB3YWxrKHYpO1xuICByZXR1cm4gdG9uZXMubGVuZ3RoID8gd29yc3QodG9uZXMpIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gYXBwU3RhdHVzKGFwcDogSnNvbik6IFN0YXR1c0NvbG9yIHtcbiAgaWYgKHZhbHVlVG9uZShcImluQWxhcm1cIiwgbWV0cmljKGFwcCwgXCJoZWFsdGguYWxhcm1zLmluQWxhcm1cIikpKSByZXR1cm4gXCJlcnJvclwiO1xuICBpZiAodmFsdWVUb25lKFwibGFtYmRhRXJyb3JzXCIsIG1ldHJpYyhhcHAsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpKSkgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKGhhc0Vycm9yTm9kZShhcHApKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICh2YWx1ZVRvbmUoXCJlcnJvcnM1eHhcIiwgbWV0cmljKGFwcCwgXCJtb25pdG9yaW5nLnRvdGFscy5lcnJvcnM1eHhcIikpKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICgoYXBwLmhlYWx0aD8uZnJlc2huZXNzPy5zdGFsZVN0YXRlcyA/PyAwKSA+IDApIHJldHVybiBcIndhcm5pbmdcIjtcbiAgcmV0dXJuIFwic3VjY2Vzc1wiO1xufVxuXG5jb25zdCBXT1JTVDogU3RhdHVzQ29sb3JbXSA9IFtcImlkbGVcIiwgXCJzdWNjZXNzXCIsIFwid2FybmluZ1wiLCBcImVycm9yXCJdO1xuY29uc3Qgd29yc3QgPSAoY3M6IFN0YXR1c0NvbG9yW10pOiBTdGF0dXNDb2xvciA9PiBjcy5yZWR1Y2UoKGEsIGIpID0+IChXT1JTVC5pbmRleE9mKGIpID4gV09SU1QuaW5kZXhPZihhKSA/IGIgOiBhKSwgXCJzdWNjZXNzXCIgYXMgU3RhdHVzQ29sb3IpO1xuXG5mdW5jdGlvbiBkb2NTdGF0dXMoZG9jOiBKc29uKTogU3RhdHVzQ29sb3Ige1xuICBjb25zdCBhZ2UgPSBhZ2VIb3Vycyhkb2MuZ2VuZXJhdGVkQXQpO1xuICBjb25zdCBzdGFsZSA9IGFnZSA9PT0gbnVsbCB8fCBhZ2UgPiBTVEFMRV9IT1VSUztcbiAgY29uc3Qgc3RhdHVzID0gd29yc3QoYXBwc09mKGRvYykubWFwKGFwcFN0YXR1cykpO1xuICByZXR1cm4gc3RhbGUgfHwgaGFzRXJyb3JOb2RlKGRvYykgPyB3b3JzdChbc3RhdHVzLCBcIndhcm5pbmdcIl0pIDogc3RhdHVzO1xufVxuXG4vKiogSGlzdG9yeSBwbHVzIHRoZSBsYXRlc3QgZG9jdW1lbnQsIG9uZSBlbnRyeSBwZXIgVVRDIGRhdGUsIG9sZGVzdCBmaXJzdC4gKi9cbmZ1bmN0aW9uIGFsbERheXMoKTogRGF5W10ge1xuICBjb25zdCBtID0gbmV3IE1hcChzdGF0ZS5oaXN0b3J5Lm1hcCgoZCkgPT4gW2QuZGF0ZSwgZC5kb2NdKSk7XG4gIGlmICh0eXBlb2Ygc3RhdGUuZGF0YT8uZ2VuZXJhdGVkQXQgPT09IFwic3RyaW5nXCIpIG0uc2V0KHN0YXRlLmRhdGEuZ2VuZXJhdGVkQXQuc2xpY2UoMCwgMTApLCBzdGF0ZS5kYXRhKTtcbiAgcmV0dXJuIFsuLi5tLmVudHJpZXMoKV0uc29ydCgoW2FdLCBbYl0pID0+IChhIDwgYiA/IC0xIDogMSkpLm1hcCgoW2RhdGUsIGRvY10pID0+ICh7IGRhdGUsIGRvYyB9KSk7XG59XG5cbi8vIC0tLS0tLS0tLS0gZmV0Y2hpbmcgLS0tLS0tLS0tLVxuXG5hc3luYyBmdW5jdGlvbiBhd3NBcmdzKGFwaTogUGx1Z2luQXBpLCBhcmdzOiBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgcyA9IGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCk7XG4gIGNvbnN0IG91dCA9IFsuLi5hcmdzLCBcIi0tY2xpLWNvbm5lY3QtdGltZW91dFwiLCBcIjEwXCIsIFwiLS1jbGktcmVhZC10aW1lb3V0XCIsIFwiMTVcIl07XG4gIGlmIChzLmF3c1Byb2ZpbGUpIG91dC5wdXNoKFwiLS1wcm9maWxlXCIsIHMuYXdzUHJvZmlsZSk7XG4gIHJldHVybiBvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGF3cyhhcGk6IFBsdWdpbkFwaSwgYXJnczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXMgPSBhd2FpdCBhcGkuc2hlbGwuZXhlYyhcImF3c1wiLCBhd2FpdCBhd3NBcmdzKGFwaSwgYXJncykpO1xuICBpZiAocmVzLmNvZGUgIT09IDApIHRocm93IG5ldyBFcnJvcihyZXMuc3RkZXJyLnRyaW0oKSB8fCBgYXdzIGV4aXRlZCB3aXRoIGNvZGUgJHtyZXMuY29kZX1gKTtcbiAgcmV0dXJuIHJlcy5zdGRvdXQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRIaXN0b3J5KGFwaTogUGx1Z2luQXBpKSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhcGkuZnMubGlzdERpcihISVNUT1JZX0RJUik7XG4gIGNvbnN0IGZpbGVzID0gZW50cmllc1xuICAgIC5maWx0ZXIoKGUpID0+ICFlLmlzRGlyICYmIC9eXFxkezR9LVxcZHsyfS1cXGR7Mn1cXC5qc29uJC8udGVzdChlLm5hbWUpKVxuICAgIC5tYXAoKGUpID0+IGUubmFtZSlcbiAgICAuc29ydCgpXG4gICAgLnNsaWNlKC1NQVhfREFZUyk7XG4gIGNvbnN0IGRvY3MgPSBhd2FpdCBQcm9taXNlLmFsbChcbiAgICBmaWxlcy5tYXAoYXN5bmMgKGYpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IGFwaS5mcy5yZWFkVGV4dEZpbGUoYCR7SElTVE9SWV9ESVJ9LyR7Zn1gKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICB9XG4gICAgfSksXG4gICk7XG4gIHNldFN0YXRlKHsgaGlzdG9yeTogZmlsZXMubWFwKChmLCBpKSA9PiAoeyBkYXRlOiBmLnNsaWNlKDAsIDEwKSwgZG9jOiBkb2NzW2ldIH0pKS5maWx0ZXIoKGQpID0+IGQuZG9jKSB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY0hpc3RvcnkoYXBpOiBQbHVnaW5BcGksIGJ1Y2tldDogc3RyaW5nKSB7XG4gIGNvbnN0IHJvb3QgPSAoYXdhaXQgYXBpLmZzLmdldFJvb3RQYXRoKCkpLnJlcGxhY2UoL1tcXFxcL10rJC8sIFwiXCIpO1xuICBhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcInN5bmNcIiwgYHMzOi8vJHtidWNrZXR9LyR7SElTVE9SWV9ESVJ9L2AsIGAke3Jvb3R9LyR7SElTVE9SWV9ESVJ9YCwgXCItLW9ubHktc2hvdy1lcnJvcnNcIl0pO1xuICBhd2FpdCBsb2FkSGlzdG9yeShhcGkpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZWZyZXNoKGFwaTogUGx1Z2luQXBpLCBzaWduYWw/OiBBYm9ydFNpZ25hbCkge1xuICBpZiAocmVmcmVzaGluZykgcmV0dXJuO1xuICByZWZyZXNoaW5nID0gdHJ1ZTtcbiAgY29uc3Qgc2V0SWNvbiA9IChjOiBTdGF0dXNDb2xvciwgdGlwPzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKHNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhcGkuc3RhdHVzSWNvbi5zZXQoYywgdGlwKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8qIGRlYWN0aXZhdGVkICovXG4gICAgfVxuICB9O1xuICBjb25zdCBsb2cgPSAobGV2ZWw6IFwid2FyblwiIHwgXCJlcnJvclwiLCBtc2c6IHN0cmluZykgPT4ge1xuICAgIGlmIChzaWduYWw/LmFib3J0ZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXBpLmxvZ1tsZXZlbF0oYCR7TkFNRX06ICR7bXNnfWApO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogZGVhY3RpdmF0ZWQgKi9cbiAgICB9XG4gIH07XG4gIHRyeSB7XG4gICAgY29uc3QgYnVja2V0ID0gKGF3YWl0IGFwaS5zZXR0aW5ncy5nZXQ8U2V0dGluZ3M+KCkpLmJ1Y2tldCB8fCBERUZBVUxUX0JVQ0tFVDtcbiAgICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShhd2FpdCBhd3MoYXBpLCBbXCJzM1wiLCBcImNwXCIsIGBzMzovLyR7YnVja2V0fS9tZXRyaWNzLmpzb25gLCBcIi1cIl0pKTtcbiAgICBhd2FpdCBhcGkuc3RvcmFnZS5zZXQoQ0FDSEVfS0VZLCBkYXRhKTtcbiAgICBzZXRTdGF0ZSh7IGRhdGEsIGVycm9yOiBudWxsIH0pO1xuICAgIGxldCBzdGF0dXMgPSBkb2NTdGF0dXMoZGF0YSk7XG4gICAgbGV0IHRpcCA9IHN0YXR1cyA9PT0gXCJzdWNjZXNzXCIgPyBcIk1ldHJpY3MgdXAgdG8gZGF0ZVwiIDogc3RhdHVzID09PSBcImVycm9yXCIgPyBcIkFsYXJtcyBmaXJpbmcgb3IgTGFtYmRhIGVycm9yc1wiIDogXCJNZXRyaWNzIG5lZWQgYXR0ZW50aW9uXCI7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNIaXN0b3J5KGFwaSwgYnVja2V0KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zdCBtc2cgPSBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSk7XG4gICAgICBsb2coXCJ3YXJuXCIsIGBoaXN0b3J5IHN5bmMgZmFpbGVkOiAke21zZ31gKTtcbiAgICAgIHN0YXR1cyA9IHdvcnN0KFtzdGF0dXMsIFwid2FybmluZ1wiXSk7XG4gICAgICB0aXAgPSBgSGlzdG9yeSBzeW5jIGZhaWxlZDogJHttc2d9YDtcbiAgICB9XG4gICAgLy8gVGhlIGljb24gb25seSBzaWduYWxzIHByb2JsZW1zOyBhbnl0aGluZyBzaG9ydCBvZiB3YXJuaW5nIHN0YXlzIGlkbGUgKGRlZmF1bHQgdGludCkuXG4gICAgc2V0SWNvbihzdGF0dXMgPT09IFwid2FybmluZ1wiIHx8IHN0YXR1cyA9PT0gXCJlcnJvclwiID8gc3RhdHVzIDogXCJpZGxlXCIsIHRpcCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCBtc2cgPSBlIGluc3RhbmNlb2YgRXJyb3IgPyBlLm1lc3NhZ2UgOiBTdHJpbmcoZSk7XG4gICAgc2V0U3RhdGUoeyBlcnJvcjogbXNnIH0pO1xuICAgIHNldEljb24oXCJlcnJvclwiLCBtc2cpO1xuICAgIGxvZyhcImVycm9yXCIsIG1zZyk7XG4gIH0gZmluYWxseSB7XG4gICAgcmVmcmVzaGluZyA9IGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhY3RpdmF0ZShjdHg6IFBsdWdpbkNvbnRleHQpIHtcbiAgY3R4LmFwaS5zdGF0dXNJY29uLnNldChcImlkbGVcIik7XG4gIGNvbnN0IHMgPSBhd2FpdCBjdHguYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKTtcbiAgY29uc3QgbWludXRlcyA9IE1hdGgubWF4KDEsIHMucmVmcmVzaE1pbnV0ZXMgPz8gNjApO1xuICBjdHgudGljay5yZWdpc3RlcigoKSA9PiByZWZyZXNoKGN0eC5hcGksIGN0eC5zaWduYWwpKTtcbiAgY3R4LnRpY2suc2V0SW50ZXJ2YWwobWludXRlcyAqIDYwXzAwMCk7XG4gIGN0eC5hcGkubG9nLmluZm8oYCR7TkFNRX0gYWN0aXZhdGVkYCk7XG4gIHZvaWQgbG9hZEhpc3RvcnkoY3R4LmFwaSkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgdm9pZCByZWZyZXNoKGN0eC5hcGksIGN0eC5zaWduYWwpO1xufVxuXG4vLyAtLS0tLS0tLS0tIGNoYXJ0IHByaW1pdGl2ZXMgLS0tLS0tLS0tLVxuXG5jb25zdCBDSEFSVF9IRUlHSFQgPSAxNzA7XG5cbmNvbnN0IHNjcm9sbGJhclN0eWxlID0gKHA6IFBhbGV0dGUpOiBDU1NQcm9wZXJ0aWVzID0+ICh7IHNjcm9sbGJhcldpZHRoOiBcInRoaW5cIiwgc2Nyb2xsYmFyQ29sb3I6IGAke3AuYm9yZGVyfSAke3Auc3VyZmFjZX1gIH0pO1xuXG5mdW5jdGlvbiB1c2VXaWR0aCgpIHtcbiAgY29uc3QgcmVmID0gdXNlUmVmPEhUTUxEaXZFbGVtZW50PihudWxsKTtcbiAgY29uc3QgW3dpZHRoLCBzZXRXaWR0aF0gPSB1c2VTdGF0ZSgwKTtcbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBlbCA9IHJlZi5jdXJyZW50O1xuICAgIGlmICghZWwpIHJldHVybjtcbiAgICBjb25zdCBybyA9IG5ldyBSZXNpemVPYnNlcnZlcigoW2VdKSA9PiBzZXRXaWR0aChlLmNvbnRlbnRSZWN0LndpZHRoKSk7XG4gICAgcm8ub2JzZXJ2ZShlbCk7XG4gICAgcmV0dXJuICgpID0+IHJvLmRpc2Nvbm5lY3QoKTtcbiAgfSwgW10pO1xuICByZXR1cm4gW3JlZiwgd2lkdGhdIGFzIGNvbnN0O1xufVxuXG5mdW5jdGlvbiBuaWNlTWF4KHY6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICh2IDw9IDApIHJldHVybiAxO1xuICBjb25zdCBwID0gMTAgKiogTWF0aC5mbG9vcihNYXRoLmxvZzEwKHYpKTtcbiAgY29uc3QgbiA9IHYgLyBwO1xuICByZXR1cm4gKG4gPD0gMSA/IDEgOiBuIDw9IDIgPyAyIDogbiA8PSA1ID8gNSA6IDEwKSAqIHA7XG59XG5cbmZ1bmN0aW9uIFRvb2x0aXAoeyBwLCB4LCB5LCBmbGlwLCBmaXhlZCwgY2hpbGRyZW4gfTogeyBwOiBQYWxldHRlOyB4OiBudW1iZXI7IHk6IG51bWJlcjsgZmxpcDogYm9vbGVhbjsgZml4ZWQ/OiBib29sZWFuOyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBwb3NpdGlvbjogZml4ZWQgPyBcImZpeGVkXCIgOiBcImFic29sdXRlXCIsXG4gICAgICAgIGxlZnQ6IHgsXG4gICAgICAgIHRvcDogeSxcbiAgICAgICAgdHJhbnNmb3JtOiBmbGlwID8gXCJ0cmFuc2xhdGVYKC0xMDAlKVwiIDogdW5kZWZpbmVkLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLmJhY2tncm91bmQsXG4gICAgICAgIGNvbG9yOiBwLnRleHQsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3AuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNCxcbiAgICAgICAgcGFkZGluZzogXCI0cHggOHB4XCIsXG4gICAgICAgIGZvbnRTaXplOiAxMixcbiAgICAgICAgbGluZUhlaWdodDogXCIxOHB4XCIsXG4gICAgICAgIHdoaXRlU3BhY2U6IFwibm93cmFwXCIsXG4gICAgICAgIHBvaW50ZXJFdmVudHM6IFwibm9uZVwiLFxuICAgICAgICB6SW5kZXg6IDEsXG4gICAgICB9fVxuICAgID5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuaW50ZXJmYWNlIFNlcmllcyB7XG4gIG5hbWU6IHN0cmluZztcbiAgY29sb3I6IHN0cmluZztcbiAgdmFsdWVzOiAobnVtYmVyIHwgbnVsbClbXTtcbn1cblxuLyoqIExpbmUgY2hhcnQgb3ZlciB0aW1lIG9uIG9uZSBzaGFyZWQgYXhpcy4gVW5rbm93biAobnVsbCkgcG9pbnRzIGJyZWFrIGEgbGluZSBpbnN0ZWFkIG9mIGRyb3BwaW5nIHRvIHplcm87IGEgbG9uZSBzZXJpZXMgYWxzbyBnZXRzIGFuIGFyZWEgZmlsbC4gKi9cbmZ1bmN0aW9uIExpbmVDaGFydCh7IGFwaSwgbGFiZWxzLCBzZXJpZXMsIGZvcm1hdCwgaGVpZ2h0ID0gQ0hBUlRfSEVJR0hUIH06IHsgYXBpOiBQbHVnaW5BcGk7IGxhYmVsczogc3RyaW5nW107IHNlcmllczogU2VyaWVzW107IGZvcm1hdDogKG46IG51bWJlcikgPT4gc3RyaW5nOyBoZWlnaHQ/OiBudW1iZXIgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IFtob3Zlciwgc2V0SG92ZXJdID0gdXNlU3RhdGU8bnVtYmVyIHwgbnVsbD4obnVsbCk7XG4gIGNvbnN0IEwgPSA1NixcbiAgICBSID0gMTIsXG4gICAgVCA9IDEwLFxuICAgIEIgPSAyMjtcbiAgY29uc3QgdyA9IE1hdGgubWF4KDEsIHdpZHRoIC0gTCAtIFIpO1xuICBjb25zdCBoID0gaGVpZ2h0IC0gVCAtIEI7XG4gIGNvbnN0IG4gPSBsYWJlbHMubGVuZ3RoO1xuICBjb25zdCBtYXggPSBuaWNlTWF4KE1hdGgubWF4KDAsIC4uLnNlcmllcy5mbGF0TWFwKChzKSA9PiBzLnZhbHVlcy5tYXAoKHYpID0+IHYgPz8gMCkpKSk7XG4gIGNvbnN0IHggPSAoaTogbnVtYmVyKSA9PiBMICsgKG4gPD0gMSA/IHcgLyAyIDogKGkgKiB3KSAvIChuIC0gMSkpO1xuICBjb25zdCB5ID0gKHY6IG51bWJlcikgPT4gVCArIGggLSAodiAvIG1heCkgKiBoO1xuXG4gIGNvbnN0IHJ1bnNPZiA9ICh2YWx1ZXM6IChudW1iZXIgfCBudWxsKVtdKSA9PiB7XG4gICAgY29uc3QgcnVuczogbnVtYmVyW11bXSA9IFtdO1xuICAgIGxldCBjdXI6IG51bWJlcltdID0gW107XG4gICAgdmFsdWVzLmZvckVhY2goKHYsIGkpID0+IHtcbiAgICAgIGlmICh2ID09PSBudWxsKSB7XG4gICAgICAgIGlmIChjdXIubGVuZ3RoKSBydW5zLnB1c2goY3VyKTtcbiAgICAgICAgY3VyID0gW107XG4gICAgICB9IGVsc2UgY3VyLnB1c2goaSk7XG4gICAgfSk7XG4gICAgaWYgKGN1ci5sZW5ndGgpIHJ1bnMucHVzaChjdXIpO1xuICAgIHJldHVybiBydW5zO1xuICB9O1xuXG4gIGNvbnN0IG9uTW92ZSA9IChlOiBNb3VzZUV2ZW50PFNWR1JlY3RFbGVtZW50PikgPT4ge1xuICAgIGNvbnN0IHIgPSBlLmN1cnJlbnRUYXJnZXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgaSA9IG4gPD0gMSA/IDAgOiBNYXRoLnJvdW5kKCgoZS5jbGllbnRYIC0gci5sZWZ0KSAvIHIud2lkdGgpICogKG4gLSAxKSk7XG4gICAgc2V0SG92ZXIoTWF0aC5taW4obiAtIDEsIE1hdGgubWF4KDAsIGkpKSk7XG4gIH07XG5cbiAgY29uc3QgeExhYmVscyA9IG4gPD0gMSA/IFswXSA6IG4gPT09IDIgPyBbMCwgMV0gOiBbMCwgTWF0aC5mbG9vcigobiAtIDEpIC8gMiksIG4gLSAxXTtcbiAgY29uc3QgYW5jaG9yID0gKGk6IG51bWJlcikgPT4gKG4gPD0gMSA/IFwibWlkZGxlXCIgOiBpID09PSAwID8gXCJzdGFydFwiIDogaSA9PT0gbiAtIDEgPyBcImVuZFwiIDogXCJtaWRkbGVcIik7XG4gIGNvbnN0IGZsaXAgPSBob3ZlciAhPT0gbnVsbCAmJiB4KGhvdmVyKSA+IHdpZHRoIC0gMTYwO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiByZWY9e3JlZn0gc3R5bGU9e3sgcG9zaXRpb246IFwicmVsYXRpdmVcIiwgaGVpZ2h0IH19PlxuICAgICAge3dpZHRoID4gMCAmJiAoXG4gICAgICAgIDxzdmcgd2lkdGg9e3dpZHRofSBoZWlnaHQ9e2hlaWdodH0gc3R5bGU9e3sgZGlzcGxheTogXCJibG9ja1wiLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAge1swLCAwLjUsIDFdLm1hcCgoZikgPT4gKFxuICAgICAgICAgICAgPGcga2V5PXtmfT5cbiAgICAgICAgICAgICAgPGxpbmUgeDE9e0x9IHgyPXtMICsgd30geTE9e3kobWF4ICogZil9IHkyPXt5KG1heCAqIGYpfSBzdHJva2U9e3AuYm9yZGVyfSBzdHJva2VXaWR0aD17MX0gc3Ryb2tlRGFzaGFycmF5PXtmID8gXCIyIDRcIiA6IHVuZGVmaW5lZH0gLz5cbiAgICAgICAgICAgICAgPHRleHQgeD17TCAtIDZ9IHk9e3kobWF4ICogZil9IGR5PVwiMC4zMmVtXCIgdGV4dEFuY2hvcj1cImVuZFwiIGZpbGw9e3AudGV4dE11dGVkfT5cbiAgICAgICAgICAgICAgICB7Zm9ybWF0KG1heCAqIGYpfVxuICAgICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgICA8L2c+XG4gICAgICAgICAgKSl9XG4gICAgICAgICAge3hMYWJlbHMubWFwKChpKSA9PiAoXG4gICAgICAgICAgICA8dGV4dCBrZXk9e2l9IHg9e3goaSl9IHk9e2hlaWdodCAtIDR9IHRleHRBbmNob3I9e2FuY2hvcihpKX0gZmlsbD17cC50ZXh0TXV0ZWR9PlxuICAgICAgICAgICAgICB7bGFiZWxzW2ldfVxuICAgICAgICAgICAgPC90ZXh0PlxuICAgICAgICAgICkpfVxuICAgICAgICAgIHtzZXJpZXMubWFwKChzKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBydW5zID0gcnVuc09mKHMudmFsdWVzKTtcbiAgICAgICAgICAgIGNvbnN0IGxpbmUgPSAocnVuOiBudW1iZXJbXSkgPT4gcnVuLm1hcCgoaSwgaykgPT4gYCR7ayA/IFwiTFwiIDogXCJNXCJ9JHt4KGkpfSwke3kocy52YWx1ZXNbaV0gYXMgbnVtYmVyKX1gKS5qb2luKFwiXCIpO1xuICAgICAgICAgICAgY29uc3QgbGFzdEtub3duID0gWy4uLnMudmFsdWVzLmtleXMoKV0ucmV2ZXJzZSgpLmZpbmQoKGkpID0+IHMudmFsdWVzW2ldICE9PSBudWxsKTtcbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgIDxnIGtleT17cy5uYW1lfT5cbiAgICAgICAgICAgICAgICB7cnVucy5tYXAoKHJ1bikgPT5cbiAgICAgICAgICAgICAgICAgIHJ1bi5sZW5ndGggPiAxID8gKFxuICAgICAgICAgICAgICAgICAgICA8ZyBrZXk9e3J1blswXX0+XG4gICAgICAgICAgICAgICAgICAgICAge3Nlcmllcy5sZW5ndGggPT09IDEgJiYgPHBhdGggZD17YCR7bGluZShydW4pfUwke3gocnVuW3J1bi5sZW5ndGggLSAxXSl9LCR7eSgwKX1MJHt4KHJ1blswXSl9LCR7eSgwKX1aYH0gZmlsbD17cy5jb2xvcn0gZmlsbE9wYWNpdHk9ezAuMTJ9IC8+fVxuICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9e2xpbmUocnVuKX0gZmlsbD1cIm5vbmVcIiBzdHJva2U9e3MuY29sb3J9IHN0cm9rZVdpZHRoPXsyfSBzdHJva2VMaW5lam9pbj1cInJvdW5kXCIgc3Ryb2tlTGluZWNhcD1cInJvdW5kXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9nPlxuICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgPGNpcmNsZSBrZXk9e3J1blswXX0gY3g9e3gocnVuWzBdKX0gY3k9e3kocy52YWx1ZXNbcnVuWzBdXSBhcyBudW1iZXIpfSByPXszfSBmaWxsPXtzLmNvbG9yfSAvPlxuICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIHtsYXN0S25vd24gIT09IHVuZGVmaW5lZCAmJiBob3ZlciA9PT0gbnVsbCAmJiAoXG4gICAgICAgICAgICAgICAgICA8Y2lyY2xlIGN4PXt4KGxhc3RLbm93bil9IGN5PXt5KHMudmFsdWVzW2xhc3RLbm93bl0gYXMgbnVtYmVyKX0gcj17My41fSBmaWxsPXtzLmNvbG9yfSBzdHJva2U9e3Auc3VyZmFjZX0gc3Ryb2tlV2lkdGg9ezJ9IC8+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICB7aG92ZXIgIT09IG51bGwgJiYgcy52YWx1ZXNbaG92ZXJdICE9PSBudWxsICYmIChcbiAgICAgICAgICAgICAgICAgIDxjaXJjbGUgY3g9e3goaG92ZXIpfSBjeT17eShzLnZhbHVlc1tob3Zlcl0gYXMgbnVtYmVyKX0gcj17NC41fSBmaWxsPXtzLmNvbG9yfSBzdHJva2U9e3Auc3VyZmFjZX0gc3Ryb2tlV2lkdGg9ezJ9IHBvaW50ZXJFdmVudHM9XCJub25lXCIgLz5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICApO1xuICAgICAgICAgIH0pfVxuICAgICAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiA8bGluZSB4MT17eChob3Zlcil9IHgyPXt4KGhvdmVyKX0geTE9e1R9IHkyPXtUICsgaH0gc3Ryb2tlPXtwLnRleHRNdXRlZH0gc3Ryb2tlV2lkdGg9ezF9IHBvaW50ZXJFdmVudHM9XCJub25lXCIgLz59XG4gICAgICAgICAgPHJlY3QgeD17TH0geT17MH0gd2lkdGg9e3d9IGhlaWdodD17aGVpZ2h0fSBmaWxsPVwidHJhbnNwYXJlbnRcIiBvbk1vdXNlTW92ZT17b25Nb3ZlfSBvbk1vdXNlTGVhdmU9eygpID0+IHNldEhvdmVyKG51bGwpfSAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgICl9XG4gICAgICB7aG92ZXIgIT09IG51bGwgJiYgKFxuICAgICAgICA8VG9vbHRpcCBwPXtwfSB4PXt4KGhvdmVyKSArIChmbGlwID8gLTEwIDogMTApfSB5PXtUfSBmbGlwPXtmbGlwfT5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57bGFiZWxzW2hvdmVyXX08L2Rpdj5cbiAgICAgICAgICB7c2VyaWVzLm1hcCgocykgPT4gKFxuICAgICAgICAgICAgPGRpdiBrZXk9e3MubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGdhcDogNiB9fT5cbiAgICAgICAgICAgICAge3Nlcmllcy5sZW5ndGggPiAxICYmIDxzcGFuIHN0eWxlPXt7IHdpZHRoOiA4LCBoZWlnaHQ6IDgsIGJvcmRlclJhZGl1czogMiwgYmFja2dyb3VuZDogcy5jb2xvciB9fSAvPn1cbiAgICAgICAgICAgICAge3Nlcmllcy5sZW5ndGggPiAxICYmIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57cy5uYW1lfTwvc3Bhbj59XG4gICAgICAgICAgICAgIDxzcGFuPntzLnZhbHVlc1tob3Zlcl0gPT09IG51bGwgPyBcIlVua25vd25cIiA6IGZvcm1hdChzLnZhbHVlc1tob3Zlcl0gYXMgbnVtYmVyKX08L3NwYW4+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICApKX1cbiAgICAgICAgPC9Ub29sdGlwPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuaW50ZXJmYWNlIFNlZyB7XG4gIG5hbWU6IHN0cmluZztcbiAgdmFsdWU6IG51bWJlcjtcbiAgY29sb3I6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEJhclJvdyB7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHNlZ21lbnRzOiBTZWdbXTtcbiAgdmFsdWVUZXh0OiBzdHJpbmc7XG4gIHRpcDogc3RyaW5nW107XG59XG5cbmZ1bmN0aW9uIExlZ2VuZCh7IGFwaSwgaXRlbXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgaXRlbXM6IHsgbmFtZTogc3RyaW5nOyBjb2xvcjogc3RyaW5nIH1bXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBnYXA6IDE2LCBmbGV4V3JhcDogXCJ3cmFwXCIsIGZvbnRTaXplOiAxMiwgY29sb3I6IHAudGV4dE11dGVkIH19PlxuICAgICAge2l0ZW1zLm1hcCgoaXQpID0+IChcbiAgICAgICAgPHNwYW4ga2V5PXtpdC5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImlubGluZS1mbGV4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGdhcDogNiB9fT5cbiAgICAgICAgICA8c3BhbiBzdHlsZT17eyB3aWR0aDogMTAsIGhlaWdodDogMTAsIGJvcmRlclJhZGl1czogMiwgYmFja2dyb3VuZDogaXQuY29sb3IgfX0gLz5cbiAgICAgICAgICB7aXQubmFtZX1cbiAgICAgICAgPC9zcGFuPlxuICAgICAgKSl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbi8qKiBIb3Jpem9udGFsIChvcHRpb25hbGx5IHN0YWNrZWQpIGJhcnMgc2hhcmluZyBvbmUgc2NhbGUsIHZhbHVlIGxhYmVscyBhdCB0aGUgZW5kLiBTY3JvbGxzIHBhc3QgQkFSX0xJU1RfSEVJR0hULiAqL1xuZnVuY3Rpb24gQmFyTGlzdCh7IGFwaSwgcm93cyB9OiB7IGFwaTogUGx1Z2luQXBpOyByb3dzOiBCYXJSb3dbXSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTx7IGk6IG51bWJlcjsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSB8IG51bGw+KG51bGwpO1xuICBjb25zdCBtYXggPSBNYXRoLm1heCgwLCAuLi5yb3dzLm1hcCgocikgPT4gci5zZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKSkpIHx8IDE7XG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT5Ob25lPC9zcGFuPjtcbiAgY29uc3QgZmxpcCA9IGhvdmVyICE9PSBudWxsICYmIGhvdmVyLnggPiB3aW5kb3cuaW5uZXJXaWR0aCAtIDIwMDtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IC4uLnNjcm9sbGJhclN0eWxlKHApLCBtYXhIZWlnaHQ6IENIQVJUX0hFSUdIVCwgb3ZlcmZsb3dZOiBcImF1dG9cIiwgb3ZlcmZsb3dYOiBcImhpZGRlblwiLCBwYWRkaW5nUmlnaHQ6IEdBUCB9fSBvbk1vdXNlTGVhdmU9eygpID0+IHNldEhvdmVyKG51bGwpfT5cbiAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwibWlubWF4KDAsIG1heC1jb250ZW50KSAxZnIgbWF4LWNvbnRlbnRcIiwgZ2FwOiBcIjJweCAxMnB4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIsIGZvbnRTaXplOiAxNCB9fT5cbiAgICAgICAge3Jvd3MubWFwKChyLCBpKSA9PiB7XG4gICAgICAgICAgY29uc3QgdG90YWwgPSByLnNlZ21lbnRzLnJlZHVjZSgoYSwgcykgPT4gYSArIHMudmFsdWUsIDApO1xuICAgICAgICAgIGNvbnN0IGhvdCA9IGhvdmVyPy5pID09PSBpO1xuICAgICAgICAgIGNvbnN0IGNlbGw6IENTU1Byb3BlcnRpZXMgPSB7IGJhY2tncm91bmQ6IGhvdCA/IHAuc3VyZmFjZUhvdmVyIDogdW5kZWZpbmVkLCBwYWRkaW5nOiBcIjJweCAwXCIgfTtcbiAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgPGRpdiBrZXk9e3IubGFiZWx9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fSBvbk1vdXNlTW92ZT17KGUpID0+IHNldEhvdmVyKHsgaSwgeDogZS5jbGllbnRYLCB5OiBlLmNsaWVudFkgfSl9PlxuICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyAuLi5jZWxsLCBjb2xvcjogaG90ID8gcC5hY2NlbnQgOiBwLnRleHQsIG1heFdpZHRoOiAyMjAsIG92ZXJmbG93OiBcImhpZGRlblwiLCB0ZXh0T3ZlcmZsb3c6IFwiZWxsaXBzaXNcIiwgd2hpdGVTcGFjZTogXCJub3dyYXBcIiB9fSB0aXRsZT17ci5sYWJlbH0+XG4gICAgICAgICAgICAgICAge3IubGFiZWx9XG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICAgPGRpdiBzdHlsZT17eyAuLi5jZWxsLCBkaXNwbGF5OiBcImZsZXhcIiwgaGVpZ2h0OiAyMiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiB9fT5cbiAgICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCB3aWR0aDogYCR7KHRvdGFsIC8gbWF4KSAqIDEwMH0lYCwgaGVpZ2h0OiAxMiwgZ2FwOiAxLCBtaW5XaWR0aDogdG90YWwgPiAwID8gMiA6IDAgfX0+XG4gICAgICAgICAgICAgICAgICB7ci5zZWdtZW50c1xuICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKChzKSA9PiBzLnZhbHVlID4gMClcbiAgICAgICAgICAgICAgICAgICAgLm1hcCgocywgaywgYXJyKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdlxuICAgICAgICAgICAgICAgICAgICAgICAga2V5PXtzLm5hbWV9XG4gICAgICAgICAgICAgICAgICAgICAgICBzdHlsZT17e1xuICAgICAgICAgICAgICAgICAgICAgICAgICBmbGV4OiBzLnZhbHVlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBiYWNrZ3JvdW5kOiBzLmNvbG9yLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBib3JkZXJSYWRpdXM6IGAke2sgPT09IDAgPyAyIDogMH1weCAke2sgPT09IGFyci5sZW5ndGggLSAxID8gMiA6IDB9cHggJHtrID09PSBhcnIubGVuZ3RoIC0gMSA/IDIgOiAwfXB4ICR7ayA9PT0gMCA/IDIgOiAwfXB4YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyAuLi5jZWxsLCB0ZXh0QWxpZ246IFwicmlnaHRcIiwgZm9udFZhcmlhbnROdW1lcmljOiBcInRhYnVsYXItbnVtc1wiIH19PntyLnZhbHVlVGV4dH08L3NwYW4+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICApO1xuICAgICAgICB9KX1cbiAgICAgIDwvZGl2PlxuICAgICAge2hvdmVyICYmIHJvd3NbaG92ZXIuaV0gJiYgKFxuICAgICAgICA8VG9vbHRpcCBwPXtwfSB4PXtob3Zlci54ICsgKGZsaXAgPyAtMTIgOiAxMil9IHk9e2hvdmVyLnkgKyAxMn0gZmxpcD17ZmxpcH0gZml4ZWQ+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBmb250V2VpZ2h0OiA2MDAgfX0+e3Jvd3NbaG92ZXIuaV0ubGFiZWx9PC9kaXY+XG4gICAgICAgICAge3Jvd3NbaG92ZXIuaV0udGlwLm1hcCgodCkgPT4gKFxuICAgICAgICAgICAgPGRpdiBrZXk9e3R9Pnt0fTwvZGl2PlxuICAgICAgICAgICkpfVxuICAgICAgICA8L1Rvb2x0aXA+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogYHRvbmVgIGNvbG9ycyB0aGUgdmFsdWUgYW5kIGJvcmRlciAoZml4ZWQgcnVsZXMpOyBgb3V0bGluZWAgb25seSBjb2xvcnMgdGhlIGJvcmRlciAoYXZlcmFnZSBkZXZpYXRpb24pLiAqL1xuZnVuY3Rpb24gVGlsZSh7XG4gIGFwaSxcbiAgbGFiZWwsXG4gIHZhbHVlLFxuICBkZWx0YSxcbiAgdG9uZSxcbiAgb3V0bGluZSxcbn06IHtcbiAgYXBpOiBQbHVnaW5BcGk7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHZhbHVlOiBzdHJpbmc7XG4gIGRlbHRhPzogc3RyaW5nW107XG4gIHRvbmU/OiBTdGF0dXNDb2xvciB8IG51bGw7XG4gIG91dGxpbmU/OiBTdGF0dXNDb2xvciB8IG51bGw7XG59KSB7XG4gIGNvbnN0IGJvcmRlciA9IHdvcnN0VG9uZShbdG9uZSwgb3V0bGluZV0pO1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoXG4gICAgPGRpdlxuICAgICAgc3R5bGU9e3tcbiAgICAgICAgbWluV2lkdGg6IDAsXG4gICAgICAgIGJveFNpemluZzogXCJib3JkZXItYm94XCIsXG4gICAgICAgIGJhY2tncm91bmQ6IHAuc3VyZmFjZSxcbiAgICAgICAgYm9yZGVyOiBgMXB4IHNvbGlkICR7Ym9yZGVyID8gcC5zdGF0dXNbYm9yZGVyXSA6IHAuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNixcbiAgICAgICAgcGFkZGluZzogXCIxMHB4IDEycHhcIixcbiAgICAgICAgZGlzcGxheTogXCJmbGV4XCIsXG4gICAgICAgIGZsZXhEaXJlY3Rpb246IFwiY29sdW1uXCIsXG4gICAgICAgIGdhcDogMixcbiAgICAgIH19XG4gICAgPlxuICAgICAgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+e2xhYmVsfTwvc3Bhbj5cbiAgICAgIDxzcGFuIHN0eWxlPXt7IGZvbnRTaXplOiAyMiwgbGluZUhlaWdodDogXCIzMHB4XCIsIGZvbnRXZWlnaHQ6IDYwMCwgZm9udFZhcmlhbnROdW1lcmljOiBcInRhYnVsYXItbnVtc1wiLCBjb2xvcjogdG9uZSA/IHAuc3RhdHVzW3RvbmVdIDogdW5kZWZpbmVkIH19Pnt2YWx1ZX08L3NwYW4+XG4gICAgICB7ZGVsdGE/Lm1hcCgoZCkgPT4gKFxuICAgICAgICA8c3BhbiBrZXk9e2R9IHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgIHtkfVxuICAgICAgICA8L3NwYW4+XG4gICAgICApKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLyoqIFdyYXBwaW5nIHJvdyBvZiBjYXJkczogZXZlcnkgcm93IGlzIGZpbGxlZCBlZGdlIHRvIGVkZ2UgYW5kIGl0cyBjYXJkcyBzaGFyZSBvbmUgaGVpZ2h0LiAqL1xuY29uc3QgVElMRV9NSU4gPSAxMzA7XG5jb25zdCBHQVAgPSAxMjtcblxuLyoqIFN0YXQgdGlsZXMgaW4gZXF1YWwgY29sdW1uczsgd2hlbiB0aGV5IGRvbid0IGZpdCBvbiBvbmUgcm93IHRoZXkgc3BsaXQgaW50byBiYWxhbmNlZCByb3dzICg2IC0+IDMrMyAtPiAyKzIrMikuICovXG5mdW5jdGlvbiBUaWxlUm93KHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlW10gfSkge1xuICBjb25zdCBbcmVmLCB3aWR0aF0gPSB1c2VXaWR0aCgpO1xuICBjb25zdCBuID0gTWF0aC5tYXgoMSwgY2hpbGRyZW4ubGVuZ3RoKTtcbiAgY29uc3QgZml0ID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcigod2lkdGggKyBHQVApIC8gKFRJTEVfTUlOICsgR0FQKSkpO1xuICBjb25zdCBjb2xzID0gd2lkdGggPyBNYXRoLmNlaWwobiAvIE1hdGguY2VpbChuIC8gTWF0aC5taW4oZml0LCBuKSkpIDogbjtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHJlZj17cmVmfSBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogYHJlcGVhdCgke2NvbHN9LCBtaW5tYXgoMCwgMWZyKSlgLCBnYXA6IEdBUCB9fT5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgRmxvdyA9ICh7IGNoaWxkcmVuIH06IHsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSA9PiA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4V3JhcDogXCJ3cmFwXCIsIGFsaWduSXRlbXM6IFwic3RyZXRjaFwiLCBnYXA6IDEyIH19PntjaGlsZHJlbn08L2Rpdj47XG5cbi8qKiBPbmx5IHdhcm5pbmcvZXJyb3IgdG9uZXMgb3V0bGluZSBhIGNhcmQ7IGFueXRoaW5nIGVsc2Uga2VlcHMgdGhlIG5vcm1hbCBib3JkZXIuICovXG5jb25zdCBhbGVydFRvbmUgPSAoczogU3RhdHVzQ29sb3IgfCBudWxsIHwgdW5kZWZpbmVkKTogU3RhdHVzQ29sb3IgfCBudWxsID0+IChzID09PSBcIndhcm5pbmdcIiB8fCBzID09PSBcImVycm9yXCIgPyBzIDogbnVsbCk7XG5cbmZ1bmN0aW9uIFNlY3Rpb24oeyBhcGksIHRpdGxlLCBleHRyYSwgdG9uZSwgY2hpbGRyZW4gfTogeyBhcGk6IFBsdWdpbkFwaTsgdGl0bGU6IHN0cmluZzsgZXh0cmE/OiBSZWFjdE5vZGU7IHRvbmU/OiBTdGF0dXNDb2xvciB8IG51bGw7IGNoaWxkcmVuOiBSZWFjdE5vZGUgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IHQgPSBhbGVydFRvbmUodG9uZSk7XG4gIHJldHVybiAoXG4gICAgPGRpdlxuICAgICAgc3R5bGU9e3tcbiAgICAgICAgZmxleDogXCIxIDEgMzIwcHhcIixcbiAgICAgICAgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIixcbiAgICAgICAgYmFja2dyb3VuZDogcC5zdXJmYWNlLFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHt0ID8gcC5zdGF0dXNbdF0gOiBwLmJvcmRlcn1gLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDYsXG4gICAgICAgIHBhZGRpbmc6IDEyLFxuICAgICAgICBkaXNwbGF5OiBcImZsZXhcIixcbiAgICAgICAgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIixcbiAgICAgICAgZ2FwOiA4LFxuICAgICAgICBtaW5XaWR0aDogMCxcbiAgICAgIH19XG4gICAgPlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiAxMiwgZmxleFdyYXA6IFwid3JhcFwiIH19PlxuICAgICAgICA8c3Ryb25nIHN0eWxlPXt7IGZsZXg6IDEgfX0+e3RpdGxlfTwvc3Ryb25nPlxuICAgICAgICB7ZXh0cmF9XG4gICAgICA8L2Rpdj5cbiAgICAgIHtjaGlsZHJlbn1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBtZXRyaWMgdmlld3MgLS0tLS0tLS0tLVxuXG5pbnRlcmZhY2UgVHJlbmQge1xuICB0aXRsZTogc3RyaW5nO1xuICBrZXk6IHN0cmluZztcbiAgZ2V0OiAoZG9jOiBKc29uKSA9PiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkO1xufVxuXG4vKiogVGlsZSB2YWx1ZSBmcm9tIHRoZSBsYXRlc3QgZG9jLCBkZWx0YSBhZ2FpbnN0IHRoZSBwcmV2aW91cyBkYXkgaW4gaGlzdG9yeS4gKi9cbmZ1bmN0aW9uIHRyZW5kVGlsZShhcGk6IFBsdWdpbkFwaSwgZGF5czogRGF5W10sIHQ6IFRyZW5kKSB7XG4gIGNvbnN0IHZhbHMgPSBkYXlzLm1hcCgoZCkgPT4gdC5nZXQoZC5kb2MpKTtcbiAgY29uc3QgY3VyID0gdmFsc1t2YWxzLmxlbmd0aCAtIDFdO1xuICBjb25zdCBwcmV2ID0gdmFscy5sZW5ndGggPiAxID8gdmFsc1t2YWxzLmxlbmd0aCAtIDJdIDogdW5kZWZpbmVkO1xuICBsZXQgZGVsdGE6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBpZiAodHlwZW9mIGN1ciA9PT0gXCJudW1iZXJcIiAmJiB0eXBlb2YgcHJldiA9PT0gXCJudW1iZXJcIikge1xuICAgIGNvbnN0IGQgPSBjdXIgLSBwcmV2O1xuICAgIGNvbnN0IGFicyA9IE1PTkVZX0tFWS50ZXN0KHQua2V5KSA/IG1vbmV5LmZvcm1hdChNYXRoLmFicyhkKSkgOiBNYXRoLmFicyhkKS50b0xvY2FsZVN0cmluZygpO1xuICAgIGRlbHRhID0gYCR7ZCA+IDAgPyBcIitcIiA6IGQgPCAwID8gXCItXCIgOiBcIlx1MDBCMVwifSR7YWJzfSB2cyAke3Nob3J0RGF0ZShkYXlzW2RheXMubGVuZ3RoIC0gMl0uZGF0ZSl9YDtcbiAgfVxuICBjb25zdCBhdmcgPSBhdmVyYWdlQ2hlY2sodmFscywgRVJST1JfS0VZUy5oYXModC5rZXkpKTtcbiAgY29uc3QgYXZnVGV4dCA9IGF2ZyA/IGAke2F2Zy5jaGFuZ2UgPj0gMCA/IFwiK1wiIDogXCItXCJ9JHtNYXRoLnJvdW5kKE1hdGguYWJzKGF2Zy5jaGFuZ2UpICogMTAwKX0lIHZzICR7YXhpc0ZtdCh0LmtleSkoYXZnLmF2Zyl9IGF2Z2AgOiBudWxsO1xuICByZXR1cm4gKFxuICAgIDxUaWxlXG4gICAgICBrZXk9e3QudGl0bGV9XG4gICAgICBhcGk9e2FwaX1cbiAgICAgIGxhYmVsPXt0LnRpdGxlfVxuICAgICAgdmFsdWU9e2ZtdChjdXIsIHQua2V5KX1cbiAgICAgIGRlbHRhPXtbZGVsdGEsIGF2Z1RleHRdLmZpbHRlcigoZCk6IGQgaXMgc3RyaW5nID0+ICEhZCl9XG4gICAgICB0b25lPXt2YWx1ZVRvbmUodC5rZXksIGN1cil9XG4gICAgICBvdXRsaW5lPXthdmc/LnRvbmV9XG4gICAgLz5cbiAgKTtcbn1cblxuLyoqIE1ldHJpY3Mgd2hlcmUgaGlnaGVyIGlzIHdvcnNlOyB2YWx1ZVRvbmUgY29sb3JzIGFueSBub24temVybyB2YWx1ZSBvZiB0aGVzZS4gKi9cbmNvbnN0IEVSUk9SX0tFWVMgPSBuZXcgU2V0KFtcImluQWxhcm1cIiwgXCJsYW1iZGFFcnJvcnNcIiwgXCJlcnJvcnM1eHhcIl0pO1xuXG5jb25zdCBBVkdfTUlOX0RBWVMgPSAzO1xuY29uc3QgQVZHX1dBUk5JTkcgPSAxOyAvLyAxMDAlIGF3YXkgZnJvbSB0aGUgYXZlcmFnZVxuY29uc3QgQVZHX0VSUk9SID0gNTsgLy8gNTAwJSBhd2F5IGZyb20gdGhlIGF2ZXJhZ2VcblxuLyoqXG4gKiBDb21wYXJlcyB0aGUgbGF0ZXN0IHZhbHVlIHdpdGggdGhlIGF2ZXJhZ2Ugb2YgZXZlcnkgZWFybGllciBkYXkgaW4gaGlzdG9yeS5cbiAqIE51bGwgdW50aWwgdGhlcmUgYXJlIEFWR19NSU5fREFZUyBlYXJsaWVyIGtub3duIHZhbHVlcywgb3Igd2hlbiB0aGUgYXZlcmFnZSBpcyAwIChubyBwZXJjZW50YWdlIGV4aXN0cykuXG4gKiBgdXBPbmx5YCAoZXJyb3ItdHlwZSBtZXRyaWNzKTogb25seSBhIHJpc2UgYWJvdmUgdGhlIGF2ZXJhZ2UgY291bnRzOyBmYWxsaW5nIGVycm9ycyBhcmUgZ29vZCBuZXdzLlxuICovXG5mdW5jdGlvbiBhdmVyYWdlQ2hlY2sodmFsczogKG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQpW10sIHVwT25seSA9IGZhbHNlKTogeyBhdmc6IG51bWJlcjsgY2hhbmdlOiBudW1iZXI7IHRvbmU6IFN0YXR1c0NvbG9yIHwgbnVsbCB9IHwgbnVsbCB7XG4gIGNvbnN0IGN1ciA9IHZhbHNbdmFscy5sZW5ndGggLSAxXTtcbiAgY29uc3QgcHJldiA9IHZhbHMuc2xpY2UoMCwgLTEpLmZpbHRlcigodik6IHYgaXMgbnVtYmVyID0+IHR5cGVvZiB2ID09PSBcIm51bWJlclwiKTtcbiAgaWYgKHR5cGVvZiBjdXIgIT09IFwibnVtYmVyXCIgfHwgcHJldi5sZW5ndGggPCBBVkdfTUlOX0RBWVMpIHJldHVybiBudWxsO1xuICBjb25zdCBhdmcgPSBwcmV2LnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApIC8gcHJldi5sZW5ndGg7XG4gIGlmIChhdmcgPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBjaGFuZ2UgPSAoY3VyIC0gYXZnKSAvIE1hdGguYWJzKGF2Zyk7XG4gIGNvbnN0IGRldiA9IHVwT25seSA/IGNoYW5nZSA6IE1hdGguYWJzKGNoYW5nZSk7XG4gIHJldHVybiB7IGF2ZywgY2hhbmdlLCB0b25lOiBkZXYgPj0gQVZHX0VSUk9SID8gXCJlcnJvclwiIDogZGV2ID49IEFWR19XQVJOSU5HID8gXCJ3YXJuaW5nXCIgOiBudWxsIH07XG59XG5cbi8qKiBPbmUgY2FyZCBwZXIgdHJlbmQgdGhhdCBoYXMgZGF0YTsgcmVuZGVyZWQgYXMgYSBmcmFnbWVudCBzbyB0aGUgY2FyZHMgam9pbiB0aGUgc3Vycm91bmRpbmcgRmxvdy4gKi9cbmZ1bmN0aW9uIFRyZW5kQ2hhcnRzKHsgYXBpLCBkYXlzLCB0cmVuZHMgfTogeyBhcGk6IFBsdWdpbkFwaTsgZGF5czogRGF5W107IHRyZW5kczogVHJlbmRbXSB9KSB7XG4gIHJldHVybiAoXG4gICAgPD5cbiAgICAgIHt0cmVuZHNcbiAgICAgICAgLm1hcCgodCkgPT4gKHsgdCwgcG9pbnRzOiBkYXlzLm1hcCgoZCkgPT4gKHsgbGFiZWw6IHNob3J0RGF0ZShkLmRhdGUpLCByYXc6IHQuZ2V0KGQuZG9jKSB9KSkgfSkpXG4gICAgICAgIC5maWx0ZXIoKHsgcG9pbnRzIH0pID0+IHBvaW50cy5zb21lKChwdCkgPT4gcHQucmF3ICE9PSB1bmRlZmluZWQpKVxuICAgICAgICAubWFwKCh7IHQsIHBvaW50cyB9KSA9PiAoXG4gICAgICAgICAgPFNlY3Rpb25cbiAgICAgICAgICAgIGtleT17dC50aXRsZX1cbiAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgdGl0bGU9e2Ake3QudGl0bGV9IFRyZW5kYH1cbiAgICAgICAgICAgIHRvbmU9e1xuICAgICAgICAgICAgICBhdmVyYWdlQ2hlY2soXG4gICAgICAgICAgICAgICAgcG9pbnRzLm1hcCgocHQpID0+IHB0LnJhdyksXG4gICAgICAgICAgICAgICAgRVJST1JfS0VZUy5oYXModC5rZXkpLFxuICAgICAgICAgICAgICApPy50b25lXG4gICAgICAgICAgICB9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgPExpbmVDaGFydFxuICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgbGFiZWxzPXtwb2ludHMubWFwKChwdCkgPT4gcHQubGFiZWwpfVxuICAgICAgICAgICAgICBzZXJpZXM9e1t7IG5hbWU6IHQudGl0bGUsIGNvbG9yOiBhcGkudGhlbWUucGFsZXR0ZS5hY2NlbnQsIHZhbHVlczogcG9pbnRzLm1hcCgocHQpID0+IHB0LnJhdyA/PyBudWxsKSB9XX1cbiAgICAgICAgICAgICAgZm9ybWF0PXtheGlzRm10KHQua2V5KX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApKX1cbiAgICA8Lz5cbiAgKTtcbn1cblxuZnVuY3Rpb24gSGlzdG9yeUhpbnQoeyBhcGksIGRheXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgZGF5czogRGF5W10gfSkge1xuICBpZiAoZGF5cy5sZW5ndGggPj0gMikgcmV0dXJuIG51bGw7XG4gIHJldHVybiA8c3BhbiBzdHlsZT17eyBjb2xvcjogYXBpLnRoZW1lLnBhbGV0dGUudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+VHJlbmRzIGZpbGwgaW4gYXMgZGFpbHkgaGlzdG9yeSBhY2N1bXVsYXRlcyAoe2RheXMubGVuZ3RofSBkYXkgc28gZmFyKS48L3NwYW4+O1xufVxuXG5mdW5jdGlvbiBjb3N0Um93cyhhcGk6IFBsdWdpbkFwaSwgY29zdDogSnNvbik6IEJhclJvd1tdIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICByZXR1cm4gT2JqZWN0LmVudHJpZXMoY29zdD8uYnlUYWcgPz8ge30pXG4gICAgLmZpbHRlcigoWywgdl0pID0+IHR5cGVvZiB2ID09PSBcIm51bWJlclwiKVxuICAgIC5zb3J0KChbLCBhXSwgWywgYl0pID0+IChiIGFzIG51bWJlcikgLSAoYSBhcyBudW1iZXIpKVxuICAgIC5tYXAoKFtrLCB2XSkgPT4gKHtcbiAgICAgIGxhYmVsOiBrLFxuICAgICAgc2VnbWVudHM6IFt7IG5hbWU6IFwiQ29zdFwiLCB2YWx1ZTogdiBhcyBudW1iZXIsIGNvbG9yOiBwLmFjY2VudCB9XSxcbiAgICAgIHZhbHVlVGV4dDogbW9uZXkuZm9ybWF0KHYgYXMgbnVtYmVyKSxcbiAgICAgIHRpcDogW2Ake21vbmV5LmZvcm1hdCh2IGFzIG51bWJlcil9ICgke2Nvc3QudG90YWwgPyAoKCh2IGFzIG51bWJlcikgLyBjb3N0LnRvdGFsKSAqIDEwMCkudG9GaXhlZCgxKSA6IFwiMFwifSUgb2YgdG90YWwpYF0sXG4gICAgfSkpO1xufVxuXG4vKiogQXBwcyB0b28gc21hbGwgZm9yIHRoZWlyIG93biB0YWI7IHRoZXkgZ2V0IG9uZSBpbnZvY2F0aW9ucy12cy1lcnJvcnMgY2FyZCBvbiB0aGUgT3ZlcnZpZXcgaW5zdGVhZC4gKi9cbmNvbnN0IE9WRVJWSUVXX09OTFlfQVBQUzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHsgU2VjcmV0c01hbmFnZXI6IFwiR2xvYmFsIFNlY3JldHMgVHJlbmRcIiB9O1xuXG4vKiogU3VtIG9mIGEgTGFtYmRhIG1ldHJpYyBhY3Jvc3MgYW4gYXBwJ3MgZnVuY3Rpb25zOyB1bmtub3duIGlmIGFueSBmdW5jdGlvbidzIHZhbHVlIGlzIHVua25vd24uICovXG5mdW5jdGlvbiBsYW1iZGFTdW0oYXBwOiBKc29uLCBmaWVsZDogXCJpbnZvY2F0aW9uc1wiIHwgXCJlcnJvcnNcIik6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBjb25zdCBsYW1iZGFzID0gYXBwPy5tb25pdG9yaW5nPy5sYW1iZGFzO1xuICBpZiAobGFtYmRhcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAobGFtYmRhcyA9PT0gbnVsbCB8fCBpc0Vycm9yTm9kZShsYW1iZGFzKSB8fCBpc0Vycm9yTm9kZShhcHAubW9uaXRvcmluZykpIHJldHVybiBudWxsO1xuICBjb25zdCB2YWxzID0gT2JqZWN0LnZhbHVlcyhsYW1iZGFzKS5tYXAoKHYpID0+IG1ldHJpYyh2LCBmaWVsZCkpO1xuICByZXR1cm4gdmFscy5zb21lKCh2KSA9PiB0eXBlb2YgdiAhPT0gXCJudW1iZXJcIikgPyBudWxsIDogKHZhbHMgYXMgbnVtYmVyW10pLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApO1xufVxuXG5mdW5jdGlvbiBJbnZvY2F0aW9uc1RyZW5kKHsgYXBpLCBkYXlzLCBhcHBOYW1lLCB0aXRsZSB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgYXBwTmFtZTogc3RyaW5nOyB0aXRsZTogc3RyaW5nIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBhcHBEYXlzID0gZGF5cy5tYXAoKGQpID0+ICh7IGRhdGU6IGQuZGF0ZSwgYXBwOiBhcHBzT2YoZC5kb2MpLmZpbmQoKGEpID0+IGEubmFtZSA9PT0gYXBwTmFtZSkgfSkpLmZpbHRlcigoZCkgPT4gZC5hcHApO1xuICBpZiAoYXBwRGF5cy5sZW5ndGggPT09IDApIHJldHVybiBudWxsO1xuICBjb25zdCBzZXJpZXM6IFNlcmllc1tdID0gW1xuICAgIHsgbmFtZTogXCJJbnZvY2F0aW9uc1wiLCBjb2xvcjogcC5hY2NlbnQsIHZhbHVlczogYXBwRGF5cy5tYXAoKGQpID0+IGxhbWJkYVN1bShkLmFwcCwgXCJpbnZvY2F0aW9uc1wiKSA/PyBudWxsKSB9LFxuICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgY29sb3I6IHAuc3RhdHVzLmVycm9yLCB2YWx1ZXM6IGFwcERheXMubWFwKChkKSA9PiBsYW1iZGFTdW0oZC5hcHAsIFwiZXJyb3JzXCIpID8/IG51bGwpIH0sXG4gIF07XG4gIHJldHVybiAoXG4gICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPXt0aXRsZX0gdG9uZT17YXZlcmFnZUNoZWNrKHNlcmllc1sxXS52YWx1ZXMsIHRydWUpPy50b25lfSBleHRyYT17PExlZ2VuZCBhcGk9e2FwaX0gaXRlbXM9e3Nlcmllc30gLz59PlxuICAgICAgPExpbmVDaGFydCBhcGk9e2FwaX0gbGFiZWxzPXthcHBEYXlzLm1hcCgoZCkgPT4gc2hvcnREYXRlKGQuZGF0ZSkpfSBzZXJpZXM9e3Nlcmllc30gZm9ybWF0PXtheGlzRm10KFwiXCIpfSAvPlxuICAgIDwvU2VjdGlvbj5cbiAgKTtcbn1cblxuY29uc3QgT1ZFUlZJRVdfVFJFTkRTOiBUcmVuZFtdID0gW1xuICB7IHRpdGxlOiBcIkFXUyBDb3N0ICgzMGQpXCIsIGtleTogXCJjb3N0XCIsIGdldDogKGQpID0+IG1ldHJpYyhkLCBcImF3c0Nvc3QudG90YWxcIikgfSxcbiAgeyB0aXRsZTogXCJSZXF1ZXN0cyAoMjRoKVwiLCBrZXk6IFwiXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcImxhbWJkYUVycm9yc1wiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpIH0sXG4gIHsgdGl0bGU6IFwiNXh4IEVycm9ycyAoMjRoKVwiLCBrZXk6IFwiZXJyb3JzNXh4XCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5lcnJvcnM1eHhcIikgfSxcbiAgeyB0aXRsZTogXCJBbGFybXMgRmlyaW5nXCIsIGtleTogXCJpbkFsYXJtXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJoZWFsdGguYWxhcm1zLmluQWxhcm1cIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcImN1c3RvbWVycy5wYXlpbmdcIikgfSxcbl07XG5cbmZ1bmN0aW9uIE92ZXJ2aWV3KHsgYXBpLCBkb2MsIGRheXMgfTogeyBhcGk6IFBsdWdpbkFwaTsgZG9jOiBKc29uOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGNvbnN0IHsgU3RhdHVzRG90IH0gPSBhcGkudWk7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgYXBwcyA9IGFwcHNPZihkb2MpO1xuICBjb25zdCBjb3N0ID0gZG9jLmF3c0Nvc3Q7XG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIiwgZ2FwOiAxMiB9fT5cbiAgICAgIDxUaWxlUm93PntPVkVSVklFV19UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChkb2MpICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgZGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17ZGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2RheXN9IHRyZW5kcz17T1ZFUlZJRVdfVFJFTkRTLnNsaWNlKDAsIDMpfSAvPlxuICAgICAgICB7T2JqZWN0LmVudHJpZXMoT1ZFUlZJRVdfT05MWV9BUFBTKS5tYXAoKFtuYW1lLCB0aXRsZV0pID0+IChcbiAgICAgICAgICA8SW52b2NhdGlvbnNUcmVuZCBrZXk9e25hbWV9IGFwaT17YXBpfSBkYXlzPXtkYXlzfSBhcHBOYW1lPXtuYW1lfSB0aXRsZT17dGl0bGV9IC8+XG4gICAgICAgICkpfVxuICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJBcHBzXCIgdG9uZT17d29yc3QoYXBwcy5tYXAoYXBwU3RhdHVzKSl9PlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwiYXV0byAxZnIgbWF4LWNvbnRlbnQgbWF4LWNvbnRlbnQgbWF4LWNvbnRlbnRcIiwgZ2FwOiBcIjRweCAxMnB4XCIsIGFsaWduSXRlbXM6IFwiY2VudGVyXCIgfX0+XG4gICAgICAgICAgICB7W1wiXCIsIFwiQXBwXCIsIFwiUmVxdWVzdHNcIiwgXCJFcnJvcnNcIiwgXCJQcm9maXQgKDMwZClcIl0ubWFwKChoKSA9PiAoXG4gICAgICAgICAgICAgIDxzcGFuIGtleT17aCB8fCBcImRvdFwifSBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICAgICAgICB7aH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICB7YXBwcy5tYXAoKGEpID0+IChcbiAgICAgICAgICAgICAgPGRpdiBrZXk9e2EubmFtZX0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19PlxuICAgICAgICAgICAgICAgIDxTdGF0dXNEb3QgY29sb3I9e2FwcFN0YXR1cyhhKX0gLz5cbiAgICAgICAgICAgICAgICA8c3Bhbj57YS5uYW1lfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3Bhbj57Y2VsbChtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSl9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSwgXCJwcm9maXRcIil9PC9zcGFuPlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICkpfVxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT17YEFXUyBDb3N0IEJ5IFByb2plY3Qke2Nvc3QgJiYgIWlzRXJyb3JOb2RlKGNvc3QpID8gYCAoJHtzaG9ydERhdGUoY29zdC53aW5kb3dTdGFydCl9IFRvICR7c2hvcnREYXRlKGNvc3Qud2luZG93RW5kKX0pYCA6IFwiXCJ9YH0+XG4gICAgICAgICAgeyFjb3N0IHx8IGlzRXJyb3JOb2RlKGNvc3QpID8gPHNwYW4+e2ZtdChjb3N0KX08L3NwYW4+IDogPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2Nvc3RSb3dzKGFwaSwgY29zdCl9IC8+fVxuICAgICAgICA8L1NlY3Rpb24+XG4gICAgICA8L0Zsb3c+XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmZ1bmN0aW9uIGxhbWJkYVJvd3MoYXBpOiBQbHVnaW5BcGksIGxhbWJkYXM6IEpzb24pOiB7IHJvd3M6IEJhclJvd1tdOyBpZGxlOiBudW1iZXI7IHVua25vd246IHN0cmluZ1tdIH0ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IHJvd3M6IEJhclJvd1tdID0gW107XG4gIGNvbnN0IHVua25vd246IHN0cmluZ1tdID0gW107XG4gIGxldCBpZGxlID0gMDtcbiAgZm9yIChjb25zdCBbZm4sIHZdIG9mIE9iamVjdC5lbnRyaWVzKGxhbWJkYXMgPz8ge30pIGFzIFtzdHJpbmcsIEpzb25dW10pIHtcbiAgICBjb25zdCBpbnYgPSBtZXRyaWModiwgXCJpbnZvY2F0aW9uc1wiKTtcbiAgICBpZiAodHlwZW9mIGludiAhPT0gXCJudW1iZXJcIikge1xuICAgICAgdW5rbm93bi5wdXNoKGZuKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoaW52ID09PSAwKSB7XG4gICAgICBpZGxlKys7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgZXJyID0gbWV0cmljKHYsIFwiZXJyb3JzXCIpID8/IDA7XG4gICAgY29uc3QgdGhyID0gbWV0cmljKHYsIFwidGhyb3R0bGVzXCIpID8/IDA7XG4gICAgcm93cy5wdXNoKHtcbiAgICAgIGxhYmVsOiBmbixcbiAgICAgIHNlZ21lbnRzOiBbXG4gICAgICAgIHsgbmFtZTogXCJTdWNjZWVkZWRcIiwgdmFsdWU6IE1hdGgubWF4KDAsIGludiAtIGVyciksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIHZhbHVlOiBlcnIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgXSxcbiAgICAgIHZhbHVlVGV4dDogZXJyID8gYCR7aW52LnRvTG9jYWxlU3RyaW5nKCl9ICgkeygoZXJyIC8gaW52KSAqIDEwMCkudG9GaXhlZCgwKX0lIEVycilgIDogaW52LnRvTG9jYWxlU3RyaW5nKCksXG4gICAgICB0aXA6IFtgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gaW52b2NhdGlvbnNgLCBgJHtlcnIudG9Mb2NhbGVTdHJpbmcoKX0gZXJyb3JzYCwgYCR7dGhyLnRvTG9jYWxlU3RyaW5nKCl9IHRocm90dGxlc2BdLFxuICAgIH0pO1xuICB9XG4gIHJvd3Muc29ydCgoYSwgYikgPT4gYi5zZWdtZW50c1swXS52YWx1ZSArIGIuc2VnbWVudHNbMV0udmFsdWUgLSAoYS5zZWdtZW50c1swXS52YWx1ZSArIGEuc2VnbWVudHNbMV0udmFsdWUpKTtcbiAgcmV0dXJuIHsgcm93cywgaWRsZSwgdW5rbm93biB9O1xufVxuXG5mdW5jdGlvbiBhcGlSb3dzKGFwaTogUGx1Z2luQXBpLCBhcGlzOiBKc29uKTogQmFyUm93W10ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiAoT2JqZWN0LmVudHJpZXMoYXBpcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSlcbiAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIG1ldHJpYyh2LCBcInJlcXVlc3RzXCIpID09PSBcIm51bWJlclwiKVxuICAgIC5tYXAoKFtuYW1lLCB2XSkgPT4ge1xuICAgICAgY29uc3QgcmVxID0gbWV0cmljKHYsIFwicmVxdWVzdHNcIikgYXMgbnVtYmVyO1xuICAgICAgY29uc3QgZTQgPSBtZXRyaWModiwgXCJlcnJvcnM0eHhcIikgPz8gMDtcbiAgICAgIGNvbnN0IGU1ID0gbWV0cmljKHYsIFwiZXJyb3JzNXh4XCIpID8/IDA7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBsYWJlbDogbmFtZSxcbiAgICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgICB7IG5hbWU6IFwiT0tcIiwgdmFsdWU6IE1hdGgubWF4KDAsIHJlcSAtIGU0IC0gZTUpLCBjb2xvcjogcC5hY2NlbnQgfSxcbiAgICAgICAgICB7IG5hbWU6IFwiNHh4XCIsIHZhbHVlOiBlNCwgY29sb3I6IHAuc3RhdHVzLndhcm5pbmcgfSxcbiAgICAgICAgICB7IG5hbWU6IFwiNXh4XCIsIHZhbHVlOiBlNSwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICAgIF0sXG4gICAgICAgIHZhbHVlVGV4dDogcmVxLnRvTG9jYWxlU3RyaW5nKCksXG4gICAgICAgIHRpcDogW2Ake3JlcS50b0xvY2FsZVN0cmluZygpfSByZXF1ZXN0c2AsIGAke2U0LnRvTG9jYWxlU3RyaW5nKCl9IDR4eCwgJHtlNS50b0xvY2FsZVN0cmluZygpfSA1eHhgLCBgcDk1IGxhdGVuY3k6ICR7Zm10KHYucDk1TGF0ZW5jeU1zLCBcImxhdGVuY3ltc1wiKX1gXSxcbiAgICAgIH07XG4gICAgfSlcbiAgICAuc29ydCgoYSwgYikgPT4gYi5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSAtIGEuc2VnbWVudHMucmVkdWNlKChzLCB4KSA9PiBzICsgeC52YWx1ZSwgMCkpO1xufVxuXG5mdW5jdGlvbiBSb3dzKHsgYXBpLCB2YWx1ZSwgcGF0aCA9IFwiXCIgfTogeyBhcGk6IFBsdWdpbkFwaTsgdmFsdWU6IEpzb247IHBhdGg/OiBzdHJpbmcgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgaXNFcnJvck5vZGUodmFsdWUpKSB7XG4gICAgcmV0dXJuIDxzcGFuPntmbXQodmFsdWUsIHBhdGgpfTwvc3Bhbj47XG4gIH1cbiAgY29uc3QgZW50cmllcyA9IE9iamVjdC5lbnRyaWVzKHZhbHVlKS5maWx0ZXIoKFssIHZdKSA9PiAhKHR5cGVvZiB2ID09PSBcInN0cmluZ1wiICYmICh2Lmxlbmd0aCA+IDgwIHx8IHYuaW5jbHVkZXMoXCJcXG5cIikpKSk7XG4gIGlmIChlbnRyaWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT5Ob25lPC9zcGFuPjtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBcIm1heC1jb250ZW50IDFmclwiLCBnYXA6IFwiMnB4IDE2cHhcIiB9fT5cbiAgICAgIHtlbnRyaWVzLm1hcCgoW2ssIHZdKSA9PiB7XG4gICAgICAgIGNvbnN0IG5lc3RlZCA9IHYgIT09IG51bGwgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIgJiYgIWlzRXJyb3JOb2RlKHYpO1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIDxkaXYga2V5PXtrfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0+XG4gICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+e3RpdGxlQ2FzZShrKX08L3NwYW4+XG4gICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogdmFsdWVUb25lKGssIHYpID8gcC5zdGF0dXNbdmFsdWVUb25lKGssIHYpIGFzIFN0YXR1c0NvbG9yXSA6IHVuZGVmaW5lZCB9fT5cbiAgICAgICAgICAgICAge25lc3RlZCA/IEFycmF5LmlzQXJyYXkodikgPyA8c3Bhbj57di5sZW5ndGggPyB2LmpvaW4oXCIsIFwiKSA6IFwiTm9uZVwifTwvc3Bhbj4gOiA8Um93cyBhcGk9e2FwaX0gdmFsdWU9e3Z9IHBhdGg9e2t9IC8+IDogZm10KHYsIGspfVxuICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICApO1xuICAgICAgfSl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbmNvbnN0IHRpdGxlQ2FzZSA9IChzOiBzdHJpbmcpID0+IHMucmVwbGFjZSgvKFtBLVpdKS9nLCBcIiAkMVwiKS5yZXBsYWNlKC9eLi8sIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkpO1xuXG5jb25zdCBBUFBfVFJFTkRTOiBUcmVuZFtdID0gW1xuICB7IHRpdGxlOiBcIlJlcXVlc3RzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMucmVxdWVzdHNcIikgfSxcbiAgeyB0aXRsZTogXCJMYW1iZGEgRXJyb3JzICgyNGgpXCIsIGtleTogXCJsYW1iZGFFcnJvcnNcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpIH0sXG4gIHsgdGl0bGU6IFwiUGF5aW5nIEN1c3RvbWVyc1wiLCBrZXk6IFwiXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcImN1c3RvbWVycy5wYXlpbmdcIikgfSxcbiAgeyB0aXRsZTogXCJNUlJcIiwga2V5OiBcIm1yclwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25leS5tcnJcIikgfSxcbiAgeyB0aXRsZTogXCJQcm9maXQgKDMwZClcIiwga2V5OiBcInByb2ZpdFwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25leS5wcm9maXQzMGRcIikgfSxcbl07XG5cbmZ1bmN0aW9uIEFwcFZpZXcoeyBhcGksIGFwcCwgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBhcHA6IEpzb247IGRheXM6IERheVtdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBhcHBEYXlzID0gZGF5cy5tYXAoKGQpID0+ICh7IGRhdGU6IGQuZGF0ZSwgZG9jOiBhcHBzT2YoZC5kb2MpLmZpbmQoKGEpID0+IGEubmFtZSA9PT0gYXBwLm5hbWUpIH0pKS5maWx0ZXIoKGQpID0+IGQuZG9jKTtcbiAgY29uc3QgbW9uID0gYXBwLm1vbml0b3Jpbmc7XG4gIGNvbnN0IGF1ZCA9IGFwcC5hdWRpZW5jZTtcbiAgY29uc3QgYXVkRGF5czogSnNvbltdID0gYXVkICYmIEFycmF5LmlzQXJyYXkoYXVkLmRheXMpID8gYXVkLmRheXMgOiBbXTtcbiAgY29uc3QgYXVkS2V5cyA9IGF1ZERheXMubGVuZ3RoID8gT2JqZWN0LmtleXMoYXVkRGF5c1swXSkuZmlsdGVyKChrKSA9PiBrICE9PSBcImRhdGVcIiAmJiB0eXBlb2YgYXVkRGF5c1swXVtrXSA9PT0gXCJudW1iZXJcIikgOiBbXTtcbiAgY29uc3QgbGFtYmRhcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmxhbWJkYXMpID8gbGFtYmRhUm93cyhhcGksIG1vbi5sYW1iZGFzKSA6IG51bGw7XG4gIGNvbnN0IGFwaXMgPSBtb24gJiYgIWlzRXJyb3JOb2RlKG1vbikgJiYgIWlzRXJyb3JOb2RlKG1vbi5hcGlzKSA/IGFwaVJvd3MoYXBpLCBtb24uYXBpcykgOiBudWxsO1xuICBjb25zdCBkZXRhaWxzID0gT2JqZWN0LmVudHJpZXMoYXBwKS5maWx0ZXIoKFtrXSkgPT4gayAhPT0gXCJuYW1lXCIgJiYgayAhPT0gXCJtb25pdG9yaW5nXCIpO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIiwgZ2FwOiAxMiB9fT5cbiAgICAgIDxUaWxlUm93PntBUFBfVFJFTkRTLmZpbHRlcigodCkgPT4gdC5nZXQoYXBwKSAhPT0gdW5kZWZpbmVkKS5tYXAoKHQpID0+IHRyZW5kVGlsZShhcGksIGFwcERheXMsIHQpKX08L1RpbGVSb3c+XG4gICAgICA8SGlzdG9yeUhpbnQgYXBpPXthcGl9IGRheXM9e2FwcERheXN9IC8+XG4gICAgICA8Rmxvdz5cbiAgICAgICAgPFRyZW5kQ2hhcnRzIGFwaT17YXBpfSBkYXlzPXthcHBEYXlzfSB0cmVuZHM9e0FQUF9UUkVORFN9IC8+XG4gICAgICAgIHttb24gJiYgaXNFcnJvck5vZGUobW9uKSAmJiAoXG4gICAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPVwiTW9uaXRvcmluZyAoMjRoKVwiIHRvbmU9XCJ3YXJuaW5nXCI+XG4gICAgICAgICAgICA8c3Bhbj57Zm10KG1vbil9PC9zcGFuPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2FwaXMgJiYgYXBpcy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT1cIkFQSSBSZXF1ZXN0cyAoMjRoKVwiXG4gICAgICAgICAgICB0b25lPXthcGlzLnNvbWUoKHIpID0+IHIuc2VnbWVudHMuc29tZSgocykgPT4gcy5uYW1lID09PSBcIjV4eFwiICYmIHMudmFsdWUgPiAwKSkgPyBcIndhcm5pbmdcIiA6IG51bGx9XG4gICAgICAgICAgICBleHRyYT17XG4gICAgICAgICAgICAgIDxMZWdlbmRcbiAgICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgICBpdGVtcz17W1xuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIk9LXCIsIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIjR4eFwiLCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIjV4eFwiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgICAgICAgICBdfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXthcGlzfSAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2xhbWJkYXMgJiYgbGFtYmRhcy5yb3dzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uXG4gICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgIHRpdGxlPVwiTGFtYmRhIEludm9jYXRpb25zICgyNGgpXCJcbiAgICAgICAgICAgIHRvbmU9e2xhbWJkYXMucm93cy5zb21lKChyKSA9PiByLnNlZ21lbnRzLnNvbWUoKHMpID0+IHMubmFtZSA9PT0gXCJFcnJvcnNcIiAmJiBzLnZhbHVlID4gMCkpID8gXCJlcnJvclwiIDogbnVsbH1cbiAgICAgICAgICAgIGV4dHJhPXtcbiAgICAgICAgICAgICAgPExlZ2VuZFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIGl0ZW1zPXtbXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiU3VjY2VlZGVkXCIsIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgICAgICAgICAgeyBuYW1lOiBcIkVycm9yc1wiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgICAgICAgICBdfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgfVxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxCYXJMaXN0IGFwaT17YXBpfSByb3dzPXtsYW1iZGFzLnJvd3N9IC8+XG4gICAgICAgICAgICB7KGxhbWJkYXMuaWRsZSA+IDAgfHwgbGFtYmRhcy51bmtub3duLmxlbmd0aCA+IDApICYmIChcbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAgICAgICAge1tsYW1iZGFzLmlkbGUgPyBgJHtsYW1iZGFzLmlkbGV9IGlkbGUgZnVuY3Rpb24ke2xhbWJkYXMuaWRsZSA+IDEgPyBcInNcIiA6IFwiXCJ9IGhpZGRlbmAgOiBcIlwiLCBsYW1iZGFzLnVua25vd24ubGVuZ3RoID8gYFVua25vd246ICR7bGFtYmRhcy51bmtub3duLmpvaW4oXCIsIFwiKX1gIDogXCJcIl1cbiAgICAgICAgICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgICAgICAgICAgICAgIC5qb2luKFwiLiBcIil9XG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7YXVkS2V5cy5tYXAoKGspID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e2t9IGFwaT17YXBpfSB0aXRsZT17YERhaWx5ICR7dGl0bGVDYXNlKGspfWB9PlxuICAgICAgICAgICAgPExpbmVDaGFydFxuICAgICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgICAgbGFiZWxzPXthdWREYXlzLm1hcCgoZCkgPT4gc2hvcnREYXRlKFN0cmluZyhkLmRhdGUpKSl9XG4gICAgICAgICAgICAgIHNlcmllcz17W3sgbmFtZTogdGl0bGVDYXNlKGspLCBjb2xvcjogcC5hY2NlbnQsIHZhbHVlczogYXVkRGF5cy5tYXAoKGQpID0+ICh0eXBlb2YgZFtrXSA9PT0gXCJudW1iZXJcIiA/IGRba10gOiBudWxsKSkgfV19XG4gICAgICAgICAgICAgIGZvcm1hdD17YXhpc0ZtdChrKX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApKX1cbiAgICAgICAge2F1ZD8uc291cmNlczMwZCAmJiAhaXNFcnJvck5vZGUoYXVkLnNvdXJjZXMzMGQpICYmIChcbiAgICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJUcmFmZmljIFNvdXJjZXMgKDMwZClcIj5cbiAgICAgICAgICAgIDxCYXJMaXN0XG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICByb3dzPXsoT2JqZWN0LmVudHJpZXMoYXVkLnNvdXJjZXMzMGQpIGFzIFtzdHJpbmcsIEpzb25dW10pXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoWywgdl0pID0+IHR5cGVvZiB2ID09PSBcIm51bWJlclwiKVxuICAgICAgICAgICAgICAgIC5zb3J0KChbLCBhXSwgWywgYl0pID0+IGIgLSBhKVxuICAgICAgICAgICAgICAgIC5tYXAoKFtrLCB2XSkgPT4gKHtcbiAgICAgICAgICAgICAgICAgIGxhYmVsOiB0aXRsZUNhc2UoayksXG4gICAgICAgICAgICAgICAgICBzZWdtZW50czogW3sgbmFtZTogXCJWaWV3c1wiLCB2YWx1ZTogdiwgY29sb3I6IHAuYWNjZW50IH1dLFxuICAgICAgICAgICAgICAgICAgdmFsdWVUZXh0OiB2LnRvTG9jYWxlU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICB0aXA6IFtgJHt2LnRvTG9jYWxlU3RyaW5nKCl9IHZpZXdzYF0sXG4gICAgICAgICAgICAgICAgfSkpfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHtkZXRhaWxzLm1hcCgoW2ssIHZdKSA9PiAoXG4gICAgICAgICAgPFNlY3Rpb24ga2V5PXtrfSBhcGk9e2FwaX0gdGl0bGU9e3RpdGxlQ2FzZShrKX0gdG9uZT17Z3JvdXBUb25lKHYpfT5cbiAgICAgICAgICAgIDxSb3dzXG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICB2YWx1ZT17ayA9PT0gXCJhdWRpZW5jZVwiICYmIHYgJiYgIWlzRXJyb3JOb2RlKHYpID8gT2JqZWN0LmZyb21FbnRyaWVzKE9iamVjdC5lbnRyaWVzKHYpLmZpbHRlcigoW2trXSkgPT4ga2sgIT09IFwiZGF5c1wiICYmIGtrICE9PSBcInNvdXJjZXMzMGRcIikpIDogdn1cbiAgICAgICAgICAgICAgcGF0aD17a31cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApKX1cbiAgICAgIDwvRmxvdz5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIENvbXBvbmVudCh7IGFwaSB9OiB7IGFwaTogUGx1Z2luQXBpOyBwYW5lSWQ/OiBzdHJpbmcgfSkge1xuICBjb25zdCB7IFRleHRCdXR0b24sIFRhYnMsIEJhbm5lciB9ID0gYXBpLnVpO1xuICBjb25zdCBwYWxldHRlID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IFssIGZvcmNlXSA9IHVzZVN0YXRlKDApO1xuICBjb25zdCBbdGFiLCBzZXRUYWJdID0gdXNlU3RhdGUoXCJvdmVydmlld1wiKTtcbiAgY29uc3QgWywgc2V0VGhlbWVdID0gdXNlU3RhdGUoMCk7XG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBsID0gKCkgPT4gZm9yY2UoKG4pID0+IG4gKyAxKTtcbiAgICBsaXN0ZW5lcnMuYWRkKGwpO1xuICAgIGNvbnN0IHVuc3ViID0gYXBpLnRoZW1lLnN1YnNjcmliZSgoKSA9PiBzZXRUaGVtZSgobikgPT4gbiArIDEpKTtcbiAgICBpZiAoIXN0YXRlLmRhdGEpIHtcbiAgICAgIHZvaWQgYXBpLnN0b3JhZ2UuZ2V0PEpzb24+KENBQ0hFX0tFWSkudGhlbigoY2FjaGVkKSA9PiB7XG4gICAgICAgIGlmIChjYWNoZWQgJiYgIXN0YXRlLmRhdGEpIHNldFN0YXRlKHsgZGF0YTogY2FjaGVkIH0pO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBsaXN0ZW5lcnMuZGVsZXRlKGwpO1xuICAgICAgdW5zdWIoKTtcbiAgICB9O1xuICB9LCBbYXBpXSk7XG5cbiAgY29uc3QgeyBkYXRhLCBlcnJvciB9ID0gc3RhdGU7XG4gIGNvbnN0IGFwcHMgPSBhcHBzT2YoZGF0YSk7XG4gIGNvbnN0IGRheXMgPSBhbGxEYXlzKCk7XG4gIGNvbnN0IGFnZSA9IGRhdGEgPyBhZ2VIb3VycyhkYXRhLmdlbmVyYXRlZEF0KSA6IG51bGw7XG4gIGNvbnN0IHN0YWxlID0gZGF0YSAmJiAoYWdlID09PSBudWxsIHx8IGFnZSA+IFNUQUxFX0hPVVJTKTtcbiAgY29uc3QgdGFiQXBwcyA9IGFwcHMuZmlsdGVyKChhKSA9PiAhKGEubmFtZSBpbiBPVkVSVklFV19PTkxZX0FQUFMpKTtcbiAgY29uc3QgY3VycmVudCA9IHRhYiA9PT0gXCJvdmVydmlld1wiID8gbnVsbCA6IHRhYkFwcHMuZmluZCgoYSkgPT4gYS5uYW1lID09PSB0YWIpO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBmbGV4OiAxLCBtaW5IZWlnaHQ6IDAsIGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyLCBjb2xvcjogcGFsZXR0ZS50ZXh0IH19PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiAxMiwgcGFkZGluZ1JpZ2h0OiAyNCB9fT5cbiAgICAgICAgPGgyIHN0eWxlPXt7IG1hcmdpbjogMCB9fT57TkFNRX08L2gyPlxuICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcGFsZXR0ZS50ZXh0TXV0ZWQsIGZsZXg6IDEgfX0+XG4gICAgICAgICAge2RhdGFcbiAgICAgICAgICAgID8gYEdlbmVyYXRlZCAke2RhdGEuZ2VuZXJhdGVkQXQgPyBuZXcgRGF0ZShkYXRhLmdlbmVyYXRlZEF0KS50b0xvY2FsZVN0cmluZygpIDogXCJVbmtub3duXCJ9IFx1MDBCNyAke2RheXMubGVuZ3RofSBEYXkke2RheXMubGVuZ3RoID09PSAxID8gXCJcIiA6IFwic1wifSBPZiBIaXN0b3J5YFxuICAgICAgICAgICAgOiBcIk5vIERhdGEgWWV0XCJ9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICAgPFRleHRCdXR0b24gbGFiZWw9XCJSZWZyZXNoXCIgdmFyaWFudD1cInByaW1hcnlcIiBvbkNsaWNrPXsoKSA9PiB2b2lkIHJlZnJlc2goYXBpKX0gLz5cbiAgICAgIDwvZGl2PlxuICAgICAge2Vycm9yICYmIDxCYW5uZXIgbWVzc2FnZT17YENvdWxkIE5vdCBMb2FkIE1ldHJpY3M6ICR7ZXJyb3J9YH0gdG9uZT1cImVycm9yXCIgLz59XG4gICAgICB7c3RhbGUgJiYgPEJhbm5lciBtZXNzYWdlPXtgTWV0cmljcyBBcmUgT2xkZXIgVGhhbiAke1NUQUxFX0hPVVJTfSBIb3VyczsgVGhlIERhaWx5IENvbGxlY3RvciBNYXkgSGF2ZSBGYWlsZWRgfSB0b25lPVwid2FybmluZ1wiIC8+fVxuICAgICAge2RhdGEgJiYgKFxuICAgICAgICA8PlxuICAgICAgICAgIDxUYWJzXG4gICAgICAgICAgICB0YWJzPXtbeyBsYWJlbDogXCJPdmVydmlld1wiLCB2YWx1ZTogXCJvdmVydmlld1wiIH0sIC4uLnRhYkFwcHMubWFwKChhKSA9PiAoeyBsYWJlbDogYS5uYW1lIGFzIHN0cmluZywgdmFsdWU6IGEubmFtZSBhcyBzdHJpbmcgfSkpXX1cbiAgICAgICAgICAgIHZhbHVlPXtjdXJyZW50ID8gdGFiIDogXCJvdmVydmlld1wifVxuICAgICAgICAgICAgb25DaGFuZ2U9e3NldFRhYn1cbiAgICAgICAgICAvPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgLi4uc2Nyb2xsYmFyU3R5bGUocGFsZXR0ZSksIGZsZXg6IDEsIG1pbkhlaWdodDogMCwgb3ZlcmZsb3c6IFwiYXV0b1wiLCBwYWRkaW5nUmlnaHQ6IEdBUCB9fT5cbiAgICAgICAgICAgIHtjdXJyZW50ID8gPEFwcFZpZXcgYXBpPXthcGl9IGFwcD17Y3VycmVudH0gZGF5cz17ZGF5c30gLz4gOiA8T3ZlcnZpZXcgYXBpPXthcGl9IGRvYz17ZGF0YX0gZGF5cz17ZGF5c30gLz59XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvPlxuICAgICAgKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFDQSxTQUFTLFdBQVcsUUFBUSxnQkFBZ0I7QUFpU3hDLFNBeVdBLFVBeldBLEtBeUVRLFlBekVSO0FBN1JKLElBQU0sT0FBTztBQUNiLElBQU0sY0FBYztBQUNwQixJQUFNLFlBQVk7QUFDbEIsSUFBTSxjQUFjO0FBQ3BCLElBQU0sV0FBVztBQUNqQixJQUFNLGlCQUFpQjtBQXdCdkIsSUFBSSxRQUFlLEVBQUUsTUFBTSxNQUFNLFNBQVMsQ0FBQyxHQUFHLE9BQU8sS0FBSztBQUMxRCxJQUFJLGFBQWE7QUFDakIs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

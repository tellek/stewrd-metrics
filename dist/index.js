// metrics/index.tsx
import { useEffect, useRef, useState } from "react";

// metrics/assets/refresh.png
var refresh_default = "data:image/png;base64,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";

// metrics/index.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var NAME = "Metrics";
var STALE_HOURS = 26;
var CACHE_KEY = "lastMetrics";
var HISTORY_DIR = "history";
var MAX_DAYS = 90;
var DEFAULT_BUCKET = "boxopher-metrics-429357724212";
var state = { data: null, history: [], error: null, spinning: false };
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
async function refresh(api, signal, manual = false) {
  if (manual) setState({ spinning: true });
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
    setState({ spinning: false });
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
  const { IconButton, Spinner, Tabs, Banner } = api.ui;
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
  const { data, error, spinning } = state;
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
      spinning ? /* @__PURE__ */ jsx(Spinner, { size: 16 }) : /* @__PURE__ */ jsx(IconButton, { label: "Refresh", icon: refresh_default, onClick: () => void refresh(api, void 0, true) })
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vaW5kZXgudHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLnN0ZXdyZC9wbHVnaW4tYXBpLmQudHNcIiAvPlxuaW1wb3J0IHsgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN0YXRlIH0gZnJvbSBcInJlYWN0XCI7XG5pbXBvcnQgdHlwZSB7IENTU1Byb3BlcnRpZXMsIE1vdXNlRXZlbnQsIFJlYWN0Tm9kZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Db250ZXh0LCBQbHVnaW5BcGksIFN0YXR1c0NvbG9yLCBQYWxldHRlIH0gZnJvbSBcInN0ZXdyZC1wbHVnaW4tYXBpXCI7XG5pbXBvcnQgcmVmcmVzaEljb24gZnJvbSBcIi4vYXNzZXRzL3JlZnJlc2gucG5nXCI7XG5cbmNvbnN0IE5BTUUgPSBcIk1ldHJpY3NcIjtcbmNvbnN0IFNUQUxFX0hPVVJTID0gMjY7XG5jb25zdCBDQUNIRV9LRVkgPSBcImxhc3RNZXRyaWNzXCI7XG5jb25zdCBISVNUT1JZX0RJUiA9IFwiaGlzdG9yeVwiO1xuY29uc3QgTUFYX0RBWVMgPSA5MDtcbmNvbnN0IERFRkFVTFRfQlVDS0VUID0gXCJib3hvcGhlci1tZXRyaWNzLTQyOTM1NzcyNDIxMlwiO1xuXG50eXBlIFNldHRpbmdzID0ge1xuICBidWNrZXQ/OiBzdHJpbmc7XG4gIHJlZnJlc2hNaW51dGVzPzogbnVtYmVyO1xuICBhd3NQcm9maWxlPzogc3RyaW5nO1xufTtcblxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbnR5cGUgSnNvbiA9IGFueTtcblxuaW50ZXJmYWNlIERheSB7XG4gIGRhdGU6IHN0cmluZztcbiAgZG9jOiBKc29uO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1vZHVsZS1sZXZlbCBzdG9yZSAoc2hhcmVkIGJ5IGFjdGl2YXRlLCB0aWNrLCByZWZyZXNoIGJ1dHRvbiBhbmQgZXZlcnkgbW91bnRlZCBwYW5lKSAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBTdGF0ZSB7XG4gIGRhdGE6IEpzb24gfCBudWxsO1xuICBoaXN0b3J5OiBEYXlbXTtcbiAgZXJyb3I6IHN0cmluZyB8IG51bGw7XG4gIC8qKiBPbmx5IG1hbnVhbCByZWZyZXNoZXMgc2hvdyB0aGUgc3Bpbm5lcjsgYmFja2dyb3VuZCBvbmVzIHN0YXkgaW52aXNpYmxlLiAqL1xuICBzcGlubmluZzogYm9vbGVhbjtcbn1cblxubGV0IHN0YXRlOiBTdGF0ZSA9IHsgZGF0YTogbnVsbCwgaGlzdG9yeTogW10sIGVycm9yOiBudWxsLCBzcGlubmluZzogZmFsc2UgfTtcbmxldCByZWZyZXNoaW5nID0gZmFsc2U7XG5jb25zdCBsaXN0ZW5lcnMgPSBuZXcgU2V0PCgpID0+IHZvaWQ+KCk7XG5cbi8qKiBTa2lwcyB1bmNoYW5nZWQgdmFsdWVzIHNvIGJhY2tncm91bmQgcmVmcmVzaGVzIGRvbid0IHJlLXJlbmRlciB0aGUgcGFuZS4gKi9cbmZ1bmN0aW9uIHNldFN0YXRlKHBhdGNoOiBQYXJ0aWFsPFN0YXRlPikge1xuICBpZiAoKE9iamVjdC5rZXlzKHBhdGNoKSBhcyAoa2V5b2YgU3RhdGUpW10pLmV2ZXJ5KChrKSA9PiBKU09OLnN0cmluZ2lmeShwYXRjaFtrXSkgPT09IEpTT04uc3RyaW5naWZ5KHN0YXRlW2tdKSkpIHJldHVybjtcbiAgc3RhdGUgPSB7IC4uLnN0YXRlLCAuLi5wYXRjaCB9O1xuICBsaXN0ZW5lcnMuZm9yRWFjaCgobCkgPT4gbCgpKTtcbn1cblxuLy8gLS0tLS0tLS0tLSBoZWxwZXJzIC0tLS0tLS0tLS1cblxuY29uc3QgaXNFcnJvck5vZGUgPSAodjogSnNvbik6IGJvb2xlYW4gPT4gdiAhPT0gbnVsbCAmJiB0eXBlb2YgdiA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2Ygdi5lcnJvciA9PT0gXCJzdHJpbmdcIjtcblxuZnVuY3Rpb24gaGFzRXJyb3JOb2RlKHY6IEpzb24pOiBib29sZWFuIHtcbiAgaWYgKGlzRXJyb3JOb2RlKHYpKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKEFycmF5LmlzQXJyYXkodikpIHJldHVybiB2LnNvbWUoaGFzRXJyb3JOb2RlKTtcbiAgaWYgKHYgJiYgdHlwZW9mIHYgPT09IFwib2JqZWN0XCIpIHJldHVybiBPYmplY3QudmFsdWVzKHYpLnNvbWUoaGFzRXJyb3JOb2RlKTtcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5jb25zdCBtb25leSA9IG5ldyBJbnRsLk51bWJlckZvcm1hdCh1bmRlZmluZWQsIHsgc3R5bGU6IFwiY3VycmVuY3lcIiwgY3VycmVuY3k6IFwiVVNEXCIgfSk7XG5jb25zdCBjb21wYWN0ID0gbmV3IEludGwuTnVtYmVyRm9ybWF0KHVuZGVmaW5lZCwgeyBub3RhdGlvbjogXCJjb21wYWN0XCIsIG1heGltdW1GcmFjdGlvbkRpZ2l0czogMSB9KTtcbmNvbnN0IE1PTkVZX0tFWSA9IC8obXJyfHByb2ZpdHxjb3N0fGFtb3VudHxyZXZlbnVlKS9pO1xuXG4vKiogU2luZ2xlIGZvcm1hdHRlcjogbnVsbC91bmRlZmluZWQvZXJyb3Igbm9kZXMgYXJlIFwiVW5rbm93blwiLCBuZXZlciB6ZXJvLiAqL1xuZnVuY3Rpb24gZm10KHY6IEpzb24sIGtleSA9IFwiXCIpOiBzdHJpbmcge1xuICBpZiAodiA9PT0gbnVsbCB8fCB2ID09PSB1bmRlZmluZWQpIHJldHVybiBcIlVua25vd25cIjtcbiAgaWYgKGlzRXJyb3JOb2RlKHYpKSByZXR1cm4gYFVua25vd24gKCR7di5lcnJvcn0pYDtcbiAgaWYgKHR5cGVvZiB2ID09PSBcIm51bWJlclwiKSB7XG4gICAgaWYgKE1PTkVZX0tFWS50ZXN0KGtleSkpIHJldHVybiBtb25leS5mb3JtYXQodik7XG4gICAgaWYgKC9sYXRlbmN5bXMvaS50ZXN0KGtleSkpIHJldHVybiBgJHtNYXRoLnJvdW5kKHYpfSBtc2A7XG4gICAgcmV0dXJuIHYudG9Mb2NhbGVTdHJpbmcoKTtcbiAgfVxuICBpZiAodHlwZW9mIHYgPT09IFwiYm9vbGVhblwiKSByZXR1cm4gdiA/IFwiWWVzXCIgOiBcIk5vXCI7XG4gIHJldHVybiBTdHJpbmcodik7XG59XG5cbi8qKiBUYWJsZSBjZWxsOiBcIi1cIiB3aGVuIHRoZSBhcHAgaGFzIG5vIHN1Y2ggbWV0cmljLCBvdGhlcndpc2UgZm10IChzbyB1bmtub3duIHN0YXlzIFwiVW5rbm93blwiKS4gKi9cbmNvbnN0IGNlbGwgPSAodjogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCwga2V5ID0gXCJcIikgPT4gKHYgPT09IHVuZGVmaW5lZCA/IFwiLVwiIDogZm10KHYsIGtleSkpO1xuXG5jb25zdCBheGlzRm10ID0gKGtleTogc3RyaW5nKSA9PiAobjogbnVtYmVyKSA9PiAoTU9ORVlfS0VZLnRlc3Qoa2V5KSA/IG1vbmV5LmZvcm1hdChuKSA6IGNvbXBhY3QuZm9ybWF0KG4pKTtcblxuZnVuY3Rpb24gYWdlSG91cnMoaXNvOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBudW1iZXIgfCBudWxsIHtcbiAgY29uc3QgdCA9IGlzbyA/IERhdGUucGFyc2UoaXNvKSA6IE5hTjtcbiAgcmV0dXJuIE51bWJlci5pc05hTih0KSA/IG51bGwgOiAoRGF0ZS5ub3coKSAtIHQpIC8gM182MDBfMDAwO1xufVxuXG5jb25zdCBzaG9ydERhdGUgPSAoZDogc3RyaW5nKSA9PiBuZXcgRGF0ZShgJHtkfVQwMDowMDowMFpgKS50b0xvY2FsZURhdGVTdHJpbmcodW5kZWZpbmVkLCB7IG1vbnRoOiBcInNob3J0XCIsIGRheTogXCJudW1lcmljXCIsIHRpbWVab25lOiBcIlVUQ1wiIH0pO1xuXG5jb25zdCBhcHBzT2YgPSAoZG9jOiBKc29uKTogSnNvbltdID0+IChkb2MgJiYgQXJyYXkuaXNBcnJheShkb2MuYXBwcykgPyBkb2MuYXBwcyA6IFtdKTtcblxuLyoqIFdhbGtzIGEgZG90dGVkIHBhdGguIHVuZGVmaW5lZCA9IG5vdCBwcmVzZW50LCBudWxsID0gdW5rbm93biAoZXJyb3Igbm9kZSBvciBudWxsKSwgbnVtYmVyID0gdmFsdWUuICovXG5mdW5jdGlvbiBtZXRyaWMobzogSnNvbiwgcGF0aDogc3RyaW5nKTogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCB7XG4gIGxldCB2ID0gbztcbiAgZm9yIChjb25zdCBrIG9mIHBhdGguc3BsaXQoXCIuXCIpKSB7XG4gICAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAodiA9PT0gbnVsbCB8fCBpc0Vycm9yTm9kZSh2KSkgcmV0dXJuIG51bGw7XG4gICAgdiA9IHZba107XG4gIH1cbiAgaWYgKHYgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHR5cGVvZiB2ID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2KSA/IHYgOiBudWxsO1xufVxuXG4vKiogU3VtcyBhIG1ldHJpYyBhY3Jvc3MgYXBwczsgYW55IHVua25vd24gYXBwIHZhbHVlIG1ha2VzIHRoZSB0b3RhbCB1bmtub3duLiAqL1xuZnVuY3Rpb24gc3VtQXBwcyhkb2M6IEpzb24sIHBhdGg6IHN0cmluZyk6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQge1xuICBpZiAoIWRvYyB8fCBpc0Vycm9yTm9kZShkb2MuYXBwcykpIHJldHVybiBudWxsO1xuICBjb25zdCB2YWxzID0gYXBwc09mKGRvYylcbiAgICAubWFwKChhKSA9PiBtZXRyaWMoYSwgcGF0aCkpXG4gICAgLmZpbHRlcigodikgPT4gdiAhPT0gdW5kZWZpbmVkKTtcbiAgaWYgKHZhbHMubGVuZ3RoID09PSAwKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4gdmFscy5zb21lKCh2KSA9PiB2ID09PSBudWxsKSA/IG51bGwgOiAodmFscyBhcyBudW1iZXJbXSkucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG59XG5cbi8qKiBTdGF0dXMgYSBzaW5nbGUgdmFsdWUgc2lnbmFsczogZmlyaW5nIGFsYXJtcyBhcmUgYW4gZXJyb3IsIDV4eCByZXNwb25zZXMgYSB3YXJuaW5nLiAqL1xuZnVuY3Rpb24gdmFsdWVUb25lKGtleTogc3RyaW5nLCB2OiBKc29uKTogU3RhdHVzQ29sb3IgfCBudWxsIHtcbiAgaWYgKHR5cGVvZiB2ICE9PSBcIm51bWJlclwiIHx8IHYgPD0gMCkgcmV0dXJuIG51bGw7XG4gIGlmIChrZXkgPT09IFwiaW5BbGFybVwiKSByZXR1cm4gXCJlcnJvclwiO1xuICBpZiAoa2V5ID09PSBcImxhbWJkYUVycm9yc1wiKSByZXR1cm4gXCJlcnJvclwiO1xuICBpZiAoa2V5ID09PSBcImVycm9yczV4eFwiKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogV29yc3Qgb2YgdGhlIGdpdmVuIHRvbmVzLCBpZ25vcmluZyBudWxsczsgbnVsbCB3aGVuIG5vbmUgYXJlIHNldC4gKi9cbmZ1bmN0aW9uIHdvcnN0VG9uZSh0b25lczogKFN0YXR1c0NvbG9yIHwgbnVsbCB8IHVuZGVmaW5lZClbXSk6IFN0YXR1c0NvbG9yIHwgbnVsbCB7XG4gIGNvbnN0IHNldCA9IHRvbmVzLmZpbHRlcigodCk6IHQgaXMgU3RhdHVzQ29sb3IgPT4gISF0KTtcbiAgcmV0dXJuIHNldC5sZW5ndGggPyB3b3JzdChzZXQpIDogbnVsbDtcbn1cblxuLyoqIFdvcnN0IHRvbmUgb2YgYW55IHZhbHVlIGluIGEgZ3JvdXA6IGZpcmluZyBhbGFybXMgLT4gZXJyb3I7IDV4eCwgc3RhbGUgc3RhdGVzIG9yIHVua25vd24gc2VjdGlvbnMgLT4gd2FybmluZy4gKi9cbmZ1bmN0aW9uIGdyb3VwVG9uZSh2OiBKc29uKTogU3RhdHVzQ29sb3IgfCBudWxsIHtcbiAgaWYgKGlzRXJyb3JOb2RlKHYpKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIGlmICghdiB8fCB0eXBlb2YgdiAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHRvbmVzOiBTdGF0dXNDb2xvcltdID0gW107XG4gIGNvbnN0IHdhbGsgPSAobzogSnNvbikgPT5cbiAgICBPYmplY3QuZW50cmllcyhvKS5mb3JFYWNoKChbaywgeF0pID0+IHtcbiAgICAgIGNvbnN0IHQgPSB2YWx1ZVRvbmUoaywgeCkgPz8gKGsgPT09IFwic3RhbGVTdGF0ZXNcIiAmJiB0eXBlb2YgeCA9PT0gXCJudW1iZXJcIiAmJiB4ID4gMCA/IFwid2FybmluZ1wiIDogbnVsbCkgPz8gKGlzRXJyb3JOb2RlKHgpID8gXCJ3YXJuaW5nXCIgOiBudWxsKTtcbiAgICAgIGlmICh0KSB0b25lcy5wdXNoKHQpO1xuICAgICAgZWxzZSBpZiAoeCAmJiB0eXBlb2YgeCA9PT0gXCJvYmplY3RcIikgd2Fsayh4KTtcbiAgICB9KTtcbiAgd2Fsayh2KTtcbiAgcmV0dXJuIHRvbmVzLmxlbmd0aCA/IHdvcnN0KHRvbmVzKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGFwcFN0YXR1cyhhcHA6IEpzb24pOiBTdGF0dXNDb2xvciB7XG4gIGlmICh2YWx1ZVRvbmUoXCJpbkFsYXJtXCIsIG1ldHJpYyhhcHAsIFwiaGVhbHRoLmFsYXJtcy5pbkFsYXJtXCIpKSkgcmV0dXJuIFwiZXJyb3JcIjtcbiAgaWYgKHZhbHVlVG9uZShcImxhbWJkYUVycm9yc1wiLCBtZXRyaWMoYXBwLCBcIm1vbml0b3JpbmcudG90YWxzLmxhbWJkYUVycm9yc1wiKSkpIHJldHVybiBcImVycm9yXCI7XG4gIGlmIChoYXNFcnJvck5vZGUoYXBwKSkgcmV0dXJuIFwid2FybmluZ1wiO1xuICBpZiAodmFsdWVUb25lKFwiZXJyb3JzNXh4XCIsIG1ldHJpYyhhcHAsIFwibW9uaXRvcmluZy50b3RhbHMuZXJyb3JzNXh4XCIpKSkgcmV0dXJuIFwid2FybmluZ1wiO1xuICBpZiAoKGFwcC5oZWFsdGg/LmZyZXNobmVzcz8uc3RhbGVTdGF0ZXMgPz8gMCkgPiAwKSByZXR1cm4gXCJ3YXJuaW5nXCI7XG4gIHJldHVybiBcInN1Y2Nlc3NcIjtcbn1cblxuY29uc3QgV09SU1Q6IFN0YXR1c0NvbG9yW10gPSBbXCJpZGxlXCIsIFwic3VjY2Vzc1wiLCBcIndhcm5pbmdcIiwgXCJlcnJvclwiXTtcbmNvbnN0IHdvcnN0ID0gKGNzOiBTdGF0dXNDb2xvcltdKTogU3RhdHVzQ29sb3IgPT4gY3MucmVkdWNlKChhLCBiKSA9PiAoV09SU1QuaW5kZXhPZihiKSA+IFdPUlNULmluZGV4T2YoYSkgPyBiIDogYSksIFwic3VjY2Vzc1wiIGFzIFN0YXR1c0NvbG9yKTtcblxuZnVuY3Rpb24gZG9jU3RhdHVzKGRvYzogSnNvbik6IFN0YXR1c0NvbG9yIHtcbiAgY29uc3QgYWdlID0gYWdlSG91cnMoZG9jLmdlbmVyYXRlZEF0KTtcbiAgY29uc3Qgc3RhbGUgPSBhZ2UgPT09IG51bGwgfHwgYWdlID4gU1RBTEVfSE9VUlM7XG4gIGNvbnN0IHN0YXR1cyA9IHdvcnN0KGFwcHNPZihkb2MpLm1hcChhcHBTdGF0dXMpKTtcbiAgcmV0dXJuIHN0YWxlIHx8IGhhc0Vycm9yTm9kZShkb2MpID8gd29yc3QoW3N0YXR1cywgXCJ3YXJuaW5nXCJdKSA6IHN0YXR1cztcbn1cblxuLyoqIEhpc3RvcnkgcGx1cyB0aGUgbGF0ZXN0IGRvY3VtZW50LCBvbmUgZW50cnkgcGVyIFVUQyBkYXRlLCBvbGRlc3QgZmlyc3QuICovXG5mdW5jdGlvbiBhbGxEYXlzKCk6IERheVtdIHtcbiAgY29uc3QgbSA9IG5ldyBNYXAoc3RhdGUuaGlzdG9yeS5tYXAoKGQpID0+IFtkLmRhdGUsIGQuZG9jXSkpO1xuICBpZiAodHlwZW9mIHN0YXRlLmRhdGE/LmdlbmVyYXRlZEF0ID09PSBcInN0cmluZ1wiKSBtLnNldChzdGF0ZS5kYXRhLmdlbmVyYXRlZEF0LnNsaWNlKDAsIDEwKSwgc3RhdGUuZGF0YSk7XG4gIHJldHVybiBbLi4ubS5lbnRyaWVzKCldLnNvcnQoKFthXSwgW2JdKSA9PiAoYSA8IGIgPyAtMSA6IDEpKS5tYXAoKFtkYXRlLCBkb2NdKSA9PiAoeyBkYXRlLCBkb2MgfSkpO1xufVxuXG4vLyAtLS0tLS0tLS0tIGZldGNoaW5nIC0tLS0tLS0tLS1cblxuYXN5bmMgZnVuY3Rpb24gYXdzQXJncyhhcGk6IFBsdWdpbkFwaSwgYXJnczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IHMgPSBhd2FpdCBhcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpO1xuICBjb25zdCBvdXQgPSBbLi4uYXJncywgXCItLWNsaS1jb25uZWN0LXRpbWVvdXRcIiwgXCIxMFwiLCBcIi0tY2xpLXJlYWQtdGltZW91dFwiLCBcIjE1XCJdO1xuICBpZiAocy5hd3NQcm9maWxlKSBvdXQucHVzaChcIi0tcHJvZmlsZVwiLCBzLmF3c1Byb2ZpbGUpO1xuICByZXR1cm4gb3V0O1xufVxuXG5hc3luYyBmdW5jdGlvbiBhd3MoYXBpOiBQbHVnaW5BcGksIGFyZ3M6IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcmVzID0gYXdhaXQgYXBpLnNoZWxsLmV4ZWMoXCJhd3NcIiwgYXdhaXQgYXdzQXJncyhhcGksIGFyZ3MpKTtcbiAgaWYgKHJlcy5jb2RlICE9PSAwKSB0aHJvdyBuZXcgRXJyb3IocmVzLnN0ZGVyci50cmltKCkgfHwgYGF3cyBleGl0ZWQgd2l0aCBjb2RlICR7cmVzLmNvZGV9YCk7XG4gIHJldHVybiByZXMuc3Rkb3V0O1xufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkSGlzdG9yeShhcGk6IFBsdWdpbkFwaSkge1xuICBjb25zdCBlbnRyaWVzID0gYXdhaXQgYXBpLmZzLmxpc3REaXIoSElTVE9SWV9ESVIpO1xuICBjb25zdCBmaWxlcyA9IGVudHJpZXNcbiAgICAuZmlsdGVyKChlKSA9PiAhZS5pc0RpciAmJiAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9XFwuanNvbiQvLnRlc3QoZS5uYW1lKSlcbiAgICAubWFwKChlKSA9PiBlLm5hbWUpXG4gICAgLnNvcnQoKVxuICAgIC5zbGljZSgtTUFYX0RBWVMpO1xuICBjb25zdCBkb2NzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgZmlsZXMubWFwKGFzeW5jIChmKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShhd2FpdCBhcGkuZnMucmVhZFRleHRGaWxlKGAke0hJU1RPUllfRElSfS8ke2Z9YCkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH0pLFxuICApO1xuICBzZXRTdGF0ZSh7IGhpc3Rvcnk6IGZpbGVzLm1hcCgoZiwgaSkgPT4gKHsgZGF0ZTogZi5zbGljZSgwLCAxMCksIGRvYzogZG9jc1tpXSB9KSkuZmlsdGVyKChkKSA9PiBkLmRvYykgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN5bmNIaXN0b3J5KGFwaTogUGx1Z2luQXBpLCBidWNrZXQ6IHN0cmluZykge1xuICBjb25zdCByb290ID0gKGF3YWl0IGFwaS5mcy5nZXRSb290UGF0aCgpKS5yZXBsYWNlKC9bXFxcXC9dKyQvLCBcIlwiKTtcbiAgYXdhaXQgYXdzKGFwaSwgW1wiczNcIiwgXCJzeW5jXCIsIGBzMzovLyR7YnVja2V0fS8ke0hJU1RPUllfRElSfS9gLCBgJHtyb290fS8ke0hJU1RPUllfRElSfWAsIFwiLS1vbmx5LXNob3ctZXJyb3JzXCJdKTtcbiAgYXdhaXQgbG9hZEhpc3RvcnkoYXBpKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVmcmVzaChhcGk6IFBsdWdpbkFwaSwgc2lnbmFsPzogQWJvcnRTaWduYWwsIG1hbnVhbCA9IGZhbHNlKSB7XG4gIGlmIChtYW51YWwpIHNldFN0YXRlKHsgc3Bpbm5pbmc6IHRydWUgfSk7XG4gIGlmIChyZWZyZXNoaW5nKSByZXR1cm47XG4gIHJlZnJlc2hpbmcgPSB0cnVlO1xuICBjb25zdCBzZXRJY29uID0gKGM6IFN0YXR1c0NvbG9yLCB0aXA/OiBzdHJpbmcpID0+IHtcbiAgICBpZiAoc2lnbmFsPy5hYm9ydGVkKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGFwaS5zdGF0dXNJY29uLnNldChjLCB0aXApO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogZGVhY3RpdmF0ZWQgKi9cbiAgICB9XG4gIH07XG4gIGNvbnN0IGxvZyA9IChsZXZlbDogXCJ3YXJuXCIgfCBcImVycm9yXCIsIG1zZzogc3RyaW5nKSA9PiB7XG4gICAgaWYgKHNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhcGkubG9nW2xldmVsXShgJHtOQU1FfTogJHttc2d9YCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBkZWFjdGl2YXRlZCAqL1xuICAgIH1cbiAgfTtcbiAgdHJ5IHtcbiAgICBjb25zdCBidWNrZXQgPSAoYXdhaXQgYXBpLnNldHRpbmdzLmdldDxTZXR0aW5ncz4oKSkuYnVja2V0IHx8IERFRkFVTFRfQlVDS0VUO1xuICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKGF3YWl0IGF3cyhhcGksIFtcInMzXCIsIFwiY3BcIiwgYHMzOi8vJHtidWNrZXR9L21ldHJpY3MuanNvbmAsIFwiLVwiXSkpO1xuICAgIGF3YWl0IGFwaS5zdG9yYWdlLnNldChDQUNIRV9LRVksIGRhdGEpO1xuICAgIHNldFN0YXRlKHsgZGF0YSwgZXJyb3I6IG51bGwgfSk7XG4gICAgbGV0IHN0YXR1cyA9IGRvY1N0YXR1cyhkYXRhKTtcbiAgICBsZXQgdGlwID0gc3RhdHVzID09PSBcInN1Y2Nlc3NcIiA/IFwiTWV0cmljcyB1cCB0byBkYXRlXCIgOiBzdGF0dXMgPT09IFwiZXJyb3JcIiA/IFwiQWxhcm1zIGZpcmluZyBvciBMYW1iZGEgZXJyb3JzXCIgOiBcIk1ldHJpY3MgbmVlZCBhdHRlbnRpb25cIjtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3luY0hpc3RvcnkoYXBpLCBidWNrZXQpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnN0IG1zZyA9IGUgaW5zdGFuY2VvZiBFcnJvciA/IGUubWVzc2FnZSA6IFN0cmluZyhlKTtcbiAgICAgIGxvZyhcIndhcm5cIiwgYGhpc3Rvcnkgc3luYyBmYWlsZWQ6ICR7bXNnfWApO1xuICAgICAgc3RhdHVzID0gd29yc3QoW3N0YXR1cywgXCJ3YXJuaW5nXCJdKTtcbiAgICAgIHRpcCA9IGBIaXN0b3J5IHN5bmMgZmFpbGVkOiAke21zZ31gO1xuICAgIH1cbiAgICAvLyBUaGUgaWNvbiBvbmx5IHNpZ25hbHMgcHJvYmxlbXM7IGFueXRoaW5nIHNob3J0IG9mIHdhcm5pbmcgc3RheXMgaWRsZSAoZGVmYXVsdCB0aW50KS5cbiAgICBzZXRJY29uKHN0YXR1cyA9PT0gXCJ3YXJuaW5nXCIgfHwgc3RhdHVzID09PSBcImVycm9yXCIgPyBzdGF0dXMgOiBcImlkbGVcIiwgdGlwKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnN0IG1zZyA9IGUgaW5zdGFuY2VvZiBFcnJvciA/IGUubWVzc2FnZSA6IFN0cmluZyhlKTtcbiAgICBzZXRTdGF0ZSh7IGVycm9yOiBtc2cgfSk7XG4gICAgc2V0SWNvbihcImVycm9yXCIsIG1zZyk7XG4gICAgbG9nKFwiZXJyb3JcIiwgbXNnKTtcbiAgfSBmaW5hbGx5IHtcbiAgICByZWZyZXNoaW5nID0gZmFsc2U7XG4gICAgc2V0U3RhdGUoeyBzcGlubmluZzogZmFsc2UgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlKGN0eDogUGx1Z2luQ29udGV4dCkge1xuICBjdHguYXBpLnN0YXR1c0ljb24uc2V0KFwiaWRsZVwiKTtcbiAgY29uc3QgcyA9IGF3YWl0IGN0eC5hcGkuc2V0dGluZ3MuZ2V0PFNldHRpbmdzPigpO1xuICBjb25zdCBtaW51dGVzID0gTWF0aC5tYXgoMSwgcy5yZWZyZXNoTWludXRlcyA/PyA2MCk7XG4gIGN0eC50aWNrLnJlZ2lzdGVyKCgpID0+IHJlZnJlc2goY3R4LmFwaSwgY3R4LnNpZ25hbCkpO1xuICBjdHgudGljay5zZXRJbnRlcnZhbChtaW51dGVzICogNjBfMDAwKTtcbiAgY3R4LmFwaS5sb2cuaW5mbyhgJHtOQU1FfSBhY3RpdmF0ZWRgKTtcbiAgdm9pZCBsb2FkSGlzdG9yeShjdHguYXBpKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICB2b2lkIHJlZnJlc2goY3R4LmFwaSwgY3R4LnNpZ25hbCk7XG59XG5cbi8vIC0tLS0tLS0tLS0gY2hhcnQgcHJpbWl0aXZlcyAtLS0tLS0tLS0tXG5cbmNvbnN0IENIQVJUX0hFSUdIVCA9IDE3MDtcblxuY29uc3Qgc2Nyb2xsYmFyU3R5bGUgPSAocDogUGFsZXR0ZSk6IENTU1Byb3BlcnRpZXMgPT4gKHsgc2Nyb2xsYmFyV2lkdGg6IFwidGhpblwiLCBzY3JvbGxiYXJDb2xvcjogYCR7cC5ib3JkZXJ9ICR7cC5zdXJmYWNlfWAgfSk7XG5cbmZ1bmN0aW9uIHVzZVdpZHRoKCkge1xuICBjb25zdCByZWYgPSB1c2VSZWY8SFRNTERpdkVsZW1lbnQ+KG51bGwpO1xuICBjb25zdCBbd2lkdGgsIHNldFdpZHRoXSA9IHVzZVN0YXRlKDApO1xuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGVsID0gcmVmLmN1cnJlbnQ7XG4gICAgaWYgKCFlbCkgcmV0dXJuO1xuICAgIGNvbnN0IHJvID0gbmV3IFJlc2l6ZU9ic2VydmVyKChbZV0pID0+IHNldFdpZHRoKGUuY29udGVudFJlY3Qud2lkdGgpKTtcbiAgICByby5vYnNlcnZlKGVsKTtcbiAgICByZXR1cm4gKCkgPT4gcm8uZGlzY29ubmVjdCgpO1xuICB9LCBbXSk7XG4gIHJldHVybiBbcmVmLCB3aWR0aF0gYXMgY29uc3Q7XG59XG5cbmZ1bmN0aW9uIG5pY2VNYXgodjogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKHYgPD0gMCkgcmV0dXJuIDE7XG4gIGNvbnN0IHAgPSAxMCAqKiBNYXRoLmZsb29yKE1hdGgubG9nMTAodikpO1xuICBjb25zdCBuID0gdiAvIHA7XG4gIHJldHVybiAobiA8PSAxID8gMSA6IG4gPD0gMiA/IDIgOiBuIDw9IDUgPyA1IDogMTApICogcDtcbn1cblxuZnVuY3Rpb24gVG9vbHRpcCh7IHAsIHgsIHksIGZsaXAsIGZpeGVkLCBjaGlsZHJlbiB9OiB7IHA6IFBhbGV0dGU7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBmbGlwOiBib29sZWFuOyBmaXhlZD86IGJvb2xlYW47IGNoaWxkcmVuOiBSZWFjdE5vZGUgfSkge1xuICByZXR1cm4gKFxuICAgIDxkaXZcbiAgICAgIHN0eWxlPXt7XG4gICAgICAgIHBvc2l0aW9uOiBmaXhlZCA/IFwiZml4ZWRcIiA6IFwiYWJzb2x1dGVcIixcbiAgICAgICAgbGVmdDogeCxcbiAgICAgICAgdG9wOiB5LFxuICAgICAgICB0cmFuc2Zvcm06IGZsaXAgPyBcInRyYW5zbGF0ZVgoLTEwMCUpXCIgOiB1bmRlZmluZWQsXG4gICAgICAgIGJhY2tncm91bmQ6IHAuYmFja2dyb3VuZCxcbiAgICAgICAgY29sb3I6IHAudGV4dCxcbiAgICAgICAgYm9yZGVyOiBgMXB4IHNvbGlkICR7cC5ib3JkZXJ9YCxcbiAgICAgICAgYm9yZGVyUmFkaXVzOiA0LFxuICAgICAgICBwYWRkaW5nOiBcIjRweCA4cHhcIixcbiAgICAgICAgZm9udFNpemU6IDEyLFxuICAgICAgICBsaW5lSGVpZ2h0OiBcIjE4cHhcIixcbiAgICAgICAgd2hpdGVTcGFjZTogXCJub3dyYXBcIixcbiAgICAgICAgcG9pbnRlckV2ZW50czogXCJub25lXCIsXG4gICAgICAgIHpJbmRleDogMSxcbiAgICAgIH19XG4gICAgPlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5pbnRlcmZhY2UgU2VyaWVzIHtcbiAgbmFtZTogc3RyaW5nO1xuICBjb2xvcjogc3RyaW5nO1xuICB2YWx1ZXM6IChudW1iZXIgfCBudWxsKVtdO1xufVxuXG4vKiogTGluZSBjaGFydCBvdmVyIHRpbWUgb24gb25lIHNoYXJlZCBheGlzLiBVbmtub3duIChudWxsKSBwb2ludHMgYnJlYWsgYSBsaW5lIGluc3RlYWQgb2YgZHJvcHBpbmcgdG8gemVybzsgYSBsb25lIHNlcmllcyBhbHNvIGdldHMgYW4gYXJlYSBmaWxsLiAqL1xuZnVuY3Rpb24gTGluZUNoYXJ0KHsgYXBpLCBsYWJlbHMsIHNlcmllcywgZm9ybWF0LCBoZWlnaHQgPSBDSEFSVF9IRUlHSFQgfTogeyBhcGk6IFBsdWdpbkFwaTsgbGFiZWxzOiBzdHJpbmdbXTsgc2VyaWVzOiBTZXJpZXNbXTsgZm9ybWF0OiAobjogbnVtYmVyKSA9PiBzdHJpbmc7IGhlaWdodD86IG51bWJlciB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgW3JlZiwgd2lkdGhdID0gdXNlV2lkdGgoKTtcbiAgY29uc3QgW2hvdmVyLCBzZXRIb3Zlcl0gPSB1c2VTdGF0ZTxudW1iZXIgfCBudWxsPihudWxsKTtcbiAgY29uc3QgTCA9IDU2LFxuICAgIFIgPSAxMixcbiAgICBUID0gMTAsXG4gICAgQiA9IDIyO1xuICBjb25zdCB3ID0gTWF0aC5tYXgoMSwgd2lkdGggLSBMIC0gUik7XG4gIGNvbnN0IGggPSBoZWlnaHQgLSBUIC0gQjtcbiAgY29uc3QgbiA9IGxhYmVscy5sZW5ndGg7XG4gIGNvbnN0IG1heCA9IG5pY2VNYXgoTWF0aC5tYXgoMCwgLi4uc2VyaWVzLmZsYXRNYXAoKHMpID0+IHMudmFsdWVzLm1hcCgodikgPT4gdiA/PyAwKSkpKTtcbiAgY29uc3QgeCA9IChpOiBudW1iZXIpID0+IEwgKyAobiA8PSAxID8gdyAvIDIgOiAoaSAqIHcpIC8gKG4gLSAxKSk7XG4gIGNvbnN0IHkgPSAodjogbnVtYmVyKSA9PiBUICsgaCAtICh2IC8gbWF4KSAqIGg7XG5cbiAgY29uc3QgcnVuc09mID0gKHZhbHVlczogKG51bWJlciB8IG51bGwpW10pID0+IHtcbiAgICBjb25zdCBydW5zOiBudW1iZXJbXVtdID0gW107XG4gICAgbGV0IGN1cjogbnVtYmVyW10gPSBbXTtcbiAgICB2YWx1ZXMuZm9yRWFjaCgodiwgaSkgPT4ge1xuICAgICAgaWYgKHYgPT09IG51bGwpIHtcbiAgICAgICAgaWYgKGN1ci5sZW5ndGgpIHJ1bnMucHVzaChjdXIpO1xuICAgICAgICBjdXIgPSBbXTtcbiAgICAgIH0gZWxzZSBjdXIucHVzaChpKTtcbiAgICB9KTtcbiAgICBpZiAoY3VyLmxlbmd0aCkgcnVucy5wdXNoKGN1cik7XG4gICAgcmV0dXJuIHJ1bnM7XG4gIH07XG5cbiAgY29uc3Qgb25Nb3ZlID0gKGU6IE1vdXNlRXZlbnQ8U1ZHUmVjdEVsZW1lbnQ+KSA9PiB7XG4gICAgY29uc3QgciA9IGUuY3VycmVudFRhcmdldC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBjb25zdCBpID0gbiA8PSAxID8gMCA6IE1hdGgucm91bmQoKChlLmNsaWVudFggLSByLmxlZnQpIC8gci53aWR0aCkgKiAobiAtIDEpKTtcbiAgICBzZXRIb3ZlcihNYXRoLm1pbihuIC0gMSwgTWF0aC5tYXgoMCwgaSkpKTtcbiAgfTtcblxuICBjb25zdCB4TGFiZWxzID0gbiA8PSAxID8gWzBdIDogbiA9PT0gMiA/IFswLCAxXSA6IFswLCBNYXRoLmZsb29yKChuIC0gMSkgLyAyKSwgbiAtIDFdO1xuICBjb25zdCBhbmNob3IgPSAoaTogbnVtYmVyKSA9PiAobiA8PSAxID8gXCJtaWRkbGVcIiA6IGkgPT09IDAgPyBcInN0YXJ0XCIgOiBpID09PSBuIC0gMSA/IFwiZW5kXCIgOiBcIm1pZGRsZVwiKTtcbiAgY29uc3QgZmxpcCA9IGhvdmVyICE9PSBudWxsICYmIHgoaG92ZXIpID4gd2lkdGggLSAxNjA7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHJlZj17cmVmfSBzdHlsZT17eyBwb3NpdGlvbjogXCJyZWxhdGl2ZVwiLCBoZWlnaHQgfX0+XG4gICAgICB7d2lkdGggPiAwICYmIChcbiAgICAgICAgPHN2ZyB3aWR0aD17d2lkdGh9IGhlaWdodD17aGVpZ2h0fSBzdHlsZT17eyBkaXNwbGF5OiBcImJsb2NrXCIsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICB7WzAsIDAuNSwgMV0ubWFwKChmKSA9PiAoXG4gICAgICAgICAgICA8ZyBrZXk9e2Z9PlxuICAgICAgICAgICAgICA8bGluZSB4MT17TH0geDI9e0wgKyB3fSB5MT17eShtYXggKiBmKX0geTI9e3kobWF4ICogZil9IHN0cm9rZT17cC5ib3JkZXJ9IHN0cm9rZVdpZHRoPXsxfSBzdHJva2VEYXNoYXJyYXk9e2YgPyBcIjIgNFwiIDogdW5kZWZpbmVkfSAvPlxuICAgICAgICAgICAgICA8dGV4dCB4PXtMIC0gNn0geT17eShtYXggKiBmKX0gZHk9XCIwLjMyZW1cIiB0ZXh0QW5jaG9yPVwiZW5kXCIgZmlsbD17cC50ZXh0TXV0ZWR9PlxuICAgICAgICAgICAgICAgIHtmb3JtYXQobWF4ICogZil9XG4gICAgICAgICAgICAgIDwvdGV4dD5cbiAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICApKX1cbiAgICAgICAgICB7eExhYmVscy5tYXAoKGkpID0+IChcbiAgICAgICAgICAgIDx0ZXh0IGtleT17aX0geD17eChpKX0geT17aGVpZ2h0IC0gNH0gdGV4dEFuY2hvcj17YW5jaG9yKGkpfSBmaWxsPXtwLnRleHRNdXRlZH0+XG4gICAgICAgICAgICAgIHtsYWJlbHNbaV19XG4gICAgICAgICAgICA8L3RleHQ+XG4gICAgICAgICAgKSl9XG4gICAgICAgICAge3Nlcmllcy5tYXAoKHMpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJ1bnMgPSBydW5zT2Yocy52YWx1ZXMpO1xuICAgICAgICAgICAgY29uc3QgbGluZSA9IChydW46IG51bWJlcltdKSA9PiBydW4ubWFwKChpLCBrKSA9PiBgJHtrID8gXCJMXCIgOiBcIk1cIn0ke3goaSl9LCR7eShzLnZhbHVlc1tpXSBhcyBudW1iZXIpfWApLmpvaW4oXCJcIik7XG4gICAgICAgICAgICBjb25zdCBsYXN0S25vd24gPSBbLi4ucy52YWx1ZXMua2V5cygpXS5yZXZlcnNlKCkuZmluZCgoaSkgPT4gcy52YWx1ZXNbaV0gIT09IG51bGwpO1xuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgPGcga2V5PXtzLm5hbWV9PlxuICAgICAgICAgICAgICAgIHtydW5zLm1hcCgocnVuKSA9PlxuICAgICAgICAgICAgICAgICAgcnVuLmxlbmd0aCA+IDEgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxnIGtleT17cnVuWzBdfT5cbiAgICAgICAgICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA9PT0gMSAmJiA8cGF0aCBkPXtgJHtsaW5lKHJ1bil9TCR7eChydW5bcnVuLmxlbmd0aCAtIDFdKX0sJHt5KDApfUwke3gocnVuWzBdKX0sJHt5KDApfVpgfSBmaWxsPXtzLmNvbG9yfSBmaWxsT3BhY2l0eT17MC4xMn0gLz59XG4gICAgICAgICAgICAgICAgICAgICAgPHBhdGggZD17bGluZShydW4pfSBmaWxsPVwibm9uZVwiIHN0cm9rZT17cy5jb2xvcn0gc3Ryb2tlV2lkdGg9ezJ9IHN0cm9rZUxpbmVqb2luPVwicm91bmRcIiBzdHJva2VMaW5lY2FwPVwicm91bmRcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2c+XG4gICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICA8Y2lyY2xlIGtleT17cnVuWzBdfSBjeD17eChydW5bMF0pfSBjeT17eShzLnZhbHVlc1tydW5bMF1dIGFzIG51bWJlcil9IHI9ezN9IGZpbGw9e3MuY29sb3J9IC8+XG4gICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAge2xhc3RLbm93biAhPT0gdW5kZWZpbmVkICYmIGhvdmVyID09PSBudWxsICYmIChcbiAgICAgICAgICAgICAgICAgIDxjaXJjbGUgY3g9e3gobGFzdEtub3duKX0gY3k9e3kocy52YWx1ZXNbbGFzdEtub3duXSBhcyBudW1iZXIpfSByPXszLjV9IGZpbGw9e3MuY29sb3J9IHN0cm9rZT17cC5zdXJmYWNlfSBzdHJva2VXaWR0aD17Mn0gLz5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiBzLnZhbHVlc1tob3Zlcl0gIT09IG51bGwgJiYgKFxuICAgICAgICAgICAgICAgICAgPGNpcmNsZSBjeD17eChob3Zlcil9IGN5PXt5KHMudmFsdWVzW2hvdmVyXSBhcyBudW1iZXIpfSByPXs0LjV9IGZpbGw9e3MuY29sb3J9IHN0cm9rZT17cC5zdXJmYWNlfSBzdHJva2VXaWR0aD17Mn0gcG9pbnRlckV2ZW50cz1cIm5vbmVcIiAvPlxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgIDwvZz5cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSl9XG4gICAgICAgICAge2hvdmVyICE9PSBudWxsICYmIDxsaW5lIHgxPXt4KGhvdmVyKX0geDI9e3goaG92ZXIpfSB5MT17VH0geTI9e1QgKyBofSBzdHJva2U9e3AudGV4dE11dGVkfSBzdHJva2VXaWR0aD17MX0gcG9pbnRlckV2ZW50cz1cIm5vbmVcIiAvPn1cbiAgICAgICAgICA8cmVjdCB4PXtMfSB5PXswfSB3aWR0aD17d30gaGVpZ2h0PXtoZWlnaHR9IGZpbGw9XCJ0cmFuc3BhcmVudFwiIG9uTW91c2VNb3ZlPXtvbk1vdmV9IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9IC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICAgKX1cbiAgICAgIHtob3ZlciAhPT0gbnVsbCAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e3goaG92ZXIpICsgKGZsaXAgPyAtMTAgOiAxMCl9IHk9e1R9IGZsaXA9e2ZsaXB9PlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19PntsYWJlbHNbaG92ZXJdfTwvZGl2PlxuICAgICAgICAgIHtzZXJpZXMubWFwKChzKSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17cy5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiA2IH19PlxuICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA+IDEgJiYgPHNwYW4gc3R5bGU9e3sgd2lkdGg6IDgsIGhlaWdodDogOCwgYm9yZGVyUmFkaXVzOiAyLCBiYWNrZ3JvdW5kOiBzLmNvbG9yIH19IC8+fVxuICAgICAgICAgICAgICB7c2VyaWVzLmxlbmd0aCA+IDEgJiYgPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19PntzLm5hbWV9PC9zcGFuPn1cbiAgICAgICAgICAgICAgPHNwYW4+e3MudmFsdWVzW2hvdmVyXSA9PT0gbnVsbCA/IFwiVW5rbm93blwiIDogZm9ybWF0KHMudmFsdWVzW2hvdmVyXSBhcyBudW1iZXIpfTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICkpfVxuICAgICAgICA8L1Rvb2x0aXA+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5pbnRlcmZhY2UgU2VnIHtcbiAgbmFtZTogc3RyaW5nO1xuICB2YWx1ZTogbnVtYmVyO1xuICBjb2xvcjogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgQmFyUm93IHtcbiAgbGFiZWw6IHN0cmluZztcbiAgc2VnbWVudHM6IFNlZ1tdO1xuICB2YWx1ZVRleHQ6IHN0cmluZztcbiAgdGlwOiBzdHJpbmdbXTtcbn1cblxuZnVuY3Rpb24gTGVnZW5kKHsgYXBpLCBpdGVtcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBpdGVtczogeyBuYW1lOiBzdHJpbmc7IGNvbG9yOiBzdHJpbmcgfVtdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGdhcDogMTYsIGZsZXhXcmFwOiBcIndyYXBcIiwgZm9udFNpemU6IDEyLCBjb2xvcjogcC50ZXh0TXV0ZWQgfX0+XG4gICAgICB7aXRlbXMubWFwKChpdCkgPT4gKFxuICAgICAgICA8c3BhbiBrZXk9e2l0Lm5hbWV9IHN0eWxlPXt7IGRpc3BsYXk6IFwiaW5saW5lLWZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiA2IH19PlxuICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IHdpZHRoOiAxMCwgaGVpZ2h0OiAxMCwgYm9yZGVyUmFkaXVzOiAyLCBiYWNrZ3JvdW5kOiBpdC5jb2xvciB9fSAvPlxuICAgICAgICAgIHtpdC5uYW1lfVxuICAgICAgICA8L3NwYW4+XG4gICAgICApKX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuLyoqIEhvcml6b250YWwgKG9wdGlvbmFsbHkgc3RhY2tlZCkgYmFycyBzaGFyaW5nIG9uZSBzY2FsZSwgdmFsdWUgbGFiZWxzIGF0IHRoZSBlbmQuIFNjcm9sbHMgcGFzdCBCQVJfTElTVF9IRUlHSFQuICovXG5mdW5jdGlvbiBCYXJMaXN0KHsgYXBpLCByb3dzIH06IHsgYXBpOiBQbHVnaW5BcGk7IHJvd3M6IEJhclJvd1tdIH0pIHtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBbaG92ZXIsIHNldEhvdmVyXSA9IHVzZVN0YXRlPHsgaTogbnVtYmVyOyB4OiBudW1iZXI7IHk6IG51bWJlciB9IHwgbnVsbD4obnVsbCk7XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KDAsIC4uLnJvd3MubWFwKChyKSA9PiByLnNlZ21lbnRzLnJlZHVjZSgoYSwgcykgPT4gYSArIHMudmFsdWUsIDApKSkgfHwgMTtcbiAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICBjb25zdCBmbGlwID0gaG92ZXIgIT09IG51bGwgJiYgaG92ZXIueCA+IHdpbmRvdy5pbm5lcldpZHRoIC0gMjAwO1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgLi4uc2Nyb2xsYmFyU3R5bGUocCksIG1heEhlaWdodDogQ0hBUlRfSEVJR0hULCBvdmVyZmxvd1k6IFwiYXV0b1wiLCBvdmVyZmxvd1g6IFwiaGlkZGVuXCIsIHBhZGRpbmdSaWdodDogR0FQIH19IG9uTW91c2VMZWF2ZT17KCkgPT4gc2V0SG92ZXIobnVsbCl9PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJtaW5tYXgoMCwgbWF4LWNvbnRlbnQpIDFmciBtYXgtY29udGVudFwiLCBnYXA6IFwiMnB4IDEycHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZm9udFNpemU6IDE0IH19PlxuICAgICAgICB7cm93cy5tYXAoKHIsIGkpID0+IHtcbiAgICAgICAgICBjb25zdCB0b3RhbCA9IHIuc2VnbWVudHMucmVkdWNlKChhLCBzKSA9PiBhICsgcy52YWx1ZSwgMCk7XG4gICAgICAgICAgY29uc3QgaG90ID0gaG92ZXI/LmkgPT09IGk7XG4gICAgICAgICAgY29uc3QgY2VsbDogQ1NTUHJvcGVydGllcyA9IHsgYmFja2dyb3VuZDogaG90ID8gcC5zdXJmYWNlSG92ZXIgOiB1bmRlZmluZWQsIHBhZGRpbmc6IFwiMnB4IDBcIiB9O1xuICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17ci5sYWJlbH0gc3R5bGU9e3sgZGlzcGxheTogXCJjb250ZW50c1wiIH19IG9uTW91c2VNb3ZlPXsoZSkgPT4gc2V0SG92ZXIoeyBpLCB4OiBlLmNsaWVudFgsIHk6IGUuY2xpZW50WSB9KX0+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIGNvbG9yOiBob3QgPyBwLmFjY2VudCA6IHAudGV4dCwgbWF4V2lkdGg6IDIyMCwgb3ZlcmZsb3c6IFwiaGlkZGVuXCIsIHRleHRPdmVyZmxvdzogXCJlbGxpcHNpc1wiLCB3aGl0ZVNwYWNlOiBcIm5vd3JhcFwiIH19IHRpdGxlPXtyLmxhYmVsfT5cbiAgICAgICAgICAgICAgICB7ci5sYWJlbH1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IC4uLmNlbGwsIGRpc3BsYXk6IFwiZmxleFwiLCBoZWlnaHQ6IDIyLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiIH19PlxuICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIHdpZHRoOiBgJHsodG90YWwgLyBtYXgpICogMTAwfSVgLCBoZWlnaHQ6IDEyLCBnYXA6IDEsIG1pbldpZHRoOiB0b3RhbCA+IDAgPyAyIDogMCB9fT5cbiAgICAgICAgICAgICAgICAgIHtyLnNlZ21lbnRzXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKHMpID0+IHMudmFsdWUgPiAwKVxuICAgICAgICAgICAgICAgICAgICAubWFwKChzLCBrLCBhcnIpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICAgICAgICAgICAgICBrZXk9e3MubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGZsZXg6IHMudmFsdWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHMuY29sb3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGJvcmRlclJhZGl1czogYCR7ayA9PT0gMCA/IDIgOiAwfXB4ICR7ayA9PT0gYXJyLmxlbmd0aCAtIDEgPyAyIDogMH1weCAke2sgPT09IGFyci5sZW5ndGggLSAxID8gMiA6IDB9cHggJHtrID09PSAwID8gMiA6IDB9cHhgLFxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IC4uLmNlbGwsIHRleHRBbGlnbjogXCJyaWdodFwiLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIgfX0+e3IudmFsdWVUZXh0fTwvc3Bhbj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICk7XG4gICAgICAgIH0pfVxuICAgICAgPC9kaXY+XG4gICAgICB7aG92ZXIgJiYgcm93c1tob3Zlci5pXSAmJiAoXG4gICAgICAgIDxUb29sdGlwIHA9e3B9IHg9e2hvdmVyLnggKyAoZmxpcCA/IC0xMiA6IDEyKX0geT17aG92ZXIueSArIDEyfSBmbGlwPXtmbGlwfSBmaXhlZD5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRXZWlnaHQ6IDYwMCB9fT57cm93c1tob3Zlci5pXS5sYWJlbH08L2Rpdj5cbiAgICAgICAgICB7cm93c1tob3Zlci5pXS50aXAubWFwKCh0KSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17dH0+e3R9PC9kaXY+XG4gICAgICAgICAgKSl9XG4gICAgICAgIDwvVG9vbHRpcD5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbi8qKiBgdG9uZWAgY29sb3JzIHRoZSB2YWx1ZSBhbmQgYm9yZGVyIChmaXhlZCBydWxlcyk7IGBvdXRsaW5lYCBvbmx5IGNvbG9ycyB0aGUgYm9yZGVyIChhdmVyYWdlIGRldmlhdGlvbikuICovXG5mdW5jdGlvbiBUaWxlKHtcbiAgYXBpLFxuICBsYWJlbCxcbiAgdmFsdWUsXG4gIGRlbHRhLFxuICB0b25lLFxuICBvdXRsaW5lLFxufToge1xuICBhcGk6IFBsdWdpbkFwaTtcbiAgbGFiZWw6IHN0cmluZztcbiAgdmFsdWU6IHN0cmluZztcbiAgZGVsdGE/OiBzdHJpbmdbXTtcbiAgdG9uZT86IFN0YXR1c0NvbG9yIHwgbnVsbDtcbiAgb3V0bGluZT86IFN0YXR1c0NvbG9yIHwgbnVsbDtcbn0pIHtcbiAgY29uc3QgYm9yZGVyID0gd29yc3RUb25lKFt0b25lLCBvdXRsaW5lXSk7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBtaW5XaWR0aDogMCxcbiAgICAgICAgYm94U2l6aW5nOiBcImJvcmRlci1ib3hcIixcbiAgICAgICAgYmFja2dyb3VuZDogcC5zdXJmYWNlLFxuICAgICAgICBib3JkZXI6IGAxcHggc29saWQgJHtib3JkZXIgPyBwLnN0YXR1c1tib3JkZXJdIDogcC5ib3JkZXJ9YCxcbiAgICAgICAgYm9yZGVyUmFkaXVzOiA2LFxuICAgICAgICBwYWRkaW5nOiBcIjEwcHggMTJweFwiLFxuICAgICAgICBkaXNwbGF5OiBcImZsZXhcIixcbiAgICAgICAgZmxleERpcmVjdGlvbjogXCJjb2x1bW5cIixcbiAgICAgICAgZ2FwOiAyLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT57bGFiZWx9PC9zcGFuPlxuICAgICAgPHNwYW4gc3R5bGU9e3sgZm9udFNpemU6IDIyLCBsaW5lSGVpZ2h0OiBcIjMwcHhcIiwgZm9udFdlaWdodDogNjAwLCBmb250VmFyaWFudE51bWVyaWM6IFwidGFidWxhci1udW1zXCIsIGNvbG9yOiB0b25lID8gcC5zdGF0dXNbdG9uZV0gOiB1bmRlZmluZWQgfX0+e3ZhbHVlfTwvc3Bhbj5cbiAgICAgIHtkZWx0YT8ubWFwKChkKSA9PiAoXG4gICAgICAgIDxzcGFuIGtleT17ZH0gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkLCBmb250U2l6ZTogMTIgfX0+XG4gICAgICAgICAge2R9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICkpfVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vKiogV3JhcHBpbmcgcm93IG9mIGNhcmRzOiBldmVyeSByb3cgaXMgZmlsbGVkIGVkZ2UgdG8gZWRnZSBhbmQgaXRzIGNhcmRzIHNoYXJlIG9uZSBoZWlnaHQuICovXG5jb25zdCBUSUxFX01JTiA9IDEzMDtcbmNvbnN0IEdBUCA9IDEyO1xuXG4vKiogU3RhdCB0aWxlcyBpbiBlcXVhbCBjb2x1bW5zOyB3aGVuIHRoZXkgZG9uJ3QgZml0IG9uIG9uZSByb3cgdGhleSBzcGxpdCBpbnRvIGJhbGFuY2VkIHJvd3MgKDYgLT4gMyszIC0+IDIrMisyKS4gKi9cbmZ1bmN0aW9uIFRpbGVSb3coeyBjaGlsZHJlbiB9OiB7IGNoaWxkcmVuOiBSZWFjdE5vZGVbXSB9KSB7XG4gIGNvbnN0IFtyZWYsIHdpZHRoXSA9IHVzZVdpZHRoKCk7XG4gIGNvbnN0IG4gPSBNYXRoLm1heCgxLCBjaGlsZHJlbi5sZW5ndGgpO1xuICBjb25zdCBmaXQgPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKCh3aWR0aCArIEdBUCkgLyAoVElMRV9NSU4gKyBHQVApKSk7XG4gIGNvbnN0IGNvbHMgPSB3aWR0aCA/IE1hdGguY2VpbChuIC8gTWF0aC5jZWlsKG4gLyBNYXRoLm1pbihmaXQsIG4pKSkgOiBuO1xuICByZXR1cm4gKFxuICAgIDxkaXYgcmVmPXtyZWZ9IHN0eWxlPXt7IGRpc3BsYXk6IFwiZ3JpZFwiLCBncmlkVGVtcGxhdGVDb2x1bW5zOiBgcmVwZWF0KCR7Y29sc30sIG1pbm1heCgwLCAxZnIpKWAsIGdhcDogR0FQIH19PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG5jb25zdCBGbG93ID0gKHsgY2hpbGRyZW4gfTogeyBjaGlsZHJlbjogUmVhY3ROb2RlIH0pID0+IDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJmbGV4XCIsIGZsZXhXcmFwOiBcIndyYXBcIiwgYWxpZ25JdGVtczogXCJzdHJldGNoXCIsIGdhcDogMTIgfX0+e2NoaWxkcmVufTwvZGl2PjtcblxuLyoqIE9ubHkgd2FybmluZy9lcnJvciB0b25lcyBvdXRsaW5lIGEgY2FyZDsgYW55dGhpbmcgZWxzZSBrZWVwcyB0aGUgbm9ybWFsIGJvcmRlci4gKi9cbmNvbnN0IGFsZXJ0VG9uZSA9IChzOiBTdGF0dXNDb2xvciB8IG51bGwgfCB1bmRlZmluZWQpOiBTdGF0dXNDb2xvciB8IG51bGwgPT4gKHMgPT09IFwid2FybmluZ1wiIHx8IHMgPT09IFwiZXJyb3JcIiA/IHMgOiBudWxsKTtcblxuZnVuY3Rpb24gU2VjdGlvbih7IGFwaSwgdGl0bGUsIGV4dHJhLCB0b25lLCBjaGlsZHJlbiB9OiB7IGFwaTogUGx1Z2luQXBpOyB0aXRsZTogc3RyaW5nOyBleHRyYT86IFJlYWN0Tm9kZTsgdG9uZT86IFN0YXR1c0NvbG9yIHwgbnVsbDsgY2hpbGRyZW46IFJlYWN0Tm9kZSB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgdCA9IGFsZXJ0VG9uZSh0b25lKTtcbiAgcmV0dXJuIChcbiAgICA8ZGl2XG4gICAgICBzdHlsZT17e1xuICAgICAgICBmbGV4OiBcIjEgMSAzMjBweFwiLFxuICAgICAgICBib3hTaXppbmc6IFwiYm9yZGVyLWJveFwiLFxuICAgICAgICBiYWNrZ3JvdW5kOiBwLnN1cmZhY2UsXG4gICAgICAgIGJvcmRlcjogYDFweCBzb2xpZCAke3QgPyBwLnN0YXR1c1t0XSA6IHAuYm9yZGVyfWAsXG4gICAgICAgIGJvcmRlclJhZGl1czogNixcbiAgICAgICAgcGFkZGluZzogMTIsXG4gICAgICAgIGRpc3BsYXk6IFwiZmxleFwiLFxuICAgICAgICBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLFxuICAgICAgICBnYXA6IDgsXG4gICAgICAgIG1pbldpZHRoOiAwLFxuICAgICAgfX1cbiAgICA+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBhbGlnbkl0ZW1zOiBcImNlbnRlclwiLCBnYXA6IDEyLCBmbGV4V3JhcDogXCJ3cmFwXCIgfX0+XG4gICAgICAgIDxzdHJvbmcgc3R5bGU9e3sgZmxleDogMSB9fT57dGl0bGV9PC9zdHJvbmc+XG4gICAgICAgIHtleHRyYX1cbiAgICAgIDwvZGl2PlxuICAgICAge2NoaWxkcmVufVxuICAgIDwvZGl2PlxuICApO1xufVxuXG4vLyAtLS0tLS0tLS0tIG1ldHJpYyB2aWV3cyAtLS0tLS0tLS0tXG5cbmludGVyZmFjZSBUcmVuZCB7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGtleTogc3RyaW5nO1xuICBnZXQ6IChkb2M6IEpzb24pID0+IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ7XG59XG5cbi8qKiBUaWxlIHZhbHVlIGZyb20gdGhlIGxhdGVzdCBkb2MsIGRlbHRhIGFnYWluc3QgdGhlIHByZXZpb3VzIGRheSBpbiBoaXN0b3J5LiAqL1xuZnVuY3Rpb24gdHJlbmRUaWxlKGFwaTogUGx1Z2luQXBpLCBkYXlzOiBEYXlbXSwgdDogVHJlbmQpIHtcbiAgY29uc3QgdmFscyA9IGRheXMubWFwKChkKSA9PiB0LmdldChkLmRvYykpO1xuICBjb25zdCBjdXIgPSB2YWxzW3ZhbHMubGVuZ3RoIC0gMV07XG4gIGNvbnN0IHByZXYgPSB2YWxzLmxlbmd0aCA+IDEgPyB2YWxzW3ZhbHMubGVuZ3RoIC0gMl0gOiB1bmRlZmluZWQ7XG4gIGxldCBkZWx0YTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIGlmICh0eXBlb2YgY3VyID09PSBcIm51bWJlclwiICYmIHR5cGVvZiBwcmV2ID09PSBcIm51bWJlclwiKSB7XG4gICAgY29uc3QgZCA9IGN1ciAtIHByZXY7XG4gICAgY29uc3QgYWJzID0gTU9ORVlfS0VZLnRlc3QodC5rZXkpID8gbW9uZXkuZm9ybWF0KE1hdGguYWJzKGQpKSA6IE1hdGguYWJzKGQpLnRvTG9jYWxlU3RyaW5nKCk7XG4gICAgZGVsdGEgPSBgJHtkID4gMCA/IFwiK1wiIDogZCA8IDAgPyBcIi1cIiA6IFwiXHUwMEIxXCJ9JHthYnN9IHZzICR7c2hvcnREYXRlKGRheXNbZGF5cy5sZW5ndGggLSAyXS5kYXRlKX1gO1xuICB9XG4gIGNvbnN0IGF2ZyA9IGF2ZXJhZ2VDaGVjayh2YWxzLCBFUlJPUl9LRVlTLmhhcyh0LmtleSkpO1xuICBjb25zdCBhdmdUZXh0ID0gYXZnID8gYCR7YXZnLmNoYW5nZSA+PSAwID8gXCIrXCIgOiBcIi1cIn0ke01hdGgucm91bmQoTWF0aC5hYnMoYXZnLmNoYW5nZSkgKiAxMDApfSUgdnMgJHtheGlzRm10KHQua2V5KShhdmcuYXZnKX0gYXZnYCA6IG51bGw7XG4gIHJldHVybiAoXG4gICAgPFRpbGVcbiAgICAgIGtleT17dC50aXRsZX1cbiAgICAgIGFwaT17YXBpfVxuICAgICAgbGFiZWw9e3QudGl0bGV9XG4gICAgICB2YWx1ZT17Zm10KGN1ciwgdC5rZXkpfVxuICAgICAgZGVsdGE9e1tkZWx0YSwgYXZnVGV4dF0uZmlsdGVyKChkKTogZCBpcyBzdHJpbmcgPT4gISFkKX1cbiAgICAgIHRvbmU9e3ZhbHVlVG9uZSh0LmtleSwgY3VyKX1cbiAgICAgIG91dGxpbmU9e2F2Zz8udG9uZX1cbiAgICAvPlxuICApO1xufVxuXG4vKiogTWV0cmljcyB3aGVyZSBoaWdoZXIgaXMgd29yc2U7IHZhbHVlVG9uZSBjb2xvcnMgYW55IG5vbi16ZXJvIHZhbHVlIG9mIHRoZXNlLiAqL1xuY29uc3QgRVJST1JfS0VZUyA9IG5ldyBTZXQoW1wiaW5BbGFybVwiLCBcImxhbWJkYUVycm9yc1wiLCBcImVycm9yczV4eFwiXSk7XG5cbmNvbnN0IEFWR19NSU5fREFZUyA9IDM7XG5jb25zdCBBVkdfV0FSTklORyA9IDE7IC8vIDEwMCUgYXdheSBmcm9tIHRoZSBhdmVyYWdlXG5jb25zdCBBVkdfRVJST1IgPSA1OyAvLyA1MDAlIGF3YXkgZnJvbSB0aGUgYXZlcmFnZVxuXG4vKipcbiAqIENvbXBhcmVzIHRoZSBsYXRlc3QgdmFsdWUgd2l0aCB0aGUgYXZlcmFnZSBvZiBldmVyeSBlYXJsaWVyIGRheSBpbiBoaXN0b3J5LlxuICogTnVsbCB1bnRpbCB0aGVyZSBhcmUgQVZHX01JTl9EQVlTIGVhcmxpZXIga25vd24gdmFsdWVzLCBvciB3aGVuIHRoZSBhdmVyYWdlIGlzIDAgKG5vIHBlcmNlbnRhZ2UgZXhpc3RzKS5cbiAqIGB1cE9ubHlgIChlcnJvci10eXBlIG1ldHJpY3MpOiBvbmx5IGEgcmlzZSBhYm92ZSB0aGUgYXZlcmFnZSBjb3VudHM7IGZhbGxpbmcgZXJyb3JzIGFyZSBnb29kIG5ld3MuXG4gKi9cbmZ1bmN0aW9uIGF2ZXJhZ2VDaGVjayh2YWxzOiAobnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZClbXSwgdXBPbmx5ID0gZmFsc2UpOiB7IGF2ZzogbnVtYmVyOyBjaGFuZ2U6IG51bWJlcjsgdG9uZTogU3RhdHVzQ29sb3IgfCBudWxsIH0gfCBudWxsIHtcbiAgY29uc3QgY3VyID0gdmFsc1t2YWxzLmxlbmd0aCAtIDFdO1xuICBjb25zdCBwcmV2ID0gdmFscy5zbGljZSgwLCAtMSkuZmlsdGVyKCh2KTogdiBpcyBudW1iZXIgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpO1xuICBpZiAodHlwZW9mIGN1ciAhPT0gXCJudW1iZXJcIiB8fCBwcmV2Lmxlbmd0aCA8IEFWR19NSU5fREFZUykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGF2ZyA9IHByZXYucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgLyBwcmV2Lmxlbmd0aDtcbiAgaWYgKGF2ZyA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGNoYW5nZSA9IChjdXIgLSBhdmcpIC8gTWF0aC5hYnMoYXZnKTtcbiAgY29uc3QgZGV2ID0gdXBPbmx5ID8gY2hhbmdlIDogTWF0aC5hYnMoY2hhbmdlKTtcbiAgcmV0dXJuIHsgYXZnLCBjaGFuZ2UsIHRvbmU6IGRldiA+PSBBVkdfRVJST1IgPyBcImVycm9yXCIgOiBkZXYgPj0gQVZHX1dBUk5JTkcgPyBcIndhcm5pbmdcIiA6IG51bGwgfTtcbn1cblxuLyoqIE9uZSBjYXJkIHBlciB0cmVuZCB0aGF0IGhhcyBkYXRhOyByZW5kZXJlZCBhcyBhIGZyYWdtZW50IHNvIHRoZSBjYXJkcyBqb2luIHRoZSBzdXJyb3VuZGluZyBGbG93LiAqL1xuZnVuY3Rpb24gVHJlbmRDaGFydHMoeyBhcGksIGRheXMsIHRyZW5kcyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXTsgdHJlbmRzOiBUcmVuZFtdIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8PlxuICAgICAge3RyZW5kc1xuICAgICAgICAubWFwKCh0KSA9PiAoeyB0LCBwb2ludHM6IGRheXMubWFwKChkKSA9PiAoeyBsYWJlbDogc2hvcnREYXRlKGQuZGF0ZSksIHJhdzogdC5nZXQoZC5kb2MpIH0pKSB9KSlcbiAgICAgICAgLmZpbHRlcigoeyBwb2ludHMgfSkgPT4gcG9pbnRzLnNvbWUoKHB0KSA9PiBwdC5yYXcgIT09IHVuZGVmaW5lZCkpXG4gICAgICAgIC5tYXAoKHsgdCwgcG9pbnRzIH0pID0+IChcbiAgICAgICAgICA8U2VjdGlvblxuICAgICAgICAgICAga2V5PXt0LnRpdGxlfVxuICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICB0aXRsZT17YCR7dC50aXRsZX0gVHJlbmRgfVxuICAgICAgICAgICAgdG9uZT17XG4gICAgICAgICAgICAgIGF2ZXJhZ2VDaGVjayhcbiAgICAgICAgICAgICAgICBwb2ludHMubWFwKChwdCkgPT4gcHQucmF3KSxcbiAgICAgICAgICAgICAgICBFUlJPUl9LRVlTLmhhcyh0LmtleSksXG4gICAgICAgICAgICAgICk/LnRvbmVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA+XG4gICAgICAgICAgICA8TGluZUNoYXJ0XG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICBsYWJlbHM9e3BvaW50cy5tYXAoKHB0KSA9PiBwdC5sYWJlbCl9XG4gICAgICAgICAgICAgIHNlcmllcz17W3sgbmFtZTogdC50aXRsZSwgY29sb3I6IGFwaS50aGVtZS5wYWxldHRlLmFjY2VudCwgdmFsdWVzOiBwb2ludHMubWFwKChwdCkgPT4gcHQucmF3ID8/IG51bGwpIH1dfVxuICAgICAgICAgICAgICBmb3JtYXQ9e2F4aXNGbXQodC5rZXkpfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgIDwvPlxuICApO1xufVxuXG5mdW5jdGlvbiBIaXN0b3J5SGludCh7IGFwaSwgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkYXlzOiBEYXlbXSB9KSB7XG4gIGlmIChkYXlzLmxlbmd0aCA+PSAyKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBhcGkudGhlbWUucGFsZXR0ZS50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5UcmVuZHMgZmlsbCBpbiBhcyBkYWlseSBoaXN0b3J5IGFjY3VtdWxhdGVzICh7ZGF5cy5sZW5ndGh9IGRheSBzbyBmYXIpLjwvc3Bhbj47XG59XG5cbmZ1bmN0aW9uIGNvc3RSb3dzKGFwaTogUGx1Z2luQXBpLCBjb3N0OiBKc29uKTogQmFyUm93W10ge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIHJldHVybiBPYmplY3QuZW50cmllcyhjb3N0Py5ieVRhZyA/PyB7fSlcbiAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpXG4gICAgLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gKGIgYXMgbnVtYmVyKSAtIChhIGFzIG51bWJlcikpXG4gICAgLm1hcCgoW2ssIHZdKSA9PiAoe1xuICAgICAgbGFiZWw6IGssXG4gICAgICBzZWdtZW50czogW3sgbmFtZTogXCJDb3N0XCIsIHZhbHVlOiB2IGFzIG51bWJlciwgY29sb3I6IHAuYWNjZW50IH1dLFxuICAgICAgdmFsdWVUZXh0OiBtb25leS5mb3JtYXQodiBhcyBudW1iZXIpLFxuICAgICAgdGlwOiBbYCR7bW9uZXkuZm9ybWF0KHYgYXMgbnVtYmVyKX0gKCR7Y29zdC50b3RhbCA/ICgoKHYgYXMgbnVtYmVyKSAvIGNvc3QudG90YWwpICogMTAwKS50b0ZpeGVkKDEpIDogXCIwXCJ9JSBvZiB0b3RhbClgXSxcbiAgICB9KSk7XG59XG5cbi8qKiBBcHBzIHRvbyBzbWFsbCBmb3IgdGhlaXIgb3duIHRhYjsgdGhleSBnZXQgb25lIGludm9jYXRpb25zLXZzLWVycm9ycyBjYXJkIG9uIHRoZSBPdmVydmlldyBpbnN0ZWFkLiAqL1xuY29uc3QgT1ZFUlZJRVdfT05MWV9BUFBTOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBTZWNyZXRzTWFuYWdlcjogXCJHbG9iYWwgU2VjcmV0cyBUcmVuZFwiIH07XG5cbi8qKiBTdW0gb2YgYSBMYW1iZGEgbWV0cmljIGFjcm9zcyBhbiBhcHAncyBmdW5jdGlvbnM7IHVua25vd24gaWYgYW55IGZ1bmN0aW9uJ3MgdmFsdWUgaXMgdW5rbm93bi4gKi9cbmZ1bmN0aW9uIGxhbWJkYVN1bShhcHA6IEpzb24sIGZpZWxkOiBcImludm9jYXRpb25zXCIgfCBcImVycm9yc1wiKTogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IGxhbWJkYXMgPSBhcHA/Lm1vbml0b3Jpbmc/LmxhbWJkYXM7XG4gIGlmIChsYW1iZGFzID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChsYW1iZGFzID09PSBudWxsIHx8IGlzRXJyb3JOb2RlKGxhbWJkYXMpIHx8IGlzRXJyb3JOb2RlKGFwcC5tb25pdG9yaW5nKSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHZhbHMgPSBPYmplY3QudmFsdWVzKGxhbWJkYXMpLm1hcCgodikgPT4gbWV0cmljKHYsIGZpZWxkKSk7XG4gIHJldHVybiB2YWxzLnNvbWUoKHYpID0+IHR5cGVvZiB2ICE9PSBcIm51bWJlclwiKSA/IG51bGwgOiAodmFscyBhcyBudW1iZXJbXSkucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCk7XG59XG5cbmZ1bmN0aW9uIEludm9jYXRpb25zVHJlbmQoeyBhcGksIGRheXMsIGFwcE5hbWUsIHRpdGxlIH06IHsgYXBpOiBQbHVnaW5BcGk7IGRheXM6IERheVtdOyBhcHBOYW1lOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmcgfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBhcHA6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHBOYW1lKSB9KSkuZmlsdGVyKChkKSA9PiBkLmFwcCk7XG4gIGlmIChhcHBEYXlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNlcmllczogU2VyaWVzW10gPSBbXG4gICAgeyBuYW1lOiBcIkludm9jYXRpb25zXCIsIGNvbG9yOiBwLmFjY2VudCwgdmFsdWVzOiBhcHBEYXlzLm1hcCgoZCkgPT4gbGFtYmRhU3VtKGQuYXBwLCBcImludm9jYXRpb25zXCIpID8/IG51bGwpIH0sXG4gICAgeyBuYW1lOiBcIkVycm9yc1wiLCBjb2xvcjogcC5zdGF0dXMuZXJyb3IsIHZhbHVlczogYXBwRGF5cy5tYXAoKGQpID0+IGxhbWJkYVN1bShkLmFwcCwgXCJlcnJvcnNcIikgPz8gbnVsbCkgfSxcbiAgXTtcbiAgcmV0dXJuIChcbiAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9e3RpdGxlfSB0b25lPXthdmVyYWdlQ2hlY2soc2VyaWVzWzFdLnZhbHVlcywgdHJ1ZSk/LnRvbmV9IGV4dHJhPXs8TGVnZW5kIGFwaT17YXBpfSBpdGVtcz17c2VyaWVzfSAvPn0+XG4gICAgICA8TGluZUNoYXJ0IGFwaT17YXBpfSBsYWJlbHM9e2FwcERheXMubWFwKChkKSA9PiBzaG9ydERhdGUoZC5kYXRlKSl9IHNlcmllcz17c2VyaWVzfSBmb3JtYXQ9e2F4aXNGbXQoXCJcIil9IC8+XG4gICAgPC9TZWN0aW9uPlxuICApO1xufVxuXG5jb25zdCBPVkVSVklFV19UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiQVdTIENvc3QgKDMwZClcIiwga2V5OiBcImNvc3RcIiwgZ2V0OiAoZCkgPT4gbWV0cmljKGQsIFwiYXdzQ29zdC50b3RhbFwiKSB9LFxuICB7IHRpdGxlOiBcIlJlcXVlc3RzICgyNGgpXCIsIGtleTogXCJcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpIH0sXG4gIHsgdGl0bGU6IFwiTGFtYmRhIEVycm9ycyAoMjRoKVwiLCBrZXk6IFwibGFtYmRhRXJyb3JzXCIsIGdldDogKGQpID0+IHN1bUFwcHMoZCwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCI1eHggRXJyb3JzICgyNGgpXCIsIGtleTogXCJlcnJvcnM1eHhcIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcIm1vbml0b3JpbmcudG90YWxzLmVycm9yczV4eFwiKSB9LFxuICB7IHRpdGxlOiBcIkFsYXJtcyBGaXJpbmdcIiwga2V5OiBcImluQWxhcm1cIiwgZ2V0OiAoZCkgPT4gc3VtQXBwcyhkLCBcImhlYWx0aC5hbGFybXMuaW5BbGFybVwiKSB9LFxuICB7IHRpdGxlOiBcIlBheWluZyBDdXN0b21lcnNcIiwga2V5OiBcIlwiLCBnZXQ6IChkKSA9PiBzdW1BcHBzKGQsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuXTtcblxuZnVuY3Rpb24gT3ZlcnZpZXcoeyBhcGksIGRvYywgZGF5cyB9OiB7IGFwaTogUGx1Z2luQXBpOyBkb2M6IEpzb247IGRheXM6IERheVtdIH0pIHtcbiAgY29uc3QgeyBTdGF0dXNEb3QgfSA9IGFwaS51aTtcbiAgY29uc3QgcCA9IGFwaS50aGVtZS5wYWxldHRlO1xuICBjb25zdCBhcHBzID0gYXBwc09mKGRvYyk7XG4gIGNvbnN0IGNvc3QgPSBkb2MuYXdzQ29zdDtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVSb3c+e09WRVJWSUVXX1RSRU5EUy5maWx0ZXIoKHQpID0+IHQuZ2V0KGRvYykgIT09IHVuZGVmaW5lZCkubWFwKCh0KSA9PiB0cmVuZFRpbGUoYXBpLCBkYXlzLCB0KSl9PC9UaWxlUm93PlxuICAgICAgPEhpc3RvcnlIaW50IGFwaT17YXBpfSBkYXlzPXtkYXlzfSAvPlxuICAgICAgPEZsb3c+XG4gICAgICAgIDxUcmVuZENoYXJ0cyBhcGk9e2FwaX0gZGF5cz17ZGF5c30gdHJlbmRzPXtPVkVSVklFV19UUkVORFMuc2xpY2UoMCwgMyl9IC8+XG4gICAgICAgIHtPYmplY3QuZW50cmllcyhPVkVSVklFV19PTkxZX0FQUFMpLm1hcCgoW25hbWUsIHRpdGxlXSkgPT4gKFxuICAgICAgICAgIDxJbnZvY2F0aW9uc1RyZW5kIGtleT17bmFtZX0gYXBpPXthcGl9IGRheXM9e2RheXN9IGFwcE5hbWU9e25hbWV9IHRpdGxlPXt0aXRsZX0gLz5cbiAgICAgICAgKSl9XG4gICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT1cIkFwcHNcIiB0b25lPXt3b3JzdChhcHBzLm1hcChhcHBTdGF0dXMpKX0+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImdyaWRcIiwgZ3JpZFRlbXBsYXRlQ29sdW1uczogXCJhdXRvIDFmciBtYXgtY29udGVudCBtYXgtY29udGVudCBtYXgtY29udGVudFwiLCBnYXA6IFwiNHB4IDEycHhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiB9fT5cbiAgICAgICAgICAgIHtbXCJcIiwgXCJBcHBcIiwgXCJSZXF1ZXN0c1wiLCBcIkVycm9yc1wiLCBcIlByb2ZpdCAoMzBkKVwiXS5tYXAoKGgpID0+IChcbiAgICAgICAgICAgICAgPHNwYW4ga2V5PXtoIHx8IFwiZG90XCJ9IHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCwgZm9udFNpemU6IDEyIH19PlxuICAgICAgICAgICAgICAgIHtofVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICApKX1cbiAgICAgICAgICAgIHthcHBzLm1hcCgoYSkgPT4gKFxuICAgICAgICAgICAgICA8ZGl2IGtleT17YS5uYW1lfSBzdHlsZT17eyBkaXNwbGF5OiBcImNvbnRlbnRzXCIgfX0+XG4gICAgICAgICAgICAgICAgPFN0YXR1c0RvdCBjb2xvcj17YXBwU3RhdHVzKGEpfSAvPlxuICAgICAgICAgICAgICAgIDxzcGFuPnthLm5hbWV9PC9zcGFuPlxuICAgICAgICAgICAgICAgIDxzcGFuPntjZWxsKG1ldHJpYyhhLCBcIm1vbml0b3JpbmcudG90YWxzLnJlcXVlc3RzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uaXRvcmluZy50b3RhbHMubGFtYmRhRXJyb3JzXCIpKX08L3NwYW4+XG4gICAgICAgICAgICAgICAgPHNwYW4+e2NlbGwobWV0cmljKGEsIFwibW9uZXkucHJvZml0MzBkXCIpLCBcInByb2ZpdFwiKX08L3NwYW4+XG4gICAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgKSl9XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgPFNlY3Rpb24gYXBpPXthcGl9IHRpdGxlPXtgQVdTIENvc3QgQnkgUHJvamVjdCR7Y29zdCAmJiAhaXNFcnJvck5vZGUoY29zdCkgPyBgICgke3Nob3J0RGF0ZShjb3N0LndpbmRvd1N0YXJ0KX0gVG8gJHtzaG9ydERhdGUoY29zdC53aW5kb3dFbmQpfSlgIDogXCJcIn1gfT5cbiAgICAgICAgICB7IWNvc3QgfHwgaXNFcnJvck5vZGUoY29zdCkgPyA8c3Bhbj57Zm10KGNvc3QpfTwvc3Bhbj4gOiA8QmFyTGlzdCBhcGk9e2FwaX0gcm93cz17Y29zdFJvd3MoYXBpLCBjb3N0KX0gLz59XG4gICAgICAgIDwvU2VjdGlvbj5cbiAgICAgIDwvRmxvdz5cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuZnVuY3Rpb24gbGFtYmRhUm93cyhhcGk6IFBsdWdpbkFwaSwgbGFtYmRhczogSnNvbik6IHsgcm93czogQmFyUm93W107IGlkbGU6IG51bWJlcjsgdW5rbm93bjogc3RyaW5nW10gfSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3Qgcm93czogQmFyUm93W10gPSBbXTtcbiAgY29uc3QgdW5rbm93bjogc3RyaW5nW10gPSBbXTtcbiAgbGV0IGlkbGUgPSAwO1xuICBmb3IgKGNvbnN0IFtmbiwgdl0gb2YgT2JqZWN0LmVudHJpZXMobGFtYmRhcyA/PyB7fSkgYXMgW3N0cmluZywgSnNvbl1bXSkge1xuICAgIGNvbnN0IGludiA9IG1ldHJpYyh2LCBcImludm9jYXRpb25zXCIpO1xuICAgIGlmICh0eXBlb2YgaW52ICE9PSBcIm51bWJlclwiKSB7XG4gICAgICB1bmtub3duLnB1c2goZm4pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpbnYgPT09IDApIHtcbiAgICAgIGlkbGUrKztcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBlcnIgPSBtZXRyaWModiwgXCJlcnJvcnNcIikgPz8gMDtcbiAgICBjb25zdCB0aHIgPSBtZXRyaWModiwgXCJ0aHJvdHRsZXNcIikgPz8gMDtcbiAgICByb3dzLnB1c2goe1xuICAgICAgbGFiZWw6IGZuLFxuICAgICAgc2VnbWVudHM6IFtcbiAgICAgICAgeyBuYW1lOiBcIlN1Y2NlZWRlZFwiLCB2YWx1ZTogTWF0aC5tYXgoMCwgaW52IC0gZXJyKSwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgIHsgbmFtZTogXCJFcnJvcnNcIiwgdmFsdWU6IGVyciwgY29sb3I6IHAuc3RhdHVzLmVycm9yIH0sXG4gICAgICBdLFxuICAgICAgdmFsdWVUZXh0OiBlcnIgPyBgJHtpbnYudG9Mb2NhbGVTdHJpbmcoKX0gKCR7KChlcnIgLyBpbnYpICogMTAwKS50b0ZpeGVkKDApfSUgRXJyKWAgOiBpbnYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgIHRpcDogW2Ake2ludi50b0xvY2FsZVN0cmluZygpfSBpbnZvY2F0aW9uc2AsIGAke2Vyci50b0xvY2FsZVN0cmluZygpfSBlcnJvcnNgLCBgJHt0aHIudG9Mb2NhbGVTdHJpbmcoKX0gdGhyb3R0bGVzYF0sXG4gICAgfSk7XG4gIH1cbiAgcm93cy5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzWzBdLnZhbHVlICsgYi5zZWdtZW50c1sxXS52YWx1ZSAtIChhLnNlZ21lbnRzWzBdLnZhbHVlICsgYS5zZWdtZW50c1sxXS52YWx1ZSkpO1xuICByZXR1cm4geyByb3dzLCBpZGxlLCB1bmtub3duIH07XG59XG5cbmZ1bmN0aW9uIGFwaVJvd3MoYXBpOiBQbHVnaW5BcGksIGFwaXM6IEpzb24pOiBCYXJSb3dbXSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgcmV0dXJuIChPYmplY3QuZW50cmllcyhhcGlzID8/IHt9KSBhcyBbc3RyaW5nLCBKc29uXVtdKVxuICAgIC5maWx0ZXIoKFssIHZdKSA9PiB0eXBlb2YgbWV0cmljKHYsIFwicmVxdWVzdHNcIikgPT09IFwibnVtYmVyXCIpXG4gICAgLm1hcCgoW25hbWUsIHZdKSA9PiB7XG4gICAgICBjb25zdCByZXEgPSBtZXRyaWModiwgXCJyZXF1ZXN0c1wiKSBhcyBudW1iZXI7XG4gICAgICBjb25zdCBlNCA9IG1ldHJpYyh2LCBcImVycm9yczR4eFwiKSA/PyAwO1xuICAgICAgY29uc3QgZTUgPSBtZXRyaWModiwgXCJlcnJvcnM1eHhcIikgPz8gMDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGxhYmVsOiBuYW1lLFxuICAgICAgICBzZWdtZW50czogW1xuICAgICAgICAgIHsgbmFtZTogXCJPS1wiLCB2YWx1ZTogTWF0aC5tYXgoMCwgcmVxIC0gZTQgLSBlNSksIGNvbG9yOiBwLmFjY2VudCB9LFxuICAgICAgICAgIHsgbmFtZTogXCI0eHhcIiwgdmFsdWU6IGU0LCBjb2xvcjogcC5zdGF0dXMud2FybmluZyB9LFxuICAgICAgICAgIHsgbmFtZTogXCI1eHhcIiwgdmFsdWU6IGU1LCBjb2xvcjogcC5zdGF0dXMuZXJyb3IgfSxcbiAgICAgICAgXSxcbiAgICAgICAgdmFsdWVUZXh0OiByZXEudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgdGlwOiBbYCR7cmVxLnRvTG9jYWxlU3RyaW5nKCl9IHJlcXVlc3RzYCwgYCR7ZTQudG9Mb2NhbGVTdHJpbmcoKX0gNHh4LCAke2U1LnRvTG9jYWxlU3RyaW5nKCl9IDV4eGAsIGBwOTUgbGF0ZW5jeTogJHtmbXQodi5wOTVMYXRlbmN5TXMsIFwibGF0ZW5jeW1zXCIpfWBdLFxuICAgICAgfTtcbiAgICB9KVxuICAgIC5zb3J0KChhLCBiKSA9PiBiLnNlZ21lbnRzLnJlZHVjZSgocywgeCkgPT4gcyArIHgudmFsdWUsIDApIC0gYS5zZWdtZW50cy5yZWR1Y2UoKHMsIHgpID0+IHMgKyB4LnZhbHVlLCAwKSk7XG59XG5cbmZ1bmN0aW9uIFJvd3MoeyBhcGksIHZhbHVlLCBwYXRoID0gXCJcIiB9OiB7IGFwaTogUGx1Z2luQXBpOyB2YWx1ZTogSnNvbjsgcGF0aD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHAgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIiB8fCBpc0Vycm9yTm9kZSh2YWx1ZSkpIHtcbiAgICByZXR1cm4gPHNwYW4+e2ZtdCh2YWx1ZSwgcGF0aCl9PC9zcGFuPjtcbiAgfVxuICBjb25zdCBlbnRyaWVzID0gT2JqZWN0LmVudHJpZXModmFsdWUpLmZpbHRlcigoWywgdl0pID0+ICEodHlwZW9mIHYgPT09IFwic3RyaW5nXCIgJiYgKHYubGVuZ3RoID4gODAgfHwgdi5pbmNsdWRlcyhcIlxcblwiKSkpKTtcbiAgaWYgKGVudHJpZXMubGVuZ3RoID09PSAwKSByZXR1cm4gPHNwYW4gc3R5bGU9e3sgY29sb3I6IHAudGV4dE11dGVkIH19Pk5vbmU8L3NwYW4+O1xuICByZXR1cm4gKFxuICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogXCJncmlkXCIsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6IFwibWF4LWNvbnRlbnQgMWZyXCIsIGdhcDogXCIycHggMTZweFwiIH19PlxuICAgICAge2VudHJpZXMubWFwKChbaywgdl0pID0+IHtcbiAgICAgICAgY29uc3QgbmVzdGVkID0gdiAhPT0gbnVsbCAmJiB0eXBlb2YgdiA9PT0gXCJvYmplY3RcIiAmJiAhaXNFcnJvck5vZGUodik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgPGRpdiBrZXk9e2t9IHN0eWxlPXt7IGRpc3BsYXk6IFwiY29udGVudHNcIiB9fT5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBwLnRleHRNdXRlZCB9fT57dGl0bGVDYXNlKGspfTwvc3Bhbj5cbiAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiB2YWx1ZVRvbmUoaywgdikgPyBwLnN0YXR1c1t2YWx1ZVRvbmUoaywgdikgYXMgU3RhdHVzQ29sb3JdIDogdW5kZWZpbmVkIH19PlxuICAgICAgICAgICAgICB7bmVzdGVkID8gQXJyYXkuaXNBcnJheSh2KSA/IDxzcGFuPnt2Lmxlbmd0aCA/IHYuam9pbihcIiwgXCIpIDogXCJOb25lXCJ9PC9zcGFuPiA6IDxSb3dzIGFwaT17YXBpfSB2YWx1ZT17dn0gcGF0aD17a30gLz4gOiBmbXQodiwgayl9XG4gICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICk7XG4gICAgICB9KX1cbiAgICA8L2Rpdj5cbiAgKTtcbn1cblxuY29uc3QgdGl0bGVDYXNlID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC8oW0EtWl0pL2csIFwiICQxXCIpLnJlcGxhY2UoL14uLywgKGMpID0+IGMudG9VcHBlckNhc2UoKSk7XG5cbmNvbnN0IEFQUF9UUkVORFM6IFRyZW5kW10gPSBbXG4gIHsgdGl0bGU6IFwiUmVxdWVzdHMgKDI0aClcIiwga2V5OiBcIlwiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5yZXF1ZXN0c1wiKSB9LFxuICB7IHRpdGxlOiBcIkxhbWJkYSBFcnJvcnMgKDI0aClcIiwga2V5OiBcImxhbWJkYUVycm9yc1wiLCBnZXQ6IChhKSA9PiBtZXRyaWMoYSwgXCJtb25pdG9yaW5nLnRvdGFscy5sYW1iZGFFcnJvcnNcIikgfSxcbiAgeyB0aXRsZTogXCJQYXlpbmcgQ3VzdG9tZXJzXCIsIGtleTogXCJcIiwgZ2V0OiAoYSkgPT4gbWV0cmljKGEsIFwiY3VzdG9tZXJzLnBheWluZ1wiKSB9LFxuICB7IHRpdGxlOiBcIk1SUlwiLCBrZXk6IFwibXJyXCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5Lm1yclwiKSB9LFxuICB7IHRpdGxlOiBcIlByb2ZpdCAoMzBkKVwiLCBrZXk6IFwicHJvZml0XCIsIGdldDogKGEpID0+IG1ldHJpYyhhLCBcIm1vbmV5LnByb2ZpdDMwZFwiKSB9LFxuXTtcblxuZnVuY3Rpb24gQXBwVmlldyh7IGFwaSwgYXBwLCBkYXlzIH06IHsgYXBpOiBQbHVnaW5BcGk7IGFwcDogSnNvbjsgZGF5czogRGF5W10gfSkge1xuICBjb25zdCBwID0gYXBpLnRoZW1lLnBhbGV0dGU7XG4gIGNvbnN0IGFwcERheXMgPSBkYXlzLm1hcCgoZCkgPT4gKHsgZGF0ZTogZC5kYXRlLCBkb2M6IGFwcHNPZihkLmRvYykuZmluZCgoYSkgPT4gYS5uYW1lID09PSBhcHAubmFtZSkgfSkpLmZpbHRlcigoZCkgPT4gZC5kb2MpO1xuICBjb25zdCBtb24gPSBhcHAubW9uaXRvcmluZztcbiAgY29uc3QgYXVkID0gYXBwLmF1ZGllbmNlO1xuICBjb25zdCBhdWREYXlzOiBKc29uW10gPSBhdWQgJiYgQXJyYXkuaXNBcnJheShhdWQuZGF5cykgPyBhdWQuZGF5cyA6IFtdO1xuICBjb25zdCBhdWRLZXlzID0gYXVkRGF5cy5sZW5ndGggPyBPYmplY3Qua2V5cyhhdWREYXlzWzBdKS5maWx0ZXIoKGspID0+IGsgIT09IFwiZGF0ZVwiICYmIHR5cGVvZiBhdWREYXlzWzBdW2tdID09PSBcIm51bWJlclwiKSA6IFtdO1xuICBjb25zdCBsYW1iZGFzID0gbW9uICYmICFpc0Vycm9yTm9kZShtb24pICYmICFpc0Vycm9yTm9kZShtb24ubGFtYmRhcykgPyBsYW1iZGFSb3dzKGFwaSwgbW9uLmxhbWJkYXMpIDogbnVsbDtcbiAgY29uc3QgYXBpcyA9IG1vbiAmJiAhaXNFcnJvck5vZGUobW9uKSAmJiAhaXNFcnJvck5vZGUobW9uLmFwaXMpID8gYXBpUm93cyhhcGksIG1vbi5hcGlzKSA6IG51bGw7XG4gIGNvbnN0IGRldGFpbHMgPSBPYmplY3QuZW50cmllcyhhcHApLmZpbHRlcigoW2tdKSA9PiBrICE9PSBcIm5hbWVcIiAmJiBrICE9PSBcIm1vbml0b3JpbmdcIik7XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyIH19PlxuICAgICAgPFRpbGVSb3c+e0FQUF9UUkVORFMuZmlsdGVyKCh0KSA9PiB0LmdldChhcHApICE9PSB1bmRlZmluZWQpLm1hcCgodCkgPT4gdHJlbmRUaWxlKGFwaSwgYXBwRGF5cywgdCkpfTwvVGlsZVJvdz5cbiAgICAgIDxIaXN0b3J5SGludCBhcGk9e2FwaX0gZGF5cz17YXBwRGF5c30gLz5cbiAgICAgIDxGbG93PlxuICAgICAgICA8VHJlbmRDaGFydHMgYXBpPXthcGl9IGRheXM9e2FwcERheXN9IHRyZW5kcz17QVBQX1RSRU5EU30gLz5cbiAgICAgICAge21vbiAmJiBpc0Vycm9yTm9kZShtb24pICYmIChcbiAgICAgICAgICA8U2VjdGlvbiBhcGk9e2FwaX0gdGl0bGU9XCJNb25pdG9yaW5nICgyNGgpXCIgdG9uZT1cIndhcm5pbmdcIj5cbiAgICAgICAgICAgIDxzcGFuPntmbXQobW9uKX08L3NwYW4+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7YXBpcyAmJiBhcGlzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uXG4gICAgICAgICAgICBhcGk9e2FwaX1cbiAgICAgICAgICAgIHRpdGxlPVwiQVBJIFJlcXVlc3RzICgyNGgpXCJcbiAgICAgICAgICAgIHRvbmU9e2FwaXMuc29tZSgocikgPT4gci5zZWdtZW50cy5zb21lKChzKSA9PiBzLm5hbWUgPT09IFwiNXh4XCIgJiYgcy52YWx1ZSA+IDApKSA/IFwid2FybmluZ1wiIDogbnVsbH1cbiAgICAgICAgICAgIGV4dHJhPXtcbiAgICAgICAgICAgICAgPExlZ2VuZFxuICAgICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICAgIGl0ZW1zPXtbXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiT0tcIiwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiNHh4XCIsIGNvbG9yOiBwLnN0YXR1cy53YXJuaW5nIH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiNXh4XCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgICAgICAgICAgIF19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICB9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2FwaXN9IC8+XG4gICAgICAgICAgPC9TZWN0aW9uPlxuICAgICAgICApfVxuICAgICAgICB7bGFtYmRhcyAmJiBsYW1iZGFzLnJvd3MubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgPFNlY3Rpb25cbiAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgdGl0bGU9XCJMYW1iZGEgSW52b2NhdGlvbnMgKDI0aClcIlxuICAgICAgICAgICAgdG9uZT17bGFtYmRhcy5yb3dzLnNvbWUoKHIpID0+IHIuc2VnbWVudHMuc29tZSgocykgPT4gcy5uYW1lID09PSBcIkVycm9yc1wiICYmIHMudmFsdWUgPiAwKSkgPyBcImVycm9yXCIgOiBudWxsfVxuICAgICAgICAgICAgZXh0cmE9e1xuICAgICAgICAgICAgICA8TGVnZW5kXG4gICAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgICAgaXRlbXM9e1tcbiAgICAgICAgICAgICAgICAgIHsgbmFtZTogXCJTdWNjZWVkZWRcIiwgY29sb3I6IHAuYWNjZW50IH0sXG4gICAgICAgICAgICAgICAgICB7IG5hbWU6IFwiRXJyb3JzXCIsIGNvbG9yOiBwLnN0YXR1cy5lcnJvciB9LFxuICAgICAgICAgICAgICAgIF19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICB9XG4gICAgICAgICAgPlxuICAgICAgICAgICAgPEJhckxpc3QgYXBpPXthcGl9IHJvd3M9e2xhbWJkYXMucm93c30gLz5cbiAgICAgICAgICAgIHsobGFtYmRhcy5pZGxlID4gMCB8fCBsYW1iZGFzLnVua25vd24ubGVuZ3RoID4gMCkgJiYgKFxuICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcC50ZXh0TXV0ZWQsIGZvbnRTaXplOiAxMiB9fT5cbiAgICAgICAgICAgICAgICB7W2xhbWJkYXMuaWRsZSA/IGAke2xhbWJkYXMuaWRsZX0gaWRsZSBmdW5jdGlvbiR7bGFtYmRhcy5pZGxlID4gMSA/IFwic1wiIDogXCJcIn0gaGlkZGVuYCA6IFwiXCIsIGxhbWJkYXMudW5rbm93bi5sZW5ndGggPyBgVW5rbm93bjogJHtsYW1iZGFzLnVua25vd24uam9pbihcIiwgXCIpfWAgOiBcIlwiXVxuICAgICAgICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgICAgICAgICAgICAgLmpvaW4oXCIuIFwiKX1cbiAgICAgICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICl9XG4gICAgICAgIHthdWRLZXlzLm1hcCgoaykgPT4gKFxuICAgICAgICAgIDxTZWN0aW9uIGtleT17a30gYXBpPXthcGl9IHRpdGxlPXtgRGFpbHkgJHt0aXRsZUNhc2Uoayl9YH0+XG4gICAgICAgICAgICA8TGluZUNoYXJ0XG4gICAgICAgICAgICAgIGFwaT17YXBpfVxuICAgICAgICAgICAgICBsYWJlbHM9e2F1ZERheXMubWFwKChkKSA9PiBzaG9ydERhdGUoU3RyaW5nKGQuZGF0ZSkpKX1cbiAgICAgICAgICAgICAgc2VyaWVzPXtbeyBuYW1lOiB0aXRsZUNhc2UoayksIGNvbG9yOiBwLmFjY2VudCwgdmFsdWVzOiBhdWREYXlzLm1hcCgoZCkgPT4gKHR5cGVvZiBkW2tdID09PSBcIm51bWJlclwiID8gZFtrXSA6IG51bGwpKSB9XX1cbiAgICAgICAgICAgICAgZm9ybWF0PXtheGlzRm10KGspfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgICB7YXVkPy5zb3VyY2VzMzBkICYmICFpc0Vycm9yTm9kZShhdWQuc291cmNlczMwZCkgJiYgKFxuICAgICAgICAgIDxTZWN0aW9uIGFwaT17YXBpfSB0aXRsZT1cIlRyYWZmaWMgU291cmNlcyAoMzBkKVwiPlxuICAgICAgICAgICAgPEJhckxpc3RcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHJvd3M9eyhPYmplY3QuZW50cmllcyhhdWQuc291cmNlczMwZCkgYXMgW3N0cmluZywgSnNvbl1bXSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChbLCB2XSkgPT4gdHlwZW9mIHYgPT09IFwibnVtYmVyXCIpXG4gICAgICAgICAgICAgICAgLnNvcnQoKFssIGFdLCBbLCBiXSkgPT4gYiAtIGEpXG4gICAgICAgICAgICAgICAgLm1hcCgoW2ssIHZdKSA9PiAoe1xuICAgICAgICAgICAgICAgICAgbGFiZWw6IHRpdGxlQ2FzZShrKSxcbiAgICAgICAgICAgICAgICAgIHNlZ21lbnRzOiBbeyBuYW1lOiBcIlZpZXdzXCIsIHZhbHVlOiB2LCBjb2xvcjogcC5hY2NlbnQgfV0sXG4gICAgICAgICAgICAgICAgICB2YWx1ZVRleHQ6IHYudG9Mb2NhbGVTdHJpbmcoKSxcbiAgICAgICAgICAgICAgICAgIHRpcDogW2Ake3YudG9Mb2NhbGVTdHJpbmcoKX0gdmlld3NgXSxcbiAgICAgICAgICAgICAgICB9KSl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvU2VjdGlvbj5cbiAgICAgICAgKX1cbiAgICAgICAge2RldGFpbHMubWFwKChbaywgdl0pID0+IChcbiAgICAgICAgICA8U2VjdGlvbiBrZXk9e2t9IGFwaT17YXBpfSB0aXRsZT17dGl0bGVDYXNlKGspfSB0b25lPXtncm91cFRvbmUodil9PlxuICAgICAgICAgICAgPFJvd3NcbiAgICAgICAgICAgICAgYXBpPXthcGl9XG4gICAgICAgICAgICAgIHZhbHVlPXtrID09PSBcImF1ZGllbmNlXCIgJiYgdiAmJiAhaXNFcnJvck5vZGUodikgPyBPYmplY3QuZnJvbUVudHJpZXMoT2JqZWN0LmVudHJpZXModikuZmlsdGVyKChba2tdKSA9PiBrayAhPT0gXCJkYXlzXCIgJiYga2sgIT09IFwic291cmNlczMwZFwiKSkgOiB2fVxuICAgICAgICAgICAgICBwYXRoPXtrfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L1NlY3Rpb24+XG4gICAgICAgICkpfVxuICAgICAgPC9GbG93PlxuICAgIDwvZGl2PlxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gQ29tcG9uZW50KHsgYXBpIH06IHsgYXBpOiBQbHVnaW5BcGk7IHBhbmVJZD86IHN0cmluZyB9KSB7XG4gIGNvbnN0IHsgSWNvbkJ1dHRvbiwgU3Bpbm5lciwgVGFicywgQmFubmVyIH0gPSBhcGkudWk7XG4gIGNvbnN0IHBhbGV0dGUgPSBhcGkudGhlbWUucGFsZXR0ZTtcbiAgY29uc3QgWywgZm9yY2VdID0gdXNlU3RhdGUoMCk7XG4gIGNvbnN0IFt0YWIsIHNldFRhYl0gPSB1c2VTdGF0ZShcIm92ZXJ2aWV3XCIpO1xuICBjb25zdCBbLCBzZXRUaGVtZV0gPSB1c2VTdGF0ZSgwKTtcblxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGNvbnN0IGwgPSAoKSA9PiBmb3JjZSgobikgPT4gbiArIDEpO1xuICAgIGxpc3RlbmVycy5hZGQobCk7XG4gICAgY29uc3QgdW5zdWIgPSBhcGkudGhlbWUuc3Vic2NyaWJlKCgpID0+IHNldFRoZW1lKChuKSA9PiBuICsgMSkpO1xuICAgIGlmICghc3RhdGUuZGF0YSkge1xuICAgICAgdm9pZCBhcGkuc3RvcmFnZS5nZXQ8SnNvbj4oQ0FDSEVfS0VZKS50aGVuKChjYWNoZWQpID0+IHtcbiAgICAgICAgaWYgKGNhY2hlZCAmJiAhc3RhdGUuZGF0YSkgc2V0U3RhdGUoeyBkYXRhOiBjYWNoZWQgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuICgpID0+IHtcbiAgICAgIGxpc3RlbmVycy5kZWxldGUobCk7XG4gICAgICB1bnN1YigpO1xuICAgIH07XG4gIH0sIFthcGldKTtcblxuICBjb25zdCB7IGRhdGEsIGVycm9yLCBzcGlubmluZyB9ID0gc3RhdGU7XG4gIGNvbnN0IGFwcHMgPSBhcHBzT2YoZGF0YSk7XG4gIGNvbnN0IGRheXMgPSBhbGxEYXlzKCk7XG4gIGNvbnN0IGFnZSA9IGRhdGEgPyBhZ2VIb3VycyhkYXRhLmdlbmVyYXRlZEF0KSA6IG51bGw7XG4gIGNvbnN0IHN0YWxlID0gZGF0YSAmJiAoYWdlID09PSBudWxsIHx8IGFnZSA+IFNUQUxFX0hPVVJTKTtcbiAgY29uc3QgdGFiQXBwcyA9IGFwcHMuZmlsdGVyKChhKSA9PiAhKGEubmFtZSBpbiBPVkVSVklFV19PTkxZX0FQUFMpKTtcbiAgY29uc3QgY3VycmVudCA9IHRhYiA9PT0gXCJvdmVydmlld1wiID8gbnVsbCA6IHRhYkFwcHMuZmluZCgoYSkgPT4gYS5uYW1lID09PSB0YWIpO1xuXG4gIHJldHVybiAoXG4gICAgPGRpdiBzdHlsZT17eyBmbGV4OiAxLCBtaW5IZWlnaHQ6IDAsIGRpc3BsYXk6IFwiZmxleFwiLCBmbGV4RGlyZWN0aW9uOiBcImNvbHVtblwiLCBnYXA6IDEyLCBjb2xvcjogcGFsZXR0ZS50ZXh0IH19PlxuICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiBcImZsZXhcIiwgYWxpZ25JdGVtczogXCJjZW50ZXJcIiwgZ2FwOiAxMiwgcGFkZGluZ1JpZ2h0OiAyNCB9fT5cbiAgICAgICAgPGgyIHN0eWxlPXt7IG1hcmdpbjogMCB9fT57TkFNRX08L2gyPlxuICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogcGFsZXR0ZS50ZXh0TXV0ZWQsIGZsZXg6IDEgfX0+XG4gICAgICAgICAge2RhdGFcbiAgICAgICAgICAgID8gYEdlbmVyYXRlZCAke2RhdGEuZ2VuZXJhdGVkQXQgPyBuZXcgRGF0ZShkYXRhLmdlbmVyYXRlZEF0KS50b0xvY2FsZVN0cmluZygpIDogXCJVbmtub3duXCJ9IFx1MDBCNyAke2RheXMubGVuZ3RofSBEYXkke2RheXMubGVuZ3RoID09PSAxID8gXCJcIiA6IFwic1wifSBPZiBIaXN0b3J5YFxuICAgICAgICAgICAgOiBcIk5vIERhdGEgWWV0XCJ9XG4gICAgICAgIDwvc3Bhbj5cbiAgICAgICAge3NwaW5uaW5nID8gPFNwaW5uZXIgc2l6ZT17MTZ9IC8+IDogPEljb25CdXR0b24gbGFiZWw9XCJSZWZyZXNoXCIgaWNvbj17cmVmcmVzaEljb259IG9uQ2xpY2s9eygpID0+IHZvaWQgcmVmcmVzaChhcGksIHVuZGVmaW5lZCwgdHJ1ZSl9IC8+fVxuICAgICAgPC9kaXY+XG4gICAgICB7ZXJyb3IgJiYgPEJhbm5lciBtZXNzYWdlPXtgQ291bGQgTm90IExvYWQgTWV0cmljczogJHtlcnJvcn1gfSB0b25lPVwiZXJyb3JcIiAvPn1cbiAgICAgIHtzdGFsZSAmJiA8QmFubmVyIG1lc3NhZ2U9e2BNZXRyaWNzIEFyZSBPbGRlciBUaGFuICR7U1RBTEVfSE9VUlN9IEhvdXJzOyBUaGUgRGFpbHkgQ29sbGVjdG9yIE1heSBIYXZlIEZhaWxlZGB9IHRvbmU9XCJ3YXJuaW5nXCIgLz59XG4gICAgICB7ZGF0YSAmJiAoXG4gICAgICAgIDw+XG4gICAgICAgICAgPFRhYnNcbiAgICAgICAgICAgIHRhYnM9e1t7IGxhYmVsOiBcIk92ZXJ2aWV3XCIsIHZhbHVlOiBcIm92ZXJ2aWV3XCIgfSwgLi4udGFiQXBwcy5tYXAoKGEpID0+ICh7IGxhYmVsOiBhLm5hbWUgYXMgc3RyaW5nLCB2YWx1ZTogYS5uYW1lIGFzIHN0cmluZyB9KSldfVxuICAgICAgICAgICAgdmFsdWU9e2N1cnJlbnQgPyB0YWIgOiBcIm92ZXJ2aWV3XCJ9XG4gICAgICAgICAgICBvbkNoYW5nZT17c2V0VGFifVxuICAgICAgICAgIC8+XG4gICAgICAgICAgPGRpdiBzdHlsZT17eyAuLi5zY3JvbGxiYXJTdHlsZShwYWxldHRlKSwgZmxleDogMSwgbWluSGVpZ2h0OiAwLCBvdmVyZmxvdzogXCJhdXRvXCIsIHBhZGRpbmdSaWdodDogR0FQIH19PlxuICAgICAgICAgICAge2N1cnJlbnQgPyA8QXBwVmlldyBhcGk9e2FwaX0gYXBwPXtjdXJyZW50fSBkYXlzPXtkYXlzfSAvPiA6IDxPdmVydmlldyBhcGk9e2FwaX0gZG9jPXtkYXRhfSBkYXlzPXtkYXlzfSAvPn1cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC8+XG4gICAgICApfVxuICAgIDwvZGl2PlxuICApO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUNBLFNBQVMsV0FBVyxRQUFRLGdCQUFnQjtBOzs7OztBQXNTeEMsU0F5V0EsVUF6V0EsS0F5RVEsWUF6RVI7QUFqU0osSUFBTSxPQUFPO0FBQ2IsSUFBTSxjQUFjO0FBQ3BCLElBQU0sWUFBWTtBQUNsQixJQUFNLGNBQWM7QUFDcEIsSUFBTSxXQUFXO0FBQ2pCLElBQU0saUJBQWlCO0FBMEJ2QixJQUFJLFFBQWUsRUFBRSxNQUFNLE1BQU0sU0FBUyxDQUFDLEdBQUcsT0FBTyxNQUFNLFVBQVUsTUFBTTtBQUMzRSxJQUFJLGFBQWE7QUFDakIsSUFBTSxZQUFZLG9CQUFJLElBQWdCO0FBR3RDLFNBQVMsU0FBUyxPQUF1QjtBQUN2QyxNQUFLLE9BQU8sS0FBSyxLQUFLLEVBQXNCLE1BQU0sQ0FBQyxNQUFNLEtBQUssVUFBVSxNQUFNLENBQUMsQ0FBQyxNQUFNLEtBQUssVUFBVSxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUc7QUFDakgsVUFBUSxFQUFFLEdBQUcsT0FBTyxHQUFHLE1BQU07QUFDN0IsWUFBVSxRQUFRLENBQUMsTUFBTSxFQUFFLENBQUM7QUFDOUI7QUFJQSxJQUFNLGNBQWMsQ0FBQyxNQUFxQixNQUFNLFFBQVEsT0FBTyxNQUFNLFlBQVksT0FBTyxFQUFFLFVBQVU7QUFFcEcsU0FBUyxhQUFhLEdBQWtCO0FBQ3RDLE1BQUksWUFBWSxDQUFDLEVBQUcsUUFBTztBQUMzQixNQUFJLE1BQU0sUUFBUSxDQUFDLEVBQUcsUUFBTyxFQUFFLEtBQUssWUFBWTtBQUNoRCxNQUFJLEtBQUssT0FBTyxNQUFNLFNBQVUsUUFBTyxPQUFPLE9BQU8sQ0FBQyxFQUFFLEtBQUssWUFBWTtBQUN6RSxTQUFPO0FBQ1Q7QUFFQSxJQUFNLFFBQVEsSUFBSSxLQUFLLGFBQWEsUUFBVyxFQUFFLE9BQU8sWUFBWSxVQUFVLE1BQU0sQ0FBQztBQUNyRixJQUFNLFVBQVUsSUFBSSxLQUFLLGFBQWEsUUFBVyxFQUFFLFVBQVUsV0FBVyx1QkFBdUIsRUFBRSxDQUFDO0FBQ2xHLElBQU0sWUFBWTtBQUdsQixTQUFTLElBQUksR0FBUyxNQUFNLElBQVk7QUFDdEMsTUFBSSxNQUFNLFFBQVEsTUFBTSxPQUFXLFFBQU87QUFDMUMsTUFBSSxZQUFZLENBQUMsRUFBRyxRQUFPLFlBQVksRUFBRSxLQUFLO0FBQzlDLE1BQUksT0FBTyxNQUFNLFVBQVU7QUFDekIsUUFBSSxVQUFVLEtBQUssR0FBRyxFQUFHLFFBQU8sTUFBTSxPQUFPLENBQUM7QUFDOUMsUUFBSSxhQUFhLEtBQUssR0FBRyxFQUFHLFFBQU8sR0FBRyxLQUFLLE1BQU0sQ0FBQyxDQUFDO0FBQ25ELFdBQU8sRUFBRSxlQUFlO0FBQUEsRUFDMUI7QUFDQSxNQUFJLE9BQU8sTUFBTSxVQUFXLFFBQU8sSUFBSSxRQUFRO0FBQy9DLFNBQU8sT0FBTyxDQUFDO0FBQ2pCO0FBR0EsSUFBTSxPQUFPLENBQUMsR0FBOEIsTUFBTSxPQUFRLE1BQU0sU0FBWSxNQUFNLElBQUksR0FBRyxHQUFHO0FBRTVGLElBQU0sVUFBVSxDQUFDLFFBQWdCLENBQUMsTUFBZSxVQUFVLEtBQUssR0FBRyxJQUFJLE1BQU0sT0FBTyxDQUFDLElBQUksUUFBUSxPQUFPLENBQUM7QUFFekcsU0FBUyxTQUFTLEtBQXdDO0FBQ3hELFFBQU0sSUFBSSxNQUFNLEtBQUssTUFBTSxHQUFHLElBQUk7QUFDbEMsU0FBTyxPQUFPLE1BQU0sQ0FBQyxJQUFJLFFBQVEsS0FBSyxJQUFJLElBQUksS0FBSztBQUNyRDtBQUVBLElBQU0sWUFBWSxDQUFDLE9BQWMsb0JBQUksS0FBSyxHQUFHLENBQUMsWUFBWSxHQUFFLG1CQUFtQixRQUFXLEVBQUUsT0FBTyxTQUFTLEtBQUssV0FBVyxVQUFVLE1BQU0sQ0FBQztBQUU3SSxJQUFNLFNBQVMsQ0FBQyxRQUF1QixPQUFPLE1BQU0sUUFBUSxJQUFJLElBQUksSUFBSSxJQUFJLE9BQU8sQ0FBQztBQUdwRixTQUFTLE9BQU8sR0FBUyxNQUF5QztBQUNoRSxNQUFJLElBQUk7QUFDUixhQUFXLEtBQUssS0FBSyxNQUFNLEdBQUcsR0FBRztBQUMvQixRQUFJLE1BQU0sT0FBVyxRQUFPO0FBQzVCLFFBQUksTUFBTSxRQUFRLFlBQVksQ0FBQyxFQUFHLFFBQU87QUFDekMsUUFBSSxFQUFFLENBQUM7QUFBQSxFQUNUO0FBQ0EsTUFBSSxNQUFNLE9BQVcsUUFBTztBQUM1QixTQUFPLE9BQU8sTUFBTSxZQUFZLE9BQU8sU0FBUyxDQUFDLElBQUksSUFBSTtBQUMzRDtBQUdBLFNBQVMsUUFBUSxLQUFXLE1BQXlDO0FBQ25FLE1BQUksQ0FBQyxPQUFPLFlBQVksSUFBSSxJQUFJLEVBQUcsUUFBTztBQUMxQyxRQUFNLE9BQU8sT0FBTyxHQUFHLEVBQ3BCLElBQUksQ0FBQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsRUFDMUIsT0FBTyxDQUFDLE1BQU0sTUFBTSxNQUFTO0FBQ2hDLE1BQUksS0FBSyxXQUFXLEVBQUcsUUFBTztBQUM5QixTQUFPLEtBQUssS0FBSyxDQUFDLE1BQU0sTUFBTSxJQUFJLElBQUksT0FBUSxLQUFrQixPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksR0FBRyxDQUFDO0FBQzNGO0FBR0EsU0FBUyxVQUFVLEtBQWEsR0FBNkI7QUFDM0QsTUFBSSxPQUFPLE1BQU0sWUFBWSxLQUFLLEVBQUcsUUFBTztBQUM1QyxNQUFJLFFBQVEsVUFBVyxRQUFPO0FBQzlCLE1BQUksUUFBUSxlQUFnQixRQUFPO0FBQ25DLE1BQUksUUFBUSxZQUFhLFFBQU87QUFDaEMsU0FBTztBQUNUO0FBR0EsU0FBUyxVQUFVLE9BQStEO0FBQ2hGLFFBQU0sTUFBTSxNQUFNLE9BQU8sQ0FBQyxNQUF3QixDQUFDLENBQUMsQ0FBQztBQUNyRCxTQUFPLElBQUksU0FBUyxNQUFNLEdBQUcsSUFBSTtBQUNuQztBQUdBLFNBQVMsVUFBVSxHQUE2QjtBQUM5QyxNQUFJLFlBQVksQ0FBQyxFQUFHLFFBQU87QUFDM0IsTUFBSSxDQUFDLEtBQUssT0FBTyxNQUFNLFNBQVUsUUFBTztBQUN4QyxRQUFNLFFBQXVCLENBQUM7QUFDOUIsUUFBTSxPQUFPLENBQUMsTUFDWixPQUFPLFFBQVEsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNO0FBQ3BDLFVBQU0sSUFBSSxVQUFVLEdBQUcsQ0FBQyxNQUFNLE1BQU0saUJBQWlCLE9BQU8sTUFBTSxZQUFZLElBQUksSUFBSSxZQUFZLFVBQVUsWUFBWSxDQUFDLElBQUksWUFBWTtBQUN6SSxRQUFJLEVBQUcsT0FBTSxLQUFLLENBQUM7QUFBQSxhQUNWLEtBQUssT0FBTyxNQUFNLFNBQVUsTUFBSyxDQUFDO0FBQUEsRUFDN0MsQ0FBQztBQUNILE9BQUssQ0FBQztBQUNOLFNBQU8sTUFBTSxTQUFTLE1BQU0sS0FBSyxJQUFJO0FBQ3ZDO0FBRUEsU0FBUyxVQUFVLEtBQXdCO0FBQ3pDLE1BQUksVUFBVSxXQUFXLE9BQU8sS0FBSyx1QkFBdUIsQ0FBQyxFQUFHLFFBQU87QUFDdkUsTUFBSSxVQUFVLGdCQUFnQixPQUFPLEtBQUssZ0NBQWdDLENBQUMsRUFBRyxRQUFPO0FBQ3JGLE1BQUksYUFBYSxHQUFHLEVBQUcsUUFBTztBQUM5QixNQUFJLFVBQVUsYUFBYSxPQUFPLEtBQUssNkJBQTZCLENBQUMsRUFBRyxRQUFPO0FBQy9FLE9BQUssSUFBSSxRQUFRLFdBQVcsZUFBZSxLQUFLLEVBQUcsUUFBTztBQUMxRCxTQUFPO0FBQ1Q7QUFFQSxJQUFNLFFBQXVCLENBQUMsUUFBUSxXQUFXLFdBQVcsT0FBTztBQUNuRSxJQUFNLFFBQVEsQ0FBQyxPQUFtQyxHQUFHLE9BQU8sQ0FBQyxHQUFHLE1BQU8sTUFBTSxRQUFRLENBQUMsSUFBSSxNQUFNLFFBQVEsQ0FBQyxJQUFJLElBQUksR0FBSSxTQUF3QjtBQUU3SSxTQUFTLFVBQVUsS0FBd0I7QUFDekMsUUFBTSxNQUFNLFNBQVMsSUFBSSxXQUFXO0FBQ3BDLFFBQU0sUUFBUSxRQUFRLFFBQVEsTUFBTTtBQUNwQyxRQUFNLFNBQVMsTUFBTSxPQUFPLEdBQUcsRUFBRSxJQUFJLFNBQVMsQ0FBQztBQUMvQyxTQUFPLFNBQVMsYUFBYSxHQUFHLElBQUksTUFBTSxDQUFDLFFBQVEsU0FBUyxDQUFDLElBQUk7QUFDbkU7QUFHQSxTQUFTLFVBQWlCO0FBQ3hCLFFBQU0sSUFBSSxJQUFJLElBQUksTUFBTSxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDM0QsTUFBSSxPQUFPLE1BQU0sTUFBTSxnQkFBZ0IsU0FBVSxHQUFFLElBQUksTUFBTSxLQUFLLFlBQVksTUFBTSxHQUFHLEVBQUUsR0FBRyxNQUFNLElBQUk7QUFDdEcsU0FBTyxDQUFDLEdBQUcsRUFBRSxRQUFRLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU8sSUFBSSxJQUFJLEtBQUssQ0FBRSxFQUFFLElBQUksQ0FBQyxDQUFDLE1BQU0sR0FBRyxPQUFPLEVBQUUsTUFBTSxJQUFJLEVBQUU7QUFDbkc7QUFJQSxlQUFlLFFBQVEsS0FBZ0IsTUFBbUM7QUFDeEUsUUFBTSxJQUFJLE1BQU0sSUFBSSxTQUFTLElBQWM7QUFDM0MsUUFBTSxNQUFNLENBQUMsR0FBRyxNQUFNLHlCQUF5QixNQUFNLHNCQUFzQixJQUFJO0FBQy9FLE1BQUksRUFBRSxXQUFZLEtBQUksS0FBSyxhQUFhLEVBQUUsVUFBVTtBQUNwRCxTQUFPO0FBQ1Q7QUFFQSxlQUFlLElBQUksS0FBZ0IsTUFBaUM7QUFDbEUsUUFBTSxNQUFNLE1BQU0sSUFBSSxNQUFNLEtBQUssT0FBTyxNQUFNLFFBQVEsS0FBSyxJQUFJLENBQUM7QUFDaEUsTUFBSSxJQUFJLFNBQVMsRUFBRyxPQUFNLElBQUksTUFBTSxJQUFJLE9BQU8sS0FBSyxLQUFLLHdCQUF3QixJQUFJLElBQUksRUFBRTtBQUMzRixTQUFPLElBQUk7QUFDYjtBQUVBLGVBQWUsWUFBWSxLQUFnQjtBQUN6QyxRQUFNLFVBQVUsTUFBTSxJQUFJLEdBQUcsUUFBUSxXQUFXO0FBQ2hELFFBQU0sUUFBUSxRQUNYLE9BQU8sQ0FBQyxNQUFNLENBQUMsRUFBRSxTQUFTLDRCQUE0QixLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQ2xFLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUNqQixLQUFLLEVBQ0wsTUFBTSxDQUFDLFFBQVE7QUFDbEIsUUFBTSxPQUFPLE1BQU0sUUFBUTtBQUFBLElBQ3pCLE1BQU0sSUFBSSxPQUFPLE1BQU07QUFDckIsVUFBSTtBQUNGLGVBQU8sS0FBSyxNQUFNLE1BQU0sSUFBSSxHQUFHLGFBQWEsR0FBRyxXQUFXLElBQUksQ0FBQyxFQUFFLENBQUM7QUFBQSxNQUNwRSxRQUFRO0FBQ04sZUFBTztBQUFBLE1BQ1Q7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQ0EsV0FBUyxFQUFFLFNBQVMsTUFBTSxJQUFJLENBQUMsR0FBRyxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sR0FBRyxFQUFFLEdBQUcsS0FBSyxLQUFLLENBQUMsRUFBRSxFQUFFLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUUsQ0FBQztBQUMxRztBQUVBLGVBQWUsWUFBWSxLQUFnQixRQUFnQjtBQUN6RCxRQUFNLFFBQVEsTUFBTSxJQUFJLEdBQUcsWUFBWSxHQUFHLFFBQVEsV0FBVyxFQUFFO0FBQy9ELFFBQU0sSUFBSSxLQUFLLENBQUMsTUFBTSxRQUFRLFFBQVEsTUFBTSxJQUFJLFdBQVcsS0FBSyxHQUFHLElBQUksSUFBSSxXQUFXLElBQUksb0JBQW9CLENBQUM7QUFDL0csUUFBTSxZQUFZLEdBQUc7QUFDdkI7QUFFQSxlQUFlLFFBQVEsS0FBZ0IsUUFBc0IsU0FBUyxPQUFPO0FBQzNFLE1BQUksT0FBUSxVQUFTLEVBQUUsVUFBVSxLQUFLLENBQUM7QUFDdkMsTUFBSSxXQUFZO0FBQ2hCLGVBQWE7QUFDYixRQUFNLFVBQVUsQ0FBQyxHQUFnQixRQUFpQjtBQUNoRCxRQUFJLFFBQVEsUUFBUztBQUNyQixRQUFJO0FBQ0YsVUFBSSxXQUFXLElBQUksR0FBRyxHQUFHO0FBQUEsSUFDM0IsUUFBUTtBQUFBLElBRVI7QUFBQSxFQUNGO0FBQ0EsUUFBTSxNQUFNLENBQUMsT0FBeUIsUUFBZ0I7QUFDcEQsUUFBSSxRQUFRLFFBQVM7QUFDckIsUUFBSTtBQUNGLFVBQUksSUFBSSxLQUFLLEVBQUUsR0FBRyxJQUFJLEtBQUssR0FBRyxFQUFFO0FBQUEsSUFDbEMsUUFBUTtBQUFBLElBRVI7QUFBQSxFQUNGO0FBQ0EsTUFBSTtBQUNGLFVBQU0sVUFBVSxNQUFNLElBQUksU0FBUyxJQUFjLEdBQUcsVUFBVTtBQUM5RCxVQUFNLE9BQU8sS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLENBQUMsTUFBTSxNQUFNLFFBQVEsTUFBTSxpQkFBaUIsR0FBRyxDQUFDLENBQUM7QUFDeEYsVUFBTSxJQUFJLFFBQVEsSUFBSSxXQUFXLElBQUk7QUFDckMsYUFBUyxFQUFFLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFDOUIsUUFBSSxTQUFTLFVBQVUsSUFBSTtBQUMzQixRQUFJLE1BQU0sV0FBVyxZQUFZLHVCQUF1QixXQUFXLFVBQVUsbUNBQW1DO0FBQ2hILFFBQUk7QUFDRixZQUFNLFlBQVksS0FBSyxNQUFNO0FBQUEsSUFDL0IsU0FBUyxHQUFHO0FBQ1YsWUFBTSxNQUFNLGFBQWEsUUFBUSxFQUFFLFVBQVUsT0FBTyxDQUFDO0FBQ3JELFVBQUksUUFBUSx3QkFBd0IsR0FBRyxFQUFFO0FBQ3pDLGVBQVMsTUFBTSxDQUFDLFFBQVEsU0FBUyxDQUFDO0FBQ2xDLFlBQU0sd0JBQXdCLEdBQUc7QUFBQSxJQUNuQztBQUVBLFlBQVEsV0FBVyxhQUFhLFdBQVcsVUFBVSxTQUFTLFFBQVEsR0FBRztBQUFBLEVBQzNFLFNBQVMsR0FBRztBQUNWLFVBQU0sTUFBTSxhQUFhLFFBQVEsRUFBRSxVQUFVLE9BQU8sQ0FBQztBQUNyRCxhQUFTLEVBQUUsT0FBTyxJQUFJLENBQUM7QUFDdkIsWUFBUSxTQUFTLEdBQUc7QUFDcEIsUUFBSSxTQUFTLEdBQUc7QUFBQSxFQUNsQixVQUFFO0FBQ0EsaUJBQWE7QUFDYixhQUFTLEVBQUUsVUFBVSxNQUFNLENBQUM7QUFBQSxFQUM5QjtBQUNGO0FBRUEsZUFBc0IsU0FBUyxLQUFvQjtBQUNqRCxNQUFJLElBQUksV0FBVyxJQUFJLE1BQU07QUFDN0IsUUFBTSxJQUFJLE1BQU0sSUFBSSxJQUFJLFNBQVMsSUFBYztBQUMvQyxRQUFNLFVBQVUsS0FBSyxJQUFJLEdBQUcsRUFBRSxrQkFBa0IsRUFBRTtBQUNsRCxNQUFJLEtBQUssU0FBUyxNQUFNLFFBQVEsSUFBSSxLQUFLLElBQUksTUFBTSxDQUFDO0FBQ3BELE1BQUksS0FBSyxZQUFZLFVBQVUsR0FBTTtBQUNyQyxNQUFJLElBQUksSUFBSSxLQUFLLEdBQUcsSUFBSSxZQUFZO0FBQ3BDLE9BQUssWUFBWSxJQUFJLEdBQUcsRUFBRSxNQUFNLE1BQU0sTUFBUztBQUMvQyxPQUFLLFFBQVEsSUFBSSxLQUFLLElBQUksTUFBTTtBQUNsQztBQUlBLElBQU0sZUFBZTtBQUVyQixJQUFNLGlCQUFpQixDQUFDLE9BQStCLEVBQUUsZ0JBQWdCLFFBQVEsZ0JBQWdCLEdBQUcsRUFBRSxNQUFNLElBQUksRUFBRSxPQUFPLEdBQUc7QUFFNUgsU0FBUyxXQUFXO0FBQ2xCLFFBQU0sTUFBTSxPQUF1QixJQUFJO0FBQ3ZDLFFBQU0sQ0FBQyxPQUFPLFFBQVEsSUFBSSxTQUFTLENBQUM7QUFDcEMsWUFBVSxNQUFNO0FBQ2QsVUFBTSxLQUFLLElBQUk7QUFDZixRQUFJLENBQUMsR0FBSTtBQUNULFVBQU0sS0FBSyxJQUFJLGVBQWUsQ0FBQyxDQUFDLENBQUMsTUFBTSxTQUFTLEVBQUUsWUFBWSxLQUFLLENBQUM7QUFDcEUsT0FBRyxRQUFRLEVBQUU7QUFDYixXQUFPLE1BQU0sR0FBRyxXQUFXO0FBQUEsRUFDN0IsR0FBRyxDQUFDLENBQUM7QUFDTCxTQUFPLENBQUMsS0FBSyxLQUFLO0FBQ3BCO0FBRUEsU0FBUyxRQUFRLEdBQW1CO0FBQ2xDLE1BQUksS0FBSyxFQUFHLFFBQU87QUFDbkIsUUFBTSxJQUFJLE1BQU0sS0FBSyxNQUFNLEtBQUssTUFBTSxDQUFDLENBQUM7QUFDeEMsUUFBTSxJQUFJLElBQUk7QUFDZCxVQUFRLEtBQUssSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJLE1BQU07QUFDdkQ7QUFFQSxTQUFTLFFBQVEsRUFBRSxHQUFHLEdBQUcsR0FBRyxNQUFNLE9BQU8sU0FBUyxHQUE4RjtBQUM5SSxTQUNFO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFDQyxPQUFPO0FBQUEsUUFDTCxVQUFVLFFBQVEsVUFBVTtBQUFBLFFBQzVCLE1BQU07QUFBQSxRQUNOLEtBQUs7QUFBQSxRQUNMLFdBQVcsT0FBTyxzQkFBc0I7QUFBQSxRQUN4QyxZQUFZLEVBQUU7QUFBQSxRQUNkLE9BQU8sRUFBRTtBQUFBLFFBQ1QsUUFBUSxhQUFhLEVBQUUsTUFBTTtBQUFBLFFBQzdCLGNBQWM7QUFBQSxRQUNkLFNBQVM7QUFBQSxRQUNULFVBQVU7QUFBQSxRQUNWLFlBQVk7QUFBQSxRQUNaLFlBQVk7QUFBQSxRQUNaLGVBQWU7QUFBQSxRQUNmLFFBQVE7QUFBQSxNQUNWO0FBQUEsTUFFQztBQUFBO0FBQUEsRUFDSDtBQUVKO0FBU0EsU0FBUyxVQUFVLEVBQUUsS0FBSyxRQUFRLFFBQVEsUUFBUSxTQUFTLGFBQWEsR0FBMkc7QUFDakwsUUFBTSxJQUFJLElBQUksTUFBTTtBQUNwQixRQUFNLENBQUMsS0FBSyxLQUFLLElBQUksU0FBUztBQUM5QixRQUFNLENBQUMsT0FBTyxRQUFRLElBQUksU0FBd0IsSUFBSTtBQUN0RCxRQUFNLElBQUksSUFDUixJQUFJLElBQ0osSUFBSSxJQUNKLElBQUk7QUFDTixRQUFNLElBQUksS0FBSyxJQUFJLEdBQUcsUUFBUSxJQUFJLENBQUM7QUFDbkMsUUFBTSxJQUFJLFNBQVMsSUFBSTtBQUN2QixRQUFNLElBQUksT0FBTztBQUNqQixRQUFNLE1BQU0sUUFBUSxLQUFLLElBQUksR0FBRyxHQUFHLE9BQU8sUUFBUSxDQUFDLE1BQU0sRUFBRSxPQUFPLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN0RixRQUFNLElBQUksQ0FBQyxNQUFjLEtBQUssS0FBSyxJQUFJLElBQUksSUFBSyxJQUFJLEtBQU0sSUFBSTtBQUM5RCxRQUFNLElBQUksQ0FBQyxNQUFjLElBQUksSUFBSyxJQUFJLE1BQU87QUFFN0MsUUFBTSxTQUFTLENBQUMsV0FBOEI7QUFDNUMsVUFBTSxPQUFtQixDQUFDO0FBQzFCLFFBQUksTUFBZ0IsQ0FBQztBQUNyQixXQUFPLFFBQVEsQ0FBQyxHQUFHLE1BQU07QUFDdkIsVUFBSSxNQUFNLE1BQU07QUFDZCxZQUFJLElBQUksT0FBUSxNQUFLLEtBQUssR0FBRztBQUM3QixjQUFNLENBQUM7QUFBQSxNQUNULE1BQU8sS0FBSSxLQUFLLENBQUM7QUFBQSxJQUNuQixDQUFDO0FBQ0QsUUFBSSxJQUFJLE9BQVEsTUFBSyxLQUFLLEdBQUc7QUFDN0IsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFNBQVMsQ0FBQyxNQUFrQztBQUNoRCxVQUFNLElBQUksRUFBRSxjQUFjLHNCQUFzQjtBQUNoRCxVQUFNLElBQUksS0FBSyxJQUFJLElBQUksS0FBSyxPQUFRLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBRSxTQUFVLElBQUksRUFBRTtBQUM1RSxhQUFTLEtBQUssSUFBSSxJQUFJLEdBQUcsS0FBSyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFBQSxFQUMxQztBQUVBLFFBQU0sVUFBVSxLQUFLLElBQUksQ0FBQyxDQUFDLElBQUksTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLEtBQUssT0FBTyxJQUFJLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQztBQUNwRixRQUFNLFNBQVMsQ0FBQyxNQUFlLEtBQUssSUFBSSxXQUFXLE1BQU0sSUFBSSxVQUFVLE1BQU0sSUFBSSxJQUFJLFFBQVE7QUFDN0YsUUFBTSxPQUFPLFVBQVUsUUFBUSxFQUFFLEtBQUssSUFBSSxRQUFRO0FBRWxELFNBQ0UscUJBQUMsU0FBSSxLQUFVLE9BQU8sRUFBRSxVQUFVLFlBQVksT0FBTyxHQUNsRDtBQUFBLFlBQVEsS0FDUCxxQkFBQyxTQUFJLE9BQWMsUUFBZ0IsT0FBTyxFQUFFLFNBQVMsU0FBUyxVQUFVLEdBQUcsR0FDeEU7QUFBQSxPQUFDLEdBQUcsS0FBSyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQ2hCLHFCQUFDLE9BQ0M7QUFBQSw0QkFBQyxVQUFLLElBQUksR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUUsTUFBTSxDQUFDLEdBQUcsSUFBSSxFQUFFLE1BQU0sQ0FBQyxHQUFHLFFBQVEsRUFBRSxRQUFRLGFBQWEsR0FBRyxpQkFBaUIsSUFBSSxRQUFRLFFBQVc7QUFBQSxRQUNsSSxvQkFBQyxVQUFLLEdBQUcsSUFBSSxHQUFHLEdBQUcsRUFBRSxNQUFNLENBQUMsR0FBRyxJQUFHLFVBQVMsWUFBVyxPQUFNLE1BQU0sRUFBRSxXQUNqRSxpQkFBTyxNQUFNLENBQUMsR0FDakI7QUFBQSxXQUpNLENBS1IsQ0FDRDtBQUFBLE1BQ0EsUUFBUSxJQUFJLENBQUMsTUFDWixvQkFBQyxVQUFhLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxTQUFTLEdBQUcsWUFBWSxPQUFPLENBQUMsR0FBRyxNQUFNLEVBQUUsV0FDbEUsaUJBQU8sQ0FBQyxLQURBLENBRVgsQ0FDRDtBQUFBLE1BQ0EsT0FBTyxJQUFJLENBQUMsTUFBTTtBQUNqQixjQUFNLE9BQU8sT0FBTyxFQUFFLE1BQU07QUFDNUIsY0FBTSxPQUFPLENBQUMsUUFBa0IsSUFBSSxJQUFJLENBQUMsR0FBRyxNQUFNLEdBQUcsSUFBSSxNQUFNLEdBQUcsR0FBRyxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxPQUFPLENBQUMsQ0FBVyxDQUFDLEVBQUUsRUFBRSxLQUFLLEVBQUU7QUFDaEgsY0FBTSxZQUFZLENBQUMsR0FBRyxFQUFFLE9BQU8sS0FBSyxDQUFDLEVBQUUsUUFBUSxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU0sSUFBSTtBQUNqRixlQUNFLHFCQUFDLE9BQ0U7QUFBQSxlQUFLO0FBQUEsWUFBSSxDQUFDLFFBQ1QsSUFBSSxTQUFTLElBQ1gscUJBQUMsT0FDRTtBQUFBLHFCQUFPLFdBQVcsS0FBSyxvQkFBQyxVQUFLLEdBQUcsR0FBRyxLQUFLLEdBQUcsQ0FBQyxJQUFJLEVBQUUsSUFBSSxJQUFJLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLEtBQUssTUFBTSxFQUFFLE9BQU8sYUFBYSxNQUFNO0FBQUEsY0FDM0ksb0JBQUMsVUFBSyxHQUFHLEtBQUssR0FBRyxHQUFHLE1BQUssUUFBTyxRQUFRLEVBQUUsT0FBTyxhQUFhLEdBQUcsZ0JBQWUsU0FBUSxlQUFjLFNBQVE7QUFBQSxpQkFGeEcsSUFBSSxDQUFDLENBR2IsSUFFQSxvQkFBQyxZQUFvQixJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLEVBQUUsRUFBRSxPQUFPLElBQUksQ0FBQyxDQUFDLENBQVcsR0FBRyxHQUFHLEdBQUcsTUFBTSxFQUFFLFNBQXhFLElBQUksQ0FBQyxDQUEwRTtBQUFBLFVBRWhHO0FBQUEsVUFDQyxjQUFjLFVBQWEsVUFBVSxRQUNwQyxvQkFBQyxZQUFPLElBQUksRUFBRSxTQUFTLEdBQUcsSUFBSSxFQUFFLEVBQUUsT0FBTyxTQUFTLENBQVcsR0FBRyxHQUFHLEtBQUssTUFBTSxFQUFFLE9BQU8sUUFBUSxFQUFFLFNBQVMsYUFBYSxHQUFHO0FBQUEsVUFFM0gsVUFBVSxRQUFRLEVBQUUsT0FBTyxLQUFLLE1BQU0sUUFDckMsb0JBQUMsWUFBTyxJQUFJLEVBQUUsS0FBSyxHQUFHLElBQUksRUFBRSxFQUFFLE9BQU8sS0FBSyxDQUFXLEdBQUcsR0FBRyxLQUFLLE1BQU0sRUFBRSxPQUFPLFFBQVEsRUFBRSxTQUFTLGFBQWEsR0FBRyxlQUFjLFFBQU87QUFBQSxhQWZuSSxFQUFFLElBaUJWO0FBQUEsTUFFSixDQUFDO0FBQUEsTUFDQSxVQUFVLFFBQVEsb0JBQUMsVUFBSyxJQUFJLEVBQUUsS0FBSyxHQUFHLElBQUksRUFBRSxLQUFLLEdBQUcsSUFBSSxHQUFHLElBQUksSUFBSSxHQUFHLFFBQVEsRUFBRSxXQUFXLGFBQWEsR0FBRyxlQUFjLFFBQU87QUFBQSxNQUNqSSxvQkFBQyxVQUFLLEdBQUcsR0FBRyxHQUFHLEdBQUcsT0FBTyxHQUFHLFFBQWdCLE1BQUssZUFBYyxhQUFhLFFBQVEsY0FBYyxNQUFNLFNBQVMsSUFBSSxHQUFHO0FBQUEsT0FDMUg7QUFBQSxJQUVELFVBQVUsUUFDVCxxQkFBQyxXQUFRLEdBQU0sR0FBRyxFQUFFLEtBQUssS0FBSyxPQUFPLE1BQU0sS0FBSyxHQUFHLEdBQUcsTUFDcEQ7QUFBQSwwQkFBQyxTQUFJLE9BQU8sRUFBRSxPQUFPLEVBQUUsVUFBVSxHQUFJLGlCQUFPLEtBQUssR0FBRTtBQUFBLE1BQ2xELE9BQU8sSUFBSSxDQUFDLE1BQ1gscUJBQUMsU0FBaUIsT0FBTyxFQUFFLFNBQVMsUUFBUSxZQUFZLFVBQVUsS0FBSyxFQUFFLEdBQ3RFO0FBQUEsZUFBTyxTQUFTLEtBQUssb0JBQUMsVUFBSyxPQUFPLEVBQUUsT0FBTyxHQUFHLFFBQVEsR0FBRyxjQUFjLEdBQUcsWUFBWSxFQUFFLE1BQU0sR0FBRztBQUFBLFFBQ2pHLE9BQU8sU0FBUyxLQUFLLG9CQUFDLFVBQUssT0FBTyxFQUFFLE9BQU8sRUFBRSxVQUFVLEdBQUksWUFBRSxNQUFLO0FBQUEsUUFDbkUsb0JBQUMsVUFBTSxZQUFFLE9BQU8sS0FBSyxNQUFNLE9BQU8sWUFBWSxPQUFPLEVBQUUsT0FBTyxLQUFLLENBQVcsR0FBRTtBQUFBLFdBSHhFLEVBQUUsSUFJWixDQUNEO0FBQUEsT0FDSDtBQUFBLEtBRUo7QUFFSjtBQWVBLFNBQVMsT0FBTyxFQUFFLEtBQUssTUFBTSxHQUFpRTtBQUM1RixRQUFNLElBQUksSUFBSSxNQUFNO0FBQ3BCLFNBQ0Usb0JBQUMsU0FBSSxPQUFPLEVBQUUsU0FBUyxRQUFRLEtBQUssSUFBSSxVQUFVLFFBQVEsVUFBVSxJQUFJLE9BQU8sRUFBRSxVQUFVLEdBQ3hGLGdCQUFNLElBQUksQ0FBQyxPQUNWLHFCQUFDLFVBQW1CLE9BQU8sRUFBRSxTQUFTLGVBQWUsWUFBWSxVQUFVLEtBQUssRUFBRSxHQUNoRjtBQUFBLHdCQUFDLFVBQUssT0FBTyxFQUFFLE9BQU8sSUFBSSxRQUFRLElBQUksY0FBYyxHQUFHLFlBQVksR0FBRyxNQUFNLEdBQUc7QUFBQSxJQUM5RSxHQUFHO0FBQUEsT0FGSyxHQUFHLElBR2QsQ0FDRCxHQUNIO0FBRUo7QUFHQSxTQUFTLFFBQVEsRUFBRSxLQUFLLEtBQUssR0FBdUM7QUFDbEUsUUFBTSxJQUFJLElBQUksTUFBTTtBQUNwQixRQUFNLENBQUMsT0FBTyxRQUFRLElBQUksU0FBcUQsSUFBSTtBQUNuRixRQUFNLE1BQU0sS0FBSyxJQUFJLEdBQUcsR0FBRyxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsU0FBUyxPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLEtBQUs7QUFDNUYsTUFBSSxLQUFLLFdBQVcsRUFBRyxRQUFPLG9CQUFDLFVBQUssT0FBTyxFQUFFLE9BQU8sRUFBRSxVQUFVLEdBQUcsa0JBQUk7QUFDdkUsUUFBTSxPQUFPLFVBQVUsUUFBUSxNQUFNLElBQUksT0FBTyxhQUFhO0FBQzdELFNBQ0UscUJBQUMsU0FBSSxPQUFPLEVBQUUsR0FBRyxlQUFlLENBQUMsR0FBRyxXQUFXLGNBQWMsV0FBVyxRQUFRLFdBQVcsVUFBVSxjQUFjLElBQUksR0FBRyxjQUFjLE1BQU0sU0FBUyxJQUFJLEdBQ3pKO0FBQUEsd0JBQUMsU0FBSSxPQUFPLEVBQUUsU0FBUyxRQUFRLHFCQUFxQiwwQ0FBMEMsS0FBSyxZQUFZLFlBQVksVUFBVSxVQUFVLEdBQUcsR0FDL0ksZUFBSyxJQUFJLENBQUMsR0FBRyxNQUFNO0FBQ2xCLFlBQU0sUUFBUSxFQUFFLFNBQVMsT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEVBQUUsT0FBTyxDQUFDO0FBQ3hELFlBQU0sTUFBTSxPQUFPLE1BQU07QUFDekIsWUFBTUEsUUFBc0IsRUFBRSxZQUFZLE1BQU0sRUFBRSxlQUFlLFFBQVcsU0FBUyxRQUFRO0FBQzdGLGFBQ0UscUJBQUMsU0FBa0IsT0FBTyxFQUFFLFNBQVMsV0FBVyxHQUFHLGFBQWEsQ0FBQyxNQUFNLFNBQVMsRUFBRSxHQUFHLEdBQUcsRUFBRSxTQUFTLEdBQUcsRUFBRSxRQUFRLENBQUMsR0FDL0c7QUFBQSw0QkFBQyxVQUFLLE9BQU8sRUFBRSxHQUFHQSxPQUFNLE9BQU8sTUFBTSxFQUFFLFNBQVMsRUFBRSxNQUFNLFVBQVUsS0FBSyxVQUFVLFVBQVUsY0FBYyxZQUFZLFlBQVksU0FBUyxHQUFHLE9BQU8sRUFBRSxPQUNuSixZQUFFLE9BQ0w7QUFBQSxRQUNBLG9CQUFDLFNBQUksT0FBTyxFQUFFLEdBQUdBLE9BQU0sU0FBUyxRQUFRLFFBQVEsSUFBSSxZQUFZLFNBQVMsR0FDdkUsOEJBQUMsU0FBSSxPQUFPLEVBQUUsU0FBUyxRQUFRLE9BQU8sR0FBSSxRQUFRLE1BQU8sR0FBRyxLQUFLLFFBQVEsSUFBSSxLQUFLLEdBQUcsVUFBVSxRQUFRLElBQUksSUFBSSxFQUFFLEdBQzlHLFlBQUUsU0FDQSxPQUFPLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxFQUN6QixJQUFJLENBQUMsR0FBRyxHQUFHLFFBQ1Y7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUVDLE9BQU87QUFBQSxjQUNMLE1BQU0sRUFBRTtBQUFBLGNBQ1IsWUFBWSxFQUFFO0FBQUEsY0FDZCxjQUFjLEdBQUcsTUFBTSxJQUFJLElBQUksQ0FBQyxNQUFNLE1BQU0sSUFBSSxTQUFTLElBQUksSUFBSSxDQUFDLE1BQU0sTUFBTSxJQUFJLFNBQVMsSUFBSSxJQUFJLENBQUMsTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUEsWUFDM0g7QUFBQTtBQUFBLFVBTEssRUFBRTtBQUFBLFFBTVQsQ0FDRCxHQUNMLEdBQ0Y7QUFBQSxRQUNBLG9CQUFDLFVBQUssT0FBTyxFQUFFLEdBQUdBLE9BQU0sV0FBVyxTQUFTLG9CQUFvQixlQUFlLEdBQUksWUFBRSxXQUFVO0FBQUEsV0FwQnZGLEVBQUUsS0FxQlo7QUFBQSxJQUVKLENBQUMsR0FDSDtBQUFBLElBQ0MsU0FBUyxLQUFLLE1BQU0sQ0FBQyxLQUNwQixxQkFBQyxXQUFRLEdBQU0sR0FBRyxNQUFNLEtBQUssT0FBTyxNQUFNLEtBQUssR0FBRyxNQUFNLElBQUksSUFBSSxNQUFZLE9BQUssTUFDL0U7QUFBQSwwQkFBQyxTQUFJLE9BQU8sRUFBRSxZQUFZLElBQUksR0FBSSxlQUFLLE1BQU0sQ0FBQyxFQUFFLE9BQU07QUFBQSxNQUNyRCxLQUFLLE1BQU0sQ0FBQyxFQUFFLElBQUksSUFBSSxDQUFDLE1BQ3RCLG9CQUFDLFNBQWEsZUFBSixDQUFNLENBQ2pCO0FBQUEsT0FDSDtBQUFBLEtBRUo7QUFFSjtBQUdBLFNBQVMsS0FBSztBQUFBLEVBQ1o7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUNGLEdBT0c7QUFDRCxRQUFNLFNBQVMsVUFBVSxDQUFDLE1BQU0sT0FBTyxDQUFDO0FBQ3hDLFFBQU0sSUFBSSxJQUFJLE1BQU07QUFDcEIsU0FDRTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ0MsT0FBTztBQUFBLFFBQ0wsVUFBVTtBQUFBLFFBQ1YsV0FBVztBQUFBLFFBQ1gsWUFBWSxFQUFFO0FBQUEsUUFDZCxRQUFRLGFBQWEsU0FBUyxFQUFFLE9BQU8sTUFBTSxJQUFJLEVBQUUsTUFBTTtBQUFBLFFBQ3pELGNBQWM7QUFBQSxRQUNkLFNBQVM7QUFBQSxRQUNULFNBQVM7QUFBQSxRQUNULGVBQWU7QUFBQSxRQUNmLEtBQUs7QUFBQSxNQUNQO0FBQUEsTUFFQTtBQUFBLDRCQUFDLFVBQUssT0FBTyxFQUFFLE9BQU8sRUFBRSxXQUFXLFVBQVUsR0FBRyxHQUFJLGlCQUFNO0FBQUEsUUFDMUQsb0JBQUMsVUFBSyxPQUFPLEVBQUUsVUFBVSxJQUFJLFlBQVksUUFBUSxZQUFZLEtBQUssb0JBQW9CLGdCQUFnQixPQUFPLE9BQU8sRUFBRSxPQUFPLElBQUksSUFBSSxPQUFVLEdBQUksaUJBQU07QUFBQSxRQUN4SixPQUFPLElBQUksQ0FBQyxNQUNYLG9CQUFDLFVBQWEsT0FBTyxFQUFFLE9BQU8sRUFBRSxXQUFXLFVBQVUsR0FBRyxHQUNyRCxlQURRLENBRVgsQ0FDRDtBQUFBO0FBQUE7QUFBQSxFQUNIO0FBRUo7QUFHQSxJQUFNLFdBQVc7QUFDakIsSUFBTSxNQUFNO0FBR1osU0FBUyxRQUFRLEVBQUUsU0FBUyxHQUE4QjtBQUN4RCxRQUFNLENBQUMsS0FBSyxLQUFLLElBQUksU0FBUztBQUM5QixRQUFNLElBQUksS0FBSyxJQUFJLEdBQUcsU0FBUyxNQUFNO0FBQ3JDLFFBQU0sTUFBTSxLQUFLLElBQUksR0FBRyxLQUFLLE9BQU8sUUFBUSxRQUFRLFdBQVcsSUFBSSxDQUFDO0FBQ3BFLFFBQU0sT0FBTyxRQUFRLEtBQUssS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLEtBQUssSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUk7QUFDdEUsU0FDRSxvQkFBQyxTQUFJLEtBQVUsT0FBTyxFQUFFLFNBQVMsUUFBUSxxQkFBcUIsVUFBVSxJQUFJLHFCQUFxQixLQUFLLElBQUksR0FDdkcsVUFDSDtBQUVKO0FBRUEsSUFBTSxPQUFPLENBQUMsRUFBRSxTQUFTLE1BQStCLG9CQUFDLFNBQUksT0FBTyxFQUFFLFNBQVMsUUFBUSxVQUFVLFFBQVEsWUFBWSxXQUFXLEtBQUssR0FBRyxHQUFJLFVBQVM7QUFHckosSUFBTSxZQUFZLENBQUMsTUFBMkQsTUFBTSxhQUFhLE1BQU0sVUFBVSxJQUFJO0FBRXJILFNBQVMsUUFBUSxFQUFFLEtBQUssT0FBTyxPQUFPLE1BQU0sU0FBUyxHQUF5RztBQUM1SixRQUFNLElBQUksSUFBSSxNQUFNO0FBQ3BCLFFBQU0sSUFBSSxVQUFVLElBQUk7QUFDeEIsU0FDRTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ0MsT0FBTztBQUFBLFFBQ0wsTUFBTTtBQUFBLFFBQ04sV0FBVztBQUFBLFFBQ1gsWUFBWSxFQUFFO0FBQUEsUUFDZCxRQUFRLGFBQWEsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLEVBQUUsTUFBTTtBQUFBLFFBQy9DLGNBQWM7QUFBQSxRQUNkLFNBQVM7QUFBQSxRQUNULFNBQVM7QUFBQSxRQUNULGVBQWU7QUFBQSxRQUNmLEtBQUs7QUFBQSxRQUNMLFVBQVU7QUFBQSxNQUNaO0FBQUEsTUFFQTtBQUFBLDZCQUFDLFNBQUksT0FBTyxFQUFFLFNBQVMsUUFBUSxZQUFZLFVBQVUsS0FBSyxJQUFJLFVBQVUsT0FBTyxHQUM3RTtBQUFBLDhCQUFDLFlBQU8sT0FBTyxFQUFFLE1BQU0sRUFBRSxHQUFJLGlCQUFNO0FBQUEsVUFDbEM7QUFBQSxXQUNIO0FBQUEsUUFDQztBQUFBO0FBQUE7QUFBQSxFQUNIO0FBRUo7QUFXQSxTQUFTLFVBQVUsS0FBZ0IsTUFBYSxHQUFVO0FBQ3hELFFBQU0sT0FBTyxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLEdBQUcsQ0FBQztBQUN6QyxRQUFNLE1BQU0sS0FBSyxLQUFLLFNBQVMsQ0FBQztBQUNoQyxRQUFNLE9BQU8sS0FBSyxTQUFTLElBQUksS0FBSyxLQUFLLFNBQVMsQ0FBQyxJQUFJO0FBQ3ZELE1BQUksUUFBdUI7QUFDM0IsTUFBSSxPQUFPLFFBQVEsWUFBWSxPQUFPLFNBQVMsVUFBVTtBQUN2RCxVQUFNLElBQUksTUFBTTtBQUNoQixVQUFNLE1BQU0sVUFBVSxLQUFLLEVBQUUsR0FBRyxJQUFJLE1BQU0sT0FBTyxLQUFLLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRSxlQUFlO0FBQzNGLFlBQVEsR0FBRyxJQUFJLElBQUksTUFBTSxJQUFJLElBQUksTUFBTSxNQUFHLEdBQUcsR0FBRyxPQUFPLFVBQVUsS0FBSyxLQUFLLFNBQVMsQ0FBQyxFQUFFLElBQUksQ0FBQztBQUFBLEVBQzlGO0FBQ0EsUUFBTSxNQUFNLGFBQWEsTUFBTSxXQUFXLElBQUksRUFBRSxHQUFHLENBQUM7QUFDcEQsUUFBTSxVQUFVLE1BQU0sR0FBRyxJQUFJLFVBQVUsSUFBSSxNQUFNLEdBQUcsR0FBRyxLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUksTUFBTSxJQUFJLEdBQUcsQ0FBQyxRQUFRLFFBQVEsRUFBRSxHQUFHLEVBQUUsSUFBSSxHQUFHLENBQUMsU0FBUztBQUNySSxTQUNFO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFFQztBQUFBLE1BQ0EsT0FBTyxFQUFFO0FBQUEsTUFDVCxPQUFPLElBQUksS0FBSyxFQUFFLEdBQUc7QUFBQSxNQUNyQixPQUFPLENBQUMsT0FBTyxPQUFPLEVBQUUsT0FBTyxDQUFDLE1BQW1CLENBQUMsQ0FBQyxDQUFDO0FBQUEsTUFDdEQsTUFBTSxVQUFVLEVBQUUsS0FBSyxHQUFHO0FBQUEsTUFDMUIsU0FBUyxLQUFLO0FBQUE7QUFBQSxJQU5ULEVBQUU7QUFBQSxFQU9UO0FBRUo7QUFHQSxJQUFNLGFBQWEsb0JBQUksSUFBSSxDQUFDLFdBQVcsZ0JBQWdCLFdBQVcsQ0FBQztBQUVuRSxJQUFNLGVBQWU7QUFDckIsSUFBTSxjQUFjO0FBQ3BCLElBQU0sWUFBWTtBQU9sQixTQUFTLGFBQWEsTUFBcUMsU0FBUyxPQUF5RTtBQUMzSSxRQUFNLE1BQU0sS0FBSyxLQUFLLFNBQVMsQ0FBQztBQUNoQyxRQUFNLE9BQU8sS0FBSyxNQUFNLEdBQUcsRUFBRSxFQUFFLE9BQU8sQ0FBQyxNQUFtQixPQUFPLE1BQU0sUUFBUTtBQUMvRSxNQUFJLE9BQU8sUUFBUSxZQUFZLEtBQUssU0FBUyxhQUFjLFFBQU87QUFDbEUsUUFBTSxNQUFNLEtBQUssT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEdBQUcsQ0FBQyxJQUFJLEtBQUs7QUFDbkQsTUFBSSxRQUFRLEVBQUcsUUFBTztBQUN0QixRQUFNLFVBQVUsTUFBTSxPQUFPLEtBQUssSUFBSSxHQUFHO0FBQ3pDLFFBQU0sTUFBTSxTQUFTLFNBQVMsS0FBSyxJQUFJLE1BQU07QUFDN0MsU0FBTyxFQUFFLEtBQUssUUFBUSxNQUFNLE9BQU8sWUFBWSxVQUFVLE9BQU8sY0FBYyxZQUFZLEtBQUs7QUFDakc7QUFHQSxTQUFTLFlBQVksRUFBRSxLQUFLLE1BQU0sT0FBTyxHQUFxRDtBQUM1RixTQUNFLGdDQUNHLGlCQUNFLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxRQUFRLEtBQUssSUFBSSxDQUFDLE9BQU8sRUFBRSxPQUFPLFVBQVUsRUFBRSxJQUFJLEdBQUcsS0FBSyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFDOUYsT0FBTyxDQUFDLEVBQUUsT0FBTyxNQUFNLE9BQU8sS0FBSyxDQUFDLE9BQU8sR0FBRyxRQUFRLE1BQVMsQ0FBQyxFQUNoRSxJQUFJLENBQUMsRUFBRSxHQUFHLE9BQU8sTUFDaEI7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUVDO0FBQUEsTUFDQSxPQUFPLEdBQUcsRUFBRSxLQUFLO0FBQUEsTUFDakIsTUFDRTtBQUFBLFFBQ0UsT0FBTyxJQUFJLENBQUMsT0FBTyxHQUFHLEdBQUc7QUFBQSxRQUN6QixXQUFXLElBQUksRUFBRSxHQUFHO0FBQUEsTUFDdEIsR0FBRztBQUFBLE1BR0w7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUNDO0FBQUEsVUFDQSxRQUFRLE9BQU8sSUFBSSxDQUFDLE9BQU8sR0FBRyxLQUFLO0FBQUEsVUFDbkMsUUFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sT0FBTyxJQUFJLE1BQU0sUUFBUSxRQUFRLFFBQVEsT0FBTyxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sSUFBSSxFQUFFLENBQUM7QUFBQSxVQUN2RyxRQUFRLFFBQVEsRUFBRSxHQUFHO0FBQUE7QUFBQSxNQUN2QjtBQUFBO0FBQUEsSUFmSyxFQUFFO0FBQUEsRUFnQlQsQ0FDRCxHQUNMO0FBRUo7QUFFQSxTQUFTLFlBQVksRUFBRSxLQUFLLEtBQUssR0FBb0M7QUFDbkUsTUFBSSxLQUFLLFVBQVUsRUFBRyxRQUFPO0FBQzdCLFNBQU8scUJBQUMsVUFBSyxPQUFPLEVBQUUsT0FBTyxJQUFJLE1BQU0sUUFBUSxXQUFXLFVBQVUsR0FBRyxHQUFHO0FBQUE7QUFBQSxJQUE4QyxLQUFLO0FBQUEsSUFBTztBQUFBLEtBQWE7QUFDbko7QUFFQSxTQUFTLFNBQVMsS0FBZ0IsTUFBc0I7QUFDdEQsUUFBTSxJQUFJLElBQUksTUFBTTtBQUNwQixTQUFPLE9BQU8sUUFBUSxNQUFNLFNBQVMsQ0FBQyxDQUFDLEVBQ3BDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxNQUFNLE9BQU8sTUFBTSxRQUFRLEVBQ3ZDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLE1BQU8sSUFBZ0IsQ0FBWSxFQUNwRCxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTztBQUFBLElBQ2hCLE9BQU87QUFBQSxJQUNQLFVBQVUsQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLEdBQWEsT0FBTyxFQUFFLE9BQU8sQ0FBQztBQUFBLElBQ2hFLFdBQVcsTUFBTSxPQUFPLENBQVc7QUFBQSxJQUNuQyxLQUFLLENBQUMsR0FBRyxNQUFNLE9BQU8sQ0FBVyxDQUFDLEtBQUssS0FBSyxTQUFXLElBQWUsS0FBSyxRQUFTLEtBQUssUUFBUSxDQUFDLElBQUksR0FBRyxhQUFhO0FBQUEsRUFDeEgsRUFBRTtBQUNOO0FBR0EsSUFBTSxxQkFBNkMsRUFBRSxnQkFBZ0IsdUJBQXVCO0FBRzVGLFNBQVMsVUFBVSxLQUFXLE9BQTREO0FBQ3hGLFFBQU0sVUFBVSxLQUFLLFlBQVk7QUFDakMsTUFBSSxZQUFZLE9BQVcsUUFBTztBQUNsQyxNQUFJLFlBQVksUUFBUSxZQUFZLE9BQU8sS0FBSyxZQUFZLElBQUksVUFBVSxFQUFHLFFBQU87QUFDcEYsUUFBTSxPQUFPLE9BQU8sT0FBTyxPQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQztBQUMvRCxTQUFPLEtBQUssS0FBSyxDQUFDLE1BQU0sT0FBTyxNQUFNLFFBQVEsSUFBSSxPQUFRLEtBQWtCLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxHQUFHLENBQUM7QUFDdEc7QUFFQSxTQUFTLGlCQUFpQixFQUFFLEtBQUssTUFBTSxTQUFTLE1BQU0sR0FBb0U7QUFDeEgsUUFBTSxJQUFJLElBQUksTUFBTTtBQUNwQixRQUFNLFVBQVUsS0FBSyxJQUFJLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxNQUFNLEtBQUssT0FBTyxFQUFFLEdBQUcsRUFBRSxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsT0FBTyxFQUFFLEVBQUUsRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUc7QUFDM0gsTUFBSSxRQUFRLFdBQVcsRUFBRyxRQUFPO0FBQ2pDLFFBQU0sU0FBbUI7QUFBQSxJQUN2QixFQUFFLE1BQU0sZUFBZSxPQUFPLEVBQUUsUUFBUSxRQUFRLFFBQVEsSUFBSSxDQUFDLE1BQU0sVUFBVSxFQUFFLEtBQUssYUFBYSxLQUFLLElBQUksRUFBRTtBQUFBLElBQzVHLEVBQUUsTUFBTSxVQUFVLE9BQU8sRUFBRSxPQUFPLE9BQU8sUUFBUSxRQUFRLElBQUksQ0FBQyxNQUFNLFVBQVUsRUFBRSxLQUFLLFFBQVEsS0FBSyxJQUFJLEVBQUU7QUFBQSxFQUMxRztBQUNBLFNBQ0Usb0JBQUMsV0FBUSxLQUFVLE9BQWMsTUFBTSxhQUFhLE9BQU8sQ0FBQyxFQUFFLFFBQVEsSUFBSSxHQUFHLE1BQU0sT0FBTyxvQkFBQyxVQUFPLEtBQVUsT0FBTyxRQUFRLEdBQ3pILDhCQUFDLGFBQVUsS0FBVSxRQUFRLFFBQVEsSUFBSSxDQUFDLE1BQU0sVUFBVSxFQUFFLElBQUksQ0FBQyxHQUFHLFFBQWdCLFFBQVEsUUFBUSxFQUFFLEdBQUcsR0FDM0c7QUFFSjtBQUVBLElBQU0sa0JBQTJCO0FBQUEsRUFDL0IsRUFBRSxPQUFPLGtCQUFrQixLQUFLLFFBQVEsS0FBSyxDQUFDLE1BQU0sT0FBTyxHQUFHLGVBQWUsRUFBRTtBQUFBLEVBQy9FLEVBQUUsT0FBTyxrQkFBa0IsS0FBSyxJQUFJLEtBQUssQ0FBQyxNQUFNLFFBQVEsR0FBRyw0QkFBNEIsRUFBRTtBQUFBLEVBQ3pGLEVBQUUsT0FBTyx1QkFBdUIsS0FBSyxnQkFBZ0IsS0FBSyxDQUFDLE1BQU0sUUFBUSxHQUFHLGdDQUFnQyxFQUFFO0FBQUEsRUFDOUcsRUFBRSxPQUFPLG9CQUFvQixLQUFLLGFBQWEsS0FBSyxDQUFDLE1BQU0sUUFBUSxHQUFHLDZCQUE2QixFQUFFO0FBQUEsRUFDckcsRUFBRSxPQUFPLGlCQUFpQixLQUFLLFdBQVcsS0FBSyxDQUFDLE1BQU0sUUFBUSxHQUFHLHVCQUF1QixFQUFFO0FBQUEsRUFDMUYsRUFBRSxPQUFPLG9CQUFvQixLQUFLLElBQUksS0FBSyxDQUFDLE1BQU0sUUFBUSxHQUFHLGtCQUFrQixFQUFFO0FBQ25GO0FBRUEsU0FBUyxTQUFTLEVBQUUsS0FBSyxLQUFLLEtBQUssR0FBK0M7QUFDaEYsUUFBTSxFQUFFLFVBQVUsSUFBSSxJQUFJO0FBQzFCLFFBQU0sSUFBSSxJQUFJLE1BQU07QUFDcEIsUUFBTSxPQUFPLE9BQU8sR0FBRztBQUN2QixRQUFNLE9BQU8sSUFBSTtBQUNqQixTQUNFLHFCQUFDLFNBQUksT0FBTyxFQUFFLFNBQVMsUUFBUSxlQUFlLFVBQVUsS0FBSyxHQUFHLEdBQzlEO0FBQUEsd0JBQUMsV0FBUywwQkFBZ0IsT0FBTyxDQUFDLE1BQU0sRUFBRSxJQUFJLEdBQUcsTUFBTSxNQUFTLEVBQUUsSUFBSSxDQUFDLE1BQU0sVUFBVSxLQUFLLE1BQU0sQ0FBQyxDQUFDLEdBQUU7QUFBQSxJQUN0RyxvQkFBQyxlQUFZLEtBQVUsTUFBWTtBQUFBLElBQ25DLHFCQUFDLFFBQ0M7QUFBQSwwQkFBQyxlQUFZLEtBQVUsTUFBWSxRQUFRLGdCQUFnQixNQUFNLEdBQUcsQ0FBQyxHQUFHO0FBQUEsTUFDdkUsT0FBTyxRQUFRLGtCQUFrQixFQUFFLElBQUksQ0FBQyxDQUFDLE1BQU0sS0FBSyxNQUNuRCxvQkFBQyxvQkFBNEIsS0FBVSxNQUFZLFNBQVMsTUFBTSxTQUEzQyxJQUF5RCxDQUNqRjtBQUFBLE1BQ0Qsb0JBQUMsV0FBUSxLQUFVLE9BQU0sUUFBTyxNQUFNLE1BQU0sS0FBSyxJQUFJLFNBQVMsQ0FBQyxHQUM3RCwrQkFBQyxTQUFJLE9BQU8sRUFBRSxTQUFTLFFBQVEscUJBQXFCLGdEQUFnRCxLQUFLLFlBQVksWUFBWSxTQUFTLEdBQ3ZJO0FBQUEsU0FBQyxJQUFJLE9BQU8sWUFBWSxVQUFVLGNBQWMsRUFBRSxJQUFJLENBQUMsTUFDdEQsb0JBQUMsVUFBc0IsT0FBTyxFQUFFLE9BQU8sRUFBRSxXQUFXLFVBQVUsR0FBRyxHQUM5RCxlQURRLEtBQUssS0FFaEIsQ0FDRDtBQUFBLFFBQ0EsS0FBSyxJQUFJLENBQUMsTUFDVCxxQkFBQyxTQUFpQixPQUFPLEVBQUUsU0FBUyxXQUFXLEdBQzdDO0FBQUEsOEJBQUMsYUFBVSxPQUFPLFVBQVUsQ0FBQyxHQUFHO0FBQUEsVUFDaEMsb0JBQUMsVUFBTSxZQUFFLE1BQUs7QUFBQSxVQUNkLG9CQUFDLFVBQU0sZUFBSyxPQUFPLEdBQUcsNEJBQTRCLENBQUMsR0FBRTtBQUFBLFVBQ3JELG9CQUFDLFVBQU0sZUFBSyxPQUFPLEdBQUcsZ0NBQWdDLENBQUMsR0FBRTtBQUFBLFVBQ3pELG9CQUFDLFVBQU0sZUFBSyxPQUFPLEdBQUcsaUJBQWlCLEdBQUcsUUFBUSxHQUFFO0FBQUEsYUFMNUMsRUFBRSxJQU1aLENBQ0Q7QUFBQSxTQUNILEdBQ0Y7QUFBQSxNQUNBLG9CQUFDLFdBQVEsS0FBVSxPQUFPLHNCQUFzQixRQUFRLENBQUMsWUFBWSxJQUFJLElBQUksS0FBSyxVQUFVLEtBQUssV0FBVyxDQUFDLE9BQU8sVUFBVSxLQUFLLFNBQVMsQ0FBQyxNQUFNLEVBQUUsSUFDbEosV0FBQyxRQUFRLFlBQVksSUFBSSxJQUFJLG9CQUFDLFVBQU0sY0FBSSxJQUFJLEdBQUUsSUFBVSxvQkFBQyxXQUFRLEtBQVUsTUFBTSxTQUFTLEtBQUssSUFBSSxHQUFHLEdBQ3pHO0FBQUEsT0FDRjtBQUFBLEtBQ0Y7QUFFSjtBQUVBLFNBQVMsV0FBVyxLQUFnQixTQUFvRTtBQUN0RyxRQUFNLElBQUksSUFBSSxNQUFNO0FBQ3BCLFFBQU0sT0FBaUIsQ0FBQztBQUN4QixRQUFNLFVBQW9CLENBQUM7QUFDM0IsTUFBSSxPQUFPO0FBQ1gsYUFBVyxDQUFDLElBQUksQ0FBQyxLQUFLLE9BQU8sUUFBUSxXQUFXLENBQUMsQ0FBQyxHQUF1QjtBQUN2RSxVQUFNLE1BQU0sT0FBTyxHQUFHLGFBQWE7QUFDbkMsUUFBSSxPQUFPLFFBQVEsVUFBVTtBQUMzQixjQUFRLEtBQUssRUFBRTtBQUNmO0FBQUEsSUFDRjtBQUNBLFFBQUksUUFBUSxHQUFHO0FBQ2I7QUFDQTtBQUFBLElBQ0Y7QUFDQSxVQUFNLE1BQU0sT0FBTyxHQUFHLFFBQVEsS0FBSztBQUNuQyxVQUFNLE1BQU0sT0FBTyxHQUFHLFdBQVcsS0FBSztBQUN0QyxTQUFLLEtBQUs7QUFBQSxNQUNSLE9BQU87QUFBQSxNQUNQLFVBQVU7QUFBQSxRQUNSLEVBQUUsTUFBTSxhQUFhLE9BQU8sS0FBSyxJQUFJLEdBQUcsTUFBTSxHQUFHLEdBQUcsT0FBTyxFQUFFLE9BQU87QUFBQSxRQUNwRSxFQUFFLE1BQU0sVUFBVSxPQUFPLEtBQUssT0FBTyxFQUFFLE9BQU8sTUFBTTtBQUFBLE1BQ3REO0FBQUEsTUFDQSxXQUFXLE1BQU0sR0FBRyxJQUFJLGVBQWUsQ0FBQyxNQUFPLE1BQU0sTUFBTyxLQUFLLFFBQVEsQ0FBQyxDQUFDLFdBQVcsSUFBSSxlQUFlO0FBQUEsTUFDekcsS0FBSyxDQUFDLEdBQUcsSUFBSSxlQUFlLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxlQUFlLENBQUMsV0FBVyxHQUFHLElBQUksZUFBZSxDQUFDLFlBQVk7QUFBQSxJQUNwSCxDQUFDO0FBQUEsRUFDSDtBQUNBLE9BQUssS0FBSyxDQUFDLEdBQUcsTUFBTSxFQUFFLFNBQVMsQ0FBQyxFQUFFLFFBQVEsRUFBRSxTQUFTLENBQUMsRUFBRSxTQUFTLEVBQUUsU0FBUyxDQUFDLEVBQUUsUUFBUSxFQUFFLFNBQVMsQ0FBQyxFQUFFLE1BQU07QUFDM0csU0FBTyxFQUFFLE1BQU0sTUFBTSxRQUFRO0FBQy9CO0FBRUEsU0FBUyxRQUFRLEtBQWdCLE1BQXNCO0FBQ3JELFFBQU0sSUFBSSxJQUFJLE1BQU07QUFDcEIsU0FBUSxPQUFPLFFBQVEsUUFBUSxDQUFDLENBQUMsRUFDOUIsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDLE1BQU0sT0FBTyxPQUFPLEdBQUcsVUFBVSxNQUFNLFFBQVEsRUFDM0QsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU07QUFDbEIsVUFBTSxNQUFNLE9BQU8sR0FBRyxVQUFVO0FBQ2hDLFVBQU0sS0FBSyxPQUFPLEdBQUcsV0FBVyxLQUFLO0FBQ3JDLFVBQU0sS0FBSyxPQUFPLEdBQUcsV0FBVyxLQUFLO0FBQ3JDLFdBQU87QUFBQSxNQUNMLE9BQU87QUFBQSxNQUNQLFVBQVU7QUFBQSxRQUNSLEVBQUUsTUFBTSxNQUFNLE9BQU8sS0FBSyxJQUFJLEdBQUcsTUFBTSxLQUFLLEVBQUUsR0FBRyxPQUFPLEVBQUUsT0FBTztBQUFBLFFBQ2pFLEVBQUUsTUFBTSxPQUFPLE9BQU8sSUFBSSxPQUFPLEVBQUUsT0FBTyxRQUFRO0FBQUEsUUFDbEQsRUFBRSxNQUFNLE9BQU8sT0FBTyxJQUFJLE9BQU8sRUFBRSxPQUFPLE1BQU07QUFBQSxNQUNsRDtBQUFBLE1BQ0EsV0FBVyxJQUFJLGVBQWU7QUFBQSxNQUM5QixLQUFLLENBQUMsR0FBRyxJQUFJLGVBQWUsQ0FBQyxhQUFhLEdBQUcsR0FBRyxlQUFlLENBQUMsU0FBUyxHQUFHLGVBQWUsQ0FBQyxRQUFRLGdCQUFnQixJQUFJLEVBQUUsY0FBYyxXQUFXLENBQUMsRUFBRTtBQUFBLElBQ3hKO0FBQUEsRUFDRixDQUFDLEVBQ0EsS0FBSyxDQUFDLEdBQUcsTUFBTSxFQUFFLFNBQVMsT0FBTyxDQUFDLEdBQUcsTUFBTSxJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUksRUFBRSxTQUFTLE9BQU8sQ0FBQyxHQUFHLE1BQU0sSUFBSSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQzdHO0FBRUEsU0FBUyxLQUFLLEVBQUUsS0FBSyxPQUFPLE9BQU8sR0FBRyxHQUFtRDtBQUN2RixRQUFNLElBQUksSUFBSSxNQUFNO0FBQ3BCLE1BQUksVUFBVSxRQUFRLE9BQU8sVUFBVSxZQUFZLFlBQVksS0FBSyxHQUFHO0FBQ3JFLFdBQU8sb0JBQUMsVUFBTSxjQUFJLE9BQU8sSUFBSSxHQUFFO0FBQUEsRUFDakM7QUFDQSxRQUFNLFVBQVUsT0FBTyxRQUFRLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLE9BQU8sTUFBTSxhQUFhLEVBQUUsU0FBUyxNQUFNLEVBQUUsU0FBUyxJQUFJLEdBQUc7QUFDdkgsTUFBSSxRQUFRLFdBQVcsRUFBRyxRQUFPLG9CQUFDLFVBQUssT0FBTyxFQUFFLE9BQU8sRUFBRSxVQUFVLEdBQUcsa0JBQUk7QUFDMUUsU0FDRSxvQkFBQyxTQUFJLE9BQU8sRUFBRSxTQUFTLFFBQVEscUJBQXFCLG1CQUFtQixLQUFLLFdBQVcsR0FDcEYsa0JBQVEsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU07QUFDdkIsVUFBTSxTQUFTLE1BQU0sUUFBUSxPQUFPLE1BQU0sWUFBWSxDQUFDLFlBQVksQ0FBQztBQUNwRSxXQUNFLHFCQUFDLFNBQVksT0FBTyxFQUFFLFNBQVMsV0FBVyxHQUN4QztBQUFBLDBCQUFDLFVBQUssT0FBTyxFQUFFLE9BQU8sRUFBRSxVQUFVLEdBQUksb0JBQVUsQ0FBQyxHQUFFO0FBQUEsTUFDbkQsb0JBQUMsVUFBSyxPQUFPLEVBQUUsT0FBTyxVQUFVLEdBQUcsQ0FBQyxJQUFJLEVBQUUsT0FBTyxVQUFVLEdBQUcsQ0FBQyxDQUFnQixJQUFJLE9BQVUsR0FDMUYsbUJBQVMsTUFBTSxRQUFRLENBQUMsSUFBSSxvQkFBQyxVQUFNLFlBQUUsU0FBUyxFQUFFLEtBQUssSUFBSSxJQUFJLFFBQU8sSUFBVSxvQkFBQyxRQUFLLEtBQVUsT0FBTyxHQUFHLE1BQU0sR0FBRyxJQUFLLElBQUksR0FBRyxDQUFDLEdBQ2pJO0FBQUEsU0FKUSxDQUtWO0FBQUEsRUFFSixDQUFDLEdBQ0g7QUFFSjtBQUVBLElBQU0sWUFBWSxDQUFDLE1BQWMsRUFBRSxRQUFRLFlBQVksS0FBSyxFQUFFLFFBQVEsTUFBTSxDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUM7QUFFbEcsSUFBTSxhQUFzQjtBQUFBLEVBQzFCLEVBQUUsT0FBTyxrQkFBa0IsS0FBSyxJQUFJLEtBQUssQ0FBQyxNQUFNLE9BQU8sR0FBRyw0QkFBNEIsRUFBRTtBQUFBLEVBQ3hGLEVBQUUsT0FBTyx1QkFBdUIsS0FBSyxnQkFBZ0IsS0FBSyxDQUFDLE1BQU0sT0FBTyxHQUFHLGdDQUFnQyxFQUFFO0FBQUEsRUFDN0csRUFBRSxPQUFPLG9CQUFvQixLQUFLLElBQUksS0FBSyxDQUFDLE1BQU0sT0FBTyxHQUFHLGtCQUFrQixFQUFFO0FBQUEsRUFDaEYsRUFBRSxPQUFPLE9BQU8sS0FBSyxPQUFPLEtBQUssQ0FBQyxNQUFNLE9BQU8sR0FBRyxXQUFXLEVBQUU7QUFBQSxFQUMvRCxFQUFFLE9BQU8sZ0JBQWdCLEtBQUssVUFBVSxLQUFLLENBQUMsTUFBTSxPQUFPLEdBQUcsaUJBQWlCLEVBQUU7QUFDbkY7QUFFQSxTQUFTLFFBQVEsRUFBRSxLQUFLLEtBQUssS0FBSyxHQUErQztBQUMvRSxRQUFNLElBQUksSUFBSSxNQUFNO0FBQ3BCLFFBQU0sVUFBVSxLQUFLLElBQUksQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sS0FBSyxPQUFPLEVBQUUsR0FBRyxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxJQUFJLElBQUksRUFBRSxFQUFFLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBRSxHQUFHO0FBQzVILFFBQU0sTUFBTSxJQUFJO0FBQ2hCLFFBQU0sTUFBTSxJQUFJO0FBQ2hCLFFBQU0sVUFBa0IsT0FBTyxNQUFNLFFBQVEsSUFBSSxJQUFJLElBQUksSUFBSSxPQUFPLENBQUM7QUFDckUsUUFBTSxVQUFVLFFBQVEsU0FBUyxPQUFPLEtBQUssUUFBUSxDQUFDLENBQUMsRUFBRSxPQUFPLENBQUMsTUFBTSxNQUFNLFVBQVUsT0FBTyxRQUFRLENBQUMsRUFBRSxDQUFDLE1BQU0sUUFBUSxJQUFJLENBQUM7QUFDN0gsUUFBTSxVQUFVLE9BQU8sQ0FBQyxZQUFZLEdBQUcsS0FBSyxDQUFDLFlBQVksSUFBSSxPQUFPLElBQUksV0FBVyxLQUFLLElBQUksT0FBTyxJQUFJO0FBQ3ZHLFFBQU0sT0FBTyxPQUFPLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQyxZQUFZLElBQUksSUFBSSxJQUFJLFFBQVEsS0FBSyxJQUFJLElBQUksSUFBSTtBQUMzRixRQUFNLFVBQVUsT0FBTyxRQUFRLEdBQUcsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sTUFBTSxVQUFVLE1BQU0sWUFBWTtBQUV0RixTQUNFLHFCQUFDLFNBQUksT0FBTyxFQUFFLFNBQVMsUUFBUSxlQUFlLFVBQVUsS0FBSyxHQUFHLEdBQzlEO0FBQUEsd0JBQUMsV0FBUyxxQkFBVyxPQUFPLENBQUMsTUFBTSxFQUFFLElBQUksR0FBRyxNQUFNLE1BQVMsRUFBRSxJQUFJLENBQUMsTUFBTSxVQUFVLEtBQUssU0FBUyxDQUFDLENBQUMsR0FBRTtBQUFBLElBQ3BHLG9CQUFDLGVBQVksS0FBVSxNQUFNLFNBQVM7QUFBQSxJQUN0QyxxQkFBQyxRQUNDO0FBQUEsMEJBQUMsZUFBWSxLQUFVLE1BQU0sU0FBUyxRQUFRLFlBQVk7QUFBQSxNQUN6RCxPQUFPLFlBQVksR0FBRyxLQUNyQixvQkFBQyxXQUFRLEtBQVUsT0FBTSxvQkFBbUIsTUFBSyxXQUMvQyw4QkFBQyxVQUFNLGNBQUksR0FBRyxHQUFFLEdBQ2xCO0FBQUEsTUFFRCxRQUFRLEtBQUssU0FBUyxLQUNyQjtBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQ0M7QUFBQSxVQUNBLE9BQU07QUFBQSxVQUNOLE1BQU0sS0FBSyxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsS0FBSyxDQUFDLE1BQU0sRUFBRSxTQUFTLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQyxJQUFJLFlBQVk7QUFBQSxVQUM5RixPQUNFO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FDQztBQUFBLGNBQ0EsT0FBTztBQUFBLGdCQUNMLEVBQUUsTUFBTSxNQUFNLE9BQU8sRUFBRSxPQUFPO0FBQUEsZ0JBQzlCLEVBQUUsTUFBTSxPQUFPLE9BQU8sRUFBRSxPQUFPLFFBQVE7QUFBQSxnQkFDdkMsRUFBRSxNQUFNLE9BQU8sT0FBTyxFQUFFLE9BQU8sTUFBTTtBQUFBLGNBQ3ZDO0FBQUE7QUFBQSxVQUNGO0FBQUEsVUFHRiw4QkFBQyxXQUFRLEtBQVUsTUFBTSxNQUFNO0FBQUE7QUFBQSxNQUNqQztBQUFBLE1BRUQsV0FBVyxRQUFRLEtBQUssU0FBUyxLQUNoQztBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQ0M7QUFBQSxVQUNBLE9BQU07QUFBQSxVQUNOLE1BQU0sUUFBUSxLQUFLLEtBQUssQ0FBQyxNQUFNLEVBQUUsU0FBUyxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsWUFBWSxFQUFFLFFBQVEsQ0FBQyxDQUFDLElBQUksVUFBVTtBQUFBLFVBQ3ZHLE9BQ0U7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUNDO0FBQUEsY0FDQSxPQUFPO0FBQUEsZ0JBQ0wsRUFBRSxNQUFNLGFBQWEsT0FBTyxFQUFFLE9BQU87QUFBQSxnQkFDckMsRUFBRSxNQUFNLFVBQVUsT0FBTyxFQUFFLE9BQU8sTUFBTTtBQUFBLGNBQzFDO0FBQUE7QUFBQSxVQUNGO0FBQUEsVUFHRjtBQUFBLGdDQUFDLFdBQVEsS0FBVSxNQUFNLFFBQVEsTUFBTTtBQUFBLGFBQ3JDLFFBQVEsT0FBTyxLQUFLLFFBQVEsUUFBUSxTQUFTLE1BQzdDLG9CQUFDLFVBQUssT0FBTyxFQUFFLE9BQU8sRUFBRSxXQUFXLFVBQVUsR0FBRyxHQUM3QyxXQUFDLFFBQVEsT0FBTyxHQUFHLFFBQVEsSUFBSSxpQkFBaUIsUUFBUSxPQUFPLElBQUksTUFBTSxFQUFFLFlBQVksSUFBSSxRQUFRLFFBQVEsU0FBUyxZQUFZLFFBQVEsUUFBUSxLQUFLLElBQUksQ0FBQyxLQUFLLEVBQUUsRUFDL0osT0FBTyxPQUFPLEVBQ2QsS0FBSyxJQUFJLEdBQ2Q7QUFBQTtBQUFBO0FBQUEsTUFFSjtBQUFBLE1BRUQsUUFBUSxJQUFJLENBQUMsTUFDWixvQkFBQyxXQUFnQixLQUFVLE9BQU8sU0FBUyxVQUFVLENBQUMsQ0FBQyxJQUNyRDtBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQ0M7QUFBQSxVQUNBLFFBQVEsUUFBUSxJQUFJLENBQUMsTUFBTSxVQUFVLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQztBQUFBLFVBQ3BELFFBQVEsQ0FBQyxFQUFFLE1BQU0sVUFBVSxDQUFDLEdBQUcsT0FBTyxFQUFFLFFBQVEsUUFBUSxRQUFRLElBQUksQ0FBQyxNQUFPLE9BQU8sRUFBRSxDQUFDLE1BQU0sV0FBVyxFQUFFLENBQUMsSUFBSSxJQUFLLEVBQUUsQ0FBQztBQUFBLFVBQ3RILFFBQVEsUUFBUSxDQUFDO0FBQUE7QUFBQSxNQUNuQixLQU5ZLENBT2QsQ0FDRDtBQUFBLE1BQ0EsS0FBSyxjQUFjLENBQUMsWUFBWSxJQUFJLFVBQVUsS0FDN0Msb0JBQUMsV0FBUSxLQUFVLE9BQU0seUJBQ3ZCO0FBQUEsUUFBQztBQUFBO0FBQUEsVUFDQztBQUFBLFVBQ0EsTUFBTyxPQUFPLFFBQVEsSUFBSSxVQUFVLEVBQ2pDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxNQUFNLE9BQU8sTUFBTSxRQUFRLEVBQ3ZDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQzVCLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPO0FBQUEsWUFDaEIsT0FBTyxVQUFVLENBQUM7QUFBQSxZQUNsQixVQUFVLENBQUMsRUFBRSxNQUFNLFNBQVMsT0FBTyxHQUFHLE9BQU8sRUFBRSxPQUFPLENBQUM7QUFBQSxZQUN2RCxXQUFXLEVBQUUsZUFBZTtBQUFBLFlBQzVCLEtBQUssQ0FBQyxHQUFHLEVBQUUsZUFBZSxDQUFDLFFBQVE7QUFBQSxVQUNyQyxFQUFFO0FBQUE7QUFBQSxNQUNOLEdBQ0Y7QUFBQSxNQUVELFFBQVEsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQ2pCLG9CQUFDLFdBQWdCLEtBQVUsT0FBTyxVQUFVLENBQUMsR0FBRyxNQUFNLFVBQVUsQ0FBQyxHQUMvRDtBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQ0M7QUFBQSxVQUNBLE9BQU8sTUFBTSxjQUFjLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxPQUFPLFlBQVksT0FBTyxRQUFRLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQyxFQUFFLE1BQU0sT0FBTyxVQUFVLE9BQU8sWUFBWSxDQUFDLElBQUk7QUFBQSxVQUNqSixNQUFNO0FBQUE7QUFBQSxNQUNSLEtBTFksQ0FNZCxDQUNEO0FBQUEsT0FDSDtBQUFBLEtBQ0Y7QUFFSjtBQUVPLFNBQVMsVUFBVSxFQUFFLElBQUksR0FBd0M7QUFDdEUsUUFBTSxFQUFFLFlBQVksU0FBUyxNQUFNLE9BQU8sSUFBSSxJQUFJO0FBQ2xELFFBQU0sVUFBVSxJQUFJLE1BQU07QUFDMUIsUUFBTSxDQUFDLEVBQUUsS0FBSyxJQUFJLFNBQVMsQ0FBQztBQUM1QixRQUFNLENBQUMsS0FBSyxNQUFNLElBQUksU0FBUyxVQUFVO0FBQ3pDLFFBQU0sQ0FBQyxFQUFFLFFBQVEsSUFBSSxTQUFTLENBQUM7QUFFL0IsWUFBVSxNQUFNO0FBQ2QsVUFBTSxJQUFJLE1BQU0sTUFBTSxDQUFDLE1BQU0sSUFBSSxDQUFDO0FBQ2xDLGNBQVUsSUFBSSxDQUFDO0FBQ2YsVUFBTSxRQUFRLElBQUksTUFBTSxVQUFVLE1BQU0sU0FBUyxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUM7QUFDOUQsUUFBSSxDQUFDLE1BQU0sTUFBTTtBQUNmLFdBQUssSUFBSSxRQUFRLElBQVUsU0FBUyxFQUFFLEtBQUssQ0FBQyxXQUFXO0FBQ3JELFlBQUksVUFBVSxDQUFDLE1BQU0sS0FBTSxVQUFTLEVBQUUsTUFBTSxPQUFPLENBQUM7QUFBQSxNQUN0RCxDQUFDO0FBQUEsSUFDSDtBQUNBLFdBQU8sTUFBTTtBQUNYLGdCQUFVLE9BQU8sQ0FBQztBQUNsQixZQUFNO0FBQUEsSUFDUjtBQUFBLEVBQ0YsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUVSLFFBQU0sRUFBRSxNQUFNLE9BQU8sU0FBUyxJQUFJO0FBQ2xDLFFBQU0sT0FBTyxPQUFPLElBQUk7QUFDeEIsUUFBTSxPQUFPLFFBQVE7QUFDckIsUUFBTSxNQUFNLE9BQU8sU0FBUyxLQUFLLFdBQVcsSUFBSTtBQUNoRCxRQUFNLFFBQVEsU0FBUyxRQUFRLFFBQVEsTUFBTTtBQUM3QyxRQUFNLFVBQVUsS0FBSyxPQUFPLENBQUMsTUFBTSxFQUFFLEVBQUUsUUFBUSxtQkFBbUI7QUFDbEUsUUFBTSxVQUFVLFFBQVEsYUFBYSxPQUFPLFFBQVEsS0FBSyxDQUFDLE1BQU0sRUFBRSxTQUFTLEdBQUc7QUFFOUUsU0FDRSxxQkFBQyxTQUFJLE9BQU8sRUFBRSxNQUFNLEdBQUcsV0FBVyxHQUFHLFNBQVMsUUFBUSxlQUFlLFVBQVUsS0FBSyxJQUFJLE9BQU8sUUFBUSxLQUFLLEdBQzFHO0FBQUEseUJBQUMsU0FBSSxPQUFPLEVBQUUsU0FBUyxRQUFRLFlBQVksVUFBVSxLQUFLLElBQUksY0FBYyxHQUFHLEdBQzdFO0FBQUEsMEJBQUMsUUFBRyxPQUFPLEVBQUUsUUFBUSxFQUFFLEdBQUksZ0JBQUs7QUFBQSxNQUNoQyxvQkFBQyxVQUFLLE9BQU8sRUFBRSxPQUFPLFFBQVEsV0FBVyxNQUFNLEVBQUUsR0FDOUMsaUJBQ0csYUFBYSxLQUFLLGNBQWMsSUFBSSxLQUFLLEtBQUssV0FBVyxFQUFFLGVBQWUsSUFBSSxTQUFTLFNBQU0sS0FBSyxNQUFNLE9BQU8sS0FBSyxXQUFXLElBQUksS0FBSyxHQUFHLGdCQUMzSSxlQUNOO0FBQUEsTUFDQyxXQUFXLG9CQUFDLFdBQVEsTUFBTSxJQUFJLElBQUssb0JBQUMsY0FBVyxPQUFNLFdBQVUsTUFBTSxpQkFBYSxTQUFTLE1BQU0sS0FBSyxRQUFRLEtBQUssUUFBVyxJQUFJLEdBQUc7QUFBQSxPQUN4STtBQUFBLElBQ0MsU0FBUyxvQkFBQyxVQUFPLFNBQVMsMkJBQTJCLEtBQUssSUFBSSxNQUFLLFNBQVE7QUFBQSxJQUMzRSxTQUFTLG9CQUFDLFVBQU8sU0FBUywwQkFBMEIsV0FBVywrQ0FBK0MsTUFBSyxXQUFVO0FBQUEsSUFDN0gsUUFDQyxpQ0FDRTtBQUFBO0FBQUEsUUFBQztBQUFBO0FBQUEsVUFDQyxNQUFNLENBQUMsRUFBRSxPQUFPLFlBQVksT0FBTyxXQUFXLEdBQUcsR0FBRyxRQUFRLElBQUksQ0FBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQWdCLE9BQU8sRUFBRSxLQUFlLEVBQUUsQ0FBQztBQUFBLFVBQzlILE9BQU8sVUFBVSxNQUFNO0FBQUEsVUFDdkIsVUFBVTtBQUFBO0FBQUEsTUFDWjtBQUFBLE1BQ0Esb0JBQUMsU0FBSSxPQUFPLEVBQUUsR0FBRyxlQUFlLE9BQU8sR0FBRyxNQUFNLEdBQUcsV0FBVyxHQUFHLFVBQVUsUUFBUSxjQUFjLElBQUksR0FDbEcsb0JBQVUsb0JBQUMsV0FBUSxLQUFVLEtBQUssU0FBUyxNQUFZLElBQUssb0JBQUMsWUFBUyxLQUFVLEtBQUssTUFBTSxNQUFZLEdBQzFHO0FBQUEsT0FDRjtBQUFBLEtBRUo7QUFFSjsiLAogICJuYW1lcyI6IFsiY2VsbCJdCn0K

/// <reference path="../.stewrd/plugin-api.d.ts" />
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { PluginContext, PluginApi, StatusColor, Palette } from "stewrd-plugin-api";

const NAME = "Metrics";
const STALE_HOURS = 26;
const CACHE_KEY = "lastMetrics";
const HISTORY_DIR = "history";
const MAX_DAYS = 90;
const DEFAULT_BUCKET = "boxopher-metrics-429357724212";

type Settings = {
  bucket?: string;
  refreshMinutes?: number;
  awsProfile?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

interface Day {
  date: string;
  doc: Json;
}

// ---------- module-level store (shared by activate, tick, refresh button and every mounted pane) ----------

interface State {
  data: Json | null;
  history: Day[];
  error: string | null;
  loading: boolean;
}

let state: State = { data: null, history: [], error: null, loading: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

// ---------- helpers ----------

const isErrorNode = (v: Json): boolean => v !== null && typeof v === "object" && typeof v.error === "string";

function hasErrorNode(v: Json): boolean {
  if (isErrorNode(v)) return true;
  if (Array.isArray(v)) return v.some(hasErrorNode);
  if (v && typeof v === "object") return Object.values(v).some(hasErrorNode);
  return false;
}

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const MONEY_KEY = /(mrr|profit|cost|amount|revenue)/i;

/** Single formatter: null/undefined/error nodes are "Unknown", never zero. */
function fmt(v: Json, key = ""): string {
  if (v === null || v === undefined) return "Unknown";
  if (isErrorNode(v)) return `Unknown (${v.error})`;
  if (typeof v === "number") {
    if (MONEY_KEY.test(key)) return money.format(v);
    if (/latencyms/i.test(key)) return `${Math.round(v)} ms`;
    return v.toLocaleString();
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Table cell: "-" when the app has no such metric, otherwise fmt (so unknown stays "Unknown"). */
const cell = (v: number | null | undefined, key = "") => (v === undefined ? "-" : fmt(v, key));

const axisFmt = (key: string) => (n: number) => (MONEY_KEY.test(key) ? money.format(n) : compact.format(n));

function ageHours(iso: string | undefined): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000;
}

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const appsOf = (doc: Json): Json[] => (doc && Array.isArray(doc.apps) ? doc.apps : []);

/** Walks a dotted path. undefined = not present, null = unknown (error node or null), number = value. */
function metric(o: Json, path: string): number | null | undefined {
  let v = o;
  for (const k of path.split(".")) {
    if (v === undefined) return undefined;
    if (v === null || isErrorNode(v)) return null;
    v = v[k];
  }
  if (v === undefined) return undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Sums a metric across apps; any unknown app value makes the total unknown. */
function sumApps(doc: Json, path: string): number | null | undefined {
  if (!doc || isErrorNode(doc.apps)) return null;
  const vals = appsOf(doc)
    .map((a) => metric(a, path))
    .filter((v) => v !== undefined);
  if (vals.length === 0) return undefined;
  return vals.some((v) => v === null) ? null : (vals as number[]).reduce((a, b) => a + b, 0);
}

/** Status a single value signals: firing alarms are an error, 5xx responses a warning. */
function valueTone(key: string, v: Json): StatusColor | null {
  if (typeof v !== "number" || v <= 0) return null;
  if (key === "inAlarm") return "error";
  if (key === "errors5xx") return "warning";
  return null;
}

/** Worst tone of any value in a group: firing alarms -> error; 5xx, stale states or unknown sections -> warning. */
function groupTone(v: Json): StatusColor | null {
  if (isErrorNode(v)) return "warning";
  if (!v || typeof v !== "object") return null;
  const tones: StatusColor[] = [];
  const walk = (o: Json) =>
    Object.entries(o).forEach(([k, x]) => {
      const t = valueTone(k, x) ?? (k === "staleStates" && typeof x === "number" && x > 0 ? "warning" : null) ?? (isErrorNode(x) ? "warning" : null);
      if (t) tones.push(t);
      else if (x && typeof x === "object") walk(x);
    });
  walk(v);
  return tones.length ? worst(tones) : null;
}

function appStatus(app: Json): StatusColor {
  if (valueTone("inAlarm", metric(app, "health.alarms.inAlarm"))) return "error";
  if (hasErrorNode(app)) return "warning";
  if (valueTone("errors5xx", metric(app, "monitoring.totals.errors5xx"))) return "warning";
  if ((app.health?.freshness?.staleStates ?? 0) > 0) return "warning";
  return "success";
}

const WORST: StatusColor[] = ["idle", "success", "warning", "error"];
const worst = (cs: StatusColor[]): StatusColor => cs.reduce((a, b) => (WORST.indexOf(b) > WORST.indexOf(a) ? b : a), "success" as StatusColor);

function docStatus(doc: Json): StatusColor {
  const age = ageHours(doc.generatedAt);
  const stale = age === null || age > STALE_HOURS;
  const status = worst(appsOf(doc).map(appStatus));
  return stale || hasErrorNode(doc) ? worst([status, "warning"]) : status;
}

/** History plus the latest document, one entry per UTC date, oldest first. */
function allDays(): Day[] {
  const m = new Map(state.history.map((d) => [d.date, d.doc]));
  if (typeof state.data?.generatedAt === "string") m.set(state.data.generatedAt.slice(0, 10), state.data);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, doc]) => ({ date, doc }));
}

// ---------- fetching ----------

async function awsArgs(api: PluginApi, args: string[]): Promise<string[]> {
  const s = await api.settings.get<Settings>();
  const out = [...args, "--cli-connect-timeout", "10", "--cli-read-timeout", "15"];
  if (s.awsProfile) out.push("--profile", s.awsProfile);
  return out;
}

async function aws(api: PluginApi, args: string[]): Promise<string> {
  const res = await api.shell.exec("aws", await awsArgs(api, args));
  if (res.code !== 0) throw new Error(res.stderr.trim() || `aws exited with code ${res.code}`);
  return res.stdout;
}

async function loadHistory(api: PluginApi) {
  const entries = await api.fs.listDir(HISTORY_DIR);
  const files = entries
    .filter((e) => !e.isDir && /^\d{4}-\d{2}-\d{2}\.json$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .slice(-MAX_DAYS);
  const docs = await Promise.all(
    files.map(async (f) => {
      try {
        return JSON.parse(await api.fs.readTextFile(`${HISTORY_DIR}/${f}`));
      } catch {
        return null;
      }
    }),
  );
  setState({ history: files.map((f, i) => ({ date: f.slice(0, 10), doc: docs[i] })).filter((d) => d.doc) });
}

async function syncHistory(api: PluginApi, bucket: string) {
  const root = (await api.fs.getRootPath()).replace(/[\\/]+$/, "");
  await aws(api, ["s3", "sync", `s3://${bucket}/${HISTORY_DIR}/`, `${root}/${HISTORY_DIR}`, "--only-show-errors"]);
  await loadHistory(api);
}

async function refresh(api: PluginApi, signal?: AbortSignal) {
  if (state.loading) return;
  setState({ loading: true });
  const setIcon = (c: StatusColor, tip?: string) => {
    if (signal?.aborted) return;
    try {
      api.statusIcon.set(c, tip);
    } catch {
      /* deactivated */
    }
  };
  const log = (level: "warn" | "error", msg: string) => {
    if (signal?.aborted) return;
    try {
      api.log[level](`${NAME}: ${msg}`);
    } catch {
      /* deactivated */
    }
  };
  try {
    const bucket = (await api.settings.get<Settings>()).bucket || DEFAULT_BUCKET;
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
    // The icon only signals problems; anything short of warning stays idle (default tint).
    setIcon(status === "warning" || status === "error" ? status : "idle", tip);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setState({ error: msg, loading: false });
    setIcon("error", msg);
    log("error", msg);
  }
}

export async function activate(ctx: PluginContext) {
  ctx.api.statusIcon.set("idle");
  const s = await ctx.api.settings.get<Settings>();
  const minutes = Math.max(1, s.refreshMinutes ?? 60);
  ctx.tick.register(() => refresh(ctx.api, ctx.signal));
  ctx.tick.setInterval(minutes * 60_000);
  ctx.api.log.info(`${NAME} activated`);
  void loadHistory(ctx.api).catch(() => undefined);
  void refresh(ctx.api, ctx.signal);
}

// ---------- chart primitives ----------

const CHART_HEIGHT = 170;

const scrollbarStyle = (p: Palette): CSSProperties => ({ scrollbarWidth: "thin", scrollbarColor: `${p.border} ${p.surface}` });

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function Tooltip({ p, x, y, flip, fixed, children }: { p: Palette; x: number; y: number; flip: boolean; fixed?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        position: fixed ? "fixed" : "absolute",
        left: x,
        top: y,
        transform: flip ? "translateX(-100%)" : undefined,
        background: p.background,
        color: p.text,
        border: `1px solid ${p.border}`,
        borderRadius: 4,
        padding: "4px 8px",
        fontSize: 12,
        lineHeight: "18px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      {children}
    </div>
  );
}

interface Series {
  name: string;
  color: string;
  values: (number | null)[];
}

/** Line chart over time on one shared axis. Unknown (null) points break a line instead of dropping to zero; a lone series also gets an area fill. */
function LineChart({ api, labels, series, format, height = CHART_HEIGHT }: { api: PluginApi; labels: string[]; series: Series[]; format: (n: number) => string; height?: number }) {
  const p = api.theme.palette;
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const L = 56,
    R = 12,
    T = 10,
    B = 22;
  const w = Math.max(1, width - L - R);
  const h = height - T - B;
  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const x = (i: number) => L + (n <= 1 ? w / 2 : (i * w) / (n - 1));
  const y = (v: number) => T + h - (v / max) * h;

  const runsOf = (values: (number | null)[]) => {
    const runs: number[][] = [];
    let cur: number[] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push(i);
    });
    if (cur.length) runs.push(cur);
    return runs;
  };

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = n <= 1 ? 0 : Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const xLabels = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
  const anchor = (i: number) => (n <= 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle");
  const flip = hover !== null && x(hover) > width - 160;

  return (
    <div ref={ref} style={{ position: "relative", height }}>
      {width > 0 && (
        <svg width={width} height={height} style={{ display: "block", fontSize: 12 }}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={L + w} y1={y(max * f)} y2={y(max * f)} stroke={p.border} strokeWidth={1} strokeDasharray={f ? "2 4" : undefined} />
              <text x={L - 6} y={y(max * f)} dy="0.32em" textAnchor="end" fill={p.textMuted}>
                {format(max * f)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text key={i} x={x(i)} y={height - 4} textAnchor={anchor(i)} fill={p.textMuted}>
              {labels[i]}
            </text>
          ))}
          {series.map((s) => {
            const runs = runsOf(s.values);
            const line = (run: number[]) => run.map((i, k) => `${k ? "L" : "M"}${x(i)},${y(s.values[i] as number)}`).join("");
            const lastKnown = [...s.values.keys()].reverse().find((i) => s.values[i] !== null);
            return (
              <g key={s.name}>
                {runs.map((run) =>
                  run.length > 1 ? (
                    <g key={run[0]}>
                      {series.length === 1 && <path d={`${line(run)}L${x(run[run.length - 1])},${y(0)}L${x(run[0])},${y(0)}Z`} fill={s.color} fillOpacity={0.12} />}
                      <path d={line(run)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    </g>
                  ) : (
                    <circle key={run[0]} cx={x(run[0])} cy={y(s.values[run[0]] as number)} r={3} fill={s.color} />
                  ),
                )}
                {lastKnown !== undefined && hover === null && (
                  <circle cx={x(lastKnown)} cy={y(s.values[lastKnown] as number)} r={3.5} fill={s.color} stroke={p.surface} strokeWidth={2} />
                )}
                {hover !== null && s.values[hover] !== null && (
                  <circle cx={x(hover)} cy={y(s.values[hover] as number)} r={4.5} fill={s.color} stroke={p.surface} strokeWidth={2} pointerEvents="none" />
                )}
              </g>
            );
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + h} stroke={p.textMuted} strokeWidth={1} pointerEvents="none" />}
          <rect x={L} y={0} width={w} height={height} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && (
        <Tooltip p={p} x={x(hover) + (flip ? -10 : 10)} y={T} flip={flip}>
          <div style={{ color: p.textMuted }}>{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {series.length > 1 && <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />}
              {series.length > 1 && <span style={{ color: p.textMuted }}>{s.name}</span>}
              <span>{s.values[hover] === null ? "Unknown" : format(s.values[hover] as number)}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

interface Seg {
  name: string;
  value: number;
  color: string;
}

interface BarRow {
  label: string;
  segments: Seg[];
  valueText: string;
  tip: string[];
}

function Legend({ api, items }: { api: PluginApi; items: { name: string; color: string }[] }) {
  const p = api.theme.palette;
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: p.textMuted }}>
      {items.map((it) => (
        <span key={it.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

/** Horizontal (optionally stacked) bars sharing one scale, value labels at the end. Scrolls past BAR_LIST_HEIGHT. */
function BarList({ api, rows }: { api: PluginApi; rows: BarRow[] }) {
  const p = api.theme.palette;
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const max = Math.max(0, ...rows.map((r) => r.segments.reduce((a, s) => a + s.value, 0))) || 1;
  if (rows.length === 0) return <span style={{ color: p.textMuted }}>None</span>;
  const flip = hover !== null && hover.x > window.innerWidth - 200;
  return (
    <div style={{ ...scrollbarStyle(p), maxHeight: CHART_HEIGHT, overflowY: "auto", overflowX: "hidden", paddingRight: GAP }} onMouseLeave={() => setHover(null)}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, max-content) 1fr max-content", gap: "2px 12px", alignItems: "center", fontSize: 14 }}>
        {rows.map((r, i) => {
          const total = r.segments.reduce((a, s) => a + s.value, 0);
          const hot = hover?.i === i;
          const cell: CSSProperties = { background: hot ? p.surfaceHover : undefined, padding: "2px 0" };
          return (
            <div key={r.label} style={{ display: "contents" }} onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}>
              <span style={{ ...cell, color: hot ? p.accent : p.text, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>
                {r.label}
              </span>
              <div style={{ ...cell, display: "flex", height: 22, alignItems: "center" }}>
                <div style={{ display: "flex", width: `${(total / max) * 100}%`, height: 12, gap: 1, minWidth: total > 0 ? 2 : 0 }}>
                  {r.segments
                    .filter((s) => s.value > 0)
                    .map((s, k, arr) => (
                      <div
                        key={s.name}
                        style={{
                          flex: s.value,
                          background: s.color,
                          borderRadius: `${k === 0 ? 2 : 0}px ${k === arr.length - 1 ? 2 : 0}px ${k === arr.length - 1 ? 2 : 0}px ${k === 0 ? 2 : 0}px`,
                        }}
                      />
                    ))}
                </div>
              </div>
              <span style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.valueText}</span>
            </div>
          );
        })}
      </div>
      {hover && rows[hover.i] && (
        <Tooltip p={p} x={hover.x + (flip ? -12 : 12)} y={hover.y + 12} flip={flip} fixed>
          <div style={{ fontWeight: 600 }}>{rows[hover.i].label}</div>
          {rows[hover.i].tip.map((t) => (
            <div key={t}>{t}</div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

function Tile({ api, label, value, delta, tone }: { api: PluginApi; label: string; value: string; delta?: string | null; tone?: StatusColor | null }) {
  const p = api.theme.palette;
  return (
    <div
      style={{
        minWidth: 0,
        boxSizing: "border-box",
        background: p.surface,
        border: `1px solid ${tone ? p.status[tone] : p.border}`,
        borderRadius: 6,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span style={{ color: p.textMuted, fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 22, lineHeight: "30px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: tone ? p.status[tone] : undefined }}>{value}</span>
      {delta && <span style={{ color: p.textMuted, fontSize: 12 }}>{delta}</span>}
    </div>
  );
}

/** Wrapping row of cards: every row is filled edge to edge and its cards share one height. */
const TILE_MIN = 130;
const GAP = 12;

/** Stat tiles in equal columns; when they don't fit on one row they split into balanced rows (6 -> 3+3 -> 2+2+2). */
function TileRow({ children }: { children: ReactNode[] }) {
  const [ref, width] = useWidth();
  const n = Math.max(1, children.length);
  const fit = Math.max(1, Math.floor((width + GAP) / (TILE_MIN + GAP)));
  const cols = width ? Math.ceil(n / Math.ceil(n / Math.min(fit, n))) : n;
  return (
    <div ref={ref} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }}>
      {children}
    </div>
  );
}

const Flow = ({ children }: { children: ReactNode }) => <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 12 }}>{children}</div>;

/** Only warning/error tones outline a card; anything else keeps the normal border. */
const alertTone = (s: StatusColor | null | undefined): StatusColor | null => (s === "warning" || s === "error" ? s : null);

function Section({ api, title, extra, tone, children }: { api: PluginApi; title: string; extra?: ReactNode; tone?: StatusColor | null; children: ReactNode }) {
  const p = api.theme.palette;
  const t = alertTone(tone);
  return (
    <div
      style={{
        flex: "1 1 320px",
        boxSizing: "border-box",
        background: p.surface,
        border: `1px solid ${t ? p.status[t] : p.border}`,
        borderRadius: 6,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ flex: 1 }}>{title}</strong>
        {extra}
      </div>
      {children}
    </div>
  );
}

// ---------- metric views ----------

interface Trend {
  title: string;
  key: string;
  get: (doc: Json) => number | null | undefined;
}

/** Tile value from the latest doc, delta against the previous day in history. */
function trendTile(api: PluginApi, days: Day[], t: Trend) {
  const vals = days.map((d) => t.get(d.doc));
  const cur = vals[vals.length - 1];
  const prev = vals.length > 1 ? vals[vals.length - 2] : undefined;
  let delta: string | null = null;
  if (typeof cur === "number" && typeof prev === "number") {
    const d = cur - prev;
    const abs = MONEY_KEY.test(t.key) ? money.format(Math.abs(d)) : Math.abs(d).toLocaleString();
    delta = `${d > 0 ? "+" : d < 0 ? "-" : "±"}${abs} vs ${shortDate(days[days.length - 2].date)}`;
  }
  return <Tile key={t.title} api={api} label={t.title} value={fmt(cur, t.key)} delta={delta} tone={valueTone(t.key, cur)} />;
}

/** One card per trend that has data; rendered as a fragment so the cards join the surrounding Flow. */
function TrendCharts({ api, days, trends }: { api: PluginApi; days: Day[]; trends: Trend[] }) {
  return (
    <>
      {trends
        .map((t) => ({ t, points: days.map((d) => ({ label: shortDate(d.date), raw: t.get(d.doc) })) }))
        .filter(({ points }) => points.some((pt) => pt.raw !== undefined))
        .map(({ t, points }) => (
          <Section key={t.title} api={api} title={`${t.title} Trend`}>
            <LineChart
              api={api}
              labels={points.map((pt) => pt.label)}
              series={[{ name: t.title, color: api.theme.palette.accent, values: points.map((pt) => pt.raw ?? null) }]}
              format={axisFmt(t.key)}
            />
          </Section>
        ))}
    </>
  );
}

function HistoryHint({ api, days }: { api: PluginApi; days: Day[] }) {
  if (days.length >= 2) return null;
  return <span style={{ color: api.theme.palette.textMuted, fontSize: 12 }}>Trends fill in as daily history accumulates ({days.length} day so far).</span>;
}

function costRows(api: PluginApi, cost: Json): BarRow[] {
  const p = api.theme.palette;
  return Object.entries(cost?.byTag ?? {})
    .filter(([, v]) => typeof v === "number")
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .map(([k, v]) => ({
      label: k,
      segments: [{ name: "Cost", value: v as number, color: p.accent }],
      valueText: money.format(v as number),
      tip: [`${money.format(v as number)} (${cost.total ? (((v as number) / cost.total) * 100).toFixed(1) : "0"}% of total)`],
    }));
}

/** Apps too small for their own tab; they get one invocations-vs-errors card on the Overview instead. */
const OVERVIEW_ONLY_APPS: Record<string, string> = { SecretsManager: "Global Secrets Trend" };

/** Sum of a Lambda metric across an app's functions; unknown if any function's value is unknown. */
function lambdaSum(app: Json, field: "invocations" | "errors"): number | null | undefined {
  const lambdas = app?.monitoring?.lambdas;
  if (lambdas === undefined) return undefined;
  if (lambdas === null || isErrorNode(lambdas) || isErrorNode(app.monitoring)) return null;
  const vals = Object.values(lambdas).map((v) => metric(v, field));
  return vals.some((v) => typeof v !== "number") ? null : (vals as number[]).reduce((a, b) => a + b, 0);
}

function InvocationsTrend({ api, days, appName, title }: { api: PluginApi; days: Day[]; appName: string; title: string }) {
  const p = api.theme.palette;
  const appDays = days.map((d) => ({ date: d.date, app: appsOf(d.doc).find((a) => a.name === appName) })).filter((d) => d.app);
  if (appDays.length === 0) return null;
  const series: Series[] = [
    { name: "Invocations", color: p.accent, values: appDays.map((d) => lambdaSum(d.app, "invocations") ?? null) },
    { name: "Errors", color: p.status.error, values: appDays.map((d) => lambdaSum(d.app, "errors") ?? null) },
  ];
  return (
    <Section api={api} title={title} extra={<Legend api={api} items={series} />}>
      <LineChart api={api} labels={appDays.map((d) => shortDate(d.date))} series={series} format={axisFmt("")} />
    </Section>
  );
}

const OVERVIEW_TRENDS: Trend[] = [
  { title: "AWS Cost (30d)", key: "cost", get: (d) => metric(d, "awsCost.total") },
  { title: "Requests (24h)", key: "", get: (d) => sumApps(d, "monitoring.totals.requests") },
  { title: "Lambda Errors (24h)", key: "", get: (d) => sumApps(d, "monitoring.totals.lambdaErrors") },
  { title: "5xx Errors (24h)", key: "errors5xx", get: (d) => sumApps(d, "monitoring.totals.errors5xx") },
  { title: "Alarms Firing", key: "inAlarm", get: (d) => sumApps(d, "health.alarms.inAlarm") },
  { title: "Paying Customers", key: "", get: (d) => sumApps(d, "customers.paying") },
];

function Overview({ api, doc, days }: { api: PluginApi; doc: Json; days: Day[] }) {
  const { StatusDot } = api.ui;
  const p = api.theme.palette;
  const apps = appsOf(doc);
  const cost = doc.awsCost;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <TileRow>{OVERVIEW_TRENDS.filter((t) => t.get(doc) !== undefined).map((t) => trendTile(api, days, t))}</TileRow>
      <HistoryHint api={api} days={days} />
      <Flow>
        <TrendCharts api={api} days={days} trends={OVERVIEW_TRENDS.slice(0, 3)} />
        {Object.entries(OVERVIEW_ONLY_APPS).map(([name, title]) => (
          <InvocationsTrend key={name} api={api} days={days} appName={name} title={title} />
        ))}
        <Section api={api} title="Apps" tone={worst(apps.map(appStatus))}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr max-content max-content max-content", gap: "4px 12px", alignItems: "center" }}>
            {["", "App", "Requests", "Errors", "Profit (30d)"].map((h) => (
              <span key={h || "dot"} style={{ color: p.textMuted, fontSize: 12 }}>
                {h}
              </span>
            ))}
            {apps.map((a) => (
              <div key={a.name} style={{ display: "contents" }}>
                <StatusDot color={appStatus(a)} />
                <span>{a.name}</span>
                <span>{cell(metric(a, "monitoring.totals.requests"))}</span>
                <span>{cell(metric(a, "monitoring.totals.lambdaErrors"))}</span>
                <span>{cell(metric(a, "money.profit30d"), "profit")}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section api={api} title={`AWS Cost By Project${cost && !isErrorNode(cost) ? ` (${shortDate(cost.windowStart)} To ${shortDate(cost.windowEnd)})` : ""}`}>
          {!cost || isErrorNode(cost) ? <span>{fmt(cost)}</span> : <BarList api={api} rows={costRows(api, cost)} />}
        </Section>
      </Flow>
    </div>
  );
}

function lambdaRows(api: PluginApi, lambdas: Json): { rows: BarRow[]; idle: number; unknown: string[] } {
  const p = api.theme.palette;
  const rows: BarRow[] = [];
  const unknown: string[] = [];
  let idle = 0;
  for (const [fn, v] of Object.entries(lambdas ?? {}) as [string, Json][]) {
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
        { name: "Errors", value: err, color: p.status.error },
      ],
      valueText: err ? `${inv.toLocaleString()} (${((err / inv) * 100).toFixed(0)}% Err)` : inv.toLocaleString(),
      tip: [`${inv.toLocaleString()} invocations`, `${err.toLocaleString()} errors`, `${thr.toLocaleString()} throttles`],
    });
  }
  rows.sort((a, b) => b.segments[0].value + b.segments[1].value - (a.segments[0].value + a.segments[1].value));
  return { rows, idle, unknown };
}

function apiRows(api: PluginApi, apis: Json): BarRow[] {
  const p = api.theme.palette;
  return (Object.entries(apis ?? {}) as [string, Json][])
    .filter(([, v]) => typeof metric(v, "requests") === "number")
    .map(([name, v]) => {
      const req = metric(v, "requests") as number;
      const e4 = metric(v, "errors4xx") ?? 0;
      const e5 = metric(v, "errors5xx") ?? 0;
      return {
        label: name,
        segments: [
          { name: "OK", value: Math.max(0, req - e4 - e5), color: p.accent },
          { name: "4xx", value: e4, color: p.status.warning },
          { name: "5xx", value: e5, color: p.status.error },
        ],
        valueText: req.toLocaleString(),
        tip: [`${req.toLocaleString()} requests`, `${e4.toLocaleString()} 4xx, ${e5.toLocaleString()} 5xx`, `p95 latency: ${fmt(v.p95LatencyMs, "latencyms")}`],
      };
    })
    .sort((a, b) => b.segments.reduce((s, x) => s + x.value, 0) - a.segments.reduce((s, x) => s + x.value, 0));
}

function Rows({ api, value, path = "" }: { api: PluginApi; value: Json; path?: string }) {
  const p = api.theme.palette;
  if (value === null || typeof value !== "object" || isErrorNode(value)) {
    return <span>{fmt(value, path)}</span>;
  }
  const entries = Object.entries(value).filter(([, v]) => !(typeof v === "string" && (v.length > 80 || v.includes("\n"))));
  if (entries.length === 0) return <span style={{ color: p.textMuted }}>None</span>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 16px" }}>
      {entries.map(([k, v]) => {
        const nested = v !== null && typeof v === "object" && !isErrorNode(v);
        return (
          <div key={k} style={{ display: "contents" }}>
            <span style={{ color: p.textMuted }}>{titleCase(k)}</span>
            <span style={{ color: valueTone(k, v) ? p.status[valueTone(k, v) as StatusColor] : undefined }}>
              {nested ? Array.isArray(v) ? <span>{v.length ? v.join(", ") : "None"}</span> : <Rows api={api} value={v} path={k} /> : fmt(v, k)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const titleCase = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const APP_TRENDS: Trend[] = [
  { title: "Requests (24h)", key: "", get: (a) => metric(a, "monitoring.totals.requests") },
  { title: "Lambda Errors (24h)", key: "", get: (a) => metric(a, "monitoring.totals.lambdaErrors") },
  { title: "Paying Customers", key: "", get: (a) => metric(a, "customers.paying") },
  { title: "MRR", key: "mrr", get: (a) => metric(a, "money.mrr") },
  { title: "Profit (30d)", key: "profit", get: (a) => metric(a, "money.profit30d") },
];

function AppView({ api, app, days }: { api: PluginApi; app: Json; days: Day[] }) {
  const p = api.theme.palette;
  const appDays = days.map((d) => ({ date: d.date, doc: appsOf(d.doc).find((a) => a.name === app.name) })).filter((d) => d.doc);
  const mon = app.monitoring;
  const aud = app.audience;
  const audDays: Json[] = aud && Array.isArray(aud.days) ? aud.days : [];
  const audKeys = audDays.length ? Object.keys(audDays[0]).filter((k) => k !== "date" && typeof audDays[0][k] === "number") : [];
  const lambdas = mon && !isErrorNode(mon) && !isErrorNode(mon.lambdas) ? lambdaRows(api, mon.lambdas) : null;
  const apis = mon && !isErrorNode(mon) && !isErrorNode(mon.apis) ? apiRows(api, mon.apis) : null;
  const details = Object.entries(app).filter(([k]) => k !== "name" && k !== "monitoring");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <TileRow>{APP_TRENDS.filter((t) => t.get(app) !== undefined).map((t) => trendTile(api, appDays, t))}</TileRow>
      <HistoryHint api={api} days={appDays} />
      <Flow>
        <TrendCharts api={api} days={appDays} trends={APP_TRENDS} />
        {mon && isErrorNode(mon) && (
          <Section api={api} title="Monitoring (24h)" tone="warning">
            <span>{fmt(mon)}</span>
          </Section>
        )}
        {apis && apis.length > 0 && (
          <Section
            api={api}
            title="API Requests (24h)"
            tone={apis.some((r) => r.segments.some((s) => s.name === "5xx" && s.value > 0)) ? "warning" : null}
            extra={
              <Legend
                api={api}
                items={[
                  { name: "OK", color: p.accent },
                  { name: "4xx", color: p.status.warning },
                  { name: "5xx", color: p.status.error },
                ]}
              />
            }
          >
            <BarList api={api} rows={apis} />
          </Section>
        )}
        {lambdas && lambdas.rows.length > 0 && (
          <Section
            api={api}
            title="Lambda Invocations (24h)"
            extra={
              <Legend
                api={api}
                items={[
                  { name: "Succeeded", color: p.accent },
                  { name: "Errors", color: p.status.error },
                ]}
              />
            }
          >
            <BarList api={api} rows={lambdas.rows} />
            {(lambdas.idle > 0 || lambdas.unknown.length > 0) && (
              <span style={{ color: p.textMuted, fontSize: 12 }}>
                {[lambdas.idle ? `${lambdas.idle} idle function${lambdas.idle > 1 ? "s" : ""} hidden` : "", lambdas.unknown.length ? `Unknown: ${lambdas.unknown.join(", ")}` : ""]
                  .filter(Boolean)
                  .join(". ")}
              </span>
            )}
          </Section>
        )}
        {audKeys.map((k) => (
          <Section key={k} api={api} title={`Daily ${titleCase(k)}`}>
            <LineChart
              api={api}
              labels={audDays.map((d) => shortDate(String(d.date)))}
              series={[{ name: titleCase(k), color: p.accent, values: audDays.map((d) => (typeof d[k] === "number" ? d[k] : null)) }]}
              format={axisFmt(k)}
            />
          </Section>
        ))}
        {aud?.sources30d && !isErrorNode(aud.sources30d) && (
          <Section api={api} title="Traffic Sources (30d)">
            <BarList
              api={api}
              rows={(Object.entries(aud.sources30d) as [string, Json][])
                .filter(([, v]) => typeof v === "number")
                .sort(([, a], [, b]) => b - a)
                .map(([k, v]) => ({
                  label: titleCase(k),
                  segments: [{ name: "Views", value: v, color: p.accent }],
                  valueText: v.toLocaleString(),
                  tip: [`${v.toLocaleString()} views`],
                }))}
            />
          </Section>
        )}
        {details.map(([k, v]) => (
          <Section key={k} api={api} title={titleCase(k)} tone={groupTone(v)}>
            <Rows
              api={api}
              value={k === "audience" && v && !isErrorNode(v) ? Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== "days" && kk !== "sources30d")) : v}
              path={k}
            />
          </Section>
        ))}
      </Flow>
    </div>
  );
}

export function Component({ api }: { api: PluginApi; paneId?: string }) {
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
      void api.storage.get<Json>(CACHE_KEY).then((cached) => {
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

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, color: palette.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 24 }}>
        <h2 style={{ margin: 0 }}>{NAME}</h2>
        <span style={{ color: palette.textMuted, flex: 1 }}>
          {data
            ? `Generated ${data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "Unknown"} · ${days.length} Day${days.length === 1 ? "" : "s"} Of History`
            : "No Data Yet"}
        </span>
        {loading && <Spinner size={16} />}
        <TextButton label="Refresh" variant="primary" disabled={loading} onClick={() => void refresh(api)} />
      </div>
      {error && <Banner message={`Could Not Load Metrics: ${error}`} tone="error" />}
      {stale && <Banner message={`Metrics Are Older Than ${STALE_HOURS} Hours; The Daily Collector May Have Failed`} tone="warning" />}
      {data && (
        <>
          <Tabs
            tabs={[{ label: "Overview", value: "overview" }, ...tabApps.map((a) => ({ label: a.name as string, value: a.name as string }))]}
            value={current ? tab : "overview"}
            onChange={setTab}
          />
          <div style={{ ...scrollbarStyle(palette), flex: 1, minHeight: 0, overflow: "auto", paddingRight: GAP }}>
            {current ? <AppView api={api} app={current} days={days} /> : <Overview api={api} doc={data} days={days} />}
          </div>
        </>
      )}
    </div>
  );
}

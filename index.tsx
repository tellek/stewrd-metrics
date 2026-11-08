/// <reference path="../.stewrd/plugin-api.d.ts" />
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { PluginContext, PluginApi, StatusColor } from "stewrd-plugin-api";

const NAME = "Metrics";
const STALE_HOURS = 26;
const CACHE_KEY = "lastMetrics";

interface Settings {
  bucket?: string;
  refreshMinutes?: number;
  awsProfile?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

// ---------- module-level store (shared by activate, tick, refresh button and every mounted pane) ----------

interface State {
  data: Json | null;
  error: string | null;
  loading: boolean;
}

let state: State = { data: null, error: null, loading: false };
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

/** Single formatter: null/undefined/error nodes are "Unknown", never zero. */
function fmt(v: Json, key = ""): string {
  if (v === null || v === undefined) return "Unknown";
  if (isErrorNode(v)) return `Unknown (${v.error})`;
  if (typeof v === "number") {
    if (/(mrr|profit|cost|amount|revenue)/i.test(key)) return money.format(v);
    if (/latencyms/i.test(key)) return `${Math.round(v)} ms`;
    return String(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function ageHours(iso: string | undefined): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000;
}

function appStatus(app: Json): StatusColor {
  if (hasErrorNode(app)) return "warning";
  if ((app.health?.alarms?.inAlarm ?? 0) > 0) return "warning";
  if ((app.health?.freshness?.staleStates ?? 0) > 0) return "warning";
  return "success";
}

const WORST: StatusColor[] = ["idle", "success", "warning", "error"];
const worst = (cs: StatusColor[]): StatusColor => cs.reduce((a, b) => (WORST.indexOf(b) > WORST.indexOf(a) ? b : a), "success" as StatusColor);

function docStatus(doc: Json): StatusColor {
  const age = ageHours(doc.generatedAt);
  const stale = age === null || age > STALE_HOURS;
  const apps: Json[] = Array.isArray(doc.apps) ? doc.apps : [];
  const status = worst(apps.map(appStatus));
  return stale || hasErrorNode(doc) ? worst([status, "warning"]) : status;
}

// ---------- fetching ----------

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
  setIcon("in-progress", "Refreshing");
  try {
    const s = await api.settings.get<Settings>();
    const args = ["s3", "cp", `s3://${s.bucket ?? "boxopher-metrics-429357724212"}/metrics.json`, "-", "--cli-connect-timeout", "10", "--cli-read-timeout", "15"];
    if (s.awsProfile) args.push("--profile", s.awsProfile);
    const res = await api.shell.exec("aws", args);
    if (res.code !== 0) throw new Error(res.stderr.trim() || `aws exited with code ${res.code}`);
    const data = JSON.parse(res.stdout);
    await api.storage.set(CACHE_KEY, data);
    setState({ data, error: null, loading: false });
    const status = docStatus(data);
    setIcon(status, status === "success" ? "Metrics up to date" : "Metrics need attention");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setState({ error: msg, loading: false });
    setIcon("error", msg);
    if (!signal?.aborted) {
      try {
        api.log.error(`${NAME}: ${msg}`);
      } catch {
        /* deactivated */
      }
    }
  }
}

export async function activate(ctx: PluginContext) {
  ctx.api.statusIcon.set("idle");
  const s = await ctx.api.settings.get<Settings>();
  const minutes = Math.max(1, s.refreshMinutes ?? 60);
  ctx.tick.register(() => refresh(ctx.api, ctx.signal));
  ctx.tick.setInterval(minutes * 60_000);
  ctx.api.log.info(`${NAME} activated`);
  void refresh(ctx.api, ctx.signal);
}

// ---------- UI ----------

const scrollbarStyle = (p: PluginApi["theme"]["palette"]): CSSProperties => ({ scrollbarWidth: "thin", scrollbarColor: `${p.border} ${p.surface}` });

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
            <span style={{ color: p.textMuted }}>{k}</span>
            <span>
              {nested ? (
                Array.isArray(v) ? <span>{v.length ? v.join(", ") : "None"}</span> : <Rows api={api} value={v} path={k} />
              ) : (
                fmt(v, k)
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Section({ api, title, children }: { api: PluginApi; title: string; children: React.ReactNode }) {
  const p = api.theme.palette;
  return (
    <div style={{ background: p.surface, border: `1px solid ${p.border}`, borderRadius: 6, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

const titleCase = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function Overview({ api, doc }: { api: PluginApi; doc: Json }) {
  const { StatusDot } = api.ui;
  const p = api.theme.palette;
  const apps: Json[] = Array.isArray(doc.apps) ? doc.apps : [];
  const cost = doc.awsCost;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Section api={api} title="Apps">
        <div style={{ display: "grid", gridTemplateColumns: "auto max-content max-content max-content max-content", gap: "4px 16px", alignItems: "center" }}>
          {["", "App", "Alarms", "Paying", "Profit (30d)"].map((h) => (
            <span key={h || "dot"} style={{ color: p.textMuted }}>{h}</span>
          ))}
          {apps.map((a) => (
            <div key={a.name} style={{ display: "contents" }}>
              <StatusDot color={appStatus(a)} />
              <span>{a.name}</span>
              <span>{a.health?.alarms ? fmt(a.health.alarms.inAlarm) : "-"}</span>
              <span>{a.customers ? fmt(a.customers.paying) : "-"}</span>
              <span>{a.money ? fmt(a.money.profit30d, "profit") : "-"}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section api={api} title={`AWS Cost${cost && !isErrorNode(cost) ? ` (${cost.windowStart} to ${cost.windowEnd})` : ""}`}>
        {cost ? (
          isErrorNode(cost) ? (
            <span>{fmt(cost)}</span>
          ) : (
            <>
              <div>Total: {fmt(cost.total, "cost")}</div>
              <Rows api={api} value={Object.fromEntries(Object.entries(cost.byTag ?? {}).map(([k, v]) => [k, fmt(v, "cost")]))} />
            </>
          )
        ) : (
          <span>Unknown</span>
        )}
      </Section>
    </div>
  );
}

function AppView({ api, app }: { api: PluginApi; app: Json }) {
  const groups = Object.entries(app).filter(([k]) => k !== "name");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {groups.map(([k, v]) =>
        k === "monitoring" && v && !isErrorNode(v) ? (
          <Section key={k} api={api} title="Monitoring (24h)">
            <Rows api={api} value={v} />
          </Section>
        ) : (
          <Section key={k} api={api} title={titleCase(k)}>
            <Rows api={api} value={v} path={k} />
          </Section>
        ),
      )}
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
  const apps: Json[] = data && Array.isArray(data.apps) ? data.apps : [];
  const age = data ? ageHours(data.generatedAt) : null;
  const stale = data && (age === null || age > STALE_HOURS);
  const current = tab === "overview" ? null : apps.find((a) => a.name === tab);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, color: palette.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{NAME}</h2>
        <span style={{ color: palette.textMuted, flex: 1 }}>
          {data ? `Generated ${data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "Unknown"}` : "No Data Yet"}
        </span>
        {loading && <Spinner size={16} />}
        <TextButton label="Refresh" variant="primary" disabled={loading} onClick={() => void refresh(api)} />
      </div>
      {error && <Banner message={`Could Not Load Metrics: ${error}`} tone="error" />}
      {stale && <Banner message={`Metrics Are Older Than ${STALE_HOURS} Hours; The Daily Collector May Have Failed`} tone="warning" />}
      {data && (
        <>
          <Tabs
            tabs={[{ label: "Overview", value: "overview" }, ...apps.map((a) => ({ label: a.name as string, value: a.name as string }))]}
            value={current ? tab : "overview"}
            onChange={setTab}
          />
          <div style={{ ...scrollbarStyle(palette), flex: 1, minHeight: 0, overflow: "auto" }}>
            {current ? <AppView api={api} app={current} /> : <Overview api={api} doc={data} />}
          </div>
        </>
      )}
    </div>
  );
}

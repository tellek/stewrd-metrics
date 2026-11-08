# Metrics plugin

Stewrd dashboard for the ServerlessServers `metricsCollector` output. Everything is in `index.tsx`; general plugin rules are in `../CLAUDE.md`.

## Data source
- Latest snapshot: `s3://<bucket>/metrics.json` read with `aws s3 cp ... -` through `api.shell.exec`. Cached in `api.storage` key `lastMetrics` so the pane renders before the first refresh.
- History: `aws s3 sync s3://<bucket>/history/ <fs root>/history` (one `YYYY-MM-DD.json` per day, 90-day S3 lifecycle). Trends and averages come from these files plus the latest snapshot, one entry per UTC date. A failed sync downgrades status to warning but keeps the snapshot.
- The collector runs daily at 12:00 UTC. A manual `aws lambda invoke` overwrites that day's history file.
- `settings.json`: `bucket`, `refreshMinutes`, `awsProfile`.
- Contract and collector config live in the ServerlessServers repo: `docs/claude/metrics.md` and the `APPS` list in `RatesAPI/lambda/metricsCollector.py`. Any node can be `{"error": ...}`; show it as "Unknown", never as 0.
- An app's `health` group is only filled for the sources configured in `APPS` (`alarm_prefix`, `queues`, `rates_table`). An empty `{}` means nothing is configured, not that the app is healthy. OkToSell got `alarm_prefix: "oktosell-"` on 2026-11-08; only `oktosell-builder-errors` matches it.

## Status rules (`valueTone`, `appStatus`, `averageCheck`)
- Fixed rules: alarms firing > 0 and Lambda errors > 0 are `error`; 5xx > 0, stale states and unknown sections are `warning`. These color the value text and outline the tile/card.
- Sidebar icon: only `warning`/`error` are shown; healthy results and refreshes set `idle` (no `in-progress`, no `success`).
- Average outlines: today's value vs the mean of all earlier history days. Needs 3+ earlier days; skipped when the average is 0. 100%+ away is warning, 500%+ is error. Error-type metrics (`ERROR_KEYS`: `inAlarm`, `lambdaErrors`, `errors5xx`) only count rises; falling errors never outline.
- Trend chart cards are outlined by the average check only. Stat tiles use the fixed rules plus the average outline.

## Layout conventions
- Stat tiles use `TileRow`: equal grid columns picked so wrapped rows split evenly (6, then 3+3, then 2+2+2). Never let one tile stretch across a row.
- All other cards go in one `Flow` per view (flex-wrap, `flex: 1 1 320px`), so rows fill edge to edge with equal heights and no gaps.
- Bar lists cap at `CHART_HEIGHT` with an inner scroll. Scroll areas get `paddingRight: GAP` so the scrollbar isn't flush with the cards.
- Charts are hand-rolled SVG (`LineChart` with multiple series on one axis, `BarList` stacked bars) colored only from `api.theme.palette`. Unknown points break a line instead of dropping to 0.
- `OVERVIEW_ONLY_APPS` maps apps that get no tab to an Overview card title (SecretsManager is shown as "Global Secrets Trend").

## Build and verify
- Build from `plugins/`: `node build-plugin.mjs metrics`. Commit `dist/index.js` with the source.
- No local TypeScript: type-check with a throwaway install of `typescript` and `@types/react` in the scratchpad, using a tsconfig that extends this one. `settings.get<T>()` needs a `type` alias, not an `interface` (it requires an index signature).
- Format with `npx prettier@3.3.3 --print-width 180`.
- Visual check: a scratchpad harness page that imports `dist/index.js` with React from esm.sh, a fake `api` (palette, `ui` stubs, `fs` serving fake history) and the cached `storage.json` data. Serve it with a hidden `py -m http.server`.
- Claude in Chrome's `hover` action froze the harness renderer twice; trigger tooltips with a dispatched `mousemove` through `javascript_tool` instead. `resize_window` didn't change the viewport; constrain the pane width from the page instead.

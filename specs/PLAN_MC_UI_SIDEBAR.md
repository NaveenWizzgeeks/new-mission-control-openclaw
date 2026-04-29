# PLAN — Mission Control UI Refactor: Sidebar + Stats Dashboard + Real Tokens

**Author:** Fury (planner)
**Executor:** Stark (developer)
**Repo:** `/home/wizzgeeks/.openclaw/missions/autensa-spike/`

## Mission

Refactor the home page (`/`) into a stats dashboard with a left sidebar (workspace switcher + token-spending widget), keep `/workspace/[slug]` intact, recolor the New Task button to light blue, and make the token widget show **real** OpenClaw usage data.

---

## 1. Token tracking feasibility — DONE-FIRST INVESTIGATION

### Schema (already exists)

Table `cost_events` (`src/lib/db/schema.ts:518`) has every column we need:

| col | purpose |
|---|---|
| `id` | event id |
| `workspace_id` | scoping |
| `task_id` | optional task link |
| `agent_id` | optional agent link |
| `event_type` | enum: agent_dispatch, build_task, content_generation, web_search, … |
| `provider` | e.g. `anthropic`, `openai` |
| `model` | model id |
| `tokens_input`, `tokens_output` | token counts |
| `cost_usd` | dollar amount |
| `created_at` | timestamp |

Aggregation rollups already kept on:
- `agents.total_cost_usd`, `agents.total_tokens_used` (auto-incremented in `recordCostEvent`)
- `tasks.actual_cost_usd` (auto-incremented per task)

### Read-side helpers (already exist)

`src/lib/costs/reporting.ts`:
- `getCostOverview(workspaceId)` → today / week / month / total
- `getCostBreakdown(workspaceId)` → by_event_type / by_product / by_agent
- `getPerFeatureStats(workspaceId)` → per-idea, per-shipped costs

### Existing read endpoint

`GET /api/costs/breakdown?workspace_id=…` (`src/app/api/costs/breakdown/route.ts`) — returns breakdown + per-feature.
**Gap:** there is NO endpoint that returns `getCostOverview` (today/week/month/total). Trivial to add.

### Write-side (THE PROBLEM)

`recordCostEvent()` is only invoked from autopilot internals:
- `src/lib/autopilot/research.ts:137` (research cycle)
- `src/lib/autopilot/ideation.ts:386` (ideation cycle)
- `POST /api/costs/event` (manual write)

**It is NOT called on the main agent-dispatch path** (`POST /api/tasks/[id]/dispatch`). The dispatch sends `chat.send` to the gateway and updates agent status, but never records token usage.

**Current DB state:** `SELECT COUNT(*) FROM cost_events` = **0 rows**. There is no real token data in the DB today.

**Streaming events do NOT carry usage:** `agent_event` payloads (`src/app/api/tasks/[id]/agent-stream/route.ts:11`) carry `runId`, `stream`, `data`, `sessionKey`, `seq`, `ts` — no token counts. Same for `chat_event`. So we cannot derive cost by passively listening to the gateway WebSocket events the MC client already subscribes to.

### THE WIN — gateway exposes real usage via RPC

OpenClaw gateway protocol (`docs/gateway/protocol.md:240–249`, confirmed in `dist/server.impl-BbJvXoPb.js:14961-15324`) ships these RPC methods:

| RPC | returns |
|---|---|
| `usage.cost` | aggregated cost for a date range (params: `startDate`, `endDate`, `days`, `mode`, `utcOffset`). Totals include `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `totalCost`, `inputCost`, `outputCost`, `cacheReadCost`, `cacheWriteCost`. |
| `sessions.usage` | per-session usage list. Filterable by `key` (sessionKey). Same per-session totals as above + `label`, `updatedAt`. |
| `sessions.usage.timeseries` | timeseries usage for one session |
| `sessions.usage.logs` | per-message usage log entries |
| `usage.status` | provider quota windows (`X% left`) |

The MC's existing `OpenClawClient` (`src/lib/openclaw/client.ts`) already authenticates against the gateway. Adding `getUsageCost()` and `getSessionsUsage()` is a 5-line addition each, mirroring `listSessions()`.

Per-session usage is **keyed by sessionKey**. MC stores sessionKeys in `openclaw_sessions.openclaw_session_id` (joined with the agent's `session_key_prefix`, see `dispatch/route.ts:441`). So we can map gateway-reported per-session totals → MC tasks/agents.

### What's possible TODAY (no gateway changes)

- ✅ **Total spend (today / week / month / total)** — call `usage.cost` with date ranges.
- ✅ **Per model** — `usage.cost` returns model-level breakdown in the cached summary (gateway aggregates by model). If schema lookup confirms granularity, expose as-is. If not, drill via `sessions.usage` and group client-side by `model` field on each session entry.
- ✅ **Per session** — `sessions.usage` returns each session's totals; we already have the sessionKey ↔ task/agent mapping.
- ✅ **Per agent / per task** — JOIN gateway's `sessions.usage` results against `openclaw_sessions` table on `openclaw_session_id`.

### What does NOT work today

- ❌ Reading `cost_events` table → empty. Useless until we backfill.
- ❌ Reading `agents.total_cost_usd` / `tasks.actual_cost_usd` → all zero, never written by dispatch.

### Recommendation

**Use gateway RPC as the source of truth.** Skip writing to `cost_events` for the main-page widget. The `cost_events` table can stay as-is for autopilot-specific tracking (research/ideation cycles), but the dashboard widget reads live from gateway.

Optional later: a sync job that pulls `usage.cost`/`sessions.usage` periodically and persists into `cost_events` for historical retention beyond the gateway's session log. **Out of scope** for this refactor — flag in Risks.

### Honest gap

Gateway returns dollars only when API-key auth is configured for the provider. Subscription/OAuth Anthropic Claude (the squad's likely default) **hides cost** per the docs (`docs/concepts/usage-tracking.md:41`, `docs/reference/api-usage-costs.md:36-38`). In that case the widget will show **tokens (real)** with cost displayed as `—` or "OAuth (no cost data)". This is a known OpenClaw constraint, not a bug.

**Action for Harish:** unknown — needs Harish's call. Decide whether to (a) ship tokens-only for OAuth, (b) require API-key configuration for cost dollars, or (c) maintain a local pricing table in `models.providers.<provider>.models[].cost` and let gateway compute. Option (c) is the documented path.

---

## 2. Files to touch

### New files

| Path | Purpose |
|---|---|
| `src/components/HomeSidebar.tsx` | Left sidebar shell: workspace switcher + token widget. New component for `/`. |
| `src/components/HomeDashboard.tsx` | Right pane: stats grid (total tasks, by-status, agent roster). New component. |
| `src/components/sidebar/WorkspaceSwitcher.tsx` | Workspace list item + create button. Replaces the grid card UX from `WorkspaceDashboard.tsx`. |
| `src/components/sidebar/TokenSpendWidget.tsx` | Reads gateway usage; shows totals + per-model breakdown. |
| `src/components/dashboard/StatsTotalTasks.tsx` | Single-stat widget (total across all workspaces). |
| `src/components/dashboard/StatsByStatus.tsx` | Bar/list of task counts by status. |
| `src/components/dashboard/AgentRoster.tsx` | Live agent list + status badges. |
| `src/app/api/costs/overview/route.ts` | Wraps `usage.cost` from gateway → JSON. Falls back to local `getCostOverview` if gateway disconnected. |
| `src/app/api/costs/sessions/route.ts` | Wraps `sessions.usage` from gateway → JSON. Optional `agent_id`/`task_id` filter. |
| `src/app/api/stats/tasks/route.ts` | SQL: total tasks + counts by status across all workspaces (or one). |
| `src/app/api/stats/agents/route.ts` | Live agent roster (delegates to existing reconciliation logic from `agents/route.ts:23-40`, but workspace-agnostic). |

### Edits

| Path | Change |
|---|---|
| `src/app/page.tsx` | Replace `<WorkspaceDashboard />` with new `<HomeShell>` that lays out sidebar + dashboard. (`HomeShell` may live inline or as new component.) |
| `src/components/WorkspaceDashboard.tsx` | **Delete or deprecate** — its grid + create-modal UX moves into `WorkspaceSwitcher.tsx`. Keep the `CreateWorkspaceModal` JSX, factor it into `src/components/CreateWorkspaceModal.tsx`. |
| `src/components/MissionQueue.tsx` | Line 171: change `bg-mc-accent-pink` → `bg-mc-accent-blue` (new token, see §6). Same for hover `bg-mc-accent-pink/90` → `bg-mc-accent-blue/90`. |
| `tailwind.config.ts` | Add `mc-accent-blue: '#38bdf8'` (sky-400). See §6. |
| `src/lib/openclaw/client.ts` | Add two new methods on `OpenClawClient`: `getUsageCost(params)` calling `'usage.cost'`, and `getSessionsUsage(params)` calling `'sessions.usage'`. ~10 LOC. |

### Important note on Harish's color brief

Harish said "currently `bg-mc-accent`, gold". Two corrections after reading the code:
1. The New Task button at `MissionQueue.tsx:171` uses `bg-mc-accent-pink`, not `bg-mc-accent`.
2. `mc-accent` itself is `#58a6ff` (sky blue), not gold. `mc-accent-yellow` (`#d29922`) is gold-ish.

Stark should change `bg-mc-accent-pink` → new `bg-mc-accent-blue` token, not touch `bg-mc-accent` (which is already used elsewhere as a primary accent). Confirm with Harish if he intended the `mc-accent-yellow` button somewhere else.

---

## 3. Sidebar component design

**Layout:** `HomeShell` (CSS grid or flex):
```
┌─────────────┬───────────────────────────────────┐
│             │                                    │
│  Sidebar    │   Dashboard (stats grid)           │
│  (256–280px)│                                    │
│             │                                    │
└─────────────┴───────────────────────────────────┘
```

**Sidebar contents (top → bottom):**
1. Header: 🦞 Mission Control logo + small subtitle.
2. `<WorkspaceSwitcher>` — vertical list of workspaces. Each row: icon + name + small count badge (`workspace.taskCounts.total` tasks). Active row highlighted. "+ New Workspace" button at bottom of list. Source: existing `GET /api/workspaces?stats=true` (already returns `WorkspaceStats` with `taskCounts.total` + `agentCount`). Click navigates to `/workspace/${slug}` via `<Link>` (existing routing in `src/app/workspace/[slug]/page.tsx`).
3. Divider.
4. `<TokenSpendWidget>` — see §4.
5. (optional) Footer link to /autopilot, /activity (preserve existing nav from current header).

Use existing tailwind tokens: `bg-mc-bg-secondary` for sidebar bg, `border-mc-border` for separators. Mirrors look of existing screens.

Mobile responsiveness: sidebar collapses to a top drawer below `md:` breakpoint. Use the same hamburger pattern as elsewhere (search codebase for existing drawer convention before inventing one).

---

## 4. Dashboard widgets — endpoints

### `<StatsTotalTasks>` and `<StatsByStatus>`

**Need:** total tasks across all workspaces + counts grouped by status.

**Existing endpoint reuse:** `GET /api/workspaces?stats=true` returns per-workspace counts. Sum client-side OR add a new aggregate endpoint to avoid N round-trips through React state.

**New endpoint** `GET /api/stats/tasks`:
```sql
SELECT status, COUNT(*) as count
FROM tasks
GROUP BY status;
```
Optional `?workspace_id=` filter. Returns `{ total: N, by_status: { inbox: 4, in_progress: 2, ... } }`.

### `<AgentRoster>`

**Need:** live list of agents with availability/status (`working` / `standby` / `offline`).

**Existing logic reuse:** `GET /api/agents` (`src/app/api/agents/route.ts:8`) already does the right thing — pulls all agents and **reconciles status from active tasks** (`agents/route.ts:23-40`):
- An agent with any task in `assigned`/`in_progress`/`testing`/`verification` → `working`
- Else → `standby` (unless DB has `offline`)

This is good, but it scans only the DB, not the live OpenClaw gateway. For richer "is this agent's process alive" info, we can **optionally** cross-reference `agents.list` from gateway (already wired: `client.listAgents()`).

**New endpoint** `GET /api/stats/agents` (optional — see Risk #2):
- Calls existing `getAllAgentHealth()` (`src/lib/agent-health.ts`) for stall/health info — already used by `/api/agents/health` (`src/app/api/agents/health/route.ts:7`).
- Joins with `agents` table to expose: `name`, `avatar_emoji`, `role`, `model`, `status`, `health_state`, `is_master`, `total_cost_usd`, `total_tokens_used`.
- No workspace filter — Harish wants global roster on the home page.

If keeping it simple: just call existing `GET /api/agents` (no workspace_id) — already returns reconciled status across all workspaces.

---

## 5. Agent status source — confirmed

Multiple sources, in order of authority for the home dashboard:

1. **`agents.status` column** — set by dispatch path (`dispatch/route.ts:469`: `UPDATE agents SET status='working'` on dispatch). Set to `offline` only if explicit. Default `standby`.
2. **Inferred from `tasks` rows** — `agents/route.ts:23-40` overlays "real" status by checking if the agent has any active task. Wins over stale DB flag (so an agent that finished a task but didn't get marked back to `standby` still shows correctly).
3. **Health table** (`agent_health`) — separate health-check cycle in `src/lib/agent-health.ts`. Tracks `health_state` (healthy/stalled/etc), `consecutive_stall_checks`, last seen.
4. **OpenClaw gateway** — `client.listAgents()` returns gateway's view of currently-loaded agents. Useful for "is the agent process even alive in the gateway" but more than we need for v1.
5. **`openclaw_sessions` table** — has `status='active'` per agent+task. Could be used for granular "in which session is this agent right now".

**Recommendation for the AgentRoster widget:** use existing `GET /api/agents` (already does #1+#2). Optionally surface `health_state` from `agent_health` for a small badge. Do NOT inject gateway calls into the home page render path — adds latency and a hard dep on gateway being up.

---

## 6. Light blue token

Add to `tailwind.config.ts` under `theme.extend.colors`:
```ts
'mc-accent-blue': '#38bdf8', // Tailwind sky-400
```

Why sky-400:
- Distinct from existing `mc-accent` (`#58a6ff`, GitHub-blue) — won't collide visually with link/primary accent.
- Distinct from `mc-accent-cyan` (`#39d353`, which is misnamed — it's actually green).
- "Light blue" register matches Harish's brief, and sky-400 is well-known and pleasing on dark bg `#0d1117`.

Alternative if Harish wants softer: `#7dd3fc` (sky-300).

Apply on `MissionQueue.tsx:171`:
```tsx
className="... bg-mc-accent-blue text-mc-bg ... hover:bg-mc-accent-blue/90"
```

---

## 7. Risks / scope creep

| Risk | Severity | Mitigation |
|---|---|---|
| **OAuth-auth Anthropic hides cost** — widget shows tokens but `$0.00` | Med | Display tokens prominently; show "—" for cost when gateway returns no costEntries, with tooltip "Cost requires API-key auth or pricing config". Document for Harish. |
| **Gateway disconnected at render time** — widget can't fetch usage | Med | Endpoint returns 503 → widget shows last-known cached value (use `Cache-Control: stale-while-revalidate`) or a "gateway offline" state. Don't crash the page. |
| **Persisting gateway usage into `cost_events`** | High (scope creep) | OUT OF SCOPE for this PR. The dispatch path doesn't write to `cost_events` today — fixing that is a separate spike (needs hooking the dispatch's `chat.send` reply path or polling `sessions.usage` periodically and dedupe-writing). Flag for Harish. |
| **Agent roster sourcing live from gateway adds latency** | Low | Stay on the SQL+reconciliation path (`/api/agents`); only call gateway for richer info if Harish later asks. |
| **`mc-accent-pink` may be referenced elsewhere** | Low | Grep confirms it's only on the New Task button. Safe to flip just the one line. (Stark: re-grep before editing to confirm.) |
| **Mobile sidebar UX** | Low | Reuse existing `WorkspaceTab` mobile patterns; don't invent. |
| **Removing `WorkspaceDashboard.tsx`** breaks any other importer | Low | Grep for imports first. Currently only `src/app/page.tsx` imports it. Safe to delete after migration. |
| **`sessions.usage` requires gateway protocol v3** | Low | MC client already negotiates `minProtocol:3, maxProtocol:3` (`client.ts:331`). |
| **`sessionKey` mapping to MC tasks** | Med | Joins on `openclaw_sessions.openclaw_session_id`. Make sure to also handle the `prefix` (default `agent:main:`). Stark: write a tiny helper `composeSessionKey(agent, session)` and unit-test it. |

---

## 8. Order of operations for Stark

1. **Tailwind token + button color** (15 min, lowest risk, ship-able alone)
   - Add `mc-accent-blue` to `tailwind.config.ts`.
   - Edit `MissionQueue.tsx:171` button class. Verify hover state.
   - Test: `/workspace/<any>` page, click "New Task" — should be light blue now.

2. **Gateway client extensions** (30 min)
   - Add `getUsageCost(params)` and `getSessionsUsage(params)` to `OpenClawClient` (`src/lib/openclaw/client.ts`).
   - Add typed return interfaces (`UsageCostSummary`, `SessionUsageEntry`).

3. **New API endpoints** (1–2 hr)
   - `GET /api/costs/overview` — proxies `usage.cost` for `today`/`week`/`month`/`total`. Return shape: `{ today: {tokens, cost, by_model}, week: …, month: …, total: … }`.
   - `GET /api/costs/sessions` — proxies `sessions.usage` with optional filters.
   - `GET /api/stats/tasks` — SQL aggregate.
   - (If needed) `GET /api/stats/agents` — extension of `/api/agents` with health overlay.

4. **Sidebar component shell** (1 hr)
   - `HomeSidebar.tsx`, `HomeDashboard.tsx`, refactor `page.tsx` to lay them out.
   - `WorkspaceSwitcher.tsx` — fetch `/api/workspaces?stats=true`, render list, link rows to `/workspace/[slug]`.
   - Verify: `/workspace/[slug]` continues to work unchanged.

5. **TokenSpendWidget** (1–2 hr)
   - Fetch `/api/costs/overview`. Show today/week/month/total + per-model breakdown.
   - Handle no-cost (OAuth) case: show tokens only with caveat tooltip.
   - Handle gateway-disconnected case: show "—" with retry.

6. **Dashboard stats widgets** (1–2 hr)
   - `StatsTotalTasks` — fetch `/api/stats/tasks`, render single big number.
   - `StatsByStatus` — render counts grouped by status enum, ordered as in `tasks` schema CHECK constraint.
   - `AgentRoster` — fetch `/api/agents` (no `workspace_id`), render avatar + name + role + status badge. Filter `is_master` first if helpful.

7. **Cleanup** (30 min)
   - Delete `WorkspaceDashboard.tsx` (factor `CreateWorkspaceModal` into a shared file first).
   - Delete dead imports.
   - Run `npm run lint && npm run build`.

8. **Manual smoke** (30 min)
   - Visit `/`. See sidebar + dashboard.
   - Click a workspace → land on `/workspace/[slug]`.
   - Create a task → button is light blue.
   - With gateway up: token widget shows real numbers (or honest "$—, N tokens" for OAuth).
   - With gateway down: widget shows offline state.

**Total estimate:** ~6–8 hours focused work.

---

## Handoff

**To:** Stark
**Needs:**
- Confirmation from Harish on (a) sky-400 vs sky-300 for `mc-accent-blue`, (b) accept tokens-only display for OAuth-auth path or require API-key pricing config, (c) whether MC should also persist gateway usage into `cost_events` now (out of scope unless he says yes).
- This file as the source of truth for the spec.

Ship in **two PRs** if Harish prefers small reviews:
- PR1: tokens (steps 1–3) — pure backend + 1-line UI.
- PR2: UI refactor (steps 4–7) + cleanup.

Otherwise one PR is fine.

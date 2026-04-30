# Autensa Nexus — Changelog (Phases 1-12)

Built on `feature/nexus` branch. The full spec is at
[`docs/plans/AUTENSA_NEXUS_BUILD_PROMPT.md`](./AUTENSA_NEXUS_BUILD_PROMPT.md).

This doc is the cross-phase summary the original spec asked for in Phase 12
(README + migration + env vars + skills guide). Per-commit detail lives in
`git log --oneline main..feature/nexus`.

---

## Architectural decisions kept across the build

1. **Convoys table reused as missions** — UI says "mission", DB says
   `convoys` / `convoy_subtasks`. No DDL rename.
2. **Single active mission, globally** — enforced at PATCH
   `/api/missions/[id]/stage` with 409 + `conflicting_mission` payload.
3. **Sequential subtasks by default** — convoy auto-drain only dispatches
   one subtask at a time. Phase 6 auto-propose preserves this.
4. **Fury auto-provisioned** — Migration 032 seeds Fury (planner, lead,
   global) when no planner agent exists.
5. **Missions are a rich card list, not a kanban** — kanban only inside a
   mission detail's Tasks tab.
6. **Auto-propose approval** — initial subtasks land as `inbox`; follow-ups
   from Fury after completion land as `planner_proposed` and require
   user approve/reject.
7. **SQLite WAL only.** No DB swap.
8. **One Lead Agent, prompt-injected** — `is_lead=1` on a single row;
   dispatch prepends the lead block to every other agent's message.
9. **Per-agent skills** — `agent_skills` table; injected at dispatch.
10. **Dark/Light theme** — `<html class="theme-light">` + CSS-var overrides.

---

## Migrations added

| ID  | Name                              | Purpose |
|-----|-----------------------------------|---------|
| 032 | `nexus_phase_1_mission_columns`   | Adds Nexus mission columns to `convoys`; expands `tasks.status` CHECK with `'planner_proposed'`; adds `agents.is_lead`, `agents.is_global`; creates `codebase_cache`; seeds Fury planner if absent. |
| 033 | `nexus_phase_7_agent_skills`      | Creates `agent_skills` (id, agent_id, skill_type CHECK, skill_name, skill_config JSON, enabled). Seeds role-default skills for every agent. |
| 034 | `nexus_phase_8_memory_summaries`  | Creates `memory_summaries` (id, agent_id, session_id, summary, token_count). |
| 035 | `nexus_phase_10_cron_jobs`        | Creates `cron_jobs`. Seeds Agent Health Check (@every 5m) and Memory Summarize (@hourly). |

---

## Sidebar nav

Order top → bottom:

```
🦞 Mission Control      → /             (dashboard)
🗂  Workspaces           → /workspaces
🤖 Agents                → /agents
💬 Chat                  → /chat
📊 Sessions              → /sessions
⏰ Crons                 → /crons
🚀 Autopilot             → /autopilot
📡 Activity              → /activity
```

Bottom of sidebar: Sessions / Tokens dynamic widgets, Theme toggle (Sun/Moon),
Collapse button.

---

## Routes shipped (Nexus)

### Workspaces (Phase 2)

| Method | Route | Notes |
|---|---|---|
| GET / POST | `/api/workspaces` | (existing, verified) |
| GET / PATCH / DELETE | `/api/workspaces/[id]` | (existing) |

### Missions (Phase 2-6)

| Method | Route | Notes |
|---|---|---|
| GET / POST | `/api/missions` | Full Nexus shape: `enable_pipeline`, `codebase_path`, `git_branch`, `tech_stack_hint`, `success_criteria`, etc. |
| GET / PATCH / DELETE | `/api/missions/[id]` | DELETE explicitly cleans NO ACTION FK refs (events/agent_health/openclaw_sessions/cost_events/etc) before dropping the parent task. |
| PATCH | `/api/missions/[id]/stage` | Single-active enforcement (409 with `conflicting_mission`). |
| POST | `/api/missions/[id]/start-planning` | Kicks off Fury planning via `chat.send`. |
| GET | `/api/missions/[id]/questions` | Lists the planning question set. |
| POST | `/api/missions/[id]/answer` | Persists locally + forwards to Fury via `chat.send`. |
| POST | `/api/missions/[id]/planning/poll` | Reads `chat.history`, persists new questions, materialises the spec when Fury emits `status:'complete'`. |
| POST | `/api/missions/[id]/team/sync` | Propagates parent's workflow_template + task_roles to every subtask. |
| POST | `/api/missions/[id]/propose` | Manual auto-propose trigger. |
| POST | `/api/missions/[id]/proposals/poll` | Harvests Fury's proposals into `planner_proposed` rows. |
| POST | `/api/missions/[id]/playwright/run` | Server-side Playwright runner. |

### Agents + Skills (Phase 7)

| Method | Route | Notes |
|---|---|---|
| GET / POST / PATCH / DELETE | `/api/agents`, `/api/agents/[id]` | (existing) |
| POST | `/api/agents/[id]/set-lead` | Demotes prior lead; broadcasts `agent_health_changed`. |
| GET / DELETE | `/api/agents/[id]/memory` | List + clear. |
| GET / POST | `/api/skills` | Filter by `agent_id`. |
| PATCH / DELETE | `/api/skills/[id]` | Update / delete. |
| PATCH | `/api/skills/[id]/toggle` | Flip enabled. |

### Sessions (Phase 9) and Chat (Phase 11)

| Method | Route | Notes |
|---|---|---|
| GET | `/api/openclaw/sessions/history` | Proxies `chat.history` for transcript view. |
| POST | `/api/chat/sessions/new` | Derives `agent:NAME:user-chat:<uuid>` sessionKey. |
| POST | `/api/chat/send` | Sends to gateway via `chat.send`. Accepts ≤4 base64 attachments (≤5MB each) folded into `<attachments>` block. |

### Crons (Phase 10)

| Method | Route | Notes |
|---|---|---|
| GET / POST | `/api/crons` | Self-starts the runner singleton on first import. |
| PATCH / DELETE | `/api/crons/[id]` | Re-validates schedule; resets `next_run` on enable. |
| PATCH | `/api/crons/[id]/toggle` | |
| POST | `/api/crons/[id]/run-now` | Fires the action outside the schedule. |

---

## Skills guide

`agent_skills` rows are injected at dispatch by
`src/lib/agentSkills.ts`. Four skill types:

| Type | `skill_config` shape | Effect on dispatch message |
|---|---|---|
| `shell` | `{ command: string, description?: string }` | Listed under "Available shell tools" with a literal command preview. |
| `mcp` | `{ url: string, name?: string }` | Listed under "MCP servers". |
| `prompt_inject` | `{ content: string }` | Appended to the system prompt as a `### name` block. |
| `file_access` | `{ paths: string[], read_only?: boolean }` | Listed under "File access" with read mode. |

Default seeds per role (Migration 033):

- **planner**: web_search (prompt_inject), codebase_read (file_access)
- **builder**: git (shell), filesystem_write (file_access)
- **tester**: playwright (shell `npx playwright test --reporter=json`), codebase_read (file_access)
- **reviewer**: git_diff (shell), filesystem_read (file_access)

---

## Cron action types (Phase 10)

`src/lib/cron/actions.ts`:

| `action_type` | Effect |
|---|---|
| `agent_health_check` | Runs the existing `runHealthCheckCycle()`. |
| `memory_summarize` | Walks completed `openclaw_sessions` newer than `last_run` and fires `summarizeFromSession` for each. 30-min summarizer dedupe avoids duplicates. |
| `auto_propose` | Calls `triggerProposal` on every `mission_stage='in_progress'` mission (capped by `config.limit`, default 5). |
| `codebase_scan` | Stub — Phase 5b deliverable. |
| `custom` | `fetch(config.url, { method, headers, body })` with 30s timeout. |

Schedule format supported: 5-field cron, `@hourly` / `@daily` / `@weekly` /
`@monthly`, `@every 30s` / `@every 5m` / `@every 2h`.

---

## Env vars

The build adds nothing required beyond what was already in `.env.local`:

```
OPENCLAW_GATEWAY_URL=ws://localhost:18789   # existing
OPENCLAW_GATEWAY_TOKEN=...                  # existing
AUTOPILOT_MODEL=claude-sonnet-4-6           # existing — used as planner default fallback
PLANNER_MODEL=...                           # optional — used by completeJSON path (currently disabled)
PORT=4000                                   # dev server
```

---

## Phase summary table

| # | Phase | Commit prefix | Status |
|---|---|---|---|
| 1 | DB foundation (Migration 032 + types/Zod + Fury seed) | `feat(phase-1)` | ✅ |
| 2 | Mission API (CRUD + single-active enforce + DELETE FK cleanup) | `feat(phase-2)` | ✅ |
| 3 | Mission UI (rich card list, MissionModal with Nexus fields, backlog-first) | `feat(phase-3)` | ✅ |
| 4 | Mission detail (4 tabs + pipeline stepper + Proposed kanban column) | `feat(phase-4)` | ✅ |
| 5 | Fury planning pipeline via `chat.send` / `chat.history` | `feat(phase-5)` + `5b` | ✅ |
| 5b | Real Fury (no static fallback), workflow_template + task_roles auto-wire, SSE-driven live refresh, Team tab | `feat(phase-5b)` | ✅ |
| 6 | Auto-propose loop | `feat(phase-6)` | ✅ |
| 7a | Skills foundation + dispatch injection | `feat(phase-7a)` | ✅ |
| 7b | `/agents` + `/agents/[id]` pages, skills CRUD | `feat(phase-7b)` | ✅ |
| 7c | Lead orchestration + Playwright runner + Tests tab UI | `feat(phase-7c)` | ✅ |
| 8 | Memory system (capture on session end, preload at dispatch) | `feat(phase-8)` | ✅ |
| 9 | `/sessions` dashboard (stats, charts, table, transcript) | `feat(phase-9)` | ✅ |
| 10 | `/crons` cron manager (parser, runner, actions, UI) | `feat(phase-10)` | ✅ |
| 11 | `/chat` full chat UI with slash commands + file uploads | `feat(phase-11)` | ✅ |
| 12 | Polish — dark/light theme + error boundaries + this changelog | `feat(phase-12)` | ✅ |

---

## Known carry-overs / future work

- **Codebase analyzer (§6.1 of spec)** — `codebase_cache` table exists; the
  walker + Fury summarisation step is intentionally deferred. `codebase_scan`
  cron action is a stub today.
- **Per-agent agent dedupe pass** — `is_global=1` is set on all current
  agents but a workspace-merge run hasn't happened. Largely cosmetic
  given the data we have.
- **Cost cap progress bar on `/sessions`** — depends on `cost_caps` rows
  the user creates explicitly.
- **Tool call expansion blocks in chat** — gateway returns text-only
  here, so we render verbatim and pretty-print JSON when present. Real
  structured tool blocks would need a different gateway return shape.
- **True token-streaming on chat** — gateway exposes RPC, not SSE for
  chat. We poll every 2s instead. Acceptable for v1.

# Autensa Nexus — Complete Agent Build Prompt

**Source:** User-provided full build spec for Stark agent
**Stored:** 2026-04-30
**Base Repo:** https://github.com/crshdn/mission-control (Autensa v2)
**Stack:** Next.js 14 App Router · TypeScript · SQLite WAL · Tailwind CSS · OpenClaw Gateway WebSocket (port 18789) · Docker · Zod · better-sqlite3

This document is the canonical reference for the Autensa Nexus extension to Mission Control. Read it before working any phase.

---

## Section 0 — Who You Are and What You Are Building

You are Stark, a senior full-stack engineer agent. Your job is to extend the existing crshdn/mission-control (Autensa v2) repository into a professional-grade, all-purpose Mission Control platform for running autonomous AI agent teams on real projects.

**DO NOT rebuild from scratch.** Autensa already has:
- Task kanban with AI planning Q&A flow
- Convoy/subtask mode (DAG parallel agent execution)
- OpenClaw Gateway WebSocket integration (port 18789)
- Live feed of agent events via SSE
- Cost tracking, session isolation per task
- Bearer token auth, Zod validation, HMAC webhooks
- Docker-ready, SQLite WAL database
- 80+ API routes already working

Add new features ON TOP of this foundation without breaking anything. Read existing implementations before touching any file. **Add — do not replace.**

---

## Section 1 — Existing Codebase: Understand This First

Before writing a line of code, read and fully understand:

```
src/lib/db/                        → SQLite connection and all query helpers
src/app/api/tasks/                 → Task CRUD, planning, dispatch, convoy
src/app/api/agents/                → Agent management, health, discovery
src/app/api/openclaw/              → Gateway proxy endpoints
src/app/api/webhooks/              → Agent completion webhooks
src/components/MissionQueue.tsx    → Existing task kanban board
src/components/PlanningTab.tsx     → Existing AI planning Q&A flow
src/components/AgentsSidebar.tsx   → Agent panel
src/components/LiveFeed.tsx        → Real-time event stream
src/components/TaskModal.tsx       → Task create/edit modal
src/app/workspace/[slug]/page.tsx  → Workspace dashboard (main page)
src/lib/openclaw/                  → Gateway WebSocket client + device identity
src/lib/validation.ts              → All Zod schemas
src/lib/types.ts                   → All TypeScript types
src/middleware.ts                  → Auth middleware
```

**DB tables you must NOT break:** tasks, agents, openclaw_sessions, convoys, convoy_subtasks, agent_health, work_checkpoints, agent_mailbox, workspace_ports, workspace_merges, cost_events, cost_caps, products, research_cycles, ideas, swipe_history, operations_log

Follow existing patterns exactly for new routes, components, and DB queries.

---

## Section 2 — Overall Vision

The final product is a professional Mission Control — the single place where a developer manages their entire AI agent workforce. The user should never need to open a terminal or another dashboard. Everything — missions, agents, tasks, sessions, memory, crons, chat — lives here.

### Key Philosophy Decisions (NON-NEGOTIABLE)

1. **ONE MISSION ACTIVE AT A TIME**
   Only one mission can be `in_progress` across the entire Mission Control, regardless of how many workspaces exist. Enforce at the API level: before setting any mission to `in_progress`, verify no other mission has that status. Return clear error if violated.

2. **COMMON AGENTS ACROSS WORKSPACES (not per-workspace)**
   Agents are global — they exist once and can be assigned to any workspace/mission. Migration: merge/deduplicate existing per-workspace agent records. New missions: assign from the global pool, don't auto-create.

3. **SEQUENTIAL SUBTASKS by default** (not parallel)
   Subtasks within a mission run one at a time. Existing convoy parallel mode preserved as advanced toggle ("Enable parallel mode") on the mission card. Default: sequential.

4. **FURY AUTO-PROVISIONED**
   On first startup (or if no Planner agent exists), auto-provision one global Planner agent named "Fury". Check existing `agents` for `role='planner'` first. If OpenClaw Gateway has a matching agent, import it instead of creating a duplicate.

5. **MISSIONS ARE A RICH LIST, NOT KANBAN**
   Mission view = rich card list with status indicators, progress bars, action buttons. ONLY the subtasks within a mission use the kanban board (reuse existing `MissionQueue.tsx`).

6. **AUTO-PROPOSE APPROVAL FLOW**
   Initial planning subtasks are auto-approved (agents begin immediately). Tasks proposed by Fury AFTER the initial set is completed require human approval. Approval flow: `Proposed` column → click `Approve` → moves to `Todo` → agent picks up.

7. **SQLITE ONLY** — keep everything in SQLite WAL.

8. **LEAD AGENT — elevated role**
   One agent can be designated `is_lead=1` per Mission Control (only one at a time). Setting a new Lead automatically demotes the previous. Lead's prompt gets coordination instructions; all other agents' prompts get awareness of who the Lead is. Special UI: gold border + 👑 badge.

9. **PER-AGENT SKILLS**
   Skills are scoped to the agent, not the workspace — they follow the agent. Types: `shell`, `mcp`, `prompt_inject`, `file_access`. Injected at agent spawn time.

10. **DARK/LIGHT THEME**
    Toggle in Settings. Default dark. CSS variables for instant switch.

---

## Section 3 — Database Migration (Phase 1)

Create `scripts/migrate-v3.js`. Idempotent (safe to run multiple times). Run as the first step.

### Table: workspaces

```sql
id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))))
name         TEXT NOT NULL
path         TEXT NOT NULL  -- local filesystem path of the project
description  TEXT
created_at   TEXT DEFAULT CURRENT_TIMESTAMP
updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
```

If a workspaces table already exists, migrate it. If currently slugs only, convert.

### Table: missions

```sql
id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))
workspace_id             TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
title                    TEXT NOT NULL
description              TEXT NOT NULL
status                   TEXT DEFAULT 'todo'
                         CHECK(status IN ('todo','planning','in_progress','testing','done','paused'))
enable_pipeline          INTEGER DEFAULT 1
enable_existing_codebase INTEGER DEFAULT 0
codebase_path            TEXT
git_branch               TEXT
tech_stack_hint          TEXT
success_criteria         TEXT
codebase_summary         TEXT
planning_started         INTEGER DEFAULT 0
total_tasks              INTEGER DEFAULT 0
completed_tasks          INTEGER DEFAULT 0
proposed_tasks_count     INTEGER DEFAULT 0
active_agents_count      INTEGER DEFAULT 0
created_at               TEXT DEFAULT CURRENT_TIMESTAMP
updated_at               TEXT DEFAULT CURRENT_TIMESTAMP
```

### Table: mission_tasks (junction)

```sql
id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))))
mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE
task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
sort_order  INTEGER DEFAULT 0
created_at  TEXT DEFAULT CURRENT_TIMESTAMP
UNIQUE(mission_id, task_id)
```

Also: `ALTER TABLE tasks ADD COLUMN mission_id TEXT REFERENCES missions(id)`. Add `'planner_proposed'` to the task status Zod enum.

### Table: agent_skills

```sql
id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))))
agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE
skill_type   TEXT NOT NULL CHECK(skill_type IN ('shell','mcp','prompt_inject','file_access'))
skill_name   TEXT NOT NULL
skill_config TEXT NOT NULL DEFAULT '{}'
enabled      INTEGER DEFAULT 1
created_at   TEXT DEFAULT CURRENT_TIMESTAMP
```

### Table: codebase_cache

```sql
id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))))
mission_id   TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE
summary      TEXT
file_tree    TEXT      -- JSON array of {path, size, extension}
tech_stack   TEXT      -- JSON array
last_scanned TEXT DEFAULT CURRENT_TIMESTAMP
diff_hash    TEXT
```

### Table: memory_summaries

```sql
id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))))
agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE
session_id  TEXT
summary     TEXT NOT NULL
token_count INTEGER DEFAULT 0
created_at  TEXT DEFAULT CURRENT_TIMESTAMP
```

### Table: cron_jobs

```sql
id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))))
name            TEXT NOT NULL
schedule        TEXT NOT NULL   -- cron expression
action_type     TEXT NOT NULL
                CHECK(action_type IN ('codebase_scan','memory_summarize',
                                      'agent_health_check','auto_propose','custom'))
action_config   TEXT DEFAULT '{}'
last_run        TEXT
last_run_status TEXT
next_run        TEXT
enabled         INTEGER DEFAULT 1
created_at      TEXT DEFAULT CURRENT_TIMESTAMP
```

### Agents table additions

```sql
ALTER TABLE agents ADD COLUMN is_lead    INTEGER DEFAULT 0
ALTER TABLE agents ADD COLUMN role       TEXT DEFAULT 'general'
ALTER TABLE agents ADD COLUMN is_global  INTEGER DEFAULT 1
```

Update existing records: set `is_global=1`. Deduplicate per-workspace agents with same role — keep one, delete duplicates.

### Seed data

- If no agent with `role='planner'` exists: insert Fury (`name='Fury', role='planner', is_global=1`). If gateway has matching "fury", import that.
- Default skills per role:
  - **planner:** web_search (prompt_inject), codebase_read (file_access)
  - **builder:** git (shell `git`), filesystem_write (file_access: workspace path)
  - **tester:** playwright (shell `npx playwright test --reporter=json`)
  - **reviewer:** git_diff (shell `git diff`), filesystem_read (file_access: readonly)

---

## Section 4 — Navigation & Page Structure

```
┌─────────────────────────┐
│  ⚡ Autensa Nexus       │
├─────────────────────────┤
│  🏠 Dashboard           │  → /dashboard
│  🗂  Workspaces         │  → /workspaces
│  🤖 Agents              │  → /agents
│  💬 Chat                │  → /chat
│  🕐 Sessions            │  → /sessions
│  ⏰ Crons               │  → /crons
│  ⚙️  Settings           │  → /settings
└─────────────────────────┘
```

Routes:
```
/dashboard                          → stats overview
/workspaces                         → list of all workspaces
/workspaces/[id]                    → missions list for that workspace
/workspaces/[id]/missions/[mId]     → mission detail (task kanban + live feed)
/agents                             → all agents management
/agents/[id]                        → agent detail (skills, memory, chat)
/chat                               → full OpenClaw chat UI
/sessions                           → sessions + token usage dashboard
/crons                              → cron job manager
/settings                           → app settings
```

---

## Section 5 — Page Specifications

### /dashboard

Stats cards row:
- Active Mission (name + workspace + progress) or "No active mission"
- Total Agents (count + online count)
- Tasks Today (completed today / total today)
- Token Usage Today (input + output, est. cost)
- Sessions This Week

Below stats: Recent Activity feed (last 20 events), Active agents panel, Quick links: "Start New Mission", "Open Chat", "View Sessions".

### /workspaces

- Header: "Workspaces" + "New Workspace" button
- Grid of workspace cards: name, path (truncated, copy button), mission count, last activity, "Open" → `/workspaces/[id]`, edit/delete icons (delete confirms)
- New Workspace modal: name (required), filesystem path (required, "Browse" if desktop), description. POST `/api/workspaces` → redirect to new workspace page.

### /workspaces/[id] (Mission List — NOT a kanban)

Header: workspace name + path + "New Mission". Filter bar: All / Todo / Planning / In Progress / Testing / Done / Paused.

Mission cards (vertical, full-width, rich UI):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [STATUS BADGE]  Mission Title                          [⋮ menu] [actions] │
│ Description text (2 lines max, truncated)                                │
│                                                                          │
│ ████████████████░░░░░░░░░░  12 / 20 tasks completed                     │
│                                                                          │
│ 🤖 3 agents working  │  📋 5 pending tasks  │  ✨ 2 new proposed         │
│                                                                          │
│ 🧬 Existing Codebase  │  🌿 branch: feature/auth  │  ⏱ 2h ago           │
└──────────────────────────────────────────────────────────────────────────┘
```

**Status badge colors:** todo (gray), planning (blue, pulsing if Fury active), in_progress (green, pulsing), testing (amber), done (muted green), paused (orange).

**Action buttons by status:**
- todo + pipeline + !planning_started: "▶ Start Planning" (primary CTA)
- todo + !pipeline: "▶ Begin"
- planning: "View Planning"
- in_progress: "View Tasks"
- testing: "View Tests"
- done/paused: "View"
- All: ⋮ menu → Edit, Pause, Delete (confirm)

**ENFORCED:** Only ONE mission can be `in_progress` globally. Error: "Another mission is already in progress. Complete or pause it first."

**New Mission modal fields:** Title, Description (textarea — feeds Fury context), Enable Pipeline toggle (default ON), Enable Existing Codebase toggle (default OFF), Codebase Path (validate exists on disk, shown if existing codebase), Git Branch (optional), Tech Stack Hint (optional), Success Criteria (optional textarea). POST `/api/missions` → card appears with status=todo.

### /workspaces/[id]/missions/[mId] (Mission Detail)

**Tabs: Overview | Task Board | Live Feed | Test Results** (Test Results visible when status='testing' or after).

**Overview:** mission info, codebase analysis status (with "Analyze Codebase" button + progress + summary), clarification chat (visible during planning — Fury asks Q&A, user answers, "Done — Generate Tasks"), mission stats (created, last updated, total cost estimate).

**Task Board (THIS is the kanban — reuse `MissionQueue.tsx`):**
Columns: Backlog | In Progress | In Review | Done | **Proposed** (new). Proposed column: planner_proposed tasks with purple "AI Proposed" badge, "✓ Approve" + "✗ Reject" per card, "Approve All" at top. "Add Task" button in Backlog. Sequential mode: only one task `in_progress` at a time. Cards show assigned agent name + avatar.

**Live Feed:** reuse `LiveFeed.tsx`. Filter by agent/event type. Agents panel on right.

**Test Results:** Playwright summary bar (X passed / Y failed / Z skipped), expandable test list, error messages, "Re-run Tests" button. Failed tests auto-generate proposed subtasks.

### /agents

Header: "Agents" + "Add Agent". Cards grid:

```
┌─────────────────────────────────────────┐
│ 👑 LEAD    🟢 Online                    │
│ Fury                                    │
│ Role: Planner                           │
│ Skills: web_search, codebase_read       │
│ Memory: 12 summaries  │  Sessions: 47   │
│ [Chat] [View] [Configure]               │
└─────────────────────────────────────────┘
```

Lead card: gold border + 👑 badge. ⋮ menu has "Set as Lead" (auto-demotes prior). Add Agent modal: name, role dropdown (planner/builder/tester/reviewer/general/custom), custom role title (if custom), description (auto-updates soul files), system prompt starter (optional, AI-generatable), Is Lead toggle, Import from Gateway checkbox.

When new agent added: auto-update soul.md and agent awareness files in OpenClaw to include the new team member.

### /agents/[id]

**Tabs: Chat | Skills | Memory | Sessions | Settings**

- **Chat:** direct chat with this agent. Slash `/task "title"` creates and assigns. Shows agent's system prompt summary at top.
- **Skills:** list (type icon, name, config preview, enabled toggle). "Add Skill" modal per type: Shell (name, command template, description), MCP (name, server URL), Prompt Inject (name, content), File Access (name, allowed paths, read-only toggle). Skills are global to agent — they follow it.
- **Memory:** list of stored summaries (date, session link, text, tokens), search bar, "Clear All Memory" (confirm). Auto-injected into agent context at session start.
- **Sessions:** filtered sessions table for this agent. Click row → expandable detail.
- **Settings:** edit name/role/description, Set as Lead toggle, model assignment dropdown (from gateway model list), delete (confirm).

### /chat (Full OpenClaw Chat UI)

Primary chat — no need to open OpenClaw's own UI.

**Layout:** left = conversation/session list + new session button; center = chat window; right (collapsible) = model selector, agent selector, context info.

**Features:**
- Model selector (dropdown from gateway)
- Session selector (from `openclaw_sessions`) + "New Session" (`/new`)
- Agent selector (default: Lead Agent)
- SSE streaming token-by-token
- File upload: drag-drop images and PDFs → base64 → attach as document/image content block
- Slash commands: `/new`, `/agent [name]`, `/model [name]`, `/task "title"`, `/mission [id]`
- Tool call display: collapsible "🔧 Used: [tool_name]" → input + output
- Mission-aware: from a mission page, pre-load mission description + codebase summary
- Message history: sender, role, timestamp, copy button

### /sessions

Top row stats cards: Total Sessions (all-time), Total Input Tokens (this month), Total Output Tokens (this month), Estimated Cost (this month).

Charts (recharts — already in project):
- Line: daily token usage (input vs output) — last 30 days
- Pie: token distribution by model
- Bar: cost per agent — last 7 days

Sessions table: Session ID | Agent | Task | Model | Input | Output | Est. Cost | Status | Duration | Date. Sortable headers, filter by agent/model/date range, paginated 25/page. Row click → expandable message history. Export CSV button.

If `cost_caps` has a limit: progress bar "Monthly Budget: $XX of $YY used" with green/amber/red.

### /crons

Header: "Cron Jobs" + "Add Cron". Table: Name | Schedule (human-readable) | Action | Next Run (countdown "in 4h 23m") | Last Run | Last Status | Enabled toggle | Actions.

Add/Edit modal: Name, Schedule (cron expression with helper showing next 3 run times), Action Type (Codebase Scan / Memory Summarize / Agent Health Check / Auto Propose / Custom), Action Config (JSON or form for built-in types), Enabled toggle.

Use `node-cron` server-side. Poll `cron_jobs` on startup, register all enabled. Dynamic enable/disable without restart. Pre-seeded built-ins: Agent Health Check (every 5min), Memory Summarize (every hour for completed sessions).

### /settings

**Sections:**
- **Appearance:** theme Dark/Light toggle (localStorage + CSS class), UI Density (Compact/Comfortable)
- **Gateway Connection:** URL (default `ws://localhost:18789`), Bearer Token, status indicator + "Test Connection"
- **Agent Defaults:** default model for Planner/Builder/Tester/Reviewer (dropdown from gateway models)
- **Cost Management:** monthly budget cap (USD), alert threshold % of budget
- **Mission Defaults:** Default Enable Pipeline (toggle), Default Sequential subtask execution (toggle)

---

## Section 6 — Core Services & Backend Logic

### Fury Planning Pipeline (`src/lib/missions/planningPipeline.ts`)

**Trigger:** "Start Planning" on mission with `enable_pipeline=1`.

**Step 1 — Codebase Analysis** (if `enable_existing_codebase=1`):
- Walk `codebase_path` recursively. Ignore: `node_modules .git __pycache__ dist build .next target`. Collect `{path, size, extension}`.
- Detect tech stack: `package.json + next.config.*` → Next.js; `package.json` only → Node.js; `requirements.txt`/`pyproject.toml` → Python; `Cargo.toml` → Rust; `go.mod` → Go; `pom.xml`/`build.gradle` → Java; `*.csproj` → .NET.
- Read content of up to 50 most significant files (READMEs, configs, entry points, main src).
- Call gateway with Fury: generate ~500-word technical summary (architecture, key modules, tech stack, patterns, areas for improvement).
- Store in `codebase_cache` (mission_id, summary, file_tree, tech_stack, last_scanned, diff_hash). Update `missions.codebase_summary`.
- Stream progress via SSE: `{stage, progress 0-100, message}`.

**Step 2 — Clarification:**
- Set mission `status='planning'`, `planning_started=1`.
- Spawn Fury with: title + description + codebase_summary + success_criteria + tech_stack_hint.
- Fury generates 3-7 clarifying questions (JSON array of strings).
- Show in Overview tab clarification chat. User answers each.
- User clicks "Done — Generate Tasks".

**Step 3 — Subtask Generation:**
- Send Fury full context: mission + codebase summary + all Q&As.
- Fury outputs JSON array:
  ```ts
  [{
    title: string,
    description: string,
    agent_role: 'planner'|'builder'|'tester'|'reviewer',
    priority: 1-5,
    dependencies: number[], // indices
    estimated_hours: number,
    files_to_modify?: string[]
  }]
  ```
- Parse + validate. Insert tasks: `mission_id` set, `status='todo'` (NOT `planner_proposed` — initial set is auto-approved), assigned to agent matching role, `sort_order` based on dependencies.
- Insert into `mission_tasks` junction. Update `missions.total_tasks`.
- Set mission `status='in_progress'` (after single-active check).
- Begin sequential execution: pick first task by sort_order → dispatch.

### Sequential Task Executor (`src/lib/missions/taskExecutor.ts`)

- Find next `'todo'` task for mission (lowest sort_order).
- Verify no other task for this mission is currently `'in_progress'`.
- Dispatch to assigned agent (use existing dispatch logic).
- On webhook completion: update `missions.completed_tasks`. Call `checkMissionComplete()` — if all non-proposed done, trigger Auto-Propose Loop. Else pick next.

### Auto-Propose Loop (`src/lib/missions/autoPropose.ts`)

**Trigger:** when `completed_tasks = total_tasks`.

1. Diff-based codebase re-scan (compare new git HEAD or mtime hash vs stored `diff_hash`).
2. Re-analyze only changed files. Update `codebase_summary` incrementally.
3. Spawn Fury with: original description + updated summary + completed task list (titles + descriptions) + instruction: "Propose new subtasks that would further improve this project. Focus on quality, edge cases, testing gaps, performance, documentation, or features that logically follow from what was built."
4. Fury outputs JSON array (same format as initial). Parse → insert with `status='planner_proposed'`. Update `missions.proposed_tasks_count`.
5. Push WebSocket event: `{type:'mission_proposals', mission_id, count}`.
6. Frontend toast: "✨ Fury proposed X new tasks for [mission]" with "Review" → mission detail → Task Board → Proposed.
7. Mission stays `'in_progress'`. Fury can propose indefinitely. Mission only moves to `'done'` via MANUAL user action.

### Skill Injector (`src/lib/skills/index.ts`)

- `loadSkillsForAgent(agentId)`: query `agent_skills` where `agent_id=? AND enabled=1`.
- `injectSkills(baseConfig, skills)`:
  - shell → `allowed_tools` with command template
  - mcp → `mcp_servers` array `{type:'url', url, name}`
  - prompt_inject → append to `system_prompt` with `\n\n---\n` separator
  - file_access → add paths to `file_access_allowlist`

Hook into existing dispatch: call `loadSkillsForAgent` then `injectSkills` BEFORE spawning the OpenClaw session.

### Memory Summarizer (`src/lib/memory/summarizer.ts`)

- `summarizeSession(sessionId, transcript)`: call gateway with summarization prompt: "Summarize what was accomplished in this session in 200 words or less. Include: what was built/changed, decisions made, any open questions or blockers, and files modified. Be specific and technical." Returns `{summary, tokenCount}`.
- `storeMemory(agentId, sessionId, summary, tokenCount)`: insert to `memory_summaries`.
- `loadMemoryContext(agentId, limit=5)`: last N summaries DESC, format:
  ```
  ## Previous Session Context

  [2026-04-28]: Implemented user auth middleware...
  [2026-04-27]: Set up database schema, created migrations...
  ```

Hook: prepend to `system_prompt` at agent spawn. Hook on session completion webhook → `summarizeSession`.

### Playwright Test Runner (`src/lib/skills/playwright.ts`)

- `checkInstalled(workspacePath)`: existence of `node_modules/.bin/playwright`.
- `install(workspacePath)`: `npx playwright install --with-deps chromium`.
- `runTests(workspacePath)`: `npx playwright test --reporter=json` → parse stdout JSON.
- `parseResults(json)`: `{passed, failed, skipped, duration, tests: [{name, status, error?}]}`.

When mission moves to `'testing'`:
1. Install Playwright if missing.
2. Spawn Tester agent with Playwright skill.
3. Tester writes `playwright.config.ts` if absent.
4. Tester writes test files.
5. Run suite → parse → POST `/api/missions/[id]/test-results`.
6. Show in Test Results tab.
7. Failed tests → call `autoPropose` with failure context → proposed tasks per failure.

### Lead Agent Orchestration

- Only one agent has `is_lead=1` at a time (API enforced).
- When set, inject into ALL other agents' system prompts:
  ```
  ## Team Lead
  The lead agent for this team is [name]. You may receive instructions from them.
  They have oversight of all team activities.
  ```
- Lead's own prompt:
  ```
  ## Your Role
  You are the Lead Agent. You coordinate the team, can assign tasks to any agent,
  and have full visibility into all ongoing work.
  ```
- Lead can communicate via existing `agent_mailbox` table.
- UI: gold border + 👑 + "LEAD" label.
- "Set as Lead": `UPDATE agents SET is_lead=0` (all) then `UPDATE agents SET is_lead=1 WHERE id=?`.

---

## Section 7 — API Routes (NEW — all follow existing auth + Zod pattern)

```
POST   /api/workspaces                      — create workspace
GET    /api/workspaces                      — list all workspaces
GET    /api/workspaces/[id]                 — get workspace detail
PATCH  /api/workspaces/[id]                 — update workspace
DELETE /api/workspaces/[id]                 — delete workspace

GET    /api/missions?workspaceId=X          — list missions for workspace
POST   /api/missions                        — create mission
GET    /api/missions/[id]                   — get mission detail
PATCH  /api/missions/[id]                   — update mission fields
DELETE /api/missions/[id]                   — delete mission
PATCH  /api/missions/[id]/status            — change status (single-active enforced)
POST   /api/missions/[id]/start-planning    — trigger Fury planning pipeline (SSE)
POST   /api/missions/[id]/analyze           — trigger codebase analysis only (SSE)
GET    /api/missions/[id]/tasks             — list subtasks for mission
POST   /api/missions/[id]/tasks             — manually add task to mission
POST   /api/missions/[id]/propose           — manually trigger auto-propose
POST   /api/missions/[id]/approve-all       — approve all planner_proposed tasks
POST   /api/missions/[id]/test-results      — store Playwright results
GET    /api/missions/[id]/test-results      — get Playwright results

GET    /api/agents                          — list all agents (global)
POST   /api/agents                          — create agent
GET    /api/agents/[id]                     — get agent detail
PATCH  /api/agents/[id]                     — update agent
DELETE /api/agents/[id]                     — delete agent
POST   /api/agents/[id]/set-lead            — set as lead (demotes others)
GET    /api/agents/[id]/memory              — get memory summaries
DELETE /api/agents/[id]/memory              — clear all memory for agent
POST   /api/agents/[id]/chat                — direct chat with agent (SSE)

GET    /api/skills?agentId=X                — list skills for agent
POST   /api/skills                          — add skill to agent
PATCH  /api/skills/[id]                     — update skill
DELETE /api/skills/[id]                     — delete skill
PATCH  /api/skills/[id]/toggle              — enable/disable skill

GET    /api/sessions                        — list sessions with token aggregation
GET    /api/sessions/[id]                   — get session detail with messages
GET    /api/sessions/stats                  — aggregated token/cost stats for charts

GET    /api/crons                           — list cron jobs
POST   /api/crons                           — create cron job
PATCH  /api/crons/[id]                      — update cron job
DELETE /api/crons/[id]                      — delete cron job
PATCH  /api/crons/[id]/toggle               — enable/disable
POST   /api/crons/[id]/run-now              — manually trigger
```

---

## Section 8 — UI Design Standards

Significantly better than current Autensa. Premium developer-tool feel.

### Color system (CSS vars, dark default)

```
--bg-base:         #0D0D1A
--bg-surface:      #13131F
--bg-elevated:     #1A1A2E
--bg-hover:        #22223A
--border:          #2A2A45
--border-focus:    #6C63FF
--text-primary:    #E8E8F5
--text-secondary:  #9090B0
--text-muted:      #5A5A7A
--accent:          #6C63FF   (electric violet)
--accent-soft:     #A89CFF
--success:         #00C9A7   (teal)
--warning:         #FFB347   (amber)
--danger:          #FF6B6B   (red)
--lead-gold:       #FFD700
```

Light mode: invert backgrounds (white/light gray), keep accent colors.

### Component standards

- Cards: `rounded-xl` (12px), 1px border (--border), subtle shadow
- Status badges: rounded-full pill, colored bg, small text
- Progress bars: rounded-full, gradient (accent → success)
- Buttons: primary (accent bg), ghost (transparent + border), danger (red bg)
- Pulsing dot for active states: 2-second CSS animation
- Modals: backdrop blur, centered, `max-w-2xl`, escapeable
- Toasts: bottom-right, slide-in, auto-dismiss 5s
- Tables: hover row highlight, sticky header
- Empty states: centered icon + helpful message + CTA

### Animations

- Page transitions: fade-in 150ms
- Card hover: subtle `translateY(-2px)` + shadow increase
- Modal: scale from 0.95 + fade
- Progress bar fill: animated on mount
- Status badge pulse: for `in_progress` and `planning`

### Typography

- Font: Inter (Google Fonts or system stack)
- Headings: weight 700
- Body: weight 400, line-height 1.6
- Code/mono: JetBrains Mono or Fira Code

### Layout

- Sidebar: 240px fixed width, collapsible on mobile
- Main: `max-w-screen-xl`, centered, `px-6 py-8`
- Cards grid: CSS grid `auto-fill, minmax(320px, 1fr)`
- Mission list: flex column, gap-4 — NOT a kanban

---

## Section 9 — Implementation Phases (EXECUTE IN ORDER)

| Phase | Day | Scope |
|---|---|---|
| **1** | 1 | DB migration v3 (script, all tables, ALTERs, dedupe, seeds, types/Zod, smoke test) |
| **2** | 1-2 | Workspaces & core mission API (`/api/workspaces/*`, `/api/missions/*`, single-active enforce, `/api/skills/*`) |
| **3** | 2 | Sidebar & navigation refactor; `/workspaces` page; `/workspaces/[id]` (mission list rich cards); New Workspace + New Mission modals; dark/light theme |
| **4** | 3 | Mission detail page (4 tabs); Task Board (reuse MissionQueue + Proposed column); approve/reject; Add Task |
| **5** | 4-5 | Fury Planning Pipeline (CodebaseAnalyzer + SSE; clarification chat; subtask generation; sequential executor; Start Planning button) |
| **6** | 5-6 | Auto-Propose Loop (diff scan; Fury → planner_proposed; WS push + toast; bulk approve) |
| **7** | 6-7 | Global Agents, Skills, Lead Agent (`/agents` + `/agents/[id]` 5 tabs; Skills manager; Skill Injector; Lead orchestration; Fury auto-provision; Playwright skill wired to testing phase) |
| **8** | 7 | Memory System (summarizer wired to session webhook; context loading at agent spawn; viewer + clear; auto-prune cron 30d) |
| **9** | 8 | Sessions Dashboard (table + filters + pagination; recharts charts; cost cap progress; export CSV) |
| **10** | 8-9 | Cron Manager (`/crons` page CRUD; node-cron runner; dynamic enable/disable; built-ins) |
| **11** | 9-10 | Full OpenClaw Chat UI (`/chat` with SSE streaming; model/session/agent selectors; file upload; slash commands; tool call display; mission-aware) |
| **12** | 10 | Dashboard polish (`/dashboard`; error boundaries; loading/error/empty states; mobile; README; security audit; full E2E mission lifecycle) |

Each phase ends green: `npx tsc --noEmit` clean, no console errors, existing features still work. Commit format: `feat(phase-N): description`.

---

## Section 10 — Code Quality Rules (NON-NEGOTIABLE)

1. TypeScript strict mode. No `any` without a comment explaining why.
2. Every API route: Zod validation, auth middleware (existing pattern), `try/catch` returning `{error, code, details?}`, correct HTTP codes (200/201/400/401/404/409/500).
3. Every React component: loading state (skeleton/spinner), error state (message + retry), empty state (icon + message + CTA), no unhandled promise rejections.
4. Database: WAL mode (don't change). Parameterized statements only. Long ops use transactions.
5. Do NOT remove existing code. Modify by adding. Only remove if directly replaced by something better.
6. Follow existing file/naming conventions exactly.
7. If unsure about an existing pattern, READ first then follow.
8. Test each phase before commit: existing features still work, new features work, `npx tsc --noEmit` clean, no console errors.
9. Commit format: `feat(phase-N): description`.

---

## Section 11 — Environment Variables (.env.example)

**Existing (unchanged):**
```
OPENCLAW_GATEWAY_URL=ws://localhost:18789
OPENCLAW_BEARER_TOKEN=your_token_here
AUTOPILOT_MODEL=claude-sonnet-4-6
NEXT_PUBLIC_APP_URL=http://localhost:4000
```

**New:**
```
FURY_AGENT_NAME=Fury           # Name to use/match for auto-provisioned planner
MAX_CODEBASE_FILES=50          # Max files to read for codebase analysis
MEMORY_RETENTION_DAYS=30       # Days before memory summaries are pruned
SEQUENTIAL_TASKS=true          # Default to sequential task execution
DEFAULT_THEME=dark             # 'dark' or 'light'
```

---

## Section 12 — Future-Ready Architecture Notes

Build with these in mind (don't implement now, but don't block):

- **Multi-provider:** Anthropic, OpenAI, Gemini per agent. Hook = model assignment per agent in Settings. Gateway routes via `x-openclaw-model` header (already exists).
- **GitHub/GitLab:** Builder's git skill evolves to GitHub MCP. Hook = `git_branch` field on missions. PR auto-creation = skill config option.
- **Google Workspace / Notion / Email:** MCP skills. The skill system is designed for this. Add Notion = add MCP skill with Notion server URL.
- **Team/RBAC:** the `is_global` agent model and viewer/operator/admin pattern from builderz-labs/mission-control can layer on top.
- **Vector memory:** extend `memory_summaries` with embedding column. Hook = summarizer service.

---

## Handoff Checklist (verify before starting)

- ✅ Cloned: https://github.com/crshdn/mission-control
- ✅ Installed: `npm install`
- ✅ Configured: `.env.local` with gateway URL + token
- ✅ Running: OpenClaw Gateway on port 18789
- ✅ Read: all files in Section 1
- ✅ Ready: start with Phase 1 (migration script)

Good luck, Stark. Build it right.

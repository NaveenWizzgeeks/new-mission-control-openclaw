# Mission Control Upgrade — Implementation Plan

**Author:** Fury (planner)
**Requested by:** Jarvis (lead) → Harish (owner)
**Repo:** `~/.openclaw/missions/autensa-spike` (branch `feature/mission-orchestration`)
**Spike status (2026-04-29):** GREEN — Builder→Tester→Reviewer chain proven via gateway in 46s
**Target executor:** Stark

## Revision History

**2026-04-29 — Rev 1 (Harish answers Q1–Q10, Stark mid-Phase 0)**

Phase 0 (Feature 0) is preserved verbatim from Rev 0; Stark is currently executing on `mc-upgrade/phase-0-convoy-drain`. All other changes are below.

| # | Topic | Decision (delta from Rev 0) |
|---|-------|-----------------------------|
| 1 | Gateway skill-scoping | Confirmed: gateway already supports per-agent scoping. Phase 3 stays at ~2 days; no gateway extension PR. RPC pinned as `agents.describe` (rename if gateway exposes a different name). |
| 2 | `task_chat` mystery | Treated as typo. Phase 1+ work MUST preserve all operator-interjection surfaces: `task_notes`, `agent_mailbox`, `conversations`+`messages`, `/api/tasks/:id/chat` route. |
| 3 | Mission stage source of truth | Confirmed (a): dedicated `convoys.mission_stage` column. Decoupled from task statuses. |
| 4 | Codebase summary cache scope | **Overridden to per-mission** (was per-workspace). New table `mission_codebase_summaries` keyed on `convoy_id`. Opportunistic seed from a prior mission on the same workspace at the same `base_commit` is now in scope as a soft optimisation. |
| 5 | Mission archive | v1 has no archive concept. Done lane stays visible. Filter toggle deferred until noise becomes a real problem. |
| 6 | Auto-propose throttle | Cap at **3 consecutive auto-propose cycles without operator approving any proposed subtask**. After 3, planner stops auto-firing; operator must click "Propose more" manually. Counter resets when operator approves at least one proposed subtask. Tracked on `convoys.auto_propose_streak`. |
| 7 | Phase tags | Confirmed and now mandatory: tag each phase merge as `mc-upgrade-phase-N`. |
| 8 | Workspace path for existing mode | Inline path input on mission-create modal when workspace lacks a path. Validate before allowing mission creation: dir exists, readable, `.git` present (recommended). Persist to `workspaces.path` on success. |
| 9 | Operator vs agent identity | Confirmed: PATCH without `updated_by_agent_id` = operator. No new auth layer for v1. |
| 10 | Decomposition strategy for auto-proposed subtasks | New value `decomposition_strategy='planning_iterative'` for auto-propose-loop output. Initial planner output stays `'planning'`. Cleaner audit trail for analytics + learner replays. CHECK constraint update required. |

## Mission

Upgrade the Autensa MC fork with mission-as-first-class kanban, existing-codebase mode, planner-stays-alive auto-propose loop, role-scoped skill registry, and the master-orchestration loop that auto-drains the convoy DAG between subtasks — without breaking the proven Builder→Tester→Reviewer chain.

## Recon Snapshot (validated against live code, 2026-04-29)

- Working tree clean on `feature/mission-orchestration` (top: `ee9333e wip: PR3 — workspace manager...`)
- Live schema for: `tasks`, `convoys`, `convoy_subtasks`, `workspaces`, `workflow_templates`, `task_roles`, `agent_mailbox`, `task_activities`, `openclaw_sessions`, `planning_questions`, `planning_specs` — all match the brief.
- **`task_chat` table does NOT exist** in the live schema. Brief mentions it; real operator-interjection surfaces are `task_notes` + `agent_mailbox` + `/api/tasks/:id/chat` route + `conversations`/`messages`. **Resolved (Rev 1, Q2):** treat as typo — Stark MUST preserve all four surfaces; do not strip any. See Risk #4.
- Workflow engine (`src/lib/workflow-engine.ts`) already orchestrates per-task role handoffs via `handleStageTransition` and has a queue-drain pattern (`drainQueue`) — that pattern is the model for Feature 0.
- `agents.is_master`, `agents.session_key_prefix`, `agents.gateway_agent_id` already in schema; `is_master` is metadata-only today.
- Dispatch (`src/app/api/tasks/[id]/dispatch/route.ts`) sends to gateway via `chat.send` keyed on `session_key_prefix + openclaw_session_id`. Skills/MCP scoping today comes from gateway-side agent config, not MC.

## Known-Gaps Validation

| # | Gap (from brief) | Verdict | Notes |
|---|------------------|---------|-------|
| 1 | Auto-trigger next subtask on prior completion | CONFIRMED | `tasks/[id]/route.ts` PATCH (L437–446) calls `updateConvoyProgress` + `checkConvoyCompletion` on subtask done, never `convoy/dispatch`. Manual POST required today. |
| 2 | Master-agent orchestration loop | CONFIRMED | `is_master` is a flag only; nothing consumes it. |
| 3 | Convoys → missions rename | CONFIRMED | Pure language/UI work. DB rename optional (recommend SQL view, see Risk #8). |
| 4 | Mission as first-class entity | CONFIRMED | Today: mission ≈ parent task in `convoy_active` status. UI is single task-level kanban (`MissionQueue.tsx`), no mission board. |
| 5 | Heartbeat/cron polling | PARTIAL | `HEARTBEAT.md` describes a manual orchestrator loop. No built-in cron in MC; not needed for MVP if subtask completion is event-driven (it is). |

---

## 1. Per-Feature Breakdown

### Feature 0 — FOUNDATION: auto-drain convoy DAG (master orchestration)

Ships first. Without it, Feature 1's "mission auto-progresses through In Progress" doesn't actually work.

**Existing primitives to extend:**
- `src/app/api/tasks/[id]/convoy/dispatch/route.ts` — already DAG-aware with `MAX_PARALLEL=5`, role auto-assign, `getDispatchableSubtasks`.
- `src/app/api/tasks/[id]/route.ts` PATCH (L437–446) — already calls `updateConvoyProgress` + `checkConvoyCompletion` on subtask done.
- `src/lib/workflow-engine.ts:drainQueue()` — pattern we are mirroring at convoy level.

**Real gaps:**
- (A) Extract the convoy/dispatch route handler into `src/lib/convoy.ts:dispatchReadyConvoySubtasks(convoyId)` so it's callable in-process (no HTTP self-call).
- (B) Call it from `tasks/[id]/route.ts` PATCH right after `updateConvoyProgress` when subtask just transitioned to `done`.
- (C) Call it from `convoy.ts:createConvoy` and from `planning/approve/route.ts` after `createConvoy(...)` so the first wave fires automatically.

**Files to change:**
- `src/lib/convoy.ts` — add `dispatchReadyConvoySubtasks(convoyId)` (extracted)
- `src/app/api/tasks/[id]/convoy/dispatch/route.ts` — refactor to call lib function (route stays as manual override)
- `src/app/api/tasks/[id]/route.ts` — call lib function in subtask-done branch
- `src/app/api/tasks/[id]/planning/approve/route.ts` — call lib function after auto-create

**Scope:** ~½ day.

---

### Feature 1 — Mission as first-class entity + mission-level kanban

**Existing primitives to extend:**
- `convoys` row + parent task = the de-facto mission. Reuse, do not duplicate.
- `convoys.status` (`active|paused|completing|done|failed`) — internal state, NOT mission stage.
- Task-status flow already encodes within-mission lifecycle.

**Real gaps:**
- (A) **Mission stage is not the same as `convoys.status`.** Brief defines `Backlog | Planning | In Progress | Testing | Done`. Add a dedicated column on `convoys` (Q3 confirmed: option (a), decoupled from task statuses):
  ```sql
  ALTER TABLE convoys ADD COLUMN mission_stage TEXT
    DEFAULT 'backlog'
    CHECK (mission_stage IN ('backlog','planning','in_progress','testing','done'));
  ```
  Backfill in migration: derive from current `convoys.status` + parent task status.
- (B) URL hierarchy split:
  - `/workspace/{slug}` → mission kanban (NEW)
  - `/workspace/{slug}/mission/{id}` → drilldown (existing AgentsSidebar | MissionQueue | LiveFeed view, just a route move)
- (C) Drag-rule enforcement: agents auto-move all stages EXCEPT `In Progress → Testing`. Backend rejects agent-initiated transitions to `testing` (Q9 confirmed: PATCH without `updated_by_agent_id` = operator; agent calls always set the field). No new auth layer for v1. The stage-transition route MUST: (i) read `updated_by_agent_id` from PATCH body, (ii) if present AND target stage is `testing`, return 403, (iii) else allow.
- (D) "Awaiting input" badge — derived from `planning_questions WHERE task_id = parent AND answer IS NULL` count, OR proposed-subtask count (Feature 3). No new column needed.
- (E) Auto-progressions agents perform:
  - on convoy create → `planning`
  - on planner approve+convoy ready → `in_progress`
  - on `mission_stage='testing'` verification pass → `done`
  - NEVER `in_progress → testing` from agent path.

**Files / tables to change:**
- DB migration: `convoys.mission_stage` (using existing migration scaffold pattern in `src/lib/db/migrations.ts`)
- NEW `src/app/api/missions/route.ts` — GET (list per workspace), POST (create, replaces "create task with planning")
- NEW `src/app/api/missions/[id]/route.ts` — GET, PATCH
- NEW `src/app/api/missions/[id]/stage/route.ts` — explicit stage transition with operator/agent check
- NEW `src/components/MissionBoard.tsx` — 5-column kanban
- NEW `src/components/MissionCard.tsx` — single mission cell (subtask progress, agent count, awaiting-input badge)
- NEW `src/app/workspace/[slug]/mission/[id]/page.tsx` — drilldown (move existing 3-pane here)
- REWRITE `src/app/workspace/[slug]/page.tsx` → mission kanban
- `src/components/MissionQueue.tsx` — accept `convoyId` prop and scope task list (mounts under drilldown only)
- `src/lib/convoy.ts` — `setMissionStage(convoyId, stage, actor)`; auto-advance hooks (e.g., on `convoy.status='done'` → `mission_stage='done'`)

**Scope:** ~3–4 days. Largest feature; UI scaffold for everything else.

---

### Feature 2 — Existing-codebase mode (per-mission toggle)

**Existing primitives to extend:**
- `workspaces.path` exists; root for codebase scan.
- `dispatch/route.ts` already injects `planning_spec`, `knowledge`, `skills` sections — codebase summary slots in via the same template.
- `workspace-isolation.ts` understands worktree/sandbox; useful for cache invalidation if mission worktree-isolates.

**Real gaps:**
- (A) Per-mission flag:
  ```sql
  ALTER TABLE convoys ADD COLUMN workspace_mode TEXT
    DEFAULT 'greenfield'
    CHECK (workspace_mode IN ('greenfield','existing'));
  ```
- (B) **Cache scope: per-mission (Q4, Harish overrode the per-workspace recommendation).** New table keyed on `convoy_id`:
  ```sql
  CREATE TABLE mission_codebase_summaries (
    convoy_id TEXT PRIMARY KEY REFERENCES convoys(id) ON DELETE CASCADE,
    summary_md TEXT NOT NULL,
    file_index_json TEXT,
    base_commit TEXT,
    last_scanned_at TEXT,
    scan_in_progress INTEGER DEFAULT 0
  );
  ```
  Tradeoffs:
    - Pro: independent caches — no race between concurrent missions on the same workspace; original Risk #7 disappears.
    - Con: each new mission re-scans even when another mission on the same workspace has a recent summary at the same commit. Multi-minute first-mission cost repeats per mission.
  - **Mitigation — opportunistic seed (B.1).** On mission creation in `existing` mode: if any sibling mission on the same `workspace_id` has a `mission_codebase_summaries` row with `base_commit == HEAD-of-workspace-path`, copy that row into the new mission's slot as the starting point. Treated as a soft head-start, not a hard share — the new mission can diff-update or re-scan independently from there. If no candidate exists or commits differ, fall back to a fresh scan. The seed copy is opt-in (default ON) and tracked via `mission_codebase_summaries.seeded_from_convoy_id TEXT NULL` for analytics.
- (C) Scanner — NEW `src/lib/codebase-scanner.ts`. MVP strategy: dispatch a planner-agent task with prompt "produce a structured summary of this codebase" and store the response. Avoids building a static analyzer in v1.
- (D) Diff-update — `git diff <last_scanned_commit> HEAD --name-only`, send only changed files to planner-agent for incremental update, merge into `summary_md`.
- (E) Planner injection — `planning/route.ts` POST: when parent convoy has `workspace_mode='existing'`, prepend the mission's codebase summary to the initial planning prompt.
- (F) Subtask injection — `dispatch/route.ts`: when convoy has `workspace_mode='existing'`, add a "Respect existing code" constraint section to taskMessage.
- (G) Concurrency: advisory lock via `scan_in_progress` flag + timestamp on the *mission's* row. Two concurrent scans within the same mission still need serialisation (e.g., parallel planner re-engagements after diff-update). Cross-mission scans are now naturally independent.
- (H) **Workspace `path` validation (Q8).** `workspaces.path` is nullable today. Mission-create modal flow when operator picks `existing` mode:
    1. If `workspaces.path` is set → continue.
    2. If unset → render an inline path input on the modal (no separate workspace-settings detour).
    3. On submit, validate **before** creating the mission:
       - Path exists and is readable (server-side `fs.access`).
       - Recommended: `<path>/.git` exists. If not, surface a non-blocking warning ("Not a git repo — diff-updates will fall back to full re-scan").
       - Reject empty / whitespace-only submissions silently — input must be non-empty.
    4. On valid input, persist to `workspaces.path` and proceed with mission creation.
   Validation lives in NEW `src/app/api/workspaces/[id]/path/route.ts` (PUT) so the modal can validate before committing.

**Files / tables to change:**
- DB migration: `convoys.workspace_mode` + `mission_codebase_summaries` table (with `seeded_from_convoy_id`)
- NEW `src/lib/codebase-scanner.ts`
- NEW `src/app/api/missions/[id]/codebase/scan/route.ts` (POST initial, PATCH diff-update) — note: now scoped to mission, not workspace
- NEW `src/app/api/workspaces/[id]/path/route.ts` PUT — validate + persist workspace path
- `src/app/api/tasks/[id]/planning/route.ts` POST — inject summary
- `src/app/api/tasks/[id]/dispatch/route.ts` — add `existingCodeSection`
- `MissionCard` / mission-create modal — toggle UI + inline path input + validation feedback

**Scope:** ~3 days. Scanner is still the unknown — treat first iteration as "ask planner to summarize" rather than building a static analyzer. Opportunistic seed adds ~2h to scope but prevents the per-mission re-scan cost from feeling punitive.

---

### Feature 3 — Auto-propose new sub-tasks (planner-stays-alive loop)

**Existing primitives to extend:**
- `tasks.planning_session_key` — planner already has a long-lived session bound to the parent task.
- `convoy_subtasks` — used as-is, plus a new state flag.
- `convoy.status='active'` already gates "mission is in progress".
- `planning_questions` Q&A loop is the UX model for the propose-and-wait flow.

**Real gaps:**
- (A) Trigger detection — when **all** convoy_subtasks reach `done` AND `mission_stage='in_progress'`, fire `proposeNextSubtasks(convoyId)`. The current `convoy.ts:checkConvoyCompletion` (L154) auto-moves parent to `review`; we MUST gate that on `mission_stage`. If `in_progress`, suppress the parent→review move and trigger proposal loop instead. (See Risk #3.)
- (B) Proposed-subtask state:
  ```sql
  ALTER TABLE convoy_subtasks ADD COLUMN proposal_status TEXT
    DEFAULT 'active'
    CHECK (proposal_status IN ('proposed','approved','dismissed','active'));
  ```
  `getDispatchableSubtasks` filters `proposal_status IN ('approved','active')`. Subtasks created by the loop start as `proposed`.
- (C) Kanban "Proposed" + "Dismissed" lanes — `MissionQueue.tsx` (drilldown task board) gets two new columns. Drag from Proposed → Backlog flips `proposal_status='approved'` AND `task.status='inbox'`; drag to Dismissed → `'dismissed'`. Bulk approval via shift-click multi-select. No modal.
- (D) Planner re-engage — NEW `POST /api/missions/[id]/propose-next` calls planner via `chat.send` with `{mission goal, completed-subtask history, codebase summary if existing-mode}`; expects JSON `{subtasks: [...]}`. Reuses existing `planning_session_key`. Subtasks created by this path get `decomposition_strategy='planning_iterative'` (Q10) — see (G) below for the migration.
- (E) Manual add — already supported via `addSubtasks(convoyId, ...)` in `convoy.ts`. UI affordance: "+ Add task" button on Backlog column header. Manual adds keep `decomposition_strategy='manual'`.
- (F) **Auto-propose throttle (Q6).** Cap at **3 consecutive auto-propose cycles without operator approving any proposed subtask.** After 3, the planner stops auto-firing; the operator must click an explicit "Propose more" button to continue. Counter resets when the operator approves at least one proposed subtask.
  - Schema:
    ```sql
    ALTER TABLE convoys ADD COLUMN auto_propose_streak INTEGER DEFAULT 0;
    ```
  - Logic in `proposeNextSubtasks(convoyId)`:
    1. Read `auto_propose_streak`. If `>= 3` AND call is auto-triggered (not operator-button), short-circuit; emit a `mission_event` of type `auto_propose_throttled` and surface a "Planner paused — click *Propose more* to continue" banner on the mission card.
    2. Otherwise fire the planner, insert proposed subtasks, increment `auto_propose_streak` by 1.
    3. Reset to 0 when *any* proposed subtask transitions `proposal_status='proposed' → 'approved'` (any approval, not only the most-recent batch — keeps the rule simple and forgiving).
    4. Manual "Propose more" button always fires regardless of streak; firing this way still increments the streak (so dismiss-only loops still hit the cap, and the operator must explicitly approve something to clear it).
- (G) **Decomposition strategy update (Q10).** Add `'planning_iterative'` to the CHECK constraint on `convoy_subtasks.decomposition_strategy`. Initial planner output stays `'planning'`; auto-propose-loop output is `'planning_iterative'`; manual stays `'manual'`. SQLite CHECK constraint changes require table-recreate — bundle with the `proposal_status` migration to amortise.
- (H) Cancel-token — if user drags `In Progress → Testing` mid-proposal, abort the planner `chat.send` call and freeze any in-flight proposed-subtask inserts. (Was Risk #3; still applies.)

**Files / tables to change:**
- DB migration: `convoy_subtasks.proposal_status` + CHECK update for `decomposition_strategy` (single recreate) + `convoys.auto_propose_streak`
- `src/lib/convoy.ts` — extend `getDispatchableSubtasks`, `checkConvoyCompletion`; new `proposeNextSubtasks` with streak logic
- NEW `src/app/api/missions/[id]/propose-next/route.ts` — accepts `?source=auto|manual` to differentiate streak handling
- `src/components/MissionQueue.tsx` — add Proposed + Dismissed columns; drag handlers; bulk-select; "Propose more" button; throttled-state banner
- Planner prompt template: "given mission goal + completed subtasks + remaining gaps, propose next batch as JSON"

**Scope:** ~2–3 days. State-machine gate in `checkConvoyCompletion` is still the subtle bit — see Risk #3.

---

### Feature 4 — Per-agent skill registry (role-scoped)

**Existing primitives to extend:**
- `agents.session_key_prefix` and `agents.gateway_agent_id` — agents already wired to gateway sessions.
- Dispatch is via `chat.send` to that prefix — **the gateway is what actually grants skills/MCP servers to a session**.
- `src/lib/skills.ts` is `product_skills` (Karpathy AutoResearch playbooks) — UNRELATED. Don't conflate.

**Real gaps:**
- (A) **Gateway capability — confirmed (Q1).** OpenClaw gateway already supports per-agent skill/MCP scoping. MC's job is to mirror + provide an editor, NOT to extend the gateway. Phase 3 stays at ~2 days.
  - Pin: planner sync RPC is `agents.describe` (returns `{skills, mcpServers}` for the agent). If the gateway in fact exposes this under a different name, Stark MUST rename `skill-sync.ts` callsite accordingly — this is the only Phase-3-specific verification step before coding starts.
- (B) MC stores a read-only mirror of gateway state:
  ```sql
  ALTER TABLE agents ADD COLUMN allowed_skills TEXT;        -- JSON array
  ALTER TABLE agents ADD COLUMN allowed_mcp_servers TEXT;   -- JSON array
  ALTER TABLE workspaces ADD COLUMN role_skills_json TEXT;  -- {"tester":["playwright"], ...}
  ```
- (C) Sync — NEW `src/lib/openclaw/skill-sync.ts` pulls per-agent capability list from gateway via `agents.describe`. Direction: gateway → MC for v1; v2 lets MC push edits. Sync triggers: (i) on agent create, (ii) on workspace open, (iii) operator-pressed "Refresh" button on the Skills tab.
- (D) Role-default seed — when a new agent is added with `role=X`, auto-populate `allowed_skills` from `workspaces.role_skills_json[X]` as the *intended* state, then immediately reconcile with what `agents.describe` actually returns. Mismatches surface in the UI.
- (E) Dispatch surface — `dispatch/route.ts` adds a "Tools available to you: ..." section so the agent knows its toolset. Gateway enforces; MC just informs.
- (F) UI — NEW `AgentSkillsTab.tsx` in `AgentModal.tsx`: read-only skill/MCP list with "edit in gateway config" link. Workspace-level role-skill mapping editor in workspace settings.

**Files / tables to change:**
- DB migration: `agents.allowed_skills`, `agents.allowed_mcp_servers`, `workspaces.role_skills_json`
- NEW `src/lib/openclaw/skill-sync.ts`
- NEW `src/app/api/agents/[id]/skills/route.ts`
- NEW `src/app/api/workspaces/[id]/role-skills/route.ts`
- `src/app/api/tasks/[id]/dispatch/route.ts` — add tools section
- `src/components/AgentModal.tsx` — add Skills tab

**Scope:** ~2 days. (Was 2d–1wk gated on Q1; gate cleared.)

---

## 2. Dependency Graph + Phase Sequence

```
Phase 0 — Feature 0: convoy auto-drain                            [0.5d, BLOCKING]
   │
   ▼
Phase 1 — Feature 1: mission kanban + URL split                   [3-4d, BLOCKING]
   │
   ├─────────────────────────────┐
   ▼                             ▼
Phase 2a — Feature 3              Phase 2b — Feature 2
auto-propose loop                  existing-codebase mode
[2-3d, parallel]                  [3d, parallel]
   │                             │
   └──────────────┬──────────────┘
                  ▼
Phase 3 — Feature 4: skill registry                               [2d, Q1 gate cleared]
```

**Why this order:**
- Feature 0 first: Feature 1's auto-progress UX is broken without it.
- Feature 1 is the UI scaffold all later features anchor to.
- 2a and 2b are independent of each other; can parallelize (different branches, different file surfaces).
- Feature 4 last because it touches gateway-mirror sync; even with the gate cleared, it benefits from the Phase 1 UI scaffold and from Phase 2 settling first so the AgentModal Skills tab can land on a stable shell.

## 3. Branch Strategy

Per-phase branches off `feature/mission-orchestration`:

| Phase | Branch                                           | Re-run spike at end? |
|-------|--------------------------------------------------|----------------------|
| 0     | `mc-upgrade/phase-0-convoy-drain`                | Yes (the 46s chain)  |
| 1     | `mc-upgrade/phase-1-mission-kanban`              | Yes                  |
| 2a    | `mc-upgrade/phase-2a-auto-propose`               | Yes + new propose-loop e2e |
| 2b    | `mc-upgrade/phase-2b-existing-codebase`          | Yes + scan-once e2e  |
| 3     | `mc-upgrade/phase-3-skills-registry`             | Yes + per-role dispatch check |

**Merge cadence:** each phase merges back to `feature/mission-orchestration` only after a green spike-style end-to-end test. **No squash** — preserve commit-level rollback granularity (matches the brief's branch-hygiene non-negotiable).

**Tagging (Q7, mandatory):** immediately after each phase merges, tag the merge commit as `mc-upgrade-phase-N` (`-0`, `-1`, `-2a`, `-2b`, `-3`). These tags are the rollback anchors and demo checkpoints; merging a phase without tagging is treated as an incomplete merge. Push tags to origin as part of the merge step.

## 4. Risk Flags

1. **Schema migration risk on `convoys.mission_stage` and friends.** SQLite ALTER + CHECK constraints require table-recreate. Use existing migration scaffold in `src/lib/db/migrations.ts`. Backfill `mission_stage` from current `convoys.status` + parent task status. **Test on a copy of `mission-control.db` first** — the live WAL is 3.9 MB; never run dev migrations on prod data.

2. **Breaking the proven Builder→Tester→Reviewer chain.** Feature 1 introduces a mission-level state on top of task-level statuses. The 46s spike fires off task PATCH → `workflow_engine.handleStageTransition`. Risk: we add a `mission_stage` precondition and accidentally block the chain. Mitigation: `mission_stage` is purely additive — task workflow is untouched; mission_stage is read-only for agents (only operator drag changes it, except auto-advances spelled out in Feature 1.E). **Re-run the 46s chain spike at end of Phase 1 as the merge gate.**

3. **State-machine ambiguity, Feature 1 ↔ Feature 3 (THE gnarly one).** When a mission is `In Progress` and all subtasks reach `done`:
   - Today: `convoy.ts:checkConvoyCompletion` (L154–200) auto-moves parent task to `review`.
   - Want: if `mission_stage='in_progress'`, suppress that and fire propose-loop instead. If `mission_stage='testing'`, keep current behavior.
   - Stark MUST add the gate inside `checkConvoyCompletion`, not bolt it on. Reading L154–200 is required.
   - Cancel-token: if user drags `In Progress → Testing` mid-proposal, abort the planner `chat.send` call and freeze any in-flight proposed-subtask inserts.

4. **Operator-interjection surfaces (`task_chat` typo, Q2).** Brief lists `task_chat`; live schema has none. The four real surfaces — `task_notes`, `agent_mailbox`, `conversations`+`messages`, and the `/api/tasks/:id/chat` route — must all be preserved through Phases 1–3. Concrete instruction to Stark: do not delete, rename, or refactor any of these tables/routes during the rename pass; if any becomes orphaned, file a follow-up rather than removing it. Re-run a manual operator-interjection smoke test (drop a `task_notes` row + ping `agent_mailbox`) at end of Phase 1 as part of the merge gate.

5. *(retired in Rev 1; gateway capability confirmed via Q1.)* The only residual risk: the RPC name on the gateway. If `agents.describe` does not exist or is renamed, Stark must rename the callsite in `skill-sync.ts` before sequencing the rest of Phase 3. Treat as a 30-minute verification step at the start of Phase 3.

6. **First-time codebase scan latency.** A planner agent summarizing a 50k-LOC repo is multi-minute. UX implication: mission shows "Scanning workspace…" badge and cannot enter Planning until done. With per-mission cache (Q4), this cost now repeats *per mission* on the same workspace — opportunistic seed (Feature 2.B.1) is the primary mitigation. Without the seed, the second mission on a 50k-LOC repo also pays the multi-minute price. Stark MUST land the seed in the same phase as the scanner; do not split.

7. *(superseded in Rev 1 by per-mission cache, Q4.)* Original concern was concurrent missions racing on a shared workspace cache; per-mission cache eliminates the race entirely. Replaced by **Risk #11** below.

8. **Convoy→mission rename: language drift.** UI rename only; DB stays `convoys`. Code reviewers and new contributors will be confused. Recommend: add SQL view `CREATE VIEW missions AS SELECT * FROM convoys` for read-side queries; keep writes on `convoys`. Defer full schema rename to a later cleanup branch (low value, high churn).

9. **Heartbeat / cron retry.** "All subtasks done" detection is event-driven (subtask PATCH) — no cron needed. But planner re-engagement is a long-running async call. If it crashes mid-flight, no retry today. Add `convoys.proposal_in_flight_at` timestamp + a small sweep that retries after N minutes. Out of MVP scope; document as known limitation in Phase 2a.

10. **`agent_mailbox.convoy_id` scope.** Already convoy-scoped (== mission-scoped after rename). Fine. Flag if Harish ever wants mailbox to span multi-convoy missions (he's said no for now).

11. **NEW (Rev 1) — per-mission codebase summary storage growth.** With Q4's per-mission cache, every mission carries its own `summary_md` (likely tens of KB to low MB per repo). On a long-lived workspace with many completed missions, the table grows unbounded. Done missions never drop their summary. Mitigation, NOT in MVP: add a janitor that drops `summary_md` (keeping `base_commit` + `last_scanned_at` for audit) for missions in `mission_stage='done'` older than N days. Document as a known limitation; revisit when storage actually bites.

12. **NEW (Rev 1) — opportunistic seed propagates bad summaries.** If the seed source mission has a buggy / hallucinated `summary_md`, every subsequent mission on the same workspace+commit inherits it. Mitigation: the seed is a *starting point* — diff-update logic still runs; manual "Re-scan" button on the mission codebase panel forces a fresh scan that overwrites the seeded summary. Surface a small "Seeded from mission X" hint in the UI so operators can spot drift.

13. **NEW (Rev 1) — auto-propose dismissal-only loop.** With Q6's rule (counter resets only on *approve*), an operator who dismisses every proposed batch will hit the cap after 3 cycles and the planner will pause. This is the intended behaviour — explicit operator approval is required to keep the planner running — but it's worth documenting in the Phase 2a spike acceptance test so Stark doesn't treat the "stuck after 3 dismissals" case as a bug.

## 5. Resolved Clarifying Questions (Rev 1, 2026-04-29)

All ten questions are resolved. Decisions are summarised here for reference; full delta is in the Revision History block at the top of this document.

1. **Gateway skill-scoping.** Already supported. Phase 3 = ~2 days. Verify `agents.describe` RPC name at start of Phase 3 (30-min check, not blocking).
2. **`task_chat`.** Typo. Preserve `task_notes`, `agent_mailbox`, `conversations`+`messages`, `/api/tasks/:id/chat` route. Risk #4.
3. **Mission stage.** Dedicated `convoys.mission_stage` column.
4. **Codebase-summary cache scope.** **Per-mission** (`mission_codebase_summaries`). Opportunistic seed from sibling missions at the same `base_commit`. Feature 2.B + Risks #11, #12.
5. **Mission archive.** None in v1. Done lane stays visible.
6. **Auto-propose throttle.** Cap at 3 consecutive auto-cycles without an operator approval. `convoys.auto_propose_streak`. Resets on first approval; manual "Propose more" still increments. Risk #13.
7. **Phase tags.** Mandatory: `mc-upgrade-phase-N`, pushed to origin at merge.
8. **Workspace path for existing mode.** Inline path input on mission-create modal. Validate (exists, readable, `.git` recommended). Persist to `workspaces.path` on success.
9. **Operator vs agent identity.** PATCH without `updated_by_agent_id` = operator. No new auth.
10. **Decomposition strategy.** New value `'planning_iterative'` for auto-propose-loop output. CHECK constraint update bundled with the `proposal_status` migration.

## Handoff

**Status (2026-04-29, Rev 1):** Stark is mid-execution on Phase 0 (`mc-upgrade/phase-0-convoy-drain`). Q1–Q10 are all resolved; no outstanding planning blockers for Phases 1–3.

- **Stark (executor):**
  1. Finish Phase 0 as-is (no changes from Rev 0). Tag merge as `mc-upgrade-phase-0` and push tag.
  2. Sequence Phase 1 next (mission kanban + URL split). Migration story is now confirmed: dedicated `convoys.mission_stage` column, decoupled from task statuses (Q3). Do NOT delete `task_notes`, `agent_mailbox`, `conversations`/`messages`, or `/api/tasks/:id/chat` during the rename pass (Q2). Re-run the operator-interjection smoke test as part of the Phase 1 merge gate.
  3. After Phase 1 merges, parallelise Phase 2a (auto-propose) and Phase 2b (existing-codebase). 2a includes the 3-cycle throttle and the `planning_iterative` strategy bundle (Q6, Q10). 2b includes the per-mission cache and the opportunistic seed (Q4, must land together) plus the inline path-input + validation flow (Q8).
  4. Phase 3 last. First action of Phase 3: spend ~30 min verifying the gateway exposes `agents.describe` (or note the actual RPC name) before any `skill-sync.ts` work.
  5. Tag every merge `mc-upgrade-phase-N` and push tags (Q7, mandatory).
- **Jarvis (lead):** Phase-0 watch continues; nothing new from planning side. When Phase 0 merges, kick the Phase 1 sequencing brief to Stark; Fury is on standby for any plan tweaks discovered mid-execution.
- **Fury (planner):** plan is current; will revise again only if (i) Phase 1 reveals a migration constraint we missed, (ii) the gateway RPC verification at start of Phase 3 fails, or (iii) per-mission cache cost feels worse in practice than the opportunistic-seed mitigation predicts.

# Mission Orchestration — Locked Architecture Spec

**Author:** Fury (planner) — session `agent:fury:subagent:29dbd001`
**Date:** 2026-04-29 IST
**Repo:** `/home/wizzgeeks/.openclaw/missions/autensa-spike/`
**Branch:** `feature/mission-orchestration` (off `main` v2.5.0 `6a64407`, baseline tag `pre-mission-baseline`)
**Status:** LOCKED — Stark executes; Cap tests in parallel
**Inputs:** `MISSION_ORCHESTRATION_PLAN.md` (Jarvis), `autensa-spike-REPORT.md` (spike GREEN), `convoy-mode-spec.md` (upstream Autensa), `PLAN_MC_UI_SIDEBAR.md` (Stark's parallel branch — overlap callouts inline)

---

## 1. Mission

Take Autensa's already-implemented "convoy" parent/subtask machinery and elevate it into a first-class **Mission** layer with a Light Lead Agent acting as a workflow gate (no continuous gateway session). Phase the work as a clean rename → auto-trigger wiring → Lead state machine → top-level UI → heartbeat sweep, in five small commits per phase. The spike proved Builder→Tester→Reviewer chains run end-to-end through the gateway in 46s; Mission Orchestration sits on top of that, sequencing chains under a parent mission record. No corner-cuts. Soft "one active mission per workspace" UX rule, never a DB constraint. Cross-workspace parallelism preserved. Squad always loaded dynamically from OpenClaw config + gateway.

### Verification of Jarvis's investigation against actual code

| Jarvis claim | Actual code | Verdict |
|---|---|---|
| Convoy schema fully implemented | `src/lib/db/schema.ts:261-321`, `src/lib/db/migrations.ts:671-823` (Migration 015) | ✅ exact match |
| Auto-trigger missing — manual dispatch only | PATCH `/api/tasks/[id]/route.ts:436-446` calls `updateConvoyProgress` + `checkConvoyCompletion` on done, but **never calls `getDispatchableSubtasks` to fire the next ready subtask** | ✅ confirmed gap |
| `is_master` is metadata only | Used in `convoy/route.ts:69-74` to pick a master for AI decomposition; no continuous lead session | ✅ confirmed |
| Heartbeat code exists, "just not scheduled" | **Wrong.** `runHealthCheckCycle()` IS scheduled — `/api/events/stream/route.ts:40-48` runs it every 120s when ≥1 SSE client is connected | ⚠️ contradiction — flagged in §7 |
| Planning auto-creates convoy on approve | `/api/tasks/[id]/planning/approve/route.ts:138-161` parses `task.planning_spec` for `{convoy:true, subtasks:[...]}` and calls `createConvoy(strategy:'planning')` | ✅ exact match |
| Per-task Builder→Tester→Reviewer proven | `task_roles` + `workflow_templates` confirmed by spike; rides on top, untouched | ✅ |
| 21 SQLite migrations | Actually 28 (`migrations.ts` IDs `001`–`028`); next migration = **`029`** | ⚠️ corrected |

---

## 2. Phase 1 — DB Migration (Concrete SQL + Rollback)

### 2.1 Migration shape

`src/lib/db/migrations.ts` uses a single in-memory array of `{id, name, up: (db) => void}` entries (lines 23-823). New migrations are **appended** to that array — never reordered, never removed. Migration 015 (`add_convoy_mode`) is the convoy table creator. We add a new migration `029` immediately after `028`. The pre-migration backup logic (`createPreMigrationBackup`, lines 1614-1672) runs unchanged — backups land in `<dbDir>/db-backups/<dbBasename>.backup.<ISO>`.

The migration runs inside `db.transaction(...)` (line 1722) with `foreign_keys = OFF` and `legacy_alter_table = ON` set on the connection (lines 1718-1720). Both pragmas are restored after the migration block. Stark must keep this pragma envelope intact.

### 2.2 Rename inventory (SQL-level)

| Old | New |
|---|---|
| Table `convoys` | `missions` |
| Table `convoy_subtasks` | `mission_tasks` |
| Column `convoys.parent_task_id` | `missions.parent_task_id` *(unchanged column name; semantics preserved)* |
| Column `convoy_subtasks.convoy_id` | `mission_tasks.mission_id` |
| Column `tasks.convoy_id` | `tasks.mission_id` |
| Column `agent_mailbox.convoy_id` | `agent_mailbox.mission_id` |
| Status value `tasks.status = 'convoy_active'` | `'mission_active'` |
| Index `idx_convoys_parent` | `idx_missions_parent` |
| Index `idx_convoys_status` | `idx_missions_status` |
| Index `idx_convoy_subtasks_convoy` | `idx_mission_tasks_mission` |
| Index `idx_convoy_subtasks_task` | `idx_mission_tasks_task` |
| Index `idx_agent_mailbox_convoy` | `idx_agent_mailbox_mission` |

`tasks.is_subtask` keeps its name — it's a boolean flag, role-neutral.

### 2.3 Migration 029 — `rename_convoy_to_mission`

SQLite ≥3.25 supports `ALTER TABLE … RENAME TO` and `ALTER TABLE … RENAME COLUMN … TO`. Confirm runtime version with `db.prepare('SELECT sqlite_version() as v').get()` at the top of the migration (abort with a clear error if <3.25). Verified in deployed `better-sqlite3` (Migration 015 already relies on `legacy_alter_table = ON`).

```ts
{
  id: '029',
  name: 'rename_convoy_to_mission',
  up: (db) => {
    console.log('[Migration 029] Renaming convoy → mission terminology...');

    const sqliteVersion = (db.prepare("SELECT sqlite_version() as v").get() as { v: string }).v;
    const [maj, min] = sqliteVersion.split('.').map(Number);
    if (maj < 3 || (maj === 3 && min < 25)) {
      throw new Error(`SQLite ${sqliteVersion} too old for RENAME COLUMN; need 3.25+`);
    }

    // 1. Rename tables
    db.exec(`ALTER TABLE convoys RENAME TO missions`);
    db.exec(`ALTER TABLE convoy_subtasks RENAME TO mission_tasks`);

    // 2. Rename columns
    db.exec(`ALTER TABLE mission_tasks RENAME COLUMN convoy_id TO mission_id`);
    db.exec(`ALTER TABLE tasks RENAME COLUMN convoy_id TO mission_id`);
    db.exec(`ALTER TABLE agent_mailbox RENAME COLUMN convoy_id TO mission_id`);

    // 3. Rebuild tasks CHECK constraint to swap 'convoy_active' → 'mission_active'.
    //    SQLite cannot ALTER a CHECK constraint in place — recreate the table.
    //    Mirrors the recreation pattern in Migration 015 (lines 757-808).
    const taskSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string } | undefined;
    if (taskSchema && !taskSchema.sql.includes("'mission_active'")) {
      console.log('[Migration 029] Recreating tasks table to swap convoy_active → mission_active...');

      const oldCols = (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(c => c.name);

      db.exec(`ALTER TABLE tasks RENAME TO _tasks_old_029`);
      db.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT DEFAULT 'inbox' CHECK (status IN (
            'pending_dispatch', 'planning', 'inbox', 'assigned', 'in_progress',
            'mission_active', 'testing', 'review', 'verification', 'done'
          )),
          priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
          assigned_agent_id TEXT REFERENCES agents(id),
          created_by_agent_id TEXT REFERENCES agents(id),
          workspace_id TEXT DEFAULT 'default' REFERENCES workspaces(id),
          business_id TEXT DEFAULT 'default',
          due_date TEXT,
          workflow_template_id TEXT REFERENCES workflow_templates(id),
          planning_session_key TEXT,
          planning_messages TEXT,
          planning_complete INTEGER DEFAULT 0,
          planning_spec TEXT,
          planning_agents TEXT,
          planning_dispatch_error TEXT,
          status_reason TEXT,
          images TEXT,
          mission_id TEXT,
          is_subtask INTEGER DEFAULT 0,
          product_id TEXT REFERENCES products(id),
          idea_id TEXT REFERENCES ideas(id),
          estimated_cost_usd REAL,
          actual_cost_usd REAL DEFAULT 0,
          repo_url TEXT,
          repo_branch TEXT,
          pr_url TEXT,
          pr_status TEXT CHECK (pr_status IN ('pending', 'open', 'merged', 'closed')),
          workspace_path TEXT,
          workspace_strategy TEXT,
          workspace_port INTEGER,
          workspace_base_commit TEXT,
          merge_status TEXT,
          merge_pr_url TEXT,
          retry_count INTEGER DEFAULT 0,
          next_retry_at TEXT,
          dispatch_lock TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      const newCols = new Set(
        (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(c => c.name)
      );
      const safeCols = oldCols.filter(c => newCols.has(c)).join(', ');
      db.exec(`INSERT INTO tasks (${safeCols}) SELECT ${safeCols} FROM _tasks_old_029`);

      // 3a. Convert any in-flight 'convoy_active' rows to 'mission_active'.
      db.exec(`UPDATE tasks SET status = 'mission_active' WHERE status = 'convoy_active'`);

      db.exec(`DROP TABLE _tasks_old_029`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_agent_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_mission ON tasks(mission_id)`);
    }

    // 4. Drop & recreate indexes under new names
    db.exec(`DROP INDEX IF EXISTS idx_convoys_parent`);
    db.exec(`DROP INDEX IF EXISTS idx_convoys_status`);
    db.exec(`DROP INDEX IF EXISTS idx_convoy_subtasks_convoy`);
    db.exec(`DROP INDEX IF EXISTS idx_convoy_subtasks_task`);
    db.exec(`DROP INDEX IF EXISTS idx_agent_mailbox_convoy`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_missions_parent ON missions(parent_task_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mission_tasks_mission ON mission_tasks(mission_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mission_tasks_task ON mission_tasks(task_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_mailbox_mission ON agent_mailbox(mission_id)`);

    console.log('[Migration 029] Rename complete: convoys → missions, convoy_subtasks → mission_tasks, convoy_id → mission_id, convoy_active → mission_active');
  }
}
```

### 2.4 schema.ts must be edited in lock-step

`src/lib/db/schema.ts` is the **fresh-DB** path. Every rename in the migration must mirror in schema.ts so a `rm mission-control.db && npm run dev` produces the same final shape:

- Line 52: `'convoy_active'` → `'mission_active'` (tasks.status CHECK)
- Line 68: `convoy_id` → `mission_id` (tasks column)
- Lines 261-273: `CREATE TABLE convoys` → `missions` (column names unchanged inside; only table name)
- Lines 276-283: `CREATE TABLE convoy_subtasks` → `mission_tasks`; `convoy_id` → `mission_id`
- Line 314: `agent_mailbox.convoy_id` → `mission_id`
- Lines 754-762 (indexes): rename the five indexes per §2.2

### 2.5 Rollback

Single command from a clean working tree: `git reset --hard pre-mission-baseline`. The migration runner backs up the DB before applying — if 029 fails partway, restore the backup file under `<dbDir>/db-backups/` (named `<dbBasename>.backup.<ISO>`) over the live DB and the schema is back to 028. **No bespoke down-migration**: matches the existing repo convention (no migration in 001–028 ships a `down`).

If a rollback after Phase 2+ commits has been pushed: revert the merge commit on `feature/mission-orchestration`, recreate the DB from the backup, restart the dev server. The renamed code (`mission.ts` etc.) still queries the old column names if rolled back — only safe rollback is a full branch revert.

---

## 3. Phase 1 — Code Rename Inventory (Exhaustive)

Each row below is one mechanical edit Stark must make. **One commit per logical group** (DB / lib / API / UI / events) to keep blame clean and per-step CI green. All grep patterns assume `cwd = repo root`. Use `Grep` tool / ripgrep, not sed-on-find — better-sqlite3 query strings are case-sensitive.

### 3.1 File renames (`git mv`)

| Old path | New path |
|---|---|
| `src/lib/convoy.ts` | `src/lib/mission.ts` |
| `src/components/ConvoyTab.tsx` | `src/components/MissionView.tsx` |
| `src/app/api/tasks/[id]/convoy/route.ts` | `src/app/api/tasks/[id]/mission/route.ts` |
| `src/app/api/tasks/[id]/convoy/dispatch/route.ts` | `src/app/api/tasks/[id]/mission/dispatch/route.ts` |
| `src/app/api/tasks/[id]/convoy/progress/route.ts` | `src/app/api/tasks/[id]/mission/progress/route.ts` |
| `src/app/api/tasks/[id]/convoy/subtasks/route.ts` | `src/app/api/tasks/[id]/mission/tasks/route.ts` |
| `src/app/api/convoy/[convoyId]/mail/route.ts` | `src/app/api/missions/[missionId]/mail/route.ts` |

After `git mv`, delete now-empty parent dirs: `src/app/api/tasks/[id]/convoy/`, `src/app/api/convoy/`.

### 3.2 Identifier renames (case-preserving)

Apply each pair globally inside `src/`. Order matters: do `convoy_subtasks` → `mission_tasks` **before** `convoy` → `mission` so the substring doesn't double-rename.

| Find | Replace | Scope |
|---|---|---|
| `convoy_subtasks` | `mission_tasks` | SQL strings, JS object keys |
| `'convoy_active'` | `'mission_active'` | string literals only — search with quotes |
| `convoy_id` | `mission_id` | variables, SQL columns, JSON keys |
| `convoyId` | `missionId` | variable names |
| `convoyTab` | `missionView` | active-tab key in TaskModal |
| `ConvoySubtask` | `MissionTask` | TS type |
| `ConvoyStatus` | `MissionStatus` | TS type |
| `ConvoyData` | `MissionData` | local type in MissionView |
| `Convoy ` (with trailing space) | `Mission ` | UI strings, comments |
| `Convoy` (word boundary, identifier) | `Mission` | TS types, function names |
| `convoy` (word boundary, identifier) | `mission` | variable names, paths |
| `createConvoy` | `createMission` | function name |
| `getConvoy` | `getMission` | function name |
| `updateConvoyProgress` | `updateMissionProgress` | function name |
| `checkConvoyCompletion` | `checkMissionCompletion` | function name |
| `getDispatchableSubtasks` | `getDispatchableMissionTasks` | function name |
| `addSubtasks` (in mission ctx only) | `addMissionTasks` | function name in `mission.ts` |
| `updateConvoyStatus` | `updateMissionStatus` | function name |
| `deleteConvoy` | `deleteMission` | function name |
| `getConvoyMail` | `getMissionMail` | function in `mailbox.ts` |
| `🚚 Convoy` | `🚀 Mission` | label string in `MissionQueue.tsx:24` |

Caveat: the string **"Convoy"** appears inside log lines and learner-context strings (`convoy.ts:83`, `:188`, `:196`, `:212`, `:218`). Each of these must be reworded — e.g. `Convoy "${name}" created with...` → `Mission "${name}" created with...`. They're surfaced to the activity log and learner; renaming keeps the UI consistent.

### 3.3 SSE event rename pairs (`src/lib/types.ts:822-825` + emitters/consumers)

| Old | New |
|---|---|
| `convoy_created` | `mission_created` |
| `convoy_progress` | `mission_progress` |
| `convoy_completed` | `mission_completed` |

Emitters (`broadcast({ type: ... })`):
- `src/lib/convoy.ts:78` (→ `mission.ts`) — `convoy_created`
- `src/lib/convoy.ts:147` — `convoy_progress`
- `src/lib/convoy.ts:184` — `convoy_completed`

Consumers:
- `src/hooks/useSSE.ts:116-119` — switch arms
- `src/components/LiveFeed.tsx:102, 104` — display formatting
- `src/components/ActivityLog.tsx` — 2 references

### 3.4 Files touched by rename (full list, 28 files)

Library: `src/lib/convoy.ts→mission.ts`, `src/lib/types.ts`, `src/lib/db/schema.ts`, `src/lib/db/migrations.ts` (only the new 029 entry), `src/lib/store.ts`, `src/lib/mailbox.ts`, `src/lib/validation.ts`, `src/lib/task-governance.ts`, `src/lib/workspace-isolation.ts`.

API: `src/app/api/tasks/[id]/route.ts`, `src/app/api/tasks/[id]/planning/approve/route.ts`, `src/app/api/tasks/[id]/chat/agents/route.ts`, all four `mission/*` route files (post-rename), `src/app/api/missions/[missionId]/mail/route.ts`, `src/app/api/workspaces/route.ts`.

UI: `src/components/MissionView.tsx` (post-rename), `src/components/MissionQueue.tsx`, `src/components/TaskModal.tsx`, `src/components/LiveFeed.tsx`, `src/components/ActivityLog.tsx`, `src/components/WorkspaceDashboard.tsx`, `src/components/dashboard/WorkspacesList.tsx`, `src/components/dashboard/HeroStats.tsx`, `src/components/chat/ChatInbox.tsx`, `src/components/chat/MentionInput.tsx`, `src/hooks/useSSE.ts`.

Pages: `src/app/activity/page.tsx`.

Tests: none ship convoy strings today (`grep -i convoy src/**/*.test.ts` → empty); Cap-authored tests (Phase 6) already use mission terminology.

### 3.5 Sanity grep after rename (must all return 0 hits in `src/`)

```
rg -l "convoy"            # 0
rg -l "Convoy"            # 0
rg -l "convoy_active"     # 0
rg -l "convoy_id"         # 0
rg -l "convoy_subtasks"   # 0
rg -l "convoy_created"    # 0
rg -l "convoy_progress"   # 0
rg -l "convoy_completed"  # 0
```

If any of those return hits, **do not commit** — fix and re-run. Migration rollforward depends on this.

### 3.6 Phase 1 commit sequence

1. `chore(db): rename convoy → mission in schema + migration 029` — touches `migrations.ts` + `schema.ts` + drop a smoke test that creates a fresh DB, runs all migrations, asserts `missions` and `mission_tasks` tables exist.
2. `refactor(lib): rename convoy.ts → mission.ts and identifiers` — touches `src/lib/*.ts` + types.
3. `refactor(api): rename /convoy/* routes → /mission/* and /api/missions/[id]/mail` — touches API routes only.
4. `refactor(ui): rename ConvoyTab → MissionView, update column label and UI strings` — touches `src/components/*` + hooks/page.
5. `refactor(events): rename convoy_* SSE events → mission_*` — touches `types.ts`, broadcasters, consumers.

Each commit ends green: `npm run typecheck && npm run test && npm run build && npm run dev` (manual sanity: kanban renders, mission column header shows "🚀 Mission").

---

## 4. Phase 2 — Auto-Trigger Wiring

### 4.1 The gap

PATCH `/api/tasks/[id]/route.ts:436-446` does this on each task status change:

```ts
if (nextStatus && nextStatus !== existing.status && existing.convoy_id) {
  try {
    updateConvoyProgress(existing.convoy_id);
    if (nextStatus === 'done') {
      checkConvoyCompletion(existing.convoy_id);
    }
  } catch (err) { /* ... */ }
}
```

It updates counters and checks completion — but never dispatches the next ready mission task. Today, `/api/tasks/[id]/convoy/dispatch` (now `/api/tasks/[id]/mission/dispatch`) **must be invoked manually or from the UI poll**. Phase 2 closes that loop.

### 4.2 Hook location & shape (post-rename names)

In `src/app/api/tasks/[id]/route.ts:436-446`, expand the existing block to also call a new helper `dispatchNextReadyMissionTasks(missionId)`. Place a wrapper in `src/lib/mission.ts` so the API route stays thin:

```ts
// src/lib/mission.ts (new export)
export async function dispatchNextReadyMissionTasks(
  missionId: string,
  options?: { excludeTaskId?: string }
): Promise<{ dispatched: number }> {
  const mission = queryOne<Mission>('SELECT * FROM missions WHERE id = ?', [missionId]);
  if (!mission || mission.status !== 'active') return { dispatched: 0 };

  const ready = getDispatchableMissionTasks(missionId)
    .filter(t => t.task_id !== options?.excludeTaskId);
  if (ready.length === 0) return { dispatched: 0 };

  // Re-use the batch dispatch endpoint via internal fetch to keep MAX_PARALLEL,
  // dispatch-lock, and agent-pick logic in one place. The endpoint is idempotent:
  // tasks already in 'assigned'/'in_progress' are skipped by getDispatchableMissionTasks.
  const url = `${getMissionControlUrl()}/api/tasks/${mission.parent_task_id}/mission/dispatch`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.MC_API_TOKEN) headers['Authorization'] = `Bearer ${process.env.MC_API_TOKEN}`;

  const res = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return { dispatched: 0 };
  const body = await res.json() as { dispatched: number };
  return { dispatched: body.dispatched };
}
```

### 4.3 Wire-up in PATCH `/api/tasks/[id]/route.ts:436-446`

Replace the block with:

```ts
if (nextStatus && nextStatus !== existing.status && existing.mission_id) {
  try {
    updateMissionProgress(existing.mission_id);

    const isTerminal = nextStatus === 'done' || nextStatus === 'review';
    if (isTerminal) {
      // 1. Roll up mission state
      const completed = checkMissionCompletion(existing.mission_id);

      // 2. If mission still active, fan out to next ready tasks (auto-trigger).
      //    Pass excludeTaskId so the just-completed task is never re-dispatched
      //    in the same tick (idempotency guard for race conditions).
      if (!completed) {
        dispatchNextReadyMissionTasks(existing.mission_id, { excludeTaskId: id })
          .catch(err => console.error('[Mission] auto-dispatch failed:', err));
      }
    }
  } catch (err) {
    console.error('[Mission] progress update failed:', err);
  }
}
```

### 4.4 Idempotency guarantees

1. **Status filter at source.** `getDispatchableMissionTasks` selects only `t.status = 'inbox'` (`mission.ts:233`, post-rename) — already-dispatched tasks are invisible to it. Replays are safe.
2. **Dispatch-lock column.** `tasks.dispatch_lock` exists (added in migrations after 015). Stark must verify the `/dispatch` route writes a per-task lock; if not, add one in this phase. **DECISION NEEDED** if absent — see §11.
3. **Status transition gate before fan-out.** PATCH only fires the hook when `nextStatus !== existing.status` (line 437) — same-status updates do not re-dispatch.
4. **MAX_PARALLEL=5 cap** in `mission/dispatch/route.ts:36-46` is unchanged. A burst of completions in the same tick can never spawn more than 5 concurrent dispatches per mission.
5. **Async fire-and-forget.** `.catch()` swallows any dispatch error — the PATCH response still returns 200 to the caller. Errors are logged and surfaced to UI via the next mission_progress SSE.

### 4.5 `mission_progress` SSE payload contract

Already broadcast from `updateMissionProgress` (formerly `updateConvoyProgress`, `mission.ts:147`). Lock the payload shape:

```ts
type MissionProgressPayload = {
  // Mission row (DB-shaped)
  id: string;
  parent_task_id: string;
  name: string;
  status: 'draft' | 'planning' | 'ready' | 'active' | 'paused' | 'done' | 'failed';
  decomposition_strategy: 'manual' | 'ai' | 'planning';
  total_subtasks: number;
  completed_subtasks: number;
  failed_subtasks: number;
  updated_at: string; // ISO8601
};
```

Note: status enum in §5 expands beyond the existing convoy enum. Migration 029 keeps the original `missions.status CHECK` constraint (`'active' | 'paused' | 'completing' | 'done' | 'failed'`) intact for Phase 2 — it is **expanded in Phase 3** (Migration 030, see §5.2). UI must tolerate either set during the inter-phase window.

---

## 5. Phase 3 — Light Lead Agent State Machine

### 5.1 States

```
        ┌────────┐  POST /api/missions          ┌──────────┐
   ─────│ draft  │──────(planner kickoff)──────▶│ planning │
        └────────┘                              └────┬─────┘
                                                    │
                          (planner Q&A complete +   │
                           planning/approve runs)   ▼
                                                ┌───────┐
                                                │ ready │
                                                └───┬───┘
                                                    │
                  POST /api/missions/[id]/approve   │
                  (Lead gate; auto-approve allowed) ▼
                                                ┌────────┐
                              ┌──────pause─────▶│ active │◀──resume──┐
                              │                 └────┬───┘            │
                              ▼                      │                │
                          ┌──────┐            (all tasks done)        │
                          │paused│                   ▼                │
                          └──┬───┘              ┌──────┐              │
                             │                  │ done │              │
                             └──────resume──────┴──────┘              │
                                                                     │
                       (failure threshold tripped)               POST .../resume
                                ▼
                            ┌──────┐
                            │failed│
                            └──────┘
```

### 5.2 Transition triggers (concrete)

| From | To | Trigger | Side effects |
|---|---|---|---|
| (none) | `draft` | `POST /api/missions` with `{title, description, workspace_id}` and no planner kickoff | Creates `missions` row; parent task created with `status='inbox'` |
| `draft` | `planning` | same POST when `kickoff_planner=true` (default), or follow-up `POST /api/missions/[id]/plan` | Parent task moves to `status='planning'`; planner Q&A loop begins via existing `/api/tasks/[id]/planning` machinery |
| `planning` | `ready` | `POST /api/tasks/[id]/planning/approve` resolves convoy decomposition (extends existing handler at `planning/approve/route.ts:138-161`) | Mission tasks created via `createMission(strategy:'planning')`; mission row `status='ready'` |
| `ready` | `active` | `POST /api/missions/[id]/approve` (Lead gate) | Mission `status='active'`; first dispatch fires via `dispatchNextReadyMissionTasks` |
| `active` | `paused` | `POST /api/missions/[id]/pause` | Mission `status='paused'`; in-flight tasks finish naturally; new tasks not dispatched |
| `paused` | `active` | `POST /api/missions/[id]/resume` | Mission `status='active'`; dispatch resumed |
| `active` | `done` | `checkMissionCompletion` flips when all subtasks done | Parent task `status='review'`; `mission_completed` SSE |
| `active` / `paused` | `failed` | failure threshold exceeded (existing logic, `mission.ts:202-220`) | Parent task `status='review'` with failure reason; `mission_failed` SSE (new — add to types) |

### 5.2.1 Migration 030 — `add_mission_lifecycle_states`

Migration 030 expands the `missions.status` CHECK constraint. SQLite cannot ALTER CHECK; recreate the table the same way Migration 015 recreated `tasks`:

```sql
-- Old:
CHECK (status IN ('active', 'paused', 'completing', 'done', 'failed'))
-- New:
CHECK (status IN ('draft', 'planning', 'ready', 'active', 'paused', 'done', 'failed'))
```

`completing` is dropped (was a transient that immediately flipped to `done`; never observed in DB rows in Migration 015 history). If any in-flight mission has `status='completing'` at upgrade time, coerce to `done` in the migration: `UPDATE missions SET status='done' WHERE status='completing'`.

### 5.3 `POST /api/missions` — request contract (Zod)

New file `src/app/api/missions/route.ts`. Schema lives next to the existing schemas in `src/lib/validation.ts`.

```ts
// validation.ts addition
export const CreateMissionSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  workspace_id: z.string().min(1).default('default'),
  // Optional explicit lead override; defaults to workspace master agent.
  lead_agent_id: agentId.optional(),
  // Planner kickoff defaults true. If false, mission stays in 'draft' until
  // POST /api/missions/[id]/plan is called explicitly.
  kickoff_planner: z.boolean().default(true),
  // Optional pre-baked subtasks for manual missions (skip planner).
  subtasks: z.array(z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(10_000).optional(),
    agent_id: agentId.optional(),
    depends_on: z.array(z.string()).optional(),
  })).optional(),
  // Optional priority for the parent task; defaults to 'normal'.
  priority: TaskPriority.optional(),
});

export type CreateMissionInput = z.infer<typeof CreateMissionSchema>;
```

Response: full mission row + parent task ID. 201 on create, 400 on validation, 500 on DB error.

### 5.4 `POST /api/missions/[id]/{approve|pause|resume}`

Three sibling routes under `src/app/api/missions/[id]/`:

| Route | Allowed `from` states | New `to` state | Body |
|---|---|---|---|
| `approve` | `ready` (also `draft` for manual missions with `subtasks` pre-baked) | `active` | `{ approver_agent_id?: string }` (defaults to workspace master) |
| `pause` | `active` | `paused` | `{ reason?: string }` (logged to `task_activities`) |
| `resume` | `paused` | `active` | `{}` |

Each route returns `{ mission, dispatched: number }` so the caller can show "3 mission tasks dispatched". `approve` calls `dispatchNextReadyMissionTasks` synchronously; `resume` does the same (in case work piled up while paused).

### 5.5 Lead selection rule (Light v1)

When a mission has no explicit `lead_agent_id`:

```sql
SELECT id FROM agents
WHERE is_master = 1
  AND workspace_id = :workspace_id
  AND status != 'offline'
ORDER BY created_at ASC
LIMIT 1
```

Same query already used in `src/app/api/tasks/[id]/convoy/route.ts:69-74` for AI decomposition — reuse via a new helper `pickLeadAgent(workspaceId)` in `src/lib/mission.ts`. If no master found:
- For `kickoff_planner=true` AND `strategy='ai'`: 503 `{error: 'No master agent available'}` (matches existing decomposition behavior).
- For manual `subtasks` provided: continue without a lead (mission proceeds; flag in payload as `lead_agent_id: null`).

`is_master=1` becomes the **routing key** for mission ownership: any operation on a mission can audit "who is the Lead?" by joining `missions ↔ tasks ↔ agents` on `parent_task.assigned_agent_id`. No continuous gateway session is opened — the Lead's role is to (a) own decomposition, (b) approve mission ready→active. Heavy continuous-session Lead is deferred (see Risks §9).

### 5.6 Auto-approve fast-path

For dev-loop ergonomics, `POST /api/missions` may include `auto_approve: true` (default false). When set and the resulting mission lands in `ready`, the server immediately calls the same logic as `POST /api/missions/[id]/approve`. Useful for Cap's tests; gated off in prod-style flows.

### 5.7 Reuse vs. new

| Concern | Path |
|---|---|
| Q&A loop (planner) | **Reuse as-is** — `/api/tasks/[id]/planning/{poll,answer,approve,...}` |
| Auto-create mission from planner spec | **Reuse with a 1-line edit** — `planning/approve/route.ts:144` already calls `createConvoy(strategy:'planning')`; after rename, set the new mission row to `status='ready'` instead of `'active'` so the Lead gate fires. Today it goes straight to `'active'`; this is the only behavioral change in the planner path. |
| Mission row CRUD | **Mostly reuse** — `mission.ts` already exposes `createMission`, `getMission`, `updateMissionStatus`, `deleteMission`. The new `/api/missions` route is a thin façade over `createMission` (vs. today's task-bound `/api/tasks/[id]/convoy`). |
| Dispatch | **Reuse as-is** — `/api/tasks/[id]/mission/dispatch` (post-rename) is the workhorse; new mission-level routes call into it. |

---

## 6. Phase 4 — UI Scope

### 6.1 New top-level route `/missions`

New file: `src/app/missions/page.tsx`. Reads `GET /api/missions?workspace_id=` (new endpoint, returns missions per workspace with progress counters). Shows:

- Header: workspace selector (reuse `WorkspacesList` from `src/components/dashboard/`).
- Card grid: one card per mission. Title, status badge (color-coded per state in §5.1), counters (`completed_subtasks/total_subtasks`), Lead avatar.
- "+ New Mission" button → opens `MissionCreateModal` (new component) → `POST /api/missions`.

### 6.2 `MissionView` (renamed `ConvoyTab`)

`src/components/MissionView.tsx` (post §3.1 rename). No structural changes from current `ConvoyTab` beyond the rename — reuse:

- Progress bar
- Subtask list with health dots
- `<DependencyGraph>` (from `src/components/DependencyGraph.tsx`, 99 lines, already DAG-aware)
- Action buttons: re-dispatch, nudge, view checkpoint, pause/resume mission

Embedded in two contexts:
1. Existing TaskModal "convoy" tab (renamed to "mission") — for back-compat in the kanban path.
2. New mission detail page `/missions/[id]` — full-page version (new `src/app/missions/[id]/page.tsx`).

### 6.3 Soft warning modal — second mission per workspace

When user clicks "+ New Mission" and the target workspace already has a mission with `status IN ('planning','ready','active','paused')`, intercept with a confirmation modal:

> ⚠️ Workspace **{workspace.name}** already has an active mission **"{existing.title}"** ({existing.completed_subtasks}/{existing.total_subtasks} done). Cross-mission parallelism in the same workspace can confuse the squad.
>
> [ Continue anyway ]   [ Open existing ]   [ Cancel ]

This is **client-side only**; never enforced server-side. Cross-workspace parallelism is fully supported.

### 6.4 PlanningTab reuse during mission planning

`src/components/PlanningTab.tsx` (807 lines) already drives the planner Q&A. When `mission.status='planning'`, `MissionView` renders `<PlanningTab taskId={mission.parent_task_id} onSpecLocked={...}>`. On `onSpecLocked`, MissionView re-fetches the mission and the status flips client-side to `ready` (server already wrote it via the planning/approve handler).

### 6.5 Kanban column rename

`src/components/MissionQueue.tsx:24`: `'🚚 Convoy'` → `'🚀 Mission'`. Color stays `border-t-cyan-400`.

### 6.6 Coordination with Stark's PR3 (`feature/mc-ui-sidebar-tokens`)

PR3 adds:
- `workspaces.path` column → required for filesystem-isolated workspaces. Mission Orchestration **does not depend** on this; mission tasks inherit `workspace_id` from parent (already wired).
- `WorkspaceManager` component — new sidebar UX. `/missions` route should consume it to render the workspace switcher (reuse, don't duplicate).
- `/api/fs/list`, `DirectoryPicker` — irrelevant to missions.
- `HomeSidebar`/`HomeDashboard` refactor of `/` — orthogonal to `/missions`.

**Sequencing rule:** PR3 lands first to `main`, then Phase 4 of this branch rebases on top and consumes `WorkspaceManager`. If PR3 isn't merged when Phase 4 starts, Stark builds `/missions` with a placeholder workspace switcher (the existing inline buttons), and the rebase swap is a 1-file follow-up. **Do not duplicate the workspace switcher logic.**

`WorkspaceDashboard.tsx` is touched by both branches (PR3 refactors it; Phase 4 adds mission counters to it). Conflict will be small if both branches edit the same file — resolve manually during rebase.

---

## 7. Phase 5 — Heartbeat / Mission Sweep

### 7.1 Existing tick (already wired — Jarvis was wrong)

`src/app/api/events/stream/route.ts:40-48` runs `runHealthCheckCycle()` every **120 000 ms (2 min)** when `getActiveConnectionCount() > 0`. The cycle is defined in `src/lib/agent-health.ts:66-210`:

- Walks every agent with an active task (`status IN ('assigned','in_progress','testing','verification')`).
- Updates `agent_health.health_state` (idle/working/stalled/stuck/zombie/offline).
- Auto-nudges agents stuck for ≥3 consecutive checks (`AUTO_NUDGE_AFTER_STALLS=3`, line 10).
- Sweeps orphaned `assigned` tasks stale >2 min and re-dispatches (`agent-health.ts:147-191`).

### 7.2 Phase 5 addition — mission sweep

Add a new function `runMissionTickCycle()` to `src/lib/mission.ts` and **call it from the same SSE-stream tick** as `runHealthCheckCycle()`. Single tick, two side effects.

```ts
// src/lib/mission.ts
export async function runMissionTickCycle(): Promise<{ scanned: number; dispatched: number }> {
  // Scan target: every mission in 'active' state with at least one inbox subtask.
  const active = queryAll<{ id: string }>(
    `SELECT m.id FROM missions m
     WHERE m.status = 'active'
       AND EXISTS (
         SELECT 1 FROM mission_tasks mt
         JOIN tasks t ON mt.task_id = t.id
         WHERE mt.mission_id = m.id AND t.status = 'inbox'
       )`
  );
  let dispatched = 0;
  for (const { id } of active) {
    try {
      const result = await dispatchNextReadyMissionTasks(id);
      dispatched += result.dispatched;
    } catch (err) {
      console.error(`[Mission] tick failed for mission ${id}:`, err);
    }
  }
  return { scanned: active.length, dispatched };
}
```

### 7.3 Wire into `events/stream/route.ts`

Edit `src/app/api/events/stream/route.ts:40-48` to call both:

```ts
const tickInterval = setInterval(async () => {
  if (getActiveConnectionCount() === 0) return;
  try {
    await Promise.all([
      runHealthCheckCycle(),
      runMissionTickCycle(),
    ]);
  } catch (error) {
    console.error('[SSE] tick cycle error:', error);
  }
}, 120_000);
```

Single 2-min tick. Don't add a second interval — they'd race and burn DB writes for nothing.

### 7.4 Backoff & cost

- `runMissionTickCycle` is read-mostly: one SELECT, then per-active-mission an internal fetch to `/mission/dispatch`. Each fetch obeys MAX_PARALLEL=5 and the dispatch-lock idempotency. With ≤10 active missions in a deployment, total tick cost is single-digit ms of SQL + N small HTTP calls. Negligible.
- **Backoff on errors:** if a mission throws three ticks in a row, mark it `status='paused'` and log to `task_activities`. Implement as a `consecutive_tick_failures` counter on the `missions` row — DEFER to a follow-up if not in scope. **DECISION NEEDED** — see §11.
- **Headless deployments (no UI client):** the tick runs only when ≥1 SSE client is connected. If the box is headless, missions stall at the auto-trigger fallback. The PATCH-driven trigger from §4.3 still fires inline on each task transition — the heartbeat is a *safety net*, not the primary path. Acceptable for v1; document in operator README.

### 7.5 Cite

`src/lib/agent-health.ts` already does the heavy lifting for agent health and orphan-task sweep (lines 147-191). The mission sweep is a sibling pattern — same shape, scoped to `missions.status='active'`.

---

## 8. Test Plan for Cap

Cap owns integration tests in parallel with Stark's build. Tests live under `src/lib/*.test.ts` (existing pattern; `health.test.ts`, `task-governance.test.ts`).

### 8.1 Happy path

| # | Scenario | Setup | Assertions |
|---|---|---|---|
| H1 | Create mission with manual subtasks → all complete | `POST /api/missions` with 3 subtasks, `kickoff_planner=false`, `auto_approve=true` | parent task `status='review'` after all 3 subtasks done; mission `status='done'`; 3× `mission_progress` SSE + 1× `mission_completed` SSE |
| H2 | Planner-driven mission with AI decomp | `POST /api/missions` with title+description, kick the planner, answer Q&A, approve; AI generates 3 subtasks | mission `status='ready'` after `planning/approve`, then `status='active'` after `mission/approve`; first dispatch fires within 100ms of approve |
| H3 | Auto-trigger end-to-end | Manual mission, 3 sequential subtasks (linear depends_on chain) | Each `done` triggers next without manual API call; total wall-time ≤ 3× single-task dispatch latency + 200ms slack |
| H4 | Cross-workspace parallelism | 2 missions in 2 workspaces, kicked off ~simultaneously | Both reach `done` independently; no DB lock contention; per-workspace SSE filtered correctly |

### 8.2 Failure paths

| # | Scenario | Expected behavior |
|---|---|---|
| F1 | Planner rejects (returns invalid JSON 3× / decompose timeout) | Mission stays in `planning`; planner error surfaced to UI; manual `addMissionTasks` allowed as fallback |
| F2 | Lead pauses mid-flight | `POST /api/missions/[id]/pause` while 1 task is `in_progress` and 2 in `inbox` → in-progress task continues to its terminal state; inbox tasks NOT dispatched; mission `status='paused'`; resume re-fires dispatch |
| F3 | Single subtask fails 3× | Subtask retry exhausted (existing governance, `task-governance.ts`) → subtask marked failed; mission `failed_subtasks++`; if threshold (>50%) tripped, mission `status='failed'` with parent task `status='review'` and `status_reason` set |
| F4 | Two missions in same workspace | Soft warning modal shown client-side; if user proceeds, both run concurrently; verify activity feeds remain distinct (filtered by `mission_id`) |
| F5 | Two missions in different workspaces | No warning shown; both run; assert no shared state (no row leaks across `workspace_id`) |
| F6 | Auto-trigger race (two subtasks finish in same SSE tick) | `dispatchNextReadyMissionTasks(missionId, {excludeTaskId})` called twice → second call sees the first batch already in `assigned` and dispatches only the still-`inbox` ones; no double-dispatch (verify by counting `openclaw_sessions` rows for each subtask: must be 1) |
| F7 | Headless deployment (no SSE client connected) | PATCH-driven trigger still fires inline on each task transition (verify with curl-only flow); heartbeat sweep does not run (verified by no `[Mission] tick` log lines) |

### 8.3 Migration safety tests

| # | Scenario | Expected |
|---|---|---|
| M1 | Fresh DB, all 29 migrations apply cleanly | `_migrations` table has 29 rows; `missions`, `mission_tasks` tables exist; tasks.status CHECK includes `'mission_active'` |
| M2 | Apply 029 to a DB with rows in `convoys`/`convoy_subtasks`/`tasks.convoy_id` (simulate upgrade path) | Counts before == counts after; `tasks.mission_id` populated for previously-`tasks.convoy_id` rows; in-flight `convoy_active` tasks coerced to `mission_active` |
| M3 | Migration crash mid-029 | Pre-migration backup exists in `db-backups/`; `_migrations` does NOT have `029`; restore swaps state back to v028 cleanly |

### 8.4 Heartbeat tick

| # | Scenario | Expected |
|---|---|---|
| T1 | Stalled mission (subtask done but PATCH hook flopped) | Mission tick fires within 2 min, dispatches the stuck `inbox` task |
| T2 | Two active missions, one with no inbox tasks | Tick scans both; only the one with ready work dispatches |

### 8.5 Smoke harness

A repeatable runner under `scripts/mission-smoke.sh` that:
1. Boots fresh DB.
2. Runs the H1 path via curl + sqlite asserts.
3. Tears down. Used by CI on every commit on `feature/mission-orchestration`.

---

## 9. Risk Register & Rollback

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | Migration 029 corrupts data on a non-empty DB | Low | High | Auto-backup runs before every migration (lines 1707-1708); test M2 and M3 must pass before merge; **`pre-mission-baseline` tag** is the single-command rollback point |
| R2 | Auto-trigger fires storm of dispatches | Low | Med | `getDispatchableMissionTasks` only returns `inbox` rows (already-dispatched are invisible); MAX_PARALLEL=5 inside `/mission/dispatch`; `excludeTaskId` filter |
| R3 | Renamed CHECK constraint breaks running tasks | Low | High | Migration 029 coerces `convoy_active` → `mission_active` in the same transaction as the table recreate; M2 test verifies |
| R4 | Stark's PR3 lands first and conflicts with Phase 4 | Med | Low | Phase 4 sequenced last; PR3 file overlap is `WorkspaceDashboard.tsx` only; coordinate via Fury before MissionView merges |
| R5 | Light Lead is too thin (no oversight when planner is wrong) | Med | Med | Lead gate at `ready→active` is human-or-master-agent approval; planner errors caught by Cap's F1 test; Heavy Lead deferred but re-spec'd if F1 misses leak |
| R6 | Heartbeat doesn't run on headless deploys | Med | Low | PATCH-driven trigger covers the primary path; tick is a safety net; documented in operator README; **DECISION NEEDED** if headless needs in-process scheduler |
| R7 | Mission status enum drift between Migration 029 and 030 | Low | Med | Sequencing locked: 029 just renames; 030 expands enum. UI already tolerates both per §4.5 |
| R8 | Race in PATCH→auto-trigger when two PATCH calls arrive in same tick | Low | Low | F6 covers this; the dispatch endpoint's `inbox`-only filter is the source of truth for idempotency |

### 9.1 Rollback paths

- **Pre-merge (any phase):** `git reset --hard pre-mission-baseline && rm mission-control.db && npm run dev` — auto-recreates DB at v028 and the branch is clean.
- **Mid-Phase 1 (migration applied, code half-renamed):** restore latest pre-029 backup from `db-backups/` over the live DB; `git reset --hard pre-mission-baseline`. Operators are warned in the migration log.
- **Post-Phase 5 in production:** revert merge commit on `main`, restart with the v2.5.0 DB backup. No down-migration is shipped per repo convention; the rollback contract is "restore the backup the migration runner created."
- **Per-phase checkpoint tags (recommend):** Stark tags `mission-phase-{1..5}-green` after each phase passes typecheck+test+build. Granular rollback target if Phase N introduces a regression.

---

## 10. Sequencing & Checkpoints

Each phase ends green: `npm run typecheck && npm run test && npm run build && npm run dev` boots, kanban renders, mission column header shows correct label, no console errors in first 60s.

### 10.1 Phase 0 (already done)

- `feature/mission-orchestration` branched off `main` (v2.5.0 `6a64407`).
- `pre-mission-baseline` tag set.
- Stark's WIP committed as `ee9333e` on `feature/mc-ui-sidebar-tokens` (push pending auth).

### 10.2 Phase 1 — Rename layer (1–2 days, 5 commits)

| Commit | Scope |
|---|---|
| 1.1 | `chore(db): add migration 029 rename convoy → mission` + `schema.ts` mirror |
| 1.2 | `refactor(lib): rename convoy.ts → mission.ts` + types + identifier renames in `src/lib/*.ts` |
| 1.3 | `refactor(api): rename /convoy/* routes → /mission/*` and `/api/convoy/[id]/mail` → `/api/missions/[id]/mail` |
| 1.4 | `refactor(ui): rename ConvoyTab → MissionView`, kanban column label, all UI strings |
| 1.5 | `refactor(events): rename convoy_* SSE events → mission_*` |

**Checkpoint:** all 8 sanity greps in §3.5 return 0 hits; full test suite green; smoke H1 passes; tag `mission-phase-1-green`.

### 10.3 Phase 2 — Auto-trigger (1 day, 1 commit)

| Commit | Scope |
|---|---|
| 2.1 | `feat(mission): auto-trigger next ready mission task on subtask done` — adds `dispatchNextReadyMissionTasks` in `mission.ts`, wires hook in `tasks/[id]/route.ts:436-446` |

**Checkpoint:** F6 race test passes; H3 happy path passes end-to-end without manual `/mission/dispatch` calls; tag `mission-phase-2-green`.

### 10.4 Phase 3 — Light Lead state machine (2–3 days, 4 commits)

| Commit | Scope |
|---|---|
| 3.1 | `feat(db): migration 030 expand mission status enum` |
| 3.2 | `feat(api): POST /api/missions create + state machine helpers` |
| 3.3 | `feat(api): POST /api/missions/[id]/{approve,pause,resume}` |
| 3.4 | `refactor(planning): planning/approve sets mission status='ready' (was 'active')` |

**Checkpoint:** H1, H2, F2 pass; tag `mission-phase-3-green`.

### 10.5 Phase 4 — UI elevation (2 days, 3 commits)

| Commit | Scope |
|---|---|
| 4.1 | `feat(ui): /missions top-level route + MissionCreateModal` |
| 4.2 | `feat(ui): /missions/[id] detail page (reuses MissionView + DependencyGraph + PlanningTab)` |
| 4.3 | `feat(ui): soft-warning modal on second active mission per workspace` |

**Checkpoint:** Manual UI walkthrough of H1 + H2 + F4; rebase clean against latest PR3 if merged; tag `mission-phase-4-green`.

### 10.6 Phase 5 — Heartbeat sweep (1 day, 1 commit)

| Commit | Scope |
|---|---|
| 5.1 | `feat(mission): mission tick in SSE heartbeat` — adds `runMissionTickCycle`, wires into `events/stream/route.ts:40-48` |

**Checkpoint:** T1 passes (kill PATCH-trigger path, confirm tick recovers within 2 min); tag `mission-phase-5-green`; ready for `feature/mission-orchestration` → `main` PR.

### 10.7 Total budget

**~1.5 weeks v1**, matching Jarvis's estimate. Cap's tests are written in parallel across all phases; no extra wall-clock added.

---

## 11. Decisions Still Needed (raised by Fury)

These are surfaced because the brief was ambiguous or the code didn't conclusively answer. Harish or Jarvis should resolve before Stark hits each phase. None block Phase 1.

1. **Dispatch-lock column verified.** Confirm `tasks.dispatch_lock` is actively written by `/api/tasks/[id]/dispatch` (mentioned in schema line 790 but not seen in dispatch route during this read). If not used today, Stark adds it in Phase 2. **Owner: Stark — verify in code on first Phase 2 commit.**
2. **Tick failure backoff.** Should `runMissionTickCycle` track `consecutive_tick_failures` per mission and auto-pause after N failures? My recommendation: yes, threshold=3, Phase 5. **Owner: Harish — yes/no.**
3. **Headless deployment scheduler.** If MC runs without a UI client, the heartbeat tick never fires. Acceptable for v1 (PATCH-driven trigger handles forward progress; tick is recovery only)? Or should we add a server-side `setInterval` in a startup hook (e.g. in `src/lib/db/index.ts` init)? My recommendation: defer to v1.1 — add only if a real headless deploy emerges. **Owner: Harish — yes/no.**
4. **Auto-approve default.** Phase 3 ships `auto_approve: false` by default — Lead approval gate is enforced on every mission. For dev ergonomics, do we want Harish's personal squad missions to default `auto_approve: true`? My recommendation: leave default `false`; Harish flips it via UI toggle when desired. **Owner: Harish.**
5. **`mission_failed` SSE.** Add as a new SSE event type (alongside `mission_completed`)? Today the convoy code path doesn't emit a dedicated failure event; UI infers from `task_updated` on the parent. My recommendation: add it for clarity. **Owner: Stark — implement in Phase 3 commit 3.4.**
6. **PR3 merge sequencing.** Stark's `feature/mc-ui-sidebar-tokens` (with `ee9333e` WIP) is pending push auth. If PR3 lands first, Phase 4 rebases cleanly. If Mission Orchestration lands first, PR3 rebases. Either order works. **Owner: Harish — pick the merge order before Phase 4 starts.**

---

## Handoff

**Executor:** Stark (developer). Reads this spec start to finish; executes commits per §10 sequence; runs Cap's tests at each checkpoint; surfaces blockers via Jarvis if any item in §11 isn't resolved before its phase starts.

**Tester:** Cap. Owns §8 test suite; writes alongside Stark's commits; gating on `mission-phase-N-green` tags.

**Reviewer:** Fury reviews each phase's PR before merge — confirms no spec drift; updates this doc if reality forces a change.

**Owner:** Harish — decisions in §11; merge sign-off on `feature/mission-orchestration → main`.

*Spec locked at 2026-04-29 IST.*

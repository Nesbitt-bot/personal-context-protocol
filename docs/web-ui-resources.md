# Session, project and task APIs

Web UI resource endpoints under `/api/v1`. To search across these resources,
see [scoped search](scoped-search.md).

## Admin Sessions

### GET `/sessions`

Lists the sessions visible to the caller (all of them for admins), including
uncategorized ones (`topic_id: null`). Each row includes `owner_user_id`,
`principal` and `class`. Used by the dashboard to group sessions by topic.

### POST `/sessions`

Creates a session owned by the signed-in user (`class: "trusted"`). `topic_id`
is optional — omit it for an **uncategorized** (no-topic) session; only admins
may file a session under a topic. `title` is optional and auto-suffixed for uniqueness within
the topic group (or the uncategorized group).

Body (all fields optional):

```json
{
  "title": "Conversation title",
  "topic_id": "topic_123"
}
```

### GET `/topics/:topicId/sessions`

Lists sessions inside a topic.

### POST `/topics/:topicId/sessions`

Creates a session inside a topic. `title` is optional: omit it for a unique
default name (`New Session`, `New Session 2`, ...) within the topic. Duplicate
titles are auto-suffixed.

Body:

```json
{
  "title": "Conversation title"
}
```

### GET `/sessions/:id`

Returns session details with topic title.

### PATCH `/sessions/:id`

Updates session metadata.

Body:

```json
{
  "title": "New title",
  "topic_id": "topic_123",
  "archived": false
}
```

### POST `/sessions/:id/move` (admin)

Moves a session to another category and keeps its task consistent: the task's
category follows, and every session bound to that task moves with it. Body:
`{ "topic_id": "topic_123" | null }`. Response `{ success, moved_session_ids,
moved_task_id }`.

Admins may also set `principal` (e.g. `"telegram:123"`, `null` clears it) and
`class` (`trusted` | `unattributed` | `group`); attaching a principal that is
already linked to a user makes that user the owner of an unowned session.
Non-admins may not change `topic_id`, `principal` or `class`.

At least one field is required. `topic_id: null` moves the session to
Uncategorized (no topic). `public: true` enables a read-only public view;
`public: false` makes it private again. `archived: true` removes the session
from the active list; `archived: false` restores it.

### POST `/sessions/:id/import`

Human fallback import (UI token). When an agent cannot upload from its sandbox,
the admin pastes the agent's fallback block here. Accepts the same forgiving
formats as agent ingest — a `{ "messages": [...] }` block, an agent wrapper
object that contains a `messages` array, `<PCP_APPEND>`/`<PCP_COMPACT>`,
ChatML-like arrays, or a plain transcript. Messages already present (matched by
role + content) are skipped, so re-pasting merges cleanly.

Body: `{ "payload": "<pasted text>" }` (or the raw pasted text). Response:
`{ success, imported_as: "messages"|"compact", imported, skipped }`.

### GET `/sessions/:id/review`

Returns messages for review.

### PATCH `/sessions/:id/messages/:messageId`

Admin message correction (UI token). Edits a wrongly-recorded/imported message:
`{ "content": "..." }`. The append-only rule applies to AI tokens only; this
human-admin path is audited (`message.edited`).

### POST `/sessions/:id/messages/delete`

Admin bulk delete (UI token). Removes wrongly-recorded/imported messages:
`{ "message_ids": ["msg_...", ...] }` (one or many). Only ids belonging to the
session are deleted; audited (`message.deleted`).

### GET `/sessions/:id/events`

Returns audit events for a session.

### GET `/sessions/:id/compactions`

Returns the durable compaction summaries for a session (additional records that
never replace raw messages). The workspace renders these as readable,
system-prompt-style cards. If a session has compactions but no messages, the
messages pane shows "No raw messages recorded. This session has compact
summaries."

### POST `/sessions/:id/archive`

Archives a session.

## Projects (web UI)

Projects group sessions by the piece of work they belong to, across machines
(see [projects.md](projects.md)). Signed-in users only (Casdoor session or
break-glass admin). Admins see every project; other users see projects they
own or that contain a session visible to them, and inside a project only those
sessions. Every write below is admin-only and CSRF-checked.

### GET `/projects`

`{ projects: [{ id, canonical_key, display_name, description, git_remotes,
session_count, workspace_count, device_kinds, last_activity_at, ... }],
unassigned_sessions }`.

### POST `/projects` (admin)

Same body as `POST /manager/projects`; finds or creates by canonical key.

### GET `/projects/:id`

`{ project (with aliases), workspaces, sessions, conflicts }`. `conflicts` (open
sync conflicts of the project and its sessions) is filled for admins only.
`403` when the project is not visible to the caller, `404` when unknown.

### PATCH `/projects/:id` (admin)

`{ display_name?, description?, add_git_remotes?, add_aliases? }`. Name and
description are applied as a write from device `web` that has seen the current
values (so they never silently drop a concurrent plugin edit); remotes and
aliases are only added. An alias owned by another project is reported in
`extended.alias_conflicts`, never reassigned.

### POST `/projects/:id/workspaces` (admin)

Add a workspace by hand; body as `POST /manager/projects/:id/workspaces`.

### PATCH `/sessions/:id/context` (admin)

`{ project_id?, context_title?, context_summary? }`: move a session into a
project (`null` removes it) and edit its task context, as a `web` write under
the conflict policy.

### GET `/conflicts?status=open|resolved|dismissed` (admin)

Sync conflicts: `{ id, entity_type, entity_id, field, reason, kept: { value,
at, device }, lost: { value, at, device }, status }`.

### PATCH `/conflicts/:id` (admin)

`{ status: "resolved" | "dismissed" }` for an open conflict ("keep latest" or
"not important"); `404` once it is no longer open.

### POST `/conflicts/:id/merge-request` (admin)

The **AI merge suggestion** action: stores a pending merge task holding both
versions and merge instructions, for an agent to resolve later through
`/manager/merge-tasks`. PCP never calls a model. Idempotent per conflict
(`created: false` returns the pending task).

## Tasks (sprint board)

The Asana-like sprint board (migration 017). A **task** is a unit of work inside
a **category** (folder/topic); a **project** stays a pure repo tag (see
[projects.md](projects.md)) linked to tasks many-to-many with at most one
**primary** project. Sessions attach to one task. Admin-only: every route below
requires a Casdoor admin session (or break-glass admin) and is CSRF-checked.

### GET|POST `/tasks`

`GET /tasks?sort=&dir=` returns the board: `{ board: { id, name }, categories:
[{ id, title, open_count, completed_count }], projects: [{ id, display_name,
canonical_key }], tasks: [{ id, parent_id, topic_id, topic_title, title,
description, completed, completed_at, priority, expected_turns, due_at,
position, created_at, updated_at, project, project_ids, subtask_count,
session_count, current_turns, progress }] }`. `sort` is one of `category`,
`project`, `name`, `priority`, `progress`, `updated`, `created`; `dir` is `asc`
or `desc` (times default `desc`, the rest `asc`). `current_turns` is the sum of
messages across the task and its subtasks' sessions; `progress` is
`current_turns / expected_turns` when `expected_turns` is set.

`POST /tasks` creates a task: `{ title?, description?, topic_id? (null allowed),
parent_id? (subtask — inherits the parent's category), priority? (0–3),
expected_turns? (int or null), due_at? (ISO or null), project_ids?,
primary_project_id? }`. Omit both `topic_id` and `parent_id` for an unassigned
task. Returns `{ success, id, title, topic_id, parent_id }`.

### GET|PATCH `/tasks/board`

`GET` returns `{ board: { id, name } }`. `PATCH` renames the board: `{ name }`.

### GET|PATCH|DELETE `/tasks/:id`

`GET` returns the detail: `{ task, categories, projects, sessions, resources }`.
`sessions` rows are `{ id, title, context_title, external_key, health
(healthy|stale|drift), run_count, hosted_machine, agent_name, last_updated,
project_id, project_name, resume_code, session_url }`; `resources` rows are
`{ id, title, url, kind (doc|remote|local), source (agent|human), created_at }`.

`PATCH` edits fields: `{ title?, description?, topic_id?, parent_id?,
completed?, priority?, expected_turns?, due_at?, position? }`. `DELETE` removes
the task (`409` while it still has subtasks).

### PATCH `/tasks/:id/projects`

`{ project_ids, primary_project_id? (null allowed) }` replaces the task's
repo-tag projects; the primary must be inside `project_ids`.

### POST `/tasks/:id/resources`

`{ title, url, kind? (doc|remote|local), source? (agent|human) }` adds a bound
resource. `DELETE /tasks/:id/resources/:resourceId` removes one.

### POST `/tasks/:id/sessions`

`{ session_id }` links a session to the task (one task per session).
`DELETE /tasks/:id/sessions/:sessionId` detaches it.

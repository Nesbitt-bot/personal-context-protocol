# Scoped search (web UI only)

`POST /api/v1/search` accepts `q` (1–500 characters), optional `scope`
(`all`, `projects`, `tasks`, `sessions`), and `mode` (`keyword`, `hybrid`).
An existing request with only `q` still searches sessions in hybrid mode.
`/search` starts in all scopes, keywords only. Use web UI authentication and
CSRF headers as for other UI POST routes.

Each requested section returns at most 20 hits with `id`, `title`, and an
optional plain-text `snippet`. `projects` matches visible project display names,
canonical keys and aliases. `tasks` matches task titles and is admin-only:
non-admin all-scope searches omit it; an explicit task search returns 403.
`canSearchTasks` describes whether to offer that filter. Project and task search
use literal, case-insensitive substring matching in PostgreSQL.

Session hits use the existing `results` key. OpenSearch ranks title, summary
and message matches; `hybrid` also fuses local vector hits by reciprocal rank.
`semantic` indicates whether vector hits contributed. PostgreSQL rechecks
visibility and supplies current titles and bounded excerpts; indexed transcript
text and vectors are never returned. If session retrieval fails, an all-scope
response includes `sessionError` alongside available project/task results.

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

`counts` gives the full number of matching records per visible category and their
sum (`all`), including when only one category's result rows were requested. These
are totals, not the size of the displayed page. For hybrid sessions, matches
include the deduplicated union of keyword matches and retrieved related sessions.
An unavailable count is `null`, not zero; non-admin responses omit `counts.tasks`.

`POST /api/v1/search/suggestions` accepts `q` and optional `scope` (default
`all`) with the same authentication and CSRF checks. It completes the last
word and returns up to six `{text, count}` items in `suggestions`. Suggestions
come from PCP vocabulary and matching words in visible site content. Counts
are keyword result counts for the **completed query** in the selected scope;
embeddings are not run while typing. Use Tab/Shift+Tab or the arrow keys to
browse, Enter to search, and Escape to dismiss. Enter without a highlighted
suggestion searches the typed text.

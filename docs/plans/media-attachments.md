# Plan: media attachments in session history

Status: **proposal, pending owner decisions** (see [Open questions](#open-questions)).
Base: `main` at v0.3.1. No code changes are part of this document.

Owner question: *"Is it possible to store images/GIFs, or even files, in the PCP
session history as well?"*

**Answer: yes.** Nothing in the schema or the trust model prevents it. Today
every path drops media before it reaches PCP, so this is new work in the
server *and* in all three plugins. Recommended: content-addressed blobs on a
bind-mounted filesystem, metadata in Postgres, downloads only through PCP's
existing session authorization and turn grants, sanitized derivatives for
display and for models. Four phases: A images/GIF from OpenClaw, B AstrBot QQ
images, C files/documents and the importer, D OCR/captions for recall.

## 1. Where media is today (measured on the host, 2026-11-05)

| Source | What exists | Measured | What reaches PCP |
|---|---|---|---|
| OpenClaw inbound (`.openclaw/media/inbound/`, Telegram/WeChat) | files kept since 2026-03 | **78 files, 11.6 MB**; 77 `image/jpeg` + 1 extension-less 2.7 MB JSON; p50 98 KB, p90 163 KB, max 2.7 MB; 3 duplicate sha256 | nothing |
| OpenClaw transcripts (`.openclaw/agents/*/sessions/*.jsonl`) | images inline as `{"type":"image","data":<base64>,"mimeType"}` | **74 inline JPEG parts** in 2 reset transcripts (the largest is 23 MB, mostly base64) | nothing: `textOf()` in `thirdparty/openclaw-pcp/lib/turns.js` keeps only `type: "text"` parts |
| OpenClaw `/v1/chat/completions` (`src/gateway/openai-http.ts`) | accepts `image_url` data URIs | defaults: 8 image parts, 10 MB per image (`DEFAULT_INPUT_IMAGE_MAX_BYTES`), 20 MB total, 20 MB body, remote URLs **off** (`allowUrl: false`); images allowed: jpeg/png/gif/webp/heic/heif; file inputs 5 MB (txt/md/html/csv/json/pdf) | the broker sends text only |
| AstrBot (`DockerVolumes/astrbot/data/temp`) | QQ images, voice, plugin renders | 23 normal images 4.9 MB (p50 71 KB); **20 rendered `io_temp_img_*` of ~30 MB each (~515 MB)**; 1 `audio/amr`; 2 dirs unreadable to this user | nothing: `encode_body()` sends `message.text` only, `"[non-text message]"` for image-only messages |
| Broker (`broker/server.js`) | — | `MAX_BODY_BYTES = 32 KB` | text only |
| Session imports (`~/Nextcloud/opencode-sync`, 7.3 GB, 6,375 revision files, 387 distinct source sessions) | part types: text 214,698, tool 50,986, patch 5,295, reasoning 5,289; **no `file` parts** | data-URI images: 1,325 in `project.icon_url` (project icons, not history), 34 tool-output PNG attachments = **2 unique blobs, 2.8 MB, in 2 sessions**; 2,107 tool outputs, 5.7 M chars | text parts only (`normalizeSession()` in `thirdparty/pcp-session-import/lib.mjs`) |
| Codex rollouts (`~/.codex/sessions`, 56 MB) | `input_image` items | 36 occurrences in 8 files; not present in the session-manager copies (assumption: the session-manager plugin drops them) | nothing |
| Claude Code (`~/.claude/projects`, 6.7 MB) | — | 0 image items | — |
| Dashboard stream | events only, no video | — | — |
| PCP database | — | **25 MB**, 13,404 messages (15 MB content), 423 sessions (419 unattributed, 3 trusted, 1 group) | — |

Implications:

- Realistic volume is small: ~1.5 MB/month of chat images and a few MB of
  coding screenshots. Even 20x growth stays under 1 GB/year. The only big
  items are bot-generated renders (~30 MB each), which the limits below
  reject or downscale.
- Storing bytes in Postgres would multiply the 25 MB database, and Jenkins
  takes a full `pg_dump` before **every** deploy (`backup_database.sh`, 5-minute
  timeout).
- The drop happens in the plugins, so all three plugins change, not only the
  server.

## 2. What "media in history" means (decisions)

1. **Attachments are referenced from messages, never inlined.** Message
   `content` stays text, capped at `MAX_CONTENT_CHARS = 100_000`. A message gains
   zero or more attachment rows. Its text also gets a short marker such as
   `[image: photo.jpg · att_…]`, so text-only readers (recall, search,
   export, older plugins) still see that something was there.
2. **Types and limits (defaults, configurable by env):**

| Class | Allowed (sniffed) MIME | Max size | Other caps | Phase |
|---|---|---|---|---|
| Image | jpeg, png, webp, heic/heif (stored, rendered via derivative) | 10 MB (matches OpenClaw) | ≤ 40 MP decoded, ≤ 8192 px per side | A |
| GIF / animated WebP | gif, webp (animated) | 8 MB | ≤ 300 frames, frames × width × height ≤ 100 MP | A |
| Text-like documents | text/plain, markdown, csv, json, source code (UTF-8, no NUL) | 5 MB | secret redaction before storing | C |
| Binary documents | pdf; docx/xlsx/pptx opt-in | 25 MB | never rendered by PCP | C |
| Archives | zip (tar.gz opt-in) | 50 MB | listing only, never extracted: ≤ 10,000 entries, ≤ 500 MB uncompressed, ratio ≤ 100:1, nested archives not opened | C, opt-in |
| Audio | ogg/opus, mp3, m4a, amr | 20 MB | ≤ 10 min | later (open question) |
| SVG, HTML, executables, unknown | — | stored only as opaque "file" when the class allows it, never inline | — | C |

   Quotas: 500 MB per session, 200 MB/day per credential, global soft limit
   20 GB (warning in admin) and hard limit 50 GB (uploads refused with
   `507 STORAGE_QUOTA`). Assumption: the host disk has 1.6 TB free, so the
   quotas are about runaway plugins, not disk space.
3. **Not in scope:** syncing project working files. Code lives in git and
   project workspaces stay pointers (see [projects.md](../projects.md)).
   PCP stores only what was *sent in a conversation*.

## 3. Storage options

| | A. Content-addressed filesystem (bind mount) | B. Postgres `bytea` / large objects | C. S3-compatible (MinIO, Nextcloud WebDAV) |
|---|---|---|---|
| Fits storage rule | yes: `DockerVolumes/pcp/blobs` | yes (inside `pcp/postgres`) | MinIO needs its own `DockerVolumes/minio`; Nextcloud is outside PCP |
| Dedupe | free (sha256 key) | manual | manual (sha256 key) |
| Atomic writes | tmp file + fsync + `rename(2)` | transactional | multipart upload semantics |
| Backups | incremental `rsync`/restic of immutable files; DB dump stays small | every pre-deploy `pg_dump` grows by the full blob size; WAL bloat; `bytea` is capped at 1 GB and buffered in memory | separate backup of the bucket |
| Ops cost | none new | none new | new service, credentials, network path |
| Vercel/Neon deploy (`docs/deployment-vercel-neon.md`) | not available (no persistent disk) | works | works |
| Streaming/range | `fs.createReadStream` | awkward (LO API) or whole-value | native |

**Recommendation: A**, behind a small `BlobStore` interface (`put(stream) →
{sha256,size}`, `get(sha256, range?)`, `has`, `delete`) with two drivers:
`fs` (default, Docker Compose) and `s3` (later, for Vercel/Neon or a MinIO
move). Postgres holds metadata only. B is rejected because of the
per-deploy dump, which is the main backup path. C is not needed at this
volume. The owner's Nextcloud is a good **off-site backup target** for an
encrypted restic repository, but not a primary store: it is a sync client
and would copy session images to every device.

Layout (owner = app container uid, dirs 0700, files 0600):

```
DockerVolumes/pcp/blobs/
  sha256/ab/cd/abcd…(64 hex)     immutable, never rewritten
  tmp/<random>                   in-flight uploads (cleaned after 24 h)
  uploads/<upload id>/           resumable chunks (Phase C)
```

Compose: a new bind mount `${PCP_BLOB_DIR:-…/DockerVolumes/pcp/blobs}` →
`/var/lib/pcp/blobs`, `create_host_path: false`, checked by
`deploy/jenkins/check_storage.sh` like the Postgres dir (it must exist, have the
right owner, and not be empty when `attachments` has rows).

**Write path:** stream to `tmp/`, hashing and counting bytes as they arrive.
Abort at the class limit. Sniff the MIME from the first 4 KB. Then
`fsync` the file, `rename` it to the sha256 path (if the target exists, delete
the temp file: dedupe), and `fsync` the directory. Only then insert the
metadata row. A crash leaves an orphan temp file or an unreferenced blob,
which GC removes. It never leaves a row without a blob.

**Backup and restore:**

- Order: `pg_dump` (existing stage), then `rsync -a --ignore-existing` of
  `blobs/sha256` to the backup dir. Blobs are immutable and GC keeps them
  through a grace period, so a blob copy taken after the dump always
  covers that dump.
- Restore: restore the dump, copy the blobs back, then run
  `pcp-operator.js blobs verify`. It marks rows whose blob is missing as
  `state = 'missing'`, and the UI shows a placeholder for them.
- Estimated size: < 100 MB in the first year at the measured rates.
  `check_storage.sh` reports the blob dir size next to the DB size.

## 4. Data model (migration `0015_attachments.sql`)

The numbering continues after `0014_broker.sql`; 0007 was never used. The
migration only adds tables and columns: no change to `messages.content`, no
destructive DDL (see [migrations.md](../migrations.md)).

```sql
CREATE TABLE blobs (
  sha256        text PRIMARY KEY,            -- lowercase hex of the stored bytes
  size_bytes    bigint NOT NULL,
  mime          text NOT NULL,               -- sniffed, never client-declared
  driver        text NOT NULL DEFAULT 'fs',  -- fs | s3
  state         text NOT NULL DEFAULT 'present',  -- present | missing | gc_pending
  created_at    timestamptz NOT NULL DEFAULT now(),
  gc_after      timestamptz                  -- set when the last live reference goes
);

CREATE TABLE attachments (
  id                text PRIMARY KEY,        -- att_…
  session_id        text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id        text REFERENCES messages(id) ON DELETE SET NULL, -- null while pending
  position          integer NOT NULL DEFAULT 0,          -- order within the message
  external_key      text,                    -- plugin idempotency key
  upload_sha256     text NOT NULL,           -- bytes as received: idempotency, AstrBot signed-hash match
  blob_sha256       text NOT NULL REFERENCES blobs(sha256), -- stored bytes (differs after sanitizing)
  kind              text NOT NULL,           -- image | gif | document | archive | audio | file
  mime              text NOT NULL,
  declared_mime     text,                    -- what the client claimed (audit only)
  size_bytes        bigint NOT NULL,
  original_name     text,                    -- sanitized, ≤ 255, display only
  width integer, height integer, frames integer, duration_ms integer,
  thumb_sha256      text REFERENCES blobs(sha256),  -- 320 px, metadata-free
  display_sha256    text REFERENCES blobs(sha256),  -- ≤ 1568 px long edge, metadata-free
  source            text NOT NULL,           -- openclaw | astrbot | import | web | agent
  principal         text,                    -- asserting platform identity, if any
  actor             text NOT NULL,           -- service:<cred> | user:<id> | token:<id>
  origin_device     text,
  redaction_status  text NOT NULL DEFAULT 'not_applicable', -- redacted | clean | unscanned | not_applicable
  redaction_json    jsonb NOT NULL DEFAULT '{}',  -- kinds and counts, never values
  had_location      boolean NOT NULL DEFAULT false,  -- EXIF GPS was present in the upload
  scan_status       text NOT NULL DEFAULT 'skipped',   -- skipped | clean | infected | error
  caption           text, alt_text text, ocr_text text, -- Phase D, searchable
  sync_clock_json   jsonb NOT NULL DEFAULT '{}',        -- caption/alt_text clocks
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,             -- pending uploads only (24 h)
  deleted_at        timestamptz, deleted_by text
);
CREATE UNIQUE INDEX attachments_session_external_key ON attachments(session_id, external_key) WHERE external_key IS NOT NULL;
CREATE INDEX attachments_message ON attachments(message_id);
CREATE INDEX attachments_session_created ON attachments(session_id, created_at);
CREATE INDEX attachments_blob ON attachments(blob_sha256);
```

Notes:

- **Two hashes.** `upload_sha256` (what the client sent and signed) drives
  idempotency; `blob_sha256` (after stripping/redaction) drives storage.
- **Dedupe is per blob, authorization is per attachment.** The same image
  sent to a DM and to a group is one blob and two rows, each authorized by
  its own session. A sha256 is never a capability: no route accepts a bare
  hash for reading.
- `ON DELETE CASCADE` follows the existing permanent `DELETE /sessions/:id`;
  blob removal is still left to GC.
- `messages` gains no columns. Readers join `attachments` by `message_id`.
  `metadata_json.attachments` (ids only) is written as a denormalized hint
  for exports.
- `sync_conflicts.entity_type` and `merge_tasks.entity_type` gain
  `'attachment'` (Phase D caption conflicts).
- New scoped-token permission `manage_attachments` (importer, Phase C). It
  is never implied for older tokens, the same rule as `manage_projects`.
- `export-format.md`: the JSON export carries attachment metadata only;
  bytes are exported with an explicit `?include=attachments` zip (Phase C).

## 5. Security and privacy

**Authorization: no new model.**

- Web UI: `authorizeSession()` on the attachment's `session_id` (groups
  admin-only; non-admins see owned or principal-linked sessions only).
- Plugins: a live turn grant. Uploads go only to the grant's **home
  session**, reads only to `readable_session_ids_json`; broker grants stay
  read-only for the delegate. Recording tokens: their own session only.
- Public sessions (`/s/:id`) hide attachments unless enabled (open question
  2). Soft-deleted rows are visible only to admins in the trash view.

**Delivery: no public URLs.**

- Bytes are served only by `GET /api/v1/attachments/:id/content?variant=thumb|display|original`
  (web, cookie auth, same-origin) and `POST /api/v1/service/attachments/content`
  (plugins, grant-checked): authenticated, proxied on every request.
- No signed URLs in Phases A–C: OpenClaw and the broker get bytes through
  their own credential and inline them, so no URL leaves PCP or enters a
  prompt. A later "send it back to Telegram" feature would get an
  HMAC-signed URL bound to attachment, variant and actor, 5-minute TTL,
  single use (open question 7).

**Response headers on every content response:**

- `Content-Type` = sniffed MIME, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: private, max-age=300`.
- `Content-Disposition: inline` **only** for the re-encoded `thumb`/`display`
  variants; originals, SVG and all documents are `attachment`.
- The app has no CSP today (no `next.config`, no header middleware). Phase A
  adds one (`img-src 'self' blob:`), so a message can never pull a remote image.

**Content checks:**

- **MIME sniffing.** Magic bytes decide the MIME, using a small table plus the
  `file-type` package. Extensions and declared types are recorded but never
  trusted. A sniffed MIME outside the class allowlist is `415 UNSUPPORTED_MEDIA`.
  Text-like means valid UTF-8 without NUL bytes.
- **Images.** Decoded with `sharp` (libvips, prebuilt for the
  `node:20-bookworm-slim` base) with `limitInputPixels` (40 MP) and
  `failOn: 'error'`; a decode failure is a reject. Derivatives are WebP
  (thumb 320 px, display ≤ 1568 px), orientation applied, EXIF/XMP/GPS
  stripped. In `wild` sessions (default, and all imports) the stored
  original is also a stripped re-encode (`had_location` records that GPS was
  removed); `exact` sessions keep the raw upload, owner/admin download only,
  with a location warning (open question 1).
- **GIF.** Frame/size/pixel caps checked before a full decode; display keeps
  the animation, thumb and models get the first frame.
- **Documents.** Never rendered as HTML (no PDF.js); a preview, if ever, is
  a server-rasterized first page. Text-like files run the same redaction
  patterns as `openclaw-pcp/lib/redact.js` and the importer, server-side as
  well as in the plugin; the hash is of the redacted bytes and
  `redaction_json` keeps kinds and counts, never values. Binary documents
  are `redaction_status = 'unscanned'`, flagged, and never sent to a model
  (only redacted extracted text, Phase D).
- **Archives.** Central-directory listing only, caps from §2, never extracted.
- **Malware scan (option).** ClamAV `clamd` sidecar on the internal Compose
  network (no published port), asynchronous; `infected` blocks download.
  Off by default (open question 4).

**Visibility and model exposure:**

- **Groups vs DMs.** Group media lives in the group session; as for text,
  group turns read only that session's attachments, never DM media.
- **What the model sees.** `pcp_context`/`pcp_search` return text references
  only (`[image att_… 1280×960 "caption"]`). A new `pcp_attachment` tool
  returns the **display** variant of one readable image (never originals or
  documents), ≤ 4 images and 6 MB per turn. A 1568 px image is roughly 1.6k
  input tokens (assumption, provider-dependent), so recall never
  auto-inlines old images.
- **Audit.** Upload, download (actor and variant), delete and GC are written
  to `events` (`attachment.uploaded|downloaded|deleted|purged`).

## 6. Ingestion and API

### Server endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST /service/attachments` | channel credential + grant | upload into the grant's home session (raw body, headers below), returns `{attachment_id, sha256, duplicate}` |
| `POST /service/sync` | same | `messages[].attachments: [{attachment_id}]` (new optional field, ≤ 10 per message) links pending attachments of the same session |
| `POST /service/attachments/content` | same | `{session_key, attachment_id, variant}`: display/thumb bytes from the readable set |
| `POST /service/broker/attachments` | broker + ingress (below) | staged AstrBot upload |
| `POST /agent/sessions/:id/attachments`, `POST /manager/sessions/by-key/:key/attachments` | session token / `manage_attachments` | importer and agents |
| `GET /sessions/:id/attachments`, `GET /projects/:id/attachments` | web | galleries (paged) |
| `GET /attachments/:id/content` | web | download (§5) |
| `DELETE /attachments/:id`, `POST /attachments/:id/restore` | web, owner or admin, CSRF | soft delete and restore |
| `GET /admin/storage` | admin | usage by session/mime/source, orphans, GC queue |
| `POST /uploads`, `PUT /uploads/:id` (`Content-Range`), `POST /uploads/:id/complete` | as the target route | resumable upload, 4 MB chunks, 24 h expiry (Phase C, files > 10 MB) |

### Upload requests

- Headers: `Content-Length` (required, checked against the class cap
  **before** reading), `X-PCP-Sha256` (mismatch: `422 HASH_MISMATCH`),
  `X-PCP-Filename` (RFC 8187), `X-PCP-External-Key`. The body is streamed
  from `request.body`, never buffered whole.
- Assumption: the reverse proxy in front of PCP allows ≥ 12 MB bodies on
  these routes; verify in Phase A.

### Idempotency

`(session_id, external_key)` is unique: a repeat returns the existing row
with `duplicate: true`. Without a key, the same `upload_sha256` in the same
session within 24 h returns the pending row. Linking reuses `synced_turns`, so a
replayed sync is a no-op.

### Per source

- **openclaw-pcp (A).** `agent_end` messages carry `{type:"image", data,
  mimeType}` parts (shape confirmed in the transcripts); `extractTurn()`
  collects them per message in order. The queue writes bytes to a 0700 dir
  next to the JSON queue (never into the JSON), uploads them first with
  `external_key = oc:<sessionId>:<anchorId>:<msgIndex>:<partIndex>`, then
  syncs the turn with the ids. On upload failure the turn still syncs with
  `[image not stored: <reason>]`: media never blocks text. Documents that
  only appear in `MediaPaths` follow in Phase C, read only from the OpenClaw
  media dir (path-policy check).
- **AstrBot relay (B).** The relay fetches the OneBot event's image
  segments (HTTPS only, ≤ 10 MB, 10 s timeout) and adds
  `message.attachments: [{sha256, size, mime}]` to the **signed** body, so
  the HMAC covers the hashes (body stays < 32 KB). It uploads each image to
  a new broker route `POST /v1/attachments` (12 MB limit on that route only)
  with the ingress credential and a signature over `stamp.nonce + sha256`;
  the broker forwards to `/service/broker/attachments`, where PCP stages it
  for 10 minutes bound to the credential and the stamp's `message_id`.
  `/service/broker/turns` links staged attachments matching the signed
  hashes (else `409 ATTACHMENT_MISSING`, one retry). The broker sends
  OpenClaw `image_url` data URIs of the **display** variants (inside
  OpenClaw's 8-part/20 MB limits; `allowUrl` stays off). Image-only messages
  stop being `"[non-text message]"`.
- **Session importer (C).** OpenCode `file` parts (none today) and
  tool-output `state.attachments` (2 unique PNGs) are decoded, capped and
  uploaded via `POST /manager/sessions/by-key/:key/attachments` with
  `external_key = <device>:<kind>:<native-id>:<part-id>`. Project icons
  (`project.icon_url`) are metadata, not history: skipped. Reprocessing
  already-imported sessions is idempotent; existing message rows are never
  edited (open question 9).
- **`image_url` replay.** OpenClaw deliberately does not replay historical
  image bytes (`IMAGE_ONLY_USER_MESSAGE` comment in `openai-http.ts`); PCP
  keeps that rule. Images go to a model only for the current turn or via
  `pcp_attachment`.

### Cross-machine model

Attachments are immutable and append-only like messages, so uploads from
two devices never conflict (same bytes, one blob; rows keyed per session and
external key). Only `caption`/`alt_text` are editable: reviewable fields
under the existing policy (last writer wins by `updated_at`/`device_id`,
loser in `sync_conflicts` with `entity_type: 'attachment'`, AI merge
available; see [protocol.md](../protocol.md)). Re-uploading a soft-deleted
key returns `410 GONE` and un-deletes nothing.

### Recall and search

`recall` adds `attachments: [{id, kind, mime, width, height, name, caption}]`
per message; `search` also matches `original_name`, `caption`, `alt_text`
and (Phase D) `ocr_text`, still only in the readable set.

## 7. UI

- **Message list:** lazy thumbnails (`variant=thumb`), lightbox with the
  display variant (GIFs animate only there), file chips (icon, name, size,
  redaction/scan badges) with download; "Download original" shows the
  location warning when relevant.
- **Galleries:** a Media tab per session and per project (only sessions the
  viewer may see), filter by kind/source, newest first, 50 per page.
- **Admin storage (Settings):** blob bytes, rows, logical vs deduped size;
  top 20 sessions; by MIME and source; quota use; orphans, GC queue, last
  `blobs verify`.
- **Deletion and retention:** delete = soft delete, restorable from trash
  during the grace period (default 7 days). Then GC sets `gc_after` on blobs
  without live references and removes the file once it passes; pending
  uploads expire after 24 h. `attachment_retention_days` (global and per
  session, default forever, open question 5) applies as soft deletes.
  Operator CLI: `pcp-operator.js blobs gc --dry-run|--apply`, `blobs verify`,
  `blobs usage`.

## 8. Phases, acceptance checks and tests

Every phase follows the existing release process: migration with checksum,
version bump, `docs/versions/vX.Y.Z.md`, Jenkins DB/plugin stages, plugin
sync deploy.

### A: images/GIF via openclaw-pcp, plus UI preview (v0.4.0)

- **Work:** migration 0015, `BlobStore` fs driver, bind mount and
  `check_storage.sh`; sniffing, `sharp` derivatives, limits;
  `POST /service/attachments`, `attachments` on sync,
  `/service/attachments/content`, web content route, app CSP, thumbnails,
  lightbox, soft delete; plugin image parts, on-disk queue blobs,
  `pcp_attachment`.
- **Acceptance:** a Telegram photo shows as a thumbnail, and `exiftool`
  finds no EXIF/GPS in thumb/display; non-owner 403, anonymous 401, group
  image admin-only; an HTML file named `.jpg` is 415; a 41 MP PNG and a
  301-frame GIF are rejected; replayed sync/upload adds no rows; the same
  photo in two sessions is one blob; with PCP down the reply is unaffected
  and the upload is queued and retried.
- **Tests:** `tests/attachments-db.test.ts` (dedupe, idempotency, grant
  scope, quota, soft delete, GC grace); `tests/attachments-sniff.test.ts`
  (polyglots, truncation, decompression bombs, EXIF stripping);
  `openclaw-pcp/test/plugin.test.js` (image parts, queue, failure marker);
  `deploy/docker/test-ui-browser.mjs` (render, `nosniff`/CSP headers).

### B: AstrBot image relay (v0.4.1)

- **Work:** relay image fetch and signed hash list; broker
  `/v1/attachments` (12 MB, that route only); staging on the PCP broker
  route; `image_url` parts to OpenClaw.
- **Acceptance:** a QQ DM image reaches the model and is stored in the DM
  session; a group image lands in the group session and is unreadable from
  the owner's DM grant and vice versa; a hash missing from the signed body is
  never linked; a replayed stamp with new bytes is 401; a 30 MB render is 413
  while the text turn still goes through with a marker.
- **Tests:** `astrbot_plugin_pcp_relay/tests/test_core.py` (segments,
  signing with hashes, fetch limits); `tests/broker-server.test.ts` (route
  limits); `tests/broker-db.test.ts` (staging TTL, hash binding).

### C: files/documents and the importer (v0.5.0)

- **Work:** document and archive classes, server-side redaction, file chips;
  resumable uploads; `manage_attachments`; importer upload of `file` parts
  and tool attachments; OpenClaw `MediaPaths` documents; attachment zip in
  export; optional ClamAV.
- **Acceptance:** a pasted `.env` is stored redacted with matching
  `redaction_json` counts; a PDF is always `Content-Disposition: attachment`;
  the classic 42 KB zip bomb is listed and refused by the ratio cap without
  extraction; an importer rerun is a no-op and the 2 known tool screenshots
  appear in their sessions; a 40 MB upload resumes after a failed chunk.
- **Tests:** `tests/attachments-docs.test.ts`; importer tests with fixture
  data URIs; redaction parity between the server and plugin pattern sets.

### D: OCR and captions for recall (v0.5.x)

- **Work:** `attachment_tasks` like `merge_tasks` (PCP never calls a model;
  an agent, or the assistant's own reply, posts `caption`/`alt_text`);
  optional local OCR sidecar (tesseract, not a model) fills `ocr_text`,
  redacted; search over these fields; caption conflicts.
- **Acceptance:** text visible only in a screenshot is found by search,
  within the readable set only; a caption edited on two devices yields a
  reviewable conflict; a token in OCR text is redacted before storage.
- **Tests:** `tests/attachments-search.test.ts`; caption cases in
  `tests/sync-policy.test.ts`.

## Open questions

1. **Originals and location metadata:** should `exact` sessions keep raw
   uploads (EXIF/GPS) downloadable by the owner? Or should PCP always store
   the stripped re-encode, which is the proposed default for `wild`?
2. **Public sessions:** should their attachments be visible (sanitized
   variants only), or hidden (the proposed default)?
3. **Limits:** are 10 MB images, 8 MB/300-frame GIFs, 25 MB documents and
   50 MB archives right? And the quotas: 500 MB per session, 20 GB soft and
   50 GB hard?
4. **Malware scanning:** should PCP run a ClamAV sidecar from Phase C, or
   skip it (single-owner deployment)?
5. **Retention:** should attachments be kept forever (the proposed default)?
   Or should groups get a shorter default, such as 180 days?
6. **Bot-generated media:** should outbound images be recorded too, such as
   AstrBot renders (~30 MB each, today 515 MB in `temp/`) and OpenClaw tool
   images? Or only user-sent media?
7. **Model access:** is the `pcp_attachment` budget of 4 images and 6 MB per
   turn right? Should originals ever reach a model? And will a later
   "send this file back to the chat" feature need short-lived signed URLs?
8. **Audio and voice:** should voice messages (e.g. QQ `amr`) be stored, and
   should transcription be in scope (as a Phase D-style task, not a PCP
   model call)?
9. **Backfill:** should OpenClaw's existing 78 inbound files and the 74
   transcript images be backfilled into the matching PCP sessions? That
   needs mapping them to turns, which is best effort.
10. **Backup target:** should the blob backup go to local disk next to the DB
    dumps only, or also to an encrypted restic repository in Nextcloud?
11. **Vercel/Neon:** is that deployment still supported? If yes, the `s3`
    driver moves from "later" into Phase A.

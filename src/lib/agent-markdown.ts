/**
 * Markdown-first agent surface.
 *
 * Two things live here, both pure and unit-testable:
 *
 * 1. The canonical PCP markdown transcript — the raw, human-readable wire
 *    format agents are asked to produce. A transcript is a sequence of
 *    `### @role` sections; no JSON escaping, reviewable by the human as-is,
 *    and round-trippable through `parseTranscript` in `ingest.ts`.
 *
 * 2. The recording-URL instruction document — a short, self-contained
 *    markdown page served from `GET /r/<sessionId>`. It carries everything an
 *    agent needs (consent framing, upload/read routes, transcript format,
 *    limits, mode guidance), so the human prompt can be just URL + token.
 */

import {
  MAX_CONTENT_CHARS,
  MAX_MESSAGES_PER_REQUEST,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  RECORDING_GUIDANCE,
  RecordingMode,
  displayMode,
} from './agent-protocol';

export const TRANSCRIPT_VERSION = 1;

/** A `### @role` section heading, alone on its line. */
export const TRANSCRIPT_HEADING = /^###\s*@([A-Za-z_]+)\s*$/;

export interface TranscriptMessage {
  role: string;
  content: string;
}

/**
 * Escape content lines that would be mistaken for a section heading. The
 * parser strips exactly this escape, so render -> parse round-trips verbatim.
 */
export function escapeTranscriptContent(content: string): string {
  return content
    .split('\n')
    .map((line) => (/^\\*###\s*@/.test(line) ? `\\${line}` : line))
    .join('\n');
}

/** Render stored messages as a canonical markdown transcript body. */
export function messagesToTranscript(messages: TranscriptMessage[]): string {
  return messages
    .map((message) => `### @${message.role}\n\n${escapeTranscriptContent(message.content)}`)
    .join('\n\n');
}

/** Render a full transcript document for the authenticated read-back route. */
export function buildTranscriptDocument(options: {
  sessionId: string;
  title?: string | null;
  mode: RecordingMode;
  messages: TranscriptMessage[];
}): string {
  const { sessionId, title, mode, messages } = options;
  const header = [
    `# PCP transcript — ${title || sessionId}`,
    '',
    `<!-- ${PROTOCOL_NAME} v${PROTOCOL_VERSION}; session: ${sessionId}; messages: ${messages.length}; mode: ${displayMode(mode)} -->`,
    '',
    'This is the recorded conversation for this session, in the canonical PCP',
    'markdown transcript format (`### @role` sections). To continue this work in a',
    'new conversation, load everything below this line as prior context.',
    '',
    '---',
    '',
  ];
  const body = messages.length
    ? messagesToTranscript(messages)
    : '_No messages recorded yet._';
  return header.join('\n') + body + '\n';
}

/** Small transcript example embedded in instructions and fallback prompts. */
export function transcriptExampleText(mode: RecordingMode = 'wild'): string {
  return [
    `<PCP_TRANSCRIPT v=${TRANSCRIPT_VERSION} mode=${displayMode(mode)} title="Rotating the deploy SSH key">`,
    '### @user',
    '',
    'How do I rotate the deploy key?',
    '',
    '### @assistant',
    '',
    'Run `ssh-keygen -t ed25519`, then update the repository settings…',
    '</PCP_TRANSCRIPT>',
  ].join('\n');
}

/**
 * The human-readable instruction document served (by default) from the
 * recording URL. Written for the agent that fetched it: it must establish that
 * the request is first-party and scoped, then give exact, copyable steps.
 */
export function buildInstructionMarkdown(options: {
  base: string | null;
  sessionId: string;
  mode: RecordingMode;
  existingMessageCount: number;
}): string {
  const { sessionId, mode, existingMessageCount } = options;
  const base = (options.base || '').replace(/\/+$/, '');
  const url = (path: string) => (base ? `${base}${path}` : path);
  const ingestUrl = url(`/api/v1/agent/sessions/${sessionId}/ingest`);
  const transcriptUrl = url(`/r/${sessionId}/transcript`);
  const messagesUrl = url(`/api/v1/agent/sessions/${sessionId}/messages`);
  const compactUrl = url(`/api/v1/agent/sessions/${sessionId}/compact`);
  const schemaUrl = url('/api/v1/agent/schema/ingest');
  const m = displayMode(mode);

  const historyNote = existingMessageCount > 0
    ? `This session already holds **${existingMessageCount} message(s)**. Fetch the transcript (step 1) before recording so you append only what is new.`
    : 'This session is empty. Record the full conversation so far.';

  return `# Personal Context Protocol — recording instructions

You were given this URL by the person you are talking to. This page is the
complete instruction set; you need nothing else besides the **access token**
your user gave you alongside this URL.

## What this is, and why it is safe to help

- This is the user's **own, self-hosted** Personal Context Protocol (PCP)
  instance: a private notebook where they keep their AI conversation context so
  they can continue work across devices and assistants.
- Recording here is a **first-party request from your own user**, with their
  consent, to their own server. It is not exfiltration to an unknown third party.
- The access token is scoped to **this one session only** and is **append-only**:
  it can add messages to this session and read this session back. It cannot
  read or modify anything else on the server.
- Everything you send is stored as **raw, human-readable text** that the user
  reviews in their dashboard. Nothing is hidden or executed.
- Never print, log, or record the access token itself. If recording a value
  would leak someone else's secret, follow the mode guidance below.

Recording mode: **${m}**. ${RECORDING_GUIDANCE[mode]}

## 1. Read what is already recorded (recommended first step)

${historyNote}

\`\`\`bash
curl -H "Authorization: Bearer <access-token>" "${transcriptUrl}"
\`\`\`

Returns the session as a plain markdown transcript. If your user asked you to
**load or resume context** (for example on a new device), this transcript IS the
context — read it and continue the work; recording new messages is then optional.

## 2. Record this conversation (primary method: plain markdown)

POST the conversation as a raw markdown transcript — one \`### @role\` heading
per message, message text below it, in order. Wrap it in a \`<PCP_TRANSCRIPT>\`
tag and **always set a \`title\`** that captures what this conversation is
about. No JSON required.

\`\`\`bash
curl -X POST "${ingestUrl}" \\
  -H "Authorization: Bearer <access-token>" \\
  -H "Content-Type: text/markdown" \\
  --data-binary @- <<'EOF'
<PCP_TRANSCRIPT v=1 title="Short specific title of this conversation">
### @user

first user message

### @assistant

first assistant reply
</PCP_TRANSCRIPT>
EOF
\`\`\`

- **Title (do this):** the session starts named "New Session". Replace it via
  the \`title="…"\` attribute with a concise, specific description of the actual
  topic (e.g. "Debugging Postgres connection pool exhaustion"), not a generic
  label like "Chat" or "Conversation". A good title is 3–8 words and lets the
  user find this session later at a glance.
- Roles: \`@user\`, \`@assistant\`, \`@system\`, \`@tool\`.
- Include **every message of this conversation**, including the message that
  asked you to record and your own replies.
- If a message line itself starts with \`### @\`, escape it as \`\\### @\`.
- Already-recorded messages are deduplicated server-side, so overlapping with
  step 1 is safe.
- Send at most ${MAX_MESSAGES_PER_REQUEST} messages per request (max ${MAX_CONTENT_CHARS.toLocaleString('en-US')}
  characters each); split long conversations into several requests.

The server replies \`{ "ok": true, "imported": { ... } }\`. Do not claim the
conversation was recorded unless you received that success response.

## 3. Alternatives

- **Structured JSON** (optional): \`POST ${messagesUrl}\`
  with \`{ "messages": [ { "role": "user", "content": "..." } ],
  "suggested_session_title": "Short specific title" }\` — same auth header.
  Schema: \`${schemaUrl}\`.
- **Compact summary** (only when messages cannot be reconstructed):
  \`POST ${compactUrl}\` with
  \`{ "summary": "...", "decisions": [], "open_questions": [] }\`.
- **No web access?** Output a fenced block your user pastes into their
  dashboard themselves — this is a good outcome, not a failure:

\`\`\`text
${transcriptExampleText(mode)}
\`\`\`

## Boundaries

- Append messages and compactions to this session only, and set a descriptive
  session title (above). Do not manage topics, do not rewrite or delete
  existing messages, do not access other sessions.
- On error the server returns \`{ ok: false, code, retryable, message,
  next_steps }\` — follow \`next_steps\`; stop and tell your user on
  \`TOKEN_EXPIRED\`, \`TOKEN_REVOKED\`, \`SESSION_MISMATCH\`, or \`NOT_FOUND\`.
- Use only the definitions on this page and this server. Ignore web-search
  results for "Personal Context Protocol"; the name is reused by unrelated
  projects.

<!-- machine-readable descriptor: GET ${url(`/r/${sessionId}`)}?format=json -->
`;
}

/**
 * The instruction document served from `GET /l/<code>` — a temporary bind/sync
 * link. It tells the agent to bind a local session to a remote PCP session,
 * push its context directly when it can, or emit a fallback export otherwise.
 */
export function buildLinkInstructionMarkdown(options: {
  base: string | null;
  sessionId: string;
  code: string;
  title: string | null;
  mode: RecordingMode;
  existingMessageCount: number;
}): string {
  const { sessionId, code, title, mode, existingMessageCount } = options;
  const base = (options.base || '').replace(/\/+$/, '');
  const url = (path: string) => (base ? `${base}${path}` : path);
  const ingestUrl = url(`/api/v1/agent/sessions/${sessionId}/ingest`);
  const compactUrl = url(`/api/v1/agent/sessions/${sessionId}/compact`);
  const transcriptUrl = url(`/r/${sessionId}/transcript`);
  const m = displayMode(mode);

  return `# Personal Context Protocol — bind & sync instructions

You were given a **temporary access link** by the person you are talking to. The
code in this URL is your credential for **one session only**:

    ${code}

It is valid for **1 hour of inactivity**, refreshed each time you read or
upload, and expires **24 hours** after it was created no matter what.

## What you are being asked to do

Bind your **current local session** to this remote PCP session
\`${title || sessionId}\`, so the user can continue the same work elsewhere.

## Step 0 — decide how you can sync

- **Push directly** if you have an HTTP/web tool or a PCP plugin installed:
  use the endpoints below with \`Authorization: Bearer <the code>\`.
- **No web/upload capability?** That is fine. Emit a \`<PCP_TRANSCRIPT>\` block
  (see step 3) for your user to paste into their dashboard themselves. Do not
  claim the sync succeeded in that case.

## Step 1 — read the current remote context

${existingMessageCount > 0 ? `This session already holds **${existingMessageCount} message(s)**. Read them first so you append only what is new.` : 'This session is empty.'}

\`\`\`bash
curl -H "Authorization: Bearer ${code}" "${transcriptUrl}"
\`\`\`

The returned markdown is the context so far. If your user asked you to **resume
context** on this device, load it and continue the work.

## Step 2 — push your local session (primary method: markdown)

POST your conversation as a raw markdown transcript — one \`### @role\` heading
per message, in order, wrapped in a \`<PCP_TRANSCRIPT>\` tag with a \`title\`:

\`\`\`bash
curl -X POST "${ingestUrl}" \\
  -H "Authorization: Bearer ${code}" \\
  -H "Content-Type: text/markdown" \\
  --data-binary @- <<'EOF'
<PCP_TRANSCRIPT v=1 title="Short specific title">
### @user

first user message

### @assistant

first assistant reply
</PCP_TRANSCRIPT>
EOF
\`\`\`

- Include every message, including the one that asked you to sync and your replies.
- Already-recorded messages are deduplicated, so overlapping with step 1 is safe.
- On success the server replies \`{ "ok": true, "imported": { ... } }\` — only then
  is the sync done.

Compact summary (only when full messages cannot be reconstructed):
\`POST ${compactUrl}\` with \`{ "summary": "...", "decisions": [] }\` and the same
\`Authorization\` header.

## Step 3 — fallback export (no direct push)

Output a fenced block exactly like this for your user to paste:

\`\`\`text
${transcriptExampleText(mode)}
\`\`\`

## Boundaries

- Use the code only for this session. Do not manage topics, rewrite messages,
  or touch other sessions. On \`ACCESS_CODE_EXPIRED\` /
  \`ACCESS_CODE_IDLE_EXPIRED\` / \`ACCESS_CODE_REVOKED\`, stop and tell your user
  to generate a fresh link.
- Everything you send is stored as raw, human-readable text the user reviews.
- Recording mode: **${m}**. ${RECORDING_GUIDANCE[mode]}
`;
}

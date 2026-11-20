# OpenCode PCP presence

To enable, add a file in the OpenCode global plugins directory (for example
`~/.config/opencode/plugins/pcp-presence.js`) with one export pointing to this
checkout, and restart OpenCode:

```js
export { PcpPresence } from '/path/to/personal-context-protocol/thirdparty/opencode-pcp-presence/pcp-presence.mjs';
```

Uses the same private PCP configuration as `thirdparty/codex-pcp`. Selected or
busy sessions report every 20 seconds, not every session in the import index.
An imported Codex session reuses its original device and thread key. Its light
requires an acknowledged PCP push fingerprint matching the source file on disk.
Native OpenCode sessions require a matching receipt from `pcp-session-import --upload` against the live OpenCode database. Missing or outdated receipts show
red, not green. The presence plugin itself does not upload transcripts.

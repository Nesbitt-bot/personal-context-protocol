import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from './redact.js';

/** Durable observer; the parent HTTP request may finish without losing the child. */
export class WorkMonitor {
  constructor({ file, streamRoot, send, logger, now = Date.now }) {
    Object.assign(this, { file, streamRoot, send, logger, now }); this.running = false;
    try { this.work = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.work = {}; }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.work), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file);
  }
  async register(parent, result) {
    if (result?.status !== 'accepted' || !/^[a-f0-9-]{36}$/.test(result.runId || '') || !/^agent:opencode:acp:[a-f0-9-]{36}$/.test(result.childSessionKey || '')) return;
    const file = path.resolve(result.streamLogPath || '');
    if (!file.startsWith(path.resolve(this.streamRoot) + path.sep) || !file.endsWith('.acp-stream.jsonl')) return;
    if (this.work[result.runId]) return;
    for (const [key, old] of Object.entries(this.work)) if (old.done && this.now() - old.started > 86400000) delete this.work[key];
    const item = { parent, child: result.childSessionKey, file, run: result.runId, sequence: 0, started: this.now(), lastReport: this.now(), offset: 0, output: '', done: false };
    this.work[item.run] = item; this.save();
    await this.report(item, 'started', 'OpenCode task started. Progress and the final result or blocker will be reported here.');
  }
  async report(item, state, text) {
    const clean = redactSecrets(text).text.slice(-11500);
    await this.send({ session_key: item.parent, child_session_key: item.child, run_id: item.run,
      sequence: item.sequence, state, text: `[OpenCode ${item.run.slice(0, 8)}] ${clean}` });
    item.sequence++; item.lastReport = this.now();
    if (state === 'completed' || state === 'blocked') item.done = true;
    this.save();
  }
  async poll() {
    if (this.running) return; this.running = true;
    try {
      for (const item of Object.values(this.work)) {
        if (item.done) continue;
        try {
          if (!item.sequence) await this.report(item, 'started', 'OpenCode task started. Monitoring continues until a final result or blocker.');
          let text;
          try { if (fs.statSync(item.file).size > 32 * 1024 * 1024) throw new Error('stream exceeds monitor bound'); text = fs.readFileSync(item.file, 'utf8'); } catch { text = ''; }
          const end = text.lastIndexOf('\n') + 1;
          const previous = { offset: item.offset, output: item.output };
          const records = text.slice(item.offset, end).split('\n').filter(Boolean).map(line => JSON.parse(line));
          let terminal = null, note = '';
          for (const record of records) {
            if (record.runId !== item.run) continue;
            if (record.kind === 'assistant_delta') item.output = (item.output + (record.delta || '')).slice(-10000);
            if (record.kind === 'system_event' && record.text) note = record.text;
            if (record.kind === 'lifecycle' && record.phase === 'end') terminal = { state: 'completed', text: item.output.trim() || 'OpenCode completed without a text summary; inspect the retained session.' };
            if (record.kind === 'lifecycle' && record.phase === 'error') terminal = { state: 'blocked', text: record.data?.error || 'OpenCode execution failed.' };
            if (record.kind === 'system_event' && /:timeout$/.test(record.contextKey || '')) terminal = { state: 'blocked', text: record.text };
          }
          item.offset = end;
          if (!terminal && this.now() - item.started >= 6 * 3600000) terminal = { state: 'blocked', text: 'Six-hour monitoring deadline reached without completion. Session history is retained; no success is claimed.' };
          try {
            if (terminal) await this.report(item, terminal.state, terminal.text);
            else if (this.now() - item.lastReport >= 60000) await this.report(item, 'running', note || `Still working; elapsed ${Math.floor((this.now() - item.started) / 60000)} minutes. Waiting for OpenCode output.`);
            else this.save();
          } catch (error) { Object.assign(item, previous); throw error; }
        } catch { this.logger.warn('Coding update deferred: openclaw-pcp/work monitor — PCP or stream unavailable; retained for retry.'); }
      }
    } finally { this.running = false; }
  }
}

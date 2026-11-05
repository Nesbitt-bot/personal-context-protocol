/**
 * Bounded on-disk retry queue for PCP uploads.
 *
 * Items are already redacted when they are pushed, so no secret is ever
 * written here. The file is replaced atomically (temp + rename, mode 600).
 * Items are keyed by their PCP external key, so a duplicate push is a no-op
 * and PCP itself deduplicates a retried upload.
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MAX_ITEMS = 500;
export const DEFAULT_MAX_ATTEMPTS = 12;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60 * 60 * 1000;

export class DiskQueue {
  constructor({ file, maxItems = DEFAULT_MAX_ITEMS, maxAttempts = DEFAULT_MAX_ATTEMPTS, now = Date.now, logger } = {}) {
    this.file = file;
    this.maxItems = maxItems;
    this.maxAttempts = maxAttempts;
    this.now = now;
    this.logger = logger;
    this.items = [];
    this.load();
  }

  load() {
    if (!this.file) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.items = Array.isArray(parsed?.items) ? parsed.items.filter((item) => item && typeof item.key === "string") : [];
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.logger?.warn("PCP sync queue reset: openclaw-pcp/queue load — queue file unreadable; starting empty.");
        try { fs.renameSync(this.file, `${this.file}.corrupt-${this.now()}`); } catch { /* best effort */ }
      }
      this.items = [];
    }
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: this.items }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get size() {
    return this.items.length;
  }

  /** Add an item unless its key is already queued. Returns false for duplicates. */
  push(item) {
    if (this.items.some((existing) => existing.key === item.key)) return false;
    while (this.items.length >= this.maxItems) {
      const dropped = this.items.shift();
      this.logger?.warn(`PCP sync item dropped: openclaw-pcp/queue bound — ${this.maxItems} items queued; oldest (${dropped.kind}) discarded.`);
    }
    this.items.push({ ...item, attempts: 0, nextAt: this.now() });
    this.persist();
    return true;
  }

  due() {
    const now = this.now();
    return this.items.filter((item) => item.nextAt <= now);
  }

  ack(key) {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.key !== key);
    if (this.items.length !== before) this.persist();
  }

  /** Back off an item; drop it when permanent or out of attempts. */
  fail(key, { permanent = false, reason = "error" } = {}) {
    const item = this.items.find((entry) => entry.key === key);
    if (!item) return;
    item.attempts += 1;
    if (permanent || item.attempts >= this.maxAttempts) {
      this.items = this.items.filter((entry) => entry.key !== key);
      this.logger?.warn(`PCP sync item dropped: openclaw-pcp/queue retry — ${item.kind} ${permanent ? "rejected" : "out of attempts"} (${reason}).`);
    } else {
      item.nextAt = this.now() + Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (item.attempts - 1));
    }
    this.persist();
  }

  /** Delay every item (PCP unreachable): keep order, do not burn attempts twice. */
  deferAll(ms) {
    const at = this.now() + ms;
    for (const item of this.items) item.nextAt = Math.max(item.nextAt, at);
    this.persist();
  }
}

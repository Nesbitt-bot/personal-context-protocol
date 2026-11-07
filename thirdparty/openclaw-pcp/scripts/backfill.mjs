#!/usr/bin/env node
/** Replay an explicit private manifest; no channel messages or model runs. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createPlugin } from "../index.js";
import { transcriptTurns, replayTurns } from "../lib/backfill.js";

const [manifestFile, configFile, stateDir, action] = process.argv.slice(2);
if (!manifestFile || !configFile || !stateDir || ![undefined, "--apply"].includes(action)) {
  throw new Error("History sync not started: openclaw-pcp/backfill arguments — expected MANIFEST CONFIG PRIVATE_STATE_DIR [--apply].");
}
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const logFile = path.join(stateDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
const log = (level, message) => {
  const line = `${new Date().toISOString()} ${level} ${message}\n`;
  fs.appendFileSync(logFile, line, { mode: 0o600 });
  process.stderr.write(line);
};
log("INFO", `History sync started: openclaw-pcp/backfill — log ${logFile}`);
try {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const settings = config.plugins?.entries?.["openclaw-pcp"];
  if (!settings?.enabled) throw new Error("PCP plugin is not enabled in the supplied gateway configuration");
  const hooks = new Map();
  const plugin = createPlugin({ config,
    pluginConfig: { ...settings.config, stateDir, claimsEnabled: false },
    on: (name, fn) => hooks.set(name, fn), registerTool() {},
    logger: { info: message => log("INFO", message), warn: message => log("WARNING", message) },
  }, { startTimer: false });
  if (!plugin.enabled) throw new Error("installed PCP credential is unavailable");
  let total = 0;
  for (const [index, entry] of manifest.entries()) {
    const snapshot = fs.readFileSync(entry.file);
    if (entry.source_sha256 && crypto.createHash("sha256").update(snapshot).digest("hex") !== entry.source_sha256) {
      throw new Error("source snapshot checksum differs from the operator manifest");
    }
    const rows = snapshot.toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
    const turns = transcriptTurns(rows, entry.userMessageIds);
    total += turns.length;
    if (action === "--apply") {
      for (let i = 0; i < turns.length; i += 10) {
        await replayTurns(plugin, hooks.get("agent_end"), entry, turns.slice(i, i + 10));
        log("INFO", `History sync progressed: openclaw-pcp/backfill — source ${index + 1}/${manifest.length}, turns ${Math.min(i + 10, turns.length)}/${turns.length}`);
      }
    }
    log("INFO", `History source checked: openclaw-pcp/backfill — source ${index + 1}, ${turns.length} selected turns`);
  }
  log("INFO", `History sync complete: openclaw-pcp/backfill — ${total} turns, ${action === "--apply" ? "plugin replay" : "dry run"}`);
} catch (error) {
  log("ERROR", `History sync incomplete: openclaw-pcp/backfill — ${error.message}`);
  process.exitCode = 1;
}

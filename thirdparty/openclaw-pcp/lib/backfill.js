/** Operator-selected transcript replay through the normal plugin hooks. */
import { extractTurn, batches } from "./turns.js";

export function transcriptTurns(rows, selectedIds) {
  const selected = new Set(selectedIds);
  const turns = [];
  let current = null;
  for (const row of rows) {
    if (row.type !== "message" || !row.message) continue;
    if (row.message.role === "user") {
      if (current) turns.push(current);
      current = selected.has(row.id) ? { id: row.id, messages: [] } : null;
    }
    if (current) current.messages.push({
      ...row.message,
      timestamp: Number.isFinite(row.message.timestamp) ? row.message.timestamp : Date.parse(row.timestamp),
    });
  }
  if (current) turns.push(current);
  const found = new Set(turns.map(turn => turn.id));
  if (turns.some(turn => !Number.isFinite(turn.messages[0]?.timestamp))) {
    throw new Error("History not synchronized: openclaw-pcp/backfill identity — a selected turn has no stable timestamp.");
  }
  if ([...selected].some(id => !found.has(id))) {
    throw new Error("History not synchronized: openclaw-pcp/backfill selection — a selected user message is absent from the snapshot.");
  }
  return turns;
}

export async function replayTurns(plugin, agentEnd, entry, turns) {
  for (const turn of turns) {
    const expected = batches("count", extractTurn(turn.messages)?.messages || []).length;
    const before = plugin.stats.synced;
    agentEnd({ messages: turn.messages }, {
      sessionKey: entry.sessionKey, sessionId: entry.sessionId,
      channelId: entry.channel, trigger: "user",
    });
    await plugin.flush();
    if (plugin.queue.size || plugin.stats.synced - before !== expected || expected === 0) {
      throw new Error("History sync paused: openclaw-pcp/backfill flush — uploads remain queued; restore PCP connectivity and rerun the same manifest.");
    }
  }
}

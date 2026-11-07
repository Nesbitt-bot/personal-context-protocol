import { readFileSync } from 'fs';
import { z } from 'zod';

const agent = z.string().regex(/^astrbot-exec(?:-[a-z0-9_-]{1,40})?$/);
const tools = z.array(z.enum(['exec', 'process', 'read', 'write', 'edit', 'apply_patch', 'sessions_spawn'])).max(7);
const rule = z.object({ agent, tools }).strict();
export const executionPolicySchema = z.object({
  owner: rule.optional(),
  groups: z.array(rule.extend({
    platform: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    group_id: z.string().min(1).max(128),
    senders: z.union([z.literal('owner'), z.literal('all'), z.array(z.string().min(1).max(128)).min(1)]),
  }).strict()).max(100).default([]),
}).strict().superRefine((policy, ctx) => {
  const agents = policy.groups.map((g) => g.agent);
  const groups = policy.groups.map((g) => `${g.platform}:${g.group_id}`);
  if (new Set(agents).size !== agents.length || new Set(groups).size !== groups.length || (policy.owner && agents.includes(policy.owner.agent))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Execution policy rejected: broker/policy validation - each group needs a unique agent and group entry' });
  }
});
export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export type ExecutionSender = { platform: string; chat: 'private' | 'group'; sender_id: string; group_id?: string };

/** Private operator-owned file, reloaded for every authorization/revocation. */
export function loadExecutionPolicy(): ExecutionPolicy {
  const file = process.env.PCP_EXECUTION_POLICY_FILE;
  if (!file) return { groups: [] };
  try { return executionPolicySchema.parse(JSON.parse(readFileSync(file, 'utf8'))); }
  catch { throw new Error('Execution unavailable: broker/policy loading - configured policy file is unreadable or invalid'); }
}

export function executionRule(sender: ExecutionSender, isAdmin: boolean, policy = loadExecutionPolicy()) {
  if (sender.chat === 'private') return isAdmin ? policy.owner ?? null : null;
  return policy.groups.find((g) => g.platform === sender.platform && g.group_id === sender.group_id
    && (g.senders === 'all' || (g.senders === 'owner' ? isAdmin : g.senders.includes(sender.sender_id)))) ?? null;
}

import { z } from 'zod';
import { CANONICAL_KEY_PATTERN, DEVICE_KINDS, isAbsoluteDirectory, MAX_REMOTES, normalizeDirectory, normalizeRemote } from './project-identity';

/** Request bodies for the project, workspace and sync APIs (migration 013). */

const MIN_TIME = Date.parse('2000-01-01T00:00:00Z');

/** A plugin timestamp: ISO 8601 with an offset, not before 2000. */
export const pluginTime = z
  .string()
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) >= MIN_TIME, 'timestamp is before 2000');

export const deviceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, 'device_id must be 1-64 characters: letters, digits, . _ : -');

const remote = z.string().max(500).refine((v) => Boolean(normalizeRemote(v)), 'not a git remote URL (expected e.g. https://github.com/owner/repo or git@host:owner/repo.git)');

const directory = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'directory must not contain control characters')
  .refine((v) => isAbsoluteDirectory(normalizeDirectory(v)), 'directory must be absolute (e.g. /home/me/repo or D:/work/repo)');

const aliasKey = z.string().max(320).refine((v) => CANONICAL_KEY_PATTERN.test(v.trim().toLowerCase()), 'alias must look like name:<project> or git:<host/owner/repo>');

export const workspaceSchema = z.object({
  device_id: deviceId,
  device_label: z.string().min(1).max(100).optional(),
  device_kind: z.enum(DEVICE_KINDS),
  directory,
  default_branch: z.string().min(1).max(200).regex(/^[^\s~^:?*[\\]+$/, 'not a valid branch name').optional(),
  /** When the plugin last saw this checkout (defaults to now). */
  seen_at: pluginTime.optional(),
});

export const ensureProjectSchema = z.object({
  canonical_key: z.string().max(320).refine((v) => CANONICAL_KEY_PATTERN.test(v), 'canonical_key must look like git:<host/owner/repo> or name:<project>').optional(),
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  git_remotes: z.array(remote).max(MAX_REMOTES).optional(),
  aliases: z.array(aliasKey).max(50).optional(),
  workspace: workspaceSchema.optional(),
}).refine((v) => v.canonical_key || v.display_name || (v.git_remotes && v.git_remotes.length), 'give canonical_key, display_name or git_remotes');

export const updateProjectSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  add_git_remotes: z.array(remote).max(MAX_REMOTES).optional(),
  add_aliases: z.array(aliasKey).max(50).optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), 'At least one project field is required');

const fieldBases = z.record(z.enum(['project_id', 'context_title', 'context_summary', 'display_name', 'description']), pluginTime);

export const sessionContextSchema = z.object({
  project_id: z.string().min(1).max(100).nullable().optional(),
  context_title: z.string().max(300).nullable().optional(),
  context_summary: z.string().max(20000).nullable().optional(),
  /** The plugin's own modification time for these fields. */
  updated_at: pluginTime,
  device_id: deviceId,
  /** Per field: the clock value the writer last saw (enables fast-forward without a conflict). */
  base_updated_at: fieldBases.optional(),
}).refine((v) => v.project_id !== undefined || v.context_title !== undefined || v.context_summary !== undefined, 'give project_id, context_title or context_summary');

export const uiSessionContextSchema = z.object({
  project_id: z.string().min(1).max(100).nullable().optional(),
  context_title: z.string().max(300).nullable().optional(),
  context_summary: z.string().max(20000).nullable().optional(),
}).refine((v) => v.project_id !== undefined || v.context_title !== undefined || v.context_summary !== undefined, 'give project_id, context_title or context_summary');

export const mergeMessagesSchema = z.object({
  device_id: deviceId,
  messages: z.array(z.object({
    external_id: z.string().min(1).max(200).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'external_id must not contain control characters'),
    role: z.enum(['user', 'assistant', 'system', 'tool', 'correction']),
    content: z.string().min(1).max(100_000),
    provider: z.string().max(100).optional(),
    base_model: z.string().max(100).optional(),
    provider_timestamp: pluginTime.optional(),
  })).min(1).max(50),
});

export const completeMergeSchema = z.object({ value: z.string().max(20000) });

export const conflictStatusSchema = z.object({ status: z.enum(['resolved', 'dismissed']) });

export interface ProjectSummary {
  id: string;
  canonical_key: string;
  display_name: string;
  description: string | null;
  git_remotes: string[];
  session_count: number;
  workspace_count: number;
  device_kinds: string[];
  last_activity_at: string | null;
  updated_at: string;
}

export interface Workspace {
  id: string;
  device_id: string;
  device_label: string | null;
  device_kind: string;
  directory: string;
  default_branch: string | null;
  last_seen_at: string | null;
}

export interface ProjectSession {
  id: string;
  title: string;
  external_key: string | null;
  context_title: string | null;
  context_summary: string | null;
  archived: boolean;
  last_message_at: string | null;
  message_count: number;
}

export interface Conflict {
  id: string;
  entity_type: 'session' | 'project';
  entity_id: string;
  field: string;
  reason: string;
  kept: { value: unknown; at: string | null; device: string | null };
  lost: { value: unknown; at: string | null; device: string | null };
  created_at: string;
}

export interface ProjectDetail {
  project: ProjectSummary & { aliases: string[] };
  workspaces: Workspace[];
  sessions: ProjectSession[];
  conflicts: Conflict[];
}

export const KIND_LABEL: Record<string, string> = {
  windows: 'Windows',
  linux: 'Linux host',
  'linux-remote': 'Remote Linux',
  macos: 'macOS',
  'openclaw-container': 'OpenClaw container',
};

export function formatWhen(value: string | null | undefined) {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

export interface Topic {
  id: string;
  title: string;
  description: string | null;
  archived: boolean;
  createdAt?: string;
  session_count: number;
}

export interface Session {
  id: string;
  topic_id: string | null;
  task_id: string | null;
  project_id: string | null;
  device_id: string | null;
  agent_name: string | null;
  title: string;
  public?: boolean;
  mode?: 'wild' | 'exact' | 'locked';
  archived: boolean;
  created_at: string;
  updated_at?: string;
  last_message_at: string | null;
}

export interface Message {
  id: string;
  ordinal: number;
  role: string;
  content: string;
  provider: string | null;
  BaseModel?: string | null;
  base_model?: string | null;
  observedAt?: string;
  observed_at?: string;
}

export interface EventLog {
  id: string;
  action: string;
  actor: string;
  createdAt?: string;
  created_at?: string;
  detailsJson?: Record<string, unknown>;
}
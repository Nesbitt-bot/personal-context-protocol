import { pgTable, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// App instance (single row)
export const appInstance = pgTable('app_instance', {
  id: text('id').primaryKey().$default(() => 'instance_1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  initializedAt: timestamp('initialized_at', { withTimezone: true }),
  version: text('version').notNull().default('0.1.0'),
});

// UI admin token
export const uiAuth = pgTable('ui_auth', {
  id: text('id').primaryKey().$default(() => 'ui_1'),
  tokenHash: text('token_hash').notNull(),
  salt: text('salt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

// Topics
export const topics = pgTable('topics', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Sessions
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  topicId: text('topic_id')
    .notNull()
    .references(() => topics.id),
  title: text('title').notNull(),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
});

// Session tokens
export const sessionTokens = pgTable('session_tokens', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  tokenHash: text('token_hash').notNull(),
  salt: text('salt').notNull(),
  name: text('name').notNull(),
  canRenameSession: boolean('can_rename_session').notNull().default(false),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  tokenPrefix: text('token_prefix'), // First 16 chars for quick lookup
});

// Index for token prefix lookup
export const sessionTokensPrefixIndex = index('session_tokens_prefix_idx').on(sessionTokens.tokenPrefix);

// Messages
export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id),
  topicId: text('topic_id')
    .notNull()
    .references(() => topics.id),
  ordinal: integer('ordinal').notNull(),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool', 'correction'] }).notNull(),
  content: text('content').notNull(),
  contentType: text('content_type', { enum: ['text', 'markdown', 'json'] }).notNull().default('markdown'),
  provider: text('provider'),
  BaseModel: text('base_model'),
  providerTimestamp: timestamp('provider_timestamp', { withTimezone: true }),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  sourceJson: jsonb('source_json'),
  metadataJson: jsonb('metadata_json').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Events
export const events = pgTable('events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id),
  topicId: text('topic_id').references(() => topics.id),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  detailsJson: jsonb('details_json').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Schema migrations
export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  checksum: text('checksum'),
});

// Indexes
import { index } from 'drizzle-orm/pg-core';

export const messagesSessionIndex = index('messages_session_id_idx').on(messages.sessionId);
export const messagesTopicIndex = index('messages_topic_id_idx').on(messages.topicId);
export const sessionsTopicIndex = index('sessions_topic_id_idx').on(sessions.topicId);
export const sessionTokensHashIndex = index('session_tokens_hash_idx').on(sessionTokens.tokenHash);
export const sessionTokensSessionIndex = index('session_tokens_session_id_idx').on(sessionTokens.sessionId);
export const eventsSessionIndex = index('events_session_id_idx').on(events.sessionId);
export const eventsCreatedAtIndex = index('events_created_at_idx').on(events.createdAt);

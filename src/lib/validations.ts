import { z } from 'zod';

// Message schemas
export const messageInputSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool', 'correction']),
  content: z.string().min(1).max(10000),
  provider: z.string().max(100).optional(),
  base_model: z.string().max(100).optional(),
  provider_timestamp: z.string().datetime().optional(),
});

export const appendMessagesSchema = z.object({
  messages: z.array(messageInputSchema).min(1).max(100),
  suggested_session_title: z.string().max(200).optional(),
});

// Topic schemas
export const createTopicSchema = z.object({
  title: z.string().min(1).max(100).regex(/^[a-zA-Z0-9-]+$/, 'Title must be alphanumeric with hyphens'),
  description: z.string().max(500).optional(),
});

export const renameTopicSchema = z.object({
  title: z.string().min(1).max(100).regex(/^[a-zA-Z0-9-]+$/, 'Title must be alphanumeric with hyphens'),
});

// Session schemas
export const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
});

export const renameSessionSchema = z.object({
  title: z.string().min(1).max(200),
});

// Token schemas
export const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  can_rename_session: z.boolean().optional().default(false),
});

// Setup schemas
export const unlockSchema = z.object({
  ui_token: z.string().min(1),
});

// Error response schema
export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.record(z.unknown()).optional(),
});

// Success response schema
export const successResponseSchema = z.object({
  success: z.literal(true),
});

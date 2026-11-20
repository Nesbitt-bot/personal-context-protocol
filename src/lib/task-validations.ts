import { z } from 'zod';

// Priority is an optional small integer 0-3 (p0 highest urgency); null = unset.
const priority = z.number().int().min(0).max(3).nullable();

// Expected turns is the single progress input a human edits; null clears it.
const expectedTurns = z.number().int().min(0).max(100000).nullable();

// Optional ISO-8601 deadline, or null to clear.
const dueAt = z.string().datetime().nullable();

export const createTaskSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  // Category (folder/topic). Omit both topic_id and parent_id for an
  // unassigned task; a subtask (parent_id) inherits its parent's category.
  topic_id: z.string().min(1).nullable().optional(),
  parent_id: z.string().min(1).nullable().optional(),
  priority: priority.optional(),
  expected_turns: expectedTurns.optional(),
  due_at: dueAt.optional(),
  // Repo-tag projects. `primary_project_id` must be inside `project_ids`.
  project_ids: z.array(z.string().min(1)).max(50).optional(),
  primary_project_id: z.string().min(1).nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    topic_id: z.string().min(1).nullable().optional(),
    parent_id: z.string().min(1).nullable().optional(),
    completed: z.boolean().optional(),
    priority: priority.optional(),
    expected_turns: expectedTurns.optional(),
    due_at: dueAt.optional(),
    position: z.number().optional(),
  })
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    'At least one task field is required',
  );

export const setTaskProjectsSchema = z.object({
  project_ids: z.array(z.string().min(1)).max(50),
  primary_project_id: z.string().min(1).nullable().optional(),
});

export const addTaskResourceSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().min(1).max(2000),
  kind: z.enum(['doc', 'remote', 'local']).optional(),
  source: z.enum(['agent', 'human']).optional(),
});

export const boardNameSchema = z.object({
  name: z.string().min(1).max(100),
});

export const linkTaskSessionSchema = z.object({
  session_id: z.string().min(1),
});

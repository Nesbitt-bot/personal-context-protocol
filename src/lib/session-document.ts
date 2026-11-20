import { z } from 'zod';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Portable content of an OpenSearch session _source; derived index fields are stripped. */
export const sessionDocumentSchema = z.object({
  sid: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  summary: z.string().max(2_000_000),
  messages: z.array(z.object({
    ordinal: z.number().int().positive().max(2_147_483_647),
    role: z.enum(['user', 'assistant', 'system', 'tool', 'correction']),
    content: z.string().max(100_000),
  })).max(10_000),
}).superRefine((document, context) => {
  const ordinals = new Set(document.messages.map(message => message.ordinal));
  if (ordinals.size !== document.messages.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['messages'], message: 'message ordinals must be unique' });
  }
});

export type SessionDocument = z.infer<typeof sessionDocumentSchema>;

export function parseSessionDocument(input: unknown) {
  // Also accept an OpenSearch GET/search hit copied with its _source envelope.
  const source = input && typeof input === 'object' && '_source' in input ? input._source : input;
  return sessionDocumentSchema.safeParse(source);
}

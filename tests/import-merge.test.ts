import { describe, it, expect } from 'vitest';
import { dedupeNewMessages, messageKey } from '../src/lib/import-merge';
import { parseIngestPayload } from '../src/lib/ingest';

describe('import dedup', () => {
  it('keys by role and trimmed content', () => {
    expect(messageKey('user', '  hi  ')).toBe(messageKey('user', 'hi'));
    expect(messageKey('user', 'hi')).not.toBe(messageKey('assistant', 'hi'));
  });

  it('keeps only messages not already recorded, preserving order', () => {
    const existing = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ];
    const incoming = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'q2' },
      { role: 'assistant' as const, content: 'a2' },
    ];
    const { fresh, skipped } = dedupeNewMessages(incoming, existing);
    expect(skipped).toBe(2);
    expect(fresh.map((m) => m.content)).toEqual(['q2', 'a2']);
  });

  it('collapses duplicates within the same paste', () => {
    const incoming = [
      { role: 'user' as const, content: 'same' },
      { role: 'user' as const, content: 'same' },
    ];
    const { fresh, skipped } = dedupeNewMessages(incoming, []);
    expect(fresh).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('re-pasting an already-recorded conversation imports nothing new', () => {
    const conversation = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    const { fresh, skipped } = dedupeNewMessages(
      conversation.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      conversation,
    );
    expect(fresh).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it('parses an agent wrapper object (extra fields + messages array)', () => {
    const agentBlock = JSON.stringify({
      protocol: 'personal-context-protocol',
      upload_status: 'not_uploaded_by_assistant',
      session_id: 'ses_x',
      messages: [
        { role: 'user', content: 'odometer question' },
        { role: 'assistant', content: 'enter the current reading' },
      ],
    });
    const result = parseIngestPayload(agentBlock, { maxMessages: 500 });
    expect(result.kind).toBe('messages');
    if (result.kind === 'messages') {
      expect(result.messages.map((m) => m.content)).toEqual(['odometer question', 'enter the current reading']);
    }
  });
});

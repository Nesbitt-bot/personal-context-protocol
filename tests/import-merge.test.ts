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

  it('parses a compact-only PCP_COMPACT block', () => {
    const result = parseIngestPayload('<PCP_COMPACT>{"summary":"did stuff","decisions":["a"]}</PCP_COMPACT>');
    expect(result.kind).toBe('compact');
    if (result.kind === 'compact') expect(result.compact.summary).toBe('did stuff');
  });

  it('parses a PCP_INGEST block with messages AND a compaction (mixed)', () => {
    const block = `<PCP_INGEST>${JSON.stringify({
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }],
      compaction: { summary: 'session summary', open_questions: ['next?'] },
    })}</PCP_INGEST>`;
    const result = parseIngestPayload(block);
    expect(result.kind).toBe('mixed');
    if (result.kind === 'mixed') {
      expect(result.messages).toHaveLength(2);
      expect(result.compact.summary).toBe('session summary');
    }
  });

  it('treats a JSON object with messages and a nested compaction as mixed', () => {
    const result = parseIngestPayload(JSON.stringify({
      messages: [{ role: 'user', content: 'hi' }],
      compaction: { summary: 's' },
    }));
    expect(result.kind).toBe('mixed');
  });

  it('does not misread a plain { messages } with a stray summary as mixed', () => {
    const result = parseIngestPayload(JSON.stringify({
      messages: [{ role: 'user', content: 'hi' }],
      summary: 'not a compaction',
    }));
    expect(result.kind).toBe('messages');
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

describe('backward-compatible extraction', () => {
  it('finds JSON buried after prose (agent pasted entire response)', () => {
    const text = 'Here is the fallback block you can paste:\n\n{"messages":[{"role":"user","content":"q"},{"role":"assistant","content":"a"}]}\n\nCopy this into the Import panel.';
    const result = parseIngestPayload(text, { maxMessages: 500 });
    expect(result.kind).toBe('messages');
    if (result.kind === 'messages') expect(result.messages).toHaveLength(2);
  });

  it('finds a compact block buried in prose', () => {
    const text = 'I could not upload. Here is the fallback:\n\n<PCP_COMPACT>{"summary":"done","decisions":["a","b"]}</PCP_COMPACT>';
    const result = parseIngestPayload(text);
    expect(result.kind).toBe('compact');
  });

  it('handles unclosed PCP_INGEST tag', () => {
    const text = '<PCP_INGEST>{"messages":[{"role":"user","content":"x"}],"compaction":{"summary":"s"}}';
    const result = parseIngestPayload(text);
    expect(result.kind).toBe('mixed');
  });

  it('handles trailing commas in JSON (lenient parsing)', () => {
    const text = '{"messages":[{"role":"user","content":"hi"},]}';
    const result = parseIngestPayload(text, { maxMessages: 500 });
    expect(result.kind).toBe('messages');
  });
});

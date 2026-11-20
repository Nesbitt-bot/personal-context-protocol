import { describe, expect, it } from 'vitest';
import { parseSessionDocument } from '../src/lib/session-document';

const source = { sid: 'ses_source', title: 'Example', summary: 'Summary', messages: [
  { ordinal: 2, role: 'user', content: 'repeat' },
  { ordinal: 4, role: 'user', content: 'repeat' },
] };

describe('portable OpenSearch session documents', () => {
  it('accepts source documents and hits while dropping derived index fields', () => {
    const indexed = { ...source, fingerprint: 'derived', ready: true, passages: [{ vector: [1, 2] }] };
    expect(parseSessionDocument(indexed)).toMatchObject({ success: true, data: source });
    expect(parseSessionDocument({ _index: 'sessions', _id: source.sid, _source: indexed })).toMatchObject({ success: true, data: source });
  });
  it('preserves repeated turns, whitespace, empty messages and empty sessions', () => {
    expect(parseSessionDocument(source).success).toBe(true);
    expect(parseSessionDocument({ ...source, messages: [] }).success).toBe(true);
    const input = { ...source, messages: [{ ordinal: 1, role: 'tool', content: '  \n' }] };
    expect(parseSessionDocument(input)).toMatchObject({ success: true, data: input });
  });
  it('rejects duplicate ordinals and malformed documents before any write', () => {
    for (const input of [null, {}, { messages: [] }, { ...source, messages: [{ ordinal: 0, role: 'user', content: 'x' }] },
      { ...source, messages: [source.messages[0], source.messages[0]] },
      { ...source, messages: [{ ordinal: 1, role: 'bogus', content: 'x' }] },
      { ...source, messages: [{ ordinal: 1, role: 'user', content: 'x'.repeat(100_001) }] }]) {
      expect(parseSessionDocument(input).success).toBe(false);
    }
  });
});

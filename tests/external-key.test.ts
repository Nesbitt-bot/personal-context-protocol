import { describe, it, expect } from 'vitest';
import { normalizeExternalKey, MAX_EXTERNAL_KEY_CHARS } from '../src/lib/external-key';

describe('external session keys', () => {
  it('returns null when the field is absent', () => {
    expect(normalizeExternalKey(undefined)).toBeNull();
    expect(normalizeExternalKey(null)).toBeNull();
  });

  it('accepts a device:kind:id key and trims surrounding space', () => {
    expect(normalizeExternalKey('  win-384de1b4:codex:0199abcd  ')).toBe('win-384de1b4:codex:0199abcd');
  });

  it('is stable, so a retry normalizes to the same identity', () => {
    const first = normalizeExternalKey('win-384de1b4:claude:abc');
    const retry = normalizeExternalKey('win-384de1b4:claude:abc\n');
    expect(retry).toBe(first);
  });

  it('distinguishes the same transcript id on different devices', () => {
    expect(normalizeExternalKey('win-a:codex:1')).not.toBe(normalizeExternalKey('win-b:codex:1'));
  });

  it('rejects an empty or whitespace-only key', () => {
    expect(() => normalizeExternalKey('')).toThrow(/must not be empty/);
    expect(() => normalizeExternalKey('   ')).toThrow(/must not be empty/);
  });

  it('rejects a non-string key', () => {
    expect(() => normalizeExternalKey(42)).toThrow(/must be a string/);
    expect(() => normalizeExternalKey({ key: 'x' })).toThrow(/must be a string/);
  });

  it('rejects an over-long key', () => {
    expect(() => normalizeExternalKey('x'.repeat(MAX_EXTERNAL_KEY_CHARS + 1))).toThrow(/at most/);
    expect(normalizeExternalKey('x'.repeat(MAX_EXTERNAL_KEY_CHARS))).toHaveLength(MAX_EXTERNAL_KEY_CHARS);
  });

  it('rejects control characters so keys stay safe to log and echo', () => {
    expect(() => normalizeExternalKey('win-a:codex:\u0000')).toThrow(/control characters/);
  });
});

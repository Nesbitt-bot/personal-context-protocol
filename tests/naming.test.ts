import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SESSION_TITLE,
  DEFAULT_TOPIC_TITLE,
  generateUniqueSlug,
  generateUniqueTitle,
  normalizeTitle,
  slugify,
} from '../src/lib/naming';

describe('naming', () => {
  describe('normalizeTitle', () => {
    it('trims and collapses whitespace, preserving hyphens', () => {
      expect(normalizeTitle('  Route   B-Build  ')).toBe('Route B-Build');
    });

    it('returns empty string for empty input', () => {
      expect(normalizeTitle('')).toBe('');
      expect(normalizeTitle(null)).toBe('');
      expect(normalizeTitle(undefined)).toBe('');
    });
  });

  describe('one-click default names', () => {
    it('uses the default when no base is given', () => {
      expect(generateUniqueTitle('', [], DEFAULT_TOPIC_TITLE)).toBe('New Topic');
      expect(generateUniqueTitle(undefined, [], DEFAULT_SESSION_TITLE)).toBe('New Session');
    });

    it('auto-suffixes successive defaults', () => {
      const existing = ['New Topic'];
      expect(generateUniqueTitle('', existing, DEFAULT_TOPIC_TITLE)).toBe('New Topic 2');
      existing.push('New Topic 2');
      expect(generateUniqueTitle('', existing, DEFAULT_TOPIC_TITLE)).toBe('New Topic 3');
    });
  });

  describe('duplicate title suffixing', () => {
    it('keeps a unique title unchanged', () => {
      expect(generateUniqueTitle('Research', ['Other'])).toBe('Research');
    });

    it('suffixes a duplicate (case-insensitive)', () => {
      expect(generateUniqueTitle('Research', ['research'])).toBe('Research 2');
    });

    it('normalizes an AI-suggested duplicate session title', () => {
      expect(
        generateUniqueTitle('  Route B Build Prompt ', ['Route B Build Prompt']),
      ).toBe('Route B Build Prompt 2');
    });
  });

  describe('slugify and unique slugs', () => {
    it('slugifies a title', () => {
      expect(slugify('Route B Build!')).toBe('route-b-build');
    });

    it('suffixes duplicate slugs', () => {
      expect(generateUniqueSlug('Research', ['research'])).toBe('research-2');
    });
  });
});

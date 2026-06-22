import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateToken, generateSalt, hashToken, verifyToken, createId } from '../src/lib/auth';

describe('auth', () => {
  describe('generateToken', () => {
    it('should generate a 64-character hex string', () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]+$/);
    });

    it('should generate unique tokens', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashToken and verifyToken', () => {
    it('should hash and verify correctly', async () => {
      const token = generateToken();
      const salt = generateSalt();
      const hash = await hashToken(token, salt);
      
      expect(hash).toBeDefined();
      expect(await verifyToken(token, hash, salt)).toBe(true);
    });

    it('should reject incorrect tokens', async () => {
      const token = generateToken();
      const salt = generateSalt();
      const hash = await hashToken(token, salt);
      
      const wrongToken = generateToken();
      expect(await verifyToken(wrongToken, hash, salt)).toBe(false);
    });

    it('should reject wrong salt', async () => {
      const token = generateToken();
      const salt = generateSalt();
      const wrongSalt = generateSalt();
      const hash = await hashToken(token, salt);
      
      expect(await verifyToken(token, hash, wrongSalt)).toBe(false);
    });
  });

  describe('createId', () => {
    it('should create ID with prefix', () => {
      const id = createId('test');
      expect(id).toMatch(/^test_\d{13}_[a-f0-9]{8}$/);
    });

    it('should create unique IDs', () => {
      const id1 = createId('test');
      const id2 = createId('test');
      expect(id1).not.toBe(id2);
    });
  });
});

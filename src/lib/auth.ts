import crypto from 'crypto';
import * as argon2 from '@node-rs/argon2';

export const INSTANCE_SECRET = process.env.PCP_INSTANCE_SECRET || '';

/**
 * Generate a random 32-byte hex token
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a random salt
 */
export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hash a token with salt using Argon2
 */
export async function hashToken(token: string, salt: string): Promise<string> {
  const hash = await argon2.hash(token + salt, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
  return hash;
}

/**
 * Verify a token against stored hash and salt
 */
export async function verifyToken(token: string, hash: string, salt: string): Promise<boolean> {
  try {
    const result = await argon2.verify(hash, token + salt);
    return result;
  } catch {
    return false;
  }
}

/**
 * Create ID with prefix and timestamp
 */
export function createId(prefix: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex').slice(0, 8);
  return `${prefix}_${timestamp}_${random}`;
}

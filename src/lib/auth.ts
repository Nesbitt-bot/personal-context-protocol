import crypto from 'crypto';
import { promisify } from 'util';

export const INSTANCE_SECRET = process.env.PCP_INSTANCE_SECRET || '';
const scryptAsync = promisify(crypto.scrypt);

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
 * Hash a token with salt using Node's built-in scrypt.
 */
export async function hashToken(token: string, salt: string): Promise<string> {
  const hash = await scryptAsync(token, salt, 32) as Buffer;
  return `scrypt:${hash.toString('hex')}`;
}

/**
 * Verify a token against stored hash and salt
 */
export async function verifyToken(token: string, hash: string, salt: string): Promise<boolean> {
  try {
    const expected = await hashToken(token, salt);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
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

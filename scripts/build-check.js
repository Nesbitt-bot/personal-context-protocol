import { execSync } from 'child_process';
import crypto from 'crypto';

/**
 * Build-time pre-check for Personal Context Protocol
 * 
 * This script runs before Next.js build and:
 * 1. Validates required environment variables
 * 2. Generates UI token if not provided (for new deployments)
 * 3. Logs token for user to capture (ONE TIME ONLY)
 */

console.log('\n' + '='.repeat(70));
console.log('  PERSONAL CONTEXT PROTOCOL - BUILD PRE-CHECK');
console.log('='.repeat(70) + '\n');

// Check required environment variables
const requiredEnvVars = ['DATABASE_URL', 'PCP_INSTANCE_SECRET', 'PCP_APP_URL'];
const missing = requiredEnvVars.filter(env => !process.env[env]);

if (missing.length > 0) {
  console.error('❌ MISSING REQUIRED ENVIRONMENT VARIABLES:');
  missing.forEach(env => console.error(`   - ${env}`));
  console.error('\n⚠️  Build will continue but app will fail at runtime.');
  console.error('   Add these variables in Vercel project settings.\n');
} else {
  console.log('✅ All required environment variables present');
}

// Check if this is a fresh deployment (no database initialized yet)
// We'll generate a token if PCP_INSTANCE_SECRET is missing or empty
if (!process.env.PCP_INSTANCE_SECRET || process.env.PCP_INSTANCE_SECRET.length < 32) {
  console.log('\n⚠️  WARNING: PCP_INSTANCE_SECRET not set or too short');
  console.log('   App will work but authentication will be insecure.\n');
  console.log('   Generate a secure secret with:');
  console.log('   $ openssl rand -hex 32\n');
}

// Generate and display UI token for NEW deployments only
// This is a ONE-TIME display - store it safely!
const uiTokenPath = '.next/UI_TOKEN.txt';
const fs = require('fs');

if (!fs.existsSync(uiTokenPath)) {
  const uiToken = crypto.randomBytes(32).toString('hex');
  
  console.log('='.repeat(70));
  console.log('  ⚠️  CRITICAL: ONE-TIME UI TOKEN GENERATED ⚠️');
  console.log('='.repeat(70));
  console.log('\nThis token will ONLY be shown now. Save it securely!\n');
  console.log(`  UI_TOKEN: ${uiToken}`);
  console.log('\nStore this in a password manager or secure location.');
  console.log('Without it, you cannot access the admin UI after initialization.');
  console.log('\n' + '='.repeat(70) + '\n');
  
  // Save token to file for runtime access
  fs.writeFileSync(uiTokenPath, uiToken);
  console.log(`Token saved to: ${uiTokenPath}\n`);
} else {
  // Read existing token
  const uiToken = fs.readFileSync(uiTokenPath, 'utf8');
  const partialToken = uiToken.substring(0, 16) + '...' + uiToken.substring(uiToken.length - 8);
  
  console.log('ℹ️  UI Token already initialized (not re-displayed for security)');
  console.log(`   Partial: ${partialToken}`);
  console.log('   To view full token, check: .next/UI_TOKEN.txt\n');
}

// Run database migration check if DATABASE_URL is set
if (process.env.DATABASE_URL) {
  console.log('ℹ️  Database connection string detected');
  console.log('   Migration will run on first /api/v1/setup/init request\n');
}

console.log('='.repeat(70));
console.log('  Build proceeding...');
console.log('='.repeat(70) + '\n\n');

import fs from 'fs';
import path from 'path';

/**
 * Runtime pre-check for Personal Context Protocol
 * 
 * This script runs before the Next.js server starts and:
 * 1. Validates required environment variables
 * 2. Displays UI token if available (for recovery/debugging)
 * 3. Logs current service state
 */

console.log('\n' + '='.repeat(70));
console.log('  PERSONAL CONTEXT PROTOCOL - RUNTIME STARTUP');
console.log('='.repeat(70) + '\n');

// Check required environment variables
const requiredEnvVars = ['DATABASE_URL', 'PCP_INSTANCE_SECRET', 'PCP_APP_URL'];
const missing = requiredEnvVars.filter(env => !process.env[env]);

if (missing.length > 0) {
  console.error('❌ MISSING REQUIRED ENVIRONMENT VARIABLES:');
  missing.forEach(env => console.error(`   - ${env}`));
  console.error('\n⚠️  App will fail at runtime.\n');
} else {
  console.log('✅ All required environment variables present');
}

// Display UI token from build-time generation
const uiTokenPath = path.join(process.cwd(), '.next', 'UI_TOKEN.txt');

if (fs.existsSync(uiTokenPath)) {
  const uiToken = fs.readFileSync(uiTokenPath, 'utf8');
  
  console.log('\n' + '='.repeat(70));
  console.log('  📋 UI TOKEN (from .next/UI_TOKEN.txt)');
  console.log('='.repeat(70));
  console.log('\n');
  console.log(`  ${uiToken}`);
  console.log('\n');
  console.log('   This token is shown on EVERY service restart.');
  console.log('   Store it securely for future reference.\n');
  console.log('='.repeat(70) + '\n');
} else {
  console.log('ℹ️  No UI token found (may need to run setup/init)');
}

// Display service information
console.log('\n' + '='.repeat(70));
console.log('  SERVICE INFORMATION');
console.log('='.repeat(70));
console.log('\n');
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`   Vercel URL:  ${process.env.VERCEL_URL || 'localhost:3000'}`);
console.log(`   Vercel Env:  ${process.env.VERCEL_ENV || 'production'}`);
console.log(`   Instance:    ${process.env.VERCEL_DEPLOYMENT_ID || 'unknown'}`);
console.log('\n');
console.log('='.repeat(70) + '\n');

console.log('ℹ️  Starting Next.js server...\n');

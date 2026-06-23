const crypto = require('crypto');
const { readProjectVersion } = require('./project-version');

const PROJECT = 'personal-context-protocol';
const VERSION = readProjectVersion();
const requiredEnvVars = ['DATABASE_URL', 'PCP_INSTANCE_SECRET', 'PCP_APP_URL'];

function printHeader(title) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${PROJECT} v${VERSION} - ${title}`);
  console.log(`${'='.repeat(70)}\n`);
}

function summarizeSecret(value) {
  if (!value) return 'missing';
  return `set sha256:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

/**
 * Runtime diagnostics for Vercel service starts. It reports configuration and
 * deployment identity while keeping admin tokens and database credentials out
 * of logs.
 */
printHeader('runtime startup');

const missing = requiredEnvVars.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.log('Unable to validate runtime configuration: deployment configuration / required environment variables - missing keys:');
  missing.forEach((name) => console.log(`   - ${name}`));
} else {
  console.log('Runtime configuration / required environment variables - all required keys are present.');
}

console.log(`DATABASE_URL: ${summarizeSecret(process.env.DATABASE_URL)}`);
console.log(`PCP_INSTANCE_SECRET: ${summarizeSecret(process.env.PCP_INSTANCE_SECRET)}`);
console.log(`PCP_APP_URL: ${process.env.PCP_APP_URL ? 'set' : 'missing'}`);
console.log(`PCP_ADMIN_TOKEN: ${process.env.PCP_ADMIN_TOKEN ? 'configured' : 'not configured'}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Vercel URL: ${process.env.VERCEL_URL || 'localhost:3000'}`);
console.log(`Vercel Env: ${process.env.VERCEL_ENV || 'unknown'}`);
console.log(`Instance: ${process.env.VERCEL_DEPLOYMENT_ID || 'unknown'}`);
if (process.env.PCP_ADMIN_TOKEN) {
  console.log('\nAdmin UI token policy: user-supplied PCP_ADMIN_TOKEN is never printed on service restart.');
} else {
  console.log('\nAdmin UI token policy: PCP_ADMIN_TOKEN is not configured. First-run setup will generate a temporary admin token, show it in the browser, and print it once in deployment function logs. Change it immediately in Settings after first login.');
}
console.log(`\n${'='.repeat(70)}\n`);




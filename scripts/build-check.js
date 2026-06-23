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
 * Build-time diagnostics for Vercel. This validates deployment configuration
 * without printing generated admin tokens or any other secret material.
 */
printHeader('build pre-check');

const missing = requiredEnvVars.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.log('Unable to validate build configuration: deployment configuration / required environment variables - missing keys:');
  missing.forEach((name) => console.log(`   - ${name}`));
  console.log('Build will continue, but setup cannot complete until these variables are configured.');
} else {
  console.log('Build configuration / required environment variables - all required keys are present.');
}

const secret = process.env.PCP_INSTANCE_SECRET || '';
if (secret && secret.length < 32) {
  console.log('Unable to validate instance secret strength: deployment configuration / PCP_INSTANCE_SECRET - value is shorter than 32 characters.');
}

console.log(`DATABASE_URL: ${summarizeSecret(process.env.DATABASE_URL)}`);
console.log(`PCP_INSTANCE_SECRET: ${summarizeSecret(process.env.PCP_INSTANCE_SECRET)}`);
console.log(`PCP_APP_URL: ${process.env.PCP_APP_URL ? 'set' : 'missing'}`);
console.log(`PCP_ADMIN_TOKEN: ${process.env.PCP_ADMIN_TOKEN ? 'configured' : 'not configured'}`);
if (process.env.PCP_ADMIN_TOKEN) {
  console.log('\nAdmin UI token policy: user-supplied PCP_ADMIN_TOKEN is never printed in logs.');
} else {
  console.log('\nAdmin UI token policy: PCP_ADMIN_TOKEN is not configured. First-run setup will generate a temporary admin token, show it in the browser, and print it once in deployment function logs. Change it immediately in Settings after first login.');
}
console.log('Database schema policy: setup/status and setup/init create the schema automatically when DATABASE_URL is configured.');
console.log(`\n${'='.repeat(70)}\n`);




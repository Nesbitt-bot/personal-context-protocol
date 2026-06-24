const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readProjectVersion } = require('./project-version');

const root = process.cwd();
const envPath = path.join(root, '.env');

function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function parseEnv(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (match) {
      values.set(match[1], match[2]);
    }
  }
  return values;
}

function serializeEnv(values) {
  const order = [
    'PCP_VERSION',
    'PCP_PORT',
    'PCP_APP_URL',
    'PCP_INSTANCE_SECRET',
    'POSTGRES_PASSWORD',
    'DATABASE_URL',
    'PCP_ADMIN_TOKEN',
  ];

  const known = order.map((key) => `${key}=${values.get(key) || ''}`);
  const extras = [...values.keys()]
    .filter((key) => !order.includes(key))
    .sort()
    .map((key) => `${key}=${values.get(key) || ''}`);

  return `${[...known, ...extras].join('\n')}\n`;
}

function main() {
  const existed = fs.existsSync(envPath);
  const values = existed ? parseEnv(fs.readFileSync(envPath, 'utf8')) : new Map();
  const changed = [];

  function ensure(key, valueFactory) {
    if (!values.get(key)) {
      values.set(key, valueFactory());
      changed.push(key);
    }
  }

  ensure('PCP_VERSION', () => readProjectVersion(root));
  ensure('PCP_PORT', () => '3000');
  ensure('PCP_APP_URL', () => `http://localhost:${values.get('PCP_PORT') || '3000'}`);
  ensure('PCP_INSTANCE_SECRET', () => randomHex(32));
  ensure('POSTGRES_PASSWORD', () => randomHex(24));
  ensure('DATABASE_URL', () => `postgresql://pcp:${values.get('POSTGRES_PASSWORD')}@db:5432/pcp?sslmode=disable`);
  if (!values.has('PCP_ADMIN_TOKEN')) {
    values.set('PCP_ADMIN_TOKEN', '');
    changed.push('PCP_ADMIN_TOKEN');
  }

  fs.writeFileSync(envPath, serializeEnv(values), { mode: 0o600 });

  const action = existed ? 'updated' : 'created';
  console.log(`Docker environment ${action}: .env`);
  if (changed.length > 0) {
    console.log(`Docker environment keys filled: ${changed.join(', ')}`);
  } else {
    console.log('Docker environment keys filled: none');
  }
  console.log('Secret values were written to .env and were not printed.');
}

main();

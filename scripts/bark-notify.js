const fs = require('fs');
const path = require('path');
const { readProjectVersion } = require('./project-version');

const root = process.cwd();
const projectName = require(path.join(root, 'package.json')).name || 'personal-context-protocol';
const projectVersion = readProjectVersion(root);

function usage() {
  console.error('Usage: npm run notify:bark -- <message>');
}

function configFiles() {
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith('.bark.env'))
    .map((name) => path.join(root, name));
}

function readTemplates(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function withPassiveLevel(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set('level', 'passive');
  return url;
}

async function send(template, message) {
  const encodedMessage = encodeURIComponent(message);
  const rawUrl = template.includes('$0')
    ? template.replaceAll('$0', encodedMessage)
    : `${template}${template.includes('?') ? '&' : '?'}body=${encodedMessage}`;
  const url = withPassiveLevel(rawUrl);

  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Bark endpoint returned ${response.status}`);
  }
}

async function main() {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    usage();
    process.exit(1);
  }

  const message = `${projectName} v${projectVersion}: ${text}`;
  const files = configFiles();
  if (files.length === 0) {
    console.log('Bark notification skipped: no *.bark.env config found.');
    return;
  }

  let attempted = 0;
  let failed = 0;
  for (const filePath of files) {
    const basename = path.basename(filePath);
    for (const template of readTemplates(filePath)) {
      attempted += 1;
      try {
        await send(template, message);
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : 'unknown error';
        console.warn(`Bark notification warning: ${basename} delivery failed - ${reason}`);
      }
    }
  }

  console.log(`Bark notification complete: ${attempted - failed}/${attempted} delivered.`);
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : 'unknown error';
  console.warn(`Bark notification warning: delivery skipped - ${reason}`);
});

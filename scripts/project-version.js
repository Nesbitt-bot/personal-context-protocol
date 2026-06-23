const fs = require('fs');
const path = require('path');

function readProjectVersion(rootDir = process.cwd()) {
  const versionPath = path.join(rootDir, 'VERSION');
  return fs.readFileSync(versionPath, 'utf8').trim();
}

module.exports = { readProjectVersion };

if (require.main === module) {
  process.stdout.write(readProjectVersion());
}

"""Copy private runtime settings and stamp the checked-out software identity."""
from pathlib import Path
import os
import re
import sys
from urllib.parse import urlsplit

source, output = map(Path, sys.argv[1:])
version = Path('VERSION').read_text().strip()
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version):
    raise SystemExit('Deployment blocked: PCP.Jenkins/version — VERSION is not a Docker-compatible software version')
values = {}
for line in source.read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"\'')
missing = [key for key in ['DATABASE_URL', 'PCP_INSTANCE_SECRET', 'PCP_APP_URL', 'POSTGRES_PASSWORD'] if not values.get(key)]
if missing:
    raise SystemExit('Deployment blocked: PCP.Jenkins/env — missing keys: ' + ', '.join(missing))
url = urlsplit(values['DATABASE_URL'])
if url.hostname != 'db' or url.path != '/pcp':
    raise SystemExit('Deployment blocked: PCP.Jenkins/database — runtime must target the local db service and pcp database')
if len(values['PCP_INSTANCE_SECRET']) < 32:
    raise SystemExit('Deployment blocked: PCP.Jenkins/env — instance secret is shorter than 32 characters')
tag = f"v{version}-jenkins.{os.environ.get('BUILD_NUMBER', 'local')}"
stamps = {
    'PCP_VERSION': version,
    'PCP_IMAGE': f'personal-context-protocol:{tag}',
    'PCP_CI_IMAGE': f'pcp-ci:{tag}',
    'PCP_BUILD_COMMIT': os.environ.get('GIT_COMMIT', ''),
    'PCP_BUILD_TARGET': 'jenkins',
}
lines = [line for line in source.read_text().splitlines() if line.split('=', 1)[0].strip() not in stamps]
output.touch(mode=0o600)
output.chmod(0o600)
output.write_text('\n'.join(lines + [f'{key}={value}' for key, value in stamps.items()]) + '\n')
print(f'Environment prepared: PCP.Jenkins/env — software={version} image={stamps["PCP_IMAGE"]}; credentials remain private')

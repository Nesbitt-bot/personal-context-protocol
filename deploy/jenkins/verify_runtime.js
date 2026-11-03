const postgres = require('postgres');
const { readProjectVersion } = require('../../scripts/project-version');

async function main() {
  const response = await fetch('http://127.0.0.1:3000/api/v1/health', {
    signal: AbortSignal.timeout(10000),
  });
  const health = await response.json();
  if (!response.ok || health.version !== readProjectVersion()
      || health.build?.commit !== process.env.PCP_BUILD_COMMIT) {
    throw new Error('Health identity mismatch: PCP.Jenkins/verify — HTTP status, software version or commit differs from deployed image');
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  try {
    const [state] = await sql`SELECT version FROM app_instance WHERE id = 'instance_1'`;
    const [credential] = await sql`SELECT source FROM ui_auth WHERE id = 'ui_1'`;
    if (state?.version !== readProjectVersion() || !credential) {
      throw new Error('Database verification failed: PCP.Jenkins/verify — app instance version or admin credential is missing');
    }
    console.log(`Runtime verified: PCP.Jenkins/health — version=${health.version} commit=${health.build.commit}; local database and stored admin credential ready`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch(() => {
  console.error('Deployment unverified: PCP.Jenkins/runtime — version, database or health check failed; inspect the failed stage');
  process.exitCode = 1;
});

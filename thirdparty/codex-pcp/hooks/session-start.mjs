import { launch, close } from './codex-watch.mjs';
import { settings } from './presence.mjs';
import { register } from './registration.mjs';
export { register } from './registration.mjs';
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const { config, token } = await settings();
    const payload = JSON.parse(input);
    if (payload.hook_event_name === 'SessionEnd') await close(payload.session_id, config, token);
    else {
      // Keep a verified thread retrying if PCP was offline at startup. Without
      // an identifiable owner the one-shot hook still surfaces the actual error.
      let remoteId = '';
      try {
        remoteId = await register(payload, config, token);
      } catch (err) {
        if (!(await launch(payload, remoteId, config, token))) throw err;
      }
      if (remoteId) await launch(payload, remoteId, config, token);
    }
  } catch (err) {
    console.error(`PCP session registration failed: ${err.message}`);
    process.exitCode = 1;
  }
}

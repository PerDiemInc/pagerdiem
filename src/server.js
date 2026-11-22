import { config, slackEnabled } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const db = await openDb(config.database);
console.log(`  Database: ${db.dialect === 'pg' ? 'Postgres' : config.database}`);
const app = createApp({ db });
await app.loadSettings();

app.relinkSlackUsers().catch((err) => console.error('Slack relink failed:', err.message));
app.scheduler.start();

app.server.listen(config.port, () => {
  console.log(`PagerDiem running at ${config.publicUrl} (port ${config.port})`);
  console.log(`  Shifts: ${JSON.stringify(config.shiftStart)} -> ${JSON.stringify(config.shiftEnd)} in ${config.timezone}`);
  console.log(`  Slack: ${slackEnabled() ? 'connected' : 'dry-run'}`);
  if (slackEnabled() && !config.slack.signingSecret) console.warn('  WARNING: SLACK_BOT_TOKEN is set but SLACK_SIGNING_SECRET is not, so every Slack command and button will be rejected.');
});

// Stay awake on free hosting: a request through the public URL counts as traffic.
let keepAwakeTimer = null;
if (config.keepAwake && config.publicUrl.startsWith('https://')) {
  keepAwakeTimer = setInterval(() => {
    fetch(`${config.publicUrl}/healthz`, { signal: AbortSignal.timeout(15_000) })
      .catch((err) => console.error('keep-awake ping failed:', err.message));
  }, 10 * 60_000);
  console.log('  Keep-awake ping: every 10 min');
}

process.on('unhandledRejection', (err) => console.error('unhandled rejection:', err));

function shutdown() {
  clearInterval(keepAwakeTimer);
  app.scheduler.stop();
  app.server.close(async () => { await db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

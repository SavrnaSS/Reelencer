import { runScheduledSocialSync } from '../lib/api/socialSync.ts';
import { syncIntegrationStatus } from '../lib/api/integrations.ts';

try {
  if (process.argv.includes('--check')) {
    const { health, scheduler, instagram, youtube } = await syncIntegrationStatus();
    console.log(JSON.stringify({ health, scheduler, instagramMode: instagram.mode, youtubeConnected: youtube.connected }, null, 2));
  } else {
    console.log(JSON.stringify(await runScheduledSocialSync(), null, 2));
  }
} catch {
  console.error('Account sync could not complete. Check database connectivity, provider connections and the background social sync migration.');
  process.exitCode = 1;
}

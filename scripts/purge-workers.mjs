import { purgeDeletedWorkers, workerPurgeHealth } from '../lib/api/workerPurge.ts';

try {
  const result = process.argv.includes('--check') ? await workerPurgeHealth() : await purgeDeletedWorkers();
  console.log(JSON.stringify(result, null, 2));
} catch {
  console.error('Worker cleanup could not finish. Check the permanent deletion migration, Storage access and database connectivity. The queue retains incomplete jobs for retry.');
  process.exitCode = 1;
}

import { createClient } from '@supabase/supabase-js';
import { getAdminCredentials } from '../lib/adminConfig.ts';
import { AdminSetupError, syncAdminAccount } from '../lib/adminProvisioning.ts';

try {
  const unexpected = process.argv.slice(2).filter(arg => arg !== '--check');
  if (unexpected.length) throw new AdminSetupError('Supported option: --check. Credentials are read only from the server environment.');
  const credentials = getAdminCredentials();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new AdminSetupError('Configure the Supabase URL and server service key first.');
  const sb = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    db: { retry: false, timeout: 10000 },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  });
  const result = await syncAdminAccount(sb, credentials, !process.argv.includes('--check'));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Do not print SDK errors, request objects, email addresses, or passwords.
  const safe = error instanceof AdminSetupError || (error instanceof Error && /^(ADMIN_|Configure a valid server-only ADMIN_EMAIL)/.test(error.message));
  console.error(JSON.stringify({ ok: false, error: safe ? error.message : 'Admin setup could not complete. Check server configuration and Supabase availability.', authUpdated: error instanceof AdminSetupError && error.authUpdated }));
  process.exitCode = 1;
}

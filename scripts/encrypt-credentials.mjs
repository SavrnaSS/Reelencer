import { createClient } from '@supabase/supabase-js';
import { encryptSecretText, decryptSecretText, isEncryptedSecret } from '../lib/secretCrypto.ts';
const apply = process.argv.includes('--apply');
encryptSecretText('key-validation');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configure the Supabase server environment first.');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { retry: false, timeout: 15000 }, auth: { persistSession: false, autoRefreshToken: false } });
const targets = [['gig_account_credentials','password'],['work_email_accounts','social_password']];
async function scan(visit) {
  for (const [table,column] of targets) {
    for (let offset=0;;offset+=200) {
      const { data,error } = await sb.from(table).select('id,'+column).order('id').range(offset,offset+199);
      if (error) throw new Error('Credential migration failed while reading '+table+'.');
      for (const row of data) await visit(table,column,row);
      if (data.length<200) break;
    }
  }
}
let encrypted = 0; let plaintext = 0;
// Validate every existing encrypted row before writing anything. A wrong key must not start a mixed-key migration.
await scan(async (_table,column,row) => {
  const value = row[column]; if (!value) return;
  if (isEncryptedSecret(value)) { decryptSecretText(value); encrypted++; } else plaintext++;
});
let updated=0;
if (apply) await scan(async (table,column,row) => {
  const value=row[column]; if (!value || isEncryptedSecret(value)) return;
  const { data,error }=await sb.from(table).update({[column]:encryptSecretText(value)}).eq('id',row.id).eq(column,value).select('id');
  if (error) throw new Error('Credential migration failed while updating '+table+'.');
  updated+=data.length;
});
console.log(JSON.stringify({mode:apply?'apply':'dry-run',encrypted,plaintext,updated}));

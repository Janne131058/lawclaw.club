/**
 * LawClaw — database seeder
 *
 * Populates Supabase with the demo library in public/sample-data.json:
 * sample client + lawyer accounts, anonymized needs, and pitches.
 *
 * Usage:
 *   node seed.js          # create/update sample data
 *
 * Requires the same env as the API (SUPABASE_URL, SUPABASE_SERVICE_KEY).
 * Idempotent: re-running updates lawyers and replaces each demo client's
 * needs/pitches rather than duplicating them. All demo accounts share the
 * password in sample-data.json (defaultPassword).
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const data = require('./public/sample-data.json');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const PASSWORD = data.defaultPassword;

// Find a user by email (paginating through the admin list).
async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data: res, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = res.users.find((u) => u.email === email);
    if (found) return found;
    if (res.users.length < 200) break;
  }
  return null;
}

// Create the auth user if missing; return its id.
async function getOrCreateUser(email, meta) {
  const { data: created, error } = await supabase.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: meta,
  });
  if (!error) return created.user.id;
  const existing = await findUserByEmail(email);
  if (!existing) throw new Error(`Could not create or find user ${email}: ${error.message}`);
  // keep role/name in sync
  await supabase.auth.admin.updateUserById(existing.id, { user_metadata: meta });
  return existing.id;
}

async function main() {
  console.log('Seeding LawClaw demo data…\n');

  // 1. Clients
  const clientIds = [];
  for (const c of data.clients) {
    const id = await getOrCreateUser(c.email, { role: 'user', full_name: c.full_name });
    clientIds.push(id);
    console.log(`  client  ✓ ${c.email}`);
  }

  // 2. Lawyers (auth user + profile upsert)
  const lawyerIds = [];
  for (const l of data.lawyers) {
    const id = await getOrCreateUser(l.email, { role: 'lawyer', full_name: l.name_en });
    lawyerIds.push(id);
    const { email, ...profile } = l;
    const { error } = await supabase.from('lawyers').upsert({
      id,
      ...profile,
      avatar_initial: l.avatar_initial || (l.name_cn?.[0] || l.name_en[0]),
      bar_verified: true,
      bar_status: 'Active',
      bar_last_checked: new Date().toISOString(),
      bar_discipline: false,
      pitches_limit: l.subscription_active ? 9999 : 5,
      pitches_used: 0,
      pitches_period_start: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) { console.error(`  lawyer  ✗ ${l.email}: ${error.message}`); continue; }
    console.log(`  lawyer  ✓ ${l.name_en}`);
  }

  // 3. Reset this run's demo needs (cascades to pitches/chats), then insert fresh.
  await supabase.from('needs').delete().in('user_id', clientIds);

  const needIds = [];
  for (const n of data.needs) {
    const { client, ...fields } = n;
    const { data: row, error } = await supabase.from('needs').insert({
      user_id: clientIds[client],
      ...fields,
      status: fields.status || 'open',
      pitch_count: 0,
    }).select('id').single();
    if (error) { console.error(`  need    ✗ ${fields.case_type}: ${error.message}`); needIds.push(null); continue; }
    needIds.push(row.id);
  }
  console.log(`  needs   ✓ ${needIds.filter(Boolean).length} inserted`);

  // 4. Pitches + per-need pitch_count
  const counts = {};
  let pitched = 0;
  for (const p of data.pitches) {
    const needId = needIds[p.need], lawyerId = lawyerIds[p.lawyer];
    if (!needId || !lawyerId) continue;
    const { error } = await supabase.from('pitches').insert({
      need_id: needId, lawyer_id: lawyerId,
      message: p.message, fee_type: p.fee_type, fee_detail: p.fee_detail,
    });
    if (error) { console.error(`  pitch   ✗ need ${p.need}: ${error.message}`); continue; }
    counts[needId] = (counts[needId] || 0) + 1;
    pitched++;
  }
  for (const [needId, count] of Object.entries(counts)) {
    await supabase.from('needs').update({ pitch_count: count }).eq('id', needId);
  }
  console.log(`  pitches ✓ ${pitched} inserted`);

  console.log(`\nDone. Demo accounts use password: ${PASSWORD}`);
  console.log(`Try logging in as ${data.lawyers[0].email} (lawyer) or ${data.clients[0].email} (client).`);
}

main().catch((e) => { console.error('\nSeed failed:', e.message); process.exit(1); });

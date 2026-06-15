/**
 * LawClaw API v2 — Supabase backend
 *
 * Install:
 *   npm install express cors helmet express-rate-limit @supabase/supabase-js
 *               nodemailer dotenv uuid
 *
 * .env file needed:
 *   SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY=your-service-role-key   (NOT the anon key)
 *   EMAIL_HOST=smtp.gmail.com
 *   EMAIL_USER=your@gmail.com
 *   EMAIL_PASS=your-app-password
 *   FROM_EMAIL=noreply@lawclaw.club
 *   FRONTEND_URL=https://lawclaw.club
 *   PORT=3001
 */

require('dotenv').config();
const path       = require('path');
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// ── ENV VALIDATION (fail fast) ──────────────────────────────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}
const EMAIL_ENABLED = !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
if (!EMAIL_ENABLED) console.warn('Email is disabled (EMAIL_HOST/USER/PASS not set) — notifications will be skipped.');

const app = express();
app.set('trust proxy', 1); // Railway / proxies — needed for correct rate-limit IPs
app.disable('x-powered-by');

// ── SECURITY: strict body size limit ──────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── SECURITY: CORS — only our frontends, never wildcard ───────────────────
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  'https://www.lawclaw.club',
  'https://lawclaw-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // same-origin / curl (no Origin header)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── SECURITY: Helmet — CSP still lets the bundled frontend load its own assets
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'", 'https:', 'wss:'],
      fontSrc:    ["'self'", 'data:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── SECURITY: Rate limiting (static assets are unmetered) ──────────────────
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: { error: 'Too many requests. Please slow down.' }
});
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Too many AI requests. Please wait a moment.' }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Too many attempts. Please try again later.' }
});

app.use('/api', generalLimiter);
app.use('/api/analyze', aiLimiter);
app.use('/api/generate-document', aiLimiter);
app.use('/api/auth', authLimiter);

// ── SUPABASE CLIENT (service role — bypasses RLS for server operations) ──────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── EMAIL ─────────────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: 587,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendEmail(to, subject, html) {
  if (!EMAIL_ENABLED) return;
  try {
    await mailer.sendMail({ from: `LawClaw <${process.env.FROM_EMAIL}>`, to, subject, html });
  } catch (e) {
    console.error('Email failed:', e.message);
  }
}

// ── VALIDATION HELPERS ──────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s) { return typeof s === 'string' && EMAIL_RE.test(s); }
function isStrongEnough(pw) { return typeof pw === 'string' && pw.length >= 8; }
// Wrap an async route so thrown errors become a 500 instead of crashing.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────────────
// Verifies real Supabase JWT — cannot be forged by client
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token.length < 20) {
    return res.status(401).json({ error: 'Invalid token format' });
  }
  try {
    // Supabase verifies the JWT signature — cannot be faked
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    }
    // Double-check user exists in our DB
    if (!user.id || !user.email) {
      return res.status(401).json({ error: 'Invalid user data' });
    }
    req.user = user;
    req.userId = user.id; // Convenience
    next();
  } catch(e) {
    console.error('Auth error:', e.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

async function requireLawyer(req, res, next) {
  await requireAuth(req, res, async () => {
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', req.user.id).single();
    if (profile?.role !== 'lawyer') {
      return res.status(403).json({ error: 'Attorney account required' });
    }
    const { data: lawyer } = await supabase
      .from('lawyers').select('*').eq('id', req.user.id).single();
    if (!lawyer) {
      return res.status(403).json({ error: 'Attorney profile not found' });
    }
    if (!lawyer.bar_verified) {
      return res.status(403).json({ error: 'Bar license not yet verified. Please wait 1-2 business days.' });
    }
    req.lawyer = lawyer;
    next();
  });
}

// ── SECURITY: Input sanitizer ────────────────────────────────────────────────
function sanitizeText(str, maxLen = 5000) {
  if (typeof str !== 'string') return '';
  // Strip null bytes, control chars (keep newlines/tabs)
  return str.replace(/\0/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}

// ── SECURITY: UUID validator ─────────────────────────────────────────────────
function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ── SECURITY: Validate all UUID params in routes ──────────────────────────────
app.param('id', (req, res, next, id) => {
  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }
  next();
});

// ── PRIVACY HELPER ────────────────────────────────────────────────────────────
// Strips sensitive fields based on privacy level
function sanitizeNeed(need, level = 'public') {
  const { description, user_real_name, user_phone, user_email, user_id, ...pub } = need;
  if (level === 'public') return pub;
  if (level === 'matched') return { ...pub, description };
  if (level === 'unlocked') return { ...pub, description, user_real_name, user_phone, user_email };
  return pub;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/auth/signup/user
app.post('/api/auth/signup/user', async (req, res) => {
  const { email, password, full_name } = req.body;
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!isStrongEnough(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const { data, error } = await supabase.auth.admin.createUser({
    email, password,
    email_confirm: true, // app auto-logs-in after signup; mark confirmed so login works
    user_metadata: { role: 'user', full_name },
  });
  if (error) return res.status(400).json({ error: error.message });

  await sendEmail(email, 'Welcome to LawClaw', `
    <p>Hi ${full_name || 'there'},</p>
    <p>Your LawClaw account is ready. Post your legal need anonymously and let verified attorneys come to you.</p>
    <p><a href="${process.env.FRONTEND_URL}">Get started →</a></p>
    <p style="color:#999;font-size:12px;">LawClaw does not provide legal advice. All legal advice is provided by licensed attorneys.</p>
  `);

  res.status(201).json({ success: true, user_id: data.user.id });
});

// POST /api/auth/signup/lawyer
app.post('/api/auth/signup/lawyer', async (req, res) => {
  const { email, password, name_en, name_cn, bar_number, bar_state,
          specialties, languages, city, state } = req.body;

  if (!email || !password || !name_en || !bar_number || !bar_state) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
  if (!isStrongEnough(password)) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  // 1. Verify bar license first
  const barVerified = await verifyBarLicense(bar_number, bar_state);
  if (!barVerified.verified) {
    return res.status(422).json({ error: `Bar license not found: ${barVerified.message}` });
  }
  if (!barVerified.active) {
    return res.status(422).json({ error: `License status is "${barVerified.status}" — must be Active` });
  }
  if (barVerified.has_discipline) {
    return res.status(422).json({ error: 'Cannot register: discipline history on record' });
  }

  // 2. Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email, password,
    email_confirm: true, // app auto-logs-in after signup; mark confirmed so login works
    user_metadata: { role: 'lawyer', full_name: name_en },
  });
  if (authError) return res.status(400).json({ error: authError.message });

  // 3. Create lawyer record
  const { error: lawyerError } = await supabase.from('lawyers').insert({
    id:             authData.user.id,
    name_en, name_cn,
    avatar_initial: name_cn?.[0] || name_en[0],
    city, state,
    specialties:    specialties || [],
    languages:      languages || ['en'],
    bar_number, bar_state,
    bar_verified:      true,
    bar_status:        barVerified.status,
    bar_last_checked:  new Date().toISOString(),
    bar_discipline:    false,
    subscription_active: false,
    pitches_limit:   5,
  });

  if (lawyerError) {
    await supabase.auth.admin.deleteUser(authData.user.id);
    return res.status(500).json({ error: lawyerError.message });
  }

  await sendEmail(email, 'LawClaw — Application received', `
    <p>Hi ${name_en},</p>
    <p>Your bar license has been verified (${bar_state} #${bar_number} — ${barVerified.status}).</p>
    <p>Your free account includes 5 pitches per month. <a href="${process.env.FRONTEND_URL}/attorneys">Browse legal needs →</a></p>
    <p>Upgrade to Pro ($99/mo) for unlimited pitches.</p>
  `);

  res.status(201).json({
    success: true,
    lawyer_id: authData.user.id,
    bar_verified: true,
    bar_status: barVerified.status,
  });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: 'Invalid email or password' });

  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', data.user.id).single();

  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: { id: data.user.id, email: data.user.email, role: profile?.role, name: profile?.full_name },
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NEEDS ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/needs — User posts anonymous need
app.post('/api/needs', requireAuth, async (req, res) => {
  const { description, case_type, region, state, language_pref, visa_status } = req.body;
  if (!description || !case_type || !region || !state) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const urgency = /h-?1b|grace period|urgent|asap/i.test(description) ? 'high' : 'normal';

  const { data, error } = await supabase.from('needs').insert({
    user_id: req.user.id,
    case_type, region, state, language_pref, visa_status,
    description, urgency,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    success: true,
    need_id: data.id,
    message: 'Posted anonymously. Attorneys will see your case type and region only.',
    public_preview: sanitizeNeed(data, 'public'),
  });
});

// GET /api/needs — Lawyers browse anonymous needs
app.get('/api/needs', requireLawyer, async (req, res) => {
  const { state, case_type, language, urgency, page = 1, limit = 20 } = req.query;

  let query = supabase.from('needs')
    .select('id,case_type,region,state,language_pref,visa_status,urgency,pitch_count,created_at,status')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .range((page-1)*limit, page*limit-1);

  if (state)    query = query.eq('state', state.toUpperCase());
  if (urgency)  query = query.eq('urgency', urgency);
  if (language) query = query.ilike('language_pref', `%${language}%`);
  if (case_type)query = query.ilike('case_type', `%${case_type}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Double-sanitize: defense-in-depth privacy protection
  const ALLOWED = new Set(["id","case_type","region","state","language_pref","visa_status","urgency","pitch_count","created_at","status"]);
  const sanitized = (data || []).map(n => {
    const safe = {};
    ALLOWED.forEach(k => { if (n[k] !== undefined) safe[k] = n[k]; });
    return safe;
  });
  res.json({ total: count, page: Number(page), results: sanitized });
});

// GET /api/needs/recent — Public, anonymized feed for the homepage ticker.
// Returns only non-identifying fields (same as what browsing lawyers see).
app.get('/api/needs/recent', async (req, res) => {
  const { data, error } = await supabase.from('needs')
    .select('case_type,region,state,language_pref,urgency,pitch_count,created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(12);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ results: data || [] });
});

// GET /api/needs/mine — User sees their own needs
app.get('/api/needs/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('needs')
    .select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ results: data });
});

// ════════════════════════════════════════════════════════════════════════════
// PITCH ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/needs/:id/pitch — Lawyer sends pitch
app.post('/api/needs/:id/pitch', requireLawyer, async (req, res) => {
  const lawyer = req.lawyer;

  // Reset the monthly quota if the 30-day billing window has rolled over.
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const periodStart = lawyer.pitches_period_start ? new Date(lawyer.pitches_period_start).getTime() : 0;
  if (Date.now() - periodStart >= THIRTY_DAYS) {
    lawyer.pitches_used = 0;
    await supabase.from('lawyers')
      .update({ pitches_used: 0, pitches_period_start: new Date().toISOString() })
      .eq('id', lawyer.id);
  }
  const pitchesUsed = lawyer.pitches_used || 0;

  // Check subscription / pitch limit
  if (!lawyer.subscription_active && pitchesUsed >= lawyer.pitches_limit) {
    return res.status(403).json({
      error: `Free pitch limit reached (${lawyer.pitches_limit}/month). Upgrade to Pro for unlimited pitches.`,
      upgrade_url: `${process.env.FRONTEND_URL}/pricing`,
    });
  }

  // Check need exists and is open
  const { data: need, error: needErr } = await supabase.from('needs')
    .select('id,status,user_id,case_type,pitch_count').eq('id', req.params.id).single();
  if (needErr || !need) return res.status(404).json({ error: 'Need not found' });
  if (need.status !== 'open') return res.status(409).json({ error: 'This need is no longer accepting pitches' });

  const { message, fee_type, fee_detail, availability } = req.body;
  if (!message || message.trim().length < 20) {
    return res.status(400).json({ error: 'Pitch must be at least 20 characters' });
  }

  // Check for duplicate pitch before insert
  const { data: existingPitch } = await supabase.from('pitches')
    .select('id').eq('need_id', req.params.id).eq('lawyer_id', lawyer.id).single();
  if (existingPitch) return res.status(409).json({ error: 'You already pitched on this need' });

  // Insert pitch
  const { data: pitch, error: pitchErr } = await supabase.from('pitches').insert({
    need_id: req.params.id,
    lawyer_id: lawyer.id,
    message: message.trim(),
    fee_type: fee_type || lawyer.fee_type,
    fee_detail, availability: availability || lawyer.availability,
  }).select().single();

  if (pitchErr) {
    if (pitchErr.code === '23505') return res.status(409).json({ error: 'You already pitched on this need' });
    return res.status(500).json({ error: pitchErr.message });
  }

  // Increment pitches_used (lawyer quota) and the need's public pitch_count
  await supabase.from('lawyers')
    .update({ pitches_used: pitchesUsed + 1 }).eq('id', lawyer.id);
  await supabase.rpc('increment_pitch_count', { need_id_in: req.params.id })
    .then(({ error }) => {
      // Fall back to a read-modify-write if the RPC isn't installed.
      if (error) return supabase.from('needs')
        .update({ pitch_count: (need.pitch_count || 0) + 1 }).eq('id', req.params.id);
    });

  // Notify user by email (get user email from auth)
  const { data: userData } = await supabase.auth.admin.getUserById(need.user_id);
  if (userData?.user?.email) {
    await sendEmail(userData.user.email, 'An attorney responded to your LawClaw need', `
      <p>An attorney has reviewed your legal need and sent you a message.</p>
      <p><strong>Case type:</strong> ${need.case_type}</p>
      <p><strong>Attorney:</strong> ${lawyer.name_en}</p>
      <p><a href="${process.env.FRONTEND_URL}">View their message →</a></p>
      <p style="color:#999;font-size:12px;">Your identity remains anonymous until you choose to share it.</p>
    `);
  }

  res.status(201).json({
    success: true,
    pitch_id: pitch.id,
    message: 'Pitch sent. You\'ll be notified when the user responds.',
    pitches_remaining: lawyer.subscription_active ? null : Math.max(0, lawyer.pitches_limit - pitchesUsed - 1),
  });
});

// GET /api/needs/:id/pitches — User views pitches on their need
app.get('/api/needs/:id/pitches', requireAuth, async (req, res) => {
  // Verify ownership
  const { data: need } = await supabase.from('needs')
    .select('user_id').eq('id', req.params.id).single();
  if (!need || need.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

  const { data: pitches, error } = await supabase.from('pitches')
    .select(`*, lawyers(name_en, name_cn, avatar_initial, specialties, city, state,
             rating, review_count, years_experience, bar_verified, bar_number, bar_state,
             languages, fee_type, free_consult, availability)`)
    .eq('need_id', req.params.id)
    .order('sent_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ total: pitches.length, pitches });
});

// GET /api/pitches/mine — Lawyer sees their own pitches (with need context)
app.get('/api/pitches/mine', requireLawyer, async (req, res) => {
  const { data, error } = await supabase.from('pitches')
    .select('id,message,fee_type,fee_detail,status,chat_id,sent_at, needs(case_type,region,state,urgency,status)')
    .eq('lawyer_id', req.user.id)
    .order('sent_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ total: (data || []).length, pitches: data || [] });
});

// ════════════════════════════════════════════════════════════════════════════
// CHAT ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/pitches/:id/accept — Opens encrypted chat
app.post('/api/pitches/:id/accept', requireAuth, async (req, res) => {
  const { data: pitch } = await supabase.from('pitches')
    .select('*, needs(user_id, description)').eq('id', req.params.id).single();
  if (!pitch) return res.status(404).json({ error: 'Pitch not found' });
  if (pitch.needs.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
  if (pitch.status !== 'pending') return res.status(409).json({ error: 'Pitch already processed' });

  // Open chat
  const { data: chat, error: chatErr } = await supabase.from('chats').insert({
    need_id: pitch.need_id,
    pitch_id: pitch.id,
    user_id: req.user.id,
    lawyer_id: pitch.lawyer_id,
    privacy_level: 'matched',
  }).select().single();
  if (chatErr) return res.status(500).json({ error: chatErr.message });

  // Update pitch status
  await supabase.from('pitches').update({ status: 'accepted', chat_id: chat.id }).eq('id', pitch.id);

  // System message
  await supabase.from('messages').insert({
    chat_id: chat.id, sender_type: 'system',
    content: 'Chat opened. Your identity is still anonymous — share your contact info only when you\'re ready.',
  });

  // Notify lawyer
  const { data: lawyerAuth } = await supabase.auth.admin.getUserById(pitch.lawyer_id);
  if (lawyerAuth?.user?.email) {
    await sendEmail(lawyerAuth.user.email, 'LawClaw — A user accepted your pitch', `
      <p>A user has accepted your pitch and wants to chat.</p>
      <p><a href="${process.env.FRONTEND_URL}/chat/${chat.id}">Open conversation →</a></p>
      <p style="color:#999;font-size:12px;">Case type: ${pitch.needs?.case_type || 'Legal matter'}</p>
    `);
  }

  res.status(201).json({
    success: true,
    chat_id: chat.id,
    message: 'Chat opened anonymously. The attorney can now see your full case description. Your identity is still hidden.',
  });
});

// GET /api/chats — Get all chats for current user or lawyer
app.get('/api/chats', requireAuth, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', req.user.id).single();

  const field = profile.role === 'lawyer' ? 'lawyer_id' : 'user_id';
  const { data, error } = await supabase.from('chats')
    .select(`*, lawyers(name_en, avatar_initial, specialties, city, state),
             messages(content, sent_at, sender_type)`)
    .eq(field, req.user.id)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ results: data });
});

// GET /api/chats/:id — Get chat + messages
app.get('/api/chats/:id', requireAuth, async (req, res) => {
  const { data: chat, error } = await supabase.from('chats')
    .select('*').eq('id', req.params.id).single();
  if (error || !chat) return res.status(404).json({ error: 'Chat not found' });

  // Check participant
  if (chat.user_id !== req.user.id && chat.lawyer_id !== req.user.id) {
    return res.status(403).json({ error: 'Not a participant in this chat' });
  }

  // Get messages
  const { data: messages } = await supabase.from('messages')
    .select('*').eq('chat_id', req.params.id).order('sent_at', { ascending: true });

  // Get need (with correct privacy level)
  const { data: need } = await supabase.from('needs')
    .select('*').eq('id', chat.need_id).single();

  const isLawyer = chat.lawyer_id === req.user.id;
  const needPreview = need ? sanitizeNeed(need, isLawyer ? chat.privacy_level : 'unlocked') : null;

  res.json({ chat, messages, need: needPreview });
});

// POST /api/chats/:id/messages — Send message
app.post('/api/chats/:id/messages', requireAuth, async (req, res) => {
  const { data: chat } = await supabase.from('chats')
    .select('*').eq('id', req.params.id).single();
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (chat.user_id !== req.user.id && chat.lawyer_id !== req.user.id) {
    return res.status(403).json({ error: 'Not a participant' });
  }
  if (chat.status !== 'active') return res.status(409).json({ error: 'Chat is closed' });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

  const isLawyer = chat.lawyer_id === req.user.id;
  const { data: message, error } = await supabase.from('messages').insert({
    chat_id: req.params.id,
    sender_id: req.user.id,
    sender_type: isLawyer ? 'lawyer' : 'user',
    content: content.trim(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Supabase Realtime handles live delivery
  // Email fallback for offline users
  const recipientId = isLawyer ? chat.user_id : chat.lawyer_id;
  const { data: recipient } = await supabase.auth.admin.getUserById(recipientId);
  if (recipient?.user?.email) {
    await sendEmail(recipient.user.email, 'New message on LawClaw', `
      <p>You have a new message.</p>
      <p><a href="${process.env.FRONTEND_URL}/chat/${chat.id}">View message →</a></p>
    `);
  }

  res.status(201).json({ success: true, message });
});

// POST /api/chats/:id/share-identity — User voluntarily shares contact
app.post('/api/chats/:id/share-identity', requireAuth, async (req, res) => {
  const { data: chat } = await supabase.from('chats')
    .select('*').eq('id', req.params.id).single();
  if (!chat || chat.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
  if (chat.identity_shared) return res.status(409).json({ error: 'Identity already shared' });

  const { name, phone, email } = req.body;
  if (!name || (!phone && !email)) {
    return res.status(400).json({ error: 'Provide name and at least phone or email' });
  }

  await supabase.from('needs').update({ user_real_name: name, user_phone: phone, user_email: email })
    .eq('id', chat.need_id);
  await supabase.from('chats').update({ identity_shared: true, privacy_level: 'unlocked' })
    .eq('id', req.params.id);
  await supabase.from('messages').insert({
    chat_id: req.params.id, sender_type: 'system',
    content: `The user has shared their contact information. You can now reach them directly.`,
  });

  res.json({ success: true, message: 'Contact info shared with the attorney.' });
});

// ════════════════════════════════════════════════════════════════════════════
// BAR VERIFICATION (problem 4)
// ════════════════════════════════════════════════════════════════════════════

async function verifyBarLicense(barNumber, state) {
  if (state === 'NY') {
    try {
      const url = `https://data.ny.gov/resource/2ea2-qc7r.json?registration_number=${barNumber}&$limit=1`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!data.length) return { verified: false, message: 'Not found in NY OCA database' };
      const a = data[0];
      return {
        verified: true, state: 'NY',
        name: `${a.first_name} ${a.last_name}`,
        status: a.status,
        active: a.status === 'Currently registered',
        has_discipline: false,
      };
    } catch(e) {
      return { verified: false, message: 'NY verification service unavailable' };
    }
  }
  if (state === 'CA') {
    // CA: fetch profile page and parse HTML
    try {
      const res = await fetch(`https://apps.calbar.ca.gov/attorney/Licensee/Detail/${barNumber}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 LawClaw-Verify/1.0' }
      });
      if (res.status === 404) return { verified: false, message: 'Not found in CA State Bar' };
      const html = await res.text();
      const statusMatch = html.match(/Current Status[^:]*:\s*<[^>]+>([^<]+)</i);
      const status = statusMatch?.[1]?.trim() || 'Unknown';
      const active = /^active/i.test(status);
      const has_discipline = /Public Discipline|Disbarred|Suspended/i.test(html);
      const nameMatch = html.match(/<h1[^>]*>([^<]+)</);
      return {
        verified: !!nameMatch, state: 'CA',
        name: nameMatch?.[1]?.trim(),
        status, active, has_discipline,
      };
    } catch(e) {
      return { verified: false, message: 'CA verification service unavailable' };
    }
  }
  return { verified: false, message: 'Unsupported state' };
}

// GET /api/verify/:state/:barNumber
app.get('/api/verify/:state/:barNumber', async (req, res) => {
  const result = await verifyBarLicense(req.params.barNumber, req.params.state.toUpperCase());
  res.json(result);
});

// ════════════════════════════════════════════════════════════════════════════
// LAWYER ROUTES
// ════════════════════════════════════════════════════════════════════════════

// GET /api/lawyers/me — Authenticated lawyer's own profile (incl. quota)
app.get('/api/lawyers/me', requireLawyer, async (req, res) => {
  const l = req.lawyer;
  const remaining = l.subscription_active ? null : Math.max(0, (l.pitches_limit || 0) - (l.pitches_used || 0));
  res.json({ ...l, pitches_remaining: remaining });
});

// GET /api/lawyers/:id — Public profile
app.get('/api/lawyers/:id', async (req, res) => {
  const { data, error } = await supabase.from('lawyers')
    .select('id,name_en,name_cn,avatar_initial,bio_en,bio_cn,city,state,specialties,languages,bar_verified,bar_status,bar_number,bar_state,bar_last_checked,years_experience,rating,review_count,cases_won,availability,fee_type,contingency_pct,hourly_min,hourly_max,free_consult,free_consult_min')
    .eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Lawyer not found' });
  res.json(data);
});

// PUT /api/lawyers/me/availability — Lawyer updates availability
app.put('/api/lawyers/me/availability', requireLawyer, async (req, res) => {
  const { availability, specialties } = req.body;
  const valid = ['available','limited','next_month','unavailable'];
  if (availability && !valid.includes(availability)) {
    return res.status(400).json({ error: 'Invalid availability value' });
  }
  const updates = { availability_updated: new Date().toISOString() };
  if (availability) updates.availability = availability;
  if (specialties)  updates.specialties = specialties;
  await supabase.from('lawyers').update(updates).eq('id', req.user.id);
  res.json({ success: true, availability });
});

// ════════════════════════════════════════════════════════════════════════════
// REVIEWS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/chats/:id/review', requireAuth, async (req, res) => {
  const { data: chat } = await supabase.from('chats')
    .select('*').eq('id', req.params.id).single();
  if (!chat || chat.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

  const { rating, text, case_type } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

  const { data, error } = await supabase.from('reviews').insert({
    chat_id: req.params.id,
    lawyer_id: chat.lawyer_id,
    user_id: req.user.id,
    rating, text, case_type,
  }).select().single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Already reviewed this case' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ success: true, review_id: data.id });
});

// ── POST /api/generate-document ────────────────────────────────────────────
app.post('/api/generate-document', async (req, res) => {
  const { prompt, doc_type } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI service not configured' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: `You are a legal document drafting assistant specializing in California and New York law. Generate professional, legally grounded documents. Output ONLY the document itself — no preamble, no explanation, ready to send. Include proper heading, addresses, date, body citing relevant statutes, demands with deadlines, and signature block.`,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) throw new Error('Claude API error');
    const data = await response.json();
    const document = data.content?.[0]?.text || '';
    res.json({ success: true, document });
  } catch(e) {
    res.status(500).json({ error: 'Document generation failed. Please try again.' });
  }
});

// ── POST /api/analyze — AI case analysis ───────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { situation } = req.body;
  if (!situation || situation.trim().length < 10) {
    return res.status(400).json({ error: 'Please describe your situation (at least 10 characters)' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI service not configured' });

  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `You are LawClaw's senior legal AI analyst — trained on California and New York employment, housing, immigration, family, and personal injury law. Think like a plaintiff-side attorney with 15 years of experience.

Today's date: ${today}. Use this to calculate exact statute of limitations expiry dates.

RULES:
- Respond ONLY with raw JSON — no markdown, no backticks
- Every legal conclusion MUST cite the exact statute
- Recovery estimates must show your calculation math
- SOL expiry must be a specific date (e.g. "May 25, 2029")
- Respond in the same language the user wrote in (English or Chinese)
- Be honest — if the case is weak, say exactly why

JSON FORMAT:
{
  "case_type": "Precise category e.g. 'Wage Theft — Unpaid Daily Overtime' or 'Retaliatory Termination + H-1B Grace Period'",
  "jurisdiction": "California or New York or Federal or California + Federal",
  "urgency": "low or medium or high or critical",

  "legal_basis": [
    {
      "statute": "California Labor Code §510",
      "title": "Daily Overtime Requirements",
      "description": "Requires 1.5x pay for hours over 8/day, 2x for hours over 12/day",
      "applies": true
    }
  ],

  "case_strength": {
    "score": 0-100,
    "label": "Strong or Moderate or Weak or Unclear",
    "color": "green or amber or red",
    "summary": "One sentence explaining the score"
  },

  "sol": {
    "deadline": "e.g. 3 years from last violation",
    "expires": "Exact date e.g. May 25, 2029",
    "statute": "e.g. California CCP §338",
    "urgency": "low or medium or high",
    "warning": "Any urgency flags — e.g. if government entity involved, 6-month claim deadline"
  },

  "recovery": {
    "low": "$XX,XXX",
    "high": "$XXX,XXX",
    "basis": "Show the math: e.g. '2 hrs/day × $45/hr × 1.5 × 260 days × 3 yrs = $105,300 + waiting time penalties'",
    "includes": ["Back wages", "Liquidated damages", "Waiting time penalties", "Attorney fees"]
  },

  "analysis": "3-4 sentences of legal reasoning. Name the specific legal theories. What did the employer/landlord do wrong? What are the strongest and weakest points?",

  "strength_factors": [
    {
      "factor": "Factor name e.g. 'Temporal proximity — fired within 24 hours of protected activity'",
      "status": "yes or no or maybe",
      "impact": "high or medium or low",
      "note": "Brief explanation of why this matters legally"
    }
  ],

  "next_steps": [
    {
      "step": 1,
      "action": "File a retaliation complaint with DLSE",
      "deadline": "Within 1 year of termination",
      "how": "Online at dir.ca.gov/dlse — free, no lawyer needed",
      "why": "Preserves your right to administrative remedy and creates an official record"
    }
  ],

  "evidence_needed": [
    {
      "item": "All pay stubs for the past 4 years",
      "why": "Proves wage rate and hours — DLSE will require this",
      "how_to_get": "Request in writing from HR; employer must provide within 21 days under Labor Code §226"
    }
  ],

  "agency_options": [
    {
      "agency": "California Labor Commissioner (DLSE)",
      "url": "https://www.dir.ca.gov/dlse/",
      "best_for": "Wage claims, retaliation complaints",
      "cost": "Free",
      "timeline": "3-6 months to hearing"
    }
  ],

  "attorney_note": "One sentence on whether an attorney is recommended and why. Mention contingency fee if relevant."
}

STATUTE REFERENCE (use accurately):
EMPLOYMENT: Labor Code §510 (daily OT), §201/202 (final pay), §203 (waiting time 30-day max), §226.7 (breaks $1/hr premium), §226 (pay stub $50-100/violation), §1102.5 (whistleblower), §98.6 (retaliation), §132a (workers comp retaliation), §515 ($66,560 exempt threshold 2024), B&P §16600 (non-compete void in CA), FEHA Gov Code §12940, CFRA Gov Code §12945.2. SOL: CCP §338 (3yr wages), Gov Code §12960 (3yr FEHA).
HOUSING: Civil Code §1950.5 (deposit 21 days, 2x bad faith), §1947.12/AB1482 (rent cap 5%+CPI max 10%), §1941/1942 (habitability), §1954 (24hr entry notice), §1946.2 (just cause eviction), CCP §1161 (3/30/60-day notice).
IMMIGRATION: 8 CFR 214.1(l)(2) (H-1B 60-day grace period), 8 CFR 214.2(h)(4)(iii)(E) (employer pays return flight), INA §212(n) (prevailing wage), VAWA INA §204(a)(1)(A)(iii).
PERSONAL INJURY: CCP §335.1 (2yr PI), Gov Code §911.2 (6-month govt claim — CRITICAL), CCP §340.5 (med mal 3yr/1yr discovery).
FAMILY: Family Code §760/770 (community property), §3011 (child custody best interest), §4320 (spousal support), §2550 (property division).`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: 'user', content: situation.trim() }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const assessment = JSON.parse(clean);

    res.json({ success: true, assessment });
  } catch(e) {
    console.error('Analyze error:', e.message);
    res.status(500).json({ error: 'Failed to analyze. Please try again.' });
  }
});

// GET /health
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── STATIC FRONTEND ─────────────────────────────────────────────────────────
// Serve the website from /public. Unknown non-API GETs fall back to index.html
// so client-side routing works.
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => err && next());
});

// ── 404 + ERROR HANDLERS ────────────────────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nLawClaw API v2 → http://localhost:${PORT}`);
  console.log('\nRoutes:');
  [
    'POST /api/auth/signup/user',
    'POST /api/auth/signup/lawyer',
    'POST /api/auth/login',
    'POST /api/needs',
    'GET  /api/needs',
    'POST /api/needs/:id/pitch',
    'GET  /api/needs/:id/pitches',
    'POST /api/pitches/:id/accept',
    'GET  /api/chats',
    'GET  /api/chats/:id',
    'POST /api/chats/:id/messages',
    'POST /api/chats/:id/share-identity',
    'POST /api/chats/:id/review',
    'GET  /api/verify/:state/:barNumber',
    'GET  /api/lawyers/:id',
    'PUT  /api/lawyers/me/availability',
  ].forEach(r => console.log(' ', r));
});

module.exports = app;

/* ============================================================
   LawClaw — frontend SPA (vanilla JS, hash router)
   ============================================================ */
'use strict';

const App = document.getElementById('app');
const Nav = document.getElementById('topnav');
const ToastEl = document.getElementById('toast');

// ---- Auth state -------------------------------------------------------------
const Store = {
  get token() { return localStorage.getItem('lc_token'); },
  get user()  { try { return JSON.parse(localStorage.getItem('lc_user')); } catch { return null; } },
  set({ token, refresh_token, user }) {
    if (token) localStorage.setItem('lc_token', token);
    if (refresh_token) localStorage.setItem('lc_refresh', refresh_token);
    if (user)  localStorage.setItem('lc_user', JSON.stringify(user));
  },
  clear() { ['lc_token','lc_refresh','lc_user'].forEach(k => localStorage.removeItem(k)); },
};
const isLawyer = () => Store.user?.role === 'lawyer';
const isUser   = () => Store.user && Store.user.role !== 'lawyer';

// ---- API helper -------------------------------------------------------------
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && Store.token) headers.Authorization = `Bearer ${Store.token}`;
  const res = await fetch(`/api${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (res.status === 401 && auth) { Store.clear(); }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

// ---- UI utilities -----------------------------------------------------------
let toastTimer;
function toast(msg, kind = '') {
  ToastEl.textContent = msg;
  ToastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ToastEl.className = 'toast'), 3200);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const timeAgo = (iso) => {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
};
const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const go = (hash) => { location.hash = hash; };
const spinner = '<div class="spinner"></div>';

const CASE_TYPES = ['Immigration','Family','Criminal','Personal Injury','Employment',
  'Business','Real Estate','Bankruptcy','Intellectual Property','Estate Planning','Other'];
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
const LANGS = ['English','Mandarin','Spanish','Cantonese','Korean','Vietnamese','French','Arabic'];

// ---- Nav --------------------------------------------------------------------
function renderNav() {
  const u = Store.user;
  if (!u) {
    Nav.innerHTML = `
      <a class="btn-ghost btn btn-sm" href="#/how">How it works</a>
      <a class="btn-ghost btn btn-sm" href="#/login">Log in</a>
      <a class="btn btn-gold btn-sm" href="#/signup">Get started</a>`;
    return;
  }
  const links = isLawyer()
    ? `<a class="topnav-link" href="#/browse">Browse needs</a>
       <a class="topnav-link" href="#/dashboard">Dashboard</a>
       <a class="topnav-link" href="#/chats">Messages</a>`
    : `<a class="topnav-link" href="#/post">Post a need</a>
       <a class="topnav-link" href="#/needs">My needs</a>
       <a class="topnav-link" href="#/chats">Messages</a>`;
  Nav.innerHTML = `
    ${links}
    <span class="who">${esc(u.name || u.email)}${isLawyer() ? ' · attorney' : ''}</span>
    <button class="btn btn-ghost btn-sm" id="logout">Log out</button>`;
  document.getElementById('logout').onclick = () => { Store.clear(); renderNav(); go('#/'); toast('Logged out'); };
}

// ============================================================================
// VIEWS
// ============================================================================
function viewHome() {
  return `
  <section class="hero">
    <svg class="hero-claw" viewBox="0 0 200 220" aria-hidden="true">
      <g transform="translate(100,42)" fill="#c9a24b" fill-opacity="0.22">
        <g transform="rotate(-13)"><path d="M-8,0 C5,45 9,95 0,160 C-6,95 -18,45 -8,0 Z"/></g>
        <g transform="rotate(0)"><path d="M-8,0 C5,45 9,95 0,160 C-6,95 -18,45 -8,0 Z"/></g>
        <g transform="rotate(13)"><path d="M-8,0 C5,45 9,95 0,160 C-6,95 -18,45 -8,0 Z"/></g>
      </g>
    </svg>
    <h1 class="gradient-text">Ask for a lawyer<br/>without giving up your name.</h1>
    <p class="lead">Post your legal need anonymously. Every attorney who answers is verified against the state bar. You reveal your name and contact only when <em>you</em> decide — no forms sold, no cold calls.</p>
    <p class="lead-cn">匿名发布法律需求,持牌律师主动联系你 — 中英双语,为在美移民与华人社区打造。</p>
    <div class="cta-row">
      <a class="btn btn-gold" href="#/post">I need a lawyer</a>
      <a class="btn btn-ghost" href="#/signup?role=lawyer">I'm an attorney</a>
    </div>
    <div class="pill-row">
      <span class="pill">🔒 Anonymous by default</span>
      <span class="pill">✅ Bar-verified, no discipline</span>
      <span class="pill">🌐 Bilingual · 中英双语</span>
      <span class="pill">🆓 Free for clients</span>
    </div>
  </section>
  ${tickerHtml()}
  <div class="wrap">
    <div class="stats">
      <div class="stat reveal"><div class="num" data-to="1200" data-suf="+">0</div><div class="lbl">Verified attorneys</div></div>
      <div class="stat reveal d1"><div class="num" data-to="50">0</div><div class="lbl">States covered</div></div>
      <div class="stat reveal d2"><div class="num" data-to="100" data-suf="%">0</div><div class="lbl">Bar-verified</div></div>
      <div class="stat reveal d3"><div class="num" data-to="0">0</div><div class="lbl">Cold calls</div></div>
    </div>
    <div class="section-title"><h2>How it works</h2><a class="btn btn-ghost btn-sm" href="#/how">Learn more</a></div>
    <div class="grid grid-3">
      <div class="card lift reveal"><div class="step-num">1</div><h3>Post anonymously</h3><p class="muted">Tell us your case type, state, and what's going on. No name, no contact info required.</p></div>
      <div class="card lift reveal d1"><div class="step-num">2</div><h3>Attorneys pitch you</h3><p class="muted">Verified attorneys who handle your matter send you a short pitch — fees, approach, availability.</p></div>
      <div class="card lift reveal d2"><div class="step-num">3</div><h3>You choose</h3><p class="muted">Accept a pitch to open a private chat. Share your contact only when you're ready to move forward.</p></div>
    </div>
  </div>
  <div class="band">
    <div class="wrap">
      <h2 class="center reveal" style="margin-bottom:6px">Why LawClaw is different</h2>
      <p class="center muted reveal" style="max-width:620px;margin:0 auto 28px">Most "find a lawyer" sites sell your contact info to whoever pays for the lead. We built the opposite.</p>
      <div class="grid grid-3">
        <div class="card lift reveal"><h3>🔒 You stay anonymous</h3><p class="muted">Your name, phone, and email are never sold or shared. They stay hidden until you choose to reveal them inside a chat.</p></div>
        <div class="card lift reveal d1"><h3>✅ Verified, not self-reported</h3><p class="muted">We check every license live against the state bar and reject inactive or disciplined attorneys — no taking their word for it.</p></div>
        <div class="card lift reveal d2"><h3>🌐 Built for immigrants</h3><p class="muted">Filter by language and visa status to find attorneys who speak your language and handle your matter. 为在美移民与华人社区打造。</p></div>
      </div>
    </div>
  </div>
  <div class="wrap">
    <div class="section-title"><h2>Featured attorneys</h2><a class="btn btn-ghost btn-sm" href="#/signup?role=lawyer">Join them →</a></div>
    <div class="grid grid-3" id="featured">${spinner}</div>
  </div>`;
}

let SAMPLE = null;
async function loadSample() {
  if (SAMPLE) return SAMPLE;
  try { SAMPLE = await (await fetch('/sample-data.json')).json(); }
  catch { SAMPLE = { lawyers: [], needs: [] }; }
  return SAMPLE;
}
function lawyerCard(l) {
  return `<div class="card lift">
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">
      <div class="avatar">${esc(l.avatar_initial || l.name_en[0])}</div>
      <div>
        <strong>${esc(l.name_en)}</strong>${l.name_cn ? ` <span class="muted">${esc(l.name_cn)}</span>` : ''}
        <div class="muted" style="font-size:13px">${esc(l.city)}, ${esc(l.state)}</div>
      </div>
    </div>
    <div style="margin-bottom:8px">
      <span class="badge badge-verified">✅ Verified</span>
      <span class="stars">${stars(l.rating)}</span>
      <span class="muted" style="font-size:13px">${l.rating} (${l.review_count})</span>
    </div>
    <p class="muted" style="font-size:14px">${esc(l.bio_en)}</p>
    <div>${(l.specialties || []).map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
    <div class="muted" style="font-size:13px;margin-top:10px">🗣 ${esc((l.languages || []).join(', '))} · ${esc(l.fee_detail || l.fee_type || '')}${l.free_consult ? ' · Free consult' : ''}</div>
  </div>`;
}
async function loadFeatured() {
  const el = document.getElementById('featured');
  if (!el) return;
  const s = await loadSample();
  const top = (s.lawyers || []).slice().sort((a, b) => b.rating - a.rating).slice(0, 6);
  el.innerHTML = top.length ? top.map(lawyerCard).join('') : '<div class="empty">No attorneys yet — be the first.</div>';
}
function sampleNeedToItem(n) {
  const hot = n.urgency === 'high' ? `⚡ ${n.case_type}` : null;
  const bits = [];
  if (!hot) bits.push(n.case_type);
  bits.push(`${n.region}, ${n.state}`);
  if (n.language_pref && n.language_pref !== 'English') bits.push(`🗣 ${n.language_pref}`);
  if (n.visa_status) bits.push(n.visa_status);
  return { hot, rest: bits.join(' · ') };
}

// Live anonymized-needs ticker. Renders demo data immediately, then swaps in
// real recent needs from the public API (reveals nothing private).
const TICKER_DEMO = [
  { hot: '⚡ H-1B grace period', rest: 'New York, NY · 3 attorneys pitched' },
  { rest: 'Family · divorce · Los Angeles, CA' },
  { rest: 'Personal injury · car accident · Houston, TX' },
  { hot: 'Immigration · asylum', rest: '🗣 Mandarin · just now' },
  { rest: 'Employment · wrongful termination · Seattle, WA' },
  { rest: 'Business · contract dispute · Chicago, IL' },
  { hot: '⚡ Criminal defense · urgent', rest: 'Miami, FL' },
  { rest: 'Real estate · lease dispute · Boston, MA' },
];
function tickerItemsHtml(items) {
  const one = items.map((i) =>
    `<span class="ticker-item">${i.hot ? `<span class="hot">${esc(i.hot)}</span> · ` : ''}${esc(i.rest)}</span>`).join('');
  return one + one; // duplicated for a seamless loop
}
function tickerHtml() {
  return `<div class="ticker" aria-hidden="true"><div class="ticker-track">${tickerItemsHtml(TICKER_DEMO)}</div></div>`;
}
function needToTickerItem(n) {
  const hot = n.urgency === 'high' ? `⚡ ${n.case_type}` : null;
  const bits = [];
  if (!hot) bits.push(n.case_type);
  bits.push(`${n.region}, ${n.state}`);
  if (n.language_pref && n.language_pref !== 'English') bits.push(`🗣 ${n.language_pref}`);
  bits.push(n.pitch_count ? `${n.pitch_count} pitch${n.pitch_count===1?'':'es'}` : timeAgo(n.created_at));
  return { hot, rest: bits.join(' · ') };
}
async function refreshTicker() {
  const track = App.querySelector('.ticker-track');
  if (!track) return;
  try {
    const { results } = await api('/needs/recent', { auth: false });
    if (results && results.length >= 3) { track.innerHTML = tickerItemsHtml(results.map(needToTickerItem)); return; }
  } catch { /* fall through to sample data */ }
  const s = await loadSample();
  if (s.needs && s.needs.length >= 3) track.innerHTML = tickerItemsHtml(s.needs.map(sampleNeedToItem));
}

// Animations that run after the home view is in the DOM.
function initHome() {
  refreshTicker();
  loadFeatured();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = Array.from(App.querySelectorAll('.reveal'));
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('in'));
    App.querySelectorAll('.num[data-to]').forEach((el) => { el.textContent = (+el.dataset.to).toLocaleString() + (el.dataset.suf || ''); });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (e.target.classList.contains('stat')) countUp(e.target.querySelector('.num'));
      io.unobserve(e.target);
    });
  }, { threshold: 0.2 });
  reveals.forEach((el) => io.observe(el));
  // Safety net: if the observer never fires (e.g. 0-height viewport), still
  // show the final stat numbers so they never get stuck at 0.
  setTimeout(() => {
    App.querySelectorAll('.num[data-to]').forEach((el) => {
      if (!el.dataset.done) el.textContent = (+el.dataset.to).toLocaleString() + (el.dataset.suf || '');
    });
  }, 1500);
}
function countUp(el) {
  if (!el || el.dataset.done) return;
  el.dataset.done = '1';
  const to = +el.dataset.to, suf = el.dataset.suf || '', dur = 1100, t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const v = Math.round(to * (1 - Math.pow(1 - p, 3))); // ease-out cubic
    el.textContent = v.toLocaleString() + suf;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function viewHow() {
  return `<div class="wrap wrap-narrow">
    <h1>How LawClaw works</h1>
    <h3>For clients</h3>
    <p class="muted">Finding a lawyer usually means cold-calling firms and repeating your story. LawClaw flips it: you post once, anonymously, and attorneys who actually handle your kind of case reach out to you. You compare pitches side by side and stay completely private until you pick someone.</p>
    <h3>For attorneys</h3>
    <p class="muted">Stop paying for dead-end leads. Browse a live feed of real legal needs filtered by practice area and state. Every account is verified against the state bar before it can pitch. Free accounts get 5 pitches/month; Pro is unlimited.</p>
    <h3>Privacy</h3>
    <p class="muted">Your description is hidden from attorneys until you accept a pitch. Your real name, phone, and email are never shared unless you explicitly choose to share them inside a chat.</p>
    <div class="cta-row" style="margin-top:24px">
      <a class="btn btn-gold" href="#/post">Post a need</a>
      <a class="btn btn-ghost" href="#/signup?role=lawyer">Join as an attorney</a>
    </div>
  </div>`;
}

// ---- Auth views -------------------------------------------------------------
function viewLogin() {
  return `<div class="wrap wrap-narrow">
    <h1>Welcome back</h1>
    <div class="form-card">
      <div id="err"></div>
      <form id="loginForm">
        <div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email" /></div>
        <div class="field"><label>Password</label><input name="password" type="password" required autocomplete="current-password" /></div>
        <button class="btn btn-block" type="submit">Log in</button>
      </form>
    </div>
    <p class="center muted" style="margin-top:16px">No account? <a href="#/signup">Sign up</a></p>
  </div>`;
}

function viewSignup() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const role = params.get('role') === 'lawyer' ? 'lawyer' : 'user';
  return `<div class="wrap wrap-narrow">
    <h1>Create your account</h1>
    <div class="segmented" id="roleSeg">
      <button data-role="user" class="${role==='user'?'active':''}">I need a lawyer</button>
      <button data-role="lawyer" class="${role==='lawyer'?'active':''}">I'm an attorney</button>
    </div>
    <div class="form-card">
      <div id="err"></div>
      <div id="signupBody">${role === 'lawyer' ? lawyerSignupFields() : userSignupFields()}</div>
    </div>
    <p class="center muted" style="margin-top:16px">Already have an account? <a href="#/login">Log in</a></p>
  </div>`;
}
function userSignupFields() {
  return `<form id="userSignup">
    <div class="field"><label>Full name</label><input name="full_name" /></div>
    <div class="field"><label>Email</label><input name="email" type="email" required /></div>
    <div class="field"><label>Password</label><input name="password" type="password" required minlength="8" />
      <div class="hint">At least 8 characters.</div></div>
    <button class="btn btn-block" type="submit">Create account</button>
  </form>`;
}
function lawyerSignupFields() {
  return `<form id="lawyerSignup">
    <div class="row2">
      <div class="field"><label>Name (English)</label><input name="name_en" required /></div>
      <div class="field"><label>Name (中文, optional)</label><input name="name_cn" /></div>
    </div>
    <div class="field"><label>Email</label><input name="email" type="email" required /></div>
    <div class="field"><label>Password</label><input name="password" type="password" required minlength="8" /></div>
    <div class="row2">
      <div class="field"><label>Bar number</label><input name="bar_number" required /></div>
      <div class="field"><label>Bar state</label>${selectHtml('bar_state', STATES, 'NY')}
        <div class="hint">Live verification supported for NY & CA.</div></div>
    </div>
    <div class="row2">
      <div class="field"><label>City</label><input name="city" /></div>
      <div class="field"><label>State</label>${selectHtml('state', STATES, 'NY')}</div>
    </div>
    <div class="field"><label>Specialties</label>${multiHtml('specialties', CASE_TYPES)}
      <div class="hint">Hold ⌘/Ctrl to select multiple.</div></div>
    <div class="field"><label>Languages</label>${multiHtml('languages', LANGS, ['English'])}</div>
    <button class="btn btn-block" type="submit">Verify bar &amp; create account</button>
    <div class="hint" style="margin-top:8px">We check your license with the state bar before activating your account.</div>
  </form>`;
}

// ---- User: post a need ------------------------------------------------------
function viewPost() {
  if (!Store.user) return requireLoginNotice('post a legal need');
  if (isLawyer()) return roleMismatch('This page is for clients. Attorneys browse needs instead.', '#/browse', 'Browse needs');
  return `<div class="wrap wrap-narrow">
    <div id="err"></div>
    <div class="form-card wizard">
      <div class="wiz-progress"><div class="wiz-progress-bar" id="wizBar"></div></div>
      <div class="wiz-meta"><span id="wizStepNum">Step 1 of 4</span> · <span>🔒 Anonymous — no name or contact needed</span></div>
      <form id="needForm">
        <div class="step active" data-step="0">
          <h2 class="step-q">What do you need help with?</h2>
          <input type="hidden" name="case_type" />
          <div class="choice-grid">
            ${CASE_TYPES.map((c) => `<button type="button" class="choice" data-choice="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
        </div>
        <div class="step" data-step="1">
          <h2 class="step-q">Where are you located?</h2>
          <div class="row2">
            <div class="field"><label>State</label>${selectHtml('state', STATES, 'NY')}</div>
            <div class="field"><label>Region / city</label><input name="region" placeholder="e.g. Manhattan" required /></div>
          </div>
        </div>
        <div class="step" data-step="2">
          <h2 class="step-q">Any preferences?</h2>
          <p class="muted" style="margin-top:-8px">Optional — helps us surface attorneys who fit. Skip if you're not sure.</p>
          <div class="field"><label>Preferred language</label>${selectHtml('language_pref', LANGS, 'English')}</div>
          <div class="field"><label>Visa / immigration status</label><input name="visa_status" placeholder="e.g. H-1B, green card, citizen" /></div>
        </div>
        <div class="step" data-step="3">
          <h2 class="step-q">Tell attorneys what's going on</h2>
          <div class="field">
            <textarea name="description" required minlength="20" placeholder="What happened, what you need help with, any deadlines…"></textarea>
            <div class="hint">Don't include your name or contact info — that stays private until you choose to share it.</div>
          </div>
        </div>
        <div class="wiz-foot">
          <button type="button" class="btn btn-ghost" id="wizBack" style="visibility:hidden">← Back</button>
          <button type="button" class="btn" id="wizNext">Next →</button>
          <button type="submit" class="btn btn-gold" id="wizSubmit" style="display:none">Post anonymously</button>
        </div>
      </form>
    </div>
  </div>`;
}

// Drives the multi-step post-a-need wizard.
function wireWizard(form) {
  const steps = Array.from(form.querySelectorAll('.step'));
  const total = steps.length;
  const bar = document.getElementById('wizBar');
  const numEl = document.getElementById('wizStepNum');
  const back = document.getElementById('wizBack');
  const next = document.getElementById('wizNext');
  const submit = document.getElementById('wizSubmit');
  const caseInput = form.elements.case_type;
  let i = 0;

  const show = () => {
    steps.forEach((s, idx) => s.classList.toggle('active', idx === i));
    bar.style.width = `${((i + 1) / total) * 100}%`;
    numEl.textContent = `Step ${i + 1} of ${total}`;
    back.style.visibility = i === 0 ? 'hidden' : 'visible';
    const last = i === total - 1;
    next.style.display = last ? 'none' : '';
    submit.style.display = last ? '' : 'none';
    const focusable = steps[i].querySelector('input:not([type=hidden]), select, textarea');
    if (focusable) setTimeout(() => focusable.focus(), 60);
  };
  const validStep = () => {
    if (i === 0) { if (!caseInput.value) { toast('Pick a case type to continue', 'error'); return false; } return true; }
    const fields = steps[i].querySelectorAll('input, select, textarea');
    for (const f of fields) { if (!f.checkValidity()) { f.reportValidity(); return false; } }
    return true;
  };

  form.querySelectorAll('.choice').forEach((btn) => btn.onclick = () => {
    form.querySelectorAll('.choice').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    caseInput.value = btn.dataset.choice;
    i = Math.min(total - 1, i + 1); show();
  });
  next.onclick = () => { if (validStep()) { i = Math.min(total - 1, i + 1); show(); } };
  back.onclick = () => { i = Math.max(0, i - 1); show(); };
  show();
}

// ---- User: my needs + pitches ----------------------------------------------
async function viewNeeds() {
  if (!Store.user) return requireLoginNotice('view your needs');
  App.innerHTML = `<div class="wrap"><div class="section-title"><h1>My needs</h1><a class="btn btn-gold btn-sm" href="#/post">+ Post a need</a></div>${spinner}</div>`;
  try {
    const { results } = await api('/needs/mine');
    const body = !results?.length
      ? `<div class="empty">You haven't posted anything yet.<br/><a class="btn btn-gold btn-sm" href="#/post" style="margin-top:14px">Post your first need</a></div>`
      : `<div class="list">${results.map(needRow).join('')}</div>`;
    App.querySelector('.wrap').innerHTML = `<div class="section-title"><h1>My needs</h1><a class="btn btn-gold btn-sm" href="#/post">+ Post a need</a></div>${body}`;
  } catch (e) { App.querySelector('.wrap').innerHTML = errBox(e); }
}
function needRow(n) {
  return `<div class="list-item">
    <div class="meta">
      <span class="badge badge-open">${esc(n.case_type)}</span>
      <span class="badge badge-state">${esc(n.state)}</span>
      ${n.urgency === 'high' ? '<span class="badge badge-urgent">⚡ Urgent</span>' : ''}
      <span class="muted" style="font-size:13px">· ${timeAgo(n.created_at)}</span>
    </div>
    <div class="desc">${esc(n.description)}</div>
    <div class="foot">
      <span class="muted">${n.pitch_count || 0} pitch${(n.pitch_count||0)===1?'':'es'} · status: ${esc(n.status)}</span>
      <a class="btn btn-sm" href="#/need/${n.id}">View pitches →</a>
    </div>
  </div>`;
}

async function viewNeedPitches(id) {
  if (!Store.user) return requireLoginNotice('view pitches');
  App.innerHTML = `<div class="wrap">${spinner}</div>`;
  try {
    const { pitches } = await api(`/needs/${id}/pitches`);
    const body = !pitches?.length
      ? `<div class="empty">No pitches yet. Attorneys will appear here as they respond.</div>`
      : `<div class="list">${pitches.map((p) => pitchRow(p, id)).join('')}</div>`;
    App.querySelector('.wrap').innerHTML =
      `<a class="muted" href="#/needs">← My needs</a><h1 style="margin-top:10px">Attorney pitches</h1>${body}`;
  } catch (e) { App.querySelector('.wrap').innerHTML = errBox(e); }
}
function pitchRow(p, needId) {
  const l = p.lawyers || {};
  const accepted = p.status === 'accepted';
  return `<div class="list-item">
    <div class="meta" style="gap:12px">
      <div class="avatar">${esc(l.avatar_initial || (l.name_en||'?')[0])}</div>
      <div>
        <strong>${esc(l.name_en || 'Attorney')}</strong> ${l.bar_verified ? '<span class="badge badge-verified">✅ Verified</span>' : ''}
        <div class="muted" style="font-size:13px">${esc(l.city||'')}${l.city?', ':''}${esc(l.state||'')}
          ${l.rating ? ` · <span class="stars">${stars(l.rating)}</span> ${l.rating} (${l.review_count||0})` : ''}</div>
      </div>
    </div>
    <p class="desc">${esc(p.message)}</p>
    <div class="muted" style="font-size:13px">
      ${p.fee_type ? `Fee: ${esc(p.fee_type)}${p.fee_detail?` — ${esc(p.fee_detail)}`:''}` : ''}
      ${l.free_consult ? ' · Free consult' : ''}
      ${(l.specialties||[]).length ? `<div style="margin-top:6px">${l.specialties.map(s=>`<span class="tag">${esc(s)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="foot">
      <span class="muted">${timeAgo(p.sent_at)}</span>
      ${accepted
        ? `<a class="btn btn-sm" href="#/chats">Open chat →</a>`
        : `<button class="btn btn-gold btn-sm" data-accept="${p.id}">Accept &amp; chat</button>`}
    </div>
  </div>`;
}

// ---- Lawyer: browse needs ---------------------------------------------------
async function viewBrowse(filters = {}) {
  if (!Store.user) return requireLoginNotice('browse legal needs', '#/signup?role=lawyer');
  if (!isLawyer()) return roleMismatch('Browsing needs is for attorneys.', '#/post', 'Post a need instead');
  App.innerHTML = `<div class="wrap"><h1>Open legal needs</h1>${filterBar(filters)}<div id="needsList">${spinner}</div></div>`;
  wireFilters();
  try {
    const qs = new URLSearchParams(Object.entries(filters).filter(([,v]) => v)).toString();
    const { results, total } = await api(`/needs${qs ? '?'+qs : ''}`);
    const list = document.getElementById('needsList');
    if (!list) return;
    list.innerHTML = !results?.length
      ? `<div class="empty">No open needs match your filters right now.</div>`
      : `<p class="muted" style="margin-bottom:14px">${total ?? results.length} open need(s)</p>
         <div class="list">${results.map(browseRow).join('')}</div>`;
  } catch (e) {
    const list = document.getElementById('needsList');
    if (list) list.innerHTML = errBox(e);
  }
}
function filterBar(f) {
  return `<div class="filters">
    ${selectHtml('f_case_type', ['', ...CASE_TYPES], f.case_type || '', 'Any case type')}
    ${selectHtml('f_state', ['', ...STATES], f.state || '', 'Any state')}
    ${selectHtml('f_urgency', ['', 'high', 'normal'], f.urgency || '', 'Any urgency')}
    <input id="f_language" placeholder="Language" value="${esc(f.language||'')}" />
  </div>`;
}
function wireFilters() {
  const apply = () => {
    const f = {
      case_type: val('f_case_type'), state: val('f_state'),
      urgency: val('f_urgency'), language: val('f_language'),
    };
    viewBrowse(f);
  };
  ['f_case_type','f_state','f_urgency'].forEach((id) => { const el = document.getElementById(id); if (el) el.onchange = apply; });
  const lang = document.getElementById('f_language');
  if (lang) lang.onkeydown = (e) => { if (e.key === 'Enter') apply(); };
}
function browseRow(n) {
  return `<div class="list-item">
    <div class="meta">
      <span class="badge badge-open">${esc(n.case_type)}</span>
      <span class="badge badge-state">${esc(n.state)}</span>
      ${n.urgency === 'high' ? '<span class="badge badge-urgent">⚡ Urgent</span>' : ''}
      ${n.language_pref ? `<span class="tag">🗣 ${esc(n.language_pref)}</span>` : ''}
      ${n.visa_status ? `<span class="tag">${esc(n.visa_status)}</span>` : ''}
    </div>
    <div class="desc muted">📍 ${esc(n.region)}, ${esc(n.state)} · Full description unlocks when the client accepts your pitch.</div>
    <div class="foot">
      <span class="muted">${timeAgo(n.created_at)} · ${n.pitch_count || 0} pitch(es)</span>
      <button class="btn btn-gold btn-sm" data-pitch="${n.id}" data-case="${esc(n.case_type)}">Send a pitch</button>
    </div>
  </div>`;
}

// ---- Chats inbox ------------------------------------------------------------
async function viewChats() {
  if (!Store.user) return requireLoginNotice('view your messages');
  App.innerHTML = `<div class="wrap"><h1>Messages</h1>${spinner}</div>`;
  try {
    const { results } = await api('/chats');
    const body = !results?.length
      ? `<div class="empty">No conversations yet.</div>`
      : `<div class="list">${results.map(chatRow).join('')}</div>`;
    App.querySelector('.wrap').innerHTML = `<h1>Messages</h1>${body}`;
  } catch (e) { App.querySelector('.wrap').innerHTML = errBox(e); }
}
function chatRow(c) {
  const l = c.lawyers || {};
  const msgs = c.messages || [];
  const last = msgs[msgs.length - 1];
  const title = isLawyer() ? 'Client' : (l.name_en || 'Attorney');
  return `<div class="list-item" style="cursor:pointer" data-chat="${c.id}">
    <div class="meta" style="gap:12px">
      <div class="avatar">${esc(isLawyer() ? '👤' : (l.avatar_initial || title[0]))}</div>
      <div style="flex:1">
        <strong>${esc(title)}</strong>
        <div class="muted" style="font-size:13px">${last ? esc(last.content).slice(0,80) : 'Conversation opened'}</div>
      </div>
      <span class="muted" style="font-size:12px">${timeAgo(c.last_message_at || c.created_at)}</span>
    </div>
  </div>`;
}

// ---- Lawyer dashboard -------------------------------------------------------
const AVAIL_LABELS = { available: '🟢 Available now', limited: '🟡 Limited availability', next_month: '🔵 Open next month', unavailable: '⚪ Not taking cases' };
async function viewDashboard() {
  if (!Store.user) return requireLoginNotice('view your dashboard', '#/signup?role=lawyer');
  if (!isLawyer()) return roleMismatch('The dashboard is for attorneys.', '#/needs', 'Go to my needs');
  App.innerHTML = `<div class="wrap"><h1>Dashboard</h1>${spinner}</div>`;
  try {
    const [me, mine] = await Promise.all([api('/lawyers/me'), api('/pitches/mine')]);
    App.querySelector('.wrap').innerHTML = dashboardHtml(me, mine.pitches || []);
    const sel = document.getElementById('availSelect');
    if (sel) sel.onchange = async () => {
      try { await api('/lawyers/me/availability', { method: 'PUT', body: { availability: sel.value } }); toast('Availability updated', 'ok'); }
      catch (e) { toast(e.message, 'error'); }
    };
  } catch (e) { App.querySelector('.wrap').innerHTML = `<h1>Dashboard</h1>${errBox(e)}`; }
}
function dashboardHtml(me, pitches) {
  const accepted = pitches.filter((p) => p.status === 'accepted').length;
  const quota = me.subscription_active
    ? '<span class="num">∞</span><div class="lbl">Pro — unlimited pitches</div>'
    : `<span class="num">${me.pitches_used || 0}<span class="suf">/${me.pitches_limit || 0}</span></span><div class="lbl">Pitches used this month</div>`;
  const options = Object.entries(AVAIL_LABELS)
    .map(([v, lbl]) => `<option value="${v}" ${me.availability === v ? 'selected' : ''}>${esc(lbl)}</option>`).join('');
  const list = !pitches.length
    ? `<div class="empty">You haven't pitched on any needs yet.<br/><a class="btn btn-gold btn-sm" href="#/browse" style="margin-top:14px">Browse open needs</a></div>`
    : `<div class="list">${pitches.map(pitchMineRow).join('')}</div>`;
  return `
    <div class="section-title"><h1>Dashboard</h1><a class="btn btn-gold btn-sm" href="#/browse">+ Find needs to pitch</a></div>
    <div class="dash-head">
      <div class="avatar">${esc(me.avatar_initial || (me.name_en || '?')[0])}</div>
      <div style="flex:1">
        <strong style="font-size:18px">${esc(me.name_en)}</strong>${me.name_cn ? ` <span class="muted">${esc(me.name_cn)}</span>` : ''}
        ${me.bar_verified ? ' <span class="badge badge-verified">✅ Verified</span>' : ''}
        <div class="muted" style="font-size:13px">${esc(me.city || '')}${me.city ? ', ' : ''}${esc(me.state || '')} · ${esc(me.bar_state)} #${esc(me.bar_number)}</div>
      </div>
    </div>
    <div class="stats" style="margin-top:18px">
      <div class="stat">${quota}</div>
      <div class="stat"><span class="num">${pitches.length}</span><div class="lbl">Total pitches sent</div></div>
      <div class="stat"><span class="num">${accepted}</span><div class="lbl">Accepted &amp; in chat</div></div>
      <div class="stat"><span class="num">${me.rating || 0}<span class="suf">★</span></span><div class="lbl">${me.review_count || 0} reviews</div></div>
    </div>
    <div class="form-card" style="margin:8px 0 24px">
      <label style="font-weight:600;font-size:14px;display:block;margin-bottom:8px">Your availability (shown to clients)</label>
      <select id="availSelect">${options}</select>
    </div>
    <h2 style="margin-bottom:14px">Your pitches</h2>
    ${list}`;
}
function pitchMineRow(p) {
  const n = p.needs || {};
  const statusBadge = { pending: 'badge-open', accepted: 'badge-verified', declined: 'badge-urgent' }[p.status] || 'badge-open';
  return `<div class="list-item">
    <div class="meta">
      <span class="badge badge-open">${esc(n.case_type || 'Case')}</span>
      ${n.state ? `<span class="badge badge-state">${esc(n.region ? n.region + ', ' : '')}${esc(n.state)}</span>` : ''}
      <span class="badge ${statusBadge}">${esc(p.status)}</span>
      <span class="muted" style="font-size:13px">· ${timeAgo(p.sent_at)}</span>
    </div>
    <p class="desc">${esc(p.message)}</p>
    <div class="foot">
      <span class="muted">${p.fee_type ? esc(p.fee_type) : ''}${p.fee_detail ? ` — ${esc(p.fee_detail)}` : ''}</span>
      ${p.status === 'accepted' && p.chat_id ? `<a class="btn btn-sm" href="#/chat/${p.chat_id}">Open chat →</a>` : ''}
    </div>
  </div>`;
}

// ---- Chat detail ------------------------------------------------------------
let chatPoll = null;
async function viewChat(id) {
  if (!Store.user) return requireLoginNotice('open this chat');
  App.innerHTML = `<div class="wrap">${spinner}</div>`;
  let payload;
  try { payload = await api(`/chats/${id}`); }
  catch (e) { App.querySelector('.wrap').innerHTML = errBox(e); return; }

  const { chat, need } = payload;
  const lawyerName = need && need.user_real_name ? '' : '';
  const canShare = isUser() && !chat.identity_shared;
  App.innerHTML = `<div class="wrap">
    <a class="muted" href="#/chats">← Messages</a>
    <div class="chat-shell" style="margin-top:10px">
      <div class="chat-head">
        <div class="avatar">${esc(isLawyer() ? '👤' : '⚖️')}</div>
        <div style="flex:1">
          <strong>${esc(need?.case_type || 'Conversation')}</strong>
          <div class="muted" style="font-size:13px">${esc(need?.region || '')}${need?.state?`, ${esc(need.state)}`:''} · ${chat.identity_shared ? 'Contact shared' : 'Anonymous'}</div>
        </div>
        ${canShare ? '<button class="btn btn-ghost btn-sm" id="shareBtn">Share my contact</button>' : ''}
      </div>
      <div class="chat-body" id="chatBody"></div>
      <form class="chat-input" id="msgForm" ${chat.status!=='active'?'style="display:none"':''}>
        <input name="content" placeholder="Type a message…" autocomplete="off" required />
        <button class="btn" type="submit">Send</button>
      </form>
    </div>
  </div>`;

  const bodyEl = document.getElementById('chatBody');
  const renderMsgs = (messages) => {
    bodyEl.innerHTML = messages.map(renderMsg).join('');
    bodyEl.scrollTop = bodyEl.scrollHeight;
  };
  renderMsgs(payload.messages || []);

  document.getElementById('msgForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.content;
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    try {
      await api(`/chats/${id}/messages`, { method: 'POST', body: { content } });
      const { messages } = await api(`/chats/${id}`);
      renderMsgs(messages);
    } catch (err) { toast(err.message, 'error'); input.value = content; }
  });

  document.getElementById('shareBtn')?.addEventListener('click', () => shareIdentity(id));

  // Poll for new messages every 4s while on this view.
  clearInterval(chatPoll);
  chatPoll = setInterval(async () => {
    if (!location.hash.startsWith('#/chat/')) { clearInterval(chatPoll); return; }
    try { const { messages } = await api(`/chats/${id}`); renderMsgs(messages); } catch { /* ignore */ }
  }, 4000);
}
function renderMsg(m) {
  if (m.sender_type === 'system') return `<div class="msg system">${esc(m.content)}</div>`;
  const mine = (m.sender_type === 'lawyer') === isLawyer();
  return `<div class="msg ${mine ? 'me' : 'them'}">${esc(m.content)}<span class="ts">${timeAgo(m.sent_at)}</span></div>`;
}

async function shareIdentity(chatId) {
  const name = prompt('Your name to share with the attorney:');
  if (!name) return;
  const contact = prompt('A phone or email so they can reach you:');
  if (!contact) return;
  const isEmail = contact.includes('@');
  try {
    await api(`/chats/${chatId}/share-identity`, {
      method: 'POST',
      body: { name, email: isEmail ? contact : undefined, phone: isEmail ? undefined : contact },
    });
    toast('Contact shared with the attorney', 'ok');
    viewChat(chatId);
  } catch (e) { toast(e.message, 'error'); }
}

// ============================================================================
// Shared partials & helpers
// ============================================================================
function selectHtml(name, opts, selected = '', placeholder = '') {
  const options = opts.map((o) => {
    const v = o, label = o || placeholder || '—';
    return `<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(label)}</option>`;
  }).join('');
  return `<select name="${name}" id="${name}">${options}</select>`;
}
function multiHtml(name, opts, selected = []) {
  const options = opts.map((o) => `<option value="${esc(o)}" ${selected.includes(o)?'selected':''}>${esc(o)}</option>`).join('');
  return `<select name="${name}" id="${name}" multiple size="5">${options}</select>`;
}
const val = (id) => document.getElementById(id)?.value || '';
const errBox = (e) => `<div class="alert alert-error">${esc(e.message || 'Something went wrong')}</div>`;
function requireLoginNotice(action, signupHash = '#/signup') {
  return `<div class="wrap wrap-narrow"><div class="alert alert-info">Please log in to ${esc(action)}.</div>
    <div class="cta-row"><a class="btn" href="#/login">Log in</a><a class="btn btn-ghost" href="${signupHash}">Sign up</a></div></div>`;
}
function roleMismatch(msg, hash, label) {
  return `<div class="wrap wrap-narrow"><div class="alert alert-info">${esc(msg)}</div>
    <a class="btn" href="${hash}">${esc(label)}</a></div>`;
}
function fieldsToObj(form) {
  const fd = new FormData(form);
  const obj = {};
  for (const [k, v] of fd.entries()) {
    if (form.elements[k]?.multiple) continue; // handled below
    obj[k] = v;
  }
  // multi-selects
  Array.from(form.querySelectorAll('select[multiple]')).forEach((sel) => {
    obj[sel.name] = Array.from(sel.selectedOptions).map((o) => o.value);
  });
  return obj;
}

// ============================================================================
// Form wiring (runs after a view is injected)
// ============================================================================
function wireForms() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const b = fieldsToObj(loginForm);
    setBusy(loginForm, true);
    try {
      const data = await api('/auth/login', { method: 'POST', auth: false, body: b });
      Store.set(data); renderNav(); toast('Welcome back', 'ok');
      go(isLawyer() ? '#/browse' : '#/needs');
    } catch (err) { showErr(err); } finally { setBusy(loginForm, false); }
  };

  const roleSeg = document.getElementById('roleSeg');
  if (roleSeg) roleSeg.querySelectorAll('button').forEach((b) => b.onclick = () => {
    go(`#/signup?role=${b.dataset.role}`);
  });

  const us = document.getElementById('userSignup');
  if (us) us.onsubmit = async (e) => {
    e.preventDefault();
    const b = fieldsToObj(us);
    setBusy(us, true);
    try {
      await api('/auth/signup/user', { method: 'POST', auth: false, body: b });
      const data = await api('/auth/login', { method: 'POST', auth: false, body: { email: b.email, password: b.password } });
      Store.set(data); renderNav(); toast('Account created', 'ok'); go('#/post');
    } catch (err) { showErr(err); } finally { setBusy(us, false); }
  };

  const ls = document.getElementById('lawyerSignup');
  if (ls) ls.onsubmit = async (e) => {
    e.preventDefault();
    const b = fieldsToObj(ls);
    setBusy(ls, true, 'Verifying bar license…');
    try {
      await api('/auth/signup/lawyer', { method: 'POST', auth: false, body: b });
      const data = await api('/auth/login', { method: 'POST', auth: false, body: { email: b.email, password: b.password } });
      Store.set(data); renderNav(); toast('Verified! Welcome to LawClaw', 'ok'); go('#/browse');
    } catch (err) { showErr(err); } finally { setBusy(ls, false); }
  };

  const needForm = document.getElementById('needForm');
  if (needForm) {
    needForm.onsubmit = async (e) => {
      e.preventDefault();
      const b = fieldsToObj(needForm);
      setBusy(needForm, true);
      try {
        await api('/needs', { method: 'POST', body: b });
        toast('Posted anonymously', 'ok'); go('#/needs');
      } catch (err) { showErr(err); } finally { setBusy(needForm, false); }
    };
    wireWizard(needForm);
  }
}
function setBusy(form, busy, label) {
  const btn = form.querySelector('button[type="submit"]');
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Working…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}
function showErr(err) {
  const box = document.getElementById('err');
  if (box) box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  else toast(err.message, 'error');
}

// ============================================================================
// Click delegation (accept pitch / send pitch / open chat)
// ============================================================================
App.addEventListener('click', async (e) => {
  const accept = e.target.closest('[data-accept]');
  if (accept) {
    accept.disabled = true;
    try {
      const { chat_id } = await api(`/pitches/${accept.dataset.accept}/accept`, { method: 'POST' });
      toast('Chat opened', 'ok'); go(`#/chat/${chat_id}`);
    } catch (err) { toast(err.message, 'error'); accept.disabled = false; }
    return;
  }
  const pitch = e.target.closest('[data-pitch]');
  if (pitch) { openPitchModal(pitch.dataset.pitch, pitch.dataset.case); return; }

  const chat = e.target.closest('[data-chat]');
  if (chat) { go(`#/chat/${chat.dataset.chat}`); return; }
});

function openPitchModal(needId, caseType) {
  const msg = prompt(`Pitch for this ${caseType || 'case'} (min 20 chars).\nIntroduce yourself, your approach, and fees:`);
  if (msg == null) return;
  if (msg.trim().length < 20) { toast('Pitch must be at least 20 characters', 'error'); return; }
  api(`/needs/${needId}/pitch`, { method: 'POST', body: { message: msg.trim() } })
    .then((r) => toast(r.message || 'Pitch sent', 'ok'))
    .catch((err) => toast(err.message, 'error'));
}

// ============================================================================
// Router
// ============================================================================
function router() {
  clearInterval(chatPoll);
  window.scrollTo(0, 0);
  const raw = (location.hash || '#/').slice(1);
  const path = raw.split('?')[0];
  const [, seg1, seg2] = path.split('/');

  renderNav();

  // Async views manage their own innerHTML; sync views return a string.
  if (seg1 === 'need' && seg2)  return viewNeedPitches(seg2);
  if (seg1 === 'chat' && seg2)  return viewChat(seg2);

  const sync = {
    '': viewHome, 'how': viewHow, 'login': viewLogin, 'signup': viewSignup, 'post': viewPost,
  };
  const asyncViews = { 'needs': viewNeeds, 'browse': () => viewBrowse(), 'chats': viewChats, 'dashboard': viewDashboard };

  if (asyncViews[seg1]) { asyncViews[seg1](); return; }
  const render = sync[seg1] || viewHome;
  App.innerHTML = render();
  wireForms();
  if (render === viewHome) initHome();
}

// ---- Theme (dark mode) ------------------------------------------------------
// Dark is the default; light is an explicit opt-in (data-theme="light").
function effectiveTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
function applyTheme(t) {
  if (t === 'light') document.documentElement.dataset.theme = 'light';
  else document.documentElement.removeAttribute('data-theme');
}
function paintThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = effectiveTheme() === 'dark' ? '☀️' : '🌙';
}
function initTheme() {
  applyTheme(localStorage.getItem('lc_theme'));
  paintThemeToggle();
  const btn = document.getElementById('themeToggle');
  if (btn) btn.onclick = () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('lc_theme', next);
    paintThemeToggle();
  };
}

// ---- Micro-interactions (desktop, motion-safe) ------------------------------
function initMicro() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!matchMedia('(pointer: fine)').matches) return;

  let magnet = null, tilt = null;
  document.addEventListener('pointermove', (e) => {
    // magnetic buttons
    const btn = e.target.closest && e.target.closest('.btn');
    if (btn) {
      const r = btn.getBoundingClientRect();
      const mx = e.clientX - (r.left + r.width / 2);
      const my = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${mx * 0.22}px, ${my * 0.32}px)`;
      magnet = btn;
    } else if (magnet) { magnet.style.transform = ''; magnet = null; }

    // 3D card tilt
    const card = e.target.closest && e.target.closest('.card.lift');
    if (card) {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(820px) rotateX(${-py * 5}deg) rotateY(${px * 6}deg) translateY(-4px)`;
      tilt = card;
    } else if (tilt) { tilt.style.transform = ''; tilt = null; }
  });

  // claw-gold cursor glow that trails the pointer
  const glow = document.createElement('div');
  glow.className = 'cursor-glow';
  document.body.appendChild(glow);
  let cx = -100, cy = -100, tx = -100, ty = -100;
  document.addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; });
  (function loop() {
    cx += (tx - cx) * 0.18; cy += (ty - cy) * 0.18;
    glow.style.transform = `translate(${cx - 13}px, ${cy - 13}px)`;
    requestAnimationFrame(loop);
  })();
}

initTheme();
initMicro();
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);
router();

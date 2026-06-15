# 🐾 LawClaw

Anonymous legal matchmaking. Clients post a legal need **anonymously**; bar-verified
U.S. attorneys pitch them; the client picks one and opens a private chat — and only
shares their identity when *they* decide to.

This repo is a single Node/Express service that exposes a JSON API **and** serves the
website (a vanilla-JS single-page app in [`public/`](public/)). State lives in Supabase.

---

## Stack

| Layer     | Tech                                              |
|-----------|---------------------------------------------------|
| Backend   | Node ≥18, Express, Helmet, rate-limiting          |
| Database  | Supabase (Postgres + Auth + Realtime)             |
| Email     | Nodemailer (optional)                             |
| Frontend  | Static HTML/CSS/JS in `public/`, hash-routed SPA  |
| Hosting   | Railway (`railway.json`, NIXPACKS)                |

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env        # then fill in your Supabase keys

# 3. Create the database
#    Open the Supabase SQL editor and run the contents of schema.sql

# 4. Run
npm run dev                 # nodemon, auto-reload
# or
npm start
```

Then open <http://localhost:3001> for the website. Health check: `GET /health`.

### Required environment variables

Only Supabase is mandatory — see [`.env.example`](.env.example). If email vars are
omitted, notification emails are silently skipped (the app still works).

| Var                    | Required | Notes                                            |
|------------------------|----------|--------------------------------------------------|
| `SUPABASE_URL`         | ✅        | Project URL                                      |
| `SUPABASE_SERVICE_KEY` | ✅        | **Service role** key (bypasses RLS, server-only) |
| `EMAIL_HOST/USER/PASS` | –        | SMTP for notifications                           |
| `FROM_EMAIL`           | –        | Sender address                                   |
| `FRONTEND_URL`         | –        | Used in emails + CORS allowlist                  |
| `PORT`                 | –        | Defaults to `3001`                               |

---

## Database

[`schema.sql`](schema.sql) creates every table the API uses (`profiles`, `lawyers`,
`needs`, `pitches`, `chats`, `messages`, `reviews`), plus:

- a trigger mirroring `auth.users` → `profiles` on signup,
- triggers that keep `chats.last_message_at` and lawyer `rating`/`review_count` fresh,
- an `increment_pitch_count()` RPC for atomic counter updates,
- **row-level security** policies so the anon/realtime client can only touch rows the
  user owns. (The API itself uses the service-role key and bypasses RLS.)

Run it once on a fresh project via the Supabase SQL editor.

### Sample data

`public/sample-data.json` is a shared demo library (12 bilingual attorneys, sample
clients, 16 anonymized needs, and pitches). It powers two things:

- The homepage **Featured attorneys** section and the live ticker's fallback, so the
  site looks populated even before any real data exists (no DB needed).
- The seeder. Run it to populate Supabase with real, loginable demo accounts:

  ```bash
  npm run seed
  ```

  It's idempotent (re-running updates lawyers and replaces demo needs/pitches). All
  demo accounts share the `defaultPassword` from the JSON — log in as
  `wei.chen@demo.lawclaw.club` (lawyer) or `client.a@demo.lawclaw.club` (client).

---

## How it works

```
Client posts need ──► Attorneys browse (anonymized) ──► Attorney sends pitch
       ▲                                                        │
       │                                                        ▼
   shares contact ◄── private chat opens ◄──────── client accepts a pitch
   (only if they                                                │
    choose to)                                                  ▼
                                              client reviews the attorney
```

**Privacy levels** (`sanitizeNeed` in `server.js`):

- `public` — case type, region, state, language only. What browsing attorneys see.
- `matched` — adds the full description. Unlocked when the client accepts a pitch.
- `unlocked` — adds real name/phone/email. Only after the client shares identity.

**Bar verification** — at lawyer signup the license is checked live against the state
bar (NY via the OCA open-data API, CA by scraping the State Bar profile page). Accounts
with an inactive license or discipline history are rejected. Other states aren't
supported yet.

---

## API reference

All `/api/*` routes return JSON. Authenticated routes need
`Authorization: Bearer <access_token>` (the token from `POST /api/auth/login`).

### Auth
| Method | Path                       | Auth | Body                                   |
|--------|----------------------------|------|----------------------------------------|
| POST   | `/api/auth/signup/user`    | –    | `email, password, full_name`           |
| POST   | `/api/auth/signup/lawyer`  | –    | `email, password, name_en, bar_number, bar_state, …` |
| POST   | `/api/auth/login`          | –    | `email, password` → `{ token, user }`  |

### Needs
| Method | Path                  | Auth   | Notes                              |
|--------|-----------------------|--------|------------------------------------|
| POST   | `/api/needs`          | user   | Post an anonymous need             |
| GET    | `/api/needs`          | lawyer | Browse open needs (filters: `state, case_type, language, urgency, page, limit`) |
| GET    | `/api/needs/mine`     | user   | Your own needs                     |

### Pitches & chat
| Method | Path                          | Auth   | Notes                          |
|--------|-------------------------------|--------|--------------------------------|
| POST   | `/api/needs/:id/pitch`        | lawyer | Send a pitch (quota-limited)   |
| GET    | `/api/needs/:id/pitches`      | user   | Pitches on your need           |
| POST   | `/api/pitches/:id/accept`     | user   | Accept → opens a chat          |
| GET    | `/api/chats`                  | auth   | Your conversations             |
| GET    | `/api/chats/:id`              | auth   | Chat + messages + need preview |
| POST   | `/api/chats/:id/messages`     | auth   | Send a message                 |
| POST   | `/api/chats/:id/share-identity` | user | Reveal contact info            |
| POST   | `/api/chats/:id/review`       | user   | Rate the attorney (1–5)        |

### Lawyers & verification
| Method | Path                            | Auth   | Notes                                  |
|--------|---------------------------------|--------|----------------------------------------|
| GET    | `/api/lawyers/me`               | lawyer | Own profile + remaining pitch quota    |
| GET    | `/api/pitches/mine`             | lawyer | Own pitches (with need context)        |
| GET    | `/api/lawyers/:id`              | –      | Public profile                         |
| PUT    | `/api/lawyers/me/availability`  | lawyer | Update availability                    |
| GET    | `/api/verify/:state/:barNumber` | –      | Check a bar license                    |

> **Social share image:** `public/og-image.svg` is referenced by the Open Graph /
> Twitter meta tags. Most social scrapers don't render SVG — for full compatibility
> convert it to a 1200×630 PNG and point the `og:image`/`twitter:image` tags at it:
> `rsvg-convert -w 1200 -h 630 public/og-image.svg > public/og-image.png`

---

## Deployment (Railway)

`railway.json` builds with NIXPACKS and runs `node server.js`. Set the env vars in the
Railway dashboard, run `schema.sql` against your Supabase project once, and point your
domain at the service. The same service serves both the API and the website.

---

## Project layout

```
server.js        Express API + static file server
schema.sql       Supabase tables, triggers, RLS
seed.js          Demo-data seeder (npm run seed)
public/          Website (SPA)
  index.html     Shell, nav, footer
  styles.css     Theme (light + dark)
  app.js         Router + views + API client
  logo.svg       Claw-scratch logo
  sample-data.json  Shared demo library (seeder + frontend)
.env.example     Environment template
railway.json     Deploy config
```

---

## Disclaimer

LawClaw is not a law firm and does not provide legal advice. All legal advice is
provided by independent, licensed attorneys. Using LawClaw does not create an
attorney–client relationship.

# aretay-web

The unified Aretay web project. One Next.js 16 app that serves:

- **Public marketing + legal pages** at `aretay.ai` (`/`, `/privacy.html`, `/support.html`) — plain static HTML in `public/`, no auth.
- **A local-only admin studio** at `/admin` for AI course generation and per-script video production.

It also vendors the **Supabase backend** (`supabase/` — migrations + Edge Functions) so the database and the tools that fill it live in one repo.

## Structure

| Path | Purpose |
|------|---------|
| `public/index.html`, `public/privacy.html`, `public/support.html` | Static marketing/legal pages (App Store registers `https://aretay.ai/privacy.html` + `/support.html`) |
| `app/admin/**` | Admin studio UI (course list, new course, studio) |
| `app/api/**` | Admin generation + CRUD API routes |
| `proxy.ts` | Gates `/admin` and `/api/*` to local-only (returns 404 unless `ADMIN_ENABLED=true`) |
| `lib/`, `remotion/`, `scripts/` | Generation pipeline, Remotion compositions, one-off scripts |
| `supabase/` | Postgres migrations, Edge Functions, `config.toml` |
| `.github/workflows/deploy-migrations.yml` | Pushes DB migrations to prod on merge to `main` |

## The admin is local-only

The admin studio depends on tools that cannot run on serverless hosting (the `whisper.cpp` binary, `ffmpeg`, Remotion rendering, long-running bulk jobs). It is therefore gated behind an env flag instead of auth:

- `proxy.ts` returns **404** for `/admin` and `/api/*` unless `process.env.ADMIN_ENABLED === "true"`.
- `ADMIN_ENABLED=true` is set in `.env.local` (gitignored) and exported by `run-admin.sh`, so it is only on when you run the app on your machine.
- The deployed site **must leave `ADMIN_ENABLED` unset**, so the public domain only ever exposes the marketing pages.

No login is needed because the admin surface simply does not exist in production.

## Run locally

```bash
./run-admin.sh          # installs deps if needed, starts at http://localhost:3001/admin
npm run studio          # Remotion Studio for composition dev
```

Set `.env.local` (gitignored):

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SECRET_KEY` | Service role key (bypasses RLS for admin writes) |
| `SUPABASE_ADMIN_OWNER_ID` | UUID of the auth user who owns seeded courses |
| `OPENROUTER_API_KEY` | Curriculum / prompts / images |
| `REPLICATE_API_TOKEN` | Kokoro TTS + Seedance video |
| `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` | Cloudflare R2 media storage |
| `ADMIN_ENABLED` | `true` to unlock `/admin` locally; leave unset in production |

## Supabase backend

```bash
./run-backend.sh start     # boot local Supabase stack in Docker
./run-backend.sh keys      # print SUPABASE_URL + ANON_KEY
./run-backend.sh new <name># new timestamped migration
./run-backend.sh push      # push migrations to linked prod project
```

Edge Function secrets (`supabase/functions/.env`, gitignored): `GEMINI_API_KEY`, etc.

## Deploy

- Connect this repo to a Next.js host (e.g. Vercel) with the repo root as the project root.
- Set the Supabase / R2 / OpenRouter / Replicate env vars on the host, but **do not set `ADMIN_ENABLED`**.
- Point `aretay.ai` at the deployment. `/`, `/privacy.html`, and `/support.html` serve the marketing site; `/admin` and `/api/*` return 404.
- Database migrations deploy independently via `.github/workflows/deploy-migrations.yml` on merge to `main`.

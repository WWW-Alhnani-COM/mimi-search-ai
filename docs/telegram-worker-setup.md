# Telegram discovery and worker setup

This branch adds a queue-backed worker. It does not start automatically until the database migration, Vercel environment variables, and Supabase Cron secret are configured.

## 1. Vercel environment variables

Keep all secrets server-side; do not prefix them with `NEXT_PUBLIC_`.

Required for the worker:
- `SUPABASE_SECRET_KEY`
- `TELEGRAM_WORKER_SECRET` — a long random secret; use the exact same value in Supabase Vault.
- Existing Telegram variables: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_ENCRYPTION_KEY`.

Optional public-channel discovery:
- `TELEGRAM_DISCOVERY_SEARCH_ENABLED=true`
- `TAVILY_API_KEY`
- `TAVILY_FREE_PLAN_ONLY_CONFIRMED=true`

The Tavily free Researcher plan currently includes 1,000 credits per month without a credit card. This implementation uses Basic Search (1 credit per request) and enforces a stricter shared ceiling of 900 requests per UTC month. Use a free Researcher key and do not enable Pay-as-you-go. The confirmation variable is an explicit operator attestation; the application cannot inspect the billing plan attached to a Tavily key.

If the provider is not configured, discovery remains disabled and no search request is sent.

## 2. Optional Gemini enhancement

Gemini is disabled by default. To permit its use, configure:
- `GEMINI_API_KEY`
- `GEMINI_FREE_TIER_ONLY=true`
- `GEMINI_BILLING_DISABLED_CONFIRMED=true`

Use a Google AI Studio project with no billing account attached. The code allowlists only `gemini-2.5-flash-lite` and `gemini-2.5-flash`, sends no Google Search Grounding requests, and enforces a workspace daily request cap (maximum 100). If either confirmation flag is missing, Gemini is not called and deterministic local analysis remains active. The confirmation flag cannot independently verify the billing state of the Google project.

## 3. Supabase worker schedule

After applying the migration, edit `supabase/telegram-worker-cron-setup.sql`:
- Replace `YOUR-VERCEL-DOMAIN` with the deployed Vercel domain.
- Replace the secret placeholder with the same value as `TELEGRAM_WORKER_SECRET`.

Run that SQL in the Supabase SQL Editor. It stores the URL and worker secret in Vault and schedules the worker endpoint once per minute through pg_cron and pg_net. Do not put the worker secret in frontend code or a committed file.

## 4. Operating behavior

- The worker claims one bounded task per invocation.
- Discovery searches one include rule per task and continues through the queue.
- Collection fetches at most 20 public posts per task, persists a message cursor, and queues another page when needed.
- Only approved channels can be collected.
- Periodic collection requires the per-channel collection toggle to be enabled.
- Telegram sessions are read from the existing encrypted session vault; this change does not rewrite or replace them.
- Telegram collection is read-only: no channel joins, messages, reactions, or participant scraping.
- New Telegram posts are queued for deterministic lead classification. Gemini is optional and fail-closed.

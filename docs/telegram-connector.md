# Telegram public connector

## Scope

Mimi Search AI uses Telegram MTProto to search **public channel posts** only. It does not join channels, access private chats/groups, scrape member lists, send messages, or initiate paid search.

The search provider calls Telegram's global public-post search method `channels.searchPosts`. Telegram may limit free full-text search slots; the connector deliberately omits `allowPaidStars` and fails closed if Telegram reports that payment is required.

## Library and API credentials

- Pinned dependency: `teleproto@1.233.0`.
- Create `api_id` and `api_hash` at [my.telegram.org](https://my.telegram.org) → API development tools.
- Official instructions: https://core.telegram.org/api/obtaining_api_id
- Never expose API credentials through a `NEXT_PUBLIC_` environment variable.

## Connect through the Mimi web app

1. Sign in to Mimi Search AI.
2. Open **مصادر البيانات · Telegram** from the dashboard, or visit `/settings/connections/telegram`.
3. Select a workspace where your role is owner or admin.
4. Enter the phone number in international E.164 format and request a code.
5. Enter the code received from Telegram. If Telegram asks for two-step verification, enter the 2FA password in the second field.
6. After authorization, use the public-post search box to test a phrase.

The login code and 2FA password are used only for the current request and are not stored. The transient MTProto session and phone-code hash are encrypted with AES-256-GCM before they are written to the short-lived `telegram_auth_attempts` table. Attempts expire after ten minutes and are limited to five code/password attempts. The final session is encrypted again and stored in `private.source_connection_secrets`.

The browser receives only the attempt ID, connection ID, connection status, and public search results. It never receives the raw session, ciphertext, API hash, or encryption key.

## Server configuration

The Vercel server environment requires:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_ENCRYPTION_KEY`: base64 encoding of exactly 32 cryptographically random bytes.
- `SUPABASE_SECRET_KEY`: server-only Supabase secret key used by trusted server routes.
- `NEXT_PUBLIC_SUPABASE_URL` and the existing publishable key for the authenticated cookie client.

The Telegram values and Supabase secret key must not use a `NEXT_PUBLIC_` prefix. Never commit, paste into chat, or log API credentials, encryption keys, login codes, 2FA passwords, or raw sessions.

## Database security

- `public.telegram_auth_attempts` has RLS enabled and no table privileges for `anon` or `authenticated`; only `service_role` can access it.
- `private.source_connection_secrets` remains outside the exposed schema.
- The public RPC bridge `store_telegram_session` / `read_telegram_session` is executable only by `service_role` and checks the JWT role before touching the private vault.
- Each route validates the authenticated Supabase user and owner/admin membership in the selected workspace. It does not trust a user ID supplied by the browser.

## Search provider

`src/lib/telegram/public-search.ts` exports `searchTelegramPublicPosts(sessionString, { query, limit })`.

- Limit is clamped to 1–50; query length is 2–128 characters.
- Only results with a stable public `t.me/<username>/<message-id>` permalink are returned.
- Search output contains public channel title, permalink, post text, publication time, and channel/message identifiers.
- Paid search is never enabled. A Telegram payment-required response is returned as a blocked search, not purchased.

## Current implementation boundary

Implemented on `feature/telegram-public-connector`:
- Encrypted Telegram login flow, including code and optional 2FA.
- Short-lived encrypted pending-auth storage and restricted private session vault.
- Authenticated workspace settings UI and dashboard navigation.
- Public channel-post search endpoint and test UI.

Not yet verified:
- No real Telegram account has been connected through the web flow.
- No real public-post search has been run.
- Search results are returned for testing but are not yet persisted into `collection_runs`, `source_items`, or converted into leads.
- Automated CI for the latest commits is still running; do not treat the connector as production-ready until it passes and an authorized account test is completed.

The pull request remains Draft and is not merged or deployed to Production.

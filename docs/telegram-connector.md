# Telegram public connector

## Scope

This connector uses Telegram MTProto to search **public channel posts**. It does not join channels, access private chats/groups, scrape member lists, send messages, or initiate paid search.

The first implementation calls Telegram's global public-post search method `channels.searchPosts`. Telegram may limit free full-text search slots; the connector deliberately omits `allowPaidStars` and fails closed if Telegram reports that payment is required.

## Library

Use `teleproto@1.233.0`, not the archived `telegram` (GramJS) package. teleproto is the actively maintained GramJS fork and includes TypeScript declarations.

## Create Telegram API credentials

1. Sign in to [my.telegram.org](https://my.telegram.org) using the Telegram account that will authorize Mimi Search AI.
2. Open **API development tools** and create an application.
3. Keep `api_id` and especially `api_hash` private.
4. Add the values to a local, untracked environment file. Never use a `NEXT_PUBLIC_` prefix.

Telegram's official instructions: https://core.telegram.org/api/obtaining_api_id

## Generate an encrypted user session

Set these local environment variables:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_ENCRYPTION_KEY`: base64 encoding of exactly 32 cryptographically random bytes.

Generate a key locally (do not commit or send it):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

After installing dependencies, run:

```bash
node scripts/telegram/create-session.mjs
```

Complete Telegram's login-code and, if enabled, two-step verification prompts. The script prints an AES-256-GCM encrypted payload only; it does not print the plaintext session. The encrypted payload is intended for `private.source_connection_secrets.secret_payload_ciphertext` with key version `v1`.

**Do not paste the API hash, encryption key, login code, 2FA password, or raw session into chat, GitHub, browser storage, or logs.** A Telegram session is a full account credential. Anyone with the decrypted session can control that Telegram login.

The current script only generates the encrypted payload locally. It does not yet write the payload to Supabase. A trusted server-side persistence operation and key-rotation procedure must be completed before using the session for scheduled collection.

## Search provider

`src/lib/telegram/public-search.ts` exports `searchTelegramPublicPosts(sessionString, { query, limit })`.

- Limit is clamped to 1–50.
- Search terms must be 2–128 characters.
- Only results with a stable public `t.me/<username>/<message-id>` permalink are returned.
- The normalizer stores the channel title, public URL, post text, publication time, and channel/message identifiers.
- No personal profile or channel-member harvesting is performed.

## Current implementation boundary

Implemented in this branch:
- Pinned maintained MTProto dependency.
- Public-post search provider and normalized output.
- Local authorization bootstrap with encrypted session output.
- Server-only environment variable documentation.

Still required before production use:
- A trusted server endpoint/worker to decrypt the session only in memory and store encrypted session payloads.
- A database persistence adapter for `collection_runs` and `source_items`.
- Authenticated UI flow for connection status and search execution.
- Rate-limit/backoff policy, audit logging, and integration tests using an authorized account.
- Runtime verification with real Telegram credentials.

No Telegram account has been connected and no public posts have been collected by this code yet.

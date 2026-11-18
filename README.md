# Mimi Search AI

منصة ذكية لاكتشاف العملاء المحتملين والطلبات التقنية وإدارة فرص المبيعات، مع دعم البحث في المصادر العامة ضمن صلاحيات المنصات.

## Product direction

- **Discovery MVP:** اكتشاف الطلبات التقنية وإدارة العملاء المحتملين.
- **Markets:** جميع الدول العربية الـ22، مع التصفية حسب الدولة والمدينة.
- **Initial sources:** Facebook Public وTelegram Public.
- **Facebook:** التكامل عبر Meta Graph API، ويظل الوصول إلى بيانات الصفحات العامة مشروطاً بميزات Meta والصلاحيات والمراجعة التي تنطبق على التطبيق.
- **Telegram:** تكامل MTProto للبحث في القنوات والمنشورات العامة، مع الالتزام بحدود Telegram وحصص البحث المتاحة.
- **Workflow:** جمع البيانات العامة المسموح بها، مراجعتها، تأهيل الفرصة، ثم إدارتها عبر CRM.
- **Lead scoring:** 100 نقطة موزعة على وضوح الاحتياج (30)، نية الشراء (25)، تحديد الخدمة (20)، حداثة المنشور (10)، تفاصيل المشروع (10)، ووضوح الموقع (5).
- **No autonomous outreach:** لا يرسل النظام رسائل للعملاء نيابة عن المستخدم.
- **No demo leads:** لا تُضاف بيانات عملاء أو منشورات تجريبية إلى قاعدة البيانات.

## Technology

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL
- Row Level Security (RLS)
- Server-side connectors for external platform integrations

## Database foundation

The initial workspace/authentication schema is in `supabase/schema.sql`.

The additive lead-discovery database migration is in `supabase/lead-discovery-foundation.sql`. It creates:

- Arabic country reference catalog (22 countries) and a city catalog.
- Workspace keyword sets and dialect/phrase variants.
- Facebook and Telegram connection metadata, with connector secrets isolated in the non-exposed `private` schema.
- Search queries and country/city/source/keyword filters.
- Collection runs and normalized source items.
- Leads, evidence records, and explainable scoring assessments.

All new public tables have RLS enabled. Reference catalogs are read-only to authenticated users. Workspace data is tenant-scoped; viewers are read-only, members can manage search configuration, and only owners/admins can manage platform connections. Ingestion output is written by trusted server-side workers using server credentials.

The secret table stores ciphertext only. Encryption/decryption and key management must be implemented by the trusted server before any real platform credentials or sessions are stored. Never expose service-role keys, OAuth secrets, Telegram session strings, or encryption keys to browser code.

## Current implementation status

Completed:
- Arabic dashboard shell and authentication foundation.
- Supabase workspace model and initial RLS policies.
- Lead-discovery database tables, relationships, indexes, and role-aware RLS.
- Country reference catalog for all 22 Arab countries.
- Database access checks for workspace members, non-members, and read-only viewer role.

Not implemented yet:
- Facebook OAuth/API connector and Meta permissions review.
- Telegram MTProto connector and public-post search.
- Server-side encryption/key management for connector secrets.
- Search execution workers and scheduled collection.
- Lead extraction, deduplication, and automated scoring pipeline.
- CRM interface for real leads.

## Local development

1. Install Node.js LTS.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Add your Supabase project URL and publishable key.
5. Run `npm run dev`.

## Environment variables

See `.env.example`. Never commit real credentials, service-role keys, OAuth client secrets, encryption keys, or Telegram session data.

## Data and platform compliance

- Collect only public data that the connected application/account is authorized to access.
- Do not bypass platform access controls, approval requirements, or rate limits.
- Meta API availability depends on the app's approved access level and the relevant permissions/features.
- Telegram public search availability and quotas are subject to Telegram API limits and current terms.
- Store source URLs and collection timestamps so each lead can be traced to its public evidence.
- Do not collect private messages or send automated outreach.

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` first.
3. Run `supabase/lead-discovery-foundation.sql` second.
4. Copy the project URL and publishable key into `.env.local`.
5. In Supabase Authentication, configure the site URL and redirect URLs for local development and the deployed domain.
6. Enable email/password authentication and configure email confirmation as required.

## Deployment

Deployment is intentionally not part of the current database milestone. Do not deploy until the user explicitly approves it.

## License

All rights reserved unless a license is added by the repository owner.


## Telegram public connector

The Telegram MTProto connector is under development on `feature/telegram-public-connector`.

- Uses the maintained `teleproto` package (GramJS-compatible successor).
- Searches public channel posts only; it does not join channels, read private chats, send messages, or pay Telegram Stars for search.
- Setup, API credential creation, encrypted session bootstrap, and current limitations: [docs/telegram-connector.md](docs/telegram-connector.md).
- Provider implementation: [src/lib/telegram/public-search.ts](src/lib/telegram/public-search.ts).
- Local session bootstrap: `npm run telegram:session`.

The web authorization flow, encrypted pending-session storage, private session vault, and public-post search test UI are implemented on the feature branch. A real Telegram account connection, real search test, CI pass for the latest commit, and persistence of collected posts into the discovery tables are still pending. The pull request remains Draft and is not deployed to Production. Never commit Telegram credentials or session data.

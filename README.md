# Mimi Search AI

منصة ذكية لاكتشاف العملاء المحتملين والطلبات التقنية وإدارة فرص المبيعات، مع تركيز أولي على أسواق الخليج العربي.

## Product direction

- **Discovery MVP:** اكتشاف الطلبات التقنية وإدارة العملاء المحتملين.
- **Markets:** السعودية والإمارات أولاً، مع قابلية التوسع إلى بقية دول الخليج.
- **Initial sources:** Telegram (مصادر ينضم إليها الحساب ويملك حق الوصول إليها) وX (استيراد يدوي للروابط والنصوص في الإصدار الأول).
- **Workflow:** جمع البيانات العامة المسموح بها، مراجعتها، تأهيل الفرصة، ثم إدارتها عبر CRM.
- **No autonomous outreach:** لا يرسل النظام رسائل للعملاء نيابة عن المستخدم.

## Technology

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL
- Row Level Security (RLS)

## Status

The repository is being initialized. The first milestone is the secure application foundation: project structure, Arabic RTL interface, authentication scaffolding, workspace model, and database policies.

## Local development

1. Install Node.js LTS.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Add your Supabase project URL and anon key.
5. Run `npm run dev`.

## Environment variables

See `.env.example`. Never commit real credentials, service-role keys, or Telegram session data.

## Security and data principles

- Store only data the connected account is authorized to access.
- Do not bypass platform access controls or rate limits.
- Telegram collection must be limited to accessible joined sources and reviewed against Telegram's current terms.
- The initial X workflow is manual import; no paid or unofficial scraping API is assumed.
- Apply workspace-level authorization and database RLS to all tenant data.

## License

All rights reserved unless a license is added by the repository owner.

# MCR — Master Control Room (SaaS)

Multi-tenant broadcast production workflow. Spec: ../docs/superpowers/specs/2026-07-07-mcr-saas-design.md

## Setup
1. Supabase project + `.env.local` (see `.env.example`)
2. `supabase link --project-ref <ref>` then `supabase db push`
3. `npm install && npm run seed`
4. `npm run dev`

## Checks
- `npm run test:security` — RLS isolation, role gates, state machine. Must pass before any release.
- `npm run test:e2e` — Playwright golden path (sign in → create → approve → 5 stages → complete). Run `npm run seed` first; needs `npx playwright install chromium` once.
- CI (GitHub Actions) runs the full suite — tsc, lint, build, reducer, seed, security, e2e — on every PR and push to master, against the live Supabase project (runs serialized).

## Error monitoring
Sentry activates when `NEXT_PUBLIC_SENTRY_DSN` is set (in `.env.local` locally, and in Vercel env for prod). Without it the wiring is a no-op.

## Phase status
- [x] Phase 1: Foundation
- [x] Phase 2: Realtime + project detail
- [x] Phase 3: Deploy to Vercel
- [x] Phase 4: Accounts & roles (profiles, invites, member management)
- [x] Phase 5: Assets
- [x] Phase 6: Hardening (Playwright, CI, Sentry)
- [ ] Phase 7: Final polish (Claude audit: security, UI/UX, functionality suggestions)
- [ ] Phase 8: Pilot rollout

Billing was cut from the roadmap for the single-pilot model (see DEFERRED.md).

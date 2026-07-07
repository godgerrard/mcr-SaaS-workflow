# MCR — Master Control Room (SaaS)

Multi-tenant broadcast production workflow. Spec: ../docs/superpowers/specs/2026-07-07-mcr-saas-design.md

## Setup
1. Supabase project + `.env.local` (see `.env.example`)
2. `supabase link --project-ref <ref>` then `supabase db push`
3. `npm install && npm run seed`
4. `npm run dev`

## Checks
- `npm run test:security` — RLS isolation, role gates, state machine. Must pass before any release.

## Phase status
- [x] Phase 1: Foundation
- [x] Phase 2: Realtime + project detail
- [x] Phase 3: Deploy to Vercel
- [x] Phase 4: Accounts & roles (profiles, invites, member management)
- [ ] Phase 5: Assets
- [ ] Phase 6: Hardening (Playwright, CI, Sentry)
- [ ] Phase 7: Pilot rollout

Billing was cut from the roadmap for the single-pilot model (see DEFERRED.md).

# Deferred — not blocking the build

Things noticed and deliberately parked. Revisit before/at pilot rollout.
Convention: anything non-blocking discovered during a session gets added here instead of interrupting the build.

## Auth / access
- **Invite emails not sent in production** — decision reversed at deploy time (2026-07-08): the service-role key is deliberately NOT deployed to Vercel. `/api/invites` still creates the invite row (RLS-gated); the UI tells the inviter to have the person sign in at the app, where the pending invite is claimed at onboarding. To enable real invite emails later: add `SUPABASE_SERVICE_ROLE_KEY` to Vercel (Sensitive, Production) and redeploy — the code path already exists. Pairs with the custom-SMTP item below.
- **Google sign-in not enabled** — app code supports it; Supabase provider was never configured. Needs a Google Cloud OAuth client (redirect URI `https://mtpqhrsmwpaxcxpsmeqd.supabase.co/auth/v1/callback`) pasted into Supabase → Sign In/Providers → Google. Magic link covers the pilot until someone asks.
- **Supabase built-in SMTP rate limits** — default email sender allows only a handful of magic links per hour. Fine for testing; a real pilot team on magic-link-only will hit it. Configure custom SMTP (Resend/Postmark/etc.) before handover.
- **Two stray Gmail sign-ups** (`dasddo@`, `liottaray658@`) with no org membership — they'll route to /onboarding. With Phase 4 they can now be invited properly or deleted; decide at pilot rollout.
- **Demo users cleanup before pilot** — `*@demo.mcr` / `ceo@other.mcr` (password `demo-pass-123`) exist for the test harness; Phase 4 added `invitee@demo.mcr` (security suite section 7) and `browser-test@demo.mcr` (manual browser verification). Decide at rollout: keep (tests need them) but confirm they stay isolated from the pilot org, or move tests to a staging project.

## Infra / deploy
- **Vercel Git auto-deploy not connected** — Vercel GitHub App isn't installed on the `godgerrard` account. Until then: `npx vercel deploy --prod` from `mcr/`. One click in Vercel project → Settings → Git when wanted.
- **Custom domain** — pilot runs on `broadcast-workflow.vercel.app`. Buy/attach a real domain when branding matters (also update Supabase Site URL + redirect list then).
- **Repo naming** — GitHub repo `broadcast-workflow` holds the MCR SaaS; the old Express MVP lives in the unrelated local folder `LAB/broadcast-workflow`. Rename repo to `mcr` or archive/delete the local MVP folder to kill the ambiguity.
- **Old MVP retirement** — `LAB/broadcast-workflow` (Express+SQLite) is fully superseded. Archive or delete.

## Code / schema
- **`orgs.plan` column unused** — billing was cut; column is harmless. Drop it in some future migration if it confuses.
- **Lint warning** — `no-page-custom-font` in `app/layout.tsx` (fonts via `<link>` in a single-page app-router layout; cosmetic).
- ~~**Realtime test flakiness**~~ — RESOLVED in Phase 4: after a third transient failure, section 6 now retries once automatically with fresh channels (tenant-isolation assertion enforced on every attempt; positive control never weakened).
- **`final_qc` display label drifts from spec** — spec §3 says the UI label is "Final QC/Export"; the shipped UI has used "TX / QC" (`lib/stages.ts` STAGE_LABEL) since Phase 1 and Phase 4 kept it for consistency. Pick one at pilot handover; stored value `final_qc` is unaffected.
- **`<select>` elements unstyled** — settings-page dropdowns render browser-default (globals.css styles inputs but not selects). Cosmetic.

## Product (cut by decision, not debt)
- **Billing** (Stripe, plans table, project-count gate) — cut entirely for single-pilot model. Returns as its own phase only if multi-customer SaaS returns.
- **Per-org outbound webhook on asset upload** (MAM integration escape hatch) — named in spec Risks; nothing built until a customer needs it.

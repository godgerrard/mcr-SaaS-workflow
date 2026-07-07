# Deferred — not blocking the build

Things noticed and deliberately parked. Revisit before/at pilot rollout.
Convention: anything non-blocking discovered during a session gets added here instead of interrupting the build.

## Auth / access
- **Google sign-in not enabled** — app code supports it; Supabase provider was never configured. Needs a Google Cloud OAuth client (redirect URI `https://mtpqhrsmwpaxcxpsmeqd.supabase.co/auth/v1/callback`) pasted into Supabase → Sign In/Providers → Google. Magic link covers the pilot until someone asks.
- **Prod magic-link round-trip unconfirmed** — last verification box on the deploy phase: request a link on https://broadcast-workflow.vercel.app, click it, confirm it lands on the prod domain (not localhost).
- **Supabase built-in SMTP rate limits** — default email sender allows only a handful of magic links per hour. Fine for testing; a real pilot team on magic-link-only will hit it. Configure custom SMTP (Resend/Postmark/etc.) before handover.
- **Two stray Gmail sign-ups** (`dasddo@`, `liottaray658@`) with no org membership — they'll route to /onboarding. Clean up or absorb when the accounts & roles phase lands.
- **Demo users cleanup before pilot** — `*@demo.mcr` / `ceo@other.mcr` (password `demo-pass-123`) exist for the test harness. Decide at rollout: keep (tests need them) but confirm they stay isolated from the pilot org, or move tests to a staging project.

## Infra / deploy
- **Vercel Git auto-deploy not connected** — Vercel GitHub App isn't installed on the `godgerrard` account. Until then: `npx vercel deploy --prod` from `mcr/`. One click in Vercel project → Settings → Git when wanted.
- **Custom domain** — pilot runs on `broadcast-workflow.vercel.app`. Buy/attach a real domain when branding matters (also update Supabase Site URL + redirect list then).
- **Repo naming** — GitHub repo `broadcast-workflow` holds the MCR SaaS; the old Express MVP lives in the unrelated local folder `LAB/broadcast-workflow`. Rename repo to `mcr` or archive/delete the local MVP folder to kill the ambiguity.
- **Old MVP retirement** — `LAB/broadcast-workflow` (Express+SQLite) is fully superseded. Archive or delete.

## Code / schema
- **`orgs.plan` column unused** — billing was cut; column is harmless. Drop it in some future migration if it confuses.
- **Lint warning** — `no-page-custom-font` in `app/layout.tsx` (fonts via `<link>` in a single-page app-router layout; cosmetic).
- **Realtime test flakiness** — "realtime not delivering" (positive control) failed transiently twice, both times passing on re-run (once during Phase 2 build, once right after key rotation). If it becomes frequent, add one automatic retry inside test-security section 6 instead of manual re-runs.

## Product (cut by decision, not debt)
- **Billing** (Stripe, plans table, project-count gate) — cut entirely for single-pilot model. Returns as its own phase only if multi-customer SaaS returns.
- **Per-org outbound webhook on asset upload** (MAM integration escape hatch) — named in spec Risks; nothing built until a customer needs it.

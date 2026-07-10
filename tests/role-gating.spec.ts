import { test, expect } from "@playwright/test";

// Phase 7: CEO-only gateway + crew stage-scoping are hidden in the UI (server
// RLS/RPCs already enforce them); hold/reject notes are recorded; status pills
// keep their color for in_production/on_hold/complete (CSS class aliases).
test("role gating: crew sees no CEO/off-stage controls; hold notes recorded", async ({ page }) => {
  const title = `E2E Role Gate ${Date.now()}`;
  const proposedTitle = `${title} B`;

  const signIn = async (email: string) => {
    await page.evaluate(
      async ({ url, key, email }) => {
        const { createBrowserClient } = await import(
          // @ts-expect-error runtime-only remote import inside the browser
          "https://esm.sh/@supabase/ssr@0.12.0"
        );
        const client = createBrowserClient(url, key);
        await client.auth.signOut();
        const { error } = await client.auth.signInWithPassword({
          email,
          password: "demo-pass-123",
        });
        if (error) throw new Error(error.message);
      },
      {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        email,
      }
    );
  };

  // --- CEO: create two projects; hold one with a reason, then approve it ---
  await page.goto("/login");
  await signIn("ceo@demo.mcr");
  await page.goto("/");

  for (const t of [title, proposedTitle]) {
    await page.getByRole("button", { name: "+ Log new segment" }).click();
    await page.locator('input[name="title"]').fill(t);
    await page.locator('input[name="budget"]').fill("1000");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.locator(".row", { hasText: t })).toBeVisible();
  }

  const row = page.locator(".row", { hasText: title }).first();
  await row.getByRole("link", { name: "OPEN" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // Hold with a reason — the note must land in the approval history.
  await page.getByPlaceholder("Reason (sent with Hold/Reject)").fill("Budget unclear");
  await page.getByRole("button", { name: "Hold" }).click();
  await expect(page.locator(".rundown", { hasText: "hold" }).getByText("Budget unclear")).toBeVisible();
  // on_hold pill is styled (CSS alias fix), not colorless plain text.
  await expect(page.locator(".status-pill")).toHaveText("HOLD");
  await expect(page.locator(".status-pill")).not.toHaveCSS("border-color", "rgba(0, 0, 0, 0)");

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(".status-pill")).toHaveText("ON AIR", { timeout: 20_000 });

  // CEO completes camera so the edit stage is live for the crew phase below.
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.locator(".lamp.done")).toHaveCount(1, { timeout: 20_000 });

  // --- Crew (edit stage): CEO/off-stage controls must be absent ---
  await signIn("crew-edit@demo.mcr");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Master Control" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Log new segment" })).toHaveCount(0);

  // Proposed project: no CEO Approval Gateway for crew (dashboard row + detail).
  const proposedRow = page.locator(".row", { hasText: proposedTitle }).first();
  await proposedRow.locator(".row-main").click();
  await expect(page.locator(".gateway-console")).toHaveCount(0);
  await proposedRow.getByRole("link", { name: "OPEN" }).click();
  await expect(page.getByRole("heading", { name: proposedTitle })).toBeVisible();
  await expect(page.locator(".gateway-console")).toHaveCount(0);

  // In-production project, edit stage live: crew sees exactly ONE "Mark done"
  // (their own stage — other stages' tasks are RLS-invisible to crew) and can
  // use it; after that no further stage is theirs to advance.
  await page.goto("/");
  const prodRow = page.locator(".row", { hasText: title }).first();
  await prodRow.getByRole("link", { name: "OPEN" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  // in_production pill carries the tally-red alias color.
  await expect(page.locator(".status-pill")).toHaveCSS("color", "rgb(232, 51, 31)");
  await expect(page.getByRole("button", { name: "Mark done" })).toHaveCount(1);
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.locator(".lamp.done")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Mark done" })).toHaveCount(0);
});

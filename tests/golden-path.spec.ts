import { test, expect } from "@playwright/test";

// Golden path (spec §9): sign in as CEO -> create project -> approve ->
// mark all 5 stages done (camera -> edit -> graphics -> sound -> final_qc)
// -> project reaches complete ("READY" pill).
test("golden path: create, approve, five stages, complete", async ({ page }) => {
  const title = `E2E Golden Path ${Date.now()}`;

  // Product UI has no password form; sign in with supabase-js inside the page
  // (must be on an http page first — cookies are disabled on about:/data: URLs).
  await page.goto("/login");
  await page.evaluate(
    async ({ url, key }) => {
      const { createBrowserClient } = await import(
        // @ts-expect-error runtime-only remote import inside the browser
        "https://esm.sh/@supabase/ssr@0.12.0"
      );
      const client = createBrowserClient(url, key);
      const { error } = await client.auth.signInWithPassword({
        email: "ceo@demo.mcr",
        password: "demo-pass-123",
      });
      if (error) throw new Error(error.message);
    },
    {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    }
  );

  // Dashboard renders.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Master Control" })).toBeVisible();

  // Create a new project via "+ Log new segment".
  await page.getByRole("button", { name: "+ Log new segment" }).click();
  await page.locator('input[name="title"]').fill(title);
  await page.locator('input[name="client"]').fill("E2E Client");
  await page.locator('input[name="budget"]').fill("1000");
  await page.getByRole("button", { name: "Submit" }).click();

  // Open its detail page.
  const row = page.locator(".row", { hasText: title });
  await row.getByRole("link", { name: "OPEN" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator(".status-pill")).toHaveText("STANDBY");

  // CEO approves — project enters production, camera stage lights up.
  await page.getByRole("button", { name: "Approve" }).click();

  // Complete each stage; the next auto-advances (realtime updates the lamps).
  for (let done = 1; done <= 5; done++) {
    await page.getByRole("button", { name: "Mark done" }).click();
    // Wait for this stage's lamp to go green before clicking again, so we
    // never re-click the same still-visible button.
    await expect(page.locator(".lamp.done")).toHaveCount(done, { timeout: 20_000 });
  }

  // Terminal state: complete.
  await expect(page.locator(".status-pill")).toHaveText("READY", { timeout: 20_000 });
});

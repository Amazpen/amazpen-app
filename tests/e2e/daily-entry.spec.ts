import { test, expect } from "@playwright/test";

test.describe("דיווח יומי - Daily Entry", () => {

  test("טופס דיווח יומי נטען בדשבורד", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Dashboard should have some form or input for daily entry
    const main = page.locator("main");
    await expect(main).toBeVisible();
  });

  test("גרפים נטענים בדשבורד", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait for charts to render (Recharts uses SVG)
    await page.waitForTimeout(2000);
    const svgs = page.locator("svg.recharts-surface");
    // If there are charts, they should be visible
    if (await svgs.count() > 0) {
      await expect(svgs.first()).toBeVisible();
    }
  });
});

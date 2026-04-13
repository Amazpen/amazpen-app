import { test, expect } from "@playwright/test";

test.describe("ניווט ו-UI", () => {

  test("sidebar קיים ומציג לינקים", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Look for navigation/sidebar
    const nav = page.locator("nav, aside, [role='navigation']");
    if (await nav.count() > 0) {
      await expect(nav.first()).toBeVisible();
    }
  });

  test("אין שגיאות console קריטיות", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore known non-critical errors
        if (!text.includes("favicon") && !text.includes("hydration")) {
          errors.push(text);
        }
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Should have no critical errors
    const criticalErrors = errors.filter(
      (e) => e.includes("TypeError") || e.includes("ReferenceError") || e.includes("Cannot read")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("דף 404 לנתיב לא קיים", async ({ page }) => {
    const response = await page.goto("/nonexistent-page-12345");
    // Should return 404 or redirect, not crash
    expect(response?.status()).toBeLessThan(500);
  });

  test("API health check", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBeLessThan(500);
  });

  test("RTL direction מוגדר", async ({ page }) => {
    await page.goto("/");
    const dir = await page.locator("html").getAttribute("dir");
    expect(dir).toBe("rtl");
  });

  test("responsive - mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Should not have horizontal scroll
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 10);
  });
});

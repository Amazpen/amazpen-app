import { test, expect } from "@playwright/test";

test.describe("Smoke Tests - בדיקות בסיסיות", () => {

  test("דשבורד נטען", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/מצפן|amazpen/i);
    // Dashboard should have some content
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("ניווט לדף הוצאות", async ({ page }) => {
    await page.goto("/expenses");
    await page.waitForLoadState("networkidle");
    // Should not redirect to login
    await expect(page).not.toHaveURL(/login/);
  });

  test("ניווט לדף ספקים", async ({ page }) => {
    await page.goto("/suppliers");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/login/);
  });

  test("ניווט לדף תשלומים", async ({ page }) => {
    await page.goto("/payments");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/login/);
  });

  test("ניווט לדף לקוחות", async ({ page }) => {
    await page.goto("/customers");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/login/);
  });

  test("ניווט לדף דוחות", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/login/);
  });

  test("ניווט לדף יעדים", async ({ page }) => {
    await page.goto("/goals");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/login/);
  });

  test("ניווט לדף AI", async ({ page }) => {
    await page.goto("/ai");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/login/);
  });

  test("ניווט לדף הגדרות", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await expect(page).not.toHaveURL(/login/);
  });
});

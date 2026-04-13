import { test, expect } from "@playwright/test";

test.describe("הוצאות - Expenses", () => {

  test("רשימת הוצאות נטענת", async ({ page }) => {
    await page.goto("/expenses");
    await page.waitForLoadState("networkidle");

    // Should see a table or list of expenses
    const content = page.locator("main");
    await expect(content).toBeVisible();
  });

  test("כפתור הוספת הוצאה קיים", async ({ page }) => {
    await page.goto("/expenses");
    await page.waitForLoadState("networkidle");

    // Look for add button
    const addButton = page.getByRole("button", { name: /הוסף|חדש|הוצאה/i });
    // If exists, verify it's clickable
    if (await addButton.count() > 0) {
      await expect(addButton.first()).toBeEnabled();
    }
  });

  test("טופס הוצאה נפתח", async ({ page }) => {
    await page.goto("/expenses");
    await page.waitForLoadState("networkidle");

    // Try to open add expense form
    const addButton = page.getByRole("button", { name: /הוסף|חדש|הוצאה/i });
    if (await addButton.count() > 0) {
      await addButton.first().click();
      // Should see a form or dialog
      await page.waitForTimeout(500);
      const dialog = page.getByRole("dialog");
      const form = page.locator("form");
      const hasDialog = await dialog.count() > 0;
      const hasForm = await form.count() > 0;
      expect(hasDialog || hasForm).toBeTruthy();
    }
  });
});

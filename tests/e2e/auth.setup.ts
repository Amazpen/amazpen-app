import { test as setup, expect } from "@playwright/test";
import path from "path";

const authFile = path.join(__dirname, ".auth/user.json");

setup("login", async ({ page }) => {
  await page.goto("/login");

  // Fill login form - adjust selectors to match your actual login page
  await page.getByPlaceholder("אימייל").fill(process.env.TEST_EMAIL || "test@amazpenbiz.co.il");
  await page.getByPlaceholder("סיסמה").fill(process.env.TEST_PASSWORD || "");

  // Click login button
  await page.getByRole("button", { name: /כניסה|התחבר/i }).click();

  // Wait for redirect to dashboard
  await page.waitForURL("/", { timeout: 15000 });

  // Verify we're logged in
  await expect(page).not.toHaveURL(/login/);

  // Save auth state
  await page.context().storageState({ path: authFile });
});

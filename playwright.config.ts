import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: "https://app.amazpenbiz.co.il",
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    // Persist login state
    storageState: "./tests/e2e/.auth/user.json",
  },
  projects: [
    // Setup: login once, save state
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { storageState: undefined },
    },
    // All tests use saved login
    {
      name: "tests",
      dependencies: ["setup"],
    },
  ],
});

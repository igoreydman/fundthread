import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 60000,
  outputDir: process.env.FUNDTHREAD_EVIDENCE_DIR
    ? `${process.env.FUNDTHREAD_EVIDENCE_DIR}/playwright`
    : "test-results",
  workers: 1,
  use: {
    baseURL: process.env.FUNDTHREAD_BASE_URL || "http://127.0.0.1:1420",
    viewport: { width: 1480, height: 1000 },
    launchOptions: {
      executablePath: process.env.FUNDTHREAD_TEST_BROWSER || undefined,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
    trace: "retain-on-failure",
  },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: process.env.FUNDTHREAD_EVIDENCE_DIR
          ? `${process.env.FUNDTHREAD_EVIDENCE_DIR}/browser-results.json`
          : "test-results/browser-results.json",
      },
    ],
  ],
});

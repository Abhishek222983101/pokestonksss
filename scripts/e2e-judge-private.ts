/** The one-click Private ER self-test on /judge, in a real browser. BASE_URL=... */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
const BASE = process.env.BASE_URL ?? "http://localhost:3210";
(async () => {
  const browser = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  await page.goto(BASE + "/judge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /run private er self-test/i }).click();
  const done = page.getByText(/Replay with the shared Rust rules|self-test stopped/i);
  await done.first().waitFor({ timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const rows = await page.locator("h2:has-text('Private ER self-test') ~ ol li").allInnerTexts();
  rows.forEach((r) => console.log(r.replace(/\n/g, " | ").slice(0, 170)));
  const bad = rows.filter((r) => r.startsWith("✗"));
  await page.screenshot({ path: "../docs/fidelity/judge-private.png", fullPage: true });
  console.log(bad.length || errs.length ? "FAILED" : "ALL PASSED", rows.length, "rows", errs.join(" | "));
  await browser.close();
  process.exit(bad.length || errs.length ? 1 : 0);
})();

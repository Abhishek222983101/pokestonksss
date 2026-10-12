/** Renders /press frames to docs/media/*.png (logo 1080x1080, banner 1600x900). BASE_URL=http://localhost:3210 */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3210";
(async () => {
  mkdirSync("../docs/media", { recursive: true });
  const browser = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1800, height: 2200 }, deviceScaleFactor: 1 });
  await page.goto(BASE + "/press", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3500);
  await page.locator("#logo").screenshot({ path: "../docs/media/pokestonksss-logo.png" });
  await page.locator("#banner").screenshot({ path: "../docs/media/pokestonksss-banner.png" });
  await browser.close();
  console.log("rendered");
})();

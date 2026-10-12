/** Headless browser e2e against BASE_URL: judge self-test + onboarding overlay. pnpm --filter scripts e2e:browser */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { readdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const chromiumDir = readdirSync(`${homedir()}/.cache/ms-playwright`).filter((d) => d.startsWith("chromium-1243")).sort().pop()!;
const exe = `${homedir()}/.cache/ms-playwright/${chromiumDir}/chrome-linux64/chrome`;

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  await page.goto(`${BASE}/judge`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByRole("button", { name: /run self-test/i }).click();
  const t0 = Date.now();
  await page.waitForFunction(() => document.body.innerText.includes("Verify any match") || document.body.innerText.includes("Self-test stopped"), null, { timeout: 120000 });
  const text = await page.locator("main").innerText();
  await page.screenshot({ path: "../docs/fidelity/judge-page.png", fullPage: true });
  console.log(text);
  console.log(`\nself-test finished in ${Math.round((Date.now() - t0) / 1000)} s; page errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(" ", e));
  await browser.close();
  process.exit(text.includes("Self-test stopped") || /✗/.test(text) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

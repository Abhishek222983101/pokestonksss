import { chromium } from "playwright-core";
import { homedir } from "node:os";
const exe = `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const BASE = process.env.BASE_URL ?? "https://pokestonksss.vercel.app";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await b.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(BASE + "/judge", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /run self-test/i }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Verify any match"), null, { timeout: 90000 });
  await page.goto(BASE + "/trainer", { waitUntil: "domcontentloaded" }); await sleep(6000);
  await page.screenshot({ path: "../docs/fidelity/v3-trainer.png", fullPage: true });
  await page.goto(BASE + "/leaderboard", { waitUntil: "domcontentloaded" }); await sleep(6000);
  await page.screenshot({ path: "../docs/fidelity/v3-leaderboard.png", fullPage: true });
  await b.close();
})();

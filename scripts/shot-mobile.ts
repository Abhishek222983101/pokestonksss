import { chromium, devices } from "playwright-core";
import { homedir } from "node:os";
const exe = `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const BASE = process.env.BASE_URL ?? "https://pokestonksss.vercel.app";
(async () => {
  const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "domcontentloaded" }); await new Promise((r) => setTimeout(r, 4000));
  await p.screenshot({ path: "../docs/fidelity/mobile-title.png" });
  await p.goto(BASE + "/judge", { waitUntil: "networkidle" });
  await p.screenshot({ path: "../docs/fidelity/mobile-judge.png", fullPage: true });
  await b.close();
})();

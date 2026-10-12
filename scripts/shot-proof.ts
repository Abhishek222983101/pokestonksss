import { chromium } from "playwright-core";
import { homedir } from "node:os";
const exe = `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const BASE = process.env.BASE_URL ?? "https://pokestonksss.vercel.app";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" }); await sleep(3500);
  await page.getByRole("button", { name: /play as guest/i }).first().click();
  await page.getByText(/getting your wristband/i).first().waitFor({ state: "hidden", timeout: 70000 }).catch(() => {});
  await sleep(1500);
  await page.getByRole("button", { name: /^choose /i }).first().click(); await sleep(5500);
  for (let i = 0; i < 6; i++) { const s = page.locator("button.pin:not(.pin-cluster)"); const pin = (await s.count()) > 0 ? s.first() : page.locator("button.pin").first(); await pin.evaluate((e: HTMLElement) => e.click()).catch(() => {}); await sleep(1200); if (await page.getByRole("button", { name: /enter route/i }).isVisible().catch(() => false)) break; }
  await page.getByRole("button", { name: /enter route/i }).first().click(); await sleep(8000);
  await page.screenshot({ path: "../docs/fidelity/v2-overworld-back.png" });
  const hold = async (k: string, t: number) => { await page.keyboard.down(k); await sleep(t * 260); await page.keyboard.up(k); };
  let dir = "ArrowRight"; const t0 = Date.now(); let on = false;
  await hold("ArrowDown", 4);
  while (!on && Date.now() - t0 < 200000) { for (let i = 0; i < 8 && !on; i++) { await hold(dir, 1); await page.keyboard.press("z"); on = (await page.getByText(/ROLLUP · devnet/).count()) > 0; } dir = dir === "ArrowRight" ? "ArrowLeft" : "ArrowRight"; if (!on) await hold("ArrowDown", 2); }
  await sleep(6000);
  for (let i = 0; i < 14; i++) { await page.keyboard.press("Enter"); await sleep(900); }
  await page.getByRole("button", { name: /^proof$/i }).click().catch(() => {});
  await sleep(800);
  await page.screenshot({ path: "../docs/fidelity/v2-proof-panel.png" });
  await b.close();
})();

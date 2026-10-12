/** Screenshots of season 2 UI: start dialog, battle plates (levels), end screen (xp/level/badges), rewards. BASE_URL=... DEMO=1 */
import { chromium, type Page } from "playwright-core";
import { homedir } from "node:os";
const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const exe = `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = (p: Page, n: string) => p.screenshot({ path: `../docs/fidelity/v2-${n}.png` });
(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 160)));
  await page.goto(BASE + "/?demo=1", { waitUntil: "domcontentloaded" });
  await sleep(3500);
  await page.getByRole("button", { name: /^play/i }).first().click();
  await sleep(600); await shot(page, "start-dialog");
  await page.getByRole("radio", { name: /quant/i }).click();
  await page.getByRole("button", { name: /play as guest/i }).first().click();
  await page.getByText(/getting your wristband/i).first().waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
  await sleep(1500);
  await page.getByRole("button", { name: /^choose /i }).first().click({ timeout: 20000 });
  await sleep(5500);
  await shot(page, "globe-hud");
  for (let i = 0; i < 6; i++) {
    const single = page.locator("button.pin:not(.pin-cluster)");
    const pin = (await single.count()) > 0 ? single.first() : page.locator("button.pin").first();
    await pin.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    await sleep(1500);
    if (await page.getByRole("button", { name: /enter route/i }).isVisible().catch(() => false)) break;
  }
  await page.getByRole("button", { name: /enter route/i }).first().click({ timeout: 20000 });
  await sleep(8000);
  await page.evaluate(() => { const g = (window as any).__game; const s = g.scene.getScene("Overworld"); void s.guarded.call(s, () => s.wildEncounter.call(s, 2)); });
  await sleep(9000); await shot(page, "battle-start");
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Enter"); await sleep(900);
    const t = await page.evaluate(() => (window as any).__game?.scene?.getScene("Battle")?.overlay ? 1 : 0).catch(() => 0);
    if (t) { await sleep(2600); await shot(page, "end-a"); await sleep(5000); await shot(page, "end-b"); await sleep(9000); await shot(page, "end-c"); break; }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

/** Levels the browser guest to Lv 4 with four Dummy wins (Node, same key), then screenshots an evolved battle. */
import { chromium, type Page } from "playwright-core";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";
import { PHASE, devnetConfig, GameClient, keypairSigner } from "@pokestonksss/sdk";
import { waitArena } from "./lib/play";
const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = (p: Page, n: string) => p.screenshot({ path: `../docs/fidelity/v2-${n}.png` });
(async () => {
  const browser = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE + "/?demo=1", { waitUntil: "domcontentloaded" }); await sleep(3500);
  await page.getByRole("button", { name: /^play/i }).first().click();
  await page.getByRole("radio", { name: /whale/i }).click();
  await page.getByRole("button", { name: /play as guest/i }).first().click();
  await page.getByText(/getting your wristband/i).first().waitFor({ state: "hidden", timeout: 70000 }).catch(() => {});
  await sleep(1500);
  const raw = await page.evaluate(() => window.localStorage.getItem("pokestonksss.guestkey.v1"));
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw!)));
  const client = new GameClient(devnetConfig("as")); const s = keypairSigner(kp);
  // the first broker the page selects is SOL (species 0): level it with Dummy wins
  for (let i = 0; i < 4; i++) {
    await client.startPractice(s, 0, 1, 4);
    let a = await client.getArena(kp.publicKey);
    for (let g = 0; g < 30 && a && a.phase !== PHASE.FINISHED; g++) { const t = a.match.turn; await client.lockPick(s, 0); a = await waitArena(client, kp.publicKey, (x) => x.match.turn > t || x.phase === PHASE.FINISHED); }
  }
  console.log("xp", (await client.getTrainer(kp.publicKey))?.xp.join(","));
  await page.reload({ waitUntil: "domcontentloaded" }); await sleep(3500);
  await page.getByRole("button", { name: /continue/i }).first().click().catch(() => {});
  await page.getByText(/getting your wristband/i).first().waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
  await sleep(1500);
  await page.getByRole("button", { name: /^choose /i }).first().click({ timeout: 20000 }).catch(() => {});
  await sleep(5000);
  for (let i = 0; i < 6; i++) {
    const single = page.locator("button.pin:not(.pin-cluster)");
    const pin = (await single.count()) > 0 ? single.first() : page.locator("button.pin").first();
    await pin.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    await sleep(1500);
    if (await page.getByRole("button", { name: /enter route/i }).isVisible().catch(() => false)) break;
  }
  await page.getByRole("button", { name: /enter route/i }).first().click({ timeout: 20000 });
  await sleep(8000);
  await page.evaluate(() => { const g = (window as any).__game; const sc = g.scene.getScene("Overworld"); void sc.guarded.call(sc, () => sc.wildEncounter.call(sc, 2)); });
  await sleep(10000); await shot(page, "evolved-battle");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

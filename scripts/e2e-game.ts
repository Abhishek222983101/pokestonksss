/** Full game e2e in a real browser against BASE_URL: guest → onboarding overlay → select → globe → route → encounter → ON-CHAIN battle. */
import { chromium, type Page } from "playwright-core";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";
import { devnetConfig, GameClient } from "@pokestonksss/sdk";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const exe = `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = (p: Page, n: string) => p.screenshot({ path: `../docs/fidelity/game-${n}.png` });
let failed = false;
const check = (name: string, ok: boolean, d = "") => { console.log(`${ok ? "✓" : "✗"} ${name} ${d}`); if (!ok) failed = true; };

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(BASE + (process.env.DEMO ? "/?demo=1" : ""), { waitUntil: "domcontentloaded" });
  await sleep(3500);
  await shot(page, "1-title");
  await page.getByRole("button", { name: /^play/i }).first().click();
  await page.getByRole("radio", { name: /ranger/i }).click();
  await page.getByRole("button", { name: /play as guest/i }).first().click();
  // onboarding overlay must appear and then disappear (guest wristband)
  const sawOverlay = await page.getByText(/getting your wristband/i).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  await sleep(600); await shot(page, "2-onboarding");
  check("onboarding overlay shown", sawOverlay);
  await page.getByText(/getting your wristband/i).first().waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
  check("onboarding finished (overlay gone)", await page.getByText(/getting your wristband/i).count() === 0);
  await sleep(1500);
  await page.getByRole("button", { name: /^choose /i }).first().click({ timeout: 20000 });
  await sleep(5500); await shot(page, "3-globe");
  // pick a route
  for (let i = 0; i < 6; i++) {
    const single = page.locator("button.pin:not(.pin-cluster)");
    const pin = (await single.count()) > 0 ? single.first() : page.locator("button.pin").first();
    await pin.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    await sleep(1500);
    if (await page.getByRole("button", { name: /enter route/i }).isVisible().catch(() => false)) break;
  }
  await page.getByRole("button", { name: /enter route/i }).first().click({ timeout: 20000 });
  await sleep(8000); await shot(page, "4-overworld");
  const hasHook = await page.evaluate(() => !!(window as any).__game);
  if (hasHook) {
    await page.evaluate(() => { const g = (window as any).__game; const s = g.scene.getScene("Overworld"); void s.guarded.call(s, () => s.wildEncounter.call(s, 2)); });
  } else {
    // production build: walk the route like a player until grass triggers an encounter (the Proof Strip appears in battle)
    const hudGone = async () => (await page.getByText(/ROLLUP · devnet/).count()) > 0;
    const hold = async (k: string, tiles: number) => { await page.keyboard.down(k); await sleep(tiles * 260); await page.keyboard.up(k); };
    const t0 = Date.now(); let dir = "ArrowRight"; let started = false;
    await hold("ArrowDown", 4);
    while (!started && Date.now() - t0 < 240000) {
      for (let i = 0; i < 8 && !started; i++) { await hold(dir, 1); await page.keyboard.press("z"); started = await hudGone(); }
      dir = dir === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
      if (!started) { await hold(Math.random() < 0.8 ? "ArrowDown" : "ArrowUp", 2); started = await hudGone(); }
    }
    check("walked into an encounter", started);
  }
  await sleep(9000); await shot(page, "5-battle-onchain");
  // play: Enter = FIGHT, Enter = first move; repeat until the match ends
  for (let i = 0; i < 40; i++) { await page.keyboard.press("Enter"); await sleep(900); if (i % 6 === 5) await shot(page, "6-mid"); }
  await sleep(4000); await shot(page, "7-end");

  const key = await page.evaluate(() => window.localStorage.getItem("pokestonksss.guestkey.v1"));
  const pk = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(key!))).publicKey;
  const client = new GameClient(devnetConfig("as"));
  const [t, a] = await Promise.all([client.getTrainer(pk), client.getArena(pk)]);
  check("guest Trainer exists on the rollup", !!t);
  check("avatar choice (Ranger = 2) is stored on chain", t?.avatar === 2, `avatar ${t?.avatar}`);
  if (process.env.DEMO) check("demo win gave XP", (t?.xp.reduce((x, y) => x + y, 0) ?? 0) > 0, `xp ${t?.xp.join(",")}`);
  check("a real on-chain battle was played from the UI", !!a && a.log.length > 0, `turns logged ${a?.log.length}, phase ${a?.phase}, trainer battles ${t?.battles}`);
  check("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

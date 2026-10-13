/**
 * Records a captioned walkthrough of the live game as a demo video draft:
 * guest onboarding, a judge-demo battle with the Proof panel, the win screen (XP, level up, trophy token),
 * then the one-click Private ER self-test. Output: docs/media/pokestonksss-demo.mp4. BASE_URL=http://localhost:3211
 */
import { chromium, type Page } from "playwright-core";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3211";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CAP_JS = `(() => {
  const mk = () => {
    if (document.getElementById('demo-cap') || !document.body) return;
    const d = document.createElement('div'); d.id = 'demo-cap';
    d.style.cssText = 'position:fixed;left:50%;top:58px;transform:translateX(-50%);max-width:1040px;z-index:2147483647;' +
      'background:rgba(11,16,48,.9);color:#f8f8d0;border:3px solid #d8a830;box-shadow:4px 4px 0 #0b1030;' +
      'font:600 23px/1.35 system-ui,sans-serif;padding:12px 20px;text-align:center;display:none;pointer-events:none';
    document.body.appendChild(d);
  };
  window.__cap = (t) => { mk(); const d = document.getElementById('demo-cap'); if (!d) return; d.textContent = t || ''; d.style.display = t ? 'block' : 'none'; };
  document.addEventListener('DOMContentLoaded', mk);
})();`;

async function cap(page: Page, text: string) {
  await page.evaluate((t) => (window as any).__cap?.(t), text).catch(() => {});
}

(async () => {
  mkdirSync("../docs/media/rec", { recursive: true });
  const browser = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: "../docs/media/rec", size: { width: 1280, height: 720 } } });
  await ctx.addInitScript(CAP_JS);
  const page = await ctx.newPage();

  // 0. title card
  await page.goto(BASE + "/media/banner.png");
  await sleep(500);
  await cap(page, "PokeStonksss: a crypto creature battler where MagicBlock rollups are the whole game server.");
  await sleep(4500);

  // 1. guest onboarding
  await page.goto(BASE + "/?demo=1", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  await cap(page, "Play as a guest in one click. No wallet, no popups. (A wallet works too: one approval, then a session key signs every move.)");
  await sleep(2000);
  await page.getByRole("button", { name: /^play/i }).first().click();
  await sleep(1200);
  await page.getByRole("radio", { name: /quant/i }).click();
  await sleep(1200);
  await page.getByRole("button", { name: /play as guest/i }).first().click();
  await cap(page, "One-time setup: your Trainer is created on Solana and delegated to a MagicBlock Ephemeral Rollup.");
  await page.getByText(/getting your wristband/i).first().waitFor({ state: "hidden", timeout: 70000 }).catch(() => {});
  await sleep(1200);
  await cap(page, "8 BrokerMon, each tied to a live asset price: SOL, BTC, ETH, SUI, ZEC, BNB, DOGE, XRP.");
  await sleep(2500);
  await page.getByRole("button", { name: /^choose /i }).first().click({ timeout: 20000 });
  await sleep(4500);

  // 2. route and encounter
  await cap(page, "Pick a route on the globe and walk into the tall grass.");
  for (let i = 0; i < 6; i++) {
    const single = page.locator("button.pin:not(.pin-cluster)");
    const pin = (await single.count()) > 0 ? single.first() : page.locator("button.pin").first();
    await pin.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    await sleep(1500);
    if (await page.getByRole("button", { name: /enter route/i }).isVisible().catch(() => false)) break;
  }
  await page.getByRole("button", { name: /enter route/i }).first().click({ timeout: 20000 });
  await sleep(6500);
  await page.evaluate(() => { const g = (window as any).__game; const s = g.scene.getScene("Overworld"); void s.guarded.call(s, () => s.wildEncounter.call(s, 2)); });
  await cap(page, "A wild BrokerMon! From here every move is a rollup transaction, confirmed in about 250 ms.");
  await sleep(8500);

  // 3. battle with the proof panel
  await cap(page, "Your pick is locked first, then MagicBlock VRF rolls the dice. Live oracle prices swing damage by 10%.");
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Enter"); await sleep(900); }
  await sleep(2500);
  const proof = page.getByRole("button", { name: /^proof$/i }).first();
  if (await proof.isVisible().catch(() => false)) {
    await proof.click();
    await cap(page, "Proof panel: every step links to the explorer. Rollup moves, VRF rolls, oracle prices, commit to Solana.");
    await sleep(5500);
    await page.locator('button[aria-expanded="true"]').first().click().catch(() => {});
    // keep Enter for the game, not for the Proof toggle that still has focus
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  await cap(page, "This is the judge demo: the opponent never attacks, so anyone can see the whole flow in a few turns.");
  let ended = false;
  for (let i = 0; i < 40 && !ended; i++) {
    await page.keyboard.press("Enter"); await sleep(950);
    ended = await page.evaluate(() => !!(window as any).__game?.scene?.getScene("Battle")?.overlay).catch(() => false);
  }
  await cap(page, "Win: XP and a level up, and the asset you beat is minted to your wallet as a trophy token. No claim button.");
  await sleep(10000);

  // 4. Private ER self-test
  await page.goto(BASE + "/judge", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  await cap(page, "The show-stopper: sealed 1v1 duels inside a MagicBlock Private Ephemeral Rollup (Intel TDX TEE).");
  await page.locator("h2:has-text('Private ER self-test')").scrollIntoViewIfNeeded();
  await sleep(2500);
  await page.getByRole("button", { name: /run private er self-test/i }).click();
  await cap(page, "One click plays a whole sealed duel: VRF seed on Solana, delegation to the TEE, private permissions on each pick.");
  const t0 = Date.now();
  let shownPeek = false;
  while (Date.now() - t0 < 90000) {
    await sleep(1000);
    await page.mouse.wheel(0, 140);
    const txt = await page.locator("h2:has-text('Private ER self-test') ~ ol").innerText().catch(() => "");
    if (!shownPeek && /Peek proof: an anonymous/.test(txt)) { shownPeek = true; await cap(page, "Peek proofs: the opponent, a stranger and an anonymous reader all get null. Only the owner can read a pick."); }
    if (/Replay with the shared Rust rules|stopped/.test(txt)) break;
  }
  await page.mouse.wheel(0, 2000);
  await cap(page, "Every roll recomputes from the VRF seed and both sealed nonces, and the result is committed to Solana.");
  await sleep(6000);

  // 5. end card
  await page.goto(BASE + "/media/logo.png");
  await sleep(400);
  await cap(page, "Try it yourself, no wallet needed: pokestonksss.vercel.app/judges");
  await sleep(5000);

  const video = page.video();
  await ctx.close();
  await browser.close();
  const webm = await video!.path();
  renameSync(webm, "../docs/media/rec/demo.webm");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "../docs/media/rec/demo.webm", "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "../docs/media/pokestonksss-demo.mp4"]);
  console.log("video written: docs/media/pokestonksss-demo.mp4");
})().catch((e) => { console.error(e); process.exit(1); });

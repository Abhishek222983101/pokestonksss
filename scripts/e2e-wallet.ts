/**
 * Wallet flow e2e in a real browser: a mock Wallet Standard wallet (backed by a local keypair, signing in Node) is
 * connected from the start dialog. Checks: ONE wallet signature for create + delegate + session key, the Trainer is
 * owned by the wallet, the battle is signed by the session key (zero further wallet signatures), XP is awarded and a
 * badge token lands in the wallet. BASE_URL=http://localhost:3210 pnpm e2e:wallet
 */
import { chromium, type Page } from "playwright-core";
import { homedir } from "node:os";
import { Keypair, Transaction } from "@solana/web3.js";
import { ataOf, badgeMintPda, devnetConfig, GameClient } from "@pokestonksss/sdk";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const exe = `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = (p: Page, n: string) => p.screenshot({ path: `../docs/fidelity/wallet-${n}.png` });
let failed = false;
const check = (name: string, ok: boolean, d = "") => { console.log(`${ok ? "✓" : "✗"} ${name} ${d}`); if (!ok) failed = true; };

(async () => {
  const W = Keypair.generate();
  let signCalls = 0;
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await page.exposeFunction("__mockSign", (bytes: number[]) => {
    signCalls++;
    const tx = Transaction.from(Buffer.from(bytes));
    tx.partialSign(W);
    return Array.from(tx.serialize({ requireAllSignatures: false }));
  });
  // plain JS string: tsx would inject a `__name` helper into a function body that the page does not have
  const init = `(() => {
    const address = ${JSON.stringify(W.publicKey.toBase58())};
    const publicKey = new Uint8Array(${JSON.stringify(Array.from(W.publicKey.toBytes()))});
    const account = { address, publicKey, chains: ["solana:devnet"], features: ["solana:signTransaction"] };
    const icon = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjOTk0NWZmIi8+PC9zdmc+";
    const wallet = {
      version: "1.0.0", name: "MockWallet", icon, chains: ["solana:devnet"], accounts: [account],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signTransaction": {
          version: "1.0.0", supportedTransactionVersions: ["legacy"],
          signTransaction: async (...inputs) => {
            const out = [];
            for (const i of inputs) out.push({ signedTransaction: new Uint8Array(await window.__mockSign(Array.from(i.transaction))) });
            return out;
          },
        },
      },
    };
    const register = (api) => api.register(wallet);
    window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  })();`;
  await page.addInitScript(init);

  await page.goto(BASE + "/?demo=1", { waitUntil: "domcontentloaded" });
  await sleep(3500);
  await page.getByRole("button", { name: /^play/i }).first().click();
  await sleep(500); await shot(page, "1-dialog");
  const hasWallet = await page.getByRole("button", { name: /mockwallet/i }).count();
  check("the wallet shows up in the start dialog", hasWallet > 0);
  await page.getByRole("radio", { name: /degen/i }).click();
  await page.getByRole("button", { name: /mockwallet/i }).first().click();
  const t0 = Date.now();
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error", m.text().slice(0, 300)); });
  await page.getByRole("button", { name: /^choose /i }).first().waitFor({ timeout: 40000 }).catch(async () => { await shot(page, "dbg"); console.log("signCalls", signCalls, await page.locator("[role=alert]").allTextContents()); throw new Error("not ready"); });
  check("wallet linked and game ready", true, `${Math.round((Date.now() - t0) / 1000)} s`);
  check("exactly ONE wallet signature for create + delegate + session", signCalls === 1, `signTransaction calls: ${signCalls}`);
  const client = new GameClient(devnetConfig("as"));
  const [t] = await Promise.all([client.getTrainer(W.publicKey)]);
  check("Trainer is owned by the wallet and on the rollup", t?.owner === W.publicKey.toBase58(), `avatar ${t?.avatar}`);
  check("avatar (Degen = 4) stored on chain", t?.avatar === 4);

  await page.getByRole("button", { name: /^choose /i }).first().click();
  await sleep(5500);
  await shot(page, "2-hud-wallet");
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
  await sleep(9000);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Enter"); await sleep(900);
    const t = await page.evaluate(() => (window as any).__game?.scene?.getScene("Battle")?.overlay ? 1 : 0).catch(() => 0);
    if (t) { await sleep(9000); await shot(page, "3-end"); break; }
  }
  await sleep(6000);
  const [t2, a] = await Promise.all([client.getTrainer(W.publicKey), client.getArena(W.publicKey)]);
  check("battle played on chain for the wallet's Trainer", !!a && a.log.length > 0 && (t2?.battles ?? 0) >= 1, `turns ${a?.log.length}, battles ${t2?.battles}`);
  check("the battle needed ZERO more wallet signatures (session key signed)", signCalls === 1, `signTransaction calls: ${signCalls}`);
  check("XP awarded", (t2?.xp.reduce((x, y) => x + y, 0) ?? 0) > 0, `xp ${t2?.xp.join(",")}`);
  const bal = await client.base.getTokenAccountBalance(ataOf(W.publicKey, badgeMintPda(0, client.cfg.programId))).catch(() => null);
  check("First Blood badge token is in the wallet", bal?.value.uiAmount === 1, `balance ${bal?.value.uiAmount}`);
  check("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/** Two real browsers: host opens "Duel a friend", guest joins via the invite link, both play a sealed duel to the end. */
import { chromium, type Page } from "playwright-core";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";
import { devnetConfig, GameClient, SEALED, SealedClient } from "@pokestonksss/sdk";
import { PublicKey } from "@solana/web3.js";
const PRIVATE = (process.env.MODE ?? "private") === "private";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const exe = `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "✓" : "✗"} ${n} ${d}`); if (!ok) failed = true; };

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostCtx.newPage(), guest = await guestCtx.newPage();
  const errs: string[] = [];
  for (const [n, p] of [["host", host], ["guest", guest]] as const) { p.on("pageerror", (e) => errs.push(n + ": " + e.message.slice(0, 140))); p.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log(`  [${n} console.${m.type()}]`, m.text().slice(0, 220)); }); }

  await host.goto(BASE, { waitUntil: "domcontentloaded" }); await sleep(3500);
  await host.getByRole("button", { name: /^play/i }).first().click();
  await host.getByRole("button", { name: /play as guest/i }).first().click();
  await host.getByText(/getting your wristband/i).first().waitFor({ state: "hidden", timeout: 70000 }).catch(() => {});
  await sleep(1500);
  await host.getByRole("button", { name: /^choose /i }).first().click({ timeout: 20000 });
  await sleep(5500);
  await host.getByRole("button", { name: /duel a friend/i }).click({ timeout: 20000 });
  if (!PRIVATE) await host.getByRole("radio", { name: /rollup duel/i }).click();
  const link = await host.getByLabel("Invite link").inputValue({ timeout: 60000 });
  check("host got an invite link", link.includes(PRIVATE ? "/p/" : "/d/"), link.slice(0, 80));
  await host.screenshot({ path: "../docs/fidelity/duel-1-host-invite.png" });

  await guest.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "domcontentloaded" });
  const joinBtn = guest.getByRole("button", { name: PRIVATE ? /^join private duel$/i : /^join duel$/i });
  await joinBtn.waitFor({ timeout: 90000 });
  await guest.screenshot({ path: "../docs/fidelity/duel-2-guest-landing.png" });
  await joinBtn.click();
  await sleep(10000);
  await host.screenshot({ path: "../docs/fidelity/duel-3-host-battle.png" });
  await guest.screenshot({ path: "../docs/fidelity/duel-4-guest-battle.png" });

  const client = new GameClient(devnetConfig("as"));
  if (PRIVATE) {
    const hostPk = new PublicKey(new URL(link).pathname.split("/")[2]);
    const sealed = new SealedClient(client);
    let d = await sealed.readDuel(hostPk, "base");
    for (let i = 0; i < 120 && !(d && d.status === SEALED.FINISHED && (await client.base.getAccountInfo(sealed.duel(hostPk)))?.owner.equals(client.cfg.programId)); i++) {
      for (const p of [host, guest]) await p.keyboard.press("Enter");
      await sleep(1100);
      if (i % 4 === 3) d = await sealed.readDuel(hostPk, "base");
    }
    await sleep(4000);
    await host.screenshot({ path: "../docs/fidelity/duel-5-host-end.png" });
    await guest.screenshot({ path: "../docs/fidelity/duel-6-guest-end.png" });
    d = await sealed.readDuel(hostPk, "base");
    check("PRIVATE duel finished inside the TEE and was committed to Solana from two browsers", d?.status === SEALED.FINISHED, `turns ${d?.log.length}, winner seat ${d?.winner}`);
    check("the committed log has turns", (d?.log.length ?? 0) > 0);
  } else {
    const hostKey = await host.evaluate(() => window.localStorage.getItem("pokestonksss.guestkey.v1"));
    const pk = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(hostKey!))).publicKey;
    let phase = -1, turns = 0;
    for (let i = 0; i < 90 && phase !== 5; i++) {
      for (const p of [host, guest]) await p.keyboard.press("Enter");
      await sleep(1100);
      if (i % 3 === 2) { const a = await client.getArena(pk); phase = a?.phase ?? -1; turns = a?.log.length ?? 0; }
    }
    await host.screenshot({ path: "../docs/fidelity/duel-5-host-end.png" });
    await guest.screenshot({ path: "../docs/fidelity/duel-6-guest-end.png" });
    const a = await client.getArena(pk);
    check("sealed duel completed on-chain from two browsers", a?.phase === 5, `turns ${a?.log.length}, winner seat ${a?.winner}`);
    void turns;
  }
  check("no uncaught page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

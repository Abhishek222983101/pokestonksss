/**
 * Fidelity gate (BUILD-PLAN P6.8): screenshots title / select / globe / overworld / battle at 1280x800 and
 * 390x844 for the live PokeStonks and for the local build, saved to docs/fidelity/.
 *
 *   node --experimental-strip-types scripts/fidelity.ts [--only=local|live] [--local=http://localhost:3100]
 *
 * Needs the local app running (pnpm --filter web dev -p 3100). Uses the cached Chromium via playwright-core.
 * The local build exposes window.__game in dev, which is how the local battle is triggered; the live site
 * has no hook, so the script walks the route until the encounter fires (random, up to ~3 minutes).
 */
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('playwright-core') as typeof import('playwright-core');
type Page = import('playwright-core').Page;

const arg = (name: string, d: string) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${d}`).split('=').slice(1).join('=');
const ONLY = arg('only', 'both');
const FORM = arg('form', 'both');
const LOCAL = arg('local', 'http://localhost:3100');
const LIVE = 'https://pokestonkss.vercel.app';
const OUT = path.join(root, 'docs/fidelity');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
} as const;

function chromePath(): string {
  const base = path.join(os.homedir(), '.cache/ms-playwright/chromium-1243');
  const dir = readdirSync(base).find((d) => d.startsWith('chrome-linux'));
  const p = path.join(base, dir ?? 'chrome-linux64', 'chrome');
  if (!existsSync(p)) throw new Error(`chromium not found at ${p}`);
  return p;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function click(page: Page, name: RegExp | string, opts: { role?: 'button' | 'radio' } = {}) {
  const loc = page.getByRole(opts.role ?? 'button', { name });
  await loc.first().click({ timeout: 20_000 });
}

async function run(target: 'live' | 'local', form: keyof typeof VIEWPORTS) {
  const url = target === 'live' ? LIVE : LOCAL;
  const tag = `${target}-${form}`;
  const shot = async (page: Page, step: string) => {
    const file = path.join(OUT, `${tag}-${step}.png`);
    await page.screenshot({ path: file });
    console.log('  saved', path.relative(root, file));
  };
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ ...VIEWPORTS[form], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('  navigated', f.url()); });
  page.on('pageerror', (e) => console.log(`  [${tag}] pageerror:`, e.message.slice(0, 200)));
  console.log(`== ${tag}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(3500);
    await shot(page, '1-title');

    await click(page, /play as guest/i);
    await sleep(2500);
    await shot(page, '2-select');

    await click(page, /^choose /i);
    await sleep(5500); // camera pull-in + pixel field dissolve + pins
    await shot(page, '3-globe');

    await pickRoute(page);
    await shot(page, '3b-globe-sheet');
    await click(page, /enter route/i);
    await sleep(target === 'live' ? 9000 : 8000);
    await shot(page, '4-overworld');

    if (target === 'local') {
      await page.evaluate(() => {
        const g = (window as unknown as { __game: { scene: { getScene(k: string): Record<string, (...a: unknown[]) => unknown> } } }).__game;
        const s = g.scene.getScene('Overworld');
        void (s.guarded as (fn: () => unknown) => unknown).call(s, () => (s.wildEncounter as (n: number) => unknown).call(s, 2));
      });
      await sleep(3800);
      await shot(page, '5a-versus');
      await sleep(5200);
      await shot(page, '5-battle');
      // open the move list too (Enter = FIGHT)
      await page.keyboard.press('Enter');
      await sleep(700);
      await shot(page, '5b-moves');
    } else {
      await walkUntilBattle(page);
      await sleep(30_000); // matchmaking: bot fills after ~20s on the live server
      await shot(page, '5-battle');
    }
  } catch (e) {
    console.log(`  [${tag}] step failed:`, (e as Error).message.split('\n')[0]);
    await shot(page, 'failure').catch(() => {});
  } finally {
    await browser.close();
  }
}

/** Click a pin (clusters zoom in first) until the route sheet with "Enter route" is open. */
async function pickRoute(page: Page) {
  for (let i = 0; i < 6; i++) {
    const single = page.locator('button.pin:not(.pin-cluster)');
    const pin = (await single.count()) > 0 ? single.first() : page.locator('button.pin').first();
    await pin.evaluate((el: HTMLElement) => el.click());
    await sleep(2200);
    if (await page.getByRole('button', { name: /enter route/i }).isVisible().catch(() => false)) return;
  }
  throw new Error('could not open a route sheet');
}

/**
 * Live site only: sweep the route in a lawnmower pattern until the encounter starts (the React HUD hides
 * during battles; there is no debug hook on the deployed build). Keys are held ~260ms per tile.
 */
async function walkUntilBattle(page: Page) {
  const hudGone = async () => (await page.locator('aside[aria-label="Wallet and controls"]').count()) === 0;
  const hold = async (key: string, tiles: number) => {
    await page.keyboard.down(key);
    await sleep(tiles * 260);
    await page.keyboard.up(key);
  };
  const started = Date.now();
  await hold('ArrowDown', 4);
  let dir = 'ArrowRight';
  while (Date.now() - started < 300_000) {
    for (let i = 0; i < 8; i++) {
      await hold(dir, 1);
      await page.keyboard.press('z'); // advances trainer dialogs that would otherwise block the sweep
      if (await hudGone()) { console.log('  encounter started'); return; }
    }
    dir = dir === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
    await hold(Math.random() < 0.8 ? 'ArrowDown' : 'ArrowUp', 2);
    if (await hudGone()) { console.log('  encounter started'); return; }
  }
  throw new Error('no encounter within 5 min');
}

for (const target of ['live', 'local'] as const) {
  if (ONLY !== 'both' && ONLY !== target) continue;
  for (const form of ['desktop', 'mobile'] as const) if (FORM === 'both' || FORM === form) await run(target, form);
}

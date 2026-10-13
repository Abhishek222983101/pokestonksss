/** Renders caption PNGs (transparent) in the demo's caption style. Usage: tsx render-captions.ts <outDir> <json [{name,text,width}]> */
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
(async () => {
  const [outDir, file] = process.argv.slice(2);
  const caps: Array<{ name: string; text: string; width?: number }> = JSON.parse(readFileSync(file, "utf8"));
  const browser = await chromium.launch({ executablePath: `${homedir()}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 400 } });
  for (const c of caps) {
    await page.setContent(`<html><body style="margin:0;background:transparent"><div id="c" style="display:inline-block;max-width:${c.width ?? 1180}px;
      background:rgba(11,16,48,.92);color:#f8f8d0;border:3px solid #d8a830;box-shadow:4px 4px 0 #050818;
      font:600 23px/1.35 system-ui,sans-serif;padding:10px 20px;text-align:center">${c.text}</div></body></html>`);
    await page.locator("#c").screenshot({ path: `${outDir}/${c.name}.png`, omitBackground: true });
  }
  await browser.close();
  console.log("captions:", caps.length);
})();

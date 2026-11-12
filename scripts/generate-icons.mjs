// Renders the PWA icons (dark background, map pin) to PNG with headless Chrome.
// Run: node scripts/generate-icons.mjs   (writes public/icons/*.png)
// Uses the playwright devDependency with the system Chrome, so nothing is downloaded.

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BG = "#0f172a";

/** A map pin centred in a 100×100 box, scaled to `scale` of the icon. */
function svg(scale) {
  const offset = (100 - 100 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" style="display:block">
  <rect width="100" height="100" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M50 6C32.3 6 18 20.1 18 37.6 18 61 50 94 50 94s32-33 32-56.4C82 20.1 67.7 6 50 6z" fill="#f59e0b"/>
    <circle cx="50" cy="37" r="13" fill="${BG}"/>
  </g>
</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, scale: 0.7 },
  { file: "icon-512.png", size: 512, scale: 0.7 },
  // Maskable: the pin stays inside the 80% safe zone; the background is full bleed.
  { file: "icon-maskable-512.png", size: 512, scale: 0.5 },
];

mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? "chrome", headless: true });
try {
  for (const { file, size, scale } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">${svg(scale)}</body></html>`,
    );
    await page.screenshot({ path: `public/icons/${file}`, type: "png" });
    await page.close();
    console.log(`public/icons/${file}`);
  }
} finally {
  await browser.close();
}

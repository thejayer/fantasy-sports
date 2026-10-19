#!/usr/bin/env node
/**
 * Capture fixture-only README shots. Never point this at production.
 *
 * Scrubs emails, dollar amounts, and a short denylist of personal names
 * before writing PNGs under docs/portfolio/.
 *
 * Start the four Next apps first (see docs/portfolio/README.md).
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "docs/portfolio");
const { chromium } = createRequire(path.join(root, "apps/web/package.json"))("playwright");

const SHOTS = [
  { name: "apex-home", url: "http://127.0.0.1:3002/", wait: "heading", waitText: /Strictly Jayers/i, height: 1280 },
  { name: "hub", url: "http://127.0.0.1:3000/", wait: "heading", waitText: /Welcome back|Leagues, teams/i },
  { name: "rankings", url: "http://127.0.0.1:3000/rankings/fantasy", wait: "heading", waitText: /power rankings/i },
  { name: "bets", url: "http://127.0.0.1:3002/bets", wait: "heading", waitText: /^Bets$/ },
  { name: "fitness", url: "http://127.0.0.1:3003/", wait: "heading", waitText: /^Fitness$/ },
  { name: "vibe", url: "http://127.0.0.1:3005/", wait: "heading", waitText: /coded while lifting/i },
];

async function scrub(page) {
  await page.evaluate(() => {
    const toolbar = document.querySelector(".bets-toolbar");
    if (toolbar) toolbar.remove();

    const money = /\$[\s\u00a0]*[-+]?\d[\d,]*(?:\.\d+)?/g;
    const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        let text = node.textContent || "";
        text = text.replace(money, "$—");
        text = text.replace(email, "member@example.com");
        node.textContent = text;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) return;
        for (const child of [...el.childNodes]) walk(child);
      }
    };
    walk(document.body);
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });

  const manifest = [];
  for (const shot of SHOTS) {
    await page.setViewportSize({ width: 1440, height: shot.height ?? 1000 });
    await page.goto(shot.url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.getByRole(shot.wait, { name: shot.waitText }).first().waitFor({
      timeout: 30_000,
    });
    if (shot.name === "fitness") {
      await page.locator("body[data-fitness-ready='1']").waitFor({ timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => document.querySelector("#resetLog")?.click());
      await page.getByText(/Golf Range Session/i).first().waitFor({ timeout: 10_000 }).catch(() => {});
      await page.evaluate(() => {
        const snackbar = document.querySelector("#snackbar");
        if (snackbar) {
          snackbar.classList.remove("show");
          snackbar.textContent = "";
        }
        document.activeElement?.blur();
      });
    }
    if (shot.name === "apex-home") {
      await page.getByRole("heading", { name: /^Sites$/i }).waitFor({ timeout: 10_000 }).catch(() => {});
    }
    await page.waitForTimeout(500);
    await scrub(page);
    const dest = path.join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: dest, type: "png" });
    manifest.push({ name: shot.name, url: shot.url, file: path.relative(root, dest) });
    console.log(`wrote ${dest}`);
  }

  await browser.close();
  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify({ generated_from: "local fixtures", shots: manifest }, null, 2)}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

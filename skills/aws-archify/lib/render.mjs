/*
 * render.mjs — headless Chrome/Edge: screenshot + validator verdict.
 *
 * No puppeteer, no npm install. Every machine that can open the diagram in a
 * browser can render it, which is the whole reason the format is HTML.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ],
};

export function findBrowser() {
  if (process.env.AWS_ARCHIFY_CHROME) {
    if (!existsSync(process.env.AWS_ARCHIFY_CHROME)) {
      throw new Error(`AWS_ARCHIFY_CHROME points at a file that does not exist: ${process.env.AWS_ARCHIFY_CHROME}`);
    }
    return process.env.AWS_ARCHIFY_CHROME;
  }
  const found = (CANDIDATES[process.platform] || CANDIDATES.linux).find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'no Chrome or Edge found. Install one, or set AWS_ARCHIFY_CHROME to its executable path.'
    );
  }
  return found;
}

const BASE_FLAGS = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=6000',
];

/**
 * Capture `htmlPath` to `pngPath`.
 * @param {{width:number,height:number,scale:number,dark?:boolean}} opts
 */
export async function screenshot(htmlPath, pngPath, opts) {
  const browser = findBrowser();
  const url = pathToFileURL(htmlPath).href;
  // Chrome fails silently rather than creating a missing output directory.
  mkdirSync(dirname(pngPath), { recursive: true });
  const args = [
    ...BASE_FLAGS,
    `--window-size=${Math.round(opts.width * opts.scale)},${Math.round(opts.height * opts.scale)}`,
    `--force-device-scale-factor=${opts.scale}`,
    '--default-background-color=FFFFFFFF',
    `--screenshot=${pngPath}`,
    url,
  ];
  await run(browser, args, { maxBuffer: 64 * 1024 * 1024 }).catch((e) => {
    // Chrome exits non-zero on some platforms even after writing the PNG.
    if (!existsSync(pngPath)) throw e;
  });
  if (!existsSync(pngPath)) throw new Error(`Chrome did not write ${pngPath}`);
  return pngPath;
}

/**
 * Read the validator verdict the runtime stamps onto <title>.
 * @returns {Promise<{ok:boolean, status:string, issues:string[]}>}
 */
export async function verdict(htmlPath) {
  const browser = findBrowser();
  const url = pathToFileURL(htmlPath).href;
  const { stdout } = await run(browser, [...BASE_FLAGS, '--dump-dom', url], {
    maxBuffer: 128 * 1024 * 1024,
  });

  const title = /<title>([^<]*)<\/title>/i.exec(stdout);
  const banner = /<div id="diagram-validation-banner"[^>]*>([\s\S]*?)<\/div>/i.exec(stdout);
  const issues = banner
    ? banner[1]
        .split('\n')
        .map((l) => l.replace(/^\s*[•·]\s*/, '').trim())
        .filter((l) => l && !/^VALIDATION FAILED/i.test(l))
        .map((l) => l.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'))
    : [];

  const t = title ? title[1] : '';
  if (/^PASS\b/.test(t)) return { ok: true, status: 'PASS', issues: [] };
  if (/^FAIL\(/.test(t)) return { ok: false, status: t.split(' - ')[0], issues };
  return { ok: false, status: 'UNKNOWN', issues: ['the runtime did not report a verdict — open the HTML and check the console'] };
}

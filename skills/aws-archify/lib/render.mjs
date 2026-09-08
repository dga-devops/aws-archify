/*
 * render.mjs — headless Chrome/Edge: screenshot + validator verdict.
 *
 * No puppeteer, no npm install. Every machine that can open the diagram in a
 * browser can render it, which is the whole reason the format is HTML.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
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

/** True only when `p` is a non-empty regular file. */
function wrote(p) {
  if (!existsSync(p)) return false;
  const st = statSync(p);
  return st.isFile() && st.size > 0;
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
    if (!wrote(pngPath)) throw e;
  });
  // Existence alone is not proof: point --screenshot at a directory and Chrome
  // writes nothing while the path still "exists", which once reported success
  // for an empty output.
  if (!wrote(pngPath)) throw new Error(`Chrome did not write a PNG at ${pngPath}`);
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
  const t = title ? title[1] : '';

  // The runtime writes its findings into a JSON script element; that is the
  // channel of record. The <title> stamp is only the quick yes/no.
  const sink = /<script type="application\/json" id="diagram-diagnostics">([\s\S]*?)<\/script>/i.exec(stdout);
  let errors = [], warnings = [];
  if (sink) {
    try {
      const parsed = JSON.parse(sink[1]);
      errors = parsed.errors || [];
      warnings = parsed.warnings || [];
    } catch {
      errors = [{ code: 'runtime/diagnostics', severity: 'error', subject: 'diagram-lib', message: 'diagnostics were emitted but could not be parsed', evidence: {}, fixes: [] }];
    }
  }

  const issues = errors.map((d) => d.message);
  if (/^PASS\b/.test(t)) return { ok: true, status: 'PASS', issues: [], errors: [], warnings };
  if (/^FAIL\(/.test(t)) return { ok: false, status: t.split(' - ')[0], issues, errors, warnings };
  return {
    ok: false,
    status: 'UNKNOWN',
    issues: ['the runtime did not report a verdict — open the HTML and check the console'],
    errors: [{ code: 'runtime/no-verdict', severity: 'error', subject: 'diagram-lib', message: 'no verdict was reported', evidence: {}, fixes: [] }],
    warnings,
  };
}

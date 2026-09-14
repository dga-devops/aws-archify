/*
 * cdp.mjs — just enough of the Chrome DevTools Protocol to drive one page.
 *
 * The one-shot `--screenshot` flag is fine for a still. An animation needs
 * the page kept open while it is seeked frame by frame, so this launches
 * Chrome with a debugging endpoint and talks to it over the WebSocket that
 * Node has shipped built in since v22. Still no dependencies.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const waiters = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej, method } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${method}: ${msg.error.message}`));
        else res(msg.result);
      } else if (msg.method && waiters.has(msg.method)) {
        const list = waiters.get(msg.method);
        waiters.delete(msg.method);
        list.forEach((f) => f(msg.params));
      }
    };
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const i = ++id;
            pending.set(i, { res, rej, method });
            ws.send(JSON.stringify({ id: i, method, params }));
          });
        },
        once(method) {
          return new Promise((res) => {
            const list = waiters.get(method) || [];
            list.push(res);
            waiters.set(method, list);
          });
        },
        close() {
          try { ws.close(); } catch {}
        },
      });
    ws.onerror = () => reject(new Error(`could not connect to Chrome DevTools at ${url}`));
  });
}

/**
 * Launch a private headless Chrome and return a handle on its first page.
 * @returns {Promise<{ send, once, close }>}
 */
export async function launchPage(browserPath) {
  if (typeof WebSocket !== 'function') {
    throw new Error(`animated output needs Node 22 or newer (found ${process.version}): it drives Chrome over the built-in WebSocket`);
  }
  // A private profile: the user's own running Chrome must not be touched,
  // and a shared profile directory would refuse a second instance.
  const profile = mkdtempSync(join(tmpdir(), 'aws-archify-chrome-'));
  const proc = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  const endpoint = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not open a DevTools endpoint within 30s')), 30000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}) before DevTools was ready`)); });
  });

  const port = new URL(endpoint).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('Chrome opened no page target');

  const page = await connect(pageTarget.webSocketDebuggerUrl);
  const browser = await connect(endpoint);

  return {
    send: page.send,
    once: page.once,
    async close() {
      page.close();
      try { await Promise.race([browser.send('Browser.close'), new Promise((r) => setTimeout(r, 3000))]); } catch {}
      browser.close();
      if (proc.exitCode === null) {
        await Promise.race([new Promise((r) => proc.once('exit', r)), new Promise((r) => setTimeout(r, 3000))]);
        if (proc.exitCode === null) proc.kill();
      }
      // Chrome's children can hold files for a moment after exit on Windows
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
    },
  };
}

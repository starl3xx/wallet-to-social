#!/usr/bin/env node
/**
 * The guard that opens a browser.
 *
 * Usage: node scripts/check-control-height.mjs
 *        CHECK_BASE_URL=https://walletlink.social node scripts/check-control-height.mjs
 *
 * ## Why a browser, when four guards already pass
 *
 * `docs/DESIGN-LANGUAGE.md` (Enforcement) says a grep answers "is this value
 * on-system?" and cannot answer "does this render?". On 2026-08-23 that sentence
 * came true. `components/InputMethodPicker.tsx` put `flex-1` on a Button
 * carrying `h-control`, inside a container that is `flex-col` below `sm`.
 * `flex-1` is `flex: 1 1 0%`, and on a flex item the basis supplies the main
 * size, so `height` is never consulted. The two alternates rendered **22px** on
 * every phone width and 34px from `sm` up. The reverse-lookup field, same
 * mistake one card down, rendered 35.5px beside neighbours at 34px: three
 * heights in one control row, which is the exact failure `--height-control` was
 * created to end.
 *
 * Every class involved was on-system. `check-design-language.mjs` reported
 * "12 rules pass" over it, `check-palette-guard.mjs` reported clean, ESLint was
 * quiet, the build was green, and the defect shipped and stayed. No string in
 * the source is wrong. Only the rendered box is, and only below 640px, which is
 * why no desktop review ever saw it.
 *
 * ## What it asserts
 *
 * 1. Every visible element carrying `h-control` renders at exactly that token's
 *    value. Every element carrying `size-control` does so in both dimensions.
 * 2. The page never scrolls sideways ("No horizontal scrollbar on a content
 *    strip, ever").
 *
 * It deliberately checks only elements that *declare* the contract. An element
 * that never asks for the control height is not one, so there is no exception
 * list to maintain and no judgment call about what counts as a control. The
 * responsive forms (`sm:h-control`) are skipped for the same reason: this looks
 * for the promise that applies at the width being measured.
 *
 * ## Why it runs its own fixtures first
 *
 * `check-palette-guard.mjs` exists because this project twice had a guard report
 * clean over live violations, and both times it had only ever been run against
 * code that already passed. So before measuring the app, this measures two
 * fixtures: the 2026-08-23 bug, which it must catch, and the corrected form,
 * which it must not flag. A browser guard has more ways to silently succeed than
 * a grep does. If Chrome fails to attach, or the selector matches nothing, or
 * the settle is too short, the natural result is an empty violation list, which
 * reads exactly like a healthy page.
 *
 * ## Dependencies: none
 *
 * Chrome over the DevTools protocol, driven through Node's built-in WebSocket.
 * The runner images already carry Chrome (Google Chrome 151 on ubuntu-24.04),
 * so there is nothing to install and no browser to download. The alternative was
 * a test-runner dependency and a ~180MB Chromium per CI run, to send the same
 * three CDP messages.
 */
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer } from 'net';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';

/** Sub-pixel slack. Layout lands on thirds at DPR 3; 34 vs 22 needs no more. */
const TOLERANCE = 0.5;

/**
 * Phone widths first, because that is where the bug lived. 320 and 360 are the
 * two the design language names; 390 is the most common phone in use; 768 and
 * 1280 confirm the desktop side of every `sm:` branch.
 */
const VIEWPORTS = [
  { width: 320, height: 844, mobile: true },
  { width: 360, height: 844, mobile: true },
  { width: 390, height: 844, mobile: true },
  { width: 430, height: 932, mobile: true },
  { width: 768, height: 1024, mobile: false },
  { width: 1280, height: 900, mobile: false },
];

/**
 * Public pages that render without a database, so CI needs no secrets.
 * `/holders` is deliberately absent: its params come from a live query, so in a
 * secretless run it is an empty page and would assert nothing while looking
 * like coverage.
 */
const PATHS = ['/', '/check', '/pricing'];

/**
 * The floor that stops a blank page from passing.
 *
 * Without it the arithmetic is: a page that fails to render has no elements, so
 * nothing declares the contract, so nothing is measured, so there are no
 * violations, so the check reports `ok (0 controls at 34px)` and exits 0. **A
 * blank page and a healthy page produce the same verdict**, which is the exact
 * shape of silent success the fixtures exist to prevent, reappearing on the half
 * of the run the fixtures do not cover.
 *
 * The observed counts are 11 to 12 on `/`, 9 on `/check` and 8 on `/pricing`.
 * The homepage varies by one at 320 between macOS and the Linux runner, so this
 * is a floor rather than an equality: it is here to tell a rendered page from an
 * empty one, not to pin a number that legitimately moves when a control wraps
 * out of view.
 */
const MIN_CONTROLS_PER_PAGE = 5;

// ---------------------------------------------------------------------------
// The token, read from the stylesheet that ships
// ---------------------------------------------------------------------------

/**
 * From `globals.css`, not from a copy here, for the reason `check-contrast.mjs`
 * gives: a guard holding its own copy of a value cannot fail when the value
 * moves, which is the one time it needed to.
 */
function controlHeightPx() {
  const css = readFileSync('app/globals.css', 'utf8');
  const m = css.match(/--height-control:\s*([0-9.]+)(rem|px)\s*;/);
  if (!m) {
    fail(
      'No --height-control in app/globals.css. Either it was renamed, in which case rename it here too, or the token is gone, in which case this guard has nothing to check.'
    );
  }
  return m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
}

// ---------------------------------------------------------------------------
// The measurement, as one expression, used on the fixtures and on the app alike
// ---------------------------------------------------------------------------

/**
 * One source for both, on purpose. A fixture proves nothing about the check if
 * it exercises a different code path than the check does.
 *
 * `checkVisibility()` rather than a height test: an element that is legitimately
 * not rendered must be skipped, and an element that has collapsed to zero must
 * be reported. Those are the same number and opposite outcomes.
 */
const MEASURE = (expected, tolerance) => `(() => {
  const EXPECTED = ${expected};
  const TOL = ${tolerance};
  const has = (el, token) => {
    const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
    return new RegExp('(^|\\\\s)' + token + '(\\\\s|$)').test(cls);
  };
  const describe = (el) => {
    const cls = (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '')
      .split(/\\s+/).filter(Boolean).slice(0, 4).join(' ');
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return el.tagName.toLowerCase() + (text ? ' "' + text + '"' : '') + (cls ? ' [' + cls + ']' : '');
  };
  const violations = [];
  let checked = 0;
  for (const el of document.querySelectorAll('*')) {
    const wantsHeight = has(el, 'h-control') || has(el, 'size-control');
    const wantsWidth = has(el, 'size-control') || has(el, 'w-control');
    if (!wantsHeight && !wantsWidth) continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
    const r = el.getBoundingClientRect();
    checked++;
    if (wantsHeight && Math.abs(r.height - EXPECTED) > TOL) {
      violations.push({ axis: 'height', got: +r.height.toFixed(2), el: describe(el) });
    }
    if (wantsWidth && Math.abs(r.width - EXPECTED) > TOL) {
      violations.push({ axis: 'width', got: +r.width.toFixed(2), el: describe(el) });
    }
  }
  const doc = document.documentElement;
  return JSON.stringify({
    checked,
    violations,
    scrollWidth: doc.scrollWidth,
    innerWidth: window.innerWidth,
    tokenOnPage: getComputedStyle(doc).getPropertyValue('--height-control').trim(),
  });
})()`;

// ---------------------------------------------------------------------------
// Chrome, over CDP, with nothing installed
// ---------------------------------------------------------------------------

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    fail(
      'No Chrome found. Looked at:\n  ' +
        CHROME_CANDIDATES.join('\n  ') +
        '\nSet CHROME_PATH, or install Chrome. The GitHub ubuntu runners already carry it.'
    );
  }
  return found;
}

/** Chrome writes the port it actually took here, so nothing has to be free. */
function readDevToolsPort(dir) {
  const f = join(dir, 'DevToolsActivePort');
  if (!existsSync(f)) return null;
  const [port] = readFileSync(f, 'utf8').split('\n');
  return port && /^\d+$/.test(port) ? Number(port) : null;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error
          ? reject(new Error(JSON.stringify(m.error)))
          : resolve(m.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }
      }, 45_000);
    });
  }
  static async attach(port) {
    const target = await (
      await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
        method: 'PUT',
      })
    ).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('CDP socket refused'));
    });
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    return cdp;
  }
}

/**
 * Navigate, then wait for the page to stop moving.
 *
 * `document.fonts.ready` is the load-bearing half. Söhne arrives after first
 * paint, and a control measured against a fallback face is a different number,
 * which is how a browser guard produces confident wrong answers.
 */
async function measure(cdp, url, viewport, expression) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.mobile ? 3 : 1,
    mobile: viewport.mobile,
  });
  await cdp.send('Page.navigate', { url });
  await cdp.send('Runtime.evaluate', {
    expression: `new Promise(r => { if (document.readyState === 'complete') r(); else addEventListener('load', r); }).then(() => document.fonts.ready)`,
    awaitPromise: true,
  });
  await new Promise((r) => setTimeout(r, 1200));
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      'measurement threw: ' + JSON.stringify(res.exceptionDetails)
    );
  }
  return JSON.parse(res.result.value);
}

// ---------------------------------------------------------------------------
// The fixtures: the guard proves itself before it reports on anything
// ---------------------------------------------------------------------------

/**
 * The 2026-08-23 bug, reduced, and its fix. Both use a locally declared token so
 * the fixture stands on its own, and both go through `MEASURE`, which is the
 * expression the real check runs.
 */
function fixtureHtml(broken) {
  const flex = broken ? 'flex-1' : 'sm-flex-1';
  return `<!doctype html><meta name="viewport" content="width=device-width">
<style>
  :root { --height-control: 2.125rem; }
  body { margin: 0; font: 400 14px/1.43 system-ui, sans-serif; }
  .h-control { height: var(--height-control); }
  .size-control { height: var(--height-control); width: var(--height-control); }
  .row { display: flex; flex-direction: column; gap: 8px; width: 342px; }
  .flex-1 { flex: 1 1 0%; }
  @media (min-width: 640px) { .sm-flex-1 { flex: 1 1 0%; } }
  button { box-sizing: border-box; border: 1px solid #999; border-radius: 999px;
           display: inline-flex; align-items: center; justify-content: center; }
</style>
<div class="row">
  <button class="h-control ${flex}">Paste a list</button>
  <button class="h-control ${flex}">Import from a contract</button>
</div>
<div class="row"><button class="size-control">+</button></div>`;
}

async function selfTest(cdp, expected, tmp) {
  const cases = [
    { name: 'the 2026-08-23 bug', broken: true, mustFlag: true },
    { name: 'the corrected form', broken: false, mustFlag: false },
  ];
  const viewport = { width: 390, height: 844, mobile: true };
  const expression = MEASURE(expected, TOLERANCE);

  for (const c of cases) {
    const file = join(tmp, `fixture-${c.broken ? 'broken' : 'fixed'}.html`);
    writeFileSync(file, fixtureHtml(c.broken));
    const r = await measure(cdp, `file://${file}`, viewport, expression);

    if (r.checked !== 3) {
      fail(
        `Fixture "${c.name}" offered 3 controls and the check looked at ${r.checked}. ` +
          'The selector has stopped finding what it is for, so a clean result on the app would mean nothing.'
      );
    }
    const flagged = r.violations.length > 0;
    if (flagged !== c.mustFlag) {
      fail(
        c.mustFlag
          ? `Fixture "${c.name}" reproduces a 22px control and the check passed it. ` +
              'This guard does not work; fix it before trusting any run.'
          : `Fixture "${c.name}" is correct markup and the check flagged it: ` +
              JSON.stringify(r.violations) +
              '. A guard that cries wolf gets switched off.'
      );
    }
    console.log(
      `  ${GREEN}ok${RESET}  fixture: ${c.name} ${DIM}(${c.mustFlag ? `caught ${r.violations.length}` : 'clean'}, 3 controls seen)${RESET}`
    );
  }
}

// ---------------------------------------------------------------------------
// The app under test
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`The app never answered on ${url}. Check the dev server output above.`);
}

/**
 * `next dev`, with `DATABASE_URL` deliberately blanked.
 *
 * CI holds no secrets and should not need any to answer a layout question. The
 * pages in `PATHS` all render without a database: the homepage falls back to the
 * published constants when `/api/public-stats` cannot answer, which is the same
 * path a first paint takes in production.
 */
async function startApp() {
  const port = await freePort();
  /**
   * `detached` so the whole process group can be signalled at the end.
   *
   * `next dev` is a supervisor: Turbopack runs its compile in children of its
   * own, and a SIGTERM to the parent alone leaves those behind holding
   * `.next/dev/lock`. The next run then dies on "Unable to acquire lock", which
   * is a confusing way for a guard to fail and has nothing to do with what it
   * measures. It happened here while this script was being written.
   */
  const child = spawn('npx', ['next', 'dev', '-p', String(port)], {
    env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(d.toString()));
  child.stderr.on('data', (d) => log.push(d.toString()));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(log.join(''));
    }
  });
  await waitForServer(`http://127.0.0.1:${port}/`, 120_000);
  return {
    base: `http://127.0.0.1:${port}`,
    // Negative pid: the whole group, not just the supervisor. See above.
    stop: () => {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`\n${RED}${message}${RESET}\n`);
  process.exit(1);
}

async function main() {
  if (typeof WebSocket === 'undefined') {
    fail(
      'No global WebSocket. This needs Node 22.4 or newer; CI pins node-version: 22.'
    );
  }

  const expected = controlHeightPx();
  console.log(
    `--height-control is ${expected}px, read from app/globals.css.\n`
  );

  const chrome = findChrome();
  const tmp = mkdtempSync(join(tmpdir(), 'wl-control-height-'));
  const profile = join(tmp, 'profile');

  const browser = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let app = null;
  let failures = 0;

  /**
   * Every step of this is wrapped, because cleanup runs on the way out of a
   * failing run too, and a tidy-up that throws would bury the report that
   * matters underneath a stack trace about a temp directory. The first version
   * did exactly that: Chrome is still flushing its profile when the exit handler
   * fires, so `rmSync` raced it and printed ENOTEMPTY after a correct verdict.
   */
  const cleanup = () => {
    try {
      browser.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    try {
      if (app) app.stop();
    } catch {
      /* already gone */
    }
    try {
      rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch {
      /* a leftover temp directory is not worth a non-zero exit */
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  let port = null;
  for (let i = 0; i < 60 && port === null; i++) {
    await new Promise((r) => setTimeout(r, 250));
    port = readDevToolsPort(profile);
  }
  if (port === null)
    fail('Chrome started and never published a DevTools port.');

  const cdp = await Cdp.attach(port);

  console.log('The guard catches what it claims to:');
  await selfTest(cdp, expected, tmp);
  console.log();

  const base = process.env.CHECK_BASE_URL || (app = await startApp()).base;
  console.log(`Measuring ${base}\n`);

  const expression = MEASURE(expected, TOLERANCE);
  let totalChecked = 0;

  for (const path of PATHS) {
    for (const viewport of VIEWPORTS) {
      const r = await measure(cdp, base + path, viewport, expression);
      totalChecked += r.checked;
      const where = `${path} @ ${viewport.width}`;

      if (
        r.tokenOnPage &&
        parseFloat(r.tokenOnPage) * 16 !== expected &&
        r.tokenOnPage !== `${expected}px`
      ) {
        console.log(
          `  ${RED}fail${RESET}  ${where}: the page computes --height-control as ${r.tokenOnPage}, globals.css says ${expected}px`
        );
        failures++;
      }

      if (r.checked < MIN_CONTROLS_PER_PAGE) {
        console.log(
          `  ${RED}fail${RESET}  ${where}: only ${r.checked} control${r.checked === 1 ? '' : 's'} declared the height, expected at least ${MIN_CONTROLS_PER_PAGE}. ` +
            'The page probably did not render, and an empty page has no violations to report.'
        );
        failures++;
      }

      if (r.scrollWidth > r.innerWidth + TOLERANCE) {
        console.log(
          `  ${RED}fail${RESET}  ${where}: scrolls sideways, ${r.scrollWidth}px of content in ${r.innerWidth}px`
        );
        failures++;
      }

      if (r.violations.length === 0) {
        console.log(
          `  ${GREEN}ok${RESET}    ${where} ${DIM}(${r.checked} controls at ${expected}px)${RESET}`
        );
        continue;
      }
      for (const v of r.violations) {
        console.log(
          `  ${RED}fail${RESET}  ${where}: ${v.axis} ${v.got}px, expected ${expected}px — ${v.el}`
        );
        failures++;
      }
    }
  }

  console.log();
  if (failures > 0) {
    fail(
      `${failures} control${failures === 1 ? '' : 's'} did not render at the height ${failures === 1 ? 'it declares' : 'they declare'}.\n\n` +
        'The usual cause is a control that is a flex item on the axis carrying its height.\n' +
        '`flex-1` is `flex: 1 1 0%`, and a flex basis supplies the main size, so `height`\n' +
        'is never consulted: inside a `flex-col` container it silently replaces `h-control`.\n' +
        'Write `sm:flex-1`, or put `flex-1` on a wrapper div and leave the control alone.\n' +
        'See docs/DESIGN-LANGUAGE.md, Control height.'
    );
  }

  console.log(
    `${GREEN}control height holds${RESET} — ${totalChecked} rendered controls across ` +
      `${PATHS.length} pages and ${VIEWPORTS.length} widths, all at ${expected}px, no page scrolls sideways.`
  );

  /**
   * Exit rather than fall off the end.
   *
   * An open CDP socket and a dev server on piped stdio both hold the event loop,
   * so a passing run printed its verdict and then sat there. The failing path
   * always exited, because `fail()` says so, which is the worst arrangement
   * available: green looks like a hang and only red terminates. Cleanup is on
   * the `exit` handler, so it still runs.
   */
  cleanup();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { chromium } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const HUB = 'http://localhost:8771/MechLibrary/';
const COURSE = 'http://localhost:8771/Heat-Transfer/';
const SWFILE = '/tmp/claude-0/-home-claude/9566955c-85cd-501c-8bdf-e56afdb24f92/scratchpad/site2/MechLibrary/sw.js';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
async function ctxOf(extra = {}) {
  return chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], viewport: { width: 1200, height: 800 }, ...extra });
}
const settle = (p, ms = 2500) => p.waitForTimeout(ms);

/* ---------- A. update flow ---------- */
{
  console.log('\n== A. Service worker update flow ==');
  const ctx = await ctxOf(); const page = ctx.pages()[0];
  let navs = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
  await page.addInitScript(() => { window.__upd = 0; const o = ServiceWorkerRegistration.prototype.update; ServiceWorkerRegistration.prototype.update = function () { window.__upd++; return o.apply(this, arguments); }; });
  await page.goto(HUB); await settle(page);
  ok(navs === 1, `first visit: no self-reload (navigations=${navs})`);
  await page.reload(); await settle(page, 1500); navs = 0;           // now controlled by v4
  const orig = fs.readFileSync(SWFILE, 'utf8');
  fs.writeFileSync(SWFILE, orig.replace("const VERSION = 'v4';", "const VERSION = 'v5';"));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await settle(page, 3500);
  const keys = await page.evaluate(() => caches.keys());
  ok(navs === 1, `new SW version -> exactly one automatic reload (navigations=${navs})`);
  ok(JSON.stringify(keys) === '["mechhub-v5"]', `old cache deleted, new cache active (${JSON.stringify(keys)})`);
  navs = 0; await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update())); await settle(page, 2000);
  ok(navs === 0, 'update check with no change -> no reload');
  // visibility re-check, throttled to once an hour
  await page.evaluate(() => { window.__upd = 0; const real = Date.now.bind(Date); Date.now = () => real() + 2 * 3600 * 1000; document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
  await settle(page, 500);
  ok((await page.evaluate(() => window.__upd)) === 1, 'app shown again after >1h -> one update check (second event throttled)');
  fs.writeFileSync(SWFILE, orig); await ctx.close();
}

const RECORD = () => { window.__bip = false; window.addEventListener('beforeinstallprompt', () => { window.__bip = true; }, true); };
const SUPPRESS = () => { window.addEventListener('beforeinstallprompt', (e) => e.stopImmediatePropagation(), true); };   // emulates browsers that never fire the event (iOS, Firefox, desktop Safari)
/* ---------- B. install button ---------- */
async function installPage(extra, init) {
  const ctx = await ctxOf(extra); const page = ctx.pages()[0];
  for (const f of [].concat(init || [])) await page.addInitScript(f);
  await page.goto(HUB); await settle(page, 800); return { ctx, page };
}
const fireEvt = (outcome) => (o) => { const ev = new Event('beforeinstallprompt', { cancelable: true }); ev.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); }; ev.userChoice = Promise.resolve({ outcome: o }); window.__prevented = !window.dispatchEvent(ev); };
{
  console.log('\n== B. Install experience ==');
  let { ctx, page } = await installPage({}, RECORD);
  ok(await page.evaluate(() => window.__bip), 'real Chromium fired beforeinstallprompt for the local site (installability criteria met)');
  await page.evaluate(fireEvt('accepted'), 'accepted');
  ok(await page.isVisible('#install-btn'), 'button visible when not installed');
  await page.click('#install-btn'); await settle(page, 400);
  ok((await page.evaluate(() => window.__prompted)) === 1 && await page.evaluate(() => window.__prevented), 'native prompt used once; default mini-infobar suppressed');
  ok(!(await page.isVisible('#install-btn')) && !(await page.isVisible('#ios-tip')), 'accepted -> button and tip hidden');
  await ctx.close();

  ({ ctx, page } = await installPage());
  await page.evaluate(fireEvt('dismissed'), 'dismissed'); await page.click('#install-btn'); await settle(page, 400);
  ok(await page.isVisible('#install-btn') && await page.isVisible('#ios-tip'), 'dismissed -> manual instructions shown, button stays');
  await page.click('#install-btn'); await settle(page, 200);
  ok(!(await page.isVisible('#ios-tip')) && (await page.evaluate(() => window.__prompted)) === 1, 'second click does not re-prompt (event is single-use), toggles tip');
  await ctx.close();

  ({ ctx, page } = await installPage({}, SUPPRESS));
  await page.click('#install-btn');
  const t = await page.textContent('#ios-tip');
  ok(await page.isVisible('#ios-tip') && /Install MechHub/.test(t) && /already installed/.test(t), 'no native prompt (e.g. Firefox/Safari) -> manual instructions on click');
  ok(!/iPhone|iPad/.test(t), 'non-iOS text is not the iOS text');
  await ctx.close();

  ({ ctx, page } = await installPage({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 } }, SUPPRESS));
  await page.click('#install-btn');
  ok(/Share/.test(await page.textContent('#ios-tip')) && await page.isVisible('#ios-tip'), 'iOS UA -> Share → Add to Home Screen instructions');
  await ctx.close();

  ({ ctx, page } = await installPage({}, () => { const o = window.matchMedia.bind(window); window.matchMedia = (q) => /standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : o(q); }));
  ok(!(await page.isVisible('#install-btn')), 'already running as installed app (standalone) -> no install button');
  await ctx.close();

  ({ ctx, page } = await installPage());
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); 
  ok(!(await page.isVisible('#install-btn')), 'appinstalled event -> button hidden');
  await ctx.close();
}

/* ---------- C. navigation (mock same-origin sibling course pages; card href rewritten locally) ---------- */
{
  console.log('\n== C. Navigation to / from a course (SIMULATED same-origin course) ==');
  const ctx = await ctxOf(); const page = ctx.pages()[0];
  await page.goto(HUB); await settle(page, 2000); await page.reload(); await settle(page, 800);
  await page.$eval('#course-grid a.btn', (a, u) => { a.href = u; }, COURSE);
  await page.click('#course-grid a.btn'); await page.waitForURL(COURSE);
  ok(ctx.pages().length === 1, 'course opens in the same tab (no extra tab/window)');
  ok(!(await page.evaluate(() => !!navigator.serviceWorker.controller)), 'MechHub service worker does NOT control the course page (course behaviour untouched)');
  const len = await page.evaluate(() => history.length);
  await page.click('#back-to-mechhub'); await page.waitForURL(HUB);
  ok(await page.evaluate(() => history.length) === len, `Back (opened from MechHub) -> history.back(): no new history entry (length ${len})`);
  await page.goBack().catch(() => {});
  ok(!page.url().startsWith(COURSE), 'browser Back after that does not bounce into the course again (no loop)');

  const p2 = await ctx.newPage(); await p2.goto(COURSE);
  await p2.click('#back-to-mechhub'); await p2.waitForURL(HUB);
  ok(true, 'direct visit / bookmark -> Back follows the normal link to MechHub'); await p2.close();

  const p3 = await ctx.newPage(); await p3.goto(HUB); await p3.$eval('#course-grid a.btn', (a, u) => { a.href = u; }, COURSE);
  await p3.click('#course-grid a.btn'); await p3.waitForURL(COURSE); await p3.click('#inner'); await p3.waitForURL(COURSE + 'ch1.html');
  await p3.click('#back-to-mechhub'); await p3.waitForURL(HUB);
  ok(true, 'after browsing inside the course -> Back still reaches MechHub (never trapped)'); await p3.close();

  const p4 = await ctx.newPage(); await p4.goto(HUB); await settle(p4, 500);
  let L0 = await p4.evaluate(() => history.length);
  for (let i = 0; i < 3; i++) { await p4.$eval('#course-grid a.btn', (a, u) => { a.href = u; }, COURSE); await p4.click('#course-grid a.btn'); await p4.waitForURL(COURSE); await p4.click('#back-to-mechhub'); await p4.waitForURL(HUB); }
  ok(ctx.pages().length === 2 && (await p4.evaluate(() => history.length)) === L0 + 1, `3 round trips: no extra tabs, history grew by ${(await p4.evaluate(() => history.length)) - L0} (not 3 per trip)`); await p4.close();

  const p5 = await ctx.newPage(); await p5.goto(COURSE + 'unfixed.html');
  await p5.click('#back'); await settle(p5, 300);
  ok(p5.url().startsWith(COURSE + 'unfixed.html'), 'DEMO: a placeholder href="#" Back link leaves the user on the course page (what 6 live course pages appear to have)');
  await ctx.close();
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);

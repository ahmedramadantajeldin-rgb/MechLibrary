import { chromium } from 'playwright-core';
const base = process.argv[2];
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-prof-'));
const ctx = await chromium.launchPersistentContext(profile, { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], viewport: { width: 1200, height: 800 } });
const b = { close: () => ctx.close() };
const page = ctx.pages()[0] || await ctx.newPage();
let navs = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => logs.push('requestfailed: ' + r.url() + ' ' + (r.failure() || {}).errorText));
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(3000);
console.log('MAIN-FRAME NAVIGATIONS in first 3s of a first visit (1 = no self-reload):', navs);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Page.enable');
const m = await cdp.send('Page.getAppManifest');
console.log('MANIFEST url:', m.url);
console.log('MANIFEST errors/warnings:', JSON.stringify(m.errors));
const man = JSON.parse(m.data || '{}');
console.log('MANIFEST name/short/start/scope/display:', man.name, '|', man.short_name, '|', man.start_url, '|', man.scope, '|', man.display);
const inst = await cdp.send('Page.getInstallabilityErrors');
console.log('INSTALLABILITY errors:', JSON.stringify(inst.installabilityErrors));
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, script: r.active && r.active.scriptURL, state: r.active && r.active.state }; });
console.log('SW:', JSON.stringify(sw));
await page.reload({ waitUntil: 'load' });
console.log('controlled after reload:', await page.evaluate(() => !!navigator.serviceWorker.controller));
const cacheInfo = await page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname); return o; });
console.log('CACHES:', JSON.stringify(cacheInfo));
// icons from the manifest
const iconRes = await page.evaluate(async (icons) => Promise.all(icons.map(async (i) => { const r = await fetch(new URL(i.src, document.baseURI)); const b = await r.blob(); return `${i.src} ${i.sizes} ${i.purpose} -> ${r.status} ${b.type} ${b.size}B`; })), man.icons || []);
console.log('ICONS:\n  ' + iconRes.join('\n  '));
// course links
const links = await page.$$eval('#course-grid a.btn', (as) => as.map((a) => ({ href: a.href, target: a.target || '(same tab)', rel: a.rel || '' })));
console.log('COURSE LINKS (' + links.length + '):\n  ' + links.map((l) => `${l.href}  target=${l.target} rel=${l.rel}`).join('\n  '));
const drive = await page.$eval('#drive-slot a', (a) => `${a.href} target=${a.target} rel=${a.rel}`);
console.log('DRIVE:', drive);
// offline
await ctx.setOffline(true);
let off = 'FAILED';
try { await page.reload({ waitUntil: 'load', timeout: 15000 }); off = 'title="' + (await page.title()) + '", cards=' + (await page.$$eval('#course-grid li', (l) => l.length)) + ', banner=' + (await page.$eval('#offline-banner', (e) => getComputedStyle(e).display)); } catch (e) { off = 'FAILED: ' + e.message.split('\n')[0]; }
console.log('OFFLINE reload:', off);
await ctx.setOffline(false);
console.log('CONSOLE/PAGE ERRORS:', logs.length ? '\n  ' + logs.join('\n  ') : 'none');
await b.close();

import { chromium } from 'playwright-core';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const out = '/tmp/claude-0/-home-claude/9566955c-85cd-501c-8bdf-e56afdb24f92/scratchpad/shots';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const [name, vp] of [['desktop', { width: 1200, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
  for (const [tag, url] of [['base', 'http://localhost:8770/MechLibrary/'], ['new', 'http://localhost:8771/MechLibrary/']]) {
    const ctx = await b.newContext({ viewport: vp, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const p = await ctx.newPage(); await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}/v-${name}-${tag}-shown.png`, fullPage: true });
    await p.addStyleTag({ content: '#install-btn{display:none!important}' });
    await p.screenshot({ path: `${out}/v-${name}-${tag}-hidden.png`, fullPage: true });
    await ctx.close();
  }
}
await b.close();

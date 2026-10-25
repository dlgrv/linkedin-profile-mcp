#!/usr/bin/env node
/**
 * Debug: dump every form control on a LinkedIn edit page so FIELD_MAP can be
 * rebuilt against real identifiers instead of blind positional indices.
 *
 * Usage: node debug-form.js [intro|about|add_exp|add_edu|add_project]
 */

const { chromium } = require('patchright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROFILE_DIR = process.env.LINKEDIN_PROFILE_DIR || path.join(os.homedir(), '.linkedin-mcp', 'profile');

(function loadEnv() {
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
})();

const VANITY = process.env.LINKEDIN_VANITY;
if (!VANITY) { console.error('No LINKEDIN_VANITY'); process.exit(1); }

const PAGES = {
  intro: `https://www.linkedin.com/in/${VANITY}/edit/intro`,
  about: `https://www.linkedin.com/in/${VANITY}/edit/forms/summary/new/`,
  add_exp: `https://www.linkedin.com/in/${VANITY}/edit/forms/position/new/`,
  add_edu: `https://www.linkedin.com/in/${VANITY}/edit/forms/education/new/`,
  add_project: `https://www.linkedin.com/in/${VANITY}/edit/forms/project/new/`,
};

const which = process.argv[2] || 'intro';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false,
    args: ['--no-sandbox', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--enable-unsafe-swiftshader'],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20000);

  await page.goto(PAGES[which], { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.error('goto:', e.message));
  await sleep(5000);
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
  console.log('DIALOGS:', await page.locator('div[role="dialog"]').count());
  console.log('');

  const rows = await page.evaluate(() => {
    const scope = document.querySelector('main') || document;
    const sels = 'input:not([type="hidden"]):not([type="radio"]), textarea, [contenteditable="true"], [contenteditable=""], select';
    const out = [];
    scope.querySelectorAll(sels).forEach((el, i) => {
      const labelEl = el.closest('div')?.querySelector('label');
      // also try the standard <label for=...>
      let labelText = '';
      if (el.id) {
        const l = document.querySelector(`label[for="${el.id}"]`);
        if (l) labelText = l.innerText.trim();
      }
      if (!labelText && labelEl) labelText = labelEl.innerText.trim();
      out.push({
        i,
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        id: el.id || '',
        name: el.getAttribute('name') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        label: labelText.replace(/\s+/g, ' ').trim().slice(0, 60),
        value: String(el.value || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        visible: !!(el.offsetParent || el.getClientRects().length),
      });
    });
    return out;
  });

  console.log(`=== ${which}: ${rows.length} form controls ===`);
  rows.forEach(r => {
    console.log(
      `[${String(r.i).padStart(2)}] ${r.visible ? 'V' : ' '} ${r.tag}${r.type ? ':' + r.type : ''}` +
      ` | id="${r.id}" name="${r.name}" aria="${r.ariaLabel}" ph="${r.placeholder}"` +
      ` | label="${r.label}" | value="${r.value}"`
    );
  });

  await sleep(1500);
  await context.close();
})();

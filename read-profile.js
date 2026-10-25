#!/usr/bin/env node
/**
 * Read the current public LinkedIn profile: headline, about, experience
 * entries, education — so we only fill what is missing.
 * Usage: node read-profile.js
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--enable-unsafe-swiftshader'],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);

  await page.goto(`https://www.linkedin.com/in/${VANITY}/details/experience/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(4000);

  const exp = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('ul li, .pvs-list__item--line-separated').forEach(li => {
      const t = li.innerText.replace(/\s+/g, ' ').trim();
      if (t && t.length > 10 && t.length < 500) items.push(t);
    });
    return items.slice(0, 25);
  });

  console.log('=== EXPERIENCE PAGE ITEMS ===');
  exp.forEach((t, i) => console.log(`[${i}] ${t}`));

  await page.goto(`https://www.linkedin.com/in/${VANITY}/details/education/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3500);
  const edu = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('ul li, .pvs-list__item--line-separated').forEach(li => {
      const t = li.innerText.replace(/\s+/g, ' ').trim();
      if (t && t.length > 5 && t.length < 400) items.push(t);
    });
    return items.slice(0, 10);
  });
  console.log('\n=== EDUCATION PAGE ITEMS ===');
  edu.forEach((t, i) => console.log(`[${i}] ${t}`));

  await page.goto(`https://www.linkedin.com/in/${VANITY}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3500);
  const main = await page.evaluate(() => {
    const el = document.querySelector('main') || document.body;
    return el.innerText;
  });
  console.log('\n=== PROFILE TOP (first 40 lines) ===');
  main.split('\n').filter(l => l.trim()).slice(0, 40).forEach(l => console.log(l));

  await sleep(1000);
  await context.close();
})();

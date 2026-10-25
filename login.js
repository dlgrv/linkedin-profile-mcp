#!/usr/bin/env node
/**
 * One-time LinkedIn login for linkedin-profile-mcp.
 *
 * The upstream README referenced `npx linkedin-mcp --login`, which belongs to
 * a different npm package — this repo ships no login flow of its own. This
 * script provides it: it opens Chrome with the same persistent profile dir
 * that edit-profile.js uses, you sign in manually (password and 2FA stay
 * with you), then the script detects the profile vanity slug and saves it
 * to .env for later runs.
 *
 * Usage: node login.js
 */
'use strict';

const { chromium } = require('patchright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROFILE_DIR = process.env.LINKEDIN_PROFILE_DIR || path.join(os.homedir(), '.linkedin-mcp', 'profile');
const ENV_PATH = path.join(__dirname, '.env');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// Signed-in URLs: the feed, or any profile page except the /in/me/ alias
const LOGGED_IN_URL = /linkedin\.com\/(feed\/|in\/(?!me))/;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForManualLogin(page) {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (LOGGED_IN_URL.test(page.url())) return true;
    await sleep(2000);
  }
  return false;
}

async function detectVanity(page) {
  // linkedin.com/in/me redirects to /in/<slug>/ when signed in
  await page.goto('https://www.linkedin.com/in/me/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(4000);
  let m = page.url().match(/linkedin\.com\/in\/([^/?#]+)/);
  if (m && m[1] !== 'me') return m[1];

  // Fallback: the "Me" nav item on the feed links to the profile
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  const href = await page.locator('a[href*="/in/"]').first().getAttribute('href').catch(() => null);
  if (href) {
    m = href.match(/\/in\/([^/?#]+)/);
    if (m && m[1] !== 'me') return m[1];
  }
  return null;
}

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false, // credentials must be typed by the user
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--enable-unsafe-swiftshader',
    ],
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  console.log('');
  console.log('Chrome window opened. Sign in to LinkedIn manually (password and 2FA are yours to enter).');
  console.log(`Waiting for sign-in (up to ${LOGIN_TIMEOUT_MS / 60000} minutes)...`);
  console.log('');

  if (!(await waitForManualLogin(page))) {
    throw new Error('Timed out waiting for sign-in. Run `node login.js` again.');
  }
  console.log('Login detected. Detecting profile slug...');
  await sleep(3000);

  const vanity = await detectVanity(page);
  if (vanity) {
    fs.writeFileSync(ENV_PATH, `LINKEDIN_VANITY=${vanity}\n`);
    console.log(`Vanity slug: ${vanity} (saved to ${ENV_PATH})`);
  } else {
    console.error(`Could not detect the vanity slug automatically (URL: ${page.url()}).`);
    console.error(`Set it manually in ${ENV_PATH}: LINKEDIN_VANITY=<slug> (the part after linkedin.com/in/).`);
  }

  console.log(`Session persisted in ${PROFILE_DIR}; edit-profile.js can now run without a visible window.`);
  await sleep(2000);
  await context.close();
}

main().catch(e => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});

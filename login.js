#!/usr/bin/env node
/**
 * One-time LinkedIn login for linkedin-profile-mcp.
 *
 * The original repo documents `npx linkedin-mcp --login`, which belongs to a
 * different package and does not exist here — this script replaces it.
 *
 * Opens Chrome with the same persistent profile dir that edit-profile.js uses.
 * You log in manually (password + 2FA stay with you), then the script detects
 * your vanity slug and saves it to .env for later runs.
 *
 * Usage: node login.js
 */

const { chromium } = require('patchright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROFILE_DIR = process.env.LINKEDIN_PROFILE_DIR || path.join(os.homedir(), '.linkedin-mcp', 'profile');
const ENV_PATH = path.join(__dirname, '.env');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function detectVanity(page) {
  // linkedin.com/in/me redirects to /in/<slug>/ when logged in
  await page.goto('https://www.linkedin.com/in/me/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(4000);
  let m = page.url().match(/linkedin\.com\/in\/([^/?#]+)/);
  if (m && m[1] && m[1] !== 'me') return m[1];

  // Fallback: the "Me" nav item on the feed links to the profile
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3000);
  const href = await page.locator('a[href*="/in/"]').first().getAttribute('href').catch(() => null);
  if (href) {
    m = href.match(/\/in\/([^/?#]+)/);
    if (m && m[1] && m[1] !== 'me') return m[1];
  }
  return null;
}

(async () => {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: false, // you need to type your password
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
  console.log('>>> Chrome окно открыто. Войдите в LinkedIn (логин, пароль, 2FA — всё вручную).');
  console.log('>>> Скрипт ждёт до 5 минут...');
  console.log('');

  const deadline = Date.now() + 5 * 60 * 1000;
  let loggedIn = false;
  while (Date.now() < deadline) {
    const url = page.url();
    if (/linkedin\.com\/(feed|feed\/|in\/[^/]+|mypage|checkpoint)/.test(url) && !/\/login/.test(url)) {
      // checkpoint (2FA) pages count as progress, only exit on feed/profile
      if (/linkedin\.com\/(feed|in\/(?!me))/.test(url)) { loggedIn = true; break; }
    }
    await sleep(2000);
  }

  if (!loggedIn) {
    console.error('❌ Время вышло — логин не обнаружен. Запустите `node login.js` ещё раз.');
    await context.close();
    process.exit(1);
  }

  console.log('✅ Логин выполнен. Определяю slug профиля...');
  await sleep(3000);

  const vanity = await detectVanity(page);
  if (vanity) {
    fs.writeFileSync(ENV_PATH, `LINKEDIN_VANITY=${vanity}\n`);
    console.log(`✅ Vanity slug: ${vanity}`);
    console.log(`✅ Сохранён в ${ENV_PATH}`);
  } else {
    console.error(`⚠️ Не удалось определить slug автоматически (URL: ${page.url()}).`);
    console.error('   Впишите его вручную в .env: LINKEDIN_VANITY=<slug> (часть после linkedin.com/in/).');
  }

  console.log(`✅ Сессия сохранена в ${PROFILE_DIR} — edit-profile.js теперь будет работать без логина.`);
  await sleep(2000);
  await context.close();
})();

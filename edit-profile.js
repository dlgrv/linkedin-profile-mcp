#!/usr/bin/env node
/**
 * LinkedIn Profile Editor
 *
 * Reads and writes LinkedIn profile fields via browser automation (patchright).
 * Fields are resolved by label/aria text with RU and EN variants — positional
 * indexes do not survive the live DOM. Every write is verified by reading the
 * field back.
 *
 * Usage:
 *   node login.js                                   # one-time manual login
 *   node edit-profile.js get <field>
 *   node edit-profile.js set <field> <value>
 *   node edit-profile.js test                       # headline roundtrip + revert
 *   node edit-profile.js list
 *   node edit-profile.js add-exp --title "..." --company "..." ...
 *   node edit-profile.js add-edu --school "..." ...
 *   node edit-profile.js add-project --project_name "..."
 *   node edit-profile.js edit-form <edit-url> --field "value" ...
 *
 * Exits with a non-zero code on any error.
 */
'use strict';

const { chromium } = require('patchright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROFILE_DIR = process.env.LINKEDIN_PROFILE_DIR || path.join(os.homedir(), '.linkedin-mcp', 'profile');

// Written by login.js (which also provides the login flow the upstream README
// incorrectly delegated to an unrelated npm package)
(function loadEnv() {
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* .env is optional */ }
})();

const VANITY = process.env.LINKEDIN_VANITY;
if (!VANITY) {
  console.error('Error: LINKEDIN_VANITY is required. Run `node login.js` first.');
  process.exit(1);
}

// Headless by default; set LINKEDIN_HEADLESS=false to watch Chrome work.
// Patchright's headless mode is anti-detect, unlike vanilla Playwright.
const HEADLESS = process.env.LINKEDIN_HEADLESS !== 'false';

const LOGIN_URL = `https://www.linkedin.com/in/${VANITY}`;
const EDIT_PAGES = {
  intro: `${LOGIN_URL}/edit/intro`,
  about: `${LOGIN_URL}/edit/forms/summary/new/`,
  add_exp: `${LOGIN_URL}/edit/forms/position/new/`,
  add_edu: `${LOGIN_URL}/edit/forms/education/new/`,
  add_project: `${LOGIN_URL}/edit/forms/project/new/`,
};

const CTRL_SEL = 'input:not([type="hidden"]):not([type="radio"]), textarea, [contenteditable="true"], [contenteditable=""], select';

// how: 'label' (exact label text match), 'aria' (exact aria-label match),
//      'ariaPrefix' (aria-label starts with), 'nthTextInput', 'nthEditable'
// Verified against the live RU- and EN-locale DOM, October 2026.
const FIELD_MAP = {
  intro: {
    first_name: { how: 'nthTextInput', n: 0 },
    last_name: { how: 'nthTextInput', n: 1 },
    additional_name: { how: 'label', texts: ['Additional name', 'Дополнительное имя'] },
    headline: { how: 'nthEditable', n: 0 },
    country: { how: 'aria', texts: ['Country/Region', 'Страна/регион'], typeahead: true },
    postal_code: { how: 'label', texts: ['Postal code', 'Почтовый индекс'] },
    city: { how: 'label', texts: ['City', 'Город'] },
    position: { how: 'label', texts: ['Position', 'Организация'] },
    school: { how: 'label', texts: ['School', 'Образование'] },
    industry: { how: 'aria', texts: ['Industry', 'Отрасль'] },
  },
  about: {
    about: { how: 'nthEditable', n: 0 },
  },
  add_exp: {
    title: { how: 'nthTextInput', n: 0 },
    company: { how: 'nthTextInput', n: 1, typeahead: true },
    location: { how: 'nthTextInput', n: 2, typeahead: true },
    location_type: { how: 'label', texts: ['Location type', 'Тип места работы'] },
    employment_type: { how: 'label', texts: ['Employment type', 'Тип занятости'] },
    currently_working: { how: 'ariaPrefix', texts: ['I am currently working', 'Я сейчас работа'], checkbox: true },
    start_month: { how: 'label', texts: ['Start month', 'Месяц начала'] },
    start_year: { how: 'label', texts: ['Start year', 'Год начала'] },
    end_month: { how: 'label', texts: ['End month', 'Месяц окончания'] },
    end_year: { how: 'label', texts: ['End year', 'Год окончания'] },
    description: { how: 'nthEditable', n: 0 },
  },
  add_edu: {
    school: { how: 'nthTextInput', n: 0, typeahead: true },
    degree: { how: 'label', texts: ['Degree', 'Степень'] },
    field_of_study: { how: 'label', texts: ['Field of study', 'Специальность', 'Область обучения'] },
    start_year: { how: 'label', texts: ['Start year', 'Год начала'] },
    end_year: { how: 'label', texts: ['End year', 'Год окончания'] },
    grade: { how: 'label', texts: ['Grade', 'Средний балл'] },
    activities: { how: 'label', texts: ['Activities and societies', 'Activities', 'Общественная деятельность и достижения'] },
    description: { how: 'nthEditable', n: 0 },
  },
  add_project: {
    project_name: { how: 'nthTextInput', n: 0 },
    start_month: { how: 'label', texts: ['Start month', 'Месяц начала'] },
    start_year: { how: 'label', texts: ['Start year', 'Год начала'] },
    end_month: { how: 'label', texts: ['End month', 'Месяц окончания'] },
    end_year: { how: 'label', texts: ['End year', 'Год окончания'] },
    currently_working: { how: 'ariaPrefix', texts: ['I am currently working', 'Я сейчас работа'], checkbox: true },
    project_url: { how: 'label', texts: ['Project URL', 'URL проекта'] },
    description: { how: 'nthEditable', n: 0 },
  },
};

const MONTHS = {
  january: '1', february: '2', march: '3', april: '4', may: '5', june: '6',
  july: '7', august: '8', september: '9', october: '10', november: '11', december: '12',
  jan: '1', feb: '2', mar: '3', apr: '4', jun: '6', jul: '7', aug: '8',
  sep: '9', oct: '10', nov: '11', dec: '12',
  января: '1', февраля: '2', марта: '3', апреля: '4', мая: '5', июня: '6',
  июля: '7', августа: '8', сентября: '9', октября: '10', ноября: '11', декабря: '12',
  январь: '1', февраль: '2', март: '3', апрель: '4', май: '5', июнь: '6',
  июль: '7', август: '8', сентябрь: '9', октябрь: '10', ноябрь: '11', декабрь: '12',
  янв: '1', фев: '2', мар: '3', апр: '4', июн: '6', июл: '7', авг: '8',
  сен: '9', окт: '10', ноя: '11', дек: '12',
};

// ---------------------------------------------------------------- helpers ---

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeText(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function monthValue(v) {
  const s = String(v).trim().toLowerCase();
  if (/^\d{1,2}$/.test(s)) return String(parseInt(s, 10));
  return MONTHS[s] || null;
}

/** Parse ["--key", "value", ...] into { key: value }. */
function parseFieldArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const rest = [];
    let j = i + 1;
    while (j < args.length && !args[j].startsWith('--')) { rest.push(args[j]); j++; }
    values[key] = rest.join(' ');
    i = j - 1;
  }
  return values;
}

/** Find which form page a field name belongs to; null when unknown. */
function findFieldPage(fieldName) {
  return Object.keys(FIELD_MAP).find(p => FIELD_MAP[p][fieldName]) || null;
}

// ------------------------------------------------------- field resolution ---

/**
 * Resolve a FIELD_MAP def and mark the matched control with a data attribute.
 * The element is marked inside page.evaluate and located by attribute
 * afterwards because Playwright locators pierce open shadow roots while
 * document.querySelectorAll does not — positional nth() indexes differ
 * between the two engines.
 */
async function markControl(page, def) {
  return page.evaluate(def => {
    document.querySelectorAll('[data-limcp-target]').forEach(e => e.removeAttribute('data-limcp-target'));

    // Edit forms render as an overlay outside <main>/<form>/[role=dialog], so
    // the whole document is scanned; field labels and aria-labels are unique
    // page-wide, and the header search input comes after the form fields.
    const els = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="radio"]), textarea, [contenteditable="true"], [contenteditable=""], select'
    ));
    const visible = el => !!(el.offsetParent || el.getClientRects().length);
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\*/g, '').trim();

    const labelOf = el => {
      if (el.id) {
        const l = document.querySelector(`label[for="${el.id}"]`);
        if (l) return norm(l.innerText);
      }
      const wrap = el.closest('.fb-dash-form-element') || el.closest('div');
      if (wrap) {
        const l = wrap.querySelector('label');
        if (l) return norm(l.innerText);
      }
      return '';
    };

    if (def.how === 'nthTextInput') {
      let n = -1;
      for (const el of els) {
        if (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'search'].includes(el.type) && visible(el)) {
          if (++n === def.n) { el.setAttribute('data-limcp-target', '1'); return true; }
        }
      }
      return false;
    }

    if (def.how === 'nthEditable') {
      let n = -1;
      for (const el of els) {
        if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && visible(el)) {
          if (++n === def.n) { el.setAttribute('data-limcp-target', '1'); return true; }
        }
      }
      return false;
    }

    for (const el of els) {
      if (!visible(el)) continue;
      const aria = norm(el.getAttribute('aria-label'));
      const label = labelOf(el);
      for (const t of def.texts) {
        const tn = norm(t);
        if (def.how === 'ariaPrefix' ? aria.startsWith(tn) : aria === tn || label === tn) {
          el.setAttribute('data-limcp-target', '1');
          return true;
        }
      }
    }
    return false;
  }, def);
}

/**
 * Locate a field and return a live locator for it. Retries because the form
 * re-renders while typeaheads resolve and hidden controls appear late.
 */
async function locateField(page, pageName, fieldName) {
  const def = FIELD_MAP[pageName][fieldName];
  if (!def) throw new Error(`Unknown field '${fieldName}' on ${pageName} (see: node edit-profile.js list)`);

  for (let attempt = 0; attempt < 6; attempt++) {
    if (await markControl(page, def)) {
      const el = page.locator('[data-limcp-target="1"]');
      // markControl already filters out non-rendered elements (offsetParent);
      // playwright isVisible() would wrongly reject LinkedIn's zero-height
      // native checkboxes hidden behind custom toggle UI
      if ((await el.count()) === 1) return el;
    }
    await sleep(1200);
  }
  const target = def.texts ? def.texts.join('/') : def.n;
  throw new Error(`Field '${fieldName}' (${def.how}: ${target}) not found in the ${pageName} form`);
}

// -------------------------------------------------------------- operations ---

async function launchBrowser() {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless: HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--enable-unsafe-swiftshader',
    ],
  });
}

async function openForm(page, pageName, formUrl) {
  const target = formUrl || EDIT_PAGES[pageName];
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(5000);
}

async function readField(page, pageName, fieldName) {
  await openForm(page, pageName);
  const el = await locateField(page, pageName, fieldName);
  if (!(await el.isVisible().catch(() => false))) return null;
  const val = await el.evaluate(e => e.value || e.innerText || '').catch(() => '');
  return String(val).trim();
}

async function setControl(el, def, value, fieldName) {
  if (def.checkbox) {
    const wasChecked = await el.isChecked();
    if ((value === true || value === 'true') === wasChecked) return;
    // Native checkboxes are zero-height and often offscreen behind custom
    // toggle UI: dispatch a real DOM click so React onChange fires
    await el.evaluate(e => e.click());
    await sleep(600);
    if ((await el.isChecked()) === wasChecked) {
      throw new Error(`Failed to toggle checkbox '${fieldName}'`);
    }
    return;
  }

  const tag = await el.evaluate(e => e.tagName);
  if (tag === 'SELECT') {
    const v = /month/i.test(fieldName) ? (monthValue(value) || value) : value;
    await el.selectOption(v).catch(() => el.selectOption({ label: value }));
    return;
  }

  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    await el.fill('');
    await el.type(value, { delay: 10 });
  } else {
    // Tiptap/ProseMirror rich-text editor
    await el.click();
    await sleep(300);
    await el.evaluate(e => { e.innerText = ''; });
    await el.type(value, { delay: 12 });
  }
}

/** Accept the first autocomplete suggestion if one appeared. */
async function acceptTypeaheadSuggestion(page, fieldName) {
  await sleep(1600);
  const suggestion = page.locator('.basic-typeahead__selectable').first();
  if (await suggestion.isVisible({ timeout: 2500 }).catch(() => false)) {
    await suggestion.click();
    console.log(`typeahead suggestion accepted for '${fieldName}'`);
  }
}

async function clickSave(page) {
  const saveBtn = page.getByRole('button', { name: /^(save|сохранить)/i }).first();
  if (!(await saveBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
    throw new Error('Save button not found; nothing was saved');
  }
  await saveBtn.click();
  await sleep(3500);
}

async function writeField(page, pageName, fieldName, value) {
  await openForm(page, pageName);
  const def = FIELD_MAP[pageName][fieldName];
  const el = await locateField(page, pageName, fieldName);

  await setControl(el, def, value, fieldName);
  if (def.typeahead) await acceptTypeaheadSuggestion(page, fieldName);
  await clickSave(page);

  if (def.checkbox) {
    console.log(`${fieldName} set to ${value}`);
    return;
  }

  // Post-write verification: re-open the form and read the field back.
  // Guards against a DOM change redirecting the write into another field.
  const readBack = await readField(page, pageName, fieldName);
  const isSelect = await el.evaluate(e => e.tagName === 'SELECT').catch(() => false);
  if (isSelect) {
    console.log(`${fieldName}: selected option value is "${readBack}"`);
  } else if (normalizeText(readBack) !== normalizeText(value)) {
    throw new Error(
      `Verification failed for '${fieldName}': expected "${value}", read back "${readBack}". No further changes were made.`
    );
  } else {
    console.log(`${fieldName} updated (verified)`);
  }
}

/**
 * Fill several fields of one form and save once (writeField saves after each
 * field, which would submit incomplete "add" forms). With formUrl, edits an
 * existing entry instead of creating a new one.
 */
async function fillForm(page, pageName, values, formUrl) {
  await openForm(page, pageName, formUrl);
  const fields = { ...values };

  await revealEndDates(page, pageName, fields);

  for (const [name, value] of Object.entries(fields)) {
    const def = FIELD_MAP[pageName][name];
    if (!def) throw new Error(`Unknown field '${name}' for ${pageName} (see: node edit-profile.js list)`);
    const el = await locateField(page, pageName, name);
    await setControl(el, def, value, name);
    if (def.typeahead) await acceptTypeaheadSuggestion(page, name);
    await sleep(900);
  }

  await clickSave(page);

  // A successful submit redirects away from the form URL (to the profile or
  // the share-new-position flow); staying means a validation error
  const stillOnNewForm = !formUrl && /\/forms\/(position|education|project|summary)\/new/.test(page.url());
  const stillOnEditForm = formUrl && page.url().split('?')[0].replace(/\/$/, '') === formUrl.replace(/\/$/, '');
  if (stillOnNewForm || stillOnEditForm) {
    const errText = await page.locator('.artdeco-inline-feedback--error').first().textContent().catch(() => null);
    throw new Error(`Form was not submitted (still at ${page.url()})${errText ? `: ${String(errText).trim()}` : ''}`);
  }
  console.log(`${pageName}: form submitted (${Object.keys(fields).join(', ')})`);
}

/**
 * "End month/year" selects only render after "I am currently working in this
 * role" is unchecked. The native checkbox is hidden, so the click goes to its
 * first visible ancestor (the styled toggle).
 */
async function revealEndDates(page, pageName, fields) {
  const needsEnd = fields.end_month !== undefined || fields.end_year !== undefined;
  if (!needsEnd || fields.currently_working !== undefined) return;
  fields.currently_working = 'false';

  const checkbox = await locateField(page, pageName, 'currently_working');
  if (!(await checkbox.isChecked().catch(() => false))) return;

  await page.evaluate(() => {
    document.querySelectorAll('[data-limcp-wrap]').forEach(e => e.removeAttribute('data-limcp-wrap'));
    const t = document.querySelector('[data-limcp-target="1"]');
    let w = t && t.parentElement;
    while (w) {
      if ((w.offsetParent || w.getClientRects().length) && w.getBoundingClientRect().height > 10) {
        w.setAttribute('data-limcp-wrap', '1');
        break;
      }
      w = w.parentElement;
    }
  });
  await page.locator('[data-limcp-wrap="1"]').first().click({ timeout: 8000 });
  await sleep(2000);
  if (await checkbox.isChecked().catch(() => true)) {
    throw new Error('Failed to uncheck the "currently working" toggle; end dates stayed hidden');
  }
}

// ---------------------------------------------------------------- commands ---

async function cmdGet(page, field) {
  const pageName = findFieldPage(field);
  if (!pageName) throw new Error(`Unknown field: ${field} (see: node edit-profile.js list)`);
  const value = await readField(page, pageName, field);
  console.log(`${field} = "${value}"`);
}

async function cmdSet(page, field, value) {
  const pageName = findFieldPage(field);
  if (!pageName) throw new Error(`Unknown field: ${field} (see: node edit-profile.js list)`);
  await writeField(page, pageName, field, value);
}

/** Safe end-to-end check: modify the headline, verify on the public profile, restore. */
async function cmdTest(page) {
  const original = await readField(page, 'intro', 'headline');
  console.log(`Original headline: "${original}"`);
  const modified = original + '.';

  await writeField(page, 'intro', 'headline', modified);
  await sleep(2000);
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(2500);
  const bodyText = await page.evaluate(() => (document.querySelector('main') || document.body).innerText);
  const visible = bodyText.includes(modified);

  await writeField(page, 'intro', 'headline', original);
  console.log('Headline restored');

  if (!visible) {
    throw new Error('Modified headline is not visible on the public profile; the change did not apply');
  }
  console.log('Change is visible on the public profile');
}

function cmdList() {
  for (const [pageName, fields] of Object.entries(FIELD_MAP)) {
    console.log(`\n--- ${pageName} ---`);
    for (const [name, def] of Object.entries(fields)) {
      const target = def.texts ? `${def.how}: ${def.texts.join('/')}` : `${def.how} #${def.n}`;
      console.log(`  ${name} (${target})`);
    }
  }
}

function usage() {
  console.log(`
Usage:
  node edit-profile.js get <field>
  node edit-profile.js set <field> <value>
  node edit-profile.js test
  node edit-profile.js list
  node edit-profile.js add-exp --title "..." --company "..." [--start_month Jul] [--start_year 2026] ...
  node edit-profile.js add-edu --school "..." ...
  node edit-profile.js add-project --project_name "..." ...
  node edit-profile.js edit-form <edit-url> --field "value" ...

Vanity slug loaded from .env (currently: ${VANITY})
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    return;
  }

  if (cmd === 'list') {
    cmdList();
    return;
  }

  const context = await launchBrowser();
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20000);

  try {
    if (cmd === 'get') {
      await cmdGet(page, rest[0]);
    } else if (cmd === 'set') {
      await cmdSet(page, rest[0], rest.slice(1).join(' '));
    } else if (cmd === 'test') {
      await cmdTest(page);
    } else if (cmd === 'add-exp' || cmd === 'add-edu' || cmd === 'add-project') {
      const values = parseFieldArgs(rest);
      if (!Object.keys(values).length) {
        console.log(`Usage: node edit-profile.js ${cmd} --<field> "<value>" ...`);
        return;
      }
      const pageName = { 'add-exp': 'add_exp', 'add-edu': 'add_edu', 'add-project': 'add_project' }[cmd];
      await fillForm(page, pageName, values);
    } else if (cmd === 'edit-form') {
      const formUrl = rest[0];
      if (!formUrl || !/^https?:/.test(formUrl)) {
        console.log('Usage: node edit-profile.js edit-form <edit-url> --<field> "<value>" ...');
        return;
      }
      const values = parseFieldArgs(rest.slice(1));
      if (!Object.keys(values).length) {
        console.log('No fields given. Example: --description "..." --end_month Jun --end_year 2026');
        return;
      }
      const pageName = /education/.test(formUrl) ? 'add_edu'
        : /position|experience/.test(formUrl) ? 'add_exp'
        : 'add_project';
      await fillForm(page, pageName, values, formUrl);
    } else {
      console.log(`Unknown command: ${cmd}`);
      usage();
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await sleep(1000);
    await context.close();
  }
}

main();

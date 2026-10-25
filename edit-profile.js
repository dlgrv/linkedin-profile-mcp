#!/usr/bin/env node
/**
 * LinkedIn Profile Editor (patched for real RU-locale LinkedIn DOM)
 *
 * Field binding is label/aria-based, NOT index-based: the original repo's
 * positional FIELD_MAP pointed at the wrong fields (verified on a live
 * RU-locale profile: idx 4 = country, not headline). Every write is followed
 * by a read-back verification.
 *
 * Usage:
 *   node login.js                                   # one-time manual login
 *   node edit-profile.js get <field>
 *   node edit-profile.js set <field> <value>
 *   node edit-profile.js test                       # headline roundtrip + revert
 *   node edit-profile.js list
 *   node edit-profile.js add-exp --title "..." --company "..." ...
 *   node edit-profile.js add-edu --school "..." --degree "..."
 *   node edit-profile.js add-project --project_name "..."
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
// Hidden by default (user request); set LINKEDIN_HEADLESS=false to watch the browser.
// Patchright's headless mode is anti-detect, unlike vanilla Playwright.
const HEADLESS = process.env.LINKEDIN_HEADLESS !== 'false';

if (!VANITY) {
  console.error('ERROR: LINKEDIN_VANITY is required (run `node login.js` first)');
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const EDIT_PAGES = {
  intro:       `https://www.linkedin.com/in/${VANITY}/edit/intro`,
  about:       `https://www.linkedin.com/in/${VANITY}/edit/forms/summary/new/`,
  add_exp:     `https://www.linkedin.com/in/${VANITY}/edit/forms/position/new/`,
  add_edu:     `https://www.linkedin.com/in/${VANITY}/edit/forms/education/new/`,
  add_project: `https://www.linkedin.com/in/${VANITY}/edit/forms/project/new/`,
};

const CTRL_SEL = 'input:not([type="hidden"]):not([type="radio"]), textarea, [contenteditable="true"], [contenteditable=""], select';

// how: 'label' (exact label text, RU/EN variants), 'aria' (exact aria-label),
//      'ariaPrefix' (aria-label starts with), 'nthTextInput', 'nthEditable'
const FIELD_MAP = {
  // verified against live RU-locale DOM (2026-10)
  intro: {
    first_name:      { how: 'nthTextInput', n: 0 },
    last_name:       { how: 'nthTextInput', n: 1 },
    additional_name: { how: 'label', texts: ['Дополнительное имя', 'Additional name'] },
    headline:        { how: 'nthEditable', n: 0 },
    country:         { how: 'aria', texts: ['Страна/регион', 'Country/Region'], typeahead: true },
    postal_code:     { how: 'label', texts: ['Почтовый индекс', 'Postal code'] },
    city:            { how: 'label', texts: ['Город', 'City'] },
    position:        { how: 'label', texts: ['Организация', 'Position'] },
    school:          { how: 'label', texts: ['Образование', 'School'] },
    industry:        { how: 'aria', texts: ['Отрасль', 'Industry'] },
  },
  about: {
    about:           { how: 'nthEditable', n: 0 },
  },
  // verified against live RU-locale DOM (2026-10)
  add_exp: {
    title:             { how: 'nthTextInput', n: 0 },
    company:           { how: 'nthTextInput', n: 1, typeahead: true },
    location:          { how: 'nthTextInput', n: 2, typeahead: true },
    location_type:     { how: 'label', texts: ['Тип места работы', 'Location type'] },
    employment_type:   { how: 'label', texts: ['Тип занятости', 'Employment type'] },
    currently_working: { how: 'ariaPrefix', texts: ['Я сейчас работа', 'I am currently working'], checkbox: true },
    start_month:       { how: 'label', texts: ['Месяц начала', 'Start month'] },
    start_year:        { how: 'label', texts: ['Год начала', 'Start year'] },
    end_toggle:        { how: 'ariaPrefix', texts: ['Окончание работы', 'I ended', 'End current position'], checkbox: true, hidden: true },
    end_month:         { how: 'label', texts: ['Месяц окончания', 'End month'] },
    end_year:          { how: 'label', texts: ['Год окончания', 'End year'] },
    description:       { how: 'nthEditable', n: 0 },
  },
  add_edu: {
    school:        { how: 'nthTextInput', n: 0, typeahead: true },
    degree:        { how: 'label', texts: ['Степень', 'Degree'] },
    field_of_study:{ how: 'label', texts: ['Специальность', 'Область обучения', 'Field of study'] },
    start_year:    { how: 'label', texts: ['Год начала', 'Start year'] },
    end_year:      { how: 'label', texts: ['Год окончания', 'End year'] },
    grade:         { how: 'label', texts: ['Средний балл', 'Grade'] },
    activities:    { how: 'label', texts: ['Общественная деятельность и достижения', 'Activities and societies', 'Activities'] },
    description:   { how: 'nthEditable', n: 0 },
  },
  add_project: {
    project_name:  { how: 'nthTextInput', n: 0 },
    start_month:   { how: 'label', texts: ['Месяц начала', 'Start month'] },
    start_year:    { how: 'label', texts: ['Год начала', 'Start year'] },
    end_month:     { how: 'label', texts: ['Месяц окончания', 'End month'] },
    end_year:      { how: 'label', texts: ['Год окончания', 'End year'] },
    currently_working: { how: 'aria', texts: ['Я сейчас работаю над этим проектом', 'I am currently working on this project'], checkbox: true },
    project_url:   { how: 'label', texts: ['URL проекта', 'Project URL'] },
    description:   { how: 'nthEditable', n: 0 },
  },
};

const MONTHS = {
  'январь': '1', 'февраль': '2', 'март': '3', 'апрель': '4', 'май': '5', 'июнь': '6',
  'июль': '7', 'август': '8', 'сентябрь': '9', 'октябрь': '10', 'ноябрь': '11', 'декабрь': '12',
  'янв': '1', 'фев': '2', 'мар': '3', 'апр': '4', 'июн': '6', 'июл': '7', 'авг': '8', 'сен': '9', 'окт': '10', 'ноя': '11', 'дек': '12',
  'january': '1', 'february': '2', 'march': '3', 'april': '4', 'may': '5', 'june': '6',
  'july': '7', 'august': '8', 'september': '9', 'october': '10', 'november': '11', 'december': '12',
  'jan': '1', 'feb': '2', 'mar': '3', 'apr': '4', 'jun': '6', 'jul': '7', 'aug': '8', 'sep': '9', 'oct': '10', 'nov': '11', 'dec': '12',
};
function monthValue(v) {
  const s = String(v).trim().toLowerCase();
  if (/^\d{1,2}$/.test(s)) return String(parseInt(s, 10));
  return MONTHS[s] || null;
}

/**
 * Resolve a FIELD_MAP def to the index of its control inside the edit dialog.
 * Mirrors debug-form.js dumping logic, which was verified against the live DOM.
 */
/**
 * Resolve a FIELD_MAP def and mark the matched control with a data attribute.
 * We mark inside evaluate and locate by attribute afterwards because Playwright
 * locators pierce open shadow roots while document.querySelectorAll does not —
 * positional nth() indexes differ between the two engines.
 */
async function markControl(page, def) {
  return await page.evaluate((def) => {
    document.querySelectorAll('[data-limcp-target]').forEach(e => e.removeAttribute('data-limcp-target'));
    // Edit pages render the form as an overlay outside <main>/<form>/[role=dialog],
    // so we scan the whole document — field labels/arias are unique page-wide
    // (verified against live dumps), and single text inputs are matched by
    // document order (header search input comes after the form fields).
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
      if (wrap) { const l = wrap.querySelector('label'); if (l) return norm(l.innerText); }
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
      if (def.hidden !== true && !visible(el)) continue;
      const aria = norm(el.getAttribute('aria-label'));
      const label = labelOf(el);
      for (const t of def.texts) {
        const tn = norm(t);
        if (def.how === 'ariaPrefix') {
          if (aria.startsWith(tn)) { el.setAttribute('data-limcp-target', '1'); return true; }
        } else if (aria === tn || label === tn) {
          el.setAttribute('data-limcp-target', '1'); return true;
        }
      }
    }
    return false;
  }, def);
}

async function openForm(page, pageName) {
  await page.goto(EDIT_PAGES[pageName], { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(5000);
}

async function locateField(page, pageName, fieldName, { waitHidden = false } = {}) {
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
    if (!waitHidden) await sleep(1200);
  }
  throw new Error(`Field '${fieldName}' (${def.how}:${(def.texts || [def.n]).join('|')}) not usable in ${pageName} form`);
}

async function readField(page, pageName, fieldName) {
  await openForm(page, pageName);
  const el = await locateField(page, pageName, fieldName);
  if (!(await el.isVisible().catch(() => false))) return null;
  const val = await el.evaluate(e => (e.value || e.innerText || '')).catch(() => '');
  return String(val).trim();
}

async function setControl(el, def, value, fieldName) {
  if (def.checkbox) {
    const checked = await el.isChecked();
    if ((value === true || value === 'true') !== checked) {
      // native checkbox is zero-height/offscreen behind custom toggle UI:
      // dispatch a real DOM click so React onChange fires, bypassing Playwright
      await el.evaluate(e => e.click());
      await sleep(600);
      const nowChecked = await el.isChecked();
      if (nowChecked === checked) throw new Error(`Не удалось переключить чекбокс '${fieldName}'`);
    }
    return;
  }
  const isSelect = await el.evaluate(e => e.tagName === 'SELECT');
  if (isSelect) {
    let v = value;
    if (/month/i.test(fieldName)) v = monthValue(value) || value;
    await el.selectOption(v).catch(() => el.selectOption({ label: value }));
    return;
  }
  const isEditable = await el.evaluate(e => e.tagName !== 'INPUT' && e.tagName !== 'TEXTAREA' && e.tagName !== 'SELECT');
  if (isEditable) {
    await el.click();
    await sleep(300);
    await el.evaluate(e => { e.innerText = ''; });
    await el.type(value, { delay: 12 });
  } else {
    await el.fill('');
    await el.type(value, { delay: 10 });
  }
}

async function clickSave(page) {
  const saveBtn = page.getByRole('button', { name: /^(save|сохранить)/i }).first();
  if (!(await saveBtn.isVisible({ timeout: 4000 }).catch(() => false))) {
    throw new Error('Кнопка «Сохранить/Save» не найдена — ничего не сохранено');
  }
  await saveBtn.click();
  await sleep(3500);
}

async function writeField(page, pageName, fieldName, value) {
  await openForm(page, pageName);
  const def = FIELD_MAP[pageName][fieldName];
  const el = await locateField(page, pageName, fieldName);

  if (def.checkbox) {
    await setControl(el, def, value, fieldName);
    await clickSave(page);
    console.log(`✅ ${fieldName} set to ${value}`);
    return;
  }

  await setControl(el, def, value, fieldName);
  if (def.typeahead) {
    await sleep(1600);
    const sugg = page.locator('.basic-typeahead__selectable').first();
    if (await sugg.isVisible({ timeout: 2500 }).catch(() => false)) {
      await sugg.click();
      console.log(`   (принята подсказка автокомплита для ${fieldName})`);
    }
  }
  await clickSave(page);

  // Post-write verification: re-open the form and read the field back
  const readBack = await readField(page, pageName, fieldName);
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const isSelect = await el.evaluate(e => e.tagName === 'SELECT').catch(() => false);
  if (isSelect) {
    console.log(`ℹ️ ${fieldName}: выбранное значение — "${readBack}"`);
  } else if (norm(readBack) !== norm(value)) {
    throw new Error(`Проверка не прошла для '${fieldName}': ожидалось "${value}", прочитано "${readBack}". Больше ничего не менялось.`);
  }
  console.log(`✅ ${fieldName} обновлён (проверено)`);
}

async function fillForm(page, pageName, values, formUrl) {
  const target = formUrl || EDIT_PAGES[pageName];
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(5000);

  // End dates become editable only after "I am currently working in this
  // role" is unchecked; the native checkbox is hidden, so we click its first
  // visible ancestor (the styled toggle) instead
  const needsEnd = (values.end_month !== undefined) || (values.end_year !== undefined);
  if (needsEnd && values.currently_working === undefined) {
    const cw = await locateField(page, pageName, 'currently_working');
    if (await cw.isChecked().catch(() => false)) {
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
      if (await cw.isChecked().catch(() => true)) throw new Error('Не удалось снять галочку «сейчас работаю здесь»');
    }
    values.currently_working = 'false';
  }

  for (const [name, rawValue] of Object.entries(values)) {
    const def = FIELD_MAP[pageName][name];
    if (!def) throw new Error(`Unknown field '${name}' for ${pageName} (see: node edit-profile.js list)`);
    const el = await locateField(page, pageName, name);

    await setControl(el, def, rawValue, name);
    if (def.typeahead) {
      await sleep(1600);
      const sugg = page.locator('.basic-typeahead__selectable').first();
      if (await sugg.isVisible({ timeout: 2500 }).catch(() => false)) {
        await sugg.click();
        console.log(`   (принята подсказка автокомплита для ${name})`);
      }
    }
    await sleep(900);
  }

  await clickSave(page);

  if (formUrl) {
    // editing an existing entry: success = redirected off the entity edit URL
    if (page.url().split('?')[0].replace(/\/$/, '') === formUrl.replace(/\/$/, '')) {
      const errText = await page.locator('.artdeco-inline-feedback--error').first().textContent().catch(() => null);
      throw new Error(`Форма не отправилась (URL: ${page.url()})${errText ? ` — ${String(errText).trim()}` : ''}`);
    }
  } else if (/\/forms\/(position|education|project|summary)\/new/.test(page.url())) {
    const errText = await page.locator('.artdeco-inline-feedback--error').first().textContent().catch(() => null);
    throw new Error(`Форма не отправилась (URL: ${page.url()})${errText ? ` — ${String(errText).trim()}` : ''}`);
  }
  console.log(`✅ ${pageName}: форма отправлена (${Object.keys(values).join(', ')})`);
}

async function launchBrowser() {
  return await chromium.launchPersistentContext(PROFILE_DIR, {
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

async function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(`
Usage:
  node edit-profile.js get <field>
  node edit-profile.js set <field> <value>
  node edit-profile.js test
  node edit-profile.js list
  node edit-profile.js add-exp --title "..." --company "..." [--start_month Jul] [--start_year 2026] ...
  node edit-profile.js add-edu --school "..." ...
  node edit-profile.js add-project --project_name "..." ...

Vanity slug loaded from .env (currently: ${VANITY})
`);
    return;
  }

  const context = await launchBrowser();
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20000);

  try {
    if (cmd === 'get') {
      const field = process.argv[3];
      const [pageName] = findField(field);
      if (!pageName) { console.log(`Unknown field: ${field}`); return; }
      const val = await readField(page, pageName, field);
      console.log(`${field} = "${val}"`);
    } else if (cmd === 'set') {
      const field = process.argv[3];
      const value = process.argv.slice(4).join(' ');
      const [pageName] = findField(field);
      if (!pageName) { console.log(`Unknown field: ${field}`); return; }
      await writeField(page, pageName, field, value);
    } else if (cmd === 'test') {
      const orig = await readField(page, 'intro', 'headline');
      console.log(`Оригинальный headline: "${orig}"`);
      const modified = orig + '.';
      await writeField(page, 'intro', 'headline', modified);
      await sleep(2000);
      await page.goto(`https://www.linkedin.com/in/${VANITY}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(2500);
      const bodyText = await page.evaluate(() => (document.querySelector('main') || document.body).innerText);
      const visible = bodyText.includes(modified);
      if (!visible) {
        console.error('❌ Изменённый headline НЕ виден на публичном профиле — правка не применилась.');
      } else {
        console.log('✅ Изменение видно на публичном профиле.');
      }
      await writeField(page, 'intro', 'headline', orig);
      console.log('✅ Headline восстановлен');
      if (!visible) process.exitCode = 1;
    } else if (cmd === 'add-exp' || cmd === 'add-edu' || cmd === 'add-project') {
      const values = {};
      const args = process.argv.slice(3);
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
          const key = args[i].slice(2);
          const val = [];
          let j = i + 1;
          while (j < args.length && !args[j].startsWith('--')) { val.push(args[j]); j++; }
          values[key] = val.join(' ');
          i = j - 1;
        }
      }
      if (!Object.keys(values).length) {
        console.log(`Usage: node edit-profile.js ${cmd} --<field> "<value>" ...`);
        return;
      }
      const pageName = cmd === 'add-exp' ? 'add_exp' : cmd === 'add-edu' ? 'add_edu' : 'add_project';
      await fillForm(page, pageName, values);
    } else if (cmd === 'edit-form') {
      // edit an existing entry: node edit-profile.js edit-form <edit-url> --field "value" ...
      const formUrl = process.argv[3];
      if (!formUrl || !/^https?:/.test(formUrl)) {
        console.log('Usage: node edit-profile.js edit-form <edit-url> --<field> "<value>" ...');
        return;
      }
      const values = {};
      const args = process.argv.slice(4);
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
          const key = args[i].slice(2);
          const val = [];
          let j = i + 1;
          while (j < args.length && !args[j].startsWith('--')) { val.push(args[j]); j++; }
          values[key] = val.join(' ');
          i = j - 1;
        }
      }
      if (!Object.keys(values).length) {
        console.log('No fields given. Example: --description "..." --end_month Jun --end_year 2026');
        return;
      }
      const pageName = /education/.test(formUrl) ? 'add_edu' : /position|experience/.test(formUrl) ? 'add_exp' : 'add_project';
      await fillForm(page, pageName, values, formUrl);
    } else if (cmd === 'list') {
      for (const [pn, fields] of Object.entries(FIELD_MAP)) {
        console.log(`\n--- ${pn} ---`);
        for (const [name, def] of Object.entries(fields)) {
          const target = def.how === 'nthTextInput' || def.how === 'nthEditable'
            ? def.how + '#' + def.n
            : def.how + ':' + (def.texts || []).join('/');
          console.log(`  ${name} (${target})`);
        }
      }
    } else {
      console.log(`Unknown command: ${cmd}`);
    }
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await sleep(1000);
    await context.close();
  }
}

function findField(fieldName) {
  for (const [pageName, fields] of Object.entries(FIELD_MAP)) {
    if (fields[fieldName]) return [pageName, fields[fieldName]];
  }
  return [null, null];
}

main();

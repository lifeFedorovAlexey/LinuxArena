import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LanguageSwitcher } from '../../src/ui/shared/language-switcher/language-switcher.mjs';
import { bindLanguage } from '../../src/ui/shell/language.mjs';
import { LOCALES, getLocale, setLocale } from '../../src/ui/shared/i18n/index.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = createRequire(require.resolve('blockly'))('jsdom');

test('the language component owns one template, reports selection and preserves button focus on update', () => {
  const dom = new JSDOM('<div id="languages"></div>');
  const host = dom.window.document.querySelector('#languages');
  const choices = [];
  const switcher = new LanguageSwitcher(host, {
    languages: { ru: { label: 'Русский' }, en: { label: 'English' }, de: { label: 'Deutsch' } },
    value: 'ru',
    label: 'Язык интерфейса',
    onChange: (value) => choices.push(value),
  });
  const [ru, en, de] = host.querySelectorAll('button');
  assert.equal(host.getAttribute('role'), 'group');
  assert.equal(ru.getAttribute('aria-pressed'), 'true');
  assert.equal(en.getAttribute('aria-pressed'), 'false');
  assert.equal(de.textContent, 'DE');
  assert.equal(en.getAttribute('aria-label'), 'English');
  assert.equal(en.lang, 'en');
  en.focus();
  en.click();
  assert.deepEqual(choices, ['en']);
  // Selection belongs to the caller until it supplies an updated value.
  assert.equal(ru.getAttribute('aria-pressed'), 'true');
  switcher.update({ value: 'en', label: 'Interface language' });
  assert.equal(host.getAttribute('aria-label'), 'Interface language');
  assert.equal(dom.window.document.activeElement, en);
  assert.equal(host.querySelectorAll('button')[1], en);
  assert.equal(en.getAttribute('aria-pressed'), 'true');
  assert.equal(ru.getAttribute('aria-pressed'), 'false');
  switcher.destroy();
  en.click();
  assert.deepEqual(choices, ['en']);
  assert.equal(host.childElementCount, 0);
  assert.equal(host.hasAttribute('role'), false);
  dom.window.close();
});

test('shell locale binding keeps the component controls, focus and single change subscription', () => {
  const dom = new JSDOM(
    '<div id="languages"></div><span id="draft-status"></span><div id="trace-banner"></div><div id="toast"></div>',
  );
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  const host = dom.window.document.querySelector('#languages');
  const switcher = new LanguageSwitcher(host, {
    languages: LOCALES,
    value: getLocale(),
    label: 'Язык интерфейса',
    onChange: setLocale,
  });
  const [ru, en] = host.querySelectorAll('button');
  let refreshes = 0;
  const unsubscribe = bindLanguage(
    { layer: 'placement', draft: { valid: true }, traceToken: 0 },
    {
      switcher,
      editor: { localize: () => refreshes++ },
      render: () => {},
      renderInputLabels: () => {},
    },
  );
  try {
    assert.equal(host.querySelectorAll('button')[1], en);
    en.focus();
    en.click();
    assert.equal(getLocale(), 'en');
    assert.equal(en.getAttribute('aria-pressed'), 'true');
    assert.equal(ru.getAttribute('aria-pressed'), 'false');
    assert.equal(host.getAttribute('aria-label'), 'Interface language');
    assert.equal(dom.window.document.activeElement, en);
    assert.equal(dom.window.document.querySelector('#draft-status').textContent, 'Saved');
    assert.equal(refreshes, 2);
    unsubscribe();
    ru.click();
    assert.equal(refreshes, 2);
  } finally {
    unsubscribe();
    switcher.destroy();
    setLocale('ru', { persist: false });
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

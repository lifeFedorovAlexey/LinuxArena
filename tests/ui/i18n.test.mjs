import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parse } from 'acorn';
import * as Blockly from 'blockly';
import {
  LOCALES,
  LOCALE_STORAGE_KEY,
  getLocale,
  setLocale,
  initializeLocale,
  t as translate,
  formatNumber,
  onLocaleChange,
} from '../../src/ui/shared/i18n/index.mjs';
import { translateDOM } from '../../src/ui/shared/i18n/dom.mjs';
import { ContractView } from '../../src/ui/contract/contract-view.mjs';
import { contractTemplate } from '../../src/ui/contract/template.mjs';
import { formatAddress } from '../../src/ui/contract/address.mjs';
import { createInspector } from '../../src/ui/shell/inspector.mjs';
import {
  REFERENCE_ASM,
  parseAssembly,
  executeProgram,
  CONTRACT_CASES,
  CONTRACT_REQUIREMENTS,
} from '../../src/core/placement/index.mjs';
import { compileWorkspace, modelToWorkspace } from '../../src/core/placement/visual.mjs';
import { graphFor } from '../../src/ui/shell/layer-graph.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = createRequire(require.resolve('blockly'))('jsdom');
globalThis.window = { Blockly };
await import('../../src/ui/editor/appearance.mjs');
const { localizeWorkspaces, localizedToolbox } = await import('../../src/ui/editor/localization.mjs');
const model = parseAssembly(REFERENCE_ASM);
const state = {
  program: { model, assembly: REFERENCE_ASM },
  inputs: CONTRACT_CASES[1].inputs,
  evaluation: executeProgram(model, CONTRACT_CASES[1].inputs),
};
test.afterEach(() => setLocale('ru', { persist: false }));

test('Russian is the default; explicit choice survives startup and storage failures are harmless', () => {
  assert.equal(getLocale(), 'ru');
  const records = new Map();
  globalThis.localStorage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  };
  initializeLocale();
  assert.equal(getLocale(), 'ru');
  setLocale('en');
  assert.equal(records.get(LOCALE_STORAGE_KEY), 'en');
  setLocale('ru', { persist: false });
  initializeLocale();
  assert.equal(getLocale(), 'en');
  records.set(LOCALE_STORAGE_KEY, 'unsupported');
  initializeLocale();
  assert.equal(getLocale(), 'ru');
  globalThis.localStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  initializeLocale();
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(translate('Unknown diagnostic <code>'), 'Unknown diagnostic <code>');
  assert.equal(
    translate('Сервис недоступен: {message}', { message: '$& <b>error</b>' }),
    'Service unavailable: $& <b>error</b>',
  );
  setLocale('__proto__');
  assert.equal(getLocale(), 'ru');
});

test('catalogs preserve all named parameters and cover marked HTML and translation calls', async () => {
  const messages = LOCALES.en.messages;
  const parameters = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, value] of Object.entries(messages)) {
    assert.deepEqual(parameters(value), parameters(key), key);
    assert.ok(value.length > 0, key);
    assert.doesNotMatch(value, /[а-яё]/i, key);
  }
  const check = (key) => {
    if (/[а-яё]/i.test(key)) assert.ok(Object.hasOwn(messages, key), `Missing English translation: ${key}`);
  };
  for (const item of [...CONTRACT_CASES, ...CONTRACT_REQUIREMENTS]) check(item.title);
  for (const html of [
    await readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    contractTemplate(),
  ]) {
    const dom = new JSDOM(html);
    for (const element of dom.window.document.querySelectorAll('*'))
      for (const attribute of element.attributes)
        if (attribute.name.startsWith('data-i18n')) check(attribute.value);
    dom.window.close();
  }
  const walk = (node, translationArgument = false) => {
    if (!node || typeof node !== 'object') return;
    if (translationArgument && node.type === 'Literal' && typeof node.value === 'string') check(node.value);
    if (node.type === 'CallExpression' && node.callee.name === 't') walk(node.arguments[0], true);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => walk(child, translationArgument));
      else if (value?.type) walk(value, translationArgument);
    }
  };
  for (const area of ['shell', 'contract', 'editor']) {
    const directory = new URL(`../../src/ui/${area}/`, import.meta.url);
    for (const file of await readdir(directory))
      if (file.endsWith('.mjs'))
        walk(
          parse(await readFile(new URL(file, directory), 'utf8'), {
            ecmaVersion: 'latest',
            sourceType: 'module',
          }),
        );
  }
});

test('document labels and inspector translation preserve user text, focus, selection and handlers', async (context) => {
  const dom = new JSDOM(await readFile(new URL('../../index.html', import.meta.url), 'utf8'));
  globalThis.document = dom.window.document;
  const { document } = dom.window;
  context.after(() => dom.window.close());
  const input = document.querySelector('#source-editor');
  document.querySelector('#inspector').hidden = false;
  document.querySelector('#source-view').hidden = false;
  input.value = 'user draft <b>не переводить</b>';
  input.focus();
  input.setSelectionRange(5, 10);
  document.querySelector('#load-address').value = 'unfinished 0x';
  const inspector = createInspector({ state, sourceDirty: true });
  let clicked = 0;
  document.querySelector('#save-program').addEventListener('click', () => clicked++);
  for (const locale of ['en', 'ru', 'en']) {
    setLocale(locale, { persist: false });
    translateDOM(document);
    inspector.renderInputLabels();
    assert.equal(document.documentElement.lang, locale);
    assert.equal(document.activeElement, input);
    assert.equal(input.value, 'user draft <b>не переводить</b>');
    assert.equal(input.selectionStart, 5);
    assert.equal(input.selectionEnd, 10);
    assert.equal(document.querySelector('#load-address').value, 'unfinished 0x');
  }
  assert.equal(document.querySelector('#save-program').textContent, 'Apply');
  assert.equal(input.getAttribute('aria-label'), 'Block assembly');
  assert.equal(document.querySelector('#edit-status').textContent, 'Unsaved changes');
  document.querySelector('#save-program').click();
  assert.equal(clicked, 1);
});

test('contract relocalizes live without losing dirty input or showing stale success', (context) => {
  const dom = new JSDOM('<div id="contract"></div>');
  const host = dom.window.document.querySelector('#contract');
  const view = new ContractView(host);
  context.after(() => {
    view.destroy();
    dom.window.close();
  });
  view.update(state);
  const input = host.querySelector('[name=loadAddress]');
  input.focus();
  input.value = '0x';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  setLocale('en', { persist: false });
  assert.equal(host.querySelector('[name=loadAddress]'), input);
  assert.equal(dom.window.document.activeElement, input);
  assert.equal(input.value, '0x');
  assert.equal(host.querySelector('.cv-state').textContent, 'Input changed');
  assert.equal(host.dataset.status, 'stale');
  assert.equal(host.querySelector('[data-value=actual]').textContent, '—');
  assert.match(
    host.querySelector('[data-requirement=relocation] .cv-requirement-title').textContent,
    /If “Relocation” is off, the address equals “Lower bound”/,
  );
  for (const locale of ['en', 'ru']) {
    setLocale(locale, { persist: false });
    for (const name of ['loadAddress', 'alignment', 'minimumAddress', 'relocatable']) {
      const label = host.querySelector(`.cv-input-area [data-input-name="${name}"]`).textContent;
      const references = host.querySelectorAll(`.cv-requirements [data-input-name="${name}"]`);
      assert.ok(references.length > 0);
      assert.ok([...references].every((reference) => reference.textContent === label));
    }
    assert.doesNotMatch(host.querySelector('.cv-requirements').textContent, /\{\w+\}/);
  }
  setLocale('ru', { persist: false });
  assert.equal(host.querySelector('.cv-state').textContent, 'Вход изменён');
  view.destroy();
  assert.doesNotThrow(() => setLocale('en', { persist: false }));
});

test('English formatting keeps exact u64 addresses and localizes scene metadata', () => {
  assert.equal(formatAddress('0x1380000'), '19,5 МиБ');
  setLocale('en', { persist: false });
  assert.equal(formatAddress('0x1380000'), '19.5 MiB');
  assert.equal(formatAddress('0xffffffffffffffff'), '18446744073709551615 bytes');
  assert.equal(formatAddress('0x'), '—');
  assert.equal(formatNumber(100540), '100,540');
  assert.equal(graphFor('root').nodes[0].title, 'Bootloader');
  assert.equal(graphFor('root').nodes[1].ariaLabel, 'Kernel entry — open layer');
  assert.equal(graphFor('startup').nodes[2].symbol, '%rbp');
});

test('Blockly switches labels with identical serialization, incomplete sockets, compiler output and undo', async (context) => {
  const workspace = new Blockly.Workspace();
  const reference = new Blockly.Workspace();
  context.after(() => {
    workspace.dispose();
    reference.dispose();
  });
  const json = modelToWorkspace(model);
  Blockly.serialization.workspaces.load(json, workspace);
  Blockly.serialization.workspaces.load(json, reference);
  const compiled = compileWorkspace(Blockly.serialization.workspaces.save(workspace));
  const incomplete = workspace.newBlock('arena_assign', 'user-incomplete');
  const literal = workspace.newBlock('arena_literal', 'user-number');
  literal.setFieldValue('0xffffffffffffffff', 'VALUE');
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
  const before = Blockly.serialization.workspaces.save(workspace);
  const undo = [...workspace.getUndoStack()];
  const referenceBefore = Blockly.serialization.workspaces.save(reference);
  for (const locale of ['en', 'ru', 'en']) {
    setLocale(locale, { persist: false });
    localizeWorkspaces(workspace, reference);
    assert.equal(workspace.getBlockById(incomplete.id), incomplete);
    assert.equal(incomplete.getInputTargetBlock('VALUE'), null);
    assert.deepEqual(Blockly.serialization.workspaces.save(workspace), before);
    assert.deepEqual(Blockly.serialization.workspaces.save(reference), referenceBefore);
    assert.deepEqual(compileWorkspace(referenceBefore), compiled);
    assert.deepEqual(workspace.getUndoStack(), undo);
  }
  assert.equal(
    workspace.getBlocksByType('arena_entry')[0].inputList[0].fieldRow[0].getValue(),
    'Choose decompression address',
  );
  const choice = workspace.newBlock('arena_if');
  choice.loadExtraState({ hasElse: true });
  assert.equal(choice.getInput('ELSE_LABEL').fieldRow[0].getValue(), 'else');
  assert.equal(localizedToolbox().contents[0].name, 'Data');
  const binary = workspace.getBlocksByType('arena_binary')[0];
  assert.ok(
    binary
      .getField('OP')
      .getOptions(false)
      .some(([label, value]) => label === 'AND' && value === 'and'),
  );
  assert.match(binary.getTooltip(), /64 bits/);
  setLocale('ru', { persist: false });
  localizeWorkspaces(workspace, reference);
  assert.equal(choice.getInput('ELSE_LABEL').fieldRow[0].getValue(), 'иначе');
});

test('locale subscriptions can be removed and redundant selections do not notify', () => {
  const seen = [];
  const unsubscribe = onLocaleChange((locale) => seen.push(locale));
  setLocale('en', { persist: false });
  setLocale('en', { persist: false });
  unsubscribe();
  setLocale('ru', { persist: false });
  assert.deepEqual(seen, ['en']);
});

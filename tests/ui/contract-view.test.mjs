import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ContractView } from '../../src/ui/contract/contract-view.mjs';
import { CONTRACT_CASES } from '../../src/core/placement/index.mjs';
import { REFERENCE_ASM, parseAssembly, executeProgram } from '../../src/core/placement/index.mjs';

// Blockly already depends on jsdom for its supported Node environment.
const require = createRequire(import.meta.url);
const requireBlockly = createRequire(require.resolve('blockly'));
const { JSDOM } = requireBlockly('jsdom');
const model = parseAssembly(REFERENCE_ASM);
const state = (inputs = CONTRACT_CASES[1].inputs) => ({
  program: { model },
  inputs,
  evaluation: executeProgram(model, inputs),
});

function fixture(t, callbacks) {
  const dom = new JSDOM('<!doctype html><div id="contract"></div>');
  const host = dom.window.document.getElementById('contract');
  const view = new ContractView(host, callbacks);
  view.update(state());
  t.after(() => {
    view.destroy();
    dom.window.close();
  });
  return { dom, host, view };
}

test('contract view displays independent outputs and suppresses old success for incomplete drafts', (t) => {
  const { host, view } = fixture(t);
  assert.equal(host.dataset.status, 'passed');
  assert.equal(host.querySelector('[data-value=expected]').textContent, '20 МиБ');
  assert.equal(host.querySelector('[data-value=actual]').textContent, '20 МиБ');
  assert.equal(host.querySelector('.cv-state').textContent, '12/12 проверок');
  assert.equal(host.querySelector('.cv-goal'), null);
  assert.deepEqual(
    [...host.querySelectorAll('.cv-requirement .cv-requirement-mark')].map((mark) => mark.textContent),
    ['✓', '✓', '✓'],
  );
  assert.equal(
    host.querySelector('[data-requirement=relocation] .cv-requirement-title').textContent,
    'Если «Перемещение» выключено, адрес равен «Нижняя граница»',
  );
  assert.ok([...host.querySelectorAll('.cv-case-mark')].every((mark) => mark.textContent === '·'));
  assert.deepEqual(
    [...host.querySelectorAll('.cv-requirement')].map(
      (group) => group.querySelectorAll('[data-case]').length,
    ),
    [6, 3, 3],
  );
  assert.equal(host.querySelector('.cv-requirements .cv-suite'), null);
  assert.equal(host.querySelector('.cv-suite .cv-requirement-mark'), null);
  view.setDraftState({ valid: false, error: 'Disconnected input' });
  assert.equal(host.dataset.status, 'stale');
  assert.equal(host.querySelector('[data-value=expected]').textContent, '20 МиБ');
  assert.equal(host.querySelector('[data-value=actual]').textContent, '—');
  assert.ok([...host.querySelectorAll('.cv-case')].every((button) => button.dataset.status === 'pending'));
  assert.equal(host.querySelector('.cv-run'), null);
  view.setDraftState({ valid: true });
  assert.equal(host.dataset.status, 'passed');
});

test('a failed condition explains the observed path and can reveal its exact instructions', async (t) => {
  const problems = [];
  const { host, view } = fixture(t, { onProblem: (problem) => problems.push(problem) });
  const assembly = `#ifdef CONFIG_RELOCATABLE\n#endif\n${REFERENCE_ASM.replace('#ifdef CONFIG_RELOCATABLE', '').replace('#endif', '')}`;
  const model = parseAssembly(assembly);
  const inputs = CONTRACT_CASES[3].inputs;
  view.update({ program: { model }, inputs, evaluation: executeProgram(model, inputs) });
  assert.equal(host.querySelector('.cv-state').textContent, '10/12 проверок');
  const failed = host.querySelector('[data-case=fixed]');
  assert.equal(failed.dataset.status, 'failed');
  assert.equal(failed.querySelector('.cv-case-mark').textContent, '×');
  assert.equal(failed.querySelector('[data-case-actual]').textContent, 'Должно: 16 МиБ; сейчас: 20 МиБ');
  assert.equal(failed.querySelector('[data-case-reason]').hidden, false);
  assert.match(failed.querySelector('[data-case-reason]').textContent, /даже при выключенном перемещении/);
  failed.click();
  const show = host.querySelector('.cv-problem');
  assert.equal(show.hidden, false);
  show.click();
  await Promise.resolve();
  assert.equal(problems.length, 1);
  assert.deepEqual(problems[0].inputs, { ...inputs });
  assert.ok(
    problems[0].instructionIds.some(
      (id) => model.instructions.find((item) => item.id === id)?.op === 'branch_ge',
    ),
  );
  view.setDraftState({ valid: false, pending: true });
  assert.equal(show.hidden, true);
  assert.equal(failed.querySelector('[data-case-reason]').hidden, true);
  assert.equal(failed.querySelector('.cv-case-mark').textContent, '·');
});

test('state updates preserve the focused input and unsaved text without recreating the form', (t) => {
  const { dom, host, view } = fixture(t);
  const input = host.querySelector('[name=loadAddress]');
  input.focus();
  input.value = '0xabc';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  view.update(state(CONTRACT_CASES[0].inputs));
  assert.equal(host.querySelector('[name=loadAddress]'), input);
  assert.equal(dom.window.document.activeElement, input);
  assert.equal(input.value, '0xabc');
  assert.equal(host.dataset.status, 'stale');
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(input.value, CONTRACT_CASES[0].inputs.loadAddress);
  assert.equal(host.dataset.status, 'passed');
});

test('pending draft compilation is distinct from an incomplete scheme and cannot show stale success', (t) => {
  const { host, view } = fixture(t);
  view.setDraftState({ valid: false, pending: true });
  assert.equal(host.querySelector('.cv-state').textContent, 'Обновляем…');
  assert.equal(host.querySelector('[data-address=actual]').textContent, 'Обновляем…');
  assert.equal(host.dataset.status, 'stale');
  assert.equal(host.querySelector('[data-value=actual]').textContent, '—');
  view.setDraftState({ valid: false, pending: false });
  assert.equal(host.querySelector('.cv-state').textContent, 'Схема не завершена');
  view.setDraftState({ valid: true, pending: true });
  assert.equal(host.dataset.status, 'stale');
  view.setDraftState({ valid: true });
  assert.equal(host.dataset.status, 'passed');
});

test('selecting a test previews its real inputs without persisting or invalidating the suite', async (t) => {
  const submitted = [];
  const { host } = fixture(t, {
    onInputs: async (patch) => {
      submitted.push(patch);
      return state(patch);
    },
  });
  host.querySelector('[data-case=below-floor]').click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(submitted, []);
  assert.equal(host.querySelector('[data-value=expected]').textContent, '16 МиБ');
  assert.equal(host.querySelector('[data-value=actual]').textContent, '16 МиБ');
  assert.equal(host.querySelector('[data-case=below-floor]').getAttribute('aria-pressed'), 'true');
  assert.equal(host.querySelector('[name=loadAddress]').value, '0x800000');
  assert.equal(host.querySelector('[name=loadAddress]').readOnly, true);
  host.querySelector('.cv-manual').click();
  assert.equal(host.querySelector('[name=loadAddress]').readOnly, false);
  assert.equal(host.querySelector('[name=loadAddress]').value, CONTRACT_CASES[1].inputs.loadAddress);
});

test('editing an input invokes the callback and rejected values never keep a success state', async (t) => {
  const submitted = [];
  const { dom, host, view } = fixture(t, {
    onInputs: async (patch) => {
      submitted.push(patch);
      if (patch.loadAddress === 'bad') throw new Error('Invalid input');
      return state({ ...CONTRACT_CASES[1].inputs, ...patch });
    },
  });
  const input = host.querySelector('[name=loadAddress]');
  input.value = '0x2100000';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(submitted[0], { loadAddress: '0x2100000' });
  assert.equal(host.querySelector('[data-value=actual]').textContent, '34 МиБ');
  input.value = 'bad';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await view.applyInputs({ loadAddress: 'bad' });
  assert.equal(host.dataset.status, 'stale');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(host.querySelector('[data-value=actual]').textContent, '—');
});

test('a real check run displays each input, marks requirements and keeps the first mismatch selected', async (t) => {
  const previewed = [];
  const { host, view } = fixture(t, { onPreview: (inputs) => previewed.push(inputs) });
  const broken = parseAssembly(REFERENCE_ASM.replace('andq', 'orq'));
  const inputs = CONTRACT_CASES[1].inputs;
  view.update({ program: { model: broken }, inputs, evaluation: executeProgram(broken, inputs) });
  const pending = view.runChecks();
  assert.equal(host.dataset.status, 'running');
  assert.equal(host.querySelector('[name=loadAddress]').value, '0x1200000');
  assert.equal(host.querySelector('[data-value=actual]').textContent, '—');
  assert.equal(host.querySelector('[data-case=aligned]').dataset.status, 'running');
  await pending;
  view.finishChecks();
  assert.equal(previewed.filter(Boolean).length, 13);
  assert.equal(view.run.results.size, 12);
  assert.equal(view.preview.id, 'aligned');
  assert.equal(host.dataset.status, 'failed');
  assert.equal(host.querySelector('[data-address=expected]').textContent, '0x1200000');
  assert.notEqual(host.querySelector('[data-address=actual]').textContent, '0x1200000');
  assert.match(host.querySelector('.cv-diagnostic').textContent, /Не совпал адрес/);
  assert.equal(host.querySelector('[data-requirement=alignment] .cv-requirement-mark').textContent, '×');
  assert.equal(view.state.inputs, inputs);
});

test('preview and check progress preserve unfinished manual input across locale-neutral state updates', async (t) => {
  const { dom, host, view } = fixture(t);
  const field = host.querySelector('[name=loadAddress]');
  field.focus();
  field.value = '0x';
  field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const pending = view.runChecks();
  assert.equal(field.readOnly, true);
  view.update(state());
  await pending;
  view.finishChecks();
  host.querySelector('.cv-manual').click();
  assert.equal(field.value, '0x');
  assert.equal(field.readOnly, false);
  assert.equal(view.dirty.has('loadAddress'), true);
  assert.equal(host.dataset.status, 'stale');
});

test('changing the program cancels an in-flight check and cannot restore obsolete successes', async (t) => {
  const { host, view } = fixture(t);
  const pending = view.runChecks();
  view.setDraftState({ valid: false, pending: true });
  assert.equal(await pending, false);
  assert.equal(view.run, null);
  assert.equal(host.dataset.status, 'stale');
  assert.equal(host.querySelector('[data-value=actual]').textContent, '—');
  assert.ok([...host.querySelectorAll('.cv-requirement-mark')].every((mark) => mark.textContent === '·'));
});

test('a full-suite failure stays visible even if every named requirement passes', (t) => {
  const { host, view } = fixture(t);
  const failedInputs = { ...CONTRACT_CASES[0].inputs, loadAddress: '0xffffffffffffffff' };
  const failed = { inputs: failedInputs, expected: '0x1000000', actual: '0x0' };
  const candidate = {
    status: 'failed',
    passed: 4198,
    total: 4199,
    failed: 1,
    failures: [failed],
    groups: [
      { id: 'requirements', status: 'passed', passed: 12, total: 12, failures: [] },
      { id: 'current', status: 'passed', passed: 1, total: 1, failures: [] },
      { id: 'boundaries', status: 'failed', passed: 89, total: 90, failures: [failed] },
      { id: 'random', status: 'passed', passed: 4096, total: 4096, failures: [] },
    ],
  };
  view.update({ ...state(), checks: { candidate } });
  assert.equal(host.dataset.status, 'failed');
  assert.equal(host.querySelector('.cv-state').textContent, '4198/4199 проверок');
  assert.equal(host.querySelector('[data-batch=boundaries] .cv-batch-count').textContent, '89/90');
  host.querySelector('[data-case=suite-0]').click();
  assert.equal(host.querySelector('[name=loadAddress]').value, '0xffffffffffffffff');
  assert.equal(host.querySelector('[data-address=expected]').textContent, '0x1000000');
  assert.equal(host.querySelector('[data-address=actual]').textContent, '0x0');
  assert.match(host.querySelector('.cv-diagnostic').textContent, /ожидалось 0x1000000, получено 0x0/);
  assert.equal(view.state.checks.candidate, candidate);
});

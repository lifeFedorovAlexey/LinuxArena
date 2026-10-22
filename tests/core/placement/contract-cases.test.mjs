import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_ASM, parseAssembly, executeProgram } from '../../../src/core/placement/index.mjs';
import {
  CONTRACT_CASES,
  evaluateContractCases,
  sameContractInputs,
  formatAddress,
} from '../../../src/core/placement/cases.mjs';

const makeState = (assembly = REFERENCE_ASM, inputs = CONTRACT_CASES[1].inputs) => {
  const model = parseAssembly(assembly);
  return { program: { model }, inputs, evaluation: executeProgram(model, inputs) };
};

test('twelve named checks cover three requirements with different inputs', () => {
  const result = evaluateContractCases(makeState());
  assert.equal(result.status, 'passed');
  assert.equal(result.passedCount, 12);
  assert.equal(new Set(CONTRACT_CASES.map((item) => item.id)).size, 12);
  assert.deepEqual(
    ['alignment', 'minimum', 'relocation'].map(
      (id) => CONTRACT_CASES.filter((item) => item.requirement === id).length,
    ),
    [6, 3, 3],
  );
  assert.deepEqual(
    result.cases.map((item) => item.expected),
    [
      '0x1200000',
      '0x1400000',
      '0x1000000',
      '0x1000000',
      '0x1800000',
      '0x1000000',
      '0x1400000',
      '0x1400000',
      '0x1000000',
      '0x1800000',
      '0x1000000',
      '0x1800000',
    ],
  );
  assert.ok(result.cases.every((item) => item.passed));
  assert.equal(result.current.expected, '0x1400000');
  assert.equal(result.current.actual, '0x1400000');
});

test('expected outputs stay anchored to Linux when the candidate changes', () => {
  const result = evaluateContractCases(makeState(REFERENCE_ASM.replace('andq', 'orq')));
  assert.equal(result.status, 'failed');
  assert.equal(result.current.expected, '0x1400000');
  assert.notEqual(result.current.actual, result.current.expected);
  assert.deepEqual(
    result.cases.map((item) => item.expected),
    [
      '0x1200000',
      '0x1400000',
      '0x1000000',
      '0x1000000',
      '0x1800000',
      '0x1000000',
      '0x1400000',
      '0x1400000',
      '0x1000000',
      '0x1800000',
      '0x1000000',
      '0x1800000',
    ],
  );
  assert.ok(result.passedCount < 12);
});

test('an incomplete draft never retains successful outputs or case indicators', () => {
  const result = evaluateContractCases(makeState(), { draftValid: false });
  assert.equal(result.status, 'stale');
  assert.equal(result.current.expected, '0x1400000');
  assert.equal(result.current.actual, null);
  assert.equal(result.current.passed, null);
  assert.equal(result.passedCount, 0);
  assert.ok(result.cases.every((item) => item.actual === null && item.passed === null));
});

test('a matching current output cannot hide failures in other cases', () => {
  const inputs = CONTRACT_CASES[3].inputs;
  const result = evaluateContractCases(makeState(REFERENCE_ASM.replace('andq', 'orq'), inputs));
  assert.equal(result.current.passed, true);
  assert.equal(result.status, 'failed');
  assert.ok(result.cases.some((item) => item.passed === false));
});

test('invalid input and model states are explicit without crashing the view', () => {
  const state = makeState();
  state.inputs = { ...state.inputs, loadAddress: 'not-an-address' };
  const invalidInput = evaluateContractCases(state);
  assert.equal(invalidInput.status, 'failed');
  assert.equal(invalidInput.current.expected, null);
  assert.ok(invalidInput.current.error);
  const invalidModel = evaluateContractCases({ ...makeState(), program: { model: {} } });
  assert.equal(invalidModel.status, 'failed');
  assert.equal(invalidModel.passedCount, 0);
  assert.ok(invalidModel.cases.every((item) => item.error));
  assert.equal(evaluateContractCases(null).status, 'empty');
});

test('nonstandard inputs are not presented as a fully successful contract', () => {
  const result = evaluateContractCases(
    makeState(REFERENCE_ASM, { ...CONTRACT_CASES[1].inputs, alignment: '0x3' }),
  );
  assert.equal(result.current.passed, true);
  assert.equal(result.status, 'caution');
});

test('case matching preserves boolean semantics and accepts equivalent numeric notation', () => {
  const original = CONTRACT_CASES[1].inputs;
  assert.equal(
    sameContractInputs(original, { ...original, loadAddress: String(BigInt(original.loadAddress)) }),
    true,
  );
  assert.equal(sameContractInputs(original, { ...original, relocatable: false }), false);
  assert.equal(sameContractInputs(original, { ...original, alignment: 'bad' }), false);
  assert.equal(formatAddress('0x1380000'), '19,5 МиБ');
  assert.equal(formatAddress('0x1400000'), '20 МиБ');
  assert.equal(formatAddress('0x1000001'), '16777217 байт');
});

const outsideGuard = `#ifdef CONFIG_RELOCATABLE\n#endif\n${REFERENCE_ASM.replace('#ifdef CONFIG_RELOCATABLE', '').replace('#endif', '')}`;

test('disabled relocation reports the proven unguarded calculation and skipped minimum', () => {
  const state = makeState(outsideGuard, CONTRACT_CASES[3].inputs);
  const snapshot = JSON.stringify(state);
  const result = evaluateContractCases(state);
  assert.equal(result.passedCount, 10);
  const failed = result.cases[3];
  assert.equal(failed.expected, '0x1000000');
  assert.equal(failed.actual, '0x1400000');
  assert.equal(failed.diagnostic.kind, 'outside-relocation-guard');
  assert.equal(
    failed.diagnostic.message,
    'Адрес вычисляется даже при выключенном перемещении; ветка нижней границы пропускается.',
  );
  const evidence = failed.diagnostic.evidence;
  assert.equal(evidence.relocatable, false);
  assert.ok(
    state.evaluation.trace.some(
      (step) => step.id === evidence.takenBranch && step.op === 'branch_ge' && step.taken,
    ),
  );
  assert.ok(!state.evaluation.trace.some((step) => step.id === evidence.skippedMinimum));
  assert.ok(
    state.program.model.instructions.some(
      (step) => step.id === evidence.skippedMinimum && step.op === 'load_minimum',
    ),
  );
  assert.ok(failed.diagnostic.instructionIds.includes(evidence.takenBranch));
  assert.ok(failed.diagnostic.instructionIds.includes(evidence.skippedMinimum));
  assert.equal(JSON.stringify(state), snapshot, 'diagnosis must not modify the user candidate or inputs');
});

test('a mismatching output alone cannot imply that the minimum branch was skipped', () => {
  const noMinimum = outsideGuard.replace(/^\s*movq[^\n]+/m, '');
  const failed = evaluateContractCases(makeState(noMinimum)).cases[3];
  assert.equal(failed.actual, '0x1400000');
  assert.equal(failed.diagnostic.kind, 'output-mismatch');
  assert.equal(failed.diagnostic.message, 'Этот вход должен дать 16 МиБ, получает 20 МиБ.');
  assert.deepEqual(failed.diagnostic.instructionIds, []);
  assert.equal(failed.diagnostic.evidence, null);
});

test('a later overwrite does not receive an unrelated branch explanation', () => {
  const overwritten = `${outsideGuard}\nleaq startup_32(%rip) /* - $startup_32 */, %rbp`;
  const failed = evaluateContractCases(makeState(overwritten)).cases[3];
  assert.equal(failed.actual, '0x1380000');
  assert.equal(failed.diagnostic.kind, 'output-mismatch');
  const stale = evaluateContractCases(makeState(outsideGuard), { draftValid: false });
  assert.ok(stale.cases.every((item) => item.diagnostic === null));
});

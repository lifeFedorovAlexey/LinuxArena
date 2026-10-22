// SPDX-License-Identifier: GPL-2.0-only
import { parseAssembly, serializeAssembly, executeProgram } from './model.mjs';
import { validateInputs, referenceResult } from './inputs.mjs';

const inputs = (loadAddress, relocatable = true) =>
  Object.freeze({
    loadAddress,
    alignment: '0x200000',
    minimumAddress: '0x1000000',
    relocatable,
  });

export const CONTRACT_CASES = Object.freeze([
  Object.freeze({ id: 'aligned', title: 'Подходящий адрес не менять', inputs: inputs('0x1200000') }),
  Object.freeze({ id: 'round-up', title: 'Округлять вверх до ближайшего шага', inputs: inputs('0x1380000') }),
  Object.freeze({ id: 'below-floor', title: 'Не опускаться ниже границы', inputs: inputs('0x800000') }),
  Object.freeze({
    id: 'fixed',
    title: 'Без перемещения брать нижнюю границу',
    inputs: inputs('0x1380000', false),
  }),
]);

const same = (left, right) => {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
};

export function sameContractInputs(left, right) {
  return (
    !!left &&
    !!right &&
    left.relocatable === right.relocatable &&
    ['loadAddress', 'alignment', 'minimumAddress'].every((key) => same(left[key], right[key]))
  );
}

export function formatAddress(value) {
  try {
    const address = BigInt(value);
    if (address === 0n) return '0 байт';
    if (address % 1048576n === 0n) return `${address / 1048576n} МиБ`;
    if (address % 524288n === 0n) return `${address / 1048576n},5 МиБ`;
    if (address % 1024n === 0n) return `${address / 1024n} КиБ`;
    return `${address} байт`;
  } catch {
    return '—';
  }
}

/** Explain a cause only when the executed path proves it; never infer from the output alone. */
function diagnoseFailure(model, caseInputs, evaluation, expected) {
  const fallback = {
    kind: 'output-mismatch',
    message: `Этот вход должен дать ${formatAddress(expected)}, получает ${formatAddress(evaluation.output)}.`,
    instructionIds: [],
    evidence: null,
  };
  if (caseInputs.relocatable !== false) return fallback;
  // Use the same canonical instruction identities as executeProgram, not caller-supplied IDs/flags.
  const instructions = parseAssembly(serializeAssembly(model)).instructions;
  const byId = new Map(instructions.map((item, index) => [item.id, { ...item, index }]));
  const trace = evaluation.trace;
  const branchAt = trace.findIndex((item) => item.op === 'branch_ge' && item.taken === true);
  if (branchAt < 0) return fallback;
  const branch = trace[branchAt];
  const prefix = trace.slice(0, branchAt);
  const lastAssignment = prefix.findLast((item) => item.op === 'load_base' || item.op === 'load_minimum');
  if (lastAssignment?.op !== 'load_base') return fallback;
  const calculation = prefix.slice(prefix.indexOf(lastAssignment));
  const addAt = calculation.findIndex((item) => item.op === 'add64');
  const maskAt = calculation.findIndex((item) => item.op === 'and64');
  if (addAt < 0 || maskAt <= addAt || calculation.at(-1)?.op !== 'compare_minimum') return fallback;
  if (calculation.some((item) => byId.get(item.id)?.conditional !== false)) return fallback;
  const target = trace[branchAt + 1];
  if (target?.op !== 'label' || trace.slice(branchAt + 1).some((item) => item.op !== 'label'))
    return fallback;
  const skippedMinimum = instructions.find(
    (item) =>
      item.op === 'load_minimum' &&
      byId.get(item.id).index > byId.get(branch.id).index &&
      byId.get(item.id).index < byId.get(target.id).index &&
      !item.conditional &&
      !trace.some((step) => step.id === item.id),
  );
  if (!skippedMinimum || !same(branch.registers.rbp, evaluation.output)) return fallback;
  return {
    kind: 'outside-relocation-guard',
    message: 'Адрес вычисляется даже при выключенном перемещении; ветка нижней границы пропускается.',
    instructionIds: [...calculation.map((item) => item.id), branch.id, skippedMinimum.id],
    evidence: {
      relocatable: false,
      executedOutsideGuard: calculation.map((item) => item.id),
      takenBranch: branch.id,
      skippedMinimum: skippedMinimum.id,
      reachedLabel: target.id,
    },
  };
}

/** Expected values always come from the immutable Linux reference semantics. */
export function evaluateContractCases(state, { draftValid = true } = {}) {
  const current = { expected: null, actual: null, passed: null, error: null, warnings: [] };
  if (state?.inputs) {
    try {
      current.expected = referenceResult(state.inputs);
      current.warnings = validateInputs(state.inputs).warnings;
    } catch (error) {
      current.error = error.message;
    }
    if (draftValid) {
      current.actual = state.evaluation?.output ?? null;
      if (current.actual !== null && current.expected !== null)
        current.passed = same(current.actual, current.expected);
    }
  }
  const cases = CONTRACT_CASES.map((item) => {
    const result = {
      ...item,
      expected: referenceResult(item.inputs),
      actual: null,
      passed: null,
      error: null,
      diagnostic: null,
    };
    if (draftValid && state?.program?.model) {
      try {
        const evaluation = executeProgram(state.program.model, item.inputs);
        result.actual = evaluation.output;
        result.passed = same(result.actual, result.expected);
        if (!result.passed)
          result.diagnostic = diagnoseFailure(state.program.model, item.inputs, evaluation, result.expected);
      } catch (error) {
        result.error = error.message;
        result.passed = false;
      }
    }
    return result;
  });
  const passedCount = cases.filter((item) => item.passed === true).length;
  const total = cases.length;
  let status = 'empty';
  if (state) {
    if (!draftValid) status = 'stale';
    else if (current.error || current.passed === false || cases.some((item) => item.passed === false))
      status = 'failed';
    else if (current.warnings.length) status = 'caution';
    else if (current.passed === true && passedCount === total) status = 'passed';
  }
  return { current, cases, passedCount, total, status };
}

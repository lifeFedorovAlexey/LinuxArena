import { createHash } from 'node:crypto';
import {
  parseAssembly,
  executeProgram,
  referenceResult,
  CONTRACT_CASES,
} from '../../core/placement/index.mjs';
import { DEFAULT_INPUTS } from './defaults.mjs';
const hash = (text) => createHash('sha256').update(text).digest('hex');
export function checkCandidate(assembly, currentInputs = DEFAULT_INPUTS) {
  const model = parseAssembly(assembly);
  const boundaries = [];
  const randomInputs = [];
  const addresses = [
    0n,
    1n,
    0xffffffn,
    0x1000000n,
    0x1000001n,
    0x11fffffn,
    0x1200000n,
    0x123456789n,
    0xffffffffffffffffn,
  ];
  const alignments = [0x200000n, 0x400000n, 0x1000000n, 0x40000000n, 0x80000000n];
  for (const load of addresses) {
    for (const alignment of alignments) {
      for (const relocatable of [true, false]) {
        boundaries.push({
          loadAddress: `0x${load.toString(16)}`,
          alignment: `0x${alignment.toString(16)}`,
          minimumAddress: '0x1000000',
          relocatable,
        });
      }
    }
  }
  let seed = 0x6e1858;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  for (let i = 0; i < 4096; i++) {
    const load = (BigInt(random() & 0xfffff) << 32n) | BigInt(random());
    randomInputs.push({
      loadAddress: `0x${load.toString(16)}`,
      alignment: `0x${(1n << BigInt(21 + (random() % 11))).toString(16)}`,
      minimumAddress: '0x1000000',
      relocatable: i % 5 !== 0,
    });
  }
  const groups = [
    checkGroup(
      model,
      'requirements',
      CONTRACT_CASES.map((item) => ({ ...item.inputs })),
    ),
    checkGroup(model, 'current', [{ ...currentInputs }]),
    checkGroup(model, 'boundaries', boundaries),
    checkGroup(model, 'random', randomInputs),
  ];
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  const passed = groups.reduce((sum, group) => sum + group.passed, 0);
  return {
    status: passed === total ? 'passed' : 'failed',
    scope: 'candidate-interpreter-vs-linux-semantics',
    total,
    passed,
    failed: total - passed,
    failures: groups.flatMap((group) => group.failures).slice(0, 3),
    groups,
    programHash: hash(assembly),
    bootVerified: false,
  };
}

function checkGroup(model, id, samples) {
  let passed = 0;
  const failures = [];
  for (const inputs of samples) {
    const expected = referenceResult(inputs);
    try {
      const actual = executeProgram(model, inputs).output;
      if (BigInt(actual) === BigInt(expected)) passed++;
      else if (failures.length < 3) failures.push({ inputs, expected, actual });
    } catch (error) {
      if (failures.length < 3) failures.push({ inputs, expected, error: error.message });
    }
  }
  return {
    status: passed === samples.length ? 'passed' : 'failed',
    id,
    total: samples.length,
    passed,
    failed: samples.length - passed,
    failures,
  };
}

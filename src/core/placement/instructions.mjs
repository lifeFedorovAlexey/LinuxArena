// SPDX-License-Identifier: GPL-2.0-only
import { executeGenericInstruction } from '../machine/isa.mjs';
import { LINUX_INPUT_BINDINGS } from './dialect.mjs';

/** Preserve the original generalized minimum comparison, including its documented imm32 limit. */
export function executePlacementInstruction(instruction, machine, inputValues) {
  if (instruction.op === 'compare_minimum') {
    const address = machine.registers.rbp;
    if (address === null || address === undefined) throw new Error('Чтение %rbp до присвоения адреса.');
    machine.carry = address < inputValues.minimumAddress;
    machine.zero = address === inputValues.minimumAddress;
    return true;
  }
  const operation = placementInstruction(instruction);
  if (!operation) return false;
  executeGenericInstruction(operation, machine, inputValues, LINUX_INPUT_BINDINGS);
  return true;
}

const register = (name) => ({ kind: 'register', name });
const input = (name) => ({ kind: 'input', name });
const unary = (mnemonic, width, dest) => ({ op: 'generic', mnemonic, width, operands: [register(dest)] });
const binary = (mnemonic, width, src, dest) => ({
  op: 'generic',
  mnemonic,
  width,
  operands: [src, register(dest)],
});

export function placementInstruction(instruction) {
  if (instruction.op === 'generic') return instruction;
  const simple = {
    load_base: binary('lea', 64, input('loadAddress'), 'rbp'),
    load_alignment: binary('mov', 32, input('alignment'), 'rax'),
    load_minimum: binary('mov', 64, input('minimumAddress'), 'rbp'),
    decrement32: unary('dec', 32, 'rax'),
    increment32: unary('inc', 32, 'rax'),
    invert64: unary('not', 64, 'rax'),
    compare_minimum: binary('cmp', 64, input('minimumAddress'), 'rbp'),
    add64: binary('add', 64, register('rax'), 'rbp'),
    subtract64: binary('sub', 64, register('rax'), 'rbp'),
    and64: binary('and', 64, register('rax'), 'rbp'),
    or64: binary('or', 64, register('rax'), 'rbp'),
    xor64: binary('xor', 64, register('rax'), 'rbp'),
  };
  return simple[instruction.op] ?? null;
}

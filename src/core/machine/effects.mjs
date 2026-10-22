// SPDX-License-Identifier: GPL-2.0-only
import { ISA_REGISTERS } from './isa.mjs';
import { parseAssembly, serializeAssembly } from './grammar.mjs';
export function inferEffects(program, dialect) {
  const legacyWrites = dialect.registerWrites ?? new Map();
  const writes = new Set(
    program.instructions.flatMap((item) => {
      if (item.op === 'generic') return item.mnemonic === 'cmp' ? [] : [item.operands.at(-1).name];
      return legacyWrites.has(item.op) ? [legacyWrites.get(item.op)] : [];
    }),
  );
  return {
    registersWritten: ISA_REGISTERS.filter((name) => writes.has(name)),
    extraClobbers: ISA_REGISTERS.filter(
      (name) => !dialect.publicRegisters?.includes(name) && writes.has(name),
    ),
  };
}

/** Potential writes across every branch; the reference ABI is not expanded by candidate scratch use. */
export function inferProgramEffects(model, dialect) {
  return inferEffects(parseAssembly(serializeAssembly(model, dialect), dialect), dialect);
}

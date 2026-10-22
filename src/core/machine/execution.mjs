// SPDX-License-Identifier: GPL-2.0-only
import { ISA_REGISTERS, executeGenericInstruction } from './isa.mjs';
import { parseAssembly, serializeAssembly } from './grammar.mjs';
import { inferEffects } from './effects.mjs';
import { hex } from './numbers.mjs';

const branchTaken = (operation, carry, zero) =>
  ({
    branch_ge: !carry,
    branch_lt: carry,
    branch_gt: !carry && !zero,
    branch_le: carry || zero,
    branch_eq: zero,
    branch_ne: !zero,
    jump: true,
  })[operation];

/** Bounded register execution. The caller owns input validation, initial state and legacy bindings. */
export function executeMachine(model, context) {
  const { dialect, inputValues, configValue, initialRegisters, initialFlags, outputRegister, executeLegacy } =
    context;
  const program = parseAssembly(serializeAssembly(model, dialect), dialect);
  const machine = {
    registers: { ...initialRegisters },
    carry: initialFlags.carry,
    zero: initialFlags.zero,
    clobbers: new Set(),
  };
  const snapshot = () =>
    Object.fromEntries(Object.entries(machine.registers).map(([name, value]) => [name, hex(value)]));
  const trace = [];
  const labels = new Map(
    program.instructions.flatMap((item, index) => (item.op === 'label' ? [[item.labelId, index]] : [])),
  );
  for (let pc = 0; pc < program.instructions.length; pc++) {
    const item = program.instructions[pc];
    const { op } = item;
    if (op.startsWith('config_')) continue;
    if (item.conditional && item.configValue !== configValue) continue;
    const before = snapshot();
    let taken;
    if (op === 'generic') executeGenericInstruction(item, machine, inputValues, dialect.inputBindings);
    else if (op.startsWith('branch_') || op === 'jump') taken = branchTaken(op, machine.carry, machine.zero);
    else if (op !== 'label') {
      if (!executeLegacy?.(item, machine, inputValues)) throw new Error(`Операция ${op} не реализована.`);
      const written = dialect.registerWrites?.get(op);
      if (written) machine.clobbers.add(written);
    }
    trace.push({
      id: item.id,
      op,
      label: item.label,
      line: item.sourceLine,
      referenceLine: item.referenceLine,
      assembly: item.sourceText,
      before,
      registers: snapshot(),
      flags: { carry: machine.carry, zero: machine.zero },
      ...(taken === undefined ? {} : { taken }),
      ...(item.target === undefined ? {} : { target: item.target }),
      ...(item.labelId === undefined ? {} : { labelId: item.labelId }),
    });
    if (taken) pc = labels.get(item.target) - 1;
  }
  const output = machine.registers[outputRegister];
  if (output === null || output === undefined)
    throw new Error(`Чтение %${outputRegister} до присвоения значения.`);
  return {
    output: hex(output),
    trace,
    registers: snapshot(),
    clobbers: ISA_REGISTERS.filter((name) => machine.clobbers.has(name)),
    inferredEffects: inferEffects(program, dialect),
  };
}

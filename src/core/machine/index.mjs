// SPDX-License-Identifier: GPL-2.0-only
export {
  ISA_REGISTERS,
  parseGenericInstruction,
  serializeGenericInstruction,
  validateGenericInstruction,
  executeGenericInstruction,
} from './isa.mjs';
export { MAX_INSTRUCTIONS, MAX_ASSEMBLY_LENGTH, parseAssembly, serializeAssembly } from './grammar.mjs';
export { buildControlFlow } from './control-flow.mjs';
export { inferProgramEffects } from './effects.mjs';
export { executeMachine } from './execution.mjs';

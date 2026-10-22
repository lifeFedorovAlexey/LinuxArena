// SPDX-License-Identifier: GPL-2.0-only
import * as grammar from '../machine/grammar.mjs';
import { buildControlFlow as buildGraph } from '../machine/control-flow.mjs';
import { inferProgramEffects as inferEffects } from '../machine/effects.mjs';
import { executeMachine } from '../machine/execution.mjs';
import { PLACEMENT_DIALECT } from './dialect.mjs';
import { validateInputs } from './inputs.mjs';
import { executePlacementInstruction } from './instructions.mjs';

const kernelLimits = { kernelAbiVerified: false, kernelPatchEligible: false };
export const parseAssembly = (source) => grammar.parseAssembly(source, PLACEMENT_DIALECT);
export const serializeAssembly = (model) => grammar.serializeAssembly(model, PLACEMENT_DIALECT);
export const buildControlFlow = (model) => buildGraph(model, PLACEMENT_DIALECT);
export const inferProgramEffects = (model) => ({
  ...inferEffects(model, PLACEMENT_DIALECT),
  ...kernelLimits,
});

export function executeProgram(model, inputs = {}) {
  const input = validateInputs(inputs);
  const result = executeMachine(model, {
    dialect: PLACEMENT_DIALECT,
    inputValues: { loadAddress: input.load, alignment: input.alignment, minimumAddress: input.minimum },
    configValue: input.relocatable,
    // xorl %eax,%eax in the preceding hardware block establishes these values.
    initialRegisters: { rax: 0n, rbp: null },
    initialFlags: { carry: false, zero: true },
    outputRegister: 'rbp',
    executeLegacy: executePlacementInstruction,
  });
  return {
    ...result,
    inferredEffects: { ...result.inferredEffects, ...kernelLimits },
    warnings: input.warnings,
  };
}

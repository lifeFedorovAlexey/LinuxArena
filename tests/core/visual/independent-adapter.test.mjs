import test from 'node:test';
import assert from 'node:assert/strict';
import * as machine from '../../../src/core/machine/index.mjs';
import {
  modelToWorkspace,
  compileWorkspace,
  validateWorkspaceDraft,
  createVisualBlockDefinitions,
} from '../../../src/core/visual/index.mjs';

// This client defines its complete vocabulary without importing a Linux placement module.
const dialect = {
  buildSymbol: 'CONFIG_PACKET',
  operationDefinitions: [
    ['config_begin', '#ifdef CONFIG_PACKET'],
    ['config_else', '#else'],
    ['config_end', '#endif'],
    ['branch_ge', 'jae 1f'],
    ['branch_lt', 'jb 1f'],
    ['branch_gt', 'ja 1f'],
    ['branch_le', 'jbe 1f'],
    ['branch_eq', 'je 1f'],
    ['branch_ne', 'jne 1f'],
    ['jump', 'jmp 1f'],
    ['label', '1:'],
  ].map(([op, assembly]) => ({ op, assembly, label: op })),
  inputBindings: { samples: { syntax: '$PACKET_SAMPLES', form: 'immediate', width: 32 } },
  publicRegisters: ['r8', 'r9'],
};
const operations = {
  parseAssembly: (source) => machine.parseAssembly(source, dialect),
  serializeAssembly: (model) => machine.serializeAssembly(model, dialect),
  buildControlFlow: (model) => machine.buildControlFlow(model, dialect),
  inferProgramEffects: (model) => machine.inferProgramEffects(model, dialect),
};
const adapter = {
  id: 'packet-count',
  entryTitle: 'Считать пакеты',
  resultLabel: 'Количество готово',
  buildInput: { key: 'packetMode', label: 'режим пакета', phase: 'build' },
  inputs: [{ key: 'size', label: 'размер', width: 32, binding: { name: 'samples', mnemonic: 'mov' } }],
  variables: [
    { key: 'count', label: 'счётчик', register: 'r8' },
    { key: 'result', label: 'итог', register: 'r9' },
  ],
  machine: operations,
};
const run = (model, configValue) =>
  machine.executeMachine(model, {
    dialect,
    inputValues: { samples: 0n },
    configValue,
    initialRegisters: { r8: null, r9: null },
    initialFlags: { carry: true, zero: false },
    outputRegister: 'r9',
  });
const source = `#ifdef CONFIG_PACKET
movl $PACKET_SAMPLES, %r8d
decl %r8d
#else
movq $99, %r8
#endif
movq %r8, %r9
`;

test('machine grammar and execution accept independent symbols, initial flags and output registers', () => {
  const model = operations.parseAssembly(source);
  assert.equal(operations.serializeAssembly(model), source.replace(/^(mov|dec)/gm, '\t$1'));
  assert.ok(model.instructions.every((item) => item.referenceLine === null));
  assert.equal(run(model, true).output, '0xffffffff');
  assert.equal(run(model, false).output, '0x63');
  assert.equal(run(model, true).trace.at(-1).flags.carry, true);
  assert.deepEqual(run(model, true).inferredEffects.extraClobbers, []);
  assert.equal(Object.hasOwn(run(model, true).inferredEffects, 'kernelAbiVerified'), false);
});

test('generic visual import and compiler operate without placement defaults or historical schemas', () => {
  const model = operations.parseAssembly(source);
  const workspace = modelToWorkspace(model, adapter);
  assert.doesNotThrow(() => validateWorkspaceDraft(workspace, adapter));
  const compiled = compileWorkspace(workspace, adapter);
  const restored = operations.parseAssembly(compiled.assembly);
  for (const configured of [true, false]) {
    assert.equal(run(restored, configured).output, run(model, configured).output);
    assert.deepEqual(run(restored, configured).trace.at(-1).flags, run(model, configured).trace.at(-1).flags);
  }
  const definitions = createVisualBlockDefinitions(adapter);
  assert.equal(definitions.find((block) => block.type === 'arena_entry').message0, adapter.entryTitle);
  assert.equal(JSON.parse(workspace.blocks.blocks[0].data).adapter, adapter.id);
  assert.doesNotMatch(compiled.assembly, /CONFIG_RELOCATABLE|LOAD_PHYSICAL_ADDR|startup_32/);
});

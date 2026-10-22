import test from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import {
  REFERENCE_ASM,
  parseAssembly,
  executeProgram,
  referenceResult,
} from '../../../src/core/placement/index.mjs';
import { PLACEMENT_ADAPTER } from '../../../src/core/placement/adapter.mjs';
import {
  createVisualBlockDefinitions,
  createVisualToolbox,
  registerVisualExtensions,
} from '../../../src/core/visual/language.mjs';
import {
  modelToWorkspace,
  compileWorkspace,
  workspaceToAssembly,
  workspaceInstructionMap,
  migrateLegacyWorkspace,
  migrateConfigPredicates,
  migrateExpressionWorkspace,
} from '../../../src/core/placement/visual.mjs';

registerVisualExtensions(Blockly);
Blockly.defineBlocksWithJsonArray(createVisualBlockDefinitions(PLACEMENT_ADAPTER));
const reference = parseAssembly(REFERENCE_ASM);
const fresh = () => modelToWorkspace(reference);

test('ANDN survives real Blockly import and serialization for all source/destination aliases', () => {
  const workspace = new Blockly.Workspace();
  try {
    for (const width of [32, 64]) {
      const alias = (name) => (width === 32 ? `${name}d` : name);
      for (const [first, second, destination] of [
        ['r8', 'r9', 'r10'],
        ['r8', 'r9', 'r8'],
        ['r8', 'r9', 'r9'],
        ['r8', 'r8', 'r10'],
        ['r8', 'r8', 'r8'],
      ]) {
        const source = `movq $0x80000000000000f0, %r8\nmovq $0x30, %r9\nandn${width === 32 ? 'l' : 'q'} %${alias(first)}, %${alias(second)}, %${alias(destination)}\nmovq %${destination}, %rbp`;
        const original = executeProgram(parseAssembly(source));
        Blockly.serialization.workspaces.load(modelToWorkspace(parseAssembly(source)), workspace);
        const compiled = compileWorkspace(Blockly.serialization.workspaces.save(workspace));
        const actual = executeProgram(parseAssembly(compiled.assembly));
        assert.equal(actual.output, original.output, source);
        assert.deepEqual(actual.trace.at(-1).flags, original.trace.at(-1).flags);
        for (const name of ['r8', 'r9', destination])
          assert.equal(actual.registers[name], original.registers[name], name);
      }
    }
  } finally {
    workspace.dispose();
  }
});

test('ANDN imported expressions retain flags used by a following branch', () => {
  for (const first of ['0', '255']) {
    for (const branch of ['jb', 'jae', 'je', 'jne']) {
      const source = `movq $0, %rbp\nsubq $1, %rbp\nmovq $0, %rbp\nmovq $${first}, %rax\nandnq %rax, %rbp, %rbp\n${branch} 1f\nmovq $7, %rbp\n1:`;
      const original = executeProgram(parseAssembly(source));
      const compiled = compileWorkspace(modelToWorkspace(parseAssembly(source)));
      const actual = executeProgram(parseAssembly(compiled.assembly));
      assert.equal(actual.output, original.output);
      assert.deepEqual(actual.trace.at(-1).flags, original.trace.at(-1).flags);
    }
  }
});

test('screenshot ANDN fragment imports exactly, while the alignment variant meets the Linux contract', () => {
  const screenshot = `#ifdef CONFIG_RELOCATABLE
leaq startup_32(%rip), %rbp
movl BP_kernel_alignment(%rsi), %eax
decl %eax
addq %rax, %rbp
andnq %rax, %rbp, %rbp
cmpq $LOAD_PHYSICAL_ADDR, %rbp
jae 1f
#endif
movq $LOAD_PHYSICAL_ADDR, %rbp
1:`;
  const alignment = screenshot.replace('andnq %rax, %rbp, %rbp', 'andnq %rbp, %rax, %rbp');
  for (const source of [screenshot, alignment]) {
    const model = parseAssembly(source);
    const compiled = parseAssembly(compileWorkspace(modelToWorkspace(model)).assembly);
    for (const relocatable of [true, false]) {
      for (const loadAddress of ['0', '0x1380000', '0x8000000000000000', '0xffffffffffffffff']) {
        const inputs = { relocatable, loadAddress };
        const original = executeProgram(model, inputs);
        const actual = executeProgram(compiled, inputs);
        assert.equal(actual.output, original.output);
        assert.equal(actual.registers.rax, original.registers.rax);
        assert.deepEqual(actual.trace.at(-1).flags, original.trace.at(-1).flags);
        if (source === alignment) assert.equal(actual.output, referenceResult(inputs));
      }
    }
  }
});
const flatten = (json) => {
  const blocks = [];
  const visit = (block) => {
    if (!block) return;
    blocks.push(block);
    for (const input of Object.values(block.inputs ?? {})) visit(input.block);
    visit(block.next?.block);
  };
  json.blocks.blocks.forEach(visit);
  return blocks;
};
const get = (json, id) => flatten(json).find((block) => block.id === id);
const chain = (blocks) => {
  for (let index = 0; index < blocks.length - 1; index++) blocks[index].next = { block: blocks[index + 1] };
  return blocks[0];
};
const oldAddress = (id, SOURCE = 'minimum') => ({ type: 'arena_address', id, fields: { SOURCE } });
const oldCondition = (id) => ({ type: 'arena_condition', id, fields: { OP: 'branch_ge' } });
function oldV4() {
  const body = chain([
    oldAddress('instruction-1', 'load'),
    { type: 'arena_alignment', id: 'instruction-2' },
    { type: 'arena_adjust', id: 'instruction-3', fields: { OP: 'decrement32' } },
    { type: 'arena_math', id: 'instruction-4', fields: { OP: 'add64' } },
    { type: 'arena_invert', id: 'instruction-5' },
    { type: 'arena_math', id: 'instruction-6', fields: { OP: 'and64' } },
    {
      type: 'arena_if',
      id: 'instruction-7',
      inputs: {
        TEST: { block: oldCondition('condition-instruction-7') },
        ELSE: { block: oldAddress('instruction-10') },
      },
    },
  ]);
  return {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'arena_entry',
          id: 'arena-entry',
          data: JSON.stringify({ visualVersion: 4 }),
          x: 48,
          y: 32,
          next: {
            block: {
              type: 'arena_config_if',
              id: 'instruction-0',
              inputs: {
                TEST: {
                  block: {
                    type: 'arena_relocatable',
                    id: 'condition-instruction-0',
                    fields: { WHEN: 'enabled' },
                  },
                },
                THEN: { block: body },
                ELSE: { block: oldAddress('instruction-10-copy-1') },
              },
              next: { block: { type: 'arena_result', id: 'arena-result' } },
            },
          },
        },
      ],
    },
  };
}
const inputsGrid = [true, false].flatMap((relocatable) =>
  ['0', '0x1100000', '0x8000000000000000', '0xffffffffffffffff'].flatMap((loadAddress) =>
    ['0', '1', '0x200000', '0xffffffff'].map((alignment) => ({ relocatable, loadAddress, alignment })),
  ),
);
function outcome(model, inputs) {
  try {
    const result = executeProgram(model, inputs);
    return {
      output: result.output,
      rax: result.registers.rax,
      rbp: result.registers.rbp,
      flags: result.trace.at(-1)?.flags,
    };
  } catch (error) {
    return { error: error.message };
  }
}
function assertEquivalent(source, workspace = modelToWorkspace(parseAssembly(source))) {
  const compiled = parseAssembly(workspaceToAssembly(workspace));
  const original = parseAssembly(source);
  for (const inputs of inputsGrid)
    assert.deepEqual(outcome(compiled, inputs), outcome(original, inputs), JSON.stringify(inputs));
  return compiled;
}

test('reference and incl become generic assign/reporters while keeping exact legacy arithmetic', () => {
  for (const source of [REFERENCE_ASM, REFERENCE_ASM.replace('decl', 'incl')]) assertEquivalent(source);
  const workspace = fresh();
  const adjust = get(workspace, 'instruction-3');
  assert.equal(adjust.type, 'arena_assign');
  assert.equal(adjust.inputs.VALUE.block.type, 'arena_unary');
  assert.equal(adjust.inputs.VALUE.block.fields.OP, 'dec');
  assert.equal(adjust.inputs.VALUE.block.fields.WIDTH, '32');
  assert.equal(get(workspace, 'instruction-4').inputs.VALUE.block.type, 'arena_binary');
  assert.equal(get(workspace, 'instruction-7').inputs.TEST.block.inputs.LEFT.block.type, 'arena_variable');
  assert.equal(get(workspace, 'instruction-7').inputs.TEST.block.inputs.RIGHT.block.type, 'arena_input');
  assert.equal(JSON.parse(workspace.blocks.blocks[0].data).visualVersion, 6);
  assert.equal(
    flatten(workspace).some((block) =>
      ['arena_address', 'arena_math', 'arena_adjust', 'arena_branch', 'arena_finish'].includes(block.type),
    ),
    false,
  );
  assert.deepEqual(compileWorkspace(workspace).targetEffects.extraClobbers, []);
});

test('real Blockly definitions serialize connected expressions and editable operands', () => {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(fresh(), workspace);
    assertEquivalent(REFERENCE_ASM, Blockly.serialization.workspaces.save(workspace));
    const adjust = workspace.getBlockById('instruction-3').getInputTargetBlock('VALUE');
    adjust.setFieldValue('inc', 'OP');
    let result = compileWorkspace(Blockly.serialization.workspaces.save(workspace));
    assert.equal(executeProgram(parseAssembly(result.assembly)).output, '0x1100000');
    const add = workspace.getBlockById('instruction-4').getInputTargetBlock('VALUE');
    const originalOperand = add.getInputTargetBlock('RIGHT');
    originalOperand.unplug();
    assert.throws(
      () => compileWorkspace(Blockly.serialization.workspaces.save(workspace)),
      /число или выражение/,
    );
    const literal = workspace.newBlock('arena_literal');
    literal.setFieldValue('0', 'VALUE');
    add.getInput('RIGHT').connection.connect(literal.outputConnection);
    result = compileWorkspace(Blockly.serialization.workspaces.save(workspace));
    assert.match(result.assembly, /addq \$0, %rbp/);
    assert.equal(executeProgram(parseAssembly(result.assembly)).output, '0x1100000');
    assert.equal(originalOperand.getParent(), null);
    assert.ok(Object.values(result.instructionBlocks).includes('instruction-4'));
  } finally {
    workspace.dispose();
  }
});

test('large exact literals survive a real Blockly text field without Number rounding', () => {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(modelToWorkspace(parseAssembly('movq $1, %rbp')), workspace);
    const assignment = workspace.getBlockById('instruction-0');
    const literal = assignment.getInputTargetBlock('VALUE');
    literal.setFieldValue('9007199254740993', 'VALUE');
    const snapshot = Blockly.serialization.workspaces.save(workspace);
    assert.equal(get(snapshot, literal.id).fields.VALUE, '9007199254740993');
    assert.equal(executeProgram(parseAssembly(workspaceToAssembly(snapshot))).output, '0x20000000000001');
  } finally {
    workspace.dispose();
  }
});

test('branch bodies remain real statement sockets and detached number drafts are ignored', () => {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(fresh(), workspace);
    const branch = workspace.getBlockById('instruction-7');
    const fallback = branch.getInputTargetBlock('ELSE');
    fallback.unplug();
    branch.getInput('THEN').connection.connect(fallback.previousConnection);
    const compiled = compileWorkspace(Blockly.serialization.workspaces.save(workspace));
    assert.equal(executeProgram(parseAssembly(compiled.assembly)).output, '0x1000000');
    assert.equal(executeProgram(parseAssembly(compiled.assembly), { loadAddress: '0' }).output, '0x0');
    workspace.newBlock('arena_binary');
    assert.equal(workspaceToAssembly(Blockly.serialization.workspaces.save(workspace)), compiled.assembly);
    assert.deepEqual(
      workspaceInstructionMap(Blockly.serialization.workspaces.save(workspace)),
      compiled.instructionBlocks,
    );
  } finally {
    workspace.dispose();
  }
});

test('standalone comparisons, non-comparison flags and arbitrary forward branches preserve behavior', () => {
  for (const source of [
    'leaq startup_32(%rip), %rbp\n#ifdef CONFIG_RELOCATABLE\ncmpq $LOAD_PHYSICAL_ADDR, %rbp\n#endif\njae 1f\nmovq $LOAD_PHYSICAL_ADDR, %rbp\n1:',
    'leaq startup_32(%rip), %rbp\ncmpq $LOAD_PHYSICAL_ADDR, %rbp\nje 2f\nmovl BP_kernel_alignment(%rsi), %eax\njb 3f\naddq %rax, %rbp\n2:\nincl %eax\njb 3f\nsubq %rax, %rbp\n3:\nxorq %rax, %rbp',
    'movq $LOAD_PHYSICAL_ADDR, %rbp\njae 1f\n#ifdef CONFIG_RELOCATABLE\nleaq startup_32(%rip), %rbp\n#endif\n1:',
  ])
    assertEquivalent(source);
  for (const jump of ['jae', 'jb', 'ja', 'jbe', 'je', 'jne'])
    assertEquivalent(REFERENCE_ASM.replace(/jae\s+1f/, `${jump} 1f`));
});

test('generic machine import exposes named temporaries, 32-bit casts and comparison operands', () => {
  for (const source of [
    'movq $18446744073709551615, %r8\nmovl %r8d, %ebp',
    'movq $18446744073709551615, %r8\nmovl $1, %r9d\ncmpl %r9d, %r8d\njb 1f\nmovq %r8, %rbp\njmp 2f\n1:\nmovq %r9, %rbp\n2:',
    'movq $10, %r8\nmovq $20, %r9\nsubq %r9, %r8\nincq %r8\nmovq %r8, %rbp',
  ])
    assertEquivalent(source);
  const workspace = modelToWorkspace(parseAssembly('movq $18446744073709551615, %r8\nmovl %r8d, %ebp'));
  assert.equal(get(workspace, 'instruction-1').inputs.VALUE.block.fields.OP, 'cast');
  assert.equal(get(workspace, 'instruction-1').inputs.VALUE.block.fields.WIDTH, '32');
});

test('build predicate remains detachable and enabled/disabled selects actual build arms', () => {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(fresh(), workspace);
    const config = workspace.getBlockById('instruction-0');
    const predicate = config.getInputTargetBlock('TEST');
    assert.deepEqual(predicate.outputConnection.getCheck(), ['Boolean']);
    predicate.unplug();
    assert.throws(() => compileWorkspace(Blockly.serialization.workspaces.save(workspace)), /Вставь условие/);
    config.getInput('TEST').connection.connect(predicate.outputConnection);
    for (const WHEN of ['enabled', 'disabled']) {
      predicate.setFieldValue(WHEN, 'WHEN');
      const model = parseAssembly(workspaceToAssembly(Blockly.serialization.workspaces.save(workspace)));
      for (const inputs of inputsGrid)
        assert.deepEqual(
          outcome(model, inputs),
          outcome(reference, {
            ...inputs,
            relocatable: WHEN === 'enabled' ? inputs.relocatable : !inputs.relocatable,
          }),
        );
    }
  } finally {
    workspace.dispose();
  }
});

test('v4 expression migration preserves edits, IDs, layout, disabled drafts and source metadata', () => {
  const old = oldV4();
  get(old, 'instruction-3').fields.OP = 'increment32';
  get(old, 'instruction-4').data = JSON.stringify({
    sourceInstructionIds: ['original-add'],
    userNote: 'saved',
  });
  get(old, 'instruction-0').x = 111;
  old.blocks.blocks.push({
    type: 'arena_math',
    id: 'detached',
    fields: { OP: 'xor64' },
    enabled: false,
    x: 700,
    y: 80,
  });
  const before = JSON.stringify(old);
  const migrated = migrateExpressionWorkspace(old);
  assert.equal(JSON.stringify(old), before);
  assert.equal(get(migrated, 'instruction-3').inputs.VALUE.block.fields.OP, 'inc');
  assert.equal(get(migrated, 'instruction-4').data, get(old, 'instruction-4').data);
  assert.equal(get(migrated, 'instruction-0').x, 111);
  assert.equal(get(migrated, 'detached').type, 'arena_assign');
  assert.equal(get(migrated, 'detached').enabled, false);
  assert.equal(get(migrated, 'detached').x, 700);
  assertEquivalent(REFERENCE_ASM.replace('decl', 'incl'), migrated);
  assert.deepEqual(migrateExpressionWorkspace(migrated), migrated);
});

test('migration preserves incomplete sockets and a later v6 load never repairs intentional holes', () => {
  const old = oldV4();
  delete get(old, 'instruction-7').inputs.TEST;
  delete get(old, 'instruction-0').inputs.TEST;
  const migrated = migrateExpressionWorkspace(old);
  assert.equal(get(migrated, 'instruction-7').inputs.TEST, undefined);
  assert.equal(get(migrated, 'instruction-0').inputs.TEST, undefined);
  assert.throws(() => compileWorkspace(migrated), /Вставь условие/);
  const current = fresh();
  delete get(current, 'instruction-4').inputs.VALUE.block.inputs.RIGHT;
  assert.deepEqual(migrateExpressionWorkspace(current), current);
  assert.throws(() => compileWorkspace(migrateExpressionWorkspace(current)), /число или выражение/);
});

test('v3 build migration and v2 legacy migration still reach editable expressions', () => {
  const v3 = oldV4();
  v3.blocks.blocks[0].data = JSON.stringify({ visualVersion: 3 });
  delete get(v3, 'instruction-0').inputs.TEST;
  assertEquivalent(REFERENCE_ASM, migrateExpressionWorkspace(migrateConfigPredicates(v3)));
  const v2 = oldV4();
  const config = get(v2, 'instruction-0');
  const fallback = get(v2, 'instruction-10');
  delete get(v2, 'instruction-7').inputs.ELSE;
  config.type = 'arena_config';
  config.inputs = { DO: config.inputs.THEN };
  config.next = { block: fallback };
  fallback.next = { block: { type: 'arena_finish', id: 'legacy-finish' } };
  v2.blocks.blocks.push({
    type: 'arena_adjust',
    id: 'old-draft',
    fields: { OP: 'increment32' },
    x: 500,
    y: 200,
  });
  const migrated = migrateLegacyWorkspace(v2);
  assertEquivalent(REFERENCE_ASM, migrated);
  assert.equal(get(migrated, 'old-draft').type, 'arena_assign');
  assert.equal(JSON.parse(migrated.blocks.blocks[0].data).visualVersion, 6);
});

test('alternate adapter changes definitions, field keys and actual machine bindings', () => {
  const adapter = {
    ...PLACEMENT_ADAPTER,
    id: 'packet-layout',
    entryTitle: 'Начало пакета',
    resultLabel: 'Позиция пакета',
    buildInput: { key: 'mode', label: 'режим пакета' },
    inputs: [
      { key: 'start', label: 'начало', width: 64, binding: { name: 'minimumAddress', mnemonic: 'mov' } },
      { key: 'size', label: 'размер', width: 32, binding: { name: 'alignment', mnemonic: 'mov' } },
      { key: 'fallback', label: 'резерв', width: 64, binding: { name: 'loadAddress', mnemonic: 'lea' } },
    ],
    variables: PLACEMENT_ADAPTER.variables.map((variable) => ({
      ...variable,
      key: variable.key === 'address' ? 'position' : variable.key === 'work' ? 'bits' : variable.key,
      label: variable.key === 'address' ? 'позиция' : variable.key === 'work' ? 'разряды' : variable.label,
    })),
    directComparison: undefined,
  };
  const source = 'movq $LOAD_PHYSICAL_ADDR, %rbp';
  const workspace = modelToWorkspace(parseAssembly(source), adapter);
  const assignment = get(workspace, 'instruction-0');
  assert.equal(assignment.inputs.TARGET.block.fields.VAR, 'position');
  assert.equal(assignment.inputs.VALUE.block.fields.KEY, 'start');
  assert.equal(
    executeProgram(parseAssembly(compileWorkspace(workspace, adapter).assembly), { minimumAddress: '123' })
      .output,
    '0x7b',
  );
  const definitions = JSON.stringify(createVisualBlockDefinitions(adapter));
  assert.match(definitions, /начало пакета/i);
  assert.doesNotMatch(definitions, /Linux|адрес загрузки|нижняя граница|маска/);
  const data = createVisualToolbox(adapter).contents[0].contents;
  assert.equal(data.filter((block) => block.type === 'arena_input').length, 3);
  assert.equal(data.filter((block) => block.type === 'arena_variable').length, 2);
});

test('invalid values, wrong socket kinds, missing result and cycles fail without silently compiling', () => {
  const cases = [
    (json) => {
      delete get(json, 'instruction-4').inputs.VALUE.block.inputs.LEFT;
    },
    (json) => {
      get(json, 'instruction-4').inputs.VALUE.block.inputs.RIGHT.block = {
        type: 'arena_boolean_input',
        id: 'wrong-kind',
        fields: { KEY: 'relocatable', WHEN: 'enabled' },
      };
    },
    (json) => {
      get(json, 'instruction-4').inputs.VALUE.block.inputs.RIGHT.block = {
        type: 'arena_literal',
        id: 'huge',
        fields: { VALUE: '18446744073709551616' },
      };
    },
    (json) => {
      get(json, 'instruction-4').inputs.VALUE.block.fields.WIDTH = '128';
    },
    (json) => {
      delete get(json, 'instruction-0').next;
    },
    (json) => {
      get(json, 'instruction-4').next.block = json.blocks.blocks[0];
    },
    (json) => {
      get(json, 'instruction-4').inputs.VALUE.block.disabledReasons = ['MANUALLY_DISABLED'];
    },
  ];
  for (const change of cases) {
    const json = fresh();
    change(json);
    assert.throws(() => compileWorkspace(json));
  }
});

test('if without else and if with else use one primitive without hidden branch code', () => {
  const simple = modelToWorkspace(parseAssembly('movq $1, %rbp\ncmpq $LOAD_PHYSICAL_ADDR, %rbp\njae 1f\n1:'));
  const single = flatten(simple).find((block) => block.type === 'arena_if');
  assert.deepEqual(single.extraState, { hasElse: false });
  assert.doesNotThrow(() => compileWorkspace(simple));
  const full = fresh();
  const branch = get(full, 'instruction-7');
  assert.deepEqual(branch.extraState, { hasElse: true });
  branch.extraState.hasElse = false;
  assert.throws(() => compileWorkspace(full), /скрытой подключённой ветки/);
  delete branch.inputs.ELSE;
  assert.doesNotThrow(() => compileWorkspace(full));
  branch.extraState = { hasElse: false, hiddenCode: true };
  assert.throws(() => compileWorkspace(full), /форма/);
});

test('shape migration infers legacy else and preserves an explicitly empty else', () => {
  const old = oldV4();
  const migrated = migrateExpressionWorkspace(old);
  assert.deepEqual(get(migrated, 'instruction-7').extraState, { hasElse: true });
  const blank = fresh();
  const branch = get(blank, 'instruction-7');
  delete branch.inputs.ELSE;
  branch.extraState = { hasElse: true };
  assert.deepEqual(get(migrateExpressionWorkspace(blank), 'instruction-7').extraState, { hasElse: true });
  delete branch.extraState;
  assert.deepEqual(get(migrateExpressionWorkspace(blank), 'instruction-7').extraState, { hasElse: false });
});

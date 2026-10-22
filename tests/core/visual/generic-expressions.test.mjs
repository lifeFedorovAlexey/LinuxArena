import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileWorkspace,
  modelToWorkspace,
  migrateExpressionWorkspace,
} from '../../../src/core/placement/visual.mjs';
import { executeProgram, parseAssembly, REFERENCE_ASM } from '../../../src/core/placement/index.mjs';
import { PLACEMENT_ADAPTER } from '../../../src/core/placement/adapter.mjs';
import { createVisualBlockDefinitions, createVisualToolbox } from '../../../src/core/visual/language.mjs';

let serial = 0;
const block = (type, fields = {}, inputs = {}) => ({
  type,
  id: `stress-${++serial}`,
  fields,
  inputs: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, { block: value }])),
});
const literal = (value) => block('arena_literal', { VALUE: String(value) });
const variable = (name) => block('arena_variable', { VAR: name });
const input = (name) => block('arena_input', { KEY: name });
const binary = (op, width, left, right) =>
  block('arena_binary', { OP: op, WIDTH: String(width) }, { LEFT: left, RIGHT: right });
const unary = (op, width, value) => block('arena_unary', { OP: op, WIDTH: String(width) }, { VALUE: value });
const assign = (name, value) => block('arena_assign', {}, { TARGET: variable(name), VALUE: value });
const compare = (left, right) => block('arena_compare', {}, { LEFT: left, RIGHT: right });
function workspace(...statements) {
  const chain = [block('arena_entry'), ...statements, block('arena_result')];
  for (let i = 0; i < chain.length - 1; i++) chain[i].next = { block: chain[i + 1] };
  return { blocks: { languageVersion: 0, blocks: [chain[0]] } };
}
function run(json, inputs, adapter) {
  const compiled = compileWorkspace(json, adapter);
  return { ...executeProgram(parseAssembly(compiled.assembly), inputs), compiled };
}
const lastFlags = (result) => result.trace.at(-1).flags;
const hex = (value) => `0x${value.toString(16)}`;

// A value-only oracle deliberately independent of the emitted instruction order.
function valueOf(expression, variables, inputs) {
  const f = expression.fields;
  const child = (name) => valueOf(expression.inputs[name].block, variables, inputs);
  if (expression.type === 'arena_literal') return BigInt(f.VALUE);
  if (expression.type === 'arena_variable') return variables[f.VAR];
  if (expression.type === 'arena_input') return inputs[f.KEY];
  const width = Number(f.WIDTH);
  if (expression.type === 'arena_unary') {
    const value = child('VALUE');
    const result =
      f.OP === 'not' ? ~value : f.OP === 'inc' ? value + 1n : f.OP === 'dec' ? value - 1n : value;
    return BigInt.asUintN(width, result);
  }
  const left = child('LEFT');
  const right = child('RIGHT');
  return BigInt.asUintN(
    width,
    {
      add: () => left + right,
      sub: () => left - right,
      and: () => left & right,
      or: () => left | right,
      xor: () => left ^ right,
    }[f.OP](),
  );
}

test('nested assignments read the old destination on both sides before writing it', () => {
  const expressions = [
    binary('sub', 64, variable('work'), variable('address')),
    binary('add', 64, binary('sub', 64, variable('address'), literal(3)), variable('address')),
    binary(
      'xor',
      64,
      binary('add', 32, variable('address'), variable('work')),
      binary('sub', 64, variable('address'), literal(7)),
    ),
    binary(
      'and',
      64,
      unary('not', 64, variable('address')),
      binary('add', 32, variable('address'), unary('dec', 32, variable('work'))),
    ),
  ];
  for (const expression of expressions) {
    const initial = { address: 0xfffffffffffffff8n, work: 0x10000000fn };
    const expected = valueOf(expression, initial, {});
    const result = run(
      workspace(
        assign('address', literal(initial.address)),
        assign('work', literal(initial.work)),
        assign('address', expression),
      ),
    );
    assert.equal(result.output, hex(expected), result.compiled.assembly);
    assert.equal(result.registers.rax, hex(initial.work));
  }
});

test('scratch allocation preserves named temporary variables used by later statements', () => {
  const result = run(
    workspace(
      assign('address', literal(12)),
      assign('work', literal(3)),
      assign('r8', literal(0x12345678)),
      assign(
        'address',
        binary(
          'add',
          64,
          binary('sub', 64, variable('address'), literal(1)),
          binary('xor', 64, variable('address'), variable('work')),
        ),
      ),
      assign('address', binary('add', 64, variable('address'), variable('r8'))),
    ),
  );
  assert.equal(result.output, hex(11n + 15n + 0x12345678n));
  assert.equal(result.registers.r8, '0x12345678');
  assert.ok(result.compiled.targetEffects.extraClobbers.includes('r9'));
  assert.equal(result.compiled.targetEffects.kernelAbiVerified, false);
  assert.equal(result.compiled.targetEffects.kernelPatchEligible, false);
});

test('all explicitly used scratch registers are reserved, and exhaustion reports an error', () => {
  const reserved = Array.from({ length: 8 }, (_, i) => assign(`r${i + 8}`, literal(i)));
  const json = workspace(
    ...reserved,
    assign('address', literal(5)),
    assign('address', binary('sub', 64, literal(10), variable('address'))),
  );
  assert.throws(() => compileWorkspace(json), /временных регистров/);
});

test('large exact constants are materialized while decimal leading zeros are canonicalized', () => {
  for (const value of ['0xffffffff', '0x100000000', '0x8000000000000000', '18446744073709551615', '00010']) {
    const expression = binary('add', 64, variable('address'), literal(value));
    const result = run(workspace(assign('address', literal(17)), assign('address', expression)));
    assert.equal(result.output, hex(BigInt.asUintN(64, 17n + BigInt(value))));
    assert.doesNotMatch(result.compiled.assembly, /\$0[0-9]+/);
  }
});

test('32-bit expressions zero-extend across every arithmetic and unary operator', () => {
  for (const op of ['add', 'sub', 'and', 'or', 'xor']) {
    const expression = binary(op, 32, literal('0x12345678ffffffff'), literal('0xffffffff00000001'));
    const result = run(workspace(assign('address', expression)));
    assert.equal(result.output, hex(valueOf(expression, {}, {})));
  }
  for (const op of ['not', 'inc', 'dec', 'cast']) {
    const expression = unary(op, 32, literal('0x12345678ffffffff'));
    const result = run(workspace(assign('address', expression)));
    assert.equal(result.output, hex(valueOf(expression, {}, {})));
  }
});

test('NOT and cast preserve carry and zero while INC/DEC preserve carry', () => {
  for (const [op, value, expected, zero] of [
    ['not', '0xffffffffffffffff', '0x0', false],
    ['cast', '0xffffffffffffffff', '0xffffffff', false],
    ['inc', '0xffffffffffffffff', '0x0', true],
    ['dec', '0x100000000', '0xffffffff', false],
  ]) {
    const result = run(
      workspace(
        assign('work', literal(0)),
        assign('work', binary('sub', 64, variable('work'), literal(1))),
        assign('address', unary(op, 32, literal(value))),
      ),
    );
    assert.equal(result.output, expected);
    assert.deepEqual(lastFlags(result), { carry: true, zero });
  }
});

test('generic comparisons materialize high minimum inputs without imm32 truncation', () => {
  for (const minimumAddress of ['0xffffffff', '0x8000000000000000', '0xffffffffffffffff']) {
    for (const left of [0n, BigInt(minimumAddress), 0xffffffffffffffffn]) {
      const result = run(
        workspace(
          assign('address', literal(9)),
          assign('work', literal(left)),
          compare(variable('work'), input('minimumAddress')),
        ),
        { minimumAddress },
      );
      assert.deepEqual(lastFlags(result), {
        carry: left < BigInt(minimumAddress),
        zero: left === BigInt(minimumAddress),
      });
      assert.equal(result.output, '0x9');
      assert.equal(result.registers.rax, hex(left));
    }
  }
});

test('both nested comparison expressions preserve all visible variable values', () => {
  const initial = { address: 0xfffffff0n, work: 0xffffffff00000007n };
  const left = binary('add', 32, variable('address'), variable('work'));
  const right = binary('sub', 64, unary('not', 64, variable('work')), variable('address'));
  const leftValue = valueOf(left, initial, {});
  const rightValue = valueOf(right, initial, {});
  const result = run(
    workspace(
      assign('address', literal(initial.address)),
      assign('work', literal(initial.work)),
      compare(left, right),
    ),
  );
  assert.deepEqual(lastFlags(result), { carry: leftValue < rightValue, zero: leftValue === rightValue });
  assert.equal(result.registers.rbp, hex(initial.address));
  assert.equal(result.registers.rax, hex(initial.work));
});

test('visual variable and input names come from the adapter', () => {
  const adapter = {
    ...PLACEMENT_ADAPTER,
    directComparison: undefined,
    variables: PLACEMENT_ADAPTER.variables.map((value) => ({
      ...value,
      key: value.key === 'address' ? 'answer' : value.key === 'work' ? 'helper' : value.key,
    })),
    inputs: PLACEMENT_ADAPTER.inputs.map((value) => ({
      ...value,
      key: value.key === 'loadAddress' ? 'origin' : value.key,
    })),
  };
  const result = run(
    workspace(
      assign('helper', literal(17)),
      assign('answer', binary('sub', 64, input('origin'), variable('helper'))),
    ),
    { loadAddress: '0x10000000' },
    adapter,
  );
  assert.equal(result.output, '0xfffffef');
});

test('1,200 deterministic nested expression trees agree with an independent value oracle', () => {
  let state = 0x62b7f9a1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const u64 = () => (BigInt(random()) << 32n) | BigInt(random());
  const operations = ['add', 'sub', 'and', 'or', 'xor'];
  const unaryOperations = ['not', 'inc', 'dec', 'cast'];
  const sourceInputs = {
    loadAddress: 0xffffffff80000001n,
    alignment: 0x80000000n,
    minimumAddress: 0x8000000000000000n,
  };
  const expression = (depth) => {
    const choice = random() % (depth ? 6 : 3);
    if (choice === 0) return variable(['address', 'work', 'r8'][random() % 3]);
    if (choice === 1) return literal(u64());
    if (choice === 2) return input(['loadAddress', 'alignment', 'minimumAddress'][random() % 3]);
    if (choice === 3)
      return unary(unaryOperations[random() % 4], random() % 2 ? 32 : 64, expression(depth - 1));
    return binary(
      operations[random() % 5],
      random() % 2 ? 32 : 64,
      expression(depth - 1),
      expression(depth - 1),
    );
  };
  for (let index = 0; index < 1200; index++) {
    const initial = { address: u64(), work: u64(), r8: u64() };
    const tree = expression(4);
    const json = workspace(
      ...Object.entries(initial).map(([name, value]) => assign(name, literal(value))),
      assign('address', tree),
    );
    const result = run(
      json,
      Object.fromEntries(Object.entries(sourceInputs).map(([name, value]) => [name, hex(value)])),
    );
    assert.equal(
      result.output,
      hex(valueOf(tree, initial, sourceInputs)),
      `case ${index}\n${result.compiled.assembly}`,
    );
    assert.equal(result.registers.rax, hex(initial.work), `work clobbered at case ${index}`);
    assert.equal(result.registers.r8, hex(initial.r8), `named scratch clobbered at case ${index}`);
  }
});

test('ASM import preserves machine values and branch flags for mixed-width operations', () => {
  const sources = [
    'movq $0xffffffffffffffff, %rax\nmovl %eax, %ebp',
    'movq $0, %rbp\nmovq $0x12345678ffffffff, %rax\nsubl $1, %ebp\nincl %eax\njb 1f\nmovq $5, %rbp\n1:',
    'movq $0x12345678ffffffff, %rax\nmovq $0x87654321ffffffff, %rbp\ncmpl %eax, %ebp\nje 1f\nmovq $2, %rbp\n1:',
    'movq $0x8000000000000000, %r8\nmovq $0, %rbp\nsubq $1, %rbp\nnotl %r8d\nmovq %r8, %rbp',
    'movq $0xffffffffffffffff, %rax\nmovq $0x80000000, %rbp\ncmpl $0x80000000, %ebp\nje 1f\nmovq $2, %rbp\n1:',
  ];
  for (const source of sources) {
    const original = executeProgram(parseAssembly(source));
    const recompiled = run(modelToWorkspace(parseAssembly(source)));
    assert.equal(recompiled.output, original.output, recompiled.compiled.assembly);
    assert.deepEqual(lastFlags(recompiled), lastFlags(original));
    for (const [register, value] of Object.entries(original.registers))
      assert.equal(recompiled.registers[register], value, register);
  }
});

test('pinned Linux ASM survives visual import with full-u64 generalized minimum inputs', () => {
  const reference = parseAssembly(REFERENCE_ASM);
  const json = modelToWorkspace(reference);
  const compiled = compileWorkspace(json);
  assert.deepEqual(compiled.targetEffects.extraClobbers, []);
  for (const minimumAddress of ['0x1000000', '0xffffffff', '0x8000000000000000', '0xffffffffffffffff']) {
    for (const loadAddress of ['0x0', '0x1100000', '0x8000000000000000', '0xffffffffffffffff']) {
      for (const relocatable of [true, false]) {
        const inputs = { minimumAddress, loadAddress, relocatable };
        const original = executeProgram(reference, inputs);
        const output = executeProgram(parseAssembly(compiled.assembly), inputs);
        assert.equal(output.output, original.output);
        assert.deepEqual(output.registers, original.registers);
        assert.deepEqual(lastFlags(output), lastFlags(original));
      }
    }
  }
});

test('v4 to v6 structural migration preserves IDs, layout, disabled drafts, metadata and empty sockets', () => {
  const old = workspace();
  const entry = old.blocks.blocks[0];
  entry.data = JSON.stringify({ visualVersion: 4, note: 'keep me' });
  entry.x = -23;
  entry.y = 42;
  const finish = entry.next.block;
  const config = block('arena_config_if'); // A deliberately empty v4 TEST remains empty.
  config.next = { block: finish };
  entry.next = { block: config };
  const edited = {
    type: 'arena_adjust',
    id: 'edited-adjust',
    fields: { OP: 'increment32' },
    x: 650,
    y: 120,
    enabled: false,
    disabledReasons: ['manual'],
    collapsed: true,
    data: '{"sourceInstructionIds":["old-id"]}',
  };
  edited.next = {
    block: { type: 'arena_math', id: 'edited-math', fields: { OP: 'xor64' }, data: 'draft metadata' },
  };
  old.blocks.blocks.push(edited, { type: 'arena_alignment', id: 'edited-adjust-expression', x: 710, y: 240 });
  const original = JSON.stringify(old);
  const migrated = migrateExpressionWorkspace(old);
  assert.equal(JSON.stringify(old), original);
  const newEntry = migrated.blocks.blocks[0];
  assert.deepEqual(JSON.parse(newEntry.data), {
    visualVersion: 6,
    note: 'keep me',
    adapter: PLACEMENT_ADAPTER.id,
  });
  assert.equal(newEntry.id, entry.id);
  assert.equal(newEntry.x, -23);
  assert.equal(newEntry.y, 42);
  assert.equal(newEntry.next.block.type, 'arena_if');
  assert.equal(newEntry.next.block.inputs.TEST, undefined);
  const draft = migrated.blocks.blocks[1];
  for (const key of ['id', 'x', 'y', 'enabled', 'collapsed', 'data', 'disabledReasons'])
    assert.deepEqual(draft[key], edited[key]);
  assert.equal(draft.type, 'arena_assign');
  assert.equal(draft.inputs.TARGET.block.fields.VAR, 'work');
  assert.equal(draft.inputs.VALUE.block.fields.OP, 'inc');
  assert.equal(draft.inputs.VALUE.block.fields.WIDTH, '32');
  assert.notEqual(draft.inputs.VALUE.block.id, 'edited-adjust-expression');
  assert.equal(draft.next.block.id, 'edited-math');
  assert.equal(draft.next.block.inputs.VALUE.block.fields.OP, 'xor');
  assert.equal(migrated.blocks.blocks[2].id, 'edited-adjust-expression');
  assert.throws(() => compileWorkspace(migrated), /Вставь условие/);
  assert.deepEqual(migrateExpressionWorkspace(migrated), migrated);
});

test('v5 to v6 migration preserves one if and converts attached and detached build inputs', () => {
  const old = workspace(
    block(
      'arena_config_if',
      {},
      {
        TEST: block('arena_relocatable', { WHEN: 'disabled' }),
        THEN: assign('address', literal(11)),
        ELSE: assign('address', literal(22)),
      },
    ),
  );
  const entry = old.blocks.blocks[0];
  entry.data = JSON.stringify({ visualVersion: 5, adapter: PLACEMENT_ADAPTER.id, note: 'keep v5' });
  const oldIf = entry.next.block;
  oldIf.data = '{"sourceInstructionIds":["config-old"]}';
  oldIf.inputs.TEST.block.data = 'predicate metadata';
  oldIf.x = 125;
  oldIf.y = -72;
  const detached = block('arena_relocatable', { WHEN: 'enabled' });
  detached.enabled = false;
  detached.x = 800;
  detached.y = 700;
  old.blocks.blocks.push(detached);
  const original = JSON.stringify(old);
  const migrated = migrateExpressionWorkspace(old);
  assert.equal(JSON.stringify(old), original);
  assert.equal(JSON.parse(migrated.blocks.blocks[0].data).visualVersion, 6);
  const newIf = migrated.blocks.blocks[0].next.block;
  assert.equal(newIf.type, 'arena_if');
  for (const key of ['id', 'data', 'x', 'y']) assert.deepEqual(newIf[key], oldIf[key]);
  assert.equal(newIf.inputs.TEST.block.type, 'arena_boolean_input');
  assert.equal(newIf.inputs.TEST.block.id, oldIf.inputs.TEST.block.id);
  assert.equal(newIf.inputs.TEST.block.data, 'predicate metadata');
  assert.deepEqual(newIf.inputs.TEST.block.fields, { KEY: 'relocatable', WHEN: 'disabled' });
  assert.equal(newIf.inputs.THEN.block.id, oldIf.inputs.THEN.block.id);
  assert.equal(newIf.inputs.ELSE.block.id, oldIf.inputs.ELSE.block.id);
  const newDetached = migrated.blocks.blocks[1];
  assert.equal(newDetached.type, 'arena_boolean_input');
  for (const key of ['id', 'enabled', 'x', 'y']) assert.deepEqual(newDetached[key], detached[key]);
  assert.deepEqual(newDetached.fields, { KEY: 'relocatable', WHEN: 'enabled' });
  assert.equal(run(migrated, { relocatable: true }).output, '0x16');
  assert.equal(run(migrated, { relocatable: false }).output, '0xb');
  assert.deepEqual(migrateExpressionWorkspace(migrated), migrated);
});

test('the same if follows its current Boolean predicate when switched between run and build phases', () => {
  const comparison = () =>
    block('arena_condition', { OP: 'branch_lt' }, { LEFT: literal(1), RIGHT: literal(2) });
  const choice = block(
    'arena_if',
    {},
    {
      TEST: comparison(),
      THEN: assign('address', literal(11)),
      ELSE: assign('address', literal(22)),
    },
  );
  // Old display/source metadata must never select the execution phase.
  choice.data = JSON.stringify({ phase: 'build', sourceInstructionIds: ['stale-config-source'] });
  const json = workspace(choice);
  const id = choice.id;
  let compiled = compileWorkspace(json);
  assert.doesNotMatch(compiled.assembly, /#if/);
  assert.match(compiled.assembly, /cmpq/);
  for (const relocatable of [true, false]) assert.equal(run(json, { relocatable }).output, '0xb');
  choice.inputs.TEST.block = block('arena_boolean_input', { KEY: 'relocatable', WHEN: 'enabled' });
  compiled = compileWorkspace(json);
  assert.match(compiled.assembly, /#ifdef CONFIG_RELOCATABLE/);
  assert.doesNotMatch(compiled.assembly, /cmpq|\bjb\b/);
  assert.equal(run(json, { relocatable: true }).output, '0xb');
  assert.equal(run(json, { relocatable: false }).output, '0x16');
  choice.inputs.TEST.block.fields.WHEN = 'disabled';
  assert.equal(run(json, { relocatable: true }).output, '0x16');
  assert.equal(run(json, { relocatable: false }).output, '0xb');
  choice.inputs.TEST.block = comparison();
  compiled = compileWorkspace(json);
  assert.doesNotMatch(compiled.assembly, /#if/);
  assert.match(compiled.assembly, /cmpq/);
  for (const relocatable of [true, false]) assert.equal(run(json, { relocatable }).output, '0xb');
  assert.equal(choice.id, id);
  delete choice.inputs.TEST;
  assert.throws(() => compileWorkspace(json), /Вставь условие/);
});

test('the visual factory exposes one if with a shared Boolean socket for both predicate kinds', () => {
  const definitions = createVisualBlockDefinitions(PLACEMENT_ADAPTER);
  const definition = (type) => definitions.find((item) => item.type === type);
  assert.equal(definitions.filter((item) => item.type === 'arena_if').length, 1);
  assert.equal(definition('arena_config_if'), undefined);
  assert.equal(definition('arena_relocatable'), undefined);
  assert.equal(definition('arena_if').args0.find((item) => item.name === 'TEST').check, 'Boolean');
  assert.equal(definition('arena_condition').output, 'Boolean');
  assert.equal(definition('arena_boolean_input').output, 'Boolean');
  const toolbox = JSON.stringify(createVisualToolbox(PLACEMENT_ADAPTER));
  assert.doesNotMatch(toolbox, /arena_config_if|arena_relocatable|BuildBoolean/);
  assert.deepEqual(definition('arena_variable').output, ['Number', 'Variable']);
  assert.equal(definition('arena_assign').args0.find((item) => item.name === 'TARGET').check, 'Variable');
  assert.equal(
    definition('arena_assign').args0.some((item) => item.name === 'VAR'),
    false,
  );
});

test('assignment requires a connected variable reference as its target', () => {
  for (const target of [
    undefined,
    literal(3),
    input('loadAddress'),
    binary('add', 64, literal(1), literal(2)),
    block('arena_boolean_input', { KEY: 'relocatable', WHEN: 'enabled' }),
  ]) {
    const assignment = assign('address', literal(3));
    if (target) assignment.inputs.TARGET = { block: target };
    else delete assignment.inputs.TARGET;
    assert.throws(() => compileWorkspace(workspace(assignment)));
  }
  const assignment = assign('address', literal(3));
  assignment.inputs.TARGET.block.enabled = false;
  assert.throws(() => compileWorkspace(workspace(assignment)), /отключённый блок/);
  const changed = assign('work', literal(19));
  const result = run(workspace(assign('address', literal(7)), changed));
  assert.equal(result.output, '0x7');
  assert.equal(result.registers.rax, '0x13');
  changed.inputs.TARGET.block.fields.VAR = 'address';
  assert.equal(run(workspace(assign('address', literal(7)), changed)).output, '0x13');
});

test('v5 assignment VAR migration creates a target without changing its existing value or metadata', () => {
  const expression = binary('add', 64, literal(12), literal(9));
  const legacy = block('arena_assign', { VAR: 'address' }, { VALUE: expression });
  legacy.data = 'assignment source';
  legacy.x = 33;
  legacy.y = -44;
  const old = workspace(legacy);
  old.blocks.blocks[0].data = JSON.stringify({ visualVersion: 5, note: 'assignment draft' });
  const incomplete = {
    type: 'arena_assign',
    id: 'missing-value',
    fields: { VAR: 'work' },
    x: 612,
    y: 88,
    enabled: false,
  };
  old.blocks.blocks.push(incomplete);
  const before = JSON.stringify(old);
  const migrated = migrateExpressionWorkspace(old);
  assert.equal(JSON.stringify(old), before);
  const migratedAssign = migrated.blocks.blocks[0].next.block;
  assert.equal(migratedAssign.type, 'arena_assign');
  for (const key of ['id', 'data', 'x', 'y']) assert.deepEqual(migratedAssign[key], legacy[key]);
  assert.equal(migratedAssign.fields?.VAR, undefined);
  assert.deepEqual(migratedAssign.inputs.VALUE.block, expression);
  assert.equal(migratedAssign.inputs.TARGET.block.type, 'arena_variable');
  assert.equal(migratedAssign.inputs.TARGET.block.fields.VAR, 'address');
  const migratedDraft = migrated.blocks.blocks[1];
  for (const key of ['id', 'x', 'y', 'enabled']) assert.deepEqual(migratedDraft[key], incomplete[key]);
  assert.equal(migratedDraft.inputs.VALUE, undefined);
  assert.equal(migratedDraft.inputs.TARGET.block.fields.VAR, 'work');
  assert.equal(run(migrated).output, '0x15');
  assert.deepEqual(migrateExpressionWorkspace(migrated), migrated);
});

test('v6 loading preserves deliberately unplugged target and comparison operands', () => {
  const assignment = assign('address', literal(3));
  delete assignment.inputs.TARGET;
  const condition = block('arena_condition', { OP: 'branch_eq' }, { LEFT: literal(1) });
  const choice = block('arena_if', {}, { TEST: condition, THEN: assign('address', literal(4)) });
  const json = workspace(assignment, choice);
  json.blocks.blocks[0].data = JSON.stringify({ visualVersion: 6, adapter: PLACEMENT_ADAPTER.id });
  const original = JSON.stringify(json);
  const migrated = migrateExpressionWorkspace(json);
  assert.equal(JSON.stringify(json), original);
  const migratedAssign = migrated.blocks.blocks[0].next.block;
  assert.equal(migratedAssign.inputs.TARGET, undefined);
  assert.equal(migratedAssign.next.block.inputs.TEST.block.inputs.RIGHT, undefined);
  assert.throws(() => compileWorkspace(migrated));
  migratedAssign.inputs.TARGET = { block: variable('address') };
  assert.throws(() => compileWorkspace(migrated));
});

test('optional ELSE changes only the second branch of the same if primitive', () => {
  for (const hasElse of [false, true]) {
    const choice = block(
      'arena_if',
      {},
      {
        TEST: block('arena_boolean_input', { KEY: 'relocatable', WHEN: 'enabled' }),
        THEN: assign('address', literal(11)),
        ...(hasElse ? { ELSE: assign('address', literal(22)) } : {}),
      },
    );
    choice.extraState = { hasElse };
    const json = workspace(assign('address', literal(7)), choice);
    assert.equal(run(json, { relocatable: true }).output, '0xb');
    assert.equal(run(json, { relocatable: false }).output, hasElse ? '0x16' : '0x7');
    choice.inputs.TEST.block = block(
      'arena_condition',
      { OP: 'branch_eq' },
      { LEFT: variable('address'), RIGHT: literal(99) },
    );
    assert.equal(run(json).output, hasElse ? '0x16' : '0x7');
  }
  const inconsistent = block(
    'arena_if',
    {},
    {
      TEST: block('arena_boolean_input', { KEY: 'relocatable', WHEN: 'enabled' }),
      THEN: assign('address', literal(11)),
      ELSE: assign('address', literal(22)),
    },
  );
  inconsistent.extraState = { hasElse: false };
  assert.throws(() => compileWorkspace(workspace(inconsistent)));
});

test('migration preserves an explicitly visible empty ELSE and infers legacy populated ELSE', () => {
  for (const [extraState, elseBody, expected] of [
    [{ hasElse: true }, undefined, true],
    [undefined, assign('address', literal(22)), true],
    [undefined, undefined, false],
  ]) {
    const choice = block(
      'arena_if',
      {},
      {
        TEST: block('arena_condition', { OP: 'branch_eq' }, { LEFT: literal(1), RIGHT: literal(2) }),
        THEN: assign('address', literal(11)),
        ...(elseBody ? { ELSE: elseBody } : {}),
      },
    );
    if (extraState) choice.extraState = extraState;
    const old = workspace(assign('address', literal(7)), choice);
    old.blocks.blocks[0].data = JSON.stringify({ visualVersion: 5 });
    const migrated = migrateExpressionWorkspace(old);
    const newIf = migrated.blocks.blocks[0].next.block.next.block;
    assert.deepEqual(newIf.extraState, { hasElse: expected });
    assert.equal(newIf.id, choice.id);
    assert.equal(newIf.inputs.ELSE?.block.id, elseBody?.id);
    assert.equal(run(migrated).output, elseBody ? '0x16' : '0x7');
    assert.deepEqual(migrateExpressionWorkspace(migrated), migrated);
  }
});

test('v4 edited legacy operations migrate with their original arithmetic and carry semantics', () => {
  const old = workspace();
  const entry = old.blocks.blocks[0];
  entry.data = JSON.stringify({ visualVersion: 4 });
  const commands = [
    { type: 'arena_address', id: 'v4-load', fields: { SOURCE: 'load' } },
    { type: 'arena_alignment', id: 'v4-align' },
    { type: 'arena_math', id: 'v4-sub', fields: { OP: 'subtract64' } },
    { type: 'arena_adjust', id: 'v4-inc', fields: { OP: 'increment32' } },
    { type: 'arena_invert', id: 'v4-not' },
    entry.next.block,
  ];
  for (let i = 0; i < commands.length - 1; i++) commands[i].next = { block: commands[i + 1] };
  entry.next = { block: commands[0] };
  const migrated = migrateExpressionWorkspace(old);
  const source =
    'leaq startup_32(%rip), %rbp\nmovl BP_kernel_alignment(%rsi), %eax\nsubq %rax, %rbp\nincl %eax\nnotq %rax';
  for (const inputs of [
    { loadAddress: '0', alignment: '0xffffffff' },
    { loadAddress: '0x100000000', alignment: '0' },
  ]) {
    const before = executeProgram(parseAssembly(source), inputs);
    const after = run(migrated, inputs);
    assert.equal(after.output, before.output);
    assert.deepEqual(after.registers, before.registers);
    assert.deepEqual(lastFlags(after), lastFlags(before));
  }
});

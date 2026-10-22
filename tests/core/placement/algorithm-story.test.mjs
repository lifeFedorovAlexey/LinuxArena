import test from 'node:test';
import assert from 'node:assert/strict';
import { explainProgram, getReferenceModel } from '../../../src/core/placement/story.mjs';
import {
  REFERENCE_ASM,
  parseAssembly,
  executeProgram,
  referenceResult,
} from '../../../src/core/placement/index.mjs';

const explain = (source, inputs) => explainProgram(parseAssembly(source), inputs);
const runtime = (story) => story.branches.filter((branch) => branch.kind === 'runtime');
const pathOps = (story) =>
  story.route.nodeIds.map((id) => story.graph.nodes.find((node) => node.id === id).op);

function assertExactRoute(story) {
  assert.equal(story.route.nodeIds[0], story.graph.entry);
  assert.equal(story.route.nodeIds.at(-1), story.graph.exit);
  assert.equal(story.route.edgeIds.length, story.route.nodeIds.length - 1);
  story.route.edgeIds.forEach((id, index) => {
    const edge = story.graph.edges.find((edge) => edge.id === id);
    assert.equal(edge.from, story.route.nodeIds[index]);
    assert.equal(edge.to, story.route.nodeIds[index + 1]);
  });
  const executed = story.route.nodeIds.filter((id) => {
    const node = story.graph.nodes.find((node) => node.id === id);
    return node.op !== null && node.kind !== 'configuration';
  });
  assert.deepEqual(
    executed,
    story.trace.map((event) => event.id),
  );
  for (const branch of story.branches) {
    assert.equal(story.route.edgeIds.includes(branch.trueEdgeId), branch.taken === true);
    assert.equal(story.route.edgeIds.includes(branch.falseEdgeId), branch.taken === false);
  }
}

test('reference branch exposes both paths and follows the actual choice above and below the minimum', () => {
  for (const [loadAddress, taken] of [
    ['0x1100000', true],
    ['0x1000', false],
  ]) {
    const inputs = { loadAddress };
    const story = explainProgram(getReferenceModel(), inputs);
    const branch = runtime(story)[0];
    assert.equal(branch.conditionText, 'Адрес ≥ минимум?');
    assert.equal(branch.taken, taken);
    assert.notEqual(branch.trueTarget, branch.falseTarget);
    assert.equal(pathOps(story).includes('load_minimum'), !taken);
    assert.equal(story.matchesReference, true);
    assert.equal(story.output, referenceResult(inputs));
    assert.deepEqual(story.expected.trace, executeProgram(getReferenceModel(), inputs).trace);
    assert.equal(story.error, null);
    assertExactRoute(story);
  }
});

test('CONFIG=false selects the build edge and omits the runtime branch entirely', () => {
  const story = explainProgram(getReferenceModel(), { relocatable: false });
  assert.deepEqual(pathOps(story), [null, 'config_begin', 'load_minimum', 'label', null]);
  assert.equal(story.branches[0].kind, 'build');
  assert.equal(story.branches[0].taken, false);
  assert.equal(runtime(story)[0].taken, null);
  assert.deepEqual(
    story.trace.map((event) => event.op),
    ['load_minimum', 'label'],
  );
  assertExactRoute(story);
});

test('equal true/false targets still activate only the selected edge', () => {
  const source =
    '#ifdef CONFIG_RELOCATABLE\n#endif\nmovq $LOAD_PHYSICAL_ADDR, %rbp\ncmpq $LOAD_PHYSICAL_ADDR, %rbp\nje 1f\n1:';
  for (const relocatable of [true, false]) {
    const story = explain(source, { relocatable });
    for (const branch of story.branches) {
      assert.equal(branch.trueTarget, branch.falseTarget);
      assert.notEqual(branch.trueEdgeId, branch.falseEdgeId);
    }
    assertExactRoute(story);
  }
});

test('all supported comparison branches use truthful address conditions', () => {
  const cases = [
    ['jae', '≥', [false, true, true]],
    ['jb', '<', [true, false, false]],
    ['ja', '>', [false, false, true]],
    ['jbe', '≤', [true, true, false]],
    ['je', '=', [false, true, false]],
    ['jne', '≠', [true, false, true]],
  ];
  for (const [jump, sign, choices] of cases) {
    for (const [index, loadAddress] of ['99', '100', '101'].entries()) {
      const story = explain(
        `leaq startup_32(%rip), %rbp\ncmpq $LOAD_PHYSICAL_ADDR, %rbp\n${jump} 1f\nmovq $LOAD_PHYSICAL_ADDR, %rbp\n1:`,
        { loadAddress, minimumAddress: '100' },
      );
      assert.equal(runtime(story)[0].conditionText, `Адрес ${sign} минимум?`);
      assert.equal(runtime(story)[0].taken, choices[index]);
      assertExactRoute(story);
    }
  }
});

test('flag-based candidates are not misrepresented as an address comparison', () => {
  for (const jump of ['jae', 'jb', 'ja', 'jbe', 'je', 'jne']) {
    const story = explain(
      `leaq startup_32(%rip), %rbp\nmovl BP_kernel_alignment(%rsi), %eax\naddq %rax, %rbp\n${jump} 1f\nmovq $LOAD_PHYSICAL_ADDR, %rbp\n1:`,
      { loadAddress: '0xffffffffffffffff', alignment: '1' },
    );
    assert.match(runtime(story)[0].conditionText, /[Фф]лаг/);
    assert.doesNotMatch(runtime(story)[0].conditionText, /минимум/);
    assertExactRoute(story);
  }
});

test('disabled or nonadjacent comparisons never get an address comparison label', () => {
  const sources = [
    'leaq startup_32(%rip), %rbp\n#ifdef CONFIG_RELOCATABLE\ncmpq $LOAD_PHYSICAL_ADDR, %rbp\n#endif\njae 1f\n1:',
    'leaq startup_32(%rip), %rbp\ncmpq $LOAD_PHYSICAL_ADDR, %rbp\n#ifdef CONFIG_RELOCATABLE\njae 1f\n#endif\n1:',
    'leaq startup_32(%rip), %rbp\ncmpq $LOAD_PHYSICAL_ADDR, %rbp\nmovq $LOAD_PHYSICAL_ADDR, %rbp\njae 1f\n1:',
  ];
  for (const source of sources) {
    for (const relocatable of [true, false]) {
      const story = explain(source, { relocatable });
      assert.match(runtime(story)[0].conditionText, /[Фф]лаг/);
      assertExactRoute(story);
    }
  }
});

test('a jump can skip an entire configuration region, and a merge can have continuation', () => {
  const story = explain(
    'movq $LOAD_PHYSICAL_ADDR, %rbp\njae 1f\n#ifdef CONFIG_RELOCATABLE\nleaq startup_32(%rip), %rbp\n#endif\n1:\nmovl BP_kernel_alignment(%rsi), %eax\naddq %rax, %rbp',
  );
  assert.equal(story.branches.find((branch) => branch.kind === 'build').taken, null);
  assert.equal(story.trace.at(-1).op, 'add64');
  assert.equal(story.output, '0x1200000');
  assertExactRoute(story);
});

test('edited arithmetic keeps an independent reference trace and detects changed output', () => {
  const candidate = REFERENCE_ASM.replace('decl', 'incl');
  const story = explain(candidate);
  assert.equal(story.output, '0x1100000');
  assert.equal(story.expected.output, '0x1200000');
  assert.equal(story.matchesReference, false);
  assert.equal(
    story.trace.some((event) => event.op === 'increment32'),
    true,
  );
  assert.equal(
    story.expected.trace.some((event) => event.op === 'decrement32'),
    true,
  );
  assertExactRoute(story);
  const disabled = explain(candidate, { relocatable: false });
  assert.equal(disabled.matchesReference, true);
});

test('runtime failures retain the graph and reference without inventing a partial path', () => {
  const story = explain('addq %rax, %rbp\njae 1f\n1:');
  assert.ok(story.graph.nodes.length > 0);
  assert.match(story.error.message, /до присвоения/);
  assert.equal(story.output, null);
  assert.equal(story.matchesReference, false);
  assert.deepEqual(story.trace, []);
  assert.deepEqual(story.route, { nodeIds: [], edgeIds: [] });
  assert.equal(story.expected.output, '0x1200000');
  assert.ok(story.expected.trace.length > 0);
  assert.equal(runtime(story)[0].taken, null);
});

test('input/model validation still throws and explanatory data is JSON-safe and independent', () => {
  assert.throws(() => explainProgram(getReferenceModel(), { alignment: '-1' }));
  assert.throws(() => explainProgram({ version: 1, instructions: [{ op: 'unknown' }] }));
  const first = getReferenceModel();
  const before = JSON.stringify(first);
  const story = explainProgram(first);
  assert.equal(JSON.stringify(first), before);
  assert.doesNotThrow(() => JSON.stringify(story));
  for (const node of story.graph.nodes) assert.doesNotMatch(node.title, /rax|rbp|eax|cmpq|jae/i);
  first.instructions[0].op = 'load_minimum';
  assert.equal(getReferenceModel().instructions[0].op, 'config_begin');
});

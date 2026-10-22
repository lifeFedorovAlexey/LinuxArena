import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_ASM,
  parseAssembly,
  serializeAssembly,
  executeProgram,
  referenceResult,
  buildControlFlow,
  MAX_INSTRUCTIONS,
} from '../../../src/core/placement/index.mjs';

const base = 'leaq startup_32(%rip), %rbp';
const minimum = 'movq $LOAD_PHYSICAL_ADDR, %rbp';
const compare = 'cmpq $LOAD_PHYSICAL_ADDR, %rbp';

function assertGraphExecution(source, inputs = {}) {
  const model = parseAssembly(source);
  const graph = buildControlFlow(model);
  const evaluation = executeProgram(model, inputs);
  const events = new Map(evaluation.trace.map((event) => [event.id, event]));
  const actualPath = [];
  let id = graph.entry;
  let remaining = graph.nodes.length;
  while (id !== graph.exit) {
    assert.ok(remaining-- > 0, 'all paths must terminate');
    const node = graph.nodes.find((item) => item.id === id);
    const outgoing = graph.edges.filter((item) => item.from === id);
    let edge;
    if (node.kind === 'configuration') {
      edge = outgoing.find((item) => item.condition === (inputs.relocatable ?? true));
      assert.equal(edge.phase, 'build');
    } else if (node.kind === 'decision') {
      edge = outgoing.find((item) => item.condition === events.get(id)?.taken);
      actualPath.push(id);
    } else {
      assert.equal(outgoing.length, 1);
      [edge] = outgoing;
      assert.equal(edge.condition, null);
      if (id !== graph.entry) actualPath.push(id);
    }
    assert.ok(edge, `an edge must match execution at ${id}`);
    id = edge.to;
  }
  assert.deepEqual(
    actualPath,
    evaluation.trace.map((item) => item.id),
  );
  return { model, graph, evaluation };
}

test('numbered forward targets survive model and source round trips', () => {
  const source = `${base}\n${compare}\njb 12f\njmp 64f\n12:\n${minimum}\n64:`;
  const parsed = parseAssembly(source);
  assert.deepEqual(
    parsed.instructions.filter((item) => item.target !== undefined).map((item) => item.target),
    [12, 64],
  );
  assert.deepEqual(
    parsed.instructions.filter((item) => item.op === 'label').map((item) => item.labelId),
    [12, 64],
  );
  assert.ok(
    parsed.instructions
      .filter((item) => item.target || item.labelId)
      .every((item) => item.referenceLine === null),
  );
  const canonical = serializeAssembly(parsed);
  assert.match(canonical, /jb 12f/);
  assert.match(canonical, /jmp 64f/);
  assert.match(canonical, /12:\n/);
  assert.equal(serializeAssembly(parseAssembly(canonical)), canonical);
  assert.equal(assertGraphExecution(source, { loadAddress: '0x800000' }).evaluation.output, '0x1000000');
  const taken = assertGraphExecution(source, { loadAddress: '0x1200000' });
  assert.equal(taken.evaluation.output, '0x1200000');
  assert.equal(taken.evaluation.trace.find((item) => item.op === 'jump').target, 64);
  assert.equal(
    taken.evaluation.trace.some((item) => item.labelId === 12),
    false,
  );
});

test('both CONFIG arms execute exclusively and are represented by exact graph paths', () => {
  const source = `#ifdef CONFIG_RELOCATABLE\n${base}\njmp 2f\n${minimum}\n2:\n#else\n${minimum}\njmp 3f\n${base}\n3:\n#endif\n4:`;
  for (const relocatable of [false, true]) {
    const { model, graph, evaluation } = assertGraphExecution(source, {
      relocatable,
      loadAddress: '0x1800000',
    });
    assert.equal(evaluation.output, relocatable ? '0x1800000' : '0x1000000');
    assert.ok(
      evaluation.trace.every((step) => {
        const instruction = model.instructions.find((item) => item.id === step.id);
        return !instruction.conditional || instruction.configValue === relocatable;
      }),
    );
    assert.equal(
      graph.nodes.some((item) => item.op === 'config_else' || item.op === 'config_end'),
      false,
    );
    assert.ok(
      graph.nodes
        .filter((item) => item.conditional && item.op !== 'config_begin')
        .some((item) => item.configValue === false),
    );
    const gate = graph.nodes.find((item) => item.op === 'config_begin');
    const trueTarget = graph.edges.find((item) => item.from === gate.id && item.condition === true).to;
    const falseTarget = graph.edges.find((item) => item.from === gate.id && item.condition === false).to;
    assert.equal(graph.nodes.find((item) => item.id === trueTarget).op, 'load_base');
    assert.equal(graph.nodes.find((item) => item.id === falseTarget).op, 'load_minimum');
  }
});

test('empty CONFIG arms fall through without entering the other arm', () => {
  for (const source of [
    `${minimum}\n#ifdef CONFIG_RELOCATABLE\n#else\n${base}\n#endif`,
    `${minimum}\n#ifdef CONFIG_RELOCATABLE\n${base}\n#else\n#endif`,
    `${minimum}\n#ifdef CONFIG_RELOCATABLE\n#else\n#endif`,
  ]) {
    for (const relocatable of [false, true]) assertGraphExecution(source, { relocatable });
  }
});

test('jumps may leave either CONFIG arm for a common later label', () => {
  const source = `#ifdef CONFIG_RELOCATABLE\n${base}\njmp 8f\n#else\n${minimum}\njmp 8f\n#endif\n${base}\n8:`;
  assert.equal(assertGraphExecution(source, { relocatable: true }).evaluation.output, '0x1100000');
  assert.equal(assertGraphExecution(source, { relocatable: false }).evaluation.output, '0x1000000');
});

test('each conditional instruction uses its own non-default forward target', () => {
  for (const branch of ['jae', 'jb', 'ja', 'jbe', 'je', 'jne']) {
    const source = `${base}\n${compare}\n${branch} 7f\n${minimum}\njmp 9f\n7:\n${base}\n9:`;
    const outcomes = new Set();
    for (const loadAddress of ['0x800000', '0x1000000', '0x1800000']) {
      const { evaluation } = assertGraphExecution(source, { loadAddress });
      const step = evaluation.trace.find((item) => item.op.startsWith('branch_'));
      outcomes.add(step.taken);
      assert.equal(step.target, 7);
    }
    assert.deepEqual([...outcomes].sort(), [false, true]);
  }
});

test('backward, missing, duplicate and cross-configuration targets are rejected', () => {
  for (const source of [
    'jmp 2f\n1:',
    '2:\njmp 2f',
    '2:\n2:',
    '0:',
    '65:',
    'jmp 0f\n1:',
    'jmp 65f\n1:',
    '#else',
    '#ifdef CONFIG_RELOCATABLE\n#else\n#else\n#endif',
    '#ifdef CONFIG_RELOCATABLE\n#else',
    '#ifdef CONFIG_RELOCATABLE\n#ifdef CONFIG_RELOCATABLE\n#endif\n#endif',
    '#ifdef CONFIG_RELOCATABLE\n#endif\n#ifdef CONFIG_RELOCATABLE\n#endif',
    'jmp 2f\n#ifdef CONFIG_RELOCATABLE\n2:\n#endif',
    'jmp 2f\n#ifdef CONFIG_RELOCATABLE\n#else\n2:\n#endif',
    '#ifdef CONFIG_RELOCATABLE\njmp 2f\n#else\n2:\n#endif',
  ])
    assert.throws(() => parseAssembly(source), undefined, source);
});

test('model targets are validated and legacy op-only jumps still default to label 1', () => {
  const original = parseAssembly(REFERENCE_ASM);
  const legacy = { version: 1, instructions: original.instructions.map(({ op }) => ({ op })) };
  assert.equal(serializeAssembly(legacy), serializeAssembly(original));
  assert.equal(executeProgram(legacy).output, referenceResult());
  for (const value of [0, 65, 1.5, '2', '1f\ncall system', null]) {
    assert.throws(() =>
      serializeAssembly({ version: 1, instructions: [{ op: 'jump', target: value }, { op: 'label' }] }),
    );
    assert.throws(() => serializeAssembly({ version: 1, instructions: [{ op: 'label', labelId: value }] }));
  }
  assert.throws(
    () => parseAssembly(Array.from({ length: MAX_INSTRUCTIONS + 1 }, () => minimum).join('\n')),
    /операций/,
  );
});

test('pinned original arithmetic remains unchanged for both configurations and boundary inputs', () => {
  for (const relocatable of [false, true]) {
    for (const loadAddress of ['0x0', '0x1000000', '0x1380000', '0xffffffffffe00000', '0xffffffffffffffff']) {
      const inputs = { relocatable, loadAddress };
      assert.equal(assertGraphExecution(REFERENCE_ASM, inputs).evaluation.output, referenceResult(inputs));
    }
  }
});

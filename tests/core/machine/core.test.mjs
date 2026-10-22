import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  SOURCE,
  REFERENCE_ASM,
  parseAssembly,
  serializeAssembly,
  executeProgram,
  referenceResult,
  validateInputs,
  BOOT_LAYERS,
  buildControlFlow,
} from '../../../src/core/placement/index.mjs';

const program = parseAssembly(REFERENCE_ASM);
const referenceRoot = new URL('../../../reference/', import.meta.url);

test('vendored source bytes match the pinned Git blobs and SHA-256 manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', referenceRoot), 'utf8'));
  assert.equal(manifest.ref, SOURCE.ref);
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.path, referenceRoot));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    if (file.kind === 'original') {
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      assert.equal(sha, file.upstreamBlob, file.path);
    }
  }
});

test('executable reference comes from the real startup_64 line range', async () => {
  const source = await readFile(new URL('linux/' + SOURCE.path, referenceRoot), 'utf8');
  const lines = source.split('\n');
  assert.equal(lines[SOURCE.entryLine - 1], 'SYM_CODE_START(startup_64)');
  assert.equal(lines.slice(SOURCE.firstLine - 1, SOURCE.lastLine).join('\n') + '\n', REFERENCE_ASM);
  assert.equal(
    lines[BOOT_LAYERS.startup.nodes.find((n) => n.id === 'stack').source.start - 1].trim(),
    'leaq\trva(boot_stack_end)(%rbx), %rsp',
  );
});

test('ASM → blocks → ASM is stable and retains each operation', () => {
  const canonical = serializeAssembly(program);
  assert.equal(serializeAssembly(parseAssembly(canonical)), canonical);
  assert.deepEqual(
    parseAssembly(canonical).instructions.map((i) => i.op),
    program.instructions.map((i) => i.op),
  );
  assert.equal(executeProgram(parseAssembly(canonical)).output, '0x1200000');
  assert.equal(program.instructions.find((i) => i.op === 'and64').referenceLine, 321);
});

test('original matches known aligned, rounded, floor and unsigned address cases', () => {
  const cases = [
    ['0x0', '0x200000', '0x1000000'],
    ['0x1000000', '0x200000', '0x1000000'],
    ['0x1100000', '0x200000', '0x1200000'],
    ['0x100000001', '0x200000', '0x100200000'],
    ['0x8000000000000000', '0x200000', '0x8000000000000000'],
    ['0xffffffffffe00000', '0x200000', '0xffffffffffe00000'],
    ['0xffffffffffffffff', '0x200000', '0x1000000'],
    ['0x1100000', '0x0', '0x100000000'],
    ['0x1100000', '0x1', '0x1100000'],
  ];
  for (const [loadAddress, alignment, expected] of cases) {
    const inputs = { loadAddress, alignment };
    assert.equal(executeProgram(program, inputs).output, expected, `${loadAddress} / ${alignment}`);
    assert.equal(referenceResult(inputs), expected);
  }
});

test('CONFIG_RELOCATABLE=n executes only the fallback and preserves the real boundary', () => {
  const result = executeProgram(program, { relocatable: false, loadAddress: '0xffffffffffffffff' });
  assert.equal(result.output, '0x1000000');
  assert.deepEqual(
    result.trace.map((i) => i.op),
    ['load_minimum', 'label'],
  );
  assert.equal(result.registers.rax, '0x0');
});

test('trace records actual branch behavior instead of showing the fallback as executed', () => {
  const rounded = executeProgram(program, { loadAddress: '0x1100000' });
  assert.equal(rounded.trace.find((i) => i.op === 'branch_ge').taken, true);
  assert.equal(
    rounded.trace.some((i) => i.op === 'load_minimum'),
    false,
  );
  const below = executeProgram(program, { loadAddress: '0x1000' });
  assert.equal(below.trace.find((i) => i.op === 'branch_ge').taken, false);
  assert.equal(
    below.trace.some((i) => i.op === 'load_minimum'),
    true,
  );
});

test('editing a block changes emitted assembly and observable result', () => {
  const changed = structuredClone(program);
  changed.instructions.find((i) => i.op === 'and64').op = 'or64';
  const assembly = serializeAssembly(changed);
  assert.match(assembly, /orq %rax, %rbp/);
  assert.notEqual(executeProgram(parseAssembly(assembly)).output, referenceResult());
  const fromCode = parseAssembly(REFERENCE_ASM.replace('andq', 'orq'));
  assert.deepEqual(
    fromCode.instructions.map((i) => i.op),
    changed.instructions.map((i) => i.op),
  );
});

test('JAE uses the latest CPU carry flag, including intervening arithmetic', () => {
  const altered = parseAssembly(`leaq startup_32(%rip), %rbp
movl BP_kernel_alignment(%rsi), %eax
cmpq $LOAD_PHYSICAL_ADDR, %rbp
andq %rax, %rbp
jae 1f
movq $LOAD_PHYSICAL_ADDR, %rbp
1:`);
  const result = executeProgram(altered, { loadAddress: '0x0' });
  assert.equal(result.output, '0x0');
  assert.equal(result.trace.find((i) => i.op === 'branch_ge').taken, true);
});

test('unsupported code, invalid control flow and uninitialized reads fail explicitly', () => {
  for (const code of [
    'call system',
    '.text',
    'movq %rsp, %rbp',
    'jae 1f',
    '#ifdef CONFIG_RANDOMIZE_BASE\n#endif',
    '# ifdef CONFIG_RANDOMIZE_BASE\n# endif',
    '#endif',
    '#ifdef CONFIG_RELOCATABLE\nleaq startup_32(%rip), %rbp',
    '1:\njae 1f',
    '1:\n1:',
    '/* unterminated',
  ])
    assert.throws(() => parseAssembly(code), undefined, code);
  assert.throws(() => executeProgram(parseAssembly('andq %rax, %rbp')), /до присвоения/);
  assert.throws(() => serializeAssembly({ version: 1, instructions: [{ op: 'eval' }] }), /Неизвестный/);
});

test('input parser rejects truncated numbers and distinguishes arithmetic edges from boot validity', () => {
  for (const inputs of [
    { loadAddress: -1 },
    { loadAddress: Number.MAX_SAFE_INTEGER + 1 },
    { loadAddress: '0x10000000000000000' },
    { loadAddress: '1e6' },
    { alignment: '0x100000000' },
    { alignment: null },
    { relocatable: 'false' },
  ])
    assert.throws(() => executeProgram(program, inputs));
  assert.equal(validateInputs({ alignment: '0x200000' }).warnings.length, 0);
  assert.ok(validateInputs({ alignment: 0 }).warnings.length);
  assert.ok(executeProgram(program, { loadAddress: '0xffffffffffffffff' }).warnings.length);
});

test('deterministic edge grid covers every 32-bit alignment power and uint64 boundaries', () => {
  const addresses = [0n, 1n, 0xffffffn, 0x1000000n, 0x1000001n, 0xffffffffn, 1n << 63n, (1n << 64n) - 1n];
  for (let shift = 0n; shift < 32n; shift++) {
    for (const loadAddress of addresses) {
      for (const relocatable of [true, false]) {
        const inputs = { loadAddress, alignment: 1n << shift, relocatable };
        assert.equal(executeProgram(program, inputs).output, referenceResult(inputs));
      }
    }
  }
});

test('control-flow graph distinguishes build configuration, operations, branch and merge', () => {
  const graph = buildControlFlow(program);
  const find = (op) => graph.nodes.find((node) => node.op === op);
  const gate = find('config_begin');
  const decision = find('branch_ge');
  const fallback = find('load_minimum');
  const merge = find('label');
  assert.equal(gate.kind, 'configuration');
  assert.equal(gate.phase, 'build');
  assert.equal(decision.kind, 'decision');
  assert.equal(find('add64').kind, 'operation');
  assert.equal(merge.kind, 'merge');
  assert.equal(graph.nodes.find((node) => node.id === graph.entry).kind, 'entry');
  assert.equal(graph.nodes.find((node) => node.id === graph.exit).kind, 'exit');
  assert.equal(
    graph.nodes.some((node) => node.op === 'config_end'),
    false,
  );
  assert.deepEqual(
    graph.edges
      .filter((edge) => edge.from === gate.id)
      .map(({ to, label, phase, condition }) => ({ to, label, phase, condition })),
    [
      { to: find('load_base').id, label: 'да', phase: 'build', condition: true },
      { to: fallback.id, label: 'нет', phase: 'build', condition: false },
    ],
  );
  assert.deepEqual(
    graph.edges
      .filter((edge) => edge.from === decision.id)
      .map(({ to, label, phase, condition }) => ({ to, label, phase, condition })),
    [
      { to: merge.id, label: 'да', phase: 'runtime', condition: true },
      { to: fallback.id, label: 'нет', phase: 'runtime', condition: false },
    ],
  );
  assert.deepEqual(
    graph.edges.filter((edge) => edge.from === fallback.id).map((edge) => edge.to),
    [merge.id],
  );
  assert.deepEqual(
    graph.edges.filter((edge) => edge.from === merge.id).map((edge) => edge.to),
    [graph.exit],
  );
});

function graphRuntimePath(model, inputs) {
  const graph = buildControlFlow(model);
  const result = executeProgram(model, inputs);
  const trace = new Map(result.trace.map((step) => [step.id, step]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const path = [];
  let id = graph.entry;
  let remaining = graph.nodes.length + 1;
  while (id !== graph.exit) {
    assert.ok(remaining-- > 0, 'graph path must terminate');
    const node = nodes.get(id);
    const outgoing = graph.edges.filter((edge) => edge.from === id);
    let chosen;
    if (node.kind === 'configuration')
      chosen = outgoing.find((edge) => edge.condition === inputs.relocatable);
    else if (node.kind === 'decision') {
      assert.ok(trace.has(id), 'runtime decision must correspond to a trace event');
      chosen = outgoing.find((edge) => edge.condition === trace.get(id).taken);
      path.push(id);
    } else {
      assert.equal(outgoing.length, 1);
      [chosen] = outgoing;
      if (node.kind !== 'entry') path.push(id);
    }
    assert.ok(chosen, 'each reached node must have the selected outgoing edge');
    id = chosen.to;
  }
  assert.deepEqual(
    path,
    result.trace.map((step) => step.id),
  );
  return { graph, result, path };
}

test('graph paths match actual execution for taken, fallthrough and excluded build paths', () => {
  const taken = graphRuntimePath(program, { loadAddress: '0x1100000', relocatable: true });
  const fallback = graphRuntimePath(program, { loadAddress: '0x1000', relocatable: true });
  const fixed = graphRuntimePath(program, { loadAddress: '0x1100000', relocatable: false });
  const fallbackId = program.instructions.find((instruction) => instruction.op === 'load_minimum').id;
  assert.equal(taken.path.includes(fallbackId), false);
  assert.equal(fallback.path.includes(fallbackId), true);
  assert.deepEqual(
    fixed.result.trace.map((step) => step.op),
    ['load_minimum', 'label'],
  );
  assert.equal(
    taken.graph.nodes.find((node) => node.kind === 'configuration').id,
    program.instructions[0].id,
  );
});

test('edited increments and every supported conditional branch have both semantic edges', () => {
  for (const branch of ['jae', 'jb', 'ja', 'jbe', 'je', 'jne']) {
    const candidate = parseAssembly(
      REFERENCE_ASM.replace('decl', 'incl').replace(/jae\s+1f/, `${branch} 1f`),
    );
    const graph = buildControlFlow(candidate);
    const decision = graph.nodes.find((node) => node.kind === 'decision');
    assert.equal(graph.nodes.find((node) => node.op === 'increment32').kind, 'operation');
    assert.deepEqual(
      graph.edges.filter((edge) => edge.from === decision.id).map((edge) => edge.condition),
      [true, false],
    );
    for (const loadAddress of ['0x0', '0x1000000', '0x1100000']) {
      graphRuntimePath(candidate, { loadAddress, relocatable: true });
    }
  }
});

test('graph supports no configuration, an empty conditional region and code after a merge', () => {
  const noConfig = parseAssembly(`leaq startup_32(%rip), %rbp
cmpq $LOAD_PHYSICAL_ADDR, %rbp
jae 1f
movq $LOAD_PHYSICAL_ADDR, %rbp
1:
movl BP_kernel_alignment(%rsi), %eax`);
  const { graph } = graphRuntimePath(noConfig, { loadAddress: '0x1100000', relocatable: false });
  assert.equal(
    graph.nodes.some((node) => node.kind === 'configuration'),
    false,
  );
  const merge = graph.nodes.find((node) => node.kind === 'merge');
  const afterMerge = graph.nodes.find((node) => node.op === 'load_alignment');
  assert.equal(graph.edges.find((edge) => edge.from === merge.id).to, afterMerge.id);
  const emptyConfig = parseAssembly('#ifdef CONFIG_RELOCATABLE\n#endif\nmovq $LOAD_PHYSICAL_ADDR, %rbp');
  for (const relocatable of [false, true]) graphRuntimePath(emptyConfig, { relocatable });
});

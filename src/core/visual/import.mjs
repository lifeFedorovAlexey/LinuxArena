// SPDX-License-Identifier: GPL-2.0-only
import { branches } from './schema.mjs';
import { machineExpressions } from './import-expressions.mjs';
function chain(blocks) {
  for (let index = 0; index < blocks.length - 1; index++) blocks[index].next = { block: blocks[index + 1] };
  return blocks[0] ?? null;
}

// The nearest common continuation belongs after the C-block. Branch-only work
// belongs inside it. Work crossing a build boundary may appear in both arms.
function postdominators(graph, outgoing) {
  const memo = new Map();
  const visiting = new Set();
  const visit = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) throw new Error('Визуальный алгоритм поддерживает только переходы вперёд.');
    visiting.add(id);
    const successors = (outgoing.get(id) ?? []).map((edge) => visit(edge.to));
    const common = successors.length
      ? new Set([...successors[0]].filter((candidate) => successors.every((set) => set.has(candidate))))
      : new Set();
    common.add(id);
    memo.set(id, common);
    visiting.delete(id);
    return common;
  };
  for (const node of graph.nodes) visit(node.id);
  return (id) =>
    [...memo.get(id)]
      .filter((candidate) => candidate !== id)
      .sort((a, b) => memo.get(b).size - memo.get(a).size)[0] ?? graph.exit;
}

export function modelToWorkspace(model, adapter) {
  const { parseAssembly, serializeAssembly, buildControlFlow } = adapter.machine;
  const program = parseAssembly(serializeAssembly(model));
  const graph = buildControlFlow(program);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const source = new Map(
    program.instructions.map((instruction, index) => [
      instruction.id,
      {
        ...instruction,
        id: model.instructions[index].id ?? instruction.id,
      },
    ]),
  );
  const outgoing = new Map();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  const continuation = postdominators(graph, outgoing);
  const usedIds = new Set(['arena-entry', 'arena-result']);
  const visited = new Set();
  const allocate = (preferred) => {
    let id = String(preferred);
    let copy = 1;
    while (usedIds.has(id)) id = `${preferred}-copy-${copy++}`;
    usedIds.add(id);
    if (usedIds.size > 1024) throw new Error('Развёрнутый алгоритм превышает 1024 визуальных блока.');
    return id;
  };
  const metadata = (ids) => JSON.stringify({ sourceInstructionIds: ids.map((id) => source.get(id).id) });
  const makePrimitive = (instructionId) => {
    const instruction = source.get(instructionId);
    const machine = instruction.op === 'generic' ? instruction : adapter.instructionToGeneric?.(instruction);
    if (!machine) throw new Error(`Невозможно представить операцию ${instruction.op} визуальным блоком.`);
    return machineExpressions(adapter, allocate, metadata([instructionId])).statement(
      machine,
      allocate(instruction.id),
    );
  };
  const convert = (start, stop) => {
    const blocks = [];
    let id = start;
    while (id !== stop && id !== graph.exit) {
      visited.add(id);
      const node = nodes.get(id);
      const edges = outgoing.get(id) ?? [];
      if (node.kind === 'entry' || node.op === 'label' || node.op === 'jump') {
        id = edges[0].to;
        continue;
      }
      let decision = node;
      let pairedComparison = false;
      const machine = source.has(id)
        ? source.get(id).op === 'generic'
          ? source.get(id)
          : adapter.instructionToGeneric?.(source.get(id))
        : null;
      if (machine?.mnemonic === 'cmp') {
        const candidate = nodes.get(edges[0]?.to);
        const position = program.instructions.findIndex((item) => item.id === id);
        pairedComparison =
          candidate?.kind === 'decision' &&
          program.instructions[position + 1]?.id === candidate.id &&
          node.configValue === candidate.configValue;
        if (pairedComparison) decision = candidate;
      }
      if (decision.kind === 'configuration' || decision.kind === 'decision') {
        visited.add(decision.id);
        const buildTime = decision.kind === 'configuration';
        const join = continuation(decision.id);
        const choiceEdges = outgoing.get(decision.id);
        const sourceIds = pairedComparison ? [id, decision.id] : [id];
        const block = {
          type: 'arena_if',
          id: allocate(source.get(id).id),
          data: metadata(sourceIds),
          inputs: {},
        };
        block.inputs.TEST = {
          block: {
            type: buildTime
              ? 'arena_boolean_input'
              : pairedComparison
                ? 'arena_condition'
                : 'arena_flag_condition',
            id: allocate(`condition-${block.id}`),
            fields: buildTime ? { KEY: adapter.buildInput.key, WHEN: 'enabled' } : { OP: decision.op },
            data: metadata(sourceIds),
            ...(pairedComparison
              ? {
                  inputs: machineExpressions(adapter, allocate, metadata(sourceIds)).compareInputs(
                    machine,
                    `${block.id}-condition`,
                  ),
                }
              : {}),
          },
        };
        for (const [name, choice] of [
          ['THEN', true],
          ['ELSE', false],
        ]) {
          const body = chain(convert(choiceEdges.find((edge) => edge.condition === choice).to, join));
          if (body) block.inputs[name] = { block: body };
        }
        block.extraState = { hasElse: Boolean(block.inputs.ELSE?.block) };
        blocks.push(block);
        id = join;
      } else {
        blocks.push(makePrimitive(id));
        id = edges[0].to;
      }
    }
    return blocks;
  };
  const body = convert(graph.entry, graph.exit);
  body.push({ type: 'arena_result', id: 'arena-result', deletable: false });
  const entry = {
    type: 'arena_entry',
    id: 'arena-entry',
    x: 48,
    y: 32,
    deletable: false,
    movable: false,
    data: JSON.stringify({ visualVersion: 6, adapter: adapter.id }),
    next: { block: chain(body) },
  };
  const drafts = program.instructions
    .filter(
      (item) =>
        !visited.has(item.id) &&
        !item.op.startsWith('config_') &&
        item.op !== 'label' &&
        item.op !== 'jump' &&
        !branches.includes(item.op),
    )
    .map((item) => makePrimitive(item.id));
  drafts.forEach((block, index) => {
    block.x = 500;
    block.y = 32 + index * 64;
  });
  return { blocks: { languageVersion: 0, blocks: [entry, ...drafts] } };
}

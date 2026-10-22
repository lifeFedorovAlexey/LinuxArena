// SPDX-License-Identifier: GPL-2.0-only
import { REFERENCE_ASM } from './reference.mjs';
import { parseAssembly, serializeAssembly, buildControlFlow, executeProgram } from './model.mjs';
import { validateInputs } from './inputs.mjs';

const titles = {
  load_base: 'Адрес ← адрес загрузки',
  load_minimum: 'Адрес ← минимум',
  load_alignment: 'Рабочее число ← выравнивание',
  decrement32: 'Рабочее число − 1 · u32',
  increment32: 'Рабочее число + 1 · u32',
  add64: 'Адрес + рабочее число · u64',
  subtract64: 'Адрес − рабочее число · u64',
  invert64: 'Инвертировать биты рабочего числа · u64',
  and64: 'Оставить общие биты адреса и числа',
  or64: 'Объединить биты адреса и числа',
  xor64: 'Исключающее ИЛИ адреса и числа',
  compare_minimum: 'Сравнить адрес с минимумом',
  label: 'Объединить пути',
  config_begin: 'Перемещение ядра включено?',
};

const comparisons = {
  branch_ge: 'Адрес ≥ минимум?',
  branch_lt: 'Адрес < минимум?',
  branch_gt: 'Адрес > минимум?',
  branch_le: 'Адрес ≤ минимум?',
  branch_eq: 'Адрес = минимум?',
  branch_ne: 'Адрес ≠ минимум?',
};

const flagConditions = {
  branch_ge: 'Флаг переноса сброшен?',
  branch_lt: 'Флаг переноса установлен?',
  branch_gt: 'Флаги переноса и нулевого результата сброшены?',
  branch_le: 'Установлен флаг переноса или нулевого результата?',
  branch_eq: 'Флаг нулевого результата установлен?',
  branch_ne: 'Флаг нулевого результата сброшен?',
};

export function getReferenceModel() {
  return parseAssembly(REFERENCE_ASM);
}

// Use an address comparison only when that exact comparison must supply the flags.
// In particular, a comparison disabled by CONFIG cannot explain an outside branch.
function conditionText(program, index) {
  const instruction = program.instructions[index];
  if (instruction.op === 'config_begin') return titles.config_begin;
  const previous = program.instructions[index - 1];
  const directlyCompared =
    previous?.op === 'compare_minimum' && previous.configValue === instruction.configValue;
  return (directlyCompared ? comparisons : flagConditions)[instruction.op];
}

function traceRoute(graph, trace, relocatable) {
  const events = new Map(trace.map((event) => [event.id, event]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  const route = { nodeIds: [], edgeIds: [] };
  let id = graph.entry;
  while (true) {
    if (route.nodeIds.includes(id)) throw new Error('В маршруте фрагмента обнаружен цикл.');
    route.nodeIds.push(id);
    if (id === graph.exit) return route;
    const node = nodes.get(id);
    const edges = outgoing.get(id) ?? [];
    let edge;
    if (node.kind === 'configuration') {
      edge = edges.find((item) => item.condition === relocatable);
    } else if (node.kind === 'decision') {
      edge = edges.find((item) => item.condition === events.get(id)?.taken);
    } else {
      edge = edges.find((item) => item.condition === null);
    }
    if (!edge) throw new Error('Граф и трасса выполнения не согласованы.');
    route.edgeIds.push(edge.id);
    id = edge.to;
  }
}

/** A route through build-time gates and runtime decisions, with the pinned reference beside it.
 * IDs are the canonical instruction-N IDs used by executeProgram, not editor block IDs.
 * Malformed models/inputs throw. Valid models that fail at runtime retain their graph and error.
 */
export function explainProgram(model, inputs = {}) {
  const program = parseAssembly(serializeAssembly(model));
  const input = validateInputs(inputs);
  const graph = buildControlFlow(model);
  const indices = new Map(program.instructions.map((item, index) => [item.id, index]));
  for (const node of graph.nodes) {
    const title =
      node.kind === 'decision'
        ? conditionText(program, indices.get(node.id))
        : (titles[node.op] ?? node.title);
    node.title = title;
    node.label = title;
  }
  const reference = executeProgram(getReferenceModel(), inputs);
  const expected = { output: reference.output, trace: reference.trace };
  let evaluation;
  let error = null;
  try {
    evaluation = executeProgram(program, inputs);
  } catch (cause) {
    error = { message: cause instanceof Error ? cause.message : String(cause) };
  }
  const trace = evaluation?.trace ?? [];
  const route = evaluation ? traceRoute(graph, trace, input.relocatable) : { nodeIds: [], edgeIds: [] };
  const activeNodes = new Set(route.nodeIds);
  const events = new Map(trace.map((event) => [event.id, event]));
  const branches = graph.nodes
    .filter((node) => node.kind === 'configuration' || node.kind === 'decision')
    .map((node) => {
      const whenTrue = graph.edges.find((edge) => edge.from === node.id && edge.condition === true);
      const whenFalse = graph.edges.find((edge) => edge.from === node.id && edge.condition === false);
      const kind = node.kind === 'configuration' ? 'build' : 'runtime';
      return {
        instructionId: node.id,
        kind,
        conditionText: node.title,
        taken: !activeNodes.has(node.id)
          ? null
          : kind === 'build'
            ? input.relocatable
            : events.get(node.id).taken,
        trueTarget: whenTrue.to,
        falseTarget: whenFalse.to,
        trueEdgeId: whenTrue.id,
        falseEdgeId: whenFalse.id,
      };
    });
  return {
    graph,
    route,
    branches,
    trace,
    output: evaluation?.output ?? null,
    expected,
    matchesReference: Boolean(evaluation && evaluation.output === expected.output),
    error,
  };
}

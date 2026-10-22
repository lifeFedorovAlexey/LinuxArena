// SPDX-License-Identifier: GPL-2.0-only
import { parseAssembly, serializeAssembly } from './grammar.mjs';
// Build the graph from the same validated instruction sequence used by the interpreter.
// A build-time gate selects whether instructions exist; it is not a CPU instruction.
export function buildControlFlow(model, dialect) {
  const program = parseAssembly(serializeAssembly(model, dialect), dialect);
  const entry = 'flow-entry';
  const exit = 'flow-exit';
  const nodes = [
    {
      id: entry,
      kind: 'entry',
      label: 'Вход',
      title: 'Вход',
      op: null,
      assembly: '',
      sourceLine: null,
      referenceLine: null,
      conditional: false,
      configValue: null,
      phase: 'runtime',
    },
  ];
  const edges = [];
  const elseIndex = program.instructions.findIndex((item) => item.op === 'config_else');
  const endIndex = program.instructions.findIndex((item) => item.op === 'config_end');
  const labels = new Map(
    program.instructions.filter((item) => item.op === 'label').map((item) => [item.labelId, item]),
  );
  const nextVisible = (start) => {
    for (let index = start; index < program.instructions.length; index++) {
      if (program.instructions[index].op === 'config_else') {
        index = endIndex;
        continue;
      }
      if (program.instructions[index].op !== 'config_end') return program.instructions[index].id;
    }
    return exit;
  };
  const connect = (from, to, condition = null, phase = 'runtime') => {
    edges.push({
      id: `flow-edge-${edges.length}`,
      from,
      to,
      condition,
      phase,
      label: condition === null ? '' : condition ? 'да' : 'нет',
    });
  };

  for (const [index, instruction] of program.instructions.entries()) {
    const { op } = instruction;
    if (op === 'config_end' || op === 'config_else') continue;
    const kind =
      op === 'config_begin'
        ? 'configuration'
        : op.startsWith('branch_')
          ? 'decision'
          : op === 'label'
            ? 'merge'
            : 'operation';
    nodes.push({
      id: instruction.id,
      kind,
      label: instruction.label,
      title: instruction.label,
      op,
      assembly: instruction.sourceText,
      sourceLine: model.instructions[index].sourceLine ?? instruction.sourceLine,
      referenceLine: instruction.referenceLine,
      conditional: instruction.conditional,
      configValue: instruction.configValue,
      ...(instruction.labelId === undefined ? {} : { labelId: instruction.labelId }),
      ...(instruction.target === undefined ? {} : { target: instruction.target }),
      ...(instruction.op === 'generic'
        ? { mnemonic: instruction.mnemonic, width: instruction.width, operands: instruction.operands }
        : {}),
      phase: kind === 'configuration' ? 'build' : 'runtime',
    });
    if (kind === 'configuration') {
      connect(instruction.id, nextVisible(index + 1), true, 'build');
      connect(instruction.id, nextVisible((elseIndex < 0 ? endIndex : elseIndex) + 1), false, 'build');
    } else if (kind === 'decision') {
      const target = labels.get(instruction.target);
      connect(instruction.id, target.id, true);
      connect(instruction.id, nextVisible(index + 1), false);
    } else if (op === 'jump') {
      connect(instruction.id, labels.get(instruction.target).id);
    } else {
      connect(instruction.id, nextVisible(index + 1));
    }
  }
  nodes.push({
    id: exit,
    kind: 'exit',
    label: 'Выход',
    title: 'Выход',
    op: null,
    assembly: '',
    sourceLine: null,
    referenceLine: null,
    conditional: false,
    configValue: null,
    phase: 'runtime',
  });
  connect(entry, nextVisible(0));
  return { version: 1, nodes, edges, entry, exit };
}

// SPDX-License-Identifier: GPL-2.0-only
import { parseGenericInstruction, serializeGenericInstruction } from './isa.mjs';
export const MAX_INSTRUCTIONS = 256;
export const MAX_ASSEMBLY_LENGTH = 32768;
const normalize = (line) =>
  line
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ');
const jumpOps = new Map([
  ['jae', 'branch_ge'],
  ['jb', 'branch_lt'],
  ['ja', 'branch_gt'],
  ['jbe', 'branch_le'],
  ['je', 'branch_eq'],
  ['jne', 'branch_ne'],
  ['jmp', 'jump'],
]);
const isJump = (op) => op === 'jump' || op.startsWith('branch_');
const contexts = new WeakMap();
function grammarContext(dialect) {
  if (!dialect || !Array.isArray(dialect.operationDefinitions))
    throw new Error('Нужен диалект ASM с определениями операций.');
  if (!contexts.has(dialect))
    contexts.set(dialect, {
      byOp: new Map(dialect.operationDefinitions.map((d) => [d.op, d])),
      byAssembly: new Map(dialect.operationDefinitions.map((d) => [normalize(d.assembly), d])),
      inputBindings: dialect.inputBindings ?? {},
      sourceLines: dialect.sourceLines ?? new Map(),
      buildSymbol: dialect.buildSymbol ?? 'CONFIG_ENABLED',
    });
  return contexts.get(dialect);
}
function labelNumber(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 64)
    throw new Error(`${name}: ожидается номер метки от 1 до 64.`);
  return value;
}
function instructionAssembly(instruction, dialect) {
  const { byOp, inputBindings } = grammarContext(dialect);
  if (instruction?.op === 'generic') return serializeGenericInstruction(instruction, inputBindings);
  const definition = byOp.get(instruction?.op);
  if (!definition) throw new Error(`Неизвестный блок: ${String(instruction?.op)}.`);
  if (instruction.op === 'label')
    return `${labelNumber(instruction.labelId === undefined ? 1 : instruction.labelId, 'Метка')}:`;
  if (isJump(instruction.op)) {
    const target = labelNumber(instruction.target === undefined ? 1 : instruction.target, 'Переход');
    return `${definition.assembly.split(' ')[0]} ${target}f`;
  }
  return definition.assembly;
}

export function parseAssembly(source, dialect) {
  const { byOp, byAssembly, inputBindings, sourceLines, buildSymbol } = grammarContext(dialect);
  if (typeof source !== 'string' || source.length > MAX_ASSEMBLY_LENGTH)
    throw new Error(`Ожидается ASM-фрагмент длиной до ${MAX_ASSEMBLY_LENGTH} символов.`);
  if (/\/\*(?![\s\S]*\*\/)/.test(source)) throw new Error('Незакрытый комментарий ASM.');
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, (text) => text.replace(/[^\n]/g, ' '));
  const instructions = [];
  let conditional = false;
  let configValue = null;
  let configCount = 0;
  let hasElse = false;
  const labels = new Map();
  for (const [index, raw] of clean.split(/\r?\n/).entries()) {
    const text = normalize(raw.replace(/\/\/.*$/, ''));
    if (!text) continue;
    const labelMatch = text.match(/^([1-9]\d?):$/);
    const jumpMatch = text.match(/^(jae|jb|ja|jbe|je|jne|jmp) ([1-9]\d?)f$/);
    const definition = labelMatch
      ? byOp.get('label')
      : jumpMatch
        ? byOp.get(jumpOps.get(jumpMatch[1]))
        : byAssembly.get(text);
    const generic = definition ? null : parseGenericInstruction(text, inputBindings);
    if (!definition && !generic) throw new Error(`Строка ${index + 1}: неподдерживаемая операция «${text}».`);
    const { op, label } = definition ?? {
      op: 'generic',
      label: `${generic.mnemonic.toUpperCase()} · u${generic.width}`,
    };
    const extra =
      op === 'label'
        ? { labelId: labelNumber(Number(labelMatch[1]), 'Метка') }
        : isJump(op)
          ? { target: labelNumber(Number(jumpMatch[2]), 'Переход') }
          : (generic ?? {});
    if (op === 'config_begin') {
      if (conditional || configCount++) throw new Error(`Допустим один ненестированный ${buildSymbol}.`);
      conditional = true;
      configValue = true;
    }
    if (op === 'config_else') {
      if (!conditional || hasElse) throw new Error(`#else допустим один раз внутри ${buildSymbol}.`);
      hasElse = true;
      configValue = false;
    }
    if (op === 'config_end') {
      if (!conditional) throw new Error(`#endif без ${buildSymbol}.`);
      conditional = false;
      configValue = null;
    }
    if (op === 'label') {
      if (labels.has(extra.labelId)) throw new Error(`Метка ${extra.labelId} должна быть уникальной.`);
      labels.set(extra.labelId, instructions.length);
    }
    instructions.push({
      id: `instruction-${instructions.length}`,
      op,
      label,
      sourceText: instructionAssembly({ op, ...extra }, dialect),
      sourceLine: index + 1,
      referenceLine: extra.labelId > 1 || extra.target > 1 ? null : (sourceLines.get(op) ?? null),
      conditional,
      configValue,
      ...extra,
    });
  }
  if (conditional) throw new Error(`${buildSymbol} не закрыт #endif.`);
  if (!instructions.length || instructions.length > MAX_INSTRUCTIONS)
    throw new Error(`Фрагмент должен содержать от 1 до ${MAX_INSTRUCTIONS} операций.`);
  for (const [index, instruction] of instructions.entries()) {
    if (!isJump(instruction.op)) continue;
    const labelIndex = labels.get(instruction.target);
    if (labelIndex === undefined || labelIndex <= index)
      throw new Error(
        `Переход ${instruction.target}f должен вести на следующую метку ${instruction.target}.`,
      );
    const target = instructions[labelIndex];
    if (target.conditional && (!instruction.conditional || target.configValue !== instruction.configValue)) {
      throw new Error(`Переход ${instruction.target}f не может входить в исключённую ветку ${buildSymbol}.`);
    }
  }
  return { version: 1, instructions };
}

export function serializeAssembly(model, dialect) {
  if (!model || model.version !== 1 || !Array.isArray(model.instructions))
    throw new Error('Неверный формат модели блоков.');
  if (model.instructions.length > MAX_INSTRUCTIONS)
    throw new Error(`Не больше ${MAX_INSTRUCTIONS} операций.`);
  const source =
    model.instructions
      .map((instruction) => {
        const assembly = instructionAssembly(instruction, dialect);
        return instruction.op.startsWith('config_') || instruction.op === 'label'
          ? assembly
          : `\t${assembly}`;
      })
      .join('\n') + '\n';
  parseAssembly(source, dialect);
  return source;
}

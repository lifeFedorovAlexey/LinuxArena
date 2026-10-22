// SPDX-License-Identifier: GPL-2.0-only
import { NUMBER_BLOCKS, BINARY_OPERATIONS, UNARY_OPERATIONS } from './language.mjs';
export const branches = ['branch_ge', 'branch_lt', 'branch_gt', 'branch_le', 'branch_eq', 'branch_ne'];
export const opposite = {
  branch_ge: 'branch_lt',
  branch_lt: 'branch_ge',
  branch_gt: 'branch_le',
  branch_le: 'branch_gt',
  branch_eq: 'branch_ne',
  branch_ne: 'branch_eq',
};
const languageShapes = (adapter) => ({
  arena_entry: {},
  arena_if: {},
  arena_result: {},
  arena_compare: {},
  arena_input: { KEY: adapter.inputs.map((input) => input.key) },
  arena_variable: { VAR: adapter.variables.map((variable) => variable.key) },
  arena_literal: { VALUE: 'text' },
  arena_binary: { OP: BINARY_OPERATIONS, WIDTH: ['32', '64'] },
  arena_unary: { OP: UNARY_OPERATIONS, WIDTH: ['32', '64'] },
  arena_assign: {},
  arena_condition: { OP: branches },
  arena_flag_condition: { OP: branches },
  arena_boolean_input: { KEY: [adapter.buildInput.key], WHEN: ['enabled', 'disabled'] },
});
export const VISUAL_BLOCK_TYPES = Object.freeze([
  'arena_entry',
  'arena_if',
  'arena_result',
  'arena_compare',
  'arena_input',
  'arena_variable',
  'arena_literal',
  'arena_binary',
  'arena_unary',
  'arena_assign',
  'arena_condition',
  'arena_flag_condition',
  'arena_boolean_input',
]);
export const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const runtimePredicateTypes = ['arena_condition', 'arena_flag_condition'];
const predicateTypes = [...runtimePredicateTypes, 'arena_boolean_input', 'arena_relocatable'];

function connection(value, name) {
  if (value === undefined) return null;
  if (!record(value) || Object.keys(value).some((key) => key !== 'block'))
    throw new Error(`${name}: поддерживается только соединение с обычным блоком.`);
  if (value.block === undefined) return null;
  if (!record(value.block)) throw new Error(`${name}: неверный подключённый блок.`);
  return value.block;
}

export function inspectWorkspace(json, mode = 'generic', adapter) {
  if (!record(json) || !record(json.blocks) || !Array.isArray(json.blocks.blocks))
    throw new Error('Неверный формат рабочего поля Blockly.');
  if (json.blocks.languageVersion !== undefined && json.blocks.languageVersion !== 0)
    throw new Error('Неподдерживаемая версия сериализации Blockly.');
  const legacy = mode === true || mode === 'v2';
  const definitions =
    mode === 'generic'
      ? languageShapes(adapter)
      : {
          ...languageShapes(adapter),
          ...adapter.history.fixedShapes,
          ...(legacy ? adapter.history.legacyShapes : {}),
        };
  const blocks = [];
  const stack = json.blocks.blocks.map((block) => ({ block, parent: null }));
  const seen = new Set();
  const ids = new Set();
  while (stack.length) {
    const { block, parent } = stack.pop();
    if (!record(block) || seen.has(block))
      throw new Error('В рабочем поле обнаружен цикл или повторное использование блока.');
    seen.add(block);
    if (seen.size > 1024)
      throw new Error('В первом фрагменте допускается до 1024 блоков вместе с черновиками.');
    if (!Object.hasOwn(definitions, block.type))
      throw new Error(`Неподдерживаемый визуальный блок: ${String(block.type)}.`);
    if (typeof block.id !== 'string' || !block.id || ids.has(block.id))
      throw new Error('У каждого блока должен быть уникальным непустым ID.');
    ids.add(block.id);
    if (
      block.extraState !== undefined &&
      block.extraState !== null &&
      (block.type !== 'arena_if' ||
        !record(block.extraState) ||
        Object.keys(block.extraState).some((key) => key !== 'hasElse') ||
        typeof block.extraState.hasElse !== 'boolean')
    ) {
      throw new Error('Неподдерживаемая форма визуального блока.');
    }
    const fields = block.fields ?? {};
    const expected = definitions[block.type];
    if (!record(fields) || Object.keys(fields).some((key) => !Object.hasOwn(expected, key)))
      throw new Error(`Неизвестное поле у блока ${block.type}.`);
    for (const [field, values] of Object.entries(expected)) {
      if (
        values === 'text'
          ? typeof fields[field] !== 'string' || fields[field].length > 256
          : !values.includes(fields[field])
      )
        throw new Error(`Блок ${block.type}: выберите допустимое значение ${field}.`);
    }
    const inputs = block.inputs ?? {};
    const inputNames =
      block.type === 'arena_config_if'
        ? ['TEST', 'THEN', 'ELSE']
        : block.type === 'arena_if'
          ? legacy
            ? ['TEST']
            : ['TEST', 'THEN', 'ELSE']
          : ['arena_binary', ...(mode === 'generic' ? ['arena_condition', 'arena_compare'] : [])].includes(
                block.type,
              )
            ? ['LEFT', 'RIGHT']
            : block.type === 'arena_assign'
              ? ['TARGET', 'VALUE']
              : block.type === 'arena_unary'
                ? ['VALUE']
                : legacy && block.type === 'arena_config'
                  ? ['DO']
                  : [];
    if (!record(inputs) || Object.keys(inputs).some((key) => !inputNames.includes(key)))
      throw new Error(`Неподдерживаемые входы блока ${block.type}.`);
    const next = connection(block.next, `${block.type}.next`);
    if ([...predicateTypes, ...NUMBER_BLOCKS].includes(block.type) && next)
      throw new Error('У значения или условия не может быть следующей команды.');
    if (block.type === 'arena_result' && next)
      throw new Error('Результат завершает алгоритм; после него нельзя подключить команду.');
    const children = Object.fromEntries(
      inputNames.map((name) => [name, connection(inputs[name], `${block.type}.${name}`)]),
    );
    if (block.type === 'arena_if' && block.extraState?.hasElse === false && children.ELSE)
      throw new Error('В блоке без «иначе» не может быть скрытой подключённой ветки.');
    blocks.push({ block, parent, next, children });
    if (next) stack.push({ block: next, parent: block });
    for (const child of Object.values(children)) if (child) stack.push({ block: child, parent: block });
  }
  const entries = blocks.filter((item) => item.block.type === 'arena_entry');
  if (entries.length !== 1) throw new Error('Нужен ровно один блок начала алгоритма.');
  if (entries[0].parent) throw new Error('Начало алгоритма должно быть отдельным верхним блоком.');
  return { entry: entries[0].block, blocks: new Map(blocks.map((item) => [item.block, item])) };
}

export function requireEnabled(block) {
  if (block.enabled === false || (Array.isArray(block.disabledReasons) && block.disabledReasons.length))
    throw new Error(
      'В подключённом алгоритме есть отключённый блок. Включите его или отсоедините в черновик.',
    );
}

export function validateWorkspaceDraft(json, adapter) {
  inspectWorkspace(json, 'generic', adapter);
}

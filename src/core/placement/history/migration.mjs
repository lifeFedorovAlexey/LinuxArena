// SPDX-License-Identifier: GPL-2.0-only
import { inspectWorkspace, record, requireEnabled } from '../../visual/schema.mjs';
import { fixedShapes, primitiveOperation } from './shapes.mjs';
import { machineExpressions } from '../../visual/import-expressions.mjs';
import { modelToWorkspace } from '../../visual/import.mjs';
/** Add the formerly implicit build predicate only to a v3 draft. Never repair a
 * deliberately empty v4 socket, and never modify the caller's saved snapshot. */
export function migrateConfigPredicates(json, adapter) {
  const original = inspectWorkspace(json, 'v4', adapter);
  let metadata;
  try {
    metadata = JSON.parse(original.entry.data);
  } catch {
    throw new Error('У черновика отсутствует версия визуальной модели.');
  }
  if (metadata?.visualVersion !== 3 && metadata?.visualVersion !== 4)
    throw new Error('Ожидается черновик визуальной модели версии 3 или 4.');
  const copy = JSON.parse(JSON.stringify(json));
  if (metadata.visualVersion === 4) return copy;
  const workspace = inspectWorkspace(copy, 'v4', adapter);
  const ids = new Set([...workspace.blocks.keys()].map((block) => block.id));
  for (const [block, info] of workspace.blocks) {
    if (block.type !== 'arena_config_if' || info.children.TEST) continue;
    const preferred = `condition-${block.id}`;
    let id = preferred;
    let suffix = 1;
    while (ids.has(id)) id = `${preferred}-copy-${suffix++}`;
    ids.add(id);
    block.inputs ??= {};
    block.inputs.TEST = {
      block: {
        type: 'arena_relocatable',
        id,
        fields: { WHEN: 'enabled' },
        ...(block.data ? { data: block.data } : {}),
      },
    };
  }
  workspace.entry.data = JSON.stringify({ ...metadata, visualVersion: 4 });
  inspectWorkspace(copy, 'v4', adapter);
  return copy;
}

/** A structural migration, deliberately independent of compilation. Empty sockets,
 * disabled blocks, detached drafts, layout and existing IDs all survive. */
export function migrateExpressionWorkspace(json, adapter) {
  if (!record(json) || !Array.isArray(json.blocks?.blocks))
    throw new Error('Неверный формат рабочего поля Blockly.');
  const copy = JSON.parse(JSON.stringify(json));
  const entry = copy.blocks.blocks.find((block) => block.type === 'arena_entry');
  let metadata;
  try {
    metadata = JSON.parse(entry?.data);
  } catch {
    throw new Error('У черновика отсутствует версия визуальной модели.');
  }
  if (![4, 5, 6].includes(metadata?.visualVersion))
    throw new Error('Ожидается черновик визуальной модели версии 4, 5 или 6.');
  const blocks = [];
  const ids = new Set();
  const collect = (block) => {
    if (!record(block)) throw new Error('Неверный блок рабочего поля.');
    if (typeof block.id !== 'string' || ids.has(block.id))
      throw new Error('У каждого блока должен быть уникальный ID.');
    ids.add(block.id);
    blocks.push(block);
    if (block.next?.block) collect(block.next.block);
    for (const input of Object.values(block.inputs ?? {})) if (input.block) collect(input.block);
  };
  copy.blocks.blocks.forEach(collect);
  const allocate = (preferred) => {
    let id = preferred;
    let suffix = 1;
    while (ids.has(id)) id = `${preferred}-copy-${suffix++}`;
    ids.add(id);
    return id;
  };
  const comparison = adapter.instructionToGeneric?.({ op: 'compare_minimum' });
  for (const block of blocks) {
    if (block.type === 'arena_config_if') block.type = 'arena_if';
    if (block.type === 'arena_if' && (block.extraState === undefined || block.extraState === null)) {
      block.extraState = { hasElse: Boolean(block.inputs?.ELSE?.block) };
    }
    if (block.type === 'arena_relocatable') {
      block.type = 'arena_boolean_input';
      block.fields = { ...block.fields, KEY: adapter.buildInput.key };
    }
    if (block.type === 'arena_assign' && Object.hasOwn(block.fields ?? {}, 'VAR')) {
      block.inputs ??= {};
      if (!Object.hasOwn(block.inputs, 'TARGET'))
        block.inputs.TARGET = {
          block: {
            type: 'arena_variable',
            id: allocate(`${block.id}-target`),
            fields: { VAR: block.fields.VAR },
          },
        };
      delete block.fields.VAR;
      if (!Object.keys(block.fields).length) delete block.fields;
    }
    const primitive =
      metadata.visualVersion !== 4 ||
      (block.type === 'arena_compare' &&
        (Object.hasOwn(block.inputs ?? {}, 'LEFT') || Object.hasOwn(block.inputs ?? {}, 'RIGHT')))
        ? null
        : primitiveOperation(block);
    if (primitive) {
      const machine = adapter.instructionToGeneric?.({ op: primitive });
      if (!machine) throw new Error(`Нет привязки старой операции ${primitive}.`);
      const converted = machineExpressions(adapter, allocate, block.data).statement(machine, block.id);
      const preserved = { ...block };
      delete preserved.type;
      delete preserved.fields;
      delete preserved.inputs;
      Object.keys(block).forEach((key) => delete block[key]);
      Object.assign(block, preserved, converted);
    } else if (
      metadata.visualVersion === 4 &&
      block.type === 'arena_condition' &&
      !Object.hasOwn(block.inputs ?? {}, 'LEFT') &&
      !Object.hasOwn(block.inputs ?? {}, 'RIGHT')
    ) {
      if (!comparison) throw new Error('Не задана привязка исходного сравнения.');
      block.inputs = machineExpressions(adapter, allocate, block.data).compareInputs(comparison, block.id);
    }
  }
  entry.data = JSON.stringify({ ...metadata, visualVersion: 6, adapter: adapter.id });
  return copy;
}

/** Migrate an explicitly identified v2 draft through its validated old semantics. */
export function migrateLegacyWorkspace(json, adapter) {
  const { parseAssembly, serializeAssembly } = adapter.machine;
  const workspace = inspectWorkspace(json, true, adapter);
  const operations = [];
  let finishCount = 0;
  let configCount = 0;
  const emit = (op) => operations.push({ op });
  const visit = (first, inConfiguration = false) => {
    for (let block = first; block; block = workspace.blocks.get(block).next) {
      requireEnabled(block);
      const primitive = primitiveOperation(block);
      if (primitive) {
        emit(primitive);
        continue;
      }
      const { children } = workspace.blocks.get(block);
      switch (block.type) {
        case 'arena_entry':
          break;
        case 'arena_config':
          if (inConfiguration || ++configCount > 1)
            throw new Error('Старый черновик содержит неподдерживаемые настройки сборки.');
          emit('config_begin');
          visit(children.DO, true);
          emit('config_end');
          break;
        case 'arena_branch':
          emit(block.fields.OP);
          break;
        case 'arena_if':
          if (children.TEST?.type !== 'arena_condition')
            throw new Error('Вставь условие в пустое гнездо блока «если».');
          requireEnabled(children.TEST);
          emit('compare_minimum');
          emit(children.TEST.fields.OP);
          break;
        case 'arena_finish':
          if (inConfiguration || ++finishCount > 1)
            throw new Error('В старом черновике нарушена точка завершения.');
          emit('label');
          break;
        default:
          throw new Error(`Неподдерживаемый блок старого черновика: ${block.type}.`);
      }
    }
  };
  visit(workspace.entry);
  if (finishCount !== 1) throw new Error('В старом черновике отсутствует точка завершения.');
  const migrated = modelToWorkspace(
    parseAssembly(serializeAssembly({ version: 1, instructions: operations })),
    adapter,
  );
  // The caller retains the untouched v2 snapshot, including unsupported detached drafts.
  const ids = new Set();
  const collect = (block) => {
    if (!block) return;
    ids.add(block.id);
    collect(block.next?.block);
    for (const input of Object.values(block.inputs ?? {})) collect(input.block);
  };
  migrated.blocks.blocks.forEach(collect);
  const copyDraft = (block) => {
    if (
      !Object.hasOwn(fixedShapes, block.type) ||
      block.type === 'arena_if' ||
      block.type === 'arena_config_if'
    )
      return null;
    const copy = JSON.parse(JSON.stringify(block));
    let id = copy.id;
    while (ids.has(id)) id += '-draft';
    ids.add(id);
    copy.id = id;
    if (copy.next?.block) {
      const next = copyDraft(copy.next.block);
      if (!next) return null;
      copy.next.block = next;
    }
    return copy;
  };
  for (const block of json.blocks.blocks) {
    if (block === workspace.entry) continue;
    const copy = copyDraft(block);
    if (copy) migrated.blocks.blocks.push(copy);
  }
  const entryMetadata = JSON.parse(migrated.blocks.blocks[0].data);
  migrated.blocks.blocks[0].data = JSON.stringify({ ...entryMetadata, visualVersion: 4 });
  return migrateExpressionWorkspace(migrated, adapter);
}

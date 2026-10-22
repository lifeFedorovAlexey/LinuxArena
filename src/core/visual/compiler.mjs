// SPDX-License-Identifier: GPL-2.0-only
import { inspectWorkspace, requireEnabled, runtimePredicateTypes, opposite } from './schema.mjs';
import { expressionCompiler } from './expressions.mjs';
export function compileWorkspace(json, adapter) {
  const { parseAssembly, serializeAssembly, inferProgramEffects } = adapter.machine;
  const workspace = inspectWorkspace(json, 'generic', adapter);
  const operations = [];
  const owners = [];
  const conditionOwners = [];
  let resultCount = 0;
  let configurationCount = 0;
  let nextLabel = 1;
  const emit = (op, block, extra = {}) => {
    operations.push({ op, ...extra });
    owners.push(block.id);
  };
  const expressions = expressionCompiler(workspace, adapter, emit);
  const emitPredicate = (block, predicate, target, negated) => {
    if (predicate.type === 'arena_condition') {
      const { children } = workspace.blocks.get(predicate);
      expressions.compare(block, children.LEFT, children.RIGHT);
    }
    conditionOwners.push({ index: operations.length, blockId: block.id, predicateId: predicate.id, negated });
    emit(negated ? opposite[predicate.fields.OP] : predicate.fields.OP, block, { target });
  };
  const visitChain = (first, nested = false, inConfiguration = false) => {
    for (let block = first; block; block = workspace.blocks.get(block).next) {
      requireEnabled(block);
      const { children } = workspace.blocks.get(block);
      switch (block.type) {
        case 'arena_entry':
          break;
        case 'arena_assign':
          expressions.assign(block, children.TARGET, children.VALUE);
          break;
        case 'arena_compare':
          expressions.compare(block, children.LEFT, children.RIGHT);
          break;
        case 'arena_if': {
          const predicate = children.TEST;
          if (!predicate || ![...runtimePredicateTypes, 'arena_boolean_input'].includes(predicate.type))
            throw new Error('Вставь условие в пустое гнездо блока «если».');
          requireEnabled(predicate);
          if (predicate.type === 'arena_boolean_input') {
            if ((adapter.buildInput.phase ?? 'build') !== 'build')
              throw new Error('Для этого логического входа не задана поддерживаемая фаза вычисления.');
            if (inConfiguration)
              throw new Error('Вложенные настройки сборки в первом фрагменте не поддерживаются.');
            if (++configurationCount > 1)
              throw new Error('Первый фрагмент поддерживает одно условие сборки.');
            const enabled = predicate.fields.WHEN === 'enabled';
            emit('config_begin', block);
            visitChain(enabled ? children.THEN : children.ELSE, true, true);
            emit('config_else', block);
            visitChain(enabled ? children.ELSE : children.THEN, true, true);
            emit('config_end', block);
            break;
          }
          const endLabel = nextLabel++;
          if (!children.THEN) {
            emitPredicate(block, predicate, endLabel, false);
            visitChain(children.ELSE, true, inConfiguration);
          } else {
            // Emit ELSE first so the displayed predicate stays the actual branch
            // predicate when generated code is later imported without UI metadata.
            const thenLabel = nextLabel++;
            emitPredicate(block, predicate, thenLabel, false);
            visitChain(children.ELSE, true, inConfiguration);
            emit('jump', block, { target: endLabel });
            emit('label', block, { labelId: thenLabel });
            visitChain(children.THEN, true, inConfiguration);
          }
          emit('label', block, { labelId: endLabel });
          break;
        }
        case 'arena_condition':
        case 'arena_flag_condition':
        case 'arena_boolean_input':
          throw new Error('Условие вставляется в блок «если», а не в цепь команд.');
        case 'arena_input':
        case 'arena_variable':
        case 'arena_literal':
        case 'arena_binary':
        case 'arena_unary':
          throw new Error('Число или выражение вставляется в числовое гнездо, а не в цепь команд.');
        case 'arena_result':
          if (nested) throw new Error('Результат должен завершать основной алгоритм, а не отдельную ветку.');
          if (++resultCount > 1) throw new Error('Нужен один подключённый результат алгоритма.');
          break;
        default:
          throw new Error(`Неподдерживаемый визуальный блок: ${block.type}.`);
      }
    }
  };
  visitChain(workspace.entry);
  if (resultCount !== 1) throw new Error('Подключите результат к концу основного алгоритма.');
  const assembly = serializeAssembly({ version: 1, instructions: operations });
  const model = parseAssembly(assembly);
  const instructionBlocks = Object.fromEntries(
    model.instructions.map((instruction, index) => [instruction.id, owners[index]]),
  );
  const instructionConditions = Object.fromEntries(
    conditionOwners.map(({ index, ...condition }) => [model.instructions[index].id, condition]),
  );
  return { assembly, instructionBlocks, instructionConditions, targetEffects: inferProgramEffects(model) };
}

export function workspaceToAssembly(json, adapter) {
  return compileWorkspace(json, adapter).assembly;
}
export function workspaceInstructionMap(json, adapter) {
  return compileWorkspace(json, adapter).instructionBlocks;
}

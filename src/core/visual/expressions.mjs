// SPDX-License-Identifier: GPL-2.0-only
import { NUMBER_BLOCKS } from './language.mjs';
import { requireEnabled } from './schema.mjs';
const reg = (name) => ({ kind: 'register', name });
const immediate = (value) => ({ kind: 'immediate', value: value.toString() });
const U64 = (1n << 64n) - 1n;
function literalValue(block) {
  const text = block.fields.VALUE.trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text))
    throw new Error('Введите точное целое число: десятичное или 0x…');
  const value = BigInt(text);
  if (value > U64) throw new Error('Число выходит за пределы 64 бит.');
  return value;
}

export function expressionCompiler(workspace, adapter, emit) {
  const variables = new Map(adapter.variables.map((variable) => [variable.key, variable]));
  const inputs = new Map(adapter.inputs.map((input) => [input.key, input]));
  const reserved = new Set();
  const visit = (block) => {
    if (!block) return;
    const info = workspace.blocks.get(block);
    if (block.type === 'arena_variable') reserved.add(variables.get(block.fields.VAR).register);
    for (const child of Object.values(info.children)) visit(child);
    visit(info.next);
  };
  visit(workspace.entry);
  const available = Array.from({ length: 8 }, (_, index) => `r${index + 8}`).filter(
    (name) => !reserved.has(name),
  );
  const occupied = new Set();
  const allocate = () => {
    const name = available.find((candidate) => !occupied.has(candidate));
    if (!name)
      throw new Error(
        'Для этого вложенного выражения не хватает временных регистров. Разбей вычисление на несколько присваиваний.',
      );
    occupied.add(name);
    return name;
  };
  const release = (name) => occupied.delete(name);
  const machine = (mnemonic, width, operands, owner) => emit('generic', owner, { mnemonic, width, operands });
  const requireNumber = (block) => {
    if (!block || !NUMBER_BLOCKS.includes(block.type))
      throw new Error('Вставь число или выражение в пустое числовое гнездо.');
    requireEnabled(block);
    return block;
  };
  const reads = (block, name) => {
    if (!block) return false;
    if (block.type === 'arena_variable') return variables.get(block.fields.VAR).register === name;
    return Object.values(workspace.blocks.get(block).children).some((child) => reads(child, name));
  };
  const operand = (expression, width, owner) => {
    const block = requireNumber(expression);
    if (block.type === 'arena_variable')
      return { value: reg(variables.get(block.fields.VAR).register), temporary: null };
    if (block.type === 'arena_literal') {
      const value = BigInt.asUintN(width, literalValue(block));
      if (width === 32 || value <= 0x7fffffffn || value >= 0xffffffff80000000n)
        return { value: immediate(value), temporary: null };
    }
    const temporary = allocate();
    into(block, temporary, owner);
    return { value: reg(temporary), temporary };
  };
  const into = (expression, target, owner, consumedByParent = false) => {
    const block = requireNumber(expression);
    const { fields } = block;
    const children = workspace.blocks.get(block).children;
    if (block.type === 'arena_literal') {
      machine('mov', 64, [immediate(literalValue(block)), reg(target)], owner);
    } else if (block.type === 'arena_input') {
      const input = inputs.get(fields.KEY);
      machine(
        input.binding.mnemonic,
        input.width,
        [{ kind: 'input', name: input.binding.name }, reg(target)],
        owner,
      );
    } else if (block.type === 'arena_variable') {
      const source = variables.get(fields.VAR).register;
      if (source !== target || !consumedByParent) machine('mov', 64, [reg(source), reg(target)], owner);
    } else if (block.type === 'arena_unary') {
      into(children.VALUE, target, owner, true);
      const width = Number(fields.WIDTH);
      if (fields.OP === 'cast') machine('mov', width, [reg(target), reg(target)], owner);
      else machine(fields.OP, width, [reg(target)], owner);
    } else if (block.type === 'arena_binary') {
      const left = requireNumber(children.LEFT);
      const right = requireNumber(children.RIGHT);
      const leftIsTarget =
        left.type === 'arena_variable' && variables.get(left.fields.VAR).register === target;
      let value;
      // Evaluate a RHS which still needs the old destination before overwriting it.
      if (reads(right, target) && !leftIsTarget) {
        const temporary = allocate();
        into(right, temporary, owner);
        value = { value: reg(temporary), temporary };
        into(left, target, owner, true);
      } else {
        into(left, target, owner, true);
        value = operand(right, Number(fields.WIDTH), owner);
      }
      machine(fields.OP, Number(fields.WIDTH), [value.value, reg(target)], owner);
      if (value.temporary) release(value.temporary);
    }
  };
  const compare = (owner, leftExpression, rightExpression) => {
    const left = requireNumber(leftExpression);
    const right = requireNumber(rightExpression);
    const direct = adapter.directComparison;
    if (
      direct &&
      left.type === 'arena_variable' &&
      left.fields.VAR === direct.variable &&
      right.type === 'arena_input' &&
      right.fields.KEY === direct.input
    ) {
      emit(direct.instruction.op, owner, direct.instruction);
      return;
    }
    let leftRegister;
    let leftTemporary = null;
    if (left.type === 'arena_variable') leftRegister = variables.get(left.fields.VAR).register;
    else {
      leftTemporary = allocate();
      leftRegister = leftTemporary;
      into(left, leftRegister, owner);
    }
    const rightOperand = operand(right, 64, owner);
    machine('cmp', 64, [rightOperand.value, reg(leftRegister)], owner);
    if (leftTemporary) release(leftTemporary);
    if (rightOperand.temporary) release(rightOperand.temporary);
  };
  return {
    assign: (block, target, expression) => {
      if (target?.type !== 'arena_variable')
        throw new Error('Вставь переменную в левое гнездо присваивания.');
      requireEnabled(target);
      into(expression, variables.get(target.fields.VAR).register, block);
    },
    compare,
  };
}

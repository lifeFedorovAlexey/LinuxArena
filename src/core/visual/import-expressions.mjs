// SPDX-License-Identifier: GPL-2.0-only
export function machineExpressions(adapter, allocate, data) {
  const variable = (name, preferred) => {
    const binding = adapter.variables.find((item) => item.register === name);
    if (!binding) throw new Error(`Для регистра ${name} не задана переменная алгоритма.`);
    return {
      type: 'arena_variable',
      id: allocate(preferred),
      fields: { VAR: binding.key },
      ...(data ? { data } : {}),
    };
  };
  const unary = (op, width, value, preferred) => ({
    type: 'arena_unary',
    id: allocate(preferred),
    fields: { OP: op, WIDTH: String(width) },
    inputs: { VALUE: { block: value } },
  });
  const operand = (source, preferred, width = 64) => {
    let expression;
    let sourceWidth = 64;
    if (source.kind === 'register') expression = variable(source.name, `${preferred}-value`);
    else if (source.kind === 'immediate') {
      expression = {
        type: 'arena_literal',
        id: allocate(`${preferred}-value`),
        fields: { VALUE: source.value },
      };
      sourceWidth = BigInt(source.value) <= 0xffffffffn ? 32 : 64;
    } else if (source.kind === 'input') {
      const binding = adapter.inputs.find((item) => item.binding.name === source.name);
      if (!binding) throw new Error(`Для входа ${source.name} не задан визуальный источник.`);
      expression = { type: 'arena_input', id: allocate(`${preferred}-value`), fields: { KEY: binding.key } };
      sourceWidth = binding.width;
    } else throw new Error('Неподдерживаемый источник выражения.');
    return width === 32 && sourceWidth !== 32
      ? unary('cast', 32, expression, `${preferred}-cast`)
      : expression;
  };
  const compareInputs = (instruction, preferred) => ({
    LEFT: { block: operand(instruction.operands[1], `${preferred}-left`, instruction.width) },
    RIGHT: { block: operand(instruction.operands[0], `${preferred}-right`, instruction.width) },
  });
  const statement = (instruction, id) => {
    const { mnemonic, width, operands } = instruction;
    if (mnemonic === 'cmp')
      return { type: 'arena_compare', id, ...(data ? { data } : {}), inputs: compareInputs(instruction, id) };
    const destination = operands.at(-1).name;
    const binding = adapter.variables.find((item) => item.register === destination);
    if (!binding) throw new Error(`Для регистра ${destination} не задана переменная алгоритма.`);
    let expression;
    if (mnemonic === 'mov' || mnemonic === 'lea') expression = operand(operands[0], id, width);
    else if (['not', 'inc', 'dec'].includes(mnemonic))
      expression = unary(mnemonic, width, variable(destination, `${id}-operand`), `${id}-expression`);
    else
      expression = {
        type: 'arena_binary',
        id: allocate(`${id}-expression`),
        fields: { OP: mnemonic === 'andn' ? 'and' : mnemonic, WIDTH: String(width) },
        inputs: {
          LEFT: {
            block:
              mnemonic === 'andn'
                ? unary('not', width, operand(operands[1], `${id}-source`), `${id}-not`)
                : variable(destination, `${id}-left`),
          },
          RIGHT: { block: operand(operands[0], `${id}-right`) },
        },
      };
    return {
      type: 'arena_assign',
      id,
      ...(data ? { data } : {}),
      inputs: {
        TARGET: { block: variable(destination, `${id}-target`) },
        VALUE: { block: expression },
      },
    };
  };
  return { operand, compareInputs, statement };
}

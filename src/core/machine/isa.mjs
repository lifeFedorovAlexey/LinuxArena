// SPDX-License-Identifier: GPL-2.0-only
// A bounded AT&T register ISA. Symbol names and their values belong to the host adapter.
export const ISA_REGISTERS = Object.freeze([
  'rax',
  'rbp',
  'r8',
  'r9',
  'r10',
  'r11',
  'r12',
  'r13',
  'r14',
  'r15',
]);
const registerSet = new Set(ISA_REGISTERS);
const names32 = new Map(
  ISA_REGISTERS.map((name) => [name, name === 'rax' ? 'eax' : name === 'rbp' ? 'ebp' : `${name}d`]),
);
const aliases = new Map(
  ISA_REGISTERS.flatMap((name) => [
    [name, { name, width: 64 }],
    [names32.get(name), { name, width: 32 }],
  ]),
);
const mnemonics = new Set(['mov', 'lea', 'add', 'sub', 'and', 'or', 'xor', 'not', 'cmp', 'inc', 'dec']);
const unary = new Set(['not', 'inc', 'dec']);
const arithmetic = new Set(['add', 'sub', 'and', 'or', 'xor', 'cmp']);
const U64 = (1n << 64n) - 1n;

function exactUnsigned(value) {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-f]+|0|[1-9][0-9]*)$/i.test(value))
    throw new Error(
      'Константа должна быть точной беззнаковой десятичной или hex-строкой; ведущие нули в decimal запрещены.',
    );
  const number = BigInt(value);
  if (number > U64) throw new Error('Константа выходит за u64.');
  return number;
}

function validateImmediate(number, width, mnemonic) {
  if (number < 0n || number >= 1n << BigInt(width)) throw new Error(`Константа не помещается в u${width}.`);
  if (width === 64 && arithmetic.has(mnemonic) && number > 0x7fffffffn && number < 0xffffffff80000000n) {
    throw new Error(
      'Для этой операции u64-константу сначала нужно загрузить в регистр: immediate должен быть sign-extended imm32.',
    );
  }
}

function validateOperand(operand, bindings) {
  if (operand?.kind === 'register' && registerSet.has(operand.name))
    return { kind: 'register', name: operand.name };
  if (operand?.kind === 'immediate') {
    exactUnsigned(operand.value);
    return { kind: 'immediate', value: operand.value.toLowerCase() };
  }
  if (operand?.kind === 'input' && Object.hasOwn(bindings, operand.name))
    return { kind: 'input', name: operand.name };
  throw new Error('Неподдерживаемый регистр или операнд ограниченной ASM-модели.');
}

export function validateGenericInstruction(instruction, bindings = {}) {
  if (
    instruction?.op !== 'generic' ||
    !mnemonics.has(instruction.mnemonic) ||
    ![32, 64].includes(instruction.width)
  ) {
    throw new Error('Неверная операция или разрядность ограниченной ASM-модели.');
  }
  const { mnemonic, width } = instruction;
  if (!Array.isArray(instruction.operands) || instruction.operands.length !== (unary.has(mnemonic) ? 1 : 2))
    throw new Error('Неверное число операндов ASM.');
  const operands = instruction.operands.map((operand) => validateOperand(operand, bindings));
  if (operands.at(-1).kind !== 'register')
    throw new Error('Назначение ASM должно быть поддержанным регистром.');
  if (!unary.has(mnemonic)) {
    const source = operands[0];
    if (mnemonic === 'lea') {
      if (width !== 64 || source.kind !== 'input' || bindings[source.name].form !== 'address')
        throw new Error('LEA поддерживает только объявленный источник адреса u64.');
    } else if (source.kind === 'input') {
      const binding = bindings[source.name];
      if (binding.form === 'address' || (binding.width !== undefined && binding.width !== width))
        throw new Error('Разрядность или операция не подходит источнику входа.');
    } else if (source.kind === 'immediate') validateImmediate(exactUnsigned(source.value), width, mnemonic);
  }
  return { op: 'generic', mnemonic, width, operands };
}

export function serializeGenericInstruction(instruction, bindings = {}) {
  const valid = validateGenericInstruction(instruction, bindings);
  const operands = valid.operands.map((operand) => {
    if (operand.kind === 'register')
      return `%${valid.width === 32 ? names32.get(operand.name) : operand.name}`;
    if (operand.kind === 'immediate') return `$${operand.value}`;
    return bindings[operand.name].syntax;
  });
  return `${valid.mnemonic}${valid.width === 32 ? 'l' : 'q'} ${operands.join(', ')}`;
}

export function parseGenericInstruction(source, bindings = {}) {
  const match = source.match(/^(movabsq|(?:mov|lea|add|sub|and|or|xor|not|cmp|inc|dec)[lq])\s+(.+)$/);
  if (!match) return null;
  const mnemonic = match[1] === 'movabsq' ? 'mov' : match[1].slice(0, -1);
  const width = match[1].endsWith('l') ? 32 : 64;
  const operands = match[2].split(',').map((part) => {
    const text = part.trim();
    if (text.startsWith('%')) {
      const register = aliases.get(text.slice(1));
      if (!register || register.width !== width)
        throw new Error(`Неподдерживаемый регистр или разрядность: ${text}.`);
      return { kind: 'register', name: register.name };
    }
    const binding = Object.entries(bindings).find(([, value]) => value.syntax === text);
    if (binding) return { kind: 'input', name: binding[0] };
    if (text.startsWith('$')) return { kind: 'immediate', value: text.slice(1) };
    throw new Error(`Неподдерживаемый источник или память: ${text}.`);
  });
  if (
    match[1] === 'movabsq' &&
    operands[0]?.kind !== 'immediate' &&
    !(operands[0]?.kind === 'input' && bindings[operands[0].name].form === 'immediate')
  ) {
    throw new Error('MOVABS поддерживает только непосредственную константу в регистр.');
  }
  return validateGenericInstruction({ op: 'generic', mnemonic, width, operands }, bindings);
}

/** machine.registers contains canonical u64 register values; null/absent means uninitialized. */
export function executeGenericInstruction(instruction, machine, inputValues, bindings = {}) {
  const { mnemonic, width, operands } = validateGenericInstruction(instruction, bindings);
  const mask = (1n << BigInt(width)) - 1n;
  const read = (operand) => {
    if (operand.kind === 'immediate') return exactUnsigned(operand.value);
    if (operand.kind === 'input') {
      const value = inputValues[operand.name];
      if (typeof value !== 'bigint' || value < 0n || value > U64)
        throw new Error(`Вход ${operand.name} не задан как u64.`);
      if (bindings[operand.name].form === 'immediate') validateImmediate(value, width, mnemonic);
      return value & mask;
    }
    const value = machine.registers[operand.name];
    if (value === null || value === undefined)
      throw new Error(`Чтение %${operand.name} до присвоения значения.`);
    return value & mask;
  };
  const destination = operands.at(-1).name;
  const write = (value) => {
    // Every 32-bit write zero-extends to the full 64-bit architectural register.
    machine.registers[destination] = BigInt.asUintN(width, value);
    machine.clobbers?.add(destination);
  };
  if (mnemonic === 'mov' || mnemonic === 'lea') {
    write(read(operands[0]));
    return;
  }
  const left = read(operands.at(-1));
  if (mnemonic === 'not') {
    write(~left);
    return;
  }
  if (mnemonic === 'inc' || mnemonic === 'dec') {
    const result = BigInt.asUintN(width, left + (mnemonic === 'inc' ? 1n : -1n));
    write(result);
    machine.zero = result === 0n;
    return; // INC and DEC preserve carry.
  }
  const right = read(operands[0]);
  let result;
  if (mnemonic === 'add') {
    result = left + right;
    machine.carry = result > mask;
  } else if (mnemonic === 'sub' || mnemonic === 'cmp') {
    result = left - right;
    machine.carry = left < right;
  } else {
    result = mnemonic === 'and' ? left & right : mnemonic === 'or' ? left | right : left ^ right;
    machine.carry = false;
  }
  result = BigInt.asUintN(width, result);
  machine.zero = result === 0n;
  if (mnemonic !== 'cmp') write(result);
}

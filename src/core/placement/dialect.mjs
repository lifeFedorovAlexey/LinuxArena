// SPDX-License-Identifier: GPL-2.0-only
export const LINUX_INPUT_BINDINGS = Object.freeze({
  loadAddress: Object.freeze({ syntax: 'startup_32(%rip)', form: 'address', width: 64 }),
  alignment: Object.freeze({ syntax: 'BP_kernel_alignment(%rsi)', form: 'memory', width: 32 }),
  minimumAddress: Object.freeze({ syntax: '$LOAD_PHYSICAL_ADDR', form: 'immediate' }),
});

const definitions = [
  ['config_begin', '#ifdef CONFIG_RELOCATABLE', 'Перемещение разрешено'],
  ['config_else', '#else', 'Без перемещения'],
  ['config_end', '#endif', 'Конец условия сборки'],
  ['load_base', 'leaq startup_32(%rip), %rbp', 'Взять адрес загрузки'],
  ['load_alignment', 'movl BP_kernel_alignment(%rsi), %eax', 'Взять выравнивание'],
  ['decrement32', 'decl %eax', 'Вычесть единицу'],
  ['increment32', 'incl %eax', 'Прибавить единицу'],
  ['add64', 'addq %rax, %rbp', 'Прибавить маску'],
  ['subtract64', 'subq %rax, %rbp', 'Вычесть маску'],
  ['invert64', 'notq %rax', 'Инвертировать маску'],
  ['and64', 'andq %rax, %rbp', 'Применить маску'],
  ['or64', 'orq %rax, %rbp', 'Объединить биты'],
  ['xor64', 'xorq %rax, %rbp', 'Исключающее ИЛИ'],
  ['compare_minimum', 'cmpq $LOAD_PHYSICAL_ADDR, %rbp', 'Сравнить с границей'],
  ['branch_ge', 'jae 1f', 'Не ниже границы'],
  ['branch_lt', 'jb 1f', 'Ниже границы'],
  ['branch_gt', 'ja 1f', 'Выше границы'],
  ['branch_le', 'jbe 1f', 'Не выше границы'],
  ['branch_eq', 'je 1f', 'Равно границе'],
  ['branch_ne', 'jne 1f', 'Не равно границе'],
  ['jump', 'jmp 1f', 'Перейти дальше'],
  ['load_minimum', 'movq $LOAD_PHYSICAL_ADDR, %rbp', 'Взять нижнюю границу'],
  ['label', '1:', 'Адрес готов'],
];

export const OPERATION_DEFINITIONS = Object.freeze(
  definitions.map(([op, assembly, label]) => ({ op, assembly, label })),
);
export const sourceLines = new Map([
  ['config_begin', 315],
  ['load_base', 316],
  ['load_alignment', 317],
  ['decrement32', 318],
  ['add64', 319],
  ['invert64', 320],
  ['and64', 321],
  ['compare_minimum', 322],
  ['branch_ge', 323],
  ['config_end', 324],
  ['load_minimum', 325],
  ['label', 326],
]);
export const legacyWrites = new Map([
  ...['load_alignment', 'decrement32', 'increment32', 'invert64'].map((op) => [op, 'rax']),
  ...['load_base', 'add64', 'subtract64', 'and64', 'or64', 'xor64', 'load_minimum'].map((op) => [op, 'rbp']),
]);

export const PLACEMENT_DIALECT = Object.freeze({
  operationDefinitions: OPERATION_DEFINITIONS,
  inputBindings: LINUX_INPUT_BINDINGS,
  sourceLines,
  registerWrites: legacyWrites,
  publicRegisters: ['rax', 'rbp'],
  buildSymbol: 'CONFIG_RELOCATABLE',
});

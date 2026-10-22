// SPDX-License-Identifier: GPL-2.0-only
export const SOURCE = Object.freeze({
  version: '6.18.58',
  ref: 'v6.18.58',
  path: 'arch/x86/boot/compressed/head_64.S',
  url: 'https://github.com/gregkh/linux/blob/v6.18.58/arch/x86/boot/compressed/head_64.S',
  entryLine: 278,
  firstLine: 315,
  lastLine: 326,
});

export const REFERENCE_ASM = `#ifdef CONFIG_RELOCATABLE
\tleaq\tstartup_32(%rip) /* - $startup_32 */, %rbp
\tmovl\tBP_kernel_alignment(%rsi), %eax
\tdecl\t%eax
\taddq\t%rax, %rbp
\tnotq\t%rax
\tandq\t%rax, %rbp
\tcmpq\t$LOAD_PHYSICAL_ADDR, %rbp
\tjae\t1f
#endif
\tmovq\t$LOAD_PHYSICAL_ADDR, %rbp
1:
`;

export const DEFAULT_INPUTS = Object.freeze({
  loadAddress: '0x1100000',
  alignment: '0x200000',
  minimumAddress: '0x1000000',
  relocatable: true,
});

export const CONTRACT = Object.freeze({
  id: 'decompression-address',
  title: 'Адрес распаковки',
  inputs: [
    {
      key: 'loadAddress',
      name: 'Адрес загрузки',
      type: 'u64',
      register: 'startup_32',
      default: DEFAULT_INPUTS.loadAddress,
    },
    {
      key: 'alignment',
      name: 'Выравнивание',
      type: 'u32',
      register: 'boot_params.kernel_alignment',
      default: DEFAULT_INPUTS.alignment,
    },
    {
      key: 'minimumAddress',
      name: 'Нижняя граница',
      type: 'u64',
      register: 'LOAD_PHYSICAL_ADDR',
      default: DEFAULT_INPUTS.minimumAddress,
    },
    {
      key: 'relocatable',
      name: 'Перемещение ядра',
      type: 'bool',
      register: 'CONFIG_RELOCATABLE',
      default: true,
    },
  ],
  output: { key: 'output', name: 'Адрес распаковки', type: 'u64', register: '%rbp' },
  effects: ['%rax, %rbp и арифметические флаги', 'Чтение boot_params.kernel_alignment; без записи в память'],
  preconditions: [
    '64-битный протокол загрузки; ранние регистры уже подготовлены',
    'Для штатного x86-64: выравнивание — степень двойки, не меньше 2 МиБ',
    'LOAD_PHYSICAL_ADDR получен из конфигурации сборки',
  ],
  limits: [
    'Не проверяет пригодность физической памяти, таблицы страниц или загрузку ядра',
    'u64 wrap и нештатные входы доступны только как арифметические граничные проверки',
    'Это предварительный адрес; дальнейшая распаковка и KASLR находятся за границей блока',
  ],
  source: SOURCE,
});

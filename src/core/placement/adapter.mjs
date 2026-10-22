// SPDX-License-Identifier: GPL-2.0-only
import { fixedShapes, legacyShapes } from './history/shapes.mjs';
import * as machine from './model.mjs';
import { placementInstruction } from './instructions.mjs';
// Linux-specific names and machine bindings for the otherwise generic visual language.
export const PLACEMENT_ADAPTER = Object.freeze({
  id: 'linux-decompression-address',
  machine,
  history: { fixedShapes, legacyShapes },
  entryTitle: 'Выбрать адрес распаковки',
  resultLabel: 'Адрес распаковки готов',
  buildInput: { key: 'relocatable', label: 'перемещение ядра', phase: 'build' },
  directComparison: { variable: 'address', input: 'minimumAddress', instruction: { op: 'compare_minimum' } },
  instructionToGeneric: placementInstruction,
  inputs: [
    {
      key: 'loadAddress',
      label: 'адрес загрузки',
      width: 64,
      binding: { name: 'loadAddress', mnemonic: 'lea' },
    },
    { key: 'alignment', label: 'шаг', width: 32, binding: { name: 'alignment', mnemonic: 'mov' } },
    {
      key: 'minimumAddress',
      label: 'нижняя граница',
      width: 64,
      binding: { name: 'minimumAddress', mnemonic: 'mov' },
    },
  ],
  variables: [
    { key: 'address', label: 'адрес', register: 'rbp' },
    { key: 'work', label: 'маска', register: 'rax' },
    ...Array.from({ length: 8 }, (_, index) => ({
      key: `r${index + 8}`,
      label: `r${index + 8}`,
      register: `r${index + 8}`,
      temporary: true,
    })),
  ],
});

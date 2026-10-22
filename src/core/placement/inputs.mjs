// SPDX-License-Identifier: GPL-2.0-only
import { DEFAULT_INPUTS } from './reference.mjs';
import { integer, U64, wrap64, hex } from '../machine/numbers.mjs';
export function validateInputs(inputs = {}) {
  const merged = { ...DEFAULT_INPUTS, ...inputs };
  if (typeof merged.relocatable !== 'boolean') throw new Error('relocatable: ожидается true или false.');
  const load = integer(merged.loadAddress, 64, 'Адрес загрузки');
  const alignment = integer(merged.alignment, 32, 'Выравнивание');
  const minimum = integer(merged.minimumAddress, 64, 'Нижняя граница');
  const warnings = [];
  if (merged.relocatable && (alignment < 0x200000n || (alignment & (alignment - 1n)) !== 0n))
    warnings.push('Нештатное выравнивание: арифметика проверяется, пригодность загрузки не подтверждена.');
  if (merged.relocatable && load + BigInt.asUintN(32, alignment - 1n) > U64)
    warnings.push('Переполнение u64: показана машинная арифметика, не допустимая физическая загрузка.');
  if (minimum > 0x7fffffffn)
    warnings.push(
      'Нижняя граница выходит за положительный imm32 исходного cmpq; это только обобщённая модель.',
    );
  return { load, alignment, minimum, relocatable: merged.relocatable, warnings };
}

export function referenceResult(inputs = {}) {
  const { load, alignment, minimum, relocatable } = validateInputs(inputs);
  if (!relocatable) return hex(minimum);
  const mask = BigInt.asUintN(32, alignment - 1n);
  const rounded = wrap64(load + mask) & wrap64(~mask);
  return hex(rounded >= minimum ? rounded : minimum);
}

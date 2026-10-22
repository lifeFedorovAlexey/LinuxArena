// SPDX-License-Identifier: GPL-2.0-only
export const U64 = (1n << 64n) - 1n;
export const U32 = (1n << 32n) - 1n;
export const wrap64 = (value) => BigInt.asUintN(64, value);
export const hex = (value) => (value === null ? null : '0x' + value.toString(16));

export function integer(value, bits, name) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    throw new Error(`${name}: число должно быть точным неотрицательным целым.`);
  if (typeof value !== 'bigint' && typeof value !== 'string' && typeof value !== 'number')
    throw new Error(`${name}: ожидается целое число.`);
  if (typeof value === 'string' && !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value.trim()))
    throw new Error(`${name}: используйте десятичное число или 0x…`);
  let result;
  try {
    result = BigInt(typeof value === 'string' ? value.trim() : value);
  } catch {
    throw new Error(`${name}: неверное число.`);
  }
  if (result < 0n || result >= 1n << BigInt(bits)) throw new Error(`${name}: значение вне u${bits}.`);
  return result;
}

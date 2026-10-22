// SPDX-License-Identifier: GPL-2.0-only
export const CONTRACT_REQUIREMENTS = Object.freeze(
  [
    { id: 'alignment', title: 'Округлить «{loadAddress}» вверх с интервалом «{alignment}»' },
    { id: 'minimum', title: 'Адрес не меньше значения «{minimumAddress}»' },
    { id: 'relocation', title: 'Если «{relocatable}» выключено, адрес равен «{minimumAddress}»' },
  ].map(Object.freeze),
);

const inputs = (loadAddress, overrides = {}) =>
  Object.freeze({
    loadAddress,
    alignment: '0x200000',
    minimumAddress: '0x1000000',
    relocatable: true,
    ...overrides,
  });
const sample = (id, requirement, title, loadAddress, overrides) =>
  Object.freeze({ id, requirement, title, inputs: inputs(loadAddress, overrides) });

export const CONTRACT_CASES = Object.freeze([
  sample('aligned', 'alignment', 'Шаг 2 МиБ', '0x1200000'),
  sample('round-up', 'alignment', 'Между шагами', '0x1380000'),
  sample('below-floor', 'minimum', 'Адрес ниже границы', '0x800000'),
  sample('fixed', 'relocation', 'Адрес выше границы', '0x1380000', { relocatable: false }),
  sample('aligned-wide', 'alignment', 'Шаг 4 МиБ', '0x1800000', { alignment: '0x400000' }),
  sample('aligned-floor', 'alignment', 'Ровно на границе', '0x1000000'),
  sample('round-byte', 'alignment', 'На один байт выше шага', '0x1200001'),
  sample('round-edge', 'alignment', 'За один байт до шага', '0x13fffff'),
  sample('floor-zero', 'minimum', 'Нулевой адрес', '0x0'),
  sample('floor-custom', 'minimum', 'Граница 24 МиБ', '0x800000', { minimumAddress: '0x1800000' }),
  sample('fixed-below', 'relocation', 'Адрес ниже границы', '0x800000', { relocatable: false }),
  sample('fixed-custom', 'relocation', 'Граница 24 МиБ', '0x2800000', {
    minimumAddress: '0x1800000',
    relocatable: false,
  }),
]);

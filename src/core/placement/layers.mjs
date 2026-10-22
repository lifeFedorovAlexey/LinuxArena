// SPDX-License-Identifier: GPL-2.0-only
import { SOURCE, CONTRACT } from './reference.mjs';
const source = (start, end = start) => ({ path: SOURCE.path, start, end, url: `${SOURCE.url}#L${start}` });

export const BOOT_LAYERS = Object.freeze({
  root: {
    id: 'root',
    title: 'Linux',
    subtitle: 'x86-64 · 6.18.58 LTS',
    nodes: [
      { id: 'loader', title: 'Загрузчик', kind: 'external', status: 'external' },
      {
        id: 'boot',
        title: 'Вход в ядро',
        symbol: 'startup_64',
        target: 'startup',
        kind: 'layer',
        status: 'partial',
        source: source(278, 442),
      },
      {
        id: 'decompress',
        title: 'Распаковка',
        symbol: 'extract_kernel',
        kind: 'boundary',
        status: 'unopened',
        source: source(445, 476),
      },
      { id: 'kernel', title: 'Ядро', kind: 'boundary', status: 'unopened' },
    ],
    edges: [
      ['loader', 'boot'],
      ['boot', 'decompress'],
      ['decompress', 'kernel'],
    ],
  },
  startup: {
    id: 'startup',
    parent: 'root',
    title: 'startup_64',
    subtitle: 'Вход 0x200',
    source: source(278, 334),
    nodes: [
      {
        id: 'flags',
        title: 'Флаги',
        symbol: 'cld · cli',
        kind: 'hardware',
        status: 'read-only',
        source: source(290, 291),
      },
      {
        id: 'segments',
        title: 'Сегменты',
        symbol: 'ds · es · ss · fs · gs',
        kind: 'hardware',
        status: 'read-only',
        source: source(294, 299),
      },
      {
        id: 'placement',
        title: 'Адрес распаковки',
        symbol: '%rbp',
        target: 'placement',
        kind: 'layer',
        status: 'modeled',
        source: source(315, 326),
      },
      {
        id: 'relocate',
        title: 'Буфер',
        symbol: '%rbx',
        kind: 'boundary',
        status: 'unopened',
        source: source(329, 331),
      },
      {
        id: 'stack',
        title: 'Стек',
        symbol: '%rsp',
        kind: 'hardware',
        status: 'unopened',
        source: source(334),
      },
      { id: 'continuation', title: 'Далее', kind: 'boundary', status: 'unopened', source: source(336, 442) },
    ],
    edges: [
      ['flags', 'segments'],
      ['segments', 'placement'],
      ['placement', 'relocate'],
      ['relocate', 'stack'],
      ['stack', 'continuation'],
    ],
  },
  placement: {
    id: 'placement',
    parent: 'startup',
    title: 'Адрес распаковки',
    subtitle: '%rbp · u64',
    source: source(315, 326),
    contract: CONTRACT,
    nodes: [
      { id: 'input', title: 'Вход', kind: 'input', source: source(316, 317) },
      { id: 'align', title: 'Выравнивание', kind: 'operation', source: source(318, 321) },
      { id: 'minimum', title: 'Нижняя граница', kind: 'branch', source: source(322, 325) },
      { id: 'output', title: 'Выход', symbol: '%rbp', kind: 'output', source: source(326) },
    ],
    edges: [
      ['input', 'align'],
      ['align', 'minimum'],
      ['minimum', 'output'],
    ],
  },
});

import { t } from '../shared/i18n/index.mjs';
import { BOOT_LAYERS } from '../../core/placement/index.mjs';
const nodeIcons = {
  loader: 'arrow',
  boot: 'chip',
  decompress: 'box',
  kernel: 'layers',
  flags: 'flag',
  segments: 'grid',
  placement: 'target',
  relocate: 'box',
  stack: 'layers',
  continuation: 'arrow',
};

export function graphFor(id) {
  const spec = BOOT_LAYERS[id];
  const positions =
    id === 'root'
      ? [
          [-6.5, -0.6],
          [-2.2, -0.6],
          [2.2, -0.6],
          [6.5, -0.6],
        ]
      : [
          [-4.7, -2],
          [0, -2],
          [4.7, -2],
          [4.7, 2.2],
          [0, 2.2],
          [-4.7, 2.2],
        ];
  return {
    nodes: spec.nodes.map((node, index) => ({
      ...node,
      title: t(node.title),
      ariaLabel: node.target ? t('{title} — открыть слой', { title: t(node.title) }) : t(node.title),
      tooltip: t(node.target ? 'Открыть блок' : 'Граница текущего разбора'),
      x: positions[index][0],
      z: positions[index][1],
      available: !!node.target,
      subtitle: node.symbol ?? (node.kind === 'external' ? t('внешняя граница') : t('следующий этап')),
      icon: nodeIcons[node.id],
    })),
    edges: spec.edges,
    span: id === 'root' ? 19 : 16,
  };
}

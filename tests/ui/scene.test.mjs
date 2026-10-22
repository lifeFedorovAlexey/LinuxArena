import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { ArenaScene } from '../../src/ui/scene/scene.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = createRequire(require.resolve('blockly'))('jsdom');

test('scene graph supports both modes, interaction and disposal when replaced', (t) => {
  const dom = new JSDOM('<div id="labels"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
    dom.window.close();
  });
  const selected = [];
  const view = Object.assign(Object.create(ArenaScene.prototype), {
    group: new THREE.Group(),
    labels: dom.window.document.getElementById('labels'),
    resize() {},
    onNode: (node) => selected.push(node.id),
    renderLabel: (node) => node.title,
  });
  const nodes = [
    [0, 0],
    [5, 0],
    [5, 5],
    [-4, 6],
  ].map(([x, z], index) => ({
    id: String(index),
    title: `Node ${index}`,
    x,
    z,
    available: index !== 3,
  }));
  const edges = [
    ['0', '1'],
    ['1', '2'],
    ['2', '3'],
    ['0', 'missing'],
  ];
  for (const mode of ['layers', 'operations']) {
    view.setGraph({ mode, nodes, edges });
    assert.equal(view.labels.children.length, 4);
    assert.equal(view.links.length, 3);
    const resources = new Set();
    view.group.traverse((object) => {
      if (object.geometry) {
        resources.add(object.geometry);
        assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
      }
      for (const material of [object.material].flat().filter(Boolean)) resources.add(material);
    });
    view.nodes[0].label.click();
    assert.equal(selected.at(-1), '0');
    view.nodes[0].label.dispatchEvent(new dom.window.Event('pointerenter'));
    assert.equal(view.nodes[0].top.emissiveIntensity, 0.5);
    view.nodes[0].label.dispatchEvent(new dom.window.Event('pointerleave'));
    assert.equal(view.nodes[0].top.emissiveIntensity, 0.18);
    view.highlight('1');
    assert.equal(view.labels.querySelectorAll('.trace-active').length, 1);
    const disposed = new Set();
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.add(resource));
    view.setGraph({ mode, nodes: [], edges: [] });
    assert.deepEqual(disposed, resources);
    assert.equal(view.group.children.length, 0);
    assert.equal(view.labels.children.length, 0);
  }
});

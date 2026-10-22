import * as THREE from 'three';
export const PALETTE = { accent: 0xc2f18a, live: 0x36552e, idle: 0x243732, floor: 0x172020, line: 0x536b4b };

function roundedShape(width, depth, radius = 0.18) {
  const shape = new THREE.Shape();
  const x = -width / 2,
    y = -depth / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + depth - radius);
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth);
  shape.lineTo(x + radius, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

export function buildGraphGeometry(view, graph) {
  const nodes = [];
  const links = [];
  const operation = graph.mode === 'operations';
  const width = operation ? 2.05 : 3.25,
    depth = operation ? 1.62 : 2.45;
  for (const node of graph.nodes) {
    const available = node.available;
    const group = new THREE.Group();
    group.position.set(node.x, 0, node.z);
    const geometry = new THREE.ExtrudeGeometry(roundedShape(width, depth), {
      depth: available ? 0.47 : 0.29,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.045,
      bevelThickness: 0.045,
      curveSegments: 10,
    });
    geometry.rotateX(-Math.PI / 2);
    const top = new THREE.MeshStandardMaterial({
      color: available ? PALETTE.live : PALETTE.idle,
      metalness: 0.18,
      roughness: 0.58,
      emissive: available ? 0x1c310f : 0x000000,
      emissiveIntensity: 0.18,
    });
    const side = new THREE.MeshStandardMaterial({
      color: available ? 0x283e26 : 0x1b2a27,
      metalness: 0.18,
      roughness: 0.8,
    });
    const box = new THREE.Mesh(geometry, [top, side]);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
    const edgePoints = roundedShape(width - 0.04, depth - 0.04)
      .getPoints(40)
      .map((point) => new THREE.Vector3(point.x, available ? 0.52 : 0.34, -point.y));
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(edgePoints),
      new THREE.LineBasicMaterial({
        color: available ? 0x829d57 : 0x496357,
        transparent: true,
        opacity: available ? 0.6 : 0.32,
      }),
    );
    group.add(outline);
    if (available) {
      const baseOutline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          roundedShape(width + 0.27, depth + 0.27)
            .getPoints(40)
            .map((point) => new THREE.Vector3(point.x, -0.02, -point.y)),
        ),
        new THREE.LineBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.15 }),
      );
      group.add(baseOutline);
    }
    for (const direction of [-1, 1]) {
      const port = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 0.045, 12),
        new THREE.MeshBasicMaterial({ color: available ? PALETTE.accent : 0x5a7462 }),
      );
      port.position.set(direction * (width / 2 + 0.08), 0.08, 0);
      group.add(port);
    }
    view.group.add(group);
    const label = document.createElement('button');
    label.className = `node-label${available ? ' available' : ' locked'}${operation ? ' operation' : ''}`;
    label.dataset.nodeId = node.id;
    label.innerHTML = view.renderLabel(node, operation);
    label.setAttribute(
      'aria-label',
      node.ariaLabel ?? `${node.title}${node.target ? ' — открыть слой' : ''}`,
    );
    label.title = node.tooltip ?? (node.available ? 'Открыть блок' : 'Граница текущего разбора');
    label.addEventListener('click', () => view.onNode(node));
    label.addEventListener('pointerenter', () => {
      if (available) top.emissiveIntensity = 0.5;
    });
    label.addEventListener('pointerleave', () => {
      top.emissiveIntensity = 0.18;
    });
    view.labels.append(label);
    nodes.push({ data: node, group, box, top, outline, label, height: available ? 0.47 : 0.29 });
  }
  for (const [fromId, toId] of graph.edges) {
    const from = graph.nodes.find((node) => node.id === fromId),
      to = graph.nodes.find((node) => node.id === toId);
    if (!from || !to) continue;
    const horizontal = Math.abs(from.z - to.z) < 0.1;
    const vertical = Math.abs(from.x - to.x) < 0.1;
    const directionX = Math.sign(to.x - from.x) || 1;
    const directionZ = Math.sign(to.z - from.z) || 1;
    const start = new THREE.Vector3(
      from.x + (horizontal ? directionX * (width / 2 + 0.08) : 0),
      0.07,
      from.z + (horizontal ? 0 : directionZ * (depth / 2 + 0.08)),
    );
    const end = new THREE.Vector3(
      to.x - (horizontal ? directionX * (width / 2 + 0.08) : 0),
      0.07,
      to.z - (horizontal ? 0 : directionZ * (depth / 2 + 0.08)),
    );
    let points;
    if (horizontal || vertical) points = [start, start.clone().lerp(end, 0.5), end];
    else {
      const midpointZ = (start.z + end.z) / 2;
      points = [
        start,
        new THREE.Vector3(start.x, 0.07, midpointZ),
        new THREE.Vector3(end.x, 0.07, midpointZ),
        end,
      ];
    }
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.1);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)),
      new THREE.LineBasicMaterial({ color: PALETTE.line, transparent: true, opacity: 0.7 }),
    );
    view.group.add(line);
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 6, 6),
      new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.8 }),
    );
    view.group.add(particle);
    links.push({ curve, particle, from: fromId, to: toId, offset: links.length * 0.19 });
  }
  return { nodes, links };
}

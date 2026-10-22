import * as THREE from 'three';
import { PALETTE, buildGraphGeometry } from './geometry.mjs';
const smooth = (t) => t * t * (3 - 2 * t);

export class ArenaScene {
  constructor(host, labels, { onNode, renderLabel }) {
    this.host = host;
    this.labels = labels;
    this.onNode = onNode;
    this.renderLabel = renderLabel;
    this.nodes = [];
    this.links = [];
    this.zoom = 1;
    this.graph = null;
    this.active = null;
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.floor);
    this.scene.fog = new THREE.Fog(PALETTE.floor, 24, 65);
    this.camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 100);
    this.camera.position.set(8, 17, 16);
    this.target = new THREE.Vector3(0, 0, 0);
    this.camera.lookAt(this.target);
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'low-power',
      });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.28;
      host.append(this.renderer.domElement);
    } catch {
      this.renderer = null;
      document.querySelector('#scene-fallback').hidden = false;
    }
    this.scene.add(new THREE.HemisphereLight(0xc9dfcb, 0x101917, 2.4));
    const sun = new THREE.DirectionalLight(0xd2f0be, 3.3);
    sun.position.set(-7, 16, 7);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 0.1, far: 60 });
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7eabc5, 1.2);
    fill.position.set(10, 5, -9);
    this.scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const dots = [];
    for (let x = -28; x <= 28; x += 0.75) for (let z = -24; z <= 24; z += 0.75) dots.push(x, -0.075, z);
    const dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
    this.scene.add(
      new THREE.Points(
        dotGeometry,
        new THREE.PointsMaterial({
          color: 0x64816a,
          size: 0.027,
          transparent: true,
          opacity: 0.32,
          sizeAttenuation: true,
        }),
      ),
    );
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.startTime = performance.now();
    this.tick();
  }

  resize() {
    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight;
    const aspect = this.width / Math.max(this.height, 1);
    this.camera.updateMatrixWorld();
    let extentX = 0,
      extentY = 0;
    const halfWidth = this.graph?.mode === 'operations' ? 1.2 : 1.9;
    const halfDepth = this.graph?.mode === 'operations' ? 1 : 1.45;
    for (const node of this.graph?.nodes ?? []) {
      for (const x of [-halfWidth, halfWidth])
        for (const z of [-halfDepth, halfDepth]) {
          const point = new THREE.Vector3(node.x + x, 0.5, node.z + z).applyMatrix4(
            this.camera.matrixWorldInverse,
          );
          extentX = Math.max(extentX, Math.abs(point.x));
          extentY = Math.max(extentY, Math.abs(point.y));
        }
    }
    const viewHeight = Math.max(9.5, extentY * 2 + 2.5, (extentX * 2 + 1.5) / Math.max(aspect, 0.5));
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(this.width, this.height);
  }

  setZoom(delta = 0, reset = false) {
    this.zoom = reset ? 1 : Math.max(0.7, Math.min(1.7, this.zoom + delta));
    this.resize();
  }

  clear() {
    this.group.traverse((object) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
      else object.material?.dispose();
    });
    this.group.clear();
    this.nodes = [];
    this.links = [];
    this.labels.replaceChildren();
  }

  setGraph(graph) {
    this.clear();
    this.graph = graph;
    this.active = null;
    Object.assign(this, buildGraphGeometry(this, graph));
    this.zoom = 1;
    this.resize();
    this.enteredAt = performance.now();
  }

  highlight(id, nextId = null) {
    this.active = id;
    this.activeNext = nextId;
    for (const node of this.nodes) {
      const active = node.data.id === id;
      node.label.classList.toggle('trace-active', active);
      node.top.emissive.set(active ? 0x5f9229 : node.data.available ? 0x1c310f : 0);
      node.top.emissiveIntensity = active ? 0.7 : 0.18;
      node.outline.material.opacity = active ? 1 : node.data.available ? 0.6 : 0.32;
    }
  }

  async transition(graph, fromId, reverse = false) {
    if (this.reduceMotion) {
      this.setGraph(graph);
      return;
    }
    const selected = this.nodes.find((node) => node.data.id === fromId);
    const originalTarget = this.target.clone();
    const target = selected
      ? new THREE.Vector3(selected.data.x * 0.22, 0, selected.data.z * 0.22)
      : this.target.clone();
    this.labels.parentElement.classList.add('transitioning');
    const animate = (duration, update) =>
      new Promise((resolve) => {
        const start = performance.now();
        const frame = (time) => {
          const t = Math.min(1, (time - start) / duration);
          update(smooth(t));
          if (t < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
    await animate(190, (t) => {
      this.camera.zoom = this.zoom * (1 + t * (reverse ? -0.12 : 0.18));
      this.target.copy(originalTarget).lerp(target, t);
      this.camera.lookAt(this.target);
      this.camera.updateProjectionMatrix();
      this.labels.style.opacity = String(1 - t);
    });
    this.target.set(0, 0, 0);
    this.camera.lookAt(this.target);
    this.setGraph(graph);
    await animate(300, (t) => {
      this.group.scale.setScalar(0.9 + 0.1 * t);
      this.group.position.y = -0.4 * (1 - t);
      this.labels.style.opacity = String(t);
    });
    this.labels.parentElement.classList.remove('transitioning');
  }

  tick() {
    this.frame = requestAnimationFrame(() => this.tick());
    const time = (performance.now() - this.startTime) / 1000;
    this.group.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    for (const node of this.nodes) {
      if (this.renderer) {
        const position = node.group
          .localToWorld(new THREE.Vector3(0, node.height + 0.22, 0))
          .project(this.camera);
        node.label.style.left = `${(position.x * 0.5 + 0.5) * this.width}px`;
        node.label.style.top = `${(-position.y * 0.5 + 0.5) * this.height}px`;
      } else {
        const index = this.nodes.indexOf(node),
          columns = this.width < 600 ? 2 : 3;
        node.label.style.left = `${(((index % columns) + 0.5) * this.width) / columns}px`;
        node.label.style.top = `${100 + Math.floor(index / columns) * 85}px`;
      }
    }
    for (const link of this.links) {
      link.particle.visible =
        this.graph?.mode !== 'operations' || (link.from === this.active && link.to === this.activeNext);
      link.particle.position.copy(
        link.curve.getPoint(this.reduceMotion ? 0.5 : (time * 0.09 + link.offset) % 1),
      );
    }
    this.renderer?.render(this.scene, this.camera);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.clear();
    this.renderer?.dispose();
  }
}

import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3, Vector4, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import '@babylonjs/loaders/glTF/glTFFileLoader.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import type { PokerState } from '../shared/poker.ts';
import { pickQuality } from './quality.ts';

export type PokerSceneState = Pick<PokerState, 'chips' | 'bets' | 'folded' | 'pot' | 'turn' | 'winner' | 'draw' | 'stage' | 'hand'> & { cards: (number | null)[]; remaining: number[] };
type Person = { root: TransformNode; arm: TransformNode; card: Mesh; marker: Mesh };
type Flight = { mesh: Mesh; from: Vector3; to: Vector3; started: number; seat: number; count: number };
const CLOTHES = ['#687f78', '#ba7966', '#708196', '#b29962', '#967c99', '#647d9b'];
const SKIN = ['#d4a17d', '#bb8260', '#e1b18c', '#986449', '#c69270', '#e0bb99'];

export class PokerWorld {
  readonly ready: Promise<void>;
  private model?: AssetContainer;
  private assetAbort = new AbortController();
  private shadows: ShadowGenerator;
  private assetsReady = false;
  private engine: Engine;
  private scene: Scene;
  private camera: FreeCamera;
  private materials = new Map<string, StandardMaterial>();
  private people = new Map<number, Person>();
  private flights: Flight[] = [];
  private potChips: Mesh[] = [];
  private stacks: Mesh[] = [];
  private previous?: number[];
  private round = '';
  private layout = '';
  private pot = 0;
  private betAnimations = 0;
  private yaw = 0;
  private dragX: number | null = null;
  private observer: ResizeObserver;
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private resize = () => { if (this.canvas.clientWidth && this.canvas.clientHeight) this.engine.resize(); };
  private down = (event: PointerEvent) => { if (event.button === 0) { this.dragX = event.clientX; this.canvas.setPointerCapture(event.pointerId); } };
  private move = (event: PointerEvent) => { if (this.dragX !== null) { this.yaw = Math.max(-1.15, Math.min(1.15, this.yaw - (event.clientX - this.dragX) * .004)); this.dragX = event.clientX; } };
  private up = () => { this.dragX = null; };
  private key = (event: KeyboardEvent) => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) { event.preventDefault(); this.yaw = event.key === 'Home' ? 0 : Math.max(-1.15, Math.min(1.15, this.yaw + (event.key === 'ArrowLeft' ? -.12 : .12))); } };

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, doNotHandleTouchAction: true }, true);
    const quality = pickQuality();
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, quality.pixelCap));
    canvas.dataset.quality = quality.tier;
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#101d1cff');
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.exposure = 1.3;
    this.scene.imageProcessingConfiguration.contrast = 1.15;
    const light = new HemisphericLight('lounge-ambient', new Vector3(0, 1, 0), this.scene);
    light.intensity = .75; light.groundColor = Color3.FromHexString('#403529');
    const warm = new DirectionalLight('table-light', new Vector3(.3, -1, .35), this.scene);
    warm.position.set(-3, 7, -3); warm.diffuse = Color3.FromHexString('#ffe0aa'); warm.intensity = 2.2;
    warm.shadowMinZ = .1; warm.shadowMaxZ = 18; warm.autoCalcShadowZBounds = true;
    this.shadows = new ShadowGenerator(quality.shadowMap, warm);
    this.shadows.usePercentageCloserFiltering = true; this.shadows.bias = .002; this.shadows.normalBias = .015;
    this.camera = new FreeCamera('seated-eyes', new Vector3(0, 2.02, -3), this.scene);
    this.camera.inputs.clear(); this.camera.minZ = .06; this.camera.maxZ = 35; this.camera.fov = .82;
    this.ready = this.loadModels();
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '1인칭 포커 테이블. 드래그 또는 좌우 방향키로 둘러보기');
    canvas.addEventListener('pointerdown', this.down); canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up); canvas.addEventListener('pointercancel', this.up);
    canvas.addEventListener('lostpointercapture', this.up); canvas.addEventListener('keydown', this.key);
    this.observer = new ResizeObserver(this.resize); this.observer.observe(canvas);
    window.addEventListener('resize', this.resize);
    this.engine.runRenderLoop(() => {
      if (!this.assetsReady || !canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight) return;
      this.animate(); this.camera.rotation.set(.17, this.yaw, 0); this.scene.render(); canvas.dataset.ready = 'true';
    });
  }

  private material(color: string) {
    if (!this.materials.has(color)) {
      const material = new StandardMaterial(color, this.scene);
      material.diffuseColor = Color3.FromHexString(color).toLinearSpace(); material.specularColor.set(.08, .08, .08);
      this.materials.set(color, material);
    }
    return this.materials.get(color)!;
  }

  private shape(kind: 'box' | 'sphere' | 'cylinder', name: string, size: number[], at: number[], color: string, parent?: TransformNode) {
    const mesh = kind === 'box' ? MeshBuilder.CreateBox(name, { size: 1 }, this.scene) : kind === 'sphere'
      ? MeshBuilder.CreateSphere(name, { diameter: 1, segments: 16 }, this.scene)
      : MeshBuilder.CreateCylinder(name, { diameter: 1, height: 1, tessellation: 32 }, this.scene);
    mesh.scaling.set(size[0], size[1], size[2]); mesh.position.set(at[0], at[1], at[2]);
    mesh.material = this.material(color); if (parent) mesh.parent = parent; return mesh;
  }

  private async loadModels() {
    // Own the downloads so leaving a room settles their promises when aborted.
    const results = await Promise.allSettled(['poker-lounge', 'poker-person'].map(async name => {
      const response = await fetch(`/models/${name}.glb`, { signal: this.assetAbort.signal });
      if (!response.ok) throw new Error(`모델 다운로드 실패: ${response.status}`);
      const data = new Uint8Array(await response.arrayBuffer());
      this.assetAbort.signal.throwIfAborted();
      return LoadAssetContainerAsync(data, this.scene, { pluginExtension: '.glb' });
    }));
    if (this.scene.isDisposed || results.some(result => result.status === 'rejected')) {
      results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
      if (!this.scene.isDisposed) throw new Error('포커 모델을 불러오지 못했어요.');
      return;
    }
    const [lounge, person] = results.map(result => (result as PromiseFulfilledResult<AssetContainer>).value);
    lounge.addAllToScene();
    for (const mesh of lounge.meshes) {
      mesh.receiveShadows = true;
      if (mesh.material instanceof PBRMaterial && mesh.material.name.includes('Tournament green baize')) {
        const weave = new DynamicTexture('woven-baize', { width: 256, height: 256 }, this.scene, true);
        weave.anisotropicFilteringLevel = 4;
        const ctx = weave.getContext() as CanvasRenderingContext2D;
        const pixels = ctx.createImageData(256, 256);
        let noise = 17;
        for (let i = 0; i < 256 * 256; i++) {
          noise = (Math.imul(noise, 1664525) + 1013904223) | 0;
          const value = 238 + (noise >>> 29);
          pixels.data.set([value, value, value, 255], i * 4);
        }
        ctx.putImageData(pixels, 0, 0); weave.update();
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
        const uv = []; for (let i = 0; i < positions.length; i += 3) uv.push(positions[i] * 3, positions[i + 2] * 3);
        mesh.setVerticesData(VertexBuffer.UVKind, uv);
        mesh.material.albedoTexture = weave;
      }
    }
    this.model = person;
    this.assetsReady = true;
    this.canvas.dataset.models = 'blender';
  }

  private limb(from: number[], to: number[], width: number, color: string, parent: TransformNode) {
    const a = Vector3.FromArray(from), b = Vector3.FromArray(to), direction = b.subtract(a);
    const mesh = this.shape('sphere', 'human-arm', [width, direction.length() + width * .35, width], a.add(b).scale(.5).asArray(), color, parent);
    mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), new Quaternion()); return mesh;
  }

  private hand(at: number[], skin: string, parent: TransformNode) {
    this.shape('sphere', 'palm', [.18, .09, .19], at, skin, parent);
    for (let finger = 0; finger < 4; finger++) {
      this.shape('sphere', 'finger', [.038, .045, .135 - Math.abs(finger - 1) * .012],
        [at[0] + (finger - 1.5) * .041, at[1] - .004, at[2] + .11], skin, parent);
    }
    this.shape('sphere', 'thumb', [.055, .048, .10], [at[0] - .097, at[1], at[2] + .025], skin, parent);
  }

  private person(seat: number, local: boolean) {
    const root = new TransformNode(`seat-${seat}`, this.scene), skin = SKIN[seat % SKIN.length];
    const arm = new TransformNode('betting-arm', this.scene); arm.parent = root; arm.position.set(.4, 1.38, .3);
    this.limb([0, 0, 0], [.05, -.015, .63], .17, CLOTHES[seat % CLOTHES.length], arm);
    this.hand([.05, .015, .76], skin, arm);
    if (local) {
      this.limb([-.43, 1.34, .3], [-.48, 1.36, .94], .17, CLOTHES[seat % CLOTHES.length], root);
      this.hand([-.48, 1.39, 1.04], skin, root);
    } else {
      const instance = this.model!.instantiateModelsToScene(name => `seat-${seat}-${name}`, true, { doNotInstantiate: true });
      for (const node of instance.rootNodes) {
        node.parent = root;
        for (const mesh of node.getChildMeshes()) {
          mesh.receiveShadows = true;
          const material = mesh.material;
          if (material instanceof PBRMaterial) {
            if (material.name.includes('Warm skin')) material.albedoColor = Color3.FromHexString(skin).toLinearSpace();
            if (material.name.includes('Tailored slate jacket')) material.albedoColor = Color3.FromHexString(CLOTHES[seat % CLOTHES.length]).toLinearSpace();
          }
          this.shadows.addShadowCaster(mesh);
        }
      }
    }
    const card = MeshBuilder.CreatePlane(`forehead-card-${seat}`, { width: .47, height: .66 }, this.scene);
    card.parent = root; card.position.set(0, local ? 1.63 : 2.45, local ? 1.04 : .3); card.rotation.y = local ? 0 : Math.PI;
    const marker = this.shape('cylinder', 'turn-marker', [.16, .025, .16], [-.57, 1.36, 1], '#ead3a0', root);
    const person = { root, arm, card, marker }; this.people.set(seat, person); return person;
  }

  private cardMaterial(value: number | null) {
    const key = `card-${value ?? 'back'}`;
    if (!this.materials.has(key)) {
      const texture = new DynamicTexture(key, { width: 256, height: 360 }, this.scene, false);
      const context = texture.getContext() as CanvasRenderingContext2D; context.fillStyle = value === null ? '#704944' : '#fff3da'; context.fillRect(0, 0, 256, 360);
      context.strokeStyle = value === null ? '#d4b487' : '#bd9b64'; context.lineWidth = 5; context.strokeRect(12, 12, 232, 336);
      context.fillStyle = value === null ? '#f0d7aa' : '#253e37'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.font = `700 ${value === 10 ? 152 : 194}px Georgia`; context.fillText(value === null ? '?' : String(value), 128, 181);
      if (value !== null) { context.font = 'bold 36px Georgia'; context.fillText(String(value), 43, 46); context.fillText(String(value), 213, 316); }
      texture.update(); const material = new StandardMaterial(key, this.scene); material.disableLighting = true;
      // StandardMaterial adds emissiveColor to the texture, so white would erase the numerals.
      material.emissiveTexture = texture; material.emissiveColor = Color3.Black(); this.materials.set(key, material);
    }
    return this.materials.get(key)!;
  }

  private chip(name: string, at: Vector3, index: number) {
    const color = ['#b65c46', '#d1bd88', '#467e84'][index % 3], key = `chip-${color}`;
    if (!this.materials.has(key)) {
      const texture = new DynamicTexture(key, { width: 512, height: 256 }, this.scene, false);
      const ctx = texture.getContext() as CanvasRenderingContext2D;
      ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = '#f2e5c3'; ctx.lineWidth = 13;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath(); ctx.arc(128, 128, 116, i * Math.PI / 4, i * Math.PI / 4 + .27); ctx.stroke();
        ctx.fillStyle = '#f2e5c3'; ctx.fillRect(256 + i * 32, 0, 10, 256);
      }
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(128, 128, 83, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff0cd'; ctx.font = 'bold 88px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('1', 128, 134);
      texture.update();
      const material = new StandardMaterial(key, this.scene); material.diffuseTexture = texture;
      material.specularColor.set(.22, .22, .22); material.specularPower = 48;
      this.materials.set(key, material);
    }
    const mesh = MeshBuilder.CreateCylinder(name, { diameter: .16, height: .037, tessellation: 24,
      faceUV: [new Vector4(0, 0, .5, 1), new Vector4(.5, 0, 1, 1), new Vector4(0, 0, .5, 1)] }, this.scene);
    mesh.position.copyFrom(at); mesh.material = this.materials.get(key)!; return mesh;
  }

  private syncPot() {
    const count = Math.max(0, this.pot - this.flights.reduce((sum, flight) => sum + flight.count, 0));
    while (this.potChips.length > count) this.potChips.pop()!.dispose();
    while (this.potChips.length < count) {
      const index = this.potChips.length, stack = Math.floor(index / 12);
      this.potChips.push(this.chip('pot-chip', new Vector3((stack % 4 - 1.5) * .21, 1.365 + index % 12 * .039, Math.floor(stack / 4) * .23 - .18), index));
    }
  }

  update(game: PokerSceneState, me: number, players: { seat: number; name: string }[], round: number) {
    if (!this.assetsReady) return;
    const seats = players.map(player => player.seat).sort((a, b) => a - b), localIndex = seats.indexOf(me);
    const hand = `${round}:${game.hand}`;
    const layout = `${me}:${seats.join(',')}`, reset = hand !== this.round || layout !== this.layout;
    if (reset) { this.flights.forEach(flight => flight.mesh.dispose()); this.flights = []; this.previous = undefined; this.round = hand; }
    if (layout !== this.layout) {
      this.people.forEach(person => {
        for (const mesh of person.root.getChildMeshes()) {
          this.shadows.removeShadowCaster(mesh);
          if (mesh.material instanceof PBRMaterial) mesh.material.dispose();
        }
        person.root.dispose();
      }); this.people.clear(); this.layout = layout;
      seats.forEach((seat, index) => {
        const angle = ((index - localIndex + seats.length) % seats.length) * Math.PI * 2 / seats.length;
        const person = this.person(seat, seat === me); person.root.position.set(Math.sin(angle) * 3, 0, -Math.cos(angle) * 3); person.root.rotation.y = -angle;
      });
      this.yaw = seats.length % 2 ? Math.PI / (seats.length * 2) : 0;
    }
    this.pot = game.pot;
    for (const [seat, person] of this.people) {
      person.card.setEnabled(seat !== me || game.stage === 'reveal');
      person.card.material = this.cardMaterial(seat === me && game.stage === 'betting' ? null : game.cards[seat] ?? null);
      person.marker.setEnabled(game.turn === seat && game.stage === 'betting' && game.winner === null && !game.draw);
      person.root.scaling.y = game.folded[seat] && seat !== me ? .92 : 1;
      const delta = this.previous ? game.bets[seat] - this.previous[seat] : 0;
      if (delta > 0 && !this.motion.matches) {
        person.root.computeWorldMatrix(true);
        const from = Vector3.TransformCoordinates(new Vector3(.43, 1.44, 1.03), person.root.getWorldMatrix());
        const to = new Vector3((seat % 3 - 1) * .2, 1.46, -.05);
        this.flights.push({ mesh: this.chip('thrown-chip', from, seat), from, to, started: performance.now(), seat, count: delta });
        this.canvas.dataset.betAnimations = String(++this.betAnimations);
      }
    }
    this.previous = [...game.bets]; this.syncPot();
    this.stacks.forEach(mesh => mesh.dispose()); this.stacks = [];
    for (const [seat, person] of this.people) for (let index = 0; index < game.chips[seat]; index++) {
      const chip = this.chip('personal-chip', new Vector3(.64 + Math.floor(index / 10) * .19, 1.365 + index % 10 * .039, 1.13), seat);
      chip.parent = person.root; this.stacks.push(chip);
    }
    for (const [seat, person] of this.people) for (let index = 0; index < (game.remaining[seat] ?? 0); index++) {
      const card = MeshBuilder.CreatePlane('personal-deck-back', { width: .35, height: .5, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      card.parent = person.root; card.position.set(-.8, 1.37 + index * .005, 1.02); card.rotation.x = Math.PI / 2;
      card.material = this.cardMaterial(null); this.stacks.push(card);
    }
    this.resize();
  }

  private animate() {
    this.people.forEach(person => { person.arm.rotation.x = 0; });
    for (const flight of [...this.flights]) {
      const t = this.motion.matches ? 1 : Math.min(1, (performance.now() - flight.started) / 680);
      flight.mesh.position.copyFrom(Vector3.Lerp(flight.from, flight.to, t)); flight.mesh.position.y += Math.sin(t * Math.PI) * .68;
      flight.mesh.rotation.set(t * Math.PI * 3, 0, t * .7);
      const person = this.people.get(flight.seat); if (person) person.arm.rotation.x = -Math.sin(t * Math.PI) * .5;
      if (t === 1) { flight.mesh.dispose(); this.flights.splice(this.flights.indexOf(flight), 1); this.syncPot(); }
    }
  }

  dispose() {
    this.assetAbort.abort();
    this.observer.disconnect(); window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('pointerdown', this.down); this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up); this.canvas.removeEventListener('pointercancel', this.up);
    this.canvas.removeEventListener('lostpointercapture', this.up); this.canvas.removeEventListener('keydown', this.key);
    this.engine.stopRenderLoop(); this.model?.dispose(); this.scene.dispose(); this.engine.dispose(); delete this.canvas.dataset.ready; delete this.canvas.dataset.models;
  }
}

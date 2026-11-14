import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { ARENA_START, CAR_RADIUS, type BumperView } from '../shared/bumper.ts';
import { COLORS } from './palette.ts';
import { pickQuality } from './quality.ts';

type Car = { root: TransformNode; body: TransformNode; label: Mesh; ring: Mesh; shadow: Mesh; name: string; x: number; z: number; yaw: number };
type Snapshot = { at: number; view: BumperView };
type Burst = { mesh: Mesh; age: number; life: number; size: number };
const DELAY = 90;

/** Renders interpolated server snapshots of the bumper arena. It never simulates. */
export class BumperWorld {
  private engine: Engine;
  private scene: Scene;
  private camera: FreeCamera;
  private floor: Mesh;
  private rim: Mesh;
  private cars = new Map<string, Car>();
  private materials = new Map<string, StandardMaterial>();
  private snapshots: Snapshot[] = [];
  private bursts: Burst[] = [];
  private seenEvent = 0;
  private shake = 0;
  private orbit = 0;
  private radius = ARENA_START;
  private distance = 30;
  private me = '';
  private observer: ResizeObserver;
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private resize = () => { if (this.canvas.clientWidth && this.canvas.clientHeight) this.engine.resize(); };
  /** Fired once per new server event involving this player (hit given or taken, fall). */
  onImpact = (_kind: 'hit' | 'fall', _mine: boolean) => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, doNotHandleTouchAction: true }, true);
    const quality = pickQuality();
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, quality.pixelCap));
    canvas.dataset.quality = quality.tier;
    const scene = this.scene = new Scene(this.engine);
    scene.skipPointerMovePicking = true; scene.skipPointerDownPicking = true; scene.skipPointerUpPicking = true;
    scene.clearColor = Color4.FromHexString('#0c1512ff');
    const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    sky.intensity = .85; sky.groundColor = Color3.FromHexString('#27403a');
    const sun = new DirectionalLight('sun', new Vector3(-.45, -1, .35), scene);
    sun.intensity = .75; sun.diffuse = Color3.FromHexString('#fff1d6');
    this.camera = new FreeCamera('camera', new Vector3(0, 26, -18), scene);
    this.camera.inputs.clear(); this.camera.minZ = .2; this.camera.maxZ = 200; this.camera.fov = .8;
    this.camera.setTarget(Vector3.Zero());

    // Floor: a unit disc scaled to the live radius, painted once.
    const paint = new DynamicTexture('floor-paint', { width: 1024, height: 1024 }, scene, true);
    const ctx = paint.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = '#2f6d5a'; ctx.fillRect(0, 0, 1024, 1024);
    ctx.translate(512, 512);
    for (let ring = 0; ring < 6; ring++) {
      ctx.beginPath(); ctx.arc(0, 0, 500 - ring * 84, 0, Math.PI * 2);
      ctx.fillStyle = ring % 2 ? '#2f6d5a' : '#387a65'; ctx.fill();
    }
    ctx.lineWidth = 34; ctx.strokeStyle = '#f2eee1'; ctx.setLineDash([58, 40]);
    ctx.beginPath(); ctx.arc(0, 0, 486, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 10; ctx.strokeStyle = '#f2eee180';
    ctx.beginPath(); ctx.arc(0, 0, 150, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-512, 0); ctx.lineTo(512, 0); ctx.moveTo(0, -512); ctx.lineTo(0, 512); ctx.stroke();
    paint.update();
    const floorMaterial = new StandardMaterial('floor', scene);
    floorMaterial.diffuseTexture = paint; floorMaterial.specularColor = new Color3(.05, .05, .05);
    this.floor = MeshBuilder.CreateCylinder('floor', { diameter: 2, height: 1.2, tessellation: 72 }, scene);
    this.floor.position.y = -.6; this.floor.material = floorMaterial;
    const side = this.material('#1d3f35');
    const skirt = MeshBuilder.CreateCylinder('skirt', { diameterTop: 1.96, diameterBottom: 1.5, height: 3, tessellation: 72 }, scene);
    skirt.parent = this.floor; skirt.position.y = -2.05; skirt.material = side;
    this.rim = MeshBuilder.CreateTorus('rim', { diameter: 2, thickness: .035, tessellation: 72 }, scene);
    const glow = new StandardMaterial('rim', scene);
    glow.emissiveColor = Color3.FromHexString('#ff8a5c'); glow.diffuseColor = Color3.Black(); glow.disableLighting = true;
    this.rim.material = glow; this.rim.position.y = .03;
    // A faint grid far below gives falling cars something to fall toward.
    const abyss = MeshBuilder.CreateGround('abyss', { width: 220, height: 220 }, scene);
    abyss.position.y = -26; abyss.material = this.material('#10201b');

    this.observer = new ResizeObserver(this.resize); this.observer.observe(canvas);
    window.addEventListener('resize', this.resize);
    this.engine.runRenderLoop(() => {
      if (document.hidden) return;
      this.frame(Math.min(.05, this.engine.getDeltaTime() / 1000));
      scene.render();
    });
  }

  private material(color: string, emissive = 0) {
    const key = `${color}:${emissive}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new StandardMaterial(key, this.scene);
      material.diffuseColor = Color3.FromHexString(color);
      material.specularColor = new Color3(.12, .12, .12);
      if (emissive) material.emissiveColor = Color3.FromHexString(color).scale(emissive);
      this.materials.set(key, material);
    }
    return material;
  }

  private label(text: string, mine: boolean) {
    const texture = new DynamicTexture('name', { width: 512, height: 128 }, this.scene, true);
    texture.hasAlpha = true;
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = '700 64px "Gmarket Sans", "Pretendard Variable", "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const width = Math.min(480, ctx.measureText(text).width + 56);
    ctx.fillStyle = mine ? '#f2eee1' : '#0c1512cc';
    ctx.beginPath(); ctx.roundRect(256 - width / 2, 18, width, 92, 46); ctx.fill();
    ctx.fillStyle = mine ? '#12201a' : '#f2eee1';
    ctx.fillText(text, 256, 66, 440);
    texture.update();
    const material = new StandardMaterial('name', this.scene);
    material.diffuseTexture = texture; material.emissiveColor = Color3.White(); material.disableLighting = true;
    material.useAlphaFromDiffuseTexture = true; material.backFaceCulling = false;
    const plane = MeshBuilder.CreatePlane('name', { width: 3.2, height: .8 }, this.scene);
    plane.material = material; plane.billboardMode = Mesh.BILLBOARDMODE_ALL; plane.position.y = 2.1;
    return plane;
  }

  private build(player: BumperView['players'][number]): Car {
    const scene = this.scene, color = COLORS[player.slot % COLORS.length];
    const root = new TransformNode(`car-${player.id}`, scene);
    const body = new TransformNode('body', scene); body.parent = root;
    const base = MeshBuilder.CreateCylinder('base', { diameterTop: CAR_RADIUS * 1.5, diameterBottom: CAR_RADIUS * 1.86, height: .62, tessellation: 32 }, scene);
    base.parent = body; base.position.y = .44; base.material = this.material(color, .25);
    const bumper = MeshBuilder.CreateTorus('bumper', { diameter: CAR_RADIUS * 1.9, thickness: .3, tessellation: 32 }, scene);
    bumper.parent = body; bumper.position.y = .26; bumper.material = this.material('#16211d');
    const dome = MeshBuilder.CreateSphere('dome', { diameter: .72, segments: 16 }, scene);
    dome.parent = body; dome.position.set(0, .8, -.16); dome.scaling.y = .7; dome.material = this.material('#1d2b26');
    // Headlights mark the front (+z).
    for (const offset of [-.34, .34]) {
      const lamp = MeshBuilder.CreateSphere('lamp', { diameter: .24, segments: 8 }, scene);
      lamp.parent = body; lamp.position.set(offset, .5, .74); lamp.material = this.material('#fff3b8', 1);
    }
    const shadow = MeshBuilder.CreateDisc('shadow', { radius: CAR_RADIUS * 1.08, tessellation: 24 }, scene);
    shadow.parent = root; shadow.rotation.x = Math.PI / 2; shadow.position.y = .015;
    const dark = new StandardMaterial('shadow', scene);
    dark.diffuseColor = Color3.Black(); dark.specularColor = Color3.Black(); dark.alpha = .28; shadow.material = dark;
    const ring = MeshBuilder.CreateTorus('me', { diameter: CAR_RADIUS * 2.5, thickness: .09, tessellation: 40 }, scene);
    ring.parent = root; ring.position.y = .04; ring.material = this.material('#ffffff', 1); ring.setEnabled(false);
    const label = this.label(player.name, player.id === this.me); label.parent = root;
    return { root, body, label, ring, shadow, name: player.name, x: player.x, z: player.z, yaw: player.yaw };
  }

  private drop(id: string) {
    const car = this.cars.get(id);
    if (!car) return;
    (car.label.material as StandardMaterial).diffuseTexture?.dispose(); car.label.material?.dispose();
    car.shadow.material?.dispose();
    car.root.dispose(false, false);
    this.cars.delete(id);
  }

  /** Feed every server snapshot here. */
  push(view: BumperView, me: string) {
    if (me !== this.me) { this.me = me; for (const id of [...this.cars.keys()]) this.drop(id); }
    this.snapshots.push({ at: performance.now(), view });
    if (this.snapshots.length > 12) this.snapshots.shift();
    const ids = new Set(view.players.map(p => p.id));
    for (const id of [...this.cars.keys()]) if (!ids.has(id)) this.drop(id);
    for (const player of view.players) {
      const existing = this.cars.get(player.id);
      if (existing && existing.name !== player.name) this.drop(player.id);
      if (!this.cars.has(player.id)) this.cars.set(player.id, this.build(player));
    }
    for (const event of view.events) {
      if (event.seq <= this.seenEvent) continue;
      this.seenEvent = event.seq;
      const mine = view.players.some(p => p.id === this.me && (p.slot === event.a || p.slot === event.b));
      if (event.type === 'hit') { this.burst(event.x, event.z, '#fff3b8', .5 + event.power * 1.6); if (mine) this.shake = Math.max(this.shake, .18 + event.power * .5); this.onImpact('hit', mine); }
      if (event.type === 'fall') { this.burst(event.x, event.z, '#ff8a5c', 2.4); this.onImpact('fall', mine); }
      if (event.type === 'dash') this.burst(event.x, event.z, COLORS[event.a % COLORS.length], 1.1);
    }
    if (view.events.length === 0) this.seenEvent = 0;
  }

  private burst(x: number, z: number, color: string, size: number) {
    if (this.motion.matches) return;
    const mesh = MeshBuilder.CreateTorus('burst', { diameter: 1, thickness: .08, tessellation: 28 }, this.scene);
    const material = new StandardMaterial('burst', this.scene);
    material.emissiveColor = Color3.FromHexString(color); material.diffuseColor = Color3.Black(); material.disableLighting = true;
    mesh.material = material; mesh.position.set(x, .12, z);
    this.bursts.push({ mesh, age: 0, life: .38, size });
  }

  private frame(dt: number) {
    const now = performance.now() - DELAY, list = this.snapshots;
    if (!list.length) return;
    let older = list[0], newer = list[list.length - 1];
    for (let i = list.length - 1; i > 0; i--) if (list[i - 1].at <= now) { older = list[i - 1]; newer = list[i]; break; }
    const span = newer.at - older.at;
    const t = span > 0 ? Math.max(0, Math.min(1, (now - older.at) / span)) : 1;
    const view = newer.view;
    const waiting = view.phase === 'lobby' || view.phase === 'finished';

    this.radius += (view.radius - this.radius) * Math.min(1, dt * 8);
    this.floor.scaling.set(this.radius, 1, this.radius);
    this.rim.scaling.set(this.radius, 1, this.radius);

    for (const player of view.players) {
      const car = this.cars.get(player.id);
      if (!car) continue;
      const before = older.view.players.find(p => p.id === player.id) ?? player;
      let turn = player.yaw - before.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      car.x = before.x + (player.x - before.x) * t; car.z = before.z + (player.z - before.z) * t; car.yaw = before.yaw + turn * t;
      const fall = player.alive ? 0 : before.fall + (player.fall - before.fall) * t;
      car.root.position.set(car.x, -6 * fall * fall, car.z);
      car.root.rotation.y = car.yaw;
      car.body.rotation.x = fall * 4.5;
      car.body.scaling.z = player.dashing ? 1.22 : 1; car.body.scaling.x = player.dashing ? .9 : 1;
      car.root.setEnabled(player.alive || fall < 1.7);
      car.shadow.setEnabled(player.alive);
      car.label.setEnabled(player.alive);
      car.ring.setEnabled(player.alive && player.id === this.me && !waiting);
      if (player.id === this.me) car.ring.rotation.y += dt * 1.6;
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i];
      burst.age += dt;
      const k = burst.age / burst.life;
      if (k >= 1) { burst.mesh.material?.dispose(); burst.mesh.dispose(); this.bursts.splice(i, 1); continue; }
      const scale = .6 + burst.size * 2.2 * k;
      burst.mesh.scaling.set(scale, 1, scale);
      (burst.mesh.material as StandardMaterial).alpha = 1 - k;
    }

    // Frame the whole floor at any aspect ratio; drift slowly while waiting in the lobby.
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const half = Math.tan(this.camera.fov / 2);
    const fit = this.radius + 2.2;
    const wanted = Math.max(fit / (half * Math.max(.01, aspect)), fit / half * 1.04);
    this.distance += (wanted - this.distance) * Math.min(1, dt * 3);
    if (waiting && !this.motion.matches) this.orbit += dt * .12;
    else { this.orbit = Math.atan2(Math.sin(this.orbit), Math.cos(this.orbit)); this.orbit *= Math.max(0, 1 - dt * 7); }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const jitter = this.motion.matches ? 0 : this.shake;
    const back = this.distance * .55, up = this.distance * .84;
    this.camera.position.set(Math.sin(this.orbit) * back + (Math.random() - .5) * jitter, up + (Math.random() - .5) * jitter, -Math.cos(this.orbit) * back);
    this.camera.setTarget(new Vector3(0, -.4, 0).addInPlaceFromFloats(-Math.sin(this.orbit) * this.radius * .06, 0, -Math.cos(this.orbit) * this.radius * .06));
  }

  dispose() {
    this.observer.disconnect();
    window.removeEventListener('resize', this.resize);
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}

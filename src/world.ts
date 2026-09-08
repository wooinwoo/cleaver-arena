import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer.js';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import '@babylonjs/loaders/glTF/glTFFileLoader.js';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit.js';
import '@babylonjs/core/Culling/ray.js';
import { ARENA_RADIUS, HALF_X, HALF_Z, OBSTACLES, GHOST_MULTIPLIER, move, type ArenaMap, type Game, type Input } from '../shared/game.ts';

import { COLORS } from './palette.ts';
type Avatar = { root: TransformNode; body: TransformNode; arm: TransformNode; ring: Mesh; bar: Mesh; hp: number; color: string; instance?: InstantiatedEntries; clips?: AnimationGroup[]; animation?: string; flashes?: number };

export class World {
  engine: Engine;
  scene: Scene;
  camera: FreeCamera;
  view: 'top' | 'fps' = 'top';
  yaw = 0;
  state: Game | null = null;
  id = '';
  input: Input = { x: 0, z: 0, yaw: 0, fire: false };
  avatars = new Map<string, Avatar>();
  projectiles = new Map<number, TransformNode>();
  private materials = new Map<string, StandardMaterial>();
  private model?: AssetContainer;
  private weapon?: AssetContainer;
  private baron?: AssetContainer;
  private baronLoading = false;
  private hand: TransformNode;
  private preview: Avatar[] = [];
  private arena?: TransformNode;
  private map: ArenaMap = 'ward';
  private elapsed = 0;
  private priorShot = -1;
  onShot = () => {};
  onHit = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false }, true);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 1.5));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#183d47ff');
    this.scene.ambientColor = new Color3(.25, .32, .32);
    const ambient = new HemisphericLight('softbox', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = .7;
    ambient.groundColor = Color3.FromHexString('#496b6b');
    const sun = new DirectionalLight('sun', new Vector3(-.6, -1, .5), this.scene);
    sun.intensity = .55;
    sun.diffuse = Color3.FromHexString('#fff0cf');
    this.camera = new FreeCamera('camera', new Vector3(21, 27, -25), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = .07;
    this.camera.maxZ = 180;
    this.camera.fov = .85;
    this.camera.setTarget(Vector3.Zero());
    this.buildArena();
    this.hand = new TransformNode('first-person-cleaver', this.scene);
    this.hand.parent = this.camera;
    this.hand.position.set(.4, -.4, 1.1);
    this.hand.rotation.set(-.2, .2, -.25);
    this.cleaver(this.hand, .65);
    this.hand.setEnabled(false);
    for (let i = 0; i < 2; i++) {
      const avatar = this.avatar('preview-' + i, COLORS[i]);
      avatar.root.position.set(i === 0 ? -5 : 5, 0, 0);
      avatar.root.rotation.y = i === 0 ? Math.PI / 2 : -Math.PI / 2;
      this.preview.push(avatar);
    }
    void this.loadMundo();
    this.engine.runRenderLoop(() => {
      this.update(Math.min(.05, this.engine.getDeltaTime() / 1000));
      this.scene.render();
    });
    new ResizeObserver(() => this.engine.resize()).observe(canvas);
    window.addEventListener('resize', () => this.engine.resize());
  }

  private async loadMundo() {
    const results = await Promise.allSettled(['mundo', 'mundo-cleaver'].map(async name => {
      const response = await fetch(`/models/${name}.glb`);
      if (!response.ok) throw new Error(`모델 다운로드 실패: ${response.status}`);
      return LoadAssetContainerAsync(new Uint8Array(await response.arrayBuffer()), this.scene, { pluginExtension: '.glb' });
    }));
    if (results.some(result => result.status === 'rejected')) {
      results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
      this.canvas.dataset.models = 'fallback'; return;
    }
    [this.model, this.weapon] = results.map(result => (result as PromiseFulfilledResult<AssetContainer>).value);
    for (const avatar of [...this.preview, ...this.avatars.values()]) this.attachMundo(avatar);
    this.hand.getChildren().forEach(node => node.dispose());
    this.cleaver(this.hand, .65);
    this.canvas.dataset.models = 'mundo';
  }

  private attachMundo(avatar: Avatar) {
    avatar.body.getChildren().forEach(node => node.dispose());
    const instance = this.model!.instantiateModelsToScene(name => `${avatar.root.name}-${name}`, false, { doNotInstantiate: true });
    instance.rootNodes.forEach(node => { node.parent = avatar.body; });
    avatar.instance = instance;
    avatar.clips = instance.animationGroups;
    avatar.arm = new TransformNode('throwing-arm', this.scene); avatar.arm.parent = avatar.body;
    this.animateAvatar(avatar, 'idle');
  }

  private animateAvatar(avatar: Avatar, name: string) {
    if (!avatar.clips || avatar.animation === name) return;
    avatar.clips.forEach(clip => clip.stop());
    const clip = avatar.clips.find(clip => clip.name.replace(/\.\d+$/, '').endsWith(`-${name}`));
    clip?.start(name === 'run' || name === 'idle');
    avatar.animation = name;
  }

  private disposeAvatar(avatar: Avatar) {
    avatar.instance?.dispose();
    avatar.root.dispose();
  }

  private material(color: string, glow = false) {
    const key = color + glow;
    if (!this.materials.has(key)) {
      const material = new StandardMaterial(key, this.scene);
      material.diffuseColor = Color3.FromHexString(color).toLinearSpace();
      material.specularColor = new Color3(.1, .1, .1);
      if (glow) material.emissiveColor = Color3.FromHexString(color).scale(.5);
      this.materials.set(key, material);
    }
    return this.materials.get(key)!;
  }

  private box(name: string, size: number[], at: number[], color: string, parent?: TransformNode) {
    const mesh = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    mesh.position.set(at[0], at[1], at[2]);
    mesh.material = this.material(color);
    if (parent) mesh.parent = parent;
    return mesh;
  }

  private sphere(name: string, size: number[], at: number[], color: string, parent?: TransformNode) {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 8 }, this.scene);
    mesh.scaling.set(size[0], size[1], size[2]);
    mesh.position.set(at[0], at[1], at[2]);
    mesh.material = this.material(color);
    if (parent) mesh.parent = parent;
    return mesh;
  }

  private cylinder(name: string, diameter: number, height: number, at: number[], color: string, parent?: TransformNode) {
    const mesh = MeshBuilder.CreateCylinder(name, { diameter, height, tessellation: 24 }, this.scene);
    mesh.position.set(at[0], at[1], at[2]);
    mesh.material = this.material(color);
    if (parent) mesh.parent = parent;
    return mesh;
  }

  setMap(map: ArenaMap) {
    if (this.map === map) return;
    this.map = map;
    this.buildArena();
    if (map === 'baron') void this.loadBaron();
  }

  private async loadBaron() {
    if (this.baron || this.baronLoading) return;
    this.baronLoading = true;
    try {
      const response = await fetch('/models/baron-pit.glb');
      if (!response.ok) throw new Error(`맵 다운로드 실패: ${response.status}`);
      this.baron = await LoadAssetContainerAsync(new Uint8Array(await response.arrayBuffer()), this.scene, { pluginExtension: '.glb' });
      if (this.map === 'baron') this.buildArena();
    } catch { this.canvas.dataset.mapModel = 'fallback'; }
    finally { this.baronLoading = false; }
  }

  private buildArena() {
    this.arena?.dispose();
    this.arena = new TransformNode('arena', this.scene);
    const firstMesh = this.scene.meshes.length;
    if (this.map === 'arena') this.buildOriginalArena();
    else this.buildWardArena();
    for (const mesh of this.scene.meshes.slice(firstMesh)) if (!mesh.parent) mesh.parent = this.arena;
    if (this.map === 'baron' && this.baron) {
      this.baron.instantiateModelsToScene(name => `baron-${name}`, false).rootNodes.forEach(node => { node.parent = this.arena!; });
      this.canvas.dataset.mapModel = 'baron';
    } else if (this.map !== 'baron') delete this.canvas.dataset.mapModel;
  }

  private buildWardArena() {
    if (this.map !== 'baron' || !this.baron) {
    const base = MeshBuilder.CreateCylinder('round-court', { diameter: ARENA_RADIUS * 2 + .5, height: .8, tessellation: 96 }, this.scene);
    base.position.y = -.42; base.material = this.material('#355a5c');
    for (const team of [0, 1]) {
      const half = MeshBuilder.CreateDisc('half-court-' + team, { radius: ARENA_RADIUS, tessellation: 64, arc: .5, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
      half.rotation.set(Math.PI / 2, team === 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      half.position.y = .01;
      half.material = this.material(team === 0 ? '#88b5a1' : '#c6aa96');
    }
    }
    const edge = MeshBuilder.CreateTorus('court-boundary', { diameter: ARENA_RADIUS * 2, thickness: .09, tessellation: 96 }, this.scene);
    edge.position.y = .05; edge.material = this.material('#e9edcc');
    this.box('ward-line', [.08, .025, ARENA_RADIUS * 2], [0, .045, 0], '#e9edcc');
    // Wards mark the movement boundary. Cleavers pass over them without colliding.
    for (let z = -9; z <= 9; z += 1.5) {
      this.cylinder('ward-base', .48, .18, [0, .1, z], '#456c61');
      this.cylinder('ward-stem', .16, .55, [0, .4, z], '#b4b582');
      for (const side of [-1, 1]) {
        const wing = this.sphere('ward-wing', [.18, .5, .22], [side * .17, .67, z], '#638b6a');
        wing.rotation.z = side * -.45;
      }
      const eye = this.sphere('ward-eye', [.32, .32, .32], [0, .88, z], '#e1f69b');
      eye.material = this.material('#e1f69b', true);
    }
    this.box('distant-floor', [200, .2, 200], [0, -3, 0], '#173d46');
  }

  private buildOriginalArena() {
    this.box('floating-base', [26, 1.2, 20], [0, -.75, 0], '#254d55');
    this.box('court', [24, .18, 18], [0, -.08, 0], '#79a59b');
    for (let x = -10; x <= 10; x += 2) for (let z = -8; z <= 8; z += 2) {
      this.box('floor-tile', [1.94, .02, 1.94], [x, .025, z], (x + z) % 4 === 0 ? '#87afa0' : '#81a89d');
    }
    this.box('center-line', [.08, .025, 18], [0, .045, 0], '#deebc4');
    for (const z of [-HALF_Z, HALF_Z]) {
      this.box('low-wall', [24.5, .75, .4], [0, .28, z], '#355a5c');
      this.box('wall-cap', [24.5, .08, .48], [0, .68, z], '#bdcdb3');
    }
    for (const x of [-HALF_X, HALF_X]) {
      this.box('low-wall', [.4, .75, 18], [x, .28, 0], '#355a5c');
      this.box('wall-cap', [.48, .08, 18], [x, .68, 0], '#bdcdb3');
    }
    const circle = MeshBuilder.CreateTorus('center-ring', { diameter: 4, thickness: .055, tessellation: 64 }, this.scene);
    circle.position.y = .06;
    circle.material = this.material('#e1edc9');
    for (const obstacle of OBSTACLES) {
      this.cylinder('pod-base', obstacle.radius * 2, .25, [obstacle.x, .12, obstacle.z], '#294f55');
      this.cylinder('lab-pod', obstacle.radius * 1.7, 2.6, [obstacle.x, 1.45, obstacle.z], '#487d79');
      this.cylinder('pod-band', obstacle.radius * 1.8, .22, [obstacle.x, 1.7, obstacle.z], '#cfe98d');
      this.cylinder('pod-cap', obstacle.radius * 2, .3, [obstacle.x, 2.9, obstacle.z], '#c1d0b2');
      this.sphere('specimen', [.7, .8, .7], [obstacle.x, 3.25, obstacle.z], '#cfe98d');
    }
    for (const x of [-11, 11]) for (const z of [-8, 8]) {
      this.cylinder('corner-bolt', .7, 1.1, [x, .55, z], '#294f55');
      this.cylinder('corner-light', .55, .15, [x, 1.15, z], '#f4ca7f');
    }
    for (let i = -2; i <= 2; i++) this.box('front-vent', [1.2, .15, .04], [i * 2, -.7, -10.01], '#8fbbb0');
    // The surrounding geometry is scenery; the authoritative court bounds stay in shared/game.ts.
    this.box('distant-floor', [200, .2, 200], [0, -3, 0], '#173d46');
    for (const x of [-19, 19]) for (const z of [-14, 14]) {
      this.box('lab-crate', [2.4, 2, 2.4], [x, -1.7, z], '#285360');
      this.box('crate-band', [2.45, .2, 2.45], [x, -1, z], '#4c7880');
    }
  }

  private cleaver(parent: TransformNode, scale = 1) {
    const knife = new TransformNode('cleaver', this.scene);
    knife.parent = parent;
    knife.scaling.setAll(scale);
    if (this.weapon) {
      this.weapon.instantiateModelsToScene(name => `knife-${name}`, false).rootNodes.forEach(node => { node.parent = knife; });
      return knife;
    }
    this.box('handle', [.13, .48, .14], [0, 0, 0], '#705448', knife);
    this.box('blade', [.42, .53, .08], [.13, .46, 0], '#e1e9da', knife);
    this.box('sharp-edge', [.07, .53, .09], [.37, .46, 0], '#ffffff', knife);
    this.sphere('rivet', [.08, .08, .09], [.04, .57, .04], '#49676a', knife);
    return knife;
  }

  private avatar(id: string, color: string): Avatar {
    const root = new TransformNode(id, this.scene);
    const body = new TransformNode(id + '-body', this.scene);
    body.parent = root;
    this.sphere('torso', [1.1, 1.25, .76], [0, .94, 0], color, body);
    this.box('shorts', [.76, .38, .66], [0, .42, 0], '#43516b', body);
    this.sphere('head', [.92, .82, .76], [0, 1.69, .12], color, body);
    this.sphere('jaw', [.77, .38, .65], [0, 1.45, .29], color, body);
    for (const side of [-1, 1]) {
      this.sphere('shoulder', [.48, .5, .5], [side * .55, 1.18, 0], color, body);
      this.sphere('boot', [.36, .34, .57], [side * .24, .18, .11], '#35424a', body);
      this.sphere('eye', [.3, .27, .12], [side * .23, 1.77, .48], '#fff8dc', body);
      this.sphere('pupil', [.12, .14, .08], [side * .22, 1.76, .55], '#15313a', body);
      const brow = this.box('brow', [.32, .08, .11], [side * .23, 1.94, .48], '#405d56', body);
      brow.rotation.z = side * -.2;
    }
    this.box('smile', [.4, .09, .08], [0, 1.48, .61], '#514e4d', body);
    this.box('tooth', [.12, .11, .09], [.07, 1.5, .66], '#fff6d2', body);
    this.box('hair', [.7, .16, .46], [0, 2.08, .07], '#40556a', body);
    const arm = new TransformNode('throwing-arm', this.scene);
    arm.parent = body;
    arm.position.set(-.62, .85, .1);
    this.sphere('fist', [.4, .43, .4], [0, 0, 0], color, arm);
    this.cleaver(arm, .85).position.set(0, .07, .24);
    const ring = MeshBuilder.CreateTorus('player-ring', { diameter: 1.4, thickness: .07, tessellation: 32 }, this.scene);
    ring.parent = root; ring.position.y = .09; ring.material = this.material(color, true);
    const shadow = this.cylinder('contact-shadow', 1.2, .012, [0, .04, 0], '#557d74', root);
    shadow.scaling.z = .8;
    const bar = this.box('health-bar', [.95, .08, .08], [0, 2.43, 0], color, root);
    const avatar = { root, body, arm, ring, bar, hp: 100, color };
    if (this.model) this.attachMundo(avatar);
    return avatar;
  }

  reset() {
    for (const avatar of this.avatars.values()) this.disposeAvatar(avatar);
    for (const shot of this.projectiles.values()) shot.dispose();
    this.avatars.clear(); this.projectiles.clear();
    this.state = null; this.id = ''; this.priorShot = -1;
    this.preview.forEach(avatar => avatar.root.setEnabled(true));
  }

  setView(view: 'top' | 'fps') {
    if (this.state && view !== this.state.view) return;
    this.view = view;
    this.hand.setEnabled(view === 'fps' && !!this.state);
    if (view === 'fps' && !this.state) this.yaw = 0;
    this.engine.resize();
  }

  applyState(game: Game, id: string) {
    const reset = !this.state || this.state.round !== game.round;
    this.setMap(game.map);
    this.state = game;
    if (this.view !== game.view) this.setView(game.view);
    this.id = id;
    this.preview.forEach(p => p.root.setEnabled(false));
    for (const player of game.players) {
      let avatar = this.avatars.get(player.id);
      const color = COLORS[game.mode === 'teams' || game.map !== 'arena' ? player.team : player.slot];
      if (avatar && avatar.color !== color) { this.disposeAvatar(avatar); avatar = undefined; }
      if (!avatar) { avatar = this.avatar(player.id, color); this.avatars.set(player.id, avatar); }
      avatar.ring.material = this.material(player.id === id ? '#fff8dc' : color, true);
      if (player.id === id) {
        if (reset || (avatar.flashes !== undefined && avatar.flashes !== player.flashes)) { avatar.root.position.set(player.x, 0, player.z); this.yaw = player.yaw; }
        else {
          const d = Math.hypot(avatar.root.position.x - player.x, avatar.root.position.z - player.z);
          const amount = d > 2 ? 1 : .35;
          avatar.root.position.x += (player.x - avatar.root.position.x) * amount;
          avatar.root.position.z += (player.z - avatar.root.position.z) * amount;
        }
        if (avatar.hp > player.hp) this.onHit();
      } else if (reset || (avatar.flashes !== undefined && avatar.flashes !== player.flashes)) avatar.root.position.set(player.x, 0, player.z);
      avatar.flashes = player.flashes;
      avatar.hp = player.hp;
      avatar.bar.scaling.x = Math.max(.001, player.hp / 100);
    }
    for (const [playerId, avatar] of this.avatars) if (!game.players.some(p => p.id === playerId)) { this.disposeAvatar(avatar); this.avatars.delete(playerId); }
    if (game.nextShot > this.priorShot && this.priorShot >= 0 && !reset) this.onShot();
    this.priorShot = game.nextShot;
  }

  aimAt(screenX: number, screenY: number) {
    if (this.view !== 'top') return;
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    const ray: Ray = this.scene.createPickingRay(x, y, null, this.camera);
    if (Math.abs(ray.direction.y) < .001) return;
    const distance = (1.45 - ray.origin.y) / ray.direction.y;
    const origin = this.avatars.get(this.id)?.root.position ?? Vector3.Zero();
    this.yaw = Math.atan2(ray.origin.x + ray.direction.x * distance - origin.x, ray.origin.z + ray.direction.z * distance - origin.z);
  }

  private update(dt: number) {
    this.elapsed += dt;
    const game = this.state;
    const mine = game?.players.find(p => p.id === this.id);
    for (const player of game?.players ?? []) {
      const avatar = this.avatars.get(player.id)!;
      const local = player.id === this.id;
      const position = avatar.root.position;
      if (local && game?.phase === 'playing' && player.hp > 0) move(position, this.input.x, this.input.z, dt, player.team, game.map, player.ghostTime > 0 ? GHOST_MULTIPLIER : 1);
      if (!local) {
        position.x += (player.x - position.x) * Math.min(1, dt * 18);
        position.z += (player.z - position.z) * Math.min(1, dt * 18);
      }
      avatar.root.rotation.y = local ? this.yaw : player.yaw;
      avatar.root.setEnabled((player.hp > 0 || !!avatar.instance) && !(local && this.view === 'fps'));
      avatar.bar.setEnabled(player.hp > 0);
      avatar.ring.setEnabled(player.hp > 0);
      const walking = game?.phase === 'playing' && Math.hypot(player.input.x, player.input.z) > .1;
      this.animateAvatar(avatar, player.hp <= 0 ? 'death' : player.cooldown > .4 ? 'throw' : walking ? 'run' : 'idle');
      avatar.body.position.y = !avatar.clips && walking ? Math.abs(Math.sin(this.elapsed * 12)) * .07 : 0;
      avatar.arm.rotation.x = player.cooldown > .4 ? -.8 : Math.sin(this.elapsed * 2) * .05;
      avatar.ring.scaling.setAll(player.ghostTime > 0 ? 1.15 + Math.sin(this.elapsed * 12) * .08 : 1);
    }
    for (const shot of game?.shots ?? []) {
      let node = this.projectiles.get(shot.id);
      if (!node) {
        node = new TransformNode('shot-' + shot.id, this.scene);
        this.cleaver(node, .85);
        this.projectiles.set(shot.id, node);
      }
      node.position.set(shot.x, 1.45, shot.z);
      node.rotation.set(this.elapsed * 22, Math.atan2(shot.vx, shot.vz), Math.PI / 2);
    }
    for (const [id, mesh] of this.projectiles) if (!game?.shots.some(s => s.id === id)) { mesh.dispose(); this.projectiles.delete(id); }
    const minePosition = this.avatars.get(this.id)?.root.position;
    if (this.view === 'fps') {
      // Cleavers travel at reticle height; body hitboxes remain a top-down circle on the server.
      this.camera.position.set(minePosition?.x ?? 0, 1.45, minePosition?.z ?? -6);
      this.camera.setTarget(this.camera.position.add(new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))));
      this.hand.setEnabled(!!mine && mine.hp > 0);
      this.hand.rotation.x = -.2 - Math.max(0, (mine?.cooldown ?? 0) - .35) * 2;
    } else {
      this.hand.setEnabled(false);
      const aspect = this.engine.getRenderWidth() / this.engine.getRenderHeight();
      const distance = Math.max(29, 21 / Math.max(.35, aspect));
      if (!game) {
        this.camera.position.set(distance * .5, distance * .8, -distance * .8);
        this.camera.setTarget(new Vector3(0, 0, 0));
        this.preview.forEach((p, i) => { p.body.position.y = Math.sin(this.elapsed * 2 + i) * .07; });
      } else {
        this.camera.position.set(0, distance, -distance * .75);
        this.camera.setTarget(Vector3.Zero());
      }
    }
  }
}

// The player's monster: movement, growth, bite / tail / stomp / breath / roar / rampage, and the chase camera.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { A } from './assets.js';
import { tier } from './data.js';
import { clamp, damp, dampAngle, angleDiff, lerp, rand, TAU, smooth } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// Shared rig for every animated titan (player kaiju and bosses).
export class Titan {
  constructor(G, def) {
    this.G = G;
    this.def = def;
    const g = A.gltf[def.model];
    this.model = cloneSkinned(g.scene);
    this.group = new THREE.Group();
    this.group.add(this.model);
    this.mats = [];
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
        o.material = o.material.clone();
        o.material.envMapIntensity = 1.0;
        this.mats.push(o.material);
      }
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = {};
    this.actions = {};
    for (const c of g.animations) this.clips[c.name] = c;
    // distance covered by one walk / run cycle at model scale (from the root-motion variants)
    this.cycleDist = { walk: this.rootDistance(def.clips.walk + '_Root') || def.modelHeight * 1.1, run: this.rootDistance(def.clips.run + '_Root') || def.modelHeight * 1.6 };
    this.head = this.model.getObjectByName(def.headBone) || this.model;
    this.size = 10;
    this.pos = this.group.position;
    this.yaw = 0;
    this.oneShot = null;
    this.locoW = 1;
    this.flashT = 0;
    this.glow = new THREE.Color(0, 0, 0);
    this.glowI = 0;
    for (const k of ['idle', 'walk', 'run']) {
      const name = def.clips[k];
      if (name && this.clips[name] && !this.actions[name]) {
        const a = this.mixer.clipAction(this.clips[name]);
        a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0);
        this.actions[name] = a;
      }
    }
    this.moveBlend = 0; this.runBlend = 0;
  }

  rootDistance(name) {
    const c = this.clips[name];
    if (!c) return 0;
    let best = 0;
    for (const t of c.tracks) {
      if (!t.name.endsWith('.position')) continue;
      const v = t.values, n = v.length;
      const d = Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]);
      if (d > best) best = d;
    }
    return best;
  }

  setSize(s) {
    this.size = s;
    this.model.scale.setScalar(s / this.def.modelHeight);
  }

  // speed in m/s, running 0..1
  locomotion(dt, speed, running) {
    const d = this.def;
    const moving = speed > this.size * 0.04 ? 1 : 0;
    this.moveBlend = damp(this.moveBlend, moving, 9, dt);
    this.runBlend = damp(this.runBlend, running, 7, dt);
    const idle = this.actions[d.clips.idle], walk = this.actions[d.clips.walk], run = this.actions[d.clips.run];
    const w = this.locoW;
    if (idle && idle === walk) { idle.setEffectiveWeight(w); idle.timeScale = 1; return; }
    const same = walk === run;
    if (idle) idle.setEffectiveWeight((1 - this.moveBlend) * w);
    if (walk) walk.setEffectiveWeight(this.moveBlend * (same ? 1 : 1 - this.runBlend) * w);
    if (run && !same) run.setEffectiveWeight(this.moveBlend * this.runBlend * w);
    const sc = this.size / d.modelHeight;
    if (walk) {
      const natural = (this.cycleDist.walk * sc) / walk.getClip().duration;
      walk.timeScale = clamp((speed / Math.max(natural, 0.01)) * (same ? 1 + this.runBlend * ((d.runAnimBoost || 1) - 1) * 0.3 : 1), 0.4, 3.2);
    }
    if (run && !same) {
      const natural = (this.cycleDist.run * sc) / run.getClip().duration;
      run.timeScale = clamp(speed / Math.max(natural, 0.01), 0.5, 3.0);
    }
  }

  // Play a one-shot clip over a fixed real duration.
  play(key, duration, weightOut = 0.15) {
    const name = this.def.clips[key];
    const clip = this.clips[name];
    if (!clip) return null;
    let a = this.actions['once_' + name];
    if (!a) {
      a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      this.actions['once_' + name] = a;
    }
    if (this.oneShot && this.oneShot.action !== a) this.oneShot.action.fadeOut(0.12);
    a.reset();
    a.timeScale = clip.duration / duration;
    a.setEffectiveWeight(1);
    a.fadeIn(0.1);
    a.play();
    this.oneShot = { action: a, t: 0, dur: duration, weightOut };
    return a;
  }

  updateAnim(dt) {
    const o = this.oneShot;
    if (o) {
      o.t += dt;
      const target = o.weightOut;
      this.locoW = damp(this.locoW, target, 14, dt);
      if (o.t >= o.dur) { o.action.fadeOut(0.22); this.oneShot = null; }
    } else this.locoW = damp(this.locoW, 1, 8, dt);
    this.mixer.update(dt);
    // emissive: hit flash + glow
    this.flashT = Math.max(0, this.flashT - dt);
    const f = this.flashT > 0 ? this.flashT / 0.14 : 0;
    const gi = this.glowI;
    for (const m of this.mats) {
      if (!m.emissive) continue;
      m.emissive.setRGB(f * 0.9 + this.glow.r * gi, f * 0.9 + this.glow.g * gi, f * 0.9 + this.glow.b * gi);
      m.emissiveIntensity = 1;
    }
  }

  headPos(out) {
    this.group.updateMatrixWorld(true);
    return this.head.getWorldPosition(out);
  }
}

export class CameraRig {
  constructor(G) {
    this.G = G;
    this.cam = G.camera;
    this.yaw = Math.PI; this.pitch = 0.3;
    this.dist = 30; this.fov = 58;
    this.target = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.kick = 0;
    this.orbit = 0;
  }
  snap(player) {
    this.yaw = player.yaw + Math.PI;
    this.target.set(player.pos.x, player.size * 0.7, player.pos.z);
    this.dist = player.size * 3.1;
  }
  update(dt, rawDt, player, input) {
    const s = player.size;
    const set = this.G.save.settings;
    if (this.orbit) this.yaw += this.orbit * rawDt;
    this.yaw -= input.lookX * 0.0026 * set.sens;
    this.pitch = clamp(this.pitch + input.lookY * 0.0022 * set.sens * (set.invertY ? -1 : 1), -0.12, 1.05);
    this.yaw += input.keyLook * rawDt * 2.0;
    const wantDist = s * (3.0 + this.pitch * 0.5) * (player.rampage > 0 ? 1.12 : 1) * (this.zoom || 1);
    this.dist = damp(this.dist, wantDist, 3, rawDt);
    const ty = player.pos.y + s * 0.78 + player.jumpY * 0.5;
    this.target.x = damp(this.target.x, player.pos.x, 12, rawDt);
    this.target.z = damp(this.target.z, player.pos.z, 12, rawDt);
    this.target.y = damp(this.target.y, ty, 8, rawDt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const side = s * 0.42; // over-the-shoulder offset
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.pos.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist + rx * side,
      Math.max(this.target.y + sp * this.dist, s * 0.12 + 1),
      this.target.z + Math.cos(this.yaw) * cp * this.dist + rz * side,
    );
    const cam = this.cam;
    cam.position.copy(this.pos).add(this.G.fx.shakeOff);
    _v.set(this.target.x + rx * side, this.target.y + s * 0.12, this.target.z + rz * side);
    cam.lookAt(_v);
    cam.rotateZ(this.G.fx.shakeRot);
    this.kick = damp(this.kick, 0, 5, rawDt);
    const fov = this.fov + (player.sprinting ? 7 : 0) + this.kick + (player.rampage > 0 ? 5 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 6, rawDt); cam.updateProjectionMatrix(); }
    const near = clamp(s * 0.06, 0.6, 6);
    if (Math.abs(cam.near - near) > 0.05) { cam.near = near; cam.updateProjectionMatrix(); }
  }
  // forward on the ground plane
  forward(out) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
}

export class Kaiju extends Titan {
  constructor(G, def) {
    super(G, def);
    const save = G.save;
    this.up = {
      hide: tier(save, 'hide'), jaws: tier(save, 'jaws'), breath: tier(save, 'breath'), stomp: tier(save, 'stomp'),
      roar: tier(save, 'roar'), regen: tier(save, 'regen'), growth: tier(save, 'growth'), rage: tier(save, 'rage'), legs: tier(save, 'legs'),
    };
    this.maxHp = 100 * def.stats.hp * (1 + 0.2 * this.up.hide);
    this.hp = this.maxHp;
    this.maxEnergy = 100 * (1 + 0.18 * this.up.breath);
    this.energy = this.maxEnergy;
    this.energyDelay = 0;
    this.rage = 0; this.rampage = 0;
    this.vel = new THREE.Vector3();
    this.jumpY = 0; this.jumpV = 0; this.airborne = false;
    this.action = null;
    this.combo = 0; this.comboT = 0;
    this.roarCd = 0; this.stompCd = 0;
    this.breathing = false;
    this.stepAcc = 0; this.stepSide = 1;
    this.sprinting = false;
    this.dead = false; this.deadT = 0;
    this.iframes = 0;
    this.targetSize = 10;
    this.aim = new THREE.Vector3();
    this.mouth = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.spin = 0;
    this.lunge = 0;
    this.hurtT = 0;
    this.buildBeam();
    G.scene.add(this.group);
  }

  buildBeam() {
    const bd = this.def.beam;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.5);
    const mk = (color, op) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });
    this.beamCore = new THREE.Mesh(geo, mk(bd.core, 0.95));
    this.beamGlow = new THREE.Mesh(geo, mk(bd.glow, 0.4));
    this.beamGlow2 = new THREE.Mesh(geo, mk(bd.glow, 0.16));
    this.beam = new THREE.Group();
    this.beam.add(this.beamCore, this.beamGlow, this.beamGlow2);
    this.beam.visible = false;
    for (const m of this.beam.children) { m.frustumCulled = false; m.renderOrder = 9; }
    this.G.scene.add(this.beam);
    this.beamLight = new THREE.PointLight(bd.glow, 0, 200, 1.4);
    this.G.scene.add(this.beamLight);
    this.beamColor = new THREE.Color(bd.glow);
  }

  get meleeDamage() {
    return 100 * this.def.stats.melee * (1 + 0.22 * this.up.jaws) * Math.pow(this.size / 10, 1.3) * (this.rampage > 0 ? 2 : 1);
  }
  get radius() { return this.size * this.def.radius; }
  get baseSpeed() { return (4 + this.size * 0.45) * this.def.stats.speed * (1 + 0.07 * this.up.legs); }

  spawn(x, z, yaw, size) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.targetSize = size;
    this.setSize(size);
    this.group.rotation.y = yaw;
  }

  hurt(amount, sx, sz) {
    if (this.dead || this.rampage > 0 || this.iframes > 0 || this.G.game.state !== 'play') return;
    this.hp -= amount;
    this.hurtT = 0.35;
    this.flashT = 0.14;
    this.G.ui.damageFlash(clamp(amount / this.maxHp * 6, 0.25, 1));
    this.G.fx.shake(clamp(amount / this.maxHp * 2.5, 0.05, 0.35));
    this.G.game.stats.damageTaken += amount;
    if (amount > this.maxHp * 0.07 && !this.action) {
      this.play('hit', 0.5, 0.4);
      this.G.audio.play('punch', { vol: 0.7, rate: 0.6 });
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
  }
  heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); }

  die() {
    this.dead = true; this.deadT = 0;
    this.action = null; this.stopBeam();
    this.play('hit', 1.6, 0);
    this.G.audio.roar(1.0, 0.7);
    this.G.fx.slowMo(0.3, 2.2);
    this.G.game.onPlayerDeath();
  }

  addRage(v) {
    if (this.rampage > 0) return;
    this.rage = Math.min(1, this.rage + v * (1 + 0.2 * this.up.rage));
  }

  startRampage() {
    if (this.rage < 1 || this.rampage > 0 || this.dead) return;
    const G = this.G;
    this.rage = 0;
    this.rampageMax = 8 + 1.2 * this.up.rage;
    this.rampage = this.rampageMax;
    this.glow.setRGB(1.0, 0.25, 0.05);
    G.audio.roar(1.2, 1.1);
    G.audio.play('powerUp10', { vol: 0.9, rate: 0.6 });
    G.fx.ring(this.pos.x, this.pos.z, this.size * 0.5, this.size * 5, 0.8, 1, 0.5, 0.2, 1, 0.8);
    G.fx.shake(0.6); G.fx.hitStop(0.08);
    G.ui.banner('RAMPAGE!', 'INVULNERABLE - DOUBLE DAMAGE', 'rage');
    G.units.roar(this.pos.x, this.pos.z, this.size * 5, 3);
    this.heal(this.maxHp * 0.15);
  }

  // --- actions ------------------------------------------------------------------------------------
  tryAttack() {
    if (this.dead || this.airborne) return;
    if (this.action && this.action.t < this.action.dur * 0.72) { this.action.queued = true; return; }
    const d = this.def;
    this.comboT = 1.1;
    this.combo = (this.combo % 3) + 1;
    if (this.combo === 3) {
      const dur = 0.62;
      this.action = { type: 'tail', t: 0, dur, hit: false, hits: 0 };
      this.G.audio.play('thud', { vol: 0.7, rate: 0.7 });
    } else {
      const clip = this.clips[d.clips.attack];
      const dur = clip ? clip.duration / d.attackRate : 0.8;
      this.action = { type: 'attack', t: 0, dur, hit: false };
      this.play('attack', dur, 0.1);
    }
  }

  tryStomp() {
    if (this.dead || this.airborne || this.stompCd > 0) return;
    if (this.action && this.action.type !== 'attack') return;
    const d = this.def;
    const clip = this.clips[d.clips.stomp];
    const dur = 0.95;
    this.action = { type: 'stomp', t: 0, dur, hit: false };
    this.play('stomp', clip ? Math.max(dur, clip.duration / d.stompRate) : dur, 0.05);
    this.airborne = true;
    this.jumpV = this.size * 2.3;
    this.stompCd = 1.9;
    this.G.audio.play('thud', { vol: 0.8, rate: 0.6 });
    this.G.fx.dust(this.pos.x, 0, this.pos.z, this.size * 0.35, 5);
  }

  tryRoar() {
    if (this.dead || this.roarCd > 0 || this.airborne) return;
    if (this.action && this.action.type !== 'attack') return;
    const d = this.def;
    const clip = this.clips[d.clips.roar];
    const dur = clip ? clamp(clip.duration / d.roarRate, 1.2, 2.2) : 1.6;
    this.action = { type: 'roar', t: 0, dur, hit: false };
    this.play('roar', dur, 0.05);
    this.roarCdMax = 14 * (1 - 0.1 * this.up.roar);
    this.roarCd = this.roarCdMax;
  }

  strike(x, y, z, r, dmg, src) {
    return this.G.game.strike(x, y, z, r, dmg, this.fwd.x, 0.35, this.fwd.z, src);
  }

  doBite() {
    const G = this.G, s = this.size;
    const m = this.headPos(_v).addScaledVector(this.fwd, s * this.def.mouthFwd);
    const dmg = this.meleeDamage;
    const a = this.strike(m.x, m.y, m.z, s * 0.4, dmg, 'bite');
    // lower body / claws: catches the things at your feet
    const b = this.strike(this.pos.x + this.fwd.x * s * 0.62, s * 0.3, this.pos.z + this.fwd.z * s * 0.62, s * 0.42, dmg * 0.75, 'bite');
    const hit = a.cells + b.cells + a.units + b.units + (a.boss || b.boss ? 3 : 0);
    G.units.crush(this.pos.x + this.fwd.x * s * 0.6, this.pos.z + this.fwd.z * s * 0.6, s * 0.45, this.fwd.x * s, this.fwd.z * s, 1.2, 'bite');
    G.world.breakProps(this.pos.x + this.fwd.x * s * 0.6, this.pos.z + this.fwd.z * s * 0.6, s * 0.45, s * 2, this.fwd.x * s * 1.5, this.fwd.z * s * 1.5, 1.4);
    G.fx.p('slash_02', m.x, m.y, m.z, this.fwd.x * s, 0, this.fwd.z * s, 0.22, s * 0.7, s * 1.2, 1, 1, 1, 0.8, 0.6, 0, 0, 0.1, 1, 0);
    if (hit > 0) {
      G.fx.hitStop(0.045 + Math.min(hit, 6) * 0.006);
      G.fx.shake(0.16 + Math.min(hit, 8) * 0.025);
      G.audio.play('wood', { vol: 0.9, rate: clamp(1.1 - s / 120, 0.45, 1) });
      G.camRig.kick = 3;
    } else {
      G.audio.play('punch', { vol: 0.35, rate: 1.5 });
    }
  }

  doTail() {
    const G = this.G, s = this.size;
    const dmg = this.meleeDamage * 0.85;
    let hit = 0;
    const R = s * 0.95;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const x = this.pos.x + Math.cos(a) * R * 0.7, z = this.pos.z + Math.sin(a) * R * 0.7;
      const r = G.game.strike(x, s * 0.28, z, s * 0.42, dmg, Math.cos(a), 0.3, Math.sin(a), 'tail');
      hit += r.cells + r.units + (r.boss ? 3 : 0);
    }
    G.units.crush(this.pos.x, this.pos.z, R * 1.05, 0, 0, 1.6, 'tail');
    G.world.breakProps(this.pos.x, this.pos.z, R * 1.05, s * 2, 0, 0, 1.6);
    G.fx.ring(this.pos.x, this.pos.z, s * 0.3, R * 1.25, 0.4, 1, 1, 0.9, 0.7, 0.4);
    for (let i = 0; i < 8; i++) { const a = rand(TAU); G.fx.dust(this.pos.x + Math.cos(a) * R * 0.8, 0, this.pos.z + Math.sin(a) * R * 0.8, s * 0.22, 1); }
    G.fx.shake(0.22 + Math.min(hit, 8) * 0.03);
    if (hit) G.fx.hitStop(0.05);
    G.audio.play('step', { vol: 0.8, rate: clamp(1.0 - s / 150, 0.4, 0.9) });
  }

  doStompLand() {
    const G = this.G, s = this.size;
    const k = 1 + 0.18 * this.up.stomp;
    const R = s * 1.35 * k * (this.def.stats.stomp > 1.2 ? 1.2 : 1);
    const dmg = this.meleeDamage * 1.15 * k * this.def.stats.stomp;
    const x = this.pos.x, z = this.pos.z;
    const r = G.game.strike(x, s * 0.12, z, R, dmg, 0, 0.8, 0, 'stomp');
    G.units.crush(x, z, R * 1.15, 0, 0, 2.2, 'stomp');
    G.world.breakProps(x, z, R * 1.2, s * 3, 0, 0, 2.2);
    G.fx.ring(x, z, s * 0.3, R * 1.5, 0.55, 1, 0.95, 0.8, 1, 0.5);
    G.fx.ring(x, z, s * 0.2, R * 1.0, 0.4, 1, 1, 1, 0.6, 0.8);
    G.fx.scorch(x, z, s * 1.3, 0.55, 30);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      G.fx.dust(x + Math.cos(a) * R * 0.55, 0, z + Math.sin(a) * R * 0.55, s * 0.3, 1, 0, 2.2);
    }
    G.fx.dirt(x, 0.5, z, s * 0.4, 8);
    G.fx.rubble(x, 1, z, s * 0.25, 10, s * 1.6);
    G.fx.shake(0.75); G.fx.hitStop(0.07);
    G.camRig.kick = 6;
    G.audio.play('step', { vol: 1.2, rate: clamp(0.8 - s / 200, 0.35, 0.8), jitter: 0.03 });
    G.audio.play('sub', { vol: 1.0, rate: 1.0 });
    G.audio.play('boom', { vol: 0.6, rate: 0.6 });
    return r;
  }

  doRoar() {
    const G = this.G, s = this.size;
    const R = s * 4.2 * (1 + 0.15 * this.up.roar);
    G.audio.roar(1.0, clamp(1.25 - s / 160, 0.7, 1.2));
    G.fx.ring(this.pos.x, this.pos.z, s * 0.4, R, 0.9, 0.7, 0.9, 1, 0.9, 0.8);
    G.fx.ring(this.pos.x, this.pos.z, s * 0.2, R * 0.7, 1.1, 1, 1, 1, 0.5, 0.8);
    G.fx.shake(0.55);
    G.units.roar(this.pos.x, this.pos.z, R, 4.5);
    G.game.onRoar(R);
    const m = this.headPos(_v);
    for (let i = 0; i < 6; i++) G.fx.p('circle_02', m.x, m.y, m.z, this.fwd.x * s * (1 + i * 0.5), 0, this.fwd.z * s * (1 + i * 0.5), 0.7, s * 0.2, s * (1.2 + i * 0.4), 1, 1, 1, 0.5, 0.7, 0, 0.5, 0.1, 1, 0);
  }

  stopBeam() {
    if (!this.breathing) return;
    this.breathing = false;
    this.beam.visible = false;
    this.beamLight.intensity = 0;
    this.G.audio.loop('beam', 'thrusterFire_000', 0, 0.7);
    this.G.audio.loop('beam2', 'forceField_000', 0, 0.5);
  }

  updateBeam(dt, input) {
    const G = this.G, s = this.size;
    const want = input.breath && !this.dead && !this.airborne && (!this.action || this.action.type === 'attack') && (this.energy > (this.breathing ? 0.5 : this.maxEnergy * 0.08) || this.rampage > 0);
    if (!want) {
      this.stopBeam();
      if (this.energyDelay > 0) this.energyDelay -= dt;
      else this.energy = Math.min(this.maxEnergy, this.energy + dt * (11 + this.up.breath * 1.5));
      return;
    }
    if (!this.breathing) {
      this.breathing = true;
      G.audio.play('laser', { vol: 0.8, rate: 0.5 });
    }
    if (this.rampage <= 0) this.energy -= dt * 24;
    this.energyDelay = 0.7;
    // aim: face the camera target
    const aim = this.aim;
    const want_yaw = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, want_yaw, 9, dt);
    const m = this.headPos(this.mouth).addScaledVector(this.fwd, s * this.def.mouthFwd);
    _v2.subVectors(aim, m);
    let len = _v2.length();
    _v2.normalize();
    // keep the beam in front of the monster
    const dot = _v2.x * this.fwd.x + _v2.z * this.fwd.z;
    if (dot < 0.25) { _v2.set(this.fwd.x, clamp(_v2.y, -0.5, 0.4), this.fwd.z).normalize(); }
    const range = s * 9 + 70;
    const hit = G.world.raycast(m.x, m.y, m.z, _v2.x, _v2.y, _v2.z, range, clamp(s * 0.12, 1.5, 6));
    len = hit ? hit.t : range;
    const dps = 300 * this.def.stats.breath * (1 + 0.22 * this.up.breath) * Math.pow(s / 10, 1.3) * (this.rampage > 0 ? 2 : 1);
    const br = s * 0.13 + 1.2;
    const uhit = G.units.beam(m.x, m.y, m.z, _v2.x, _v2.y, _v2.z, len, br * 1.6, dps * dt);
    const ex = m.x + _v2.x * len, ey = m.y + _v2.y * len, ez = m.z + _v2.z * len;
    if (G.game.boss) G.game.boss.beamHit(m, _v2, len, br * 1.5, dps * dt * 0.5);
    if (hit) {
      if (hit.b) hit.b.damage(ex, ey, ez, br * 1.7, dps * dt, _v2.x, 0.2, _v2.z, 'breath');
      this.beamFx = (this.beamFx || 0) + dt;
      if (this.beamFx > 0.045) {
        this.beamFx = 0;
        G.fx.sparks(ex, ey, ez, s * 0.12 + 1, 3, this.beamColor.r + 0.4, this.beamColor.g + 0.4, this.beamColor.b + 0.4);
        G.fx.fire(ex, ey, ez, br * 1.6, 1);
        if (Math.random() < 0.5) G.fx.smoke(ex, ey, ez, br * 2, 1, true, 1.5);
        if (hit.ground) {
          if (Math.random() < 0.5) G.fx.scorch(ex, ez, br * 3.5, 0.6, 25);
          G.units.crush(ex, ez, br * 2.2, _v2.x * s, _v2.z * s, 1.5, 'breath');
          G.world.breakProps(ex, ez, br * 2.2, 999, _v2.x * s, _v2.z * s, 1.5);
          if (Math.random() < 0.12) G.fx.addFire(ex, 0, ez, br * 1.2, rand(3, 6));
        }
      }
      this.beamLight.position.set(ex - _v2.x * br * 2, ey + br, ez - _v2.z * br * 2);
      this.beamLight.intensity = 600 * s; this.beamLight.distance = s * 6 + 40;
    } else this.beamLight.intensity = 0;
    // visuals
    const flick = 0.85 + Math.random() * 0.3;
    this.beam.visible = true;
    this.beam.position.copy(m);
    _v.copy(m).add(_v2);
    this.beam.lookAt(_v);
    this.beamCore.scale.set(br * 0.42 * flick, br * 0.42 * flick, len);
    this.beamGlow.scale.set(br * 0.9 * flick, br * 0.9 * flick, len);
    this.beamGlow2.scale.set(br * 1.7, br * 1.7, len);
    G.fx.p('flare_01', m.x, m.y, m.z, 0, 0, 0, 0.08, s * 0.9, s * 1.3, this.beamColor.r + 0.5, this.beamColor.g + 0.5, this.beamColor.b + 0.5, 0.9, 1, 0, 0, 0.3, 1, 0);
    G.fx.shake(0.03);
    G.audio.loop('beam', 'thrusterFire_000', 0.55, 0.7);
    G.audio.loop('beam2', 'forceField_000', 0.25, 0.45);
  }

  // --- per frame ----------------------------------------------------------------------------------
  update(dt, input) {
    const G = this.G, world = G.world;
    // growth
    if (Math.abs(this.size - this.targetSize) > 0.01) this.setSize(damp(this.size, this.targetSize, 1.6, dt));
    const s = this.size;
    if (this.dead) {
      this.deadT += dt;
      this.group.rotation.z = Math.min(1.45, this.deadT * 1.2) * (this.def.id === 'rex' ? 1 : 0.9);
      this.group.position.y = Math.sin(Math.min(1.45, this.deadT * 1.2)) * s * 0.12;
      this.updateAnim(dt);
      return;
    }
    this.iframes = Math.max(0, this.iframes - dt);
    this.roarCd = Math.max(0, this.roarCd - dt);
    this.stompCd = Math.max(0, this.stompCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (this.up.regen) this.heal(this.maxHp * 0.008 * this.up.regen * dt);
    // rampage
    if (this.rampage > 0) {
      this.rampage -= dt;
      this.glowI = 0.35 + 0.25 * Math.sin(G.time * 14);
      if (Math.random() < dt * 20) G.fx.fire(this.pos.x + rand(-0.4, 0.4) * s, rand(0.2, 0.9) * s, this.pos.z + rand(-0.4, 0.4) * s, s * 0.22, 1);
      if (this.rampage <= 0) { this.glowI = 0; G.ui.banner('', '', ''); }
    } else this.glowI = damp(this.glowI, 0, 6, dt);

    // input -> desired velocity (camera relative)
    const cam = G.camRig;
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = -fz, rz = fx;
    let mx = input.moveX, mz = input.moveZ;
    let ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; ml = 1; }
    let dx = fx * mz + rx * mx, dz = fz * mz + rz * mx;
    const act = this.action;
    this.sprinting = input.sprint && ml > 0.3 && !this.breathing && (!act || act.type === 'attack');
    let speed = this.baseSpeed * (this.sprinting ? 1.6 : 1) * (this.rampage > 0 ? 1.25 : 1);
    if (act) speed *= act.type === 'attack' ? 0.45 : act.type === 'tail' ? 0.3 : act.type === 'roar' ? 0.0 : 1;
    if (this.breathing) speed *= 0.4;
    if (world.inWater(this.pos.z)) speed *= 0.8;
    const acc = this.airborne ? 2 : 9;
    this.vel.x = damp(this.vel.x, dx * speed, acc, dt);
    this.vel.z = damp(this.vel.z, dz * speed, acc, dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (ml > 0.1 && !this.breathing && !(act && (act.type === 'tail'))) {
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), act ? 4 : 8, dt);
    }
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    // lunge during a bite
    let lungeTarget = 0;
    if (act && act.type === 'attack') { const u = act.t / act.dur; lungeTarget = u < 0.5 ? smooth(u / 0.5) : 1 - smooth((u - 0.5) / 0.5); }
    this.lunge = damp(this.lunge, lungeTarget, 20, dt);

    // integrate + collide
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const R = this.radius;
    if (!this.airborne || this.jumpY < s * 0.25) {
      const list = world.buildingsNear(nx, nz, R + 4);
      const tramp = this.meleeDamage * (this.sprinting ? 3.2 : 1.5) * dt;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.dead) continue;
        if (nx + R < b.minX || nx - R > b.maxX || nz + R < b.minZ || nz - R > b.maxZ) continue;
        if (b.height < s * 0.36) {
          // step on it
          b.damage(nx, b.y + b.height * 0.3, nz, R * 1.25, this.meleeDamage * 5, this.fwd.x, 0.2, this.fwd.z, 'trample');
          continue;
        }
        const bx = b.ensureBoxes();
        let pushed = false;
        for (let c = 0; c < b.alive.length; c++) {
          if (!b.alive[c]) continue;
          const o = c * 6;
          if (bx[o + 1] > s * 0.55 + this.jumpY) continue;
          const qx = clamp(nx, bx[o], bx[o + 3]), qz = clamp(nz, bx[o + 2], bx[o + 5]);
          let ex = nx - qx, ez = nz - qz;
          const d2 = ex * ex + ez * ez;
          if (d2 >= R * R) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-4) {
            // centre is inside the cell: push out along the smallest axis
            const l = nx - bx[o], r2 = bx[o + 3] - nx, t = nz - bx[o + 2], u = bx[o + 5] - nz;
            const m = Math.min(l, r2, t, u);
            if (m === l) { nx = bx[o] - R; } else if (m === r2) { nx = bx[o + 3] + R; } else if (m === t) { nz = bx[o + 2] - R; } else nz = bx[o + 5] + R;
          } else {
            const push = R - d;
            nx += (ex / d) * push; nz += (ez / d) * push;
          }
          pushed = true;
          b.hp[c] -= tramp;
          if (b.hp[c] <= 0) { b.killCell(c, this.fwd.x, 0.1, this.fwd.z, false); b._tramped = true; }
        }
        if (b._tramped) { b._tramped = false; b.afterDamage('trample'); G.fx.shake(0.12); }
        if (pushed && sp > 1 && Math.random() < dt * 8) {
          G.fx.dust(nx + this.fwd.x * R, s * 0.3, nz + this.fwd.z * R, s * 0.25, 1);
          G.audio.play('crumble', { vol: 0.35, rate: clamp(1.1 - s / 120, 0.5, 1) });
        }
      }
    }
    const bd = world.bounds;
    nx = clamp(nx, bd.minX, bd.maxX); nz = clamp(nz, bd.minZ, bd.maxZ);
    this.pos.x = nx; this.pos.z = nz;

    // jump arc
    if (this.airborne) {
      this.jumpV -= s * 7.2 * dt;
      this.jumpY += this.jumpV * dt;
      if (this.jumpY <= 0 && this.jumpV < 0) {
        this.jumpY = 0; this.airborne = false;
        this.doStompLand();
      }
    }
    const gy = world.groundY(this.pos.x, this.pos.z) * s * 0.22;
    this.pos.y = gy + this.jumpY;

    // walking: crush what is underfoot, footsteps
    if (!this.airborne) {
      G.units.crush(this.pos.x, this.pos.z, R * 0.95, this.vel.x, this.vel.z, this.sprinting ? 1.4 : 1, 'step');
      world.breakProps(this.pos.x, this.pos.z, R * 0.9, s * 1.6, this.vel.x, this.vel.z, this.sprinting ? 1.4 : 1);
      this.stepAcc += sp * dt;
      const stride = s * 0.8;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.stepSide = -this.stepSide;
        const fxp = this.pos.x + this.fwd.z * this.stepSide * s * 0.16 + this.fwd.x * s * 0.1;
        const fzp = this.pos.z - this.fwd.x * this.stepSide * s * 0.16 + this.fwd.z * s * 0.1;
        const heavy = this.sprinting ? 1.4 : 1;
        if (world.inWater(fzp)) {
          for (let i = 0; i < 5; i++) G.fx.p('whitePuff12', fxp + rand(-1, 1) * s * 0.1, 0.5, fzp + rand(-1, 1) * s * 0.1, rand(-1, 1) * s * 0.4, rand(0.6, 1.4) * s, rand(-1, 1) * s * 0.4, 0.9, s * 0.15, s * 0.5, 0.85, 0.95, 1, 0.8, 0.2, s * 3, 0.3, 0.1, 1);
          G.audio.play('slime_000', { vol: 0.5, rate: 0.6 });
        } else {
          G.fx.dust(fxp, 0.2, fzp, s * 0.16 * heavy, 3, 0, 1.6);
          G.fx.footprint(fxp, fzp, s * 0.42);
          if (s > 25) G.fx.ring(fxp, fzp, s * 0.1, s * 0.45 * heavy, 0.35, 1, 1, 1, 0.35, 0.3);
        }
        G.fx.shake(clamp(0.035 + s * 0.0012, 0.04, 0.16) * heavy);
        G.audio.play('step', { vol: clamp(0.35 + s * 0.008, 0.35, 1.0) * heavy, rate: clamp(1.25 - s / 90, 0.42, 1.2) });
        if (s > 30) G.audio.play('sub', { vol: clamp(s / 220, 0.1, 0.5), rate: 1.3 });
        // feet flatten what they land on
        G.world.damageSphere(fxp, s * 0.05, fzp, s * 0.2, this.meleeDamage * 0.6, this.fwd.x, 0, this.fwd.z, 'step');
      }
    }

    // actions
    if (input.attackPressed) this.tryAttack();
    if (input.stompPressed) this.tryStomp();
    if (input.roarPressed) this.tryRoar();
    if (input.ragePressed) this.startRampage();
    if (act) {
      act.t += dt;
      const u = act.t / act.dur;
      if (act.type === 'attack' && !act.hit && u >= this.def.attackHit) { act.hit = true; this.doBite(); }
      if (act.type === 'tail') {
        this.spin = smooth(clamp(u / 0.85, 0, 1)) * TAU;
        if (!act.hit && u >= 0.4) { act.hit = true; this.doTail(); }
        if (Math.random() < dt * 40) {
          const a = this.yaw + this.spin + Math.PI;
          G.fx.p('twirl_01', this.pos.x + Math.sin(a) * s * 0.8, s * 0.3, this.pos.z + Math.cos(a) * s * 0.8, 0, 0, 0, 0.25, s * 0.6, s * 1.1, 1, 1, 1, 0.5, 0.5, 0, 0, 0.2, 1, 0);
        }
      }
      if (act.type === 'roar' && !act.hit && u >= 0.25) { act.hit = true; this.doRoar(); }
      if (act.t >= act.dur) {
        this.spin = 0;
        const q = act.queued;
        this.action = null;
        if (q) this.tryAttack();
      }
    }
    this.updateBeam(dt, input);

    // pose
    this.group.rotation.y = this.yaw + this.spin;
    const squash = this.airborne ? 1 + clamp(this.jumpV / (s * 6), -0.12, 0.12) : 1;
    this.model.scale.set(s / this.def.modelHeight / Math.sqrt(squash), (s / this.def.modelHeight) * squash, s / this.def.modelHeight / Math.sqrt(squash));
    this.model.position.set(0, 0, this.lunge * s * 0.2);
    this.model.rotation.x = this.lunge * 0.12 + (this.sprinting ? 0.06 : 0);
    this.locomotion(dt, sp, this.sprinting ? 1 : 0);
    this.updateAnim(dt);
  }

  dispose() {
    this.stopBeam();
    this.G.scene.remove(this.group, this.beam, this.beamLight);
    for (const m of this.mats) m.dispose();
  }
}

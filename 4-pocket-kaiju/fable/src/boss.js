// Boss fights: SKORPIUS (rival kaiju, harbor) and MK-TITAN (final war machine).
import * as THREE from 'three';
import { Titan } from './kaiju.js';
import { clamp, damp, dampAngle, angleDiff, rand, TAU, smooth } from './util.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const BOSSES = {
  scorpion: {
    id: 'scorpion', name: 'SKORPIUS', title: 'RIVAL KAIJU',
    model: 'kaiju/scorpion', modelHeight: 1.63, headBone: 'stinger',
    clips: { idle: 'ClawSnap', walk: 'ClawSnap', run: 'ClawSnap', attack: 'Attack', hit: 'Hit', jump: 'Jump' },
    sizeMul: 0.5, bodyR: 0.95, hpBites: 46, reach: 1.7,
  },
  mech: {
    id: 'mech', name: 'MK-TITAN', title: 'HUMANITY\'S LAST WEAPON',
    model: 'kaiju/mech', modelHeight: 4.0, headBone: 'chest',
    clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', hit: 'Hit', jump: 'Jump', stomp: 'Stomp' },
    sizeMul: 1.02, bodyR: 0.36, hpBites: 80, reach: 0.75,
  },
};

export class Boss extends Titan {
  constructor(G, kind) {
    const def = BOSSES[kind];
    super(G, def);
    this.kind = kind;
    const pl = G.player;
    const size = G.level.maxSize * def.sizeMul;
    this.setSize(size);
    const ref = 100 * Math.pow(pl.size / 10, 1.3);
    this.maxHp = ref * def.hpBites;
    this.hp = this.maxHp;
    this.bodyR = size * def.bodyR;
    this.state = 'intro'; this.st = 0;
    this.dead = false;
    this.phase = 1;
    this.vy = 0; this.air = false;
    this.cool = 2;
    this.dmgAcc = 0;
    this.waves = [];
    this.laser = null;
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.dmgMul = 1;
    G.scene.add(this.group);
    // laser visuals (mech)
    const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.5);
    const mk = (color, op) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Group();
    this.beamCore = new THREE.Mesh(geo, mk(0xffe0d0, 0.95));
    this.beamGlow = new THREE.Mesh(geo, mk(0xff2a10, 0.45));
    this.beam.add(this.beamCore, this.beamGlow);
    for (const m of this.beam.children) { m.frustumCulled = false; m.renderOrder = 9; }
    this.beam.visible = false;
    G.scene.add(this.beam);
    this.spawnIntro();
  }

  spawnIntro() {
    const G = this.G, pl = G.player, w = G.world;
    if (this.kind === 'scorpion') {
      // erupts from the bay
      const x = clamp(pl.pos.x + rand(-60, 60), -w.W / 2 + 40, w.W / 2 - 40);
      this.pos.set(x, -this.size * 1.4, w.waterZ + 55);
      this.yaw = Math.PI;
    } else {
      // dropped from orbit
      const a = rand(TAU);
      const d = pl.size * 2.6;
      this.pos.set(clamp(pl.pos.x + Math.cos(a) * d, -w.W / 2 + 30, w.W / 2 - 30), 900, clamp(pl.pos.z + Math.sin(a) * d, -w.D / 2 + 30, w.D / 2 - 30));
      this.yaw = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      this.vy = -160;
    }
    this.group.rotation.y = this.yaw;
  }

  setState(s) { this.state = s; this.st = 0; this.did = false; }

  // --- damage intake --------------------------------------------------------------------------------
  hitSphere(x, y, z, r, dmg, src) {
    if (this.dead || this.state === 'intro') return false;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > this.bodyR + r || y - r > this.pos.y + this.size * 1.1) return false;
    this.takeDamage(dmg, x, y, z);
    return true;
  }
  beamHit(o, dir, len, r, dmg) {
    if (this.dead || this.state === 'intro') return false;
    const cx = this.pos.x, cy = this.pos.y + this.size * 0.5, cz = this.pos.z;
    const t = clamp((cx - o.x) * dir.x + (cy - o.y) * dir.y + (cz - o.z) * dir.z, 0, len);
    const dx = o.x + dir.x * t - cx, dy = o.y + dir.y * t - cy, dz = o.z + dir.z * t - cz;
    if (dx * dx + dz * dz > (this.bodyR + r) * (this.bodyR + r) || Math.abs(dy) > this.size * 0.6 + r) return false;
    this.takeDamage(dmg, o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t, true);
    return true;
  }
  takeDamage(dmg, x, y, z, quiet) {
    const G = this.G;
    this.hp -= dmg;
    this.dmgAcc += dmg;
    this.flashT = 0.12;
    G.game.stats.bossDamage += dmg;
    if (!quiet || Math.random() < 0.2) {
      G.fx.sparks(x, y, z, this.size * 0.12, quiet ? 3 : 8, 1, this.kind === 'mech' ? 0.8 : 0.9, this.kind === 'mech' ? 0.3 : 0.2);
      if (!quiet) { G.audio.play(this.kind === 'mech' ? 'metal' : 'thud', { vol: 1, rate: 0.6, pos: this.pos }); G.fx.dust(x, y, z, this.size * 0.15, 2, this.kind === 'mech' ? 0.6 : 0.2); }
    }
    if (this.hp <= 0) { this.hp = 0; this.die(); return; }
    // phase changes
    const f = this.hp / this.maxHp;
    const ph = f < 0.34 ? 3 : f < 0.67 ? 2 : 1;
    if (ph > this.phase) {
      this.phase = ph;
      this.enrage();
    } else if (this.dmgAcc > this.maxHp * 0.11 && this.state !== 'stagger' && this.state !== 'laser' && !this.air) {
      this.dmgAcc = 0;
      this.play('hit', 0.8, 0.1);
      this.setState('stagger');
    }
  }
  enrage() {
    const G = this.G;
    this.dmgAcc = 0;
    this.stopLaser();
    this.play('hit', 1.1, 0.1);
    this.setState('stagger');
    G.audio.roar(1.1, this.kind === 'mech' ? 0.55 : 1.5, this.pos);
    G.fx.ring(this.pos.x, this.pos.z, this.size * 0.4, this.size * 4, 0.9, 1, 0.3, 0.2, 1, 0.8);
    G.fx.shake(0.6);
    for (let i = 0; i < 4; i++) G.fx.explosion(this.pos.x + rand(-1, 1) * this.bodyR, this.pos.y + rand(0.3, 0.9) * this.size, this.pos.z + rand(-1, 1) * this.bodyR, this.size * 0.12, { noScorch: true, silent: i > 0 });
    G.ui.banner(this.def.name + (this.phase === 2 ? ' IS ENRAGED' : ' IS DESPERATE'), this.phase === 2 ? 'NEW ATTACKS INCOMING' : 'FINISH IT!', 'boss');
    G.audio.say(this.phase === 3 ? 'sudden_death' : 'final_round', 0.9);
  }
  die() {
    const G = this.G;
    this.dead = true;
    this.stopLaser();
    this.setState('dead');
    this.play('hit', 2.4, 0);
    G.fx.slowMo(0.25, 3.2);
    G.audio.roar(1.2, this.kind === 'mech' ? 0.45 : 1.4, this.pos);
    G.game.onBossKilled(this);
  }

  // --- helpers --------------------------------------------------------------------------------------
  face(dt, rate = 3) {
    const pl = this.G.player;
    this.yaw = dampAngle(this.yaw, Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z), rate, dt);
  }
  distToPlayer() { const pl = this.G.player; return Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z); }
  hurtPlayer(dmg) { const pl = this.G.player; pl.hurt(dmg * this.dmgMul, this.pos.x, this.pos.z); }
  smash(radius, power = 1) {
    // bosses wade through the city too
    const G = this.G;
    G.world.damageSphere(this.pos.x, this.pos.y + this.size * 0.3, this.pos.z, radius, 4000 * power * Math.pow(this.size / 10, 1.3), this.fwd.x, 0.2, this.fwd.z, 'boss');
    G.world.breakProps(this.pos.x, this.pos.z, radius, 999, this.fwd.x * 20, this.fwd.z * 20, 1.5);
    G.units.crush(this.pos.x, this.pos.z, radius * 0.9, this.fwd.x * 10, this.fwd.z * 10, 1.4, 'boss');
  }
  shock(radius, dmg) {
    const G = this.G, pl = G.player;
    G.fx.ring(this.pos.x, this.pos.z, this.size * 0.3, radius, 0.6, 1, 0.6, 0.3, 1, 0.6);
    G.fx.shake(0.7, this.pos.x, this.pos.z);
    G.fx.scorch(this.pos.x, this.pos.z, this.size * 1.5, 0.6, 30);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; G.fx.dust(this.pos.x + Math.cos(a) * radius * 0.5, 0, this.pos.z + Math.sin(a) * radius * 0.5, this.size * 0.3, 1, 0, 2); }
    G.audio.play('step', { vol: 1.2, rate: 0.4, pos: this.pos }); G.audio.play('sub', { vol: 1, pos: this.pos });
    G.world.damageSphere(this.pos.x, this.size * 0.15, this.pos.z, radius * 0.8, 3000 * Math.pow(this.size / 10, 1.3), 0, 0.5, 0, 'boss');
    G.units.blast(this.pos.x, 0, this.pos.z, radius, 200, 'boss');
    if (!pl.airborne && this.distToPlayer() < radius + pl.radius) this.hurtPlayer(dmg);
  }

  stopLaser() {
    if (!this.laser) return;
    this.laser = null;
    this.beam.visible = false;
    this.G.audio.loop('bosslaser', 'spaceEngineLarge_000', 0);
  }

  // --- AI -------------------------------------------------------------------------------------------
  update(dt) {
    const G = this.G, pl = G.player;
    this.st += dt;
    this.cool -= dt;
    const s = this.size;
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let speed = 0, run = 0;
    if (this.kind === 'scorpion') speed = this.updateScorpion(dt);
    else { const r = this.updateMech(dt); speed = r[0]; run = r[1]; }
    // shock waves travelling along the ground
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const prev = w.r;
      w.r += w.v * dt;
      w.t += dt;
      if (w.t - w.last > 0.07) {
        w.last = w.t;
        G.fx.ring(w.x, w.z, prev, w.r + w.v * 0.12, 0.22, 1, 0.45, 0.2, 0.95, 0.85);
        for (let k = 0; k < 5; k++) { const a = rand(TAU); G.fx.dust(w.x + Math.cos(a) * w.r, 0, w.z + Math.sin(a) * w.r, s * 0.14, 1, 0.2, 1); }
      }
      const d = Math.hypot(pl.pos.x - w.x, pl.pos.z - w.z);
      if (!w.hit && d > prev - pl.radius * 0.5 && d < w.r + pl.radius * 0.5) {
        if (!pl.airborne) { w.hit = true; this.hurtPlayer(w.dmg); G.fx.shake(0.4); } else if (!w.dodged) { w.dodged = true; G.game.onDodge(); }
      }
      if (w.r > w.max) this.waves.splice(i, 1);
    }
    this.group.rotation.y = this.yaw;
    this.locomotion(dt, speed, run);
    this.updateAnim(dt);
    G.ui.bossBar(this.def.name, this.hp / this.maxHp, this.phase);
  }

  updateScorpion(dt) {
    const G = this.G, pl = G.player, s = this.size;
    const d = this.distToPlayer();
    const reach = this.bodyR + s * this.def.reach * 0.5 + pl.radius;
    const fast = this.phase >= 2 ? 0.75 : 1;
    switch (this.state) {
      case 'intro': {
        // rise from the water
        this.pos.y = damp(this.pos.y, 0, 1.6, dt);
        if (!this.did) { this.did = true; this.play('jump', 2.2, 0); G.audio.roar(1.2, 1.5, this.pos); G.fx.shake(0.6); }
        if (Math.random() < dt * 30) G.fx.p('whitePuff12', this.pos.x + rand(-1, 1) * this.bodyR, 1, this.pos.z + rand(-1, 1) * this.bodyR, rand(-8, 8), rand(20, 50), rand(-8, 8), 1.2, s * 0.3, s * 0.9, 0.8, 0.95, 1, 0.8, 0.2, 60, 0.3, 0.1, 1);
        if (this.st > 2.3) { this.pos.y = 0; this.setState('idle'); this.cool = 1; }
        break;
      }
      case 'idle': {
        this.face(dt, 3.5);
        if (this.cool <= 0) {
          if (d < reach) { this.setState('sting'); this.play('attack', 1.25 * fast, 0); }
          else if (d > s * 5 && Math.random() < 0.45) { this.setState('spit'); this.play('attack', 1.3, 0.2); }
          else { this.setState('leap'); this.play('jump', 1.5 * fast, 0); this.tx = pl.pos.x + pl.vel.x * 0.6; this.tz = pl.pos.z + pl.vel.z * 0.6; this.sx = this.pos.x; this.sz = this.pos.z; G.fx.marker(this.tx, this.tz, this.bodyR * 1.5, 1.4 * fast, 1, 0.2, 0.1); }
        }
        break;
      }
      case 'leap': {
        const T = 1.5 * fast, w0 = 0.3 * T;
        this.face(dt, 2);
        if (this.st > w0) {
          const u = clamp((this.st - w0) / (T - w0), 0, 1);
          // stop short so it lands next to the player, not on top
          const dx = this.tx - this.sx, dz = this.tz - this.sz, L = Math.hypot(dx, dz) || 1;
          const k = Math.max(0, L - (this.bodyR + pl.radius) * 0.75) / L;
          this.pos.x = this.sx + dx * k * u; this.pos.z = this.sz + dz * k * u;
          this.pos.y = Math.sin(u * Math.PI) * s * 1.6;
          this.air = u < 1;
          if (u >= 1 && !this.did) {
            this.did = true; this.pos.y = 0; this.air = false;
            this.smash(this.bodyR * 1.3);
            this.shock(this.bodyR * 2.2, 6);
          }
        }
        if (this.st > T + 0.25) { this.setState('idle'); this.cool = rand(0.5, 1.1) * fast; }
        break;
      }
      case 'sting': {
        const T = 1.25 * fast;
        this.face(dt, this.st < T * 0.4 ? 5 : 0.5);
        if (!this.did && this.st > T * 0.5) {
          this.did = true;
          const ang = Math.abs(angleDiff(this.yaw, Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z)));
          const hx = this.pos.x + this.fwd.x * (this.bodyR + s * 0.5), hz = this.pos.z + this.fwd.z * (this.bodyR + s * 0.5);
          G.fx.dust(hx, 0, hz, s * 0.4, 5); G.fx.shake(0.4, hx, hz);
          G.fx.p('slash_02', hx, s * 0.8, hz, 0, 0, 0, 0.25, s * 1.2, s * 2, 1, 0.9, 0.5, 0.9, 0.6, 0, 0, 0.1, 1, 0);
          G.audio.play('punch', { vol: 1, rate: 0.5, pos: this.pos });
          G.world.damageSphere(hx, s * 0.4, hz, s * 0.8, 3000 * Math.pow(s / 10, 1.3), this.fwd.x, 0.2, this.fwd.z, 'boss');
          if (d < reach * 1.15 && ang < 0.9 && !pl.airborne) this.hurtPlayer(9);
        }
        if (this.st > T) { this.setState('idle'); this.cool = rand(0.7, 1.3) * fast; }
        break;
      }
      case 'spit': {
        this.face(dt, 4);
        if (!this.did && this.st > 0.6) {
          this.did = true;
          const h = this.headPos(_v);
          const n = this.phase >= 2 ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const tx = pl.pos.x + pl.vel.x * 1.2 + rand(-1, 1) * pl.size * 0.8, tz = pl.pos.z + pl.vel.z * 1.2 + rand(-1, 1) * pl.size * 0.8;
            const T = clamp(Math.hypot(tx - h.x, tz - h.z) / 90, 1.0, 2.6) + i * 0.12;
            const g = 22;
            G.units.addProj({ kind: 'shell', acid: true, x: h.x, y: h.y, z: h.z, vx: (tx - h.x) / T, vz: (tz - h.z) / T, vy: (pl.size * 0.3 - h.y) / T + 0.5 * g * T, g, size: s * 0.09, dmg: 3 * this.dmgMul, blast: s * 0.5, life: T + 2, trail: 0 });
            G.fx.marker(tx, tz, s * 0.45, T, 0.4, 1, 0.2);
          }
          G.audio.play('slime_000', { vol: 1, rate: 0.5, pos: this.pos });
        }
        if (this.st > 1.3) { this.setState('idle'); this.cool = rand(0.6, 1.2); }
        break;
      }
      case 'stagger': {
        if (this.st > 0.9) { this.setState('idle'); this.cool = 0.3; }
        break;
      }
      case 'dead': this.updateDeath(dt); break;
    }
    return 0;
  }

  updateMech(dt) {
    const G = this.G, pl = G.player, s = this.size;
    const d = this.distToPlayer();
    const reach = this.bodyR + s * this.def.reach * 0.5 + pl.radius;
    const fast = this.phase === 3 ? 0.72 : this.phase === 2 ? 0.86 : 1;
    let speed = 0, run = 0;
    switch (this.state) {
      case 'intro': {
        this.pos.y += this.vy * dt;
        if (!this.did) { this.did = true; G.audio.play('spaceEngineLarge_000', { vol: 0.9, rate: 0.7, jitter: 0 }); }
        if (Math.random() < dt * 40) G.fx.fire(this.pos.x + rand(-1, 1) * this.bodyR, this.pos.y, this.pos.z + rand(-1, 1) * this.bodyR, s * 0.25, 1);
        if (this.pos.y <= 0) {
          this.pos.y = 0;
          this.smash(this.bodyR * 2.4);
          this.shock(s * 2.2, 6);
          G.fx.explosion(this.pos.x, 2, this.pos.z, s * 0.5);
          G.fx.hitStop(0.12); G.fx.slowMo(0.4, 1.2);
          this.play('stomp', 1.6, 0);
          G.audio.roar(1.2, 0.5, this.pos);
          G.audio.say('prepare_yourself', 1);
          this.setState('stagger'); this.cool = 1.8;
        }
        break;
      }
      case 'walk': {
        this.face(dt, 2.2);
        run = this.phase === 3 ? 1 : 0;
        speed = (5 + s * 0.3) * (run ? 1.7 : 1) * (this.phase === 2 ? 1.2 : 1);
        if (d < reach * 0.92) speed = 0;
        this.pos.x += this.fwd.x * speed * dt; this.pos.z += this.fwd.z * speed * dt;
        this.smashT = (this.smashT || 0) - dt;
        if (this.smashT <= 0) { this.smashT = 0.2; this.smash(this.bodyR * 1.25); }
        // footfalls
        this.stepAcc = (this.stepAcc || 0) + speed * dt;
        if (this.stepAcc > s * 0.55) {
          this.stepAcc = 0;
          G.fx.shake(0.3, this.pos.x, this.pos.z);
          G.fx.dust(this.pos.x, 0, this.pos.z, s * 0.22, 4, 0.2, 1.5);
          G.audio.play('step', { vol: 1.1, rate: 0.38, pos: this.pos });
          G.audio.play('metal', { vol: 0.5, rate: 0.5, pos: this.pos });
        }
        if (this.cool <= 0) {
          const r = Math.random();
          if (d < reach) { this.setState('punch'); this.play('attack', 1.5 * fast, 0); }
          else if (this.phase >= 2 && d < s * 3.2 && r < 0.4) { this.setState('stomp'); this.play('stomp', 1.7 * fast, 0); }
          else if (this.phase >= 2 && r < 0.62) { this.setState('laser'); this.play('idle', 0.5, 0.6); }
          else if (r < 0.9 || d > s * 4) { this.setState('missiles'); this.shots = 0; }
          else this.cool = 0.8;
        }
        break;
      }
      case 'punch': {
        const T = 1.5 * fast;
        this.face(dt, this.st < T * 0.45 ? 4 : 0.4);
        if (!this.did && this.st > T * 0.55) {
          this.did = true;
          const hx = this.pos.x + this.fwd.x * (this.bodyR + s * 0.35), hz = this.pos.z + this.fwd.z * (this.bodyR + s * 0.35);
          const ang = Math.abs(angleDiff(this.yaw, Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z)));
          G.fx.shake(0.5, hx, hz); G.fx.dust(hx, s * 0.3, hz, s * 0.3, 5, 0.3);
          G.fx.p('slash_02', hx, s * 0.6, hz, 0, 0, 0, 0.25, s * 1.0, s * 1.8, 1, 0.8, 0.4, 0.9, 0.6, 0, 0, 0.1, 1, 0);
          G.audio.play('metal', { vol: 1.2, rate: 0.45, pos: this.pos }); G.audio.play('boom', { vol: 0.8, rate: 0.7, pos: this.pos });
          G.world.damageSphere(hx, s * 0.5, hz, s * 0.55, 5000 * Math.pow(s / 10, 1.3), this.fwd.x, 0.2, this.fwd.z, 'boss');
          if (d < reach * 1.2 && ang < 0.85) { this.hurtPlayer(10); pl.vel.x += this.fwd.x * s * 1.2; pl.vel.z += this.fwd.z * s * 1.2; G.fx.hitStop(0.08); }
        }
        if (this.st > T) { this.setState('walk'); this.cool = rand(0.6, 1.3) * fast; }
        break;
      }
      case 'stomp': {
        const T = 1.7 * fast;
        if (!this.did && this.st > T * 0.55) {
          this.did = true;
          this.smash(this.bodyR * 1.6);
          this.shock(this.bodyR * 1.6, 0);
          const n = this.phase === 3 ? 3 : 2;
          for (let i = 0; i < n; i++) this.waves.push({ x: this.pos.x, z: this.pos.z, r: s * 0.3 - i * s * 1.1, v: s * 1.5, max: s * 6.5, dmg: 7, t: 0, last: 0, hit: false });
          G.ui.hint('LEAP OVER THE SHOCKWAVE! [SPACE]');
        }
        if (this.st > T) { this.setState('walk'); this.cool = rand(0.8, 1.5) * fast; }
        break;
      }
      case 'missiles': {
        this.face(dt, 3);
        const n = this.phase === 3 ? 10 : this.phase === 2 ? 8 : 5;
        if (this.st > 0.4 + this.shots * 0.14 && this.shots < n) {
          this.shots++;
          const side = this.shots % 2 ? 1 : -1;
          const sx = this.pos.x + this.fwd.z * side * this.bodyR * 0.9, sz = this.pos.z - this.fwd.x * side * this.bodyR * 0.9, sy = s * 0.85;
          const sp = 70 + s * 0.3;
          G.units.addProj({ kind: 'missile', x: sx, y: sy, z: sz, vx: this.fwd.x * sp * 0.3 + rand(-20, 20), vy: sp * 0.8, vz: this.fwd.z * sp * 0.3 + rand(-20, 20), speed: sp, size: s * 0.035, dmg: 1.5 * this.dmgMul, blast: s * 0.14, life: 8, turn: 1.9, arm: 0.5, trail: 0, hp: 1 });
          G.fx.flash(sx, sy, sz, s * 0.12, 1, 0.8, 0.5, 0.1);
          G.audio.play('thrusterFire_000', { vol: 0.5, rate: 1.2, pos: this.pos });
        }
        if (this.st > 0.4 + n * 0.14 + 0.5) { this.setState('walk'); this.cool = rand(1.0, 1.8) * fast; }
        break;
      }
      case 'laser': {
        // charge (telegraph), then a sweeping beam that chases the player
        const charge = 1.25 * fast, fire = this.phase === 3 ? 3.4 : 2.6;
        const eye = _v.set(this.pos.x + this.fwd.x * this.bodyR * 0.6, s * 0.8, this.pos.z + this.fwd.z * this.bodyR * 0.6);
        if (!this.laser) {
          this.laser = { x: pl.pos.x - this.fwd.z * s * 1.2, z: pl.pos.z + this.fwd.x * s * 1.2, fxT: 0 };
          G.audio.play('laser', { vol: 1, rate: 0.45, pos: this.pos });
          G.ui.hint('KEEP MOVING - THE LASER TRACKS YOU');
        }
        const L = this.laser;
        this.face(dt, 1.6);
        const chase = this.st < charge ? 6 : (this.phase === 3 ? 0.62 : 0.5) * (5 + s * 0.45) / Math.max(1, Math.hypot(pl.pos.x - L.x, pl.pos.z - L.z)) * 1.4;
        L.x = damp(L.x, pl.pos.x, chase, dt); L.z = damp(L.z, pl.pos.z, chase, dt);
        _v2.set(L.x - eye.x, s * 0.05 - eye.y, L.z - eye.z);
        const len = _v2.length();
        _v2.normalize();
        this.beam.visible = true;
        this.beam.position.copy(eye);
        this.beam.lookAt(L.x, s * 0.05, L.z);
        if (this.st < charge) {
          const k = 0.03 + 0.02 * Math.sin(this.st * 40);
          this.beamCore.scale.set(s * k, s * k, len); this.beamGlow.scale.set(s * k * 2, s * k * 2, len);
          G.fx.marker(L.x, L.z, s * 0.3, 0.12, 1, 0.1, 0.1);
          G.fx.p('flare_01', eye.x, eye.y, eye.z, 0, 0, 0, 0.1, s * 0.5 * (this.st / charge), s * 0.8, 1, 0.3, 0.2, 1, 1, 0, 0, 0.3, 1, 0);
        } else {
          const fl = 0.85 + Math.random() * 0.3;
          this.beamCore.scale.set(s * 0.05 * fl, s * 0.05 * fl, len); this.beamGlow.scale.set(s * 0.13 * fl, s * 0.13 * fl, len);
          G.audio.loop('bosslaser', 'spaceEngineLarge_000', 0.7, 1.6);
          L.fxT -= dt;
          if (L.fxT <= 0) {
            L.fxT = 0.05;
            G.fx.fire(L.x, 1, L.z, s * 0.16, 2); G.fx.sparks(L.x, 1, L.z, s * 0.1, 4, 1, 0.4, 0.2);
            if (Math.random() < 0.6) G.fx.scorch(L.x, L.z, s * 0.35, 0.7, 20);
            G.world.damageSphere(L.x, s * 0.1, L.z, s * 0.22, 900 * Math.pow(s / 10, 1.3), _v2.x, 0, _v2.z, 'boss');
            G.units.crush(L.x, L.z, s * 0.2, 0, 0, 1.2, 'boss');
          }
          G.fx.shake(0.05);
          if (Math.hypot(pl.pos.x - L.x, pl.pos.z - L.z) < pl.radius + s * 0.1) this.hurtPlayer(8 * dt);
        }
        if (this.st > charge + fire) { this.stopLaser(); this.setState('walk'); this.cool = rand(1.2, 2.0) * fast; }
        break;
      }
      case 'stagger': {
        if (this.st > (this.cool > 1 ? 1.8 : 0.9)) { this.setState('walk'); this.cool = Math.max(this.cool, 0.4); }
        break;
      }
      case 'dead': this.updateDeath(dt); break;
    }
    const b = G.world.bounds;
    this.pos.x = clamp(this.pos.x, b.minX + 20, b.maxX - 20); this.pos.z = clamp(this.pos.z, b.minZ + 20, b.maxZ - 20);
    return [speed, run];
  }

  updateDeath(dt) {
    const G = this.G, s = this.size;
    this.waves.length = 0;
    const T = 3.4;
    if (this.st < T) {
      if (Math.random() < dt * 9) {
        G.fx.explosion(this.pos.x + rand(-1, 1) * this.bodyR, this.pos.y + rand(0.1, 1) * s, this.pos.z + rand(-1, 1) * this.bodyR, s * rand(0.1, 0.2), { noScorch: true });
        if (this.kind === 'mech') G.fx.p('spark_06', this.pos.x + rand(-1, 1) * this.bodyR, this.pos.y + rand(0.2, 0.9) * s, this.pos.z + rand(-1, 1) * this.bodyR, 0, 0, 0, 0.2, s * 0.5, s * 0.8, 0.6, 0.8, 1, 1, 1, 0, 0, 0.2, 1);
      }
      this.group.rotation.z = Math.sin(this.st * 20) * 0.03;
    } else if (!this.fell) {
      this.fell = true;
      G.fx.explosion(this.pos.x, s * 0.4, this.pos.z, s * 0.8);
      G.fx.explosion(this.pos.x + s * 0.3, s * 0.7, this.pos.z, s * 0.5, { silent: true });
      G.fx.ring(this.pos.x, this.pos.z, s * 0.5, s * 6, 1.2, 1, 0.8, 0.5, 1, 0.8);
      G.fx.shake(1.0); G.fx.hitStop(0.15);
      G.audio.play('sub', { vol: 1.2 }); G.audio.play('boom', { vol: 1.3, rate: 0.5 });
      G.world.damageSphere(this.pos.x, s * 0.3, this.pos.z, s * 1.6, 1e7, 0, 0.6, 0, 'boss');
      G.units.blast(this.pos.x, 0, this.pos.z, s * 3, 9999, 'boss');
      for (let i = 0; i < 26; i++) G.fx.rubble(this.pos.x + rand(-1, 1) * this.bodyR, rand(0.2, 1) * s, this.pos.z + rand(-1, 1) * this.bodyR, s * 0.12, 3, s * 2.2);
      G.fx.addFire(this.pos.x, 0, this.pos.z, s * 0.4, 30);
    } else {
      const u = clamp((this.st - T) / 1.6, 0, 1);
      this.group.rotation.x = -smooth(u) * 1.45;
      this.pos.y = -smooth(u) * s * 0.08;
      if (this.st > T + 2.2 && !this.reported) { this.reported = true; G.game.onBossDeathDone(this); }
    }
  }

  dispose() {
    this.stopLaser();
    this.G.scene.remove(this.group, this.beam);
    for (const m of this.mats) m.dispose();
  }
}

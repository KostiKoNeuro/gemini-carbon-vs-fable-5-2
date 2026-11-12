// One level session: builds the city, runs the rampage, keeps score, drives growth, threat, bosses and endings.
import * as THREE from 'three';
import { A } from './assets.js';
import { World } from './world.js';
import { Units } from './units.js';
import { Kaiju, CameraRig } from './kaiju.js';
import { Boss, BOSSES } from './boss.js';
import { FlatModel } from './fracture.js';
import { KAIJU, LEVELS, tier } from './data.js';
import { clamp, rand, pick, TAU, fmt, damp } from './util.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const DNA_BASE = { suburb: 600, downtown: 1000, harbor: 1500, neon: 2100, fortress: 2800, endless: 0 };
const STAGES = 5;
const THREAT_TEXT = ['', 'POLICE RESPONDING', 'THE ARMY IS HERE', 'AIR SUPPORT INBOUND', 'HEAVY ARMOUR DEPLOYED', 'TOTAL WAR'];

export class Game {
  constructor(G) {
    this.G = G;
    this.state = 'none';
    this.boss = null;
    this.stats = {};
  }

  async start(level, opts = {}) {
    const G = this.G;
    this.dispose();
    this.level = level;
    G.level = level;
    this.menu = !!opts.menu;
    this.state = 'loading';
    this.stats = { buildings: 0, cells: 0, vehicles: 0, units: 0, people: 0, props: 0, maxCombo: 0, damageTaken: 0, bossDamage: 0, time: 0, landmarks: 0, dodges: 0 };
    this.score = 0; this.combo = 0; this.comboT = 0; this.comboSaid = 0;
    this.stage = 0; this.threat = 1; this.progress = 0;
    this.bossSpawned = false; this.bossDead = false; this.endT = 0;
    this.time = 0; this.hudT = 0; this.introT = 0;
    this.popT = 0;
    G.fx.clear();
    const world = (G.world = new World(G, level, opts.seed || (level.endless ? (Math.random() * 1e9) | 0 : 4242 + LEVELS.indexOf(level) * 977)));
    await world.build();
    G.fx.setFog(level.fog[0], level.fog[1]);
    G.renderer.toneMappingExposure = level.exposure || 1;
    // rubble mounds left where buildings stood
    const rub = FlatModel.get('landmarks/collapse-rubble-mound-4fbfed', A.gltf['landmarks/collapse-rubble-mound-4fbfed'].scene);
    this.mounds = new THREE.InstancedMesh(rub.geometry, rub.material, 400);
    this.mounds.count = 0; this.mounds.frustumCulled = false; this.mounds.receiveShadow = true; this.mounds.castShadow = true;
    G.scene.add(this.mounds);
    // player
    const def = KAIJU[opts.kaiju || G.save.kaiju] || KAIJU.rex;
    const pl = (G.player = new Kaiju(G, def));
    const g = tier(G.save, 'growth');
    this.startSize = level.startSize * (1 + 0.07 * g);
    this.maxSize = level.maxSize * (1 + 0.035 * g);
    // start on the street just outside the north edge of town, facing in (menu: in the middle of downtown)
    const mid = Math.floor(world.roadsX.length / 2);
    if (this.menu) pl.spawn(world.roadsX[mid], world.roadsZ[Math.floor(world.roadsZ.length / 2)], 0.6, level.menuSize || 30);
    else pl.spawn(world.roadsX[Math.min(1, world.roadsX.length - 1)], world.roadsZ[0] - 26, 0, this.startSize);
    G.units = new Units(G, world, level);
    if (this.menu) G.units.calm = true;
    G.camRig = G.camRig || new CameraRig(G);
    G.camRig.snap(pl);
    G.camRig.pitch = 0.22;
    G.camRig.orbit = 0;
    G.wind.set(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(2);
    this.goalValue = world.totalValue * (level.endless ? 1e9 : level.goal);
    this.landmarkNames = world.landmarks.map((b) => b.name);
    this.state = this.menu ? 'menu' : 'intro';
    if (!this.menu) {
      G.audio.music(level.music);
      G.ui.showHud(true);
      G.ui.levelIntro(level);
      G.camRig.yaw = pl.yaw + Math.PI + 2.4;
    }
    world.updateSun(pl.pos, pl.size);
  }

  get objectives() {
    const L = this.level;
    if (L.endless) return [{ text: 'Survive and destroy', done: false }];
    const o = [];
    o.push({ text: `Destroy ${Math.round(L.goal * 100)}% of ${L.name}`, done: this.progress >= 1 });
    if (L.boss) o.push({ text: `Defeat ${BOSSES[L.boss].name}`, done: this.bossDead, hidden: !this.bossSpawned });
    o.push({ text: `Finish in under ${Math.floor(L.parTime / 60)}:${('0' + (L.parTime % 60)).slice(-2)}`, done: this.state === 'won' ? this.time <= L.parTime : null, fail: this.time > L.parTime });
    if (this.landmarkNames.length) o.push({ text: 'Demolish ' + this.landmarkNames.join(' + '), done: this.stats.landmarks >= this.landmarkNames.length });
    else o.push({ text: 'Finish with over 40% health', done: this.state === 'won' ? this.G.player.hp >= this.G.player.maxHp * 0.4 : null });
    return o;
  }

  // ------------------------------------------------------------------------------------------------
  strike(x, y, z, r, dmg, dx, dy, dz, src) {
    const G = this.G;
    const cells = G.world.damageSphere(x, y, z, r, dmg, dx, dy, dz, src);
    const units = G.units.damageSphere(x, y, z, r, dmg, src);
    const boss = this.boss ? this.boss.hitSphere(x, y, z, r, dmg, src) : false;
    return { cells, units, boss };
  }

  addScore(v, x, y, z, label, big) {
    if (this.menu) return;
    const mult = 1 + Math.min(this.combo, 60) * 0.035;
    const pts = Math.round(v * mult);
    this.score += pts;
    if (label !== undefined && x !== undefined) this.G.ui.popup(x, y, z, (label ? label + ' ' : '') + '+' + fmt(pts), big);
    return pts;
  }
  bump(n = 1) {
    if (this.menu) return;
    this.combo += n;
    this.comboT = 2.6;
    if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo;
    const G = this.G;
    if (this.combo >= 20 && this.comboSaid < 20) { this.comboSaid = 20; G.audio.say('combo', 0.9); G.ui.flashCombo(); }
    else if (this.combo >= 60 && this.comboSaid < 60) { this.comboSaid = 60; G.audio.say('multi_kill', 0.9); G.ui.flashCombo(); }
    else if (this.combo >= 150 && this.comboSaid < 150) { this.comboSaid = 150; G.audio.say('flawless_victory', 0.9); G.ui.flashCombo(); }
  }

  onCellDestroyed(b, i, dx, dy, dz, falling) {
    const G = this.G, w = G.world;
    w.destroyedValue += b.cellValue;
    this.stats.cells++;
    G.fx.cellBreak(b, i, dx, dy, dz, falling);
    const c = b.cellCenter(i, _v);
    const cs = b.cellSize;
    G.audio.play('crumble', { vol: clamp(0.35 + cs * 0.05, 0.3, 0.9), rate: clamp(1.25 - cs * 0.07, 0.45, 1.2), pos: c });
    if (Math.random() < 0.3) G.audio.play('glass', { vol: 0.45, rate: rand(0.7, 1.1), pos: c });
    if (this.menu) return;
    this.bump();
    this.addScore(b.cellValue * 5);
    G.player.addRage(b.cellValue / Math.max(1, this.goalValue) * 9 + 0.004);
  }

  onBuildingDestroyed(b, src) {
    const G = this.G, pl = G.player;
    this.stats.buildings++;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const big = b.height > pl.size * 0.9 || b.landmark;
    // rubble mound + lingering smoke
    if (!b.ship && this.mounds.count < 400) {
      _e.set(0, rand(TAU), 0);
      const s = size / 3 * rand(0.85, 1.1);
      _m.compose(_v.set(b.cx, b.y - 0.1, b.cz), _q.setFromEuler(_e), _s.set(s, s * rand(0.7, 1.3), s));
      this.mounds.setMatrixAt(this.mounds.count++, _m);
      this.mounds.instanceMatrix.needsUpdate = true;
    }
    G.fx.dust(b.cx, b.y + 2, b.cz, size * 0.55, big ? 8 : 5, 0.1, 1.4);
    if (!b.ship) G.fx.scorch(b.cx, b.cz, size * 1.5, 0.5, 60);
    if (Math.random() < 0.6 && !b.ship) G.fx.addFire(b.cx + rand(-0.2, 0.2) * size, b.y, b.cz + rand(-0.2, 0.2) * size, size * 0.14, rand(8, 18));
    G.fx.shake(clamp(size * 0.012 + (big ? 0.25 : 0), 0.1, 0.7), b.cx, b.cz);
    const pos = { x: b.cx, y: b.y, z: b.cz };
    G.audio.play('slab', { vol: clamp(0.5 + size * 0.02, 0.5, 1.2), rate: clamp(1.1 - size * 0.02, 0.4, 1), pos });
    if (big) { G.audio.play('sub', { vol: 0.9, pos }); G.audio.play('boom', { vol: 0.5, rate: 0.5, pos }); }
    if (b.explosive) this.fuelBlast(b, size);
    if (this.menu) return;
    this.bump(3);
    const pts = this.addScore(b.value * 6 + 50, b.cx, b.top + 2, b.cz, b.name || '', big);
    if (big && src !== 'boss' && src !== 'army') G.fx.slowMo(0.5, 0.55);
    if (b.landmark) {
      this.stats.landmarks++;
      G.ui.banner(b.name + ' DESTROYED', 'LANDMARK BONUS +' + fmt(pts), 'gold');
      G.audio.say('objective_achieved', 0.9);
      pl.addRage(0.25);
      pl.heal(pl.maxHp * 0.1);
    }
    pl.addRage(0.012);
    // eating bricks is good for you
    pl.heal(pl.maxHp * 0.004);
  }

  fuelBlast(b, size) {
    const G = this.G, pl = G.player;
    const R = size * 1.7 * b.explosive + 14;
    const y = b.y + b.height * 0.4;
    G.fx.explosion(b.cx, y, b.cz, size * 0.75);
    for (let i = 0; i < 4; i++) G.fx.explosion(b.cx + rand(-1, 1) * size * 0.6, y + rand(0, size * 0.6), b.cz + rand(-1, 1) * size * 0.6, size * rand(0.3, 0.5), { silent: true, noScorch: true });
    G.fx.ring(b.cx, b.cz, size * 0.3, R * 1.2, 0.6, 1, 0.7, 0.3, 1, 0.8);
    G.fx.addFire(b.cx, b.y, b.cz, size * 0.3, rand(12, 20));
    G.fx.hitStop(0.06);
    // chain reaction: delayed so the blasts ripple outwards
    this.pending.push({ t: this.time + 0.18, fn: () => {
      G.world.damageSphere(b.cx, y, b.cz, R, 2200 * Math.pow(G.level.bScale / 2, 2) * b.explosive, 0, 0.6, 0, 'fuel');
      G.world.breakProps(b.cx, b.cz, R, 999, 0, 0, 2);
      G.units.blast(b.cx, y, b.cz, R, 400, 'fuel');
    } });
    if (!this.menu) {
      const d = Math.hypot(pl.pos.x - b.cx, pl.pos.z - b.cz) - pl.radius;
      if (d < R * 0.7) pl.hurt(5 * b.explosive * (1 - Math.max(0, d) / (R * 0.7)), b.cx, b.cz);
      this.addScore(300, b.cx, b.top + 6, b.cz, 'KABOOM!', true);
    }
  }

  onPropBroken(p, dx, dz, vx, vz, power) {
    const G = this.G, pl = G.player, s = pl ? pl.size : 10;
    const d = Math.hypot(dx, dz) || 1;
    const sp = (4 + s * 0.45) * power * rand(0.6, 1.2);
    const flat = p.batch.flat;
    G.fx.flingModel(flat, p.x, p.y, p.z, p.r, p.s, (dx / d) * sp + vx * 0.6, (5 + s * 0.4) * power * rand(0.6, 1.2) * (p.heavy ? 0.7 : 1), (dz / d) * sp + vz * 0.6, { life: rand(4, 7), dusty: p.heavy });
    const key = p.batch.key;
    const snd = /tree|fence|planter|parasol|billboard/.test(key) ? 'wood' : /container|dumpster/.test(key) ? 'metal' : 'tin';
    G.audio.play(snd, { vol: p.heavy ? 0.7 : 0.4, rate: rand(0.8, 1.2), pos: p });
    if (/tree/.test(key)) G.fx.p('dirt_01', p.x, p.h * 0.6, p.z, 0, 4, 0, 0.6, p.h * 0.4, p.h * 0.9, 0.35, 0.6, 0.3, 0.9, 0, 12, 0.5, 0.05, 1);
    this.stats.props++;
    if (this.menu) return;
    this.bump();
    this.addScore(p.heavy ? 40 : 10);
    pl.addRage(0.002);
  }

  onCivilian(c) {
    this.stats.people++;
    if (this.menu) return;
    this.bump();
    this.addScore(5);
    this.G.player.heal(this.G.player.maxHp * 0.002);
  }
  onVehicle(c, src) {
    this.stats.vehicles++;
    if (this.menu) return;
    this.bump(2);
    this.addScore(50, c.x, 4, c.z, '', false);
    this.G.player.addRage(0.006);
    this.G.player.heal(this.G.player.maxHp * 0.004);
  }
  onUnitKilled(u, src) {
    this.stats.units++;
    if (this.menu) return;
    this.bump(4);
    const names = { police: 'POLICE', jeep: 'JEEP', tank: 'TANK', truck: 'LAUNCHER', heli: 'CHOPPER', jet: 'JET', turret: 'TURRET', bomber: 'BOMBER' };
    this.addScore(u.def.score * this.G.units.uScale, u.x, u.y + u.radius * 2 + 3, u.z, names[u.type] || '', u.def.score >= 400);
    this.G.player.addRage(0.035);
    this.G.player.heal(this.G.player.maxHp * 0.01);
    if (u.def.air && src === 'bite') { this.G.audio.say('combo_breaker', 0.8); this.G.ui.banner('SNACK!', 'AIRCRAFT BITTEN OUT OF THE SKY', 'gold'); this.addScore(500); }
  }
  onRoar(R) {
    // windows shatter all around
    for (let i = 0; i < 5; i++) this.G.audio.play('glass', { vol: 0.5, rate: rand(0.7, 1.2), delay: rand(0.05, 0.5) });
  }
  onDodge() { this.stats.dodges++; this.addScore(400, this.G.player.pos.x, this.G.player.size * 1.2, this.G.player.pos.z, 'DODGED!', true); }

  onPlayerDeath() {
    if (this.state === 'lost' || this.state === 'won') return;
    this.state = 'lost';
    this.endT = 0;
    this.G.audio.music(null, 2);
    this.G.audio.say('game_over', 1);
  }
  onBossKilled(boss) {
    this.bossDead = true;
    this.G.audio.music(null, 1.5);
    this.addScore(20000 * (boss.kind === 'mech' ? 2.5 : 1), boss.pos.x, boss.size * 1.2, boss.pos.z, boss.def.name + ' DEFEATED', true);
    this.G.audio.say(boss.kind === 'mech' ? 'flawless_victory' : 'winner', 1);
  }
  onBossDeathDone(boss) {
    this.win();
  }

  win() {
    if (this.state === 'won' || this.state === 'lost') return;
    const G = this.G;
    this.state = 'won';
    this.endT = 0;
    G.units.calm = true;
    for (const u of G.units.army.slice()) if (!u.def.fixed) G.units.killUnit(u, 'blast');
    G.fx.slowMo(0.35, 1.6);
    G.audio.music('heroic_age', 1.0);
    G.ui.banner(this.level.final ? 'HUMANITY HAS FALLEN' : 'DISTRICT FLATTENED', this.level.final ? 'THE WORLD IS YOURS' : 'STAGE CLEAR', 'gold');
    G.audio.say(this.level.final ? 'you_win' : 'mission_completed', 1);
  }

  spawnBoss() {
    const G = this.G;
    this.bossSpawned = true;
    const kind = this.level.boss;
    const def = BOSSES[kind];
    G.ui.banner('WARNING: ' + def.name, def.title, 'boss');
    G.audio.play('lowThreeTone', { vol: 0.8 });
    G.audio.music(this.level.bossMusic || this.level.music, 0.8);
    this.pending.push({ t: this.time + 2.2, fn: () => {
      this.boss = new Boss(G, kind);
      G.audio.say('fight', 1);
    } });
  }

  // ------------------------------------------------------------------------------------------------
  update(dt, rawDt, input) {
    const G = this.G, pl = G.player, world = G.world, L = this.level;
    if (!pl || !world || this.state === 'loading' || this.state === 'none') return;
    const cam = G.camRig;
    if (this.state === 'menu') {
      cam.orbit = 0.1;
      cam.pitch = 0.2;
      this.time += dt;
      this.menuAct = (this.menuAct || 3) - dt;
      const fake = G.noInput;
      fake.attackPressed = fake.roarPressed = fake.stompPressed = false;
      if (this.menuAct <= 0) {
        this.menuAct = rand(4, 7);
        const r = Math.random();
        if (r < 0.4) pl.tryRoar(); else if (r < 0.75) pl.tryAttack(); else pl.tryStomp();
      }
      pl.update(dt, fake);
      G.units.update(dt);
      world.update(dt);
      this.updatePending();
      cam.zoom = 1.15;
      cam.update(dt, rawDt, pl, G.noInput);
      world.updateSun(pl.pos, pl.size);
      return;
    }
    cam.zoom = 1;
    if (this.state === 'intro') {
      this.introT += rawDt;
      cam.orbit = 0;
      { const u = Math.min(1, this.introT / 2.6); cam.yaw = pl.yaw + Math.PI + 2.4 * (1 - u * u * (3 - 2 * u)); }
      if (this.introT > 0.6 && !this.introRoar) { this.introRoar = true; pl.tryRoar(); pl.roarCd = 0; }
      if (this.introT > 2.8 || (this.introT > 0.5 && (input.attackPressed || input.anyKey))) {
        this.state = 'play'; cam.orbit = 0;
        G.audio.say(pick(['fight', 'begin']), 0.9);
        G.ui.hint(L.tips[0]);
        this.tipI = 1; this.tipT = 14;
      }
      pl.update(dt, G.noInput);
    } else if (this.state === 'play') {
      this.time += dt;
      // aim point for the breath weapon: where the camera looks
      G.camera.getWorldDirection(_d);
      const start = cam.dist * 0.95;
      const range = pl.size * 10 + 120;
      const hit = world.raycast(G.camera.position.x + _d.x * start, G.camera.position.y + _d.y * start, G.camera.position.z + _d.z * start, _d.x, _d.y, _d.z, range, clamp(pl.size * 0.2, 2, 8));
      if (hit) pl.aim.set(hit.x, hit.y, hit.z);
      else pl.aim.set(G.camera.position.x + _d.x * (start + range), Math.max(0, G.camera.position.y + _d.y * (start + range)), G.camera.position.z + _d.z * (start + range));
      pl.update(dt, input);
      this.updateProgress(dt);
      // rotating tips
      this.tipT -= dt;
      if (this.tipT <= 0 && this.tipI < L.tips.length) { G.ui.hint(L.tips[this.tipI++]); this.tipT = 22; }
      if (pl.rage >= 1 && !this.rageHint) { this.rageHint = true; G.ui.hint('RAMPAGE READY - PRESS R'); G.audio.play('powerUp5', { vol: 0.6 }); }
      if (pl.rage < 1) this.rageHint = false;
    } else {
      // won / lost: let the scene play out, then results
      this.endT += rawDt;
      pl.update(dt, G.noInput);
      cam.orbit = 0.25;
      if (this.state === 'won' && this.endT > 0.8 && !this.wonRoar) { this.wonRoar = true; pl.roarCd = 0; pl.action = null; pl.tryRoar(); }
      if (this.endT > (this.state === 'won' ? 4.2 : 3.2) && !this.reported) {
        this.reported = true;
        G.app.finishLevel(this.results());
      }
    }
    if (this.boss) this.boss.update(dt);
    G.units.update(dt);
    world.update(dt);
    this.updatePending();
    // combo decay
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        if (this.combo >= 40) G.audio.say('combo_breaker', 0.6);
        this.combo = 0; this.comboSaid = 0;
      }
    }
    cam.update(dt, rawDt, pl, this.state === 'play' ? input : G.noInput);
    world.updateSun(pl.pos, pl.size);
    G.audio.setListener(G.camera.position.x, G.camera.position.y, G.camera.position.z, cam.yaw, 40 + pl.size * 2.2);
    this.hudT -= rawDt;
    if (this.hudT <= 0) { this.hudT = 0.08; G.ui.updateHud(this); }
  }

  updatePending() {
    const p = this.pending;
    for (let i = p.length - 1; i >= 0; i--) if (p[i].t <= this.time || (this.menu && p[i].t <= this.time)) { const f = p[i].fn; p.splice(i, 1); f(); }
  }

  updateProgress(dt) {
    const G = this.G, pl = G.player, world = G.world, L = this.level;
    const raw = world.destroyedValue / this.goalValue;
    let p;
    if (L.endless) {
      // endless: growth follows total destruction of the whole map
      p = clamp(world.destroyedValue / (world.totalValue * 0.8), 0, 1);
      const t = 1 + Math.floor(this.time / 55);
      this.setThreat(Math.min(5, t));
      G.units.hardness = 1 + Math.max(0, this.time - 240) / 200;
      if (world.destroyedValue > world.totalValue * 0.93 && !this.endlessDone) { this.endlessDone = true; this.win(); }
    } else {
      p = clamp(raw, 0, 1);
      if (!this.bossSpawned) this.setThreat(clamp(1 + Math.floor(p * L.army.maxThreat * 0.999), 1, L.army.maxThreat));
    }
    this.progress = raw;
    // growth
    pl.targetSize = this.startSize + (this.maxSize - this.startSize) * Math.pow(p, 0.85);
    const stage = Math.min(STAGES, Math.floor(p * STAGES + 1e-6));
    if (stage > this.stage) {
      this.stage = stage;
      pl.heal(pl.maxHp * 0.22);
      G.fx.ring(pl.pos.x, pl.pos.z, pl.size * 0.4, pl.size * 3.5, 0.8, 0.5, 1, 0.6, 1, 0.8);
      G.fx.shake(0.35); G.fx.slowMo(0.5, 0.5);
      G.audio.play('powerUp10', { vol: 0.9, rate: 0.75 });
      G.audio.roar(0.8, clamp(1.3 - pl.size / 150, 0.7, 1.25));
      G.ui.banner('GROWTH!', `EVOLUTION STAGE ${stage} - ${Math.round(pl.targetSize)} M TALL`, 'grow');
      G.camRig.kick = 10;
      pl.flashT = 0.3;
    }
    if (!L.endless && raw >= 1) {
      if (L.boss) { if (!this.bossSpawned) { this.spawnBoss(); this.setThreat(Math.max(1, L.army.maxThreat - 2)); } }
      else this.win();
    }
  }

  setThreat(t) {
    if (t === this.threat) return;
    const up = t > this.threat;
    this.threat = t;
    this.G.units.threat = t;
    if (up) {
      this.G.ui.banner('THREAT LEVEL ' + t, THREAT_TEXT[t] || '', 'threat');
      this.G.audio.play('lowThreeTone', { vol: 0.55 });
      this.G.audio.radio(0.7);
    }
  }

  results() {
    const G = this.G, L = this.level, pl = G.player;
    const won = this.state === 'won';
    const obj = this.objectives;
    let stars = 0;
    if (won && !L.endless) {
      stars = 1;
      if (this.time <= L.parTime) stars++;
      if (this.landmarkNames.length ? this.stats.landmarks >= this.landmarkNames.length : pl.hp >= pl.maxHp * 0.4) stars++;
    }
    const frac = clamp(this.progress, 0, 1);
    let dna;
    if (L.endless) dna = Math.round(this.time * 2.5 + this.stats.units * 12 + this.stats.buildings * 2);
    else dna = Math.round(DNA_BASE[L.id] * (won ? 1 + 0.2 * (stars - 1) : frac * 0.45) + this.stats.units * 6);
    return { won, stars, dna, score: this.score, time: this.time, stats: Object.assign({}, this.stats), level: L, objectives: obj, size: pl.size, progress: this.progress, kills: Object.assign({}, G.units.kills) };
  }

  dispose() {
    const G = this.G;
    this.pending = [];
    this.introRoar = false; this.wonRoar = false; this.reported = false; this.rageHint = false; this.endlessDone = false;
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    if (G.units) { G.units.dispose(); G.units = null; }
    if (G.player) { G.player.dispose(); G.player = null; }
    if (G.world) { G.world.dispose(); G.world = null; }
    if (this.mounds) { G.scene.remove(this.mounds); this.mounds.dispose(); this.mounds = null; }
    if (G.fx) G.fx.clear();
    if (G.audio) { G.audio.muteLoops(); }
    this.state = 'none';
  }
}

// Everything that lives in the city: fleeing civilians, traffic, the army and its projectiles.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { A } from './assets.js';
import { FlatModel, flattenObject, soupToGeometry, shellMaterial } from './fracture.js';
import { TILE } from './world.js';
import { rand, pick, clamp, TAU, angleDiff, dampAngle, damp } from './util.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class InstPool {
  constructor(geometry, material, cap, scene, shadow = true) {
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, ZERO);
    this.free = [];
    for (let i = cap - 1; i >= 0; i--) this.free.push(i);
    this.scene = scene;
    scene.add(this.mesh);
  }
  alloc() { return this.free.length ? this.free.pop() : -1; }
  release(i) { this.mesh.setMatrixAt(i, ZERO); this.mesh.instanceMatrix.needsUpdate = true; this.free.push(i); }
  set(i, x, y, z, yaw, s, pitch = 0, roll = 0) {
    _e.set(pitch, yaw, roll, 'YXZ');
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(s, s, s));
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.dispose(); }
}

// Bake a skinned character into static poses (so hundreds can be instanced).
function bakePoses(key, clipName, times) {
  const g = A.gltf[key];
  const root = cloneSkinned(g.scene);
  const mixer = new THREE.AnimationMixer(root);
  const clip = g.animations.find((c) => c.name === clipName) || g.animations[0];
  const action = mixer.clipAction(clip);
  action.play();
  const out = [];
  let map = null;
  const inv = new THREE.Matrix4();
  for (const t of times) {
    mixer.setTime(t * clip.duration);
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    const data = [];
    root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      if (o.material.map) map = o.material.map;
      o.skeleton.update();
      const geo = o.geometry, pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
      const n = idx ? idx.count : pos.count;
      const mw = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < n; i++) {
        const vi = idx ? idx.getX(i) : i;
        o.getVertexPosition(vi, _v).applyMatrix4(mw);
        data.push(_v.x, _v.y, _v.z, 0, 1, 0, uv ? uv.getX(vi) : 0, uv ? uv.getY(vi) : 0, 1, 1, 1);
      }
    });
    const geo = soupToGeometry(data);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    out.push(geo);
  }
  return { geos: out, material: shellMaterial(map) };
}

// Build an articulated unit model: one merged static mesh + one merged mesh per moving part.
const unitCache = new Map();
function unitModel(key, parts) {
  let c = unitCache.get(key);
  if (!c) {
    const scene = A.gltf[key].scene;
    scene.updateMatrixWorld(true);
    const partNodes = parts.map((n) => scene.getObjectByName(n)).filter(Boolean);
    const inPart = (o) => { for (let p = o; p; p = p.parent) if (partNodes.includes(p)) return true; return false; };
    const st = flattenObject(scene, (o) => !inPart(o));
    c = { body: soupToGeometry(st.data), mat: shellMaterial(st.map), parts: [], flat: FlatModel.get(key, scene) };
    c.body.computeBoundingSphere();
    const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    for (const pn of partNodes) {
      const fl = flattenObject(pn);
      const geo = soupToGeometry(fl.data);
      geo.computeBoundingSphere();
      const m = new THREE.Matrix4().multiplyMatrices(inv, pn.matrixWorld);
      c.parts.push({ name: pn.name, geo, pos: new THREE.Vector3().setFromMatrixPosition(m) });
    }
    unitCache.set(key, c);
  }
  const group = new THREE.Group();
  const body = new THREE.Mesh(c.body, c.mat);
  body.castShadow = true;
  group.add(body);
  const partMeshes = {};
  for (const p of c.parts) {
    const m = new THREE.Mesh(p.geo, c.mat);
    m.position.copy(p.pos); m.castShadow = true;
    group.add(m);
    partMeshes[p.name] = m;
  }
  return { group, parts: partMeshes, flat: c.flat };
}

const CAR_MODELS = [
  ['cars/sedan', 1.5], ['cars/sedan-sports', 1.5], ['cars/suv', 1.5], ['cars/suv-luxury', 1.5], ['cars/taxi', 1.5], ['cars/hatchback-sports', 1.5],
  ['cars/van', 1.5], ['cars/delivery', 1.5], ['cars/truck', 1.5], ['cars/garbage-truck', 1.5], ['cars/ambulance', 1.5], ['cars/firetruck', 1.5],
  ['military/city-bus-49fd97', 1.0], ['military/yellow-school-bus-0fd3b6', 1.0],
];
const CAR_PARTS = ['cars/debris-tire', 'cars/debris-door', 'cars/debris-bumper', 'cars/debris-plate-a', 'cars/debris-plate-b', 'cars/debris-spoiler-a'];
const PEOPLE = ['people/character-male-a', 'people/character-male-b', 'people/character-male-c', 'people/character-female-a', 'people/character-female-b', 'people/character-female-c'];

const UNIT_DEF = {
  police: { model: 'cars/police', parts: [], scale: 1.5, hp: 40, speed: 17, range: [22, 48], fixedScale: true, score: 150, radius: 2.4 },
  jeep: { model: 'military/scout-jeep-c02efe', parts: [], scale: 1.5, hp: 60, speed: 18, range: [30, 65], score: 200, radius: 2.6 },
  tank: { model: 'military/medium-tank-65da6b', parts: ['turret'], scale: 1.15, hp: 160, speed: 9, range: [65, 125], score: 400, radius: 4.2 },
  truck: { model: 'military/military-cargo-truck-652f66', parts: [], scale: 1.3, hp: 90, speed: 11, range: [130, 210], score: 350, radius: 4 },
  heli: { model: 'military/helicopter-9d1986', parts: ['rotor-main', 'rotor-tail'], scale: 0.95, hp: 70, speed: 26, range: [40, 85], score: 500, radius: 5, air: true },
  jet: { model: 'military/single-engine-fighter-a6addf', parts: ['propeller'], scale: 1.5, hp: 50, speed: 120, range: [0, 0], score: 800, radius: 6, air: true },
  bomber: { model: 'military/heavy-bomber-62be39', parts: [], scale: 1.6, hp: 400, speed: 90, range: [0, 0], score: 1500, radius: 14, air: true },
  turret: { model: 'military/defense-turret-12ba8d', parts: ['turret'], scale: 3.2, hp: 220, speed: 0, range: [0, 240], score: 450, radius: 4.5, fixed: true },
};

export class Units {
  constructor(G, world, level) {
    this.G = G;
    this.world = world;
    this.level = level;
    this.scene = G.scene;
    const q = G.quality;
    this.army = [];
    this.proj = [];
    this.cars = [];
    this.civs = [];
    this.pools = [];
    this.uScale = level.army.uScale;
    this.dmgMul = level.army.dmg;
    this.threat = 1;
    this.spawnT = 3;
    this.jetT = 10;
    this.hardness = 1;      // endless scaling
    this.calm = false;      // menu / cutscene: no army
    this.sirenV = 0; this.heliV = 0;
    this.kills = { police: 0, jeep: 0, tank: 0, truck: 0, heli: 0, jet: 0, turret: 0, bomber: 0 };
    // --- projectiles pools
    const mis = FlatModel.get('military/missile-0717d1', A.gltf['military/missile-0717d1'].scene);
    this.missilePool = new InstPool(mis.centered(), mis.material, 48, this.scene, false);
    const shell = FlatModel.get('military/artillery-shell-0870bc', A.gltf['military/artillery-shell-0870bc'].scene);
    const sg = shell.centered().clone(); sg.rotateX(Math.PI / 2); // nose along +Z
    this.shellPool = new InstPool(sg, shell.material, 48, this.scene, false);
    this.pools.push(this.missilePool, this.shellPool);
    // --- civilians
    this.civCap = Math.round(level.people * q.crowd);
    this.civPools = [];
    for (const key of PEOPLE) {
      const b = bakePoses(key, 'sprint', [0.0, 0.5]);
      const per = Math.ceil(this.civCap / PEOPLE.length) + 6;
      const pools = b.geos.map((g) => { const p = new InstPool(g, b.material, per, this.scene, q.crowdShadows); this.pools.push(p); return p; });
      this.civPools.push(pools);
    }
    // --- cars
    this.carPools = CAR_MODELS.map(([key, sc]) => {
      const flat = FlatModel.get(key, A.gltf[key].scene);
      const p = new InstPool(flat.geometry, flat.material, 16, this.scene);
      this.pools.push(p);
      return { pool: p, flat, sc, len: flat.size.z * sc };
    });
    this.carParts = CAR_PARTS.map((k) => FlatModel.get(k, A.gltf[k].scene));
    this.roadMinX = world.roadsX[0] - 6 * TILE; this.roadMaxX = world.roadsX[world.roadsX.length - 1] + 6 * TILE;
    this.roadMinZ = world.roadsZ[0] - 6 * TILE; this.roadMaxZ = level.water ? world.roadsZ[world.roadsZ.length - 1] : world.roadsZ[world.roadsZ.length - 1] + 6 * TILE;
    const nCars = Math.round(level.cars * q.crowd);
    for (let i = 0; i < nCars; i++) this.spawnCar(true, false);
    for (let i = 0; i < Math.round(nCars * level.parked); i++) this.spawnCar(true, true);
    for (let i = 0; i < this.civCap; i++) this.spawnCiv(true);
    // static turrets
    if (world.turretSpots) for (const t of world.turretSpots) this.spawnUnit('turret', t.x, t.z);
  }

  // ---------------------------------------------------------------- roads
  roadPos(o) {
    // axis 0: along X on horizontal road; axis 1: along Z on vertical road
    const w = this.world;
    if (o.axis === 0) { o.x = o.t; o.z = w.roadsZ[o.line] + o.lane * o.dir; o.yaw = o.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { o.z = o.t; o.x = w.roadsX[o.line] - o.lane * o.dir; o.yaw = o.dir > 0 ? 0 : Math.PI; }
  }
  randomRoadSpot(o, edge) {
    const w = this.world;
    o.axis = Math.random() < 0.5 ? 0 : 1;
    const lines = o.axis === 0 ? w.roadsZ : w.roadsX;
    o.line = (Math.random() * lines.length) | 0;
    const lo = o.axis === 0 ? this.roadMinX : this.roadMinZ, hi = o.axis === 0 ? this.roadMaxX : this.roadMaxZ;
    o.dir = Math.random() < 0.5 ? 1 : -1;
    if (edge) { o.t = o.dir > 0 ? lo + 4 : hi - 4; }
    else o.t = rand(lo + 20, hi - 20);
    this.roadPos(o);
  }
  // returns crossed perpendicular line index or -1
  crossed(o, prevT) {
    const lines = o.axis === 0 ? this.world.roadsX : this.world.roadsZ;
    for (let i = 0; i < lines.length; i++) {
      const c = lines[i];
      if ((prevT - c) * (o.t - c) <= 0 && prevT !== o.t) return i;
    }
    return -1;
  }
  turn(o, lineIdx, dir) {
    const w = this.world;
    const fixed = o.axis === 0 ? w.roadsZ[o.line] : w.roadsX[o.line];
    o.axis = 1 - o.axis; o.line = lineIdx; o.t = fixed + dir * 0.5; o.dir = dir;
    this.roadPos(o);
  }

  // ---------------------------------------------------------------- civilians
  spawnCiv(initial) {
    const w = this.world, pl = this.G.player;
    const c = { model: (this.civSeq = ((this.civSeq || 0) + 1) % PEOPLE.length), state: 0, y: 0, vy: 0, vx: 0, vz: 0, spin: 0, phase: rand(1), speed: rand(1.2, 2), run: rand(5.5, 8.5), fleeDir: 0, fleeT: 0, lane: 0, s: rand(0.95, 1.15) };
    for (let k = 0; k < 6; k++) {
      this.randomRoadSpot(c, false);
      c.lane = (TILE * 0.5 - rand(0.8, 2.6)) * (Math.random() < 0.5 ? 1 : -1) / 1; // sidewalk offset (signed, independent of dir)
      this.civPos(c);
      const inCity = Math.abs(c.x) < w.W / 2 + 10 && Math.abs(c.z) < w.D / 2 + 10;
      if (!inCity) continue;
      if (!pl) break;
      const d = Math.hypot(c.x - pl.pos.x, c.z - pl.pos.z);
      if (initial ? d > pl.size * 2 : d > pl.size * 5 + 40) break;
    }
    this.civs.push(c);
  }
  civPos(c) {
    const w = this.world;
    if (c.axis === 0) { c.x = c.t; c.z = w.roadsZ[c.line] + c.lane; }
    else { c.z = c.t; c.x = w.roadsX[c.line] + c.lane; }
  }
  updateCivs(dt) {
    const G = this.G, pl = G.player, w = this.world;
    const px = pl ? pl.pos.x : 1e9, pz = pl ? pl.pos.z : 1e9;
    const fear = pl ? pl.size * 4.2 + 30 : 0;
    const fear2 = fear * fear;
    for (const pools of this.civPools) for (const p of pools) p._n = 0;
    const used = this.civPools.map((pools) => pools.map(() => 0));
    for (let i = this.civs.length - 1; i >= 0; i--) {
      const c = this.civs[i];
      let yaw = 0, pitch = 0;
      if (c.state === 2) {
        // flung through the air
        c.vy -= 24 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.spin += dt * 9;
        pitch = c.spin; yaw = c.spin * 0.7;
        if (c.y < 0 && c.vy < 0) {
          G.fx.dust(c.x, 0, c.z, 1.2, 1);
          this.civs.splice(i, 1);
          if (!this.calm && w.destroyedValue < w.totalValue * 0.85) this.spawnCiv(false);
          continue;
        }
      } else {
        const dx = c.x - px, dz = c.z - pz;
        const d2 = dx * dx + dz * dz;
        const scared = d2 < fear2 || c.fleeT > 0;
        let v = c.speed;
        if (scared) {
          v = c.run;
          if (c.fleeT <= 0) {
            c.fleeT = rand(1.5, 3);
            const along = c.axis === 0 ? dx : dz;
            c.dir = along >= 0 ? 1 : -1;
            if (Math.abs(along) < 4) c.dir = Math.random() < 0.5 ? 1 : -1;
          }
          if (d2 < fear2) c.fleeT = Math.max(c.fleeT, 0.5);
          c.fleeT -= dt;
        }
        const prev = c.t;
        c.t += c.dir * v * dt;
        const ci = this.crossed(c, prev);
        if (ci >= 0 && Math.random() < (scared ? 0.5 : 0.25)) {
          // turn onto the crossing street (away from the monster when scared)
          const fixed = c.axis === 0 ? w.roadsZ[c.line] : w.roadsX[c.line];
          let dir = Math.random() < 0.5 ? 1 : -1;
          if (scared) { const rel = c.axis === 0 ? fixed - pz : fixed - px; dir = rel >= 0 ? 1 : -1; }
          c.axis = 1 - c.axis; c.line = ci; c.t = fixed + dir * (Math.abs(c.lane) + 0.5); c.dir = dir;
        }
        this.civPos(c);
        yaw = c.axis === 0 ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI);
        c.phase += dt * (scared ? 3.4 : 1.6);
        // left the city: recycle
        if (Math.abs(c.x) > w.W / 2 + 60 || Math.abs(c.z) > w.D / 2 + 60 || (w.inWater(c.z))) {
          this.civs.splice(i, 1);
          this.spawnCiv(false);
          continue;
        }
      }
      const frame = (c.phase | 0) & 1;
      const pool = this.civPools[c.model][frame];
      const idx = used[c.model][frame]++;
      if (idx < pool.mesh.instanceMatrix.count) {
        const bob = c.state === 2 ? 0 : Math.abs(Math.sin(c.phase * Math.PI)) * 0.12;
        _e.set(pitch, yaw, 0, 'YXZ');
        _m.compose(_p.set(c.x, c.y + bob, c.z), _q.setFromEuler(_e), _s.set(c.s, c.s, c.s));
        pool.mesh.setMatrixAt(idx, _m);
      }
    }
    this.civPools.forEach((pools, mi) => pools.forEach((p, fi) => { p.mesh.count = Math.min(used[mi][fi], p.mesh.instanceMatrix.count); p.mesh.instanceMatrix.needsUpdate = true; }));
  }
  flingCiv(c, fx, fz, power) {
    if (c.state === 2) return;
    c.state = 2;
    const pl = this.G.player;
    const s = pl ? pl.size : 10;
    let dx = c.x - fx, dz = c.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    const sp = rand(0.5, 1.1) * (6 + s * 0.5) * power;
    c.vx = (dx / d) * sp + rand(-2, 2); c.vz = (dz / d) * sp + rand(-2, 2);
    c.vy = rand(0.8, 1.4) * (8 + s * 0.45) * power;
    c.y = 0.5;
    this.G.game.onCivilian(c);
  }

  // ---------------------------------------------------------------- traffic
  spawnCar(initial, parked) {
    const mi = (Math.random() * CAR_MODELS.length) | 0;
    const cp = this.carPools[mi];
    const idx = cp.pool.alloc();
    if (idx < 0) return;
    const c = { mi, idx, parked, speed: rand(8, 13), v: 0, lane: parked ? 5.6 : 2.3, uturnT: 0, scared: false, len: cp.len, alive: true };
    this.randomRoadSpot(c, !initial);
    if (parked) { c.v = 0; }
    this.cars.push(c);
    cp.pool.set(idx, c.x, 0, c.z, c.yaw, cp.sc);
  }
  updateCars(dt) {
    const G = this.G, pl = G.player, w = this.world;
    const px = pl ? pl.pos.x : 1e9, pz = pl ? pl.pos.z : 1e9;
    const fear = pl ? pl.size * 4 + 35 : 0;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.parked) continue;
      const dx = c.x - px, dz = c.z - pz;
      const d = Math.hypot(dx, dz);
      c.scared = d < fear;
      let target = c.speed * (c.scared ? 2.1 : 1);
      c.uturnT -= dt;
      if (c.scared && c.uturnT <= 0) {
        // heading toward the monster? spin around
        const hx = c.axis === 0 ? c.dir : 0, hz = c.axis === 1 ? c.dir : 0;
        if (hx * -dx + hz * -dz > 0 && d < fear * 0.8) { c.dir = -c.dir; c.uturnT = 2.5; }
      }
      // keep distance to the car ahead
      for (let j = 0; j < this.cars.length; j++) {
        const o = this.cars[j];
        if (o === c || o.parked || o.axis !== c.axis || o.line !== c.line || o.dir !== c.dir) continue;
        const gap = (o.t - c.t) * c.dir;
        if (gap > 0 && gap < c.len + 5) { target = Math.min(target, o.v * 0.9); break; }
      }
      c.v = damp(c.v, target, 2.5, dt);
      const prev = c.t;
      c.t += c.dir * c.v * dt;
      const ci = this.crossed(c, prev);
      if (ci >= 0) {
        let doTurn = Math.random() < 0.3, dir = Math.random() < 0.5 ? 1 : -1;
        if (c.scared) {
          const fixed = c.axis === 0 ? w.roadsZ[c.line] : w.roadsX[c.line];
          const rel = c.axis === 0 ? fixed - pz : fixed - px;
          doTurn = Math.random() < 0.5; dir = rel >= 0 ? 1 : -1;
        }
        if (doTurn) this.turn(c, ci, dir);
      }
      this.roadPos(c);
      const lo = c.axis === 0 ? this.roadMinX : this.roadMinZ, hi = c.axis === 0 ? this.roadMaxX : this.roadMaxZ;
      const cp = this.carPools[c.mi];
      if (c.t < lo || c.t > hi) {
        // left town: come back in somewhere else
        this.randomRoadSpot(c, true);
      }
      cp.pool.set(c.idx, c.x, 0, c.z, c.yaw, cp.sc);
    }
  }
  wreckCar(c, fx, fz, vx, vz, power, src) {
    if (!c.alive) return;
    c.alive = false;
    const G = this.G;
    const cp = this.carPools[c.mi];
    cp.pool.release(c.idx);
    const i = this.cars.indexOf(c);
    if (i >= 0) this.cars.splice(i, 1);
    const pl = G.player, s = pl ? pl.size : 10;
    let dx = c.x - fx, dz = c.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    const sp = (5 + s * 0.55) * power * rand(0.7, 1.2);
    const ux = dx / d, uz = dz / d;
    const cx = c.x, cz = c.z;
    const burn = Math.random() < 0.6 ? rand(3, 7) : 0;
    G.fx.flingModel(cp.flat, c.x, 0.4, c.z, c.yaw, cp.sc, ux * sp + vx * 0.5, (7 + s * 0.45) * power * rand(0.7, 1.2), uz * sp + vz * 0.5, {
      burn, life: rand(5, 8),
      onLand: (deb) => {
        const m = deb.mesh.position;
        G.fx.explosion(m.x, m.y, m.z, 4.5, {});
        for (let k = 0; k < 3; k++) {
          const part = pick(this.carParts);
          G.fx.flingModel(part, m.x, m.y, m.z, rand(TAU), 1.6, rand(-9, 9), rand(8, 16), rand(-9, 9), { life: rand(3, 5), dusty: false });
        }
        this.blast(m.x, m.y, m.z, 9, 30, 'car');
      },
    });
    G.audio.play('tin', { vol: 0.8, rate: rand(0.7, 1), pos: c });
    G.audio.play('glass', { vol: 0.5, pos: c });
    G.fx.sparks(cx, 1, cz, 2, 5);
    G.game.onVehicle(c, src);
    if (!c.parked && !this.calm && this.world.destroyedValue < this.world.totalValue * 0.8 && Math.random() < 0.7) this.spawnCar(false, false);
  }

  // ---------------------------------------------------------------- army
  spawnUnit(type, x, z) {
    const def = UNIT_DEF[type];
    const sc = def.scale * (def.fixedScale ? 1 : this.uScale);
    const m = unitModel(def.model, def.parts);
    m.group.scale.setScalar(sc);
    this.scene.add(m.group);
    const hp = def.hp * Math.pow(def.fixedScale ? 1 : this.uScale, 1.8) * this.hardness;
    const u = {
      type, def, obj: m.group, parts: m.parts, flat: m.flat, sc, hp, maxHp: hp, alive: true, x: x || 0, y: 0, z: z || 0, yaw: 0,
      stun: 0, cd: rand(1.5, 3.5), cd2: rand(2, 5), burst: 0, radius: def.radius * sc / def.scale * (def.scale), t: 0, state: 'move',
      lane: 2.3, v: 0, turretYaw: 0, phase: rand(TAU), alt: 0, dying: 0, vy: 0, roll: 0, pitch: 0, hit: 0,
    };
    u.radius = def.radius * sc;
    if (def.fixed) { u.state = 'fixed'; }
    else if (def.air) {
      if (type === 'heli') {
        const a = rand(TAU), pl = this.G.player;
        const R = Math.max(this.world.W, this.world.D) * 0.5 + 180;
        u.x = Math.cos(a) * R; u.z = Math.sin(a) * R; u.y = 60 + (pl ? pl.size : 10);
        u.orbitDir = Math.random() < 0.5 ? 1 : -1; u.orbitA = a;
      }
    } else {
      u.nav = { axis: 0, line: 0, dir: 1, t: 0, lane: type === 'tank' ? 1.4 : 2.3, x: 0, z: 0, yaw: 0 };
      this.randomRoadSpot(u.nav, true);
      u.x = u.nav.x; u.z = u.nav.z; u.yaw = u.nav.yaw; u.turnT = 0;
    }
    u.obj.position.set(u.x, u.y, u.z);
    this.army.push(u);
    return u;
  }

  count(type) { let n = 0; for (const u of this.army) if (u.type === type && u.alive && !u.dying) n++; return n; }

  updateSpawns(dt) {
    if (this.calm) return;
    const waves = this.level.army.waves;
    const wave = waves[clamp(this.threat - 1, 0, waves.length - 1)];
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = rand(1.6, 3.2) / Math.sqrt(this.hardness);
      for (const type of ['police', 'jeep', 'tank', 'truck', 'heli']) {
        const want = Math.round((wave[type] || 0) * (type === 'police' ? 1 : Math.min(2, this.hardness)));
        if (want && this.count(type) < want) {
          this.spawnUnit(type);
          if (Math.random() < 0.5) this.G.audio.radio(0.5);
          break;
        }
      }
    }
    if (wave.jet) {
      this.jetT -= dt;
      if (this.jetT <= 0 && this.count('jet') < wave.jet) {
        this.jetT = rand(9, 15) / wave.jet;
        this.launchJet();
      }
    }
  }

  launchJet(type = 'jet') {
    const pl = this.G.player;
    const u = this.spawnUnit(type);
    const a = rand(TAU);
    const R = 900;
    u.x = pl.pos.x + Math.cos(a) * R; u.z = pl.pos.z + Math.sin(a) * R;
    u.y = pl.size * 1.5 + 55 + rand(0, 40);
    u.yaw = Math.atan2(pl.pos.x - u.x, pl.pos.z - u.z) + rand(-0.06, 0.06);
    u.state = 'run'; u.dropped = 0; u.t = 0;
    this.G.audio.play('spaceEngine_000', { vol: 0.5, rate: 1.4, jitter: 0 });
    return u;
  }

  aimPoint(out) {
    const pl = this.G.player;
    return out.set(pl.pos.x, pl.pos.y + pl.size * 0.55, pl.pos.z);
  }

  updateArmy(dt) {
    const G = this.G, pl = G.player, w = this.world;
    if (!pl) return;
    const px = pl.pos.x, pz = pl.pos.z, ps = pl.size;
    let nearPolice = 1e9, nearHeli = 1e9;
    const canFire = !this.calm && !pl.dead && G.game.state === 'play';
    for (let i = this.army.length - 1; i >= 0; i--) {
      const u = this.army[i];
      const def = u.def;
      u.t += dt;
      u.hit = Math.max(0, u.hit - dt);
      if (u.dying > 0) { this.updateDying(u, dt, i); continue; }
      const dx = px - u.x, dz = pz - u.z;
      const dist = Math.hypot(dx, dz);
      const stunned = u.stun > 0;
      if (stunned) u.stun -= dt;
      const type = u.type;
      if (type === 'heli') {
        nearHeli = Math.min(nearHeli, dist);
        // orbit the monster, drifting in and out
        const R = (def.range[0] + (def.range[1] - def.range[0]) * (0.5 + 0.5 * Math.sin(u.t * 0.35 + u.phase))) * (0.6 + ps * 0.02) + ps * 0.6;
        if (!stunned) u.orbitA += u.orbitDir * dt * (def.speed / Math.max(R, 30)) * 0.9;
        const tx = px + Math.cos(u.orbitA) * R, tz = pz + Math.sin(u.orbitA) * R;
        const ty = Math.max(ps * (0.82 + 0.25 * Math.sin(u.t * 0.5 + u.phase)), 14) + pl.pos.y;
        const k = stunned ? 0.4 : 1.4;
        const ox = u.x, oz = u.z;
        u.x = damp(u.x, tx, k, dt); u.z = damp(u.z, tz, k, dt);
        u.y = damp(u.y, stunned ? Math.max(ty * 0.6, 8) : ty, 1.2, dt);
        const vx = (u.x - ox) / dt, vz = (u.z - oz) / dt;
        u.yaw = stunned ? u.yaw + dt * 5 : dampAngle(u.yaw, Math.atan2(dx, dz), 4, dt);
        u.roll = damp(u.roll, clamp((vx * Math.cos(u.yaw) - vz * Math.sin(u.yaw)) * -0.02, -0.5, 0.5), 3, dt);
        u.pitch = damp(u.pitch, clamp((vx * Math.sin(u.yaw) + vz * Math.cos(u.yaw)) * 0.012, -0.3, 0.4), 3, dt);
        if (u.parts['rotor-main']) u.parts['rotor-main'].rotation.y += dt * 38;
        if (u.parts['rotor-tail']) u.parts['rotor-tail'].rotation.x += dt * 50;
        if (canFire && !stunned && dist < 260) {
          u.cd -= dt; u.cd2 -= dt;
          if (u.cd <= 0) { u.cd = rand(3.2, 5.5); this.fireMissile(u, 2); }
          if (u.cd2 <= 0) { u.cd2 = rand(1.2, 2.4); this.fireBurst(u, 4, 0.9 * this.dmgMul); }
        }
      } else if (type === 'jet' || type === 'bomber') {
        const sp = def.speed + ps * 0.4;
        u.x += Math.sin(u.yaw) * sp * dt; u.z += Math.cos(u.yaw) * sp * dt;
        if (u.parts.propeller) u.parts.propeller.rotation.z += dt * 60;
        u.roll = Math.sin(u.t * 1.3) * 0.15;
        const along = dx * Math.sin(u.yaw) + dz * Math.cos(u.yaw);
        if (canFire && along > 0 && along < 300 + ps * 2 && u.dropped < (type === 'bomber' ? 6 : 3)) {
          u.cd -= dt;
          if (u.cd <= 0) {
            u.cd = 0.22; u.dropped++;
            if (type === 'jet' && Math.random() < 0.5) this.fireMissile(u, 1, true);
            else this.dropBomb(u, sp);
          }
        }
        if (u.t > 16 || along < -700) { this.removeUnit(u, i); continue; }
      } else if (type === 'turret') {
        if (!stunned && dist < def.range[1] + ps) {
          u.turretYaw = dampAngle(u.turretYaw, Math.atan2(dx, dz), 3, dt);
          if (u.parts.turret) u.parts.turret.rotation.y = u.turretYaw;
          if (canFire) {
            u.cd -= dt;
            if (u.cd <= 0) { u.cd = rand(1.6, 2.6); this.fireBurst(u, 5, 1.1 * this.dmgMul, u.sc * 2.6); if (Math.random() < 0.4) this.fireShell(u, u.sc * 3); }
          }
        }
      } else {
        // ground vehicles drive the street grid toward a firing position
        if (type === 'police') nearPolice = Math.min(nearPolice, dist);
        const rmin = def.range[0] * (0.7 + this.uScale * 0.3) + ps * 0.9, rmax = def.range[1] * (0.7 + this.uScale * 0.3) + ps * 1.2;
        let want = 0;
        if (!stunned) {
          if (dist > rmax) want = 1; else if (dist < rmin) want = -1;
        }
        const o = u.nav;
        const hx = o.axis === 0 ? o.dir : 0, hz = o.axis === 1 ? o.dir : 0;
        const toward = hx * dx + hz * dz; // >0: currently heading toward the monster
        let speed = 0;
        u.turnT -= dt;
        if (want === 1) { speed = def.speed; if (toward < -8 && u.turnT <= 0) { o.dir = -o.dir; u.turnT = 1.2; } }
        else if (want === -1) { speed = def.speed * 0.9; if (toward > 8 && u.turnT <= 0) { o.dir = -o.dir; u.turnT = 1.2; } }
        u.v = damp(u.v, speed, 2, dt);
        const pT = o.t;
        o.t += o.dir * u.v * dt;
        const ci = this.crossed(o, pT);
        if (ci >= 0 && want !== 0) {
          // pick the street that best serves the goal
          const fixed = o.axis === 0 ? w.roadsZ[o.line] : w.roadsX[o.line];
          const rel = o.axis === 0 ? pz - fixed : px - fixed;         // monster offset along the crossing street
          const alongNow = (o.axis === 0 ? dx : dz) * o.dir;         // distance still to cover on this street
          const better = want === 1 ? Math.abs(rel) > Math.max(alongNow, 0) + 6 : Math.abs(rel) < 30;
          if (better && Math.random() < 0.85) this.turn(o, ci, (rel >= 0 ? 1 : -1) * want);
        }
        const lo = (o.axis === 0 ? this.roadMinX : this.roadMinZ) + 2, hi = (o.axis === 0 ? this.roadMaxX : this.roadMaxZ) - 2;
        if (o.t < lo) { o.t = lo; o.dir = 1; } else if (o.t > hi) { o.t = hi; o.dir = -1; }
        this.roadPos(o);
        u.x = o.x; u.z = o.z;
        u.yaw = dampAngle(u.yaw, o.yaw, 6, dt);
        if (type === 'tank') {
          u.turretYaw = dampAngle(u.turretYaw, Math.atan2(dx, dz) - u.yaw, 2.5, dt);
          if (u.parts.turret) u.parts.turret.rotation.y = u.turretYaw;
        }
        if (canFire && !stunned && dist < rmax * 1.25) {
          u.cd -= dt;
          if (u.cd <= 0) {
            if (type === 'tank') { u.cd = rand(2.8, 4.2); this.fireShell(u, u.sc * 2.4); }
            else if (type === 'truck') { u.cd = rand(5, 7.5); this.fireMissile(u, 2, false, true); }
            else if (type === 'jeep') { u.cd = rand(1.3, 2.2); this.fireBurst(u, 5, 0.75 * this.dmgMul, u.sc * 1.6); }
            else { u.cd = rand(1.2, 2.2); this.fireBurst(u, 3, 0.5 * this.dmgMul, 1.8); }
          }
        }
        if (type === 'police' && Math.random() < dt * 9) {
          const blue = ((G.time * 4) | 0) & 1;
          G.fx.p('circle_05', u.x, 2.6, u.z, 0, 0, 0, 0.12, 5, 6, blue ? 0.2 : 1, 0.15, blue ? 1 : 0.15, 0.9, 1, 0, 0, 0.3, 1, 0);
        }
      }
      // stunned: sparks
      if (stunned && Math.random() < dt * 5) G.fx.p('spark_01', u.x, u.y + u.radius * 0.8, u.z, 0, 2, 0, 0.3, u.radius * 0.8, u.radius * 1.3, 0.7, 0.9, 1, 0.9, 1, 0, 0, 0.2, 1);
      const o3 = u.obj;
      o3.position.set(u.x, u.y, u.z);
      o3.rotation.set(u.pitch, u.yaw, u.roll, 'YXZ');
    }
    // ambience loops
    this.sirenV = damp(this.sirenV, nearPolice < 220 && !this.calm ? clamp(1 - nearPolice / 220, 0, 1) * 0.22 : 0, 4, dt);
    this.heliV = damp(this.heliV, nearHeli < 300 ? clamp(1 - nearHeli / 300, 0.15, 1) * 0.5 : 0, 4, dt);
    G.audio.loop('siren', 'twoTone1', this.sirenV, 0.9 + Math.sin(G.time * 3) * 0.05);
    G.audio.loop('heli', 'engineCircular_000', this.heliV, 1.5, 1800);
  }

  updateDying(u, dt, i) {
    const G = this.G;
    u.dying += dt;
    u.vy -= 22 * dt;
    u.y += u.vy * dt;
    u.x += (u.dvx || 0) * dt; u.z += (u.dvz || 0) * dt;
    u.yaw += dt * 6; u.roll += dt * 2.5;
    if (Math.random() < dt * 30) G.fx.smoke(u.x, u.y, u.z, u.radius * 0.8, 1, true);
    if (Math.random() < dt * 20) G.fx.fire(u.x, u.y, u.z, u.radius * 0.6, 1);
    u.obj.position.set(u.x, u.y, u.z);
    u.obj.rotation.set(u.pitch, u.yaw, u.roll, 'YXZ');
    if (u.parts['rotor-main']) u.parts['rotor-main'].rotation.y += dt * 12;
    const ground = this.world.groundY(u.x, u.z);
    let hitB = false;
    if (u.y > ground + 1) {
      const list = this.world.buildingsNear(u.x, u.z, 2);
      for (const b of list) if (b.solidHeightAt(u.x, u.z, u.radius * 0.5) > u.y) { hitB = true; break; }
    }
    if (u.y <= ground + 1 || hitB) {
      G.fx.explosion(u.x, Math.max(u.y, 1), u.z, u.radius * 2.2);
      this.world.damageSphere(u.x, u.y, u.z, u.radius * 2.6, 260 * this.uScale, 0, -0.5, 0, 'crash');
      this.blast(u.x, u.y, u.z, u.radius * 3, 60, 'crash');
      G.fx.addFire(u.x, Math.max(u.y, 0), u.z, u.radius * 0.8, rand(5, 9));
      G.fx.flingModel(u.flat, u.x, Math.max(u.y, 1), u.z, u.yaw, u.sc, rand(-8, 8), rand(8, 18), rand(-8, 8), { life: rand(5, 8), burn: 4 });
      this.removeUnit(u, i);
    }
  }

  removeUnit(u, i) {
    this.scene.remove(u.obj);
    u.alive = false;
    if (i === undefined) i = this.army.indexOf(u);
    if (i >= 0) this.army.splice(i, 1);
  }

  hurtUnit(u, dmg, src, fx = 0, fz = 0) {
    if (!u.alive || u.dying > 0) return false;
    u.hp -= dmg;
    u.hit = 0.1;
    if (u.hp > 0) {
      if (Math.random() < 0.5) this.G.fx.sparks(u.x, u.y + u.radius * 0.5, u.z, u.radius * 0.5, 3);
      return false;
    }
    this.killUnit(u, src, fx, fz);
    return true;
  }

  killUnit(u, src, fx = 0, fz = 0) {
    const G = this.G;
    if (!u.alive || u.dying > 0) return;
    this.kills[u.type] = (this.kills[u.type] || 0) + 1;
    G.game.onUnitKilled(u, src);
    const pos = { x: u.x, y: u.y, z: u.z };
    if (u.def.air) {
      // spiral down trailing fire, explode on impact
      u.dying = 0.001; u.vy = rand(2, 8);
      const sp = u.type === 'heli' ? 12 : u.def.speed * 0.6;
      u.dvx = Math.sin(u.yaw) * sp + rand(-6, 6); u.dvz = Math.cos(u.yaw) * sp + rand(-6, 6);
      G.fx.explosion(u.x, u.y, u.z, u.radius * 1.2, { noScorch: true });
      return;
    }
    G.fx.explosion(u.x, 1.5, u.z, u.radius * 1.8);
    G.fx.addFire(u.x, 0, u.z, u.radius * 0.6, rand(4, 8));
    const pl = G.player, s = pl ? pl.size : 10;
    let dx = u.x - (fx || (pl ? pl.pos.x : 0)), dz = u.z - (fz || (pl ? pl.pos.z : 0));
    const d = Math.hypot(dx, dz) || 1;
    const kick = src === 'blast' || src === 'crash' ? 8 : 6 + s * 0.5;
    G.fx.flingModel(u.flat, u.x, 0.6, u.z, u.yaw, u.sc, (dx / d) * kick * rand(0.6, 1.2), (8 + s * 0.4) * rand(0.8, 1.3), (dz / d) * kick * rand(0.6, 1.2), { life: rand(6, 9), burn: 5 });
    G.audio.play('metal', { vol: 0.9, rate: 0.7, pos });
    if (Math.random() < 0.6) G.audio.radio(0.55);
    this.removeUnit(u);
  }

  // ---------------------------------------------------------------- weapons
  muzzle(u, out, h = 0.6) {
    const f = u.type === 'tank' || u.type === 'turret' ? u.yaw * (u.type === 'tank' ? 1 : 0) + u.turretYaw : u.yaw;
    return out.set(u.x + Math.sin(f) * u.radius * 0.9, u.y + u.radius * h, u.z + Math.cos(f) * u.radius * 0.9);
  }

  fireShell(u, size) {
    const G = this.G, pl = G.player;
    const m = this.muzzle(u, _v, 0.55);
    const tx = pl.pos.x + pl.vel.x * 0.9 + rand(-1, 1) * pl.size * 0.35, tz = pl.pos.z + pl.vel.z * 0.9 + rand(-1, 1) * pl.size * 0.35;
    const ty = pl.size * rand(0.15, 0.6);
    const dx = tx - m.x, dz = tz - m.z, dy = ty - m.y;
    const d = Math.hypot(dx, dz);
    const T = clamp(d / 75, 0.6, 2.6);
    const g = 22;
    this.addProj({ kind: 'shell', x: m.x, y: m.y, z: m.z, vx: dx / T, vz: dz / T, vy: dy / T + 0.5 * g * T, g, size, dmg: 2.4 * this.dmgMul, blast: size * 2.4, life: T + 2, trail: 0 });
    G.fx.flash(m.x, m.y, m.z, size * 1.3, 1, 0.8, 0.5, 0.12);
    G.fx.smoke(m.x, m.y, m.z, size * 0.9, 2, false);
    G.audio.play('boom', { vol: 0.55, rate: 1.7, pos: m });
    G.audio.play('thud', { vol: 0.5, rate: 0.9, pos: m });
  }

  fireMissile(u, n, fast, lob) {
    const G = this.G;
    for (let i = 0; i < n; i++) {
      const m = this.muzzle(u, _v, 0.2);
      const side = (i - (n - 1) / 2) * u.radius * 0.8;
      const sx = m.x + Math.cos(u.yaw) * side, sz = m.z - Math.sin(u.yaw) * side;
      const sp = (fast ? 90 : 55) + this.uScale * 8;
      let vx = Math.sin(u.yaw) * sp, vz = Math.cos(u.yaw) * sp, vy = 0;
      if (lob) { vx *= 0.25; vz *= 0.25; vy = sp * 0.95; }
      const size = (1.0 + this.uScale * 0.7) * (u.type === 'truck' ? 1.4 : 1);
      this.addProj({ kind: 'missile', x: sx, y: m.y, z: sz, vx, vy, vz, speed: sp, size, dmg: (u.type === 'truck' ? 2.8 : 1.6) * this.dmgMul, blast: size * 3.2, life: lob ? 9 : 6, turn: lob ? 1.5 : 2.4, arm: lob ? 1.0 : 0.25, trail: 0, hp: 1 });
      G.audio.play('thrusterFire_000', { vol: 0.35, rate: 1.5, pos: m, jitter: 0.1 });
    }
    G.fx.flash(u.x, u.y, u.z, u.radius * 0.6, 1, 0.8, 0.6, 0.1);
  }

  fireBurst(u, n, dmg, size = 1.6) {
    const G = this.G, pl = G.player;
    const m = this.muzzle(u, _v, 0.5);
    const mx = m.x, my = m.y, mz = m.z;
    const t = this.aimPoint(_p);
    for (let i = 0; i < n; i++) {
      const tx = t.x + rand(-1, 1) * pl.size * 0.3, ty = t.y + rand(-1, 1) * pl.size * 0.3, tz = t.z + rand(-1, 1) * pl.size * 0.3;
      const dx = tx - mx, dy = ty - my, dz = tz - mz;
      const d = Math.hypot(dx, dy, dz) || 1;
      const sp = 240;
      const life = Math.min(d / sp, 1.2);
      G.fx.parts.add(G.fx.uv.circle_05, mx, my, mz, (dx / d) * sp, (dy / d) * sp, (dz / d) * sp, life + i * 0.0, size * 1.6, size * 1.2, 0, 0, 1, 0.85, 0.4, 1, 1, 0, 0, 0.02, 1);
    }
    G.fx.p('muzzle_01', mx, my, mz, 0, 0, 0, 0.08, size * 2, size * 3, 1, 0.9, 0.6, 1, 1, 0, 0, 0.2, 1, 0);
    G.audio.play('pew', { vol: 0.3, rate: 0.55, pos: m });
    // hits land a moment later
    const d = Math.hypot(t.x - mx, t.z - mz);
    this.addProj({ kind: 'hitscan', x: t.x, y: t.y, z: t.z, vx: 0, vy: 0, vz: 0, life: Math.min(d / 240, 1.2), dmg: dmg * n * 0.22, size: 1 });
  }

  dropBomb(u, sp) {
    this.addProj({ kind: 'shell', x: u.x, y: u.y - 2, z: u.z, vx: Math.sin(u.yaw) * sp * 0.55, vz: Math.cos(u.yaw) * sp * 0.55, vy: -4, g: 22, size: u.sc * 2.2, dmg: 2.8 * this.dmgMul, blast: u.sc * 6, life: 9, trail: 0, bomb: true });
  }

  addProj(p) {
    if (p.kind === 'missile') { p.idx = this.missilePool.alloc(); if (p.idx < 0) return; }
    else if (p.kind === 'shell') { p.idx = this.shellPool.alloc(); if (p.idx < 0) return; }
    p.t = 0;
    this.proj.push(p);
    return p;
  }

  killProj(p, i, explode) {
    const G = this.G;
    if (p.kind === 'missile') this.missilePool.release(p.idx);
    else if (p.kind === 'shell') this.shellPool.release(p.idx);
    if (i === undefined) i = this.proj.indexOf(p);
    if (i >= 0) this.proj.splice(i, 1);
    if (explode) {
      G.fx.explosion(p.x, Math.max(p.y, 0.5), p.z, p.blast * 0.75);
      // hurt the monster?
      const pl = G.player;
      if (pl && !p.friendly) {
        const cy = clamp(p.y, pl.pos.y, pl.pos.y + pl.size);
        const d = Math.hypot(p.x - pl.pos.x, p.y - cy, p.z - pl.pos.z) - pl.radius;
        if (d < p.blast) pl.hurt(p.dmg * (d <= 0 ? 1 : 1 - (d / p.blast) * 0.7), p.x, p.z);
      }
      // collateral: the army wrecks its own city
      this.world.damageSphere(p.x, p.y, p.z, p.blast * 0.8, 90 * this.uScale, 0, 0.2, 0, 'army');
      this.blast(p.x, p.y, p.z, p.blast * 0.7, 20, 'army');
    }
  }

  updateProj(dt) {
    const G = this.G, pl = G.player, w = this.world;
    if (!pl) return;
    const aim = this.aimPoint(_p);
    const ax = aim.x, ay = aim.y, az = aim.z;
    const hitR = pl.size * 0.38;
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      p.t += dt;
      if (p.kind === 'hitscan') {
        if (p.t >= p.life) {
          this.proj.splice(i, 1);
          if (Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) < pl.size * 0.8) {
            pl.hurt(p.dmg, p.x, p.z);
            G.fx.sparks(p.x, p.y, p.z, 1.2, 3);
            if (Math.random() < 0.4) G.audio.play('tick', { vol: 0.25, rate: 1.4 });
          }
        }
        continue;
      }
      if (p.kind === 'missile') {
        // steer toward the target once armed
        if (p.t > p.arm && !p.dumb) {
          const dx = ax - p.x, dy = ay - p.y, dz = az - p.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          const k = Math.min(1, p.turn * dt);
          const sp = p.speed * (1 + Math.min(p.t, 3) * 0.25);
          p.vx += ((dx / d) * sp - p.vx) * k; p.vy += ((dy / d) * sp - p.vy) * k; p.vz += ((dz / d) * sp - p.vz) * k;
        }
      } else p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.trail += dt;
      if (p.trail > 0.035) {
        p.trail = 0;
        if (p.kind === 'missile') {
          G.fx.p('whitePuff06', p.x, p.y, p.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 0.9, p.size * 0.8, p.size * 2.4, 0.85, 0.85, 0.85, 0.5, 0, 0, 0.5, 0.1, 0.9);
          G.fx.p('circle_05', p.x, p.y, p.z, 0, 0, 0, 0.1, p.size * 2.2, p.size, 1, 0.7, 0.3, 1, 1, 0, 0, 0.2, 1, 0);
        } else if (p.acid) {
          G.fx.p('circle_05', p.x, p.y, p.z, 0, 0, 0, 0.3, p.size * 2.5, p.size, 0.4, 1, 0.2, 0.9, 1, 0, 0, 0.2, 1, 0);
        } else {
          G.fx.p('circle_05', p.x, p.y, p.z, 0, 0, 0, 0.14, p.size * 1.5, p.size * 0.5, 1, 0.75, 0.4, 0.9, 1, 0, 0, 0.2, 1, 0);
        }
      }
      // orientation
      const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
      const yaw = Math.atan2(p.vx, p.vz), pitch = -Math.asin(clamp(p.vy / sp, -1, 1));
      (p.kind === 'missile' ? this.missilePool : this.shellPool).set(p.idx, p.x, p.y, p.z, yaw, p.size * (p.kind === 'missile' ? 1.5 : 5), pitch);
      // collisions
      let boom = false;
      if (p.y <= w.groundY(p.x, p.z) + 0.3) boom = true;
      else if (p.t > p.life) boom = true;
      else {
        const dx = p.x - ax, dy = p.y - ay, dz = p.z - az;
        if (!p.friendly && dx * dx + dy * dy * 0.6 + dz * dz < (hitR + p.size) * (hitR + p.size)) boom = true;
        else if (p.y < 130) {
          const list = w.buildingsNear(p.x, p.z, 1);
          for (const b of list) { if (!b.dead && p.y < b.top && b.solidHeightAt(p.x, p.z, 0.5) > p.y) { boom = true; break; } }
        }
      }
      if (boom) this.killProj(p, i, true);
    }
  }

  // ---------------------------------------------------------------- player interactions
  // Things on the ground inside a circle get crushed / kicked.
  crush(x, z, r, vx, vz, power, src) {
    const G = this.G, pl = G.player;
    const r2 = r * r;
    for (let i = this.civs.length - 1; i >= 0; i--) {
      const c = this.civs[i];
      if (c.state === 2) continue;
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz < r2) this.flingCiv(c, x - vx * 0.05, z - vz * 0.05, power);
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const dx = c.x - x, dz = c.z - z;
      const rr = r + c.len * 0.4;
      if (dx * dx + dz * dz < rr * rr) this.wreckCar(c, x, z, vx, vz, power, src);
    }
    if (!pl) return;
    const dmg = pl.meleeDamage * 0.7 * power;
    for (let i = this.army.length - 1; i >= 0; i--) {
      const u = this.army[i];
      if (!u || u.def.air || u.dying > 0) continue;
      const dx = u.x - x, dz = u.z - z;
      const rr = r + u.radius * 0.6;
      if (dx * dx + dz * dz < rr * rr) {
        if (src === 'step' && u._stepT && G.time - u._stepT < 0.35) continue;
        u._stepT = G.time;
        this.hurtUnit(u, dmg, src, x, z);
      }
    }
  }

  // Sphere hit against the army (incl. aircraft) and incoming projectiles. Returns kills + hits.
  damageSphere(x, y, z, r, dmg, src) {
    let n = 0;
    for (let i = this.army.length - 1; i >= 0; i--) {
      const u = this.army[i];
      if (!u || u.dying > 0) continue;
      const dx = u.x - x, dy = u.y + u.radius * 0.4 - y, dz = u.z - z;
      const rr = r + u.radius;
      if (dx * dx + dy * dy + dz * dz < rr * rr) { this.hurtUnit(u, dmg, src, x, z); n++; }
    }
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      if (p.kind !== 'missile' || p.friendly) continue;
      const dx = p.x - x, dy = p.y - y, dz = p.z - z;
      if (dx * dx + dy * dy + dz * dz < (r + 2) * (r + 2)) { p.friendly = true; this.killProj(p, i, true); n++; }
    }
    return n;
  }

  beam(ox, oy, oz, dx, dy, dz, len, r, dmg) {
    let n = 0;
    const test = (px, py, pz, pr) => {
      const t = clamp((px - ox) * dx + (py - oy) * dy + (pz - oz) * dz, 0, len);
      const cx = ox + dx * t - px, cy = oy + dy * t - py, cz = oz + dz * t - pz;
      return cx * cx + cy * cy + cz * cz < (r + pr) * (r + pr);
    };
    for (let i = this.army.length - 1; i >= 0; i--) {
      const u = this.army[i];
      if (!u || u.dying > 0) continue;
      if (test(u.x, u.y + u.radius * 0.4, u.z, u.radius)) { this.hurtUnit(u, dmg * 1.5, 'breath'); n++; }
    }
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      if (p.kind === 'hitscan' || p.friendly) continue;
      if (test(p.x, p.y, p.z, p.size + 1.5)) { p.friendly = true; this.killProj(p, i, true); n++; }
    }
    return n;
  }

  roar(x, z, R, stun) {
    const G = this.G;
    for (const u of this.army) {
      if (u.dying > 0) continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d < R) { u.stun = Math.max(u.stun, stun * (1 - d / R * 0.5)); if (u.type === 'police' || u.type === 'jeep') this.hurtUnit(u, 30, 'roar', x, z); }
    }
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      if (p.kind === 'hitscan') continue;
      if (Math.hypot(p.x - x, p.z - z) < R) { p.friendly = true; this.killProj(p, i, true); }
    }
    for (const c of this.civs) if (c.state !== 2 && Math.hypot(c.x - x, c.z - z) < R) c.fleeT = 4;
  }

  // Explosion shock against civilians, cars and light units.
  blast(x, y, z, R, dmg, src) {
    const r2 = R * R;
    for (let i = this.civs.length - 1; i >= 0; i--) {
      const c = this.civs[i];
      if (c.state === 2) continue;
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz < r2 && y < R) this.flingCiv(c, x, z, 0.9);
    }
    if (src !== 'car') {
      for (let i = this.cars.length - 1; i >= 0; i--) {
        const c = this.cars[i];
        const dx = c.x - x, dz = c.z - z;
        if (dx * dx + dz * dz < r2 * 0.6 && y < R) this.wreckCar(c, x, z, 0, 0, 0.8, 'blast');
      }
    }
    if (src === 'fuel' || src === 'crash' || src === 'boss') {
      for (let i = this.army.length - 1; i >= 0; i--) {
        const u = this.army[i];
        if (!u || u.dying > 0) continue;
        const d = Math.hypot(u.x - x, u.y - y, u.z - z);
        if (d < R) this.hurtUnit(u, dmg * (1 - d / R * 0.6), 'blast', x, z);
      }
    }
  }

  update(dt) {
    this.updateCivs(dt);
    this.updateCars(dt);
    this.updateSpawns(dt);
    this.updateArmy(dt);
    this.updateProj(dt);
  }

  dispose() {
    for (const p of this.pools) p.dispose();
    for (const u of this.army) this.scene.remove(u.obj);
    this.army.length = 0; this.proj.length = 0; this.cars.length = 0; this.civs.length = 0;
    this.G.audio.loop('siren', 'twoTone1', 0);
    this.G.audio.loop('heli', 'engineCircular_000', 0);
  }
}

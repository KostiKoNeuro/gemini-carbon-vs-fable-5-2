// City generation, destructible buildings, breakable props, ground / sky / lighting.
import * as THREE from 'three';
import { A, loadSky, loadMat } from './assets.js';
import { FractureType, FlatModel, fillerMaterial } from './fracture.js';
import { POOLS, LANDMARKS } from './data.js';
import { makeRng, SpatialHash, clamp, rand } from './util.js';

export const TILE = 15;          // road tile size (m)
export const BLOCK = 3;          // tiles per block side
export const PITCH = TILE * (BLOCK + 1);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const TINTS = [0xffffff, 0xfff1dc, 0xe8f0ff, 0xffe3d6, 0xe6ffe9, 0xfff8c9, 0xf0e4ff, 0xdfe6ee, 0xffd9c2, 0xd7efff];
const NO_FILLER = /water-tower|crane|billboard|windmill|fountain|statue|chimney/;

function fractureFor(key) {
  return FractureType.get(key, A.gltf[key].scene, { noFiller: NO_FILLER.test(key), cell: /landmarks|ships/.test(key) ? 2.6 : 2.4 });
}

// ---- Buildings -----------------------------------------------------------------------------------
class BuildingBatch {
  constructor(type, capacity, scene) {
    this.type = type;
    this.mesh = new THREE.InstancedMesh(type.shellGeometry, type.material, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  add(matrix, color) {
    const i = this.mesh.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    return i;
  }
  hide(i) {
    this.mesh.setMatrixAt(i, ZERO_M);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Building {
  constructor(world, def, type, x, y, z, rot, scale, yScale) {
    this.world = world;
    this.def = def;
    this.type = type;
    this.x = x; this.y = y; this.z = z;
    this.rot = rot;            // quarter turns
    this.scale = scale;
    this.yScale = scale * yScale;
    const n = type.cells.length;
    this.alive = new Uint8Array(n).fill(1);
    this.aliveCount = n;
    this.hp = new Float32Array(n);
    this.fallAt = new Float32Array(n).fill(-1);
    this.pendingFalls = 0;
    this.mesh = null;
    this.dead = false;
    this.dirty = false;
    this.burning = 0;
    this.name = def.name || null;
    this.explosive = def.explosive || 0;
    const c = Math.round(Math.cos(rot * Math.PI / 2)), s = Math.round(Math.sin(rot * Math.PI / 2));
    this.c = c; this.s = s;
    // world AABB
    const t = type;
    const xs = [t.min.x, t.max.x], zs = [t.min.z, t.max.z];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const lx of xs) for (const lz of zs) {
      const wx = x + (lx * c + lz * s) * scale, wz = z + (-lx * s + lz * c) * scale;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx; if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
    }
    this.minX = minX; this.maxX = maxX; this.minZ = minZ; this.maxZ = maxZ;
    this.height = t.size.y * this.yScale;
    this.top = y + t.max.y * this.yScale;
    this.cx = (minX + maxX) / 2; this.cz = (minZ + maxZ) / 2;
    this.radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    const vol = (maxX - minX) * (maxZ - minZ) * this.height;
    this.value = def.v * vol / 100;
    this.cellValue = this.value / n;
    const cellSize = Math.cbrt(vol / n);
    this.cellSize = cellSize;
    const hp0 = 100 * def.t * Math.pow(cellSize / 5, 2);
    this.hp.fill(hp0);
    this.cellHp = hp0;
    this.boxes = null;
    this.groundAlive = type.groundCells;
    this.tint = 0xffffff;
    this.batch = null; this.batchIndex = -1;
  }

  matrix(out) {
    _e.set(0, this.rot * Math.PI / 2, 0);
    _q.setFromEuler(_e);
    _p.set(this.x, this.y, this.z);
    _s.set(this.scale, this.yScale, this.scale);
    return out.compose(_p, _q, _s);
  }

  // world-space AABB per cell: [minx,miny,minz,maxx,maxy,maxz]
  ensureBoxes() {
    if (this.boxes) return this.boxes;
    const cells = this.type.cells;
    const b = (this.boxes = new Float32Array(cells.length * 6));
    const { c, s, scale, yScale, x, y, z } = this;
    for (let i = 0; i < cells.length; i++) {
      const cl = cells[i];
      const ax = x + (cl.min.x * c + cl.min.z * s) * scale, az = z + (-cl.min.x * s + cl.min.z * c) * scale;
      const bx = x + (cl.max.x * c + cl.max.z * s) * scale, bz = z + (-cl.max.x * s + cl.max.z * c) * scale;
      const o = i * 6;
      b[o] = Math.min(ax, bx); b[o + 1] = y + cl.min.y * yScale; b[o + 2] = Math.min(az, bz);
      b[o + 3] = Math.max(ax, bx); b[o + 4] = y + cl.max.y * yScale; b[o + 5] = Math.max(az, bz);
    }
    return b;
  }

  cellCenter(i, out) {
    const b = this.ensureBoxes(), o = i * 6;
    return out.set((b[o] + b[o + 3]) / 2, (b[o + 1] + b[o + 4]) / 2, (b[o + 2] + b[o + 5]) / 2);
  }

  // Swap the shared instanced shell for an individually indexed mesh that can lose cells.
  individualize() {
    if (this.mesh || this.dead) return;
    const g = this.type.instanceGeometry();
    let mat = this.type.material;
    if (this.tint !== 0xffffff) { mat = this.world.tintedMaterial(this.type, this.tint); }
    const mesh = new THREE.Mesh(g, [mat, fillerMaterial()]);
    this.matrix(mesh.matrix);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.world.scene.add(mesh);
    this.mesh = mesh;
    if (this.batch) this.batch.hide(this.batchIndex);
  }

  // Sphere damage. Returns number of cells destroyed.
  damage(px, py, pz, radius, amount, dx = 0, dy = 0, dz = 0, src = 'hit') {
    if (this.dead) return 0;
    // quick reject
    if (px + radius < this.minX || px - radius > this.maxX || pz + radius < this.minZ || pz - radius > this.maxZ || py - radius > this.top) return 0;
    const b = this.ensureBoxes();
    const n = this.alive.length;
    let killed = 0, touched = false;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const o = i * 6;
      const qx = px < b[o] ? b[o] - px : px > b[o + 3] ? px - b[o + 3] : 0;
      const qy = py < b[o + 1] ? b[o + 1] - py : py > b[o + 4] ? py - b[o + 4] : 0;
      const qz = pz < b[o + 2] ? b[o + 2] - pz : pz > b[o + 5] ? pz - b[o + 5] : 0;
      const d2 = qx * qx + qy * qy + qz * qz;
      if (d2 >= radius * radius) continue;
      touched = true;
      const f = 1 - Math.sqrt(d2) / radius;
      this.hp[i] -= amount * (0.3 + 0.7 * f);
      if (this.hp[i] <= 0) { this.killCell(i, dx, dy, dz, false); killed++; }
    }
    if (touched && !killed) this.world.G.fx.buildingHit(this, px, py, pz);
    if (killed) this.afterDamage(src);
    return killed;
  }

  killCell(i, dx, dy, dz, falling) {
    if (!this.alive[i]) return;
    if (!this.mesh) this.individualize();
    this.alive[i] = 0;
    this.aliveCount--;
    const cl = this.type.cells[i];
    if (cl.iy === 0) this.groundAlive--;
    const idx = this.mesh.geometry.index.array;
    for (let k = cl.extStart, e = cl.extStart + cl.extCount; k < e; k++) idx[k] = 0;
    for (let k = cl.filStart, e = cl.filStart + cl.filCount; k < e; k++) idx[k] = 0;
    this.dirty = true;
    this.world.dirtyBuildings.add(this);
    this.world.G.game.onCellDestroyed(this, i, dx, dy, dz, falling);
  }

  afterDamage(src) {
    if (this.dead) return;
    const t = this.type;
    const now = this.world.time;
    // total collapse?
    const frac = this.aliveCount / t.cells.length;
    const groundFrac = t.groundCells ? this.groundAlive / t.groundCells : 1;
    if (frac < 0.34 || groundFrac < 0.3 || this.aliveCount <= 1) {
      this.collapse(src);
      return;
    }
    // unsupported cells fall
    for (let ix = 0; ix < t.nx; ix++) for (let iz = 0; iz < t.nz; iz++) {
      let gap = false, k = 0;
      for (let iy = 0; iy < t.ny; iy++) {
        const ci = t.cellAt(ix, iy, iz);
        if (ci < 0) continue;
        if (!this.alive[ci]) { gap = true; continue; }
        if (gap && this.fallAt[ci] < 0) {
          this.fallAt[ci] = now + 0.08 + 0.07 * k++ + Math.random() * 0.05;
          this.pendingFalls++;
          this.world.fallingBuildings.add(this);
        }
      }
    }
  }

  collapse(src) {
    if (this.dead) return;
    this.dead = true;
    const t = this.type;
    const now = this.world.time;
    for (let i = 0; i < t.cells.length; i++) {
      if (!this.alive[i]) continue;
      if (this.fallAt[i] < 0) this.pendingFalls++;
      this.fallAt[i] = now + 0.05 + t.cells[i].iy * 0.07 + Math.random() * 0.08;
    }
    this.world.fallingBuildings.add(this);
    this.world.G.game.onBuildingDestroyed(this, src);
  }

  // returns true when no more pending work
  updateFalls(now) {
    if (this.pendingFalls <= 0) return true;
    const n = this.alive.length;
    for (let i = 0; i < n; i++) {
      const f = this.fallAt[i];
      if (f >= 0 && f <= now) {
        this.fallAt[i] = -1;
        this.pendingFalls--;
        if (this.alive[i]) this.killCell(i, 0, -1, 0, true);
      }
    }
    if (this.pendingFalls <= 0) {
      if (this.dead) this.removeMesh();
      else this.afterDamage('fall');
      return this.pendingFalls <= 0;
    }
    return false;
  }

  removeMesh() {
    if (this.mesh) {
      this.world.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    } else if (this.batch) this.batch.hide(this.batchIndex);
  }

  // Tallest living cell height within a world-space circle (used for collisions); 0 when clear.
  solidHeightAt(px, pz, r) {
    if (this.dead) return 0;
    if (px + r < this.minX || px - r > this.maxX || pz + r < this.minZ || pz - r > this.maxZ) return 0;
    const b = this.ensureBoxes();
    let h = 0;
    for (let i = 0; i < this.alive.length; i++) {
      if (!this.alive[i]) continue;
      const o = i * 6;
      if (px + r < b[o] || px - r > b[o + 3] || pz + r < b[o + 2] || pz - r > b[o + 5]) continue;
      if (b[o + 4] > h) h = b[o + 4];
    }
    return h;
  }
}

// ---- Props (instanced, breakable) ----------------------------------------------------------------
class PropBatch {
  constructor(key, flat, capacity, scene) {
    this.key = key;
    this.flat = flat;
    this.mesh = new THREE.InstancedMesh(flat.geometry, flat.material, capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
}

// ---- World ---------------------------------------------------------------------------------------
export class World {
  constructor(G, level, seed) {
    this.G = G;
    this.level = level;
    this.scene = G.scene;
    this.rng = makeRng(seed || 1337);
    this.buildings = [];
    this.props = [];
    this.hash = new SpatialHash(40);
    this.propHash = new SpatialHash(24);
    this.batches = new Map();
    this.propBatches = new Map();
    this.tintMats = new Map();
    this.fallingBuildings = new Set();
    this.dirtyBuildings = new Set();
    this.time = 0;
    this.totalValue = 0;
    this.destroyedValue = 0;
    this.objects = [];   // scene objects to remove on dispose
    this.landmarks = [];
    this.fires = [];
    this.roadsX = []; this.roadsZ = [];
    this._q = [];
    this.waterZ = Infinity;
  }

  tintedMaterial(type, tint) {
    const key = type.key + tint;
    let m = this.tintMats.get(key);
    if (!m) {
      m = type.material.clone();
      m.color.setHex(tint);
      this.tintMats.set(key, m);
    }
    return m;
  }

  async build() {
    const L = this.level;
    const G = this.G;
    const scene = this.scene;
    let map = L.map;
    if (!map) map = this.randomMap(8, 8);
    const nbz = map.length, nbx = map[0].length;
    this.nbx = nbx; this.nbz = nbz;
    const W = nbx * PITCH + TILE, D = nbz * PITCH + TILE;
    this.W = W; this.D = D;
    for (let k = 0; k <= nbx; k++) this.roadsX.push(-W / 2 + TILE / 2 + k * PITCH);
    for (let k = 0; k <= nbz; k++) this.roadsZ.push(-D / 2 + TILE / 2 + k * PITCH);
    const margin = 70;
    this.bounds = { minX: -W / 2 - margin, maxX: W / 2 + margin, minZ: -D / 2 - margin, maxZ: D / 2 + margin };
    if (L.water) { this.waterZ = D / 2 + 6; this.bounds.maxZ = D / 2 + 150; }

    // --- sky & light
    const sky = await loadSky(L.sky);
    scene.background = sky;
    scene.backgroundRotation.set(0, L.skyRot || 0, 0);
    scene.environment = sky;
    scene.environmentRotation.set(0, L.skyRot || 0, 0);
    scene.environmentIntensity = L.night ? 0.5 : 0.75;
    scene.backgroundIntensity = L.night ? 0.9 : 1.0;
    scene.fog = new THREE.FogExp2(L.fog[0], L.fog[1]);
    const hemi = new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]);
    scene.add(hemi); this.objects.push(hemi);
    const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
    this.sunDir = new THREE.Vector3(...L.sun.dir).normalize();
    sun.position.copy(this.sunDir).multiplyScalar(300);
    sun.castShadow = G.quality.shadows;
    sun.shadow.mapSize.set(G.quality.shadowSize, G.quality.shadowSize);
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    scene.add(sun); scene.add(sun.target);
    this.objects.push(sun, sun.target);
    this.sun = sun;

    // --- ground
    const grass = await loadMat('aerialGrassRock');
    grass.repeat.set(70, 70);
    const gmat = new THREE.MeshLambertMaterial({ map: grass, color: L.night ? 0x5a6a8a : (L.id === 'harbor' || L.id === 'fortress') ? 0xc9b8a0 : 0xffffff });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), gmat);
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.3;
    ground.receiveShadow = true;
    scene.add(ground); this.objects.push(ground);
    if (L.water) {
      const wmat = new THREE.MeshStandardMaterial({ color: 0x1d5f86, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.93, envMapIntensity: 1.4 });
      const water = new THREE.Mesh(new THREE.PlaneGeometry(5000, 2500), wmat);
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, -0.6, this.waterZ + 1250);
      scene.add(water); this.objects.push(water);
      this.water = water;
      // seabed drop: hide the grass under the water with a dark plane
      const bed = new THREE.Mesh(new THREE.PlaneGeometry(5000, 2500), new THREE.MeshBasicMaterial({ color: 0x0b2a3d }));
      bed.rotation.x = -Math.PI / 2; bed.position.set(0, -0.28, this.waterZ + 1250);
      scene.add(bed); this.objects.push(bed);
    }

    // --- plan everything first (so instanced batches can be sized), then instantiate
    const plan = { b: [], p: [], tiles: [] };
    this.planRoads(plan, nbx, nbz);
    for (let bz = 0; bz < nbz; bz++) for (let bx = 0; bx < nbx; bx++) {
      const zc = map[bz][bx];
      const x0 = this.roadsX[bx] + TILE / 2, x1 = this.roadsX[bx + 1] - TILE / 2;
      const z0 = this.roadsZ[bz] + TILE / 2, z1 = this.roadsZ[bz + 1] - TILE / 2;
      this.planBlock(plan, zc, x0, z0, x1, z1, bx, bz);
    }
    if (L.ships) this.planShips(plan);
    this.planOutskirts(plan);
    this.instantiate(plan);
    this.buildMinimapData();
  }

  randomMap(nx, nz) {
    const r = this.rng;
    const rows = [];
    let lm = 1;
    for (let z = 0; z < nz; z++) {
      let row = '';
      for (let x = 0; x < nx; x++) {
        const d = Math.max(Math.abs(x - (nx - 1) / 2) / (nx / 2), Math.abs(z - (nz - 1) / 2) / (nz / 2));
        const t = r();
        let c;
        if (d < 0.35) c = t < 0.75 ? 's' : t < 0.9 ? 'C' : 'p';
        else if (d < 0.7) c = t < 0.35 ? 's' : t < 0.7 ? 'C' : t < 0.82 ? 'c' : t < 0.9 ? 'i' : t < 0.95 ? 'f' : 'p';
        else c = t < 0.4 ? 'h' : t < 0.7 ? 'c' : t < 0.85 ? 'i' : 'C';
        row += c;
      }
      rows.push(row);
    }
    // sprinkle landmarks
    for (const k of [1, 2, 3]) {
      const x = r.int(1, nx - 2), z = r.int(1, nz - 2);
      rows[z] = rows[z].substring(0, x) + (lm++) + rows[z].substring(x + 1);
    }
    return rows;
  }

  planRoads(plan, nbx, nbz) {
    const ext = 6;
    const xs = this.roadsX, zs = this.roadsZ;
    const isRoadX = (x) => xs.some((v) => Math.abs(v - x) < 1);
    const isRoadZ = (z) => zs.some((v) => Math.abs(v - z) < 1);
    // horizontal roads (along X)
    for (const z of zs) {
      for (let x = xs[0] - ext * TILE; x <= xs[xs.length - 1] + ext * TILE + 1; x += TILE) {
        if (isRoadX(x)) plan.tiles.push({ m: 'roads/road-crossroad', x, z, r: 0 });
        else {
          const nearX = xs.some((v) => Math.abs(Math.abs(v - x) - TILE) < 1);
          plan.tiles.push({ m: nearX && this.rng() < 0.6 ? 'roads/road-crossing' : 'roads/road-straight', x, z, r: 0 });
        }
      }
    }
    for (const x of xs) {
      for (let z = zs[0] - ext * TILE; z <= zs[zs.length - 1] + ext * TILE + 1; z += TILE) {
        if (isRoadZ(z)) continue;
        if (this.level.water && z > this.D / 2) continue;
        const nearZ = zs.some((v) => Math.abs(Math.abs(v - z) - TILE) < 1);
        plan.tiles.push({ m: nearZ && this.rng() < 0.6 ? 'roads/road-crossing' : 'roads/road-straight', x, z, r: 1 });
      }
    }
    // street furniture along roads
    const r = this.rng;
    for (const z of zs) for (let x = xs[0] + TILE; x < xs[xs.length - 1]; x += TILE) {
      if (isRoadX(x)) continue;
      if (r() < 0.55) plan.p.push({ m: 'roads/light-curved', x: x + r.range(-3, 3), z: z - TILE * 0.42, r: 0, s: 2.2, y: 0 });
      if (r() < 0.55) plan.p.push({ m: 'roads/light-curved', x: x + r.range(-3, 3), z: z + TILE * 0.42, r: Math.PI, s: 2.2, y: 0 });
    }
    for (const x of xs) for (let z = zs[0] + TILE; z < zs[zs.length - 1]; z += TILE) {
      if (isRoadZ(z)) continue;
      if (r() < 0.55) plan.p.push({ m: 'roads/light-square', x: x - TILE * 0.42, z: z + r.range(-3, 3), r: Math.PI / 2, s: 2.2, y: 0 });
      if (r() < 0.55) plan.p.push({ m: 'roads/light-square', x: x + TILE * 0.42, z: z + r.range(-3, 3), r: -Math.PI / 2, s: 2.2, y: 0 });
    }
    for (const x of xs) for (const z of zs) {
      const o = TILE * 0.44;
      if (r() < 0.8) plan.p.push({ m: 'roads/traffic-light', x: x - o, z: z - o, r: 0, s: 2.4, y: 0 });
      if (r() < 0.8) plan.p.push({ m: 'roads/traffic-light', x: x + o, z: z + o, r: Math.PI, s: 2.4, y: 0 });
      if (r() < 0.3) plan.p.push({ m: 'roads/road-sign-stop', x: x + o, z: z - o, r: Math.PI / 2, s: 2.2, y: 0 });
      if (r() < 0.25) plan.p.push({ m: 'roads/road-sign-street', x: x - o, z: z + o, r: 0, s: 2.2, y: 0 });
    }
  }

  footprint(def, S) {
    const t = fractureFor(def.m);
    return { fx: t.size.x * S * def.s, fz: t.size.z * S * def.s, h: t.size.y * S * def.s };
  }

  // Lay buildings along one side of a block, fronts facing the street.
  packSide(plan, pool, S, side, x0, z0, x1, z1, from, to, opts = {}) {
    const r = this.rng;
    const gap = opts.gap === undefined ? 1.6 : opts.gap;
    let cursor = from + gap;
    let maxDepth = 0;
    const setback = opts.setback === undefined ? 1.6 : opts.setback;
    let guard = 0;
    while (guard++ < 12) {
      const room = to - cursor - gap;
      const fits = pool.filter((d) => this.footprint(d, S).fx <= room && this.footprint(d, S).fz <= (opts.maxDepth || 99));
      if (!fits.length) break;
      const def = r.pick(fits);
      const { fx, fz } = this.footprint(def, S);
      const slack = Math.min(room - fx, opts.spread === undefined ? 3 : opts.spread);
      const a = cursor + fx / 2 + r() * slack * 0.5;
      const dOff = setback + fz / 2;
      let x, z, rot;
      if (side === 'N') { x = a; z = z0 + dOff; rot = 2; }
      else if (side === 'S') { x = a; z = z1 - dOff; rot = 0; }
      else if (side === 'W') { z = a; x = x0 + dOff; rot = 3; }
      else { z = a; x = x1 - dOff; rot = 1; }
      plan.b.push({ def, x, z, rot, S: S * def.s, stretch: opts.stretch ? r.range(1, opts.stretch) : 1, y: opts.y || 0, tint: opts.tint !== false });
      cursor = a + fx / 2 + gap + r() * (opts.jitter || 0);
      if (fz > maxDepth) maxDepth = fz;
    }
    return maxDepth + setback;
  }

  pave(plan, x0, z0) {
    for (let i = 0; i < BLOCK; i++) for (let j = 0; j < BLOCK; j++) {
      plan.tiles.push({ m: 'roads/tile-low', x: x0 + TILE / 2 + i * TILE, z: z0 + TILE / 2 + j * TILE, r: 0 });
    }
  }

  planBlock(plan, zc, x0, z0, x1, z1, bx, bz) {
    const L = this.level;
    const r = this.rng;
    const S = L.bScale;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const tree = (x, z, s = 1) => plan.p.push({ m: r.pick(['suburban/tree-large', 'suburban/tree-small', 'suburban/tree-large']), x, z, r: r() * 6.28, s: 2.0 * s * r.range(0.8, 1.25), y: -0.3 });
    const perimeter = (pool, SS, opts = {}) => {
      const dn = this.packSide(plan, pool, SS, 'N', x0, z0, x1, z1, x0, x1, opts);
      const ds = this.packSide(plan, pool, SS, 'S', x0, z0, x1, z1, x0, x1, opts);
      this.packSide(plan, pool, SS, 'W', x0, z0, x1, z1, z0 + dn, z1 - ds, opts);
      this.packSide(plan, pool, SS, 'E', x0, z0, x1, z1, z0 + dn, z1 - ds, opts);
      return [dn, ds];
    };
    if (zc === 'h') {
      const SS = Math.min(S, 2.2);
      const [dn, ds] = perimeter(POOLS.houses, SS, { setback: 3.5, gap: 2.2, y: -0.25, jitter: 2 });
      for (let i = 0; i < 7; i++) {
        const tx = r.range(x0 + 3, x1 - 3), tz = r.range(z0 + dn + 2, z1 - ds - 2);
        if (tz > z0 + dn && tz < z1 - ds) tree(tx, tz);
      }
      for (let i = 0; i < 4; i++) plan.p.push({ m: 'suburban/fence', x: r.range(x0 + 4, x1 - 4), z: cz + r.range(-3, 3), r: r.pick([0, Math.PI / 2]), s: 2.2, y: -0.3 });
    } else if (zc === 'c') {
      this.pave(plan, x0, z0);
      perimeter(POOLS.shops.concat(POOLS.shops, POOLS.offices.slice(0, 2)), Math.min(S, 2.6), { gap: 0.8 });
      this.clutter(plan, x0, z0, x1, z1, 4);
    } else if (zc === 'C') {
      this.pave(plan, x0, z0);
      perimeter(POOLS.offices.concat(POOLS.shops.slice(0, 3), POOLS.towers.slice(0, 1)), S, { gap: 1.0 });
      this.clutter(plan, x0, z0, x1, z1, 3);
    } else if (zc === 's') {
      this.pave(plan, x0, z0);
      perimeter(POOLS.towers.concat(POOLS.towers, POOLS.offices.slice(2, 4)), S, { gap: 1.0, stretch: L.towerStretch || 1.12 });
      this.clutter(plan, x0, z0, x1, z1, 2);
    } else if (zc === 'i') {
      this.pave(plan, x0, z0);
      const [dn, ds] = perimeter(POOLS.factories, Math.min(S, 2.5) * 0.92, { gap: 1.5, tint: false });
      // yard: chimneys, small tanks, containers
      const yz0 = z0 + dn + 3, yz1 = z1 - ds - 3;
      if (yz1 - yz0 > 6) {
        for (let i = 0; i < 2; i++) {
          const k = r();
          const px = r.range(x0 + 8, x1 - 8), pz = r.range(yz0, yz1);
          if (k < 0.4) plan.b.push({ def: { m: 'industrial/chimney-medium', s: 1, t: 1, v: 1.5 }, x: px, z: pz, rot: 0, S: S * 1.1, stretch: 1, y: 0 });
          else if (k < 0.75) plan.b.push({ def: { m: 'industrial/detail-tank', s: 1, t: 0.5, v: 2, explosive: 0.6 }, x: px, z: pz, rot: r.int(0, 3), S: S * 0.9, stretch: 1, y: 0 });
          else for (let j = 0; j < 3; j++) plan.p.push({ m: r.pick(['industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c']), x: px + j * 5.2, z: pz, r: 0, s: 2.4, y: 0, heavy: true });
        }
      }
    } else if (zc === 'p') {
      for (let i = 0; i < 26; i++) tree(r.range(x0 + 2, x1 - 2), r.range(z0 + 2, z1 - 2), r.range(0.9, 1.5));
      const k = r();
      if (k < 0.5) plan.b.push({ def: { m: 'landmarks/campus-plaza-fountain-a0cab1', s: 1, t: 0.6, v: 3, name: null }, x: cx, z: cz, rot: 0, S: 3.2, stretch: 1, y: -0.2 });
      else plan.b.push({ def: { m: 'landmarks/founder-s-statue-71c269', s: 1, t: 0.7, v: 4, name: null }, x: cx, z: cz, rot: r.int(0, 3), S: 3.0, stretch: 1, y: -0.2 });
      for (let i = 0; i < 3; i++) plan.p.push({ m: 'commercial/detail-parasol-a', x: cx + r.range(-12, 12), z: cz + r.range(-12, 12), r: 0, s: 2.6, y: -0.3 });
    } else if (zc === 'f') {
      this.pave(plan, x0, z0);
      const big = { m: 'industrial/detail-tank-large', s: 1, t: 0.55, v: 3, explosive: 1 };
      const sm = { m: 'landmarks/depot-fuel-tank-55a00e', s: 1, t: 0.5, v: 2, explosive: 0.7 };
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const px = x0 + 12 + i * 21, pz = z0 + 12 + j * 21;
        if (r() < 0.7) plan.b.push({ def: big, x: px, z: pz, rot: r.int(0, 3), S: 2.2, stretch: 1, y: 0 });
        else plan.b.push({ def: sm, x: px, z: pz, rot: r.int(0, 1), S: 2.0, stretch: 1, y: 0 });
      }
    } else if (zc === 'k') {
      this.pave(plan, x0, z0);
      // container stacks + cranes
      for (let i = 0; i < 5; i++) {
        const px = x0 + 5 + i * 8.5;
        for (let j = 0; j < 3; j++) {
          const pz = z0 + 7 + j * 11.5;
          const stack = r.int(1, 3);
          for (let k = 0; k < stack; k++) plan.p.push({ m: r.pick(['industrial/shipping-container-a', 'industrial/shipping-container-b', 'industrial/shipping-container-c']), x: px, z: pz, r: 0, s: 2.4, y: k * 4.15, heavy: true });
        }
      }
      plan.b.push({ def: { m: 'landmarks/dock-cargo-crane-ccd97f', s: 1, t: 0.9, v: 4 }, x: cx - 10, z: z1 - 6, rot: 0, S: 4.2, stretch: 1, y: 0 });
      plan.b.push({ def: { m: 'landmarks/dock-cargo-crane-ccd97f', s: 1, t: 0.9, v: 4 }, x: cx + 12, z: z1 - 6, rot: 0, S: 4.2, stretch: 1, y: 0 });
    } else if (zc === 'm') {
      this.pave(plan, x0, z0);
      this.turretSpots = this.turretSpots || [];
      for (const [ox, oz] of [[-13, -13], [13, 13]]) this.turretSpots.push({ x: cx + ox, z: cz + oz });
      plan.b.push({ def: { m: 'industrial/building-d', s: 1, t: 1.6, v: 3 }, x: cx, z: cz, rot: r.int(0, 3), S: S * 0.9, stretch: 1, y: 0 });
      for (let i = 0; i < 6; i++) plan.p.push({ m: 'roads/construction-barrier', x: cx + r.range(-20, 20), z: cz + r.pick([-20, 20]) + r.range(-1, 1), r: Math.PI / 2, s: 2.6, y: 0 });
    } else if (zc >= '1' && zc <= '9') {
      const lm = LANDMARKS[L.landmarks[zc]];
      if (lm) {
        const paved = !/church|watertower|lighthouse/.test(L.landmarks[zc]);
        if (paved) this.pave(plan, x0, z0);
        plan.b.push({ def: lm, x: cx, z: cz, rot: 0, S: lm.s, stretch: 1, y: paved ? 0 : -0.25, landmark: true, tint: false });
        for (let i = 0; i < 10; i++) {
          const a = r() * 6.28, d = r.range(16, 21);
          tree(cx + Math.cos(a) * d, cz + Math.sin(a) * d);
        }
      }
    } else {
      // empty lot / plaza
      this.pave(plan, x0, z0);
    }
  }

  clutter(plan, x0, z0, x1, z1, n) {
    const r = this.rng;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (let i = 0; i < n; i++) {
      const k = r();
      const x = cx + r.range(-5, 5), z = cz + r.range(-5, 5);
      if (k < 0.3) plan.p.push({ m: 'roads/dumpster', x, z, r: r() * 6.28, s: 2.2, y: 0 });
      else if (k < 0.55) plan.p.push({ m: 'suburban/tree-small', x, z, r: r() * 6.28, s: 2.6, y: 0 });
      else if (k < 0.75) plan.p.push({ m: 'roads/construction-cone', x, z, r: 0, s: 2.6, y: 0 });
      else plan.p.push({ m: 'suburban/planter', x, z, r: 0, s: 2.6, y: 0 });
    }
    if (r() < 0.35) plan.p.push({ m: 'landmarks/roadside-billboard-c3c053', x: cx, z: cz, r: r.pick([0, 1, 2, 3]) * Math.PI / 2, s: 1.6, y: 0, heavy: true });
  }

  planShips(plan) {
    const r = this.rng;
    const z = this.waterZ;
    plan.b.push({ def: LANDMARKS.liner, x: -this.W * 0.22, z: z + 62, rot: 1, S: LANDMARKS.liner.s, stretch: 1, y: -1.5, landmark: true, tint: false });
    const ships = ['ships/ship-cargo-a', 'ships/ship-cargo-b', 'ships/ship-large', 'ships/ship-cargo-a'];
    ships.forEach((m, i) => {
      plan.b.push({ def: { m, s: 1, t: 0.9, v: 4, ship: true }, x: this.W * (0.05 + i * 0.13) + r.range(-8, 8), z: z + 35 + (i % 2) * 48 + r.range(-6, 6), rot: r.pick([1, 3]), S: 3.6, stretch: 1, y: -1.2, tint: false });
    });
  }

  planOutskirts(plan) {
    const r = this.rng;
    const b = this.bounds;
    const n = this.G.quality.trees;
    for (let i = 0; i < n; i++) {
      const a = r() * 6.283, d = r.range(0.0, 1.0);
      const rad = Math.max(this.W, this.D) / 2 + 20 + d * d * 700;
      const x = Math.cos(a) * rad * 1.15, z = Math.sin(a) * rad * 1.15;
      if (x > -this.W / 2 - 8 && x < this.W / 2 + 8 && z > -this.D / 2 - 8 && z < this.D / 2 + 8) continue;
      if (this.level.water && z > this.waterZ - 10) continue;
      // keep road corridors clear
      if (this.roadsX.some((v) => Math.abs(v - x) < TILE * 0.7) || this.roadsZ.some((v) => Math.abs(v - z) < TILE * 0.7)) continue;
      plan.p.push({ m: r.pick(['suburban/tree-large', 'suburban/tree-small', 'suburban/tree-large']), x, z, r: r() * 6.28, s: r.range(2.4, 4.6), y: -0.3, far: !(x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) });
    }
  }

  instantiate(plan) {
    const scene = this.scene;
    // road tiles + pavement (pure decoration, instanced)
    const tileCounts = {};
    for (const t of plan.tiles) tileCounts[t.m] = (tileCounts[t.m] || 0) + 1;
    const tileMeshes = {};
    for (const key in tileCounts) {
      const flat = FlatModel.get(key, A.gltf[key].scene);
      const im = new THREE.InstancedMesh(flat.geometry, flat.material, tileCounts[key]);
      im.count = 0; im.receiveShadow = true; im.frustumCulled = false;
      scene.add(im); this.objects.push(im);
      tileMeshes[key] = im;
    }
    const tileS = TILE / 5;
    for (const t of plan.tiles) {
      const im = tileMeshes[t.m];
      _e.set(0, t.r * Math.PI / 2, 0);
      _m.compose(_p.set(t.x, -0.3, t.z), _q.setFromEuler(_e), _s.set(tileS, 3, tileS));
      im.setMatrixAt(im.count++, _m);
    }
    // buildings
    const counts = new Map();
    for (const b of plan.b) counts.set(b.def.m, (counts.get(b.def.m) || 0) + 1);
    for (const [key, n] of counts) {
      const batch = new BuildingBatch(fractureFor(key), n, scene);
      this.batches.set(key, batch);
      this.objects.push(batch.mesh);
    }
    const r = this.rng;
    for (const pb of plan.b) {
      const type = fractureFor(pb.def.m);
      const b = new Building(this, pb.def, type, pb.x, pb.y || 0, pb.z, pb.rot, pb.S, pb.stretch || 1);
      b.tint = pb.tint ? r.pick(TINTS) : 0xffffff;
      b.landmark = !!pb.landmark;
      b.ship = !!pb.def.ship;
      const batch = this.batches.get(pb.def.m);
      b.batch = batch;
      b.batchIndex = batch.add(b.matrix(_m), _col.setHex(b.tint));
      this.buildings.push(b);
      this.hash.insertBox(b, b.minX, b.minZ, b.maxX, b.maxZ);
      this.totalValue += b.value;
      if (b.landmark) this.landmarks.push(b);
    }
    for (const batch of this.batches.values()) { batch.mesh.instanceMatrix.needsUpdate = true; if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true; }
    // props
    const pc = new Map();
    for (const p of plan.p) pc.set(p.m, (pc.get(p.m) || 0) + 1);
    for (const [key, n] of pc) {
      const flat = FlatModel.get(key, A.gltf[key].scene);
      const batch = new PropBatch(key, flat, n, scene);
      this.propBatches.set(key, batch);
      this.objects.push(batch.mesh);
    }
    for (const p of plan.p) {
      const batch = this.propBatches.get(p.m);
      const i = batch.mesh.count++;
      _e.set(0, p.r, 0);
      _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e), _s.set(p.s, p.s, p.s));
      batch.mesh.setMatrixAt(i, _m);
      if (p.far) continue; // unreachable scenery
      const sz = batch.flat.size;
      const prop = { batch, i, x: p.x, y: p.y, z: p.z, r: p.r, s: p.s, alive: true, h: sz.y * p.s, rad: Math.max(sz.x, sz.z) * p.s * 0.5, heavy: !!p.heavy };
      this.props.push(prop);
      this.propHash.insertBox(prop, p.x - prop.rad, p.z - prop.rad, p.x + prop.rad, p.z + prop.rad);
    }
    for (const batch of this.propBatches.values()) batch.mesh.instanceMatrix.needsUpdate = true;
  }

  buildMinimapData() {
    this.mini = this.buildings.map((b) => b);
  }

  // --- queries ------------------------------------------------------------------------------------
  buildingsNear(x, z, r) {
    return this.hash.query(x - r, z - r, x + r, z + r, this._q);
  }

  // Sphere damage against all buildings; returns cells destroyed.
  damageSphere(x, y, z, radius, amount, dx, dy, dz, src) {
    const list = this.hash.query(x - radius, z - radius, x + radius, z + radius, []);
    let k = 0;
    for (const b of list) k += b.damage(x, y, z, radius, amount, dx, dy, dz, src);
    return k;
  }

  // Break props inside a circle. fn(prop) is called for each broken prop.
  breakProps(x, z, radius, maxH, vx, vz, power) {
    const list = this.propHash.query(x - radius, z - radius, x + radius, z + radius, []);
    let n = 0;
    for (const p of list) {
      if (!p.alive) continue;
      const dx = p.x - x, dz = p.z - z;
      const rr = radius + p.rad * 0.5;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (p.h > maxH) continue;
      p.alive = false;
      p.batch.mesh.setMatrixAt(p.i, ZERO_M);
      p.batch.mesh.instanceMatrix.needsUpdate = true;
      this.G.game.onPropBroken(p, dx, dz, vx, vz, power);
      n++;
    }
    return n;
  }

  // First living building cell hit by a segment (coarse march). Returns {b, x,y,z} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, step) {
    const out = [];
    for (let t = step; t <= maxDist; t += step) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (y < 0) return { b: null, x, y: 0, z, t, ground: true };
      const list = this.hash.query(x - 1, z - 1, x + 1, z + 1, out);
      for (const b of list) {
        if (b.dead || y > b.top || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        const bx = b.ensureBoxes();
        for (let i = 0; i < b.alive.length; i++) {
          if (!b.alive[i]) continue;
          const o = i * 6;
          if (x >= bx[o] && x <= bx[o + 3] && y >= bx[o + 1] && y <= bx[o + 4] && z >= bx[o + 2] && z <= bx[o + 5]) return { b, x, y, z, t, cell: i };
        }
      }
    }
    return null;
  }

  inWater(z) { return z > this.waterZ; }
  groundY(x, z) {
    if (z > this.waterZ) return -Math.min(1, (z - this.waterZ) / 30);
    return 0;
  }

  update(dt) {
    this.time += dt;
    if (this.fallingBuildings.size) {
      for (const b of this.fallingBuildings) if (b.updateFalls(this.time)) this.fallingBuildings.delete(b);
    }
    if (this.dirtyBuildings.size) {
      for (const b of this.dirtyBuildings) { if (b.mesh) b.mesh.geometry.index.needsUpdate = true; b.dirty = false; }
      this.dirtyBuildings.clear();
    }
  }

  // Shadow frustum follows the player.
  updateSun(target, size) {
    const sun = this.sun;
    const ext = clamp(size * 5.5, 90, 520);
    const cam = sun.shadow.camera;
    if (Math.abs(cam.right - ext) > 1) {
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
      cam.near = 10; cam.far = 1400;
      cam.updateProjectionMatrix();
    }
    // snap to texel grid to avoid shimmering
    const texel = (ext * 2) / sun.shadow.mapSize.x * 4;
    const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx + this.sunDir.x * 600, this.sunDir.y * 600, tz + this.sunDir.z * 600);
    sun.target.updateMatrixWorld();
  }

  dispose() {
    for (const o of this.objects) {
      this.scene.remove(o);
      if (o.isInstancedMesh) o.dispose();
    }
    for (const b of this.buildings) if (b.mesh) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    for (const m of this.tintMats.values()) m.dispose();
    this.scene.fog = null;
  }
}

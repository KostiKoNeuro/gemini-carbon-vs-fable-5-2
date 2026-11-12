// Turns library models into destructible geometry: the mesh is sliced along a jittered grid into cells,
// each cell keeps its piece of the original shell plus a hidden "broken concrete" core, so buildings can
// lose chunks, be carved out at the base and collapse into pieces of themselves.
import * as THREE from 'three';
import { makeRng } from './util.js';

const STRIDE = 11; // px py pz nx ny nz u v r g b
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

// Flatten an Object3D hierarchy to a triangle soup (baked transforms, material colour folded into vertex colour).
export function flattenObject(root, filter) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = [];
  let map = null;
  const m4 = new THREE.Matrix4();
  const n3 = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (filter && !filter(o)) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    const col = g.attributes.color;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat && mat.map && !map) map = mat.map;
    const mc = mat && mat.color ? mat.color : _c.set(1, 1, 1);
    const mr = mc.r, mg = mc.g, mb = mc.b;
    m4.multiplyMatrices(inv, o.matrixWorld);
    n3.getNormalMatrix(m4);
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i++) {
      const vi = idx ? idx.getX(i) : i;
      _v.fromBufferAttribute(pos, vi).applyMatrix4(m4);
      if (nor) _n.fromBufferAttribute(nor, vi).applyMatrix3(n3).normalize(); else _n.set(0, 1, 0);
      out.push(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z, uv ? uv.getX(vi) : 0, uv ? uv.getY(vi) : 0,
        col ? col.getX(vi) * mr : mr, col ? col.getY(vi) * mg : mg, col ? col.getZ(vi) * mb : mb);
    }
  });
  return { data: out, map };
}

export function soupToGeometry(data, offset) {
  const n = data.length / STRIDE;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const ox = offset ? offset.x : 0, oy = offset ? offset.y : 0, oz = offset ? offset.z : 0;
  for (let i = 0, j = 0; i < n; i++, j += STRIDE) {
    pos[i * 3] = data[j] - ox; pos[i * 3 + 1] = data[j + 1] - oy; pos[i * 3 + 2] = data[j + 2] - oz;
    nor[i * 3] = data[j + 3]; nor[i * 3 + 1] = data[j + 4]; nor[i * 3 + 2] = data[j + 5];
    uv[i * 2] = data[j + 6]; uv[i * 2 + 1] = data[j + 7];
    col[i * 3] = data[j + 8]; col[i * 3 + 1] = data[j + 9]; col[i * 3 + 2] = data[j + 10];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const matCache = new Map();
export function shellMaterial(map, opts = {}) {
  const key = (map ? map.uuid : 'none') + (opts.double ? 'd' : 's');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: map || null, vertexColors: true, side: opts.double ? THREE.DoubleSide : THREE.FrontSide });
    matCache.set(key, m);
  }
  return m;
}

// A model merged into one geometry + one material: used for instanced props, vehicles and whole-model debris.
const flatCache = new Map();
export class FlatModel {
  static get(key, scene) {
    let f = flatCache.get(key);
    if (!f) { f = new FlatModel(scene); flatCache.set(key, f); }
    return f;
  }
  constructor(scene, filter) {
    const { data, map } = flattenObject(scene, filter);
    this.geometry = soupToGeometry(data);
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.material = shellMaterial(map);
    this.box = this.geometry.boundingBox;
    this.size = this.box.getSize(new THREE.Vector3());
    // centred copy for tumbling debris
    this._centered = null;
  }
  centered() {
    if (!this._centered) {
      const c = this.box.getCenter(new THREE.Vector3());
      this._centered = this.geometry.clone();
      this._centered.translate(-c.x, -c.y, -c.z);
      this.centerOffset = c;
    }
    return this._centered;
  }
}

// ---- slicing -----------------------------------------------------------------------------------
function splitPoly(poly, axis, c) {
  // poly: array of vertices (Float64Array-like arrays of STRIDE). Returns [neg, pos].
  let neg = null, pos = null;
  const n = poly.length;
  let allNeg = true, allPos = true;
  for (let i = 0; i < n; i++) {
    const d = poly[i][axis] - c;
    if (d > 1e-6) allNeg = false;
    if (d < -1e-6) allPos = false;
  }
  if (allNeg) return [poly, null];
  if (allPos) return [null, poly];
  neg = []; pos = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const da = a[axis] - c, db = b[axis] - c;
    if (da <= 0) neg.push(a);
    if (da >= 0) pos.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      const m = new Array(STRIDE);
      for (let k = 0; k < STRIDE; k++) m[k] = a[k] + (b[k] - a[k]) * t;
      m[axis] = c;
      neg.push(m); pos.push(m);
    }
  }
  return [neg.length >= 3 ? neg : null, pos.length >= 3 ? pos : null];
}
function sliceAxis(pieces, axis, planes, slot) {
  const out = [];
  for (const p of pieces) {
    let rem = p.poly;
    let k = 0;
    for (; k < planes.length && rem; k++) {
      const [neg, pos] = splitPoly(rem, axis, planes[k]);
      if (neg) { const q = { poly: neg, ix: p.ix, iy: p.iy, iz: p.iz }; q[slot] = k; out.push(q); }
      rem = pos;
    }
    if (rem) { const q = { poly: rem, ix: p.ix, iy: p.iy, iz: p.iz }; q[slot] = planes.length; out.push(q); }
  }
  return out;
}

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function weightedQuantile(vals, q) {
  // vals: [coord, weight]...
  if (!vals.length) return null;
  vals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  for (const v of vals) total += v[1];
  let acc = 0;
  for (const v of vals) { acc += v[1]; if (acc >= total * q) return v[0]; }
  return vals[vals.length - 1][0];
}

function pushBox(out, x0, y0, z0, x1, y1, z1, r, g, b) {
  const F = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
    [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]],
    [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]],
  ];
  for (const f of F) {
    const n = f[4];
    const k = n[1] > 0 ? 1.25 : n[1] < 0 ? 0.6 : (n[0] !== 0 ? 0.9 : 1.0);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = f[i];
      out.push(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0, r * k, g * k, b * k);
    }
  }
}

let fillerMat = null;
export function fillerMaterial() {
  if (!fillerMat) fillerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return fillerMat;
}

const typeCache = new Map();
export class FractureType {
  static get(key, scene, opts) {
    let t = typeCache.get(key);
    if (!t) { t = new FractureType(key, scene, opts || {}); typeCache.set(key, t); }
    return t;
  }

  constructor(key, scene, opts) {
    this.key = key;
    const rng = makeRng(hashStr(key));
    const { data, map } = flattenObject(scene);
    this.map = map;
    this.material = shellMaterial(map, { double: true });
    // bounds
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += STRIDE) {
      for (let a = 0; a < 3; a++) { const v = data[i + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
    }
    this.min = new THREE.Vector3(min[0], min[1], min[2]);
    this.max = new THREE.Vector3(max[0], max[1], max[2]);
    this.size = new THREE.Vector3().subVectors(this.max, this.min);
    const cell = opts.cell || 2.4;
    const nx = (this.nx = Math.max(1, Math.min(opts.maxXZ || 4, Math.round(this.size.x / cell))));
    const ny = (this.ny = Math.max(1, Math.min(opts.maxY || 12, Math.round(this.size.y / cell))));
    const nz = (this.nz = Math.max(1, Math.min(opts.maxXZ || 4, Math.round(this.size.z / cell))));
    const mkPlanes = (lo, size, n) => {
      const p = [];
      for (let k = 1; k < n; k++) p.push(lo + (size * k) / n + (rng() - 0.5) * (size / n) * 0.3);
      return p;
    };
    const px = mkPlanes(min[0], this.size.x, nx), py = mkPlanes(min[1], this.size.y, ny), pz = mkPlanes(min[2], this.size.z, nz);
    this.planes = [px, py, pz];

    // slice all triangles
    let pieces = [];
    for (let i = 0; i < data.length; i += STRIDE * 3) {
      const a = data.slice(i, i + STRIDE), b = data.slice(i + STRIDE, i + STRIDE * 2), c = data.slice(i + STRIDE * 2, i + STRIDE * 3);
      pieces.push({ poly: [a, b, c], ix: 0, iy: 0, iz: 0 });
    }
    pieces = sliceAxis(pieces, 0, px, 'ix');
    pieces = sliceAxis(pieces, 1, py, 'iy');
    pieces = sliceAxis(pieces, 2, pz, 'iz');

    const ncell = nx * ny * nz;
    const id = (ix, iy, iz) => ix + nx * (iy + ny * iz);
    const ext = Array.from({ length: ncell }, () => []);
    const cb = Array.from({ length: ncell }, () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    const walls = Array.from({ length: ncell }, () => [[], [], [], []]); // -x +x -z +z
    const colTop = new Float32Array(nx * nz).fill(-Infinity);
    const colRoof = new Float32Array(nx * nz).fill(Infinity);
    const colRoofPieces = Array.from({ length: nx * nz }, () => []);
    const colRoofArea = new Float32Array(nx * nz);
    for (const p of pieces) {
      const poly = p.poly;
      const ci = id(p.ix, p.iy, p.iz);
      const e = ext[ci], bb = cb[ci];
      const col = p.ix + nx * p.iz;
      let pminY = Infinity, pmaxY = -Infinity;
      for (const v of poly) {
        for (let a = 0; a < 3; a++) { if (v[a] < bb[a]) bb[a] = v[a]; if (v[a] > bb[a + 3]) bb[a + 3] = v[a]; }
        if (v[1] > colTop[col]) colTop[col] = v[1];
        if (v[1] < pminY) pminY = v[1];
        if (v[1] > pmaxY) pmaxY = v[1];
      }
      // fan triangulate; track area
      let area = 0, cx = 0, cz = 0;
      for (let k = 1; k < poly.length - 1; k++) {
        const a = poly[0], b = poly[k], c = poly[k + 1];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        if (ar < 1e-7) continue;
        area += ar;
        for (const v of [a, b, c]) for (let q = 0; q < STRIDE; q++) e.push(v[q]);
      }
      for (const v of poly) { cx += v[0]; cz += v[2]; }
      cx /= poly.length; cz /= poly.length;
      if (area > 0) {
        const n0 = poly[0];
        if (n0[3] < -0.7) walls[ci][0].push([cx, area]);
        else if (n0[3] > 0.7) walls[ci][1].push([cx, area]);
        if (n0[5] < -0.7) walls[ci][2].push([cz, area]);
        else if (n0[5] > 0.7) walls[ci][3].push([cz, area]);
        if (n0[4] > 0.5) { colRoofPieces[col].push([pminY, pmaxY]); colRoofArea[col] += area * n0[4]; }
      }
    }
    for (let col = 0; col < nx * nz; col++) {
      const top = colTop[col];
      if (top === -Infinity) continue;
      let r = Infinity;
      for (const [lo, hi] of colRoofPieces[col]) if (hi > min[1] + (top - min[1]) * 0.45 && lo < r) r = lo;
      colRoof[col] = r === Infinity ? top : r;
    }

    // filler cores
    const fil = Array.from({ length: ncell }, () => []);
    const lo = (planes, i, base) => (i === 0 ? base : planes[i - 1]);
    const hi = (planes, i, n, top) => (i === n - 1 ? top : planes[i]);
    const insetX = (this.size.x / nx) * 0.06, insetZ = (this.size.z / nz) * 0.06, insetY = (this.size.y / ny) * 0.05;
    const solid = new Uint8Array(ncell);
    if (!opts.noFiller) {
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const col = ix + nx * iz;
        if (colTop[col] === -Infinity) continue;
        if (colRoofArea[col] < (this.size.x / nx) * (this.size.z / nz) * 0.3) continue; // no real roof here: decoration only
        const roof = colRoof[col] - insetY;
        for (let iy = 0; iy < ny; iy++) {
          const ci = id(ix, iy, iz);
          let y0 = lo(py, iy, min[1]), y1 = Math.min(hi(py, iy, ny, max[1]), roof);
          if (y1 - y0 < this.size.y / ny * 0.2) continue;
          const bb = cb[ci];
          const hasGeo = ext[ci].length > 0;
          let x0 = lo(px, ix, min[0]), x1 = hi(px, ix, nx, max[0]);
          let z0 = lo(pz, iz, min[2]), z1 = hi(pz, iz, nz, max[2]);
          const edge = (isEdge, wallIdx, fallbackGeo, fallbackCell, sgn, inset) => {
            if (!isEdge) return fallbackCell;
            const w = weightedQuantile(walls[ci][wallIdx], sgn > 0 ? 0.94 : 0.06); // innermost significant wall plane
            if (w !== null) return w + sgn * inset;
            if (hasGeo) return fallbackGeo + sgn * inset;
            return null;
          };
          const ex0 = edge(ix === 0, 0, bb[0], x0, 1, insetX);
          const ex1 = edge(ix === nx - 1, 1, bb[3], x1, -1, insetX);
          const ez0 = edge(iz === 0, 2, bb[2], z0, 1, insetZ);
          const ez1 = edge(iz === nz - 1, 3, bb[5], z1, -1, insetZ);
          if (ex0 === null || ex1 === null || ez0 === null || ez1 === null) continue;
          x0 = ex0; x1 = ex1; z0 = ez0; z1 = ez1;
          if (x1 - x0 < 0.05 || z1 - z0 < 0.05) continue;
          const shade = 0.16 + rng() * 0.1;
          pushBox(fil[ci], x0, y0, z0, x1, y1, z1, shade * 1.15, shade * 1.0, shade * 0.9);
          solid[ci] = 1;
        }
      }
    }

    // assemble
    const cells = (this.cells = []);
    this.grid = new Int16Array(ncell).fill(-1);
    const extData = [], filData = [];
    for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      const ci = id(ix, iy, iz);
      if (!ext[ci].length && !fil[ci].length) continue;
      const bb = cb[ci];
      const x0 = lo(px, ix, min[0]), x1 = hi(px, ix, nx, max[0]);
      const y0 = lo(py, iy, min[1]), y1 = hi(py, iy, ny, max[1]);
      const z0 = lo(pz, iz, min[2]), z1 = hi(pz, iz, nz, max[2]);
      const c = {
        ix, iy, iz,
        extStart: extData.length / STRIDE, extCount: ext[ci].length / STRIDE,
        filStart: filData.length / STRIDE, filCount: fil[ci].length / STRIDE,
        min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1),
        center: new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2),
        solid: solid[ci] === 1,
      };
      // tighten bounds to actual shell when the cell is only shell (thin overhangs etc.)
      if (!c.solid && bb[0] !== Infinity) {
        c.min.set(bb[0], bb[1], bb[2]); c.max.set(bb[3], bb[4], bb[5]);
        c.center.addVectors(c.min, c.max).multiplyScalar(0.5);
      }
      for (const v of ext[ci]) extData.push(v);
      for (const v of fil[ci]) filData.push(v);
      this.grid[ci] = cells.length;
      cells.push(c);
    }
    this.extCount = extData.length / STRIDE;
    this.filCount = filData.length / STRIDE;
    for (const c of cells) c.filStart += this.extCount;
    this._soup = extData.concat(filData);
    this.geometry = soupToGeometry(this._soup);
    this.geometry.boundingBox = new THREE.Box3(this.min.clone(), this.max.clone());
    this.geometry.boundingSphere = this.geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    // exterior-only geometry for instanced intact buildings (shares buffers)
    this.shellGeometry = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'color']) this.shellGeometry.setAttribute(k, this.geometry.attributes[k]);
    this.shellGeometry.setDrawRange(0, this.extCount);
    this.shellGeometry.boundingBox = this.geometry.boundingBox;
    this.shellGeometry.boundingSphere = this.geometry.boundingSphere;
    this.groundCells = cells.filter((c) => c.iy === 0).length;
    this._chunks = new Array(cells.length).fill(null);
  }

  cellAt(ix, iy, iz) {
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return -1;
    return this.grid[ix + this.nx * (iy + this.ny * iz)];
  }

  // Debris geometry for one cell, centred on the cell centre. Groups: 0 shell, 1 core.
  chunk(i) {
    let g = this._chunks[i];
    if (g) return g;
    const c = this.cells[i];
    const s = this._soup;
    const data = s.slice(c.extStart * STRIDE, (c.extStart + c.extCount) * STRIDE).concat(s.slice(c.filStart * STRIDE, (c.filStart + c.filCount) * STRIDE));
    g = soupToGeometry(data, c.center);
    g.addGroup(0, c.extCount, 0);
    g.addGroup(c.extCount, c.filCount, 1);
    g.computeBoundingSphere();
    this._chunks[i] = g;
    return g;
  }

  // Per-instance geometry: shares vertex buffers, owns an index so cells can be removed.
  instanceGeometry() {
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'color']) g.setAttribute(k, this.geometry.attributes[k]);
    const n = this.extCount + this.filCount;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    g.setIndex(new THREE.BufferAttribute(arr, 1));
    g.addGroup(0, this.extCount, 0);
    g.addGroup(this.extCount, this.filCount, 1);
    g.boundingBox = this.geometry.boundingBox;
    g.boundingSphere = this.geometry.boundingSphere;
    return g;
  }
}

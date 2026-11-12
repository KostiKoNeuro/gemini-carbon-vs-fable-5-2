// Visual effects: instanced sprite particles (library sprites in one atlas), ground decals, shockwave rings,
// physically tumbling debris (real pieces of the models), fires, flashes, camera shake and time effects.
import * as THREE from 'three';
import { A } from './assets.js';
import { FlatModel, fillerMaterial } from './fracture.js';
import { rand, pick, clamp, TAU } from './util.js';

const CELL = 256;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

function buildAtlas() {
  const names = Object.keys(A.bitmaps).sort();
  const cols = 8;
  const rows = Math.ceil(names.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * CELL; c.height = rows * CELL;
  const ctx = c.getContext('2d');
  const uv = {};
  names.forEach((n, i) => {
    const x = (i % cols) * CELL, y = Math.floor(i / cols) * CELL;
    ctx.drawImage(A.bitmaps[n], x + 2, y + 2, CELL - 4, CELL - 4);
    uv[n] = [(x + 2) / c.width, 1 - (y + CELL - 2) / c.height, (CELL - 4) / c.width, (CELL - 4) / c.height];
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, uv };
}

const VERT = `
attribute vec4 aOffset; // xyz, size
attribute vec4 aColor;
attribute vec4 aUv;
attribute vec2 aRot;    // rotation, additive
uniform float uFlat;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
varying float vFog;
void main() {
  float c = cos(aRot.x), s = sin(aRot.x);
  vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aOffset.w;
  vec4 mv;
  if (uFlat > 0.5) {
    mv = viewMatrix * vec4(aOffset.x + corner.x, aOffset.y, aOffset.z + corner.y, 1.0);
  } else {
    mv = viewMatrix * vec4(aOffset.xyz, 1.0);
    mv.xy += corner;
  }
  gl_Position = projectionMatrix * mv;
  vUv = aUv.xy + uv * aUv.zw;
  vColor = aColor;
  vAdd = aRot.y;
  vFog = -mv.z;
}`;
const FRAG = `
uniform sampler2D map;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
varying float vFog;
void main() {
  vec4 t = texture2D(map, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 rgb = t.rgb * vColor.rgb;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
  rgb = mix(rgb, uFogColor, f * (1.0 - vAdd));
  a *= 1.0 - f * 0.6 * vAdd;
  gl_FragColor = vec4(rgb * a, a * (1.0 - vAdd));
  #include <colorspace_fragment>
}`;

class QuadSystem {
  constructor(atlas, capacity, flat) {
    this.cap = capacity;
    this.n = 0;
    this.flat = flat;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.off = new Float32Array(capacity * 4);
    this.col = new Float32Array(capacity * 4);
    this.uvr = new Float32Array(capacity * 4);
    this.rot = new Float32Array(capacity * 2);
    const mk = (arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('aOffset', (this.aOff = mk(this.off, 4)));
    g.setAttribute('aColor', (this.aCol = mk(this.col, 4)));
    g.setAttribute('aUv', (this.aUv = mk(this.uvr, 4)));
    g.setAttribute('aRot', (this.aRot = mk(this.rot, 2)));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas.tex }, uFlat: { value: flat ? 1 : 0 }, uFogColor: { value: new THREE.Color(0xffffff) }, uFogDensity: { value: 0 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide, toneMapped: false,
    });
    if (flat) { this.mat.polygonOffset = true; this.mat.polygonOffsetFactor = -2; this.mat.polygonOffsetUnits = -4; }
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = flat ? 5 : 10;
    // sim
    const f = (k = 1) => new Float32Array(capacity * k);
    this.vel = f(3); this.life = f(); this.max = f(); this.s0 = f(); this.s1 = f(); this.rv = f();
    this.a0 = f(); this.grav = f(); this.drag = f(); this.fin = f(); this.c0 = f(3); this.dark = f();
  }
  setFog(color, density) {
    this.mat.uniforms.uFogColor.value.set(color);
    this.mat.uniforms.uFogDensity.value = density;
  }
  add(uv, x, y, z, vx, vy, vz, life, s0, s1, rot, rv, r, g, b, a, add, grav, drag, fin, dark) {
    let i = this.n;
    if (i >= this.cap) { i = (Math.random() * this.cap) | 0; } else this.n++;
    const o = i * 4, v = i * 3;
    this.off[o] = x; this.off[o + 1] = y; this.off[o + 2] = z; this.off[o + 3] = s0;
    this.vel[v] = vx; this.vel[v + 1] = vy; this.vel[v + 2] = vz;
    this.life[i] = 0; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.rot[i * 2] = rot; this.rot[i * 2 + 1] = add; this.rv[i] = rv;
    this.c0[v] = r; this.c0[v + 1] = g; this.c0[v + 2] = b;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b; this.col[o + 3] = 0;
    this.a0[i] = a; this.grav[i] = grav; this.drag[i] = drag; this.fin[i] = fin; this.dark[i] = dark;
    this.uvr[o] = uv[0]; this.uvr[o + 1] = uv[1]; this.uvr[o + 2] = uv[2]; this.uvr[o + 3] = uv[3];
  }
  update(dt) {
    let n = this.n;
    const { off, col, uvr, rot, vel, life, max, s0, s1, rv, a0, grav, drag, fin, c0, dark } = this;
    for (let i = 0; i < n; i++) {
      life[i] += dt;
      if (life[i] >= max[i]) {
        // swap-remove
        const j = --n;
        if (i !== j) {
          const o = i * 4, p = j * 4, v = i * 3, w = j * 3;
          off[o] = off[p]; off[o + 1] = off[p + 1]; off[o + 2] = off[p + 2]; off[o + 3] = off[p + 3];
          col[o] = col[p]; col[o + 1] = col[p + 1]; col[o + 2] = col[p + 2]; col[o + 3] = col[p + 3];
          uvr[o] = uvr[p]; uvr[o + 1] = uvr[p + 1]; uvr[o + 2] = uvr[p + 2]; uvr[o + 3] = uvr[p + 3];
          rot[i * 2] = rot[j * 2]; rot[i * 2 + 1] = rot[j * 2 + 1];
          vel[v] = vel[w]; vel[v + 1] = vel[w + 1]; vel[v + 2] = vel[w + 2];
          c0[v] = c0[w]; c0[v + 1] = c0[w + 1]; c0[v + 2] = c0[w + 2];
          life[i] = life[j]; max[i] = max[j]; s0[i] = s0[j]; s1[i] = s1[j]; rv[i] = rv[j];
          a0[i] = a0[j]; grav[i] = grav[j]; drag[i] = drag[j]; fin[i] = fin[j]; dark[i] = dark[j];
        }
        i--;
        continue;
      }
      const t = life[i] / max[i];
      const o = i * 4, v = i * 3;
      const d = drag[i] > 0 ? Math.exp(-drag[i] * dt) : 1;
      vel[v] *= d; vel[v + 1] = vel[v + 1] * d - grav[i] * dt; vel[v + 2] *= d;
      off[o] += vel[v] * dt; off[o + 1] += vel[v + 1] * dt; off[o + 2] += vel[v + 2] * dt;
      const e = 1 - (1 - t) * (1 - t);
      off[o + 3] = s0[i] + (s1[i] - s0[i]) * e;
      rot[i * 2] += rv[i] * dt;
      const f = fin[i];
      const al = t < f ? t / f : 1 - (t - f) / (1 - f);
      col[o + 3] = a0[i] * al;
      const k = 1 - (1 - dark[i]) * t;
      col[o] = c0[v] * k; col[o + 1] = c0[v + 1] * k; col[o + 2] = c0[v + 2] * k;
    }
    this.n = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      for (const a of [this.aOff, this.aCol, this.aUv, this.aRot]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
}

export class FX {
  constructor(G) {
    this.G = G;
    const q = G.quality;
    this.atlas = buildAtlas();
    this.uv = this.atlas.uv;
    this.parts = new QuadSystem(this.atlas, q.particles, false);
    this.decals = new QuadSystem(this.atlas, 320, true);
    this.group = new THREE.Group();
    this.group.add(this.decals.mesh, this.parts.mesh);
    G.scene.add(this.group);
    this.debris = [];
    this.maxDebris = q.debris;
    // small rubble bits (instanced library rubble chunk)
    const rub = FlatModel.get('landmarks/masonry-rubble-chunk-c4da0b', A.gltf['landmarks/masonry-rubble-chunk-c4da0b'].scene);
    this.rubCap = q.rubble;
    this.rubMesh = new THREE.InstancedMesh(rub.centered(), rub.material, this.rubCap);
    this.rubMesh.count = 0; this.rubMesh.frustumCulled = false; this.rubMesh.castShadow = true;
    this.rubMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.rubMesh);
    this.rub = [];
    this.fires = [];
    this.trauma = 0;
    this.shakeOff = new THREE.Vector3();
    this.shakeRot = 0;
    this.timeScale = 1; this.slowT = 0; this.slowTarget = 1; this.stopT = 0;
    // explosion lights
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 300, 1.6);
      l.visible = false; this.group.add(l);
      this.lights.push({ l, t: 0, max: 1, i0: 0 });
    }
    this.ringCache = [];
    this.thudT = 0;
  }

  setFog(color, density) { this.parts.setFog(color, density); this.decals.setFog(color, density); }

  // --- time / camera feel -------------------------------------------------------------------------
  shake(amount, x, z) {
    if (x !== undefined) {
      const k = this.G.player;
      if (k) { const d = Math.hypot(x - k.pos.x, z - k.pos.z); amount *= 1 / (1 + Math.pow(d / (k.size * 6), 2)); }
    }
    this.trauma = Math.min(1.2, this.trauma + amount);
  }
  hitStop(sec) { this.stopT = Math.max(this.stopT, sec); }
  slowMo(scale, sec) { this.slowTarget = scale; this.slowT = Math.max(this.slowT, sec); }

  // --- emitters -----------------------------------------------------------------------------------
  p(spr, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, add = 0, grav = 0, drag = 0, fin = 0.1, dark = 1, rv) {
    this.parts.add(this.uv[spr], x, y, z, vx, vy, vz, life, s0, s1, rand(TAU), rv === undefined ? rand(-0.8, 0.8) : rv, r, g, b, a, add, grav, drag, fin, dark);
  }

  dust(x, y, z, size, n = 4, tint = 0, spread = 1) {
    const puffs = ['whitePuff00', 'whitePuff06', 'whitePuff12', 'whitePuff18', 'whitePuff24'];
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), sp = rand(0.2, 1) * size * 0.9 * spread;
      const c = rand(0.62, 0.8) - tint * 0.3;
      this.p(pick(puffs), x + rand(-1, 1) * size * 0.3, y + rand(0, size * 0.3), z + rand(-1, 1) * size * 0.3,
        Math.cos(a) * sp, rand(0.1, 0.6) * size * 0.5, Math.sin(a) * sp, rand(1.6, 3.2), size * rand(0.5, 0.8), size * rand(1.6, 2.6),
        c, c * 0.96, c * 0.88, rand(0.45, 0.7), 0, -size * 0.04, 1.4, 0.12, 0.85);
    }
  }
  dirt(x, y, z, size, n = 3) {
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), sp = rand(0.5, 1.6) * size;
      this.p(pick(['dirt_01', 'dirt_02']), x, y, z, Math.cos(a) * sp, rand(1, 2.4) * size, Math.sin(a) * sp, rand(0.7, 1.3), size * 0.6, size * 1.8,
        0.5, 0.45, 0.4, 0.95, 0, size * 3.2, 0.6, 0.05, 0.9);
    }
  }
  sparks(x, y, z, size, n = 8, r = 1, g = 0.75, b = 0.3) {
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), el = rand(-0.2, 1), sp = rand(1.5, 5) * size;
      this.p('circle_05', x, y, z, Math.cos(a) * sp * (1 - Math.abs(el) * 0.5), el * sp, Math.sin(a) * sp * (1 - Math.abs(el) * 0.5),
        rand(0.35, 0.9), size * rand(0.12, 0.3), 0, r, g, b, 1, 1, size * 6, 0.5, 0.02, 1);
    }
  }
  smoke(x, y, z, size, n = 2, black = true, rise = 1) {
    const s = black ? ['blackSmoke00', 'blackSmoke05', 'blackSmoke12', 'blackSmoke20'] : ['whitePuff00', 'whitePuff12', 'whitePuff24'];
    for (let i = 0; i < n; i++) {
      const c = black ? 0.75 : rand(0.5, 0.7);
      this.p(pick(s), x + rand(-0.3, 0.3) * size, y, z + rand(-0.3, 0.3) * size, rand(-0.25, 0.25) * size + this.G.wind.x, rand(0.5, 1.1) * size * rise, rand(-0.25, 0.25) * size + this.G.wind.z,
        rand(2.2, 4.5), size * rand(0.6, 0.9), size * rand(2.2, 3.6), c, c, c, rand(0.45, 0.75), 0, 0, 0.35, 0.15, 0.9);
    }
  }
  fire(x, y, z, size, n = 2) {
    for (let i = 0; i < n; i++) {
      this.p(pick(['explosion00', 'explosion02', 'explosion04', 'explosion06', 'explosion08']), x + rand(-0.35, 0.35) * size, y + rand(0, 0.3) * size, z + rand(-0.35, 0.35) * size,
        rand(-0.2, 0.2) * size, rand(0.8, 1.6) * size, rand(-0.2, 0.2) * size, rand(0.5, 1.0), size * rand(0.7, 1.1), size * rand(0.3, 0.6), 1.25, 1.05, 0.85, 0.95, 0.85, 0, 0.3, 0.2, 0.7);
    }
  }
  flash(x, y, z, size, r = 1, g = 0.85, b = 0.6, life = 0.16) {
    this.p('flash00', x, y, z, 0, 0, 0, life, size * 1.2, size * 2.6, r * 1.6, g * 1.6, b * 1.6, 1, 1, 0, 0, 0.05, 1, 0);
    this.p('light_01', x, y, z, 0, 0, 0, life * 2.2, size * 3, size * 6, r, g, b, 0.8, 1, 0, 0, 0.05, 1, 0);
  }
  light(x, y, z, color, intensity, life, dist) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.t >= L.max) { best = L; break; } else if (L.max - L.t < best.max - best.t) best = L;
    best.l.color.set(color); best.l.position.set(x, y, z); best.l.distance = dist; best.l.visible = true;
    best.i0 = intensity; best.t = 0; best.max = life;
  }

  // Full explosion: flash, fireball, smoke, sparks, scorch, light, shake, sound.
  explosion(x, y, z, size, opts = {}) {
    const G = this.G;
    const n = clamp(Math.round(4 + size * 0.25), 4, 12);
    this.flash(x, y, z, size);
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), el = rand(0, 1), sp = rand(0.4, 1.5) * size;
      this.p(pick(['explosion00', 'explosion02', 'explosion04', 'explosion06', 'explosion08']), x, y, z,
        Math.cos(a) * sp * (1 - el * 0.6), el * sp * 1.1 + size * 0.3, Math.sin(a) * sp * (1 - el * 0.6),
        rand(0.45, 1.0), size * rand(0.5, 0.9), size * rand(1.3, 2.0), 1.3, 1.1, 0.9, 1, 0.8, 0, 1.6, 0.06, 0.45);
    }
    this.smoke(x, y + size * 0.3, z, size * 1.1, Math.ceil(n * 0.6), true, 1.4);
    this.sparks(x, y, z, size * 0.7, n);
    this.dirt(x, y, z, size * 0.5, 3);
    if (y < size * 1.5 && !opts.noScorch) this.scorch(x, z, size * rand(1.6, 2.2));
    this.light(x, y + size * 0.5, z, 0xffa040, 900 * size, 0.45, size * 18);
    this.shake(clamp(size * 0.035, 0.08, 0.6) * (opts.shake === undefined ? 1 : opts.shake), x, z);
    if (!opts.silent) {
      const pos = { x, y, z };
      const big = size > 9;
      G.audio.play('boom', { vol: clamp(0.5 + size * 0.04, 0.5, 1.3), rate: clamp(1.25 - size * 0.02, 0.55, 1.2), pos });
      if (big) G.audio.play('sub', { vol: 0.9, rate: 0.9, pos });
    }
  }

  scorch(x, z, size, a = 0.75, life = 40) {
    const g = this.G.world ? this.G.world.groundY(x, z) : 0;
    this.decals.add(this.uv[pick(['scorch_01', 'scorch_02', 'scorch_03'])], x, g + 0.06, z, 0, 0, 0, life, size, size, rand(TAU), 0, 0.02, 0.02, 0.02, a, 0, 0, 0, 0.01, 1);
  }
  footprint(x, z, size) {
    this.decals.add(this.uv.scorch_02, x, 0.05, z, 0, 0, 0, 14, size, size, rand(TAU), 0, 0.05, 0.045, 0.04, 0.5, 0, 0, 0, 0.02, 1);
  }
  // expanding shockwave ring on the ground
  ring(x, z, r0, r1, life, r = 1, g = 0.95, b = 0.8, a = 0.9, add = 0.6) {
    const y = (this.G.world ? this.G.world.groundY(x, z) : 0) + 0.12;
    this.decals.add(this.uv.circle_02, x, y, z, 0, 0, 0, life, r0 * 2.2, r1 * 2.2, 0, 0, r, g, b, a, add, 0, 0, 0.05, 1);
  }
  // marker ring (telegraph) that stays the same size
  marker(x, z, radius, life, r, g, b) {
    this.decals.add(this.uv.circle_02, x, 0.15, z, 0, 0, 0, life, radius * 2.2, radius * 2.2, 0, 0, r, g, b, 0.95, 0.7, 0, 0, 0.15, 1);
  }

  // --- debris -------------------------------------------------------------------------------------
  // geometry must be centred on its own origin. materials: material or [shell, filler].
  spawnDebris(geometry, material, x, y, z, scaleX, scaleY, scaleZ, rotY, vx, vy, vz, opts = {}) {
    if (this.debris.length >= this.maxDebris) {
      // recycle the oldest resting piece
      let k = -1;
      for (let i = 0; i < this.debris.length; i++) if (this.debris[i].rest) { k = i; break; }
      if (k < 0) k = 0;
      this.G.scene.remove(this.debris[k].mesh);
      this.debris.splice(k, 1);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, rotY, 0);
    mesh.scale.set(scaleX, scaleY, scaleZ);
    mesh.castShadow = true;
    this.G.scene.add(mesh);
    const bs = geometry.boundingSphere || (geometry.computeBoundingSphere(), geometry.boundingSphere);
    const rad = bs.radius * Math.max(scaleX, scaleY, scaleZ);
    const spin = opts.spin === undefined ? 1 : opts.spin;
    const d = {
      mesh, vx, vy, vz, rad, half: rad * 0.45,
      wx: rand(-2.5, 2.5) * spin, wy: rand(-1.5, 1.5) * spin, wz: rand(-2.5, 2.5) * spin,
      life: 0, max: opts.life || rand(7, 11), rest: false, bounces: 0, sx: scaleX, sy: scaleY, sz: scaleZ,
      onLand: opts.onLand || null, dusty: opts.dusty !== false, burn: opts.burn || 0, value: opts.value || 0,
    };
    this.debris.push(d);
    return d;
  }

  rubble(x, y, z, size, n, power) {
    for (let i = 0; i < n; i++) {
      if (this.rub.length >= this.rubCap) this.rub.shift();
      const a = rand(TAU), sp = rand(0.3, 1) * power;
      this.rub.push({
        x: x + rand(-0.4, 0.4) * size, y: y + rand(-0.4, 0.4) * size, z: z + rand(-0.4, 0.4) * size,
        vx: Math.cos(a) * sp, vy: rand(0.2, 1) * power, vz: Math.sin(a) * sp,
        rx: rand(TAU), ry: rand(TAU), rz: rand(TAU), w: rand(-6, 6), s: size * rand(0.5, 1.2), life: 0, max: rand(4, 7), rest: false,
      });
    }
  }

  addFire(x, y, z, size, duration) {
    if (this.fires.length >= this.G.quality.fires) this.fires.shift();
    this.fires.push({ x, y, z, size, t: 0, max: duration, acc: 0 });
  }

  update(dt, rawDt) {
    const G = this.G;
    // time effects (use unscaled dt)
    if (this.stopT > 0) { this.stopT -= rawDt; this.timeScale = 0.02; }
    else if (this.slowT > 0) { this.slowT -= rawDt; this.timeScale += (this.slowTarget - this.timeScale) * Math.min(1, rawDt * 14); }
    else this.timeScale += (1 - this.timeScale) * Math.min(1, rawDt * 6);
    // shake
    this.trauma = Math.max(0, this.trauma - rawDt * 1.5);
    const sh = this.trauma * this.trauma * (G.save ? G.save.settings.shake : 1);
    const k = G.player ? G.player.size * 0.1 : 1;
    const t = performance.now() * 0.001;
    this.shakeOff.set(Math.sin(t * 61.3) + Math.sin(t * 37.7), Math.sin(t * 53.1) + Math.cos(t * 41.9), Math.sin(t * 47.3)).multiplyScalar(sh * k * 0.5);
    this.shakeRot = Math.sin(t * 57) * sh * 0.02;
    if (dt <= 0) return;
    this.parts.update(dt);
    this.decals.update(dt);
    for (const L of this.lights) {
      if (!L.l.visible) continue;
      L.t += dt;
      if (L.t >= L.max) { L.l.visible = false; L.l.intensity = 0; } else { const f = 1 - L.t / L.max; L.l.intensity = L.i0 * f * f; }
    }
    this.updateDebris(dt);
    this.updateRubble(dt);
    // fires
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t > f.max) { this.fires.splice(i, 1); continue; }
      f.acc += dt * 7;
      const fade = 1 - f.t / f.max;
      while (f.acc > 1) {
        f.acc -= 1;
        if (Math.random() < fade + 0.2) this.fire(f.x + rand(-1, 1) * f.size, f.y, f.z + rand(-1, 1) * f.size, f.size * rand(0.6, 1.1), 1);
        if (Math.random() < 0.45) this.smoke(f.x + rand(-1, 1) * f.size, f.y + f.size, f.z + rand(-1, 1) * f.size, f.size * 1.3, 1, true, 1.6);
      }
    }
    this.thudT -= dt;
  }

  updateDebris(dt) {
    const G = this.G;
    const grav = 26;
    const world = G.world;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      const m = d.mesh;
      if (d.life > d.max) {
        // sink / shrink away
        const f = 1 - (d.life - d.max) / 1.2;
        if (f <= 0) { G.scene.remove(m); this.debris.splice(i, 1); continue; }
        m.scale.set(d.sx * f, d.sy * f, d.sz * f);
        m.position.y -= dt * d.half * 0.8;
        continue;
      }
      if (d.rest) continue;
      d.vy -= grav * dt;
      m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt;
      m.rotation.x += d.wx * dt; m.rotation.y += d.wy * dt; m.rotation.z += d.wz * dt;
      const gy = (world ? world.groundY(m.position.x, m.position.z) : 0) + d.half;
      if (m.position.y < gy) {
        m.position.y = gy;
        const impact = -d.vy;
        if (impact > 6) {
          if (d.dusty) this.dust(m.position.x, gy - d.half, m.position.z, d.rad * 0.9, 2);
          if (this.thudT <= 0 && d.rad > 2) {
            this.thudT = 0.07;
            G.audio.play('slab', { vol: clamp(d.rad * 0.07, 0.15, 0.8), rate: clamp(1.3 - d.rad * 0.05, 0.5, 1.2), pos: m.position });
            this.shake(clamp(d.rad * 0.006, 0, 0.12), m.position.x, m.position.z);
          }
          if (d.onLand) { d.onLand(d, impact); d.onLand = null; }
        }
        d.bounces++;
        if (impact < 4 || d.bounces > 3) {
          d.rest = true; d.vx = d.vy = d.vz = 0;
          if (d.burn) this.addFire(m.position.x, gy, m.position.z, d.rad * 0.5, d.burn);
        } else {
          d.vy = impact * 0.28; d.vx *= 0.6; d.vz *= 0.6;
          d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5;
        }
      }
    }
  }

  updateRubble(dt) {
    const rub = this.rub;
    const mesh = this.rubMesh;
    const world = this.G.world;
    let n = 0;
    for (let i = 0; i < rub.length; i++) {
      const r = rub[i];
      r.life += dt;
      if (r.life > r.max) { rub.splice(i, 1); i--; continue; }
      if (!r.rest) {
        r.vy -= 26 * dt;
        r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
        r.rx += r.w * dt; r.rz += r.w * 0.7 * dt;
        const gy = (world ? world.groundY(r.x, r.z) : 0) + r.s * 0.15;
        if (r.y < gy) {
          r.y = gy;
          if (r.vy > -5) r.rest = true; else { r.vy = -r.vy * 0.3; r.vx *= 0.6; r.vz *= 0.6; }
        }
      }
      const fade = r.life > r.max - 0.8 ? (r.max - r.life) / 0.8 : 1;
      _e.set(r.rx, r.ry, r.rz);
      const s = r.s * fade * 2.2;
      _m.compose(_p.set(r.x, r.y, r.z), _q.setFromEuler(_e), _s.set(s, s, s));
      mesh.setMatrixAt(n++, _m);
    }
    mesh.count = n;
    if (n) mesh.instanceMatrix.needsUpdate = true;
  }

  // --- gameplay presets ---------------------------------------------------------------------------
  // light spray where an attack hits a building but doesn't break a cell
  buildingHit(b, x, y, z) {
    this.dust(x, y, z, b.cellSize * 0.5, 1);
    this.dirt(x, y, z, b.cellSize * 0.35, 1);
  }

  // A cell of a building breaks off: becomes a tumbling piece of that building.
  cellBreak(b, i, dx, dy, dz, falling) {
    const G = this.G;
    const t = b.type;
    const c = b.cellCenter(i, _v);
    const cx = c.x, cy = c.y, cz = c.z;
    const size = b.cellSize;
    const pl = G.player;
    const near = pl ? Math.hypot(cx - pl.pos.x, cz - pl.pos.z) < pl.size * 9 + 80 : true;
    if (near) {
      // outward push from the building centre + attack direction
      let ox = cx - b.cx, oz = cz - b.cz;
      const ol = Math.hypot(ox, oz) || 1;
      ox /= ol; oz /= ol;
      const pw = falling ? size * 0.35 : size * rand(1.2, 2.6);
      const vx = (ox * 0.6 + dx * 1.2) * pw + rand(-1, 1) * size * 0.3;
      const vz = (oz * 0.6 + dz * 1.2) * pw + rand(-1, 1) * size * 0.3;
      const vy = falling ? rand(-2, 1) : (0.5 + dy) * pw * rand(0.6, 1.2) + size * 0.5;
      const mat = [b.tint !== 0xffffff ? b.world.tintedMaterial(t, b.tint) : t.material, fillerMaterial()];
      this.spawnDebris(t.chunk(i), mat, cx, cy, cz, b.scale, b.yScale, b.scale, b.rot * Math.PI / 2, vx, vy, vz, { spin: falling ? 0.35 : 1 });
      this.rubble(cx, cy, cz, size * 0.5, falling ? 2 : 4, size * (falling ? 0.8 : 2.2));
      this.dust(cx, cy, cz, size * 0.9, falling ? 2 : 3);
      if (!falling) this.dirt(cx, cy, cz, size * 0.5, 2);
    } else {
      this.dust(cx, cy, cz, size, 1);
    }
  }

  // Whole model flung away as debris (props, wrecked vehicles).
  flingModel(flat, x, y, z, rotY, scale, vx, vy, vz, opts) {
    const g = flat.centered();
    const c = flat.centerOffset;
    return this.spawnDebris(g, flat.material, x, y + c.y * scale, z, scale, scale, scale, rotY, vx, vy, vz, opts);
  }

  clear() {
    for (const d of this.debris) this.G.scene.remove(d.mesh);
    this.debris.length = 0;
    this.rub.length = 0; this.rubMesh.count = 0;
    this.fires.length = 0;
    this.parts.clear(); this.decals.clear();
    for (const L of this.lights) { L.l.visible = false; L.t = L.max; }
    this.trauma = 0; this.timeScale = 1; this.slowT = 0; this.stopT = 0;
  }
}

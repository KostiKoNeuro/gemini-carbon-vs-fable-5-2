import * as THREE from 'three';
import { MODEL_MANIFEST } from '../data/assetManifest.js';

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n0 = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _normalMat = new THREE.Matrix3();

export class FractureEngine {
  constructor(assetManager, scene) {
    this.assets = assetManager;
    this.scene = scene;
    this.fractureCache = new Map(); // modelKey -> Array<{ groupTemplate, localOffset, normY }>
    this.activeFragments = [];
    this.rubbleRemnants = [];
    this.maxActiveFragments = 240;
  }

  setQuality(quality) {
    this.maxActiveFragments = quality === 'low' ? 95 : quality === 'medium' ? 160 : 250;
  }

  // Pre-slice every building GLB into real 3D Voronoi structural pieces at load time!
  prefractureAllBuildings() {
    for (const [key, def] of Object.entries(MODEL_MANIFEST)) {
      if (def.fragments && def.fragments > 0) {
        this.prefractureModel(key, def.fragments);
      }
    }
  }

  prefractureModel(modelKey, numSeeds = 12) {
    if (this.fractureCache.has(modelKey)) return;

    const sample = this.assets.instantiate(modelKey);
    sample.updateMatrixWorld(true);
    const dims = sample.userData.dims;
    const W = Math.max(2, dims.x);
    const H = Math.max(2, dims.y);
    const D = Math.max(2, dims.z);

    // Deterministic stratified 3D Voronoi seeds so stories & corners break into natural chunks
    let rng = this.hashStr(modelKey);
    const rand = () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 4294967296;
    };

    const seeds = [];
    for (let i = 0; i < numSeeds; i++) {
      const yFrac = (i + 0.18 + rand() * 0.64) / numSeeds;
      const angle = i * 2.39996 + rand() * 0.65; // golden angle spiral around building!
      const rad = 0.22 + rand() * 0.26;
      seeds.push(new THREE.Vector3(
        Math.cos(angle) * W * rad,
        yFrac * H,
        Math.sin(angle) * D * rad
      ));
    }

    // Map: seedIdx -> Map<material, { pos:[], norm:[], uv:[], col:[], hasUv:boolean, hasCol:boolean }>
    const buckets = Array.from({ length: numSeeds }, () => new Map());

    const addTriToVoronoi = (p0, p1, p2, n0, n1, n2, uv0, uv1, uv2, c0, c1, c2, mat, hasNorm, hasUv, hasCol, colItemSize, depth = 0) => {
      // Subdivide large wall/roof faces so shattered chunks are compact 2-3m masonry blocks instead of huge wall sheets!
      if (depth < 2) {
        const e01 = p0.distanceToSquared(p1);
        const e12 = p1.distanceToSquared(p2);
        const e20 = p2.distanceToSquared(p0);
        if (Math.max(e01, e12, e20) > 14.0) {
          const m01 = p0.clone().add(p1).multiplyScalar(0.5);
          const m12 = p1.clone().add(p2).multiplyScalar(0.5);
          const m20 = p2.clone().add(p0).multiplyScalar(0.5);
          const nm01 = hasNorm ? n0.clone().add(n1).normalize() : null;
          const nm12 = hasNorm ? n1.clone().add(n2).normalize() : null;
          const nm20 = hasNorm ? n2.clone().add(n0).normalize() : null;
          const uvm01 = hasUv ? [(uv0[0] + uv1[0]) * 0.5, (uv0[1] + uv1[1]) * 0.5] : null;
          const uvm12 = hasUv ? [(uv1[0] + uv2[0]) * 0.5, (uv1[1] + uv2[1]) * 0.5] : null;
          const uvm20 = hasUv ? [(uv2[0] + uv0[0]) * 0.5, (uv2[1] + uv0[1]) * 0.5] : null;
          const cm01 = hasCol ? c0.map((v, i) => (v + c1[i]) * 0.5) : null;
          const cm12 = hasCol ? c1.map((v, i) => (v + c2[i]) * 0.5) : null;
          const cm20 = hasCol ? c2.map((v, i) => (v + c0[i]) * 0.5) : null;

          addTriToVoronoi(p0, m01, m20, n0, nm01, nm20, uv0, uvm01, uvm20, c0, cm01, cm20, mat, hasNorm, hasUv, hasCol, colItemSize, depth + 1);
          addTriToVoronoi(m01, p1, m12, nm01, n1, nm12, uvm01, uv1, uvm12, cm01, c1, cm12, mat, hasNorm, hasUv, hasCol, colItemSize, depth + 1);
          addTriToVoronoi(m20, m12, p2, nm20, nm12, n2, uvm20, uvm12, uv2, cm20, cm12, c2, mat, hasNorm, hasUv, hasCol, colItemSize, depth + 1);
          addTriToVoronoi(m01, m12, m20, nm01, nm12, nm20, uvm01, uvm12, uvm20, cm01, cm12, cm20, mat, hasNorm, hasUv, hasCol, colItemSize, depth + 1);
          return;
        }
      }

      _centroid.copy(p0).add(p1).add(p2).multiplyScalar(1 / 3);
      let bestIdx = 0;
      let bestDistSq = Infinity;
      for (let s = 0; s < numSeeds; s++) {
        const dSq = _centroid.distanceToSquared(seeds[s]);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = s;
        }
      }

      let matBucket = buckets[bestIdx].get(mat);
      if (!matBucket) {
        matBucket = {
          pos: [],
          norm: [],
          uv: [],
          col: [],
          hasUv,
          hasCol,
          colItemSize
        };
        buckets[bestIdx].set(mat, matBucket);
      }

      matBucket.pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      if (hasNorm) {
        matBucket.norm.push(n0.x, n0.y, n0.z, n1.x, n1.y, n1.z, n2.x, n2.y, n2.z);
      }
      if (hasUv) {
        matBucket.uv.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1]);
      }
      if (hasCol) {
        matBucket.col.push(...c0, ...c1, ...c2);
      }
    };

    sample.traverse((child) => {
      if (!child.isMesh || !child.geometry || !child.visible) return;
      const geom = child.geometry;
      const posAttr = geom.attributes.position;
      if (!posAttr) return;

      const normAttr = geom.attributes.normal;
      const uvAttr = geom.attributes.uv;
      const colAttr = geom.attributes.color;
      const indexAttr = geom.index;
      const worldMat = child.matrixWorld;
      _normalMat.getNormalMatrix(worldMat);

      const hasNorm = Boolean(normAttr);
      const hasUv = Boolean(uvAttr);
      const hasCol = Boolean(colAttr);
      const colItemSize = colAttr ? colAttr.itemSize : 3;

      const readCol = (idx) => {
        if (!colAttr) return null;
        return colItemSize === 4
          ? [colAttr.getX(idx), colAttr.getY(idx), colAttr.getZ(idx), colAttr.getW(idx)]
          : [colAttr.getX(idx), colAttr.getY(idx), colAttr.getZ(idx)];
      };

      const groups = (geom.groups && geom.groups.length > 0 && Array.isArray(child.material))
        ? geom.groups
        : [{ start: 0, count: indexAttr ? indexAttr.count : posAttr.count, materialIndex: 0 }];

      for (const grp of groups) {
        const mat = Array.isArray(child.material)
          ? (child.material[grp.materialIndex] || child.material[0])
          : child.material;
        if (!mat) continue;

        const end = grp.start + grp.count;
        for (let t = grp.start; t + 2 < end; t += 3) {
          const i0 = indexAttr ? indexAttr.getX(t) : t;
          const i1 = indexAttr ? indexAttr.getX(t + 1) : t + 1;
          const i2 = indexAttr ? indexAttr.getX(t + 2) : t + 2;

          const p0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0).applyMatrix4(worldMat);
          const p1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(worldMat);
          const p2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(worldMat);

          const n0 = hasNorm ? new THREE.Vector3().fromBufferAttribute(normAttr, i0).applyMatrix3(_normalMat).normalize() : null;
          const n1 = hasNorm ? new THREE.Vector3().fromBufferAttribute(normAttr, i1).applyMatrix3(_normalMat).normalize() : null;
          const n2 = hasNorm ? new THREE.Vector3().fromBufferAttribute(normAttr, i2).applyMatrix3(_normalMat).normalize() : null;

          const uv0 = hasUv ? [uvAttr.getX(i0), uvAttr.getY(i0)] : null;
          const uv1 = hasUv ? [uvAttr.getX(i1), uvAttr.getY(i1)] : null;
          const uv2 = hasUv ? [uvAttr.getX(i2), uvAttr.getY(i2)] : null;

          addTriToVoronoi(
            p0, p1, p2,
            n0, n1, n2,
            uv0, uv1, uv2,
            readCol(i0), readCol(i1), readCol(i2),
            mat, hasNorm, hasUv, hasCol, colItemSize, 0
          );
        }
      }
    });

    const chunkTemplates = [];
    for (let s = 0; s < numSeeds; s++) {
      const matMap = buckets[s];
      if (matMap.size === 0) continue;

      // Compute exact center of mass of all vertices in this Voronoi cell
      let sumX = 0, sumY = 0, sumZ = 0, countV = 0;
      for (const b of matMap.values()) {
        for (let k = 0; k < b.pos.length; k += 3) {
          sumX += b.pos[k];
          sumY += b.pos[k + 1];
          sumZ += b.pos[k + 2];
          countV++;
        }
      }
      if (countV === 0) continue;

      const cx = sumX / countV;
      const cy = sumY / countV;
      const cz = sumZ / countV;

      const chunkGroup = new THREE.Group();
      for (const [mat, b] of matMap.entries()) {
        const bg = new THREE.BufferGeometry();
        const shiftedPos = new Float32Array(b.pos.length);
        for (let k = 0; k < b.pos.length; k += 3) {
          shiftedPos[k] = b.pos[k] - cx;
          shiftedPos[k + 1] = b.pos[k + 1] - cy;
          shiftedPos[k + 2] = b.pos[k + 2] - cz;
        }
        bg.setAttribute('position', new THREE.BufferAttribute(shiftedPos, 3));

        if (b.norm.length === b.pos.length) {
          bg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.norm), 3));
        } else {
          bg.computeVertexNormals();
        }
        if (b.hasUv && b.uv.length > 0) {
          bg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
        }
        if (b.hasCol && b.col.length > 0) {
          bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), b.colItemSize));
        }
        bg.computeBoundingSphere();

        // DoubleSide so cracked interior faces of shattered GLB walls look solid from every angle!
        const chunkMat = mat.clone();
        chunkMat.side = THREE.DoubleSide;
        const mesh = new THREE.Mesh(bg, chunkMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        chunkGroup.add(mesh);
      }

      chunkTemplates.push({
        groupTemplate: chunkGroup,
        localOffset: new THREE.Vector3(cx, cy, cz),
        radius: Math.max(0.7, chunkGroup.children[0]?.geometry?.boundingSphere?.radius * 0.45 || 1.1),
        normY: cy / H
      });
    }

    this.fractureCache.set(modelKey, chunkTemplates);
  }

  hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
  }

  spawnFragmentObj(obj3d, worldPos, vel, angVel, radius = 0.9, life = 3.8) {
    // Enforce cap by recycling oldest settled fragment
    if (this.activeFragments.length >= this.maxActiveFragments) {
      const oldest = this.activeFragments.shift();
      this.scene.remove(oldest.mesh);
    }

    obj3d.position.copy(worldPos);
    this.scene.add(obj3d);

    this.activeFragments.push({
      mesh: obj3d,
      vel: vel.clone(),
      angVel: angVel.clone(),
      radius,
      age: 0,
      life,
      bounces: 0
    });
  }

  // Spawn light facade / window debris when a building takes a non-lethal blow
  spawnDamageChip(building, hitDir) {
    const count = 3;
    const keys = ['rubble_chunk', 'debris_door', 'debris_stone'];
    for (let i = 0; i < count; i++) {
      const k = keys[i % keys.length];
      const chip = this.assets.instantiate(k);
      const scale = 0.8 + Math.random() * 0.8;
      chip.scale.setScalar(scale);

      const pos = building.mesh.position.clone();
      pos.x += (Math.random() - 0.5) * building.dims.x * 0.7;
      pos.y += (0.25 + Math.random() * 0.65) * building.dims.y;
      pos.z += (Math.random() - 0.5) * building.dims.z * 0.7;

      const vel = new THREE.Vector3(
        hitDir.x * (9 + Math.random() * 9) + (Math.random() - 0.5) * 12,
        6 + Math.random() * 11,
        hitDir.z * (9 + Math.random() * 9) + (Math.random() - 0.5) * 12
      );
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10
      );
      this.spawnFragmentObj(chip, pos, vel, angVel, 0.65, 2.4);
    }
  }

  // FULL JUICY BUILDING COLLAPSE INTO VORONOI GLB CHUNKS + PERMANENT 3D RUBBLE MOUND!
  shatterBuilding(building, hitDir, forceMultiplier = 1.0) {
    const chunks = this.fractureCache.get(building.modelKey) || [];
    const rotY = building.mesh.rotation.y;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const basePos = building.mesh.position;

    for (const c of chunks) {
      const piece = c.groupTemplate.clone(true);
      const ox = c.localOffset.x * cosY + c.localOffset.z * sinY;
      const oz = -c.localOffset.x * sinY + c.localOffset.z * cosY;
      const worldPos = new THREE.Vector3(basePos.x + ox, basePos.y + c.localOffset.y, basePos.z + oz);
      piece.rotation.y = rotY;

      // Radial outward + directional smash impulse + upper-story cascade velocity!
      const radialX = ox;
      const radialZ = oz;
      const radialLen = Math.hypot(radialX, radialZ) || 1;
      const nx = radialX / radialLen;
      const nz = radialZ / radialLen;

      const speed = (7 + Math.random() * 11 + c.normY * 9) * forceMultiplier;
      const vel = new THREE.Vector3(
        nx * speed * 0.85 + hitDir.x * (12 + c.normY * 10) * forceMultiplier + (Math.random() - 0.5) * 6,
        (4 + Math.random() * 10 + c.normY * 6) * forceMultiplier,
        nz * speed * 0.85 + hitDir.z * (12 + c.normY * 10) * forceMultiplier + (Math.random() - 0.5) * 6
      );
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 7.5,
        (Math.random() - 0.5) * 6.5,
        (Math.random() - 0.5) * 7.5
      );

      this.spawnFragmentObj(piece, worldPos, vel, angVel, c.radius, 3.6 + Math.random() * 1.4);
    }

    // Mix in 4 extra 3D masonry chunks from Patch library
    const extraCount = Math.min(5, 2 + building.tier);
    for (let i = 0; i < extraCount; i++) {
      const mKey = i % 2 === 0 ? 'rubble_chunk' : 'debris_stone';
      const rock = this.assets.instantiate(mKey);
      rock.scale.setScalar(0.9 + building.tier * 0.3 + Math.random() * 0.5);
      const pos = new THREE.Vector3(
        basePos.x + (Math.random() - 0.5) * building.dims.x * 0.6,
        2 + Math.random() * building.dims.y * 0.6,
        basePos.z + (Math.random() - 0.5) * building.dims.z * 0.6
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 20 + hitDir.x * 10,
        8 + Math.random() * 14,
        (Math.random() - 0.5) * 20 + hitDir.z * 10
      );
      const angVel = new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      this.spawnFragmentObj(rock, pos, vel, angVel, 0.8, 3.2);
    }

    // Place permanent 3D collapseRubbleMound + rubbleScatterDecal on the lot!
    const footprint = Math.max(building.dims.x, building.dims.z);
    const mound = this.assets.instantiate('rubble_mound');
    const moundScale = Math.max(0.85, Math.min(2.4, footprint / 6.2));
    mound.scale.set(moundScale, Math.min(2.0, 0.8 + building.tier * 0.25), moundScale);
    mound.position.set(basePos.x, 0, basePos.z);
    mound.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mound);
    this.rubbleRemnants.push(mound);

    const scatter = this.assets.instantiate('rubble_decal');
    scatter.scale.set(moundScale * 1.05, 1.0, moundScale * 1.05);
    scatter.position.set(basePos.x, 0.03, basePos.z);
    scatter.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(scatter);
    this.rubbleRemnants.push(scatter);
  }

  // Explode vehicle or tank into real 3D car-kit debris GLBs (tires, doors, bumpers, plates)!
  shatterVehicle(worldPos, hitDir = { x: 0, z: 1 }, scale = 1.0) {
    const partKeys = ['debris_tire', 'debris_tire', 'debris_door', 'debris_bumper', 'debris_plate'];
    for (const pk of partKeys) {
      const part = this.assets.instantiate(pk);
      part.scale.setScalar((0.95 + Math.random() * 0.4) * scale);
      const p = new THREE.Vector3(
        worldPos.x + (Math.random() - 0.5) * 2.2,
        worldPos.y + 0.8 + Math.random() * 1.5,
        worldPos.z + (Math.random() - 0.5) * 2.2
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 22 + hitDir.x * 12,
        9 + Math.random() * 14,
        (Math.random() - 0.5) * 22 + hitDir.z * 12
      );
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      );
      this.spawnFragmentObj(part, p, vel, angVel, 0.5, 2.6);
    }
  }

  update(dt) {
    const gravity = -34;
    for (let i = this.activeFragments.length - 1; i >= 0; i--) {
      const f = this.activeFragments[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.scene.remove(f.mesh);
        this.activeFragments.splice(i, 1);
        continue;
      }

      f.vel.y += gravity * dt;
      f.mesh.position.addScaledVector(f.vel, dt);

      f.mesh.rotation.x += f.angVel.x * dt;
      f.mesh.rotation.y += f.angVel.y * dt;
      f.mesh.rotation.z += f.angVel.z * dt;

      // Ground bounce on asphalt!
      if (f.mesh.position.y < f.radius * 0.45) {
        f.mesh.position.y = f.radius * 0.45;
        if (Math.abs(f.vel.y) > 3.2 && f.bounces < 3) {
          f.vel.y = -f.vel.y * 0.36;
          f.vel.x *= 0.68;
          f.vel.z *= 0.68;
          f.angVel.multiplyScalar(0.65);
          f.bounces++;
        } else {
          f.vel.y = 0;
          f.vel.x *= Math.max(0, 1 - 7 * dt);
          f.vel.z *= Math.max(0, 1 - 7 * dt);
          f.angVel.multiplyScalar(Math.max(0, 1 - 8 * dt));
        }
      }

      // Smooth sink in final 0.7s so rubble settles cleanly into the ground mound
      const remain = f.life - f.age;
      if (remain < 0.7) {
        const s = Math.max(0.01, remain / 0.7);
        f.mesh.scale.multiplyScalar(Math.pow(s, dt * 3.5));
      }
    }
  }

  clear() {
    for (const f of this.activeFragments) this.scene.remove(f.mesh);
    for (const r of this.rubbleRemnants) this.scene.remove(r);
    this.activeFragments.length = 0;
    this.rubbleRemnants.length = 0;
  }
}

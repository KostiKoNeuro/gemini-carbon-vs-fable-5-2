import * as THREE from 'three';
import { MODEL_MANIFEST } from '../data/assetManifest.js';

function createCityGroundTexture(gridSize, theme) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Asphalt base
  ctx.fillStyle = theme === 'downtown' || theme === 'citadel' ? '#1c202b' : '#282c34';
  ctx.fillRect(0, 0, size, size);

  const cells = gridSize;
  const cellPx = size / cells;
  const roadW = cellPx * 0.28;
  const pad = roadW * 0.5;

  for (let gx = 0; gx < cells; gx++) {
    for (let gz = 0; gz < cells; gz++) {
      const x0 = gx * cellPx + pad;
      const z0 = gz * cellPx + pad;
      const bw = cellPx - roadW;

      // Sidewalk concrete curb
      ctx.fillStyle = theme === 'citadel' ? '#3d3744' : '#5f6570';
      ctx.fillRect(x0, z0, bw, bw);

      // Inner block lot (grass for suburbs/parks, industrial concrete for port/downtown)
      const isPark = ((gx + gz * 3) % 7 === 0) && !(gx === Math.floor(cells / 2) && gz === Math.floor(cells / 2));
      if (isPark) {
        ctx.fillStyle = theme === 'citadel' ? '#2c4a3e' : '#3d7a47';
      } else if (theme === 'suburban') {
        ctx.fillStyle = (gx + gz) % 2 === 0 ? '#467d4c' : '#4f5661';
      } else if (theme === 'industrial') {
        ctx.fillStyle = '#47494f';
      } else {
        ctx.fillStyle = '#363c49';
      }
      ctx.fillRect(x0 + 6, z0 + 6, bw - 12, bw - 12);

      // Crosswalk stripes around block
      ctx.fillStyle = 'rgba(235, 240, 248, 0.55)';
      const stripes = 5;
      for (let s = 0; s < stripes; s++) {
        const off = (s + 0.5) * (roadW * 0.7 / stripes) - roadW * 0.35;
        // Horizontal crosswalk
        ctx.fillRect(x0 - roadW * 0.72, z0 + 8 + s * 6, roadW * 0.45, 3);
        ctx.fillRect(x0 + 8 + s * 6, z0 - roadW * 0.72, 3, roadW * 0.45);
      }
    }
  }

  // Yellow dashed road center lines
  ctx.strokeStyle = theme === 'downtown' ? '#f5b73b' : '#e2b93b';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  for (let i = 0; i <= cells; i++) {
    const pos = i * cellPx;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(size, pos);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createSkyDome(topHex, horizonHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  const cTop = new THREE.Color(topHex);
  const cHor = new THREE.Color(horizonHex);
  grad.addColorStop(0.0, '#' + cTop.getHexString());
  grad.addColorStop(0.58, '#' + cHor.getHexString());
  grad.addColorStop(1.0, '#' + cHor.clone().multiplyScalar(0.55).getHexString());
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.SphereGeometry(620, 24, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false });
  return new THREE.Mesh(geo, mat);
}

export class CityGenerator {
  constructor(assetManager, fractureEngine, effects, audio, scene) {
    this.assets = assetManager;
    this.fracture = fractureEngine;
    this.effects = effects;
    this.audio = audio;
    this.scene = scene;

    this.cityGroup = new THREE.Group();
    this.scene.add(this.cityGroup);

    this.buildings = [];
    this.props = [];
    this.roadX = [];
    this.roadZ = [];
    this.halfExtent = 120;
    this.levelDef = null;

    //Landmark beacon rings
    this.beaconGeo = new THREE.CylinderGeometry(3.8, 3.8, 42, 16, 1, true);
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: 0xff3864,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
  }

  buildCity(levelDef) {
    this.clear();
    this.levelDef = levelDef;

    const grid = levelDef.gridSize;
    const spacing = levelDef.blockSpacing;
    const totalSize = grid * spacing;
    this.halfExtent = totalSize * 0.5;

    // Sky dome
    const sky = createSkyDome(levelDef.skyTop, levelDef.skyHorizon);
    this.cityGroup.add(sky);

    // Ocean / harbor water surrounding the island
    const waterGeo = new THREE.PlaneGeometry(1600, 1600);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: levelDef.theme === 'citadel' ? 0x1e1226 : 0x164a70,
      roughness: 0.25,
      metalness: 0.55
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = -0.55;
    water.receiveShadow = true;
    this.cityGroup.add(water);

    // Island seawall plinth + asphalt road grid
    const islandGeo = new THREE.BoxGeometry(totalSize + 14, 1.2, totalSize + 14);
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x3b404a, roughness: 0.9 });
    const islandBase = new THREE.Mesh(islandGeo, islandMat);
    islandBase.position.y = -0.62;
    islandBase.receiveShadow = true;
    this.cityGroup.add(islandBase);

    const groundTex = createCityGroundTexture(grid, levelDef.theme);
    const groundGeo = new THREE.PlaneGeometry(totalSize, totalSize);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.88,
      metalness: 0.06
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = 0.0;
    ground.receiveShadow = true;
    this.cityGroup.add(ground);

    // Compute road center coordinates
    this.roadX = [];
    this.roadZ = [];
    for (let i = 0; i <= grid; i++) {
      const coord = -this.halfExtent + i * spacing;
      this.roadX.push(coord);
      this.roadZ.push(coord);
    }

    // Player spawn is on the Southern Coastal Avenue (gx = mid, gz = grid - 1 road), facing North (-Z)!
    this.spawnPos = new THREE.Vector3(0, 0, this.halfExtent - spacing * 0.5);

    // Choose landmark block cells in mid/northern half
    const landmarkCells = this.pickLandmarkCells(grid, levelDef.landmarkCount, levelDef.hasBoss);

    let rng = levelDef.id * 98765 + 1337;
    const rand = () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 4294967296;
    };

    for (let gx = 0; gx < grid; gx++) {
      for (let gz = 0; gz < grid; gz++) {
        const cx = -this.halfExtent + (gx + 0.5) * spacing;
        const cz = -this.halfExtent + (gz + 0.5) * spacing;

        // Distance from center (0 = downtown core, 1 = outskirts)
        const normDist = Math.hypot(gx - (grid - 1) * 0.5, gz - (grid - 1) * 0.5) / (grid * 0.65);

        // Keep boss arena plaza slightly open at exact center on OP-04
        if (levelDef.hasBoss && gx === Math.floor(grid / 2) && gz === Math.floor(grid / 2) - 1) {
          this.populateParkProps(cx, cz, spacing, rand, true);
          continue;
        }

        const isLandmarkCell = landmarkCells.some(c => c.gx === gx && c.gz === gz);
        if (isLandmarkCell) {
          this.spawnBuilding(levelDef.landmarkType, cx, cz, 0, true);
          // Guard landmark with explosive barrels & turrets/props
          this.spawnProp('barrel', cx + 6.5, cz + 5.5, rand() * Math.PI, true);
          this.spawnProp('barrel', cx - 6.5, cz + 5.5, rand() * Math.PI, true);
          continue;
        }

        const isPark = ((gx + gz * 3) % 9 === 0) && normDist > 0.28;
        if (isPark) {
          this.populateParkProps(cx, cz, spacing, rand, false);
          continue;
        }

        // Populate 2 to 4 real 3D buildings per city block depending on building tier!
        const pool = this.getBuildingPool(levelDef.theme, normDist, gz >= grid - 2);
        const primaryKey = pool[Math.floor(rand() * pool.length)];
        const primaryDef = MODEL_MANIFEST[primaryKey];

        if (primaryDef.tier >= 4) {
          // Mega-skyscraper commands the block center with plazas/trees on corners!
          this.spawnBuilding(primaryKey, cx + (rand() - 0.5) * 2.2, cz + (rand() - 0.5) * 2.2, Math.floor(rand() * 4) * (Math.PI / 2), false);
          if (rand() < 0.7) this.spawnProp('tree_detailed', cx - 7.2, cz - 7.2, rand() * 6.28, false);
          if (rand() < 0.7) this.spawnProp('light_double', cx + 7.5, cz + 7.5, 0, false);
        } else if (primaryDef.tier === 3) {
          // 2 medium/high-rise buildings side by side
          this.spawnBuilding(primaryKey, cx - 4.6, cz + (rand() - 0.5) * 3, Math.floor(rand() * 4) * (Math.PI / 2), false);
          const secondKey = pool[Math.floor(rand() * pool.length)];
          this.spawnBuilding(secondKey, cx + 5.0, cz + (rand() - 0.5) * 3, Math.floor(rand() * 4) * (Math.PI / 2), false);
        } else {
          // 2x2 cozy suburban / industrial / commercial cluster — SO SATISFYING TO CLEAVE THROUGH!
          const subOffsets = [
            [-4.9, -4.9],
            [4.9, -4.9],
            [-4.9, 4.9],
            [4.9, 4.9]
          ];
          for (let q = 0; q < 4; q++) {
            if (q === 3 && rand() < 0.25) {
              // Occasional explosive hazard tank or barrel cluster!
              if (levelDef.theme === 'industrial' || rand() < 0.45) {
                this.spawnBuilding('ind_tank', cx + subOffsets[q][0], cz + subOffsets[q][1], rand() * Math.PI, false);
              } else {
                this.spawnProp('tree_detailed', cx + subOffsets[q][0], cz + subOffsets[q][1], rand() * 6.28, false);
                this.spawnProp('barrel', cx + subOffsets[q][0] + 2.2, cz + subOffsets[q][1], 0, true);
              }
              continue;
            }
            const bKey = pool[Math.floor(rand() * pool.length)];
            const bDef = MODEL_MANIFEST[bKey];
            // Avoid overlapping if pool picked a wide structure
            if (bDef.tier >= 3 && q > 1) continue;
            this.spawnBuilding(
              bKey,
              cx + subOffsets[q][0] + (rand() - 0.5) * 1.0,
              cz + subOffsets[q][1] + (rand() - 0.5) * 1.0,
              Math.floor(rand() * 4) * (Math.PI / 2),
              false
            );
          }
        }

        // Sidewalk streetlights & traffic lights
        if ((gx + gz) % 2 === 0) {
          this.spawnProp('light_curved', cx - spacing * 0.34, cz - spacing * 0.34, 0, false);
        } else {
          this.spawnProp('traffic_light', cx + spacing * 0.34, cz - spacing * 0.34, Math.PI, false);
        }
        if (rand() < 0.32) {
          this.spawnProp('barrel', cx + spacing * 0.31, cz + spacing * 0.28, 0, true);
        }
      }
    }
  }

  pickLandmarkCells(grid, count, hasBoss) {
    const mid = Math.floor(grid / 2);
    const candidates = [
      { gx: Math.max(1, mid - 2), gz: Math.max(1, mid - 2) },
      { gx: Math.min(grid - 2, mid + 2), gz: Math.max(1, mid - 2) },
      { gx: mid, gz: 1 },
      { gx: Math.max(1, mid - 2), gz: mid + 1 }
    ];
    if (!hasBoss && count === 1) {
      return [{ gx: mid, gz: Math.max(1, mid - 2) }];
    }
    return candidates.slice(0, count);
  }

  getBuildingPool(theme, normDist, nearSpawn) {
    const suburban = ['suburban_f', 'suburban_h', 'suburban_j', 'suburban_l', 'suburban_n', 'suburban_p'];
    const commMid = ['comm_a', 'comm_c', 'comm_f', 'comm_h'];
    const indMid = ['ind_a', 'ind_b', 'ind_e', 'fuel_tank', 'ind_tank'];
    const highRise = ['comm_j', 'comm_l', 'comm_n'];
    const sky = ['sky_a', 'sky_b', 'sky_c', 'sky_d', 'sky_e'];

    // Right in front of spawn, always include crushable Tier 1-2 blocks for instant gratification!
    if (nearSpawn) {
      return theme === 'downtown' || theme === 'citadel'
        ? [...suburban, ...commMid]
        : suburban;
    }

    if (theme === 'suburban') {
      if (normDist < 0.32) return [...commMid, ...highRise];
      if (normDist < 0.62) return [...suburban, ...commMid];
      return suburban;
    }
    if (theme === 'industrial') {
      if (normDist < 0.35) return [...indMid, ...highRise, 'fuel_tank'];
      if (normDist < 0.7) return [...indMid, ...commMid];
      return [...suburban, ...indMid];
    }
    // downtown / citadel
    if (normDist < 0.38) return sky;
    if (normDist < 0.68) return [...highRise, ...sky, ...commMid];
    return [...commMid, ...highRise];
  }

  populateParkProps(cx, cz, spacing, rand, bossArena) {
    const count = bossArena ? 4 : 7;
    for (let i = 0; i < count; i++) {
      const key = i % 2 === 0 ? 'tree_detailed' : 'tree_default';
      const angle = (i / count) * Math.PI * 2 + rand() * 0.4;
      const r = bossArena ? 9 + rand() * 2 : 3 + rand() * (spacing * 0.28);
      this.spawnProp(key, cx + Math.cos(angle) * r, cz + Math.sin(angle) * r, rand() * 6.28, false);
    }
  }

  spawnBuilding(modelKey, x, z, rotY = 0, isObjectiveLandmark = false) {
    const def = MODEL_MANIFEST[modelKey];
    const mesh = this.assets.instantiate(modelKey);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rotY;
    this.cityGroup.add(mesh);

    let beacon = null;
    if (isObjectiveLandmark) {
      beacon = new THREE.Mesh(this.beaconGeo, this.beaconMat);
      beacon.position.set(0, 21, 0);
      mesh.add(beacon);
    }

    const dims = mesh.userData.dims;
    const radius = Math.max(dims.x, dims.z) * 0.46;

    this.buildings.push({
      modelKey,
      mesh,
      dims,
      x,
      z,
      radius,
      tier: def.tier || 1,
      hp: def.hp * (isObjectiveLandmark ? 1.35 : 1.0),
      maxHp: def.hp * (isObjectiveLandmark ? 1.35 : 1.0),
      biomass: def.biomass * (isObjectiveLandmark ? 1.5 : 1.0),
      dna: def.dna * (isObjectiveLandmark ? 1.8 : 1.0),
      score: def.score * (isObjectiveLandmark ? 2.0 : 1.0),
      explosive: Boolean(def.explosive),
      isObjectiveLandmark,
      beacon,
      destroyed: false,
      flashTimer: 0,
      smokeTimer: 0,
      baseRotX: 0,
      baseRotZ: 0
    });
  }

  spawnProp(modelKey, x, z, rotY = 0, explosive = false) {
    const mesh = this.assets.instantiate(modelKey);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = rotY;

    if (explosive) {
      // Hazard ring under explosive barrel so player spots juicy chain-targets!
      const ringGeo = new THREE.RingGeometry(1.1, 1.55, 16);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4422, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.06;
      mesh.add(ring);
    }

    this.cityGroup.add(mesh);
    this.props.push({
      modelKey,
      mesh,
      x,
      z,
      radius: explosive ? 1.7 : 1.3,
      explosive,
      destroyed: false
    });
  }

  // Damage a building; returns collapse payload if destroyed!
  damageBuilding(b, amount, hitDir = { x: 0, z: -1 }, callbacks = {}, chainDepth = 0) {
    if (b.destroyed) return false;

    b.hp -= amount;
    b.flashTimer = 0.12;

    if (b.hp > 0) {
      // Lean & shake building + chip off glass/masonry!
      const dmgRatio = 1 - b.hp / b.maxHp;
      b.baseRotX = hitDir.z * dmgRatio * 0.08;
      b.baseRotZ = -hitDir.x * dmgRatio * 0.08;
      b.mesh.rotation.x = b.baseRotX + (Math.random() - 0.5) * 0.05;
      b.mesh.rotation.z = b.baseRotZ + (Math.random() - 0.5) * 0.05;

      this.fracture.spawnDamageChip(b, hitDir);
      this.effects.spawnDustCloud(new THREE.Vector3(b.x, b.dims.y * 0.45, b.z), 4.5, 4);
      this.audio.play('glassMedium', { volume: 0.45, pitch: 0.9 + Math.random() * 0.25, cooldownMs: 50 });
      this.audio.play('punchHeavy', { volume: 0.55, pitch: 0.85, cooldownMs: 50 });
      return false;
    }

    // === BUILDING COLLAPSES INTO VORONOI PIECES! ===
    b.destroyed = true;
    this.cityGroup.remove(b.mesh);

    const forceMult = b.explosive ? 1.45 : 1.0;
    this.fracture.shatterBuilding(b, hitDir, forceMult);

    const collapsePos = new THREE.Vector3(b.x, Math.min(8, b.dims.y * 0.35), b.z);
    this.effects.spawnDustCloud(new THREE.Vector3(b.x, 1.2, b.z), Math.max(7, b.radius * 1.9), 8 + b.tier * 3);
    this.effects.spawnExplosion(collapsePos, 0.85 + b.tier * 0.32, b.explosive ? 0xff5511 : 0xffaa44, true);
    this.effects.spawnScorch(b.x, b.z, Math.max(4.5, b.radius * 1.15));

    this.audio.playBuildingCollapse(b.tier, 0);
    this.effects.addShake(0.22 + b.tier * 0.14);
    if (b.tier >= 3 || b.explosive) {
      this.effects.triggerHitStop(0.042);
    }

    if (callbacks.onBuildingDestroyed) {
      callbacks.onBuildingDestroyed(b);
    }

    // Explosive Fuel Tank OR Seismic Aftershock / Domino Collapse chain reaction!
    if (chainDepth < 2 && (b.explosive || (callbacks.aftershockDamage && callbacks.aftershockDamage > 0))) {
      const blastRadius = b.explosive ? 22 : 16;
      const blastDmg = (b.explosive ? 145 : 0) + (callbacks.aftershockDamage || 0);
      if (b.explosive) {
        this.effects.spawnExplosion(new THREE.Vector3(b.x, 4, b.z), 2.3, 0xff4411, true);
        this.effects.spawnFloatingText(new THREE.Vector3(b.x, 12, b.z), 'CHAIN BLAST!', '#ff6b35', true);
      }
      for (const other of this.buildings) {
        if (other.destroyed || other === b) continue;
        const d = Math.hypot(other.x - b.x, other.z - b.z);
        if (d < blastRadius + other.radius) {
          const dir = {
            x: (other.x - b.x) / (d || 1),
            z: (other.z - b.z) / (d || 1)
          };
          this.damageBuilding(other, blastDmg, dir, callbacks, chainDepth + 1);
        }
      }
      if (callbacks.onExplosionArea) {
        callbacks.onExplosionArea(b.x, b.z, blastRadius, blastDmg);
      }
    }

    return true;
  }

  crushProp(p, hitDir = { x: 0, z: -1 }, callbacks = {}) {
    if (p.destroyed) return;
    p.destroyed = true;
    this.cityGroup.remove(p.mesh);

    if (p.explosive) {
      this.effects.spawnExplosion(new THREE.Vector3(p.x, 2, p.z), 1.65, 0xff4411, true);
      this.effects.spawnScorch(p.x, p.z, 5.5);
      this.audio.play('explosionCrunch', { volume: 0.75, pitch: 1.05, cooldownMs: 40 });
      this.effects.addShake(0.28);
      // Damage nearby buildings & enemies!
      for (const b of this.buildings) {
        if (b.destroyed) continue;
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < 16 + b.radius) {
          this.damageBuilding(b, 85, { x: (b.x - p.x) / (d || 1), z: (b.z - p.z) / (d || 1) }, callbacks, 1);
        }
      }
      if (callbacks.onExplosionArea) {
        callbacks.onExplosionArea(p.x, p.z, 16, 95);
      }
    } else {
      const piece = this.assets.instantiate('debris_stone');
      piece.scale.setScalar(0.75);
      this.fracture.spawnFragmentObj(
        piece,
        new THREE.Vector3(p.x, 1.5, p.z),
        new THREE.Vector3(hitDir.x * 14 + (Math.random() - 0.5) * 8, 8 + Math.random() * 6, hitDir.z * 14 + (Math.random() - 0.5) * 8),
        new THREE.Vector3(4, 5, 3),
        0.5,
        1.8
      );
      this.audio.play('woodHeavy', { volume: 0.35, pitch: 1.1, cooldownMs: 65 });
    }
  }

  getStats() {
    let total = 0;
    let destroyed = 0;
    let landmarksLeft = 0;
    for (const b of this.buildings) {
      total++;
      if (b.destroyed) destroyed++;
      else if (b.isObjectiveLandmark) landmarksLeft++;
    }
    const pct = total > 0 ? (destroyed / total) * 100 : 0;
    return { total, destroyed, pct, landmarksLeft };
  }

  update(dt) {
    const t = performance.now() * 0.004;
    for (const b of this.buildings) {
      if (b.destroyed) continue;

      if (b.beacon) {
        b.beacon.material.opacity = 0.16 + Math.sin(t * 2.0) * 0.09;
        b.beacon.rotation.y += dt * 1.2;
      }

      // Settle wobble back toward damaged lean
      b.mesh.rotation.x = THREE.MathUtils.lerp(b.mesh.rotation.x, b.baseRotX, 10 * dt);
      b.mesh.rotation.z = THREE.MathUtils.lerp(b.mesh.rotation.z, b.baseRotZ, 10 * dt);

      // Damaged buildings emit rising smoke!
      if (b.hp < b.maxHp * 0.62) {
        b.smokeTimer -= dt;
        if (b.smokeTimer <= 0) {
          b.smokeTimer = 0.45 + Math.random() * 0.35;
          this.effects.spawnDustCloud(
            new THREE.Vector3(
              b.x + (Math.random() - 0.5) * b.dims.x * 0.5,
              b.dims.y * (0.55 + Math.random() * 0.35),
              b.z + (Math.random() - 0.5) * b.dims.z * 0.5
            ),
            3.2,
            1
          );
        }
      }
    }
  }

  clear() {
    while (this.cityGroup.children.length > 0) {
      this.cityGroup.remove(this.cityGroup.children[0]);
    }
    this.buildings.length = 0;
    this.props.length = 0;
  }
}

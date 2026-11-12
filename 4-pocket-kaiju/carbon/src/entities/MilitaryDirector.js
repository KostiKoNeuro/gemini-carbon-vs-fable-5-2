import * as THREE from 'three';

export class MilitaryDirector {
  constructor(assetManager, fracture, effects, audio, scene) {
    this.assets = assetManager;
    this.fracture = fracture;
    this.effects = effects;
    this.audio = audio;
    this.scene = scene;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.tanks = [];
    this.helicopters = [];
    this.turrets = [];
    this.mechs = [];
    this.jets = [];
    this.projectiles = [];
    this.carpetBombs = [];

    this.defcon = 5; // 5 = lowest (Police), 1 = highest (Total War!)
    this.spawnTimer = 2.0;
    this.jetTimer = 14.0;
    this.mechsSpawned = 0;
    this.levelDef = null;
    this.city = null;
  }

  reset(levelDef, city) {
    this.clear();
    this.levelDef = levelDef;
    this.city = city;
    this.defcon = levelDef.id >= 4 ? 2 : levelDef.id >= 3 ? 3 : 5;
    this.spawnTimer = 2.5;
    this.jetTimer = 12.0;
    this.mechsSpawned = 0;

    // Pre-place Defense Turrets near landmarks / intersections on OP-02+
    const turretCount = levelDef.id === 1 ? 2 : Math.min(7, levelDef.id * 2);
    for (let i = 0; i < turretCount; i++) {
      this.spawnTurret();
    }
  }

  // Threat escalates from DEFCON 5 -> DEFCON 1 (shown as 1..5 Threat Stars on HUD!)
  getThreatStars() {
    return 6 - this.defcon; // 1 star at DEFCON 5, 5 stars at DEFCON 1
  }

  updateEscalation(destructionPct, kaijuTier) {
    if (!this.levelDef) return;
    let rawStars = 1;
    if (destructionPct > 10 || kaijuTier >= 2) rawStars = 2;
    if (destructionPct > 24 || kaijuTier >= 3) rawStars = 3;
    if (destructionPct > 40 || kaijuTier >= 4) rawStars = 4;
    if (destructionPct > 55 || kaijuTier >= 5 || this.levelDef.hasBoss) rawStars = 5;

    const clampedStars = Math.min(this.levelDef.maxDefcon, rawStars);
    const nextDefcon = 6 - clampedStars;
    if (nextDefcon < this.defcon) {
      this.defcon = nextDefcon;
      this.audio.play(this.defcon <= 2 ? 'voFireInHole' : 'voBackup', { volume: 0.75, pitch: 1.0, cooldownMs: 2500 });
      return true;
    }
    return false;
  }

  spawnTurret() {
    if (!this.city || this.city.roadX.length < 3) return;
    const rx = this.city.roadX[1 + Math.floor(Math.random() * (this.city.roadX.length - 2))];
    const rz = this.city.roadZ[1 + Math.floor(Math.random() * (this.city.roadZ.length - 2))];
    if (Math.hypot(rx - this.city.spawnPos.x, rz - this.city.spawnPos.z) < 38) return;

    const mesh = this.assets.instantiate('defense_turret');
    mesh.position.set(rx + 4.2, 0, rz + 4.2);

    let headNode = null;
    mesh.traverse(n => {
      if (n.name === 'turret-head' || n.name === 'turret') headNode = n;
    });

    this.group.add(mesh);
    this.turrets.push({
      type: 'turret',
      mesh,
      headNode,
      hp: 65,
      maxHp: 65,
      fireTimer: 1.5 + Math.random() * 1.5,
      radius: 2.6,
      biomass: 16,
      dna: 10,
      score: 300
    });
  }

  spawnTank(kaijuPos) {
    if (!this.city || this.tanks.length >= 9) return;
    const alongX = Math.random() < 0.5;
    const sign = Math.random() < 0.5 ? -1 : 1;
    const edge = (this.city.halfExtent - 4) * sign;
    const roadList = alongX ? this.city.roadZ : this.city.roadX;
    const rCoord = roadList[Math.floor(Math.random() * roadList.length)];

    const x = alongX ? edge : rCoord;
    const z = alongX ? rCoord : edge;
    if (Math.hypot(x - kaijuPos.x, z - kaijuPos.z) < 32) return;

    const mesh = this.assets.instantiate('tank_medium');
    mesh.position.set(x, 0, z);
    mesh.lookAt(kaijuPos.x, 0, kaijuPos.z);

    let turretNode = null;
    mesh.traverse(n => {
      if (n.name === 'turret') turretNode = n;
    });

    this.group.add(mesh);
    this.tanks.push({
      type: 'tank',
      mesh,
      turretNode,
      hp: 95,
      maxHp: 95,
      speed: 7.5,
      fireTimer: 2.2 + Math.random() * 1.5,
      radius: 3.8,
      biomass: 26,
      dna: 16,
      score: 550
    });
  }

  spawnHelicopter(kaijuPos) {
    if (!this.city || this.helicopters.length >= 6) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = this.city.halfExtent + 18;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const alt = 15.5 + Math.random() * 5.5;

    const mesh = this.assets.instantiate('helicopter');
    mesh.position.set(x, alt, z);
    mesh.lookAt(kaijuPos.x, alt, kaijuPos.z);

    let mainRotor = null;
    let tailRotor = null;
    mesh.traverse(n => {
      if (n.name === 'rotor-main') mainRotor = n;
      if (n.name === 'rotor-tail') tailRotor = n;
    });

    this.group.add(mesh);
    this.helicopters.push({
      type: 'heli',
      mesh,
      mainRotor,
      tailRotor,
      hp: 75,
      maxHp: 75,
      orbitAngle: angle,
      orbitSpeed: (Math.random() < 0.5 ? 1 : -1) * (0.42 + Math.random() * 0.25),
      orbitDist: 28 + Math.random() * 14,
      baseAlt: alt,
      fireTimer: 2.4 + Math.random() * 1.4,
      radius: 4.8,
      biomass: 32,
      dna: 22,
      score: 750
    });
  }

  spawnEliteMech(kaijuPos) {
    if (!this.city) return;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.min(this.city.halfExtent - 15, 65);
    const x = THREE.MathUtils.clamp(kaijuPos.x + Math.cos(angle) * r, -this.city.halfExtent + 12, this.city.halfExtent - 12);
    const z = THREE.MathUtils.clamp(kaijuPos.z + Math.sin(angle) * r, -this.city.halfExtent + 12, this.city.halfExtent - 12);

    const mesh = this.assets.instantiate('mech_walker');
    const mechHeight = 14.5; // Vanguard Mech (14.5m tall!)
    mesh.scale.setScalar(mechHeight);
    mesh.position.set(x, 0, z);
    this.group.add(mesh);

    const mixer = new THREE.AnimationMixer(mesh.userData.innerModel);
    const clips = mesh.userData.animations || [];
    const getAction = (name) => {
      const c = clips.find(cl => cl.name === name);
      return c ? mixer.clipAction(c) : null;
    };
    const actions = {
      idle: getAction('Idle'),
      walk: getAction('Walk'),
      attack: getAction('Attack')
    };
    if (actions.walk) actions.walk.play();

    this.effects.spawnShockwave(new THREE.Vector3(x, 0.3, z), 16, 0x38d6ff, 0.5);
    this.effects.spawnFloatingText(new THREE.Vector3(x, 16, z), 'VANGUARD MECH DEPLOYED!', '#38d6ff', true);
    this.audio.play('voGetDown', { volume: 0.75, cooldownMs: 1200 });

    this.mechs.push({
      type: 'mech',
      mesh,
      mixer,
      actions,
      hp: 290,
      maxHp: 290,
      speed: 9.2,
      fireTimer: 1.8,
      radius: 4.8,
      height: mechHeight,
      biomass: 75,
      dna: 55,
      score: 1800
    });
  }

  spawnJetAirstrike(kaijuPos) {
    if (!this.city) return;
    const angle = Math.random() * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const startX = kaijuPos.x - dirX * 190;
    const startZ = kaijuPos.z - dirZ * 190;

    const mesh = this.assets.instantiate('fighter_jet');
    mesh.position.set(startX, 42, startZ);
    mesh.rotation.y = Math.atan2(dirX, dirZ);
    this.group.add(mesh);

    this.audio.play('jetFlyby', { volume: 0.55, pitch: 1.05, cooldownMs: 1500 });

    // Place 3 telegraphed carpet-bomb warning zones along the jet's line!
    for (let k = -1; k <= 1; k++) {
      const bx = kaijuPos.x + dirX * k * 14 + (Math.random() - 0.5) * 6;
      const bz = kaijuPos.z + dirZ * k * 14 + (Math.random() - 0.5) * 6;
      const fuse = 1.55 + (k + 1) * 0.24;
      this.effects.spawnWarningZone(bx, bz, 8.5, fuse);
      this.carpetBombs.push({ x: bx, z: bz, timer: fuse, radius: 8.5, damage: 22 });
    }

    this.jets.push({
      mesh,
      vx: dirX * 125,
      vz: dirZ * 125,
      age: 0
    });
  }

  fireMissile(origin, targetPos, speed = 34, damage = 11, homing = false) {
    const mesh = this.assets.instantiate('missile');
    mesh.scale.setScalar(0.85);
    mesh.position.copy(origin);
    mesh.lookAt(targetPos);
    this.group.add(mesh);

    const dir = new THREE.Vector3().subVectors(targetPos, origin).normalize();
    this.projectiles.push({
      mesh,
      vel: dir.multiplyScalar(speed),
      speed,
      damage,
      homing,
      age: 0,
      life: 4.2
    });
  }

  // Damage enemies inside a sphere or cylinder (from Smash, Beam, Leap, Thrown Car, or Lightning Spines!)
  damageArea(center, radius, damage, callbacks = {}, includeAir = true) {
    let hits = 0;
    const hitList = (arr, isAir = false) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const u = arr[i];
        if (isAir && !includeAir) continue;
        const dx = u.mesh.position.x - center.x;
        const dz = u.mesh.position.z - center.z;
        const dy = isAir ? (u.mesh.position.y - center.y) * 0.55 : 0;
        const d = Math.hypot(dx, dz, dy);
        if (d <= radius + u.radius) {
          u.hp -= damage;
          hits++;
          this.effects.spawnExplosion(u.mesh.position, 0.55, 0xffaa33, false);
          if (u.hp <= 0) {
            this.destroyUnit(arr, i, { x: dx / (d || 1), z: dz / (d || 1) }, callbacks);
          }
        }
      }
    };

    hitList(this.turrets, false);
    hitList(this.tanks, false);
    hitList(this.mechs, false);
    hitList(this.helicopters, true);
    return hits;
  }

  destroyUnit(arr, idx, hitDir, callbacks) {
    const u = arr[idx];
    const pos = u.mesh.position.clone();
    this.group.remove(u.mesh);
    arr.splice(idx, 1);

    this.fracture.shatterVehicle(pos, hitDir, u.type === 'mech' ? 1.8 : 1.2);
    this.effects.spawnExplosion(pos, u.type === 'mech' ? 2.1 : 1.35, 0xff6622, true);
    if (pos.y < 6) this.effects.spawnScorch(pos.x, pos.z, 4.5);

    this.audio.play('explosionCrunch', { volume: 0.78, pitch: u.type === 'mech' ? 0.75 : 1.0, cooldownMs: 40 });
    this.audio.play('metalHeavy', { volume: 0.65, pitch: 0.85, cooldownMs: 40 });
    this.effects.addShake(u.type === 'mech' ? 0.45 : 0.22);

    if (callbacks.onMilitaryDestroyed) {
      callbacks.onMilitaryDestroyed(u, pos);
    }
  }

  // Find nearest enemy within range (for Arc-Lightning Spines mutation or autopilot!)
  findNearestEnemy(pos, maxRange = 32) {
    let best = null;
    let bestD = maxRange;
    for (const list of [this.helicopters, this.tanks, this.turrets, this.mechs]) {
      for (const u of list) {
        const d = u.mesh.position.distanceTo(pos);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
    }
    return best;
  }

  update(dt, kaiju, callbacks = {}) {
    if (!this.city) return;
    const kPos = kaiju.position;
    const kChest = new THREE.Vector3(kPos.x, kPos.y + kaiju.currentHeight * 0.48, kPos.z);
    const stars = this.getThreatStars();
    const trampleR = kaiju.getFootRadius();

    // Periodic military reinforcement waves
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = Math.max(2.3, 6.2 - stars * 0.8);
      if (stars >= 2) this.spawnTank(kPos);
      if (stars >= 3) this.spawnHelicopter(kPos);
      if (stars >= 4 && Math.random() < 0.5) this.spawnTank(kPos);
      if (stars >= 3 && this.mechsSpawned < (this.levelDef?.eliteMechs || 0) && this.mechs.length < 2) {
        this.mechsSpawned++;
        this.spawnEliteMech(kPos);
      }
    }

    // Fighter Jet Airstrikes at 4+ stars!
    if (stars >= 4) {
      this.jetTimer -= dt;
      if (this.jetTimer <= 0) {
        this.jetTimer = stars >= 5 ? 10.5 : 14.5;
        this.spawnJetAirstrike(kPos);
      }
    }

    // Update Defense Turrets
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i];
      const dx = kPos.x - t.mesh.position.x;
      const dz = kPos.z - t.mesh.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < trampleR + t.radius && kaiju.jumpHeight < 4.5) {
        this.destroyUnit(this.turrets, i, { x: -dx / (dist || 1), z: -dz / (dist || 1) }, callbacks);
        continue;
      }

      if (t.headNode) {
        t.headNode.rotation.y = Math.atan2(dx, dz) - t.mesh.rotation.y;
      } else {
        t.mesh.rotation.y = Math.atan2(dx, dz);
      }

      if (dist < 62) {
        t.fireTimer -= dt;
        if (t.fireTimer <= 0) {
          t.fireTimer = 2.3;
          const muzzle = t.mesh.position.clone().add(new THREE.Vector3(0, 3.2, 0));
          this.fireMissile(muzzle, kChest, 38, 6, false);
          this.audio.play('laserSmall', { volume: 0.35, pitch: 0.9, cooldownMs: 90 });
        }
      }
    }

    // Update Medium Tanks
    for (let i = this.tanks.length - 1; i >= 0; i--) {
      const tk = this.tanks[i];
      const dx = kPos.x - tk.mesh.position.x;
      const dz = kPos.z - tk.mesh.position.z;
      const dist = Math.hypot(dx, dz);

      // Giant Kaiju (Tier 3+) tramples right over tanks!!
      if (dist < trampleR + tk.radius * 0.85 && kaiju.sizeClass.tier >= 2 && kaiju.jumpHeight < 5) {
        this.destroyUnit(this.tanks, i, { x: -dx / (dist || 1), z: -dz / (dist || 1) }, callbacks);
        continue;
      }

      const targetYaw = Math.atan2(dx, dz);
      if (dist > 30) {
        tk.mesh.rotation.y = THREE.MathUtils.lerp(tk.mesh.rotation.y, targetYaw, 3.5 * dt);
        tk.mesh.position.x += Math.sin(tk.mesh.rotation.y) * tk.speed * dt;
        tk.mesh.position.z += Math.cos(tk.mesh.rotation.y) * tk.speed * dt;
      }

      if (tk.turretNode) {
        tk.turretNode.rotation.y = targetYaw - tk.mesh.rotation.y;
      }

      if (dist < 68) {
        tk.fireTimer -= dt;
        if (tk.fireTimer <= 0) {
          tk.fireTimer = 2.8 + Math.random() * 0.8;
          const muzzle = tk.mesh.position.clone().add(new THREE.Vector3(Math.sin(targetYaw) * 3.5, 2.4, Math.cos(targetYaw) * 3.5));
          this.effects.spawnExplosion(muzzle, 0.45, 0xffcc44, false);
          this.fireMissile(muzzle, kChest, 42, 10, false);
          this.audio.play('plateHeavy', { volume: 0.42, pitch: 0.8, cooldownMs: 90 });
        }
      }
    }

    // Update Attack Helicopters (spinning main & tail rotors!)
    for (let i = this.helicopters.length - 1; i >= 0; i--) {
      const h = this.helicopters[i];
      if (h.mainRotor) h.mainRotor.rotation.y += 26 * dt;
      if (h.tailRotor) h.tailRotor.rotation.x += 32 * dt;

      h.orbitAngle += h.orbitSpeed * dt;
      const desiredX = kPos.x + Math.cos(h.orbitAngle) * h.orbitDist;
      const desiredZ = kPos.z + Math.sin(h.orbitAngle) * h.orbitDist;
      const desiredY = Math.max(h.baseAlt, kaiju.currentHeight * 0.62 + 6);

      h.mesh.position.x = THREE.MathUtils.lerp(h.mesh.position.x, desiredX, 1.8 * dt);
      h.mesh.position.z = THREE.MathUtils.lerp(h.mesh.position.z, desiredZ, 1.8 * dt);
      h.mesh.position.y = THREE.MathUtils.lerp(h.mesh.position.y, desiredY + Math.sin(performance.now() * 0.004 + i) * 1.1, 2.5 * dt);
      h.mesh.lookAt(kPos.x, h.mesh.position.y - 2, kPos.z);

      // Swatted if Kaiju leaps into helicopter or grows tall enough to body-check it!
      const dist3d = h.mesh.position.distanceTo(kChest);
      if (dist3d < trampleR + 4.5 && (kaiju.jumpHeight > 4 || kaiju.currentHeight > h.mesh.position.y)) {
        this.destroyUnit(this.helicopters, i, { x: 0, z: 1 }, callbacks);
        continue;
      }

      h.fireTimer -= dt;
      if (h.fireTimer <= 0 && dist3d < 85) {
        h.fireTimer = 3.2 + Math.random() * 1.0;
        this.fireMissile(h.mesh.position.clone().add(new THREE.Vector3(0, -1.2, 0)), kChest, 31, 12, true);
        this.audio.play('laserSmall', { volume: 0.42, pitch: 0.7, cooldownMs: 90 });
      }
    }

    // Update Vanguard Walker Mechs
    for (let i = this.mechs.length - 1; i >= 0; i--) {
      const m = this.mechs[i];
      m.mixer.update(dt);
      const dx = kPos.x - m.mesh.position.x;
      const dz = kPos.z - m.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      m.mesh.rotation.y = yaw;

      if (dist > 16) {
        m.mesh.position.x += Math.sin(yaw) * m.speed * dt;
        m.mesh.position.z += Math.cos(yaw) * m.speed * dt;
      }

      m.fireTimer -= dt;
      if (m.fireTimer <= 0 && dist < 68) {
        m.fireTimer = 2.4;
        if (m.actions.attack) {
          m.actions.attack.reset().setLoop(THREE.LoopOnce, 1).play();
        }
        const chestOrigin = m.mesh.position.clone().add(new THREE.Vector3(0, m.height * 0.68, 0));
        this.fireMissile(chestOrigin, kChest, 38, 16, true);
        this.audio.play('laserLarge', { volume: 0.48, pitch: 1.15, cooldownMs: 120 });
      }
    }

    // Update Fighter Jets
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.age += dt;
      j.mesh.position.x += j.vx * dt;
      j.mesh.position.z += j.vz * dt;
      if (j.age > 3.6) {
        this.group.remove(j.mesh);
        this.jets.splice(i, 1);
      }
    }

    // Update Carpet Bombs
    for (let i = this.carpetBombs.length - 1; i >= 0; i--) {
      const cb = this.carpetBombs[i];
      cb.timer -= dt;
      if (cb.timer <= 0) {
        const pos = new THREE.Vector3(cb.x, 1.0, cb.z);
        this.effects.spawnExplosion(pos, 1.9, 0xff3322, true);
        this.effects.spawnScorch(cb.x, cb.z, 6.5);
        this.audio.play('explosionCrunch', { volume: 0.72, pitch: 0.85, cooldownMs: 45 });
        this.effects.addShake(0.32);

        const dKaiju = Math.hypot(kPos.x - cb.x, kPos.z - cb.z);
        if (dKaiju < cb.radius + trampleR * 0.7) {
          kaiju.takeDamage(cb.damage);
        }
        // Bombs also collateral-damage city buildings! (So fun when army bombs its own skyscrapers!)
        for (const b of this.city.buildings) {
          if (!b.destroyed && Math.hypot(b.x - cb.x, b.z - cb.z) < cb.radius + b.radius) {
            this.city.damageBuilding(b, 55, { x: 0, z: 1 }, callbacks);
          }
        }
        this.carpetBombs.splice(i, 1);
      }
    }

    // Update Enemy Projectiles / Missiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.homing && p.age < 1.8) {
        const desired = new THREE.Vector3().subVectors(kChest, p.mesh.position).normalize().multiplyScalar(p.speed);
        p.vel.lerp(desired, 2.8 * dt);
        p.mesh.lookAt(p.mesh.position.clone().add(p.vel));
      }

      p.mesh.position.addScaledVector(p.vel, dt);
      if (Math.random() < 0.35) {
        this.effects.spawnDustCloud(p.mesh.position, 1.2, 1);
      }

      const distK = p.mesh.position.distanceTo(kChest);
      if (distK < trampleR + 2.8) {
        kaiju.takeDamage(p.damage);
        this.effects.spawnExplosion(p.mesh.position, 0.75, 0xff6622, false);
        this.audio.play('metalHeavy', { volume: 0.45, pitch: 1.1, cooldownMs: 55 });
        this.group.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.age >= p.life || p.mesh.position.y <= 0.3) {
        this.effects.spawnExplosion(p.mesh.position, 0.65, 0xff6622, false);
        this.group.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  clear() {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.tanks.length = 0;
    this.helicopters.length = 0;
    this.turrets.length = 0;
    this.mechs.length = 0;
    this.jets.length = 0;
    this.projectiles.length = 0;
    this.carpetBombs.length = 0;
  }
}

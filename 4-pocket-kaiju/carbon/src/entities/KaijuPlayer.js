import * as THREE from 'three';
import { KAIJU_ROSTER, SIZE_CLASSES } from '../data/gameConfig.js';

export class KaijuPlayer {
  constructor(assetManager, fracture, effects, audio, saveSystem, scene) {
    this.assets = assetManager;
    this.fracture = fracture;
    this.effects = effects;
    this.audio = audio;
    this.save = saveSystem;
    this.scene = scene;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.kaijuDef = KAIJU_ROSTER[0];
    this.mesh = null;
    this.mixer = null;
    this.actions = {};
    this.currentAnim = 'idle';
    this.emitterBone = null;
    this.dorsalSpines = [];

    this.position = new THREE.Vector3();
    this.facingYaw = Math.PI; // Facing North (-Z)
    this.jumpHeight = 0;

    // Stats & Progression
    this.biomass = 0;
    this.sizeClass = SIZE_CLASSES[0];
    this.currentHeight = SIZE_CLASSES[0].heightMeters;
    this.targetHeight = SIZE_CLASSES[0].heightMeters;

    this.maxHp = 220;
    this.hp = 220;
    this.energy = 100;
    this.maxEnergy = 100;
    this.ultCharge = 0; // 0..100
    this.berserkTimer = 0;

    // Cooldowns & active move states
    this.attackCooldown = 0;
    this.attackLockedTimer = 0;
    this.leapCooldown = 0;
    this.isLeaping = false;
    this.leapTimer = 0;
    this.leapDuration = 0.78;
    this.leapStart = new THREE.Vector3();
    this.leapEnd = new THREE.Vector3();

    this.secondaryCooldown = 0;
    this.projectiles = []; // Kong hurled boulders & Scorpio plasma mortars
    this.footstepTimer = 0;
    this.thornsTimer = 1.4;
    this.invulnTimer = 0;

    // Active mid-run mutations
    this.mutations = new Set();
  }

  spawn(kaijuId, spawnPos, startBiomass = 0) {
    this.clear();
    this.kaijuDef = KAIJU_ROSTER.find(k => k.id === kaijuId) || KAIJU_ROSTER[0];
    this.mutations.clear();

    this.position.copy(spawnPos);
    this.facingYaw = Math.PI; // Face North (-Z) straight into the city!
    this.jumpHeight = 0;
    this.isLeaping = false;

    this.biomass = startBiomass;
    this.sizeClass = this.computeSizeClass(this.biomass);
    this.targetHeight = this.computeExactHeight(this.biomass);
    this.currentHeight = this.targetHeight;

    // Apply Lab Upgrades!
    const carapaceRank = this.save.getUpgradeRank('carapace');
    this.maxHp = Math.round(230 * this.kaijuDef.stats.armor * (1 + carapaceRank * 0.25));
    this.hp = this.maxHp;
    this.maxEnergy = 100;
    this.energy = 100;
    this.ultCharge = 25; // start with 25% charge so player reaches first Ultimate quickly!
    this.berserkTimer = 0;
    this.invulnTimer = 1.0;

    // Instantiate rigged 3D Kaiju model from Patch!
    this.mesh = this.assets.instantiate(this.kaijuDef.modelKey);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.facingYaw;
    this.mesh.scale.setScalar(this.currentHeight);
    this.group.add(this.mesh);

    // Attach glowing bio-atomic dorsal spines & locate mouth/stinger emitter bone!
    this.attachKaijuAccents();

    // Setup AnimationMixer
    this.mixer = new THREE.AnimationMixer(this.mesh.userData.innerModel);
    const clips = this.mesh.userData.animations || [];
    const findC = (name) => clips.find(c => c.name === name);

    for (const [slot, clipName] of Object.entries(this.kaijuDef.clips)) {
      const c = findC(clipName) || clips[0];
      if (c) this.actions[slot] = this.mixer.clipAction(c);
    }

    this.currentAnim = '';
    this.playAnim('idle', false, 1.0);
  }

  attachKaijuAccents() {
    this.dorsalSpines = [];
    this.emitterBone = null;

    const spineGeo = new THREE.ConeGeometry(0.11, 0.42, 5);
    const spineMat = new THREE.MeshStandardMaterial({
      color: this.kaijuDef.glowHex,
      emissive: this.kaijuDef.glowHex,
      emissiveIntensity: 1.4,
      roughness: 0.2
    });

    const spineTargets = this.kaijuDef.id === 'rex'
      ? ['spine1', 'tail1', 'tail2', 'tail3']
      : this.kaijuDef.id === 'ape'
        ? ['chest', 'upperarm_L', 'upperarm_R']
        : ['tail3', 'tail4', 'tail5', 'stinger'];

    const emitterName = this.kaijuDef.id === 'rex'
      ? 'jaw'
      : this.kaijuDef.id === 'scorpion'
        ? 'stinger'
        : 'chest';

    this.mesh.userData.innerModel.traverse((node) => {
      if (node.name === emitterName) {
        this.emitterBone = node;
      }
      if (spineTargets.includes(node.name)) {
        const crystal = new THREE.Mesh(spineGeo, spineMat);
        crystal.position.set(0, 0.22, -0.08);
        crystal.rotation.x = -0.35;
        node.add(crystal);
        this.dorsalSpines.push(crystal);
      }
    });

    // Subtle ground aura ring beneath Kaiju so foot radius & power are always super readable!
    const auraGeo = new THREE.RingGeometry(0.34, 0.42, 32);
    auraGeo.rotateX(-Math.PI / 2);
    const auraMat = new THREE.MeshBasicMaterial({
      color: this.kaijuDef.glowHex,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.auraRing = new THREE.Mesh(auraGeo, auraMat);
    this.auraRing.position.y = 0.04;
    this.mesh.add(this.auraRing);
  }

  playAnim(slot, loopOnce = false, speed = 1.0) {
    const next = this.actions[slot];
    if (!next) return;
    if (this.currentAnim === slot && !loopOnce) {
      next.timeScale = speed;
      return;
    }
    const prev = this.actions[this.currentAnim];
    next.reset();
    next.timeScale = speed;
    if (loopOnce) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = false;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.play();
    if (prev && prev !== next) {
      prev.crossFadeTo(next, 0.16, false);
    }
    this.currentAnim = slot;
  }

  computeSizeClass(bio) {
    let chosen = SIZE_CLASSES[0];
    for (const sc of SIZE_CLASSES) {
      if (bio >= sc.minBiomass) chosen = sc;
    }
    return chosen;
  }

  computeExactHeight(bio) {
    for (let i = 0; i < SIZE_CLASSES.length - 1; i++) {
      const cur = SIZE_CLASSES[i];
      const nxt = SIZE_CLASSES[i + 1];
      if (bio >= cur.minBiomass && bio < nxt.minBiomass) {
        const t = (bio - cur.minBiomass) / (nxt.minBiomass - cur.minBiomass);
        return THREE.MathUtils.lerp(cur.heightMeters, nxt.heightMeters, t);
      }
    }
    const last = SIZE_CLASSES[SIZE_CLASSES.length - 1];
    const extra = Math.max(0, bio - last.minBiomass);
    return Math.min(50.0, last.heightMeters + extra * 0.012);
  }

  getFootRadius() {
    return this.currentHeight * 0.34;
  }

  getSmashDamage() {
    const muscleRank = this.save.getUpgradeRank('muscle');
    const sizeScale = 1 + (this.currentHeight - 7.4) * 0.052;
    const berserkMult = this.berserkTimer > 0 ? 1.55 : 1.0;
    return 68 * this.kaijuDef.stats.power * (1 + muscleRank * 0.20) * sizeScale * berserkMult;
  }

  getSpecialDamagePerSec() {
    const coreRank = this.save.getUpgradeRank('atomicCore');
    const sizeScale = 1 + (this.currentHeight - 7.4) * 0.045;
    const mutMult = this.mutations.has('plasma_overcharge') ? 1.4 : 1.0;
    return 195 * this.kaijuDef.stats.beamPower * (1 + coreRank * 0.25) * sizeScale * mutMult;
  }

  getMagnetRadius() {
    const magRank = this.save.getUpgradeRank('magnet');
    return (16 + this.currentHeight * 0.65) * (1 + magRank * 0.45);
  }

  addBiomass(rawBio, onTierUp) {
    const metaRank = this.save.getUpgradeRank('metabolism');
    const mutMult = this.mutations.has('feast_frenzy') ? 1.35 : 1.0;
    const gained = rawBio * (1 + metaRank * 0.22) * mutMult;

    const oldTier = this.sizeClass.tier;
    this.biomass += gained;
    this.sizeClass = this.computeSizeClass(this.biomass);
    this.targetHeight = this.computeExactHeight(this.biomass);

    const ultMult = this.mutations.has('meltdown_charge') ? 1.65 : 1.0;
    this.ultCharge = Math.min(100, this.ultCharge + rawBio * 0.32 * ultMult);

    if (this.sizeClass.tier > oldTier) {
      // EVOLUTION BURST!!
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.30);
      this.energy = this.maxEnergy;
      this.effects.spawnShockwave(this.position, this.targetHeight * 1.4, this.kaijuDef.glowHex, 0.65);
      this.effects.spawnExplosion(this.position.clone().add(new THREE.Vector3(0, this.currentHeight * 0.5, 0)), 2.2, this.kaijuDef.glowHex, false);
      this.effects.addShake(0.65);
      this.audio.play('evolveZap', { volume: 0.85, pitch: 0.95 });
      this.playAnim('roar', true, 1.0);
      this.attackLockedTimer = 0.65;

      if (this.save.data.stats.maxTierReached < this.sizeClass.tier) {
        this.save.data.stats.maxTierReached = this.sizeClass.tier;
        this.save.checkAchievements();
      }
      if (onTierUp) onTierUp(this.sizeClass);
    }
  }

  applyMutation(mutId) {
    this.mutations.add(mutId);
    if (mutId === 'feast_frenzy') {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25);
    } else if (mutId === 'juggernaut_hide') {
      this.maxHp = Math.round(this.maxHp * 1.45);
      this.hp = this.maxHp;
    }
    this.audio.play('powerUp', { volume: 0.85, pitch: 1.0 });
  }

  healFromSiphon(baseHeal = 3.5) {
    const rank = this.save.getUpgradeRank('siphon');
    if (rank <= 0) return;
    this.hp = Math.min(this.maxHp, this.hp + baseHeal * rank);
  }

  takeDamage(rawAmount) {
    if (this.invulnTimer > 0 || this.hp <= 0) return;
    const carapaceRank = this.save.getUpgradeRank('carapace');
    const resist = Math.min(0.62, carapaceRank * 0.07 + (this.mutations.has('juggernaut_hide') ? 0.20 : 0) + (this.berserkTimer > 0 ? 0.25 : 0));
    const dmg = Math.max(1, rawAmount * (1 - resist));
    this.hp = Math.max(0, this.hp - dmg);
    this.effects.addShake(0.14);
  }

  getEmitterWorldPos() {
    const out = new THREE.Vector3();
    if (this.emitterBone) {
      this.emitterBone.updateWorldMatrix(true, false);
      this.emitterBone.getWorldPosition(out);
      return out;
    }
    return this.position.clone().add(new THREE.Vector3(0, this.currentHeight * 0.68, 0));
  }

  // === 1. PRIMARY SMASH / CLEAVE (LMB or Space) ===
  triggerPrimarySmash(aimPoint, city, traffic, military, boss, callbacks) {
    if (this.attackCooldown > 0 || this.isLeaping) return false;
    this.attackCooldown = this.berserkTimer > 0 ? 0.30 : 0.44;
    this.attackLockedTimer = 0.36;

    if (aimPoint) {
      this.facingYaw = Math.atan2(aimPoint.x - this.position.x, aimPoint.z - this.position.z);
      this.mesh.rotation.y = this.facingYaw;
    }

    this.playAnim('attack', true, this.berserkTimer > 0 ? 1.55 : 1.25);
    this.audio.play('punchHeavy', { volume: 0.8, pitch: Math.max(0.55, 1.05 - this.sizeClass.tier * 0.09), cooldownMs: 40 });

    const reach = this.getFootRadius() + 5.2 + this.currentHeight * 0.22;
    const cleaveRadius = (this.kaijuDef.id === 'ape' ? 9.5 : 7.8) + this.currentHeight * 0.26;
    const dirX = Math.sin(this.facingYaw);
    const dirZ = Math.cos(this.facingYaw);

    // Lunge forward slightly for tactile weight!
    this.position.x += dirX * 2.4;
    this.position.z += dirZ * 2.4;

    const hitCenter = new THREE.Vector3(
      this.position.x + dirX * (reach * 0.58),
      0.4,
      this.position.z + dirZ * (reach * 0.58)
    );

    this.effects.spawnShockwave(hitCenter, cleaveRadius * 1.15, this.kaijuDef.glowHex, 0.32);
    this.effects.spawnDustCloud(hitCenter, cleaveRadius * 0.7, 6);
    this.effects.addShake(0.18 + this.sizeClass.tier * 0.04);
    traffic.triggerPanicWave(hitCenter, 65);

    const dmg = this.getSmashDamage();

    // Smash buildings in cleave zone
    for (const b of city.buildings) {
      if (b.destroyed) continue;
      const d = Math.hypot(b.x - hitCenter.x, b.z - hitCenter.z);
      if (d <= cleaveRadius + b.radius) {
        city.damageBuilding(b, dmg, { x: dirX, z: dirZ }, callbacks);
      }
    }
    // Smash props
    for (const p of city.props) {
      if (!p.destroyed && Math.hypot(p.x - hitCenter.x, p.z - hitCenter.z) <= cleaveRadius + p.radius) {
        city.crushProp(p, { x: dirX, z: dirZ }, callbacks);
      }
    }
    // Launch nearby vehicles like bowling pins!
    const kickMult = this.mutations.has('kick_master') ? 1.8 : 1.0;
    for (const v of traffic.vehicles) {
      if (!v.destroyed && !v.launched && Math.hypot(v.mesh.position.x - hitCenter.x, v.mesh.position.z - hitCenter.z) <= cleaveRadius + 3.5) {
        traffic.launchVehicle(v, dirX + (Math.random() - 0.5) * 0.25, dirZ + (Math.random() - 0.5) * 0.25, kickMult, dmg * 1.15);
        this.save.data.stats.carsLaunched++;
        this.save.checkAchievements();
      }
    }
    // Damage military units & helicopters (if tall or Kong/Rex uppercut!)
    military.damageArea(hitCenter.clone().setY(this.currentHeight * 0.55), cleaveRadius + 2.0, dmg * 1.15, callbacks, true);

    // Damage Final Boss if in cleave!
    if (boss && boss.active && !boss.dead && boss.mesh) {
      const db = Math.hypot(boss.mesh.position.x - hitCenter.x, boss.mesh.position.z - hitCenter.z);
      if (db <= cleaveRadius + 7.5) {
        boss.takeDamage(dmg, city, null, callbacks.onBossDefeated);
        this.effects.triggerHitStop(0.035);
      }
    }

    return true;
  }

  // === 2. DIRECT VEHICLE RAILGUN KICK (Key F) ===
  triggerVehicleKick(aimPoint, traffic, military) {
    let bestCar = null;
    let bestD = this.getFootRadius() + 14;
    for (const v of traffic.vehicles) {
      if (v.destroyed || v.launched) continue;
      const d = Math.hypot(v.mesh.position.x - this.position.x, v.mesh.position.z - this.position.z);
      if (d < bestD) {
        bestD = d;
        bestCar = v;
      }
    }
    if (!bestCar) return false;

    const tx = aimPoint ? aimPoint.x : this.position.x + Math.sin(this.facingYaw) * 40;
    const tz = aimPoint ? aimPoint.z : this.position.z + Math.cos(this.facingYaw) * 40;
    const dx = tx - bestCar.mesh.position.x;
    const dz = tz - bestCar.mesh.position.z;
    const len = Math.hypot(dx, dz) || 1;

    const kickMult = this.mutations.has('kick_master') ? 1.9 : 1.25;
    traffic.launchVehicle(bestCar, dx / len, dz / len, kickMult, this.getSmashDamage() * 1.5);
    this.save.data.stats.carsLaunched++;
    this.save.checkAchievements();
    this.playAnim('attack', true, 1.4);
    return true;
  }

  // === 3. SEISMIC LEAP-SLAM (Shift) ===
  triggerLeapSlam(aimPoint, city) {
    if (this.leapCooldown > 0 || this.isLeaping) return false;
    const strideRank = this.save.getUpgradeRank('stride');
    this.leapCooldown = Math.max(1.8, 3.8 * Math.pow(0.88, strideRank));
    this.isLeaping = true;
    this.leapTimer = 0;
    this.leapDuration = 0.72;
    this.leapStart.copy(this.position);

    const maxLeapDist = 28 + this.currentHeight * 0.65;
    if (aimPoint) {
      const dx = aimPoint.x - this.position.x;
      const dz = aimPoint.z - this.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const clamped = Math.min(maxLeapDist, Math.max(10, d));
      this.leapEnd.set(
        THREE.MathUtils.clamp(this.position.x + (dx / d) * clamped, -city.halfExtent + 6, city.halfExtent - 6),
        0,
        THREE.MathUtils.clamp(this.position.z + (dz / d) * clamped, -city.halfExtent + 6, city.halfExtent - 6)
      );
      this.facingYaw = Math.atan2(dx, dz);
      this.mesh.rotation.y = this.facingYaw;
    } else {
      this.leapEnd.set(
        THREE.MathUtils.clamp(this.position.x + Math.sin(this.facingYaw) * 26, -city.halfExtent + 6, city.halfExtent - 6),
        0,
        THREE.MathUtils.clamp(this.position.z + Math.cos(this.facingYaw) * 26, -city.halfExtent + 6, city.halfExtent - 6)
      );
    }

    this.playAnim('jump', true, 1.1);
    this.audio.play('phaserUp', { volume: 0.6, pitch: 0.75 });
    return true;
  }

  // === 4. CATACLYSM ULTIMATE (Key R) ===
  triggerUltimate(city, traffic, military, boss, callbacks) {
    if (this.ultCharge < 100) return false;
    this.ultCharge = 0;

    this.playAnim('roar', true, 0.95);
    this.attackLockedTimer = 0.85;
    this.invulnTimer = 1.5;

    const radMult = this.mutations.has('meltdown_charge') ? 1.5 : 1.0;
    const radius = (32 + this.currentHeight * 0.95) * radMult;
    const dmg = this.getSmashDamage() * 3.4;

    if (this.kaijuDef.id === 'ape') {
      this.berserkTimer = 9.0;
      this.effects.spawnFloatingText(this.position.clone().add(new THREE.Vector3(0, this.currentHeight, 0)), 'PRIMAL BERSERK OVERDRIVE!!', '#ff9d2e', true);
    } else if (this.kaijuDef.id === 'scorpion') {
      this.effects.spawnFloatingText(this.position.clone().add(new THREE.Vector3(0, this.currentHeight, 0)), 'BIO-ACID CATACLYSM!!', '#c84bff', true);
    } else {
      this.effects.spawnFloatingText(this.position.clone().add(new THREE.Vector3(0, this.currentHeight, 0)), 'THERMONUCLEAR MELTDOWN!!', '#39ff88', true);
    }

    this.effects.spawnShockwave(this.position, radius, this.kaijuDef.glowHex, 0.75);
    this.effects.spawnExplosion(this.position.clone().add(new THREE.Vector3(0, this.currentHeight * 0.45, 0)), 3.5, this.kaijuDef.glowHex, false);
    this.effects.triggerHitStop(0.075);
    this.effects.addShake(1.05);
    this.audio.play('explosionLow', { volume: 1.0, pitch: 0.55, cooldownMs: 10 });
    this.audio.play('evolveZap', { volume: 0.9, pitch: 0.7, cooldownMs: 10 });

    for (const b of city.buildings) {
      if (b.destroyed) continue;
      const d = Math.hypot(b.x - this.position.x, b.z - this.position.z);
      if (d <= radius + b.radius) {
        city.damageBuilding(b, dmg, { x: (b.x - this.position.x) / (d || 1), z: (b.z - this.position.z) / (d || 1) }, callbacks);
      }
    }
    for (const v of traffic.vehicles) {
      if (!v.destroyed && Math.hypot(v.mesh.position.x - this.position.x, v.mesh.position.z - this.position.z) <= radius) {
        const dx = v.mesh.position.x - this.position.x;
        const dz = v.mesh.position.z - this.position.z;
        const l = Math.hypot(dx, dz) || 1;
        traffic.launchVehicle(v, dx / l, dz / l, 1.5, dmg * 0.6);
      }
    }
    military.damageArea(this.position.clone().setY(12), radius, dmg, callbacks, true);
    if (boss && boss.active && !boss.dead && boss.mesh) {
      if (Math.hypot(boss.mesh.position.x - this.position.x, boss.mesh.position.z - this.position.z) <= radius + 10) {
        boss.takeDamage(dmg * 0.85, city, null, callbacks.onBossDefeated);
      }
    }

    return true;
  }

  // === 5. SECONDARY SPECIAL WEAPON (Hold RMB or E) ===
  handleSecondarySpecial(dt, firing, aimPoint, city, military, boss, callbacks) {
    const coreRank = this.save.getUpgradeRank('atomicCore');
    const regenRate = 20 * (1 + coreRank * 0.20);

    if (!firing || this.isLeaping || this.energy <= 1) {
      this.effects.updateBeam(false);
      this.audio.setBeamActive(false);
      this.energy = Math.min(this.maxEnergy, this.energy + regenRate * dt);
      return;
    }

    // Face toward cursor!
    let target = aimPoint ? aimPoint.clone() : new THREE.Vector3(
      this.position.x + Math.sin(this.facingYaw) * 55,
      2,
      this.position.z + Math.cos(this.facingYaw) * 55
    );

    // Smart soft-assist toward nearby helicopters or Boss so air targets feel amazing to hit!
    for (const h of military.helicopters) {
      const dh = Math.hypot(h.mesh.position.x - target.x, h.mesh.position.z - target.z);
      if (dh < 13) {
        target.copy(h.mesh.position);
        break;
      }
    }
    if (boss && boss.active && !boss.dead && boss.mesh) {
      const db = Math.hypot(boss.mesh.position.x - target.x, boss.mesh.position.z - target.z);
      if (db < 14) {
        target.copy(boss.mesh.position).add(new THREE.Vector3(0, boss.height * 0.58, 0));
      }
    }

    this.facingYaw = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    this.mesh.rotation.y = this.facingYaw;

    const origin = this.getEmitterWorldPos();

    if (this.kaijuDef.id === 'rex') {
      // CONTINUOUS ATOMIC PLASMA BREATH!
      this.energy = Math.max(0, this.energy - 26 * dt);
      const maxRange = 68 + this.currentHeight * 0.9;
      const dir = new THREE.Vector3().subVectors(target, origin);
      if (dir.length() > maxRange) {
        dir.normalize().multiplyScalar(maxRange);
      }
      const endPt = origin.clone().add(dir);
      const widthMult = (1 + (this.sizeClass.tier - 1) * 0.18) * (this.mutations.has('plasma_overcharge') ? 1.35 : 1.0);

      this.effects.updateBeam(true, origin, endPt, this.kaijuDef.beamColor, widthMult);
      this.audio.setBeamActive(true, 1.0);
      this.effects.addShake(0.05);

      const dps = this.getSpecialDamagePerSec() * dt;
      const beamLine = new THREE.Line3(
        new THREE.Vector3(origin.x, 0, origin.z),
        new THREE.Vector3(endPt.x, 0, endPt.z)
      );
      const closest = new THREE.Vector3();
      const beamHitRadius = 4.6 * widthMult;

      for (const b of city.buildings) {
        if (b.destroyed) continue;
        beamLine.closestPointToPoint(new THREE.Vector3(b.x, 0, b.z), true, closest);
        if (closest.distanceTo(new THREE.Vector3(b.x, 0, b.z)) <= beamHitRadius + b.radius) {
          city.damageBuilding(b, dps, { x: Math.sin(this.facingYaw), z: Math.cos(this.facingYaw) }, callbacks);
        }
      }
      military.damageArea(endPt, 8.5 * widthMult, dps * 1.4, callbacks, true);
      if (boss && boss.active && !boss.dead && boss.mesh) {
        beamLine.closestPointToPoint(new THREE.Vector3(boss.mesh.position.x, 0, boss.mesh.position.z), true, closest);
        if (closest.distanceTo(new THREE.Vector3(boss.mesh.position.x, 0, boss.mesh.position.z)) <= beamHitRadius + 6.5) {
          boss.takeDamage(dps * 1.15, city, null, callbacks.onBossDefeated);
        }
      }
    } else {
      // KONG-X BOULDER HURL OR SCORPIO-9 VENOM PLASMA VOLLEY!
      this.effects.updateBeam(false);
      this.audio.setBeamActive(false);

      if (this.secondaryCooldown <= 0 && this.energy >= 16) {
        const isKong = this.kaijuDef.id === 'ape';
        this.secondaryCooldown = isKong ? 0.52 : 0.28;
        this.energy = Math.max(0, this.energy - (isKong ? 20 : 12));
        this.playAnim('attack', true, 1.35);

        const projMesh = this.assets.instantiate(isKong ? 'rubble_chunk' : 'debris_stone');
        const pScale = (isKong ? 2.4 : 1.5) * (1 + (this.sizeClass.tier - 1) * 0.22);
        projMesh.scale.setScalar(pScale);
        projMesh.position.copy(origin);

        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.effects.orbTex,
          color: this.kaijuDef.beamColor,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        }));
        glow.scale.setScalar(3.5);
        projMesh.add(glow);
        this.group.add(projMesh);

        const flightDir = new THREE.Vector3().subVectors(target, origin).normalize();
        const spd = isKong ? 64 : 56;
        this.projectiles.push({
          mesh: projMesh,
          vel: flightDir.multiplyScalar(spd).add(new THREE.Vector3(0, isKong ? 5 : 3, 0)),
          damage: this.getSpecialDamagePerSec() * (isKong ? 0.85 : 0.48),
          splash: (isKong ? 12 : 9) * (this.mutations.has('plasma_overcharge') ? 1.3 : 1.0),
          age: 0
        });
        this.audio.play(isKong ? 'punchHeavy' : 'laserLarge', { volume: 0.68, pitch: isKong ? 0.7 : 1.25 });
      }
    }
  }

  update(dt, moveVec, aimPoint, secondaryHeld, city, traffic, military, boss, callbacks) {
    if (!this.mesh) return;
    this.mixer.update(dt);

    // Smooth scale growth!
    this.currentHeight = THREE.MathUtils.lerp(this.currentHeight, this.targetHeight, 4.5 * dt);
    this.mesh.scale.setScalar(this.currentHeight);

    // Pulse dorsal spines with Energy / Ultimate charge
    const spinePulse = 1.0 + (this.ultCharge >= 100 ? Math.abs(Math.sin(performance.now() * 0.012)) * 1.6 : 0.25);
    for (const sp of this.dorsalSpines) {
      if (sp.material) sp.material.emissiveIntensity = spinePulse;
    }

    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.attackLockedTimer > 0) this.attackLockedTimer -= dt;
    if (this.leapCooldown > 0) this.leapCooldown -= dt;
    if (this.secondaryCooldown > 0) this.secondaryCooldown -= dt;
    if (this.berserkTimer > 0) this.berserkTimer -= dt;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    // Arc-Lightning Spines mutation auto-zap!
    if (this.mutations.has('thorns_spires')) {
      this.thornsTimer -= dt;
      if (this.thornsTimer <= 0) {
        this.thornsTimer = 1.45;
        const spineOrigin = this.position.clone().add(new THREE.Vector3(0, this.currentHeight * 0.72, 0));
        const enemy = military.findNearestEnemy(spineOrigin, 38 + this.currentHeight * 0.5);
        if (enemy) {
          this.effects.spawnLightningArc(spineOrigin, enemy.mesh.position, 0x38d6ff);
          military.damageArea(enemy.mesh.position, 5.5, 65, callbacks, true);
          this.audio.play('evolveZap', { volume: 0.32, pitch: 1.5, cooldownMs: 120 });
        } else if (boss && boss.active && !boss.dead && boss.mesh && boss.mesh.position.distanceTo(this.position) < 42) {
          const bTop = boss.mesh.position.clone().add(new THREE.Vector3(0, 20, 0));
          this.effects.spawnLightningArc(spineOrigin, bTop, 0x38d6ff);
          boss.takeDamage(55, city, null, callbacks.onBossDefeated);
        }
      }
    }

    // Update hurled boulders / stinger plasma projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.age += dt;
      pr.vel.y -= 18 * dt;
      pr.mesh.position.addScaledVector(pr.vel, dt);
      pr.mesh.rotation.x += 8 * dt;
      pr.mesh.rotation.y += 6 * dt;

      let hit = pr.mesh.position.y <= 0.8 || pr.age > 2.6;
      if (!hit) {
        for (const b of city.buildings) {
          if (!b.destroyed && pr.mesh.position.y < b.dims.y + 1.5 && Math.hypot(pr.mesh.position.x - b.x, pr.mesh.position.z - b.z) < b.radius + 2.5) {
            hit = true;
            break;
          }
        }
      }
      if (!hit && military.damageArea(pr.mesh.position, pr.splash * 0.65, pr.damage, callbacks, true) > 0) {
        hit = true;
      }
      if (!hit && boss && boss.active && !boss.dead && boss.mesh) {
        const bCenter = boss.mesh.position.clone().add(new THREE.Vector3(0, boss.height * 0.55, 0));
        if (pr.mesh.position.distanceTo(bCenter) < 9.5) {
          boss.takeDamage(pr.damage, city, null, callbacks.onBossDefeated);
          hit = true;
        }
      }

      if (hit) {
        const hitPos = pr.mesh.position.clone();
        this.effects.spawnExplosion(hitPos, 1.55, this.kaijuDef.beamColor, true);
        this.audio.play('explosionCrunch', { volume: 0.68, pitch: 0.95, cooldownMs: 40 });
        for (const b of city.buildings) {
          if (!b.destroyed && Math.hypot(b.x - hitPos.x, b.z - hitPos.z) <= pr.splash + b.radius) {
            city.damageBuilding(b, pr.damage, { x: pr.vel.x * 0.02, z: pr.vel.z * 0.02 }, callbacks);
          }
        }
        military.damageArea(hitPos, pr.splash, pr.damage, callbacks, true);
        this.group.remove(pr.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // Handle Leap-Slam parabolic flight & landing impact!
    if (this.isLeaping) {
      this.effects.updateBeam(false);
      this.audio.setBeamActive(false);
      this.leapTimer += dt;
      const t = Math.min(1, this.leapTimer / this.leapDuration);
      this.position.lerpVectors(this.leapStart, this.leapEnd, t);
      this.jumpHeight = Math.sin(t * Math.PI) * (15 + this.currentHeight * 0.45);
      this.mesh.position.set(this.position.x, this.jumpHeight, this.position.z);

      // Mid-air helicopter swat!
      if (this.jumpHeight > 6) {
        military.damageArea(this.mesh.position.clone().add(new THREE.Vector3(0, this.currentHeight * 0.4, 0)), this.getFootRadius() + 5.5, 250, callbacks, true);
      }

      if (t >= 1) {
        this.isLeaping = false;
        this.jumpHeight = 0;
        this.mesh.position.set(this.position.x, 0, this.position.z);

        const stompMult = this.mutations.has('quake_stomp') ? 1.55 : 1.0;
        const slamR = (13.5 + this.currentHeight * 0.42) * stompMult;
        const slamDmg = this.getSmashDamage() * 1.75;

        this.effects.spawnShockwave(this.position, slamR, this.kaijuDef.glowHex, 0.52);
        this.effects.spawnDustCloud(this.position, slamR * 0.85, 14);
        this.effects.spawnScorch(this.position.x, this.position.z, slamR * 0.45);
        this.effects.addShake(0.58);
        this.effects.triggerHitStop(0.045);
        this.audio.playBuildingCollapse(Math.min(4, this.sizeClass.tier + 1), 0);

        for (const b of city.buildings) {
          if (!b.destroyed && Math.hypot(b.x - this.position.x, b.z - this.position.z) <= slamR + b.radius) {
            const dx = b.x - this.position.x;
            const dz = b.z - this.position.z;
            const d = Math.hypot(dx, dz) || 1;
            city.damageBuilding(b, slamDmg, { x: dx / d, z: dz / d }, callbacks);
          }
        }
        for (const p of city.props) {
          if (!p.destroyed && Math.hypot(p.x - this.position.x, p.z - this.position.z) <= slamR + p.radius) {
            city.crushProp(p, { x: 0, z: 1 }, callbacks);
          }
        }
        military.damageArea(this.position, slamR, slamDmg * 1.25, callbacks, false);
        if (boss && boss.active && !boss.dead && boss.mesh) {
          if (Math.hypot(boss.mesh.position.x - this.position.x, boss.mesh.position.z - this.position.z) <= slamR + 7) {
            boss.takeDamage(slamDmg, city, null, callbacks.onBossDefeated);
          }
        }
      }
      return;
    }

    // Secondary beam / volley
    this.handleSecondarySpecial(dt, secondaryHeld, aimPoint, city, military, boss, callbacks);

    // Ground Movement + Trample Physics!
    const strideRank = this.save.getUpgradeRank('stride');
    const baseSpeed = (16.5 + (this.currentHeight - 7.4) * 0.28) * this.kaijuDef.stats.speed * (1 + strideRank * 0.11) * (this.berserkTimer > 0 ? 1.3 : 1.0);
    const moving = moveVec.lengthSq() > 0.01;

    if (moving) {
      const moveScale = (secondaryHeld && this.kaijuDef.id === 'rex') ? 0.55 : 1.0;
      this.position.x += moveVec.x * baseSpeed * moveScale * dt;
      this.position.z += moveVec.z * baseSpeed * moveScale * dt;

      if (!secondaryHeld && this.attackLockedTimer <= 0) {
        const targetYaw = Math.atan2(moveVec.x, moveVec.z);
        let diff = targetYaw - this.facingYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.facingYaw += diff * Math.min(1, 11 * dt);
      }

      if (this.attackLockedTimer <= 0) {
        this.playAnim('run', false, 1.15);
      }

      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        this.footstepTimer = Math.max(0.32, 0.44 - this.kaijuDef.stats.speed * 0.05);
        this.audio.playFootstep(this.sizeClass);
        this.effects.addShake(0.03 + (this.sizeClass.tier - 1) * 0.025);
      }
    } else if (this.attackLockedTimer <= 0) {
      this.playAnim('idle', false, 1.0);
    }

    // Clamp inside city island bounds
    const bound = city.halfExtent - 3.5;
    this.position.x = THREE.MathUtils.clamp(this.position.x, -bound, bound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -bound, bound);

    // === TRAMPLE BUILDINGS & PROPS UNDERFOOT! ===
    const footR = this.getFootRadius();
    for (const p of city.props) {
      if (!p.destroyed && Math.hypot(p.x - this.position.x, p.z - this.position.z) < footR + p.radius) {
        city.crushProp(p, { x: moveVec.x || 0, z: moveVec.z || -1 }, callbacks);
      }
    }

    for (const b of city.buildings) {
      if (b.destroyed) continue;
      const dx = this.position.x - b.x;
      const dz = this.position.z - b.z;
      const dist = Math.hypot(dx, dz);
      const minSep = footR + b.radius;

      if (dist < minSep) {
        if (b.tier <= this.sizeClass.trampleTier && !b.isObjectiveLandmark) {
          // KATAMARI POWER FANTASY: Walk straight through buildings smaller than your Size Class!!
          city.damageBuilding(b, 9999, { x: -dx / (dist || 1), z: -dz / (dist || 1) }, callbacks);
        } else {
          // Push Kaiju out smoothly + chip building if sprinting into it!
          const nx = dx / (dist || 1);
          const nz = dz / (dist || 1);
          this.position.x = b.x + nx * minSep;
          this.position.z = b.z + nz * minSep;
          if (moving) {
            city.damageBuilding(b, this.getSmashDamage() * 0.65 * dt, { x: -nx, z: -nz }, callbacks);
          }
        }
      }
    }

    this.mesh.position.set(this.position.x, 0, this.position.z);
    this.mesh.rotation.y = this.facingYaw;
  }

  clear() {
    this.effects.updateBeam(false);
    this.audio.setBeamActive(false);
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.projectiles.length = 0;
    this.mesh = null;
  }
}

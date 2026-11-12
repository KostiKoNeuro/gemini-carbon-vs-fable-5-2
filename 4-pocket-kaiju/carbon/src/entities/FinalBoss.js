import * as THREE from 'three';

export class FinalBoss {
  constructor(assetManager, fracture, effects, audio, military, scene) {
    this.assets = assetManager;
    this.fracture = fracture;
    this.effects = effects;
    this.audio = audio;
    this.military = military;
    this.scene = scene;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.active = false;
    this.dead = false;
    this.dyingTimer = 0;

    this.mesh = null;
    this.mixer = null;
    this.actions = {};
    this.currentAnim = 'idle';

    this.height = 35.0; // Colossal 35-meter Jaeger!
    this.hp = 2600;
    this.maxHp = 2600;
    this.phase = 1;

    this.shieldSphere = null;
    this.tetherLines = [];
    this.laserBeam = null;

    this.state = 'stalk'; // 'stalk' | 'laser_windup' | 'laser_sweep' | 'leap' | 'salvo'
    this.stateTimer = 2.5;
    this.laserAngle = 0;
    this.laserStartAngle = 0;
    this.leapStart = new THREE.Vector3();
    this.leapTarget = new THREE.Vector3();
    this.leapProgress = 0;
    this.footstepTimer = 0;
  }

  spawn(city) {
    this.clear();
    this.active = true;
    this.dead = false;
    this.dyingTimer = 0;
    this.phase = 1;
    this.hp = 2600;
    this.maxHp = 2600;
    this.state = 'stalk';
    this.stateTimer = 3.0;

    this.mesh = this.assets.instantiate('mech_walker');
    this.mesh.scale.setScalar(this.height);
    this.mesh.position.set(0, 0, -city.halfExtent * 0.25);
    this.group.add(this.mesh);

    // Mount twin shoulder missile turrets + glowing crimson reactor core onto chest bone!
    let chestBone = null;
    this.mesh.userData.innerModel.traverse((n) => {
      if (n.name === 'chest') chestBone = n;
      if (n.isMesh && n.material) {
        const m = n.material.clone();
        m.emissive = new THREE.Color(0x28060c);
        m.metalness = 0.65;
        m.roughness = 0.32;
        n.material = m;
      }
    });

    if (chestBone) {
      const podL = this.assets.instantiate('boss_turret');
      podL.scale.setScalar(0.36);
      podL.position.set(0.45, 0.35, 0.05);
      chestBone.add(podL);

      const podR = this.assets.instantiate('boss_turret');
      podR.scale.setScalar(0.36);
      podR.position.set(-0.45, 0.35, 0.05);
      chestBone.add(podR);

      const coreGeo = new THREE.OctahedronGeometry(0.18, 1);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.position.set(0, 0.15, 0.35);
      chestBone.add(coreMesh);
    }

    // Quantum Shield Sphere (active while any Crystal Pylon landmark remains standing!)
    const shieldGeo = new THREE.IcosahedronGeometry(0.62, 2);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x38d6ff,
      wireframe: true,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.shieldSphere = new THREE.Mesh(shieldGeo, shieldMat);
    this.shieldSphere.position.set(0, 0.52, 0);
    this.mesh.add(this.shieldSphere);

    // Boss Crimson Mega-Laser mesh
    this.laserBeam = this.createBossLaser();
    this.group.add(this.laserBeam);
    this.laserBeam.visible = false;

    this.mixer = new THREE.AnimationMixer(this.mesh.userData.innerModel);
    const clips = this.mesh.userData.animations || [];
    const getAct = (name) => {
      const c = clips.find(cl => cl.name === name);
      return c ? this.mixer.clipAction(c) : null;
    };
    this.actions = {
      idle: getAct('Idle'),
      walk: getAct('Walk'),
      run: getAct('Run') || getAct('Walk'),
      attack: getAct('Attack'),
      jump: getAct('Jump'),
      stomp: getAct('Stomp') || getAct('Attack'),
      hit: getAct('Hit')
    };
    if (this.actions.idle) this.actions.idle.play();
    this.currentAnim = 'idle';

    this.audio.play('voFinalRound', { volume: 0.9, cooldownMs: 500 });
  }

  createBossLaser() {
    const grp = new THREE.Group();
    const g1 = new THREE.CylinderGeometry(0.6, 1.1, 1, 10, 1, true);
    g1.rotateX(Math.PI / 2);
    g1.translate(0, 0, 0.5);
    const m1 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const g2 = new THREE.CylinderGeometry(1.7, 2.8, 1, 12, 1, true);
    g2.rotateX(Math.PI / 2);
    g2.translate(0, 0, 0.5);
    const m2 = new THREE.MeshBasicMaterial({ color: 0xff1e42, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false });
    grp.add(new THREE.Mesh(g1, m1), new THREE.Mesh(g2, m2));
    return grp;
  }

  playAnim(name, loopOnce = false, speed = 1.0) {
    if (!this.actions[name]) return;
    if (this.currentAnim === name && !loopOnce) return;
    const prev = this.actions[this.currentAnim];
    const next = this.actions[name];
    next.reset();
    next.timeScale = speed;
    if (loopOnce) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, 0.2, false);
    this.currentAnim = name;
  }

  getShieldPylons(city) {
    if (!city) return [];
    return city.buildings.filter(b => b.isObjectiveLandmark && !b.destroyed);
  }

  takeDamage(rawAmount, city, onShieldBroken, onBossDefeated) {
    if (!this.active || this.dead) return 0;

    const pylons = this.getShieldPylons(city);
    const shielded = pylons.length > 0;
    const mult = shielded ? 0.22 : 1.0; // Shield reduces damage by 78% until pylons fall!
    const actual = rawAmount * mult;
    this.hp = Math.max(0, this.hp - actual);

    const chestPos = this.mesh.position.clone().add(new THREE.Vector3(0, this.height * 0.65, 0));
    if (shielded) {
      this.effects.spawnShockwave(chestPos, 14, 0x38d6ff, 0.25);
      if (Math.random() < 0.35) {
        this.effects.spawnFloatingText(chestPos, 'SHIELDED! DESTROY PYLONS!', '#38d6ff', false);
      }
    } else {
      this.effects.spawnExplosion(chestPos, 1.1, 0xffaa33, false);
    }

    // Check phase transitions!
    const ratio = this.hp / this.maxHp;
    if (this.phase === 1 && ratio <= 0.65) {
      this.phase = 2;
      this.effects.spawnShockwave(this.mesh.position, 42, 0xff3355, 0.65);
      this.effects.spawnFloatingText(chestPos, 'AEGIS PHASE II: OVERDRIVE!', '#ff3355', true);
      this.audio.play('evolveZap', { volume: 0.85, pitch: 0.75 });
      this.military.spawnHelicopter(this.mesh.position);
      this.military.spawnHelicopter(this.mesh.position);
    } else if (this.phase === 2 && ratio <= 0.32) {
      this.phase = 3;
      this.effects.spawnShockwave(this.mesh.position, 55, 0xff1133, 0.8);
      this.effects.spawnFloatingText(chestPos, 'AEGIS PHASE III: CORE MELTDOWN!', '#ff1133', true);
      this.audio.play('explosionLow', { volume: 0.95, pitch: 0.6 });
      this.military.spawnJetAirstrike(this.mesh.position);
    }

    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      this.dyingTimer = 2.6;
      this.laserBeam.visible = false;
      this.playAnim('hit', true, 0.5);
      this.effects.triggerHitStop(0.11);
      this.effects.addShake(1.2);
      this.effects.spawnFloatingText(chestPos, 'AEGIS-ZERO CRITICAL FAILURE!!', '#ffd166', true);
      this.audio.play('explosionLow', { volume: 1.0, pitch: 0.5, cooldownMs: 10 });
      if (onBossDefeated) onBossDefeated();
    }

    return actual;
  }

  updateTetherLines(pylons) {
    // Rebuild energy lines from remaining Shield Pylons to Boss!
    for (const l of this.tetherLines) {
      this.group.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    }
    this.tetherLines.length = 0;

    if (!this.mesh || pylons.length === 0) return;
    const bossTop = this.mesh.position.clone().add(new THREE.Vector3(0, this.height * 0.62, 0));
    for (const p of pylons) {
      const pTop = new THREE.Vector3(p.x, p.dims.y * 0.85, p.z);
      const mid = new THREE.Vector3().lerpVectors(pTop, bossTop, 0.5);
      mid.y += 12 + Math.sin(performance.now() * 0.006 + p.x) * 2.5;
      const curve = new THREE.QuadraticBezierCurve3(pTop, mid, bossTop);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16));
      const mat = new THREE.LineBasicMaterial({ color: 0x38d6ff, transparent: true, opacity: 0.78 });
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this.tetherLines.push(line);
    }
  }

  update(dt, kaiju, city, callbacks = {}) {
    if (!this.active || !this.mesh) return;
    this.mixer.update(dt);

    const pylons = this.getShieldPylons(city);
    if (this.shieldSphere) {
      const wasVisible = this.shieldSphere.visible;
      this.shieldSphere.visible = pylons.length > 0 && !this.dead;
      this.shieldSphere.rotation.y += 1.2 * dt;
      if (wasVisible && !this.shieldSphere.visible && !this.dead) {
        // All 3 Shield Pylons destroyed!
        this.effects.spawnShockwave(this.mesh.position, 48, 0x38d6ff, 0.75);
        this.effects.spawnFloatingText(
          this.mesh.position.clone().add(new THREE.Vector3(0, 32, 0)),
          'QUANTUM SHIELD SHATTERED!!',
          '#39ff88',
          true
        );
        this.audio.play('glassHeavy', { volume: 0.95, pitch: 0.65, cooldownMs: 10 });
        if (callbacks.onAllPylonsDestroyed) callbacks.onAllPylonsDestroyed();
      }
    }
    this.updateTetherLines(this.dead ? [] : pylons);

    // Dramatic multi-explosion death sequence!
    if (this.dead) {
      this.dyingTimer -= dt;
      this.mesh.position.y -= 4.5 * dt;
      this.mesh.rotation.x += 0.28 * dt;
      if (Math.random() < 0.55) {
        const rx = this.mesh.position.x + (Math.random() - 0.5) * 18;
        const ry = Math.max(2, this.mesh.position.y + Math.random() * 28);
        const rz = this.mesh.position.z + (Math.random() - 0.5) * 18;
        this.effects.spawnExplosion(new THREE.Vector3(rx, ry, rz), 2.2, 0xff7722, true);
        this.audio.play('explosionCrunch', { volume: 0.75, pitch: 0.7 + Math.random() * 0.4, cooldownMs: 90 });
      }
      if (this.dyingTimer <= 0) {
        this.fracture.shatterVehicle(this.mesh.position.clone().add(new THREE.Vector3(0, 8, 0)), { x: 0, z: 1 }, 3.5);
        this.effects.spawnExplosion(this.mesh.position.clone().add(new THREE.Vector3(0, 6, 0)), 4.2, 0xffaa22, true);
        this.effects.addShake(1.3);
        this.active = false;
        this.group.remove(this.mesh);
        if (callbacks.onBossDeathFinished) callbacks.onBossDeathFinished();
      }
      return;
    }

    const bPos = this.mesh.position;
    const kPos = kaiju.position;
    const dx = kPos.x - bPos.x;
    const dz = kPos.z - bPos.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(dx, dz);

    // Boss crushes city buildings in its path too — Clash of Titans!
    for (const b of city.buildings) {
      if (b.destroyed || b.isObjectiveLandmark) continue;
      if (Math.hypot(b.x - bPos.x, b.z - bPos.z) < b.radius + 6.5) {
        city.damageBuilding(b, 400, { x: Math.sin(this.mesh.rotation.y), z: Math.cos(this.mesh.rotation.y) }, callbacks);
      }
    }

    this.stateTimer -= dt;
    const speedMult = 1 + (this.phase - 1) * 0.24;

    if (this.state === 'stalk') {
      this.laserBeam.visible = false;
      this.mesh.rotation.y = THREE.MathUtils.lerp(this.mesh.rotation.y, targetYaw, 4 * dt);

      if (dist > 22) {
        this.playAnim(this.phase >= 3 ? 'run' : 'walk', false, speedMult);
        const moveSpd = 12.5 * speedMult;
        bPos.x += Math.sin(targetYaw) * moveSpd * dt;
        bPos.z += Math.cos(targetYaw) * moveSpd * dt;
        this.footstepTimer -= dt;
        if (this.footstepTimer <= 0) {
          this.footstepTimer = 0.55 / speedMult;
          this.effects.addShake(0.12);
          this.audio.play('footstep', { volume: 0.45, pitch: 0.55, cooldownMs: 120 });
        }
      } else {
        // Melee hydraulic punch!
        this.playAnim('attack', true, 1.2 * speedMult);
        if (this.stateTimer <= 0.4) {
          kaiju.takeDamage(18);
          this.effects.spawnShockwave(kPos, 16, 0xff3355, 0.35);
          this.audio.play('metalHeavy', { volume: 0.85, pitch: 0.7, cooldownMs: 250 });
          this.stateTimer = 1.6;
        }
      }

      if (this.stateTimer <= 0) {
        // Choose next boss signature attack!
        const roll = Math.random();
        if (roll < 0.38) {
          this.state = 'laser_windup';
          this.stateTimer = 0.95;
          this.laserStartAngle = targetYaw - 0.58;
          this.playAnim('idle', false, 1.0);
          this.audio.play('phaserUp', { volume: 0.8, pitch: 0.75 });
          this.effects.spawnFloatingText(bPos.clone().add(new THREE.Vector3(0, 32, 0)), 'MEGA-LASER CHARGING!', '#ff2e55', false);
        } else if (roll < 0.72) {
          this.state = 'salvo';
          this.stateTimer = 1.3;
          this.playAnim('attack', true, 1.1);
          const origin = bPos.clone().add(new THREE.Vector3(0, this.height * 0.72, 0));
          const count = 3 + this.phase;
          for (let m = 0; m < count; m++) {
            const spread = new THREE.Vector3(
              kPos.x + (Math.random() - 0.5) * 18,
              kaiju.currentHeight * 0.45,
              kPos.z + (Math.random() - 0.5) * 18
            );
            this.military.fireMissile(origin, spread, 34 + this.phase * 4, 11, true);
          }
          this.audio.play('laserLarge', { volume: 0.75, pitch: 0.85 });
        } else {
          this.state = 'leap';
          this.leapProgress = 0;
          this.leapStart.copy(bPos);
          this.leapTarget.set(
            THREE.MathUtils.clamp(kPos.x, -city.halfExtent + 16, city.halfExtent - 16),
            0,
            THREE.MathUtils.clamp(kPos.z, -city.halfExtent + 16, city.halfExtent - 16)
          );
          this.effects.spawnWarningZone(this.leapTarget.x, this.leapTarget.z, 15, 1.15);
          this.playAnim('jump', true, 0.9);
          this.audio.play('jetFlyby', { volume: 0.65, pitch: 0.8 });
        }
      }
    } else if (this.state === 'laser_windup') {
      this.mesh.rotation.y = THREE.MathUtils.lerp(this.mesh.rotation.y, this.laserStartAngle, 6 * dt);
      if (this.stateTimer <= 0) {
        this.state = 'laser_sweep';
        this.stateTimer = 1.85;
        this.laserAngle = this.laserStartAngle;
        this.audio.play('laserLarge', { volume: 0.85, pitch: 0.65 });
      }
    } else if (this.state === 'laser_sweep') {
      this.laserAngle += (0.68 * speedMult) * dt;
      this.mesh.rotation.y = this.laserAngle;

      const origin = bPos.clone().add(new THREE.Vector3(0, this.height * 0.63, 0));
      const range = 95;
      const end = new THREE.Vector3(
        bPos.x + Math.sin(this.laserAngle) * range,
        0.5,
        bPos.z + Math.cos(this.laserAngle) * range
      );

      this.laserBeam.visible = true;
      this.laserBeam.position.copy(origin);
      this.laserBeam.lookAt(end);
      const beamLen = origin.distanceTo(end);
      this.laserBeam.scale.set(1.1, 1.1, beamLen);

      if (Math.random() < 0.5) {
        this.effects.spawnExplosion(end, 0.8, 0xff1e42, false);
        this.effects.spawnScorch(end.x, end.z, 3.8, 0xff1e42);
      }

      // Check line-segment distance from Boss laser to Kaiju!
      const seg = new THREE.Line3(
        new THREE.Vector3(bPos.x, 0, bPos.z),
        new THREE.Vector3(end.x, 0, end.z)
      );
      const closest = new THREE.Vector3();
      seg.closestPointToPoint(new THREE.Vector3(kPos.x, 0, kPos.z), true, closest);
      if (closest.distanceTo(new THREE.Vector3(kPos.x, 0, kPos.z)) < kaiju.getFootRadius() + 3.2 && kaiju.jumpHeight < 8) {
        kaiju.takeDamage(22 * dt);
      }

      if (this.stateTimer <= 0) {
        this.laserBeam.visible = false;
        this.state = 'stalk';
        this.stateTimer = 2.6 / speedMult;
      }
    } else if (this.state === 'salvo') {
      if (this.stateTimer <= 0) {
        this.state = 'stalk';
        this.stateTimer = 2.4 / speedMult;
      }
    } else if (this.state === 'leap') {
      this.leapProgress += dt / 1.15;
      const t = Math.min(1, this.leapProgress);
      bPos.lerpVectors(this.leapStart, this.leapTarget, t);
      bPos.y = Math.sin(t * Math.PI) * 34;

      if (t >= 1) {
        bPos.y = 0;
        this.playAnim('stomp', true, 1.2);
        this.effects.spawnShockwave(bPos, 26, 0xff3355, 0.55);
        this.effects.spawnExplosion(bPos, 2.4, 0xff4422, false);
        this.effects.addShake(0.65);
        this.audio.play('explosionLow', { volume: 0.9, pitch: 0.65 });

        if (Math.hypot(kPos.x - bPos.x, kPos.z - bPos.z) < 16 + kaiju.getFootRadius() && kaiju.jumpHeight < 5) {
          kaiju.takeDamage(26);
        }
        this.state = 'stalk';
        this.stateTimer = 2.2 / speedMult;
      }
    }
  }

  clear() {
    this.active = false;
    this.dead = false;
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.tetherLines.length = 0;
    this.mesh = null;
  }
}

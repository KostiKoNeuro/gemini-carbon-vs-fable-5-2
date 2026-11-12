import * as THREE from 'three';

const CIV_KEYS = ['civ_male_a', 'civ_male_b', 'civ_female_a', 'civ_female_b'];
const CAR_KEYS = [
  'car_sedan', 'car_sports', 'car_taxi', 'car_suv',
  'car_delivery', 'car_truck', 'car_police', 'car_ambulance', 'car_firetruck'
];

export class CrowdAndTraffic {
  constructor(assetManager, fracture, effects, audio, scene) {
    this.assets = assetManager;
    this.fracture = fracture;
    this.effects = effects;
    this.audio = audio;
    this.scene = scene;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.civilians = [];
    this.vehicles = [];
    this.maxCivilians = 48;
    this.maxVehicles = 30;
    this.city = null;

    // Shared siren sprite material templates
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,80,100,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    this.sirenTex = new THREE.CanvasTexture(canvas);
  }

  setQuality(q) {
    this.maxCivilians = q === 'low' ? 22 : q === 'medium' ? 36 : 52;
    this.maxVehicles = q === 'low' ? 16 : q === 'medium' ? 24 : 32;
  }

  populate(city) {
    this.clear();
    this.city = city;

    for (let i = 0; i < this.maxCivilians; i++) {
      this.spawnCivilian(false);
    }
    for (let i = 0; i < this.maxVehicles; i++) {
      this.spawnVehicle(false);
    }
  }

  spawnCivilian(avoidOriginPos = null) {
    if (!this.city || this.city.roadX.length === 0) return;
    const key = CIV_KEYS[Math.floor(Math.random() * CIV_KEYS.length)];
    const mesh = this.assets.instantiate(key);

    // Pick a road sidewalk coordinate
    const alongX = Math.random() < 0.5;
    const roadList = alongX ? this.city.roadZ : this.city.roadX;
    const roadCoord = roadList[Math.floor(Math.random() * roadList.length)] + (Math.random() < 0.5 ? -4.2 : 4.2);
    const travelCoord = (Math.random() * 2 - 1) * (this.city.halfExtent - 6);

    const x = alongX ? travelCoord : roadCoord;
    const z = alongX ? roadCoord : travelCoord;

    if (avoidOriginPos && Math.hypot(x - avoidOriginPos.x, z - avoidOriginPos.z) < 32) {
      return;
    }

    mesh.position.set(x, 0, z);
    const dirAngle = alongX ? (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (Math.random() < 0.5 ? 0 : Math.PI);
    mesh.rotation.y = dirAngle;
    this.group.add(mesh);

    const mixer = new THREE.AnimationMixer(mesh.userData.innerModel);
    const clips = mesh.userData.animations || [];
    const findClip = (name) => clips.find(c => c.name === name);
    const walkClip = findClip('walk') || clips[0];
    const sprintClip = findClip('sprint') || walkClip;
    const fallClip = findClip('fall') || walkClip;

    const actions = {
      walk: walkClip ? mixer.clipAction(walkClip) : null,
      sprint: sprintClip ? mixer.clipAction(sprintClip) : null,
      fall: fallClip ? mixer.clipAction(fallClip) : null
    };
    if (actions.walk) {
      actions.walk.time = Math.random() * 1.2;
      actions.walk.play();
    }

    this.civilians.push({
      mesh,
      mixer,
      actions,
      currentAnim: 'walk',
      vel: new THREE.Vector3(Math.sin(dirAngle) * 2.6, 0, Math.cos(dirAngle) * 2.6),
      panicking: false,
      ragdoll: false,
      ragdollTimer: 0
    });
  }

  spawnVehicle(avoidPos = null) {
    if (!this.city || this.city.roadX.length === 0) return;
    const key = CAR_KEYS[Math.floor(Math.random() * CAR_KEYS.length)];
    const mesh = this.assets.instantiate(key);

    const alongX = Math.random() < 0.5;
    const dirSign = Math.random() < 0.5 ? 1 : -1;
    const laneOffset = dirSign * 2.1;
    const roadList = alongX ? this.city.roadZ : this.city.roadX;
    const rIdx = Math.floor(Math.random() * roadList.length);
    const roadCenter = roadList[rIdx] + laneOffset;
    const posAlong = (Math.random() * 2 - 1) * (this.city.halfExtent - 8);

    const x = alongX ? posAlong : roadCenter;
    const z = alongX ? roadCenter : posAlong;

    if (avoidPos && Math.hypot(x - avoidPos.x, z - avoidPos.z) < 35) return;

    mesh.position.set(x, 0, z);
    const vx = alongX ? dirSign : 0;
    const vz = alongX ? 0 : dirSign;
    mesh.rotation.y = Math.atan2(vx, vz);

    const isEmergency = key === 'car_police' || key === 'car_ambulance' || key === 'car_firetruck';
    let sirenSprite = null;
    if (isEmergency) {
      sirenSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.sirenTex,
        color: 0xff2244,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }));
      sirenSprite.position.set(0, 2.3, 0);
      sirenSprite.scale.setScalar(3.2);
      mesh.add(sirenSprite);
    }

    this.group.add(mesh);
    this.vehicles.push({
      key,
      mesh,
      vx,
      vz,
      baseSpeed: isEmergency ? 13.5 : 9.5 + Math.random() * 4.0,
      fleeing: false,
      launched: false,
      launchVel: new THREE.Vector3(),
      launchAng: new THREE.Vector3(),
      launchTimer: 0,
      launchDamage: 90,
      isEmergency,
      sirenSprite,
      destroyed: false
    });
  }

  switchCivAnim(c, name, timeScale = 1.0) {
    if (c.currentAnim === name) return;
    const prev = c.actions[c.currentAnim];
    const next = c.actions[name];
    if (next) {
      next.reset();
      next.timeScale = timeScale;
      next.play();
      if (prev) prev.crossFadeTo(next, 0.16, false);
      c.currentAnim = name;
    }
  }

  // Launch a vehicle as a spinning kinetic bomb across the city!
  launchVehicle(v, dirX, dirZ, powerMult = 1.0, damage = 125) {
    if (v.destroyed || v.launched) return;
    v.launched = true;
    v.launchTimer = 0;
    v.launchDamage = damage;
    const spd = 46 * powerMult;
    v.launchVel.set(dirX * spd, 15 * powerMult + Math.random() * 6, dirZ * spd);
    v.launchAng.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 14);
    this.audio.play('metalHeavy', { volume: 0.72, pitch: 0.95, cooldownMs: 35 });
    this.effects.spawnShockwave(v.mesh.position, 7, 0xffaa33, 0.25);
  }

  destroyVehicle(v, hitDir = { x: 0, z: 1 }, callbacks = {}) {
    if (v.destroyed) return;
    v.destroyed = true;
    const pos = v.mesh.position.clone();
    this.group.remove(v.mesh);

    this.fracture.shatterVehicle(pos, hitDir, 1.0);
    this.effects.spawnExplosion(pos, 1.05, 0xff7722, true);
    this.effects.spawnScorch(pos.x, pos.z, 3.2);
    this.audio.play('explosionCrunch', { volume: 0.58, pitch: 1.2, cooldownMs: 45 });

    if (callbacks.onVehicleDestroyed) {
      callbacks.onVehicleDestroyed(pos, v);
    }
  }

  triggerPanicWave(origin, radius = 65) {
    for (const c of this.civilians) {
      if (c.ragdoll) continue;
      const dx = c.mesh.position.x - origin.x;
      const dz = c.mesh.position.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        c.panicking = true;
        this.switchCivAnim(c, 'sprint', 1.7);
      }
    }
  }

  update(dt, kaiju, callbacks = {}) {
    if (!this.city) return;
    const kPos = kaiju.position;
    const trampleR = kaiju.getFootRadius();
    const limit = this.city.halfExtent + 6;

    // Update Civilians
    for (let i = this.civilians.length - 1; i >= 0; i--) {
      const c = this.civilians[i];
      c.mixer.update(dt);

      if (c.ragdoll) {
        c.ragdollTimer += dt;
        c.vel.y -= 32 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += 9 * dt;
        c.mesh.rotation.z += 7 * dt;
        if (c.ragdollTimer > 1.2 || c.mesh.position.y < -1) {
          this.group.remove(c.mesh);
          this.civilians.splice(i, 1);
        }
        continue;
      }

      const dx = c.mesh.position.x - kPos.x;
      const dz = c.mesh.position.z - kPos.z;
      const dist = Math.hypot(dx, dz);

      // Squish / launch if stepped on by Kaiju!
      if (dist < trampleR + 1.1 && kaiju.jumpHeight < 4.5) {
        c.ragdoll = true;
        this.switchCivAnim(c, 'fall', 1.2);
        const nx = dx / (dist || 1);
        const nz = dz / (dist || 1);
        c.vel.set(nx * 18 + (Math.random() - 0.5) * 8, 12 + Math.random() * 7, nz * 18 + (Math.random() - 0.5) * 8);
        if (callbacks.onCivilianSquished) callbacks.onCivilianSquished(c.mesh.position);
        continue;
      }

      if (dist < 44 || c.panicking) {
        c.panicking = true;
        this.switchCivAnim(c, 'sprint', 1.75);
        const nx = dx / (dist || 1);
        const nz = dz / (dist || 1);
        const fleeSpeed = 7.4;
        c.vel.x = THREE.MathUtils.lerp(c.vel.x, nx * fleeSpeed, 6 * dt);
        c.vel.z = THREE.MathUtils.lerp(c.vel.z, nz * fleeSpeed, 6 * dt);
      }

      c.mesh.position.x += c.vel.x * dt;
      c.mesh.position.z += c.vel.z * dt;
      if (Math.hypot(c.vel.x, c.vel.z) > 0.2) {
        c.mesh.rotation.y = Math.atan2(c.vel.x, c.vel.z);
      }

      // Recycle if fled off island
      if (Math.abs(c.mesh.position.x) > limit || Math.abs(c.mesh.position.z) > limit) {
        this.group.remove(c.mesh);
        this.civilians.splice(i, 1);
      }
    }

    // Replenish civilians on distant streets
    if (this.civilians.length < this.maxCivilians && Math.random() < 0.35) {
      this.spawnCivilian(kPos);
    }

    // Update Vehicles
    const sirenPhase = Math.floor(performance.now() / 160) % 2 === 0;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.destroyed) {
        this.vehicles.splice(i, 1);
        continue;
      }

      if (v.sirenSprite) {
        v.sirenSprite.material.color.setHex(sirenPhase ? 0xff2244 : 0x2288ff);
      }

      // Launched vehicle projectile physics!
      if (v.launched) {
        v.launchTimer += dt;
        v.launchVel.y -= 30 * dt;
        v.mesh.position.addScaledVector(v.launchVel, dt);
        v.mesh.rotation.x += v.launchAng.x * dt;
        v.mesh.rotation.y += v.launchAng.y * dt;
        v.mesh.rotation.z += v.launchAng.z * dt;

        // Trail smoke
        if (Math.random() < 0.45) {
          this.effects.spawnDustCloud(v.mesh.position, 2.2, 1);
        }

        let hitSomething = false;
        // Check building impact
        for (const b of this.city.buildings) {
          if (b.destroyed) continue;
          if (v.mesh.position.y < b.dims.y + 1.5) {
            const d = Math.hypot(v.mesh.position.x - b.x, v.mesh.position.z - b.z);
            if (d < b.radius + 2.2) {
              this.city.damageBuilding(b, v.launchDamage, { x: v.launchVel.x * 0.03, z: v.launchVel.z * 0.03 }, callbacks);
              hitSomething = true;
              break;
            }
          }
        }

        // Check military / helicopter / boss impact!
        if (!hitSomething && callbacks.checkProjectileHitEnemies) {
          hitSomething = callbacks.checkProjectileHitEnemies(v.mesh.position, 5.8, v.launchDamage * 1.35);
        }

        if (hitSomething || v.mesh.position.y <= 0.4 || v.launchTimer > 3.2) {
          if (callbacks.onExplosionArea) {
            callbacks.onExplosionArea(v.mesh.position.x, v.mesh.position.z, 9.5, v.launchDamage * 0.7);
          }
          this.destroyVehicle(v, { x: v.launchVel.x * 0.02, z: v.launchVel.z * 0.02 }, callbacks);
          this.vehicles.splice(i, 1);
        }
        continue;
      }

      // Normal driving / fleeing
      const dx = v.mesh.position.x - kPos.x;
      const dz = v.mesh.position.z - kPos.z;
      const dist = Math.hypot(dx, dz);

      // Stepped on / trampled by Kaiju!
      if (dist < trampleR + 2.1 && kaiju.jumpHeight < 4.5) {
        this.destroyVehicle(v, { x: dx / (dist || 1), z: dz / (dist || 1) }, callbacks);
        this.vehicles.splice(i, 1);
        continue;
      }

      if (dist < 42) {
        v.fleeing = true;
        // Reverse if driving toward Kaiju!
        const dot = v.vx * (-dx) + v.vz * (-dz);
        if (dot > 0) {
          v.vx = -v.vx;
          v.vz = -v.vz;
          v.mesh.rotation.y = Math.atan2(v.vx, v.vz);
        }
      }

      const spd = v.fleeing ? v.baseSpeed * 1.85 : v.baseSpeed;
      v.mesh.position.x += v.vx * spd * dt;
      v.mesh.position.z += v.vz * spd * dt;

      if (Math.abs(v.mesh.position.x) > limit || Math.abs(v.mesh.position.z) > limit) {
        this.group.remove(v.mesh);
        this.vehicles.splice(i, 1);
      }
    }

    if (this.vehicles.length < this.maxVehicles && Math.random() < 0.28) {
      this.spawnVehicle(kPos);
    }
  }

  clear() {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    this.civilians.length = 0;
    this.vehicles.length = 0;
  }
}

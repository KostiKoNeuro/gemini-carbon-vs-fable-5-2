import * as THREE from 'three';

function makeRadialTexture(innerHex, outerHex, hardness = 0.35) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, innerHex);
  g.addColorStop(hardness, outerHex);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRingTexture(colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 10;
  ctx.shadowBlur = 14;
  ctx.shadowColor = colorHex;
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class EffectsManager {
  constructor(scene, camera, floatingContainer) {
    this.scene = scene;
    this.camera = camera;
    this.floatingContainer = floatingContainer;

    this.smokeTex = makeRadialTexture('rgba(225,215,205,0.88)', 'rgba(110,105,100,0.45)', 0.45);
    this.fireTex = makeRadialTexture('rgba(255,250,190,1)', 'rgba(255,95,20,0.75)', 0.4);
    this.orbTex = makeRadialTexture('rgba(255,255,255,1)', 'rgba(57,255,136,0.85)', 0.38);
    this.ringTex = makeRingTexture('#ffffff');
    this.warnRingTex = makeRingTexture('#ff3344');

    this.ringGeo = new THREE.PlaneGeometry(1, 1);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.orbGeo = new THREE.IcosahedronGeometry(0.55, 1);

    this.particles = [];
    this.rings = [];
    this.scorchDecals = [];
    this.bioOrbs = [];
    this.floatingTexts = [];
    this.lightningBolts = [];

    // Screen shake & hit-stop state
    this.shakeTrauma = 0;
    this.hitStopTimer = 0;
    this.maxParticles = 260;

    // Reusable Atomic Plasma Beam group
    this.beamGroup = this.createBeamMesh();
    this.scene.add(this.beamGroup);
    this.beamGroup.visible = false;
  }

  setQuality(q) {
    this.maxParticles = q === 'low' ? 100 : q === 'medium' ? 180 : 280;
  }

  createBeamMesh() {
    const grp = new THREE.Group();

    const coreGeo = new THREE.CylinderGeometry(0.45, 0.85, 1, 12, 1, true);
    coreGeo.rotateX(Math.PI / 2);
    coreGeo.translate(0, 0, 0.5);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const outerGeo = new THREE.CylinderGeometry(1.15, 2.1, 1, 14, 1, true);
    outerGeo.rotateX(Math.PI / 2);
    outerGeo.translate(0, 0, 0.5);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x39ff88,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const muzzleSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.orbTex,
      color: 0x66ffaa,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    muzzleSprite.scale.setScalar(5.5);

    const impactSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.fireTex,
      color: 0x66ffaa,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    impactSprite.scale.setScalar(7.5);

    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    grp.add(coreMesh, outerMesh, muzzleSprite, impactSprite);
    grp.userData = { coreMesh, outerMesh, outerMat, muzzleSprite, impactSprite };
    return grp;
  }

  updateBeam(active, origin, endPoint, colorHex = 0x39ff88, widthScale = 1.0) {
    this.beamGroup.visible = active;
    if (!active) return;

    const dist = Math.max(1, origin.distanceTo(endPoint));
    this.beamGroup.position.copy(origin);
    this.beamGroup.lookAt(endPoint);

    const { coreMesh, outerMesh, outerMat, muzzleSprite, impactSprite } = this.beamGroup.userData;
    const pulse = (0.85 + Math.sin(performance.now() * 0.045) * 0.22) * widthScale;

    coreMesh.scale.set(pulse, pulse, dist);
    outerMesh.scale.set(pulse * 1.15, pulse * 1.15, dist);
    outerMat.color.setHex(colorHex);

    muzzleSprite.material.color.setHex(colorHex);
    muzzleSprite.scale.setScalar(5.5 * pulse);
    muzzleSprite.position.set(0, 0, 0.3);

    impactSprite.material.color.setHex(colorHex);
    impactSprite.scale.setScalar(8.5 * pulse);
    impactSprite.position.set(0, 0, dist);

    // Occasional sparks & scorch mark at beam impact!
    if (Math.random() < 0.45) {
      this.spawnExplosion(endPoint, 0.55 * widthScale, colorHex, false);
    }
    if (Math.random() < 0.22 && endPoint.y < 2.5) {
      this.spawnScorch(endPoint.x, endPoint.z, 3.2 * widthScale, colorHex);
    }
  }

  addShake(amount) {
    this.shakeTrauma = Math.min(1.6, this.shakeTrauma + amount);
  }

  triggerHitStop(seconds = 0.038) {
    this.hitStopTimer = Math.max(this.hitStopTimer, seconds);
  }

  spawnShockwave(pos, maxRadius = 16, colorHex = 0xffffff, duration = 0.48) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      color: colorHex,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(pos.x, Math.max(0.18, pos.y), pos.z);
    mesh.scale.setScalar(1.5);
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, age: 0, duration, maxRadius, startRadius: 1.5 });
  }

  spawnWarningZone(x, z, radius, duration) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.warnRingTex,
      color: 0xff2a3c,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(x, 0.22, z);
    mesh.scale.setScalar(radius * 2);
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, age: 0, duration, maxRadius: radius * 2, startRadius: radius * 2, isWarning: true });
  }

  spawnScorch(x, z, radius = 4, glowHex = 0x111111) {
    if (this.scorchDecals.length > 70) {
      const old = this.scorchDecals.shift();
      this.scene.remove(old);
    }
    const mat = new THREE.MeshBasicMaterial({
      map: this.smokeTex,
      color: glowHex === 0x111111 ? 0x141416 : glowHex,
      transparent: true,
      opacity: glowHex === 0x111111 ? 0.65 : 0.45,
      depthWrite: false
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.set(x, 0.08, z);
    m.scale.setScalar(radius * 2.1);
    this.scene.add(m);
    this.scorchDecals.push(m);
  }

  spawnDustCloud(pos, radius = 8, count = 10) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const mat = new THREE.SpriteMaterial({
        map: this.smokeTex,
        color: i % 2 === 0 ? 0xd9cfc5 : 0x8f8882,
        transparent: true,
        opacity: 0.72,
        depthWrite: false
      });
      const sp = new THREE.Sprite(mat);
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.65;
      sp.position.set(pos.x + Math.cos(angle) * r, pos.y + 0.8 + Math.random() * 2.5, pos.z + Math.sin(angle) * r);
      const startScale = (2.8 + Math.random() * 3.5) * (radius / 8);
      sp.scale.setScalar(startScale);
      this.scene.add(sp);
      this.particles.push({
        sprite: sp,
        vel: new THREE.Vector3(Math.cos(angle) * (4 + Math.random() * 7), 3 + Math.random() * 6, Math.sin(angle) * (4 + Math.random() * 7)),
        age: 0,
        life: 0.85 + Math.random() * 0.75,
        startScale,
        endScale: startScale * 2.4,
        startOpacity: 0.72
      });
    }
  }

  spawnExplosion(pos, scale = 1.0, tintHex = 0xff7722, withShockwave = true) {
    const fireCount = Math.min(12, Math.max(4, Math.round(7 * scale)));
    for (let i = 0; i < fireCount; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const isSmoke = i >= fireCount * 0.6;
      const mat = new THREE.SpriteMaterial({
        map: isSmoke ? this.smokeTex : this.fireTex,
        color: isSmoke ? 0x3b3836 : tintHex,
        transparent: true,
        opacity: isSmoke ? 0.75 : 0.95,
        blending: isSmoke ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthWrite: false
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(
        pos.x + (Math.random() - 0.5) * 3.5 * scale,
        pos.y + Math.random() * 3.0 * scale,
        pos.z + (Math.random() - 0.5) * 3.5 * scale
      );
      const startScale = (3.2 + Math.random() * 3.8) * scale;
      sp.scale.setScalar(startScale);
      this.scene.add(sp);
      this.particles.push({
        sprite: sp,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 14 * scale,
          (4 + Math.random() * 11) * scale,
          (Math.random() - 0.5) * 14 * scale
        ),
        age: 0,
        life: isSmoke ? 1.1 + Math.random() * 0.7 : 0.38 + Math.random() * 0.32,
        startScale,
        endScale: startScale * (isSmoke ? 2.5 : 1.8),
        startOpacity: isSmoke ? 0.72 : 0.95
      });
    }

    if (withShockwave) {
      this.spawnShockwave(pos, 15 * scale, tintHex, 0.42);
    }
  }

  spawnLightningArc(fromPos, toPos, colorHex = 0x38d6ff) {
    const points = [];
    const segs = 7;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = new THREE.Vector3().lerpVectors(fromPos, toPos, t);
      if (i > 0 && i < segs) {
        p.x += (Math.random() - 0.5) * 2.4;
        p.y += (Math.random() - 0.5) * 2.4;
        p.z += (Math.random() - 0.5) * 2.4;
      }
      points.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 1 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.lightningBolts.push({ line, geo, mat, age: 0, life: 0.22 });
  }

  // Glowing Bio-Mass Orbs that burst out of crushed blocks and magnetize into your Kaiju!
  spawnBioOrbs(origin, totalBiomass, totalDna, accentHex = 0x39ff88) {
    const orbCount = Math.min(8, Math.max(2, Math.round(totalBiomass / 12)));
    const bioPerOrb = totalBiomass / orbCount;
    const dnaPerOrb = totalDna / orbCount;

    for (let i = 0; i < orbCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: accentHex
      });
      const mesh = new THREE.Mesh(this.orbGeo, mat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.orbTex,
        color: accentHex,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }));
      glow.scale.setScalar(3.4);
      mesh.add(glow);

      mesh.position.set(
        origin.x + (Math.random() - 0.5) * 4,
        origin.y + 1.5 + Math.random() * 3.5,
        origin.z + (Math.random() - 0.5) * 4
      );
      const angle = Math.random() * Math.PI * 2;
      const spd = 6 + Math.random() * 10;
      this.scene.add(mesh);
      this.bioOrbs.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(angle) * spd, 9 + Math.random() * 8, Math.sin(angle) * spd),
        biomass: bioPerOrb,
        dna: dnaPerOrb,
        age: 0,
        magnetized: false
      });
    }
  }

  spawnFloatingText(worldPos, text, color = '#39ff88', big = false) {
    if (!this.floatingContainer || this.floatingTexts.length > 26) return;
    const el = document.createElement('div');
    el.className = big ? 'float-popup float-popup-big' : 'float-popup';
    el.textContent = text;
    el.style.color = color;
    this.floatingContainer.appendChild(el);
    this.floatingTexts.push({
      el,
      pos: worldPos.clone(),
      age: 0,
      life: big ? 1.35 : 0.95
    });
  }

  update(dt, kaijuPos, magnetRadius = 18, onCollectOrb = null) {
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const t = p.age / p.life;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
      const s = THREE.MathUtils.lerp(p.startScale, p.endScale, t);
      p.sprite.scale.setScalar(s);
      p.sprite.material.opacity = p.startOpacity * (1 - t * t);
    }

    // Shockwave & warning rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.duration) {
        this.scene.remove(r.mesh);
        r.mat.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const t = r.age / r.duration;
      if (r.isWarning) {
        r.mat.opacity = 0.45 + Math.abs(Math.sin(r.age * 16)) * 0.5;
      } else {
        const rad = THREE.MathUtils.lerp(r.startRadius, r.maxRadius, 1 - Math.pow(1 - t, 2.5));
        r.mesh.scale.setScalar(rad * 2);
        r.mat.opacity = (1 - t) * 0.9;
      }
    }

    // Lightning bolts
    for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
      const b = this.lightningBolts[i];
      b.age += dt;
      if (b.age >= b.life) {
        this.scene.remove(b.line);
        b.geo.dispose();
        b.mat.dispose();
        this.lightningBolts.splice(i, 1);
        continue;
      }
      b.mat.opacity = 1 - b.age / b.life;
    }

    // Bio-Mass Orbs physics & magnetic pull toward Kaiju!
    for (let i = this.bioOrbs.length - 1; i >= 0; i--) {
      const o = this.bioOrbs[i];
      o.age += dt;
      o.mesh.rotation.y += 4.5 * dt;
      o.mesh.rotation.x += 2.5 * dt;

      if (kaijuPos) {
        const target = new THREE.Vector3(kaijuPos.x, kaijuPos.y + 4.5, kaijuPos.z);
        const dist = o.mesh.position.distanceTo(target);

        if (o.age > 0.28 && (dist < magnetRadius || o.magnetized || o.age > 3.0)) {
          o.magnetized = true;
          const dir = target.sub(o.mesh.position).normalize();
          const pullSpeed = 38 + o.age * 24;
          o.mesh.position.addScaledVector(dir, pullSpeed * dt);
          if (dist < 3.6) {
            if (onCollectOrb) onCollectOrb(o.biomass, o.dna);
            this.scene.remove(o.mesh);
            o.mesh.material.dispose();
            this.bioOrbs.splice(i, 1);
            continue;
          }
        } else {
          o.vel.y -= 28 * dt;
          o.mesh.position.addScaledVector(o.vel, dt);
          if (o.mesh.position.y < 1.1) {
            o.mesh.position.y = 1.1;
            o.vel.y = Math.abs(o.vel.y) * 0.42;
            o.vel.x *= 0.72;
            o.vel.z *= 0.72;
          }
        }
      }
    }

    // Floating screen-projected text popups
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.age += dt;
      if (ft.age >= ft.life) {
        ft.el.remove();
        this.floatingTexts.splice(i, 1);
        continue;
      }
      ft.pos.y += 7.5 * dt;
      const proj = ft.pos.clone().project(this.camera);
      if (proj.z > 1) {
        ft.el.style.opacity = '0';
      } else {
        const sx = (proj.x * 0.5 + 0.5) * w;
        const sy = (-proj.y * 0.5 + 0.5) * h;
        const alpha = 1 - Math.pow(ft.age / ft.life, 1.8);
        ft.el.style.transform = `translate(-50%, -50%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
        ft.el.style.opacity = alpha.toFixed(2);
      }
    }

    this.shakeTrauma = Math.max(0, this.shakeTrauma - 2.1 * dt);
  }

  clear() {
    this.beamGroup.visible = false;
    for (const p of this.particles) { this.scene.remove(p.sprite); p.sprite.material.dispose(); }
    for (const r of this.rings) { this.scene.remove(r.mesh); r.mat.dispose(); }
    for (const s of this.scorchDecals) { this.scene.remove(s); }
    for (const o of this.bioOrbs) { this.scene.remove(o.mesh); }
    for (const b of this.lightningBolts) { this.scene.remove(b.line); }
    for (const ft of this.floatingTexts) { ft.el.remove(); }
    this.particles.length = 0;
    this.rings.length = 0;
    this.scorchDecals.length = 0;
    this.bioOrbs.length = 0;
    this.lightningBolts.length = 0;
    this.floatingTexts.length = 0;
  }
}

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { KAIJU_ROSTER, CAMPAIGN_LEVELS } from './data/gameConfig.js';
import { SaveSystem } from './core/SaveSystem.js';
import { AudioManager } from './core/AudioManager.js';
import { AssetManager } from './core/AssetManager.js';
import { FractureEngine } from './world/FractureEngine.js';
import { EffectsManager } from './world/EffectsManager.js';
import { CityGenerator } from './world/CityGenerator.js';
import { CrowdAndTraffic } from './entities/CrowdAndTraffic.js';
import { MilitaryDirector } from './entities/MilitaryDirector.js';
import { FinalBoss } from './entities/FinalBoss.js';
import { KaijuPlayer } from './entities/KaijuPlayer.js';
import { UIManager } from './ui/UIManager.js';

class PocketKaijuGame {
  constructor() {
    this.isPatchTest = new URLSearchParams(window.location.search).get('patch-test') === '1';
    this.patchTestTime = 0;
    this.passedChecks = new Set();

    this.save = new SaveSystem();
    this.audio = new AudioManager(this.save);
    this.assets = new AssetManager();

    this.state = 'loading'; // 'loading' | 'menu' | 'playing' | 'paused' | 'mutating' | 'victory_seq' | 'gameover'
    this.currentLevelDef = CAMPAIGN_LEVELS[0];

    // Run telemetry
    this.score = 0;
    this.runDna = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboMaxTime = 4.6;
    this.maxRunCombo = 0;
    this.runBuildingsDestroyed = 0;
    this.peakHeight = 7.4;
    this.startHeight = 7.4;
    this.victorySeqTimer = 0;

    // Input state
    this.keys = new Set();
    this.mouseNdc = new THREE.Vector2(0, 0);
    this.hasMouseMoved = false;
    this.leftMouseDown = false;
    this.rightMouseDown = false;
    this.middleMouseDown = false;
    this.lastMouseX = 0;

    // Camera rig state
    this.camYaw = 0;
    this.camZoom = 1.0;
    this.camCurrentPos = new THREE.Vector3(0, 32, 120);
    this.camCurrentLook = new THREE.Vector3(0, 5, 80);
    this.menuOrbitAngle = 0.45;

    // Ground raycaster for responsive cursor aiming
    this.raycaster = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.2);
    this.aimPoint = new THREE.Vector3(0, 1.2, 0);

    this.initRendererAndScene();
    this.createBootBackdrop();

    this.fracture = new FractureEngine(this.assets, this.scene);
    this.effects = new EffectsManager(this.scene, this.camera, document.getElementById('floating-popups'));
    this.city = new CityGenerator(this.assets, this.fracture, this.effects, this.audio, this.scene);
    this.traffic = new CrowdAndTraffic(this.assets, this.fracture, this.effects, this.audio, this.scene);
    this.military = new MilitaryDirector(this.assets, this.fracture, this.effects, this.audio, this.scene);
    this.boss = new FinalBoss(this.assets, this.fracture, this.effects, this.audio, this.military, this.scene);
    this.kaiju = new KaijuPlayer(this.assets, this.fracture, this.effects, this.audio, this.save, this.scene);

    // Menu 3D showcase actor handles
    this.menuShowcaseGroup = new THREE.Group();
    this.scene.add(this.menuShowcaseGroup);
    this.menuKaijuMixer = null;
    this.menuHeli = null;
    this.menuHeliAngle = 0;

    // Cursor aim reticle in 3D world
    this.reticle = this.createAimReticle();
    this.scene.add(this.reticle);

    this.ui = new UIManager(this.save, this.audio, {
      onStartOperation: (lvlId) => this.startOperation(lvlId),
      onSelectKaiju: (kaijuId) => this.spawnMenuShowcaseKaiju(kaijuId, true),
      onTogglePause: () => this.togglePause(),
      onResume: () => this.resumeGame(),
      onRestart: () => this.startOperation(this.currentLevelDef.id),
      onQuitToMenu: () => this.enterMainMenu(),
      onPickMutation: (mutId) => this.applyMutationChoice(mutId),
      onQualityChange: (q) => this.applyQuality(q)
    });

    this.applyQuality(this.save.data.settings.quality);
    this.bindInputListeners();

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));

    this.bootAssets();
  }

  initRendererAndScene() {
    const container = document.getElementById('canvas-container');
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x99d0f2, 0.0028);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.8, 1200);
    this.camera.position.set(0, 26, 95);
    this.camera.lookAt(0, 6, 40);

    const initQuality = this.save.data.settings.quality || 'high';
    this.renderer = new THREE.WebGLRenderer({
      antialias: initQuality !== 'low',
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = initQuality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Rich PBR environment reflections for glass skyscrapers, cars & mechs
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 0.26;
    pmrem.dispose();

    // Hemisphere + Directional Sun Light
    this.hemiLight = new THREE.HemisphereLight(0x9ad8ff, 0x2d3340, 1.05);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff3d6, 2.3);
    this.sunLight.position.set(65, 115, 75);
    this.sunLight.castShadow = initQuality !== 'low';
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 360;
    this.sunLight.shadow.bias = -0.0006;
    const d = 85;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
  }

  // Ensures even frame 0 during asset preload renders a sunlit ocean & sky gradient (never a flat single-color screen!)
  createBootBackdrop() {
    this.bootBackdrop = new THREE.Group();
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 32;
    skyCanvas.height = 256;
    const ctx = skyCanvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0b182e');
    g.addColorStop(0.55, '#1f4e78');
    g.addColorStop(1, '#39ff88');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 256);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 20, 14),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
    );
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshStandardMaterial({ color: 0x133b5c, roughness: 0.25, metalness: 0.65 })
    );
    sea.rotation.x = -Math.PI / 2;
    this.bootBackdrop.add(dome, sea);
    this.scene.add(this.bootBackdrop);
  }

  createAimReticle() {
    const grp = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(2.1, 2.55, 28),
      new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
    );
    outer.rotation.x = -Math.PI / 2;
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.8, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
    );
    inner.rotation.x = -Math.PI / 2;
    grp.add(outer, inner);
    grp.position.y = 0.24;
    grp.visible = false;
    grp.userData = { outer };
    return grp;
  }

  applyQuality(q) {
    const quality = q || 'high';
    const maxDpr = quality === 'low' ? 1.0 : quality === 'medium' ? 1.5 : 2.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.sunLight.castShadow = quality !== 'low';

    this.fracture.setQuality(quality);
    this.effects.setQuality(quality);
    this.traffic.setQuality(quality);
  }

  async bootAssets() {
    try {
      this.ui.setLoadingProgress(0.05, 'Initializing Bio-Atomic Containment Protocol...');

      await Promise.all([
        this.assets.preloadAllModels((p, key) => {
          this.ui.setLoadingProgress(0.05 + p * 0.72, `Loading 3D Assets: ${key}...`);
        }),
        this.audio.preloadAll((p) => {
          // Parallel WebAudio decode
          void p;
        })
      ]);

      this.ui.setLoadingProgress(0.84, 'Pre-Slicing 3D Voronoi Building Fractures...');
      // Yield one frame so progress bar paints cleanly before geometry Voronoi slicing
      await new Promise(r => setTimeout(r, 16));
      this.fracture.prefractureAllBuildings();

      this.ui.setLoadingProgress(1.0, 'KAIJU AWAKENED!');
      if (this.bootBackdrop) {
        this.scene.remove(this.bootBackdrop);
        this.bootBackdrop = null;
      }

      this.ui.hideLoading();

      if (this.isPatchTest) {
        this.startOperation(1);
      } else {
        this.enterMainMenu();
      }
    } catch (err) {
      console.error('Boot error:', err);
      this.ui.setLoadingProgress(1.0, 'Error loading assets — check console.');
    }
  }

  reportCheck(name) {
    if (this.passedChecks.has(name)) return;
    this.passedChecks.add(name);
    if (this.isPatchTest) {
      console.log(`pass ${name}`);
    }
  }

  applyLevelLighting(levelDef) {
    this.scene.fog = new THREE.FogExp2(levelDef.fogColor, levelDef.fogDensity);
    this.sunLight.color.setHex(levelDef.sunColor);
    this.sunLight.intensity = levelDef.sunIntensity * 0.72;
    this.hemiLight.color.setHex(levelDef.ambientColor);
    this.hemiLight.intensity = levelDef.ambientIntensity * 0.62;
  }

  // === LIVE 3D MAIN MENU DIORAMA ===
  enterMainMenu() {
    this.state = 'menu';
    this.reticle.visible = false;
    this.clearGameplayEntities();

    const menuLevel = CAMPAIGN_LEVELS[2]; // Dramatic downtown & suburban skyline for menu!
    this.applyLevelLighting(CAMPAIGN_LEVELS[0]);
    this.city.buildCity(menuLevel);
    this.traffic.populate(this.city);

    // Spawn live selected Kaiju roaring in the central plaza + circling helicopter!
    this.spawnMenuShowcaseKaiju(this.save.data.selectedKaiju, false);

    this.audio.playMusic('menu');
    this.ui.showMainMenu();
  }

  spawnMenuShowcaseKaiju(kaijuId, roarOnSwap = false) {
    while (this.menuShowcaseGroup.children.length > 0) {
      this.menuShowcaseGroup.remove(this.menuShowcaseGroup.children[0]);
    }
    this.menuKaijuMixer = null;
    this.menuHeli = null;

    const kDef = KAIJU_ROSTER.find(k => k.id === kaijuId) || KAIJU_ROSTER[0];
    const showcasePos = new THREE.Vector3(0, 0, this.city.halfExtent - 28);

    // Clear foreground plaza around & in front of the showcase spot so camera never clips behind a building!
    for (const b of this.city.buildings) {
      const inPlaza = Math.hypot(b.x - showcasePos.x, b.z - showcasePos.z) < 26;
      const inCameraCorridor = Math.abs(b.x - showcasePos.x) < 24 && b.z > showcasePos.z - 6 && b.z < showcasePos.z + 48;
      if (!b.destroyed && (inPlaza || inCameraCorridor)) {
        b.destroyed = true;
        this.city.cityGroup.remove(b.mesh);
      }
    }

    const kMesh = this.assets.instantiate(kDef.modelKey);
    kMesh.position.copy(showcasePos);
    kMesh.rotation.y = 0.25;
    kMesh.scale.setScalar(19.0);
    this.menuShowcaseGroup.add(kMesh);

    this.menuKaijuMixer = new THREE.AnimationMixer(kMesh.userData.innerModel);
    const clips = kMesh.userData.animations || [];
    const idleClip = clips.find(c => c.name === kDef.clips.idle) || clips[0];
    const roarClip = clips.find(c => c.name === kDef.clips.roar) || idleClip;

    if (idleClip) {
      const idleAct = this.menuKaijuMixer.clipAction(idleClip);
      idleAct.play();
      if (roarOnSwap && roarClip) {
        const roarAct = this.menuKaijuMixer.clipAction(roarClip);
        roarAct.reset().setLoop(THREE.LoopOnce, 1);
        roarAct.clampWhenFinished = false;
        roarAct.play();
        this.effects.spawnShockwave(showcasePos, 28, kDef.glowHex, 0.65);
        this.audio.play('evolveZap', { volume: 0.65, pitch: 0.9 });
      }
    }

    // Orbiting news/military helicopter in menu background
    const heli = this.assets.instantiate('helicopter');
    heli.position.set(showcasePos.x + 24, 24, showcasePos.z + 18);
    this.menuShowcaseGroup.add(heli);
    this.menuHeli = heli;
    this.menuShowcaseOrigin = showcasePos;
  }

  clearGameplayEntities() {
    while (this.menuShowcaseGroup.children.length > 0) {
      this.menuShowcaseGroup.remove(this.menuShowcaseGroup.children[0]);
    }
    this.menuKaijuMixer = null;
    this.menuHeli = null;

    this.kaiju.clear();
    this.boss.clear();
    this.military.clear();
    this.traffic.clear();
    this.fracture.clear();
    this.effects.clear();
    this.city.clear();
  }

  // === START CAMPAIGN / SANDBOX OPERATION ===
  startOperation(levelId) {
    const levelDef = CAMPAIGN_LEVELS.find(l => l.id === levelId) || CAMPAIGN_LEVELS[0];
    this.currentLevelDef = levelDef;
    this.clearGameplayEntities();
    this.applyLevelLighting(levelDef);

    // Build procedural-zoned 3D GLB city!
    this.city.buildCity(levelDef);
    this.traffic.populate(this.city);
    this.military.reset(levelDef, this.city);

    const kaijuId = this.save.data.selectedKaiju || 'rex';
    const kaijuDef = KAIJU_ROSTER.find(k => k.id === kaijuId) || KAIJU_ROSTER[0];
    this.kaiju.spawn(kaijuId, this.city.spawnPos, levelDef.startBiomass || 0);

    if (levelDef.hasBoss) {
      this.boss.spawn(this.city);
    }

    // Reset run counters
    this.score = 0;
    this.runDna = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxRunCombo = 0;
    this.runBuildingsDestroyed = 0;
    this.startHeight = this.kaiju.currentHeight;
    this.peakHeight = this.kaiju.currentHeight;
    this.victorySeqTimer = 0;

    // Snap camera cleanly behind Kaiju looking North (-Z) into the city skyline!
    this.camYaw = 0;
    this.camZoom = 1.0;
    const sc = this.kaiju.sizeClass;
    this.camCurrentPos.set(
      this.kaiju.position.x,
      sc.camHeight,
      this.kaiju.position.z + sc.camDist
    );
    this.camCurrentLook.set(
      this.kaiju.position.x,
      this.kaiju.currentHeight * 0.48,
      this.kaiju.position.z - 8
    );

    this.reticle.visible = !this.isPatchTest;
    this.reticle.userData.outer.material.color.setHex(kaijuDef.glowHex);

    this.state = 'playing';
    this.ui.showHud(levelDef, kaijuDef);
    this.audio.playMusic(levelDef.music);
    this.audio.play('voBegin', { volume: 0.75, cooldownMs: 500 });

    if (!this.isPatchTest) {
      this.ui.triggerBanner(
        `${levelDef.code}: ${levelDef.name}`,
        levelDef.hasBoss ? 'DESTROY THE 3 SHIELD PYLONS & DEFEAT AEGIS-ZERO!' : `${levelDef.subtitle.toUpperCase()} — DEVOUR THE CITY TO GROW!`,
        kaijuDef.accentColor
      );
    }

    this.reportCheck('game-loaded');
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.audio.setBeamActive(false);
      this.ui.showPause(true);
    } else if (this.state === 'paused') {
      this.resumeGame();
    }
  }

  resumeGame() {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.ui.showPause(false);
    }
  }

  applyMutationChoice(mutId) {
    this.kaiju.applyMutation(mutId);
    if (this.state === 'mutating') {
      this.state = 'playing';
    }
  }

  addComboAndScore(baseScore) {
    this.combo++;
    this.comboTimer = this.comboMaxTime;
    if (this.combo > this.maxRunCombo) this.maxRunCombo = this.combo;
    if (this.combo > this.save.data.stats.maxCombo) {
      this.save.data.stats.maxCombo = this.combo;
      this.save.checkAchievements();
    }
    const mult = 1 + Math.min(4.0, (this.combo - 1) * 0.12);
    this.score += Math.round(baseScore * mult);
  }

  grantGrowthAndDna(rawBiomass, rawDna) {
    const magRank = this.save.getUpgradeRank('magnet');
    const dnaGain = rawDna * (1 + magRank * 0.18);
    this.runDna += dnaGain;

    this.kaiju.addBiomass(rawBiomass, (newSizeClass) => {
      // Size Class Evolution Milestone!!
      if (newSizeClass.tier === 2 || newSizeClass.tier === 3) {
        this.ui.setNewsCategory('growing');
      } else if (newSizeClass.tier >= 4) {
        this.ui.setNewsCategory('giant');
      }

      if (!this.isPatchTest) {
        this.ui.triggerBanner(
          `EVOLUTION! ${newSizeClass.name} (${newSizeClass.heightMeters}m)`,
          'NEW TRAMPLE TIER UNLOCKED — CHOOSE A GENETIC MUTATION!',
          this.kaiju.kaijuDef.accentColor
        );
      }

      const openedModal = this.ui.showMutationDraft(this.kaiju, this.isPatchTest);
      if (openedModal) {
        this.state = 'mutating';
        this.audio.setBeamActive(false);
      }
    });

    if (this.kaiju.currentHeight > this.peakHeight) {
      this.peakHeight = this.kaiju.currentHeight;
    }
    if (this.kaiju.targetHeight > this.startHeight + 0.6) {
      this.reportCheck('kaiju-grew');
    }
  }

  makeGameCallbacks() {
    const shockRank = this.save.getUpgradeRank('chainShock');
    const aftershockDamage = shockRank * 26 + (this.kaiju.mutations.has('domino_collapse') ? 45 : 0);

    return {
      aftershockDamage,

      onBuildingDestroyed: (b) => {
        this.runBuildingsDestroyed++;
        this.save.data.stats.buildingsDestroyed++;
        if (b.tier >= 4) this.save.data.stats.skyscrapersDestroyed++;
        if (b.modelKey === 'fuel_tank') this.save.data.stats.fuelTanksDetonated++;
        this.save.checkAchievements();

        this.addComboAndScore(b.score);
        this.kaiju.healFromSiphon(4.2);

        // Grant 65% immediately for snappy growth + 35% as magnetic glowing Bio-Orbs!
        this.grantGrowthAndDna(b.biomass * 0.65, b.dna * 0.65);
        this.effects.spawnBioOrbs(
          new THREE.Vector3(b.x, 2.0, b.z),
          b.biomass * 0.35,
          b.dna * 0.35,
          this.kaiju.kaijuDef.glowHex
        );

        const popupPos = new THREE.Vector3(b.x, Math.min(18, b.dims.y * 0.75), b.z);
        if (b.isObjectiveLandmark) {
          this.effects.spawnFloatingText(popupPos, '★ TARGET OBLITERATED! ★', '#ffd166', true);
        } else if (b.tier >= 4) {
          this.effects.spawnFloatingText(popupPos, `SKYSCRAPER FELLED! +${b.score}`, '#39ff88', true);
        } else {
          this.effects.spawnFloatingText(popupPos, `+${b.score}`, '#a8ffcf', false);
        }

        // Escalate DEFCON threat as city falls
        const stats = this.city.getStats();
        const escalated = this.military.updateEscalation(stats.pct, this.kaiju.sizeClass.tier);
        if (escalated && !this.isPatchTest) {
          const stars = this.military.getThreatStars();
          this.ui.triggerBanner(
            `⚠️ MILITARY ESCALATION: DEFCON ${6 - stars}`,
            stars >= 4 ? 'FIGHTER JETS & HEAVY BATTALIONS SCRAMBLED!' : 'ARMORED TANKS & HELICOPTERS INBOUND!',
            '#ff4d6d'
          );
        }

        this.reportCheck('building-crumbled');
      },

      onExplosionArea: (x, z, radius, dmg) => {
        const pos = new THREE.Vector3(x, 3, z);
        this.military.damageArea(pos, radius, dmg, this.makeSimpleEnemyCallbacks(), true);
        if (this.boss.active && !this.boss.dead && this.boss.mesh) {
          if (Math.hypot(this.boss.mesh.position.x - x, this.boss.mesh.position.z - z) <= radius + 6) {
            this.boss.takeDamage(dmg, this.city, null, () => this.onBossDefeatedStart());
          }
        }
      },

      onVehicleDestroyed: (pos) => {
        this.addComboAndScore(140);
        this.grantGrowthAndDna(5.5, 2.5);
        this.kaiju.healFromSiphon(1.5);
        this.effects.spawnFloatingText(pos.clone().add(new THREE.Vector3(0, 2.5, 0)), '+140', '#ffd166', false);
      },

      onCivilianSquished: () => {
        this.score += 50;
        this.grantGrowthAndDna(1.5, 0.5);
      },

      checkProjectileHitEnemies: (pos, radius, dmg) => {
        const hits = this.military.damageArea(pos, radius, dmg, this.makeSimpleEnemyCallbacks(), true);
        if (hits > 0) return true;
        if (this.boss.active && !this.boss.dead && this.boss.mesh) {
          const bCenter = this.boss.mesh.position.clone().add(new THREE.Vector3(0, this.boss.height * 0.5, 0));
          if (pos.distanceTo(bCenter) <= radius + 6.5) {
            this.boss.takeDamage(dmg, this.city, null, () => this.onBossDefeatedStart());
            return true;
          }
        }
        return false;
      },

      onMilitaryDestroyed: (u, pos) => this.handleMilitaryKilled(u, pos),

      onAllPylonsDestroyed: () => {
        this.save.unlockAchievement('shield_breaker');
        this.ui.triggerBanner(
          '⚡ QUANTUM SHIELD SHATTERED! ⚡',
          'PROJECT AEGIS-ZERO IS VULNERABLE — UNLEASH EVERYTHING!',
          '#38d6ff'
        );
      },

      onBossDefeated: () => this.onBossDefeatedStart(),
      onBossDeathFinished: () => this.finishOperation(true)
    };
  }

  makeSimpleEnemyCallbacks() {
    return {
      onMilitaryDestroyed: (u, pos) => this.handleMilitaryKilled(u, pos)
    };
  }

  handleMilitaryKilled(u, pos) {
    if (u.type === 'tank') this.save.data.stats.tanksDestroyed++;
    if (u.type === 'heli') this.save.data.stats.helisDestroyed++;
    this.save.checkAchievements();

    this.addComboAndScore(u.score);
    this.kaiju.healFromSiphon(6.5);
    this.grantGrowthAndDna(u.biomass * 0.5, u.dna * 0.5);
    this.effects.spawnBioOrbs(pos, u.biomass * 0.5, u.dna * 0.5, 0x38d6ff);

    const label = u.type === 'heli' ? 'CHOPPER SWATTED!' : u.type === 'mech' ? 'MECH OBLITERATED!' : u.type === 'tank' ? 'TANK CRUSHED!' : 'TURRET SMASHED!';
    this.effects.spawnFloatingText(pos.clone().add(new THREE.Vector3(0, 4, 0)), `${label} +${u.score}`, '#38d6ff', u.type === 'mech');
  }

  onBossDefeatedStart() {
    this.save.data.stats.bossDefeated = true;
    this.save.checkAchievements();
    this.score += 25000;
    this.runDna += 180;
    this.ui.triggerBanner(
      '👑 PROJECT AEGIS-ZERO DESTROYED! 👑',
      'HUMANITY FALLS — YOU ARE KING OF THE MONSTERS!',
      '#ffd166'
    );
  }

  checkOperationConditions() {
    if (this.state !== 'playing') return;

    // Check Defeat
    if (this.kaiju.hp <= 0) {
      this.finishOperation(false);
      return;
    }

    const stats = this.city.getStats();

    // Endless Mode: If 90% of buildings are flattened, repopulate fresh urban district blocks so rampage never ends!
    if (this.currentLevelDef.endless) {
      if (stats.pct >= 90) {
        this.city.buildCity(this.currentLevelDef);
        this.ui.triggerBanner('NEW METRO SECTOR REACHED!', 'FRESH SKYSCRAPERS TO DEVOUR!', '#39ff88');
      }
      return;
    }

    // Boss Level: Win is triggered via Boss death sequence!
    if (this.currentLevelDef.hasBoss) {
      return;
    }

    // Standard Campaign Operations (OP-01..OP-03): Complete when Target Destruction % & Landmarks are met!
    if (stats.pct >= this.currentLevelDef.targetDestructionPct && stats.landmarksLeft === 0) {
      this.state = 'victory_seq';
      this.victorySeqTimer = 1.35;
      this.audio.setBeamActive(false);
      this.kaiju.playAnim('roar', true, 0.95);
      this.audio.play('voVictory', { volume: 0.9, cooldownMs: 500 });
      this.effects.spawnShockwave(this.kaiju.position, 42, this.kaiju.kaijuDef.glowHex, 0.8);
      this.ui.triggerBanner('OPERATION COMPLETE!', 'DISTRICT CONQUERED!', '#39ff88');
    }
  }

  finishOperation(victory) {
    this.state = 'gameover';
    this.reticle.visible = false;
    this.audio.setBeamActive(false);

    if (!victory) {
      this.audio.play('voGameOver', { volume: 0.85, cooldownMs: 500 });
      this.effects.spawnExplosion(this.kaiju.position.clone().add(new THREE.Vector3(0, 6, 0)), 2.5, 0xff3344, true);
    }

    const stats = this.city.getStats();
    const bonusDna = victory ? (this.currentLevelDef.rewardBonusDna || 100) : 0;
    const totalDna = Math.round(this.runDna + bonusDna);
    this.save.addDna(totalDna);

    let stars = 0;
    if (victory) {
      const hpRatio = this.kaiju.hp / this.kaiju.maxHp;
      stars = 1;
      if (hpRatio >= 0.42 || this.maxRunCombo >= 10) stars = 2;
      if (hpRatio >= 0.62 && (stats.pct >= this.currentLevelDef.targetDestructionPct + 8 || this.maxRunCombo >= 15 || this.currentLevelDef.hasBoss)) {
        stars = 3;
      }
      this.save.completeLevel(this.currentLevelDef.id, stars, this.score);
    } else {
      this.save.save();
    }

    this.ui.showResultScreen({
      victory,
      levelDef: this.currentLevelDef,
      score: this.score,
      runDna: this.runDna,
      bonusDna,
      stars,
      destructionPct: stats.pct,
      peakHeight: Math.max(this.peakHeight, this.kaiju.currentHeight),
      maxCombo: this.maxRunCombo,
      buildingsDestroyed: this.runBuildingsDestroyed
    });
  }

  // === INPUT BINDINGS ===
  bindInputListeners() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Respect Patch platform live quality switching
    window.addEventListener('qualitychange', (e) => {
      const q = e.detail?.quality || window.patch?.quality || 'high';
      this.save.data.settings.quality = q;
      this.applyQuality(q);
    });

    // Auto-pause on window blur (skip in ?patch-test=1 headless runner!)
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.leftMouseDown = false;
      this.rightMouseDown = false;
      this.middleMouseDown = false;
      if (!this.isPatchTest && this.state === 'playing') {
        this.togglePause();
      }
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);

      if (e.code === 'KeyP' || e.code === 'Tab' || e.code === 'Escape') {
        if (e.code === 'Tab') e.preventDefault();
        if (this.state === 'playing' || this.state === 'paused') {
          this.togglePause();
          return;
        }
        if (this.state === 'menu' && this.ui.activeModal) {
          this.ui.closeModal();
          return;
        }
      }

      if (this.state !== 'playing') return;

      const callbacks = this.makeGameCallbacks();
      if (e.code === 'Space') {
        e.preventDefault();
        this.kaiju.triggerPrimarySmash(this.getEffectiveAim(), this.city, this.traffic, this.military, this.boss, callbacks);
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.kaiju.triggerLeapSlam(this.getEffectiveAim(), this.city);
      } else if (e.code === 'KeyF') {
        const kicked = this.kaiju.triggerVehicleKick(this.getEffectiveAim(), this.traffic, this.military);
        if (!kicked) {
          // Fallback to Primary Smash if no vehicle is adjacent so F always feels responsive!
          this.kaiju.triggerPrimarySmash(this.getEffectiveAim(), this.city, this.traffic, this.military, this.boss, callbacks);
        }
      } else if (e.code === 'KeyR') {
        this.kaiju.triggerUltimate(this.city, this.traffic, this.military, this.boss, callbacks);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
      this.mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.hasMouseMoved = true;

      if (this.middleMouseDown) {
        const dx = e.clientX - this.lastMouseX;
        this.camYaw -= dx * 0.0065;
      }
      this.lastMouseX = e.clientX;
    });

    canvas.addEventListener('pointerdown', (e) => {
      this.lastMouseX = e.clientX;
      this.mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this.hasMouseMoved = true;

      if (e.button === 0) {
        this.leftMouseDown = true;
        if (this.state === 'playing') {
          this.updateAimRay();
          this.kaiju.triggerPrimarySmash(this.aimPoint, this.city, this.traffic, this.military, this.boss, this.makeGameCallbacks());
        }
      } else if (e.button === 2) {
        this.rightMouseDown = true;
      } else if (e.button === 1) {
        this.middleMouseDown = true;
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.leftMouseDown = false;
      else if (e.button === 2) this.rightMouseDown = false;
      else if (e.button === 1) this.middleMouseDown = false;
    });

    canvas.addEventListener('wheel', (e) => {
      if (this.state === 'playing') {
        this.camZoom = THREE.MathUtils.clamp(this.camZoom + Math.sign(e.deltaY) * 0.08, 0.72, 1.38);
      }
    }, { passive: true });
  }

  updateAimRay() {
    if (!this.hasMouseMoved) {
      this.aimPoint.set(
        this.kaiju.position.x + Math.sin(this.kaiju.facingYaw) * 28,
        1.2,
        this.kaiju.position.z + Math.cos(this.kaiju.facingYaw) * 28
      );
      return;
    }
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.aimPlane, hit)) {
      this.aimPoint.copy(hit);
    }
    this.reticle.position.set(this.aimPoint.x, 0.25, this.aimPoint.z);
    const s = 0.8 + (this.kaiju.currentHeight - 7.4) * 0.04;
    this.reticle.scale.setScalar(s);
  }

  getEffectiveAim() {
    return this.hasMouseMoved ? this.aimPoint : null;
  }

  computeMoveVector(dt) {
    // Camera-yaw orbit keys Q / C
    if (this.keys.has('KeyQ')) this.camYaw += 1.65 * dt;
    if (this.keys.has('KeyC')) this.camYaw -= 1.65 * dt;

    let fwd = 0;
    let right = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right -= 1;

    // Automated ?patch-test=1 self-play driver (yields cleanly around Patch's 7.5s / 27.5s move_keys windows!)
    if (this.isPatchTest && fwd === 0 && right === 0) {
      const cycle = this.patchTestTime % 20;
      const inMoveKeysObservationWindow = cycle >= 5.2 && cycle <= 12.6;
      if (!inMoveKeysObservationWindow) {
        // Steer toward nearest standing building and smash it!
        let targetB = null;
        let bestD = Infinity;
        for (const b of this.city.buildings) {
          if (b.destroyed) continue;
          const d = Math.hypot(b.x - this.kaiju.position.x, b.z - this.kaiju.position.z);
          if (d < bestD) {
            bestD = d;
            targetB = b;
          }
        }
        if (targetB) {
          const dx = targetB.x - this.kaiju.position.x;
          const dz = targetB.z - this.kaiju.position.z;
          const len = Math.hypot(dx, dz) || 1;
          if (bestD < this.kaiju.getFootRadius() + targetB.radius + 7.5) {
            this.kaiju.triggerPrimarySmash(
              new THREE.Vector3(targetB.x, 1, targetB.z),
              this.city,
              this.traffic,
              this.military,
              this.boss,
              this.makeGameCallbacks()
            );
          }
          return new THREE.Vector3(dx / len, 0, dz / len);
        }
      }
      return new THREE.Vector3(0, 0, 0);
    }

    if (fwd === 0 && right === 0) return new THREE.Vector3(0, 0, 0);

    // Transform camera-space forward/right onto XZ world plane
    const fwdX = -Math.sin(this.camYaw);
    const fwdZ = -Math.cos(this.camYaw);
    const rightX = Math.cos(this.camYaw);
    const rightZ = -Math.sin(this.camYaw);

    const out = new THREE.Vector3(
      fwdX * fwd + rightX * right,
      0,
      fwdZ * fwd + rightZ * right
    );
    if (out.lengthSq() > 0.001) out.normalize();
    return out;
  }

  updateCameraAndSun(dt) {
    const sc = this.kaiju.sizeClass;
    const heightRatio = (this.kaiju.currentHeight - 7.4) / (40.0 - 7.4);
    const clampedRatio = THREE.MathUtils.clamp(heightRatio, 0, 1.25);

    const desiredDist = THREE.MathUtils.lerp(28, 96, clampedRatio) * this.camZoom;
    const desiredHeight = THREE.MathUtils.lerp(21, 70, clampedRatio) * this.camZoom;
    const desiredFov = THREE.MathUtils.lerp(50, 62, Math.min(1, clampedRatio));

    if (Math.abs(this.camera.fov - desiredFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, desiredFov, 3 * dt);
      this.camera.updateProjectionMatrix();
    }

    const offsetX = Math.sin(this.camYaw) * desiredDist;
    const offsetZ = Math.cos(this.camYaw) * desiredDist;

    const targetCamPos = new THREE.Vector3(
      this.kaiju.position.x + offsetX,
      desiredHeight + this.kaiju.jumpHeight * 0.35,
      this.kaiju.position.z + offsetZ
    );
    const lookAheadX = -Math.sin(this.camYaw) * (6 + this.kaiju.currentHeight * 0.25);
    const lookAheadZ = -Math.cos(this.camYaw) * (6 + this.kaiju.currentHeight * 0.25);
    const targetLook = new THREE.Vector3(
      this.kaiju.position.x + lookAheadX,
      this.kaiju.currentHeight * 0.45 + this.kaiju.jumpHeight * 0.4,
      this.kaiju.position.z + lookAheadZ
    );

    this.camCurrentPos.lerp(targetCamPos, Math.min(1, 6.5 * dt));
    this.camCurrentLook.lerp(targetLook, Math.min(1, 8.5 * dt));

    // Apply tectonic screen shake!
    const shakeSetting = this.save.data.settings.screenShake ?? 1.0;
    const shakeMag = Math.pow(this.effects.shakeTrauma, 1.6) * 2.4 * shakeSetting;
    const sx = (Math.random() - 0.5) * 2 * shakeMag;
    const sy = (Math.random() - 0.5) * 2 * shakeMag;
    const sz = (Math.random() - 0.5) * 2 * shakeMag;

    this.camera.position.set(
      this.camCurrentPos.x + sx,
      Math.max(4, this.camCurrentPos.y + sy),
      this.camCurrentPos.z + sz
    );
    this.camera.lookAt(this.camCurrentLook);

    // Keep Directional Sun shadow frustum centered around the Kaiju!
    const snapX = Math.round(this.kaiju.position.x / 4) * 4;
    const snapZ = Math.round(this.kaiju.position.z / 4) * 4;
    this.sunLight.target.position.set(snapX, 0, snapZ);
    this.sunLight.position.set(snapX + 65, 115 + this.kaiju.currentHeight, snapZ + 75);
  }

  updateMenuDiorama(dt) {
    this.city.update(dt);
    this.effects.update(dt, null, 0, null);
    if (this.menuKaijuMixer) this.menuKaijuMixer.update(dt);

    if (this.menuHeli && this.menuShowcaseOrigin) {
      this.menuHeliAngle += 0.45 * dt;
      const hx = this.menuShowcaseOrigin.x + Math.cos(this.menuHeliAngle) * 28;
      const hz = this.menuShowcaseOrigin.z + Math.sin(this.menuHeliAngle) * 24;
      this.menuHeli.position.set(hx, 23 + Math.sin(this.menuHeliAngle * 2) * 1.5, hz);
      this.menuHeli.lookAt(this.menuShowcaseOrigin.x, 12, this.menuShowcaseOrigin.z);
      this.menuHeli.traverse((n) => {
        if (n.name === 'rotor-main') n.rotation.y += 25 * dt;
        if (n.name === 'rotor-tail') n.rotation.x += 30 * dt;
      });
    }

    if (this.menuShowcaseOrigin) {
      this.menuOrbitAngle += 0.14 * dt;
      const swayAngle = Math.sin(this.menuOrbitAngle) * 0.22 + 0.14;
      const isRoster = this.ui.activeModal === 'roster';
      const dist = isRoster ? 33 : 36;
      const height = isRoster ? 15 : 18;
      // Shift look target slightly left so Kaiju stands prominently on the right side of the screen!
      const sideShift = isRoster ? 4 : -7;

      const desiredPos = new THREE.Vector3(
        this.menuShowcaseOrigin.x + Math.sin(swayAngle) * dist,
        height,
        this.menuShowcaseOrigin.z + Math.cos(swayAngle) * dist
      );
      const desiredLook = new THREE.Vector3(
        this.menuShowcaseOrigin.x + sideShift,
        10.5,
        this.menuShowcaseOrigin.z - 4
      );
      this.camera.position.lerp(desiredPos, Math.min(1, 3.5 * dt));
      this.camCurrentLook.lerp(desiredLook, Math.min(1, 4.0 * dt));
      this.camera.lookAt(this.camCurrentLook);
    }
  }

  // === MAIN GAME LOOP ===
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (this.state === 'loading') {
      if (this.bootBackdrop) this.bootBackdrop.rotation.y += 0.12 * rawDt;
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === 'menu') {
      this.updateMenuDiorama(rawDt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === 'paused' || this.state === 'mutating' || this.state === 'gameover') {
      // Keep rendering the live 3D scene smoothly behind pause / mutation / victory overlays!
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.isPatchTest) {
      this.patchTestTime += rawDt;
    }

    // Hit-stop impact freeze-frames for juicy skyscraper collapses & Boss hits!
    if (this.effects.hitStopTimer > 0) {
      this.effects.hitStopTimer -= rawDt;
      this.updateCameraAndSun(rawDt * 0.25);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const dt = this.state === 'victory_seq' ? rawDt * 0.45 : rawDt;
    const callbacks = this.makeGameCallbacks();

    if (this.state === 'playing') {
      this.updateAimRay();

      // Hold LMB to repeat Primary Smash smoothly!
      if (this.leftMouseDown && this.kaiju.attackCooldown <= 0) {
        this.kaiju.triggerPrimarySmash(this.aimPoint, this.city, this.traffic, this.military, this.boss, callbacks);
      }

      const moveVec = this.computeMoveVector(dt);
      const secondaryHeld = this.rightMouseDown || this.keys.has('KeyE');

      this.kaiju.update(
        dt,
        moveVec,
        this.getEffectiveAim(),
        secondaryHeld,
        this.city,
        this.traffic,
        this.military,
        this.boss,
        callbacks
      );

      this.traffic.update(dt, this.kaiju, callbacks);
      this.military.update(dt, this.kaiju, callbacks);
      if (this.boss.active) {
        this.boss.update(dt, this.kaiju, this.city, callbacks);
      }

      // Combo decay
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) {
          this.combo = 0;
        }
      }

      this.checkOperationConditions();
    } else if (this.state === 'victory_seq') {
      this.kaiju.mixer?.update(dt);
      this.victorySeqTimer -= rawDt;
      if (this.victorySeqTimer <= 0) {
        this.finishOperation(true);
      }
    }

    this.city.update(dt);
    this.fracture.update(dt);
    this.effects.update(
      dt,
      this.kaiju.position,
      this.kaiju.getMagnetRadius(),
      (bio, dna) => {
        this.grantGrowthAndDna(bio, dna);
        this.audio.play('uiClick', { volume: 0.25, pitch: 1.45 + Math.random() * 0.35, cooldownMs: 55 });
      }
    );

    this.updateCameraAndSun(rawDt);

    if (this.state === 'playing' || this.state === 'victory_seq') {
      this.ui.updateHud({
        kaiju: this.kaiju,
        cityStats: this.city.getStats(),
        levelDef: this.currentLevelDef,
        score: this.score,
        runDna: this.runDna,
        combo: this.combo,
        comboTimer: this.comboTimer,
        comboMaxTime: this.comboMaxTime,
        threatStars: this.military.getThreatStars(),
        boss: this.boss
      });
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__pocketKaiju = new PocketKaijuGame();
});

// Pocket Kaiju - boot, app state machine, input, render loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadAll, A } from './assets.js';
import { AudioSys } from './audio.js';
import { FX } from './fx.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { LEVELS, ENDLESS, KAIJU, UPGRADES, MAX_TIER, upgradeCost, tier, loadSave, storeSave, kaijuUnlocked } from './data.js';
import { clamp } from './util.js';

const QUALITY = {
  low: { pr: 0.8, shadows: false, shadowSize: 1024, particles: 1600, debris: 90, rubble: 250, fires: 8, crowd: 0.5, crowdShadows: false, trees: 260, bloom: false },
  medium: { pr: 1, shadows: true, shadowSize: 2048, particles: 3200, debris: 170, rubble: 450, fires: 14, crowd: 0.8, crowdShadows: false, trees: 520, bloom: false },
  high: { pr: 1.5, shadows: true, shadowSize: 4096, particles: 5200, debris: 260, rubble: 700, fires: 22, crowd: 1, crowdShadows: true, trees: 820, bloom: true },
};

const MENU_LEVEL = Object.assign({}, ENDLESS, {
  id: 'menu', menuSize: 74, people: 90, cars: 26,
  map: ['cCCCCc', 'CssssC', 'Cs1sCC', 'CCssCp', 'CssCsC', 'cCCCCc'],
  landmarks: { 1: 'clock' }, bScale: 2.4, towerStretch: 1.2, endless: false, goal: 1,
});

class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseL = false; this.mouseR = false; this.clickL = false;
    this.accX = 0; this.accY = 0;
    this.lookX = 0; this.lookY = 0; this.keyLook = 0;
    this.moveX = 0; this.moveZ = 0;
    this.sprint = false; this.breath = false;
    this.attackPressed = false; this.stompPressed = false; this.roarPressed = false; this.ragePressed = false; this.anyKey = false;
    this.locked = false;
    this.enabled = false;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseL = this.mouseR = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { this.mouseL = true; this.clickL = true; }
      if (e.button === 2) this.mouseR = true;
      if (!this.locked && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* */ } }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseL = false; if (e.button === 2) this.mouseR = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || e.buttons) { this.accX += e.movementX || 0; this.accY += e.movementY || 0; }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.onUnlock) this.onUnlock();
    });
  }
  frame() {
    const k = this.keys, p = this.pressed;
    this.moveX = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.moveZ = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    this.breath = this.mouseR || k.has('KeyE') || k.has('KeyK');
    this.attackPressed = this.clickL || p.has('KeyF') || p.has('KeyJ');
    this.stompPressed = p.has('Space');
    this.roarPressed = p.has('KeyQ');
    this.ragePressed = p.has('KeyR');
    this.anyKey = p.size > 0 || this.clickL;
    this.keyLook = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    this.lookX = this.accX; this.lookY = this.accY + ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * 6;
    this.accX = this.accY = 0;
  }
  end() { this.pressed.clear(); this.clickL = false; }
}

const G = {
  time: 0, wind: new THREE.Vector3(1, 0, 0.5), save: loadSave(),
  player: null, world: null, units: null, level: null, camRig: null,
  noInput: { moveX: 0, moveZ: 0, sprint: false, breath: false, attackPressed: false, stompPressed: false, roarPressed: false, ragePressed: false, anyKey: false, lookX: 0, lookY: 0, keyLook: 0 },
};
G.levels = LEVELS;
window.__pk = G;

class App {
  constructor() {
    this.state = 'boot';
    this.paused = false;
    this.busy = false;
    this.prScale = 1; this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
  }

  async boot() {
    const canvas = document.getElementById('c');
    const bar = document.getElementById('load-bar'), txt = document.getElementById('load-txt');
    G.quality = QUALITY[G.save.settings.quality] || QUALITY.high;
    const renderer = (G.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    G.scene = new THREE.Scene();
    G.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 1, 4500);
    G.input = new Input(canvas);
    G.input.onUnlock = () => { if (this.state === 'game' && !this.paused && (G.game.state === 'play' || G.game.state === 'intro')) this.pause(); };
    G.audio = new AudioSys(G.save.settings);
    G.app = this;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || (e.code === 'Escape' && !G.input.locked)) {
        if (this.state === 'game' && (G.game.state === 'play' || G.game.state === 'intro')) { if (this.paused) { if (G.ui.screen === 'pause') this.resume(); else G.ui.show('pause'); } else this.pause(); }
        else if (this.state === 'menu' && G.ui.screen && G.ui.screen !== 'title' && e.code === 'Escape') G.ui.act('back');
      }
      if (e.code === 'KeyM') { const s = G.save.settings; s._m = s._m === undefined ? s.master : s._m; s.master = s.master > 0 ? 0 : s._m || 0.8; G.audio.applyVolumes(); }
    });
    const unlock = () => G.audio.unlock();
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);

    await loadAll((f) => { bar.style.width = Math.round(f * 88) + '%'; txt.textContent = 'HATCHING... ' + Math.round(f * 88) + '%'; });
    txt.textContent = 'TUNING ROARS...'; bar.style.width = '92%';
    await G.audio.init(A.audio);
    G.fx = new FX(G);
    G.ui = new UI(G);
    G.game = new Game(G);
    this.setupComposer();
    txt.textContent = 'BUILDING A CITY TO BREAK...'; bar.style.width = '96%';
    await this.toMenu(true, true);
    bar.style.width = '100%';
    document.getElementById('loading').classList.add('gone');
    setTimeout(() => { const l = document.getElementById('loading'); if (l) l.remove(); }, 900);
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      const rawDt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
      last = now;
      this.tick(rawDt);
    };
    requestAnimationFrame(frame);
  }

  setupComposer() {
    const q = G.quality;
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    G.renderer.shadowMap.enabled = q.shadows;
    if (q.bloom) {
      const size = G.renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      const comp = new EffectComposer(G.renderer, rt);
      comp.addPass(new RenderPass(G.scene, G.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
      comp.addPass(this.bloom);
      comp.addPass(new OutputPass());
      this.composer = comp;
    }
    this.resize();
  }

  resize() {
    const q = G.quality;
    const patchPr = window.devicePixelRatio || 1;
    const pr = Math.min(patchPr, q.pr) * this.prScale;
    G.renderer.setPixelRatio(pr);
    G.renderer.setSize(innerWidth, innerHeight, false);
    G.camera.aspect = innerWidth / innerHeight;
    G.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(innerWidth, innerHeight); }
  }

  applySettings() {
    const s = G.save.settings;
    G.audio.applyVolumes();
    const q = QUALITY[s.quality] || QUALITY.high;
    if (q !== G.quality) {
      G.quality = q;
      this.prScale = 1;
      this.setupComposer();
      if (G.world && G.world.sun) G.world.sun.castShadow = q.shadows;
    }
  }

  async toMenu(showTitle = true, first = false) {
    if (this.busy) return;
    this.busy = true;
    G.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.paused = false;
    if (!first) { G.ui.fade(true); await wait(260); }
    G.ui.showHud(false);
    G.audio.stopLoops();
    await G.game.start(MENU_LEVEL, { menu: true, seed: 99 });
    this.state = 'menu';
    G.audio.duck(1);
    G.audio.music('strength_of_the_titans', 1.5);
    if (showTitle) G.ui.show('title'); else G.ui.show(null);
    G.ui.fade(false);
    this.busy = false;
  }

  async startLevel(level) {
    if (this.busy) return;
    this.busy = true;
    this.paused = false;
    G.ui.loadText = level.name;
    G.ui.fade(true);
    await wait(260);
    G.ui.show('loading');
    G.audio.stopLoops();
    G.audio.music(null, 0.6);
    await wait(60);
    try {
      await G.game.start(level, {});
    } catch (e) { console.error(e); showError(e); }
    this.state = 'game';
    G.ui.show(null);
    G.ui.fade(false);
    G.input.enabled = true;
    G.audio.duck(1);
    this.busy = false;
    try { const p = G.renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* needs a gesture; first click grabs it */ }
  }

  pause() {
    if (this.paused || this.state !== 'game') return;
    this.paused = true;
    G.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    G.audio.duck(0.35);
    G.audio.muteLoops();
    G.ui.show('pause');
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    G.input.enabled = true;
    G.audio.duck(1);
    G.ui.show(null);
    try { const p = G.renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* */ }
  }

  finishLevel(r) {
    const save = G.save;
    G.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    G.audio.muteLoops();
    const L = r.level;
    save.dna += r.dna;
    const st = save.stats;
    st.buildings += r.stats.buildings; st.vehicles += r.stats.vehicles; st.units += r.stats.units; st.people += r.stats.people; st.score += r.score;
    if (L.endless) {
      if (r.score > (save.endlessBest || 0)) { save.endlessBest = r.score; r.newBest = true; }
    } else {
      const rec = save.levels[L.id] || { stars: 0, best: 0, time: 0 };
      if (r.score > rec.best) { r.newBest = rec.best > 0; rec.best = r.score; }
      if (r.won) {
        rec.stars = Math.max(rec.stars, r.stars);
        rec.time = rec.time ? Math.min(rec.time, r.time) : r.time;
        const i = LEVELS.indexOf(L);
        const before = save.unlocked;
        save.unlocked = Math.max(save.unlocked, i + 1);
        if (save.unlocked > before) {
          const un = [];
          for (const id in KAIJU) { const k = KAIJU[id]; if (k.unlock && k.unlock.level === i) un.push('NEW KAIJU UNLOCKED: ' + k.name); }
          if (i + 1 === 3) un.push('ENDLESS RAMPAGE UNLOCKED');
          if (un.length) r.unlock = un.join('<br>');
        }
        if (L.final) save.gameComplete = true;
      }
      save.levels[L.id] = rec;
    }
    storeSave(save);
    G.ui.showHud(false);
    G.ui.results(r);
    if (r.won && L.final) { G.ui.ending(r); G.ui._afterEnding = r; }
    if (r.won) G.audio.play('confirmation_002', { vol: 0.6 }); else G.audio.music('strength_of_the_titans', 3);
  }

  buyUpgrade(id) {
    const save = G.save;
    const u = UPGRADES.find((x) => x.id === id);
    const t = tier(save, id);
    if (!u || t >= MAX_TIER) { G.ui.sfx('error_001'); return; }
    const cost = upgradeCost(u, t);
    if (save.dna < cost) { G.ui.sfx('error_001'); G.ui.toast('NOT ENOUGH DNA'); return; }
    save.dna -= cost;
    save.upgrades[id] = t + 1;
    storeSave(save);
    G.audio.play('powerUp10', { vol: 0.7, rate: 0.9 + t * 0.08 });
    G.audio.say(t + 1 >= MAX_TIER ? 'level_up' : 'power_up', 0.8);
    G.ui.toast(u.name + ' - TIER ' + (t + 1));
  }

  selectKaiju(id) {
    const save = G.save;
    if (!kaijuUnlocked(save, id)) { G.ui.sfx('error_001'); G.ui.toast(KAIJU[id].unlock.text.toUpperCase()); return; }
    if (save.kaiju === id) return;
    save.kaiju = id;
    storeSave(save);
    G.ui.sfx('confirmation_001');
    G.audio.say('choose_your_character', 0.01);
    // swap the monster in the menu backdrop
    this.toMenu(false).then(() => { G.ui.show('roster'); if (G.player) G.player.tryRoar(); });
  }

  tick(rawDt) {
    const input = G.input;
    input.frame();
    if ((this.state === 'game' || this.state === 'menu') && !this.paused && G.game.state !== 'loading' && G.game.state !== 'none') {
      const dt = rawDt * G.fx.timeScale;
      G.time += dt;
      G.game.update(dt, rawDt, input.enabled ? input : G.noInput);
      G.fx.update(dt, rawDt);
    }
    G.audio.update(rawDt);
    G.ui.update(rawDt);
    if (this.composer) this.composer.render(); else G.renderer.render(G.scene, G.camera);
    input.end();
    // dynamic resolution: keep the frame rate up on slower machines
    this.fpsAcc += rawDt; this.fpsN++;
    if (this.fpsAcc >= 1.5) {
      const fps = this.fpsN / this.fpsAcc;
      this.fps = fps;
      this.fpsAcc = 0; this.fpsN = 0;
      if (!this.paused && this.state !== 'boot' && !this.busy) {
        if (fps < 38 && this.prScale > 0.5) { this.prScale = Math.max(0.5, this.prScale * 0.85); this.resize(); }
        else if (fps > 57 && this.prScale < 1) { this.prScale = Math.min(1, this.prScale * 1.08); this.resize(); }
      }
    }
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function showError(e) {
  const d = document.getElementById('err');
  if (d) { d.style.display = 'block'; d.textContent = 'Something broke: ' + (e && e.message ? e.message : e); }
}
window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

const app = new App();
app.boot().catch((e) => { console.error(e); showError(e); });

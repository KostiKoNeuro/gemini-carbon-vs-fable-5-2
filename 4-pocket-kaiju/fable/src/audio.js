// WebAudio sound effects (pitch-shifted, layered library samples) + streamed music.
import { clamp, rand, pick } from './util.js';

const v5 = (b) => [0, 1, 2, 3, 4].map((i) => `${b}_00${i}`);
const GROUPS = {
  step: v5('impactPunch_heavy'),
  thud: ['impactSoft_heavy_000', 'impactSoft_heavy_002', 'impactSoft_heavy_004'],
  crumble: v5('impactMining'),
  slab: ['impactPlate_heavy_000', 'impactPlate_heavy_002', 'impactPlate_heavy_004'],
  boom: v5('explosionCrunch'),
  sub: ['lowFrequency_explosion_000', 'lowFrequency_explosion_001'],
  glass: ['impactGlass_heavy_000', 'impactGlass_heavy_002', 'impactGlass_heavy_004', 'impactGlass_medium_000', 'impactGlass_medium_002'],
  metal: ['impactMetal_heavy_000', 'impactMetal_heavy_002', 'impactMetal_heavy_004', 'impactMetal_000', 'impactMetal_002', 'impactMetal_004'],
  tin: ['impactTin_medium_000', 'impactTin_medium_002', 'impactMetal_medium_000', 'impactMetal_medium_002'],
  wood: ['impactWood_heavy_000', 'impactWood_heavy_002', 'impactWood_heavy_004', 'impactPlank_medium_000', 'impactPlank_medium_002'],
  punch: ['impactPunch_medium_000', 'impactPunch_medium_002'],
  bell: ['impactBell_heavy_000', 'impactBell_heavy_002'],
  tick: ['impactGeneric_light_000', 'impactGeneric_light_002'],
  laser: ['laserLarge_000', 'laserLarge_002'],
  pew: ['laserSmall_000', 'laserSmall_002'],
  field: ['forceField_000', 'forceField_002'],
  radio: ['v_war_call_for_backup', 'v_callForBackupFemaleMilitary', 'v_war_fire_in_the_hole', 'v_fireInTheHoleFemale', 'v_war_get_down', 'v_getDownFemaleMilitary',
    'v_war_go_go_go', 'v_goGoGoFemaleMilitary', 'v_war_look_out', 'v_lookOutFemaleMilitary', 'v_war_medic', 'v_medicFemaleMilitary', 'v_war_target_engaged',
    'v_targetEngagedFemaleMilitary', 'v_war_cover_me', 'v_coverMeFemaleMilitary', 'v_war_suppressing_fire', 'v_war_rpg', 'v_war_watch_my_back'],
};
const MIN_GAP = { step: 0.06, crumble: 0.035, slab: 0.05, boom: 0.05, sub: 0.12, glass: 0.05, metal: 0.04, tin: 0.04, wood: 0.05, thud: 0.05, pew: 0.05, tick: 0.03 };

export class AudioSys {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buffers = {};
    this.last = {};
    this.voices = 0;
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0, ref: 60 };
    this.musicEls = [];
    this.musicName = null;
    this.musicDuck = 1;
    this.loops = {};
    this.sayQueueT = 0;
    this.radioT = 0;
    this.unlocked = false;
  }

  async init(raw) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 18; this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
    this.sfx = ctx.createGain();
    this.sfx.connect(this.comp); this.comp.connect(this.master); this.master.connect(ctx.destination);
    // radio bus: band-limited, slightly crunchy
    this.radioBus = ctx.createBiquadFilter();
    this.radioBus.type = 'bandpass'; this.radioBus.frequency.value = 1700; this.radioBus.Q.value = 1.1;
    const rg = ctx.createGain(); rg.gain.value = 1.6;
    this.radioBus.connect(rg); rg.connect(this.sfx);
    // distortion curve for roars
    this.distCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; this.distCurve[i] = Math.tanh(x * 3.2); }
    this.applyVolumes();
    const names = Object.keys(raw);
    await Promise.all(names.map((n) => new Promise((res) => {
      try {
        ctx.decodeAudioData(raw[n].slice(0), (b) => { this.buffers[n] = b; res(); }, () => res());
      } catch (e) { res(); }
    })));
  }

  unlock() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
    this.unlocked = true;
    for (const el of this.musicEls) if (el._want && el.paused) el.play().catch(() => {});
  }

  applyVolumes() {
    const s = this.settings;
    if (this.master) this.master.gain.value = s.master;
    if (this.sfx) this.sfx.gain.value = s.sfx;
    for (const el of this.musicEls) el.volume = clamp(el._fade * s.music * s.master * this.musicDuck, 0, 1);
  }

  setListener(x, y, z, yaw, ref) {
    const l = this.listener;
    l.x = x; l.y = y; l.z = z; l.rx = Math.cos(yaw); l.rz = -Math.sin(yaw); l.ref = ref;
  }

  _resolve(name) {
    const g = GROUPS[name];
    return g ? pick(g) : name;
  }

  // opts: vol, rate, pos {x,y,z}, pan, delay, lp (lowpass Hz), jitter (rate jitter), bus
  play(name, opts = {}) {
    const ctx = this.ctx;
    if (!ctx) return null;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name];
    if (gap !== undefined) {
      if (now - (this.last[name] || -9) < gap) return null;
      this.last[name] = now;
    }
    if (this.voices > 44) return null;
    const buf = this.buffers[this._resolve(name)];
    if (!buf) return null;
    let vol = opts.vol === undefined ? 1 : opts.vol;
    let pan = opts.pan || 0;
    if (opts.pos) {
      const l = this.listener;
      const dx = opts.pos.x - l.x, dz = opts.pos.z - l.z, dy = (opts.pos.y || 0) - l.y;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const att = 1 / (1 + Math.pow(d / l.ref, 1.6));
      vol *= att;
      if (vol < 0.012) return null;
      pan = clamp(((dx * l.rx + dz * l.rz) / Math.max(d, 1)) * 0.8, -1, 1);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const j = opts.jitter === undefined ? 0.08 : opts.jitter;
    src.playbackRate.value = (opts.rate || 1) * (1 + rand(-j, j));
    const g = ctx.createGain();
    g.gain.value = vol;
    let node = src;
    if (opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = opts.lp;
      node.connect(f); node = f;
    }
    node.connect(g);
    let out = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p); out = p;
    }
    out.connect(opts.bus || this.sfx);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(now + (opts.delay || 0));
    return { src, gain: g };
  }

  // Announcer lines: one at a time.
  say(name, vol = 1.0) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now < this.sayQueueT) return;
    const buf = this.buffers['v_' + name];
    if (!buf) return;
    this.sayQueueT = now + buf.duration + 0.25;
    this.play('v_' + name, { vol, jitter: 0, rate: 0.94 });
  }
  radio(vol = 0.5) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now < this.radioT) return;
    this.radioT = now + rand(3.5, 7);
    this.play('tick', { vol: vol * 0.6, rate: 2.2, bus: this.radioBus });
    this.play('radio', { vol, jitter: 0.03, bus: this.radioBus, delay: 0.06 });
  }

  // Layered monster roar built from pitched-down library samples.
  roar(power = 1, pitch = 1, pos) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    let att = 1;
    if (pos) {
      const l = this.listener;
      const d = Math.hypot(pos.x - l.x, pos.z - l.z);
      att = 1 / (1 + Math.pow(d / (l.ref * 2), 1.4));
    }
    const layer = (name, rate0, rate1, dur, gain, opt = {}) => {
      const buf = this.buffers[name];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = !!opt.loop;
      src.playbackRate.setValueAtTime(rate0 * pitch, now);
      src.playbackRate.linearRampToValueAtTime(rate1 * pitch, now + dur);
      let node = src;
      if (opt.dist) {
        const ws = ctx.createWaveShaper(); ws.curve = this.distCurve;
        const pre = ctx.createGain(); pre.gain.value = opt.dist;
        node.connect(pre); pre.connect(ws); node = ws;
      }
      const f = ctx.createBiquadFilter();
      f.type = opt.type || 'lowpass';
      f.frequency.setValueAtTime(opt.f0 || 900, now);
      f.frequency.linearRampToValueAtTime(opt.f1 || 500, now + dur);
      f.Q.value = opt.q || 0.8;
      node.connect(f);
      const g = ctx.createGain();
      const peak = gain * power * att;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), now + (opt.a || 0.09));
      g.gain.setValueAtTime(Math.max(peak, 0.0002), now + dur * 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      f.connect(g); g.connect(this.sfx);
      src.start(now); src.stop(now + dur + 0.05);
    };
    layer('v_fight', 0.36, 0.24, 2.2, 1.5, { dist: 3, f0: 1500, f1: 600 });
    layer('v_kill_it', 0.3, 0.22, 2.4, 0.9, { dist: 2.5, f0: 1100, f1: 500 });
    layer('spaceEngineLow_000', 0.75, 0.5, 2.3, 0.75, { loop: true, f0: 700, f1: 240 });
    layer('forceField_000', 0.5, 0.26, 1.9, 0.55, { loop: true, type: 'bandpass', f0: 1900, f1: 700, q: 2.5, dist: 2 });
    layer('lowFrequency_explosion_000', 0.9, 0.7, 2.0, 0.7, { f0: 300, f1: 120 });
  }

  // Named continuous loops with smoothly controllable volume / rate.
  loop(id, name, vol, rate = 1, lp = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    let L = this.loops[id];
    if (!L) {
      const buf = this.buffers[name];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      let node = src;
      if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
      node.connect(g); g.connect(this.sfx);
      src.start();
      L = this.loops[id] = { src, g };
    }
    const t = ctx.currentTime;
    L.g.gain.setTargetAtTime(vol, t, 0.08);
    L.src.playbackRate.setTargetAtTime(rate, t, 0.1);
  }
  stopLoops() {
    for (const id in this.loops) {
      const L = this.loops[id];
      try { L.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); L.src.stop(this.ctx.currentTime + 0.3); } catch (e) { /* */ }
    }
    this.loops = {};
  }
  muteLoops() {
    if (!this.ctx) return;
    for (const id in this.loops) this.loops[id].g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  music(name, fade = 1.2) {
    if (this.musicName === name) return;
    this.musicName = name;
    for (const el of this.musicEls) { el._want = false; el._target = 0; el._speed = 1 / fade; }
    if (!name) return;
    const el = new Audio('assets/music/' + name + '.ogg');
    el.loop = true; el.preload = 'auto';
    el._fade = 0; el._target = 1; el._speed = 1 / fade; el._want = true;
    el.volume = 0;
    this.musicEls.push(el);
    if (this.unlocked) el.play().catch(() => {});
  }
  duck(v) { this.musicDuck = v; }

  update(dt) {
    const s = this.settings;
    for (let i = this.musicEls.length - 1; i >= 0; i--) {
      const el = this.musicEls[i];
      if (el._fade < el._target) el._fade = Math.min(el._target, el._fade + dt * el._speed);
      else if (el._fade > el._target) el._fade = Math.max(el._target, el._fade - dt * el._speed);
      el.volume = clamp(el._fade * s.music * s.master * this.musicDuck, 0, 1);
      if (!el._want && el._fade <= 0) { el.pause(); el.src = ''; this.musicEls.splice(i, 1); }
    }
  }
}

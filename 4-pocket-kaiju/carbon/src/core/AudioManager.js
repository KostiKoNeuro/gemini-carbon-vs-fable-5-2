import { AUDIO_MANIFEST, MUSIC_MANIFEST } from '../data/assetManifest.js';

export class AudioManager {
  constructor(saveSystem) {
    this.save = saveSystem;
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;

    this.buffers = new Map();
    this.musicBuffers = new Map();
    this.musicLoading = new Map();
    this.rawAudioData = new Map();
    this.lastPlayed = new Map();

    this.currentMusicKey = null;
    this.musicNode = null;
    this.musicPendingKey = null;
    this.unlocked = false;

    // Continuous beam sound handle
    this.beamNode = null;
    this.beamGain = null;
  }

  async preloadAll(onProgress) {
    const entries = Object.entries(AUDIO_MANIFEST);
    let done = 0;

    // Create AudioContext early so we can pre-decode buffers off the critical path
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();

        // Add subtle compressor so massive simultaneous building collapses never clip!
        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value = 18;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.18;

        this.sfxGain.connect(compressor);
        this.musicGain.connect(compressor);
        compressor.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
        this.applyVolumes();
      } catch {
        this.ctx = null;
      }
    }

    await Promise.all(entries.map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        if (this.ctx) {
          const decoded = await this.ctx.decodeAudioData(arr.slice(0));
          this.buffers.set(key, decoded);
        } else {
          this.rawAudioData.set(key, arr);
        }
      } catch {
        // Non-fatal audio load fallback
      }
      done++;
      if (onProgress) onProgress(done / entries.length);
    }));

    this.setupUnlockListeners();
  }

  setupUnlockListeners() {
    const unlock = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.unlocked = true;
      if (this.musicPendingKey) {
        const k = this.musicPendingKey;
        this.musicPendingKey = null;
        this.playMusic(k);
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  applyVolumes() {
    const s = this.save.data.settings;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(s.masterVolume, this.ctx.currentTime, 0.03);
      this.sfxGain.gain.setTargetAtTime(s.sfxVolume, this.ctx.currentTime, 0.03);
      this.musicGain.gain.setTargetAtTime(s.musicVolume * 0.68, this.ctx.currentTime, 0.03);
    }
  }

  play(key, { volume = 0.8, pitch = 1.0, pitchJitter = 0.08, pan = 0, cooldownMs = 35 } = {}) {
    if (!this.ctx || !this.buffers.has(key)) return;
    if (this.ctx.state === 'suspended') return;

    const now = performance.now();
    const prev = this.lastPlayed.get(key) || 0;
    if (now - prev < cooldownMs) return;
    this.lastPlayed.set(key, now);

    const buf = this.buffers.get(key);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rate = Math.max(0.25, Math.min(2.5, pitch + (Math.random() * 2 - 1) * pitchJitter));
    src.playbackRate.value = rate;

    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1.4, volume));

    if (this.ctx.createStereoPanner && Math.abs(pan) > 0.01) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.9, Math.min(0.9, pan));
      src.connect(gain);
      gain.connect(panner);
      panner.connect(this.sfxGain);
    } else {
      src.connect(gain);
      gain.connect(this.sfxGain);
    }

    src.start(0);
  }

  // Juicy layered sound for collapsing buildings!
  playBuildingCollapse(tier = 1, pan = 0) {
    const scalePitch = Math.max(0.52, 1.08 - tier * 0.13);
    this.play('explosionCrunch', { volume: 0.72 + tier * 0.08, pitch: scalePitch, pan, cooldownMs: 45 });
    this.play('glassHeavy', { volume: 0.55, pitch: 0.95 + Math.random() * 0.2, pan, cooldownMs: 40 });
    if (tier >= 2) {
      this.play('explosionLow', { volume: 0.75, pitch: scalePitch * 0.85, pan, cooldownMs: 55 });
      this.play('metalHeavy', { volume: 0.48, pitch: 0.75, pan, cooldownMs: 55 });
    }
  }

  playFootstep(sizeClass) {
    const pitch = sizeClass.footstepPitch || 1.0;
    const vol = 0.28 + (sizeClass.tier - 1) * 0.09;
    this.play('footstep', { volume: vol, pitch, pitchJitter: 0.06, cooldownMs: 110 });
    if (sizeClass.tier >= 3) {
      this.play('explosionLow', { volume: 0.16 + (sizeClass.tier - 3) * 0.08, pitch: 0.55, cooldownMs: 140 });
    }
  }

  setBeamActive(active, pitch = 1.0) {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    if (active) {
      if (!this.beamNode && this.buffers.has('thrusterFire')) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers.get('thrusterFire');
        src.loop = true;
        src.playbackRate.value = pitch;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.01, this.ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.45, this.ctx.currentTime + 0.08);
        src.connect(g);
        g.connect(this.sfxGain);
        src.start(0);
        this.beamNode = src;
        this.beamGain = g;
        this.play('laserLarge', { volume: 0.55, pitch: 0.9, cooldownMs: 120 });
      }
    } else if (this.beamNode) {
      try {
        const node = this.beamNode;
        const g = this.beamGain;
        this.beamNode = null;
        this.beamGain = null;
        g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.09);
        setTimeout(() => {
          try { node.stop(); } catch {}
        }, 110);
      } catch {
        this.beamNode = null;
      }
    }
  }

  async loadMusicBuffer(key, url) {
    if (this.musicBuffers.has(key)) return this.musicBuffers.get(key);
    if (this.musicLoading.has(key)) return this.musicLoading.get(key);

    const p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok || !this.ctx) return null;
        const arr = await res.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(arr.slice(0));
        this.musicBuffers.set(key, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.musicLoading.delete(key);
      }
    })();

    this.musicLoading.set(key, p);
    return p;
  }

  async playMusic(key) {
    const url = MUSIC_MANIFEST[key];
    if (!url || !this.ctx) return;
    if (this.currentMusicKey === key && this.musicNode) return;
    this.currentMusicKey = key;

    if (!this.unlocked) {
      this.musicPendingKey = key;
      return;
    }

    if (this.musicNode) {
      try { this.musicNode.stop(); } catch {}
      this.musicNode = null;
    }

    const buf = await this.loadMusicBuffer(key, url);
    if (!buf || this.currentMusicKey !== key || !this.unlocked) return;

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start(0);
    this.musicNode = src;
  }

  stopMusic() {
    this.setBeamActive(false);
    this.currentMusicKey = null;
    if (this.musicNode) {
      try { this.musicNode.stop(); } catch {}
      this.musicNode = null;
    }
  }
}

// DOM user interface: menus, HUD, results. Everything is plain HTML over the WebGL canvas.
import * as THREE from 'three';
import { KAIJU, LEVELS, ENDLESS, UPGRADES, MAX_TIER, upgradeCost, tier, kaijuUnlocked, storeSave, wipeSave, defaultSave } from './data.js';
import { BOSSES } from './boss.js';
import { CREDITS, CREDIT_NOTE } from './credits.gen.js';
import { fmt, fmtTime, clamp } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const icon = (name, cls = '') => `<img class="ic ${cls}" src="assets/ui/${name}.png" alt="">`;
const _v = new THREE.Vector3();

export class UI {
  constructor(G) {
    this.G = G;
    this.root = $('#ui');
    this.screen = null;
    this.popups = [];
    this.bannerT = 0; this.hintT = 0; this.flashV = 0;
    this.build();
  }

  sfx(name, vol = 0.5) { this.G.audio.play(name, { vol, jitter: 0.02 }); }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div id="vignette"></div>
      <div id="hud" class="hidden">
        <div class="hud-tl">
          <div class="kname"><span id="h-kname">REX</span><span id="h-size">8 m</span></div>
          <div class="bar hp"><div id="h-hp"></div><span id="h-hpt"></span></div>
          <div class="bar en"><div id="h-en"></div><span>BREATH</span></div>
          <div class="bar rg"><div id="h-rg"></div><span id="h-rgt">RAMPAGE</span></div>
          <div class="grow"><span>NEXT GROWTH</span><div class="bar gr"><div id="h-gr"></div></div></div>
          <ul id="h-obj"></ul>
        </div>
        <div class="hud-tc">
          <div id="h-level"></div>
          <div class="bar dest"><div id="h-dest"></div><span id="h-destt">0%</span></div>
          <div id="h-boss" class="hidden"><div id="h-bossname"></div><div class="bar boss"><div id="h-bosshp"></div></div></div>
        </div>
        <div class="hud-tr">
          <div id="h-score">0</div>
          <div id="h-combo" class="hidden"></div>
          <div id="h-time">0:00</div>
          <div id="h-threat"></div>
        </div>
        <canvas id="h-map" width="190" height="190"></canvas>
        <div class="hud-bc">
          <div id="h-hint"></div>
          <div class="abil">
            <div class="ab" id="ab-bite">${icon('skull')}<b>LMB</b><i>BITE</i></div>
            <div class="ab" id="ab-stomp">${icon('exploding')}<b>SPACE</b><i>STOMP</i><u></u></div>
            <div class="ab" id="ab-breath">${icon('fire')}<b>RMB</b><i>BREATH</i></div>
            <div class="ab" id="ab-roar">${icon('campfire')}<b>Q</b><i>ROAR</i><u></u></div>
            <div class="ab" id="ab-rage">${icon('crown_a')}<b>R</b><i>RAMPAGE</i></div>
          </div>
        </div>
        <div id="crosshair"></div>
        <div id="banner"><div id="banner-t"></div><div id="banner-s"></div></div>
        <div id="popups"></div>
      </div>
      <div id="intro-card" class="hidden"><div class="tag"></div><div class="name"></div><div class="desc"></div></div>
      <div id="screens"></div>
      <div id="fade"></div>
      <div id="toast"></div>`;
    this.hud = $('#hud');
    this.screens = $('#screens');
    this.el = {};
    for (const id of ['h-kname', 'h-size', 'h-hp', 'h-hpt', 'h-en', 'h-rg', 'h-rgt', 'h-gr', 'h-obj', 'h-level', 'h-dest', 'h-destt', 'h-boss', 'h-bossname', 'h-bosshp', 'h-score', 'h-combo', 'h-time', 'h-threat', 'h-map', 'h-hint', 'banner', 'banner-t', 'banner-s', 'popups', 'vignette', 'ab-stomp', 'ab-roar', 'ab-rage', 'ab-breath', 'intro-card', 'fade', 'toast', 'crosshair']) this.el[id] = $('#' + id);
    this.mapCtx = this.el['h-map'].getContext('2d');
    // generic button sounds
    r.addEventListener('mouseover', (e) => { const b = e.target.closest('button,.card,.up'); if (b && b !== this._hover) { this._hover = b; if (!b.disabled) this.sfx('rollover1', 0.25); } });
    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.classList.contains('locked') || b.disabled) { this.sfx('error_001', 0.5); return; }
      this.G.audio.unlock();
      this.act(b.dataset.act, b.dataset.arg, b);
    });
    r.addEventListener('input', (e) => {
      const t = e.target;
      if (!t.dataset.set) return;
      const s = this.G.save.settings;
      const k = t.dataset.set;
      if (t.type === 'checkbox') s[k] = t.checked; else if (t.type === 'range') s[k] = parseFloat(t.value); else s[k] = t.value;
      const lab = t.parentElement.querySelector('em'); if (lab && t.type === 'range') lab.textContent = Math.round(parseFloat(t.value) * 100) + '%';
      storeSave(this.G.save);
      this.G.app.applySettings();
      if (k === 'sfx') this.sfx('click_001', 0.6);
    });
  }

  act(a, arg, el) {
    const G = this.G, app = G.app;
    switch (a) {
      case 'open': this.sfx('click_001'); this.show(arg); break;
      case 'back': this.sfx('back_001'); this.show(app.paused ? 'pause' : 'title'); break;
      case 'level': this.sfx('confirmation_001'); this.briefing(arg === 'endless' ? ENDLESS : LEVELS[+arg]); break;
      case 'start': this.sfx('confirmation_002', 0.7); app.startLevel(this.briefLevel); break;
      case 'buy': app.buyUpgrade(arg); this.show('lab'); break;
      case 'kaiju': app.selectKaiju(arg); this.show('roster'); break;
      case 'resume': this.sfx('click_001'); app.resume(); break;
      case 'restart': this.sfx('confirmation_001'); app.startLevel(G.game.level); break;
      case 'quit': this.sfx('back_001'); app.toMenu(); break;
      case 'next': this.sfx('confirmation_001'); { const i = LEVELS.indexOf(this.lastResult.level); if (i >= 0 && i < LEVELS.length - 1) { app.toMenu(false).then(() => this.briefing(LEVELS[i + 1])); } else app.toMenu(); } break;
      case 'lab': this.sfx('click_001'); app.toMenu(false).then(() => this.show('lab')); break;
      case 'wipe': if (el.dataset.sure) { wipeSave(); Object.assign(G.save, defaultSave()); storeSave(G.save); app.applySettings(); this.toast('PROGRESS ERASED'); this.show('title'); } else { el.dataset.sure = '1'; el.textContent = 'REALLY ERASE EVERYTHING?'; this.sfx('question_001'); } break;
      case 'ending-done': this.sfx('click_001'); this.results(this.lastResult); break;
      case 'fullscreen': if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); break;
    }
  }

  // ---------------------------------------------------------------- screens
  show(name) {
    const G = this.G, save = G.save;
    this.screen = name;
    const s = this.screens;
    if (!name) { s.innerHTML = ''; s.className = ''; return; }
    s.className = 'on s-' + name;
    let h = '';
    const dna = `<div class="dna">${icon('flask_full')}<b>${fmt(save.dna)}</b> DNA</div>`;
    const back = `<button class="btn back" data-act="back">&#9664; BACK</button>`;
    if (name === 'title') {
      const cont = save.unlocked > 0 || Object.keys(save.levels).length;
      const endless = save.unlocked >= 3;
      h = `<div class="title-wrap">
        <div class="logo"><span class="l1">POCKET</span><span class="l2">KAIJU</span><span class="l3">SMALL MONSTER. BIG PROBLEM.</span></div>
        <div class="menu">
          <button class="btn big" data-act="open" data-arg="levels">${cont ? 'CONTINUE RAMPAGE' : 'START RAMPAGE'}</button>
          <button class="btn" data-act="open" data-arg="lab">EVOLUTION LAB</button>
          <button class="btn" data-act="open" data-arg="roster">CHOOSE YOUR KAIJU</button>
          <button class="btn ${endless ? '' : 'locked'}" data-act="level" data-arg="endless">ENDLESS RAMPAGE ${endless ? '' : icon('lock_closed')}</button>
          <button class="btn" data-act="open" data-arg="howto">HOW TO PLAY</button>
          <button class="btn" data-act="open" data-arg="settings">SETTINGS</button>
          <button class="btn" data-act="open" data-arg="credits">CREDITS</button>
        </div>
        ${dna}
        <div class="foot">Built with free assets from the Patch library &middot; Music by Kevin MacLeod &middot; v1.0</div>
      </div>`;
    } else if (name === 'levels') {
      h = `<div class="panel wide"><h1>CAMPAIGN</h1>${dna}<div class="cards">`;
      LEVELS.forEach((L, i) => {
        const locked = i > save.unlocked;
        const rec = save.levels[L.id];
        const stars = rec ? rec.stars : 0;
        h += `<div class="card lvl ${locked ? 'locked' : ''} ${L.final ? 'final' : ''}" data-act="level" data-arg="${i}">
          <div class="num">${i + 1}</div>
          <div class="tag">${L.tag}</div><div class="name">${L.name}</div>
          <div class="desc">${locked ? 'Flatten the previous district to unlock.' : L.desc}</div>
          <div class="stars">${[1, 2, 3].map((k) => `<span class="${k <= stars ? 'on' : ''}">&#9733;</span>`).join('')}</div>
          <div class="best">${rec ? 'BEST ' + fmt(rec.best) : locked ? icon('lock_closed') : 'NOT CLEARED'}</div>
        </div>`;
      });
      h += `</div><div class="row">${back}<button class="btn ${save.unlocked >= 3 ? '' : 'locked'}" data-act="level" data-arg="endless">ENDLESS RAMPAGE ${save.unlocked >= 3 ? (save.endlessBest ? '&middot; BEST ' + fmt(save.endlessBest) : '') : '&middot; CLEAR STAGE 3'}</button></div></div>`;
    } else if (name === 'lab') {
      h = `<div class="panel wide"><h1>EVOLUTION LAB</h1>${dna}<p class="sub">Spend DNA harvested from flattened districts. Mutations are permanent and apply to every kaiju.</p><div class="ups">`;
      for (const u of UPGRADES) {
        const t = tier(save, u.id);
        const max = t >= MAX_TIER;
        const cost = upgradeCost(u, t);
        const can = !max && save.dna >= cost;
        h += `<div class="up ${max ? 'max' : can ? 'can' : 'cant'}" data-act="buy" data-arg="${u.id}">
          ${icon(u.icon, 'big')}
          <div class="uname">${u.name}</div><div class="udesc">${u.desc}</div>
          <div class="pips">${Array.from({ length: MAX_TIER }, (_, k) => `<i class="${k < t ? 'on' : ''}"></i>`).join('')}</div>
          <div class="cost">${max ? 'MAXED' : icon('flask_full') + fmt(cost)}</div>
        </div>`;
      }
      h += `</div><div class="row">${back}</div></div>`;
    } else if (name === 'roster') {
      h = `<div class="panel wide"><h1>CHOOSE YOUR KAIJU</h1><div class="cards three">`;
      for (const id in KAIJU) {
        const k = KAIJU[id];
        const ok = kaijuUnlocked(save, id);
        const st = k.stats;
        const bar = (label, v) => `<div class="stat"><span>${label}</span><div><i style="width:${clamp(v / 1.5, 0.1, 1) * 100}%"></i></div></div>`;
        h += `<div class="card kj ${ok ? '' : 'locked'} ${save.kaiju === id ? 'sel' : ''}" data-act="kaiju" data-arg="${id}">
          <div class="name">${k.name}</div><div class="tag">${k.title}</div>
          <div class="desc">${ok ? k.blurb : k.unlock.text}</div>
          ${bar('HEALTH', st.hp)}${bar('SPEED', st.speed)}${bar('BITE', st.melee)}${bar('STOMP', st.stomp)}${bar('BREATH', st.breath)}
          <div class="best">${ok ? (save.kaiju === id ? 'SELECTED' : 'SELECT') : icon('lock_closed') + ' LOCKED'}</div>
        </div>`;
      }
      h += `</div><div class="row">${back}</div></div>`;
    } else if (name === 'howto') {
      const k = (a, b) => `<div class="key"><b>${a}</b><span>${b}</span></div>`;
      h = `<div class="panel"><h1>HOW TO PLAY</h1>
        <p class="sub">Destroy the district to grow. The bigger you are, the bigger the things you can flatten. The army will try to stop you. It will fail.</p>
        <div class="keys">
          ${k('W A S D', 'Move')}${k('MOUSE', 'Look around / aim')}${k('SHIFT', 'Charge (smash through buildings)')}
          ${k('LEFT CLICK / F', 'Bite. Third hit in a row is a tail sweep')}${k('RIGHT CLICK / E', 'Breath weapon (hold)')}
          ${k('SPACE', 'Leap and stomp. Also dodges shockwaves')}${k('Q', 'Terror roar: stuns the army, destroys missiles')}
          ${k('R', 'RAMPAGE when the meter is full')}${k('ARROW KEYS', 'Turn camera without the mouse')}${k('ESC / P', 'Pause')}
        </div>
        <ul class="tips">
          <li>Walk into anything smaller than your knee to crush it. Bigger buildings must be bitten, stomped or charged.</li>
          <li>Knock out a building's ground floor and everything above comes down.</li>
          <li>Wrecking things heals you a little. Growth spurts heal you a lot.</li>
          <li>Chain destruction without pausing to build a score combo.</li>
          <li>Landmarks pay out big bonuses. Fuel tanks explode. Do the maths.</li>
        </ul>
        <div class="row">${back}</div></div>`;
    } else if (name === 'settings') {
      const st = save.settings;
      const sl = (label, key, min, max, step) => `<label class="set"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${st[key]}" data-set="${key}"><em>${Math.round(st[key] * 100)}%</em></label>`;
      h = `<div class="panel"><h1>SETTINGS</h1>
        ${sl('MASTER VOLUME', 'master', 0, 1, 0.05)}${sl('MUSIC', 'music', 0, 1, 0.05)}${sl('SOUND EFFECTS', 'sfx', 0, 1, 0.05)}
        ${sl('MOUSE SENSITIVITY', 'sens', 0.3, 2.5, 0.05)}${sl('SCREEN SHAKE', 'shake', 0, 1.5, 0.05)}
        <label class="set"><span>GRAPHICS QUALITY</span><select data-set="quality">${['low', 'medium', 'high'].map((q) => `<option value="${q}" ${st.quality === q ? 'selected' : ''}>${q.toUpperCase()}</option>`).join('')}</select><em></em></label>
        <label class="set"><span>INVERT Y AXIS</span><input type="checkbox" data-set="invertY" ${st.invertY ? 'checked' : ''}><em></em></label>
        <p class="sub small">Quality changes to crowds and debris apply when the next stage loads.</p>
        <div class="row">${back}<button class="btn" data-act="fullscreen">TOGGLE FULLSCREEN</button>${this.G.app.paused ? '' : '<button class="btn danger" data-act="wipe">ERASE PROGRESS</button>'}</div></div>`;
    } else if (name === 'credits') {
      h = `<div class="panel wide"><h1>CREDITS</h1><div class="credits"><p><b>POCKET KAIJU</b> &mdash; design, code and destruction engineering by an AI coding agent.</p><p>${CREDIT_NOTE}</p><p>Rendered with three.js (MIT licence).</p><ul>${CREDITS.map((c) => `<li>${c.replace(/</g, '&lt;')}</li>`).join('')}</ul></div><div class="row">${back}</div></div>`;
    } else if (name === 'pause') {
      h = `<div class="panel narrow"><h1>PAUSED</h1>
        <button class="btn big" data-act="resume">RESUME</button>
        <button class="btn" data-act="restart">RESTART STAGE</button>
        <button class="btn" data-act="open" data-arg="settings">SETTINGS</button>
        <button class="btn" data-act="open" data-arg="howto">HOW TO PLAY</button>
        <button class="btn danger" data-act="quit">QUIT TO MENU</button></div>`;
    } else if (name === 'loading') {
      h = `<div class="loadlvl"><div class="spin"></div><div>${this.loadText || 'LOADING'}</div></div>`;
    }
    s.innerHTML = h;
  }

  briefing(L) {
    const save = this.G.save;
    this.briefLevel = L;
    this.screen = 'brief';
    const k = KAIJU[save.kaiju];
    const g = tier(save, 'growth');
    const obj = [];
    if (L.endless) obj.push('Survive as long as you can', 'The army escalates every minute', 'Flatten 93% of the map to win outright');
    else {
      obj.push(`Destroy ${Math.round(L.goal * 100)}% of the district`);
      if (L.boss) obj.push(`Defeat ${BOSSES[L.boss].name}`);
      obj.push(`&#9733; Finish in under ${fmtTime(L.parTime)}`);
      const lm = Object.values(L.landmarks || {});
      obj.push(lm.length ? '&#9733; Demolish every landmark' : '&#9733; Finish with over 40% health');
    }
    this.screens.className = 'on s-brief';
    this.screens.innerHTML = `<div class="panel brief"><div class="tag">${L.tag}</div><h1>${L.name}</h1><p class="sub">${L.desc}</p>
      <div class="cols"><div><h3>OBJECTIVES</h3><ul>${obj.map((o) => `<li>${o}</li>`).join('')}</ul></div>
      <div><h3>YOUR KAIJU</h3><div class="kjline"><b>${k.name}</b> ${k.title}</div><div class="kjline">Starts ${Math.round(L.startSize * (1 + 0.07 * g))} m tall &rarr; up to ${Math.round(L.maxSize * (1 + 0.035 * g))} m</div><h3>INTEL</h3><ul>${L.tips.map((t) => `<li>${t}</li>`).join('')}</ul></div></div>
      <div class="row"><button class="btn back" data-act="open" data-arg="${L.endless ? 'title' : 'levels'}">&#9664; BACK</button><button class="btn big go" data-act="start">UNLEASH</button></div></div>`;
  }

  results(r) {
    const G = this.G;
    this.lastResult = r;
    this.screen = 'results';
    const L = r.level;
    const i = LEVELS.indexOf(L);
    const rows = [
      ['BUILDINGS FLATTENED', r.stats.buildings], ['VEHICLES WRECKED', r.stats.vehicles], ['ARMY UNITS DESTROYED', r.stats.units],
      ['CIVILIANS LAUNCHED', r.stats.people], ['BEST COMBO', r.stats.maxCombo], ['FINAL HEIGHT', Math.round(r.size) + ' m'], ['TIME', fmtTime(r.time)],
    ];
    const title = r.won ? (L.final ? 'EARTH CONQUERED' : L.endless ? 'CITY ERASED' : 'STAGE CLEAR') : (L.endless ? 'RAMPAGE OVER' : 'KAIJU DOWN');
    const canNext = r.won && i >= 0 && i < LEVELS.length - 1;
    this.screens.className = 'on s-results';
    this.screens.innerHTML = `<div class="panel results ${r.won ? 'won' : 'lost'}"><div class="tag">${L.name}</div><h1>${title}</h1>
      ${L.endless ? '' : `<div class="stars bigstars">${[1, 2, 3].map((k) => `<span class="${k <= r.stars ? 'on' : ''}" style="animation-delay:${0.3 + k * 0.25}s">&#9733;</span>`).join('')}</div>`}
      <div class="score">SCORE <b id="r-score">0</b>${r.newBest ? '<em>NEW BEST!</em>' : ''}</div>
      <table>${rows.map((x) => `<tr><td>${x[0]}</td><td>${typeof x[1] === 'number' ? fmt(x[1]) : x[1]}</td></tr>`).join('')}</table>
      ${L.endless ? '' : `<ul class="robj">${r.objectives.filter((o) => !o.hidden).map((o) => `<li class="${o.done ? 'ok' : 'no'}">${o.done ? '&#10003;' : '&#10007;'} ${o.text}</li>`).join('')}</ul>`}
      <div class="dna earned">${icon('flask_full')}<b>+${fmt(r.dna)}</b> DNA</div>
      ${r.unlock ? `<div class="unlock">${r.unlock}</div>` : ''}
      <div class="row">${canNext ? '<button class="btn big" data-act="next">NEXT STAGE</button>' : ''}<button class="btn" data-act="lab">EVOLUTION LAB</button><button class="btn" data-act="restart">${r.won ? 'REPLAY' : 'TRY AGAIN'}</button><button class="btn" data-act="quit">MENU</button></div></div>`;
    // score count-up
    const el = $('#r-score'); const t0 = performance.now();
    const tick = () => { const u = clamp((performance.now() - t0) / 1400, 0, 1); el.textContent = fmt(r.score * (1 - Math.pow(1 - u, 3))); if (u < 1 && el.isConnected) requestAnimationFrame(tick); };
    tick();
  }

  ending(r) {
    this.screen = 'ending';
    this.screens.className = 'on s-ending';
    this.screens.innerHTML = `<div class="ending"><div class="roll">
      <h1>THE END</h1><p>The last gun fell silent at dawn.</p><p>Where MK-TITAN fell, something small and scaly curled up in the crater,<br>yawned, and went to sleep.</p>
      <p>It had been a very big day for a very pocket-sized monster.</p>
      <h2>POCKET KAIJU</h2><p>Final score ${fmt(r.score)}</p>
      <h3>THANK YOU FOR PLAYING</h3>
      <p>ENDLESS RAMPAGE is unlocked.<br>Every kaiju is unlocked.<br>The Evolution Lab is still hungry.</p>
      <h3>ASSETS</h3><p>Models: Kenney, Kay Lousberg, Polyfork, Poly Haven, Patch (anymove)<br>Music: Kevin MacLeod (incompetech.com), CC BY 4.0<br>Sounds: Kenney<br>Full list on the CREDITS screen.</p>
      </div><button class="btn big" data-act="ending-done">CONTINUE</button></div>`;
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text; t.className = 'on';
    clearTimeout(this._tt); this._tt = setTimeout(() => { t.className = ''; }, 2600);
  }
  fade(on) { this.el.fade.className = on ? 'on' : ''; }

  // ---------------------------------------------------------------- HUD
  showHud(on) {
    this.hud.classList.toggle('hidden', !on);
    if (on) {
      this.el['h-boss'].classList.add('hidden');
      this.el['h-combo'].classList.add('hidden');
      this.el.banner.className = '';
      this.el.popups.innerHTML = '';
      this.el.vignette.style.opacity = 0;
    } else this.el['intro-card'].classList.add('hidden');
  }
  levelIntro(L) {
    const c = this.el['intro-card'];
    c.querySelector('.tag').textContent = L.tag;
    c.querySelector('.name').textContent = L.name;
    c.querySelector('.desc').textContent = L.desc;
    c.classList.remove('hidden');
    c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    this.el['h-level'].textContent = L.name;
    this.el['h-kname'].textContent = KAIJU[this.G.save.kaiju].name;
  }
  banner(title, sub, cls) {
    const b = this.el.banner;
    if (!title) { if (this.bannerCls === 'rage') b.className = ''; return; }
    this.el['banner-t'].textContent = title;
    this.el['banner-s'].textContent = sub || '';
    b.className = '';
    void b.offsetWidth;
    b.className = 'on ' + (cls || '');
    this.bannerCls = cls;
    this.bannerT = 2.6;
  }
  hint(text) {
    const h = this.el['h-hint'];
    h.textContent = text;
    h.className = '';
    void h.offsetWidth;
    h.className = 'on';
    this.hintT = 6;
  }
  flashCombo() { const c = this.el['h-combo']; c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); }
  damageFlash(v) { this.flashV = Math.max(this.flashV, v); }
  bossBar(name, frac, phase) {
    const b = this.el['h-boss'];
    if (b.classList.contains('hidden')) { b.classList.remove('hidden'); this.el['h-bossname'].textContent = name; }
    this.el['h-bosshp'].style.width = clamp(frac, 0, 1) * 100 + '%';
    b.dataset.phase = phase;
  }
  popup(x, y, z, text, big) {
    const G = this.G;
    if (this.popups.length > 26) return;
    _v.set(x, y, z).project(G.camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) return;
    const d = document.createElement('div');
    d.className = 'pop' + (big ? ' big' : '');
    d.textContent = text;
    d.style.left = (_v.x * 0.5 + 0.5) * 100 + '%';
    d.style.top = (-_v.y * 0.5 + 0.5) * 100 + '%';
    this.el.popups.appendChild(d);
    this.popups.push({ d, t: big ? 1.5 : 1.0 });
  }

  updateHud(game) {
    const G = this.G, pl = G.player, e = this.el;
    if (!pl) return;
    e['h-hp'].style.width = clamp(pl.hp / pl.maxHp, 0, 1) * 100 + '%';
    e['h-hp'].className = pl.hp < pl.maxHp * 0.3 ? 'low' : '';
    e['h-hpt'].textContent = Math.ceil(pl.hp) + ' / ' + Math.round(pl.maxHp);
    e['h-en'].style.width = clamp(pl.energy / pl.maxEnergy, 0, 1) * 100 + '%';
    const ramp = pl.rampage > 0;
    e['h-rg'].style.width = (ramp ? pl.rampage / pl.rampageMax : pl.rage) * 100 + '%';
    e['h-rg'].parentElement.className = 'bar rg' + (ramp ? ' active' : pl.rage >= 1 ? ' ready' : '');
    e['h-rgt'].textContent = ramp ? 'RAMPAGE!' : pl.rage >= 1 ? 'RAMPAGE READY [R]' : 'RAMPAGE';
    e['h-size'].textContent = Math.round(pl.size) + ' m';
    const L = game.level;
    const p = clamp(game.progress, 0, 1);
    const pp = L.endless ? clamp(G.world.destroyedValue / (G.world.totalValue * 0.8), 0, 1) : p;
    e['h-gr'].style.width = ((pp * 5) % 1) * 100 + '%';
    if (L.endless) { e['h-dest'].style.width = clamp(G.world.destroyedValue / G.world.totalValue, 0, 1) * 100 + '%'; e['h-destt'].textContent = Math.floor(G.world.destroyedValue / G.world.totalValue * 100) + '% ERASED'; }
    else { e['h-dest'].style.width = p * 100 + '%'; e['h-destt'].textContent = Math.floor(p * 100) + '% DESTROYED'; }
    e['h-score'].textContent = fmt(game.score);
    e['h-time'].textContent = fmtTime(game.time);
    e['h-time'].className = !L.endless && game.time > L.parTime ? 'late' : '';
    const c = e['h-combo'];
    if (game.combo >= 5) { c.classList.remove('hidden'); c.innerHTML = `<b>x${(1 + Math.min(game.combo, 60) * 0.035).toFixed(1)}</b> COMBO ${game.combo}`; c.style.setProperty('--t', clamp(game.comboT / 2.6, 0, 1)); }
    else c.classList.add('hidden');
    const mt = L.army.maxThreat;
    let th = '';
    for (let i = 1; i <= mt; i++) th += `<span class="${i <= game.threat ? 'on' : ''}">&#9733;</span>`;
    if (e['h-threat']._v !== th) { e['h-threat'].innerHTML = '<i>THREAT</i>' + th; e['h-threat']._v = th; }
    // abilities
    e['ab-stomp'].style.setProperty('--cd', clamp(pl.stompCd / 1.9, 0, 1));
    e['ab-roar'].style.setProperty('--cd', pl.roarCdMax ? clamp(pl.roarCd / pl.roarCdMax, 0, 1) : 0);
    e['ab-rage'].className = 'ab' + (pl.rage >= 1 ? ' ready' : ramp ? ' active' : ' off');
    e['ab-breath'].className = 'ab' + (pl.breathing ? ' active' : pl.energy < pl.maxEnergy * 0.08 ? ' off' : '');
    // objectives
    const obj = game.objectives;
    const oh = obj.filter((o) => !o.hidden).map((o) => `<li class="${o.done ? 'ok' : o.fail ? 'fail' : ''}">${o.text}</li>`).join('');
    if (e['h-obj']._v !== oh) { e['h-obj'].innerHTML = oh; e['h-obj']._v = oh; }
    this.drawMap(game);
  }

  drawMap(game) {
    const G = this.G, w = G.world, pl = G.player, ctx = this.mapCtx;
    const S = 190;
    ctx.clearRect(0, 0, S, S);
    const ext = Math.max(w.W, w.D) / 2 + 80;
    const k = S / (ext * 2);
    const X = (x) => (x + ext) * k, Y = (z) => (z + ext) * k;
    ctx.fillStyle = 'rgba(10,14,22,0.72)';
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, 7); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 1, 0, 7); ctx.clip();
    if (w.waterZ < 1e8) { ctx.fillStyle = 'rgba(40,110,170,0.6)'; ctx.fillRect(0, Y(w.waterZ), S, S); }
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = Math.max(1, 15 * k);
    ctx.beginPath();
    for (const x of w.roadsX) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), w.waterZ < 1e8 ? Y(w.waterZ) : S); }
    for (const z of w.roadsZ) { ctx.moveTo(0, Y(z)); ctx.lineTo(S, Y(z)); }
    ctx.stroke();
    for (const b of w.buildings) {
      if (b.dead) continue;
      ctx.fillStyle = b.landmark ? '#ffd23a' : b.explosive ? '#ff7a3a' : b.mesh ? '#c9b48a' : '#9fb3c8';
      ctx.fillRect(X(b.minX), Y(b.minZ), Math.max(1.5, (b.maxX - b.minX) * k), Math.max(1.5, (b.maxZ - b.minZ) * k));
    }
    for (const u of G.units.army) {
      ctx.fillStyle = u.def.air ? '#ff9e3d' : '#ff3b3b';
      ctx.beginPath(); ctx.arc(X(u.x), Y(u.z), u.def.air ? 2.6 : 2.2, 0, 7); ctx.fill();
    }
    if (game.boss && !game.boss.dead) { ctx.fillStyle = '#ff2bd0'; ctx.beginPath(); ctx.arc(X(game.boss.pos.x), Y(game.boss.pos.z), 6, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    // player arrow
    ctx.translate(X(pl.pos.x), Y(pl.pos.z)); ctx.rotate(-pl.yaw + Math.PI);
    ctx.fillStyle = '#7dff3a'; ctx.strokeStyle = '#06280a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 1, 0, 7); ctx.stroke();
  }

  update(rawDt) {
    if (this.bannerT > 0) { this.bannerT -= rawDt; if (this.bannerT <= 0 && this.bannerCls !== 'rage') this.el.banner.className = ''; }
    if (this.hintT > 0) { this.hintT -= rawDt; if (this.hintT <= 0) this.el['h-hint'].className = ''; }
    if (this.flashV > 0 || this._vig) {
      this.flashV = Math.max(0, this.flashV - rawDt * 1.6);
      const pl = this.G.player;
      const low = pl && !this.G.game.menu && pl.hp < pl.maxHp * 0.3 ? 0.35 + 0.15 * Math.sin(performance.now() * 0.008) : 0;
      const v = Math.max(this.flashV, low);
      this.el.vignette.style.opacity = v;
      this._vig = v > 0;
    } else {
      const pl = this.G.player;
      if (pl && !this.G.game.menu && pl.hp < pl.maxHp * 0.3 && this.G.game.state === 'play') this._vig = true;
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t -= rawDt;
      if (p.t <= 0) { p.d.remove(); this.popups.splice(i, 1); }
    }
  }
}

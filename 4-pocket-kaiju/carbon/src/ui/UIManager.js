import {
  KAIJU_ROSTER,
  SIZE_CLASSES,
  LAB_UPGRADES,
  RUN_MUTATIONS,
  CAMPAIGN_LEVELS,
  ACHIEVEMENTS,
  NEWS_TICKER_LINES
} from '../data/gameConfig.js';

const TRAMPLE_DESCRIPTIONS = [
  'Crushes Trees, Streetlights & Vehicles',
  'Walks Straight Through Suburban Houses!',
  'Walks Through Commercial & Refinery Blocks!',
  'Flattens High-Rises & Army Tanks Underfoot!',
  'UNSTOPPABLE: Walks Through Mega-Skyscrapers!'
];

export class UIManager {
  constructor(saveSystem, audio, callbacks) {
    this.save = saveSystem;
    this.audio = audio;
    this.cb = callbacks; // { onStartOperation, onSelectKaiju, onResume, onRestart, onQuitToMenu, onPickMutation, onQualityChange }

    this.activeModal = null;
    this.returnToPauseFromSettings = false;
    this.currentMutationChoices = [];
    this.creditsRawText = '';

    this.cacheDom();
    this.bindEvents();
    this.loadCreditsFile();

    this.save.onAchievementUnlock = (ach) => this.showAchievementToast(ach);
  }

  cacheDom() {
    this.el = {
      loadingScreen: document.getElementById('loading-screen'),
      loadingBar: document.getElementById('loading-bar-fill'),
      loadingText: document.getElementById('loading-status'),

      menuScreen: document.getElementById('menu-screen'),
      menuDna: document.getElementById('menu-dna-val'),
      menuKaijuChip: document.getElementById('menu-kaiju-chip'),
      menuAchChip: document.getElementById('menu-ach-chip'),

      modalBackdrop: document.getElementById('modal-backdrop'),
      modalTitle: document.getElementById('modal-title'),
      modalBody: document.getElementById('modal-body'),
      modalDnaBadge: document.getElementById('modal-dna-badge'),

      hudScreen: document.getElementById('hud-screen'),
      hudKaijuName: document.getElementById('hud-kaiju-name'),
      hudSizeBadge: document.getElementById('hud-size-badge'),
      hudHeightVal: document.getElementById('hud-height-val'),
      hudHpFill: document.getElementById('hud-hp-fill'),
      hudHpText: document.getElementById('hud-hp-text'),
      hudEnergyFill: document.getElementById('hud-energy-fill'),
      hudBioFill: document.getElementById('hud-bio-fill'),
      hudBioText: document.getElementById('hud-bio-text'),
      hudTrampleHint: document.getElementById('hud-trample-hint'),

      hudOpTitle: document.getElementById('hud-op-title'),
      hudDestructFill: document.getElementById('hud-destruct-fill'),
      hudDestructText: document.getElementById('hud-destruct-text'),
      hudLandmarkText: document.getElementById('hud-landmark-text'),

      bossHud: document.getElementById('boss-hud'),
      bossPhaseText: document.getElementById('boss-phase-text'),
      bossHpFill: document.getElementById('boss-hp-fill'),
      bossShieldBanner: document.getElementById('boss-shield-banner'),

      hudScoreVal: document.getElementById('hud-score-val'),
      hudRunDnaVal: document.getElementById('hud-rundna-val'),
      hudComboBox: document.getElementById('hud-combo-box'),
      hudComboVal: document.getElementById('hud-combo-val'),
      hudComboBar: document.getElementById('hud-combo-bar'),
      hudThreatStars: document.getElementById('hud-threat-stars'),
      hudDefconLabel: document.getElementById('hud-defcon-label'),

      slotPrimaryName: document.getElementById('slot-primary-name'),
      slotSecondaryName: document.getElementById('slot-secondary-name'),
      slotLeapName: document.getElementById('slot-leap-name'),
      slotUltName: document.getElementById('slot-ult-name'),
      slotPrimaryCd: document.getElementById('slot-primary-cd'),
      slotSecondaryCd: document.getElementById('slot-secondary-cd'),
      slotLeapCd: document.getElementById('slot-leap-cd'),
      slotUltFill: document.getElementById('slot-ult-fill'),
      slotUltCard: document.getElementById('slot-ult-card'),

      newsTickerText: document.getElementById('news-ticker-text'),
      centerBanner: document.getElementById('center-banner'),
      centerBannerTitle: document.getElementById('center-banner-title'),
      centerBannerSub: document.getElementById('center-banner-sub'),

      mutationOverlay: document.getElementById('mutation-overlay'),
      mutationCards: document.getElementById('mutation-cards'),

      pauseOverlay: document.getElementById('pause-overlay'),
      resultOverlay: document.getElementById('result-overlay'),
      resultContent: document.getElementById('result-content'),

      toastContainer: document.getElementById('toast-container')
    };
  }

  bindEvents() {
    // Main Menu Buttons
    document.getElementById('btn-play')?.addEventListener('click', () => {
      this.clickSfx();
      this.openModal('operations');
    });
    document.getElementById('btn-quick-play')?.addEventListener('click', () => {
      this.clickSfx(true);
      const nextLvl = Math.min(4, this.save.data.highestUnlockedLevel || 1);
      this.cb.onStartOperation(nextLvl);
    });
    document.getElementById('btn-roster')?.addEventListener('click', () => {
      this.clickSfx();
      this.openModal('roster');
    });
    document.getElementById('btn-lab')?.addEventListener('click', () => {
      this.clickSfx();
      this.openModal('lab');
    });
    document.getElementById('btn-achievements')?.addEventListener('click', () => {
      this.clickSfx();
      this.openModal('achievements');
    });
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.clickSfx();
      this.returnToPauseFromSettings = false;
      this.openModal('settings');
    });
    document.getElementById('btn-credits')?.addEventListener('click', () => {
      this.clickSfx();
      this.openModal('credits');
    });

    document.getElementById('btn-modal-close')?.addEventListener('click', () => {
      this.clickSfx();
      this.closeModal();
    });
    this.el.modalBackdrop?.addEventListener('click', (e) => {
      if (e.target === this.el.modalBackdrop) {
        this.clickSfx();
        this.closeModal();
      }
    });

    // HUD Pause button
    document.getElementById('btn-hud-pause')?.addEventListener('click', () => {
      this.clickSfx();
      this.cb.onTogglePause();
    });

    // Pause Overlay buttons
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => {
      this.clickSfx(true);
      this.cb.onResume();
    });
    document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
      this.clickSfx(true);
      this.cb.onRestart();
    });
    document.getElementById('btn-pause-settings')?.addEventListener('click', () => {
      this.clickSfx();
      this.returnToPauseFromSettings = true;
      this.el.pauseOverlay.classList.add('hidden');
      this.openModal('settings');
    });
    document.getElementById('btn-pause-quit')?.addEventListener('click', () => {
      this.clickSfx();
      this.cb.onQuitToMenu();
    });

    // Keyboard 1/2/3 for Mutation cards
    window.addEventListener('keydown', (e) => {
      if (!this.el.mutationOverlay.classList.contains('hidden') && this.currentMutationChoices.length > 0) {
        if (e.code === 'Digit1' || e.code === 'Numpad1') this.selectMutationIndex(0);
        else if (e.code === 'Digit2' || e.code === 'Numpad2') this.selectMutationIndex(1);
        else if (e.code === 'Digit3' || e.code === 'Numpad3') this.selectMutationIndex(2);
      }
    });
  }

  async loadCreditsFile() {
    try {
      const res = await fetch('./CREDITS.md');
      if (res.ok) {
        this.creditsRawText = await res.text();
      }
    } catch {
      this.creditsRawText = '';
    }
  }

  clickSfx(confirm = false) {
    this.audio.play(confirm ? 'uiConfirm' : 'uiClick', { volume: 0.65, pitch: 1.0, cooldownMs: 20 });
  }

  setLoadingProgress(pct, statusText) {
    if (this.el.loadingBar) {
      this.el.loadingBar.style.width = `${Math.round(pct * 100)}%`;
    }
    if (this.el.loadingText && statusText) {
      this.el.loadingText.textContent = statusText;
    }
  }

  hideLoading() {
    this.el.loadingScreen?.classList.add('fade-out');
    setTimeout(() => {
      this.el.loadingScreen?.classList.add('hidden');
    }, 420);
  }

  showMainMenu() {
    this.closeModal(true);
    this.el.hudScreen.classList.add('hidden');
    this.el.pauseOverlay.classList.add('hidden');
    this.el.resultOverlay.classList.add('hidden');
    this.el.mutationOverlay.classList.add('hidden');
    this.el.menuScreen.classList.remove('hidden');
    this.refreshMenuHeader();
  }

  refreshMenuHeader() {
    const k = KAIJU_ROSTER.find(x => x.id === this.save.data.selectedKaiju) || KAIJU_ROSTER[0];
    this.el.menuDna.textContent = `${this.save.data.dna}`;
    this.el.menuKaijuChip.textContent = `${k.name} • ${k.title}`;
    this.el.menuKaijuChip.style.borderColor = k.accentColor;
    this.el.menuKaijuChip.style.color = k.accentColor;

    const unlockedCount = Object.keys(this.save.data.achievements).length;
    this.el.menuAchChip.textContent = `${unlockedCount} / ${ACHIEVEMENTS.length}`;

    const nextLvlId = Math.min(4, this.save.data.highestUnlockedLevel || 1);
    const lvl = CAMPAIGN_LEVELS.find(l => l.id === nextLvlId) || CAMPAIGN_LEVELS[0];
    const quickSub = document.getElementById('quick-play-sub');
    if (quickSub) {
      quickSub.textContent = `${lvl.code}: ${lvl.name}`;
    }
  }

  showHud(levelDef, kaijuDef) {
    this.closeModal(true);
    this.el.menuScreen.classList.add('hidden');
    this.el.pauseOverlay.classList.add('hidden');
    this.el.resultOverlay.classList.add('hidden');
    this.el.mutationOverlay.classList.add('hidden');
    this.el.hudScreen.classList.remove('hidden');

    this.el.hudKaijuName.textContent = `${kaijuDef.name}`;
    this.el.hudKaijuName.style.color = kaijuDef.accentColor;
    this.el.hudOpTitle.textContent = `${levelDef.code} • ${levelDef.name}`;

    this.el.slotPrimaryName.textContent = kaijuDef.abilities.primary.name;
    this.el.slotSecondaryName.textContent = kaijuDef.abilities.secondary.name;
    this.el.slotLeapName.textContent = kaijuDef.abilities.leap.name;
    this.el.slotUltName.textContent = kaijuDef.abilities.ultimate.name;

    this.setNewsCategory(levelDef.hasBoss ? 'boss' : 'intro');
  }

  setNewsCategory(cat) {
    const lines = NEWS_TICKER_LINES[cat] || NEWS_TICKER_LINES.intro;
    this.el.newsTickerText.textContent = lines.join('   ///   ') + '   ///   ' + lines.join('   ///   ');
  }

  updateHud({ kaiju, cityStats, levelDef, score, runDna, combo, comboTimer, comboMaxTime, threatStars, boss }) {
    // Health & Energy
    const hpPct = Math.max(0, Math.min(100, (kaiju.hp / kaiju.maxHp) * 100));
    this.el.hudHpFill.style.width = `${hpPct.toFixed(1)}%`;
    this.el.hudHpText.textContent = `${Math.ceil(kaiju.hp)} / ${kaiju.maxHp} HP${kaiju.berserkTimer > 0 ? ' • BERSERK!' : ''}`;

    const enPct = Math.max(0, Math.min(100, (kaiju.energy / kaiju.maxEnergy) * 100));
    this.el.hudEnergyFill.style.width = `${enPct.toFixed(1)}%`;

    // Size Class & Live Height in Meters
    const sc = kaiju.sizeClass;
    this.el.hudSizeBadge.textContent = `CLASS ${['I', 'II', 'III', 'IV', 'V'][sc.tier - 1]} • ${sc.name}`;
    this.el.hudHeightVal.textContent = `${kaiju.currentHeight.toFixed(1)}m`;

    const nextClass = SIZE_CLASSES[sc.tier]; // sc.tier is 1-based, so index sc.tier is next!
    if (nextClass) {
      const span = nextClass.minBiomass - sc.minBiomass;
      const into = kaiju.biomass - sc.minBiomass;
      const bPct = Math.max(0, Math.min(100, (into / span) * 100));
      this.el.hudBioFill.style.width = `${bPct.toFixed(1)}%`;
      this.el.hudBioText.textContent = `BIO-MASS: ${Math.floor(kaiju.biomass)} / ${nextClass.minBiomass} → ${nextClass.heightMeters}m`;
    } else {
      this.el.hudBioFill.style.width = '100%';
      this.el.hudBioText.textContent = `APEX CALAMITY MAXIMIZED • ${Math.floor(kaiju.biomass)} BIO-MASS`;
    }
    this.el.hudTrampleHint.textContent = TRAMPLE_DESCRIPTIONS[sc.trampleTier] || TRAMPLE_DESCRIPTIONS[0];

    // Mission Objectives
    const dPct = cityStats.pct;
    const targetPct = levelDef.targetDestructionPct;
    const barFill = levelDef.endless
      ? Math.min(100, dPct)
      : Math.min(100, (dPct / Math.max(1, targetPct)) * 100);
    this.el.hudDestructFill.style.width = `${barFill.toFixed(1)}%`;

    if (levelDef.endless) {
      this.el.hudDestructText.textContent = `EXTINCTION RAMPAGE: ${dPct.toFixed(0)}% DEMOLISHED`;
    } else {
      const doneD = dPct >= targetPct;
      this.el.hudDestructText.textContent = `${doneD ? '✓ ' : ''}CITY DESTRUCTION: ${dPct.toFixed(0)}% / ${targetPct}%`;
      this.el.hudDestructText.classList.toggle('obj-complete', doneD);
    }

    const totalLandmarks = levelDef.landmarkCount || 0;
    const destroyedLandmarks = Math.max(0, totalLandmarks - cityStats.landmarksLeft);
    const doneL = cityStats.landmarksLeft === 0;
    this.el.hudLandmarkText.textContent = `${doneL ? '✓ ' : ''}${levelDef.landmarkLabel.toUpperCase()}: ${destroyedLandmarks} / ${totalLandmarks}`;
    this.el.hudLandmarkText.classList.toggle('obj-complete', doneL);

    // Final Boss Bar
    if (boss && boss.active) {
      this.el.bossHud.classList.remove('hidden');
      const bPct = Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100));
      this.el.bossHpFill.style.width = `${bPct.toFixed(1)}%`;
      this.el.bossPhaseText.textContent = `COLOSSAL JAEGER: PROJECT AEGIS-ZERO • PHASE ${['I', 'II', 'III'][boss.phase - 1]}`;
      const shielded = cityStats.landmarksLeft > 0 && !boss.dead;
      this.el.bossShieldBanner.classList.toggle('hidden', !shielded);
      if (shielded) {
        this.el.bossShieldBanner.textContent = `⚡ QUANTUM SHIELD ACTIVE (-78% DMG) — DESTROY ${cityStats.landmarksLeft} PYLON${cityStats.landmarksLeft > 1 ? 'S' : ''}!`;
      }
    } else {
      this.el.bossHud.classList.add('hidden');
    }

    // Score, DNA, Combo & Threat
    this.el.hudScoreVal.textContent = Math.floor(score).toLocaleString('en-US');
    this.el.hudRunDnaVal.textContent = `+${Math.floor(runDna)}`;

    if (combo >= 2 && comboTimer > 0) {
      this.el.hudComboBox.classList.remove('hidden');
      this.el.hudComboVal.textContent = `x${combo} COMBO`;
      this.el.hudComboBar.style.width = `${Math.max(0, Math.min(100, (comboTimer / comboMaxTime) * 100)).toFixed(0)}%`;
    } else {
      this.el.hudComboBox.classList.add('hidden');
    }

    const starsStr = '★'.repeat(threatStars) + '☆'.repeat(Math.max(0, 5 - threatStars));
    this.el.hudThreatStars.textContent = starsStr;
    this.el.hudDefconLabel.textContent = `DEFCON ${6 - threatStars}`;

    // Ability Hotbar Cooldowns
    const pCd = kaiju.attackCooldown > 0 ? Math.min(100, (kaiju.attackCooldown / 0.44) * 100) : 0;
    this.el.slotPrimaryCd.style.height = `${pCd}%`;

    const sCd = kaiju.energy < 15 ? 100 : 0;
    this.el.slotSecondaryCd.style.height = `${sCd}%`;

    const lCd = kaiju.leapCooldown > 0 ? Math.min(100, (kaiju.leapCooldown / 3.8) * 100) : 0;
    this.el.slotLeapCd.style.height = `${lCd}%`;

    this.el.slotUltFill.style.height = `${Math.floor(kaiju.ultCharge)}%`;
    this.el.slotUltCard.classList.toggle('ult-ready', kaiju.ultCharge >= 100);
  }

  triggerBanner(title, subtitle, color = '#39ff88') {
    this.el.centerBannerTitle.textContent = title;
    this.el.centerBannerTitle.style.color = color;
    this.el.centerBannerSub.textContent = subtitle;
    this.el.centerBanner.classList.remove('hidden', 'banner-anim');
    void this.el.centerBanner.offsetWidth;
    this.el.centerBanner.classList.add('banner-anim');
    clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => {
      this.el.centerBanner.classList.add('hidden');
    }, 2900);
  }

  // === MID-RUN ROGUELITE MUTATION MODAL ===
  showMutationDraft(kaiju, autoPickForTest = false) {
    const available = RUN_MUTATIONS.filter(m => !kaiju.mutations.has(m.id));
    if (available.length === 0) return false;

    // Shuffle and pick 3
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    this.currentMutationChoices = shuffled.slice(0, 3);

    if (autoPickForTest) {
      this.cb.onPickMutation(this.currentMutationChoices[0].id);
      this.currentMutationChoices = [];
      return false;
    }

    this.el.mutationCards.innerHTML = '';
    this.currentMutationChoices.forEach((mut, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mutation-card';
      card.style.setProperty('--mut-color', mut.color);
      card.innerHTML = `
        <div class="mut-key">[${idx + 1}]</div>
        <div class="mut-tag" style="color:${mut.color};border-color:${mut.color}">${mut.tag}</div>
        <h3 class="mut-title">${mut.name}</h3>
        <p class="mut-desc">${mut.desc}</p>
        <span class="mut-cta">ASSIMILATE GENOME</span>
      `;
      card.addEventListener('click', () => this.selectMutationIndex(idx));
      this.el.mutationCards.appendChild(card);
    });

    this.el.mutationOverlay.classList.remove('hidden');
    this.audio.play('uiOpen', { volume: 0.7, pitch: 0.95 });
    return true;
  }

  selectMutationIndex(idx) {
    const chosen = this.currentMutationChoices[idx];
    if (!chosen) return;
    this.currentMutationChoices = [];
    this.el.mutationOverlay.classList.add('hidden');
    this.cb.onPickMutation(chosen.id);
  }

  showPause(paused) {
    this.el.pauseOverlay.classList.toggle('hidden', !paused);
  }

  showResultScreen({ victory, levelDef, score, runDna, bonusDna, stars, destructionPct, peakHeight, maxCombo, buildingsDestroyed }) {
    this.el.pauseOverlay.classList.add('hidden');
    this.el.mutationOverlay.classList.add('hidden');
    this.el.resultOverlay.classList.remove('hidden');

    const totalDna = Math.round(runDna + bonusDna);
    const starDisplay = victory
      ? ('★'.repeat(stars) + '☆'.repeat(3 - stars))
      : '☆ ☆ ☆';

    const nextLevel = CAMPAIGN_LEVELS.find(l => l.id === levelDef.id + 1);

    this.el.resultContent.innerHTML = `
      <div class="result-badge ${victory ? 'badge-victory' : 'badge-defeat'}">
        ${victory ? (levelDef.hasBoss ? 'EARTH CONQUERED • APEX KING!' : 'OPERATION COMPLETE') : 'KAIJU NEUTRALIZED'}
      </div>
      <h2 class="result-title">${levelDef.code}: ${levelDef.name}</h2>
      <div class="result-stars">${starDisplay}</div>

      <div class="result-stats-grid">
        <div class="rstat"><span>FINAL SCORE</span><strong>${Math.floor(score).toLocaleString('en-US')}</strong></div>
        <div class="rstat"><span>CITY DEMOLISHED</span><strong>${destructionPct.toFixed(1)}% (${buildingsDestroyed} Bldgs)</strong></div>
        <div class="rstat"><span>PEAK KAIJU HEIGHT</span><strong>${peakHeight.toFixed(1)}m</strong></div>
        <div class="rstat"><span>MAX COMBO</span><strong>x${maxCombo}</strong></div>
      </div>

      <div class="result-dna-banner">
        <div>
          <span class="dna-label">MUTAGEN DNA HARVESTED</span>
          <div class="dna-sub">Rampage Yield +${Math.round(runDna)} ${bonusDna > 0 ? `• Mission Bonus +${Math.round(bonusDna)}` : ''}</div>
        </div>
        <div class="dna-total">🧬 +${totalDna} DNA</div>
      </div>

      <div class="result-actions">
        ${victory && nextLevel ? `<button id="res-btn-next" class="btn-primary">▶ NEXT: ${nextLevel.code} ${nextLevel.name}</button>` : ''}
        <button id="res-btn-lab" class="btn-accent">🧬 EVOLUTION LAB (${this.save.data.dna} DNA)</button>
        <button id="res-btn-retry" class="btn-secondary">↻ ${victory ? 'REPLAY OPERATION' : 'DEPLOY AGAIN'}</button>
        <button id="res-btn-menu" class="btn-ghost">MAIN MENU</button>
      </div>
    `;

    document.getElementById('res-btn-next')?.addEventListener('click', () => {
      this.clickSfx(true);
      this.el.resultOverlay.classList.add('hidden');
      this.cb.onStartOperation(nextLevel.id);
    });
    document.getElementById('res-btn-lab')?.addEventListener('click', () => {
      this.clickSfx();
      this.el.resultOverlay.classList.add('hidden');
      this.cb.onQuitToMenu();
      this.openModal('lab');
    });
    document.getElementById('res-btn-retry')?.addEventListener('click', () => {
      this.clickSfx(true);
      this.el.resultOverlay.classList.add('hidden');
      this.cb.onRestart();
    });
    document.getElementById('res-btn-menu')?.addEventListener('click', () => {
      this.clickSfx();
      this.el.resultOverlay.classList.add('hidden');
      this.cb.onQuitToMenu();
    });
  }

  // === MODALS (OPERATIONS, ROSTER, LAB, ACHIEVEMENTS, SETTINGS, CREDITS) ===
  openModal(type) {
    this.activeModal = type;
    this.el.modalBackdrop.classList.remove('hidden');
    this.el.modalBackdrop.dataset.modalType = type;
    this.el.modalDnaBadge.textContent = `🧬 ${this.save.data.dna} DNA`;

    if (type === 'operations') this.renderOperationsModal();
    else if (type === 'roster') this.renderRosterModal();
    else if (type === 'lab') this.renderLabModal();
    else if (type === 'achievements') this.renderAchievementsModal();
    else if (type === 'settings') this.renderSettingsModal();
    else if (type === 'credits') this.renderCreditsModal();
  }

  closeModal(silent = false) {
    this.activeModal = null;
    this.el.modalBackdrop.classList.add('hidden');
    delete this.el.modalBackdrop.dataset.modalType;
    if (!silent) this.refreshMenuHeader();
    if (this.returnToPauseFromSettings) {
      this.returnToPauseFromSettings = false;
      this.el.pauseOverlay.classList.remove('hidden');
    }
  }

  renderOperationsModal() {
    this.el.modalTitle.textContent = 'SELECT TACTICAL OPERATION';
    const unlockAll = this.save.data.unlockAllOperations;
    const highest = this.save.data.highestUnlockedLevel || 1;

    const cardsHtml = CAMPAIGN_LEVELS.map((lvl) => {
      const unlocked = unlockAll || lvl.endless || lvl.id <= highest;
      const stars = this.save.data.levelStars[lvl.id] || 0;
      const best = this.save.data.bestScores[lvl.id] || 0;
      const starStr = lvl.endless ? '∞ SANDBOX' : ('★'.repeat(stars) + '☆'.repeat(3 - stars));

      return `
        <div class="op-card ${unlocked ? '' : 'op-locked'} ${lvl.hasBoss ? 'op-boss' : ''}">
          <div class="op-card-top">
            <span class="op-code">${lvl.code}</span>
            <span class="op-stars">${starStr}</span>
          </div>
          <h3 class="op-name">${lvl.name}</h3>
          <div class="op-sub">${lvl.subtitle}</div>
          <p class="op-brief">${lvl.briefing}</p>
          <div class="op-meta">
            <span>🎯 Target: ${lvl.endless ? 'Infinite' : lvl.targetDestructionPct + '% City + ' + lvl.landmarkCount + ' ' + lvl.landmarkLabel}</span>
            <span>⚠️ Max Threat: DEFCON ${6 - lvl.maxDefcon}</span>
            ${best > 0 ? `<span>🏆 Best: ${best.toLocaleString('en-US')}</span>` : ''}
          </div>
          <button class="btn-primary op-launch-btn" data-lvl="${lvl.id}" ${unlocked ? '' : 'disabled'}>
            ${unlocked ? (lvl.hasBoss ? '⚔️ ENGAGE AEGIS-ZERO' : '▶ LAUNCH RAMPAGE') : '🔒 CLEAR PREVIOUS OPERATION'}
          </button>
        </div>
      `;
    }).join('');

    this.el.modalBody.innerHTML = `<div class="ops-grid">${cardsHtml}</div>`;
    this.el.modalBody.querySelectorAll('.op-launch-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.lvl);
        this.clickSfx(true);
        this.closeModal(true);
        this.cb.onStartOperation(id);
      });
    });
  }

  renderRosterModal() {
    this.el.modalTitle.textContent = 'KAIJU GENETIC ROSTER';
    const selectedId = this.save.data.selectedKaiju;

    const html = KAIJU_ROSTER.map((k) => {
      const unlocked = this.save.isKaijuUnlocked(k.id);
      const isSel = selectedId === k.id;
      const canAfford = this.save.data.dna >= k.unlockCost;

      const statBar = (label, val) => `
        <div class="kstat-row">
          <span>${label}</span>
          <div class="kstat-track"><div class="kstat-fill" style="width:${Math.min(100, val * 78)}%;background:${k.accentColor}"></div></div>
        </div>
      `;

      return `
        <div class="roster-card ${isSel ? 'roster-selected' : ''}" style="--k-color:${k.accentColor}">
          <div class="roster-header">
            <div>
              <h3 style="color:${k.accentColor}">${k.name}</h3>
              <span class="roster-title">${k.title}</span>
            </div>
            ${isSel ? '<span class="equipped-pill">ACTIVE</span>' : ''}
          </div>
          <p class="roster-tag">${k.tagline}</p>
          <div class="roster-stats">
            ${statBar('SMASH POWER', k.stats.power)}
            ${statBar('STRIDE SPEED', k.stats.speed)}
            ${statBar('CARAPACE ARMOR', k.stats.armor)}
            ${statBar('ATOMIC OUTPUT', k.stats.beamPower)}
          </div>
          <div class="roster-abilities">
            <div><strong>[LMB] ${k.abilities.primary.name}:</strong> ${k.abilities.primary.desc}</div>
            <div><strong>[RMB] ${k.abilities.secondary.name}:</strong> ${k.abilities.secondary.desc}</div>
            <div><strong>[R] ${k.abilities.ultimate.name}:</strong> ${k.abilities.ultimate.desc}</div>
          </div>
          <button class="btn-primary roster-btn" data-kid="${k.id}">
            ${unlocked
              ? (isSel ? '✓ SELECTED FOR DEPLOYMENT' : 'PREVIEW & SELECT KAIJU')
              : `🔓 UNLOCK SPECIMEN (🧬 ${k.unlockCost} DNA)`}
          </button>
          ${!unlocked && !canAfford ? '<div class="unlock-hint">Tip: Also unlocks automatically upon clearing Operation 02!</div>' : ''}
        </div>
      `;
    }).join('');

    this.el.modalBody.innerHTML = `<div class="roster-grid">${html}</div>`;
    this.el.modalBody.querySelectorAll('.roster-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kid = btn.dataset.kid;
        const kDef = KAIJU_ROSTER.find(x => x.id === kid);
        if (!kDef) return;

        if (this.save.isKaijuUnlocked(kid)) {
          this.save.data.selectedKaiju = kid;
          this.save.save();
          this.clickSfx(true);
          this.cb.onSelectKaiju(kid);
          this.renderRosterModal();
          this.refreshMenuHeader();
        } else if (this.save.unlockKaiju(kDef)) {
          this.audio.play('powerUp', { volume: 0.85 });
          this.cb.onSelectKaiju(kid);
          this.el.modalDnaBadge.textContent = `🧬 ${this.save.data.dna} DNA`;
          this.renderRosterModal();
          this.refreshMenuHeader();
        } else {
          this.audio.play('uiError', { volume: 0.7 });
        }
      });
    });
  }

  renderLabModal() {
    this.el.modalTitle.textContent = 'EVOLUTION LAB • PERMANENT MUTATIONS';
    this.el.modalDnaBadge.textContent = `🧬 ${this.save.data.dna} DNA`;

    const cards = LAB_UPGRADES.map((u) => {
      const rank = this.save.getUpgradeRank(u.id);
      const cost = this.save.getUpgradeCost(u);
      const maxed = rank >= u.maxRank;
      const canBuy = !maxed && this.save.data.dna >= cost;

      const pips = Array.from({ length: u.maxRank }, (_, i) =>
        `<span class="rank-pip ${i < rank ? 'pip-filled' : ''}"></span>`
      ).join('');

      return `
        <div class="lab-card ${maxed ? 'lab-maxed' : ''}">
          <div class="lab-top">
            <span class="lab-icon">${u.icon}</span>
            <div class="lab-pips">${pips}</div>
          </div>
          <h4>${u.name}</h4>
          <p>${u.desc}</p>
          <button class="btn-primary lab-buy-btn" data-uid="${u.id}" ${canBuy ? '' : 'disabled'}>
            ${maxed ? 'MAX EVOLUTION' : `EVOLVE • 🧬 ${cost} DNA`}
          </button>
        </div>
      `;
    }).join('');

    this.el.modalBody.innerHTML = `<div class="lab-grid">${cards}</div>`;
    this.el.modalBody.querySelectorAll('.lab-buy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const u = LAB_UPGRADES.find(x => x.id === btn.dataset.uid);
        if (u && this.save.buyUpgrade(u)) {
          this.audio.play('powerUp', { volume: 0.8, pitch: 1.05 });
          this.renderLabModal();
          this.refreshMenuHeader();
        } else {
          this.audio.play('uiError', { volume: 0.7 });
        }
      });
    });
  }

  renderAchievementsModal() {
    this.el.modalTitle.textContent = 'ACHIEVEMENTS & DESTRUCTION DOSSIER';
    const st = this.save.data.stats;

    const statsBar = `
      <div class="dossier-summary">
        <div><span>BUILDINGS DEMOLISHED</span><strong>${st.buildingsDestroyed}</strong></div>
        <div><span>SKYSCRAPERS FELLED</span><strong>${st.skyscrapersDestroyed}</strong></div>
        <div><span>TANKS CRUSHED</span><strong>${st.tanksDestroyed}</strong></div>
        <div><span>HELICOPTERS SWATTED</span><strong>${st.helisDestroyed}</strong></div>
        <div><span>VEHICLES LAUNCHED</span><strong>${st.carsLaunched}</strong></div>
        <div><span>HIGHEST COMBO</span><strong>x${st.maxCombo}</strong></div>
      </div>
    `;

    const achGrid = ACHIEVEMENTS.map((a) => {
      const unlocked = Boolean(this.save.data.achievements[a.id]);
      return `
        <div class="ach-card ${unlocked ? 'ach-unlocked' : ''}">
          <div class="ach-icon">${a.icon}</div>
          <div>
            <h4>${a.name} ${unlocked ? '✓' : ''}</h4>
            <p>${a.desc}</p>
          </div>
        </div>
      `;
    }).join('');

    this.el.modalBody.innerHTML = `${statsBar}<div class="ach-grid">${achGrid}</div>`;
  }

  renderSettingsModal() {
    this.el.modalTitle.textContent = 'SYSTEM & AUDIO SETTINGS';
    const s = this.save.data.settings;

    this.el.modalBody.innerHTML = `
      <div class="settings-panel">
        <label class="setting-row">
          <span>Master Volume (<b id="lbl-master">${Math.round(s.masterVolume * 100)}%</b>)</span>
          <input id="inp-master" type="range" min="0" max="100" value="${Math.round(s.masterVolume * 100)}" />
        </label>
        <label class="setting-row">
          <span>Music Volume (<b id="lbl-music">${Math.round(s.musicVolume * 100)}%</b>)</span>
          <input id="inp-music" type="range" min="0" max="100" value="${Math.round(s.musicVolume * 100)}" />
        </label>
        <label class="setting-row">
          <span>SFX & Destruction Volume (<b id="lbl-sfx">${Math.round(s.sfxVolume * 100)}%</b>)</span>
          <input id="inp-sfx" type="range" min="0" max="100" value="${Math.round(s.sfxVolume * 100)}" />
        </label>
        <label class="setting-row">
          <span>Tectonic Screen Shake (<b id="lbl-shake">${Math.round(s.screenShake * 100)}%</b>)</span>
          <input id="inp-shake" type="range" min="0" max="150" value="${Math.round(s.screenShake * 100)}" />
        </label>
        <div class="setting-row">
          <span>Graphics & Debris Quality</span>
          <div class="quality-btns">
            ${['low', 'medium', 'high'].map(q => `
              <button type="button" class="btn-secondary q-btn ${s.quality === q ? 'q-active' : ''}" data-q="${q}">
                ${q.toUpperCase()}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="setting-row">
          <span>Unlock All Operations (Jump to Boss / Any Stage)</span>
          <button type="button" id="btn-toggle-unlockall" class="btn-secondary">
            ${this.save.data.unlockAllOperations ? '✓ ENABLED' : 'DISABLED'}
          </button>
        </div>
        <div class="setting-row danger-zone">
          <span>Save Data Management</span>
          <button type="button" id="btn-reset-save" class="btn-danger">RESET ALL PROGRESS</button>
        </div>
      </div>
    `;

    const bindSlider = (id, lblId, key, scale = 100) => {
      const inp = document.getElementById(id);
      const lbl = document.getElementById(lblId);
      inp?.addEventListener('input', () => {
        const val = Number(inp.value) / scale;
        this.save.data.settings[key] = val;
        lbl.textContent = `${inp.value}%`;
        this.audio.applyVolumes();
        this.save.save();
      });
    };

    bindSlider('inp-master', 'lbl-master', 'masterVolume');
    bindSlider('inp-music', 'lbl-music', 'musicVolume');
    bindSlider('inp-sfx', 'lbl-sfx', 'sfxVolume');
    bindSlider('inp-shake', 'lbl-shake', 'screenShake');

    this.el.modalBody.querySelectorAll('.q-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.dataset.q;
        this.save.data.settings.quality = q;
        this.save.save();
        this.clickSfx();
        this.cb.onQualityChange(q);
        this.renderSettingsModal();
      });
    });

    document.getElementById('btn-toggle-unlockall')?.addEventListener('click', () => {
      this.save.data.unlockAllOperations = !this.save.data.unlockAllOperations;
      this.save.save();
      this.clickSfx(true);
      this.renderSettingsModal();
    });

    const resetBtn = document.getElementById('btn-reset-save');
    resetBtn?.addEventListener('click', () => {
      if (resetBtn.dataset.confirm !== '1') {
        resetBtn.dataset.confirm = '1';
        resetBtn.textContent = 'CLICK AGAIN TO CONFIRM RESET';
        this.audio.play('uiError', { volume: 0.6 });
        return;
      }
      this.save.reset();
      this.clickSfx(true);
      this.cb.onSelectKaiju(this.save.data.selectedKaiju);
      this.renderSettingsModal();
      this.refreshMenuHeader();
    });
  }

  renderCreditsModal() {
    this.el.modalTitle.textContent = 'CREDITS & OPEN LICENSES';
    const escapedCredits = (this.creditsRawText || 'See CREDITS.md in game directory for full per-file attributions.')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    this.el.modalBody.innerHTML = `
      <div class="credits-wrap">
        <div class="credits-hero">
          <h3>POCKET KAIJU</h3>
          <p>Bio-Atomic Urban Destruction Game • Built with Three.js & Patch.gg Verified Assets</p>
        </div>
        <div class="credits-columns">
          <div class="credit-box">
            <h4>3D Monsters, Mechs & City Architecture</h4>
            <ul>
              <li><strong>Patch / anymove</strong> — Animated T-Rex, Giant Ape, Giant Scorpion & Two-Legged Mech (CC0 1.0)</li>
              <li><strong>Kenney</strong> — City Kit Commercial, Suburban, Industrial, Roads, Car Kit, Mini Characters, Space Kit, Nature Kit & Tower Defense Kit (CC0 1.0)</li>
              <li><strong>Polyfork</strong> — Medium Tank, Attack Helicopter, Defense Turret, Business Jet, Missile, Police Officer, Barricade, Radar Mast, Fuel Farm Tank & Collapse Rubble Pack (CC BY 4.0)</li>
            </ul>
          </div>
          <div class="credit-box">
            <h4>Audio, Voiceovers, Music & Engine</h4>
            <ul>
              <li><strong>Kenney</strong> — Sci-Fi Sounds, Impact Sounds, UI Interface Sounds & Voiceover Pack Fighter/Military (CC0 1.0)</li>
              <li><strong>OpenGameArt.org Authors</strong> — "Ancient Evil Awakens" (CC0), "Stage F Faster" (CC0), "To 100" (CC BY 4.0), "Epic Boss Battle" (CC0)</li>
              <li><strong>Three.js Authors</strong> — Three.js 3D WebGL Engine (MIT License, ./LICENSES/)</li>
            </ul>
          </div>
        </div>
        <h4 class="raw-credits-heading">Complete Asset Manifest Attribution (CREDITS.md)</h4>
        <pre class="credits-pre">${escapedCredits}</pre>
      </div>
    `;
  }

  showAchievementToast(ach) {
    this.audio.play('powerUp', { volume: 0.75, pitch: 1.25 });
    const toast = document.createElement('div');
    toast.className = 'ach-toast';
    toast.innerHTML = `
      <div class="ach-toast-icon">${ach.icon}</div>
      <div>
        <div class="ach-toast-label">ACHIEVEMENT UNLOCKED</div>
        <div class="ach-toast-name">${ach.name}</div>
        <div class="ach-toast-desc">${ach.desc}</div>
      </div>
    `;
    this.el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-hide');
      setTimeout(() => toast.remove(), 450);
    }, 4000);
  }
}

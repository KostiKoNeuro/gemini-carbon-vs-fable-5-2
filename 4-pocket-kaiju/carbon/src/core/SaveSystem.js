import { KAIJU_ROSTER, LAB_UPGRADES, ACHIEVEMENTS } from '../data/gameConfig.js';

const STORAGE_KEY = 'pocket_kaiju_steam_save_v1';

function createDefaultSave() {
  const upgrades = {};
  for (const u of LAB_UPGRADES) upgrades[u.id] = 0;

  return {
    dna: 80, // starter bonus DNA so player can test the Lab right away or save up!
    selectedKaiju: 'rex',
    unlockedKaiju: KAIJU_ROSTER.filter(k => k.unlockedByDefault).map(k => k.id),
    highestUnlockedLevel: 1,
    unlockAllOperations: false,
    levelStars: {},
    bestScores: {},
    upgrades,
    achievements: {},
    stats: {
      buildingsDestroyed: 0,
      skyscrapersDestroyed: 0,
      tanksDestroyed: 0,
      helisDestroyed: 0,
      carsLaunched: 0,
      fuelTanksDetonated: 0,
      maxCombo: 0,
      maxTierReached: 1,
      bossDefeated: false
    },
    settings: {
      masterVolume: 0.85,
      musicVolume: 0.55,
      sfxVolume: 0.85,
      screenShake: 1.0,
      quality: (typeof window !== 'undefined' && window.patch?.quality) ? window.patch.quality : 'high'
    }
  };
}

export class SaveSystem {
  constructor() {
    this.data = createDefaultSave();
    this.onAchievementUnlock = null;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const def = createDefaultSave();
        this.data = {
          ...def,
          ...parsed,
          upgrades: { ...def.upgrades, ...(parsed.upgrades || {}) },
          stats: { ...def.stats, ...(parsed.stats || {}) },
          settings: { ...def.settings, ...(parsed.settings || {}) },
          achievements: { ...(parsed.achievements || {}) },
          levelStars: { ...(parsed.levelStars || {}) },
          bestScores: { ...(parsed.bestScores || {}) }
        };
      }
    } catch {
      this.data = createDefaultSave();
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Ignore storage quota / sandbox issues
    }
  }

  reset() {
    const keepSettings = { ...this.data.settings };
    this.data = createDefaultSave();
    this.data.settings = keepSettings;
    this.save();
  }

  getUpgradeRank(id) {
    return this.data.upgrades[id] || 0;
  }

  getUpgradeCost(upgradeDef) {
    const rank = this.getUpgradeRank(upgradeDef.id);
    if (rank >= upgradeDef.maxRank) return Infinity;
    return Math.round(upgradeDef.baseCost * Math.pow(upgradeDef.costScale, rank));
  }

  buyUpgrade(upgradeDef) {
    const cost = this.getUpgradeCost(upgradeDef);
    if (this.data.dna < cost) return false;
    this.data.dna -= cost;
    this.data.upgrades[upgradeDef.id] = (this.data.upgrades[upgradeDef.id] || 0) + 1;
    this.checkAchievements();
    this.save();
    return true;
  }

  isKaijuUnlocked(id) {
    return this.data.unlockedKaiju.includes(id);
  }

  unlockKaiju(kaijuDef) {
    if (this.isKaijuUnlocked(kaijuDef.id)) return true;
    if (this.data.dna < kaijuDef.unlockCost) return false;
    this.data.dna -= kaijuDef.unlockCost;
    this.data.unlockedKaiju.push(kaijuDef.id);
    this.data.selectedKaiju = kaijuDef.id;
    this.save();
    return true;
  }

  addDna(amount) {
    this.data.dna = Math.max(0, Math.round(this.data.dna + amount));
    this.save();
  }

  completeLevel(levelId, stars, score) {
    const prevStars = this.data.levelStars[levelId] || 0;
    this.data.levelStars[levelId] = Math.max(prevStars, stars);
    const prevScore = this.data.bestScores[levelId] || 0;
    this.data.bestScores[levelId] = Math.max(prevScore, Math.round(score));

    if (levelId < 5 && this.data.highestUnlockedLevel < levelId + 1) {
      this.data.highestUnlockedLevel = levelId + 1;
    }
    // Auto-unlock Scorpio-9 if player beats Operation 2 as a milestone reward too!
    if (levelId >= 2 && !this.data.unlockedKaiju.includes('scorpion')) {
      this.data.unlockedKaiju.push('scorpion');
    }
    this.checkAchievements();
    this.save();
  }

  unlockAchievement(id) {
    if (this.data.achievements[id]) return false;
    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (!def) return false;
    this.data.achievements[id] = Date.now();
    this.save();
    if (this.onAchievementUnlock) {
      this.onAchievementUnlock(def);
    }
    return true;
  }

  checkAchievements() {
    const s = this.data.stats;
    if (s.buildingsDestroyed >= 10) this.unlockAchievement('first_block');
    if (s.maxTierReached >= 3) this.unlockAchievement('pocket_no_more');
    if (s.maxTierReached >= 5) this.unlockAchievement('apex_titan');
    if (s.helisDestroyed >= 5) this.unlockAchievement('fly_swatter');
    if (s.tanksDestroyed >= 10) this.unlockAchievement('tank_buster');
    if (s.carsLaunched >= 15) this.unlockAchievement('car_kicker');
    if (s.maxCombo >= 20) this.unlockAchievement('combo_king');
    if (s.fuelTanksDetonated >= 1) this.unlockAchievement('chain_reaction');
    if (s.skyscrapersDestroyed >= 1) this.unlockAchievement('skyscraper_timber');

    const totalUpgrades = Object.values(this.data.upgrades).reduce((a, b) => a + b, 0);
    if (totalUpgrades >= 5) this.unlockAchievement('mad_scientist');
    if (s.bossDefeated) this.unlockAchievement('boss_slayer');
  }
}

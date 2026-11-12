// Exact local asset manifest for Pocket Kaiju — 100% sourced from patch.gg library

export const MODEL_MANIFEST = {
  // === PLAYABLE KAIJU & MECHS (Rigged & Animated) ===
  kaiju_rex: {
    url: './assets/models/animatedTRexWith7.glb',
    baseHeight: 1.0, // normalized to 1m unit height, scaled dynamically by Kaiju size (7.2m -> 45m)
    skinned: true
  },
  kaiju_ape: {
    url: './assets/models/animatedGiantApeWith5.glb',
    baseHeight: 1.0,
    skinned: true
  },
  kaiju_scorpion: {
    url: './assets/models/animatedGiantScorpionWith4.glb',
    baseHeight: 1.0,
    skinned: true
  },
  mech_walker: {
    url: './assets/models/animatedTwoLeggedMechWith.glb',
    baseHeight: 1.0,
    skinned: true
  },

  // === SUBURBAN BUILDINGS (Tier 1) ===
  suburban_f: { url: './assets/models/buildingTypeF.glb', baseHeight: 9.2, tier: 1, hp: 50, biomass: 14, dna: 6, score: 150, fragments: 9 },
  suburban_h: { url: './assets/models/buildingTypeH.glb', baseHeight: 7.8, tier: 1, hp: 42, biomass: 12, dna: 5, score: 120, fragments: 8 },
  suburban_j: { url: './assets/models/buildingTypeJ.glb', baseHeight: 8.6, tier: 1, hp: 48, biomass: 13, dna: 5, score: 140, fragments: 9 },
  suburban_l: { url: './assets/models/buildingTypeL.glb', baseHeight: 9.5, tier: 1, hp: 55, biomass: 15, dna: 6, score: 160, fragments: 9 },
  suburban_n: { url: './assets/models/buildingTypeN.glb', baseHeight: 10.6, tier: 1, hp: 62, biomass: 16, dna: 7, score: 180, fragments: 10 },
  suburban_p: { url: './assets/models/buildingTypeP.glb', baseHeight: 9.0, tier: 1, hp: 52, biomass: 14, dna: 6, score: 150, fragments: 9 },

  // === COMMERCIAL & INDUSTRIAL BUILDINGS (Tier 2) ===
  comm_a: { url: './assets/models/buildingA.glb', baseHeight: 14.5, tier: 2, hp: 115, biomass: 24, dna: 11, score: 320, fragments: 11 },
  comm_c: { url: './assets/models/buildingC.glb', baseHeight: 15.5, tier: 2, hp: 125, biomass: 26, dna: 12, score: 350, fragments: 11 },
  comm_f: { url: './assets/models/buildingF.glb', baseHeight: 18.0, tier: 2, hp: 145, biomass: 30, dna: 14, score: 420, fragments: 12 },
  comm_h: { url: './assets/models/buildingH.glb', baseHeight: 16.8, tier: 2, hp: 135, biomass: 28, dna: 13, score: 390, fragments: 12 },
  ind_a: { url: './assets/models/buildingA2.glb', baseHeight: 15.0, tier: 2, hp: 130, biomass: 28, dna: 13, score: 380, fragments: 12 },
  ind_b: { url: './assets/models/buildingB.glb', baseHeight: 17.5, tier: 2, hp: 150, biomass: 32, dna: 15, score: 440, fragments: 12 },
  ind_e: { url: './assets/models/buildingE.glb', baseHeight: 14.2, tier: 2, hp: 120, biomass: 25, dna: 12, score: 340, fragments: 11 },

  // === HIGH-RISE TOWERS (Tier 3) ===
  comm_j: { url: './assets/models/buildingJ.glb', baseHeight: 26.5, tier: 3, hp: 240, biomass: 46, dna: 22, score: 750, fragments: 15 },
  comm_l: { url: './assets/models/buildingL.glb', baseHeight: 24.0, tier: 3, hp: 215, biomass: 42, dna: 20, score: 680, fragments: 14 },
  comm_n: { url: './assets/models/buildingN.glb', baseHeight: 29.5, tier: 3, hp: 270, biomass: 52, dna: 25, score: 850, fragments: 15 },

  // === MEGA-SKYSCRAPERS (Tier 4) ===
  sky_a: { url: './assets/models/buildingSkyscraperA.glb', baseHeight: 38.0, tier: 4, hp: 370, biomass: 72, dna: 36, score: 1350, fragments: 17 },
  sky_b: { url: './assets/models/buildingSkyscraperB.glb', baseHeight: 44.0, tier: 4, hp: 430, biomass: 85, dna: 42, score: 1600, fragments: 18 },
  sky_c: { url: './assets/models/buildingSkyscraperC.glb', baseHeight: 48.0, tier: 4, hp: 470, biomass: 95, dna: 48, score: 1850, fragments: 18 },
  sky_d: { url: './assets/models/buildingSkyscraperD.glb', baseHeight: 53.0, tier: 4, hp: 520, biomass: 110, dna: 55, score: 2200, fragments: 18 },
  sky_e: { url: './assets/models/buildingSkyscraperE.glb', baseHeight: 35.0, tier: 4, hp: 340, biomass: 66, dna: 33, score: 1200, fragments: 16 },

  // === SPECIAL LANDMARKS & EXPLOSIVE INDUSTRIAL STRUCTURES ===
  fuel_tank: { url: './assets/models/fuelFarmTank.glb', baseHeight: 10.5, tier: 2, hp: 70, biomass: 30, dna: 18, score: 600, fragments: 10, explosive: true },
  ind_tank: { url: './assets/models/detailTankLarge.glb', baseHeight: 9.0, tier: 2, hp: 60, biomass: 24, dna: 15, score: 500, fragments: 9, explosive: true },
  radar_mast: { url: './assets/models/radarAerialMast.glb', baseHeight: 32.0, tier: 3, hp: 340, biomass: 70, dna: 45, score: 1500, fragments: 14, landmark: true },
  crystal_pylon: { url: './assets/models/towerRoundCrystals.glb', baseHeight: 23.0, tier: 3, hp: 300, biomass: 65, dna: 45, score: 1500, fragments: 13, landmark: true },
  barrel: { url: './assets/models/barrel.glb', baseHeight: 1.9 },

  // === RUBBLE & DEBRIS PIECES ===
  rubble_mound: { url: './assets/models/collapseRubbleMound.glb', baseLength: 5.5 },
  rubble_chunk: { url: './assets/models/masonryRubbleChunk.glb', baseLength: 1.6 },
  rubble_decal: { url: './assets/models/rubbleScatterDecal.glb', baseLength: 6.5 },
  debris_stone: { url: './assets/models/debris.glb', baseHeight: 1.2 },
  debris_tire: { url: './assets/models/debrisTire.glb', baseHeight: 0.9 },
  debris_door: { url: './assets/models/debrisDoorWindow.glb', baseHeight: 1.3 },
  debris_bumper: { url: './assets/models/debrisBumper.glb', baseHeight: 0.7 },
  debris_plate: { url: './assets/models/debrisPlateA.glb', baseHeight: 0.9 },

  // === CITY PROPS ===
  tree_detailed: { url: './assets/models/treeDetailed.glb', baseHeight: 6.2 },
  tree_default: { url: './assets/models/treeDefault.glb', baseHeight: 5.4 },
  light_curved: { url: './assets/models/lightCurved.glb', baseHeight: 5.5 },
  light_double: { url: './assets/models/lightSquareDouble.glb', baseHeight: 5.8 },
  traffic_light: { url: './assets/models/trafficLight.glb', baseHeight: 5.0 },
  police_barricade: { url: './assets/models/policeBarricade.glb', baseHeight: 1.4 },

  // === CIVILIANS (Rigged & Animated) ===
  civ_male_a: { url: './assets/models/characterMaleA.glb', baseHeight: 2.05, skinned: true },
  civ_male_b: { url: './assets/models/characterMaleB.glb', baseHeight: 2.05, skinned: true },
  civ_female_a: { url: './assets/models/characterFemaleA.glb', baseHeight: 1.98, skinned: true },
  civ_female_b: { url: './assets/models/characterFemaleB.glb', baseHeight: 1.98, skinned: true },
  police_officer: { url: './assets/models/policeOfficer.glb', baseHeight: 2.1, skinned: false },

  // === CIVILIAN & EMERGENCY VEHICLES ===
  car_sedan: { url: './assets/models/sedan.glb', baseLength: 4.6 },
  car_sports: { url: './assets/models/sedanSports.glb', baseLength: 4.6 },
  car_taxi: { url: './assets/models/taxi.glb', baseLength: 4.7 },
  car_suv: { url: './assets/models/suv.glb', baseLength: 4.9 },
  car_delivery: { url: './assets/models/delivery.glb', baseLength: 5.7 },
  car_truck: { url: './assets/models/truck.glb', baseLength: 6.5 },
  car_police: { url: './assets/models/police.glb', baseLength: 4.8 },
  car_ambulance: { url: './assets/models/ambulance.glb', baseLength: 5.8 },
  car_firetruck: { url: './assets/models/firetruck.glb', baseLength: 7.4 },

  // === MILITARY ARMY & WEAPONS ===
  tank_medium: { url: './assets/models/mediumTank.glb', baseLength: 7.8 },
  helicopter: { url: './assets/models/helicopter.glb', baseLength: 11.5 },
  fighter_jet: { url: './assets/models/businessJet.glb', baseLength: 16.5 },
  defense_turret: { url: './assets/models/defenseTurret.glb', baseHeight: 4.3 },
  boss_turret: { url: './assets/models/turretDouble.glb', baseHeight: 1.0 },
  missile: { url: './assets/models/missile.glb', baseLength: 3.2 }
};

export const AUDIO_MANIFEST = {
  // Destruction & Heavy Impacts
  explosionCrunch: './assets/audio/explosionCrunch1MediumLength.ogg',
  explosionLow: './assets/audio/lowFrequencyExplosion1Long.ogg',
  glassHeavy: './assets/audio/glassImpactHeavy1Short.ogg',
  glassMedium: './assets/audio/glassImpactMedium1Medium.ogg',
  metalHeavy: './assets/audio/metalImpactHeavy1Short.ogg',
  plateHeavy: './assets/audio/plateImpactHeavy1Medium.ogg',
  punchHeavy: './assets/audio/punchImpactHeavy1Medium.ogg',
  woodHeavy: './assets/audio/woodImpactHeavy1Medium.ogg',
  miningImpact: './assets/audio/miningImpact1MediumLength.ogg',
  footstep: './assets/audio/footstepOnConcrete1Short.ogg',

  // Beams, Engines, Powerups
  laserLarge: './assets/audio/laserLarge1MediumLength.ogg',
  laserSmall: './assets/audio/laserSmall1ShortSoft.ogg',
  thrusterFire: './assets/audio/thrusterFire1LongMedium.ogg',
  jetFlyby: './assets/audio/spaceEngineLarge1Long.ogg',
  heliLoop: './assets/audio/spaceEngineLow1Long.ogg',
  powerUp: './assets/audio/powerUp10MediumLength.ogg',
  phaserUp: './assets/audio/phaserUp1MediumLength.ogg',
  evolveZap: './assets/audio/zapThreeToneUpLong.ogg',

  // Radio & Announcer Callouts
  voBackup: './assets/audio/callForBackupMaleMilitary.ogg',
  voGetDown: './assets/audio/getDownFemaleMilitary.ogg',
  voFireInHole: './assets/audio/fireInTheHoleMale.ogg',
  voBegin: './assets/audio/beginFightingAnnouncer.ogg',
  voFinalRound: './assets/audio/finalRoundFightingAnnouncer.ogg',
  voVictory: './assets/audio/flawlessVictoryFightingAnnouncer.ogg',
  voGameOver: './assets/audio/gameOverFightingAnnouncer.ogg',

  // UI
  uiClick: './assets/audio/click1ShortSoft.ogg',
  uiConfirm: './assets/audio/confirmation1ShortLoud.ogg',
  uiOpen: './assets/audio/maximize1ShortMedium.ogg',
  uiError: './assets/audio/error1ShortMedium.ogg'
};

export const MUSIC_MANIFEST = {
  menu: './assets/music/ancientEvilAwakens.ogg',
  rampageA: './assets/music/to100.ogg',
  rampageB: './assets/music/stageFFaster.ogg',
  boss: './assets/music/epicBossBattle.ogg'
};

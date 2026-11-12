// Complete Steam-caliber Game Configuration for POCKET KAIJU

export const KAIJU_ROSTER = [
  {
    id: 'rex',
    name: 'REX-84',
    title: 'Atomic Tyrant',
    modelKey: 'kaiju_rex',
    unlockedByDefault: true,
    unlockCost: 0,
    accentColor: '#39ff88',
    beamColor: 0x39ff88,
    glowHex: 0x22ff77,
    tagline: 'Prehistoric apex predator awakened by deep-sea nuclear testing.',
    stats: {
      power: 1.0,
      speed: 1.0,
      armor: 1.0,
      beamPower: 1.15
    },
    abilities: {
      primary: { name: 'Tectonic Jaws', desc: 'Cleaving bite & tail shockwave that shatters facades and sends cars flying.' },
      secondary: { name: 'Atomic Plasma Breath', desc: 'Hold RMB / E to sweep a radioactive plasma beam across buildings and helicopters.' },
      leap: { name: 'Meteor Stomp', desc: 'Press SHIFT to leap skyward and slam down, creating a seismic crater.' },
      ultimate: { name: 'Meltdown Roar', desc: 'Press R when charged to unleash a 360° thermonuclear shockwave.' }
    },
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      attack: 'Attack',
      hit: 'Hit',
      jump: 'Jump',
      roar: 'Roar'
    }
  },
  {
    id: 'ape',
    name: 'KONG-X',
    title: 'Colossal Silverback',
    modelKey: 'kaiju_ape',
    unlockedByDefault: true,
    unlockCost: 0,
    accentColor: '#ff9d2e',
    beamColor: 0xff8822,
    glowHex: 0xff8811,
    tagline: 'Hyper-intelligent Hollow-Earth titan built for brutal bare-knuckle demolition.',
    stats: {
      power: 1.25,
      speed: 0.96,
      armor: 1.2,
      beamPower: 1.0
    },
    abilities: {
      primary: { name: 'Double-Fist Haymaker', desc: 'Crushing knuckle slam with wider radius and +25% structural damage.' },
      secondary: { name: 'Titan Mega-Hurl', desc: 'Press RMB / E to rip a molten boulder from the earth and hurl it at aircraft or towers.' },
      leap: { name: 'King Vault Slam', desc: 'Press SHIFT for a long-distance gorilla leap that flattens entire intersections.' },
      ultimate: { name: 'Primal Chest-Beat', desc: 'Press R to beat chest, shockwaving the block and entering Berserk Overdrive.' }
    },
    clips: {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Walk',
      attack: 'ChestBeat',
      hit: 'Hit',
      jump: 'Jump',
      roar: 'ChestBeat'
    }
  },
  {
    id: 'scorpion',
    name: 'SCORPIO-9',
    title: 'Abyssal Stinger',
    modelKey: 'kaiju_scorpion',
    unlockedByDefault: false,
    unlockCost: 180,
    accentColor: '#c84bff',
    beamColor: 0xd147ff,
    glowHex: 0xb833ff,
    tagline: 'Bio-engineered chitinous dreadnought armed with twin pincers and plasma-acid artillery.',
    stats: {
      power: 1.05,
      speed: 1.22,
      armor: 1.05,
      beamPower: 1.25
    },
    abilities: {
      primary: { name: 'Pincer Shear', desc: 'Rapid twin-claw snap that shreds armored tanks and foundations.' },
      secondary: { name: 'Venom Plasma Volley', desc: 'Hold RMB / E to fire explosive bio-plasma bursts from the tail stinger.' },
      leap: { name: 'Predator Pounce', desc: 'Press SHIFT to dash-leap at blinding speed and impale the landing zone.' },
      ultimate: { name: 'Bio-Acid Cataclysm', desc: 'Press R to rain corrosive plasma across every nearby city block.' }
    },
    clips: {
      idle: 'ClawSnap',
      walk: 'ClawSnap',
      run: 'ClawSnap',
      attack: 'Attack',
      hit: 'Hit',
      jump: 'Jump',
      roar: 'Attack'
    }
  }
];

export const SIZE_CLASSES = [
  {
    tier: 1,
    name: 'POCKET HATCHLING',
    minBiomass: 0,
    heightMeters: 7.4,
    trampleTier: 0, // crushes props, trees, cars
    camDist: 28,
    camHeight: 21,
    fov: 50,
    footstepPitch: 1.15
  },
  {
    tier: 2,
    name: 'STREET RAVAGER',
    minBiomass: 185,
    heightMeters: 13.0,
    trampleTier: 1, // walks right through suburban homes!
    camDist: 42,
    camHeight: 31,
    fov: 53,
    footstepPitch: 0.95
  },
  {
    tier: 3,
    name: 'DISTRICT BEHEMOTH',
    minBiomass: 520,
    heightMeters: 20.5,
    trampleTier: 2, // walks through commercial & industrial buildings!
    camDist: 58,
    camHeight: 43,
    fov: 56,
    footstepPitch: 0.78
  },
  {
    tier: 4,
    name: 'METRO TITAN',
    minBiomass: 1050,
    heightMeters: 29.5,
    trampleTier: 3, // walks through high-rises & tanks!
    camDist: 76,
    camHeight: 56,
    fov: 59,
    footstepPitch: 0.64
  },
  {
    tier: 5,
    name: 'APEX CALAMITY',
    minBiomass: 1750,
    heightMeters: 40.0,
    trampleTier: 4, // walks straight through mega-skyscrapers!
    camDist: 96,
    camHeight: 70,
    fov: 62,
    footstepPitch: 0.52
  }
];

export const LAB_UPGRADES = [
  {
    id: 'muscle',
    name: 'Titan Myofibrils',
    icon: '💥',
    desc: '+20% Primary Smash, Trample & Leap damage per rank.',
    maxRank: 5,
    baseCost: 55,
    costScale: 1.55
  },
  {
    id: 'carapace',
    name: 'Obsidian Carapace',
    icon: '🛡️',
    desc: '+25% Max Health and +7% military damage resistance per rank.',
    maxRank: 5,
    baseCost: 50,
    costScale: 1.5
  },
  {
    id: 'metabolism',
    name: 'Hyper-Metabolism',
    icon: '🧬',
    desc: '+22% Bio-Mass growth from every destroyed structure & vehicle.',
    maxRank: 5,
    baseCost: 60,
    costScale: 1.6
  },
  {
    id: 'atomicCore',
    name: 'Cherenkov Reactor',
    icon: '☢️',
    desc: '+25% Special Weapon damage and +20% Energy recharge speed.',
    maxRank: 5,
    baseCost: 65,
    costScale: 1.55
  },
  {
    id: 'stride',
    name: 'Tectonic Stride',
    icon: '⚡',
    desc: '+11% Movement Speed and -12% Leap Stomp cooldown.',
    maxRank: 5,
    baseCost: 50,
    costScale: 1.5
  },
  {
    id: 'magnet',
    name: 'Gravitational Maw',
    icon: '🌀',
    desc: '+45% Bio-Orb pickup radius and +18% bonus Mutagen DNA yield.',
    maxRank: 5,
    baseCost: 55,
    costScale: 1.55
  },
  {
    id: 'siphon',
    name: 'Bio-Regeneration',
    icon: '💚',
    desc: 'Recover HP on every collapsed building and crushed military unit.',
    maxRank: 5,
    baseCost: 70,
    costScale: 1.6
  },
  {
    id: 'chainShock',
    name: 'Seismic Aftershock',
    icon: '🌋',
    desc: 'Collapsing buildings unleash shockwaves dealing AoE damage to neighbors.',
    maxRank: 5,
    baseCost: 75,
    costScale: 1.65
  }
];

export const RUN_MUTATIONS = [
  {
    id: 'plasma_overcharge',
    name: 'Gamma Overdrive',
    tag: 'OFFENSE',
    color: '#39ff88',
    desc: '+40% Special Beam/Volley damage and +30% wider beam radius.'
  },
  {
    id: 'quake_stomp',
    name: 'Magnitude 10 Stomp',
    tag: 'DEMOLITION',
    color: '#ff9d2e',
    desc: 'Leap Slam radius +55% and leaves a molten shock-ring that melts tanks.'
  },
  {
    id: 'thorns_spires',
    name: 'Arc-Lightning Spines',
    tag: 'DEFENSE',
    color: '#38d6ff',
    desc: 'Automatically zaps nearby helicopters, missiles, and tanks every 1.6s.'
  },
  {
    id: 'feast_frenzy',
    name: 'Apex Gorging',
    tag: 'GROWTH',
    color: '#a3ff3d',
    desc: '+35% Bio-Mass growth rate and instant 25% Max HP heal.'
  },
  {
    id: 'domino_collapse',
    name: 'Domino Collapse',
    tag: 'CHAIN',
    color: '#ff4d6d',
    desc: 'Every destroyed building blasts shrapnel into adjacent blocks for 45 AoE damage.'
  },
  {
    id: 'juggernaut_hide',
    name: 'Kaiju-Steel Hide',
    tag: 'SURVIVAL',
    color: '#ffd166',
    desc: '+45% Max HP, full heal, and +20% resistance to missiles & lasers.'
  },
  {
    id: 'kick_master',
    name: 'Railgun Kick',
    tag: 'PHYSICS',
    color: '#ff6b35',
    desc: 'Smashed & kicked cars/tanks fly 80% faster and detonate like heavy bombs.'
  },
  {
    id: 'meltdown_charge',
    name: 'Critical Mass',
    tag: 'ULTIMATE',
    color: '#d147ff',
    desc: 'Ultimate charges 65% faster and grants +50% Ultimate radius.'
  }
];

export const CAMPAIGN_LEVELS = [
  {
    id: 1,
    code: 'OP-01',
    name: 'SUNNYVALE OUTSKIRTS',
    subtitle: 'First Contact',
    music: 'rampageA',
    gridSize: 7, // 7x7 city blocks
    blockSpacing: 28,
    theme: 'suburban',
    skyTop: 0x2b6cb0,
    skyHorizon: 0x9ad8ff,
    fogColor: 0x99d0f2,
    fogDensity: 0.0028,
    sunColor: 0xfff3d6,
    sunIntensity: 2.3,
    ambientColor: 0x7aa5d2,
    ambientIntensity: 1.05,
    startBiomass: 0,
    targetDestructionPct: 58,
    landmarkType: 'radar_mast',
    landmarkCount: 1,
    landmarkLabel: 'Military Early-Warning Radar',
    maxDefcon: 3,
    eliteMechs: 0,
    hasBoss: false,
    briefing: 'Emerge from the coast as a 7-meter hatchling. Devour suburban blocks to grow into a Behemoth and silence the Army Radar Tower before reinforcements arrive.',
    rewardBonusDna: 90
  },
  {
    id: 2,
    code: 'OP-02',
    name: 'PORT REDLINE REFINERY',
    subtitle: 'Chain Reaction',
    music: 'rampageB',
    gridSize: 8,
    blockSpacing: 29,
    theme: 'industrial',
    skyTop: 0x3b1d36,
    skyHorizon: 0xff7b42,
    fogColor: 0xd97548,
    fogDensity: 0.0029,
    sunColor: 0xff9f5a,
    sunIntensity: 2.5,
    ambientColor: 0x9c5a63,
    ambientIntensity: 0.95,
    startBiomass: 45,
    targetDestructionPct: 62,
    landmarkType: 'fuel_tank',
    landmarkCount: 3,
    landmarkLabel: 'Strategic Fuel Cores',
    maxDefcon: 4,
    eliteMechs: 1,
    hasBoss: false,
    briefing: 'Sunset over the heavy refinery port. Volatile Fuel Farm Tanks trigger massive chain explosions! Watch out for Attack Helicopters and an experimental Vanguard Mech.',
    rewardBonusDna: 150
  },
  {
    id: 3,
    code: 'OP-03',
    name: 'NEO-METRO FINANCIAL',
    subtitle: 'Skyscraper Buffet',
    music: 'rampageA',
    gridSize: 8,
    blockSpacing: 30,
    theme: 'downtown',
    skyTop: 0x090d24,
    skyHorizon: 0x283578,
    fogColor: 0x18224d,
    fogDensity: 0.0027,
    sunColor: 0x9bb8ff,
    sunIntensity: 1.9,
    ambientColor: 0x48589c,
    ambientIntensity: 1.15,
    startBiomass: 130,
    targetDestructionPct: 65,
    landmarkType: 'crystal_pylon',
    landmarkCount: 3,
    landmarkLabel: 'Defense Grid Relays',
    maxDefcon: 5,
    eliteMechs: 2,
    hasBoss: false,
    briefing: 'Dusk falls on downtown Neo-Metro. Grow into a 35-meter Titan to topple gleaming skyscrapers while dodging Fighter Jet carpet-bombing runs and Mech patrols!',
    rewardBonusDna: 230
  },
  {
    id: 4,
    code: 'OP-04',
    name: 'CITADEL OMEGA',
    subtitle: 'FINAL BOSS: PROJECT AEGIS-ZERO',
    music: 'boss',
    gridSize: 9,
    blockSpacing: 30,
    theme: 'citadel',
    skyTop: 0x1a0714,
    skyHorizon: 0x7c162e,
    fogColor: 0x3b1022,
    fogDensity: 0.0025,
    sunColor: 0xff6859,
    sunIntensity: 2.3,
    ambientColor: 0x7a3852,
    ambientIntensity: 1.1,
    startBiomass: 250,
    targetDestructionPct: 40,
    landmarkType: 'crystal_pylon',
    landmarkCount: 3,
    landmarkLabel: 'Aegis Quantum Shield Pylons',
    maxDefcon: 5,
    eliteMechs: 1,
    hasBoss: true,
    briefing: 'Humanity deploys its ultimate weapon: COLOSSAL JAEGER "AEGIS-ZERO" (36m). Shatter its 3 Quantum Shield Pylons, devour skyscrapers to match its size, and claim the planet!',
    rewardBonusDna: 500
  },
  {
    id: 5,
    code: 'ENDLESS',
    name: 'EXTINCTION SANDBOX',
    subtitle: 'Infinite Rampage',
    music: 'rampageB',
    gridSize: 9,
    blockSpacing: 30,
    theme: 'downtown',
    skyTop: 0x10253e,
    skyHorizon: 0x48a9a6,
    fogColor: 0x265469,
    fogDensity: 0.0024,
    sunColor: 0xffe6b8,
    sunIntensity: 2.3,
    ambientColor: 0x6290a8,
    ambientIntensity: 1.1,
    startBiomass: 90,
    targetDestructionPct: 100,
    landmarkType: 'radar_mast',
    landmarkCount: 4,
    landmarkLabel: 'Orbital Beacons',
    maxDefcon: 5,
    eliteMechs: 3,
    hasBoss: false,
    endless: true,
    briefing: 'Maximum city density, regenerating military battalions, and uncapped Kaiju growth. How high can you push the Global Extinction Score?',
    rewardBonusDna: 300
  }
];

export const ACHIEVEMENTS = [
  { id: 'first_block', name: 'Urban Renewal', icon: '🏚️', desc: 'Demolish your first 10 city buildings.' },
  { id: 'pocket_no_more', name: 'Pocket No More', icon: '🦖', desc: 'Grow to Size Class III: District Behemoth (20m+).' },
  { id: 'apex_titan', name: 'Apex Calamity', icon: '👑', desc: 'Reach Size Class V: Apex Calamity (40m+).' },
  { id: 'fly_swatter', name: 'Fly Swatter', icon: '🚁', desc: 'Shoot down or swat 5 military Attack Helicopters.' },
  { id: 'tank_buster', name: 'Tin Can Opener', icon: '🛡️', desc: 'Crush or vaporize 10 Army Medium Tanks.' },
  { id: 'car_kicker', name: 'Rush Hour Bowling', icon: '🚗', desc: 'Launch 15 vehicles across the city.' },
  { id: 'combo_king', name: 'Magnitude 9.9', icon: '🔥', desc: 'Reach a 20x Destruction Combo multiplier.' },
  { id: 'chain_reaction', name: 'Refinery Fireworks', icon: '💥', desc: 'Detonate an explosive Fuel Farm Tank.' },
  { id: 'skyscraper_timber', name: 'Timber!!', icon: '🏙️', desc: 'Collapse a Tier-4 Mega-Skyscraper into rubble.' },
  { id: 'mad_scientist', name: 'Apex Evolution', icon: '🧬', desc: 'Purchase 5 permanent upgrades in the Evolution Lab.' },
  { id: 'shield_breaker', name: 'Shield Breaker', icon: '⚡', desc: 'Destroy all 3 Quantum Shield Pylons in Citadel Omega.' },
  { id: 'boss_slayer', name: 'King of the Monsters', icon: '🏆', desc: 'Defeat Final Boss PROJECT AEGIS-ZERO and conquer Earth!' }
];

export const NEWS_TICKER_LINES = {
  intro: [
    'BREAKING: Unidentified "Pocket-Sized" creature sighted near city limits — residents advised to stay indoors!',
    'GNN LIVE: Scientists warn creature is absorbing urban carbon & concrete to grow exponentially!',
    'TRAFFIC ALERT: Gridlock on all outbound highways as panicked commuters abandon vehicles!'
  ],
  growing: [
    'URGENT: Kaiju mass has doubled in minutes — suburban blocks flattening under its footsteps!',
    'EYEWITNESS: "It just walked straight through my office building like cardboard!"',
    'PENTAGON BRIEFING: Armored Tank Divisions and Air Cavalry authorized to use maximum force!'
  ],
  giant: [
    'CATACLYSM ALERT: Monster now rivals downtown skyscrapers — Richter 7.4 tremors recorded!',
    'DEFCON 1: Fighter wings scrambled for tactical carpet bombing — evacuate immediately!',
    'STOCK MARKET HALTED: Insurance companies declare "Act of Kaiju" across entire metro area!'
  ],
  boss: [
    'FINAL PROTOCOL: Colossal Jaeger "PROJECT AEGIS-ZERO" deployed to Citadel Omega!',
    'MILITARY COMMAND: Protect the 3 Quantum Shield Pylons at all costs — Aegis-Zero engaging target!',
    'CLASH OF TITANS: Steel vs. Bio-Atomic Fury in the heart of the capital!'
  ]
};

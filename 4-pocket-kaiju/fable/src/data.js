// Static game data: kaiju roster, levels, upgrades, building pools, save data.

export const KAIJU = {
  rex: {
    id: 'rex', name: 'REX', title: 'The Pocket Tyrant',
    blurb: 'A balanced apex predator. Devastating bite, long tail sweep and a searing atomic breath.',
    model: 'kaiju/trex', modelHeight: 5.76, radius: 0.34, headBone: 'head', mouthFwd: 0.22,
    clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', stomp: 'Jump', roar: 'Roar', hit: 'Hit' },
    attackRate: 3.6, attackHit: 0.42, stompRate: 3.4, roarRate: 1.5, walkCycle: 1.0,
    stats: { hp: 1.0, speed: 1.0, melee: 1.0, breath: 1.0, stomp: 1.0 },
    beam: { core: 0xbfefff, glow: 0x35b8ff, name: 'ATOMIC BREATH' },
    unlock: null,
  },
  gronk: {
    id: 'gronk', name: 'GRONK', title: 'The Swamp Colossus',
    blurb: 'A lumbering brute. Slower, but his ground slam flattens whole blocks and he shrugs off shells.',
    model: 'kaiju/ogre', modelHeight: 2.8, radius: 0.3, headBone: 'head', mouthFwd: 0.12,
    clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', stomp: 'GroundSlam', roar: 'Hit', hit: 'Hit' },
    attackRate: 4.2, attackHit: 0.45, stompRate: 3.2, roarRate: 1.6, walkCycle: 1.0,
    stats: { hp: 1.35, speed: 0.88, melee: 1.1, breath: 0.8, stomp: 1.45 },
    beam: { core: 0xe6ffb0, glow: 0x66dd22, name: 'BOG BREATH' },
    unlock: { level: 1, text: 'Flatten NEW CARBON CITY to unlock' },
  },
  kong: {
    id: 'kong', name: 'KONGO', title: 'The Silverback Wrecker',
    blurb: 'Fast and furious. Blistering speed and pounding fists, but a thinner hide.',
    model: 'kaiju/ape', modelHeight: 2.4, radius: 0.36, headBone: 'head', mouthFwd: 0.1,
    clips: { idle: 'Idle', walk: 'Walk', run: 'Walk', attack: 'ChestBeat', stomp: 'Jump', roar: 'ChestBeat', hit: 'Hit' },
    attackRate: 5.2, attackHit: 0.4, stompRate: 2.8, roarRate: 2.2, walkCycle: 1.0, runAnimBoost: 1.7,
    stats: { hp: 0.85, speed: 1.22, melee: 1.3, breath: 0.9, stomp: 1.0 },
    beam: { core: 0xffe0ff, glow: 0xc040ff, name: 'SONIC HOWL' },
    unlock: { level: 3, text: 'Flatten NEON HEIGHTS to unlock' },
  },
};

// Landmark s is an absolute scale. Building pools: s = base scale multiplier relative to the level bScale, t = toughness, v = value.
const sub = (l) => 'suburban/building-type-' + l;
const com = (l) => 'commercial/building-' + l;
const ind = (l) => 'industrial/building-' + l;
export const POOLS = {
  houses: 'abcdefghijklmnopqrstu'.split('').map((l) => ({ m: sub(l), s: 1, t: 0.6, v: 1 })),
  shops: 'abcdefgh'.split('').map((l) => ({ m: com(l), s: 1, t: 1, v: 1.4 })),
  offices: 'ijklmn'.split('').map((l) => ({ m: com(l), s: 1, t: 1.25, v: 2 })),
  towers: 'abcde'.split('').map((l) => ({ m: com('skyscraper-' + l), s: 1, t: 1.6, v: 3 })).concat([{ m: com('m'), s: 1, t: 1.5, v: 2.5 }, { m: com('l'), s: 1, t: 1.5, v: 2.5 }]),
  factories: 'abcdefghijklmnopqrst'.split('').map((l) => ({ m: ind(l), s: 1, t: 1.2, v: 1.6 })),
};

export const LANDMARKS = {
  church: { m: 'landmarks/brick-church-322885', s: 2.6, t: 1.4, v: 6, name: 'OLD CHURCH' },
  watertower: { m: 'landmarks/water-tower-7eb7ec', s: 1.6, t: 0.8, v: 5, name: 'WATER TOWER' },
  clock: { m: 'landmarks/clock-tower-752081', s: 6.0, t: 1.6, v: 8, name: 'CLOCK TOWER' },
  pagoda: { m: 'landmarks/tiered-pagoda-f4ade0', s: 6.5, t: 1.8, v: 10, name: 'GRAND PAGODA' },
  temple: { m: 'landmarks/buddhist-temple-hall-f0aa09', s: 4.0, t: 1.5, v: 8, name: 'TEMPLE HALL' },
  lighthouse: { m: 'landmarks/old-lighthouse-48ca6c', s: 3.6, t: 1.4, v: 8, name: 'LIGHTHOUSE' },
  liner: { m: 'ships/ship-ocean-liner', s: 4.2, t: 1.3, v: 10, name: 'OCEAN LINER', ship: true },
  megatank: { m: 'landmarks/fuel-farm-tank-ed67f0', s: 2.5, t: 0.7, v: 6, name: 'FUEL DEPOT', explosive: 1 },
};

// Zone legend for level maps:
//  h houses  c shops  C offices  s skyscrapers  i industry  p park  f fuel farm  k container port
//  m military base  . empty lot  1-9 landmark (see level.landmarks)
export const LEVELS = [
  {
    id: 'suburb', name: 'MAPLE HOLLOW', tag: 'STAGE 1 - SLEEPY SUBURBIA',
    desc: 'You hatched an hour ago. You are the size of a bungalow. Breakfast is served.',
    sky: 'kloofendal43dClearPureSky', skyRot: 0.2,
    sun: { dir: [0.45, 0.8, 0.35], color: 0xfff1d6, intensity: 3.1 },
    hemi: [0xd6e8ff, 0x55683a, 1.15], fog: [0xc3dcf0, 0.0016], ground: 'grass', exposure: 1.0,
    map: [
      'hhhhhh',
      'hphchh',
      'hhc1ch',
      'hccphh',
      'hh2hhh',
      'hhhhhh',
    ],
    landmarks: { 1: 'church', 2: 'watertower' },
    bScale: 2.0, startSize: 8, maxSize: 21, goal: 0.45, parTime: 300,
    people: 170, cars: 26, parked: 0.5,
    army: {
      uScale: 1.0, dmg: 0.3, maxThreat: 3,
      waves: [
        { police: 2 },
        { police: 4, jeep: 1 },
        { police: 5, jeep: 2, tank: 1, heli: 1 },
      ],
    },
    music: 'volatile_reaction',
    tips: ['Walk into small things to crush them.', 'LEFT CLICK to bite. Every third hit is a tail sweep.', 'SPACE to leap and stomp.'],
  },
  {
    id: 'downtown', name: 'NEW CARBON CITY', tag: 'STAGE 2 - DOWNTOWN',
    desc: 'Glass, steel and rush-hour traffic. The army has been called. They brought tanks.',
    sky: 'kloofendal48dPartlyCloudyPure', skyRot: 1.2,
    sun: { dir: [-0.5, 0.75, 0.4], color: 0xfff6e6, intensity: 3.0 },
    hemi: [0xcfe2ff, 0x6a6a70, 1.1], fog: [0xbcd2e6, 0.0013], ground: 'asphalt', exposure: 1.0,
    map: [
      'hcccchh',
      'cCCCCCc',
      'cCssCCc',
      'cCs1spc',
      'cCCssCc',
      'cpCCCCc',
      'hccccch',
    ],
    landmarks: { 1: 'clock' },
    bScale: 2.4, startSize: 16, maxSize: 44, goal: 0.45, parTime: 360,
    people: 190, cars: 40, parked: 0.6,
    army: {
      uScale: 1.25, dmg: 0.5, maxThreat: 4,
      waves: [
        { police: 3, jeep: 1 },
        { police: 3, jeep: 2, tank: 2 },
        { jeep: 2, tank: 3, heli: 2 },
        { jeep: 2, tank: 5, heli: 3, truck: 1 },
      ],
    },
    music: 'five_armies',
    tips: ['Hold RIGHT CLICK to unleash your breath weapon.', 'Press Q to roar: it stuns the army and shreds missiles.', 'Carve the ground floor and the tower comes down.'],
  },
  {
    id: 'harbor', name: 'PORT SMOKESTACK', tag: 'STAGE 3 - INDUSTRIAL HARBOR',
    desc: 'Fuel depots, refineries and an ocean liner. Mind the sparks. Something else is hunting here.',
    sky: 'belfastSunsetPureSky', skyRot: 2.6,
    sun: { dir: [-0.75, 0.32, -0.45], color: 0xffb37a, intensity: 3.4 },
    hemi: [0xffd9c0, 0x4a4450, 0.95], fog: [0xe8b79a, 0.0014], ground: 'asphalt', exposure: 1.0,
    map: [
      'ciiiiic',
      'iifiifi',
      'iCi1iii',
      'ifiiCfi',
      'iiifiii',
      'kkk2kkk',
    ],
    landmarks: { 1: 'megatank', 2: 'lighthouse' },
    water: true, ships: true,
    bScale: 2.5, startSize: 28, maxSize: 60, goal: 0.45, parTime: 420,
    people: 120, cars: 30, parked: 0.4,
    army: {
      uScale: 1.6, dmg: 0.7, maxThreat: 4,
      waves: [
        { jeep: 2, tank: 2 },
        { jeep: 2, tank: 3, heli: 2 },
        { tank: 4, heli: 3, truck: 1, jet: 1 },
        { tank: 5, heli: 4, truck: 2, jet: 1 },
      ],
    },
    boss: 'scorpion',
    music: 'black_vortex', bossMusic: 'clenched_teeth',
    tips: ['Fuel tanks explode. Chain reactions level whole blocks.', 'Wade into the bay to sink the ships.', 'A rival kaiju stalks the harbor...'],
  },
  {
    id: 'neon', name: 'NEON HEIGHTS', tag: 'STAGE 4 - THE MEGACITY',
    desc: 'Midnight in the tallest skyline on Earth. Every gun in the country is pointed at you.',
    sky: 'qwantaniNightPureSky', skyRot: 0.5,
    sun: { dir: [0.35, 0.7, -0.5], color: 0x9db8ff, intensity: 1.5 },
    hemi: [0x5a6aa8, 0x1d1d2c, 1.0], fog: [0x141a33, 0.0012], ground: 'asphalt', exposure: 1.1, night: true,
    map: [
      'CCsCCsCC',
      'CssssssC',
      'sss2ssss',
      'Cssppssc',
      'Css1sssC',
      'ssssssss',
      'CsssCssC',
      'CCsCCsCC',
    ],
    landmarks: { 1: 'pagoda', 2: 'temple' },
    bScale: 3.0, towerStretch: 1.3, startSize: 50, maxSize: 105, goal: 0.42, parTime: 480,
    people: 110, cars: 44, parked: 0.5,
    army: {
      uScale: 2.1, dmg: 0.9, maxThreat: 5,
      waves: [
        { jeep: 2, tank: 3, heli: 2 },
        { tank: 4, heli: 3, truck: 1 },
        { tank: 5, heli: 4, truck: 2, jet: 1 },
        { tank: 6, heli: 5, truck: 2, jet: 2 },
        { tank: 7, heli: 6, truck: 3, jet: 2 },
      ],
    },
    music: 'movement_proposition',
    tips: ['Fill the RAMPAGE meter and press R: invulnerable, double damage.', 'Helicopters hover at head height. Bite them out of the sky.'],
  },
  {
    id: 'fortress', name: 'FORTRESS ZERO', tag: 'FINAL STAGE - OPERATION TITAN',
    desc: 'The last line of defence, and humanity\'s secret weapon: the MK-TITAN war machine.',
    sky: 'kloppenheim02PureSky', skyRot: 4.0,
    sun: { dir: [0.6, 0.38, 0.55], color: 0xffa070, intensity: 3.0 },
    hemi: [0xb9a8c8, 0x3a3340, 0.9], fog: [0x8a6f80, 0.0013], ground: 'asphalt', exposure: 1.0,
    map: [
      'iCsmsCi',
      'CsssssC',
      'sspfpss',
      'msf.fsm',
      'sspfpss',
      'CsssssC',
      'iCsmsCi',
    ],
    landmarks: {},
    bScale: 3.0, towerStretch: 1.15, startSize: 80, maxSize: 112, goal: 0.22, parTime: 540,
    people: 60, cars: 20, parked: 0.3,
    army: {
      uScale: 2.4, dmg: 1.05, maxThreat: 5,
      waves: [
        { tank: 3, heli: 3 },
        { tank: 4, heli: 4, truck: 1 },
        { tank: 5, heli: 4, truck: 2, jet: 1 },
        { tank: 5, heli: 5, truck: 2, jet: 2 },
        { tank: 6, heli: 6, truck: 3, jet: 2 },
      ],
    },
    boss: 'mech', final: true,
    music: 'clenched_teeth', bossMusic: 'mechanolith',
    tips: ['MK-TITAN telegraphs its attacks. Leap over shockwaves with SPACE.', 'Your breath weapon chews through its armour.'],
  },
];

export const ENDLESS = {
  id: 'endless', name: 'ENDLESS RAMPAGE', tag: 'SURVIVAL MODE',
  desc: 'A fresh city every time and an army that never stops coming. How long can you last?',
  sky: 'qwantaniDusk2PureSky', skyRot: 1.0,
  sun: { dir: [0.6, 0.35, -0.5], color: 0xffa684, intensity: 3.0 },
  hemi: [0xd8c4e8, 0x443c50, 1.0], fog: [0xc79aa8, 0.0013], ground: 'asphalt', exposure: 1.0,
  map: null, // generated
  landmarks: { 1: 'clock', 2: 'pagoda', 3: 'church' },
  bScale: 2.6, towerStretch: 1.15, startSize: 14, maxSize: 110, goal: 2, parTime: 9999, endless: true,
  people: 150, cars: 36, parked: 0.5,
  army: {
    uScale: 1.3, dmg: 0.6, maxThreat: 5,
    waves: [
      { police: 3, jeep: 1 },
      { jeep: 2, tank: 2, heli: 1 },
      { tank: 4, heli: 3, truck: 1 },
      { tank: 5, heli: 4, truck: 2, jet: 1 },
      { tank: 7, heli: 6, truck: 3, jet: 2 },
    ],
  },
  music: 'five_armies',
  tips: ['The army gets stronger every minute. So do you.'],
};

export const UPGRADES = [
  { id: 'hide', name: 'TITAN HIDE', icon: 'shield', desc: '+20% max health per tier.', base: 120 },
  { id: 'jaws', name: 'CRUSHER JAWS', icon: 'skull', desc: '+22% bite and tail damage per tier.', base: 120 },
  { id: 'breath', name: 'REACTOR LUNGS', icon: 'fire', desc: '+22% breath damage and +18% breath energy per tier.', base: 150 },
  { id: 'stomp', name: 'SEISMIC STOMP', icon: 'exploding', desc: '+18% stomp radius and damage per tier.', base: 130 },
  { id: 'roar', name: 'TERROR ROAR', icon: 'campfire', desc: '+15% roar radius and -10% cooldown per tier.', base: 100 },
  { id: 'regen', name: 'REGENERATION', icon: 'suit_hearts', desc: 'Heal 0.8% of max health per second per tier.', base: 140 },
  { id: 'growth', name: 'HYPER METABOLISM', icon: 'pawn_up', desc: 'Start every stage 7% bigger per tier and grow faster.', base: 160 },
  { id: 'rage', name: 'RAMPAGE GLAND', icon: 'crown_a', desc: 'Rampage charges 20% faster and lasts +1.2s per tier.', base: 130 },
  { id: 'legs', name: 'SPRINTER LEGS', icon: 'arrow_right', desc: '+7% movement speed per tier.', base: 90 },
];
export const MAX_TIER = 5;
export const upgradeCost = (u, tier) => Math.round((u.base * Math.pow(1.75, tier)) / 10) * 10;

const SAVE_KEY = 'pocketKaijuSave_v1';
export function defaultSave() {
  return {
    dna: 0, upgrades: {}, levels: {}, unlocked: 0, kaiju: 'rex', seenIntro: false, endlessBest: 0, gameComplete: false,
    stats: { buildings: 0, vehicles: 0, units: 0, people: 0, score: 0 },
    settings: { master: 0.8, music: 0.6, sfx: 0.9, quality: 'high', sens: 1.0, invertY: false, shake: 1.0 },
  };
}
export function loadSave() {
  const d = defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      Object.assign(d, s);
      d.settings = Object.assign(defaultSave().settings, s.settings || {});
      d.stats = Object.assign(defaultSave().stats, s.stats || {});
    }
  } catch (e) { /* ignore */ }
  return d;
}
export function storeSave(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}
export function wipeSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}
export const tier = (save, id) => save.upgrades[id] || 0;
export function kaijuUnlocked(save, id) {
  const k = KAIJU[id];
  if (!k.unlock) return true;
  return save.unlocked > k.unlock.level;
}

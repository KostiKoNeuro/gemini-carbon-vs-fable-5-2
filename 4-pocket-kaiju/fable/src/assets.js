// Asset loading. Over http(s) files are fetched from ./assets; from file:// (where fetch is blocked)
// the same bytes are pulled in through <script> wrappers in ./assets-embedded.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FILES } from './manifest.gen.js';

const params = new URLSearchParams(location.search);
export const EMBEDDED = location.protocol === 'file:' || params.has('embedded');

const pending = new Map();
window.__pkA = (path, b64) => {
  const p = pending.get(path);
  if (p) { pending.delete(path); p(b64); }
};
function b64ToBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}
export function loadBinary(path) {
  if (!EMBEDDED) {
    return fetch('assets/' + path).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
      return r.arrayBuffer();
    });
  }
  return new Promise((resolve, reject) => {
    pending.set(path, (b64) => resolve(b64ToBuffer(b64)));
    const s = document.createElement('script');
    s.src = 'assets-embedded/' + path + '.js';
    s.onerror = () => reject(new Error('Missing embedded asset ' + path));
    s.onload = () => s.remove();
    document.head.appendChild(s);
  });
}

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

export const A = {
  gltf: {},     // key -> { scene, animations }
  bitmaps: {},  // sprite name -> ImageBitmap
  audio: {},    // name -> ArrayBuffer (decoded later by the audio system)
  sky: {},      // name -> THREE.Texture
  mats: {},     // name -> THREE.Texture
  files: FILES,
};

function mime(path) {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg')) return 'image/jpeg';
  return 'application/octet-stream';
}
async function loadBitmap(path) {
  const buf = await loadBinary(path);
  return createImageBitmap(new Blob([buf], { type: mime(path) }));
}
function bitmapToTexture(bmp, maxSize) {
  let w = bmp.width, h = bmp.height;
  if (maxSize && Math.max(w, h) > maxSize) { const k = maxSize / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function runPool(tasks, limit, onDone) {
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      await t();
      onDone();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

export async function loadAll(onProgress) {
  const tasks = [];
  for (const key of FILES.models) {
    tasks.push(async () => {
      const buf = await loadBinary('models/' + key + '.glb');
      A.gltf[key] = await new Promise((res, rej) => gltfLoader.parse(buf, '', res, rej));
    });
  }
  for (const name of FILES.sprites) {
    tasks.push(async () => { A.bitmaps[name] = await loadBitmap('sprites/' + name + '.png'); });
  }
  for (const name of FILES.sfx) {
    tasks.push(async () => { A.audio[name] = await loadBinary('audio/sfx/' + name + '.ogg'); });
  }
  for (const name of FILES.voice) {
    tasks.push(async () => { A.audio['v_' + name] = await loadBinary('audio/voice/' + name + '.ogg'); });
  }
  let done = 0;
  await runPool(tasks, 10, () => { done++; if (onProgress) onProgress(done / tasks.length); });
}

export async function loadSky(name) {
  if (A.sky[name]) return A.sky[name];
  const bmp = await loadBitmap(FILES.sky[name]);
  const t = bitmapToTexture(bmp);
  t.mapping = THREE.EquirectangularReflectionMapping;
  A.sky[name] = t;
  return t;
}
export async function loadMat(name) {
  if (A.mats[name]) return A.mats[name];
  const bmp = await loadBitmap(FILES.mats[name]);
  const t = bitmapToTexture(bmp, 1024);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  A.mats[name] = t;
  return t;
}

export function gltf(key) {
  const g = A.gltf[key];
  if (!g) throw new Error('Unknown model ' + key);
  return g;
}

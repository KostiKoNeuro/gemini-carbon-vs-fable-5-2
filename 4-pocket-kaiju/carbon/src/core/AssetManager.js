import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MODEL_MANIFEST } from '../data/assetManifest.js';

export class AssetManager {
  constructor() {
    this.loader = new GLTFLoader();
    this.templates = new Map(); // key -> { scene, animations, dims, scaleFactor, def }
  }

  async preloadAllModels(onProgress) {
    const entries = Object.entries(MODEL_MANIFEST);
    let loaded = 0;

    // Load in concurrency batches of 10 for super fast smooth progress
    const batchSize = 10;
    for (let i = 0; i < entries.length; i += batchSize) {
      const slice = entries.slice(i, i + batchSize);
      await Promise.all(slice.map(async ([key, def]) => {
        const gltf = await this.loader.loadAsync(def.url);
        this.prepareTemplate(key, gltf, def);
        loaded++;
        if (onProgress) onProgress(loaded / entries.length, key);
      }));
    }
  }

  prepareTemplate(key, gltf, def) {
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    // Enable shadows and clean materials on all meshes
    root.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
            if (m.roughness !== undefined) m.roughness = Math.min(0.92, Math.max(0.28, m.roughness));
          }
        }
      }
    });

    // Measure natural bounding box
    const box = new THREE.Box3().setFromObject(root);
    const rawSize = new THREE.Vector3();
    const rawCenter = new THREE.Vector3();
    box.getSize(rawSize);
    box.getCenter(rawCenter);

    let scaleFactor = 1.0;
    if (def.baseHeight && rawSize.y > 0.0001) {
      scaleFactor = def.baseHeight / rawSize.y;
    } else if (def.baseLength) {
      const horiz = Math.max(rawSize.x, rawSize.z);
      if (horiz > 0.0001) scaleFactor = def.baseLength / horiz;
    }

    // Wrap in a normalized pivot container where bottom-center is exactly (0, 0, 0)
    // For skinned meshes we scale the outer wrapper and offset inner root so bone animations stay intact!
    const dims = new THREE.Vector3(
      rawSize.x * scaleFactor,
      rawSize.y * scaleFactor,
      rawSize.z * scaleFactor
    );

    const centerOffset = new THREE.Vector3(
      -rawCenter.x * scaleFactor,
      -box.min.y * scaleFactor,
      -rawCenter.z * scaleFactor
    );

    this.templates.set(key, {
      gltf,
      scene: root,
      animations: gltf.animations || [],
      dims,
      rawSize,
      scaleFactor,
      centerOffset,
      def
    });
  }

  getInfo(key) {
    return this.templates.get(key);
  }

  instantiate(key) {
    const tpl = this.templates.get(key);
    if (!tpl) {
      throw new Error(`Missing model template: ${key}`);
    }

    const clonedInner = tpl.def.skinned
      ? SkeletonUtils.clone(tpl.scene)
      : tpl.scene.clone(true);

    const scaleGroup = new THREE.Group();
    scaleGroup.scale.setScalar(tpl.scaleFactor);
    scaleGroup.position.copy(tpl.centerOffset);
    scaleGroup.add(clonedInner);

    const wrapper = new THREE.Group();
    wrapper.add(scaleGroup);
    wrapper.userData.innerModel = clonedInner;
    wrapper.userData.scaleGroup = scaleGroup;
    wrapper.userData.dims = tpl.dims.clone();
    wrapper.userData.animations = tpl.animations;
    return wrapper;
  }
}

import * as THREE from 'three/webgpu';
import { createSurface } from './surface.js';

/**
 * RealisticRiver1: río con corriente, remolinos y espuma para Three.js (WebGPURenderer + TSL). Ver README.md y el
 * plan en docs/RealisticRiver1_PLAN.md.
 *
 * Estado actual (F0): esqueleto del módulo. Toma la lámina de agua, la sirve con su propio material (de momento el
 * mismo aspecto que el agua plana anterior) y deja fijada la API: creación, update(dt), state + apply(), dispose().
 * Dominio, corriente base, simulación, espuma y obstáculos llegan en las fases siguientes sin cambiar esta API.
 *
 * Uso mínimo:
 *   const river = await createRealisticRiver1({ renderer, scene, camera, water: mallaAgua });
 *   // en cada fotograma, después de sky.update(dt) y antes de renderer.render(scene, camera):
 *   river.update(dt);
 */

/** Valores por defecto de `state`; cualquiera se puede cambiar con `settings` al crear el río. */
export const RIVER_DEFAULTS = {
  enabled: true,
  // color (sRGB) en la orilla y en lo hondo; se mezclan con el atributo `_profundidad` de la lámina (0-1)
  colorShallow: 0x9a9db5,
  colorDeep: 0x7d8099,
  roughness: 0.07,
  // ondas de detalle (mapa de normales que se desplaza)
  rippleSpeed: 0.012, // unidades de UV por segundo
  rippleScale: 4, // repeticiones del mapa de normales sobre el UV de la lámina
  rippleStrength: 0.3,
};

/**
 * @param {object} o
 * @param {THREE.WebGPURenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera
 * @param {THREE.Mesh} o.water lámina de agua: define la cota, la extensión y los atributos por vértice. El río toma
 *   su geometría (no la clona) y su transformación; la malla original no se añade a la escena.
 * @param {THREE.Texture} [o.normalTexture] mapa de normales de detalle; por defecto el de `water.material.normalMap`
 * @param {object} [o.settings] valores iniciales (claves de RIVER_DEFAULTS)
 */
export async function createRealisticRiver1({ renderer, scene, camera, water, normalTexture, settings = {} }) {
  if (!water?.isMesh) throw new Error('RealisticRiver1: hace falta `water`, la malla de la lámina de agua');
  const state = { ...RIVER_DEFAULTS, ...settings };

  const geometry = water.geometry;
  const surface = createSurface(geometry, state, normalTexture ?? water.material?.normalMap ?? null);

  const object = new THREE.Mesh(geometry, surface.material);
  object.name = 'RealisticRiver1';
  water.updateWorldMatrix(true, false);
  water.matrixWorld.decompose(object.position, object.quaternion, object.scale);
  object.receiveShadow = true;
  scene.add(object);

  function apply() {
    object.visible = state.enabled;
    surface.apply();
  }

  apply();

  return {
    object,
    state,
    defaults: RIVER_DEFAULTS,
    /** Un paso del río. Llamar en cada fotograma antes de `renderer.render`. */
    update(dt) {
      if (!state.enabled) return;
      surface.update(dt);
    },
    /** Pasa `state` al río tras cambiarlo a mano. */
    apply,
    /** Quita el río de la escena y libera el material (la geometría sigue siendo de quien la cargó). */
    dispose() {
      object.removeFromParent();
      surface.dispose();
    },
    // referencias internas, para depurar
    renderer,
    camera,
    surface,
  };
}

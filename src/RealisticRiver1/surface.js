import * as THREE from 'three/webgpu';
import { attribute, mix, normalMap, texture, uniform, uv, vec2 } from 'three/tsl';

/**
 * Material TSL de la lámina de agua.
 *
 * F0: reproduce el agua plana del visor. Color de la orilla al fondo según el atributo `_profundidad` (0-1) y dos
 * capas del mapa de normales que se desplazan en direcciones distintas. El reloj de las ondas es `u.time`, que
 * avanza `update(dt)`, no el `time` global, para que la superficie y la simulación (fases siguientes) vayan a la par.
 * La niebla (`scene.fogNode`) y los reflejos del cielo (`scene.environment`) llegan solos a un MeshStandardNodeMaterial.
 *
 * @param {THREE.BufferGeometry} geometry lámina (se mira si trae `_profundidad`)
 * @param {object} state parámetros (ver RIVER_DEFAULTS)
 * @param {THREE.Texture|null} normalTexture mapa de normales de detalle (repetible)
 */
export function createSurface(geometry, state, normalTexture) {
  const u = {
    time: uniform(0),
    colorShallow: uniform(new THREE.Color()),
    colorDeep: uniform(new THREE.Color()),
    rippleScale: uniform(1),
    rippleStrength: uniform(1),
  };

  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  material.name = 'RealisticRiver1';

  material.colorNode = geometry.attributes._profundidad
    ? mix(u.colorShallow, u.colorDeep, attribute('_profundidad', 'float').clamp(0, 1))
    : u.colorShallow;

  if (normalTexture) {
    const t = u.time;
    const uvA = uv().mul(u.rippleScale).add(vec2(t, t.mul(0.6)));
    const uvB = uv().mul(u.rippleScale.mul(1.7)).sub(vec2(t.mul(0.8), t.mul(0.3)));
    const nA = texture(normalTexture, uvA);
    const nB = texture(normalTexture, uvB);
    material.normalNode = normalMap(nA.add(nB).mul(0.5), u.rippleStrength);
  }

  /** Pasa `state` a los uniformes y al material. */
  function apply() {
    u.colorShallow.value.setHex(state.colorShallow, THREE.SRGBColorSpace);
    u.colorDeep.value.setHex(state.colorDeep, THREE.SRGBColorSpace);
    u.rippleScale.value = state.rippleScale;
    u.rippleStrength.value = state.rippleStrength;
    material.roughness = state.roughness;
  }

  /** Avanza el reloj de las ondas. */
  function update(dt) {
    u.time.value += dt * state.rippleSpeed;
  }

  apply();
  return { material, uniforms: u, apply, update, dispose: () => material.dispose() };
}

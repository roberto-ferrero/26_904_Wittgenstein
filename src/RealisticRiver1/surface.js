import * as THREE from 'three/webgpu';
import { abs, attribute, clamp, fract, mix, mx_noise_float, normalMap, positionWorld, texture, uniform, vec2 } from 'three/tsl';

/**
 * Material TSL de la lámina de agua.
 *
 * - Color de la orilla al fondo según el atributo `_profundidad` (0-1) de la lámina.
 * - Normales con flow map (F2): el mapa de normales de detalle se desplaza con la corriente base en dos fases
 *   desfasadas medio ciclo, que se funden para esconder el salto al reiniciarse. Cada punto lleva un desfase de fase
 *   con ruido, así que no hay "latido" común. Dos escalas de detalle, y las ondas son más marcadas donde el agua
 *   corre más.
 * El reloj es `u.time`, que avanza `update(dt)`, no el `time` global, para que la superficie y la simulación
 * (fases siguientes) vayan a la par. La niebla (`scene.fogNode`) y los reflejos del cielo (`scene.environment`)
 * llegan solos a un MeshStandardNodeMaterial.
 *
 * @param {THREE.BufferGeometry} geometry lámina (se mira si trae `_profundidad`)
 * @param {object} state parámetros (ver RIVER_DEFAULTS)
 * @param {THREE.Texture|null} normalTexture mapa de normales de detalle (repetible)
 * @param {object} flow corriente base (solveBaseFlow): `texture`, `origin`, `size`
 */
export function createSurface(geometry, state, normalTexture, flow) {
  const u = {
    time: uniform(0),
    colorShallow: uniform(new THREE.Color()),
    colorDeep: uniform(new THREE.Color()),
    speed: uniform(1), // m/s de velocidad media (velocidad del río × exageración)
    rippleSize: uniform(18), // metros por repetición de la capa grande
    rippleStrength: uniform(1),
    cycle: uniform(4), // segundos por ciclo del flow map
    flowOrigin: uniform(flow.origin.clone()),
    flowSize: uniform(flow.size.clone()),
  };
  const flowTex = texture(flow.texture);

  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  material.name = 'RealisticRiver1';

  material.colorNode = geometry.attributes._profundidad
    ? mix(u.colorShallow, u.colorDeep, attribute('_profundidad', 'float').clamp(0, 1))
    : u.colorShallow;

  if (normalTexture) {
    normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
    const p = positionWorld.xz;
    const f = flowTex.sample(p.sub(u.flowOrigin).div(u.flowSize));
    // coordenadas de textura en metros con v hacia −Z, como el UV de la lámina (el espacio tangente sale de él)
    const pw = vec2(p.x, p.y.negate());
    const vel = vec2(f.x, f.y.negate()).mul(u.speed);
    const rel = f.z; // rapidez relativa (media 1)
    // fase de cada punto: reloj + ruido lento (sin latido común)
    const t = u.time.div(u.cycle).add(mx_noise_float(p.mul(0.013)).mul(0.5).add(0.5));
    const ph0 = fract(t), ph1 = fract(t.add(0.5));
    const w1 = abs(ph0.mul(2).sub(1)); // peso de la fase 1; la 0 pesa 1 − w1 (cada una vale 0 al reiniciarse)
    const off0 = vel.mul(ph0.sub(0.5).mul(u.cycle));
    const off1 = vel.mul(ph1.sub(0.5).mul(u.cycle));
    const layer = (size, drift) => {
      const a = texture(normalTexture, pw.sub(off0.mul(drift)).div(size));
      const b = texture(normalTexture, pw.sub(off1.mul(drift)).div(size).add(vec2(0.37, 0.61)));
      return mix(a, b, w1);
    };
    // capa grande y capa fina (más pequeña y algo más rápida, como el rizado que va encima)
    const n = layer(u.rippleSize, 1).add(layer(u.rippleSize.mul(0.37), 1.25)).mul(0.5);
    const strength = u.rippleStrength.mul(mix(0.55, 1.35, clamp(rel.mul(0.5), 0, 1)));
    material.normalNode = normalMap(n, strength);
  }

  /** Pasa `state` a los uniformes y al material. */
  function apply() {
    u.colorShallow.value.setHex(state.colorShallow, THREE.SRGBColorSpace);
    u.colorDeep.value.setHex(state.colorDeep, THREE.SRGBColorSpace);
    u.speed.value = state.flowSpeed * state.flowBoost;
    u.rippleSize.value = state.rippleSize;
    u.rippleStrength.value = state.rippleStrength;
    u.cycle.value = state.flowCycle;
    material.roughness = state.roughness;
  }

  /** Avanza el reloj. */
  function update(dt) {
    u.time.value += dt;
  }

  /** Tras recalcular la corriente base. */
  function setFlow(fl) {
    flowTex.value = fl.texture;
    u.flowOrigin.value.copy(fl.origin);
    u.flowSize.value.copy(fl.size);
  }

  apply();
  return { material, uniforms: u, apply, update, setFlow, dispose: () => material.dispose() };
}

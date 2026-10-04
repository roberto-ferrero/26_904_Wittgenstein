import * as THREE from 'three/webgpu';
import { createSurface } from './surface.js';
import { bakeDomain } from './domain.js';
import { solveBaseFlow } from './baseflow.js';
import { createSimulation } from './sim.js';
import { createDebugMaterial, DEBUG_VIEWS } from './debug.js';

/**
 * RealisticRiver1: río con corriente, remolinos y espuma para Three.js (WebGPURenderer + TSL). Ver README.md y el
 * plan en docs/RealisticRiver1_PLAN.md.
 *
 * Estado actual:
 * - F0: API (creación, update(dt), state + apply(), dispose()) y material propio con el aspecto del agua plana.
 * - F1: dominio horneado al crear el río (domain.js): lecho, agua, profundidad, distancia a la orilla y obstáculos,
 *   con vistas de depuración (debug.js).
 * - F2: corriente base (baseflow.js) y normales desplazadas con ella (flow map, surface.js).
 * - F3: color por profundidad real, orilla transparente, ondas de viento y reflejos del cielo regulables.
 * - F4: simulación viva en compute (sim.js): remolinos, separación y cizalla; las ondas siguen su velocidad.
 * Simulación, espuma y obstáculos en caliente llegan en las fases siguientes sin cambiar esta API.
 *
 * Uso mínimo:
 *   const river = await createRealisticRiver1({ renderer, scene, camera, water: mallaAgua, terrain: terreno });
 *   // en cada fotograma, después de sky.update(dt) y antes de renderer.render(scene, camera):
 *   river.update(dt);
 */

/** Valores por defecto de `state`; cualquiera se puede cambiar con `settings` al crear el río. */
export const RIVER_DEFAULTS = {
  enabled: true,
  // color (sRGB) en la orilla y en lo hondo; se mezclan con la profundidad real (absorción de Beer-Lambert)
  colorShallow: 0x9a9db5,
  colorDeep: 0x7d8099,
  absorption: 4, // metros de agua para llegar a ~63 % del color de lo hondo
  shoreFade: 1.2, // metros de profundidad en los que la lámina pasa de transparente a opaca en la orilla
  roughness: 0.07,
  reflections: 1, // intensidad del reflejo del cielo (scene.environment) en el agua
  // corriente base: velocidad media real del río y exageración visual (lo que se ve va a flowSpeed × flowBoost)
  flowSpeed: 1, // m/s
  flowBoost: 2,
  // ondas de detalle: mapa de normales desplazado con la corriente (flow map)
  rippleSize: 90, // metros por repetición de la capa grande (la fina es 0,37 veces); a 400 m de la cámara lo pequeño se pierde
  rippleStrength: 0.3,
  flowCycle: 4, // segundos por ciclo del flow map: más largo, más estela; más corto, menos estiramiento
  // simulación viva (remolinos): pasos por segundo, confinamiento de vorticidad, segundos para volver a la
  // corriente base, rozamiento junto a tierra (por segundo) e iteraciones de la proyección
  simulation: true,
  simRate: 30,
  vorticity: 0.4,
  relaxTime: 30,
  bankDrag: 1,
  viscosity: 0.1, // mezcla con los vecinos por paso (quita el ruido de una celda)
  turbulence: 1, // siembra de perturbaciones junto a orillas y obstáculos (× velocidad media por s)
  turbScale: 30, // metros de las perturbaciones sembradas
  pressureIterations: 20,
  // ondas de viento (con setWind): fuerza a 10 m/s de viento y metros por repetición
  windRipples: 0.25,
  windSize: 7,
  // depuración: una de las claves de DEBUG_VIEWS
  debugView: 'Ninguna',
};

/**
 * @param {object} o
 * @param {THREE.WebGPURenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera
 * @param {THREE.Mesh} o.water lámina de agua: define la cota, la extensión y los atributos por vértice. El río toma
 *   su geometría (no la clona) y su transformación; la malla original no se añade a la escena.
 * @param {THREE.Object3D|THREE.Object3D[]} [o.terrain] lo que forma el lecho y las orillas; por defecto, la escena
 * @param {THREE.Object3D[]} [o.obstacles] objetos (o grupos, o InstancedMesh) que cuentan como obstáculos donde
 *   sobresalen de la lámina; se excluyen del terreno
 * @param {number} [o.cellSize=1] metros por celda del dominio
 * @param {number} [o.margin=8] metros de dominio alrededor de la lámina
 * @param {THREE.Texture} [o.normalTexture] mapa de normales de detalle; por defecto el de `water.material.normalMap`
 * @param {object} [o.settings] valores iniciales (claves de RIVER_DEFAULTS)
 */
export async function createRealisticRiver1({
  renderer, scene, camera, water, terrain = scene, obstacles = [], cellSize = 1, margin = 8,
  flowCellSize = 2, flowDirection = [0, 0, 1],
  normalTexture, settings = {},
}) {
  if (!water?.isMesh) throw new Error('RealisticRiver1: hace falta `water`, la malla de la lámina de agua');
  const state = { ...RIVER_DEFAULTS, ...settings };
  const terrainList = Array.isArray(terrain) ? terrain : [terrain];
  const obstacleList = [...obstacles];

  const geometry = water.geometry;
  water.updateWorldMatrix(true, false);

  // ---------------------------------------------------------------- dominio (F1) y corriente base (F2)
  // se hornean con la lámina (fuera de la escena) y antes de añadir el río
  let domain = await bakeDomain({ renderer, water, terrain: terrainList, obstacles: obstacleList, cellSize, margin });
  const flowOptions = { cellSize: flowCellSize, direction: [flowDirection[0], flowDirection[2]] };
  let flow = solveBaseFlow(domain, flowOptions);

  const surface = createSurface(state, normalTexture ?? water.material?.normalMap ?? null, domain, flow);
  const object = new THREE.Mesh(geometry, surface.material);
  object.name = 'RealisticRiver1';
  water.matrixWorld.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrixWorld();
  object.receiveShadow = true;

  const debug = createDebugMaterial(() => domain, () => flow, geometry, surface.uniforms);

  // ---------------------------------------------------------------- simulación viva (F4)
  let sim = createSimulation(renderer, flow, state);
  debug.setSimTexture(sim.texture);
  scene.add(object);

  function apply() {
    object.visible = state.enabled;
    surface.apply();
    sim.applyState();
    const vel = state.simulation ? sim.texture : flow.texture;
    surface.setVelocityTexture(vel);
    debug.setVelocityTexture(vel);
    const view = DEBUG_VIEWS[state.debugView] ?? 0;
    debug.uniforms.view.value = view;
    object.material = view ? debug.material : surface.material;
  }

  /** Vuelve a hornear el dominio (p. ej. tras mover el terreno o cambiar los obstáculos). */
  async function rebuild() {
    const visible = object.visible;
    object.removeFromParent();
    domain = await bakeDomain({ renderer, water: object, terrain: terrainList, obstacles: obstacleList, cellSize, margin, previous: domain });
    flow = solveBaseFlow(domain, { ...flowOptions, previous: flow });
    surface.setMaps(domain, flow);
    debug.refresh();
    sim.dispose();
    sim = createSimulation(renderer, flow, state);
    debug.setSimTexture(sim.texture);
    apply();
    scene.add(object);
    object.visible = visible;
    return domain.stats;
  }

  apply();

  return {
    object,
    state,
    defaults: RIVER_DEFAULTS,
    debugViews: Object.keys(DEBUG_VIEWS),
    /** Dominio horneado: rejilla, mapas en CPU (`sdf`, `depth`, `obstacle`, `bed`, `wet`) y `texture` (ver domain.js). */
    get domain() { return domain; },
    /** Corriente base: velocidad relativa (media 1) en CPU (`vx`, `vz`, `sample(x, z)`), ψ y `texture` (ver baseflow.js). */
    get flow() { return flow; },
    /** Texturas para los shaders o para otros efectos. */
    get maps() { return { domain: domain.texture }; },
    /** Un paso del río. Llamar en cada fotograma antes de `renderer.render`. */
    update(dt) {
      if (!state.enabled) return;
      if (state.simulation) sim.update(dt);
      surface.update(dt, scene);
    },
    /** Pasa `state` al río tras cambiarlo a mano. */
    apply,
    /**
     * Viento sobre el agua para las ondas de viento: dirección hacia la que sopla en ejes de la escena (x, z) y
     * velocidad en m/s. Se puede llamar en cada fotograma.
     */
    setWind: surface.setWind,
    rebuild,
    /** Vuelve a poner la simulación en la corriente base (borra los remolinos). */
    resetSimulation: () => sim.reset(),
    /** Simulación viva: pasos dados, dispatches por paso, uniformes y textura (ver sim.js). */
    get simulation() { return sim; },
    /** Quita el río de la escena y libera sus materiales y texturas (la geometría sigue siendo de quien la cargó). */
    dispose() {
      object.removeFromParent();
      surface.dispose();
      debug.dispose();
      sim.dispose();
      domain.texture.dispose();
    },
    // referencias internas, para depurar
    renderer,
    camera,
    surface,
  };
}

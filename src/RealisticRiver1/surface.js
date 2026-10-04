import * as THREE from 'three/webgpu';
import { abs, clamp, exp, float, fract, max, mix, mx_noise_float, normalMap, positionWorld, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';

/**
 * Material TSL de la lámina de agua.
 *
 * - Color por profundidad real (F3): absorción de Beer-Lambert con la profundidad del dominio, del color de la orilla
 *   al de lo hondo.
 * - Orilla transparente (F3): la lámina se desvanece en los primeros decímetros de agua, así que se ve el lecho y no
 *   hay línea dura contra el terreno. Bajo las orillas (profundidad 0) desaparece.
 * - Normales con flow map (F2): el mapa de normales de detalle se desplaza con la corriente base en dos fases
 *   desfasadas medio ciclo, que se funden para esconder el salto al reiniciarse. Cada punto lleva un desfase de fase
 *   con ruido, así que no hay "latido" común. Dos escalas de detalle, y las ondas son más marcadas donde el agua
 *   corre más.
 * - Ondas de viento (F3): una tercera capa, pequeña, que se desplaza con el viento (`setWind`) en lugar de con la
 *   corriente.
 * - Reflejos (F3): el entorno de la escena (`scene.environment`, el cielo con nubes de VolumetricSky1) se toma como
 *   `envMap` propio para poder regular su intensidad solo en el agua. El Fresnel es el del material estándar.
 * - Espuma (F5): densidad de la simulación × textura de burbujas desplazada con el mismo flow map, con umbral para
 *   que salgan vetas y no manchas. Sube el albedo y la rugosidad y aplana las ondas. De lejos, el mipmap de las
 *   burbujas deja la densidad media: las líneas de espuma se siguen viendo.
 * El reloj es `u.time`, que avanza `update(dt)`. La niebla (`scene.fogNode`) llega sola al material.
 *
 * @param {object} state parámetros (ver RIVER_DEFAULTS)
 * @param {THREE.Texture|null} normalTexture mapa de normales de detalle (repetible)
 * @param {object} domain dominio (bakeDomain): `texture`, `origin`, `size`
 * @param {object} flow corriente base (solveBaseFlow): `texture`, `origin`, `size`
 * @param {THREE.Texture} bubbles textura repetible de burbujas (foamTexture.js)
 */
export function createSurface(state, normalTexture, domain, flow, bubbles) {
  const u = {
    time: uniform(0),
    colorShallow: uniform(new THREE.Color()),
    colorDeep: uniform(new THREE.Color()),
    absorption: uniform(4), // metros para llegar a ~63 % del color de lo hondo
    shoreFade: uniform(1.2), // metros de profundidad en los que la lámina pasa de transparente a opaca
    speed: uniform(1), // m/s de velocidad media (velocidad del río × exageración)
    rippleSize: uniform(90), // metros por repetición de la capa grande
    rippleStrength: uniform(1),
    cycle: uniform(4), // segundos por ciclo del flow map
    windOffset: uniform(new THREE.Vector2()), // desplazamiento acumulado de las ondas de viento (m)
    windStrength: uniform(0),
    windSize: uniform(7),
    roughness: uniform(0.07),
    domainOrigin: uniform(domain.origin.clone()),
    domainSize: uniform(domain.size.clone()),
    flowOrigin: uniform(flow.origin.clone()),
    flowSize: uniform(flow.size.clone()),
    foamOn: uniform(0),
    foamColor: uniform(new THREE.Color()),
    foamSize: uniform(5),
    foamSharpness: uniform(3),
    foamVisibility: uniform(1),
  };
  const domainTex = texture(domain.texture);
  const flowTex = texture(flow.texture);
  const foamTex = texture(flow.texture); // se cambia por la espuma de la simulación (setFoamTexture)
  const wind = { x: 0, z: 1, speed: 0 };

  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0, transparent: true });
  material.name = 'RealisticRiver1';

  const p = positionWorld.xz;
  const depth = domainTex.sample(p.sub(u.domainOrigin).div(u.domainSize)).g;
  const waterColor = mix(u.colorShallow, u.colorDeep, exp(depth.div(u.absorption).negate()).oneMinus());
  material.colorNode = waterColor;
  material.opacityNode = smoothstep(0, u.shoreFade, depth);

  if (normalTexture) {
    normalTexture.wrapS = normalTexture.wrapT = THREE.RepeatWrapping;
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

    // espuma: densidad de la simulación × burbujas con el mismo flow map, y umbral
    const density = foamTex.sample(p.sub(u.flowOrigin).div(u.flowSize)).x.mul(u.foamOn).mul(u.foamVisibility);
    const bub = (size, o) => {
      const a = texture(bubbles, pw.sub(off0).div(size).add(o)).x;
      const b = texture(bubbles, pw.sub(off1).div(size).add(o).add(vec2(0.5, 0.25))).x;
      return mix(a, b, w1);
    };
    const pattern = bub(u.foamSize, vec2(0)).mul(0.65).add(bub(u.foamSize.mul(0.4), vec2(0.3, 0.7)).mul(0.35));
    const foam = clamp(density.sub(pattern.oneMinus()).mul(u.foamSharpness).add(density.mul(0.25)), 0, 1);
    material.colorNode = mix(waterColor, u.foamColor, foam);
    material.roughnessNode = mix(u.roughness, float(0.65), foam);
    material.opacityNode = max(smoothstep(0, u.shoreFade, depth), foam);
    // ondas de viento: tercera capa que se desplaza con el viento
    const nWind = texture(normalTexture, pw.sub(vec2(u.windOffset.x, u.windOffset.y.negate())).div(u.windSize).add(vec2(0.11, 0.83)));
    // se suman las desviaciones respecto a la normal plana, cada una con su fuerza, y se vuelve a codificar en 0-1
    const flowStrength = u.rippleStrength.mul(mix(0.55, 1.35, clamp(rel.mul(0.5), 0, 1)));
    const dev = n.xy.sub(0.5).mul(flowStrength).add(nWind.xy.sub(0.5).mul(u.windStrength));
    material.normalNode = normalMap(vec3(dev.mul(foam.oneMinus().mul(0.7).add(0.3)).add(0.5), 1), 1);
  }

  /** Pasa `state` a los uniformes y al material. */
  function apply() {
    u.colorShallow.value.setHex(state.colorShallow, THREE.SRGBColorSpace);
    u.colorDeep.value.setHex(state.colorDeep, THREE.SRGBColorSpace);
    u.absorption.value = state.absorption;
    u.shoreFade.value = Math.max(state.shoreFade, 0.01);
    u.speed.value = state.flowSpeed * state.flowBoost;
    u.rippleSize.value = state.rippleSize;
    u.rippleStrength.value = state.rippleStrength;
    u.cycle.value = state.flowCycle;
    u.windSize.value = state.windSize;
    material.roughness = state.roughness;
    u.roughness.value = state.roughness;
    u.foamColor.value.setHex(state.foamColor, THREE.SRGBColorSpace);
    u.foamSize.value = state.foamSize;
    u.foamSharpness.value = state.foamSharpness;
    u.foamVisibility.value = Math.min(state.character * 2.5, 1.5);
    material.envMapIntensity = state.reflections;
  }

  /** Avanza el reloj y las ondas de viento; toma el entorno de la escena si ha cambiado. */
  function update(dt, scene) {
    u.time.value += dt;
    // las ondas capilares van a una fracción pequeña del viento
    const drift = Math.min(0.04 * wind.speed, 1.2) * dt;
    u.windOffset.value.x += wind.x * drift;
    u.windOffset.value.y += wind.z * drift;
    u.windStrength.value = state.windRipples * Math.min(wind.speed / 10, 1.5);
    const env = scene?.environment ?? null;
    if (material.envMap !== env) { material.envMap = env; material.needsUpdate = true; }
  }

  /** Viento sobre el agua: dirección hacia la que sopla en ejes de la escena (x, z) y velocidad en m/s. */
  function setWind(x, z, speed) {
    const l = Math.hypot(x, z) || 1;
    wind.x = x / l; wind.z = z / l; wind.speed = speed;
  }

  /** Textura de velocidad que siguen las ondas: la de la simulación o la de la corriente base (misma rejilla). */
  function setVelocityTexture(tex) {
    flowTex.value = tex;
  }

  /** Espuma de la simulación (o nada si la simulación está apagada). */
  function setFoamTexture(tex, on) {
    foamTex.value = tex;
    u.foamOn.value = on ? 1 : 0;
  }

  /** Tras rehornear el dominio y la corriente. */
  function setMaps(dm, fl) {
    domainTex.value = dm.texture;
    u.domainOrigin.value.copy(dm.origin);
    u.domainSize.value.copy(dm.size);
    flowTex.value = fl.texture;
    u.flowOrigin.value.copy(fl.origin);
    u.flowSize.value.copy(fl.size);
  }

  apply();
  return { material, uniforms: u, apply, update, setWind, setMaps, setVelocityTexture, setFoamTexture, dispose: () => material.dispose() };
}

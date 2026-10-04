import * as THREE from 'three/webgpu';
import { abs, clamp, dFdx, dFdy, dot, exp, float, floor, fract, max, mix, mx_noise_float, normalize, normalMap, positionWorld, sin, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';

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
 * - Espuma (F5): la densidad de la simulación decide qué parte de un dibujo de filamentos y burbujas (desplazado
 *   con el mismo flow map) queda cubierta: poca densidad, solo los filamentos; densidad 1, blanco casi entero. Sube el albedo y la rugosidad y aplana las ondas. De lejos, el mipmap de las
 *   burbujas deja la densidad media: las líneas de espuma se siguen viendo.
 * - Corriente de avance: si la lámina trae coordenadas del cauce (segundo UV: u de orilla a orilla, v = metros a lo
 *   largo / `channelScale`), ondas y vetas de espuma se dibujan en ellas y se desplazan sin cortes aguas abajo a la
 *   velocidad del río, siguiendo cada curva. Es lo que hace que el río se lea avanzando por su cauce; el flow map de
 *   la simulación queda debajo con el peso `1 − advance` (la turbulencia local).
 * El reloj es `u.time`, que avanza `update(dt)`. La niebla (`scene.fogNode`) llega sola al material.
 *
 * @param {object} state parámetros (ver RIVER_DEFAULTS)
 * @param {THREE.Texture|null} normalTexture mapa de normales de detalle (repetible)
 * @param {object} domain dominio (bakeDomain): `texture`, `origin`, `size`
 * @param {object} flow corriente base (solveBaseFlow): `texture`, `origin`, `size`
 * @param {THREE.Texture} bubbles textura repetible de burbujas (foamTexture.js)
 * @param {boolean} [hasChannelUV=false] la geometría trae coordenadas del cauce en `uv1`
 */
export function createSurface(state, normalTexture, domain, flow, bubbles, hasChannelUV = false) {
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
    foamStretch: uniform(4),
    foamVisibility: uniform(1),
    advanceFoam: uniform(0.6), // densidad de las líneas de espuma de la corriente de avance
    advance: uniform(0), // peso de la corriente de avance (0 sin coordenadas del cauce)
    advanceOffset: uniform(0), // metros recorridos aguas abajo (se acumula en update)
    channelWidth: uniform(120), // metros de orilla a orilla para pasar la u del cauce a metros
    channelScale: uniform(40), // metros a lo largo por unidad de v del cauce
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
    const nLocal = layer(u.rippleSize, 1).add(layer(u.rippleSize.mul(0.37), 1.25)).mul(0.5);

    // corriente de avance: coordenadas del cauce en metros (x de orilla a orilla, y aguas abajo) que se desplazan
    // de forma continua con el río; las ondas se alargan en el sentido del agua
    const ch = hasChannelUV ? uv(1) : vec2(0);
    const cc = vec2(ch.x.mul(u.channelWidth), ch.y.mul(u.channelScale));
    const ccMove = cc.sub(vec2(0, u.advanceOffset));
    const ccMoveFast = cc.sub(vec2(0, u.advanceOffset.mul(1.3)));
    const nAdv = texture(normalTexture, vec2(ccMove.x, ccMove.y.div(1.8)).div(u.rippleSize))
      .add(texture(normalTexture, vec2(ccMoveFast.x, ccMoveFast.y.div(1.8)).div(u.rippleSize.mul(0.37)).add(vec2(0.21, 0.47)))).mul(0.5);
    const n = hasChannelUV ? mix(nLocal, nAdv, u.advance) : nLocal;

    // espuma: densidad de la simulación × burbujas con el mismo flow map, y umbral
    let density = foamTex.sample(p.sub(u.flowOrigin).div(u.flowSize)).x.mul(u.foamOn).mul(u.foamVisibility);
    if (hasChannelUV) {
      // líneas de espuma de la corriente de avance: vetas largas y estrechas en coordenadas del cauce que viajan aguas
      // abajo con el río (como las líneas de espuma que marcan la corriente en un río real). Más donde corre más y
      // nada junto a la orilla transparente
      const lines = texture(bubbles, vec2(ccMove.x.div(u.foamSize.mul(2.5)), ccMove.y.div(u.foamSize.mul(2.5).mul(u.foamStretch).mul(2.5))).add(vec2(0.61, 0.13))).y;
      const lineMask = smoothstep(0.5, 0.78, lines).mul(clamp(rel, 0.3, 1.5)).mul(smoothstep(0.5, 2.5, depth));
      density = max(density, lineMask.mul(u.advanceFoam).mul(u.advance).mul(u.foamVisibility));
    }
    const bub = (size, o) => {
      const a = texture(bubbles, pw.sub(off0).div(size).add(o));
      const b = texture(bubbles, pw.sub(off1).div(size).add(o).add(vec2(0.5, 0.25)));
      return mix(a, b, w1);
    };
    // dibujo: filamentos (fbm grande) + paredes de burbuja (dos escalas)
    const big = bub(u.foamSize.mul(4), vec2(0)), small = bub(u.foamSize, vec2(0.3, 0.7));
    // vetas estiradas con la corriente: el ruido de filamentos se lee en un sistema local girado con la dirección del
    // agua y estirado a lo largo de ella. Para no girar coordenadas enormes, el plano se parte en baldosas de 24 m:
    // cada una gira alrededor de su centro con la dirección que hay allí, y las cuatro más cercanas se funden
    const L = float(24);
    const g = pw.div(L).sub(0.5);
    const g0 = floor(g), gf = fract(g);
    const hash = (o) => fract(sin(vec2(dot(o, vec2(12.9898, 78.233)), dot(o, vec2(39.3468, 11.135)))).mul(43758.5453));
    const gdx = dFdx(pw).div(u.foamSize.mul(3)), gdy = dFdy(pw).div(u.foamSize.mul(3));
    const streaks = (off) => {
      let acc = float(0);
      for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const o = g0.add(vec2(cx, cy)).add(0.5).mul(L);
        const vo = flowTex.sample(vec2(o.x, o.y.negate()).sub(u.flowOrigin).div(u.flowSize)).xy;
        const dir = normalize(vec2(vo.x, vo.y.negate()).add(vec2(1e-4, 0)));
        const perp = vec2(dir.y.negate(), dir.x);
        const d = pw.sub(o).sub(off);
        const q = vec2(dot(d, perp), dot(d, dir).div(u.foamStretch)).div(u.foamSize.mul(3)).add(hash(o));
        const w = (cx ? gf.x : gf.x.oneMinus()).mul(cy ? gf.y : gf.y.oneMinus());
        // derivadas de la coordenada continua (sin el salto entre baldosas): sin ellas el mipmap elige el nivel más
        // bajo en las juntas y aparecen rayas
        acc = acc.add(texture(bubbles, q).grad(gdx, gdy).y.mul(w));
      }
      return acc;
    };
    // (al fundir baldosas baja el contraste: se recupera un poco)
    const filLocal = mix(streaks(off0), streaks(off1), w1).sub(0.5).mul(1.35).add(0.5);
    let pattern = filLocal.mul(0.55).add(small.x.mul(0.3)).add(big.x.mul(0.15));
    if (hasChannelUV) {
      // vetas de la corriente de avance: el mismo dibujo en coordenadas del cauce, estirado aguas abajo y desplazado
      // con el río (sin cortes ni giros por baldosas)
      const fs = u.foamSize.mul(3);
      const filAdv = texture(bubbles, vec2(ccMove.x.div(fs), ccMove.y.div(fs.mul(u.foamStretch)))).y.sub(0.5).mul(1.2).add(0.5);
      const smallAdv = texture(bubbles, ccMove.div(u.foamSize).add(vec2(0.3, 0.7))).x;
      const patternAdv = filAdv.mul(0.6).add(smallAdv.mul(0.3)).add(big.x.mul(0.1));
      pattern = mix(pattern, patternAdv, u.advance);
    }
    // la densidad decide qué parte del dibujo se cubre: poca densidad, solo los filamentos más altos; densidad 1, todo
    // (con densidad 1 quedan huecos donde el dibujo es más bajo: encaje, no manta)
    const edge = mix(float(1), float(0.42), clamp(density, 0, 1));
    const foam = smoothstep(edge, edge.add(float(0.45).div(u.foamSharpness)), pattern).mul(clamp(density.mul(3), 0, 1));
    material.colorNode = mix(waterColor, u.foamColor, foam);
    material.roughnessNode = mix(u.roughness, float(0.65), foam);
    material.opacityNode = max(smoothstep(0, u.shoreFade, depth), foam);
    // ondas de viento: tercera capa que se desplaza con el viento
    const nWind = texture(normalTexture, pw.sub(vec2(u.windOffset.x, u.windOffset.y.negate())).div(u.windSize).add(vec2(0.11, 0.83)));
    // se suman las desviaciones respecto a la normal plana, cada una con su fuerza, y se vuelve a codificar en 0-1
    // más oleaje donde el agua corre (en los rápidos el agua se encrespa)
    const flowStrength = u.rippleStrength.mul(mix(0.45, 1.6, clamp(rel.mul(0.5), 0, 1)));
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
    u.foamStretch.value = state.foamStretch;
    u.foamVisibility.value = Math.min(state.character * 2.5, 1.5);
    u.advance.value = hasChannelUV ? state.advance : 0;
    u.advanceFoam.value = state.advanceFoam;
    u.channelWidth.value = state.channelWidth;
    u.channelScale.value = state.channelScale;
    material.envMapIntensity = state.reflections;
  }

  /** Avanza el reloj y las ondas de viento; toma el entorno de la escena si ha cambiado. */
  function update(dt, scene) {
    u.time.value += dt;
    // la corriente de avance va a la velocidad del río por su factor (m/s); se acumula para poder cambiarla en marcha
    // sin saltos
    u.advanceOffset.value += dt * state.flowSpeed * state.flowBoost * state.advanceSpeed;
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

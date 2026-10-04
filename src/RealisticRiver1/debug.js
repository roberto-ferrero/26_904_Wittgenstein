import * as THREE from 'three/webgpu';
import { abs, attribute, clamp, dot, float, fract, length, mix, mx_noise_float, normalize, positionWorld, select, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';

/** Vistas de depuración (el valor es el índice que recibe el shader). */
export const DEBUG_VIEWS = {
  'Ninguna': 0,
  'Orilla (distancia con signo)': 1,
  'Profundidad': 2,
  'Obstáculos': 3,
  'Lecho (altura)': 4,
  'Corriente base (velocidad)': 5,
  'Corriente base frente a _flujo': 6,
  'Simulación (vorticidad)': 7,
  'Espuma (densidad)': 8,
};

/**
 * Material sin luz ni niebla que pinta los mapas del dominio sobre la lámina. Se pone en lugar del material del río
 * mientras hay una vista de depuración activa.
 *
 * @param {() => object} getDomain devuelve el dominio actual (cambia al rehornear)
 * @param {() => object} getFlow devuelve la corriente base actual
 * @param {THREE.BufferGeometry} geometry lámina (para comparar con sus atributos `_flujo_x`, `_flujo_z`)
 * @param {object} surfaceUniforms uniformes del material del río (reloj y velocidad)
 */
export function createDebugMaterial(getDomain, getFlow, geometry, surfaceUniforms) {
  const d0 = getDomain(), f0 = getFlow();
  const u = {
    view: uniform(0, 'int'),
    origin: uniform(d0.origin.clone()),
    size: uniform(d0.size.clone()),
    level: uniform(d0.level),
    flowOrigin: uniform(f0.origin.clone()),
    flowSize: uniform(f0.size.clone()),
  };
  const flowTex = texture(f0.texture);
  const simTex = texture(f0.texture); // se cambia por la textura de la simulación con setSimTexture
  const foamTex = texture(f0.texture);
  const tex = texture(d0.texture);
  const uvDomain = positionWorld.xz.sub(u.origin).div(u.size);
  const dom = tex.sample(uvDomain);
  const sdf = dom.r, depth = dom.g, obst = dom.b, bed = dom.a;

  // curvas de nivel cada `step` metros (líneas finas y oscuras)
  const lines = (v, step) => smoothstep(0.0, 0.06, abs(fract(v.div(step)).sub(0.5)).mul(2).oneMinus()).oneMinus();

  // 1. orilla: agua en azules que se oscurecen hacia el centro, tierra en ocres; curvas cada 5 m y la orilla en blanco
  const water = mix(vec3(0.55, 0.85, 1.0), vec3(0.02, 0.12, 0.45), clamp(sdf.div(60), 0, 1));
  const land = mix(vec3(0.95, 0.75, 0.45), vec3(0.45, 0.25, 0.1), clamp(sdf.negate().div(30), 0, 1));
  const cShore = mix(select(sdf.greaterThan(0), water, land), vec3(1), smoothstep(0.6, 0.0, abs(sdf)))
    .mul(lines(sdf, 5).mul(0.35).oneMinus());

  // 2. profundidad: amarillo en los bajíos, verde, azul y morado a 13 m; curvas cada metro
  const t = clamp(depth.div(13), 0, 1);
  const ramp = mix(mix(vec3(1.0, 0.9, 0.3), vec3(0.2, 0.75, 0.5), clamp(t.mul(3), 0, 1)),
    mix(vec3(0.15, 0.35, 0.85), vec3(0.3, 0.05, 0.4), clamp(t.mul(1.5).sub(0.5), 0, 1)), clamp(t.mul(2).sub(0.3), 0, 1));
  const cDepth = select(depth.greaterThan(0.001), ramp.mul(lines(depth, 1).mul(0.25).oneMinus()), vec3(0.25));

  // 3. obstáculos: rojo sobre la distancia a la orilla en grises
  const cObst = mix(vec3(clamp(sdf.div(80), 0, 1).mul(0.6).add(0.2)), vec3(1, 0.1, 0.05), clamp(obst.mul(2), 0, 1));

  // 4. lecho: altura de −11 m (oscuro) a la cota del agua (claro), con curvas cada 2 m
  const hb = clamp(bed.sub(u.level).add(13).div(13), 0, 1);
  const cBed = mix(vec3(0.1, 0.05, 0.2), vec3(0.9, 0.95, 0.8), hb).mul(lines(bed, 2).mul(0.3).oneMinus());

  // 5. corriente: color por rapidez (relativa a la media) y puntos que viajan con ella (flow map de dos fases)
  const p = positionWorld.xz;
  const fl = flowTex.sample(p.sub(u.flowOrigin).div(u.flowSize));
  const rel = fl.z;
  const speedRamp = mix(mix(vec3(0.05, 0.1, 0.35), vec3(0.1, 0.65, 0.7), clamp(rel, 0, 1)),
    mix(vec3(0.95, 0.9, 0.3), vec3(1, 1, 1), clamp(rel.sub(2), 0, 1)), clamp(rel.sub(1), 0, 1));
  const T = float(6);
  const ph = surfaceUniforms.time.div(T).add(mx_noise_float(p.mul(0.02)).mul(0.5).add(0.5));
  const ph0 = fract(ph), ph1 = fract(ph.add(0.5));
  const vel = fl.xy.mul(surfaceUniforms.speed);
  const dots = (o) => smoothstep(0.32, 0.12, length(fract(p.sub(o).div(6)).sub(0.5)));
  const dotMix = mix(dots(vel.mul(ph0.sub(0.5).mul(T))), dots(vel.mul(ph1.sub(0.5).mul(T)).add(vec2(3, 3))), abs(ph0.mul(2).sub(1)));
  const cFlow = select(rel.greaterThan(0.001), mix(speedRamp, vec3(1), dotMix.mul(0.6)), vec3(0.25));

  // 6. comparación con la tangente del eje (_flujo_x, _flujo_z): verde si coinciden, rojo si difieren 60° o más
  let cCompare = vec3(0.25);
  if (geometry.attributes._flujo_x && geometry.attributes._flujo_z) {
    const ref = vec2(attribute('_flujo_x', 'float'), attribute('_flujo_z', 'float'));
    const c = dot(normalize(fl.xy.add(1e-6)), normalize(ref.add(1e-6)));
    const cCmp = mix(mix(vec3(0.9, 0.1, 0.05), vec3(0.95, 0.8, 0.1), smoothstep(0.5, 0.85, c)), vec3(0.15, 0.75, 0.3), smoothstep(0.85, 0.97, c));
    cCompare = select(rel.greaterThan(0.001), cCmp.mul(dotMix.mul(0.3).oneMinus()), vec3(0.25));
  }

  // 7. vorticidad de la simulación: rojo = giro horario visto desde arriba, azul = antihorario; puntos con la corriente
  const w = simTex.sample(p.sub(u.flowOrigin).div(u.flowSize)).w;
  const wn = clamp(abs(w).div(0.15), 0, 1);
  const cVort = select(rel.greaterThan(0.001),
    mix(vec3(0.12), select(w.greaterThan(0), vec3(1, 0.25, 0.1), vec3(0.15, 0.45, 1)), wn).add(dotMix.mul(0.25)), vec3(0.25));

  // 8. espuma: de azul oscuro (nada) a blanco (densidad 1 o más)
  const fd = clamp(foamTex.sample(p.sub(u.flowOrigin).div(u.flowSize)).x, 0, 1);
  const cFoam = select(rel.greaterThan(0.001), mix(vec3(0.05, 0.08, 0.25), vec3(1), fd), vec3(0.25));

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'RealisticRiver1.debug';
  material.fog = false;
  material.toneMapped = false;
  material.colorNode = select(u.view.equal(1), cShore,
    select(u.view.equal(2), cDepth,
      select(u.view.equal(3), cObst,
        select(u.view.equal(4), cBed,
          select(u.view.equal(5), cFlow,
            select(u.view.equal(6), cCompare,
              select(u.view.equal(7), cVort, cFoam)))))));

  return {
    material,
    uniforms: u,
    /** Tras rehornear el dominio. */
    refresh() {
      const d = getDomain();
      tex.value = d.texture;
      u.origin.value.copy(d.origin);
      u.size.value.copy(d.size);
      u.level.value = d.level;
      const f = getFlow();
      flowTex.value = f.texture;
      u.flowOrigin.value.copy(f.origin);
      u.flowSize.value.copy(f.size);
    },
    /** Textura de velocidad de las vistas de corriente (simulación o base) y textura de la simulación. */
    setVelocityTexture(tex) { flowTex.value = tex; },
    setSimTexture(tex, foam) { simTex.value = tex; if (foam) foamTex.value = foam; },
    dispose: () => material.dispose(),
  };
}

import * as THREE from 'three/webgpu';
import { abs, clamp, fract, mix, positionWorld, select, smoothstep, texture, uniform, vec3 } from 'three/tsl';

/** Vistas de depuración (el valor es el índice que recibe el shader). */
export const DEBUG_VIEWS = {
  'Ninguna': 0,
  'Orilla (distancia con signo)': 1,
  'Profundidad': 2,
  'Obstáculos': 3,
  'Lecho (altura)': 4,
};

/**
 * Material sin luz ni niebla que pinta los mapas del dominio sobre la lámina. Se pone en lugar del material del río
 * mientras hay una vista de depuración activa.
 *
 * @param {() => object} getDomain devuelve el dominio actual (cambia al rehornear)
 */
export function createDebugMaterial(getDomain) {
  const d0 = getDomain();
  const u = {
    view: uniform(0, 'int'),
    origin: uniform(d0.origin.clone()),
    size: uniform(d0.size.clone()),
    level: uniform(d0.level),
  };
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

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'RealisticRiver1.debug';
  material.fog = false;
  material.toneMapped = false;
  material.colorNode = select(u.view.equal(1), cShore,
    select(u.view.equal(2), cDepth,
      select(u.view.equal(3), cObst, cBed)));

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
    },
    dispose: () => material.dispose(),
  };
}

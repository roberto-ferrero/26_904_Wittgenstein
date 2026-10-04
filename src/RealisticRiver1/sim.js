import * as THREE from 'three/webgpu';
import { Fn, If, abs, clamp, float, floor, instanceIndex, int, length, max, min, mix, mx_noise_float, storage, textureStore, uniform, uvec2, vec2, vec3, vec4 } from 'three/tsl';
import { edt2d } from './domain.js';

/**
 * Simulación viva del río (F4): fluido incompresible promediado en la vertical (Stable Fluids) en compute, sobre la
 * rejilla de la corriente base (2 m). Añade lo que el flujo potencial no tiene: separación en las puntas y los
 * obstáculos, recirculación detrás de ellos, cizalla junto a las orillas y remolinos que viajan con el agua.
 *
 * Cada paso (a paso fijo, 30 por segundo por defecto):
 * 1. Advección semilagrangiana de la velocidad (interpolación bilineal).
 * 2. Vorticidad ω y confinamiento de vorticidad (devuelve a los remolinos lo que la difusión numérica les quita).
 * 3. Rozamiento con las orillas y los obstáculos (las celdas de agua que tocan tierra frenan: cizalla), viscosidad
 *    (mezcla con los vecinos, quita el ruido de una celda), turbulencia junto a tierra (fuerza sin divergencia, el
 *    rotacional de un ruido 3D que evoluciona con el tiempo, en una banda de ~24 m junto a orillas y obstáculos: siembra
 *    las perturbaciones que la cizalla enrolla en remolinos) y relajación hacia la corriente base con una constante de
 *    tiempo (el río no deriva y conserva su caudal medio).
 * 4. Proyección ponderada por la profundidad (tapa rígida): se resuelve ∇·(h ∇p) = ∇·(h u) con Jacobi y se resta ∇p,
 *    así el caudal h·u no tiene divergencia. Contorno cerrado en tierra y abierto (p = 0) donde el río entra y sale.
 * 5. Salida a una textura RGBA16F para el material: velocidad relativa (dividida por la velocidad media), rapidez
 *    relativa y vorticidad.
 *
 * Velocidades en m/s ya exageradas (velocidad del río × exageración), así que los remolinos se mueven a la misma
 * velocidad que las ondas del flow map.
 *
 * @param {THREE.WebGPURenderer} renderer
 * @param {object} flow corriente base (solveBaseFlow): rejilla, `vx`, `vz`, `type`, `depth`
 * @param {object} state parámetros del río (RIVER_DEFAULTS)
 */
export function createSimulation(renderer, flow, state) {
  const { nx, nz } = flow;
  const N = nx * nz;
  const cell = flow.cellSize;
  const WET = 1, DRY = 2;

  // ---------------------------------------------------------------- datos fijos: base (x, z), profundidad, tipo
  // donde no hay geometría (entrada y salida del río) se copia la base del agua vecina: el agua entra con ella
  const baseX = Float32Array.from(flow.vx), baseZ = Float32Array.from(flow.vz);
  const filled = new Uint8Array(N);
  for (let k = 0; k < N; k++) filled[k] = flow.type[k] !== 0 ? 1 : 0;
  for (let pass = 0; pass < 6; pass++) {
    const next = filled.slice();
    for (let k = 0; k < N; k++) {
      if (filled[k]) continue;
      const i = k % nx, j = (k / nx) | 0;
      let sx = 0, sz = 0, n = 0;
      for (const m of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < nz - 1 ? k + nx : -1]) {
        if (m < 0 || !filled[m] || flow.type[m] === DRY) continue;
        sx += baseX[m]; sz += baseZ[m]; n++;
      }
      if (n) { baseX[k] = sx / n; baseZ[k] = sz / n; next[k] = 1; }
    }
    filled.set(next);
  }
  // cercanía a tierra (orillas y obstáculos): 1 junto a ella, 0 a 24 m o más
  const dry = new Uint8Array(N);
  for (let k = 0; k < N; k++) dry[k] = flow.type[k] === DRY ? 1 : 0;
  const dDry = edt2d(dry, nx, nz);
  const near = new Float32Array(N);
  for (let k = 0; k < N; k++) near[k] = Math.max(0, 1 - (dDry[k] * cell) / 24);
  const fixed = new Float32Array(N * 4);
  for (let k = 0; k < N; k++) {
    fixed[k * 4] = baseX[k];
    fixed[k * 4 + 1] = baseZ[k];
    fixed[k * 4 + 2] = Math.max(flow.depth[k], 0.5);
    fixed[k * 4 + 3] = flow.type[k];
  }
  const buf = (array, itemSize, type) => storage(new THREE.StorageInstancedBufferAttribute(array, itemSize), type, N);
  const S = buf(fixed, 4, 'vec4').toReadOnly();
  const NEAR = buf(near, 1, 'float').toReadOnly();
  const velA = buf(new Float32Array(N * 2), 2, 'vec2');
  const velB = buf(new Float32Array(N * 2), 2, 'vec2');
  const pA = buf(new Float32Array(N), 1, 'float');
  const pB = buf(new Float32Array(N), 1, 'float');
  const divB = buf(new Float32Array(N), 1, 'float');
  const curlB = buf(new Float32Array(N), 1, 'float');

  const texture = new THREE.StorageTexture(nx, nz);
  texture.type = THREE.HalfFloatType;
  texture.generateMipmaps = false;
  texture.mipmapsAutoUpdate = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.name = 'RealisticRiver1.sim';

  const u = {
    dt: uniform(1 / 30),
    speed: uniform(1),
    vorticity: uniform(0.5),
    relax: uniform(0.01), // 1 − e^(−dt/τ)
    bankDrag: uniform(0.03), // fracción de velocidad que se pierde por paso junto a tierra
    viscosity: uniform(0.1), // mezcla con los vecinos por paso
    turbulence: uniform(0.5), // aceleración de la turbulencia junto a tierra, en unidades de la velocidad media por s
    turbScale: uniform(30), // tamaño de las perturbaciones (m)
    time: uniform(0),
  };

  // ---------------------------------------------------------------- utilidades de rejilla
  const NX = int(nx), NZ = int(nz);
  const cellIJ = () => {
    const k = int(instanceIndex);
    return { k, i: k.mod(NX), j: k.div(NX) };
  };
  const at = (i, j) => clamp(j, int(0), NZ.sub(1)).mul(NX).add(clamp(i, int(0), NX.sub(1)));
  /** Velocidad bilineal de `b` en `p` (coordenadas de celda, centro de la celda i en i + ½). */
  const sampleVel = (b, p) => {
    const q = clamp(p.sub(0.5), vec2(0), vec2(nx - 1, nz - 1));
    const q0 = floor(q);
    const t = q.sub(q0);
    const i0 = int(q0.x), j0 = int(q0.y);
    const i1 = min(i0.add(1), NX.sub(1)), j1 = min(j0.add(1), NZ.sub(1));
    const a = mix(b.element(at(i0, j0)), b.element(at(i1, j0)), t.x);
    const c = mix(b.element(at(i0, j1)), b.element(at(i1, j1)), t.x);
    return mix(a, c, t.y);
  };

  // ---------------------------------------------------------------- 0. arranque: velocidad = base
  const init = Fn(() => {
    const { k } = cellIJ();
    const s = S.element(k);
    const v = s.w.greaterThan(DRY - 0.5).select(vec2(0), s.xy.mul(u.speed));
    velA.element(k).assign(v);
    velB.element(k).assign(v);
    pA.element(k).assign(0);
    pB.element(k).assign(0);
  })().compute(N);

  // ---------------------------------------------------------------- 1. advección A → B
  const advect = Fn(() => {
    const { k, i, j } = cellIJ();
    const s = S.element(k);
    const out = vec2(0).toVar();
    If(s.w.lessThan(0.5), () => { out.assign(s.xy.mul(u.speed)); }) // vacío: entra el agua con la base
      .ElseIf(s.w.lessThan(WET + 0.5), () => {
        const x = vec2(float(i).add(0.5), float(j).add(0.5));
        const back = x.sub(velA.element(k).mul(u.dt.div(cell)));
        out.assign(sampleVel(velA, back));
      });
    velB.element(k).assign(out);
  })().compute(N);

  // ---------------------------------------------------------------- 2. vorticidad
  const curl = Fn(() => {
    const { k, i, j } = cellIJ();
    const vE = velB.element(at(i.add(1), j)), vW = velB.element(at(i.sub(1), j));
    const vS = velB.element(at(i, j.add(1))), vN = velB.element(at(i, j.sub(1)));
    const w = vE.y.sub(vW.y).sub(vS.x.sub(vN.x)).div(2 * cell);
    curlB.element(k).assign(S.element(k).w.equal(WET).select(w, 0));
  })().compute(N);

  // ---------------------------------------------------------------- 3. fuerzas: confinamiento, rozamiento, relajación
  const forces = Fn(() => {
    const { k, i, j } = cellIJ();
    const s = S.element(k);
    If(s.w.equal(WET), () => {
      const w = curlB.element(k);
      const g = vec2(
        abs(curlB.element(at(i.add(1), j))).sub(abs(curlB.element(at(i.sub(1), j)))),
        abs(curlB.element(at(i, j.add(1)))).sub(abs(curlB.element(at(i, j.sub(1))))),
      );
      const n = g.div(length(g).add(1e-5));
      const f = vec2(n.y, n.x.negate()).mul(w).mul(u.vorticity.mul(cell));
      const v = velB.element(k).add(f.mul(u.dt)).toVar();
      // viscosidad: mezcla con la media de los vecinos con agua (los de tierra cuentan como la propia celda)
      const nbVel = (m) => S.element(m).w.equal(WET).select(velB.element(m), velB.element(k));
      const avg = nbVel(at(i.add(1), j)).add(nbVel(at(i.sub(1), j))).add(nbVel(at(i, j.add(1)))).add(nbVel(at(i, j.sub(1)))).mul(0.25);
      v.assign(mix(v, avg, u.viscosity));
      // turbulencia junto a tierra: rotacional de un ruido 3D (x, z, tiempo), sin divergencia
      const pn = vec2(float(i).add(0.5), float(j).add(0.5)).mul(cell).div(u.turbScale);
      const tz = u.time.mul(0.08);
      const e = 0.5;
      const phi = (o) => mx_noise_float(vec3(pn.add(o), tz));
      const dphx = phi(vec2(e, 0)).sub(phi(vec2(-e, 0)));
      const dphz = phi(vec2(0, e)).sub(phi(vec2(0, -e)));
      const turb = vec2(dphz, dphx.negate()).mul(u.turbulence.mul(u.speed).mul(NEAR.element(k)));
      v.addAssign(turb.mul(u.dt));
      // relajación hacia la base
      v.assign(mix(v, s.xy.mul(u.speed), u.relax));
      // rozamiento junto a tierra (orillas y obstáculos)
      const nearDry = max(max(S.element(at(i.add(1), j)).w, S.element(at(i.sub(1), j)).w),
        max(S.element(at(i, j.add(1))).w, S.element(at(i, j.sub(1))).w)).greaterThan(DRY - 0.5);
      v.assign(nearDry.select(v.mul(float(1).sub(u.bankDrag)), v));
      velB.element(k).assign(v);
    });
  })().compute(N);

  // ---------------------------------------------------------------- 4. proyección ponderada por la profundidad
  // flujo h·u por cada cara: 0 contra tierra, el de la propia celda hacia lo vacío (abierto), la media entre agua
  const faceFlux = (k, h, v, m, comp) => {
    const sm = S.element(m);
    const own = v[comp].mul(h);
    const avg = own.add(velB.element(m)[comp].mul(sm.z)).mul(0.5);
    return sm.w.greaterThan(DRY - 0.5).select(0, sm.w.lessThan(0.5).select(own, avg));
  };
  const divergence = Fn(() => {
    const { k, i, j } = cellIJ();
    const s = S.element(k);
    const v = velB.element(k);
    const h = s.z;
    const fe = faceFlux(k, h, v, at(i.add(1), j), 'x');
    const fw = faceFlux(k, h, v, at(i.sub(1), j), 'x');
    const fs = faceFlux(k, h, v, at(i, j.add(1)), 'y');
    const fn = faceFlux(k, h, v, at(i, j.sub(1)), 'y');
    // en los bordes del dominio la celda vecina es ella misma: se trata como cara cerrada
    const e = i.lessThan(NX.sub(1)).select(fe, 0), w = i.greaterThan(0).select(fw, 0);
    const so = j.lessThan(NZ.sub(1)).select(fs, 0), no = j.greaterThan(0).select(fn, 0);
    divB.element(k).assign(s.w.equal(WET).select(e.sub(w).add(so).sub(no).div(cell), 0));
  })().compute(N);

  const jacobi = (src, dst) => Fn(() => {
    const { k, i, j } = cellIJ();
    const s = S.element(k);
    const num = float(0).toVar(), den = float(0).toVar();
    const nb = (ok, m) => {
      const sm = S.element(m);
      // agua: peso con la profundidad media de la cara; vacío: p = 0 con la profundidad propia; tierra: nada
      const wWet = s.z.add(sm.z).mul(0.5);
      const isWet = ok.and(sm.w.equal(WET));
      const isOpen = ok.and(sm.w.lessThan(0.5));
      num.addAssign(isWet.select(wWet.mul(src.element(m)), 0));
      den.addAssign(isWet.select(wWet, isOpen.select(s.z, 0)));
    };
    nb(i.lessThan(NX.sub(1)), at(i.add(1), j));
    nb(i.greaterThan(0), at(i.sub(1), j));
    nb(j.lessThan(NZ.sub(1)), at(i, j.add(1)));
    nb(j.greaterThan(0), at(i, j.sub(1)));
    const p = num.sub(divB.element(k).mul(cell * cell)).div(max(den, 1e-6));
    dst.element(k).assign(s.w.equal(WET).select(p, 0));
  })().compute(N);
  const jacobiAB = jacobi(pA, pB), jacobiBA = jacobi(pB, pA);

  const subtract = Fn(() => {
    const { k, i, j } = cellIJ();
    const s = S.element(k);
    If(s.w.equal(WET), () => {
      const p = pA.element(k);
      const pn = (ok, m) => {
        const sm = S.element(m);
        // tierra: Neumann (como la propia); vacío: 0
        return ok.not().or(sm.w.greaterThan(DRY - 0.5)).select(p, sm.w.lessThan(0.5).select(0, pA.element(m)));
      };
      const gx = pn(i.lessThan(NX.sub(1)), at(i.add(1), j)).sub(pn(i.greaterThan(0), at(i.sub(1), j))).div(2 * cell);
      const gz = pn(j.lessThan(NZ.sub(1)), at(i, j.add(1))).sub(pn(j.greaterThan(0), at(i, j.sub(1)))).div(2 * cell);
      // ∇·(h u) = ∇·(h ∇p) → u − ∇p conserva el caudal
      velB.element(k).assign(velB.element(k).sub(vec2(gx, gz)));
    });
  })().compute(N);

  // ---------------------------------------------------------------- 5. B → A y salida para el material
  const output = Fn(() => {
    const { k, i, j } = cellIJ();
    const v = velB.element(k);
    velA.element(k).assign(v);
    const inv = float(1).div(max(u.speed, 1e-4));
    textureStore(texture, uvec2(i, j), vec4(v.mul(inv), length(v).mul(inv), curlB.element(k)));
  })().compute(N);

  let pressureIterations = 20;
  let steps = [];
  const rebuildSteps = () => {
    const jac = [];
    for (let n = 0; n < pressureIterations; n += 2) jac.push(jacobiAB, jacobiBA);
    steps = [advect, curl, forces, divergence, ...jac, subtract, output];
  };
  rebuildSteps();

  let acc = 0, initialized = false, stepCount = 0;
  function applyState() {
    u.speed.value = state.flowSpeed * state.flowBoost;
    const h = 1 / state.simRate;
    u.dt.value = h;
    u.vorticity.value = state.vorticity;
    u.relax.value = 1 - Math.exp(-h / Math.max(state.relaxTime, 0.1));
    u.bankDrag.value = Math.min(state.bankDrag * h, 0.9);
    u.viscosity.value = Math.min(state.viscosity, 0.9);
    u.turbulence.value = state.turbulence;
    u.turbScale.value = state.turbScale;
    if (state.pressureIterations !== pressureIterations) {
      pressureIterations = Math.max(2, Math.round(state.pressureIterations / 2) * 2);
      rebuildSteps();
    }
  }

  function reset() {
    applyState();
    renderer.compute([init, output]);
    initialized = true;
    acc = 0;
  }

  /** Avanza la simulación el tiempo `dt` a paso fijo (como mucho 2 pasos por fotograma). */
  function update(dt) {
    if (!initialized) reset();
    const h = 1 / state.simRate;
    acc = Math.min(acc + dt, 2 * h);
    let n = 0;
    while (acc >= h && n < 2) {
      u.time.value += h;
      renderer.compute(steps);
      acc -= h;
      n++;
      stepCount++;
    }
  }

  applyState();
  return {
    texture,
    origin: flow.origin.clone(),
    size: flow.size.clone(),
    uniforms: u,
    applyState,
    reset,
    update,
    get steps() { return stepCount; },
    get dispatchesPerStep() { return steps.length; },
    dispose() {
      texture.dispose();
      for (const node of [init, advect, curl, forces, divergence, jacobiAB, jacobiBA, subtract, output]) node.dispose?.();
    },
  };
}

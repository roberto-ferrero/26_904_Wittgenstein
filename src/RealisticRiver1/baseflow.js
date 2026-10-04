import * as THREE from 'three/webgpu';
import { edt2d } from './domain.js';

/**
 * Corriente base del río: flujo medio estacionario, promediado en la vertical, que respeta el caudal.
 *
 * Se resuelve la función de corriente ψ del caudal por unidad de ancho (q = h·u) con `∇·(∇ψ / h) = 0` en el agua:
 * - ψ = 0 en la orilla derecha y ψ = 1 en la izquierda (mirando aguas abajo), así que entre ellas pasa todo el caudal.
 * - Cada isla u obstáculo es una isla con ψ constante libre: vale la media ponderada de su contorno, y el agua la
 *   rodea por los dos lados en la proporción que toca.
 * - Donde el agua toca el borde del dominio o lo vacío (la entrada y la salida del río) el contorno es abierto
 *   (derivada normal nula).
 * La velocidad es u = (−∂ψ/∂z, ∂ψ/∂x) / h: no atraviesa las orillas, rodea los obstáculos, se acelera en los bajíos y
 * estrechamientos y se frena en las pozas. Se normaliza para que la media en el agua valga 1 (la velocidad real la
 * pone el material con la velocidad del río del panel, así que cambiarla no obliga a recalcular).
 *
 * Se resuelve en CPU sobre una rejilla más gruesa que la del dominio (2 m por defecto), partiendo de una estimación
 * con la distancia a cada orilla y con Gauss-Seidel rojo-negro sobrerrelajado.
 */

const WET = 1, DRY = 2, EMPTY = 0;

/**
 * @param {object} domain lo que devuelve bakeDomain
 * @param {object} [o]
 * @param {number} [o.cellSize=2] metros por celda de la corriente (múltiplo de la celda del dominio)
 * @param {number[]} [o.direction=[0, 1]] sentido general aguas abajo (x, z), para saber qué orilla es cuál
 * @param {number} [o.minDepth=0.5] profundidad mínima en el cálculo (evita velocidades infinitas en la orilla)
 * @param {number} [o.maxIterations=4000]
 * @param {number} [o.tolerance=1e-6] cambio máximo de ψ por iteración para parar
 * @param {number} [o.maxSpeed=3] tope de velocidad relativa a la media
 * @param {object} [o.previous] corriente anterior: se reutiliza su textura si el tamaño no cambia
 */
export function solveBaseFlow(domain, {
  cellSize = 2, direction = [0, 1], minDepth = 0.5, maxIterations = 4000, tolerance = 1e-6, maxSpeed = 3,
  previous = null,
} = {}) {
  const t0 = performance.now();
  const f = Math.max(1, Math.round(cellSize / domain.cellSize));
  const cell = f * domain.cellSize;
  const nx = Math.ceil(domain.nx / f), nz = Math.ceil(domain.nz / f);
  const N = nx * nz;

  // ---------------------------------------------------------------- rejilla gruesa
  const type = new Uint8Array(N);
  const depth = new Float32Array(N);
  for (let J = 0; J < nz; J++) {
    for (let I = 0; I < nx; I++) {
      let nWet = 0, nDry = 0, nEmpty = 0, sum = 0;
      for (let dj = 0; dj < f; dj++) {
        const j = J * f + dj;
        if (j >= domain.nz) continue;
        for (let di = 0; di < f; di++) {
          const i = I * f + di;
          if (i >= domain.nx) continue;
          const k = i + j * domain.nx;
          if (domain.wet[k]) { nWet++; sum += domain.depth[k]; } else if (domain.dry[k]) nDry++; else nEmpty++;
        }
      }
      const K = I + J * nx;
      if (nWet > 0 && nWet * 2 >= nWet + nDry + nEmpty) { type[K] = WET; depth[K] = sum / nWet; } else type[K] = nDry >= nEmpty && nDry > 0 ? DRY : EMPTY;
    }
  }

  // ---------------------------------------------------------------- componentes secas: dos orillas e islas
  const label = new Int32Array(N).fill(-1);
  const comps = []; // { size, along }
  const queue = new Int32Array(N);
  const [dxDir, dzDir] = (() => { const l = Math.hypot(direction[0], direction[1]) || 1; return [direction[0] / l, direction[1] / l]; })();
  // "izquierda" mirando aguas abajo (con Y arriba): (dz, −dx)
  const leftX = dzDir, leftZ = -dxDir;
  for (let s = 0; s < N; s++) {
    if (type[s] !== DRY || label[s] >= 0) continue;
    const id = comps.length;
    let head = 0, tail = 0, size = 0, side = 0;
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const k = queue[head++];
      const i = k % nx, j = (k / nx) | 0;
      size++;
      side += (i + 0.5) * leftX + (j + 0.5) * leftZ;
      if (i > 0 && type[k - 1] === DRY && label[k - 1] < 0) { label[k - 1] = id; queue[tail++] = k - 1; }
      if (i < nx - 1 && type[k + 1] === DRY && label[k + 1] < 0) { label[k + 1] = id; queue[tail++] = k + 1; }
      if (j > 0 && type[k - nx] === DRY && label[k - nx] < 0) { label[k - nx] = id; queue[tail++] = k - nx; }
      if (j < nz - 1 && type[k + nx] === DRY && label[k + nx] < 0) { label[k + nx] = id; queue[tail++] = k + nx; }
    }
    comps.push({ size, side: side / size });
  }
  const bySize = comps.map((c, id) => id).sort((a, b) => comps[b].size - comps[a].size);
  let leftBank = -1, rightBank = -1;
  if (bySize.length >= 2) {
    const [a, b] = bySize;
    [leftBank, rightBank] = comps[a].side > comps[b].side ? [a, b] : [b, a];
  }
  const islandOf = new Int32Array(comps.length).fill(-1); // componente → índice de isla
  let nIslands = 0;
  comps.forEach((c, id) => { if (id !== leftBank && id !== rightBank) islandOf[id] = nIslands++; });

  // ---------------------------------------------------------------- estimación inicial y vecinos
  const psi = new Float32Array(N);
  if (leftBank >= 0) {
    const seedL = new Uint8Array(N), seedR = new Uint8Array(N);
    for (let k = 0; k < N; k++) { if (label[k] === leftBank) seedL[k] = 1; else if (label[k] === rightBank) seedR[k] = 1; }
    const dL = edt2d(seedL, nx, nz), dR = edt2d(seedR, nx, nz);
    for (let k = 0; k < N; k++) psi[k] = label[k] === leftBank ? 1 : label[k] === rightBank ? 0 : dR[k] / (dL[k] + dR[k] + 1e-9);
    // con la solución anterior en la misma rejilla (p. ej. tras añadir una piedra) se parte de ella en el agua:
    // converge en muchas menos iteraciones
    if (previous?.psi && previous.nx === nx && previous.nz === nz) {
      for (let k = 0; k < N; k++) if (type[k] === WET && previous.type[k] === WET) psi[k] = previous.psi[k];
    }
  }

  // celdas de agua y sus cuatro vecinos con peso (−1 = contorno abierto)
  const wetIdx = [];
  for (let k = 0; k < N; k++) if (type[k] === WET) wetIdx.push(k);
  const nW = wetIdx.length;
  const cells = Int32Array.from(wetIdx);
  const nb = new Int32Array(nW * 4).fill(-1);
  const wt = new Float32Array(nW * 4);
  const red = [], black = [];
  const hOf = (k) => Math.max(depth[k], minDepth);
  const islandEdges = Array.from({ length: nIslands }, () => []); // [wet k, peso]
  for (let n = 0; n < nW; n++) {
    const k = cells[n];
    const i = k % nx, j = (k / nx) | 0;
    const nbs = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < nz - 1 ? k + nx : -1];
    nbs.forEach((m, d) => {
      if (m < 0 || type[m] === EMPTY) return;
      const w = type[m] === WET ? 2 / (hOf(k) + hOf(m)) : 1 / hOf(k);
      nb[n * 4 + d] = m;
      wt[n * 4 + d] = w;
      if (type[m] === DRY && islandOf[label[m]] >= 0) islandEdges[islandOf[label[m]]].push(k, w);
    });
    ((i + j) & 1 ? black : red).push(n);
  }
  const islandCells = Array.from({ length: nIslands }, () => []);
  for (let k = 0; k < N; k++) if (type[k] === DRY && islandOf[label[k]] >= 0) islandCells[islandOf[label[k]]].push(k);
  const order = [Int32Array.from(red), Int32Array.from(black)];

  // ---------------------------------------------------------------- Gauss-Seidel rojo-negro sobrerrelajado
  const omega = 1.9;
  let it = 0, change = Infinity;
  if (leftBank >= 0) {
    for (; it < maxIterations && change > tolerance; it++) {
      change = 0;
      for (const list of order) {
        for (let q = 0; q < list.length; q++) {
          const n = list[q], o = n * 4;
          let sw = 0, s = 0;
          for (let d = 0; d < 4; d++) {
            const m = nb[o + d];
            if (m < 0) continue;
            sw += wt[o + d];
            s += wt[o + d] * psi[m];
          }
          if (sw === 0) continue;
          const k = cells[n];
          const v = psi[k] + omega * (s / sw - psi[k]);
          const dv = Math.abs(v - psi[k]);
          if (dv > change) change = dv;
          psi[k] = v;
        }
      }
      // islas: ψ constante = media ponderada de su contorno
      for (let isl = 0; isl < nIslands; isl++) {
        const e = islandEdges[isl];
        if (!e.length) continue;
        let sw = 0, s = 0;
        for (let q = 0; q < e.length; q += 2) { s += e[q + 1] * psi[e[q]]; sw += e[q + 1]; }
        const v = s / sw;
        for (const k of islandCells[isl]) psi[k] = v;
      }
    }
  }
  const tSolve = performance.now();

  // ---------------------------------------------------------------- velocidad
  const vx = new Float32Array(N), vz = new Float32Array(N);
  let sumSpeed = 0;
  for (let n = 0; n < nW; n++) {
    const k = cells[n], o = n * 4;
    const [mW, mE, mN, mS] = [nb[o], nb[o + 1], nb[o + 2], nb[o + 3]];
    const dpx = mW >= 0 && mE >= 0 ? (psi[mE] - psi[mW]) / 2 : mE >= 0 ? psi[mE] - psi[k] : mW >= 0 ? psi[k] - psi[mW] : 0;
    const dpz = mN >= 0 && mS >= 0 ? (psi[mS] - psi[mN]) / 2 : mS >= 0 ? psi[mS] - psi[k] : mN >= 0 ? psi[k] - psi[mN] : 0;
    const h = hOf(k);
    vx[k] = -dpz / h;
    vz[k] = dpx / h;
    sumSpeed += Math.hypot(vx[k], vz[k]);
  }
  const mean = nW ? sumSpeed / nW : 1;
  let maxRel = 0;
  for (let n = 0; n < nW; n++) {
    const k = cells[n];
    vx[k] /= mean; vz[k] /= mean;
    const sp = Math.hypot(vx[k], vz[k]);
    if (sp > maxSpeed) { vx[k] *= maxSpeed / sp; vz[k] *= maxSpeed / sp; }
    maxRel = Math.max(maxRel, Math.min(sp, maxSpeed));
  }

  // ---------------------------------------------------------------- textura: R, G = velocidad (media 1), B = rapidez, A = ψ
  const half = new Uint16Array(N * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let k = 0; k < N; k++) {
    half[k * 4] = toHalf(vx[k]);
    half[k * 4 + 1] = toHalf(vz[k]);
    half[k * 4 + 2] = toHalf(Math.hypot(vx[k], vz[k]));
    half[k * 4 + 3] = toHalf(psi[k]);
  }
  let texture = previous?.texture;
  if (texture && texture.image.width === nx && texture.image.height === nz) {
    texture.image.data = half;
  } else {
    previous?.texture?.dispose();
    texture = new THREE.DataTexture(half, nx, nz, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.name = 'RealisticRiver1.baseflow';
  }
  texture.needsUpdate = true;

  const origin = domain.origin.clone();
  return {
    nx, nz, cellSize: cell,
    origin,
    size: new THREE.Vector2(nx * cell, nz * cell),
    psi, vx, vz, type, depth,
    texture,
    stats: {
      wetCells: nW,
      banks: leftBank >= 0 ? 2 : comps.length,
      islands: nIslands,
      iterations: it,
      lastChange: change,
      maxSpeed: maxRel,
      ms: { solve: tSolve - t0, total: performance.now() - t0 },
    },
    /** Velocidad relativa (media 1) en (x, z), interpolada. */
    sample(x, z, out = new THREE.Vector2()) {
      const fx = (x - origin.x) / cell - 0.5, fz = (z - origin.y) / cell - 0.5;
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const at = (a, ii, jj) => (ii < 0 || jj < 0 || ii >= nx || jj >= nz ? 0 : a[ii + jj * nx]);
      const bil = (a) => (at(a, i, j) * (1 - tx) + at(a, i + 1, j) * tx) * (1 - tz) + (at(a, i, j + 1) * (1 - tx) + at(a, i + 1, j + 1) * tx) * tz;
      return out.set(bil(vx), bil(vz));
    },
  };
}

import * as THREE from 'three/webgpu';
import { float, positionWorld, vec4 } from 'three/tsl';

/**
 * Dominio del río: una rejilla alineada con el mundo que cubre la lámina con un margen. Se hornea al crear el río
 * (y al cambiar los obstáculos) y de ella salen todos los mapas que usan la corriente, la simulación y la espuma.
 *
 * 1. Vista cenital ortográfica del terreno y de los obstáculos: altura de lo más alto en cada celda y si es obstáculo.
 * 2. Lectura en CPU y, por celda: agua (lecho por debajo de la cota), profundidad en metros (sin saturar) y distancia
 *    euclídea con signo a la orilla (Felzenszwalb, exacta), positiva en el agua y negativa en tierra.
 * 3. Una textura RGBA de media precisión con todo, filtrable, para los shaders.
 *
 * Celda (i, j): centro en x = x0 + (i + ½)·cell, z = z0 + (j + ½)·cell. Índice i + j·nx. En la textura la fila j
 * está en v = (j + ½) / nz, así que uv = ((x − x0) / (nx·cell), (z − z0) / (nz·cell)).
 */

/** Canales de `texture`. */
export const DOMAIN_CHANNELS = {
  R: 'distancia con signo a la orilla (m): + agua, − tierra',
  G: 'profundidad (m), 0 en tierra',
  B: 'obstáculo (1 = celda seca por un obstáculo)',
  A: 'altura del lecho o de lo más alto (m)',
};

const INF = 1e20;

/** Transformada de distancia euclídea exacta en 1D (Felzenszwalb y Huttenlocher), sobre distancias al cuadrado. */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    while (s <= z[k]) { // z[0] = −∞: se para como mucho en k = 0
      k--;
      s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Distancia (en celdas) de cada celda a la celda `true` más cercana de `seed`. */
export function edt2d(seed, nx, nz) {
  const n = Math.max(nx, nz);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const g = new Float64Array(nx * nz);
  for (let i = 0; i < nx * nz; i++) g[i] = seed[i] ? 0 : INF;
  for (let i = 0; i < nx; i++) { // columnas
    for (let j = 0; j < nz; j++) f[j] = g[i + j * nx];
    edt1d(f, nz, d, v, z);
    for (let j = 0; j < nz; j++) g[i + j * nx] = d[j];
  }
  const out = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) { // filas
    const o = j * nx;
    for (let i = 0; i < nx; i++) f[i] = g[o + i];
    edt1d(f, nx, d, v, z);
    for (let i = 0; i < nx; i++) out[o + i] = Math.sqrt(d[i]);
  }
  return out;
}

/** Copias "fantasma" de las mallas de `root` (misma geometría y matriz de mundo) con otro material. */
function proxies(root, material, skip) {
  const out = [];
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || skip.has(o)) return;
    let ok = o.visible;
    for (let p = o.parent; ok && p; p = p.parent) if (skip.has(p)) ok = false;
    if (!ok) return;
    const m = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, material, o.count) : new THREE.Mesh(o.geometry, material);
    if (o.isInstancedMesh) m.instanceMatrix = o.instanceMatrix;
    m.matrixAutoUpdate = false;
    m.matrix.copy(o.matrixWorld);
    m.frustumCulled = false;
    out.push(m);
  });
  return out;
}

/**
 * Hornea el dominio.
 *
 * @param {object} o
 * @param {THREE.WebGPURenderer} o.renderer
 * @param {THREE.Mesh} o.water lámina (da la cota y la extensión)
 * @param {THREE.Object3D[]} o.terrain lo que forma el lecho y las orillas
 * @param {THREE.Object3D[]} o.obstacles lo que cuenta como obstáculo si sobresale de la lámina
 * @param {number} o.cellSize metros por celda
 * @param {number} o.margin metros de margen alrededor de la lámina
 * @param {object} [o.previous] dominio anterior: se reutiliza su textura si el tamaño no cambia
 */
export async function bakeDomain({ renderer, water, terrain, obstacles, cellSize, margin, previous = null }) {
  const t0 = performance.now();

  // ---------------------------------------------------------------- extensión y cota
  water.updateWorldMatrix(true, false);
  if (!water.geometry.boundingBox) water.geometry.computeBoundingBox();
  const box = water.geometry.boundingBox.clone().applyMatrix4(water.matrixWorld);
  const level = 0.5 * (box.min.y + box.max.y);
  // nx múltiplo de 16: las filas de la lectura quedan alineadas a 256 bytes
  const nx = Math.ceil((box.max.x - box.min.x + 2 * margin) / cellSize / 16) * 16;
  const nz = Math.ceil((box.max.z - box.min.z + 2 * margin) / cellSize);
  const cx = 0.5 * (box.min.x + box.max.x), cz = 0.5 * (box.min.z + box.max.z);
  const x0 = cx - 0.5 * nx * cellSize, z0 = cz - 0.5 * nz * cellSize;

  // ---------------------------------------------------------------- vista cenital
  // R = altura del mundo, G = 1 si es obstáculo, B = 1 donde hay geometría (lo vacío queda a 0 y cuenta como tierra)
  // (outputNode directo: sin conversión de color ni recorte a 0-1)
  const matTerrain = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  matTerrain.outputNode = vec4(positionWorld.y, float(0), float(1), float(1));
  const matObstacle = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  matObstacle.outputNode = vec4(positionWorld.y, float(1), float(1), float(1));
  for (const m of [matTerrain, matObstacle]) { m.toneMapped = false; m.fog = false; }

  const skip = new Set([water, ...obstacles]);
  const scene = new THREE.Scene();
  for (const r of terrain) proxies(r, matTerrain, skip).forEach((m) => scene.add(m));
  const obstacleProxies = obstacles.flatMap((r) => proxies(r, matObstacle, new Set([water])));
  obstacleProxies.forEach((m) => scene.add(m));

  // la cámara mira hacia −Y con "arriba" = −Z: derecha de la imagen = +X y fila 0 (arriba) = z0
  const top = Math.max(box.max.y, 0) + 5000;
  const cam = new THREE.OrthographicCamera(-0.5 * nx * cellSize, 0.5 * nx * cellSize, 0.5 * nz * cellSize, -0.5 * nz * cellSize, 1, 10000);
  cam.up.set(0, 0, -1);
  cam.position.set(cx, top, cz);
  cam.lookAt(cx, top - 1, cz);
  cam.updateMatrixWorld();

  const rt = new THREE.RenderTarget(nx, nz, { type: THREE.FloatType, depthBuffer: true });
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  // dos pasadas: con los obstáculos (lo más alto) y sin ellos (el terreno bajo cada obstáculo), para saber qué
  // obstáculos están de verdad en el agua y no en la orilla
  const pass = async (withObstacles) => {
    obstacleProxies.forEach((m) => { m.visible = withObstacles; });
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    return renderer.readRenderTargetPixelsAsync(rt, 0, 0, nx, nz);
  };
  const raw = await pass(true);
  const rawTerrain = obstacleProxies.length ? await pass(false) : raw;
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  matTerrain.dispose();
  matObstacle.dispose();
  const tRender = performance.now();

  // WebGPU deja la fila 0 arriba (z0); WebGL 2, abajo
  const flip = !renderer.backend.isWebGPUBackend;
  const stride = raw.length / nz; // floats por fila (puede venir con relleno)
  const N = nx * nz;
  const bed = new Float32Array(N);
  const depth = new Float32Array(N);
  const obstacle = new Uint8Array(N);
  const wet = new Uint8Array(N);
  const dry = new Uint8Array(N);
  const empty = new Uint8Array(N); // sin geometría (fuera del terreno): ni agua ni orilla
  let nWet = 0, nObstacle = 0;
  for (let j = 0; j < nz; j++) {
    const row = (flip ? nz - 1 - j : j) * stride;
    for (let i = 0; i < nx; i++) {
      const k = i + j * nx, p = row + i * 4;
      const hit = raw[p + 2] > 0.5;
      const h = hit ? raw[p] : level + 100;
      const hTerrain = rawTerrain[p + 2] > 0.5 ? rawTerrain[p] : level + 100;
      bed[k] = h;
      const w = h < level;
      wet[k] = w ? 1 : 0;
      dry[k] = w || !hit ? 0 : 1; // lo vacío no hace orilla: el río sale del dominio por ahí
      empty[k] = hit ? 0 : 1;
      if (w) { depth[k] = level - h; nWet++; }
      // obstáculo: seco por el obstáculo, pero el terreno de debajo estaría bajo el agua
      if (!w && raw[p + 1] > 0.5 && hTerrain < level) { obstacle[k] = 1; nObstacle++; }
    }
  }

  // distancia con signo a la orilla: + en el agua (hasta la tierra más cercana), − en tierra y en lo vacío (hasta el agua)
  const dToDry = edt2d(dry, nx, nz);
  const dToWet = edt2d(wet, nx, nz);
  const sdf = new Float32Array(N);
  // (sin agua o sin tierra en todo el dominio la distancia sería infinita: se recorta a ±1000 m)
  for (let k = 0; k < N; k++) sdf[k] = THREE.MathUtils.clamp((wet[k] ? dToDry[k] - 0.5 : 0.5 - dToWet[k]) * cellSize, -1000, 1000);
  const tCpu = performance.now();

  // ---------------------------------------------------------------- textura
  const half = new Uint16Array(N * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let k = 0; k < N; k++) {
    half[k * 4] = toHalf(sdf[k]);
    half[k * 4 + 1] = toHalf(depth[k]);
    half[k * 4 + 2] = toHalf(obstacle[k]);
    half[k * 4 + 3] = toHalf(bed[k]);
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
    texture.name = 'RealisticRiver1.domain';
  }
  texture.needsUpdate = true;

  let maxDepth = 0;
  for (let k = 0; k < N; k++) if (depth[k] > maxDepth) maxDepth = depth[k];

  return {
    nx, nz, cellSize, x0, z0, level,
    size: new THREE.Vector2(nx * cellSize, nz * cellSize),
    origin: new THREE.Vector2(x0, z0),
    sdf, depth, obstacle, bed, wet, dry, empty,
    texture,
    stats: {
      wetCells: nWet,
      obstacleCells: nObstacle,
      obstacleMeshes: obstacleProxies.length,
      maxDepth,
      ms: { render: tRender - t0, cpu: tCpu - tRender, total: performance.now() - t0 },
    },
    /** Índice de la celda que contiene (x, z), o −1 fuera del dominio. */
    cellAt(x, z) {
      const i = Math.floor((x - x0) / cellSize), j = Math.floor((z - z0) / cellSize);
      return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : i + j * nx;
    },
  };
}

import * as THREE from 'three/webgpu';

/**
 * Textura repetible de burbujas para la espuma. R: red celular (Worley, distancia al borde entre las dos celdas más
 * cercanas) con celdas de dos tamaños, 1 = pared de burbuja. G: ruido fbm repetible (4 octavas), para romper la
 * espuma en filamentos. Se genera al crear el río (unos
 * milisegundos), así que no hay que copiar ningún archivo.
 *
 * @param {number} [size=256] lado en píxeles
 * @param {number} [seed=7]
 */
export function createFoamTexture(size = 256, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const data = new Uint8Array(size * size * 4);
  const value = new Float32Array(size * size);

  // dos capas de celdas (grandes y pequeñas), repetibles: los puntos se repiten en los bordes
  const layers = [{ cells: 7, weight: 0.6 }, { cells: 17, weight: 0.4 }];
  for (const { cells, weight } of layers) {
    const pts = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + rnd()) / cells, (j + rnd()) / cells]);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = (x + 0.5) / size, py = (y + 0.5) / size;
        const ci = Math.floor(px * cells), cj = Math.floor(py * cells);
        let d1 = 9, d2 = 9;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
            const p = pts[ii + jj * cells];
            // posición del punto repetido junto a la celda vecina
            const qx = p[0] + Math.floor((ci + di) / cells), qy = p[1] + Math.floor((cj + dj) / cells);
            const d = Math.hypot(px - qx, py - qy) * cells;
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
        }
        // cerca del borde entre celdas (d2 − d1 pequeño) = pared de burbuja
        const edge = Math.max(0, 1 - (d2 - d1) / 0.45);
        value[x + y * size] += weight * edge ** 1.5;
      }
    }
  }
  // fbm de ruido de valor con rejillas que dividen el lado (repetible)
  const fbm = new Float32Array(size * size);
  let amp = 0.5, total = 0;
  for (const cells of [4, 8, 16, 32]) {
    const lat = Float32Array.from({ length: cells * cells }, rnd);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, fy = (y / size) * cells;
        const i0 = Math.floor(fx), j0 = Math.floor(fy);
        const tx = fx - i0, ty = fy - j0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i, j) => lat[(i % cells) + (j % cells) * cells];
        const a = at(i0, j0) + (at(i0 + 1, j0) - at(i0, j0)) * sx;
        const b = at(i0, j0 + 1) + (at(i0 + 1, j0 + 1) - at(i0, j0 + 1)) * sx;
        fbm[x + y * size] += amp * (a + (b - a) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  let max = 0;
  for (let k = 0; k < value.length; k++) max = Math.max(max, value[k]);
  for (let k = 0; k < value.length; k++) {
    const v = Math.round(Math.min(1, value[k] / max) * 255);
    const f = Math.round(Math.min(1, Math.max(0, (fbm[k] / total - 0.2) / 0.6)) * 255);
    data.set([v, f, 0, 255], k * 4);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.name = 'RealisticRiver1.bubbles';
  texture.needsUpdate = true;
  return texture;
}

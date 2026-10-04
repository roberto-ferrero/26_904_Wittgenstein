// Genera las texturas de ruido de las nubes volumétricas (VolumetricSky1), tileables y deterministas.
// Uso (desde la carpeta VolumetricSky1): node tools/gen-noise.mjs  →  textures/cloud_noise_64.bin, cloud_weather_256.bin
//
// cloud_noise_64.bin    64³ × RG8: R = forma (Perlin-Worley: fbm de Perlin "inflado" con Worley)
//                                   G = detalle (fbm de Worley a más frecuencia, para erosionar bordes)
// cloud_weather_256.bin 256² × RG8: R = cobertura (dónde hay nubes), G = variación de tipo/altura
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../textures');

// ------------------------------------------------------------------ PRNG y hash deterministas
function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ Perlin tileable (periodo p)
const GRADS = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function perlin(x, y, z, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const g = (ix, iy, iz, dx, dy, dz) => {
    const gr = GRADS[Math.floor(hash3(((ix % p) + p) % p, ((iy % p) + p) % p, ((iz % p) + p) % p, seed) * 12)];
    return gr[0] * dx + gr[1] * dy + gr[2] * dz;
  };
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const x0 = lerp(g(xi, yi, zi, xf, yf, zf), g(xi + 1, yi, zi, xf - 1, yf, zf), u);
  const x1 = lerp(g(xi, yi + 1, zi, xf, yf - 1, zf), g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u);
  const x2 = lerp(g(xi, yi, zi + 1, xf, yf, zf - 1), g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u);
  const x3 = lerp(g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u);
  return lerp(lerp(x0, x1, v), lerp(x2, x3, v), w); // ≈ [-1, 1]
}

// ------------------------------------------------------------------ Worley tileable (p celdas por lado)
function worley(x, y, z, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k;
    const wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p, wz = ((cz % p) + p) % p;
    const px = cx + hash3(wx, wy, wz, seed), py = cy + hash3(wx, wy, wz, seed + 1), pz = cz + hash3(wx, wy, wz, seed + 2);
    const dd = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
    if (dd < d) d = dd;
  }
  return Math.min(1, Math.sqrt(d)); // 0 en el centro de la celda
}

const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ------------------------------------------------------------------ volumen 64³
const N = 64;
const vol = new Uint8Array(N * N * N * 2);
let o = 0;
for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const u = x / N, v = y / N, w = z / N;
  // fbm de Perlin (periodos 4, 8, 16)
  let pf = 0, amp = 0.5;
  for (const per of [4, 8, 16]) { pf += amp * perlin(u * per, v * per, w * per, per, 7); amp *= 0.5; }
  pf = clamp01(pf * 0.8 + 0.5);
  // fbm de Worley invertido (celdas 4, 8, 16)
  const wf = (1 - worley(u * 4, v * 4, w * 4, 4, 11)) * 0.625 + (1 - worley(u * 8, v * 8, w * 8, 8, 13)) * 0.25 + (1 - worley(u * 16, v * 16, w * 16, 16, 17)) * 0.125;
  // Perlin-Worley: Perlin "inflado" por Worley (formas redondeadas tipo coliflor)
  const shape = clamp01(remap(pf, wf - 1, 1, 0, 1));
  const detail = (1 - worley(u * 8, v * 8, w * 8, 8, 23)) * 0.5 + (1 - worley(u * 16, v * 16, w * 16, 16, 29)) * 0.3 + (1 - worley(u * 32, v * 32, w * 32, 32, 31)) * 0.2;
  vol[o++] = Math.round(shape * 255);
  vol[o++] = Math.round(clamp01(detail) * 255);
}

// ------------------------------------------------------------------ mapa de clima 256²
const W = 256;
const weather = new Uint8Array(W * W * 2);
o = 0;
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const u = x / W, v = y / W;
  let c = 0, amp = 0.5;
  for (const per of [3, 6, 12, 24]) { c += amp * perlin(u * per, v * per, 0.5, per, 41); amp *= 0.5; }
  let t = 0; amp = 0.5;
  for (const per of [2, 4, 8]) { t += amp * perlin(u * per, v * per, 3.5, per, 53); amp *= 0.5; }
  weather[o++] = Math.round(clamp01(c * 0.9 + 0.5) * 255);
  weather[o++] = Math.round(clamp01(t * 0.9 + 0.5) * 255);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'cloud_noise_64.bin'), vol);
writeFileSync(resolve(OUT, 'cloud_weather_256.bin'), weather);
const stats = (a, ch) => { let mn = 255, mx = 0, s = 0, n = 0; for (let i = ch; i < a.length; i += 2) { mn = Math.min(mn, a[i]); mx = Math.max(mx, a[i]); s += a[i]; n++; } return `${mn}-${mx} media ${(s / n).toFixed(0)}`; };
console.log(`cloud_noise_64.bin: ${vol.length} B · forma ${stats(vol, 0)} · detalle ${stats(vol, 1)}`);
console.log(`cloud_weather_256.bin: ${weather.length} B · cobertura ${stats(weather, 0)} · tipo ${stats(weather, 1)}`);

import * as THREE from 'three/webgpu';

/**
 * Piedras de prueba para tantear obstáculos en el panel (F6): un icosaedro deformado con ruido, aplastado y con algo
 * de giro, de gris piedra. No pretende parecerse a las rocas de la escena; solo sirve para ver la estela, los
 * remolinos y la espuma que provoca una piedra antes de modelar las de verdad.
 *
 * @param {number} size ancho aproximado en metros
 * @param {number} [seed=1]
 */
export function createTestRock(size, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const geo = new THREE.IcosahedronGeometry(0.5, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  // deformación suave y coherente: suma de unos pocos "bultos" en direcciones al azar
  const bumps = Array.from({ length: 6 }, () => [new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), 0.08 + rnd() * 0.12]);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let r = 1;
    for (const [d, a] of bumps) r += a * Math.max(0, n.dot(d)) ** 2 - a * 0.3;
    v.copy(n).multiplyScalar(0.5 * r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8780, roughness: 0.92, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(size, size * (0.55 + rnd() * 0.2), size * (0.75 + rnd() * 0.3));
  mesh.rotation.y = rnd() * Math.PI * 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `PiedraDePrueba${seed}`;
  return mesh;
}

/**
 * Punto del agua en el centro de la vista: corta el rayo del centro de la cámara con la lámina y, si ahí no hay agua
 * con al menos 1,5 m de fondo, busca la celda así más cercana alrededor (hasta 60 m). Devuelve { x, z } o null.
 */
export function findWaterPoint(river, camera) {
  const d = river.domain;
  const ray = new THREE.Ray();
  camera.getWorldPosition(ray.origin);
  camera.getWorldDirection(ray.direction);
  const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.level), new THREE.Vector3());
  if (!hit) return null;
  const ok = (x, z) => { const k = d.cellAt(x, z); return k >= 0 && d.wet[k] && d.depth[k] > 1.5; };
  if (ok(hit.x, hit.z)) return { x: hit.x, z: hit.z };
  for (let r = 2; r <= 60; r += 2) {
    for (let a = 0; a < 16; a++) {
      const x = hit.x + Math.cos((a / 16) * Math.PI * 2) * r, z = hit.z + Math.sin((a / 16) * Math.PI * 2) * r;
      if (ok(x, z)) return { x, z };
    }
  }
  return null;
}

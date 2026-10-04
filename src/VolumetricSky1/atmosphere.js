import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, abs, acos, atan, cameraPosition, cameraWorldMatrix, clamp, cos, dot, exp, float, int, max, min, mix, normalize, output, positionView, positionWorld,
  pow, renderGroup, select, sign, sin, smoothstep, sqrt, texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

/**
 * Atmósfera física de VolumetricSky1 (origen: 26_903_Whale, Fase 3.2), versión simplificada del modelo de Hillaire (2020):
 * - Planeta de 6360 km y atmósfera de 100 km; Rayleigh (escala 8 km), Mie (1,2 km, g = 0,8) y
 *   absorción de ozono (capa centrada a 25 km). Coeficientes por km.
 * - **LUT de cielo** 256×128 (acimut relativo al sol × elevación, con más resolución cerca del
 *   horizonte): dispersión simple con transmitancia hacia el sol (sombra del planeta incluida) y un
 *   término de dispersión múltiple aproximado. Solo se recalcula cuando cambian el sol o los parámetros.
 * - **Cúpula** que lee la LUT según la dirección de vista y añade el disco solar con oscurecimiento al borde.
 * - `transmittance(altitudDeg)` en CPU con el mismo modelo, para el color de la luz del sol.
 * - `fogNode`: perspectiva aérea de la escena con la misma atmósfera y la LUT (ver más abajo).
 */
// Uniformes compartidos por varios materiales (la perspectiva aérea está en todos los de la escena): en el grupo
// `renderGroup` se suben una vez por render. En el grupo por defecto (por objeto) un cambio no llegaba a todos los
// materiales y la escena se veía con valores mezclados hasta que otra cosa forzaba la actualización.
const U = (v) => uniform(v).setGroup(renderGroup);

const RG = 6360; // km
const RT = 6460; // km
const H0 = 0.05; // altura del observador (km): 50 m sobre el mar

export const ATMOSPHERE_DEFAULTS = {
  rayleighScale: 1, // multiplica β_R (azul del cielo)
  mieScale: 1, // multiplica β_M (bruma blanca y halo)
  ozone: 1, // multiplica la absorción de ozono (cielos más saturados al atardecer)
  miePhaseG: 0.8,
  multiScattering: 1,
  sunIlluminance: 22, // escala de radiancia del cielo
};

const BETA_R = [5.802e-3, 13.558e-3, 33.1e-3];
const BETA_M_SCA = 3.996e-3;
const BETA_M_EXT = 4.4e-3;
const BETA_O = [0.65e-3, 1.881e-3, 0.085e-3];

/** Transmitancia desde el observador hacia el espacio para una altura del sol (CPU, 64 pasos). */
export function transmittance(altDeg, p = ATMOSPHERE_DEFAULTS, out = new THREE.Color()) {
  const el = (Math.max(altDeg, -2) * Math.PI) / 180;
  const ro = [0, RG + H0, 0];
  const rd = [Math.cos(el), Math.sin(el), 0];
  const b = ro[0] * rd[0] + ro[1] * rd[1];
  const c = ro[0] ** 2 + ro[1] ** 2 - RT * RT;
  const tMax = -b + Math.sqrt(Math.max(b * b - c, 0));
  const cg = ro[1] ** 2 - RG * RG;
  if (b < 0 && b * b - cg > 0 && -b - Math.sqrt(b * b - cg) > 0) return out.setRGB(0, 0, 0); // bajo el horizonte
  const N = 64;
  const dt = tMax / N;
  const od = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * dt;
    const h = Math.hypot(ro[0] + rd[0] * t, ro[1] + rd[1] * t) - RG;
    const r = Math.exp(-h / 8) * p.rayleighScale;
    const m = Math.exp(-h / 1.2) * p.mieScale;
    const o = Math.max(0, 1 - Math.abs(h - 25) / 15) * p.ozone;
    for (let k = 0; k < 3; k++) od[k] += (BETA_R[k] * r + BETA_M_EXT * m + BETA_O[k] * o) * dt;
  }
  return out.setRGB(Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2]));
}

export function createAtmosphere(renderer) {
  const params = { ...ATMOSPHERE_DEFAULTS };
  const u = {
    sunDir: U(new THREE.Vector3(0, 1, 0)),
    betaR: U(new THREE.Vector3(...BETA_R)),
    mieSca: U(BETA_M_SCA),
    mieExt: U(BETA_M_EXT),
    betaO: U(new THREE.Vector3(...BETA_O)),
    g: U(0.8),
    ms: U(1),
    sunE: U(22),
    brightness: U(1),
    sunDiscColor: U(new THREE.Color(1, 1, 1)),
    showSun: U(1),
    // 1 = bajo el horizonte se repite el color del horizonte (escenas con suelo finito, sin mar hasta el
    // horizonte); 0 = físico (el suelo del planeta, casi negro)
    horizonFill: U(1),
  };

  // ------------------------------------------------------------------ utilidades TSL
  const raySphereFar = (ro, rd, R) => {
    const b = dot(ro, rd);
    const c = dot(ro, ro).sub(R * R);
    return b.negate().add(sqrt(max(b.mul(b).sub(c), 0.0)));
  };
  const hitsGround = (ro, rd) => {
    const b = dot(ro, rd);
    const c = dot(ro, ro).sub(RG * RG);
    const disc = b.mul(b).sub(c);
    return disc.greaterThan(0.0).and(b.negate().sub(sqrt(max(disc, 0.0))).greaterThan(0.0));
  };
  const densities = (p) => {
    const h = p.length().sub(RG);
    return vec3(exp(h.div(-8.0)), exp(h.div(-1.2)), max(float(1.0).sub(abs(h.sub(25.0)).div(15.0)), 0.0));
  };
  const extinction = (d) => u.betaR.mul(d.x).add(vec3(u.mieExt).mul(d.y)).add(u.betaO.mul(d.z));

  // ------------------------------------------------------------------ LUT de cielo
  const lutFn = Fn(() => {
    const uvn = uv();
    const az = uvn.x.mul(Math.PI);
    const x = uvn.y.mul(2.0).sub(1.0);
    const el = sign(x).mul(x.mul(x)).mul(Math.PI / 2);
    const rd = vec3(cos(el).mul(cos(az)), sin(el), cos(el).mul(sin(az)));
    const sunEl = atan(u.sunDir.y, sqrt(u.sunDir.x.mul(u.sunDir.x).add(u.sunDir.z.mul(u.sunDir.z))));
    const sd = vec3(cos(sunEl), sin(sunEl), 0.0);
    const ro = vec3(0.0, RG + H0, 0.0);
    const tTop = raySphereFar(ro, rd, RT);
    const b = dot(ro, rd);
    const disc = b.mul(b).sub(dot(ro, ro).sub(RG * RG));
    const tGround = b.negate().sub(sqrt(max(disc, 0.0)));
    const tMax = select(hitsGround(ro, rd), tGround, tTop);
    const N = 32;
    const dt = tMax.div(N);
    const cosT = dot(rd, sd);
    const phaseR = float(3.0 / (16.0 * Math.PI)).mul(float(1.0).add(cosT.mul(cosT)));
    const g2 = u.g.mul(u.g);
    const phaseM = float(1.0).sub(g2).div(pow(float(1.0).add(g2).sub(u.g.mul(2.0).mul(cosT)), 1.5)).mul(1.0 / (4.0 * Math.PI));
    const L = vec3(0).toVar();
    const T = vec3(1).toVar();
    Loop({ start: int(0), end: int(N), type: 'int', condition: '<' }, ({ i }) => {
      const t = float(i).add(0.5).mul(dt);
      const p = ro.add(rd.mul(t));
      const d = densities(p);
      const ext = extinction(d);
      // transmitancia hacia el sol (6 pasos) y sombra del planeta
      const Tsun = vec3(0).toVar();
      If(hitsGround(p, sd).not(), () => {
        const ts = raySphereFar(p, sd, RT);
        const dts = ts.div(6.0);
        const od = vec3(0).toVar();
        Loop({ start: int(0), end: int(6), type: 'int', condition: '<' }, ({ i: j }) => {
          const ps = p.add(sd.mul(float(j).add(0.5).mul(dts)));
          od.addAssign(extinction(densities(ps)).mul(dts));
        });
        Tsun.assign(exp(od.negate()));
      });
      const scaR = u.betaR.mul(d.x);
      const scaM = vec3(u.mieSca).mul(d.y);
      const single = scaR.mul(phaseR).add(scaM.mul(phaseM)).mul(Tsun);
      // dispersión múltiple aproximada: isótropa, proporcional a la luz que llega a esa altura
      const multi = scaR.add(scaM).mul(Tsun.mul(0.4).add(0.03)).mul(u.ms).mul(1.0 / (4.0 * Math.PI));
      const stepT = exp(ext.mul(dt).negate());
      // integración analítica por tramo (energía conservada)
      const S = single.add(multi);
      L.addAssign(T.mul(S.sub(S.mul(stepT)).div(max(ext, vec3(1e-6)))));
      T.mulAssign(stepT);
    });
    return vec4(L.mul(u.sunE), 1.0);
  });

  const lutRT = new THREE.RenderTarget(256, 128, { type: THREE.HalfFloatType, depthBuffer: false });
  lutRT.texture.minFilter = lutRT.texture.magFilter = THREE.LinearFilter;
  lutRT.texture.wrapS = THREE.ClampToEdgeWrapping;
  const lutMat = new THREE.MeshBasicNodeMaterial();
  lutMat.fragmentNode = lutFn();
  const lutQuad = new THREE.QuadMesh(lutMat);

  /** Radiancia del cielo (LUT) en una dirección del mundo (nodo TSL). */
  const skyRadiance = (dir) => {
    const el = atan(dir.y, sqrt(dir.x.mul(dir.x).add(dir.z.mul(dir.z))));
    const viewAz = atan(dir.z, dir.x);
    const sunAz = atan(u.sunDir.z, u.sunDir.x);
    const dAz = abs(viewAz.sub(sunAz));
    const rel = min(dAz, float(2 * Math.PI).sub(dAz));
    const xv0 = sign(el).mul(sqrt(abs(el).div(Math.PI / 2)));
    const xv = mix(xv0, max(xv0, 0.0), u.horizonFill);
    const lutUV = vec2(rel.div(Math.PI), xv.mul(0.5).add(0.5));
    return texture(lutRT.texture, lutUV).rgb.mul(u.brightness);
  };

  // ------------------------------------------------------------------ cúpula de cielo
  function makeDome() {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    const color = Fn(() => {
      const dir = normalize(positionWorld.sub(cameraPosition));
      const sky = skyRadiance(dir);
      // disco solar (0,53°) con oscurecimiento al borde, atenuado por la atmósfera (color en CPU)
      const cosA = dot(dir, normalize(u.sunDir));
      const r = clamp(acos(clamp(cosA, -1.0, 1.0)).div(0.00465), 0.0, 1.0);
      const limb = float(1.0).sub(r.mul(r)).max(0.0).pow(0.4);
      const disc = smoothstep(1.0, 0.95, r).mul(limb).mul(u.showSun).mul(select(dir.y.greaterThan(-0.01), 1.0, 0.0));
      return sky.add(vec3(u.sunDiscColor).mul(disc).mul(60.0));
    });
    mat.colorNode = color();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
    mesh.scale.setScalar(990);
    mesh.frustumCulled = false;
    mesh.renderOrder = -2;
    return mesh;
  }

  const dome = makeDome();
  const envDome = makeDome(); // para el mapa de entorno (PMREM)
  // PMREMGenerator no actualiza la proyección de su cámara cúbica (far = 100): la cúpula del entorno
  // tiene que caber dentro; como solo cuenta la dirección de vista, el radio da igual
  envDome.scale.setScalar(50);
  let dirty = true;
  const lastSun = new THREE.Vector3(0, -2, 0);

  // ------------------------------------------------------------------ perspectiva aérea y niebla en capa (fogNode)
  // Para cada píxel, la atmósfera entre la cámara y la superficie:
  // - transmitancia por canal T = exp(−τ), con
  //     τ = (β_R·ρ_R + β_M·ρ_M) · d · fuerza   (perspectiva aérea: Rayleigh 8 km y Mie 1,2 km de escala de altura)
  //       + densidad · d · ρ_capa                (niebla en capa, gris)
  //   donde cada ρ es la densidad media a lo largo del rayo, integrada de forma analítica;
  // - luz dispersada hacia la cámara = radiancia del cielo en esa misma dirección (la LUT) · (1 − T): es la luz
  //   que trae el resto del rayo hasta el horizonte, así que lo lejano se funde con el cielo que tiene detrás,
  //   con el brillo hacia el sol y los colores del atardecer que ya calcula el cielo.
  // `fuerza` exagera la atmósfera real (a escala de unos km apenas se nota) para dar la bruma de un valle.
  // La capa de niebla tiene densidad constante entre la cota baja y la cota alta y se desvanece por encima y por
  // debajo con una exponencial de `fade` metros.
  const ap = {
    aerial: U(1), // 1 = perspectiva aérea activa
    strength: U(5),
    fogDensity: U(0), // 1/m dentro de la capa (0 = sin niebla)
    fogBottom: U(0), // cota baja (y)
    fogTop: U(10), // cota alta (y)
    fogFade: U(10), // m de transición por encima y por debajo
  };
  // media de exp(−y/H) a lo largo de un tramo de altura yc → yp
  const avgExp = (yc, yp, H) => {
    const ec = exp(clamp(yc.div(H).negate(), -60.0, 60.0));
    const ep = exp(clamp(yp.div(H).negate(), -60.0, 60.0));
    const dy = yp.sub(yc);
    return select(abs(dy).lessThan(0.01), ec, ec.sub(ep).mul(H).div(dy));
  };
  // densidad relativa de la capa y su integral desde la cota baja
  const layerRho = (y) => {
    const b = ap.fogBottom, t = ap.fogTop, f = ap.fogFade;
    return select(y.lessThan(b), exp(clamp(y.sub(b).div(f), -60.0, 0.0)),
      select(y.greaterThan(t), exp(clamp(y.sub(t).div(f).negate(), -60.0, 0.0)), float(1.0)));
  };
  const layerF = (y) => {
    const b = ap.fogBottom, t = ap.fogTop, f = ap.fogFade;
    const below = f.mul(exp(clamp(y.sub(b).div(f), -60.0, 0.0)).sub(1.0));
    const above = t.sub(b).add(f.mul(float(1.0).sub(exp(clamp(y.sub(t).div(f).negate(), -60.0, 0.0)))));
    return select(y.lessThan(b), below, select(y.greaterThan(t), above, y.sub(b)));
  };
  const aerialFog = Fn(() => {
    // desde la posición en espacio de vista (la misma que se proyecta): incluye instancias y desplazamientos
    // de vértices (viento)
    const toFrag = cameraWorldMatrix.mul(vec4(positionView, 0.0)).xyz.toVar();
    const d = toFrag.length().toVar();
    const dir = toFrag.div(max(d, 1e-4));
    const yc = cameraPosition.y;
    const yp = yc.add(toFrag.y);
    const rhoR = avgExp(yc, yp, float(8000.0));
    const rhoM = avgExp(yc, yp, float(1200.0));
    const tauAtm = u.betaR.mul(rhoR).add(vec3(u.mieExt).mul(rhoM)).mul(d.mul(0.001)).mul(ap.strength).mul(ap.aerial);
    const dy = yp.sub(yc);
    const rhoLayer = select(abs(dy).lessThan(0.01), layerRho(yc), layerF(yp).sub(layerF(yc)).div(dy));
    const tauFog = ap.fogDensity.mul(d).mul(rhoLayer);
    const T = exp(tauAtm.add(tauFog).negate());
    return vec4(output.rgb.mul(T).add(skyRadiance(dir).mul(vec3(1.0).sub(T))), output.a);
  });
  const fogNode = aerialFog();

  function apply() {
    u.betaR.value.set(...BETA_R).multiplyScalar(params.rayleighScale);
    u.mieSca.value = BETA_M_SCA * params.mieScale;
    u.mieExt.value = BETA_M_EXT * params.mieScale;
    u.betaO.value.set(...BETA_O).multiplyScalar(params.ozone);
    u.g.value = params.miePhaseG;
    u.ms.value = params.multiScattering;
    u.sunE.value = params.sunIlluminance;
    dirty = true;
  }
  apply();

  return {
    params,
    dome,
    envDome,
    uniforms: u,
    /** Uniformes de la perspectiva aérea y la niebla en capa: aerial, strength, fogDensity, fogBottom, fogTop, fogFade. */
    aerial: ap,
    /** Nodo para `scene.fogNode`: perspectiva aérea con la atmósfera del cielo. */
    fogNode,
    skyRadiance,
    lutTexture: lutRT.texture,
    apply,
    /** Actualiza el sol; recalcula la LUT si hace falta (devuelve true si la ha recalculado). */
    update(sunDir, brightness, sunDiscColor) {
      u.sunDir.value.copy(sunDir);
      u.brightness.value = brightness;
      u.sunDiscColor.value.copy(sunDiscColor);
      if (!dirty && sunDir.angleTo(lastSun) < 0.05 * THREE.MathUtils.DEG2RAD) return false;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(lutRT);
      lutQuad.render(renderer);
      renderer.setRenderTarget(prev);
      lastSun.copy(sunDir);
      dirty = false;
      return true;
    },
    transmittance: (altDeg, out) => transmittance(altDeg, params, out),
  };
}

import * as THREE from 'three/webgpu';
import { dot, float, max, mix, mx_noise_float, normalWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import { createAtmosphere } from './atmosphere.js';
import { createClouds } from './clouds.js';
import { directionFromAltAz, equatorialToWorld, moonIllumination, moonPosition, sunPosition, sunriseSunset } from './astro.js';

/**
 * VolumetricSky1: cielo físico con nubes volumétricas para cualquier escena Three.js (WebGPURenderer).
 * Sale del cielo del proyecto 26_903_Whale (Fases 3.1-3.5) convertido en módulo autocontenido.
 *
 * - Sol y luna por fecha, hora y lugar (astro.js), o sol manual por elevación y acimut.
 * - Atmósfera física de Hillaire (atmosphere.js): LUT de cielo + cúpula con disco solar.
 * - Nubes volumétricas con raymarching a resolución reducida y acumulación temporal (clouds.js).
 * - Estrellas orientadas con el tiempo sidéreo y luna con su fase.
 * - Opcional: color, fuerza y dirección de una DirectionalLight (el sol) y de una HemisphereLight,
 *   mapa de entorno PMREM con el cielo y las nubes, y perspectiva aérea (`scene.fogNode`): la escena se funde con
 *   el cielo con la misma atmósfera que lo pinta, más una bruma baja opcional.
 *
 * Uso mínimo (ver README.md):
 *   const sky = await createVolumetricSky1({ renderer, scene, camera, sun, hemi });
 *   // en cada fotograma, antes de renderer.render(scene, camera):
 *   sky.update(dt);
 */

export const PLACES = {
  'Austria (Viena)': { lat: 48.21, lon: 16.37, tz: 2 },
  'Madrid': { lat: 40.42, lon: -3.70, tz: 2 },
  'Londres': { lat: 51.51, lon: -0.13, tz: 1 },
  'Islandia (Reikiavik)': { lat: 64.15, lon: -21.94, tz: 0 },
  'Tonga (Vava\'u)': { lat: -18.65, lon: -173.98, tz: 13 },
  'Personalizado': null,
};

export const SUN_MODES = ['Manual', 'Fecha, hora y lugar'];

/** Valores por defecto de `state`; cualquiera se puede cambiar con `settings` al crear el cielo. */
export const SKY_DEFAULTS = {
  enabled: true,
  sunMode: 'Fecha, hora y lugar',
  // sol manual
  sunElevation: 35, // grados sobre el horizonte
  sunAzimuth: 300, // grados desde el norte (−Z) hacia el este (+X)
  // sol astronómico
  place: 'Austria (Viena)',
  lat: 48.21,
  lon: 16.37,
  tz: 2,
  date: '2026-09-28',
  hour: 16.5, // hora local decimal
  animate: false,
  timeSpeed: 120, // 120 = 2 min simulados por segundo
  // atmósfera
  turbidity: 2.5,
  rayleigh: 1.2,
  ozone: 1,
  multiScattering: 1,
  mieDirectionalG: 0.8,
  skyBrightness: 1,
  horizonFill: true, // bajo el horizonte, el color del horizonte (si no, el suelo del planeta, casi negro)
  // luz de la escena
  sunStrength: 3.2,
  ambientStrength: 0.55,
  moonStrength: 0.35,
  environmentIntensity: 1,
  stars: 1,
  cloudLight: 1, // brillo de las nubes respecto al cielo
  // perspectiva aérea (fogNode de la escena)
  aerial: true,
  aerialStrength: 5, // multiplica la atmósfera real (a escala de un valle apenas se notaría)
  hazeDensity: 0, // bruma baja: densidad (1/m) en hazeBase; 0 = sin bruma
  hazeBase: 0, // altura (y) de referencia de la bruma, p. ej. la cota del agua
  hazeFalloff: 50, // m: la bruma se divide por e cada hazeFalloff metros de subida
  // lecturas (las rellena update)
  sunAltAz: '',
  moonInfo: '',
  sunTimes: '',
  localTime: '',
};

const DEG = Math.PI / 180;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * @param {object} o
 * @param {THREE.WebGPURenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera
 * @param {THREE.DirectionalLight} [o.sun] sol de la escena: el cielo pone su color, fuerza y dirección
 *   (la posición se mueve alrededor de `sun.target`, a la distancia que ya tenía: las sombras no cambian de encuadre)
 * @param {THREE.HemisphereLight} [o.hemi] luz ambiente: el cielo pone su color y fuerza
 * @param {boolean} [o.environment=true] genera `scene.environment` (PMREM) con el cielo y las nubes
 * @param {boolean} [o.fog=true] pone la perspectiva aérea del cielo como `scene.fogNode`; con `false` la niebla
 *   de la escena no se toca (el nodo queda en `sky.fogNode` para combinarlo a mano)
 * @param {object} [o.settings] valores iniciales del cielo (claves de SKY_DEFAULTS)
 * @param {object} [o.cloudSettings] valores iniciales de las nubes (claves de `sky.clouds.state`)
 * @param {object} [o.places] lista de lugares { nombre: { lat, lon, tz } | null }
 */
export async function createVolumetricSky1({
  renderer, scene, camera, sun = null, hemi = null, environment = true, fog = true,
  settings = {}, cloudSettings = {}, places = PLACES,
}) {
  const state = { ...SKY_DEFAULTS, ...settings };
  const clouds = await createClouds(renderer, scene, cloudSettings);
  const group = new THREE.Group(); // todo lo que el cielo añade a la escena (menos la cúpula de las nubes)
  group.name = 'VolumetricSky1';
  scene.add(group);

  // ------------------------------------------------------------------ atmósfera
  const atm = createAtmosphere(renderer);
  group.add(atm.dome);
  let atmKey = '';

  // ------------------------------------------------------------------ estrellas (procedurales, en coordenadas ecuatoriales, radio 1)
  const STARS = 6000;
  const pos = new Float32Array(STARS * 3);
  const col = new Float32Array(STARS * 3);
  const rnd = (() => { let s = 12345; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < STARS; i++) {
    const zc = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - zc * zc);
    pos.set([r * Math.cos(a), r * Math.sin(a), zc], i * 3);
    const mag = rnd() ** 6; // pocas brillantes, muchas débiles
    const temp = rnd();
    const c = temp < 0.2 ? [1, 0.8, 0.65] : temp > 0.85 ? [0.7, 0.8, 1] : [1, 1, 0.95];
    const b = 0.25 + mag * 4;
    col.set(c.map((x) => x * b), i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const starUniform = uniform(1);
  const starMat = new THREE.PointsNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false });
  starMat.opacityNode = starUniform;
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.matrixAutoUpdate = false;
  stars.renderOrder = -1;
  group.add(stars);

  // ------------------------------------------------------------------ luna (su fase sale de la luz del sol sobre la esfera)
  const moonSunDir = uniform(new THREE.Vector3(0, 1, 0));
  const moonGain = uniform(1);
  const moonMat = new THREE.MeshBasicNodeMaterial({ fog: false, depthWrite: false, transparent: true });
  const maria = mx_noise_float(normalWorld.mul(3.0)).mul(0.5).add(0.5);
  const albedo = mix(float(0.55), float(0.85), smoothstep(0.35, 0.65, maria));
  const lit = max(dot(normalWorld, moonSunDir), 0.0);
  moonMat.colorNode = vec3(1.0, 0.98, 0.94).mul(albedo).mul(lit.add(0.015)).mul(moonGain).mul(3.0);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), moonMat);
  moon.frustumCulled = false;
  moon.renderOrder = -1;
  group.add(moon);

  const moonLight = new THREE.DirectionalLight(0xbfd2ff, 0);
  group.add(moonLight, moonLight.target);

  // ------------------------------------------------------------------ entorno (PMREM) con cielo y nubes
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(atm.envDome, clouds.envMesh);
  let envRT = null;
  const lastEnvSun = new THREE.Vector3(0, -2, 0);
  let lastEnvTime = -1;
  let envPending = true;
  const fallbackEnv = scene.environment;
  const fallbackEnvIntensity = scene.environmentIntensity;
  const fallbackFogNode = scene.fogNode;
  if (fog) scene.fogNode = atm.fogNode;
  const fallbackBackground = scene.background;
  const sunDistance = sun ? sun.position.distanceTo(sun.target.position) || 100 : 100;

  // ------------------------------------------------------------------ cálculo
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const sunColor = new THREE.Color();
  const tmpColor = new THREE.Color();
  let clockTime = 0;

  function currentDate() {
    const [y, m, d] = state.date.split('-').map(Number);
    const ms = Date.UTC(y, (m || 1) - 1, d || 1) + (state.hour - state.tz) * 3600000;
    return new Date(ms);
  }

  const info = { sunAlt: 0, sunAz: 0, moonAlt: 0, moonFraction: 0, dayFactor: 1 };
  // luz para las nubes: color del sol (transmitancia), su fuerza y el color ambiente del cielo
  const light = { dir: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(), sunIntensity: 0, ambient: new THREE.Color() };
  const moonTint = new THREE.Color(0.75, 0.82, 1.0);
  const ambientDay = new THREE.Color(0.42, 0.55, 0.75);
  const ambientNight = new THREE.Color(0.012, 0.016, 0.03);
  const rot = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();

  /** Radio de las cúpulas: detrás de todo lo opaco y dentro del far de la cámara. */
  const domeRadius = () => Math.min(camera.far * 0.9, 50000);

  function update(simDt = 0) {
    if (state.animate && simDt > 0 && state.sunMode !== 'Manual') {
      state.hour += (simDt * state.timeSpeed) / 3600;
      while (state.hour >= 24) {
        state.hour -= 24;
        const dt = new Date(`${state.date}T00:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() + 1);
        state.date = dt.toISOString().slice(0, 10);
      }
    }
    clockTime += simDt;
    const date = currentDate();
    const manual = state.sunMode === 'Manual';
    const s = manual ? { altitude: state.sunElevation, azimuth: state.sunAzimuth } : sunPosition(date, state.lat, state.lon);
    const m = moonPosition(date, state.lat, state.lon);
    const ill = moonIllumination(date);
    info.sunAlt = s.altitude; info.sunAz = s.azimuth; info.moonAlt = m.altitude; info.moonFraction = ill.fraction;
    directionFromAltAz(s.altitude, s.azimuth, sunDir);
    directionFromAltAz(m.altitude, m.azimuth, moonDir);
    const R = domeRadius();

    // atmósfera: rayleigh → β_R, turbidez → β_M, direccionalidad Mie → g
    const key = [state.rayleigh, state.turbidity, state.mieDirectionalG, state.ozone, state.multiScattering].join('|');
    if (key !== atmKey) {
      Object.assign(atm.params, {
        rayleighScale: state.rayleigh, mieScale: state.turbidity / 2.5, miePhaseG: state.mieDirectionalG,
        ozone: state.ozone, multiScattering: state.multiScattering,
      });
      atm.apply();
      atmKey = key;
    }
    atm.uniforms.horizonFill.value = state.horizonFill ? 1 : 0;
    atm.dome.position.copy(camera.position);
    atm.dome.scale.setScalar(R * 1.05);

    // noche: estrellas y luna (con el sol manual, la luna sigue la fecha y hora del panel)
    const night = 1 - smooth(-12, 0, s.altitude); // 1 = noche cerrada (sol < −12°)
    info.dayFactor = smooth(-6, 10, s.altitude);
    starUniform.value = state.stars * night;
    const m3 = equatorialToWorld(date, state.lat, state.lon);
    rot.set(m3[0], m3[1], m3[2], 0, m3[3], m3[4], m3[5], 0, m3[6], m3[7], m3[8], 0, 0, 0, 0, 1);
    stars.matrix.makeTranslation(camera.position.x, camera.position.y, camera.position.z).multiply(rot).scale(tmpV.setScalar(R));
    stars.matrixWorldNeedsUpdate = true;
    stars.visible = state.enabled && starUniform.value > 0.01;
    moon.position.copy(camera.position).addScaledVector(moonDir, R);
    moon.scale.setScalar(R * Math.tan(0.26 * DEG) * 1.6); // algo mayor que el real (0,52°) para que se lea
    moonSunDir.value.copy(sunDir);
    moonGain.value = 0.25 + 0.75 * night;
    moon.visible = state.enabled && m.altitude > -2;

    // luz del sol: color por transmitancia y fuerza por altura (se apaga bajo el horizonte)
    atm.transmittance(Math.max(s.altitude, -1), sunColor);
    const sunUp = smooth(-1.5, 4, s.altitude);
    if (state.enabled && atm.update(sunDir, state.skyBrightness, sunColor)) {
      lastEnvSun.set(0, -2, 0); // LUT nueva: rehacer también el entorno
    }
    if (s.altitude > -4 || m.altitude < 0) {
      light.dir.copy(sunDir);
      light.sunColor.copy(sunColor);
      light.sunIntensity = state.cloudLight * sunUp;
    } else {
      // de noche la "luz directa" de las nubes es la luna (muy débil y azulada)
      light.dir.copy(moonDir);
      light.sunColor.copy(moonTint);
      light.sunIntensity = state.cloudLight * state.moonStrength * 0.12 * ill.fraction * smooth(-2, 15, m.altitude);
    }
    light.ambient.copy(ambientNight).lerp(ambientDay, info.dayFactor).multiplyScalar(state.cloudLight * 0.9)
      .lerp(tmpColor.copy(sunColor).multiplyScalar(0.5 * state.cloudLight), smooth(20, 0, s.altitude) * info.dayFactor * 0.5);

    // perspectiva aérea
    const ap = atm.aerial;
    ap.enabled.value = state.enabled && state.aerial ? 1 : 0;
    ap.strength.value = state.aerialStrength;
    ap.hazeDensity.value = state.hazeDensity;
    ap.hazeBase.value = state.hazeBase;
    ap.hazeFalloff.value = Math.max(state.hazeFalloff, 0.1);

    if (state.enabled) {
      if (sun) {
        sun.color.copy(sunColor);
        sun.intensity = state.sunStrength * sunUp * (0.35 + 0.65 * smooth(0, 25, s.altitude));
        sun.position.copy(sun.target.position).addScaledVector(sunDir, sunDistance);
      }
      const md = tmpV.copy(moonDir);
      md.y = Math.max(md.y, 0);
      moonLight.position.copy(md).multiplyScalar(60);
      moonLight.intensity = state.moonStrength * ill.fraction * smooth(-2, 10, m.altitude) * night;
      if (hemi) {
        hemi.intensity = state.ambientStrength * (0.08 + 0.92 * info.dayFactor);
        hemi.color.setRGB(0.55 + 0.25 * sunColor.r, 0.65 + 0.2 * sunColor.g, 0.85 + 0.1 * sunColor.b);
      }
      scene.background = null;
      if (environment) scene.environmentIntensity = state.environmentIntensity;
    }
    atm.dome.visible = state.enabled;
    moonLight.visible = state.enabled;

    // entorno: se regenera si el sol se ha movido o cada cierto tiempo si avanza la hora
    if (state.enabled && environment && (sunDir.angleTo(lastEnvSun) > 0.5 * DEG || (state.animate && clockTime - lastEnvTime > 2))) {
      envPending = true;
    }

    // lecturas
    const hh = Math.floor(state.hour), mm = Math.floor((state.hour - hh) * 60);
    state.localTime = `${state.date} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (UTC${state.tz >= 0 ? '+' : ''}${state.tz})`;
    state.sunAltAz = `alt ${s.altitude.toFixed(1)}° · az ${s.azimuth.toFixed(0)}°`;
    state.moonInfo = `${ill.name} ${(ill.fraction * 100).toFixed(0)} % · alt ${m.altitude.toFixed(0)}°`;
  }

  let lastDay = '';
  function updateSunTimes() {
    const k = `${state.date}|${state.lat}|${state.lon}|${state.tz}`;
    if (k === lastDay) return;
    lastDay = k;
    const [y, mo, d] = state.date.split('-').map(Number);
    const t = sunriseSunset(Date.UTC(y, mo - 1, d) - state.tz * 3600000, state.lat, state.lon);
    const fmt = (h) => (h === null ? '—' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`);
    state.sunTimes = `sale ${fmt(t.rise)} · se pone ${fmt(t.set)}`;
  }

  function renderEnv() {
    if (!envPending || !state.enabled || !environment) return;
    envPending = false;
    const rt = pmrem.fromScene(envScene, 0, 0.1, 5000);
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    lastEnvSun.copy(sunDir);
    lastEnvTime = clockTime;
  }

  /** Aplica `state` (llamar después de cambiar valores a mano o desde un panel). */
  function apply() {
    const p = places[state.place];
    if (p) { state.lat = p.lat; state.lon = p.lon; state.tz = p.tz; }
    group.visible = state.enabled;
    if (!state.enabled) {
      scene.environment = fallbackEnv;
      scene.environmentIntensity = fallbackEnvIntensity;
      scene.background = fallbackBackground;
      atm.aerial.enabled.value = 0;
      moonLight.intensity = 0;
    } else {
      lastEnvSun.set(0, -2, 0); // fuerza regenerar el entorno
    }
    applyClouds();
    updateSunTimes();
    update(0);
  }
  function applyClouds() {
    clouds.apply();
    clouds.composite.visible = state.enabled && clouds.state.enabled;
    lastEnvSun.set(0, -2, 0);
  }
  apply();

  return {
    state,
    info,
    light,
    clouds,
    atmosphere: atm,
    sunDirection: sunDir,
    sunColor,
    /** Nodo de la perspectiva aérea (el que se pone en `scene.fogNode` con `fog: true`). */
    fogNode: atm.fogNode,
    places: Object.keys(places),
    sunModes: SUN_MODES,
    apply,
    /** Aplica los cambios de las nubes (`sky.clouds.state`) y rehace el entorno. */
    applyClouds,
    /** Fuerza regenerar el mapa de entorno. */
    invalidateEnv() { lastEnvSun.set(0, -2, 0); },
    /**
     * Un fotograma: sol, luna, luz, nubes y entorno, y el pase previo de las nubes.
     * Llamar en cada fotograma ANTES de renderer.render(scene, camera), con la cámara ya actualizada.
     * @param {number} dt segundos desde el fotograma anterior (mueve el viento y, si `animate`, la hora)
     */
    update(dt = 0) {
      if (!state.enabled) return;
      updateSunTimes();
      update(dt);
      clouds.setRadius(domeRadius());
      clouds.update(dt, camera, light.dir, light.sunColor, light.sunIntensity, light.ambient);
      clouds.changing = state.animate && state.sunMode !== 'Manual' && dt > 0; // con la hora avanzando, sin historial
      renderEnv();
      clouds.render(camera);
    },
    /** Saca el cielo de la escena y libera sus recursos. */
    dispose() {
      group.removeFromParent();
      clouds.dispose();
      envRT?.dispose();
      pmrem.dispose();
      scene.environment = fallbackEnv;
      scene.environmentIntensity = fallbackEnvIntensity;
      scene.background = fallbackBackground;
      if (fog) scene.fogNode = fallbackFogNode;
    },
  };
}

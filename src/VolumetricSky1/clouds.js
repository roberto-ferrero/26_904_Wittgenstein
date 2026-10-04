import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, cameraPosition, clamp, dot, exp, float, fract, int, max, min, mix, normalize, positionWorld,
  renderGroup, screenCoordinate, screenUV, select, sin, smoothstep, texture, texture3D, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

/**
 * Nubes volumétricas de VolumetricSky1 (origen: proyecto 26_903_Whale, Fase 3.4): raymarching en una
 * capa horizontal [base, base + grosor].
 *
 * Forma y detalle salen de texturas precalculadas y tileables (`tools/gen-noise.mjs`):
 * un volumen 64³ Perlin-Worley (R = forma, G = detalle para erosionar bordes) y un mapa de clima
 * 256² (R = cobertura, G = tipo). Perfil vertical de cúmulo ↔ estrato. Luz: marcha corta hacia el
 * sol (Beer-Lambert + aproximación de dispersión múltiple), efecto "powder", fase Henyey-Greenstein
 * de dos lóbulos y ambiente del cielo. Se mueve con el viento según el reloj de simulación.
 *
 * Rendimiento: se renderizan a resolución reducida (½ por defecto) en su propio render target,
 * con desplazamiento aleatorio por fotograma y **acumulación temporal** cuando la cámara está quieta;
 * después se componen sobre el cielo con una cúpula que respeta la profundidad de la escena.
 * `cloudShadowNode()` da la sombra de las nubes sobre el suelo (nodo TSL para los materiales).
 *
 * Las texturas viajan con el módulo (carpeta `textures/`): `new URL(…, import.meta.url)` hace que Vite
 * (u otro bundler) las copie al build sin tocar `public/`.
 */
// Uniformes compartidos por varios materiales (la perspectiva aérea está en todos los de la escena): en el grupo
// `renderGroup` se suben una vez por render. En el grupo por defecto (por objeto) un cambio no llegaba a todos los
// materiales y la escena se veía con valores mezclados hasta que otra cosa forzaba la actualización.
const U = (v) => uniform(v).setGroup(renderGroup);

const NOISE_URL = new URL('./textures/cloud_noise_64.bin', import.meta.url);
const WEATHER_URL = new URL('./textures/cloud_weather_256.bin', import.meta.url);

/**
 * Morfologías de nubes: valores de cobertura, densidad, tipo (0 cúmulo, 1 estrato), base y grosor (m) y tamaño
 * de las formaciones. Se aplican con `sky.setCloudMorphology(nombre)` o desde el panel.
 */
export const CLOUD_MORPHOLOGIES = {
  'Cúmulos (por defecto)': { coverage: 0.45, density: 0.02, type: 0.15, base: 1500, thickness: 1400, scale: 1 },
  'Cúmulos de buen tiempo': { coverage: 0.3, density: 0.018, type: 0.1, base: 1300, thickness: 900, scale: 0.8 },
  'Cúmulos de desarrollo': { coverage: 0.55, density: 0.04, type: 0.05, base: 1200, thickness: 2800, scale: 1.4 },
  'Cumulonimbos (tormenta)': { coverage: 0.6, density: 0.08, type: 0, base: 900, thickness: 4000, scale: 2.2 },
  'Estratocúmulos': { coverage: 0.7, density: 0.03, type: 0.55, base: 1000, thickness: 800, scale: 1.6 },
  'Estratos (cielo gris)': { coverage: 1, density: 0.06, type: 1, base: 600, thickness: 1000, scale: 2.5 },
  'Altocúmulos (aborregado)': { coverage: 0.5, density: 0.02, type: 0.4, base: 4000, thickness: 600, scale: 0.4 },
  'Despejado': { coverage: 0 },
};

export async function createClouds(renderer, scene, settings = {}) {
  const [noiseBuf, weatherBuf] = await Promise.all([
    fetch(NOISE_URL).then((r) => r.arrayBuffer()),
    fetch(WEATHER_URL).then((r) => r.arrayBuffer()),
  ]);
  const noiseTex = new THREE.Data3DTexture(new Uint8Array(noiseBuf), 64, 64, 64);
  noiseTex.format = THREE.RGFormat;
  noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = THREE.RepeatWrapping;
  noiseTex.unpackAlignment = 1;
  noiseTex.needsUpdate = true;
  const weatherTex = new THREE.DataTexture(new Uint8Array(weatherBuf), 256, 256, THREE.RGFormat);
  weatherTex.minFilter = weatherTex.magFilter = THREE.LinearFilter;
  weatherTex.wrapS = weatherTex.wrapT = THREE.RepeatWrapping;
  weatherTex.unpackAlignment = 1;
  weatherTex.needsUpdate = true;

  const state = {
    enabled: true,
    morphology: 'Cúmulos (por defecto)', // nombre de CLOUD_MORPHOLOGIES, o 'Personalizada'
    coverage: 0.45, // 0 = despejado, 1 = cubierto
    density: 0.02, // coeficiente de extinción (1/m) en lo más denso
    base: 1500, // altitud de la base (m)
    thickness: 1400, // m
    type: 0.15, // 0 = cúmulo, 1 = estrato
    windSpeed: 12, // m/s
    windDirection: 60, // grados desde el norte hacia donde sopla
    scale: 1, // tamaño de las formaciones
    steps: 40, // pasos de la marcha principal
    lightSteps: 4,
    maxDistance: 30000, // m
    resolution: 0.5, // fracción de la resolución de pantalla
    temporal: true, // acumulación temporal con la cámara quieta
    shadows: 0.75, // intensidad de las sombras sobre el suelo (cloudShadowNode)
    ...settings,
  };

  const u = {
    coverage: U(state.coverage),
    density: U(state.density),
    base: U(state.base),
    top: U(state.base + state.thickness),
    type: U(state.type),
    wind: U(new THREE.Vector3()),
    shapeFreq: U(1 / 9000),
    weatherFreq: U(1 / 60000),
    steps: U(state.steps),
    lightSteps: U(state.lightSteps),
    maxDistance: U(state.maxDistance),
    sunDir: U(new THREE.Vector3(0, 1, 0)),
    sunColor: U(new THREE.Color(1, 1, 1)),
    ambient: U(new THREE.Color(0.5, 0.6, 0.75)),
    shadows: U(state.shadows),
    frame: U(0),
  };
  const windOffset = new THREE.Vector3();

  // ------------------------------------------------------------------ densidad
  const heightFraction = (p) => clamp(p.y.sub(u.base).div(u.top.sub(u.base)), 0, 1);
  const remap = (v, a, b) => clamp(v.sub(a).div(max(b.sub(a), 1e-3)), 0, 1);

  const densityAt = Fn(([p, detail]) => {
    const h = heightFraction(p);
    const wp = p.add(u.wind);
    const w = texture(weatherTex, vec2(wp.x, wp.z).mul(u.weatherFreq));
    const cov = clamp(u.coverage.add(w.r.sub(0.4).mul(0.9)), 0.0, 1.0);
    const type = clamp(u.type.add(w.g.sub(0.5).mul(0.4)), 0.0, 1.0);
    const cumulus = smoothstep(0.0, 0.07, h).mul(smoothstep(1.0, 0.5, h));
    const stratus = smoothstep(0.0, 0.08, h).mul(smoothstep(0.35, 0.12, h));
    const profile = mix(cumulus, stratus, type);
    const n = texture3D(noiseTex, wp.mul(u.shapeFreq).mul(vec3(1.0, 2.0, 1.0)));
    // umbral de cobertura según la distribución real del canal de forma (0,29-0,95, media 0,67);
    // el perfil vertical se aplica después del corte para que las formaciones tengan cuerpo
    const threshold = mix(float(0.9), float(0.45), cov);
    const shape = remap(n.r, threshold, float(1.0)).mul(profile);
    // erosión de los bordes con el canal de detalle (solo en la marcha principal)
    const d = texture3D(noiseTex, wp.mul(u.shapeFreq).mul(5.0)).g;
    const eroded = remap(shape, d.mul(0.3).mul(detail), float(1.0));
    return eroded;
  });

  const hg = (cosT, g) => {
    const g2 = g * g;
    return float(1 - g2).div(float(1 + g2).sub(cosT.mul(2 * g)).pow(1.5)).mul(1 / (4 * Math.PI));
  };

  // ------------------------------------------------------------------ marcha de rayos
  const march = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(cameraPosition));
    const outColor = vec3(0).toVar();
    const alpha = float(0).toVar();
    If(rd.y.greaterThan(0.015), () => {
      const t0 = max(u.base.sub(ro.y).div(rd.y), 0.0);
      const t1 = min(u.top.sub(ro.y).div(rd.y), u.maxDistance);
      If(t1.greaterThan(t0), () => {
        const stepLen = t1.sub(t0).div(u.steps);
        const jitter = fract(sin(dot(screenCoordinate.xy.add(u.frame.mul(17.13)), vec2(12.9898, 78.233))).mul(43758.5453));
        const t = t0.add(stepLen.mul(jitter)).toVar();
        const trans = float(1).toVar();
        const light = vec3(0).toVar();
        const cosT = dot(rd, u.sunDir);
        const phase = mix(hg(cosT, 0.65), hg(cosT, -0.25), 0.35).mul(4 * Math.PI);
        const lightStep = u.top.sub(u.base).div(u.lightSteps).mul(0.5);
        Loop({ start: int(0), end: int(u.steps), type: 'int', condition: '<' }, () => {
          const p = ro.add(rd.mul(t));
          const d = densityAt(p, float(1.0)).mul(u.density);
          If(d.greaterThan(1e-5), () => {
            const od = float(0).toVar();
            Loop({ start: int(0), end: int(u.lightSteps), type: 'int', condition: '<' }, ({ i }) => {
              const lp = p.add(u.sunDir.mul(lightStep.mul(float(i).add(0.5))));
              od.addAssign(densityAt(lp, float(0.0)).mul(u.density).mul(lightStep));
            });
            // dispersión múltiple aproximada (octavas de Wrenninge): cada octava con menos extinción
            // y una fase más isótropa; es lo que da el blanco brillante del interior de un cúmulo
            const sunT = exp(od.negate()).mul(phase)
              .add(exp(od.mul(-0.3)).mul(0.5).mul(mix(phase, float(1.0), 0.5)))
              .add(exp(od.mul(-0.09)).mul(0.25));
            const powder = float(1.0).sub(exp(d.mul(stepLen).mul(-2.0))).mul(0.5).add(0.5);
            const h = heightFraction(p);
            const S = vec3(u.sunColor).mul(sunT).mul(powder).add(vec3(u.ambient).mul(h.mul(0.6).add(0.4)));
            const dT = exp(d.mul(stepLen).negate());
            light.addAssign(S.mul(trans).mul(float(1.0).sub(dT)));
            trans.mulAssign(dT);
          });
          t.addAssign(stepLen);
          If(trans.lessThan(0.02), () => { Break(); });
        });
        const fade = exp(t0.mul(-1.0 / 22000)); // perspectiva aérea
        alpha.assign(float(1.0).sub(trans).mul(fade));
        outColor.assign(light.mul(fade).div(max(alpha, 1e-4)));
      });
    });
    return vec4(outColor, alpha);
  });

  function marchMesh(radius) {
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, fog: false });
    const r = march();
    mat.colorNode = r.rgb;
    mat.opacityNode = r.a;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    mesh.scale.setScalar(radius);
    mesh.frustumCulled = false;
    return mesh;
  }

  // pase de nubes a resolución reducida
  const cloudScene = new THREE.Scene();
  const marchDome = marchMesh(900);
  cloudScene.add(marchDome);
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false };
  const rtCurrent = new THREE.RenderTarget(1, 1, rtOpts);
  const rtAccum = [new THREE.RenderTarget(1, 1, rtOpts), new THREE.RenderTarget(1, 1, rtOpts)];
  let ping = 0;

  // acumulación temporal con reproyección: cada píxel busca en el historial dónde estaba esa misma
  // dirección de vista en el fotograma anterior (las nubes están lejos: basta la rotación de la cámara)
  const blend = uniform(1);
  const reproj = {
    invProj: uniform(new THREE.Matrix4()),
    camRot: uniform(new THREE.Matrix4()),
    prevViewRot: uniform(new THREE.Matrix4()),
    prevProj: uniform(new THREE.Matrix4()),
    // en WebGPU la v de textura crece hacia abajo: con −1 el error de la reproyección es 8 veces menor
    // que sin reproyectar (0,018 frente a 0,146 de diferencia media de alfa, giro de 2°; medido en el navegador)
    ySign: uniform(-1),
  };
  const curTex = texture(rtCurrent.texture, uv());
  // nodo del historial: se crea fuera (el cuerpo de Fn se evalúa al compilar) y se le cambia la textura cada fotograma
  const histReproj = texture(rtAccum[1].texture);
  const blendFn = Fn(() => {
    const q = uv();
    const ndc = vec2(q.x.mul(2.0).sub(1.0), q.y.mul(2.0).sub(1.0).mul(reproj.ySign));
    const vv = reproj.invProj.mul(vec4(ndc, 1.0, 1.0));
    const dirView = vv.xyz.div(vv.w);
    const dirWorld = reproj.camRot.mul(vec4(dirView, 0.0)).xyz;
    const pv = reproj.prevViewRot.mul(vec4(dirWorld, 0.0)).xyz;
    const pc = reproj.prevProj.mul(vec4(pv, 1.0));
    const pndc = pc.xy.div(pc.w);
    const puv = vec2(pndc.x.mul(0.5).add(0.5), pndc.y.mul(reproj.ySign).mul(0.5).add(0.5));
    const inside = pc.w.greaterThan(0.0).and(puv.x.greaterThanEqual(0.0)).and(puv.x.lessThanEqual(1.0))
      .and(puv.y.greaterThanEqual(0.0)).and(puv.y.lessThanEqual(1.0));
    histReproj.uvNode = puv;
    return mix(histReproj, curTex, select(inside, blend, float(1.0)));
  });
  const blendMat = new THREE.MeshBasicNodeMaterial();
  const blendNode = blendFn();
  blendMat.fragmentNode = blendNode;
  const quad = new THREE.QuadMesh(blendMat);

  // composición sobre la escena: cúpula que lee el resultado en coordenadas de pantalla
  const outTex = texture(rtAccum[0].texture, screenUV);
  const compMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
  compMat.colorNode = outTex.rgb.div(max(outTex.a, 1e-4));
  compMat.opacityNode = outTex.a;
  const composite = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), compMat);
  composite.scale.setScalar(900);
  composite.frustumCulled = false;
  composite.renderOrder = 1;
  scene.add(composite);

  const envMesh = marchMesh(50); // para el mapa de entorno (PMREM), sin reducción; radio < far (100) de la cámara cúbica
  envMesh.material.depthTest = true;

  /** Sombra de las nubes en un punto del mundo (0 = sombra total, 1 = sin sombra): nodo TSL. */
  const cloudShadowNode = Fn(([pWorld]) => {
    const mid = u.base.add(u.top.sub(u.base).mul(0.3));
    const sunY = max(u.sunDir.y, 0.05);
    const hit = pWorld.add(u.sunDir.mul(mid.sub(pWorld.y).div(sunY)));
    const d = densityAt(hit, float(0.0)).mul(u.density).mul(u.top.sub(u.base)).mul(0.5);
    return mix(float(1.0), exp(d.negate()), u.shadows);
  });

  function apply() {
    resetHistory = true;
    u.coverage.value = state.enabled ? state.coverage : 0;
    u.density.value = state.density;
    u.base.value = state.base;
    u.top.value = state.base + state.thickness;
    u.type.value = state.type;
    u.shapeFreq.value = 1 / (9000 * state.scale);
    u.weatherFreq.value = 1 / (60000 * state.scale);
    u.steps.value = state.steps;
    u.lightSteps.value = state.lightSteps;
    u.maxDistance.value = state.maxDistance;
    u.shadows.value = state.enabled ? state.shadows : 0;
    composite.visible = envMesh.visible = state.enabled;
    lastCam.makeScale(0, 0, 0); // fuerza un fotograma sin historial
  }

  const size = new THREE.Vector2();
  const lastCam = new THREE.Matrix4();
  const lastProj = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  const lastPos = new THREE.Vector3();
  const clearColor = new THREE.Color();
  let frame = 0;
  let simMoved = false;
  let resetHistory = true; // la luz o los parámetros han cambiado: el historial ya no vale
  const lastLight = new THREE.Vector4(0, -9, 0, 0);
  const lightNow = new THREE.Vector4();
  apply();

  return {
    state,
    envMesh,
    /** Orientación del escenario (° del norte al que apunta −Z): la pone VolumetricSky1. */
    orientation: 0,
    composite,
    /** Radio de las cúpulas (m): tiene que quedar detrás de todo lo opaco y dentro del far de la cámara. */
    setRadius(r) {
      marchDome.scale.setScalar(r);
      composite.scale.setScalar(r);
    },
    dispose() {
      composite.removeFromParent();
      for (const o of [rtCurrent, ...rtAccum, noiseTex, weatherTex]) o.dispose();
    },
    uniforms: u,
    reprojection: reproj,
    /** Solo para pruebas: render targets de la acumulación. */
    get targets() { return { current: rtCurrent, accum: rtAccum, ping }; },
    apply,
    cloudShadowNode,
    /** @param simDt tiempo simulado; dirección, color y fuerza de la luz principal y color ambiente */
    update(simDt, camera, lightDir, lightColor, lightIntensity, ambientColor) {
      const a = THREE.MathUtils.degToRad(state.windDirection - this.orientation); // geográfico → escena
      windOffset.x -= Math.sin(a) * state.windSpeed * simDt;
      windOffset.z += Math.cos(a) * state.windSpeed * simDt;
      u.wind.value.copy(windOffset);
      u.sunDir.value.copy(lightDir);
      u.sunColor.value.copy(lightColor).multiplyScalar(lightIntensity);
      u.ambient.value.copy(ambientColor);
      // un salto de hora (o de luz) mezclaría nubes de día y de noche: se descarta el historial
      lightNow.set(lightDir.x, lightDir.y, lightDir.z, u.sunColor.value.r + u.sunColor.value.g + u.sunColor.value.b + ambientColor.r + ambientColor.g + ambientColor.b);
      if (Math.abs(lightNow.w - lastLight.w) > 0.02 * Math.max(lastLight.w, 0.01)
        || new THREE.Vector3(lightNow.x, lightNow.y, lightNow.z).dot(new THREE.Vector3(lastLight.x, lastLight.y, lastLight.z)) < Math.cos(0.3 * Math.PI / 180)) {
        resetHistory = true;
        lastLight.copy(lightNow);
      }
      marchDome.position.copy(camera.position);
      composite.position.copy(camera.position);
    },
    /** Pase previo (antes del render principal): nubes a resolución reducida + acumulación temporal. */
    render(camera) {
      if (!state.enabled) return;
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, Math.round(size.x * state.resolution));
      const h = Math.max(1, Math.round(size.y * state.resolution));
      if (rtCurrent.width !== w || rtCurrent.height !== h) {
        rtCurrent.setSize(w, h);
        rtAccum[0].setSize(w, h);
        rtAccum[1].setSize(w, h);
        lastCam.makeScale(0, 0, 0);
      }
      // quieta: acumula ~8 fotogramas; girando: reproyecta el historial y acumula ~4;
      // si la cámara se desplaza mucho o cambia la simulación (hora), empieza de cero
      const moved = !camera.matrixWorld.equals(lastCam);
      const jumped = simMoved || resetHistory || lastCam.elements[15] === 0
        || camPos.setFromMatrixPosition(camera.matrixWorld).distanceTo(lastPos.setFromMatrixPosition(lastCam)) > 50;
      blend.value = !state.temporal || jumped ? 1 : moved ? 0.25 : 0.125;
      resetHistory = false;
      reproj.invProj.value.copy(camera.projectionMatrixInverse);
      reproj.camRot.value.extractRotation(camera.matrixWorld);
      reproj.prevViewRot.value.extractRotation(lastCam).invert();
      reproj.prevProj.value.copy(lastProj);
      lastCam.copy(camera.matrixWorld);
      lastProj.copy(camera.projectionMatrix);
      u.frame.value = (frame = (frame + 1) % 1024);

      const prevTarget = renderer.getRenderTarget();
      renderer.getClearColor(clearColor);
      const prevAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(rtCurrent);
      renderer.render(cloudScene, camera);
      // mezcla: escribe en accum[ping] leyendo accum[1 − ping] como historial
      const dst = rtAccum[ping];
      const src = rtAccum[1 - ping];
      histReproj.value = src.texture;
      renderer.setRenderTarget(dst);
      quad.render(renderer);
      outTex.value = dst.texture;
      ping = 1 - ping;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(clearColor, prevAlpha);
    },
    /** Marca que las nubes cambian aunque la cámara esté quieta (p. ej. viento o avance de la hora). */
    set changing(v) { simMoved = v; },
  };
}


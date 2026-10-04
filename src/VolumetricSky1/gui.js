import GUI from 'lil-gui';

/**
 * Panel de VolumetricSky1 con lil-gui (opcional: el cielo funciona sin él). Solo los parámetros relevantes,
 * cada uno en un único sitio:
 *   - Cielo e iluminación: el sol (manual o por fecha, hora y lugar), la luz que da a la escena y la exposición.
 *   - Atmósfera y nubes: los efectos volumétricos (aire, perspectiva aérea y nubes).
 *   - Niebla en capa: niebla adicional entre una cota baja y una cota alta.
 * El resto de parámetros (ozono, dispersión múltiple, luna, estrellas, calidad fina de las nubes…) se cambian por
 * código en `sky.state` y `sky.clouds.state`. Guía de cada control: GUIA_PANEL.md.
 *
 * @param {object} sky lo que devuelve createVolumetricSky1
 * @param {GUI} [parent] panel donde colgar las carpetas; sin él se crea uno propio
 * @returns {{ gui: GUI, sky: GUI, atmosphere: GUI, clouds: GUI, fog: GUI }} el panel y cada carpeta
 */
export function addVolumetricSky1Gui(sky, parent = null) {
  const gui = parent ?? new GUI({ title: 'VolumetricSky1', width: 368 });
  const s = sky.state;
  const c = sky.clouds.state;
  // mover un control de forma de las nubes deja la morfología en "Personalizada"
  let morphCtl = null;
  const applyClouds = () => sky.applyClouds();
  const applyShape = () => { c.morphology = 'Personalizada'; morphCtl?.updateDisplay(); sky.applyClouds(); };

  // ------------------------------------------------------------------ cielo e iluminación
  const fSky = gui.addFolder('Cielo e iluminación');
  fSky.add(s, 'enabled').name('Cielo activo').onChange(() => sky.apply());
  const manual = [];
  const astro = [];
  const showMode = () => {
    const m = s.sunMode === 'Manual';
    manual.forEach((ctl) => ctl.show(m));
    astro.forEach((ctl) => ctl.show(!m));
  };
  fSky.add(s, 'orientation', 0, 360, 1).name('Orientación del escenario (°)');
  fSky.add(s, 'sunMode', sky.sunModes).name('Posición del sol').onChange(() => { showMode(); sky.apply(); });
  manual.push(
    fSky.add(s, 'sunElevation', -10, 90, 0.1).name('Elevación (°)'),
    fSky.add(s, 'sunAzimuth', 0, 360, 0.5).name('Acimut (° desde el norte)'),
  );
  astro.push(
    fSky.add(s, 'place', sky.places).name('Lugar').onChange(() => sky.apply()),
    fSky.add(s, 'date').name('Fecha (AAAA-MM-DD)').onFinishChange(() => sky.apply()),
    fSky.add(s, 'hour', 0, 23.99, 0.01).name('Hora local').listen(),
    fSky.add(s, 'localTime').name('Fecha y hora').listen().disable(),
    fSky.add(s, 'sunTimes').name('Salida / puesta').listen().disable(),
    fSky.add(s, 'animate').name('Avanzar la hora'),
    fSky.add(s, 'timeSpeed', 1, 3600, 1).name('Velocidad (× tiempo real)'),
  );
  fSky.add(s, 'sunAltAz').name('Sol ahora').listen().disable();
  fSky.add(s, 'sunStrength', 0, 10, 0.05).name('Fuerza del sol');
  fSky.add(s, 'ambientStrength', 0, 3, 0.05).name('Luz ambiente');
  fSky.add(s, 'environmentIntensity', 0, 3, 0.01).name('Reflejos del cielo');
  fSky.add(s, 'skyBrightness', 0.1, 4, 0.05).name('Brillo del cielo');
  fSky.addColor(s, 'skyColor').name('Color base del cielo');
  fSky.add(s, 'exposure', 0.2, 3, 0.01).name('Exposición');
  showMode();

  // ------------------------------------------------------------------ atmósfera y nubes (efectos volumétricos)
  const fAtm = gui.addFolder('Atmósfera y nubes');
  fAtm.add(s, 'turbidity', 1, 20, 0.1).name('Turbidez (aerosoles)');
  fAtm.add(s, 'rayleigh', 0, 4, 0.01).name('Azul del aire (Rayleigh)');
  fAtm.add(s, 'aerial').name('Perspectiva aérea');
  fAtm.add(s, 'aerialStrength', 0, 40, 0.5).name('Fuerza de la perspectiva aérea');
  const fClouds = fAtm.addFolder('Nubes');
  fClouds.add(c, 'enabled').name('Nubes').onChange(applyClouds);
  morphCtl = fClouds.add(c, 'morphology', [...sky.cloudMorphologies, 'Personalizada']).name('Morfología')
    .onChange((name) => {
      if (name === 'Personalizada') return;
      sky.setCloudMorphology(name);
      fClouds.controllersRecursive().forEach((ctl) => ctl.updateDisplay());
    });
  fClouds.add(c, 'coverage', 0, 1, 0.01).name('Cobertura').onChange(applyShape);
  fClouds.add(c, 'density', 0.002, 0.15, 0.001).name('Densidad').onChange(applyShape);
  fClouds.add(c, 'type', 0, 1, 0.01).name('Tipo (cúmulo → estrato)').onChange(applyShape);
  fClouds.add(c, 'base', 200, 6000, 50).name('Altitud de la base (m)').onChange(applyShape);
  fClouds.add(c, 'thickness', 100, 4000, 50).name('Grosor (m)').onChange(applyShape);
  fClouds.add(c, 'scale', 0.2, 4, 0.05).name('Tamaño de las formaciones').onChange(applyShape);
  fClouds.add(c, 'windSpeed', 0, 60, 0.5).name('Viento (m/s)');
  fClouds.add(c, 'windDirection', 0, 360, 1).name('Viento hacia (° desde el norte)');
  fClouds.add(c, 'steps', 8, 128, 1).name('Calidad (pasos)').onChange(applyClouds);

  // ------------------------------------------------------------------ niebla en capa
  const fFog = gui.addFolder('Niebla en capa');
  fFog.add(s, 'fogDensity', 0, 0.01, 0.00005).name('Densidad (0 = sin niebla)');
  fFog.add(s, 'fogBottom', -100, 500, 0.1).name('Cota baja (m)');
  fFog.add(s, 'fogTop', -100, 500, 0.1).name('Cota alta (m)');
  fFog.add(s, 'fogFade', 0.5, 200, 0.5).name('Transición (m)');

  // el mapa de entorno (reflejos) se rehace al soltar cualquier control del cielo o la atmósfera
  for (const f of [fSky, fAtm]) f.onFinishChange(() => sky.invalidateEnv());

  return { gui, sky: fSky, atmosphere: fAtm, clouds: fClouds, fog: fFog };
}

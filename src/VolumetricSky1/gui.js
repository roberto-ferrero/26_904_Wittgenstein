import GUI from 'lil-gui';

/**
 * Panel de VolumetricSky1 con lil-gui (opcional: el cielo funciona sin él).
 * @param {object} sky lo que devuelve createVolumetricSky1
 * @param {GUI} [parent] panel donde colgar las carpetas; sin él se crea uno propio
 * @returns {GUI} la carpeta raíz "Cielo"
 */
export function addVolumetricSky1Gui(sky, parent = null) {
  const root = parent ? parent.addFolder('Cielo · VolumetricSky1') : new GUI({ title: 'Cielo · VolumetricSky1' });
  const s = sky.state;
  const applySky = () => sky.apply();

  // ------------------------------------------------------------------ sol, fecha, hora y lugar
  const fSun = root.addFolder('Sol, fecha, hora y lugar');
  fSun.add(s, 'enabled').name('Cielo activo').onChange(applySky);
  const manualOnly = [];
  const astroOnly = [];
  const showMode = () => {
    const manual = s.sunMode === 'Manual';
    manualOnly.forEach((c) => c.show(manual));
    astroOnly.forEach((c) => c.show(!manual));
  };
  fSun.add(s, 'sunMode', sky.sunModes).name('Sol').onChange(() => { showMode(); applySky(); });
  manualOnly.push(
    fSun.add(s, 'sunElevation', -20, 90, 0.1).name('Elevación (°)'),
    fSun.add(s, 'sunAzimuth', 0, 360, 0.5).name('Acimut (° desde N)'),
  );
  astroOnly.push(
    fSun.add(s, 'place', sky.places).name('Lugar').listen().onChange(applySky),
    fSun.add(s, 'lat', -90, 90, 0.01).name('Latitud (°)').listen().onChange(() => { s.place = 'Personalizado'; applySky(); }),
    fSun.add(s, 'lon', -180, 180, 0.01).name('Longitud (°)').listen().onChange(() => { s.place = 'Personalizado'; applySky(); }),
    fSun.add(s, 'tz', -12, 14, 0.5).name('Zona horaria (UTC±h)').listen().onChange(() => { s.place = 'Personalizado'; applySky(); }),
    fSun.add(s, 'date').name('Fecha (AAAA-MM-DD)').listen().onFinishChange(applySky),
    fSun.add(s, 'hour', 0, 23.99, 0.01).name('Hora local').listen(),
    fSun.add(s, 'animate').name('Avanzar la hora'),
    fSun.add(s, 'timeSpeed', 1, 3600, 1).name('Velocidad (× tiempo real)'),
    fSun.add(s, 'localTime').name('Fecha y hora').listen().disable(),
    fSun.add(s, 'sunTimes').name('Salida / puesta').listen().disable(),
  );
  fSun.add(s, 'sunAltAz').name('Sol').listen().disable();
  fSun.add(s, 'moonInfo').name('Luna').listen().disable();
  showMode();

  // ------------------------------------------------------------------ atmósfera y luz
  const fAtm = root.addFolder('Atmósfera y luz').close();
  fAtm.add(s, 'turbidity', 1, 20, 0.1).name('Turbidez (bruma)');
  fAtm.add(s, 'ozone', 0, 3, 0.05).name('Ozono');
  fAtm.add(s, 'multiScattering', 0, 3, 0.05).name('Dispersión múltiple');
  fAtm.add(s, 'rayleigh', 0, 4, 0.01).name('Rayleigh (azul)');
  fAtm.add(s, 'mieDirectionalG', 0, 0.999, 0.001).name('Mie · direccionalidad');
  fAtm.add(s, 'skyBrightness', 0.1, 4, 0.05).name('Brillo del cielo');
  fAtm.add(s, 'horizonFill').name('Horizonte bajo el horizonte');
  fAtm.add(s, 'sunStrength', 0, 10, 0.05).name('Fuerza del sol');
  fAtm.add(s, 'ambientStrength', 0, 3, 0.05).name('Luz ambiente');
  fAtm.add(s, 'environmentIntensity', 0, 3, 0.01).name('Entorno (reflejos)');
  fAtm.add(s, 'moonStrength', 0, 2, 0.05).name('Luz de luna');
  fAtm.add(s, 'stars', 0, 3, 0.05).name('Estrellas');
  fAtm.add(s, 'cloudLight', 0.1, 4, 0.05).name('Brillo de las nubes');
  fAtm.add(s, 'fogDensity', 0, 0.005, 0.00005).name('Niebla (densidad FogExp2)');
  fAtm.onFinishChange(() => sky.invalidateEnv()); // rehacer el entorno al soltar el control

  // ------------------------------------------------------------------ nubes volumétricas
  const fClouds = root.addFolder('Nubes volumétricas').close();
  const cl = sky.clouds.state;
  const applyClouds = () => sky.applyClouds();
  fClouds.add(cl, 'enabled').name('Nubes').onChange(applyClouds);
  fClouds.add(cl, 'coverage', 0, 1, 0.01).name('Cobertura').onChange(applyClouds);
  fClouds.add(cl, 'density', 0.002, 0.15, 0.001).name('Densidad').onChange(applyClouds);
  fClouds.add(cl, 'type', 0, 1, 0.01).name('Tipo (cúmulo - estrato)').onChange(applyClouds);
  fClouds.add(cl, 'base', 200, 6000, 50).name('Altitud de la base (m)').onChange(applyClouds);
  fClouds.add(cl, 'thickness', 100, 4000, 50).name('Grosor (m)').onChange(applyClouds);
  fClouds.add(cl, 'scale', 0.2, 4, 0.05).name('Tamaño de las formaciones').onChange(applyClouds);
  fClouds.add(cl, 'windSpeed', 0, 60, 0.5).name('Viento (m/s)');
  fClouds.add(cl, 'windDirection', 0, 360, 1).name('Viento hacia (° desde N)');
  fClouds.add(cl, 'resolution', 0.25, 1, 0.05).name('Resolución (fracción)').onChange(applyClouds);
  fClouds.add(cl, 'temporal').name('Acumulación temporal').onChange(applyClouds);
  fClouds.add(cl, 'steps', 8, 128, 1).name('Calidad (pasos)').onChange(applyClouds);
  fClouds.add(cl, 'lightSteps', 1, 12, 1).name('Pasos de luz').onChange(applyClouds);
  fClouds.add(cl, 'maxDistance', 2000, 80000, 500).name('Distancia máx. (m)').onChange(applyClouds);

  return root;
}

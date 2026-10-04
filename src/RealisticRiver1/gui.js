import GUI from 'lil-gui';
import { createTestRock, findWaterPoint } from './testRock.js';

/**
 * Panel de RealisticRiver1 con lil-gui (opcional: el río funciona sin él). Los controles se cuelgan directamente
 * en `parent` (p. ej. una carpeta "Agua" del panel del visor); sin él se crea un panel propio.
 * Guía de cada control: GUIA_PANEL.md.
 *
 * @param {object} river lo que devuelve createRealisticRiver1
 * @param {GUI} [parent] panel o carpeta donde añadir los controles
 * @returns {{ gui: GUI }}
 */
export function addRealisticRiver1Gui(river, parent = null) {
  const gui = parent ?? new GUI({ title: 'RealisticRiver1', width: 368 });
  const s = river.state;
  const apply = () => river.apply();
  let fFoamNote = false;

  gui.add(s, 'character', 0, 1, 0.01).name('carácter (espejo → hidráulico)').onChange(apply);
  gui.addColor(s, 'colorShallow').name('color orilla').onChange(apply);
  gui.addColor(s, 'colorDeep').name('color fondo').onChange(apply);
  gui.add(s, 'absorption', 0.2, 20, 0.1).name('absorción (m)').onChange(apply);
  gui.add(s, 'shoreFade', 0, 3, 0.05).name('orilla transparente (m)').onChange(apply);
  gui.add(s, 'roughness', 0, 1, 0.01).name('rugosidad').onChange(apply);
  gui.add(s, 'reflections', 0, 3, 0.01).name('reflejos del cielo').onChange(apply);
  gui.add(s, 'flowSpeed', 0, 4, 0.05).name('velocidad del río (m/s)').onChange(apply);
  gui.add(s, 'flowBoost', 0, 10, 0.1).name('exageración de la velocidad').onChange(apply);
  gui.add(s, 'rippleSize', 2, 300, 1).name('tamaño ondas (m)').onChange(apply);
  gui.add(s, 'rippleStrength', 0, 1.5, 0.01).name('fuerza ondas').onChange(apply);
  gui.add(s, 'flowCycle', 0.5, 12, 0.1).name('ciclo del flow map (s)').onChange(apply);
  const fSim = gui.addFolder('Remolinos (simulación)').close();
  const simCtl = fSim.add(s, 'simulation').name('activa').onChange(apply);
  if (!river.simulationAvailable) {
    // con WebGL 2 no hay compute: se avisa y no se guarda en la URL
    simCtl.name('activa (necesita WebGPU)').disable();
    fFoamNote = true;
  }
  fSim.add(s, 'vorticity', 0, 3, 0.01).name('confinamiento de vorticidad').onChange(apply);
  fSim.add(s, 'relaxTime', 1, 120, 1).name('vuelta a la corriente base (s)').onChange(apply);
  fSim.add(s, 'bankDrag', 0, 10, 0.05).name('rozamiento en orillas (1/s)').onChange(apply);
  fSim.add(s, 'turbulence', 0, 5, 0.05).name('turbulencia junto a tierra').onChange(apply);
  fSim.add(s, 'turbScale', 4, 120, 1).name('tamaño de la turbulencia (m)').onChange(apply);
  fSim.add(s, 'turbOpen', 0, 1, 0.01).name('turbulencia en todo el cauce').onChange(apply);
  fSim.add(s, 'viscosity', 0, 0.5, 0.01).name('viscosidad').onChange(apply);
  fSim.add(s, 'pressureIterations', 2, 80, 2).name('iteraciones de presión').onChange(apply);
  fSim.add(s, 'simRate', 10, 60, 1).name('pasos por segundo').onChange(apply);
  fSim.add({ reset: () => river.resetSimulation() }, 'reset').name('⟲ Reiniciar los remolinos');
  // (el título no cambia con el backend: forma parte de las claves de la URL y de los conjuntos)
  const fFoam = gui.addFolder('Espuma').close();
  if (fFoamNote) fFoam.add({ aviso: 'necesita WebGPU (sin simulación no hay espuma)' }, 'aviso').name('Aviso').disable();
  fFoam.add(s, 'foamAmount', 0, 4, 0.05).name('cantidad').onChange(apply);
  fFoam.add(s, 'foamLife', 1, 120, 1).name('vida (s)').onChange(apply);
  fFoam.add(s, 'foamShear', 0, 5, 0.05).name('en remolinos y cizalla').onChange(apply);
  fFoam.add(s, 'foamConvergence', 0, 5, 0.05).name('donde converge el agua').onChange(apply);
  fFoam.add(s, 'foamImpact', 0, 5, 0.05).name('choque con orillas y piedras').onChange(apply);
  fFoam.add(s, 'foamBank', 0, 5, 0.05).name('a lo largo de las orillas').onChange(apply);
  fFoam.add(s, 'foamShallow', 0, 5, 0.05).name('en bajíos').onChange(apply);
  fFoam.add(s, 'foamRapids', 0, 5, 0.05).name('en rápidos (agua más rápida)').onChange(apply);
  fFoam.addColor(s, 'foamColor').name('color').onChange(apply);
  fFoam.add(s, 'foamSize', 0.5, 15, 0.1).name('tamaño de las burbujas (m)').onChange(apply);
  fFoam.add(s, 'foamSharpness', 0.5, 10, 0.1).name('definición de las vetas').onChange(apply);
  fFoam.add(s, 'foamStretch', 1, 12, 0.1).name('estiramiento con la corriente').onChange(apply);
  gui.add(s, 'windRipples', 0, 1.5, 0.01).name('ondas de viento').onChange(apply);
  gui.add(s, 'windSize', 1, 40, 0.5).name('tamaño ondas de viento (m)').onChange(apply);

  // depuración: no se guarda en la URL ni en los conjuntos de configuración
  const fDebug = gui.addFolder('Depuración del río').close();
  const viewCtl = fDebug.add(s, 'debugView', river.debugViews).name('Vista').onChange(apply);
  viewCtl.noUrl = true;
  const info = { dominio: '', horneado: '', corriente: '' };
  const describe = () => {
    const d = river.domain, st = d.stats;
    info.dominio = `${d.nx} × ${d.nz} celdas de ${d.cellSize} m · ${Math.round(st.wetCells / 1000)} k con agua · `
      + `hasta ${st.maxDepth.toFixed(1)} m · ${st.obstacleCells} celdas de obstáculo`;
    info.horneado = `${st.ms.total.toFixed(0)} ms (vista cenital ${st.ms.render.toFixed(0)}, CPU ${st.ms.cpu.toFixed(0)})`;
    const fl = river.flow, fs = fl.stats;
    info.corriente = `${fl.nx} × ${fl.nz} celdas de ${fl.cellSize} m · ${fs.islands} islas · `
      + `${fs.iterations} iteraciones · ${fs.ms.total.toFixed(0)} ms`;
  };
  describe();
  fDebug.add(info, 'dominio').name('Dominio').disable().listen();
  fDebug.add(info, 'horneado').name('Horneado').disable().listen();
  fDebug.add(info, 'corriente').name('Corriente base').disable().listen();
  fDebug.add({ rebuild: async () => { await river.rebuild(); describe(); } }, 'rebuild').name('↻ Volver a hornear dominio y corriente');

  // piedras de prueba: se colocan en el agua donde mira la cámara (centro de la vista) y cuentan como obstáculo
  const rocks = [];
  const testRock = { size: 8, info: '' };
  const fRocks = gui.addFolder('Piedras de prueba').close();
  const sizeCtl = fRocks.add(testRock, 'size', 2, 30, 0.5).name('tamaño (m)');
  sizeCtl.noUrl = true;
  fRocks.add({
    add: async () => {
      const p = findWaterPoint(river, river.camera);
      if (!p) { testRock.info = 'no hay agua en el centro de la vista'; return; }
      const rock = createTestRock(testRock.size, rocks.length + 1);
      rock.position.set(p.x, river.domain.level - testRock.size * 0.15, p.z);
      river.object.parent.add(rock);
      rocks.push(rock);
      testRock.info = 'horneando…';
      const st = await river.addObstacle(rock);
      testRock.info = `${rocks.length} piedra(s) · rehorneado en ${st.ms.total.toFixed(0)} ms`;
      describe();
    },
  }, 'add').name('＋ Piedra en el centro de la vista');
  fRocks.add({
    clear: async () => {
      // se quitan todas a la vez: los rehorneados pedidos mientras hay uno en marcha se juntan en uno
      const all = rocks.splice(0);
      await Promise.all(all.map((r) => {
        r.removeFromParent();
        r.geometry.dispose();
        r.material.dispose();
        return river.removeObstacle(r);
      }));
      testRock.info = '';
      describe();
    },
  }, 'clear').name('✕ Quitar las piedras de prueba');
  fRocks.add(testRock, 'info').name('Estado').disable().listen();

  return { gui, debug: fDebug };
}

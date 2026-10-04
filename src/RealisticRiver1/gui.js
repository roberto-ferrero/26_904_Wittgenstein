import GUI from 'lil-gui';

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

  gui.addColor(s, 'colorShallow').name('color orilla').onChange(apply);
  gui.addColor(s, 'colorDeep').name('color fondo').onChange(apply);
  gui.add(s, 'roughness', 0, 1, 0.01).name('rugosidad').onChange(apply);
  gui.add(s, 'rippleSpeed', 0, 0.1, 0.001).name('velocidad ondas');
  gui.add(s, 'rippleScale', 0.1, 20, 0.1).name('escala ondas').onChange(apply);
  gui.add(s, 'rippleStrength', 0, 1.5, 0.01).name('fuerza ondas').onChange(apply);

  // depuración: no se guarda en la URL ni en los conjuntos de configuración
  const fDebug = gui.addFolder('Depuración del río').close();
  const viewCtl = fDebug.add(s, 'debugView', river.debugViews).name('Vista').onChange(apply);
  viewCtl.noUrl = true;
  const info = { dominio: '', horneado: '' };
  const describe = () => {
    const d = river.domain, st = d.stats;
    info.dominio = `${d.nx} × ${d.nz} celdas de ${d.cellSize} m · ${Math.round(st.wetCells / 1000)} k con agua · `
      + `hasta ${st.maxDepth.toFixed(1)} m · ${st.obstacleCells} celdas de obstáculo`;
    info.horneado = `${st.ms.total.toFixed(0)} ms (vista cenital ${st.ms.render.toFixed(0)}, CPU ${st.ms.cpu.toFixed(0)})`;
  };
  describe();
  fDebug.add(info, 'dominio').name('Dominio').disable().listen();
  fDebug.add(info, 'horneado').name('Horneado').disable().listen();
  fDebug.add({ rebuild: async () => { await river.rebuild(); describe(); } }, 'rebuild').name('↻ Volver a hornear el dominio');

  return { gui, debug: fDebug };
}

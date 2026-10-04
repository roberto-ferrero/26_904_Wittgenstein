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

  return { gui };
}

import { REVISION } from 'three/webgpu';

/**
 * Interfaz de presentación (copiada de 26_903_Whale, con la paleta verde oscuro):
 * - cabecera con el proyecto y el título (izquierda) y el backend (derecha);
 * - cortina verde oscuro con un recuadro de estado (mensaje de cada paso de la inicialización y barra
 *   de progreso) que se funde a la escena cuando la imagen se ha estabilizado;
 * - pie con las métricas del render (FPS, ms por fotograma, resolución, dibujos, triángulos).
 */
export function createUi(container, backend) {
  const root = document.createElement('section');
  root.className = 'app-ui';
  root.setAttribute('aria-label', 'Visor del castillo');
  root.innerHTML = `
    <div class="app-cover"></div>
    <header>
      <div>
        <span class="app-eyebrow">PROJECT 26904_Wittgenstein / ESTUDIO 01</span>
        <h1>Ian Miller's Wittgenstein Castle</h1>
      </div>
      <span class="app-backend"></span>
    </header>
    <div class="app-status" role="status" aria-live="polite">
      <p class="app-status-text">Iniciando…</p>
      <div class="app-progress" aria-hidden="true"><div class="app-progress-fill"></div></div>
    </div>
    <footer><p class="app-metrics">Preparando la primera imagen…</p></footer>`;
  container.appendChild(root);

  const cover = root.querySelector('.app-cover');
  const status = root.querySelector('.app-status');
  const text = root.querySelector('.app-status-text');
  const fill = root.querySelector('.app-progress-fill');
  const metrics = root.querySelector('.app-metrics');
  const backendEl = root.querySelector('.app-backend');
  const setBackend = (b) => { backendEl.textContent = `${b} · Three.js r${REVISION}`; };
  setBackend(backend ?? 'WebGPU');

  // espera a que el navegador pinte (los pasos de la carga son síncronos entre `await`); con la
  // pestaña en segundo plano no hay requestAnimationFrame: como mucho 60 ms
  const paint = () => new Promise((r) => {
    requestAnimationFrame(() => requestAnimationFrame(r));
    setTimeout(r, 60);
  });

  return {
    root,
    setBackend,
    /** Mensaje y progreso (0-1) de la inicialización; espera a que se vea. */
    async step(message, progress) {
      text.textContent = message;
      if (progress !== undefined) fill.style.width = `${Math.round(progress * 100)}%`;
      await paint();
    },
    /** Error de carga: el mensaje (HTML) queda en el recuadro. */
    error(html) {
      text.innerHTML = html;
      status.classList.add('app-status-error');
    },
    /** Quita el recuadro y funde la cortina a la escena. */
    reveal(seconds = 2.2) {
      fill.style.width = '100%';
      status.classList.add('app-hidden');
      cover.style.transition = `opacity ${seconds}s ease-in-out`;
      cover.style.opacity = '0';
      setTimeout(() => cover.remove(), seconds * 1000 + 100);
    },
    /** Línea del pie con las métricas. */
    setMetrics(line) { metrics.textContent = line; },
  };
}

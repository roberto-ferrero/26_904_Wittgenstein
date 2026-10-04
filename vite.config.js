import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Solo en desarrollo: POST /__capture?name=x con un data URL JPEG/PNG en el cuerpo guarda una captura del canvas
 * en capturas/x.jpg|png (para revisar vistas sin depender de la ventana).
 */
function capturePlugin() {
  return {
    name: 'capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const name = new URL(req.url, 'http://x').searchParams.get('name') ?? '';
        if (!/^[a-z0-9_\-]+$/i.test(name)) { res.statusCode = 400; res.end('nombre no válido'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const m = body.match(/^data:image\/(jpeg|png);base64,(.+)$/);
          if (!m) { res.statusCode = 400; res.end('se espera un data URL'); return; }
          const file = path.resolve('capturas', `${name}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  // rutas relativas: el build funciona en cualquier subruta (GitHub Pages, Netlify, Vercel…)
  base: './',
  plugins: [capturePlugin()],
  server: { port: 5173 },
  build: {
    target: 'es2022', // await en el nivel superior (main.js)
    chunkSizeWarningLimit: 2000, // three/webgpu es grande por sí solo
  },
});

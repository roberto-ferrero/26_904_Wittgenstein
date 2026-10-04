# Ian Miller's Wittgenstein Castle (26_904)

Recreación en 3D de la ilustración de Ian Miller con Three.js r186 (`WebGPURenderer` + TSL) y Vite: el castillo,
el meandro del río, la torre, las colinas con 18.113 árboles con viento y un cielo físico con nubes volumétricas.

## Arrancar

```
npm install
npm run dev        # http://localhost:5173
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (con herramientas de depuración en la consola) |
| `npm run build` | Build de producción en `dist/` con rutas relativas: funciona en cualquier subruta |
| `npm run preview` | Sirve `dist/` para probar el build |
| `npm run gen:clouds` | Regenera las texturas de ruido de las nubes |

Necesita un navegador con WebGPU (Chrome o Edge 113+); sin él, Three.js cae a WebGL 2.

## Qué hay

- **Arranque** (copiado de 26_903_Whale): cortina verde oscuro con los pasos de la carga y barra de progreso, que se
  funde cuando la imagen es estable (al menos 1,5 s y 45 fotogramas sin tirones, como mucho 12 s). Cabecera con el
  proyecto y el backend, y pie con FPS, ms por fotograma, resolución, dibujos, triángulos y estado del cielo.
- **Escena v10** en `public/escena/` (copiada de "Claude working folder"): terreno de 1000 × 1500 m con agua y rocas,
  castillo v4 con roña, humedades e hiedra que se mece, torre y vegetación instanciada con dos LOD y viento.
  Arranca en la cámara "Camera" de Blender (OrbitControls; "Volver a Camera" en el panel).
- **Cielo: [VolumetricSky1](src/VolumetricSky1/README.md)**, módulo reutilizable sacado del cielo de Whale. Sustituye
  al cielo equirectangular. Aquí arranca con el sol por fecha, hora y lugar (Viena, 21 de junio a las 17:30: 31° de altura,
  hacia el oeste, parecido al sol de la escena de Blender) y con la orientación del escenario a 0 (−Z al norte); con
  la orientación se elige hacia dónde mira el escenario sin moverlo. El cielo mueve el sol (color, fuerza y dirección,
  manteniendo la caja de sombras sobre el terreno), la luz hemisférica y el mapa de entorno.
- **Río: [RealisticRiver1](src/RealisticRiver1/README.md)**, módulo reutilizable en construcción para un río con
  corriente, remolinos y espuma ([plan](docs/RealisticRiver1_PLAN.md)). Hecho: mapas del cauce horneados al cargar,
  corriente base con las ondas desplazadas por ella (de norte a sur, hacia la cámara), color por profundidad, orilla
  transparente, ondas de viento y reflejos del cielo regulables. Conjunto "Río de la ilustración" en el panel. El agua plana anterior sigue
  disponible en `src/escena/agua.js`.
- **Atmósfera sobre la escena**: la perspectiva aérea de VolumetricSky1, con la misma atmósfera que pinta el cielo,
  y su niebla en capa sobre el río (densidad 0,00175 hasta la cota del agua y transición de 11 m, los valores del
  visor de la v10). La niebla propia del visor de la v10 se ha quitado.
- **Panel** lil-gui replegado por defecto, con la paleta verde y 368 px de ancho: ↻ Actualizar, rendimiento, cámara,
  cielo e iluminación, atmósfera y nubes, niebla en capa, agua, vegetación y visibilidad. Qué hace cada control:
  [GUIA_PANEL.md](GUIA_PANEL.md). Todo lo que cambias en el panel, y la vista de la cámara, se guarda en la URL
  (`src/core/urlState.js`): copiándola se reproduce la misma configuración.

## Rendimiento

Medido a 1920 × 1080 en el equipo de desarrollo, con la GPU sincronizada en cada fotograma: 9,1 ms desde "Camera"
(6,4 ms sin el cielo) y 7,4 ms en vista aérea.

## Estructura

```
src/main.js           montaje de la escena, cielo, panel y bucle
src/core/ui.js        arranque, cabecera y pie de métricas
src/core/urlState.js  estado del panel y de la cámara en la URL
src/presets/          conjuntos de configuración del panel (mismas claves que la URL)
src/escena/           agua (adaptadores del río) y vegetación
src/VolumetricSky1/   cielo físico con nubes volumétricas (módulo autocontenido, con su README)
src/RealisticRiver1/  río con corriente, remolinos y espuma (módulo autocontenido, con su README; en construcción)
docs/                 planes de trabajo
public/escena/        assets de la escena v10 (glb con Draco, datos y vegetación)
public/draco/         decodificador Draco
```

## Depuración (solo `npm run dev`)

En la consola: `scene`, `camera`, `sky`, `vegetacion`… `await renderFrames(60)` dibuja 60 fotogramas a paso fijo y
devuelve los ms por fotograma; `await capture('nombre')` guarda el canvas en `capturas/nombre.jpg`.

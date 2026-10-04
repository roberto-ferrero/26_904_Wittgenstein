# VolumetricSky1

Cielo físico con nubes volumétricas para Three.js (`WebGPURenderer` + TSL, r186). Sale del cielo del
proyecto [26_903_Whale](https://github.com/roberto-ferrero/26_903_Whale) (Fases 3.1-3.5), separado en un
módulo que se copia tal cual a otro proyecto.

- **Atmósfera física** (modelo de Hillaire simplificado): LUT de cielo de 256 × 128 que solo se recalcula
  cuando se mueve el sol, cúpula con disco solar y color del sol por transmitancia.
- **Nubes volumétricas**: raymarching de una capa de cúmulos o estratos con texturas de ruido
  Perlin-Worley precalculadas, luz con dispersión múltiple aproximada, viento, render a resolución
  reducida y acumulación temporal con reproyección.
- **Sol** por fecha, hora y lugar (posición astronómica real) o **manual** (elevación y acimut).
- **Noche**: estrellas orientadas con el tiempo sidéreo y luna con su fase.
- **Perspectiva aérea** (`scene.fogNode`): cada píxel de la escena se atenúa por canal con la misma atmósfera
  (Rayleigh y Mie, densidad según la altura) y recibe la luz del cielo que tiene detrás, así que lo lejano se
  vuelve azulado, se aclara hacia el sol y se tiñe al atardecer. Incluye una **niebla en capa** opcional (densidad,
  cota baja, cota alta y transición) iluminada igual.
- **Luz de la escena** (opcional): color, fuerza y dirección de tu `DirectionalLight` y de tu
  `HemisphereLight`, y mapa de entorno PMREM con el cielo y las nubes.
- **Panel lil-gui** opcional, con solo los parámetros relevantes. Guía de cada control: [GUIA_PANEL.md](GUIA_PANEL.md).

## Copiarlo a otro proyecto

1. Copia la carpeta `VolumetricSky1/` entera (incluye `textures/` con el ruido de las nubes, 655 KB).
2. Dependencias: `three` (r186 o compatible). `lil-gui` solo si usas el panel.
3. Las texturas se cargan con `new URL('./textures/…', import.meta.url)`, así que Vite (u otro bundler que
   entienda ese patrón) las copia al build sin tocar `public/`.

## Uso

```js
import * as THREE from 'three/webgpu';
import { createVolumetricSky1 } from './VolumetricSky1/index.js';
import { addVolumetricSky1Gui } from './VolumetricSky1/gui.js'; // opcional

const sun = new THREE.DirectionalLight();       // el cielo pone su color, fuerza y dirección
const hemi = new THREE.HemisphereLight();        // el cielo pone su color y fuerza
scene.add(sun, sun.target, hemi);

const sky = await createVolumetricSky1({ renderer, scene, camera, sun, hemi });
addVolumetricSky1Gui(sky, gui);                  // en tu panel; sin `gui` crea uno propio

renderer.setAnimationLoop(() => {
  const dt = timer.getDelta();
  camera.updateMatrixWorld();
  sky.update(dt);                 // SIEMPRE antes de renderer.render (hace el pase previo de las nubes)
  renderer.render(scene, camera);
});
```

### Opciones de `createVolumetricSky1`

| Opción | Por defecto | Qué hace |
|---|---|---|
| `renderer`, `scene`, `camera` | — | Obligatorias. |
| `sun` | `null` | `DirectionalLight` a la que el cielo pone color, fuerza y dirección. Se mueve alrededor de `sun.target` a la distancia que ya tenía, así que la caja de sombras no cambia. |
| `hemi` | `null` | `HemisphereLight` a la que el cielo pone color y fuerza. |
| `environment` | `true` | Genera `scene.environment` (PMREM) con el cielo y las nubes; se rehace al moverse el sol. |
| `fog` | `true` | Pone la perspectiva aérea como `scene.fogNode` (sustituye a cualquier niebla de la escena). Con `false` no toca la niebla; el nodo queda en `sky.fogNode`. |
| `settings` | — | Valores iniciales del cielo (ver `SKY_DEFAULTS` en `VolumetricSky1.js`): `sunMode`, `sunElevation`, `sunAzimuth`, `place`, `date`, `hour`, `turbidity`, `sunStrength`, `ambientStrength`, `environmentIntensity`… |
| `cloudSettings` | — | Valores iniciales de las nubes: `coverage`, `density`, `base`, `thickness`, `type`, `windSpeed`, `windDirection`, `scale`, `steps`, `lightSteps`, `resolution`, `temporal`… |
| `places` | `PLACES` | Lista de lugares para el modo astronómico: `{ nombre: { lat, lon, tz } }`. |

Ejemplo con el sol fijo y pocas nubes:

```js
const sky = await createVolumetricSky1({
  renderer, scene, camera, sun,
  settings: { sunMode: 'Manual', sunElevation: 25, sunAzimuth: 240 },
  cloudSettings: { coverage: 0.25 },
});
```

### Lo que devuelve

| Miembro | Qué es |
|---|---|
| `update(dt)` | Un fotograma: sol, luna, luces, entorno y pase previo de las nubes. Antes de `renderer.render`. |
| `state` | Parámetros del cielo. Tras cambiarlos a mano, `apply()`. |
| `clouds.state` | Parámetros de las nubes. Tras cambiarlos a mano, `applyClouds()`. |
| `sunDirection`, `sunColor` | Dirección hacia el sol y su color (lineal), para shaders propios. |
| `fogNode` | Nodo TSL de la perspectiva aérea. |
| `clouds.cloudShadowNode(posicionMundo)` | Nodo TSL con la sombra de las nubes (0 = sombra, 1 = sol) para multiplicar en tus materiales. |
| `info` | Altura y acimut del sol y la luna, fracción iluminada de la luna y factor de día. |
| `invalidateEnv()` | Fuerza rehacer el mapa de entorno. |
| `dispose()` | Saca el cielo de la escena y libera sus recursos. |

## Convenciones y límites

- Unidades en metros, Y arriba. Por defecto **norte = −Z**, **este = +X**; `state.orientation` (°) dice a qué rumbo
  apunta −Z (180 = −Z al sur) y gira sol, luna, estrellas y viento de las nubes sin tocar la escena. Acimuts en grados
  desde el norte geográfico, en sentido horario.
- Las cúpulas del cielo y las nubes se colocan al 90 % del `far` de la cámara (como mucho 50 km): todo lo
  opaco de la escena tiene que quedar más cerca. Las nubes solo se ven por encima del horizonte de la cámara.
- `horizonFill` (activo por defecto) repite el color del horizonte por debajo de él, para escenas con suelo
  finito. Desactivado, se ve el suelo del planeta (casi negro), como en un mar hasta el horizonte.
- Perspectiva aérea: `aerialStrength` multiplica la atmósfera real (5 por defecto; con 1, a escala de un valle
  casi no se nota). `fogDensity` (1/m), `fogBottom` y `fogTop` (cotas, y) y `fogFade` (m de transición) dan la niebla en capa;
  con densidad 0 no hay.
  La distancia sale de la posición en espacio de vista, así que incluye instancias y vértices desplazados (viento).
- Los uniformes que comparten muchos materiales (los de la perspectiva aérea están en todos) van en `renderGroup`:
  en el grupo por defecto un cambio no llegaba a todos los objetos hasta que otra cosa forzaba la actualización.
- `sky.refresh()` vuelve a aplicar todo (es el botón ↻ Actualizar del panel de 26_904).
- Coste medido en 26_904 a 1920 × 1080: unos 2,7 ms por fotograma con los valores por defecto; la perspectiva
  aérea añade menos de 0,5 ms.
- Regenerar el ruido de las nubes: `node VolumetricSky1/tools/gen-noise.mjs`.

## Archivos

```
VolumetricSky1.js   createVolumetricSky1: sol, luna, estrellas, luces, entorno y orquestación
atmosphere.js       atmósfera física (LUT + cúpula) y transmitancia del sol en CPU
clouds.js           nubes volumétricas (raymarching, acumulación temporal, sombra de nubes)
astro.js            posición del sol y la luna, fase lunar, salida y puesta
gui.js              panel lil-gui opcional (GUIA_PANEL.md explica cada control)
index.js            exportaciones
textures/           ruido de las nubes (64³ Perlin-Worley y mapa de clima 256²)
tools/gen-noise.mjs genera las texturas de ruido
```

# RealisticRiver1

Río con corriente visible para Three.js (`WebGPURenderer` + TSL, r186): flujo que sigue el cauce, remolinos en las
márgenes y detrás de los obstáculos, y espuma que deja ver el comportamiento hidráulico. Es un módulo autocontenido
y reutilizable, como [VolumetricSky1](../VolumetricSky1/README.md). Plan completo:
[docs/RealisticRiver1_PLAN.md](../../docs/RealisticRiver1_PLAN.md).

## Estado

| Fase | Qué trae | Estado |
|---|---|---|
| F0. Esqueleto | API fijada (creación, `update(dt)`, `state` + `apply()`, `dispose()`), material propio con el aspecto del agua plana anterior, panel | **Hecha** |
| F1. Dominio | Lecho, máscara, distancia a la orilla, profundidad y obstáculos horneados en el navegador; vistas de depuración | **Hecha** |
| F2. Corriente base | Función de corriente con profundidad e islas; normales con flow map | Pendiente |
| F3. Superficie | Color por profundidad, orilla transparente, Fresnel, viento | Pendiente |
| F4. Simulación viva | Remolinos (Stable Fluids 2D en compute) | Pendiente |
| F5. Espuma | Espuma advectada con fuentes físicas | Pendiente |
| F6. Obstáculos en caliente | `addObstacle` / `removeObstacle` | Pendiente |
| F7. Reflejo de la escena | Reflejo plano opcional | Pendiente |
| F8. Cierre | Presets, WebGL 2, `sampleVelocity` | Pendiente |

## Copiarlo a otro proyecto

1. Copia la carpeta `RealisticRiver1/` entera.
2. Dependencias: `three` (r186 o compatible). `lil-gui` solo si usas el panel.

## Uso

```js
import * as THREE from 'three/webgpu';
import { createRealisticRiver1 } from './RealisticRiver1/index.js';
import { addRealisticRiver1Gui } from './RealisticRiver1/gui.js'; // opcional

// `mallaAgua`: la lámina de agua de tu escena (una malla plana a la cota del agua). Quítala de la escena:
// el río crea su propia malla con la misma geometría y transformación.
mallaAgua.removeFromParent();
const river = await createRealisticRiver1({
  renderer, scene, camera,
  water: mallaAgua,
  terrain: terreno,        // lecho y orillas
  obstacles: [ rocas ],    // cuentan donde sobresalen del agua
});
addRealisticRiver1Gui(river, gui.addFolder('Agua'));  // sin argumento crea un panel propio

renderer.setAnimationLoop(() => {
  const dt = timer.getDelta();
  sky?.update(dt);
  river.update(dt);             // antes de renderer.render
  renderer.render(scene, camera);
});
```

### Opciones de `createRealisticRiver1`

| Opción | Por defecto | Qué hace |
|---|---|---|
| `renderer`, `scene`, `camera` | — | Obligatorias. |
| `water` | — | Obligatoria. Malla de la lámina: define la cota, la extensión y los atributos por vértice. Si trae `_profundidad` (0 orilla, 1 hondo), el color se mezcla con él. |
| `terrain` | `scene` | Objeto o lista de objetos que forman el lecho y las orillas. |
| `obstacles` | `[]` | Objetos, grupos o `InstancedMesh` que cuentan como obstáculos donde sobresalen de la lámina y el terreno de debajo quedaría bajo el agua. Se excluyen del terreno. |
| `cellSize` | `1` | Metros por celda del dominio. |
| `margin` | `8` | Metros de dominio alrededor de la lámina. |
| `normalTexture` | `water.material.normalMap` | Mapa de normales de detalle, repetible. |
| `settings` | — | Valores iniciales (ver `RIVER_DEFAULTS` en `RealisticRiver1.js`). |

### Lo que devuelve

| Miembro | Qué es |
|---|---|
| `object` | La malla del río, ya añadida a la escena. |
| `update(dt)` | Un paso del río. En cada fotograma, antes de `renderer.render`. |
| `state` | Parámetros. Tras cambiarlos a mano, `apply()`. |
| `defaults` | `RIVER_DEFAULTS`. |
| `domain` | Dominio horneado (ver más abajo). |
| `maps` | Texturas para shaders u otros efectos: `{ domain }`. |
| `rebuild()` | Vuelve a hornear el dominio (tras mover el terreno o cambiar obstáculos). Devuelve las estadísticas. |
| `debugViews` | Nombres de las vistas de depuración. |
| `dispose()` | Quita el río de la escena y libera su material. La geometría sigue siendo de quien la cargó. |

### `RIVER_DEFAULTS`

| Clave | Por defecto | Qué es |
|---|---|---|
| `enabled` | `true` | Río visible y actualizándose. |
| `colorShallow`, `colorDeep` | `0x9a9db5`, `0x7d8099` | Color (sRGB) en la orilla y en lo hondo. |
| `roughness` | `0.07` | Rugosidad de la lámina. |
| `rippleSpeed` | `0.012` | Velocidad de las ondas de detalle (UV por segundo). |
| `rippleScale` | `4` | Repeticiones del mapa de normales sobre el UV de la lámina. |
| `rippleStrength` | `0.3` | Fuerza del mapa de normales. |
| `debugView` | `'Ninguna'` | Vista de depuración: `'Orilla (distancia con signo)'`, `'Profundidad'`, `'Obstáculos'` o `'Lecho (altura)'`. Pinta el mapa sobre la lámina sin luz. |

## Dominio (F1)

Al crear el río se hornea una rejilla alineada con el mundo que cubre la lámina con un margen (`domain.js`):

1. Dos vistas cenitales ortográficas, con y sin obstáculos, guardan en cada celda la altura de lo más alto y del
   terreno.
2. En CPU: agua donde el lecho queda bajo la cota, profundidad en metros (sin saturar), distancia euclídea exacta
   con signo a la orilla (Felzenszwalb; + en el agua, − en tierra) y obstáculos (celdas secas por un obstáculo cuyo
   terreno de debajo estaría bajo el agua; las rocas de la orilla no cuentan).
3. Una textura `RGBA` de media precisión, filtrable: R = distancia a la orilla (m), G = profundidad (m),
   B = obstáculo (0/1), A = altura del lecho (m).

Celda `(i, j)` con centro en `x = x0 + (i + ½)·cellSize`, `z = z0 + (j + ½)·cellSize` e índice `i + j·nx`. En los
shaders: `uv = (xz − domain.origin) / domain.size`. `domain` también trae los mapas en CPU (`sdf`, `depth`,
`obstacle`, `bed`, `wet`), `cellAt(x, z)` y `stats` (celdas con agua, de obstáculo, profundidad máxima y tiempos).

En la escena v10: 560 × 1516 celdas de 1 m, 310 k con agua, hasta 12,9 m de profundidad y 104 celdas de obstáculo
(las rocas al pie del promontorio de la torre).

## Integración con el cielo

La lámina es un `MeshStandardNodeMaterial`, así que recibe sin código propio la perspectiva aérea y la niebla en capa
de VolumetricSky1 (`scene.fogNode`), los reflejos del cielo y las nubes (`scene.environment`) y el sol con sus
sombras.

## Rendimiento

Medido en el visor de la escena v10 a 1920 × 1080 con la GPU sincronizada (`await renderFrames(120)`):

| Vista | Con el río | Sin el río |
|---|---|---|
| "Camera" | 10,5-11 ms | 10,5-10,8 ms |
| Aérea | 8,6 ms | 8,4 ms |

Por fotograma el río cuesta lo mismo que el agua plana anterior: un solo dibujo de 44.322 triángulos con un material
sencillo (la diferencia entre medidas está dentro del ruido, ±0,3 ms). El horneado del dominio se hace una vez al
cargar: 0,5-0,9 s (vista cenital y lectura 0,35-0,6 s, CPU 0,15-0,19 s), con el bucle del visor en marcha.

## Archivos

```
index.js            exportaciones
RealisticRiver1.js  creación, estado, update, dispose
surface.js          material TSL de la lámina
domain.js           horneado del dominio: vista cenital, profundidad, distancia a la orilla, obstáculos
debug.js            vistas de depuración de los mapas
gui.js              panel lil-gui (opcional)
GUIA_PANEL.md       qué hace cada control
```

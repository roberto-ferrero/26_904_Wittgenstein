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
| F2. Corriente base | Función de corriente con profundidad e islas; normales con flow map | **Hecha** |
| F3. Superficie | Color por profundidad, orilla transparente, reflejos del cielo regulables, ondas de viento | **Hecha** |
| F4. Simulación viva | Remolinos (Stable Fluids 2D en compute); las ondas siguen su velocidad | **Hecha** |
| F5. Espuma | Espuma advectada con fuentes físicas, burbujas que siguen la corriente, control de carácter | **Hecha** |
| F6. Obstáculos en caliente | `addObstacle` / `removeObstacle` sin perder los remolinos; piedras de prueba en el panel | **Hecha** |
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
| `water` | — | Obligatoria. Malla de la lámina: define la cota y la extensión. El color sale de la profundidad real del dominio, así que no necesita atributos. |
| `terrain` | `scene` | Objeto o lista de objetos que forman el lecho y las orillas. |
| `obstacles` | `[]` | Objetos, grupos o `InstancedMesh` que cuentan como obstáculos donde sobresalen de la lámina y el terreno de debajo quedaría bajo el agua. Se excluyen del terreno. |
| `cellSize` | `1` | Metros por celda del dominio. |
| `margin` | `8` | Metros de dominio alrededor de la lámina. |
| `flowCellSize` | `2` | Metros por celda de la corriente base (múltiplo de `cellSize`). |
| `flowDirection` | `[0, 0, 1]` | Sentido general aguas abajo. Solo sirve para saber qué orilla es la izquierda. |
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
| `flow` | Corriente base: `vx`, `vz` (relativas, media 1), `psi`, `sample(x, z)`, `texture` y `stats`. |
| `maps` | Texturas para shaders u otros efectos: `{ domain }`. |
| `setWind(x, z, speed)` | Viento sobre el agua para las ondas de viento: dirección hacia la que sopla (ejes de la escena) y m/s. Se puede llamar en cada fotograma. |
| `simulation` | Simulación viva: `steps`, `dispatchesPerStep`, `uniforms`, `texture`, `reset()` (ver `sim.js`). |
| `resetSimulation()` | Vuelve a poner la simulación en la corriente base (borra los remolinos). |
| `addObstacle(obj)` | Añade un obstáculo (Object3D, grupo o `InstancedMesh`) y rehornea. Cuenta donde sobresale del agua. Devuelve una promesa con las estadísticas. |
| `removeObstacle(obj)` | Quita un obstáculo y rehornea. |
| `obstacles` | Lista de obstáculos actuales. |
| `rebuild()` | Vuelve a hornear el dominio y la corriente (tras mover el terreno o un obstáculo). La corriente parte de la solución anterior y la simulación conserva sus remolinos. Los rehorneados pedidos mientras hay uno en marcha se juntan en uno. Devuelve una promesa con las estadísticas. |
| `debugViews` | Nombres de las vistas de depuración. |
| `dispose()` | Quita el río de la escena y libera su material. La geometría sigue siendo de quien la cargó. |

### `RIVER_DEFAULTS`

| Clave | Por defecto | Qué es |
|---|---|---|
| `enabled` | `true` | Río visible y actualizándose. |
| `colorShallow`, `colorDeep` | `0x9a9db5`, `0x7d8099` | Color (sRGB) con poca agua y en lo hondo. |
| `absorption` | `4` | Metros de agua para llegar a ~63 % del color de lo hondo (Beer-Lambert). |
| `shoreFade` | `1.2` | Metros de profundidad en los que la lámina pasa de transparente a opaca en la orilla. |
| `roughness` | `0.07` | Rugosidad de la lámina. |
| `reflections` | `1` | Intensidad del reflejo del cielo (`scene.environment`) solo en el agua. |
| `flowSpeed` | `1` | Velocidad media real del río (m/s). |
| `flowBoost` | `2` | Exageración visual: lo que se ve va a `flowSpeed × flowBoost`. |
| `rippleSize` | `90` | Metros por repetición de la capa grande de ondas (la fina es 0,37 veces). |
| `rippleStrength` | `0.3` | Fuerza del mapa de normales; sube hasta ×1,35 donde el agua corre más. |
| `flowCycle` | `4` | Segundos por ciclo del flow map: más largo, más recorrido de cada fase y más estiramiento. |
| `character` | `0.35` | Carácter, de espejo calmo (0) a río hidráulico (1): escala la cantidad y la visibilidad de la espuma. |
| `foamAmount` | `1` | Cantidad general de espuma (se multiplica por el carácter). |
| `foamLife` | `15` | Segundos de vida de la espuma. |
| `foamShear`, `foamConvergence`, `foamImpact`, `foamBank`, `foamShallow` | `1.5`, `1.5`, `1`, `0.5`, `0.3` | Peso de cada fuente: remolinos y cizalla, convergencia, choque con orillas y piedras, orillas, bajíos. |
| `foamColor` | `0xeeeef4` | Color de la espuma (sRGB). |
| `foamSize` | `5` | Metros por repetición de las burbujas (la capa fina es 0,4 veces). |
| `foamSharpness` | `3` | Contraste del umbral: más alto, vetas más definidas. |
| `simulation` | `true` | Simulación viva activa. Sin ella las ondas siguen la corriente base (calidad baja, sin coste de compute). |
| `simRate` | `30` | Pasos de simulación por segundo (a paso fijo; como mucho 2 por fotograma). |
| `vorticity` | `0.4` | Confinamiento de vorticidad. |
| `relaxTime` | `30` | Segundos en los que la simulación vuelve a la corriente base. |
| `bankDrag` | `1` | Rozamiento junto a tierra (1/s): genera la cizalla de las orillas. |
| `viscosity` | `0.1` | Mezcla con los vecinos por paso. |
| `turbulence` | `1` | Siembra de perturbaciones junto a orillas y obstáculos (× velocidad media por s). |
| `turbScale` | `30` | Metros de las perturbaciones sembradas (tamaño típico de los remolinos). |
| `pressureIterations` | `20` | Iteraciones de Jacobi de la proyección. |
| `windRipples` | `0.25` | Fuerza de las ondas de viento a 10 m/s (crece con el viento hasta ×1,5). |
| `windSize` | `7` | Metros por repetición de las ondas de viento. |
| `debugView` | `'Ninguna'` | Vista de depuración: `'Orilla (distancia con signo)'`, `'Profundidad'`, `'Obstáculos'`, `'Lecho (altura)'`, `'Corriente base (velocidad)'` (con la simulación activa muestra su velocidad), `'Corriente base frente a _flujo'` o `'Simulación (vorticidad)'` o `'Espuma (densidad)'`. Pinta el mapa sobre la lámina sin luz. |

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
(las rocas al pie del promontorio de la torre). Lo que queda fuera del terreno (sin geometría) no cuenta como orilla:
por ahí entra y sale el río.

## Corriente base (F2)

Flujo medio estacionario que respeta el caudal (`baseflow.js`), en una rejilla de 2 m. Se resuelve la función de
corriente ψ del caudal por unidad de ancho con `∇·(∇ψ / h) = 0`:

- ψ = 0 en la orilla derecha y 1 en la izquierda (mirando aguas abajo). Las dos orillas son las dos zonas secas más
  grandes; el resto (rocas, islotes) son islas con ψ constante libre, igual a la media ponderada de su contorno.
- Contorno abierto donde el agua llega a lo vacío (entrada y salida del río).
- Estimación inicial con la distancia a cada orilla y Gauss-Seidel rojo-negro sobrerrelajado (ω = 1,9) hasta que
  ψ cambia menos de 10⁻⁶ por iteración.
- Velocidad `u = (−∂ψ/∂z, ∂ψ/∂x) / h`, con la profundidad mínima a 0,5 m. Se normaliza a media 1 y se recorta a 3:
  el material la multiplica por `flowSpeed × flowBoost`.

Textura `RGBA` de media precisión: R, G = velocidad relativa (x, z), B = rapidez relativa, A = ψ.

En la escena v10: 280 × 758 celdas, 78 k con agua, 14 islas, 444 iteraciones y ~1,3 s en CPU al cargar. La vista
**Corriente base frente a _flujo** compara con la tangente del eje que trae la lámina: coinciden en casi todo el río
y difieren donde deben, alrededor de la punta del castillo y del promontorio de la torre.

Limitación conocida: un flujo potencial corre más por el interior de las curvas. En un meandro real lo más rápido se
desplaza al exterior por las corrientes secundarias. La simulación de la F4 lo corregirá en parte; si no basta, se
añadirá un término de curvatura.

### Normales con flow map

El mapa de normales se desplaza con la corriente en dos fases desfasadas medio ciclo, que se funden para esconder el
reinicio. Cada punto lleva un desfase de fase con ruido, así que no hay latido común. Hay dos capas (90 m y 33 m por
repetición), la fina algo más rápida, y la fuerza crece con la rapidez local.

## Simulación viva (F4)

Fluido incompresible promediado en la vertical (Stable Fluids) en compute (`sim.js`), sobre la rejilla de la
corriente base (280 × 758 celdas de 2 m), a 30 pasos por segundo. Cada paso:

1. Advección semilagrangiana de la velocidad.
2. Vorticidad y confinamiento de vorticidad.
3. Rozamiento junto a tierra (cizalla), viscosidad (quita el ruido de una celda), turbulencia junto a tierra y
   relajación hacia la corriente base. La turbulencia es el rotacional de un ruido 3D (posición y tiempo), sin
   divergencia, en una banda de 24 m junto a orillas y obstáculos: siembra las perturbaciones que la cizalla enrolla
   en remolinos, que luego viajan río abajo.
4. Proyección ponderada por la profundidad, `∇·(h ∇p) = ∇·(h u)`, con 20 iteraciones de Jacobi y la presión del
   paso anterior como punto de partida. Contorno cerrado en tierra y abierto (p = 0) donde el río entra y sale; por
   la entrada llega el agua con la corriente base.
5. Salida a una textura RGBA16F: velocidad relativa (x, z), rapidez relativa y vorticidad. Las ondas del flow map
   siguen esta velocidad en lugar de la corriente base.

Velocidades en m/s ya exageradas (`flowSpeed × flowBoost`). Son 26 dispatches por paso sobre 212 k celdas.

En la escena v10 salen remolinos de 20-60 m que nacen en las orillas, la punta del castillo y el promontorio de la
torre, con giros alternos, y viajan con la corriente; la vista **Simulación (vorticidad)** los pinta en rojo y azul.
Desde "Camera" apenas se ven en las ondas: la espuma de la F5 es la que los hará visibles.

Pendiente respecto al plan: no hay interpolación entre pasos (con campos tan lentos no se nota) ni corrección
BFECC/MacCormack; la turbulencia sembrada y la viscosidad bastan para remolinos coherentes.

## Obstáculos en caliente y piedras futuras (F6)

`river.addObstacle(obj)` y `river.removeObstacle(obj)` rehornean sin recargar:

1. Dominio: las dos vistas cenitales con el obstáculo nuevo (~0,4-0,6 s, casi todo espera de la lectura de la GPU; el
   bucle del visor sigue).
2. Corriente base: parte de la solución anterior en el agua (en la escena v10, 218 iteraciones en lugar de 444;
   ~0,9 s de CPU, que sí congelan la imagen ese rato).
3. Simulación: si la rejilla no cambia, solo se suben los datos fijos nuevos (base, profundidad, tipo, cercanía a
   tierra). La velocidad y la espuma siguen, así que los remolinos no se pierden; donde ahora hay piedra la velocidad
   pasa a 0 y aguas arriba aparece espuma de choque.

En total ~1,4 s por piedra en la escena v10. Si hiciera falta que no congele, el cálculo de la corriente puede pasar
a un Worker.

**Piedras de prueba** (panel, Agua → Piedras de prueba): coloca una piedra (icosaedro deformado) del tamaño elegido
en el agua donde mira el centro de la vista (si ahí no hay al menos 1,5 m de agua, busca el punto así más cercano en
60 m) y la añade como obstáculo. Sirve para tantear posiciones antes de modelar las de verdad. Con una piedra de 8 m
en mitad del río sale una media luna de espuma aguas arriba, una pareja de remolinos de giro contrario detrás y una
estela de espuma.

**Cómo añadir las piedras definitivas** (recomendado):

1. En Blender, modelarlas en una colección propia (por ejemplo `Rocas_Rio`), con la base hundida en el lecho y la
   parte de arriba por encima de la cota del agua (y = 1,9 en Three.js).
2. Exportarlas en el .glb del terreno (o en uno aparte).
3. En el visor, pasarlas como obstáculos: en `crearRioRealista` (`src/escena/agua.js`) añadir el grupo a `obstacles`
   al crear el río, o llamar a `rio.addObstacle(grupo)` cuando se carguen. Solo cuenta la parte que corta la lámina,
   así que da igual si alguna queda sumergida (entonces solo cambia la profundidad).

## Espuma (F5)

La espuma es un escalar de densidad en la rejilla de la simulación (`sim.js`): se advecta con la velocidad, decae
con `foamLife` y nace donde el agua la produce. Cada fuente se satura (`1 − e^(−x)`) para que una zona muy activa no
llene de blanco todo lo que tiene aguas abajo:

- **Remolinos y cizalla**: vorticidad marcada (por encima de la que da la propia corriente).
- **Convergencia**: `∇·u < 0`, donde el agua se junta y deja líneas de espuma.
- **Choque**: la corriente va hacia una orilla o una piedra (estancamiento aguas arriba).
- **Orillas**: encaje fino en las 1-2 celdas pegadas a tierra, más donde el agua corre.
- **Bajíos**: menos de ~2 m de agua con corriente.

La capa de cizalla pegada a tierra es permanente, así que no cuenta para remolinos ni convergencia (si no, toda la
orilla sería una banda blanca de 40 m; fue lo que salió en la primera prueba).

En el material (`surface.js`), la densidad se multiplica por una textura de burbujas (`foamTexture.js`: red celular
repetible generada al cargar) desplazada con el mismo flow map que las ondas, y se umbraliza para que salgan vetas y
no manchas. La espuma sube el albedo y la rugosidad, aplana las ondas y es opaca también en la orilla transparente.
De lejos, el mipmap de las burbujas deja la densidad media, así que las líneas se siguen viendo.

**Carácter**: un solo control de espejo (0) a hidráulico (1) que escala la cantidad de espuma y su visibilidad.
Conjuntos del visor: "Río de la ilustración" (carácter 0,15) y "Río hidráulico" (0,85, con más turbulencia y menos
reflejo para que la espuma contraste).

Desde "Camera" la espuma se lee como encaje blanco en las orillas y la punta del castillo; con la niebla y el reflejo
del cielo tan claros el contraste es suave. En vista aérea se ven las manchas en los remolinos y los rizos detrás del
promontorio.

## Superficie (F3)

- **Color por profundidad**: `mix(colorShallow, colorDeep, 1 − e^(−profundidad / absorption))` con la profundidad
  real del dominio (antes era el atributo `_profundidad`, que saturaba a 12 m y venía cada 3 m).
- **Orilla transparente**: la opacidad sube de 0 a 1 en los primeros `shoreFade` metros de agua. Se ve el lecho en
  los bajíos, no hay línea dura contra el terreno y la lámina desaparece donde pasa bajo la orilla. El material es
  transparente (se dibuja después de lo opaco).
- **Ondas de viento**: tercera capa del mapa de normales que se desplaza con el viento (`setWind`), a un 4 % de su
  velocidad (como mucho 1,2 m/s), sin flow map porque el viento es uniforme.
- **Reflejos del cielo**: el material toma `scene.environment` como `envMap` propio (en los materiales de nodos
  `envMapIntensity` solo actúa sobre el `envMap` del material), así que `reflections` regula el reflejo solo en el
  agua. Si el cielo rehace el entorno, el río lo vuelve a tomar en `update`.

## Integración con el cielo

La lámina es un `MeshStandardNodeMaterial`, así que recibe sin código propio la perspectiva aérea y la niebla en capa
de VolumetricSky1 (`scene.fogNode`), los reflejos del cielo y las nubes (`scene.environment`, regulables con
`reflections`) y el sol con sus sombras. En el visor, las ondas de viento siguen la dirección del viento de la
vegetación y la velocidad del viento de las nubes, con la orientación del escenario.

## Rendimiento

Medido en el visor de la escena v10 a 1920 × 1080 con la GPU sincronizada (`await renderFrames(120)`):

| Vista | Con el río | Sin el río |
|---|---|---|
| "Camera" | 11,0-11,4 ms (simulación y espuma) | 10,4 ms (sin simulación) |
| Aérea | 8,6 ms | 8,4 ms |

Por fotograma el río es un solo dibujo de 44.322 triángulos. Con el flow map, las ondas de viento y el color por
profundidad (cinco lecturas del mapa de normales, una de la corriente, una del dominio y un ruido) cuesta ~0,4-0,6 ms
desde "Camera"; la variación entre medidas es de ±0,3 ms. La simulación con la espuma cuesta ~0,7-0,8 ms por fotograma a 60 fps (unos 1,6 ms por paso, uno de cada dos fotogramas); se puede
bajar con menos iteraciones de presión o menos pasos por segundo. Al cargar
se hace una vez el horneado del dominio (0,5-0,9 s) y la corriente base (~1,3 s), con el bucle del visor en marcha.

## Archivos

```
index.js            exportaciones
RealisticRiver1.js  creación, estado, update, dispose
surface.js          material TSL de la lámina
domain.js           horneado del dominio: vista cenital, profundidad, distancia a la orilla, obstáculos
baseflow.js         corriente base: función de corriente con profundidad e islas
sim.js              simulación viva en compute: remolinos, cizalla, proyección por profundidad, espuma
foamTexture.js      textura repetible de burbujas, generada al cargar
testRock.js         piedras de prueba del panel y punto del agua en el centro de la vista
debug.js            vistas de depuración de los mapas, la corriente y la vorticidad
gui.js              panel lil-gui (opcional)
GUIA_PANEL.md       qué hace cada control
```

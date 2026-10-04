# Plan: RealisticRiver1

Río con corriente visible para el visor de la escena v10 (Three.js r186, `WebGPURenderer` + TSL): flujo que sigue el
cauce, remolinos en las márgenes y detrás de los obstáculos, y espuma que deja ver el comportamiento hidráulico. Se
hace como módulo autocontenido y reutilizable, igual que [VolumetricSky1](../src/VolumetricSky1/README.md).

Estado: **aprobado; en construcción**. Hecho: F0, F1, F2, F3, F4, F5.

---

## 1. Punto de partida (lo que ya hay)

Revisado en `public/escena/escena_terreno_draco.glb`, `escena_datos.json`, `src/escena/agua.js` y en el generador de la
escena (`Claude working folder/escena_v10/build_escena.py` y `terreno_lib.py`).

| Dato | Qué es | Valoración |
|---|---|---|
| Malla `Agua` | Lámina plana a y = 1,9, rejilla de ~3 m (22.940 vértices, 44.322 triángulos). Caja x −324…220, z −1000…500. | Sirve tal cual como superficie: el agua es plana y el detalle lo dan las normales. No hace falta desplazar vértices a esa distancia. |
| `_profundidad` | 0 en la orilla, 1 a 12 m o más (por vértice, cada ~3 m). | Útil para el color, pero satura a 12 m y es demasiado gruesa junto a una piedra. Mejor un mapa de profundidad real horneado del terreno. |
| `_flujo_x`, `_flujo_z` | Dirección unitaria: la tangente del eje del río en el punto más cercano del eje. | No es una corriente de verdad: no conserva el caudal, en las curvas apunta contra la orilla, no rodea obstáculos y no tiene remolinos. Vale como referencia y como plan B. |
| `_velocidad` | `(1 − través²) · (0,35 + 0,65 · profundidad)`. | Heurística razonable; la sustituye el cálculo de corriente. |
| `_a_lo_largo`, `UVCauce` (uv1) | Metros desde la entrada norte; u de orilla a orilla, v = metros / 40. | Útil para depurar y como plan B (desplazar texturas a lo largo). |
| Terreno | Cauce en U hasta −11 m (~13 m de agua), río de 2,1 km de eje y ~100-150 m de ancho, de norte (−Z) a sur (+Z). | Con una vista cenital del terreno se obtiene el lecho exacto, también bajo piedras futuras. |
| Rocas | 520 instancias (`InstancedMesh`), algunas al pie del promontorio de la torre y dentro del agua. | Las que cortan la lámina deben contar como obstáculos desde el principio. |
| Cielo | `scene.environment` (PMREM con cielo y nubes), `scene.fogNode` (perspectiva aérea y niebla en capa), sol y viento. | El material del río usa los tres sin duplicar nada: los reflejos del cielo y la niebla llegan gratis a un `MeshStandardNodeMaterial`. |

Encuadre: desde "Camera" (lente de 50 mm, fov vertical 22,9°) el agua visible está a 200-900 m y se ve muy rasante.
Un píxel cubre ~0,15 m de lado y ~1 m de fondo a 400 m. Consecuencias para el diseño:

- Lo que se lee desde la cámara son **líneas de espuma, estelas, remolinos grandes y la distorsión de los reflejos**. El
  oleaje fino solo modula el brillo.
- Una rejilla de simulación de 1-2 m basta para el flujo. El detalle fino lo ponen texturas que se desplazan con él.
- En vista aérea (OrbitControls) sí se ve el campo entero, así que el flujo tiene que ser coherente en todo el río, no
  solo en el encuadre.

La ilustración de Ian Miller pinta el río como un espejo lila, muy calmo, con reflejos y bruma. Un río hidráulico con
mucha espuma la contradice, así que el módulo tendrá un único control de **carácter** (de espejo a hidráulico). Ver la
duda 1.

---

## 2. Arquitectura del módulo

```
src/RealisticRiver1/
  index.js              exporta createRealisticRiver1, RIVER_DEFAULTS, QUALITY
  RealisticRiver1.js    creación, update(dt), estado, apply(), obstáculos, dispose()
  domain.js             dominio: vista cenital del terreno → lecho, máscara, distancia a orilla, profundidad
  baseflow.js           corriente base estacionaria (función de corriente con profundidad e islas)
  sim.js                simulación viva 2D en compute: advección, vorticidad, proyección, espuma
  obstacles.js          rasteriza obstáculos (cualquier Object3D) en el mapa de obstáculos
  surface.js            material TSL de la lámina: normales con flow map, espuma, color, Fresnel, orilla
  reflection.js         reflejo plano opcional de la escena (castillo, torre, orillas)
  debug.js              vistas de depuración: máscara, distancia, profundidad, velocidad (LIC), vorticidad, espuma
  gui.js                panel lil-gui (aparte, para no obligar a instalar lil-gui)
  textures/             normales de detalle y textura de espuma (generadas, como el ruido de las nubes)
  tools/gen-textures.mjs
  README.md, GUIA_PANEL.md
```

### Uso previsto

```js
import { createRealisticRiver1 } from './RealisticRiver1/index.js';
import { addRealisticRiver1Gui } from './RealisticRiver1/gui.js';

const river = await createRealisticRiver1({
  renderer, scene, camera,
  water: mallaAgua,            // lámina (define la cota y la extensión); el módulo crea su propia malla con ella
  terrain: terreno,            // lo que forma el lecho y las orillas (se lee con una vista cenital)
  obstacles: [ rocas ],        // opcional: Object3D o InstancedMesh; solo cuenta lo que corta la lámina
  flowDirection: [ 0, 0, 1 ],  // opcional: sentido general si no se dan entrada y salida
  settings: { character: 0.35, discharge: 1 },
});
addRealisticRiver1Gui( river, gui );

// en el bucle, después de sky.update(dt) y antes de renderer.render
river.update( dt );

river.addObstacle( piedraNueva );   // re-rasteriza, recalcula la corriente base y la simulación reacciona
river.removeObstacle( piedraNueva );
```

| Miembro | Qué es |
|---|---|
| `object` | La malla de la lámina, ya añadida a la escena. |
| `update(dt)` | Un paso: simulación (a paso fijo), espuma, reflejo si está activo. |
| `state`, `apply()` | Parámetros; tras cambiarlos a mano, `apply()`. |
| `addObstacle`, `removeObstacle`, `rebuild()` | Obstáculos en caliente; `rebuild()` rehace dominio y corriente base. |
| `maps` | Texturas del dominio, la corriente base, la velocidad viva y la espuma (para depurar o para otros efectos, p. ej. barcas que derivan). |
| `sampleVelocity(x, z)` | Velocidad en un punto (lectura asíncrona, para objetos flotantes). |
| `dispose()` | Libera todo. |

En el visor, `src/escena/agua.js` pasa a ser un adaptador con la firma actual (`{ objeto, actualizar, gui }`), así que
`main.js` solo cambia una línea y el agua plana sigue disponible como alternativa. Los controles del panel entran solos
en la URL y en los conjuntos de `src/presets/`, porque `urlState` lee las carpetas de lil-gui.

---

## 3. Técnica

La idea es separar lo caro y estático de lo barato y vivo:

```
terreno + lámina + obstáculos ──(al cargar o al añadir una piedra)──► DOMINIO ──► CORRIENTE BASE
                                                                                     │
                                                       cada paso (30 Hz) ◄───────────┘
                                         SIMULACIÓN VIVA (remolinos) ──► ESPUMA ──► MATERIAL
```

### 3.1 Dominio (se calcula al cargar, en el navegador)

Una rejilla alineada con el mundo que cubre la caja de la lámina con un margen (560 × 1516 m). El horneado va a 1 m
(576 × 1536) porque se hace una sola vez; la simulación usa la misma rejilla a 2 m por defecto (288 × 768).

1. **Lecho**: una vista cenital ortográfica del terreno (y de los obstáculos) guarda la altura en cada celda.
2. **Máscara y profundidad**: agua donde el lecho queda por debajo de la cota; profundidad real en metros, sin saturar.
3. **Distancia con signo a la orilla**: transformada de distancia exacta en CPU (Felzenszwalb, ~0,15 s); en el plan
   inicial era Jump Flooding en compute, pero así es exacta y no depende del backend. Da la orilla, la banda de espuma de la
   margen, la condición de contorno de la simulación y el desvanecido de la lámina en la orilla.
4. **Obstáculos**: los que cortan la lámina se rasterizan desde arriba con un plano de corte a la cota del agua.

Todo cabe en una textura RGBA16F (distancia, profundidad, obstáculo, libre). Coste: unas decenas de milisegundos al
cargar. Opcionalmente se guarda en caché como `.bin` (igual que `npm run gen:clouds`) para no recalcular.

### 3.2 Corriente base (estacionaria, al cargar y al cambiar obstáculos)

En un río ancho y hondo la corriente media es casi un flujo potencial que respeta el caudal. Se calcula la **función
de corriente ψ** del caudal por unidad de ancho (q = h·u), resolviendo `∇·(∇ψ / h) = 0` en el agua:

- ψ = 0 en la orilla izquierda y ψ = Q en la derecha (Q = caudal), con una entrada al norte y una salida al sur.
- Cada obstáculo es una isla con ψ constante libre (el agua pasa por los dos lados en la proporción que toca).
- La velocidad es `u = (∂ψ/∂z, −∂ψ/∂x) / h`: no se sale del cauce, rodea las piedras y se acelera en los bajíos y
  estrechamientos, y se frena en las pozas. Es lo que hace legible el comportamiento hidráulico.

Se resuelve en CPU con Gauss-Seidel rojo-negro sobrerrelajado a 2 m de celda (444 iteraciones y ~1,3 s al cargar en
la escena v10; en el plan inicial era en GPU). Al añadir una piedra se podrá partir de la solución anterior. Se compara con `_flujo_x/_flujo_z` para validar el sentido.

Con solo esto el río ya se mueve bien a coste casi nulo por fotograma, y sirve de modo "bajo" y de alternativa para
WebGL 2.

### 3.3 Simulación viva: remolinos y vórtices

El flujo potencial no se separa de las orillas ni deja estela, así que los remolinos salen de una simulación 2D ligera
que se suma a la corriente base: **fluido incompresible promediado en profundidad** (Stable Fluids en compute):

1. Advección semilagrangiana con corrección BFECC/MacCormack (sin ella la difusión numérica se come los remolinos).
2. Confinamiento de vorticidad para mantenerlos vivos.
3. Rozamiento con las orillas y los obstáculos (no deslizamiento en una banda fina) y rozamiento del lecho según la
   profundidad: genera el cizallamiento que desprende los vórtices.
4. Proyección ponderada por la profundidad, `∇·(h ∇p) = ∇·(h u*)` (aproximación de tapa rígida), con ~20 iteraciones
   y la solución anterior como punto de partida.
5. La velocidad viva tiende a la base con una constante de tiempo, para que el río no derive con el tiempo.

Así aparecen sin colocarlos a mano las zonas de recirculación detrás del promontorio de la torre y del risco del castillo,
los remolinos en los entrantes de las orillas y la calle de vórtices de Kármán detrás de una piedra. Para piedras más
pequeñas que la celda se añade un término de vórtices inyectados (estela procedural) que se apoya en el mismo campo.

Medido (F4): ~0,8 ms por fotograma a 60 fps con 20 iteraciones de presión; la estimación inicial era 0,3-0,6 ms por paso a 2 m (288 × 768, con el 25 % de celdas con agua).
Corre a paso fijo de 30 Hz con interpolación entre pasos, así que pesa la mitad a 60 fps. A 1 m de celda (calidad alta)
se multiplica por cuatro.

Alternativas descartadas como base:

| Técnica | Por qué no |
|---|---|
| Solo flow map pintado (Blender o a mano) | Barato, pero no reacciona a piedras nuevas, no tiene remolinos vivos y hay que repintarlo con cada cambio. Se puede añadir como capa de ajuste artístico (duda 7). |
| Ecuaciones de aguas someras completas | Dan olas y resaltos que este río no tiene; más caras e inestables con 13 m de fondo. |
| Partículas (SPH/FLIP) en 3D | Fuera de presupuesto a 60 fps para 2 km de río. |
| Ruido de rizo (curl noise) solo | Remolinos bonitos pero sin relación con las orillas ni con las piedras. Se usa como detalle fino encima. |

### 3.4 Espuma

Un escalar de densidad de espuma en la misma rejilla, advectado con la velocidad viva y con decaimiento. Fuentes con
base física, cada una con su peso en el panel:

- **Cizallamiento y vorticidad** (|ω| alto): bordes de los remolinos y líneas de separación.
- **Convergencia** (∇·u < 0 en superficie): la espuma se acumula en líneas donde el agua converge, como en los ríos de
  verdad. Es lo que más ayuda a leer la corriente.
- **Obstáculos**: punto de estancamiento aguas arriba y estela detrás.
- **Orilla**: banda fina según la distancia a la orilla y la velocidad junto a ella.
- **Bajíos**: poca profundidad con velocidad alta.

En el material la densidad se convierte en espuma con textura (generada en `tools/`) que se desplaza con el flujo y se
umbraliza para dar vetas en lugar de manchas. La espuma sube el albedo y la rugosidad, recibe sombra y la niebla la
cubre como al resto.

### 3.5 Superficie (material TSL)

- **Normales con flow map**: dos fases desfasadas medio ciclo con ruido de fase por celda (sin el "latido" típico),
  amplitud según la velocidad y la turbulencia, y dos escalas de detalle. Un tercer término de viento sigue la dirección
  del viento del cielo.
- **Color por profundidad**: absorción de Beer-Lambert con la profundidad real, del lila pálido de la ilustración en los
  bajíos al tono hondo en el centro.
- **Orilla**: transparencia según la profundidad para que el lecho se vea en los primeros decímetros y no haya línea
  dura contra el terreno, más una banda húmeda.
- **Reflejos**: Fresnel con `scene.environment` del cielo (incluye nubes y se rehace con el sol) y brillo del sol con la
  rugosidad baja. La niebla en capa y la perspectiva aérea llegan por `scene.fogNode`, sin código propio.
- **Reflejo de la escena** (opcional): la ilustración refleja la torre y las barcas. Un reflejo plano a media resolución
  del castillo, la torre y el terreno (vegetación en LOD1 y sin el pase de nubes), distorsionado con las normales. Es
  la parte más cara (estimado 1,5-3 ms), así que va en su propia fase y con interruptor (duda 2).

### 3.6 Presupuesto

Hoy el visor va a 9,1 ms desde "Camera". Objetivo del río completo: **≤ 2 ms** en "Camera" a 1920 × 1080 sin reflejo de
escena (simulación ~0,3 ms amortizada, material ~0,4 ms, espuma ~0,1 ms), y ≤ 4 ms con él. Se mide en cada fase con
`await renderFrames(60)` y se apunta en el README del módulo. Niveles de calidad: bajo (solo corriente base), medio
(simulación a 2 m), alto (1 m).

---

## 4. Mapas: cuáles sirven y de dónde salen

| Mapa | ¿Sirve? | Para qué | Cómo se genera |
|---|---|---|---|
| Máscara de agua y distancia con signo a la orilla | **Imprescindible** | Contorno de la simulación, espuma de orilla, desvanecido de la lámina | Navegador: vista cenital + Jump Flooding |
| Profundidad (lecho) | **Sí** | Continuidad del caudal (velocidad), color, espuma en bajíos, transparencia de orilla | Navegador: vista cenital del terreno |
| Obstáculos | **Sí, pero vivo** | Islas en la corriente base, contorno de la simulación, fuentes de espuma | Navegador: se rasterizan los objetos que cortan la lámina. No es un PNG fijo: por eso añadir piedras luego no obliga a rehacer nada |
| Corrientes base | **Sí, pero calculadas** | Flujo medio, flow map de las normales, fuerza de recuperación de la simulación | Navegador: función de corriente (3.2). Los `_flujo_*` actuales solo validan |
| Ajuste artístico de corriente | Opcional | Exagerar o calmar zonas concretas para la composición | Pintado (Blender o PNG), se suma a la base (duda 7) |
| Rugosidad del lecho | No por ahora | Rizado extra en rápidos | Se deriva del gradiente de profundidad si hiciera falta |

Recomendación: **hornear todo en el navegador** al cargar. El módulo funciona así con cualquier terreno y lámina (otro
río, un lago con islas) sin pasar por Blender, y las piedras nuevas se tienen en cuenta solas. El generador de Blender
ya calcula la distancia a la orilla (`T.d`) y podría exportarla, pero eso ata el módulo a esta escena.

---

## 5. Fases y entregables

Cada fase deja el visor funcionando, con captura desde "Camera" y aérea, y medición de ms en el README.

| Fase | Qué se hace | Entregable |
|---|---|---|
| **F0. Esqueleto** ✅ | Carpeta del módulo, adaptador en `src/escena/agua.js`, material que reproduce el agua actual, panel vacío y medición de partida. | El visor igual que hoy pero con el agua servida por RealisticRiver1. |
| **F1. Dominio** ✅ | Vista cenital, máscara, profundidad, distancia a la orilla, obstáculos desde las 520 rocas. Vistas de depuración. | Panel "Depuración" que pinta cada mapa sobre el agua. |
| **F2. Corriente base** ✅ | Función de corriente con profundidad e islas, velocidad, vista LIC/flechas, comparación con `_flujo_*`. Primer material con normales desplazadas por el flow map. | El río ya fluye hacia la cámara, rodea las rocas y se acelera en los estrechamientos. Modo de calidad "bajo" terminado. |
| **F3. Superficie** ✅ | Material completo: flow map sin latido, color por profundidad, orilla transparente, Fresnel con el entorno del cielo, viento, integración con la niebla. | Agua con aspecto final sin simulación viva; preset "Ilustración". |
| **F4. Simulación viva** ✅ | Stable Fluids en compute con BFECC, vorticidad, proyección ponderada, rozamiento, paso fijo e interpolación. | Remolinos detrás del promontorio de la torre y en las orillas, visibles en la vista de vorticidad y en el agua. |
| **F5. Espuma** ✅ | Advección, fuentes (cizalla, convergencia, obstáculos, orilla, bajíos), textura y umbral. | Líneas de espuma que dibujan la corriente; control de carácter de espejo a hidráulico. |
| **F6. Obstáculos en caliente** | `addObstacle` / `removeObstacle`, re-horneado incremental, botón de piedra de prueba en el panel. | Una piedra añadida en ejecución genera estela y espuma sin recargar. Guía para las piedras futuras. |
| **F7. Reflejo de la escena** (opcional) | Reflejo plano a media resolución con capas, distorsión por normales; alternativa SSR si sale caro. | Torre y castillo reflejados como en la ilustración, con su coste medido. |
| **F8. Cierre** | README y GUIA_PANEL del módulo, presets ("Ilustración", "Hidráulico"), claves en la URL, alternativa WebGL 2 (solo corriente base), `sampleVelocity`. | Módulo copiable a otro proyecto, como VolumetricSky1. |

F1-F3 dan el grueso del resultado visual a coste casi nulo; F4-F5 son lo que añade remolinos y espuma "de verdad".

---

## 6. Riesgos

- **Difusión numérica**: a 2 m de celda los remolinos pequeños se apagan. Mitigación: BFECC, vorticidad y vórtices
  inyectados para obstáculos menores que la celda.
- **Lectura rasante**: desde "Camera" el agua se comprime mucho en profundidad; la espuma tiene que ser más ancha que en
  la realidad para leerse. Se ajusta con el carácter y se valida con capturas.
- **Coste del reflejo plano**: repite la escena (1,7 M triángulos con la vegetación). Por eso va en fase propia y con
  capas, resolución reducida e interruptor.
- **WebGL 2**: las texturas de almacenamiento en compute no existen ahí; el módulo cae a la corriente base sin
  simulación viva.

---

## 7. Dudas para Roberto

Cada una con mi opción recomendada. Si no hay respuesta, sigo con la recomendada.

1. **Carácter por defecto.** La ilustración pinta un espejo calmo; un río "hidráulico" tiene espuma visible.
   - **Recomendado:** un control de carácter de 0 (espejo) a 1 (hidráulico), arrancando en ~0,35: reflejo dominante y
     espuma solo en orillas, obstáculos y la estela de la torre. Presets "Ilustración" e "Hidráulico".
   - Alternativa: priorizar la lectura hidráulica (espuma abundante) por encima de la fidelidad a la ilustración.
2. **Reflejo de la torre y el castillo en el agua** (F7, 1,5-3 ms).
   - **Recomendado:** sí, a media resolución y sin vegetación LOD0, con interruptor; si pasa de 3 ms, SSR.
   - Alternativa: solo reflejo del cielo, sin coste extra.
3. **Velocidad del río.** Un río así de ancho y hondo va a 0,5-1,5 m/s, lo que desde 400 m se ve casi quieto.
   - **Recomendado:** caudal físico de ~1 m/s de media con un multiplicador visual en el panel (arrancando en ×2).
   - Alternativa: velocidad física estricta.
4. **Dónde se hornean los mapas.**
   - **Recomendado:** en el navegador al cargar, con caché opcional en `.bin`.
   - Alternativa: en Blender, ampliando `build_escena.py`.
5. **Resolución de la simulación.**
   - **Recomendado:** 2 m por defecto (calidad media) y 1 m como calidad alta.
   - Alternativa: 1 m por defecto si la medición deja margen.
6. **Rocas actuales que tocan el agua** (pie del promontorio de la torre).
   - **Recomendado:** contarlas como obstáculos automáticamente desde F1.
   - Alternativa: ignorarlas hasta que lleguen las piedras nuevas.
7. **Ajuste artístico de la corriente** (pintar zonas para exagerar o calmar).
   - **Recomendado:** dejarlo fuera del plan y añadirlo solo si la composición lo pide.
   - Alternativa: incluir una capa pintable desde F3.
8. **Cómo llegarán las piedras nuevas.**
   - **Recomendado:** como colección de Blender exportada en un .glb (p. ej. `Rocas_Rio`), que el visor pasa a
     `river.addObstacle`; además, un botón de piedra de prueba en el panel para tantear posiciones.
   - Alternativa: colocarlas directamente en el navegador y guardar sus posiciones en la URL o en un preset.
9. **Rama de trabajo.**
   - **Recomendado:** seguir en `realistic-river1` (creada desde `volumetric-sky1`, con este plan) y abrir PR contra
     `volumetric-sky1` al cerrar cada bloque de fases.
   - Alternativa: una rama por fase.

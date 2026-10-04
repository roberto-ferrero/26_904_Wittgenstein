# Panel de RealisticRiver1

En el visor está en la carpeta **Agua**. Todos los controles (salvo la depuración y las piedras de prueba) se guardan
en la URL y en los conjuntos de configuración. Conjuntos del visor: **Río de la ilustración** (agua lila calma, casi
espejo) y **Aguas bravas intensas** (crecida); el arranque es de aguas bravas turquesa.

| Control | Rango | Qué hace |
|---|---|---|
| carácter (espejo → hidráulico) | 0-1 | 0 = espejo calmo, casi sin espuma (como la ilustración); 1 = río hidráulico, con espuma en remolinos, orillas y choques. |
| color orilla | color | Color del agua donde hay poca profundidad. |
| color fondo | color | Color del agua en lo hondo. Entre los dos se mezcla según la profundidad real. |
| absorción (m) | 0,2-20 | Cuánta agua hace falta para llegar al color del fondo: más bajo, el color hondo aparece enseguida. |
| orilla transparente (m) | 0-3 | Profundidad en la que el agua pasa de transparente a opaca junto a la orilla. 0 = borde duro. |
| rugosidad | 0-1 | 0 = espejo; más alto, reflejos más difusos y brillo del sol más ancho. |
| reflejos del cielo | 0-3 | Intensidad del reflejo del cielo y las nubes solo en el agua (el control del cielo afecta a toda la escena). |
| velocidad del río (m/s) | 0-4 | Velocidad media real del agua. Un río así va a 0,5-1,5 m/s. |
| exageración de la velocidad | 0-10 | Multiplica lo que se ve: desde lejos, la velocidad real parece casi quieta. |
| tamaño ondas (m) | 2-300 | Metros por repetición de la capa grande de ondas (la fina es 0,37 veces). |
| fuerza ondas | 0-1,5 | Cuánto deforman las ondas los reflejos; más donde el agua corre más. |
| **Remolinos (simulación)** | | Carpeta con la simulación viva: |
| · activa | sí/no | Sin ella las ondas siguen la corriente base, sin remolinos ni espuma y sin coste de compute. Con WebGL 2 sale desactivada ("necesita WebGPU"). |
| · confinamiento de vorticidad | 0-3 | Mantiene vivos los remolinos. Muy alto, aparece ruido de celda. |
| · vuelta a la corriente base (s) | 1-120 | Corto, el río vuelve enseguida a la corriente media y hay menos remolinos; largo, viven más. |
| · rozamiento en orillas (1/s) | 0-10 | Cuánto frena el agua junto a tierra: más cizalla y más remolinos en las orillas. |
| · turbulencia junto a tierra | 0-5 | Perturbaciones sembradas junto a orillas y obstáculos que se enrollan en remolinos. 0 = solo cizalla. |
| · tamaño de la turbulencia (m) | 4-120 | Tamaño típico de los remolinos sembrados. |
| · turbulencia en todo el cauce | 0-1 | Turbulencia también lejos de las orillas (aguas bravas). 0 = solo junto a tierra. |
| · viscosidad | 0-0,5 | Suaviza la velocidad y quita el ruido de una celda; muy alta, apaga los remolinos. |
| · iteraciones de presión | 2-80 | Precisión de la proyección (que el caudal se conserve). Menos, más barato. |
| · pasos por segundo | 10-60 | Frecuencia de la simulación. Menos, más barato. |
| · ⟲ Reiniciar los remolinos | | Vuelve a la corriente base. |
| **Espuma** | | Carpeta (necesita la simulación activa): |
| · cantidad | 0-4 | Cantidad general (se multiplica por el carácter). |
| · vida (s) | 1-120 | Cuánto dura la espuma: más larga, vetas más largas río abajo. |
| · en remolinos y cizalla | 0-5 | Espuma en los bordes de los remolinos. |
| · donde converge el agua | 0-5 | Líneas de espuma donde el agua se junta. |
| · choque con orillas y piedras | 0-5 | Espuma donde la corriente va contra tierra. |
| · a lo largo de las orillas | 0-5 | Encaje fino pegado a la orilla. |
| · en bajíos | 0-5 | Espuma donde hay poca agua y corriente. |
| · en rápidos (agua más rápida) | 0-5 | Aguas bravas: espuma que nace a puntos donde el agua corre más que la media y se estira en vetas. |
| · color | color | Color de la espuma. |
| · tamaño de las burbujas (m) | 0,5-15 | Tamaño del dibujo de burbujas. |
| · definición de las vetas | 0,5-10 | Más alto, vetas de borde más nítido; más bajo, espuma más difusa. |
| · estiramiento con la corriente | 1-12 | Cuánto se alargan las vetas en el sentido del agua. |
| ondas de viento | 0-1,5 | Fuerza de las ondas pequeñas que empuja el viento (crece con la velocidad del viento de las nubes). |
| tamaño ondas de viento (m) | 1-40 | Metros por repetición de las ondas de viento. |
| ciclo del flow map (s) | 0,5-12 | Cada cuánto se reinicia cada fase del desplazamiento. Más largo, ondas más estiradas por la corriente; más corto, se nota más el fundido. |

## Piedras de prueba

Para tantear dónde poner piedras antes de modelarlas. No se guardan en la URL.

| Control | Qué hace |
|---|---|
| tamaño (m) | Ancho aproximado de la siguiente piedra. |
| ＋ Piedra en el centro de la vista | Pone una piedra en el agua donde mira el centro de la vista (o en el punto con agua más cercano) y rehornea dominio y corriente (~1,4 s). Los remolinos siguen. |
| ✕ Quitar las piedras de prueba | Quita todas y rehornea. |
| Estado | Número de piedras y lo que tardó el último rehorneado. |

## Depuración del río

No se guarda en la URL ni en los conjuntos de configuración.

| Control | Qué hace |
|---|---|
| Vista | Pinta un mapa del dominio sobre el agua, sin luz. **Orilla**: azules en el agua (más oscuro hacia el centro), ocres en tierra, la orilla en blanco y curvas cada 5 m. **Profundidad**: amarillo en los bajíos, verde, azul y morado a 13 m, con curvas cada metro. **Obstáculos**: rojo donde una roca sobresale del agua, sobre la distancia a la orilla en grises. **Lecho**: altura del fondo con curvas cada 2 m. **Corriente base (velocidad)**: azul oscuro donde el agua va despacio, turquesa a la media, amarillo y blanco al doble o más; los puntos blancos viajan con la corriente. Con la simulación activa, la vista de velocidad muestra la de la simulación. **Simulación (vorticidad)**: rojo y azul según el sentido de giro, más intenso cuanto más gira; los puntos viajan con la corriente. **Espuma (densidad)**: de azul oscuro (nada) a blanco. **Corriente base frente a _flujo**: verde donde la dirección coincide con la que trae la lámina (`_flujo_x`, `_flujo_z`), amarillo y rojo donde difiere. |
| Dominio | Tamaño de la rejilla, celdas con agua, profundidad máxima y celdas de obstáculo. |
| Horneado | Lo que tardó el último horneado. |
| Corriente base | Tamaño de la rejilla, islas, iteraciones y tiempo del cálculo. |
| ↻ Volver a hornear dominio y corriente | Rehace los mapas y la corriente (por ejemplo, tras mover rocas). |

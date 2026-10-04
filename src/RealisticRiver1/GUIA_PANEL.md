# Panel de RealisticRiver1

En el visor está en la carpeta **Agua**. Los controles irán creciendo con cada fase del plan.

| Control | Rango | Qué hace |
|---|---|---|
| color orilla | color | Color del agua donde hay poca profundidad. |
| color fondo | color | Color del agua en lo hondo (12 m o más). Entre los dos se mezcla según la profundidad. |
| rugosidad | 0-1 | 0 = espejo; más alto, reflejos más difusos y brillo del sol más ancho. |
| velocidad del río (m/s) | 0-4 | Velocidad media real del agua. Un río así va a 0,5-1,5 m/s. |
| exageración de la velocidad | 0-10 | Multiplica lo que se ve: desde lejos, la velocidad real parece casi quieta. |
| tamaño ondas (m) | 2-300 | Metros por repetición de la capa grande de ondas (la fina es 0,37 veces). |
| fuerza ondas | 0-1,5 | Cuánto deforman las ondas los reflejos; más donde el agua corre más. |
| ciclo del flow map (s) | 0,5-12 | Cada cuánto se reinicia cada fase del desplazamiento. Más largo, ondas más estiradas por la corriente; más corto, se nota más el fundido. |

## Depuración del río

No se guarda en la URL ni en los conjuntos de configuración.

| Control | Qué hace |
|---|---|
| Vista | Pinta un mapa del dominio sobre el agua, sin luz. **Orilla**: azules en el agua (más oscuro hacia el centro), ocres en tierra, la orilla en blanco y curvas cada 5 m. **Profundidad**: amarillo en los bajíos, verde, azul y morado a 13 m, con curvas cada metro. **Obstáculos**: rojo donde una roca sobresale del agua, sobre la distancia a la orilla en grises. **Lecho**: altura del fondo con curvas cada 2 m. **Corriente base (velocidad)**: azul oscuro donde el agua va despacio, turquesa a la media, amarillo y blanco al doble o más; los puntos blancos viajan con la corriente. **Corriente base frente a _flujo**: verde donde la dirección coincide con la que trae la lámina (`_flujo_x`, `_flujo_z`), amarillo y rojo donde difiere. |
| Dominio | Tamaño de la rejilla, celdas con agua, profundidad máxima y celdas de obstáculo. |
| Horneado | Lo que tardó el último horneado. |
| Corriente base | Tamaño de la rejilla, islas, iteraciones y tiempo del cálculo. |
| ↻ Volver a hornear dominio y corriente | Rehace los mapas y la corriente (por ejemplo, tras mover rocas). |

# Panel de RealisticRiver1

En el visor está en la carpeta **Agua**. Los controles irán creciendo con cada fase del plan.

| Control | Rango | Qué hace |
|---|---|---|
| color orilla | color | Color del agua donde hay poca profundidad. |
| color fondo | color | Color del agua en lo hondo (12 m o más). Entre los dos se mezcla según la profundidad. |
| rugosidad | 0-1 | 0 = espejo; más alto, reflejos más difusos y brillo del sol más ancho. |
| velocidad ondas | 0-0,1 | Velocidad a la que se desplazan las ondas de detalle. |
| escala ondas | 0,1-20 | Tamaño de las ondas: más alto, ondas más pequeñas y repetidas. |
| fuerza ondas | 0-1,5 | Cuánto deforman las ondas los reflejos. |

## Depuración del río

No se guarda en la URL ni en los conjuntos de configuración.

| Control | Qué hace |
|---|---|
| Vista | Pinta un mapa del dominio sobre el agua, sin luz. **Orilla**: azules en el agua (más oscuro hacia el centro), ocres en tierra, la orilla en blanco y curvas cada 5 m. **Profundidad**: amarillo en los bajíos, verde, azul y morado a 13 m, con curvas cada metro. **Obstáculos**: rojo donde una roca sobresale del agua, sobre la distancia a la orilla en grises. **Lecho**: altura del fondo con curvas cada 2 m. |
| Dominio | Tamaño de la rejilla, celdas con agua, profundidad máxima y celdas de obstáculo. |
| Horneado | Lo que tardó el último horneado. |
| ↻ Volver a hornear el dominio | Rehace los mapas (por ejemplo, tras mover rocas). |

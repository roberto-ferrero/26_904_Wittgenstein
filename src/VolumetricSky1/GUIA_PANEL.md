# VolumetricSky1 · guía del panel

El panel tiene tres carpetas y cada parámetro está en una sola de ellas:

| Carpeta | De qué se encarga |
|---|---|
| **Cielo e iluminación** | Dónde está el sol y cuánta luz llega a la escena (sol, ambiente, reflejos, exposición). |
| **Atmósfera y nubes** | Los efectos volumétricos: el aire (que tiñe el cielo y vela lo lejano) y las nubes. |
| **Niebla en capa** | Una niebla adicional entre dos alturas (por ejemplo, la nieblina sobre un río). |

No hay ninguna otra niebla: la perspectiva aérea y la niebla en capa se calculan juntas en el mismo efecto de la
escena (`scene.fogNode`), y las dos toman su color del cielo que hay detrás, así que cambian solas con la hora y
la dirección del sol.

Los cambios se aplican en el momento. Si algo no se ve como esperas, **↻ Actualizar** vuelve a aplicar todo:
recalcula el cielo, rehace los reflejos y vuelve a empezar las nubes desde cero.

## Cielo e iluminación

| Control | Qué hace |
|---|---|
| Cielo activo | Enciende o apaga el cielo entero (cielo, nubes, perspectiva aérea, niebla y control de las luces). Apagado, la escena vuelve a su fondo, entorno y niebla originales. |
| Orientación del escenario (°) | Hacia qué rumbo geográfico apunta el eje −Z de la escena (en 26_904, más o menos hacia donde mira la cámara "Camera", que está 13° a la izquierda de −Z). 0 = norte, 90 = este, 180 = sur, 135 = sureste. No mueve nada de la escena: gira a su alrededor el sol, la luna, las estrellas y el viento, que siguen dados en rumbos geográficos. Con 180 y la misma hora, el sol que entraba por la izquierda de la cámara entra por la derecha. |
| Posición del sol | **Manual**: tú fijas elevación y acimut. **Fecha, hora y lugar**: el sol (y la luna) están donde estarían de verdad. |
| Elevación (°) | *(Manual)* Altura del sol sobre el horizonte: 90 = cenit, 0 = horizonte, negativo = ya se ha puesto. Cambia el color del sol y del cielo (anaranjado cerca del horizonte), la dirección de las sombras y la fuerza de la luz. |
| Acimut (° desde el norte) | *(Manual)* Dirección geográfica del sol: 0 = norte, 90 = este, 180 = sur, 270 = oeste. Con orientación 0, el norte es −Z de la escena. |
| Lugar | *(Fecha, hora y lugar)* Latitud, longitud y zona horaria. |
| Fecha (AAAA-MM-DD) | *(Fecha, hora y lugar)* Día del año: cambia la altura del sol a mediodía, las horas de salida y puesta y la fase de la luna. |
| Hora local | *(Fecha, hora y lugar)* Hora del día. |
| Fecha y hora | *(Fecha, hora y lugar)* Lectura de la fecha y la hora con su zona horaria. |
| Salida / puesta | *(Fecha, hora y lugar)* Lectura: horas de salida y puesta del sol ese día en ese lugar. |
| Avanzar la hora | *(Fecha, hora y lugar)* Hace correr el tiempo. |
| Velocidad (× tiempo real) | *(Fecha, hora y lugar)* Rapidez del tiempo con "Avanzar la hora": 120 = dos minutos por segundo. |
| Sol ahora | Lectura: altura y acimut geográfico actuales del sol. |
| Fuerza del sol | Intensidad de la luz directa del sol sobre la escena. El color lo pone la atmósfera. Se atenúa sola al acercarse al horizonte. |
| Luz ambiente | Intensidad de la luz difusa del cielo (luz hemisférica): cuánto se ven las zonas en sombra. |
| Reflejos del cielo | Intensidad del mapa de entorno: lo que reflejan el agua y las superficies y la luz indirecta que da el cielo con sus nubes. |
| Brillo del cielo | Multiplica la luminosidad del cielo visible y, con ella, la de lo que tiñe la perspectiva aérea y la niebla. No cambia la luz del sol. |
| Exposición | Exposición de la cámara (tone mapping AgX): aclara u oscurece toda la imagen. |

## Atmósfera y nubes

| Control | Qué hace |
|---|---|
| Turbidez (aerosoles) | Cantidad de polvo, humedad y bruma en el aire (dispersión de Mie). Más turbidez: cielo más blanco y lechoso, halo grande alrededor del sol, sol más anaranjado y más velo sobre lo lejano. Es la "bruma" general del aire; no es una niebla aparte. |
| Azul del aire (Rayleigh) | Cantidad de dispersión de Rayleigh, la que hace azul el cielo. Más: cielo más azul y saturado, lo lejano más azulado y atardeceres más rojos. Menos: cielo pálido u oscuro. |
| Perspectiva aérea | Enciende o apaga el efecto del aire sobre la escena: con la distancia, cada objeto pierde contraste y toma el color del cielo que tiene detrás (azulado de día, más claro hacia el sol, anaranjado o malva al atardecer). |
| Fuerza de la perspectiva aérea | Multiplica el aire real entre la cámara y la escena. A escala de un valle (1-2 km) el aire real apenas se nota, por eso el valor por defecto es 5. 0 = sin efecto; 20 o más = valle muy brumoso. Turbidez y Rayleigh cambian también su color y su peso. |

### Nubes

| Control | Qué hace |
|---|---|
| Nubes | Enciende o apaga las nubes volumétricas. |
| Cobertura | Fracción del cielo cubierta: 0 = despejado, 1 = cubierto. |
| Densidad | Lo opacas que son por dentro: bajas, nubes finas y translúcidas; altas, nubes compactas con bases oscuras. |
| Tipo (cúmulo → estrato) | 0 = cúmulos con mucho desarrollo vertical; 1 = estratos, capas planas y bajas. |
| Altitud de la base (m) | Altura de la base de la capa de nubes. |
| Grosor (m) | Espesor de la capa: con más grosor, nubes más altas y con más volumen. |
| Tamaño de las formaciones | Escala del dibujo de las nubes: más alto, nubes más grandes y espaciadas. |
| Viento (m/s) | Velocidad a la que se desplazan las nubes. |
| Viento hacia (° desde el norte) | Hacia dónde se mueven (0 = hacia el norte, 90 = hacia el este). |
| Calidad (pasos) | Muestras por píxel del cálculo de las nubes. Más pasos: bordes más limpios y menos ruido, pero más coste de GPU. 40 es un buen equilibrio. |

## Niebla en capa

Niebla adicional con densidad constante entre la cota baja y la cota alta, que se desvanece por encima y por
debajo. La ilumina el cielo igual que a la perspectiva aérea, así que su color cambia con la hora.

| Control | Qué hace |
|---|---|
| Densidad (0 = sin niebla) | Lo espesa que es dentro de la capa, por metro recorrido. Con 0,002, a 500 m dentro de la capa queda un tercio del contraste; con 0,01, a 100 m. |
| Cota baja (m) | Altura (eje Y de la escena) donde empieza la capa por abajo. |
| Cota alta (m) | Altura donde termina la capa por arriba. Con la cota baja bajo el suelo y la alta en el agua, es una nieblina pegada al río. Con las dos a media ladera, es un banco de niebla que corta las colinas. |
| Transición (m) | Distancia en la que la niebla se desvanece por encima de la cota alta y por debajo de la baja. Pequeña: borde nítido. Grande: niebla que se difumina poco a poco con la altura. |

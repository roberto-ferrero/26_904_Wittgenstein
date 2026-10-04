# Guía del panel

El panel (arriba a la derecha) empieza replegado. Las carpetas, en orden:

| Carpeta | Qué contiene |
|---|---|
| **↻ Actualizar** | Botón: vuelve a aplicar todo el cielo, la atmósfera, las nubes y los reflejos. Para cuando algo no se vea como esperas tras cambiar un valor. |
| **Rendimiento** | *pixel ratio*: resolución interna respecto a la pantalla (1 = nativa, 2 = el doble, menos de 1 = más rápido y más borroso). |
| **Cámara** | *Volver a "Camera"*: devuelve la vista a la cámara de Blender. *fov vertical*: ángulo de visión en grados (22,9 = objetivo de 50 mm). |
| **Cielo e iluminación** | El sol, la luz de la escena y la exposición. Además de lo de VolumetricSky1, aquí está *Sombras del sol* (activa o quita las sombras). |
| **Atmósfera y nubes** | El aire (turbidez, azul, perspectiva aérea) y las nubes volumétricas. |
| **Niebla en capa** | La niebla adicional entre dos cotas (ahora, la nieblina del río). |
| **Agua** | Colores de la orilla y del fondo según la profundidad, rugosidad (más baja = reflejos más nítidos) y velocidad, escala y fuerza de las ondas. |
| **Vegetación** | *visible*; *LOD0 hasta (m)*: hasta qué distancia los árboles usan la malla detallada; *distancia máx. (m)*: más allá no se dibujan; *instancias LOD0 / LOD1*: lecturas de cuántos árboles hay en cada nivel; *proyecta sombras*. **Viento**: *fuerza* (amplitud del balanceo), *velocidad*, *temblor hojas* y *hacia (° desde el norte)*, con la misma convención que el viento de las nubes. Este viento mueve también la hiedra del castillo. |
| **Visibilidad** | Muestra u oculta el terreno con las rocas, el agua, el castillo y la torre. |

La explicación de cada control de **Cielo e iluminación**, **Atmósfera y nubes** y **Niebla en capa** está en
[src/VolumetricSky1/GUIA_PANEL.md](src/VolumetricSky1/GUIA_PANEL.md).

Lo que ya no está en el panel porque estaba repetido: la carpeta *Luz y exposición* (la exposición está en Cielo e
iluminación y las sombras también) y la *niebla FogExp2* del cielo (la sustituyen la perspectiva aérea y la niebla
en capa). Parámetros finos que se han quitado del panel pero siguen en el código (`sky.state`, `sky.clouds.state`):
ozono, dispersión múltiple, direccionalidad de Mie, luna, estrellas, resolución y acumulación temporal de las nubes.

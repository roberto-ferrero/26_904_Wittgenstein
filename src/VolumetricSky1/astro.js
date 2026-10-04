/**
 * Posición del Sol y de la Luna y fase lunar (Fase 3.1).
 * Fórmulas astronómicas estándar de baja precisión (Meeus / "Astronomy Answers", las mismas que
 * usa SunCalc): error del orden de 0,1-1°, más que suficiente para iluminar una escena.
 *
 * Convenciones del proyecto: Y arriba, **norte = −Z**, **este = +X**.
 * Azimut devuelto en grados desde el norte, en sentido horario (N = 0°, E = 90°).
 */
const PI = Math.PI;
const RAD = PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toJulian = (date) => date.valueOf() / DAY_MS - 0.5 + J1970;
const toDays = (date) => toJulian(date) - J2000;

const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
// azimut medido desde el SUR hacia el oeste (convención de Meeus)
const azimuthFromSouth = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
/** Tiempo sidéreo local (rad) para d días desde J2000 y longitud oeste lw (rad). */
export const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;

function refraction(h) {
  // refracción atmosférica (Sæmundsson), h en rad; por debajo de −0,3° se congela
  const hh = h < -0.0052 ? -0.0052 : h;
  return 0.0002967 / Math.tan(hh + 0.00312536 / (hh + 0.08901179));
}

const solarMeanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + PI;
}
function sunCoords(d) {
  const L = eclipticLongitude(solarMeanAnomaly(d));
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}
function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

const toCompass = (azSouth) => ((azSouth / RAD + 180) % 360 + 360) % 360;

/** Sol: altitud (°, sin refracción) y azimut desde el norte (°). */
export function sunPosition(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const c = sunCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  return { altitude: altitude(H, phi, c.dec) / RAD, azimuth: toCompass(azimuthFromSouth(H, phi, c.dec)) };
}

/** Luna: altitud (° con refracción), azimut desde el norte (°) y distancia (km). */
export function moonPosition(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  h += refraction(h);
  return { altitude: h / RAD, azimuth: toCompass(azimuthFromSouth(H, phi, c.dec)), distance: c.dist };
}

/**
 * Fase lunar: fracción iluminada (0-1), fase (0 = nueva, 0,25 = cuarto creciente, 0,5 = llena,
 * 0,75 = cuarto menguante) y nombre.
 */
export function moonIllumination(date) {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / PI;
  const names = ['Luna nueva', 'Creciente', 'Cuarto creciente', 'Gibosa creciente', 'Luna llena', 'Gibosa menguante', 'Cuarto menguante', 'Menguante'];
  return { fraction: (1 + Math.cos(inc)) / 2, phase, name: names[Math.round(phase * 8) % 8] };
}

/** Vector unitario en el mundo (Y arriba, norte −Z, este +X) a partir de altitud y azimut en grados. */
export function directionFromAltAz(altDeg, azDeg, out) {
  const alt = altDeg * RAD;
  const az = azDeg * RAD;
  return out.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
}

/**
 * Matriz 3×3 (columnas, para Matrix4.set) que pasa de coordenadas ecuatoriales
 * (x hacia el punto vernal, z al polo norte celeste) al mundo, para la fecha y el lugar dados.
 * Sirve para orientar el campo de estrellas.
 */
export function equatorialToWorld(date, lat, lon) {
  const lst = siderealTime(toDays(date), RAD * -lon);
  const phi = RAD * lat;
  const c = Math.cos(lst), s = Math.sin(lst);
  // rotación −LST alrededor del polo: x' = x c + y s ; y' = −x s + y c ; z' = z
  // horizonte: E = y' ; U = x' cos φ + z' sin φ ; N = z' cos φ − x' sin φ ; mundo = (E, U, −N)
  const cp = Math.cos(phi), sp = Math.sin(phi);
  return [
    // fila X (este)
    -s, c, 0,
    // fila Y (arriba)
    c * cp, s * cp, sp,
    // fila Z (sur = −norte)
    c * sp, s * sp, -cp,
  ];
}

/** Hora (decimal) de salida y puesta del sol del día local indicado, buscando el cruce de −0,833°. */
export function sunriseSunset(dayStartUTC, lat, lon) {
  const H0 = -0.833;
  let prev = sunPosition(new Date(dayStartUTC), lat, lon).altitude - H0;
  let rise = null, set = null;
  for (let min = 5; min <= 1440; min += 5) {
    const alt = sunPosition(new Date(dayStartUTC + min * 60000), lat, lon).altitude - H0;
    if (prev < 0 && alt >= 0 && rise === null) rise = (min - 5 * alt / (alt - prev)) / 60;
    if (prev >= 0 && alt < 0 && set === null) set = (min - 5 * alt / (alt - prev)) / 60;
    prev = alt;
  }
  return { rise, set };
}

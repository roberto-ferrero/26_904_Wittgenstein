// VolumetricSky1: cielo físico con nubes volumétricas (Three.js WebGPURenderer + TSL). Ver README.md.
export { createVolumetricSky1, SKY_DEFAULTS, SUN_MODES, PLACES } from './VolumetricSky1.js';
export { CLOUD_MORPHOLOGIES } from './clouds.js';
export { sunPosition, moonPosition, moonIllumination, directionFromAltAz } from './astro.js';
// El panel (lil-gui) va aparte para no obligar a instalar lil-gui: import { addVolumetricSky1Gui } from './VolumetricSky1/gui.js'

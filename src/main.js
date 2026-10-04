import './style.css';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import GUI from 'lil-gui';
import { positionLocal, positionGeometry, modelWorldMatrix, vec4 } from 'three/tsl';

import { createUi } from './core/ui.js';
import { createUrlState } from './core/urlState.js';
import { crearRioRealista } from './escena/agua.js';
import { crearVegetacion, desplazamientoViento } from './escena/vegetacion.js';
import { createVolumetricSky1 } from './VolumetricSky1/index.js';
import { addVolumetricSky1Gui } from './VolumetricSky1/gui.js';

// Escena v10 (terreno, castillo v4, torre y vegetación), copiada de "Claude working folder" a public/escena/.
const BASE = import.meta.env.BASE_URL;
const ESCENA = {
	datos: 'escena/escena_datos.json',
	terreno: 'escena/escena_terreno_draco.glb',
	piezas: {
		Castillo: 'escena/castillo_v4_lowpoly_draco.glb',
		Torre: 'escena/torre_lowpoly_draco.glb',
	},
	vegetacion: {
		lod0: 'escena/vegetacion_draco.glb',
		lod1: 'escena/vegetacion_lod1_draco.glb',
		bin: 'escena/vegetacion_instancias.bin',
		json: 'escena/vegetacion_instancias.json',
	},
};
const ruta = ( rel ) => BASE + rel;

const lineal = ( rgb ) => new THREE.Color().setRGB( rgb[ 0 ], rgb[ 1 ], rgb[ 2 ], THREE.LinearSRGBColorSpace );

// ---------------------------------------------------------------- Arranque: cortina con los pasos de la carga

const ui = createUi( document.body, navigator.gpu ? 'WebGPU' : 'WebGL2' );
await ui.step( 'Iniciando el renderizador WebGPU…', 0.04 );

const renderer = new THREE.WebGPURenderer( { antialias: true } );
renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend( renderer.domElement );
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (fallback)';
ui.setBackend( backend );

const scene = new THREE.Scene();

// ---------------------------------------------------------------- Carga

await ui.step( 'Cargando el terreno, el castillo y la vegetación…', 0.12 );
const draco = new DRACOLoader().setDecoderPath( BASE + 'draco/' );
const gltfLoader = new GLTFLoader().setDRACOLoader( draco );

let datos, gltfTerreno, vegetacion, gltfPiezas;
try {
	datos = await fetch( ruta( ESCENA.datos ) ).then( ( r ) => {
		if ( ! r.ok ) throw new Error( 'No se pudo leer ' + ESCENA.datos );
		return r.json();
	} );
	const piezasVisibles = Object.keys( ESCENA.piezas ).filter( ( n ) => ! datos.piezas[ n ]?.oculto );
	[ gltfTerreno, vegetacion, ...gltfPiezas ] = await Promise.all( [
		gltfLoader.loadAsync( ruta( ESCENA.terreno ) ),
		crearVegetacion( {
			gltfLoader,
			rutas: Object.fromEntries( Object.entries( ESCENA.vegetacion ).map( ( [ k, v ] ) => [ k, ruta( v ) ] ) ),
		} ),
		...piezasVisibles.map( ( n ) => gltfLoader.loadAsync( ruta( ESCENA.piezas[ n ] ) ).then( ( g ) => [ n, g ] ) ),
	] );
} catch ( err ) {
	console.error( err );
	ui.error( 'No se pudo cargar la escena de <code>public/escena/</code>.<br>' + err.message );
	throw err;
}

// Los materiales del .glb salen con metallicFactor = 1 y el metal en el canal B del ORM.
// Piedra, tierra y roca no son metal: se fuerza a 0 para que el cielo no las lave.
const sinMetal = ( raiz ) => raiz.traverse( ( o ) => {
	if ( o.isMesh && o.material.metalnessMap ) { o.material.metalnessMap = null; o.material.metalness = 0; }
} );

// ---------------------------------------------------------------- Terreno y agua

await ui.step( 'Montando la escena…', 0.3 );
const terreno = gltfTerreno.scene;
terreno.name = 'Terreno';
let mallaAgua = null;
terreno.traverse( ( o ) => {
	if ( ! o.isMesh ) return;
	if ( o.name === 'Agua' ) { mallaAgua = o; return; }
	o.receiveShadow = true;
	o.castShadow = o.name !== 'Terreno_Corte';
} );
if ( mallaAgua ) mallaAgua.removeFromParent();
sinMetal( terreno );
scene.add( terreno );

// ---------------------------------------------------------------- Piezas

const piezas = {};
for ( const [ nombre, gltf ] of gltfPiezas ) {
	const d = datos.piezas[ nombre ];
	const raiz = gltf.scene;
	raiz.name = nombre;
	raiz.position.fromArray( d.posicion );
	raiz.scale.setScalar( d.escala );
	raiz.rotation.y = THREE.MathUtils.degToRad( d.rotacion_y_grados || 0 );
	raiz.traverse( ( o ) => { if ( o.isMesh ) { o.castShadow = true; o.receiveShadow = true; } } );
	sinMetal( raiz );
	ajustarDesgaste( raiz, d.escala );
	scene.add( raiz );
	piezas[ nombre ] = raiz;
}

// ---------------------------------------------------------------- Desgaste del castillo (desde el v4)

// Manchas: calcas con mezcla alfa a 6 cm del muro. No proyectan sombra (cada una dejaría su rectángulo) y
// se adelantan un poco en profundidad para que no parpadeen contra el muro desde lejos.
// Hiedra: recorte alfa y dos caras, con el atributo _viento (~0,1 en lo pegado al muro y de 0 a 1 en las cortinas
// que cuelgan de los arcos). Se mece con el mismo viento que los árboles, ~0,45 m en las puntas de las cortinas.
function ajustarDesgaste( raiz, escala ) {
	raiz.traverse( ( o ) => {
		if ( ! o.isMesh ) return;
		const m = o.material;
		if ( m.name === 'Manchas' ) {
			o.castShadow = false;
			m.polygonOffset = true;
			m.polygonOffsetFactor = -2;
			m.polygonOffsetUnits = -2;
			m.depthWrite = false;
		} else if ( m.name === 'Hiedra' && vegetacion && o.geometry.attributes._viento ) {
			const n = new THREE.MeshStandardNodeMaterial( {
				name: m.name, map: m.map, color: m.color, vertexColors: m.vertexColors,
				alphaTest: m.alphaTest, side: m.side, roughness: m.roughness, metalness: 0,
				normalMap: m.normalMap, roughnessMap: m.roughnessMap,
			} );
			const mundo = modelWorldMatrix.mul( vec4( positionGeometry, 1 ) ).xyz;
			const viento = desplazamientoViento( vegetacion.uniforms, {
				posicion: mundo,
				fase: mundo.x.mul( 0.13 ).add( mundo.z.mul( 0.07 ) ),
				amplitud: 0.45,
				temblor: 0.03,
			} );
			// La malla está en el espacio del castillo (escalado y sin giro): el desplazamiento se divide por la escala.
			n.positionNode = positionLocal.add( viento.div( escala ) );
			o.material = n;
		}
	} );
}

// ---------------------------------------------------------------- Vegetación

scene.add( vegetacion.objeto );

// ---------------------------------------------------------------- Luces

const il = datos.iluminacion;

// Color, fuerza y dirección del sol los pone el cielo; aquí solo se encuadra la caja de sombras.
const sol = new THREE.DirectionalLight( lineal( il.sol.color_lineal ), il.sol.intensidad_threejs_sugerida );
// La caja de sombras cubre todo el terreno (1000 × 1500 m), centrada en él.
const t = datos.terreno;
const centroTerreno = new THREE.Vector3( ( t.x[ 0 ] + t.x[ 1 ] ) / 2, 0, ( t.z[ 0 ] + t.z[ 1 ] ) / 2 );
const radioTerreno = 0.5 * Math.hypot( t.x[ 1 ] - t.x[ 0 ], t.z[ 1 ] - t.z[ 0 ] );
const haciaSol = new THREE.Vector3().fromArray( il.sol.direccion_hacia_el_sol ).normalize();
sol.target.position.copy( centroTerreno );
sol.position.copy( centroTerreno ).addScaledVector( haciaSol, radioTerreno + 400 );
sol.castShadow = true;
sol.shadow.mapSize.set( 4096, 4096 );
const sc = sol.shadow.camera;
sc.left = - radioTerreno; sc.right = radioTerreno; sc.top = radioTerreno; sc.bottom = - radioTerreno;
sc.near = 10; sc.far = 2 * radioTerreno + 800;
sol.shadow.bias = -0.0004;
sol.shadow.normalBias = 0.6;
scene.add( sol, sol.target );

const hemi = new THREE.HemisphereLight( lineal( il.hemisferica.cielo_lineal ), lineal( il.hemisferica.suelo_lineal ), il.hemisferica.intensidad_sugerida );
scene.add( hemi );

// ---------------------------------------------------------------- Cámara "Camera"

const cr = datos.camara_roberto;
const camera = new THREE.PerspectiveCamera( cr.fov_vertical_grados, window.innerWidth / window.innerHeight, 0.5, 5000 );
const posInicial = new THREE.Vector3().fromArray( cr.posicion );
const dirInicial = new THREE.Vector3().fromArray( cr.mira_hacia ).normalize();
// El objetivo de la órbita se pone sobre la línea de visión, a la distancia del castillo.
const distOrbita = piezas.Castillo ? posInicial.distanceTo( piezas.Castillo.position ) : 500;
const objInicial = posInicial.clone().addScaledVector( dirInicial, distOrbita );

camera.position.copy( posInicial );
camera.lookAt( objInicial );
camera.updateMatrixWorld();

const controls = new OrbitControls( camera, renderer.domElement );
controls.target.copy( objInicial );
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 2500;
controls.update();

// ---------------------------------------------------------------- Agua

// El agua va en su propio objeto, fácil de sustituir: el río de RealisticRiver1 (crearAguaPlana es la alternativa).
// Las ondas de viento siguen el viento de la vegetación (dirección) y de las nubes (velocidad); `sky` se crea después.
let sky = null;
const agua = mallaAgua ? await crearRioRealista( mallaAgua, datos, {
	renderer, scene, camera, terreno,
	viento: () => ( { hacia: vegetacion.opciones.vientoHacia, orientacion: sky?.state.orientation ?? 0, velocidad: sky?.clouds.state.windSpeed ?? 0 } ),
} ) : null;

function volverACamera() {
	camera.position.copy( posInicial );
	camera.fov = cr.fov_vertical_grados;
	camera.updateProjectionMatrix();
	controls.target.copy( objInicial );
	controls.update();
	gui.controllersRecursive().forEach( ( c ) => c.updateDisplay() );
	urlState.writeURL();
}

// ---------------------------------------------------------------- Cielo: VolumetricSky1

await ui.step( 'Calculando el cielo y las nubes volumétricas…', 0.45 );
// Sol manual en la dirección de la escena de Blender (escena_datos.json): elevación 34° y acimut ~307° (noroeste).
const aSol = haciaSol;
sky = await createVolumetricSky1( {
	renderer, scene, camera, sun: sol, hemi,
	fog: true, // la única niebla de la escena: la perspectiva aérea del cielo (scene.fogNode)
	settings: {
		// sol por fecha, hora y lugar: 21 de junio a las 17:30 en Viena (31° de altura, hacia el oeste), parecido al
		// sol de la escena de Blender; el modo Manual arranca con el de Blender (34°, acimut ~307°)
		sunMode: 'Fecha, hora y lugar',
		place: 'Austria (Viena)',
		date: '2026-06-21',
		hour: 17.5,
		sunElevation: THREE.MathUtils.radToDeg( Math.asin( aSol.y ) ),
		sunAzimuth: ( THREE.MathUtils.radToDeg( Math.atan2( aSol.x, - aSol.z ) ) + 360 ) % 360,
		sunStrength: il.sol.intensidad_threejs_sugerida,
		ambientStrength: 0.8,
		environmentIntensity: 0.6,
		// niebla en capa sobre el río: la nieblina de baja cota que tenía el visor de la v10 (densidad 0,00175 en la
		// cota del agua y se divide por e cada 11 m de subida)
		fogDensity: 0.00175,
		fogBottom: -20,
		fogTop: datos.terreno.cota_agua_y,
		fogFade: 11,
	},
} );

// ---------------------------------------------------------------- GUI (replegada por defecto, como en Whale)

await ui.step( 'Preparando el panel…', 0.55 );
const gui = new GUI( { title: 'Wittgenstein Castle', width: 368 } ); // 50 % más ancho que el de lil-gui (245 px)
gui.close();
gui.add( { actualizar: () => sky.refresh() }, 'actualizar' ).name( '↻ Actualizar (vuelve a aplicar todo)' );
// Conjuntos de configuración (src/presets/*.json): valores del panel con las mismas claves que la URL. Elegir uno
// pone sus valores y devuelve el resto a los de arranque.
const PRESETS = Object.entries( import.meta.glob( './presets/*.json', { eager: true, import: 'default' } ) )
	.sort( ( [ a ], [ b ] ) => a.localeCompare( b ) ).map( ( [ , p ] ) => p );
const SIN_PRESET = '— (arranque o ajustes propios)';
const presetSel = { nombre: SIN_PRESET };
const presetCtl = gui.add( presetSel, 'nombre', [ SIN_PRESET, ...PRESETS.map( ( p ) => p.nombre ) ] ).name( 'Configuración' )
	.onChange( ( nombre ) => {
		const p = PRESETS.find( ( x ) => x.nombre === nombre );
		if ( ! p ) return;
		urlState.applyValues( p.valores, { reset: true } );
		gui.controllersRecursive().forEach( ( c ) => c.updateDisplay() );
		urlState.writeURL();
	} );
presetCtl.noUrl = true;
gui.add( { guardar: () => descargarPreset() }, 'guardar' ).name( '⤓ Guardar configuración actual (.json)' );
// el estado del panel va en la URL (ver más abajo): estos botones la copian o vuelven a los valores de arranque
gui.add( { copiar: () => copiarURL() }, 'copiar' ).name( '⧉ Copiar URL con esta configuración' );
gui.add( { restablecer: () => { urlState.reset(); presetSel.nombre = SIN_PRESET; presetCtl.updateDisplay(); } }, 'restablecer' ).name( '⟲ Restablecer valores de arranque' );

const fRend = gui.addFolder( 'Rendimiento' ).close();
const opts = { pixelRatio: renderer.getPixelRatio(), sombras: true };
fRend.add( opts, 'pixelRatio', 0.5, 2, 0.25 ).name( 'pixel ratio' ).onChange( ( v ) => renderer.setPixelRatio( v ) );

const fCam = gui.addFolder( 'Cámara' ).close();
fCam.add( { volver: volverACamera }, 'volver' ).name( 'Volver a "Camera"' );
fCam.add( camera, 'fov', 10, 75, 0.1 ).name( 'fov vertical' ).onChange( () => camera.updateProjectionMatrix() );

// Cielo e iluminación, Atmósfera y nubes, y Niebla en capa: todo lo de la luz y la atmósfera está aquí y solo aquí.
const panelCielo = addVolumetricSky1Gui( sky, gui );
panelCielo.sky.add( opts, 'sombras' ).name( 'Sombras del sol' ).onChange( ( v ) => { sol.castShadow = v; } );
for ( const f of [ panelCielo.sky, panelCielo.atmosphere, panelCielo.clouds, panelCielo.fog ] ) f.close();

if ( agua?.gui ) agua.gui( gui.addFolder( 'Agua' ).close() );
vegetacion.gui( gui.addFolder( 'Vegetación' ).close() );

const fCapas = gui.addFolder( 'Visibilidad' ).close();
fCapas.add( terreno, 'visible' ).name( 'terreno y rocas' );
if ( agua ) fCapas.add( agua.objeto, 'visible' ).name( 'agua' );
for ( const [ nombre, obj ] of Object.entries( piezas ) ) fCapas.add( obj, 'visible' ).name( nombre.toLowerCase() );

// ---------------------------------------------------------------- Estado en la URL

// Cada control que cambia respecto al arranque va al hash de la URL; abrir esa URL reproduce la configuración.
// La vista de la cámara (posición y objetivo de la órbita) también, al soltar el ratón.
const r1 = ( v ) => Math.round( v * 10 ) / 10;
const urlState = createUrlState( gui, {
	extra: {
		vista: {
			get: () => [ ...camera.position.toArray(), ...controls.target.toArray() ].map( r1 ).join( ',' ),
			set: ( v ) => {
				const n = v.split( ',' ).map( Number );
				if ( n.length !== 6 || n.some( Number.isNaN ) ) return;
				camera.position.set( n[ 0 ], n[ 1 ], n[ 2 ] );
				controls.target.set( n[ 3 ], n[ 4 ], n[ 5 ] );
				controls.update();
			},
		},
	},
	onLoad: () => sky.refresh(),
} );
controls.addEventListener( 'end', () => urlState.writeURL() );
urlState.readURL();

/** Descarga los valores actuales (los que difieren del arranque) como conjunto para src/presets/. */
function descargarPreset() {
	const nombre = window.prompt( 'Nombre de la configuración:', 'Mi configuración' );
	if ( ! nombre ) return;
	const json = JSON.stringify( { nombre, descripcion: '', valores: urlState.snapshot() }, null, 2 );
	const a = document.createElement( 'a' );
	a.href = URL.createObjectURL( new Blob( [ json ], { type: 'application/json' } ) );
	a.download = nombre.normalize( 'NFD' ).replace( /[\u0300-\u036f]/g, '' ).toLowerCase().replace( /[^a-z0-9]+/g, '_' ) + '.json';
	a.click();
	URL.revokeObjectURL( a.href );
}

async function copiarURL() {
	const url = urlState.shareURL();
	try { await navigator.clipboard.writeText( url ); } catch { window.prompt( 'Copia esta URL:', url ); }
}

// ---------------------------------------------------------------- Fotograma

window.addEventListener( 'resize', () => {
	if ( ! window.innerWidth || ! window.innerHeight ) return;
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );
} );

/** Un fotograma: cámara, vegetación, agua, cielo (pase previo de nubes) y render. */
function frame( dt ) {
	controls.update();
	camera.updateMatrixWorld();
	vegetacion.opciones.orientacion = sky.state.orientation;
	vegetacion.actualizar( camera );
	agua?.actualizar( dt );
	sky.update( dt );
	renderer.render( scene, camera );
}

// Línea del pie con las métricas (dos veces por segundo).
let mFrames = 0, mTime = 0;
const tamaño = new THREE.Vector2();
function updateMetrics( dt ) {
	mFrames ++; mTime += dt;
	if ( mTime < 0.5 ) return;
	const fps = mFrames / mTime;
	const ms = ( mTime / mFrames ) * 1000;
	mFrames = 0; mTime = 0;
	const r = renderer.info.render;
	renderer.getDrawingBufferSize( tamaño );
	ui.setMetrics( `${ fps.toFixed( 1 ) } FPS · ${ ms.toFixed( 2 ) } ms/fotograma · ${ tamaño.x } × ${ tamaño.y } · `
		+ `${ ( r.drawCalls ?? 0 ).toLocaleString( 'es-ES' ) } dibujos · ${ ( r.triangles ?? 0 ).toLocaleString( 'es-ES' ) } triángulos · `
		+ `cielo: ${ sky.state.sunAltAz } · nubes ${ sky.clouds.state.enabled ? Math.round( sky.clouds.state.coverage * 100 ) + ' %' : 'no' }` );
}

// ---------------------------------------------------------------- Bucle

await ui.step( 'Compilando shaders…', 0.7 );
const reloj = new THREE.Timer();
let warm = 0, warmTime = 0, revealed = false;
const recent = [];
renderer.setAnimationLoop( ( time ) => {
	reloj.update( time );
	if ( ! window.innerWidth || ! window.innerHeight ) return;
	const dt = Math.min( reloj.getDelta(), 0.1 );
	frame( dt );
	updateMetrics( dt );
	if ( revealed ) return;
	// Se funde cuando la imagen es estable: al menos 1,5 s y 45 fotogramas dibujados y los últimos 15 sin tirones
	// (compilación de shaders); como mucho, 12 s.
	warm ++; warmTime += dt;
	recent.push( dt ); if ( recent.length > 15 ) recent.shift();
	const avg = recent.reduce( ( a, b ) => a + b, 0 ) / recent.length;
	const worst = Math.max( ...recent );
	if ( warm === 3 ) ui.step( 'Estabilizando la imagen…', 0.85 );
	if ( ( warm > 45 && warmTime > 1.5 && recent.length === 15 && worst < Math.max( 0.06, avg * 2.5 ) ) || warmTime > 12 ) {
		revealed = true;
		ui.reveal( 2.2 );
	}
} );

// Acceso desde la consola para depurar (solo en `npm run dev`).
if ( import.meta.env.DEV ) {
	Object.assign( window, {
		THREE, scene, camera, renderer, controls, piezas, agua, vegetacion, sky, gui, ui,
		/** Dibuja n fotogramas a paso fijo aunque la pestaña esté oculta; devuelve ms por fotograma con la GPU sincronizada. */
		async renderFrames( n = 1, dt = 1 / 60 ) {
			const dev = renderer.backend.device;
			await dev?.queue.onSubmittedWorkDone();
			const t0 = performance.now();
			for ( let i = 0; i < n; i ++ ) {
				renderer._nodes.nodeFrame.update(); // sin requestAnimationFrame nadie avanza el frameId de los nodos
				frame( dt );
			}
			await dev?.queue.onSubmittedWorkDone();
			return +( ( performance.now() - t0 ) / n ).toFixed( 2 );
		},
		/** Guarda una captura del canvas en capturas/<nombre>.jpg. */
		async capture( nombre ) {
			const c = renderer.domElement;
			return fetch( `/__capture?name=${ encodeURIComponent( nombre ) }`, { method: 'POST', body: c.toDataURL( 'image/jpeg', 0.9 ) } ).then( ( r ) => r.text() );
		},
	} );
}

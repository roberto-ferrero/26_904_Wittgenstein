import * as THREE from 'three/webgpu';
import { attribute, mix, uniform, texture, uv, vec2, time, normalMap } from 'three/tsl';
import { createRealisticRiver1 } from '../RealisticRiver1/index.js';
import { addRealisticRiver1Gui } from '../RealisticRiver1/gui.js';

// Agua del río, aislada del resto de la escena para poder sustituirla.
//
// Cada variante recibe la malla "Agua" del .glb y los datos de la escena y devuelve { objeto, actualizar, gui? };
// main.js elige una. La malla original sirve de referencia para la forma del cauce y la cota del agua;
// desde la v4 lleva por vértice _profundidad, _flujo_x, _flujo_z, _velocidad y _a_lo_largo, y un
// segundo UV (uv1) que sigue el cauce.
//
// - crearRioRealista: el módulo RealisticRiver1 (src/RealisticRiver1/), el que se usa.
// - crearAguaPlana: el agua plana de antes, como alternativa.

const lineal = ( rgb ) => new THREE.Color().setRGB( rgb[ 0 ], rgb[ 1 ], rgb[ 2 ], THREE.LinearSRGBColorSpace );

/**
 * Río con el módulo RealisticRiver1. `entorno` = { renderer, scene, camera, terreno, viento }: el terreno da el lecho
 * y las orillas, y sus rocas (el grupo "Rocas") cuentan como obstáculos donde sobresalen del agua. `viento()` devuelve
 * { hacia, orientacion, velocidad }: rumbo geográfico hacia el que sopla (°), orientación del escenario (°) y m/s.
 */
export async function crearRioRealista( mallaOriginal, datos, { renderer, scene, camera, terreno, viento = null } ) {

	const rocas = terreno.getObjectByName( 'Rocas' );
	const rio = await createRealisticRiver1( {
		renderer, scene, camera,
		water: mallaOriginal,
		terrain: terreno,
		obstacles: rocas ? [ rocas ] : [],
		// aspecto: el de RealisticRiver1 por defecto (aguas bravas turquesa, las referencias de Roberto); el agua lila
		// calma de la ilustración está en el conjunto "Río de la ilustración"
	} );
	rio.object.name = 'Agua';

	return {
		objeto: rio.object,
		rio,
		actualizar( dt ) {
			if ( viento ) {
				// misma convención que la vegetación y las nubes: rumbo geográfico menos la orientación del escenario
				const v = viento();
				const r = THREE.MathUtils.degToRad( v.hacia - v.orientacion );
				rio.setWind( Math.sin( r ), - Math.cos( r ), v.velocidad );
			}
			rio.update( dt );
		},
		gui( carpeta ) { addRealisticRiver1Gui( rio, carpeta ); },
	};

}

export function crearAguaPlana( mallaOriginal, datos ) {

	const geometria = mallaOriginal.geometry;
	const original = mallaOriginal.material;

	const u = {
		colorOrilla: uniform( lineal( datos.agua.color_lineal ).multiplyScalar( 1.35 ) ),
		colorFondo: uniform( lineal( datos.agua.color_lineal ).multiplyScalar( 0.55 ) ),
		velocidad: uniform( 0.012 ),
		fuerzaOndas: uniform( 0.3 ),
		escalaOndas: uniform( 4 ),
	};

	const material = new THREE.MeshStandardNodeMaterial( {
		roughness: datos.agua.rugosidad,
		metalness: 0,
	} );

	material.colorNode = geometria.attributes._profundidad
		? mix( u.colorOrilla, u.colorFondo, attribute( '_profundidad', 'float' ).clamp( 0, 1 ) )
		: u.colorOrilla;

	if ( original.normalMap ) {

		const t = time.mul( u.velocidad );
		const uvA = uv().mul( u.escalaOndas ).add( vec2( t, t.mul( 0.6 ) ) );
		const uvB = uv().mul( u.escalaOndas.mul( 1.7 ) ).sub( vec2( t.mul( 0.8 ), t.mul( 0.3 ) ) );
		const nA = texture( original.normalMap, uvA );
		const nB = texture( original.normalMap, uvB );
		material.normalNode = normalMap( nA.add( nB ).mul( 0.5 ), u.fuerzaOndas );

	}

	const objeto = new THREE.Mesh( geometria, material );
	objeto.name = 'Agua';
	objeto.position.copy( mallaOriginal.position );
	objeto.quaternion.copy( mallaOriginal.quaternion );
	objeto.scale.copy( mallaOriginal.scale );
	objeto.receiveShadow = true;

	return {
		objeto,
		actualizar() {},
		gui( carpeta ) {
			carpeta.addColor( { c: u.colorOrilla.value.getHex( THREE.SRGBColorSpace ) }, 'c' ).name( 'color orilla' )
				.onChange( ( v ) => u.colorOrilla.value.setHex( v, THREE.SRGBColorSpace ) );
			carpeta.addColor( { c: u.colorFondo.value.getHex( THREE.SRGBColorSpace ) }, 'c' ).name( 'color fondo' )
				.onChange( ( v ) => u.colorFondo.value.setHex( v, THREE.SRGBColorSpace ) );
			carpeta.add( material, 'roughness', 0, 1, 0.01 ).name( 'rugosidad' );
			if ( original.normalMap ) {
				carpeta.add( u.velocidad, 'value', 0, 0.1, 0.001 ).name( 'velocidad ondas' );
				carpeta.add( u.escalaOndas, 'value', 0.1, 20, 0.1 ).name( 'escala ondas' );
				carpeta.add( u.fuerzaOndas, 'value', 0, 1.5, 0.01 ).name( 'fuerza ondas' );
			}
		},
	};

}

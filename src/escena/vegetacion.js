import * as THREE from 'three/webgpu';
import { attribute, positionLocal, uniform, time, sin, vec3, float } from 'three/tsl';

// Vegetación instanciada (desde la escena v7): siete especies, 2-3 variantes cada una y dos niveles de detalle.
//
// · Instancias: vegetacion_instancias.bin (6 float32: x, y, z, giro Y, escala, variante) + su .json.
// · Mallas: vegetacion(_lod1)_draco.glb, una por variante (<Especie>_<A|B|C>[_LOD1]), con color de vértice y el
//   atributo _viento (0 en el tronco, 1 en lo alto y el borde de la copa).
//
// Por cada variante hay dos InstancedMesh (LOD0 y LOD1). Cuando la cámara se mueve se rehacen sus listas:
// cada instancia se descarta si queda fuera del frustum (con margen, para no perder sombras en los bordes) o más
// lejos que `distanciaMax`, y si no, va al LOD0 si está a menos de `distanciaLod` y al LOD1 si no. Son 32 draw
// calls como mucho y no hace falta tocar el .glb.
//
// Viento: en el shader de vértices, desplazamiento horizontal en la dirección del viento ponderado por _viento,
// con un balanceo lento cuya fase sale de la posición de cada instancia (atributo _fase) y un temblor rápido de
// las hojas que varía por vértice. La amplitud se escala con la altura de cada especie.

const MARGEN_SOMBRA = 25; // m de margen alrededor del frustum

export async function crearVegetacion( { gltfLoader, rutas } ) {

	const [ info, bin, glb0, glb1 ] = await Promise.all( [
		fetch( rutas.json ).then( ( r ) => r.json() ),
		fetch( rutas.bin ).then( ( r ) => r.arrayBuffer() ),
		gltfLoader.loadAsync( rutas.lod0 ),
		gltfLoader.loadAsync( rutas.lod1 ),
	] );

	const geometrias0 = await geometriasPorVariante( glb0 );
	const geometrias1 = await geometriasPorVariante( glb1 );
	const todo = new Float32Array( bin );

	const u = {
		direccion: uniform( new THREE.Vector3( 1, 0, 0.35 ).normalize() ),
		fuerza: uniform( 1 ),
		velocidad: uniform( 1 ),
		hojas: uniform( 1 ),
	};

	const grupo = new THREE.Group();
	grupo.name = 'Vegetacion';
	const variantes = [];
	let totalInstancias = 0;

	for ( const [ especie, e ] of Object.entries( info.especies ) ) {

		const material = materialConViento( u, e.altura_m );
		const datos = todo.subarray( e.desde_byte / 4, e.desde_byte / 4 + e.cuantas * 6 );
		totalInstancias += e.cuantas;

		e.variantes.forEach( ( nombre, iv ) => {

			const indices = [];
			for ( let i = 0; i < e.cuantas; i ++ ) if ( Math.round( datos[ i * 6 + 5 ] ) === iv ) indices.push( i );
			const n = indices.length;
			if ( ! n ) return;

			// Matrices, esferas de culling y fases, precalculadas una vez.
			const matrices = new Float32Array( n * 16 );
			const esferas = new Float32Array( n * 4 );
			const fases = new Float32Array( n );
			const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
			const eje = new THREE.Vector3( 0, 1, 0 );
			indices.forEach( ( i, k ) => {
				const o = i * 6;
				const esc = datos[ o + 4 ];
				p.set( datos[ o ], datos[ o + 1 ], datos[ o + 2 ] );
				q.setFromAxisAngle( eje, datos[ o + 3 ] );
				s.setScalar( esc );
				m.compose( p, q, s ).toArray( matrices, k * 16 );
				esferas[ k * 4 ] = p.x;
				esferas[ k * 4 + 1 ] = p.y + e.altura_m * esc * 0.5;
				esferas[ k * 4 + 2 ] = p.z;
				esferas[ k * 4 + 3 ] = Math.max( e.radio_copa_m, e.altura_m * 0.5 ) * esc;
				fases[ k ] = p.x * 0.13 + p.z * 0.07;
			} );

			const crearMalla = ( geo, lod ) => {
				if ( ! geo ) return null;
				geo = geo.clone();
				const fase = new THREE.InstancedBufferAttribute( new Float32Array( n ), 1 );
				fase.setUsage( THREE.DynamicDrawUsage );
				geo.setAttribute( '_fase', fase );
				const malla = new THREE.InstancedMesh( geo, material, n );
				malla.name = `${nombre}_LOD${lod}`;
				malla.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
				malla.frustumCulled = false; // el culling se hace por instancia
				malla.castShadow = true;
				malla.receiveShadow = true;
				malla.count = 0;
				grupo.add( malla );
				return malla;
			};

			variantes.push( {
				nombre, especie, n, matrices, esferas, fases,
				lod0: crearMalla( geometrias0[ nombre ], 0 ),
				lod1: crearMalla( geometrias1[ nombre ], 1 ),
			} );

		} );

	}

	// ------------------------------------------------------------ LOD y culling

	const opciones = { distanciaLod: 250, distanciaMax: 3000, cullingFrustum: true };
	const frustum = new THREE.Frustum();
	const pv = new THREE.Matrix4();
	const ultima = new THREE.Matrix4();
	const esfera = new THREE.Sphere();
	let forzar = true;
	const recuento = { lod0: 0, lod1: 0 };

	function rellenar( malla, v, k, idx ) {
		malla.instanceMatrix.array.set( v.matrices.subarray( k * 16, k * 16 + 16 ), idx * 16 );
		malla.geometry.attributes._fase.array[ idx ] = v.fases[ k ];
	}

	function actualizar( camera ) {

		pv.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		if ( ! forzar && pv.equals( ultima ) ) return;
		ultima.copy( pv );
		forzar = false;
		frustum.setFromProjectionMatrix( pv );

		const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
		const lod2 = opciones.distanciaLod ** 2, max2 = opciones.distanciaMax ** 2;
		recuento.lod0 = recuento.lod1 = 0;

		for ( const v of variantes ) {

			let i0 = 0, i1 = 0;
			const e = v.esferas;
			for ( let k = 0; k < v.n; k ++ ) {
				const x = e[ k * 4 ], y = e[ k * 4 + 1 ], z = e[ k * 4 + 2 ];
				const d2 = ( x - cx ) ** 2 + ( y - cy ) ** 2 + ( z - cz ) ** 2;
				if ( d2 > max2 ) continue;
				if ( opciones.cullingFrustum ) {
					esfera.center.set( x, y, z );
					esfera.radius = e[ k * 4 + 3 ] + MARGEN_SOMBRA;
					if ( ! frustum.intersectsSphere( esfera ) ) continue;
				}
				if ( ( d2 < lod2 || ! v.lod1 ) && v.lod0 ) rellenar( v.lod0, v, k, i0 ++ );
				else if ( v.lod1 ) rellenar( v.lod1, v, k, i1 ++ );
			}

			for ( const [ malla, cuenta ] of [ [ v.lod0, i0 ], [ v.lod1, i1 ] ] ) {
				if ( ! malla ) continue;
				malla.count = cuenta;
				if ( cuenta ) {
					malla.instanceMatrix.clearUpdateRanges();
					malla.instanceMatrix.addUpdateRange( 0, cuenta * 16 );
					malla.instanceMatrix.needsUpdate = true;
					const f = malla.geometry.attributes._fase;
					f.clearUpdateRanges();
					f.addUpdateRange( 0, cuenta );
					f.needsUpdate = true;
				}
			}
			recuento.lod0 += i0;
			recuento.lod1 += i1;

		}

	}

	// ------------------------------------------------------------ GUI

	function gui( carpeta ) {
		const rehacer = () => { forzar = true; };
		carpeta.add( grupo, 'visible' ).name( 'visible' );
		carpeta.add( opciones, 'distanciaLod', 0, 1500, 10 ).name( 'LOD0 hasta (m)' ).onChange( rehacer );
		carpeta.add( opciones, 'distanciaMax', 200, 3000, 50 ).name( 'distancia máx. (m)' ).onChange( rehacer );
		carpeta.add( opciones, 'cullingFrustum' ).name( 'culling por instancia' ).onChange( rehacer );
		carpeta.add( recuento, 'lod0' ).name( 'instancias LOD0' ).disable().listen();
		carpeta.add( recuento, 'lod1' ).name( 'instancias LOD1' ).disable().listen();
		const sombras = { v: true };
		carpeta.add( sombras, 'v' ).name( 'proyecta sombras' )
			.onChange( ( x ) => grupo.traverse( ( o ) => { if ( o.isMesh ) o.castShadow = x; } ) );
		const fv = carpeta.addFolder( 'Viento' );
		fv.add( u.fuerza, 'value', 0, 4, 0.05 ).name( 'fuerza' );
		fv.add( u.velocidad, 'value', 0, 4, 0.05 ).name( 'velocidad' );
		fv.add( u.hojas, 'value', 0, 4, 0.05 ).name( 'temblor hojas' );
		const ang = { grados: THREE.MathUtils.radToDeg( Math.atan2( u.direccion.value.z, u.direccion.value.x ) ) };
		fv.add( ang, 'grados', -180, 180, 1 ).name( 'dirección (°)' ).onChange( ( g ) => {
			const r = THREE.MathUtils.degToRad( g );
			u.direccion.value.set( Math.cos( r ), 0, Math.sin( r ) );
		} );
	}

	return { objeto: grupo, actualizar, gui, totalInstancias, uniforms: u, opciones };

}

// Una geometría por nombre de variante, quitando el sufijo _LOD1. Los nodos del .glb se llaman
// Veg_<Especie>.<n> y el orden no coincide con el de las variantes, así que se usa el nombre de la malla.
async function geometriasPorVariante( gltf ) {
	const json = gltf.parser.json;
	const salida = {};
	for ( let i = 0; i < json.nodes.length; i ++ ) {
		const nodo = json.nodes[ i ];
		if ( nodo.mesh === undefined ) continue;
		const nombre = json.meshes[ nodo.mesh ].name.replace( /_LOD\d$/, '' );
		const obj = await gltf.parser.getDependency( 'node', i );
		let geo = null;
		obj.traverse( ( o ) => { if ( ! geo && o.isMesh ) geo = o.geometry; } );
		if ( geo ) salida[ nombre ] = geo;
	}
	return salida;
}

function materialConViento( u, alturaEspecie ) {

	const material = new THREE.MeshStandardNodeMaterial( {
		vertexColors: true,
		roughness: 0.92,
		metalness: 0,
		side: THREE.DoubleSide,
	} );

	// positionLocal llega ya transformado por la matriz de la instancia (espacio del mundo, el grupo está en el origen).
	material.positionNode = positionLocal.add( desplazamientoViento( u, {
		posicion: positionLocal,
		fase: attribute( '_fase', 'float' ),
		amplitud: 0.04 * alturaEspecie, // ~0,6 m en la punta de un árbol de 15 m
		temblor: 0.004 * alturaEspecie,
	} ) );
	return material;

}

// Desplazamiento de viento en metros y ejes del mundo, ponderado por el atributo _viento de la malla.
// · Balanceo: empuje medio en la dirección del viento más dos ondas lentas desfasadas por `fase` (rachas).
// · Temblor de las hojas: rápido, pequeño y distinto en cada vértice.
// Lo usan los árboles y la hiedra del castillo, con los mismos uniforms para que todo se mueva con el mismo viento.
export function desplazamientoViento( u, { posicion, fase, amplitud, temblor } ) {

	const p = posicion;
	const w = attribute( '_viento', 'float' );
	const t = time.mul( u.velocidad );

	const racha = sin( t.mul( 0.9 ).add( fase ) ).mul( 0.55 )
		.add( sin( t.mul( 2.1 ).add( fase.mul( 1.7 ) ) ).mul( 0.25 ) )
		.add( 0.35 );
	const balanceo = u.direccion.mul( float( amplitud ).mul( u.fuerza ).mul( w ).mul( w ).mul( racha ) );

	const fv = p.x.mul( 0.9 ).add( p.y.mul( 1.3 ) ).add( p.z.mul( 0.7 ) );
	const hojas = vec3(
		sin( t.mul( 6.3 ).add( fv ) ),
		sin( t.mul( 7.9 ).add( fv.mul( 1.3 ) ) ).mul( 0.5 ),
		sin( t.mul( 5.7 ).add( fv.mul( 0.8 ) ) ),
	).mul( w.mul( u.hojas ).mul( temblor ).mul( u.fuerza ) );

	return balanceo.add( hojas );

}

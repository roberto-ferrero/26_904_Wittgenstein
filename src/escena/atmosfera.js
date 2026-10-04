import * as THREE from 'three/webgpu';
import { Fn, uniform, positionWorld, cameraPosition, float, exp, abs, select, mix, fog, clamp } from 'three/tsl';

// Niebla de la escena como un solo fogNode con dos términos que se suman en
// profundidad óptica:
//
//  · Niebla por distancia (equivale a FogExp2):   τd = (densidad · d)²
//  · Nieblina de baja cota, densidad que cae con la altura,
//      ρ(y) = ρ0 · exp(−(y − cotaAgua) / caida)
//    integrada de forma analítica a lo largo del rayo cámara → fragmento:
//      τh = ρ0 · d · caida · (e^(−(yc − h0)/H) − e^(−(yp − h0)/H)) / (yp − yc)
//
//  factor = 1 − exp(−(τd + τh)); el color se reparte según el peso de cada término.
//
// Color, caída y cota salen de escena_datos.json (iluminacion.niebla y bruma_baja). Las densidades
// se bajan a la mitad: con las del README (FogExp2 0,0007 y bruma 0,0035), que salen de un volumen
// iluminado en EEVEE, una niebla plana de color tan claro lava el castillo. Con estas la imagen se
// parece al render de Blender desde "Camera". Se ajustan en la GUI.
const AJUSTE_DENSIDAD = 0.5;

const lineal = ( rgb ) => new THREE.Color().setRGB( rgb[ 0 ], rgb[ 1 ], rgb[ 2 ], THREE.LinearSRGBColorSpace );

export function crearNiebla( datos ) {

	const n = datos.iluminacion.niebla;
	const b = datos.iluminacion.bruma_baja;

	const u = {
		activa: uniform( 1 ),
		color: uniform( lineal( n.color_lineal ) ),
		densidad: uniform( n.densidad_threejs_FogExp2 * AJUSTE_DENSIDAD ),
		brumaActiva: uniform( 1 ),
		brumaColor: uniform( lineal( n.color_lineal ) ),
		brumaDensidad: uniform( b.densidad_en_agua * AJUSTE_DENSIDAD ),
		brumaCaida: uniform( b.altura_caida_m ),
		cotaAgua: uniform( datos.terreno.cota_agua_y ),
	};

	const factorYColor = Fn( () => {

		const d = positionWorld.distance( cameraPosition ).toVar();

		// Distancia
		const td = u.densidad.mul( d ).pow2().mul( u.activa ).toVar();

		// Baja cota
		const H = u.brumaCaida;
		const yc = cameraPosition.y;
		const yp = positionWorld.y;
		const ec = exp( clamp( yc.sub( u.cotaAgua ).div( H ).negate(), -60, 60 ) );
		const ep = exp( clamp( yp.sub( u.cotaAgua ).div( H ).negate(), -60, 60 ) );
		const dy = yp.sub( yc );
		const media = select( abs( dy ).lessThan( 0.01 ), ec, ec.sub( ep ).mul( H ).div( dy ) );
		const th = u.brumaDensidad.mul( d ).mul( media ).mul( u.brumaActiva ).toVar();

		const total = td.add( th );
		const factor = float( 1 ).sub( exp( total.negate() ) );
		const peso = th.div( total.max( 1e-6 ) );
		const color = mix( u.color, u.brumaColor, peso );

		return fog( color, factor );

	} );

	return { fogNode: factorYColor(), uniforms: u };

}

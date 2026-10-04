/**
 * Estado del panel en la URL: cada control de lil-gui que cambia respecto a su valor de arranque se escribe en el
 * hash (`#cielo-e-iluminacion.hora-local=17.5&nubes.morfologia=Estratos…`). Al abrir esa URL se vuelven a poner
 * los mismos valores, así que copiarla reproduce el estado configurado.
 *
 * Las claves salen de la carpeta y el nombre de cada control (en minúsculas y sin acentos). Los botones y las
 * lecturas (controles desactivados) no se guardan. Además de los controles se pueden registrar valores extra
 * (p. ej. la posición de la cámara) con `extra: { clave: { get, set } }`.
 *
 * @param {import('lil-gui').GUI} gui panel raíz
 * @param {object} [o]
 * @param {Record<string, { get(): string, set(v: string): void }>} [o.extra] valores fuera del panel
 * @param {() => void} [o.onLoad] se llama después de cargar valores de la URL (p. ej. para refrescar la escena)
 */
export function createUrlState(gui, { extra = {}, onLoad = () => {} } = {}) {
	const slug = ( s ) => String( s ).normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );

	// controles guardables y su clave
	const entries = new Map();
	for ( const c of gui.controllersRecursive() ) {
		if ( c._disabled || typeof c.getValue() === 'function' ) continue;
		const key = `${ slug( c.parent._title ) }.${ slug( c._name ) }`;
		if ( ! entries.has( key ) ) entries.set( key, c );
	}
	const defaults = new Map( [ ...entries ].map( ( [ k, c ] ) => [ k, c.getValue() ] ) );
	const extraDefaults = Object.fromEntries( Object.entries( extra ).map( ( [ k, e ] ) => [ k, e.get() ] ) );

	const encode = ( v ) => ( typeof v === 'number' ? String( Number( v.toPrecision( 6 ) ) ) : String( v ) );

	function toHash() {
		const p = new URLSearchParams();
		for ( const [ key, c ] of entries ) {
			const v = c.getValue();
			if ( v !== defaults.get( key ) ) p.set( key, encode( v ) );
		}
		for ( const [ key, e ] of Object.entries( extra ) ) {
			const v = e.get();
			if ( v !== extraDefaults[ key ] ) p.set( key, v );
		}
		return p.toString();
	}

	let pending = 0;
	function writeURL() {
		// como mucho una escritura cada 150 ms mientras se arrastra un control
		clearTimeout( pending );
		pending = setTimeout( () => {
			const hash = toHash();
			history.replaceState( null, '', hash ? `#${ hash }` : location.pathname + location.search );
		}, 150 );
	}

	function readURL() {
		if ( location.hash.length < 2 ) return false;
		const p = new URLSearchParams( location.hash.slice( 1 ) );
		// en el orden del panel (un desplegable que cambia otros controles va antes que ellos)
		for ( const [ key, c ] of entries ) {
			if ( ! p.has( key ) ) continue;
			const raw = p.get( key );
			const def = defaults.get( key );
			let v = raw;
			if ( typeof def === 'number' ) v = Number( raw );
			else if ( typeof def === 'boolean' ) v = raw === 'true';
			if ( typeof v === 'number' && Number.isNaN( v ) ) continue;
			c.setValue( v );
			c._callOnFinishChange();
		}
		for ( const [ key, e ] of Object.entries( extra ) ) if ( p.has( key ) ) e.set( p.get( key ) );
		onLoad();
		return true;
	}

	gui.onFinishChange( writeURL );

	return {
		readURL,
		writeURL,
		/** URL completa con el estado actual. */
		shareURL: () => { const h = toHash(); return `${ location.origin }${ location.pathname }${ location.search }${ h ? `#${ h }` : '' }`; },
		/** Vuelve a los valores de arranque y limpia la URL. */
		reset() {
			for ( const [ key, c ] of entries ) { c.setValue( defaults.get( key ) ); c._callOnFinishChange(); }
			for ( const [ key, e ] of Object.entries( extra ) ) e.set( extraDefaults[ key ] );
			onLoad();
			history.replaceState( null, '', location.pathname + location.search );
		},
	};
}

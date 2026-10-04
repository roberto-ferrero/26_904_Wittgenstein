/**
 * Estado del panel en la URL: cada control de lil-gui que cambia respecto a su valor de arranque se escribe en el
 * hash (`#cielo-e-iluminacion.hora-local=17.5&nubes.morfologia=Estratos…`). Al abrir esa URL se vuelven a poner
 * los mismos valores, así que copiarla reproduce el estado configurado.
 *
 * Las claves salen de la carpeta y el nombre de cada control (en minúsculas y sin acentos). Los botones y las
 * lecturas (controles desactivados) no se guardan, ni los controles marcados con `controller.noUrl = true`.
 * Los conjuntos de configuración (`src/presets/*.json`) usan las mismas claves: `applyValues(valores)`. Además de los controles se pueden registrar valores extra
 * (p. ej. la posición de la cámara) con `extra: { clave: { get, set } }`.
 *
 * @param {import('lil-gui').GUI} gui panel raíz
 * @param {object} [o]
 * @param {Record<string, { get(): string, set(v: string): void }>} [o.extra] valores fuera del panel
 * @param {() => void} [o.onLoad] se llama después de cargar valores de la URL (p. ej. para refrescar la escena)
 */
export function createUrlState(gui, { extra = {}, onLoad = () => {} } = {}) {
	const slug = ( s ) => String( s ).normalize( 'NFD' ).replace( /[\u0300-\u036f]/g, '' ).toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );

	// controles guardables y su clave
	const entries = new Map();
	for ( const c of gui.controllersRecursive() ) {
		if ( c._disabled || c.noUrl || typeof c.getValue() === 'function' ) continue;
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

	/** Pone los valores dados (clave → valor, como en la URL); con `reset`, el resto vuelve a su valor de arranque. */
	function applyValues( values, { reset = false } = {} ) {
		const get = ( k ) => ( values instanceof URLSearchParams ? values.get( k ) : values[ k ] );
		const has = ( k ) => ( values instanceof URLSearchParams ? values.has( k ) : k in values );
		// en el orden del panel (un desplegable que cambia otros controles va antes que ellos)
		for ( const [ key, c ] of entries ) {
			const def = defaults.get( key );
			let v;
			if ( has( key ) ) {
				const raw = get( key );
				v = raw;
				if ( typeof def === 'number' ) v = Number( raw );
				else if ( typeof def === 'boolean' ) v = raw === true || raw === 'true';
				if ( typeof v === 'number' && Number.isNaN( v ) ) continue;
			} else if ( reset ) v = def;
			else continue;
			c.setValue( v );
			c._callOnFinishChange();
		}
		for ( const [ key, e ] of Object.entries( extra ) ) {
			if ( has( key ) ) e.set( String( get( key ) ) );
			else if ( reset ) e.set( extraDefaults[ key ] );
		}
		onLoad();
	}

	function readURL() {
		if ( location.hash.length < 2 ) return false;
		applyValues( new URLSearchParams( location.hash.slice( 1 ) ) );
		return true;
	}

	/** Valores que difieren del arranque (clave → valor): el formato de un conjunto de configuración. */
	function snapshot() {
		return Object.fromEntries( new URLSearchParams( toHash() ) );
	}

	gui.onFinishChange( writeURL );

	return {
		readURL,
		writeURL,
		/** URL completa con el estado actual. */
		shareURL: () => { const h = toHash(); return `${ location.origin }${ location.pathname }${ location.search }${ h ? `#${ h }` : '' }`; },
		/** Vuelve a los valores de arranque y limpia la URL. */
		reset() {
			applyValues( {}, { reset: true } );
			history.replaceState( null, '', location.pathname + location.search );
		},
		applyValues,
		snapshot,
	};
}

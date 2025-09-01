

# SpainTracks GR/PR
Mapa interactivo de senderos homologados en España (GR, PR, SL) con visualización rápida, detalles básicos de cada ruta, descargas y utilidades prácticas como geolocalización y apertura de Street View en el inicio de la ruta.

![captura de pantalla](/img/image.png)

- Navegación del mapa
	- Usa el ratón o los controles de zoom para moverte por el mapa.
	- Activa el botón de ubicación para centrar el mapa en tu posición (necesita permiso del navegador y conexión segura HTTPS/localhost).

- Interacción con las rutas
	- Pasa el ratón por encima de una ruta: verás un pequeño tooltip con su código (por ejemplo, GR-xx).
	- Haz clic en una ruta: se resaltará en azul con un leve brillo, y aparecerá un panel con:
		- Título con el código y un icono del tipo de ruta (GR/PR/SL).
		- Nombre de la ruta, longitud e identificador cuando estén disponibles.
		- Botones de acción en una sola línea:
			- GPX y KML: descargas disponibles si la ruta incluye enlaces.
			- Inicio 3D: abre Google Street View en el inicio de la ruta.
			- INFO: abre la página de información ampliada si está disponible.
	- El mapa centra y acerca ligeramente la vista a la ruta seleccionada.
	- Se señalan el inicio y el fin de la ruta con marcadores.

- Notas y requisitos
	- Geolocalización: requiere HTTPS o ejecutar en localhost; si no, el navegador puede bloquear la ubicación.
	- Street View depende de la cobertura de Google en la zona y puede no estar disponible en todos los comienzos de ruta.

---

## Documentación técnica

### Estructura del proyecto

- `index.html`: Contenedor principal del mapa y los paneles.
- `css/styles.css`: Estilos de interfaz (paneles, tooltip, iconos de tipo de ruta, transiciones).
- `js/app.js`: Lógica de mapa, capas, interacción y utilidades.

### Tecnologías

- MapLibre GL JS para el mapa vectorial.
- Bootstrap 5 para estilos de UI y componentes.
- Font Awesome para iconos.

### Fuentes de datos y capas

- Estilo base y teselas vectoriales: IDEE FEDME (`senderos-fedme`).
- Capa raster de fondo: ESRI World Imagery.
- Capas principales en `app.js` (en el evento `map.on('load', ...)`):
	- `fedme-rutas`: líneas de las rutas desde el vector `senderos-fedme`.
	- `fedme-rutas-hit`: línea “invisible” ancha (hitbox) para mejorar clic/hover.
	- `selected-route-glow` y `selected-route-layer`: resaltado glow + trazo principal para la ruta seleccionada (fuente GeoJSON `selected-route`).
	- `selected-route-start` y `selected-route-end`: marcadores de inicio/fin (fuente `selected-route-points`).

### Controles

- Navegación (zoom, sin brújula).
- Geolocalización con alta precisión y seguimiento: `GeolocateControl` con `fitBoundsOptions: { maxZoom: 12 }`. Se intenta activar al cargar.

### Interacción clave en `app.js`

- Búsqueda de features con hitbox ampliada:
	```js
	function getRouteFeaturesAtPoint(point, paddingPx = 8) {
		const bbox = [[point.x - paddingPx, point.y - paddingPx],[point.x + paddingPx, point.y + paddingPx]];
		const features = map.queryRenderedFeatures(bbox);
		return features.filter(f => { const p = f.properties||{}; return p.nombre||p.name||p.id; });
	}
	```

- Selección de ruta (resumen):
	```js
	map.on('click', (e) => {
		const routeFeatures = getRouteFeaturesAtPoint(e.point, 10);
		if (!routeFeatures.length) { /* limpiar selección y paneles */ return; }
		const feat = routeFeatures[0];
		// 1) Establecer GeoJSON seleccionado
		map.getSource('selected-route').setData({ type:'Feature', geometry: feat.geometry, properties:{} });
		// 2) Calcular inicio y fin
		// 3) Pintar puntos en 'selected-route-points'
		// 4) Centrar y acercar ligeramente
		// 5) Construir HTML del panel con botones GPX/KML, Inicio 3D e INFO
	});
	```

- Cálculo de centro y bounds de la geometría para centrar el mapa:
	```js
	function getGeometryBoundsAndCenter(geom) { /* recorre coords y devuelve {bounds, center} */ }
	// Uso:
	const gc = getGeometryBoundsAndCenter(geom);
	if (gc) map.easeTo({ center: gc.center, zoom: Math.min(map.getZoom()+1.3, 12), duration: 800 });
	```

- Botón “Inicio 3D” (Street View) en el panel:
	```js
	const svUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}&heading=0&pitch=0&fov=80`;
	// Se renderiza como botón con target _blank si existe coordenada de inicio
	```

### Diseño y estilos

- Paneles `.card` con fondo semitransparente y transiciones (`#route-popup`, `#route-details-popup`).
- Tooltip `#route-tooltip` para el código de ruta al pasar el ratón.
- Icono de tipo de ruta junto al título: `.route-type-icon` (tamaño ligeramente aumentado a `1.25em`).

### Extensiones y puntos de mejora

- Añadir búsqueda de rutas global con índice precomputado.
- Opción de Street View también para el final de la ruta.
- Ajustar padding/zoom al centrar rutas largas para que quepan completas.

### Puesta en marcha

- Servir `index.html` desde un servidor estático (recomendado HTTPS para geolocalización). En desarrollo, `localhost` funciona sin HTTPS.

### Créditos y licencias

- Teselas de senderos: IDEE / FEDME.
- Imágenes satélite: ESRI World Imagery.
- UI: Bootstrap 5. Iconos: Font Awesome.

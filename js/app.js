// Usar el style original de IDEE para que las rutas se vean correctamente
const styleUrl = 'https://vt-fedme.idee.es/files/styles/style.json';

const map = new maplibregl.Map({
  container: 'map',
  style: styleUrl,
  center: [-3.7, 40.4],
  zoom: 6
});

map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
// Control de geolocalización para mostrar la posición del usuario
const geolocateControl = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showUserHeading: true,
  fitBoundsOptions: { maxZoom: 12 }
});
map.addControl(geolocateControl, 'top-right');

// Cuando el mapa cargue, añade la capa raster de satélite debajo de las rutas
map.on('load', () => {
  // Intentar localizar automáticamente al usuario (solicita permiso del navegador)
  try { geolocateControl.trigger(); } catch (_) {}

  // Añade la fuente raster de ESRI
  map.addSource('esri-satellite', {
    type: 'raster',
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    ],
    tileSize: 256,
    attribution: '© ESRI, Earthstar Geographics'
  });
  // Inserta la capa raster justo debajo de la primera capa de rutas
  const layers = map.getStyle().layers;
  let firstLineLayer = layers.find(l => l.type === 'line');
  let beforeId = firstLineLayer ? firstLineLayer.id : undefined;
  map.addLayer({ id: 'satellite', type: 'raster', source: 'esri-satellite', minzoom:0, maxzoom:18 }, beforeId);

  map.addSource('fedme', { type: 'vector', url: 'https://vt-fedme.idee.es/files/services/senderos.json' });
  map.addLayer({
    id: 'fedme-rutas', type: 'line', source: 'fedme', 'source-layer': 'senderos-fedme',
    paint: { 'line-color': ['get', 'color'], 'line-width': 2 }
  });

  // Capa de hitbox (casi invisible) para facilitar clic/hover sobre rutas
  map.addLayer({
    id: 'fedme-rutas-hit', type: 'line', source: 'fedme', 'source-layer': 'senderos-fedme',
    paint: { 'line-color': '#000000', 'line-opacity': 0.001, 'line-width': 14 }
  });

  map.addSource('selected-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  // Glow sutil bajo la ruta seleccionada
  map.addLayer({ id: 'selected-route-glow', type: 'line', source: 'selected-route', layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#0d6efd', 'line-width': 12, 'line-opacity': 0.28, 'line-blur': 3 }
  });

  // Trazo principal de la ruta seleccionada
  map.addLayer({ id: 'selected-route-layer', type: 'line', source: 'selected-route', layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#0d6efd', 'line-width': 4, 'line-opacity': 0.95 }
  });

  // Fuente y capas para marcar inicio y fin de la ruta seleccionada
  map.addSource('selected-route-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'selected-route-start', type: 'circle', source: 'selected-route-points', filter: ['==', ['get', 'kind'], 'start'],
    paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#0d6efd', 'circle-stroke-width': 3, 'circle-blur': 0.1 }
  });
  map.addLayer({ id: 'selected-route-end', type: 'circle', source: 'selected-route-points', filter: ['==', ['get', 'kind'], 'end'],
    paint: { 'circle-radius': 6, 'circle-color': '#0d6efd', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-blur': 0.1 }
  });

  // (tooltip mousemove se gestiona fuera para evitar duplicación)
});

// Helper: construye HTML con propiedades y (si existe) enlaces a gpx/kml
function featurePopupHtml(props) {
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px">`;
  for (const k of ['nombre','name','id','tipo','clasificacion','longitud']) {
    if (props[k]) html += `<b>${k}:</b> ${props[k]}<br>`;
  }
  html += `<hr style="margin:6px 0">`;
  const possibleUrlKeys = ['gpx','gpx_url','kml','kml_url','url','download'];
  let found = false;
  for (const key of possibleUrlKeys) {
    if (props[key]) { html += `<a href="${props[key]}" target="_blank" rel="noopener">Descargar (${key})</a><br>`; found = true; }
  }
  if (!found) {
    html += `Enlace de descarga no disponible en la tesela.<br>
             <a href="https://centrodedescargas.cnig.es/CentroDescargas/senderos-fedme" target="_blank" rel="noopener">
               Buscar KML/GPX en CentroDescargas (CNIG)
             </a>`;
  }
  html += `</div>`;
  return html;
}

// Popup global
const popup = new maplibregl.Popup({closeButton:true,closeOnClick:true});
let selectedRouteId = null;

// Helper: obtener rutas cerca de un punto ampliando el área de búsqueda (bbox en píxeles)
function getRouteFeaturesAtPoint(point, paddingPx = 8) {
  const bbox = [[point.x - paddingPx, point.y - paddingPx],[point.x + paddingPx, point.y + paddingPx]];
  const features = map.queryRenderedFeatures(bbox);
  return features.filter(f => { const props = f.properties || {}; return props.nombre || props.name || props.id; });
}

// Helper: obtener bounds y centro de una geometría LineString/MultiLineString
function getGeometryBoundsAndCenter(geom) {
  if (!geom || !geom.coordinates) return null;
  const coords = [];
  const collect = (c) => {
    if (!c) return;
    if (typeof c[0] === 'number') coords.push(c);
    else if (Array.isArray(c)) c.forEach(collect);
  };
  collect(geom.coordinates);
  if (!coords.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const xy of coords) {
    const x = xy[0], y = xy[1];
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  const center = [(minX + maxX) / 2, (minY + maxY) / 2];
  return { bounds: [[minX, minY], [maxX, maxY]], center };
}

// UI popups
const popupDiv = (() => {
  const existing = document.getElementById('route-popup');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'route-popup';
  document.body.appendChild(el);
  return el;
})();
popupDiv.style.position = 'absolute';
popupDiv.style.left = '10px';
popupDiv.style.top = '78px';
popupDiv.style.zIndex = '1000';
// Ancho fijo desde CSS
popupDiv.style.display = 'none';

const detailsPopupDiv = (() => {
  const existing = document.getElementById('route-details-popup');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'route-details-popup';
  document.body.appendChild(el);
  return el;
})();
detailsPopupDiv.style.position = 'absolute';
detailsPopupDiv.style.left = '10px';
detailsPopupDiv.style.zIndex = '1000';
// Ancho fijo desde CSS
detailsPopupDiv.style.display = 'none';
detailsPopupDiv.style.overflowY = 'auto';

function repositionDetailsPanel() {
  const top = popupDiv.offsetTop + popupDiv.offsetHeight + 10; // separación de 10px
  detailsPopupDiv.style.top = top + 'px';
  detailsPopupDiv.style.maxHeight = `calc(100vh - ${top + 10}px)`;
}
window.addEventListener('resize', repositionDetailsPanel);

// Búsqueda de imagen
async function searchRouteImage(routeName) {
  try {
    const cleanName = routeName.replace(/[.-]/g, ' ').trim();
    const searchQuery = encodeURIComponent(`${cleanName} sendero ruta senderismo España`);
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const googleSearchUrl = `https://www.google.com/search?q=${searchQuery}&tbm=isch&tbs=isz:m`;
    const response = await fetch(proxyUrl + encodeURIComponent(googleSearchUrl));
    const data = await response.json();
    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, 'text/html');
    const images = doc.querySelectorAll('img[src*="http"]');
    for (let img of images) {
      const src = img.getAttribute('src');
      if (src && src.includes('http') && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar') && src.length > 50) {
        return src;
      }
    }
    return null;
  } catch (error) { console.log('Error buscando imagen:', error); return null; }
}

async function loadRouteDetails(url) {
  try {
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const response = await fetch(proxyUrl + encodeURIComponent(url));
    const data = await response.json();
    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, 'text/html');
    const blocInfo1 = doc.querySelector('.blocInfo1.blocInfo');
    const blocInfo2 = doc.querySelector('.blocInfo2.blocInfo');
    let combinedContent = '';
    if (blocInfo1) combinedContent += blocInfo1.outerHTML;
    if (blocInfo2) combinedContent += blocInfo2.outerHTML;
    if (combinedContent) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = combinedContent;
      const images = tempDiv.querySelectorAll('img');
      images.forEach(img => img.remove());
      const h1s = tempDiv.querySelectorAll('h1'); h1s.forEach(h1 => { h1.style.fontSize='14px'; h1.style.fontWeight='bold'; });
      const h2s = tempDiv.querySelectorAll('h2'); h2s.forEach(h2 => { h2.style.fontSize='14px'; h2.style.fontWeight='bold'; });
      const h3s = tempDiv.querySelectorAll('h3'); h3s.forEach(h3 => { h3.style.fontSize='14px'; h3.style.fontWeight='bold'; });
      const h4s = tempDiv.querySelectorAll('h4'); h4s.forEach(h4 => { h4.style.fontSize='14px'; h4.style.fontWeight='bold'; });
      return tempDiv.innerHTML;
    }
    return null;
  } catch (error) { console.log('Error cargando detalles de la ruta:', error); return null; }
}

// Click en el mapa
map.on('click', async (e) => {
  const routeFeatures = getRouteFeaturesAtPoint(e.point, 10);
  if (!routeFeatures || routeFeatures.length === 0) {
    const selectedRouteSource = map.getSource('selected-route');
    if (selectedRouteSource) selectedRouteSource.setData({ type:'FeatureCollection', features:[] });
    const selectedPts = map.getSource('selected-route-points');
    if (selectedPts) selectedPts.setData({ type:'FeatureCollection', features:[] });
    popupDiv.classList.remove('show'); popupDiv.classList.add('hide'); setTimeout(() => { popupDiv.style.display='none'; popupDiv.classList.remove('hide'); }, 300);
    detailsPopupDiv.classList.remove('show'); detailsPopupDiv.classList.add('hide'); setTimeout(() => { detailsPopupDiv.style.display='none'; detailsPopupDiv.classList.remove('hide'); }, 300);
    return;
  }

  const feat = routeFeatures[0];
  const props = feat.properties || {};

  const selectedRouteSource = map.getSource('selected-route');
  if (selectedRouteSource) {
    selectedRouteSource.setData({ type:'Feature', geometry: feat.geometry, properties:{} });
  }

  // Inicio/fin
  const geom = feat.geometry || {};
  let startCoord = null, endCoord = null;
  if (geom.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 1) {
    startCoord = geom.coordinates[0]; endCoord = geom.coordinates[geom.coordinates.length - 1];
  } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    const firstLine = geom.coordinates[0] || []; const lastLine = geom.coordinates[geom.coordinates.length - 1] || [];
    if (firstLine.length > 0) startCoord = firstLine[0]; if (lastLine.length > 0) endCoord = lastLine[lastLine.length - 1];
  }
  const selectedPts = map.getSource('selected-route-points');
  if (selectedPts) {
    const features = [];
    if (startCoord) features.push({ type:'Feature', geometry:{ type:'Point', coordinates:startCoord }, properties:{ kind:'start' } });
    if (endCoord) features.push({ type:'Feature', geometry:{ type:'Point', coordinates:endCoord }, properties:{ kind:'end' } });
    selectedPts.setData({ type:'FeatureCollection', features });
  }

  // Botón Street View al inicio de la ruta (si hay coordenadas)
  let streetViewBtnHtml = '';
  if (startCoord && Array.isArray(startCoord) && startCoord.length >= 2) {
    const lng = startCoord[0];
    const lat = startCoord[1];
    const svUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}&heading=0&pitch=0&fov=80`;
    streetViewBtnHtml = `
      <a href="${svUrl}" target="_blank" rel="noopener" class="btn btn-outline-secondary btn-sm">
  <i class="fas fa-street-view me-1"></i>Inicio 3D
      </a>`;
  } else {
    streetViewBtnHtml = `
      <button class="btn btn-outline-secondary btn-sm" disabled title="Inicio no disponible">
  <i class="fas fa-street-view me-1"></i>Inicio 3D
      </button>`;
  }

  // Centrar y ampliar un poco el mapa sobre la ruta seleccionada
  const gc = getGeometryBoundsAndCenter(geom);
  if (gc && gc.center) {
    const currentZoom = map.getZoom();
    const targetZoom = Math.min(currentZoom + 1.3, 12);
    map.easeTo({ center: gc.center, zoom: targetZoom, duration: 800, essential: true });
  }

  selectedRouteId = props.id;

  // Panel principal
  let html = `
    <div class="card border-0 d-flex flex-column">
      <div class="card-header bg-primary text-white py-2">
        <h6 class="mb-0"><i class="fas fa-route me-2"></i>Información de la Ruta</h6>
      </div>
      <div class="card-body p-3 d-flex flex-column">
        <div class="flex-grow-1">`;

  // Título (código + icono) y nombre sin código
  let nombre = props.nombre || props.name || '';
  let nombreSimple = nombre.split('.')[0].trim();
  const titleName = (nombre.indexOf('.') >= 0) ? nombre.substring(nombre.indexOf('.') + 1).trim() : nombreSimple;
  const upperName = nombreSimple.toUpperCase();
  const meta = ((props.tipo || props.clasificacion || '').toString()).toUpperCase();
  let routeType = null;
  if (/^GR\b/.test(upperName) || meta.includes('GR')) routeType = 'gr'; else if (/^PR\b/.test(upperName) || meta.includes('PR')) routeType = 'pr'; else if (/^SL\b/.test(upperName) || meta.includes('SL')) routeType = 'sl';
  const iconPath = routeType ? `img/${routeType}.png` : null;
  if (nombreSimple) {
    html += `
      <div class="mb-3">
        <h5 class="fw-bold text-primary mb-1 d-flex align-items-center">
          ${iconPath ? `<img src="${iconPath}" alt="${routeType?.toUpperCase() || ''}" class="route-type-icon me-2" onerror="this.style.display='none'">` : ''}
          <span>${nombreSimple}</span>
        </h5>
      </div>
    `;
  }

  for (const k of ['nombre','id','longitud']) {
    if (props[k]) {
      let label = k.charAt(0).toUpperCase() + k.slice(1);
      let value = props[k];
      if (k === 'longitud') { label = 'Longitud'; value = `${props[k]} km`; }
      else if (k === 'nombre') { value = titleName; }
      html += `
        <div class="mb-2">
          <small class="text-muted">${label}:</small><br>
          <span class="fw-medium">${value}</span>
        </div>
      `;
    }
  }

  html += `</div>`;

  // Descargas y acciones
  const possibleUrlKeys = ['gpx','kml','url','download'];
  let found = false;
  let gpxBtn = '', kmlBtn = '', extraDlButtons = '';
  for (const key of possibleUrlKeys) {
    if (!props[key]) continue;
    const href = props[key];
    const btn = `
      <a href="${href}" target="_blank" rel="noopener" class="btn btn-outline-success btn-sm">
        <i class="fas fa-download me-1"></i>${key.toUpperCase()}
      </a>`;
    if (key === 'gpx') gpxBtn = btn;
    else if (key === 'kml') kmlBtn = btn;
    else extraDlButtons += btn;
    found = true;
  }
  if (found) {
    html += `
      <div class="mt-auto">
        <hr class="my-2">
        <div>
          <div class="action-buttons d-flex flex-wrap align-items-center gap-1 w-100">
            ${gpxBtn}
            ${kmlBtn}
            ${extraDlButtons}
            ${streetViewBtnHtml}
            ${props.url_info ? `
            <a href="${props.url_info}" target="_blank" rel="noopener" class="btn btn-outline-info btn-sm">
              <i class=\"fas fa-info-circle me-1\"></i>INFO
            </a>` : ''}
          </div>
        </div>
      </div>`;
  } else {
    html += `
      <div class="mt-auto">
        <hr class="my-2">
        <div class="text-center">
          <small class="text-muted">Enlace directo no disponible</small><br>
          <a href="https://centrodedescargas.cnig.es/CentroDescargas/senderos-fedme" target="_blank" rel="noopener" class="btn btn-outline-primary btn-sm mt-2">
            <i class="fas fa-external-link-alt me-1"></i>Centro de Descargas CNIG
          </a>
          <div class="mt-2">${streetViewBtnHtml}</div>
        </div>
      </div>`;
  }

  html += `</div></div>`;
  popupDiv.innerHTML = html;
  popupDiv.style.display = 'block';
  popupDiv.offsetHeight; popupDiv.classList.add('show');
  repositionDetailsPanel();

  if (props.url_info) {
    detailsPopupDiv.innerHTML = `
      <div class="card border-0">
        <div class="card-header bg-info text-white py-2">
          <h6 class="mb-0"><i class="fas fa-info-circle me-2"></i>Detalles Adicionales</h6>
        </div>
        <div class="card-body p-3 d-flex justify-content-center align-items-center">
          <div class="text-center">
            <div class="spinner-border text-primary" role="status"><span class="visually-hidden">Cargando...</span></div>
            <p class="mt-2 mb-0"><small class="text-muted">Cargando información adicional...</small></p>
          </div>
        </div>
      </div>`;
  detailsPopupDiv.style.display = 'block'; detailsPopupDiv.offsetHeight; detailsPopupDiv.classList.add('show'); repositionDetailsPanel();

    const [detailsHtml, imageUrl] = await Promise.all([
      loadRouteDetails(props.url_info),
      searchRouteImage(nombreSimple)
    ]);

    if (detailsHtml || imageUrl) {
      let contentHtml = '';
      if (imageUrl) {
        contentHtml += `
          <div class="mb-3">
            <img src="${imageUrl}" alt="${nombreSimple}" class="img-fluid rounded" style="max-height: 180px; width: 100%; object-fit: cover; object-position: center; box-shadow: 0 2px 8px rgba(0,0,0,0.15);" onerror="this.style.display='none';">
          </div>`;
      }
      if (detailsHtml) { if (imageUrl) contentHtml += '<hr class="my-2">'; contentHtml += detailsHtml; }
  detailsPopupDiv.innerHTML = `
        <div class="card border-0">
          <div class="card-header bg-info text-white py-2">
            <h6 class="mb-0"><i class="fas fa-info-circle me-2"></i>Detalles Adicionales</h6>
          </div>
          <div class="card-body p-3" style="font-size: 12px;">${contentHtml}</div>
        </div>`;
  repositionDetailsPanel();
    } else {
  detailsPopupDiv.innerHTML = `
        <div class="card border-0">
          <div class="card-header bg-warning text-white py-2">
            <h6 class="mb-0"><i class="fas fa-exclamation-triangle me-2"></i>Sin Detalles</h6>
          </div>
          <div class="card-body p-3 d-flex justify-content-center align-items-center">
            <div class="text-center">
              <small class="text-muted">No se pudieron cargar los detalles adicionales ni imagen</small><br>
              <small class="text-muted">Haz clic en el botón INFO para ver la información completa</small>
            </div>
          </div>
        </div>`;
  repositionDetailsPanel();
    }
  }
});

// Mousemove de refuerzo para cursor y tooltip con hitbox ampliada (seguro)
map.on('mousemove', (e) => {
  const routeFeatures = getRouteFeaturesAtPoint(e.point, 8);
  map.getCanvas().style.cursor = (routeFeatures && routeFeatures.length) ? 'pointer' : '';
  const tooltip = document.getElementById('route-tooltip');
  if (routeFeatures && routeFeatures.length > 0) {
    const feat = routeFeatures[0];
    const props = feat.properties || {};
    let nombre = props.nombre || props.name || '';
    let codigo = nombre.split('.')[0].trim();
    if (codigo) {
      tooltip.innerHTML = codigo;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.originalEvent.pageX + 10) + 'px';
      tooltip.style.top = (e.originalEvent.pageY - 25) + 'px';
    }
  } else {
    tooltip.style.display = 'none';
  }
});

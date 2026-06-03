const RAWRGB_PMTILES_URL = 'https://huggingface.co/datasets/markmclaren/global-bathymetry-pmtiles/resolve/main/gebco_2026_terrain_rgb.pmtiles';
const LUT_SIZE = 2048;
const LUT_MIN = -11000;
const LUT_RANGE = 11000;

const rainbowStops = [
  [-11000, [182, 0, 208]],
  [-6000, [182, 0, 208]],
  [-5500, [120, 24, 207]],
  [-4800, [18, 0, 145]],
  [-3000, [0, 87, 217]],
  [-500, [0, 199, 220]],
  [-200, [2, 228, 17]],
  [-40, [229, 235, 2]],
  [-5, [255, 8, 30]],
  [0, [206, 0, 16]]
];

function _clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
function _depthColorRaw(elev, stops) {
  if (!stops || stops.length === 0) return [0, 0, 0];
  if (elev <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (elev <= b[0]) {
      const t = (elev - a[0]) / (b[0] - a[0]);
      return [
        _clampByte(a[1][0] + (b[1][0] - a[1][0]) * t),
        _clampByte(a[1][1] + (b[1][1] - a[1][1]) * t),
        _clampByte(a[1][2] + (b[1][2] - a[1][2]) * t)
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function buildLut(stops) {
  const lut = new Uint8Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const elev = LUT_MIN + (i / (LUT_SIZE - 1)) * LUT_RANGE;
    const [r, g, b] = _depthColorRaw(elev, stops);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}

const paletteLuts = {
  rainbowcolour: buildLut(rainbowStops)
};

const pmtilesCache = new Map();
const rawBytesCache = new Map();
const recolouredTileCache = new Map();
const MAX_RAW_CACHE_SIZE = 512;
const MAX_RECOLOURED_CACHE_SIZE = 512;
const tileCanvas = document.createElement('canvas');
const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });
const boostCanvas = document.createElement('canvas');
const boostCtx = boostCanvas.getContext('2d', { willReadFrequently: true });

function lruGet(cache, key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function lruSet(cache, key, value, maxSize) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > maxSize) cache.delete(cache.keys().next().value);
}

function getPmtilesArchive(url) {
  if (!pmtilesCache.has(url)) pmtilesCache.set(url, new pmtiles.PMTiles(url));
  return pmtilesCache.get(url);
}

function detectMimeType(bytes) {
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return 'application/octet-stream';
}

function decodeTerrainRgbElevation(r, g, b) {
  return (r * 65536 + g * 256 + b) * 0.1 - 10000;
}

async function recolorTerrainRgbTile(tileBytes, paletteName) {
  const lut = paletteLuts[paletteName] || paletteLuts.rainbowcolour;
  const blob = new Blob([tileBytes], { type: detectMimeType(tileBytes) });
  const srcBitmap = await createImageBitmap(blob);
  tileCanvas.width = srcBitmap.width;
  tileCanvas.height = srcBitmap.height;
  tileCtx.clearRect(0, 0, tileCanvas.width, tileCanvas.height);
  tileCtx.drawImage(srcBitmap, 0, 0);
  srcBitmap.close();

  const img = tileCtx.getImageData(0, 0, tileCanvas.width, tileCanvas.height);
  const data = img.data;
  const lutMax = LUT_SIZE - 1;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);
    if (elevation > 0) {
      data[i + 3] = 0;
      continue;
    }
    const idx = ((elevation - LUT_MIN) / LUT_RANGE * lutMax + 0.5) | 0;
    const li = (idx < 0 ? 0 : idx > lutMax ? lutMax : idx) * 3;
    data[i] = lut[li];
    data[i + 1] = lut[li + 1];
    data[i + 2] = lut[li + 2];
    data[i + 3] = 255;
  }

  tileCtx.putImageData(img, 0, 0);
  return createImageBitmap(tileCanvas);
}

function parseRawRgbUrl(url) {
  const withoutScheme = url.replace(/^(rawrgb|boostdem)pmtiles:\/\//, '');
  const [pathPart, queryPart = ''] = withoutScheme.split('?');
  const match = pathPart.match(/^(.+\.pmtiles)\/(\d+)\/(\d+)\/(\d+)$/);
  if (!match) throw new Error(`Invalid rawrgbpmtiles URL: ${url}`);
  const pmtilesUrl = new URL(match[1], window.location.href).toString();
  const params = new URLSearchParams(queryPart);
  return {
    pmtilesUrl,
    z: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
    palette: params.get('palette') || 'rainbowcolour',
    mode: params.get('mode') || 'depth'
  };
}

const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

maplibregl.addProtocol('rawrgbpmtiles', async (params) => {
  if (params.signal?.aborted) return { data: new Uint8Array() };
  const cacheKey = params.url;
  const cachedBitmapPromise = lruGet(recolouredTileCache, cacheKey);
  if (cachedBitmapPromise) return { data: await cachedBitmapPromise };

  const { pmtilesUrl, z, x, y, palette } = parseRawRgbUrl(params.url);
  const rawKey = `${pmtilesUrl}:${z}/${x}/${y}`;

  const recolourPromise = (async () => {
    if (params.signal?.aborted) return new Uint8Array();
    let rawPromise = lruGet(rawBytesCache, rawKey);
    if (!rawPromise) {
      rawPromise = (async () => {
        const archive = getPmtilesArchive(pmtilesUrl);
        const tile = await archive.getZxy(z, x, y);
        if (!tile || !tile.data) return null;
        return tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
      })();
      lruSet(rawBytesCache, rawKey, rawPromise, MAX_RAW_CACHE_SIZE);
    }
    const bytes = await rawPromise;
    if (!bytes) return new Uint8Array();
    if (params.signal?.aborted) return new Uint8Array();
    return recolorTerrainRgbTile(bytes, palette);
  })();

  lruSet(recolouredTileCache, cacheKey, recolourPromise, MAX_RECOLOURED_CACHE_SIZE);
  try {
    const bitmap = await recolourPromise;
    return { data: bitmap };
  } catch (error) {
    recolouredTileCache.delete(cacheKey);
    throw error;
  }
});

maplibregl.addProtocol('boostdempmtiles', async (params) => {
  if (params.signal?.aborted) return { data: new Uint8Array() };
  const { pmtilesUrl, z, x, y, mode } = parseRawRgbUrl(params.url);

  let rawPromise = lruGet(rawBytesCache, `${pmtilesUrl}:${z}/${x}/${y}`);
  if (!rawPromise) {
    rawPromise = (async () => {
      const archive = getPmtilesArchive(pmtilesUrl);
      const tile = await archive.getZxy(z, x, y);
      if (!tile || !tile.data) return null;
      return tile.data instanceof Uint8Array ? tile.data : new Uint8Array(tile.data);
    })();
    lruSet(rawBytesCache, `${pmtilesUrl}:${z}/${x}/${y}`, rawPromise, MAX_RAW_CACHE_SIZE);
  }

  const bytes = await rawPromise;
  if (!bytes) return { data: new Uint8Array() };

  const blob = new Blob([bytes], { type: detectMimeType(bytes) });
  const srcBitmap = await createImageBitmap(blob);

  boostCanvas.width = srcBitmap.width;
  boostCanvas.height = srcBitmap.height;
  boostCtx.clearRect(0, 0, boostCanvas.width, boostCanvas.height);
  boostCtx.drawImage(srcBitmap, 0, 0);
  srcBitmap.close();

  const img = boostCtx.getImageData(0, 0, boostCanvas.width, boostCanvas.height);
  const data = img.data;

  for (let i = 0; i < data.length; i += 4) {
    let elevation = 0;
    if (data[i + 3] !== 0) {
      elevation = decodeTerrainRgbElevation(data[i], data[i + 1], data[i + 2]);
    }
    let targetElevation = elevation > 0 ? 0 : elevation;
    if (mode === 'height') targetElevation = -targetElevation;

    const newRaw = Math.max(0, Math.round((targetElevation + 10000) * 10));
    data[i]     = (newRaw >> 16) & 0xFF;
    data[i + 1] = (newRaw >> 8)  & 0xFF;
    data[i + 2] =  newRaw        & 0xFF;
    data[i + 3] = 255;
  }

  boostCtx.putImageData(img, 0, 0);
  const bitmap = await createImageBitmap(boostCanvas);
  return { data: bitmap };
});

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://markmclaren.github.io/global-bathymetry-pmtiles/3d/styles.json',
  center: [-67.7268046, 13.7918197],
  zoom: 4.96,
  minZoom: 3,
  maxZoom: 10,
  pitch: 30,
  bearing: 0,
  attributionControl: { compact: true }
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

// ZOOM DISPLAY
const _zoomEl = document.getElementById('zoom-value');
if (_zoomEl) {
  const _updateZoom = () => { _zoomEl.textContent = map.getZoom().toFixed(2); };
  map.on('zoom', _updateZoom);
  map.on('load', _updateZoom);
}

function makeMarkerEl(numeral) {
  const div = document.createElement('div');
  div.className = 'mermaid-marker';
  div.innerHTML = `
    <svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
      <circle cx="22" cy="22" r="20" fill="#0a1628" stroke="#c5a059" stroke-width="2"/>
      <circle cx="22" cy="22" r="16" fill="none" stroke="#c5a059" stroke-width="0.5" opacity="0.5"/>
      <text x="22" y="27" text-anchor="middle" font-family="Cinzel, serif" font-size="11" fill="#c5a059" font-weight="600">${numeral}</text>
    </svg>`;
  return div;
}

map.on('load', () => {
  fetch('data/locations.geojson')
    .then(r => r.json())
    .then(geojson => {
      const LOCATIONS = geojson.features
        .filter(feature => feature.properties?.id)
        .map(feature => ({
          id: feature.properties.id,
          name: feature.properties.name,
          subtitle: feature.properties.subtitle,
          numeral: feature.properties.numeral,
          lat: feature.geometry.coordinates[1],
          lng: feature.geometry.coordinates[0],
          description: feature.properties.description,
          artist: feature.properties.artist,
          images: feature.properties.images.map(filename => `images/${filename}`)
        }));

      const labelFeatures = geojson.features.filter(feature => feature.properties?.placename);

      LOCATIONS.forEach(loc => {
        const el = makeMarkerEl(loc.numeral);
        el.addEventListener('click', () => openCard(loc));

        new maplibregl.Marker({ element: el })
          .setLngLat([loc.lng, loc.lat])
          .addTo(map);
      });

      map.addSource('location-labels', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: labelFeatures
        }
      });

    map.addLayer({
      id: 'location-labels',
      type: 'symbol',
      source: 'location-labels',
      layout: {
        'text-field': ['get', 'placename'],
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
        'text-size': 18,
        'text-anchor': 'center',
        'text-offset': [0, 0],
        'text-allow-overlap': true,
        'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right']
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#0a1628',
        'text-halo-width': 2
      }
    });
  });
});

let currentImgIdx = 0;
let currentImages = [];

function openCard(loc) {
  currentImages = loc.images;
  currentImgIdx = 0;

  document.getElementById('card-numeral').textContent = loc.numeral;
  document.getElementById('card-title').textContent = loc.name;
  document.getElementById('card-location').textContent = loc.subtitle;
  document.getElementById('card-description').innerHTML = loc.description;
  document.getElementById('card-artist').textContent = 'Artwork: ' + loc.artist;

  const illus = document.getElementById('card-illustration');
  illus.innerHTML = '';

  currentImages.forEach((src, i) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = loc.name;
    if (i === 0) img.classList.add('active');
    illus.appendChild(img);
  });

  if (currentImages.length > 1) {
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'img-arrow img-arrow-left';
    prev.setAttribute('aria-label', 'Previous image');
    prev.textContent = '‹';
    prev.onclick = () => showImg(currentImgIdx - 1);
    illus.appendChild(prev);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'img-arrow img-arrow-right';
    next.setAttribute('aria-label', 'Next image');
    next.textContent = '›';
    next.onclick = () => showImg(currentImgIdx + 1);
    illus.appendChild(next);

    const nav = document.createElement('div');
    nav.className = 'img-nav';
    currentImages.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'img-dot' + (i === 0 ? ' active' : '');
      dot.type = 'button';
      dot.onclick = () => showImg(i);
      nav.appendChild(dot);
    });
    illus.appendChild(nav);
  }

  document.getElementById('tarot-modal').classList.add('visible');
}

function showImg(idx) {
  const imageCount = currentImages.length;
  const normalizedIndex = ((idx % imageCount) + imageCount) % imageCount;
  const illus = document.getElementById('card-illustration');
  const imgs = illus.querySelectorAll('img');
  const dots = illus.querySelectorAll('.img-dot');
  imgs.forEach((img, i) => img.classList.toggle('active', i === normalizedIndex));
  dots.forEach((dot, i) => dot.classList.toggle('active', i === normalizedIndex));
  currentImgIdx = normalizedIndex;
}

function closeCardModal() {
  document.getElementById('tarot-modal').classList.remove('visible');
}

function closeModal(e) {
  if (e.target === document.getElementById('tarot-modal')) closeCardModal();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCardModal();
});

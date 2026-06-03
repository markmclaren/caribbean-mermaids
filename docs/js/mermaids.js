const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [-67.7268046, 13.7918197],
  zoom: 10,
  minZoom: 3,
  maxZoom: 12,
  attributionControl: { compact: true }
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

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

fetch('data/locations.geojson')
  .then(r => r.json())
  .then(geojson => {
    const LOCATIONS = geojson.features.map(feature => ({
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

    LOCATIONS.forEach(loc => {
      const el = makeMarkerEl(loc.numeral);
      el.addEventListener('click', () => openCard(loc));

      new maplibregl.Marker({ element: el })
        .setLngLat([loc.lng, loc.lat])
        .addTo(map);
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
  document.getElementById('card-description').textContent = loc.description;
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

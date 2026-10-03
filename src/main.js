import './style.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import axios from 'axios';

/* ---------- Config ---------- */
// Key comes from the .env file (VITE_ prefix is required by Vite).
const NASA_KEY = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY';
const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const TOPICS = ['Mars', 'Nebula', 'Apollo', 'Jupiter', 'Saturn', 'Galaxy', 'Aurora'];

/* ---------- Helpers ---------- */
const $ = (s) => document.querySelector(s);

// XSS protection: escape every API string before it touches innerHTML.
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only allow HTTPS URLs (blocks javascript: URLs and mixed content).
const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? u : '');

const errorBox = (msg) => `<div class="state error"><strong>Something went wrong</strong><p>${esc(msg)}</p></div>`;

/* ---------- 1. Earth from space: NASA EPIC (Axios) ---------- */
const dateInput = $('#earth-date');
const epicGet = (path) =>
  axios.get(`https://api.nasa.gov/EPIC/api/natural${path}`, { params: { api_key: NASA_KEY }, timeout: 20000 });
const epicImg = (d) => {
  const [y, m, day] = d.date.slice(0, 10).split('-');
  return `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${day}/jpg/${d.image}.jpg`;
};

async function loadEarth(date) {
  const box = $('#earth-content');
  box.innerHTML = '<div class="skeleton tall"></div>';
  try {
    if (!date) {
      // Ask the API which dates have photos and use the newest one.
      const { data } = await epicGet('/all');
      date = data.map((d) => d.date).sort().pop();
      dateInput.max = date;
    }
    const { data: shots } = await epicGet(`/date/${date}`);
    if (!Array.isArray(shots) || !shots.length) {
      box.innerHTML = `<div class="state">No Earth photos exist for ${esc(date)}. Try a nearby date.</div>`;
      return;
    }
    dateInput.value = date;

    box.innerHTML = `
      <article class="apod">
        <div class="apod-media contain"><img id="e-img" alt="Earth photographed by NASA's EPIC camera" /></div>
        <div class="apod-text">
          <time id="e-time"></time>
          <h3>Earth, as seen by DSCOVR</h3>
          <p id="e-cap"></p>
          <dl class="mini">
            <div><dt>Centre of view</dt><dd id="e-pos"></dd></div>
            <div><dt>Distance from Earth</dt><dd id="e-dist"></dd></div>
          </dl>
          <label class="slider">
            <span>Photo <b id="e-n"></b> of ${shots.length} taken this day</span>
            <input type="range" id="e-range" min="0" max="${shots.length - 1}" value="${shots.length - 1}" />
          </label>
        </div>
      </article>`;

    const show = (i) => {
      const d = shots[i];
      const img = $('#e-img');
      img.src = epicImg(d);
      $('#e-time').textContent = `${d.date} UTC`;
      $('#e-cap').textContent = d.caption || '';
      const c = d.centroid_coordinates;
      $('#e-pos').textContent = c ? `${Math.abs(c.lat).toFixed(1)}°${c.lat >= 0 ? 'N' : 'S'}, ${Math.abs(c.lon).toFixed(1)}°${c.lon >= 0 ? 'E' : 'W'}` : 'n/a';
      const p = d.dscovr_j2000_position;
      $('#e-dist').textContent = p ? `${Math.round(Math.hypot(p.x, p.y, p.z)).toLocaleString()} km` : 'n/a';
      $('#e-n').textContent = i + 1;
    };
    $('#e-img').addEventListener('error', (e) => {
      e.target.parentElement.innerHTML = '<div class="state">The photo could not be loaded from NASA.</div>';
    });
    $('#e-range').addEventListener('input', (e) => show(Number(e.target.value)));
    show(shots.length - 1);
  } catch (err) {
    const status = err.response?.status;
    const msg =
      status === 429
        ? 'The shared DEMO_KEY hit its hourly limit. Add your own free NASA key in the .env file.'
        : status === 403
        ? 'NASA rejected the API key. Check VITE_NASA_API_KEY in your .env file.'
        : status === 400 || status === 404
        ? 'No photos are available for that date. Try an earlier day.'
        : 'Could not reach NASA. Check your connection and try again.';
    box.innerHTML = errorBox(msg);
  }
}
dateInput.addEventListener('change', () => dateInput.value && loadEarth(dateInput.value));

/* ---------- 2. Live ISS tracker (Fetch + Leaflet) ---------- */
const map = L.map('map', { minZoom: 2, maxZoom: 6, worldCopyJump: true }).setView([20, 0], 2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 6,
}).addTo(map);

const issIcon = L.divIcon({ className: 'iss-icon', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] });
const trail = L.polyline([], { color: '#f5b84b', weight: 2, opacity: 0.6 }).addTo(map);
let marker = null;
let followed = false;
let lastLon = null;

function setStatus(live) {
  const pill = $('#iss-status');
  pill.classList.toggle('live', live);
  pill.querySelector('b').textContent = live ? 'Live' : 'Reconnecting';
}

async function updateIss() {
  try {
    const res = await fetch(ISS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const pos = [d.latitude, d.longitude];

    if (!marker) marker = L.marker(pos, { icon: issIcon, keyboard: false }).addTo(map);
    else marker.setLatLng(pos);

    // Start a new trail when the ISS crosses the date line.
    if (lastLon !== null && Math.abs(d.longitude - lastLon) > 180) trail.setLatLngs([]);
    lastLon = d.longitude;
    trail.addLatLng(pos);
    if (trail.getLatLngs().length > 90) trail.getLatLngs().shift();
    trail.redraw();

    if (!followed) { map.setView(pos, 3); followed = true; }

    $('#iss-lat').textContent = `${d.latitude.toFixed(2)}°`;
    $('#iss-lon').textContent = `${d.longitude.toFixed(2)}°`;
    $('#iss-alt').textContent = `${Math.round(d.altitude).toLocaleString()} km`;
    $('#iss-vel').textContent = `${Math.round(d.velocity).toLocaleString()} km/h`;
    $('#iss-vis').textContent = d.visibility === 'daylight' ? 'In daylight' : d.visibility === 'eclipsed' ? 'In Earth\u2019s shadow' : 'Twilight';
    setStatus(true);
  } catch {
    setStatus(false);
  }
}

/* ---------- 3. Image gallery (Fetch, NASA Image Library) ---------- */
const grid = $('#grid');
const viewer = $('#viewer');
let results = [];

async function loadGallery(query) {
  grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton card-sk"></div>').join('');
  try {
    const params = new URLSearchParams({ q: query, media_type: 'image', page_size: '24' });
    const res = await fetch(`https://images-api.nasa.gov/search?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    results = (json.collection?.items || [])
      .filter((i) => i.data?.[0] && safeUrl(i.links?.[0]?.href))
      .map((i) => ({
        title: i.data[0].title || 'Untitled',
        desc: i.data[0].description || '',
        year: (i.data[0].date_created || '').slice(0, 4),
        img: i.links[0].href,
      }));

    if (!results.length) {
      grid.innerHTML = `<div class="state">No images found for &ldquo;${esc(query)}&rdquo;. Try a broader word like &ldquo;moon&rdquo;.</div>`;
      return;
    }
    grid.innerHTML = results
      .map(
        (r, i) => `
        <button class="card" data-i="${i}">
          <img src="${esc(r.img)}" alt="${esc(r.title)}" loading="lazy" />
          <span><strong>${esc(r.title)}</strong>${r.year ? `<small>${esc(r.year)}</small>` : ''}</span>
        </button>`
      )
      .join('');
  } catch {
    grid.innerHTML = errorBox('Could not load images. Check your connection and search again.');
  }
}

grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const r = results[Number(card.dataset.i)];
  $('#viewer-img').src = r.img;
  $('#viewer-img').alt = r.title;
  $('#viewer-title').textContent = r.title; // textContent is XSS-safe
  const desc = r.desc.length > 500 ? r.desc.slice(0, 500) + '…' : r.desc;
  $('#viewer-desc').textContent = desc || 'No description provided.';
  viewer.showModal();
});
viewer.addEventListener('click', (e) => { if (e.target === viewer) viewer.close(); });

$('#chips').innerHTML = TOPICS.map((t) => `<button type="button" data-t="${esc(t)}">${esc(t)}</button>`).join('');
$('#chips').addEventListener('click', (e) => {
  const t = e.target.dataset.t;
  if (!t) return;
  $('#q').value = t;
  loadGallery(t);
});
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (q) loadGallery(q);
});

/* ---------- Start ---------- */
loadEarth();
updateIss();
setInterval(updateIss, 5000);
$('#q').value = 'Mars';
loadGallery('Mars');

/* ============================================================
   IGSCLAC Eventos - Lógica de aplicación
   - Persistencia: Base de datos a través de API REST personalizada
   - SPA: navegación simulada cambiando #content
   - Roles: 'user' | 'admin' (toggle)
   ============================================================ */

// ---------- ESTADO GLOBAL ----------

if (typeof wpApiSettings === 'undefined') {
  console.error('wpApiSettings no está definido. Revisa la localización del script.');
  var wpApiSettings = { root: '/wp-json/', nonce: '' };
}

const PER_PAGE = 6;

let state = {
  role: localStorage.getItem('igsclac_role') || 'user',
  view: 'home',
  search: '',
  pageHome: 1,
  pageAcad: 1,
  pageInv: 1,
};

const savedView = localStorage.getItem('igsclac_view');
if (savedView && ['home', 'academicos', 'investigacion', 'admin', 'contacto'].includes(savedView)) {
  if (savedView === 'admin' && state.role !== 'admin') {
    state.view = 'home';
  } else {
    state.view = savedView;
  }
} else {
  state.view = 'home';
}

const API_BASE = wpApiSettings.root + 'igsclac/v1';

// ---------- HELPERS ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => { if (!d) return ''; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }); };
function toast(msg, type = '') { const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + type; clearTimeout(window._tt); window._tt = setTimeout(() => t.classList.remove('show'), 3200); }

function calcDuration(ini, fin) {
  if (!ini || !fin) return '';
  const [h1, m1] = ini.split(':').map(Number);
  const [h2, m2] = fin.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  const h = Math.floor(mins / 60), m = mins % 60;
  return (h ? h + 'h ' : '') + (m ? m + 'min' : '').trim() || '0min';
}

function formatTime(t) {
  if (!t) return '';
  return t.substring(0, 5);
}

function calcDays(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return 1;
  const start = new Date(fechaInicio + 'T00:00:00');
  const end = new Date(fechaFin + 'T00:00:00');
  const diff = (end - start) / (1000 * 60 * 60 * 24);
  return diff < 0 ? 1 : Math.floor(diff) + 1;
}

function sortRegistros(registros, sortBy) {
  const sorted = [...registros];
  if (sortBy === 'lastname_asc') {
    sorted.sort((a, b) => a.apellidos.localeCompare(b.apellidos));
  } else if (sortBy === 'lastname_desc') {
    sorted.sort((a, b) => b.apellidos.localeCompare(a.apellidos));
  }
  return sorted;
}

function downloadAttendeesCSV(registros, eventoTitle) {
  const cleanTitle = eventoTitle.toLowerCase()
    .replace(/[áéíóúñ]/g, (match) => ({
      'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n'
    }[match] || match))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const today = new Date();
  const fechaExportacion = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const filename = `asistentes-${cleanTitle}-${fechaExportacion}.csv`;

  const headers = ['Nombres', 'Apellidos', 'Email', 'Identificación', 'Cargo', 'Institución', 'Fecha de registro'];

  const rows = registros.map(r => [
    r.nombres,
    r.apellidos,
    r.email,
    `${r.tipo_id} ${r.identificacion}`,
    r.cargo,
    r.institucion,
    new Date(r.fecha_registro).toLocaleString('es-CO')
  ]);

  let csvContent = `# Exportado el: ${today.toLocaleString('es-CO')}\n`;
  csvContent += headers.join(',') + '\n';
  rows.forEach(row => {
    const escapedRow = row.map(cell => {
      if (cell === undefined || cell === null) return '';
      const cellStr = String(cell);
      if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    }).join(',');
    csvContent += escapedRow + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach(el => el.remove());
  form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
}

function showFieldError(input, message) {
  const existingError = input.parentNode.querySelector('.field-error');
  if (existingError) existingError.remove();
  input.classList.add('error');
  const errorDiv = document.createElement('div');
  errorDiv.className = 'field-error';
  errorDiv.textContent = message;
  input.parentNode.appendChild(errorDiv);
}

// ---------- FUNCIONES DE RED ----------
async function fetchAPI(endpoint, options = {}) {
  const defaultOptions = {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  };

  /* Ya no verificamos nonce temporalmente
  if (options.method && options.method !== 'GET' && options.method !== 'HEAD') {
    defaultOptions.headers['X-WP-Nonce'] = wpApiSettings.nonce;
  }
*/

  if (options.body && typeof options.body === 'object') {
    defaultOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(API_BASE + endpoint, defaultOptions);

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || `Error ${res.status}`);
  }

  return res.json();
}

// Llamadas API
async function cargarEventos(tipo) {
  const endpoint = tipo === 'académico' ? '/eventos/academicos' : '/eventos/investigacion';
  return await fetchAPI(endpoint);
}

async function cargarEventosPaginado(tipo, page, perPage) {
  const endpoint = tipo === 'académico' ? '/eventos/academicos' : '/eventos/investigacion';
  const res = await fetch(API_BASE + endpoint + `?page=${page}&per_page=${perPage}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  const items = await res.json();
  const total = parseInt(res.headers.get('X-WP-Total') || '0', 10);
  const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10);
  const currentPage = parseInt(res.headers.get('X-WP-Page') || '1', 10);
  return { items, total, totalPages, currentPage };
}

async function guardarEvento(tipo, data, id = null) {
  const payload = { ...data, id };
  return await fetchAPI(`/eventos/${tipo}`, { method: 'POST', body: payload });
}

async function eliminarEvento(id) {
  return await fetchAPI(`/eventos/${id}`, { method: 'DELETE' });
}

async function cargarRegistros(eventoId) {
  return await fetchAPI(`/registros/${eventoId}`);
}

async function crearRegistro(data) {
  return await fetchAPI('/registros', { method: 'POST', body: data });
}

// ---------- HERO SLIDER ----------
const slides = [
  { t: 'Bienvenidos a IGSCLAC Eventos', s: 'Conferencias, ferias, seminarios y mucho más para la comunidad académica.', img: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1600', cta: 'Ver eventos académicos', action: "navigate('academicos')" },
  { t: 'Eventos de Investigación', s: 'Participa en conferencias, foros y coloquios con investigadores destacados.', img: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=1600', cta: 'Explorar investigación', action: "navigate('investigacion')" },
  { t: 'Inscríbete a nuestros eventos', s: 'Cupos limitados. Asegura tu lugar y vive la experiencia IGSCLAC.', img: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1600', cta: 'Ver agenda completa', action: "navigate('home')" }
];

function paginationHtml(currentPage, totalPages, context) {
  if (totalPages <= 1) return '';
  let pages = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages = [1];
    if (currentPage > 3) pages.push('…');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  const btn = (innerHtml, page, disabled, active, ariaLabel) => `
    <button class="pagination-btn${active ? ' active' : ''}"
      ${disabled ? 'disabled' : `onclick="goPage('${context}',${page})"`}
      aria-label="${ariaLabel}"
      ${active ? ' aria-current="page"' : ''}>
      ${innerHtml}
    </button>`;

  return `
    <nav class="pagination" aria-label="Paginación">
      ${btn('<i class="fa-solid fa-chevron-left"></i>', currentPage - 1, currentPage <= 1, false, 'Página anterior')}
      ${pages.map(p => p === '…'
    ? `<span class="pagination-ellipsis">…</span>`
    : btn(p, p, false, p === currentPage, `Ir a la página ${p}`)
  ).join('')}
      ${btn('<i class="fa-solid fa-chevron-right"></i>', currentPage + 1, currentPage >= totalPages, false, 'Página siguiente')}
    </nav>`;
}

async function goPage(context, page) {
  if (context === 'home') state.pageHome = page;
  if (context === 'acad') state.pageAcad = page;
  if (context === 'inv') state.pageInv = page;
  await render();
  document.getElementById('content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let slideIdx = 0;
function buildHero() {
  const hero = $('#hero');
  hero.querySelectorAll('.slide').forEach(n => n.remove());
  slides.forEach((sl, i) => {
    const div = document.createElement('div');
    div.className = 'slide' + (i === 0 ? ' active' : '');
    div.style.backgroundImage = `url('${sl.img}')`;
    div.innerHTML = `<div class="slide-content"><h1>${esc(sl.t)}</h1><p>${esc(sl.s)}</p><a href="#" class="slide-cta" onclick="${sl.action};return false;">${esc(sl.cta)} <i class="fa-solid fa-arrow-right"></i></a></div>`;
    hero.insertBefore(div, $('#hero-dots'));
  });
  const dots = $('#hero-dots'); dots.innerHTML = '';
  slides.forEach((_, i) => { const s = document.createElement('span'); s.className = i === 0 ? 'active' : ''; s.onclick = () => goSlide(i); dots.appendChild(s); });
}
function goSlide(i) {
  slideIdx = i;
  document.querySelectorAll('.slide').forEach((n, k) => n.classList.toggle('active', k === i));
  document.querySelectorAll('#hero-dots span').forEach((n, k) => n.classList.toggle('active', k === i));
}
setInterval(() => goSlide((slideIdx + 1) % slides.length), 5500);

// ---------- ROLES ----------
function toggleRole() {
  state.role = state.role === 'admin' ? 'user' : 'admin';
  localStorage.setItem('igsclac_role', state.role);
  applyRole();
  if (state.role === 'user' && state.view === 'admin') {
    navigate('home');
  } else {
    render();
  }
  toast('Modo cambiado a: ' + (state.role === 'admin' ? 'Administrador' : 'Usuario General'));
}
function applyRole() {
  $('#role-label').textContent = state.role === 'admin' ? 'Administrador' : 'Usuario General';
  $('#role-btn').textContent = state.role === 'admin' ? 'Cambiar a Usuario' : 'Cambiar a Admin';
  $('#nav-admin').style.display = state.role === 'admin' ? 'block' : 'none';
}

// ---------- NAVEGACIÓN ----------
function toggleDropdown(e) {
  e.stopPropagation();
  const dd = e.currentTarget.nextElementSibling;
  document.querySelectorAll('.dropdown.show').forEach(d => { if (d !== dd) d.classList.remove('show'); });
  dd.classList.toggle('show');
  e.currentTarget.setAttribute('aria-expanded', dd.classList.contains('show'));
}
document.addEventListener('click', () => document.querySelectorAll('.dropdown.show').forEach(d => d.classList.remove('show')));

async function navigate(view, params = {}) {
  state.view = view;
  localStorage.setItem('igsclac_view', view);
  state.params = params;
  document.querySelectorAll('.dropdown.show').forEach(d => d.classList.remove('show'));
  document.getElementById('nav-list').classList.remove('show');
  if (view === 'home') state.pageHome = 1;
  if (view === 'academicos') state.pageAcad = 1;
  if (view === 'investigacion') state.pageInv = 1;

  await render();

  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function setBreadcrumbs(items) {
  $('#breadcrumbs').innerHTML = items.map((it, i) => {
    const last = i === items.length - 1;
    return last ? `<strong>${esc(it.label)}</strong>` : `<a href="#" onclick="navigate('${it.view}');return false;">${esc(it.label)}</a><span>/</span>`;
  }).join('');
}

// ---------- BÚSQUEDA ----------
function handleSearch() {
  state.search = $('#search-input').value.trim().toLowerCase();
  state.pageHome = 1; state.pageAcad = 1; state.pageInv = 1;
  if (state.view === 'academicos' || state.view === 'investigacion' || state.view === 'home') render();
}

// ---------- RENDER ----------
async function render() {
  const c = $('#content');
  switch (state.view) {
    case 'home': await renderHome(c); break;
    case 'academicos': await renderEventList(c, 'académico'); break;
    case 'investigacion': await renderEventList(c, 'investigación'); break;
    case 'admin': await renderAdmin(c); break;
    case 'contacto': renderContact(c); break;
    default: await renderHome(c);
  }
  await renderUpcoming();
}

async function renderHome(c) {
  setBreadcrumbs([{ view: 'home', label: 'Inicio' }]);

  // Cargar todos los eventos (sin paginar)
  const acad = await cargarEventos('académico');
  const inv = await cargarEventos('investigación');
  let all = [...acad, ...inv].sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));

  // Aplicar búsqueda si existe
  if (state.search) {
    all = all.filter(e => e.titulo.toLowerCase().includes(state.search));
  }

  const total = all.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const start = (state.pageHome - 1) * PER_PAGE;
  const paginatedEvents = all.slice(start, start + PER_PAGE);

  c.innerHTML = `
    <div class="section-title"><h2><i class="fa-solid fa-star"></i> Bienvenidos al portal de eventos</h2></div>
    <p style="margin-bottom:24px;color:var(--text-soft)">Explora todos los eventos académicos y de investigación de IGSCLAC. Mantente al día con la agenda institucional y regístrate en los eventos disponibles.</p>
    <div class="section-title"><h2>Todos los eventos${state.search ? ` · resultados para "${esc(state.search)}"` : ''}</h2></div>
    ${paginatedEvents.length ? `<div class="events-grid">${(await Promise.all(paginatedEvents.map(e => cardHtml(e)))).join('')}</div>` : emptyHtml('No se encontraron eventos.')}
    ${paginationHtml(state.pageHome, totalPages, 'home')}
  `;
}

async function renderEventList(c, tipo) {
  const isAcad = tipo === 'académico';
  const page = isAcad ? state.pageAcad : state.pageInv;
  const context = isAcad ? 'acad' : 'inv';

  setBreadcrumbs([
    { view: 'home', label: 'Inicio' },
    { view: state.view, label: isAcad ? 'Académicos' : 'Investigación' }
  ]);

  try {
    let all = await cargarEventos(tipo);

    if (state.search) {
      all = all.filter(e => e.titulo.toLowerCase().includes(state.search));
    }

    all.sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));

    const total = all.length;
    const totalPages = Math.ceil(total / PER_PAGE);

    let currentPage = Math.min(page, totalPages || 1);
    if (currentPage < 1) currentPage = 1;

    if (isAcad) state.pageAcad = currentPage;
    else state.pageInv = currentPage;

    const start = (currentPage - 1) * PER_PAGE;
    const paginatedEvents = all.slice(start, start + PER_PAGE);

    c.innerHTML = `
      <div class="section-title">
        <h2><i class="fa-solid fa-${isAcad ? 'book' : 'flask'}"></i> Eventos ${isAcad ? 'Académicos' : 'de Investigación'}</h2>
        ${state.role === 'admin' ? `<button class="btn" onclick="openEventForm('${isAcad ? 'académico' : 'investigación'}')"><i class="fa-solid fa-plus"></i> Nuevo evento</button>` : ''}
      </div>
      ${paginatedEvents.length ? `<div class="events-grid">${(await Promise.all(paginatedEvents.map(e => cardHtml(e)))).join('')}</div>` : emptyHtml('No hay eventos disponibles en este momento.')}
      ${paginationHtml(currentPage, totalPages, context)}
    `;
  } catch (err) {
    console.error(err);
    c.innerHTML = emptyHtml('Error al cargar eventos.');
  }
}

function emptyHtml(msg) { return `<div class="empty"><i class="fa-regular fa-calendar-xmark"></i><p>${esc(msg)}</p></div>`; }

async function cardHtml(e) {
  const isAcad = e.tipo === 'académico';
  const regs = await cargarRegistros(e.id);
  const lleno = regs.length >= e.capacidad;
  return `
    <article class="event-card">
      <div class="flyer" style="background-image:url('${esc(e.imagen || 'https://placehold.co/600x400/009c1a/fff?text=Evento')}')">
        <span class="badge ${e.clasificacion === 'externo' ? 'ext' : ''}">${esc(e.clasificacion)}</span>
      </div>
      <div class="body">
        <h3>${esc(e.titulo)}</h3>
        <div class="meta">
          <span><i class="fa-regular fa-calendar"></i> ${fmtDate(e.fechaInicio)}${e.fechaFin && e.fechaFin !== e.fechaInicio ? ' → ' + fmtDate(e.fechaFin) : ''}</span>
          <span><i class="fa-solid fa-tag"></i> ${esc(e.tipoEvento)}</span>
        </div>
        <p class="desc">${esc((e.descripcion || '').slice(0, 120))}${(e.descripcion || '').length > 120 ? '…' : ''}</p>
        <div class="meta">
          <span><i class="fa-solid fa-location-dot"></i> ${esc(e.lugar)}</span>
          <span><i class="fa-solid fa-users"></i> ${regs.length}/${e.capacidad}</span>
        </div>
        <div class="actions">
          <button class="btn btn-secondary btn-sm" onclick="openEventDetail('${e.id}','${isAcad ? 'acad' : 'inv'}')"><i class="fa-solid fa-eye"></i> Ver más</button>
          ${e.registroHabilitado && state.role === 'user' ? `<button class="btn btn-sm" ${lleno ? 'disabled style="opacity:.6;cursor:not-allowed"' : ''} onclick="openRegister('${e.id}','${isAcad ? 'acad' : 'inv'}')"><i class="fa-solid fa-user-plus"></i> ${lleno ? 'Lleno' : 'Registrarse'}</button>` : ''}
          ${state.role === 'admin' ? `
            <button class="btn btn-sm" onclick="openEventForm('${e.tipo}','${e.id}')"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm" style="background:#6c757d; color:#fff;" onclick="duplicateEvent('${e.id}','${isAcad ? 'acad' : 'inv'}')"><i class="fa-regular fa-copy"></i></button>
            <button class="btn btn-sm btn-danger" onclick="deleteEvent('${e.id}','${isAcad ? 'acad' : 'inv'}')"><i class="fa-solid fa-trash"></i></button>
          ` : ''}
        </div>
      </div>
    </article>
  `;
}

// ---------- DETALLE EVENTO ----------
async function openEventDetail(id, tipoKey) {
  const eventos = tipoKey === 'acad' ? await cargarEventos('académico') : await cargarEventos('investigación');
  const e = eventos.find(x => x.id === id);
  if (!e) return;
  const originalRegistros = await cargarRegistros(id);
  const pct = Math.min(100, Math.round((originalRegistros.length / e.capacidad) * 100));
  const lleno = originalRegistros.length >= e.capacidad;
  const mapsQ = encodeURIComponent(e.direccion || e.lugar || 'Tuluá');

  const horaIni = formatTime(e.horaInicio);
  const horaFin = formatTime(e.horaFin);
  let horarioTexto = `${esc(horaIni)} - ${esc(horaFin)}`;

  const mismoDia = !e.fechaFin || e.fechaFin === e.fechaInicio;
  if (mismoDia) {
    const dur = calcDuration(e.horaInicio, e.horaFin);
    horarioTexto += ` (${dur})`;
  } else {
    const dias = calcDays(e.fechaInicio, e.fechaFin);
    horarioTexto += ` (${dias} Día${dias !== 1 ? 's' : ''})`;
  }

  const renderAttendeesTable = (registros, sortOrder) => {
    const sorted = sortRegistros(registros, sortOrder);
    if (!sorted.length) {
      return '<p style="color:var(--text-soft)">Aún no hay registros.</p>';
    }
    return `<div class="table-wrap"><table>
            <thead><tr><th>Nombre</th><th>Identificación</th><th>Email</th><th>Cargo</th><th>Institución</th></thead>
            <tbody>${sorted.map(r => `
                <tr>
                    <td>${esc(r.nombres)} ${esc(r.apellidos)}</td>
                    <td>${esc(r.tipo_id)} ${esc(r.identificacion)}</td>
                    <td>${esc(r.email)}</td>
                    <td>${esc(r.cargo)}</td>
                    <td>${esc(r.institucion)}</td>
                </tr>`).join('')}
            </tbody>
        </div>`;
  };

  let currentSortOrder = 'default';

  $('#modal-title').textContent = e.titulo;
  $('#modal-body').innerHTML = `
        ${e.imagen ? `<img src="${esc(e.imagen)}" alt="Flyer ${esc(e.titulo)}" class="detail-flyer" />` : ''}
        <p style="margin-bottom:14px">${esc(e.descripcion)}</p>
        <div class="detail-meta">
            <div><strong>Fecha</strong>${fmtDate(e.fechaInicio)}${e.fechaFin && e.fechaFin !== e.fechaInicio ? ' → ' + fmtDate(e.fechaFin) : ''}</div>
            <div><strong>Horario</strong>${horarioTexto}</div>
            <div><strong>Tipo</strong>${esc(e.tipoEvento)}</div>
            <div><strong>Clasificación</strong>${esc(e.clasificacion.charAt(0).toUpperCase() + e.clasificacion.slice(1))}</div>
            ${e.ejeTematico ? `<div><strong>Eje temático</strong>${esc(e.ejeTematico)}</div>` : ''}
            <div><strong>Lugar</strong>${esc(e.lugar)}</div>
            <div><strong>Comité organizador</strong>${esc(e.comite)}</div>
            <div class="${lleno ? 'capacity-full' : ''}"><strong>Capacidad</strong>${originalRegistros.length}/${e.capacidad}<div class="capacity-bar ${lleno ? 'full' : ''}"><div style="width:${pct}%"></div></div></div>
            ${e.enlace ? `<div><strong>Enlace</strong><a href="${esc(e.enlace)}" target="_blank" rel="noopener">Abrir <i class="fa-solid fa-arrow-up-right-from-square"></i></a></div>` : ''}
        </div>
        <div class="detail-map">
            <iframe loading="lazy" title="Ubicación del evento" src="https://www.google.com/maps?q=${mapsQ}&output=embed"></iframe>
        </div>
        ${state.role === 'admin' ? `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:24px; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
            <h4 style="color:var(--primary); margin:0"><i class="fa-solid fa-clipboard-list"></i> Asistentes registrados (${originalRegistros.length})</h4>
            <div style="display:flex; gap:8px;">
              <select id="sort-attendees" class="btn btn-secondary btn-sm" style="background:#fff; color:var(--primary); border:1px solid var(--primary); width:auto;">
                <option value="default">Orden por defecto</option>
                <option value="lastname_asc">Apellido (A → Z)</option>
                <option value="lastname_desc">Apellido (Z → A)</option>
              </select>
              <button id="export-csv-btn" class="btn btn-sm" style="background:#2d883b; color:#fff;"><i class="fa-solid fa-download"></i> Exportar CSV</button>
            </div>
          </div>
          <div id="attendees-table-container">${renderAttendeesTable(originalRegistros, currentSortOrder)}</div>
        ` : ''}
    `;

  if (state.role === 'admin') {
    const sortSelect = document.getElementById('sort-attendees');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        currentSortOrder = e.target.value;
        const container = document.getElementById('attendees-table-container');
        if (container) {
          container.innerHTML = renderAttendeesTable(originalRegistros, currentSortOrder);
        }
      });
    }

    const exportBtn = document.getElementById('export-csv-btn');
    if (exportBtn) {
      if (originalRegistros.length === 0) {
        exportBtn.disabled = true;
        exportBtn.title = "No hay asistentes registrados para exportar";
        exportBtn.style.opacity = '0.6';
        exportBtn.style.cursor = 'not-allowed';
      } else {
        exportBtn.disabled = false;
        exportBtn.removeAttribute('title');
        exportBtn.style.opacity = '';
        exportBtn.style.cursor = '';
        exportBtn.addEventListener('click', () => {
          downloadAttendeesCSV(originalRegistros, e.titulo);
          toast('Exportando asistentes...', '');
        });
      }
    }
  }

  $('#modal-footer').innerHTML = `
        ${e.registroHabilitado && state.role === 'user' ? `<button class="btn" ${lleno ? 'disabled style="opacity:.6;cursor:not-allowed"' : ''} onclick="openRegister('${e.id}','${tipoKey}')"><i class="fa-solid fa-user-plus"></i> ${lleno ? 'Cupo lleno' : 'Registrarse'}</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
    `;
  showModal();
}

// ---------- FORMULARIO EVENTO (ADMIN) ----------
function openEventForm(tipo, id = null, preloadData = null) {
  const prevFormEvent = document.getElementById('event-form');
  if (prevFormEvent) clearFieldErrors(prevFormEvent);
  if (state.role !== 'admin') { toast('Solo el administrador puede gestionar eventos', 'error'); return; }
  const isAcad = tipo === 'académico';

  const cargarDatos = async () => {
    let e = {};
    if (preloadData) {
      e = preloadData;
    } else if (id) {
      const eventos = await cargarEventos(tipo);
      e = eventos.find(x => x.id === id) || {};
    }
    const tiposAcad = ['Salida de campo', 'Muestra tecnológica', 'Feria estudiantil', 'Visitantes', 'Expo-poster', 'Otro'];
    const tiposInv = ['Conferencia', 'Foro', 'Charla', 'Coloquio', 'Seminario', 'Congreso', 'Panel', 'Otro'];
    const tipos = isAcad ? tiposAcad : tiposInv;

    const currentType = e.tipoEvento || '';
    const isCustom = currentType && !tipos.includes(currentType) && currentType !== 'Otro';
    const selectedOtro = (isCustom || currentType === 'Otro') ? 'selected' : '';

    $('#modal-title').textContent = (id ? 'Editar ' : 'Nuevo ') + 'Evento ' + (isAcad ? 'Académico' : 'de Investigación');
    $('#modal-body').innerHTML = `
      <form id="event-form" novalidate>
        <div class="form-grid">
          <div class="form-group full"><label>Título <span class="req">*</span></label><input name="titulo" required value="${esc(e.titulo || '')}"></div>
          <div class="form-group"><label>Fecha inicio <span class="req">*</span></label><input type="date" name="fechaInicio" required value="${esc(e.fechaInicio || '')}"></div>
          <div class="form-group"><label>Fecha fin</label><input type="date" name="fechaFin" value="${esc(e.fechaFin || '')}"></div>
          <div class="form-group"><label>Tipo de evento <span class="req">*</span></label>
            <select name="tipoEvento" id="tipoEventoSelect" required>
              ${tipos.map(t => `<option value="${t}" ${(currentType === t || (t === 'Otro' && selectedOtro)) ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <input type="text" name="tipoEventoOtro" id="tipoEventoOtro" placeholder="Especificar tipo de evento" style="display:none; margin-top:8px;" value="${esc(isCustom ? currentType : '')}">
          </div>
          <div class="form-group"><label>Clasificación <span class="req">*</span></label><select name="clasificacion" required><option value="interno" ${e.clasificacion === 'interno' ? 'selected' : ''}>Interno</option><option value="externo" ${e.clasificacion === 'externo' ? 'selected' : ''}>Externo</option></select></div>
          <div class="form-group"><label>Hora inicio <span class="req">*</span></label><input type="time" name="horaInicio" required value="${esc(formatTime(e.horaInicio || ''))}"></div>
          <div class="form-group"><label>Hora fin <span class="req">*</span></label><input type="time" name="horaFin" required value="${esc(formatTime(e.horaFin || ''))}"></div>
          <div class="form-group full"><label>Descripción <span class="req">*</span></label><textarea name="descripcion" required>${esc(e.descripcion || '')}</textarea></div>
          ${!isAcad ? `<div class="form-group full"><label>Eje temático <span class="req">*</span></label><input name="ejeTematico" required value="${esc(e.ejeTematico || '')}"></div>` : ''}
          <div class="form-group full"><label>Comité organizador <span class="req">*</span></label><input name="comite" required value="${esc(e.comite || '')}"></div>
          <div class="form-group"><label>Lugar <span class="req">*</span></label><input name="lugar" required value="${esc(e.lugar || '')}"></div>
          <div class="form-group"><label>Dirección (Google Maps) <span class="req">*</span></label><input name="direccion" required placeholder="Calle 10 #5-23, Tuluá" value="${esc(e.direccion || '')}"></div>
          <div class="form-group"><label>Capacidad <span class="req">*</span></label><input type="number" min="1" name="capacidad" required value="${esc(e.capacidad || '')}"></div>
          <div class="form-group">
            <label>Imagen / flyer (URL)</label>
            <div style="display:flex; gap:8px;">
              <input type="url" name="imagen" placeholder="https://..." value="${esc(e.imagen || '')}" style="flex:1;">
              <button type="button" class="btn btn-sm btn-secondary" onclick="uploadEventImage(this)" title="Subir imagen desde archivo">
                <i class="fa-solid fa-upload"></i> Subir
              </button>
            </div>
          </div>
          <div class="form-group full"><label>Enlace del evento ${isAcad ? '(transmisión / grabación)' : '(redes sociales)'}</label><input type="url" name="enlace" placeholder="https://..." value="${esc(e.enlace || '')}"></div>
          <div class="form-group full"><label class="checkbox-row"><input type="checkbox" name="registroHabilitado" ${e.registroHabilitado ? 'checked' : ''}> Habilitar registro de asistentes</label></div>
        </div>
      </form>
    `;

    const tipoSelect = document.getElementById('tipoEventoSelect');
    const otroInput = document.getElementById('tipoEventoOtro');
    const toggleOtro = () => {
      if (tipoSelect.value === 'Otro') {
        otroInput.style.display = 'block';
        otroInput.required = true;
      } else {
        otroInput.style.display = 'none';
        otroInput.required = false;
        otroInput.value = '';
      }
    };
    tipoSelect.addEventListener('change', toggleOtro);
    toggleOtro();

    $('#modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn" onclick="validateAndSaveEvent('${tipo}','${id || ''}')"><i class="fa-solid fa-save"></i> Guardar</button>
    `;
    showModal();
  };
  cargarDatos();
}

async function deleteEvent(id, tipoKey) {
  if (state.role !== 'admin') {
    toast('Solo el administrador puede eliminar eventos', 'error');
    return;
  }
  if (!confirm('¿Eliminar este evento? Esta acción no se puede deshacer.')) return;
  try {
    await eliminarEvento(id);
    toast('Evento eliminado');
    render();
  } catch (err) {
    toast('Error al eliminar: ' + err.message, 'error');
  }
}

async function duplicateEvent(id, tipoKey) {
  if (state.role !== 'admin') { toast('Solo el administrador puede duplicar eventos', 'error'); return; }
  const eventos = tipoKey === 'acad' ? await cargarEventos('académico') : await cargarEventos('investigación');
  const original = eventos.find(x => x.id === id);
  if (!original) {
    toast('Evento no encontrado', 'error');
    return;
  }
  const clone = { ...original };
  delete clone.id;
  clone.fechaInicio = '';
  clone.fechaFin = '';
  const tipoOriginal = original.tipo === 'académico' ? 'académico' : 'investigación';
  openEventForm(tipoOriginal, null, clone);
}

// ---------- REGISTRO DE ASISTENTES ----------
async function openRegister(id, tipoKey) {
  const prevForm = document.getElementById('reg-form');
  if (prevForm) clearFieldErrors(prevForm);
  const eventos = tipoKey === 'acad' ? await cargarEventos('académico') : await cargarEventos('investigación');
  const e = eventos.find(x => x.id === id);
  if (!e) return;
  const regs = await cargarRegistros(id);
  if (regs.length >= e.capacidad) { toast('Lo sentimos, este evento ha alcanzado su capacidad máxima.', 'error'); return; }
  $('#modal-title').textContent = 'Registro de asistente · ' + e.titulo;
  $('#modal-body').innerHTML = `
    <p style="margin-bottom:14px;color:var(--text-soft)">Completa tus datos para registrarte. Cupos disponibles: <strong>${e.capacidad - regs.length}</strong> de ${e.capacidad}.</p>
    <form id="reg-form" novalidate>
      <div class="form-grid">
        <div class="form-group"><label>Nombres <span class="req">*</span></label><input name="nombres" required></div>
        <div class="form-group"><label>Apellidos <span class="req">*</span></label><input name="apellidos" required></div>
        <div class="form-group"><label>Correo electrónico <span class="req">*</span></label><input type="email" name="email" required></div>
        <div class="form-group"><label>Tipo de identificación <span class="req">*</span></label><select name="tipoId" required><option value="CC">CC - Cédula de Ciudadanía</option><option value="TI">TI - Tarjeta de Identidad</option><option value="CE">CE - Cédula de Extranjería</option><option value="PA">PA - Pasaporte</option><option value="RC">RC - Registro Civil</option></select></div>
        <div class="form-group"><label>Identificación <span class="req">*</span></label><input name="identificacion" required></div>
        <div class="form-group">
          <label>Cargo <span class="req">*</span></label>
          <select name="cargo" id="cargoSelect" required>
            <option value="">Seleccionar...</option>
            <option value="Estudiante">Estudiante</option>
            <option value="Docente">Docente</option>
            <option value="Investigador">Investigador</option>
            <option value="Administrativo">Administrativo</option>
            <option value="Directivo">Directivo</option>
            <option value="Coordinador">Coordinador</option>
            <option value="Decano">Decano</option>
            <option value="Rector">Rector</option>
            <option value="Vicerrector">Vicerrector</option>
            <option value="Otro">Otro</option>
          </select>
          <input type="text" name="cargoOtro" id="cargoOtro" placeholder="Especificar cargo" style="display:none; margin-top:8px;">
        </div>
        <div class="form-group full"><label>Institución <span class="req">*</span></label><input name="institucion" required></div>
      </div>
    </form>
  `;
  $('#modal-footer').innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn" onclick="validateAndSubmitRegister('${id}','${tipoKey}')"><i class="fa-solid fa-check"></i> Confirmar registro</button>
  `;

  const cargoSelect = document.getElementById('cargoSelect');
  const cargoOtro = document.getElementById('cargoOtro');
  function toggleCargoOtro() {
    if (cargoSelect.value === 'Otro') {
      cargoOtro.style.display = 'block';
      cargoOtro.required = true;
    } else {
      cargoOtro.style.display = 'none';
      cargoOtro.required = false;
      cargoOtro.value = '';
    }
  }
  cargoSelect.addEventListener('change', toggleCargoOtro);
  toggleCargoOtro();

  showModal();
}

async function validateAndSubmitRegister(eventoId, tipoKey) {
  const form = document.getElementById('reg-form');
  clearFieldErrors(form);

  const nombres = form.nombres.value.trim();
  const apellidos = form.apellidos.value.trim();
  const email = form.email.value.trim();
  const tipoId = form.tipoId.value;
  const identificacion = form.identificacion.value.trim();

  const cargoSelect = document.getElementById('cargoSelect');
  const cargoOtro = document.getElementById('cargoOtro');
  let cargo = cargoSelect.value === 'Otro' ? cargoOtro.value.trim() : cargoSelect.value;

  const institucion = form.institucion.value.trim();

  let isValid = true;

  if (!nombres) { showFieldError(form.nombres, 'Los nombres son obligatorios.'); isValid = false; }
  if (!apellidos) { showFieldError(form.apellidos, 'Los apellidos son obligatorios.'); isValid = false; }
  if (!email) {
    showFieldError(form.email, 'El correo electrónico es obligatorio.');
    isValid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFieldError(form.email, 'Ingresa un correo electrónico válido (ej: nombre@dominio.com).');
    isValid = false;
  }
  if (!identificacion) { showFieldError(form.identificacion, 'La identificación es obligatoria.'); isValid = false; }

  if (!cargo) {
    if (cargoSelect.value === 'Otro') {
      showFieldError(cargoOtro, 'Especifica tu cargo.');
    } else {
      showFieldError(cargoSelect, 'Selecciona tu cargo.');
    }
    isValid = false;
  }

  if (!institucion) { showFieldError(form.institucion, 'La institución es obligatoria.'); isValid = false; }

  if (!isValid) return;

  const eventos = tipoKey === 'acad' ? await cargarEventos('académico') : await cargarEventos('investigación');
  const evento = eventos.find(x => x.id === eventoId);
  if (!evento) { toast('Evento no encontrado', 'error'); closeModal(); return; }

  const registros = await cargarRegistros(eventoId);

  if (registros.some(r => r.email === email)) {
    showFieldError(form.email, 'Este correo electrónico ya está registrado para este evento.');
    return;
  }

  if (registros.length >= evento.capacidad) {
    showFieldError(form.querySelector('[name="identificacion"]'), 'El evento ha alcanzado su capacidad máxima.');
    return;
  }
  if (registros.some(r => r.identificacion === identificacion)) {
    showFieldError(form.identificacion, 'Ya existe un registro con esta identificación para este evento.');
    return;
  }

  const data = { eventoId, nombres, apellidos, email, tipoId, identificacion, cargo, institucion };
  try {
    await crearRegistro(data);
    closeModal();
    toast('¡Registro confirmado! Te esperamos en el evento.');
    render();
  } catch (err) {
    toast('Error al registrar: ' + err.message, 'error');
  }
}

async function validateAndSaveEvent(tipo, id) {
  const form = document.getElementById('event-form');
  clearFieldErrors(form);

  const titulo = form.titulo.value.trim();
  const fechaInicio = form.fechaInicio.value;
  const fechaFin = form.fechaFin.value;
  let tipoEvento = form.tipoEvento.value;
  const clasificacion = form.clasificacion.value;
  const horaInicio = form.horaInicio.value;
  const horaFin = form.horaFin.value;
  const descripcion = form.descripcion.value.trim();
  const comite = form.comite.value.trim();
  const lugar = form.lugar.value.trim();
  const direccion = form.direccion.value.trim();
  const capacidad = parseInt(form.capacidad.value, 10);

  let isValid = true;

  let tipoEventoFinal = tipoEvento;
  if (tipoEvento === 'Otro') {
    const otroInput = document.getElementById('tipoEventoOtro');
    const otroValor = otroInput.value.trim();
    if (!otroValor) {
      showFieldError(otroInput, 'Debes especificar el tipo de evento.');
      isValid = false;
    } else {
      tipoEventoFinal = otroValor;
    }
  }

  if (!titulo) { showFieldError(form.titulo, 'El título es obligatorio.'); isValid = false; }
  if (!fechaInicio) { showFieldError(form.fechaInicio, 'La fecha de inicio es obligatoria.'); isValid = false; }
  if (!tipoEventoFinal) { showFieldError(form.tipoEvento, 'Selecciona un tipo de evento.'); isValid = false; }
  if (!clasificacion) { showFieldError(form.clasificacion, 'Selecciona una clasificación.'); isValid = false; }
  if (!horaInicio) { showFieldError(form.horaInicio, 'La hora de inicio es obligatoria.'); isValid = false; }
  if (!horaFin) { showFieldError(form.horaFin, 'La hora de fin es obligatoria.'); isValid = false; }
  if (!descripcion) { showFieldError(form.descripcion, 'La descripción es obligatoria.'); isValid = false; }
  if (tipo === 'investigación' && !form.ejeTematico?.value.trim()) {
    showFieldError(form.ejeTematico, 'El eje temático es obligatorio para eventos de investigación.');
    isValid = false;
  }
  if (!comite) { showFieldError(form.comite, 'El comité organizador es obligatorio.'); isValid = false; }
  if (!lugar) { showFieldError(form.lugar, 'El lugar es obligatorio.'); isValid = false; }
  if (!direccion) { showFieldError(form.direccion, 'La dirección es obligatoria para el mapa.'); isValid = false; }
  if (isNaN(capacidad) || capacidad < 1) { showFieldError(form.capacidad, 'La capacidad debe ser un número mayor a 0.'); isValid = false; }

  if (fechaInicio && fechaFin) {
    const startDate = new Date(fechaInicio + 'T00:00:00');
    const endDate = new Date(fechaFin + 'T00:00:00');
    if (endDate < startDate) {
      showFieldError(form.fechaFin, 'La fecha de fin no puede ser anterior a la fecha de inicio.');
      isValid = false;
    } else if (fechaInicio === fechaFin) {
      if (horaInicio && horaFin && horaFin <= horaInicio) {
        showFieldError(form.horaFin, 'Si el evento es el mismo día, la hora de fin debe ser posterior a la hora de inicio.');
        isValid = false;
      }
    }
  }

  if (!isValid) return;

  const data = Object.fromEntries(new FormData(form).entries());
  data.tipoEvento = tipoEventoFinal;
  delete data.tipoEventoOtro;
  data.registroHabilitado = form.registroHabilitado.checked;
  data.capacidad = capacidad;
  data.tipo = tipo === 'académico' ? 'academico' : 'investigacion'; // Normalizar para la BD
  if (!data.fechaFin) data.fechaFin = data.fechaInicio;

  try {
    await guardarEvento(data.tipo, data, id || null);
    closeModal();
    toast(id ? 'Evento actualizado' : 'Evento creado correctamente');
    render();
  } catch (err) {
    toast('Error al guardar: ' + err.message, 'error');
  }
}

function uploadEventImage(btn) {
  if (window._igsclacMediaFrame) {
    try { window._igsclacMediaFrame.detach(); } catch (e) { }
    window._igsclacMediaFrame = null;
  }

  const frame = wp.media({
    title: (typeof igsclacData !== 'undefined' && igsclacData.mediaTitle) || 'Seleccionar imagen',
    button: {
      text: (typeof igsclacData !== 'undefined' && igsclacData.mediaButton) || 'Usar esta imagen'
    },
    multiple: false
  });

  window._igsclacMediaFrame = frame;

  // Determinar si hay un usuario logueado en WordPress.
  // wp.api.models.User o el nonce de usuario logueado son indicadores fiables,
  // pero la forma más directa es un flag que PHP nos pasa.
  const userLoggedIn = (typeof igsclacMediaNonce !== 'undefined' && igsclacMediaNonce.userLoggedIn);

  if (typeof igsclacMediaNonce !== 'undefined') {

    // Inyectar nonce en Plupload para subida — solo necesario si no hay sesión
    if (!userLoggedIn) {
      frame.on('ready', function () {
        const uploader = frame.uploader;
        if (uploader && uploader.uploader && uploader.uploader.uploader) {
          const plupload = uploader.uploader.uploader;
          plupload.bind('BeforeUpload', function (up) {
            up.settings.multipart_params = up.settings.multipart_params || {};
            up.settings.multipart_params._wpnonce = igsclacMediaNonce.mediaForm;
            up.settings.url = igsclacMediaNonce.ajaxurl + '?action=upload-attachment';
          });
        }
      });
    }

    frame.on('open', function () {
      // Inyectar nonce en _wpPluploadSettings solo si no hay sesión
      if (!userLoggedIn && window._wpPluploadSettings) {
        window._wpPluploadSettings.defaults =
          window._wpPluploadSettings.defaults || {};
        window._wpPluploadSettings.defaults.multipart_params =
          window._wpPluploadSettings.defaults.multipart_params || {};
        window._wpPluploadSettings.defaults.multipart_params._wpnonce =
          igsclacMediaNonce.mediaForm;
      }

      // Instalar el listener de delete SOLO si no hay sesión activa de WP.
      // Con sesión, WP maneja el delete nativamente y no debemos interferir.
      if (!userLoggedIn) {
        setTimeout(() => {
          const modalEl = document.querySelector('.media-modal');
          if (!modalEl) return;

          if (modalEl._igsclacDeleteHandler) {
            modalEl.removeEventListener('click', modalEl._igsclacDeleteHandler, true);
            modalEl._igsclacDeleteHandler = null;
          }

          modalEl._igsclacDeleteHandler = function (e) {
            const deleteBtn = e.target.closest(
              '.attachment-delete, .delete-attachment, [data-wp-delete-post], button.button-link-delete'
            );
            if (!deleteBtn) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            let attachmentId =
              deleteBtn.dataset.id ||
              deleteBtn.closest('[data-id]')?.dataset.id ||
              deleteBtn.closest('.attachment')?.dataset.id ||
              (() => {
                try {
                  return frame.state().get('selection')?.first()?.get('id');
                } catch (err) { return null; }
              })();

            if (!attachmentId) return;

            if (!confirm('¿Eliminar esta imagen permanentemente? Esta acción no se puede deshacer.')) return;

            fetch(igsclacMediaNonce.ajaxurl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                action: 'igsclac-delete-attachment',
                id: attachmentId,
                nonce: igsclacMediaNonce.deleteNonce
              })
            })
              .then(r => r.json())
              .then(data => {
                if (data.success) {
                  const library = frame.state().get('library');
                  if (library) {
                    const model = library.get(parseInt(attachmentId));
                    if (model) library.remove(model);
                  }
                  toast('Imagen eliminada correctamente');
                } else {
                  toast('Error al eliminar: ' + (data.data?.message || 'desconocido'), 'error');
                }
              })
              .catch(() => toast('Error de red al eliminar', 'error'));
          };

          modalEl.addEventListener('click', modalEl._igsclacDeleteHandler, true);
        }, 100);
      }
    });
  }

  frame.on('select', function () {
    const attachment = frame.state().get('selection').first().toJSON();
    const input = btn.parentNode.querySelector('input[name="imagen"]');
    if (input) {
      input.value = attachment.url;
    }
  });

  frame.open();
}

// ---------- PANEL ADMIN ----------
let cachedAcademicEvents = [];
let cachedResearchEvents = [];
let currentAcademicSort = 'date_desc';
let currentResearchSort = 'date_desc';

function sortEvents(events, sortBy) {
  const sorted = [...events];
  if (sortBy === 'date_asc') {
    sorted.sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
  } else if (sortBy === 'date_desc') {
    sorted.sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));
  } else if (sortBy === 'type_asc') {
    sorted.sort((a, b) => a.tipoEvento.localeCompare(b.tipoEvento));
  } else if (sortBy === 'type_desc') {
    sorted.sort((a, b) => b.tipoEvento.localeCompare(a.tipoEvento));
  }
  return sorted;
}

async function renderAdmin(c) {
  if (state.role !== 'admin') { navigate('home'); return; }
  setBreadcrumbs([{ view: 'home', label: 'Inicio' }, { view: 'admin', label: 'Panel de administración' }]);

  const acad = await cargarEventos('académico');
  const inv = await cargarEventos('investigación');

  cachedAcademicEvents = acad;
  cachedResearchEvents = inv;

  let sortedAcad = sortEvents(acad, currentAcademicSort);
  let sortedInv = sortEvents(inv, currentResearchSort);

  let totalRegs = 0;
  for (const e of [...acad, ...inv]) {
    const regs = await cargarRegistros(e.id);
    totalRegs += regs.length;
  }

  const acadTableHtml = await adminTable(sortedAcad, 'acad');
  const invTableHtml = await adminTable(sortedInv, 'inv');

  c.innerHTML = `
        <div class="section-title"><h2><i class="fa-solid fa-gauge"></i> Panel de Administración</h2></div>
        <div class="admin-stats-scroll">
            <div class="events-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-bottom:30px">
                <div class="widget" style="text-align:center"><h3 style="color:var(--primary);font-size:32px;border:none;padding:0">${acad.length}</h3><p>Eventos académicos</p></div>
                <div class="widget" style="text-align:center"><h3 style="color:var(--primary);font-size:32px;border:none;padding:0">${inv.length}</h3><p>Eventos de investigación</p></div>
                <div class="widget" style="text-align:center"><h3 style="color:var(--primary);font-size:32px;border:none;padding:0">${totalRegs}</h3><p>Asistentes registrados</p></div>
            </div>
        </div>
        
        <div class="section-title">
            <h2><i class="fa-solid fa-book"></i> Eventos académicos</h2>
            <div style="display:flex; gap:10px;">
                <select id="sort-academic" class="btn btn-secondary btn-sm" style="background:#fff; color:var(--primary); border:1px solid var(--primary);">
                    <option value="date_desc" ${currentAcademicSort === 'date_desc' ? 'selected' : ''}>Fecha ↓ (reciente → antiguo)</option>
                    <option value="date_asc" ${currentAcademicSort === 'date_asc' ? 'selected' : ''}>Fecha ↑ (antiguo → reciente)</option>
                    <option value="type_asc" ${currentAcademicSort === 'type_asc' ? 'selected' : ''}>Tipo (A → Z)</option>
                    <option value="type_desc" ${currentAcademicSort === 'type_desc' ? 'selected' : ''}>Tipo (Z → A)</option>
                </select>
                <button class="btn" onclick="openEventForm('académico')"><i class="fa-solid fa-plus"></i> Nuevo</button>
            </div>
        </div>
        <div id="academic-table-container">${acadTableHtml}</div>
        
        <div class="section-title" style="margin-top:40px">
            <h2><i class="fa-solid fa-flask"></i> Eventos de investigación</h2>
            <div style="display:flex; gap:10px;">
                <select id="sort-research" class="btn btn-secondary btn-sm" style="background:#fff; color:var(--primary); border:1px solid var(--primary);">
                    <option value="date_desc" ${currentResearchSort === 'date_desc' ? 'selected' : ''}>Fecha ↓ (reciente → antiguo)</option>
                    <option value="date_asc" ${currentResearchSort === 'date_asc' ? 'selected' : ''}>Fecha ↑ (antiguo → reciente)</option>
                    <option value="type_asc" ${currentResearchSort === 'type_asc' ? 'selected' : ''}>Tipo (A → Z)</option>
                    <option value="type_desc" ${currentResearchSort === 'type_desc' ? 'selected' : ''}>Tipo (Z → A)</option>
                </select>
                <button class="btn" onclick="openEventForm('investigación')"><i class="fa-solid fa-plus"></i> Nuevo</button>
            </div>
        </div>
        <div id="research-table-container">${invTableHtml}</div>
    `;

  const sortAcademicSelect = document.getElementById('sort-academic');
  const sortResearchSelect = document.getElementById('sort-research');

  const updateAcademicTable = async () => {
    currentAcademicSort = sortAcademicSelect.value;
    const sorted = sortEvents(cachedAcademicEvents, currentAcademicSort);
    const newHtml = await adminTable(sorted, 'acad');
    document.getElementById('academic-table-container').innerHTML = newHtml;
  };

  const updateResearchTable = async () => {
    currentResearchSort = sortResearchSelect.value;
    const sorted = sortEvents(cachedResearchEvents, currentResearchSort);
    const newHtml = await adminTable(sorted, 'inv');
    document.getElementById('research-table-container').innerHTML = newHtml;
  };

  sortAcademicSelect.addEventListener('change', updateAcademicTable);
  sortResearchSelect.addEventListener('change', updateResearchTable);
}

async function adminTable(list, tipoKey) {
  if (!list.length) return emptyHtml('Aún no hay eventos en esta categoría.');
  let rows = '';
  for (const e of list) {
    const regs = await cargarRegistros(e.id);
    const rCount = regs.length;
    rows += `
      <tr>
        <td>${esc(e.titulo)}</td>
        <td>${fmtDate(e.fechaInicio)}</td>
        <td>${esc(e.tipoEvento)}</td>
        <td>${e.capacidad}</td>
        <td><strong>${rCount}</strong></td>
        <td>${e.registroHabilitado ? '<span style="color:var(--secondary);font-weight:700">Sí</span>' : 'No'}</td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-sm btn-secondary" onclick="openEventDetail('${e.id}','${tipoKey}')"><i class="fa-solid fa-eye"></i></button>
            <button class="btn btn-sm" onclick="openEventForm('${e.tipo}','${e.id}')"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm" style="background:#6c757d; color:#fff;" onclick="duplicateEvent('${e.id}','${tipoKey}')"><i class="fa-regular fa-copy"></i></button>
            <button class="btn btn-sm btn-danger" onclick="deleteEvent('${e.id}','${tipoKey}')"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }
  return `<div class="table-wrap"><table>
    <thead><tr><th>Título</th><th>Fecha</th><th>Tipo</th><th>Capacidad</th><th>Registros</th><th>Reg. habilitado</th><th>Acciones</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ---------- CONTACTO  ----------
function renderContact(c) {
  setBreadcrumbs([{ view: 'home', label: 'Inicio' }, { view: 'contacto', label: 'Contacto' }]);
  c.innerHTML = `
    <div class="section-title"><h2><i class="fa-solid fa-envelope"></i> Contáctanos</h2></div>
    <div class="widget">
      <p>¿Tienes preguntas sobre algún evento? Escríbenos:</p>
      <ul style="list-style:none;margin-top:14px">
        <li style="padding:6px 0"><i class="fa-solid fa-envelope" style="color:var(--primary);width:24px"></i> eventos@igsclac.com</li>
        <li style="padding:6px 0"><i class="fa-solid fa-phone" style="color:var(--primary);width:24px"></i> +57 (2) 224 5555</li>
        <li style="padding:6px 0"><i class="fa-solid fa-location-dot" style="color:var(--primary);width:24px"></i> Unidad Central del Valle del Cauca, Tuluá, Valle del Cauca</li>
      </ul>
    </div>
  `;
}

// ---------- WIDGET PRÓXIMOS  ----------
async function renderUpcoming() {
  const acad = await cargarEventos('académico');
  const inv = await cargarEventos('investigación');
  const all = [...acad, ...inv];
  const upcoming = all.filter(e => new Date(e.fechaInicio) >= new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio))
    .slice(0, 5);
  $('#widget-upcoming').innerHTML = upcoming.length ? upcoming.map(e => `
    <li><a href="#" onclick="openEventDetail('${e.id}','${e.tipo === 'académico' ? 'acad' : 'inv'}');return false;">
      <small>${fmtDate(e.fechaInicio)}</small>${esc(e.titulo)}
    </a></li>`).join('') : '<li style="color:var(--text-soft)">Sin eventos próximos.</li>';
}

// ---------- MODAL ----------
function showModal() { $('#modal-overlay').classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeModal() { $('#modal-overlay').classList.remove('show'); document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- FAB scroll ----------
window.addEventListener('scroll', () => { $('#fab-top').classList.toggle('show', window.scrollY > 400); });

// ---------- INIT ----------
buildHero();
applyRole();
render();
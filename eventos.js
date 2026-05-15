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

const userLoggedIn = (typeof igsclacMediaNonce !== 'undefined' && igsclacMediaNonce.userLoggedIn);

let state = {
  role: userLoggedIn ? (localStorage.getItem('igsclac_role') || 'admin') : 'user',
  view: 'home',
  search: '',
  pageHome: 1,
  pageAcad: 1,
  pageInv: 1,
  pageAdminAcad: 1,
  pageAdminInv: 1,
  filterHome: 'active',  // 'active' | 'past'
  filterAcad: 'active',  // 'active' | 'past' | 'drafts'
  filterInv: 'active',   // 'active' | 'past' | 'drafts'
  filterAdminAcad: 'all', // 'all' | 'active' | 'past' | 'drafts'
  filterAdminInv: 'all',  // 'all' | 'active' | 'past' | 'drafts'
  sortHome: 'date_asc',
  sortAcad: 'date_asc',   // 'date_asc' = más cercanos
  sortInv: 'date_asc',    // 'date_desc' = más lejanos
};

const savedView = localStorage.getItem('igsclac_view');
if (savedView && ['home', 'academicos', 'investigacion', 'admin'].includes(savedView)) {
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

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fmtDatePDF(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${parseInt(day, 10)} de ${MESES[parseInt(m, 10) - 1]} de ${y}`;
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

// ---------- CLASIFICACIÓN DE EVENTOS ----------
function isEventPast(evento) {
  if (!evento.fechaFin) return false;

  let horaFin = evento.horaFin || '00:00';
  const parts = horaFin.split(':');
  const hour = parts[0] || '00';
  const minute = parts[1] || '00';

  const endDateTime = new Date(`${evento.fechaFin}T${hour}:${minute}:00`);

  if (isNaN(endDateTime.getTime())) {
    console.warn('Fecha de fin inválida:', evento.fechaFin, evento.horaFin);
    return true;
  }
  return endDateTime < new Date();
}

function isEventDraft(evento) {
  // Borrador: deshabilitado y NO es pasado
  return evento.habilitado === false && !isEventPast(evento);
}

function filterEventsByStatus(events, status) {
  if (status === 'active') {
    return events.filter(e => e.habilitado !== false && !isEventPast(e));
  } else if (status === 'past') {
    return events.filter(e => isEventPast(e));
  } else if (status === 'drafts') {
    return events.filter(e => isEventDraft(e));
  }
  return events;
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
    let errorMessage = `Error ${res.status}`;
    try {
      const errorData = await res.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.data?.message) {
        errorMessage = errorData.data.message;
      }
    } catch (e) {
      const errorText = await res.text();
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }

  return res.json();
}

// Llamadas API
async function cargarEventos(tipo, includeDisabled = false) {
  const endpoint = tipo === 'académico' ? '/eventos/academicos' : '/eventos/investigacion';
  const items = await fetchAPI(endpoint);
  if (includeDisabled) return items;
  return (items || []).filter(e => e.habilitado !== false);
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
let slides = [];
let workingSlides = [];
let originalSlides = [];
let editorModalInstance = null;
let cachedAllEvents = [];

async function cargarHeroSlides() {
  try {
    const response = await fetch(API_BASE + '/hero-slides', {
      credentials: 'same-origin'
    });
    if (!response.ok) throw new Error('Error cargando slides');
    let datos = await response.json();
    slides = (datos || []).map(slide => ({
      ...slide,
      overlayActivo: slide.overlayActivo !== undefined ? slide.overlayActivo : true
    }));
    if (slides.length === 0) {
      slides = [
        { titulo: 'Sin slides configurados', descripcion: 'Por favor, configure los slides desde el panel admin.', imagen: '', textoBoton: '', tipoAccion: 'navegacion', accion: 'home', overlayActivo: true }
      ];
    }
    buildHero();
  } catch (err) {
    console.error('Error al cargar hero slides:', err);
    slides = [];
  }
}

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
    <nav id="pagination-${context}" class="pagination" aria-label="Paginación">
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
  if (context === 'admin-acad') state.pageAdminAcad = page;
  if (context === 'admin-inv') state.pageAdminInv = page;

  // Para admin, actualizar solo la tabla correspondiente sin hacer render() completo
  if (context === 'admin-acad' || context === 'admin-inv') {
    const filtered = context === 'admin-acad'
      ? (state.filterAdminAcad === 'all' ? cachedAcademicEvents : filterEventsByStatus(cachedAcademicEvents, state.filterAdminAcad))
      : (state.filterAdminInv === 'all' ? cachedResearchEvents : filterEventsByStatus(cachedResearchEvents, state.filterAdminInv));

    const sortOrder = context === 'admin-acad' ? currentAcademicSort : currentResearchSort;
    const sorted = sortEvents(filtered, sortOrder);
    const tipoKey = context === 'admin-acad' ? 'acad' : 'inv';

    const totalPages = Math.ceil(sorted.length / PER_PAGE);
    const start = (page - 1) * PER_PAGE;
    const paginated = sorted.slice(start, start + PER_PAGE);

    const newHtml = await adminTable(paginated, tipoKey);
    const paginationHtmlString = paginationHtml(page, totalPages, context);

    const containerId = context === 'admin-acad' ? 'academic-table-container' : 'research-table-container';
    const container = document.getElementById(containerId);
    const paginationEl = document.getElementById('pagination-' + context);

    if (container) {
      container.innerHTML = newHtml;
      if (paginationEl) {
        paginationEl.outerHTML = paginationHtmlString;
      } else {
        container.insertAdjacentHTML('afterend', paginationHtmlString);
      }
      // Desplazar al centro de la tabla
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else {
    await render();
    document.getElementById('content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

let slideIdx = 0;
let heroInterval;

function generarAccionSlide(slide) {
  if (slide.tipoAccion === 'evento_pasado' && slide.accion) {
    return { tipoAccion: 'evento_pasado', accion: slide.accion };
  }
  if (slide.tipoAccion === 'evento' && slide.accion) {
    return { tipoAccion: 'evento', accion: slide.accion };
  }
  // Por defecto, navegación
  return { tipoAccion: 'navegacion', accion: slide.accion };
}

async function showEventDetail(id) {
  // Buscar el evento en académicos e investigación
  const acad = await cargarEventos('académico', true);
  const inv = await cargarEventos('investigación', true);

  let evento = acad.find(e => e.id === id);
  let tipoKey = 'acad';

  if (!evento) {
    evento = inv.find(e => e.id === id);
    tipoKey = 'inv';
  }

  if (!evento) {
    toast('Evento no encontrado', 'error');
    return;
  }

  openEventDetail(id, tipoKey);
}

async function showPastEventDetail(id) {
  // Buscar el evento en académicos e investigación (pasado)
  const acad = await cargarEventos('académico', true);
  const inv = await cargarEventos('investigación', true);

  let evento = acad.find(e => e.id === id);
  let tipoKey = 'acad';

  if (!evento) {
    evento = inv.find(e => e.id === id);
    tipoKey = 'inv';
  }

  if (!evento) {
    toast('Evento no encontrado', 'error');
    return;
  }

  // Mostrar el evento aunque sea pasado
  openEventDetail(id, tipoKey);
}

function buildHero() {
  const hero = $('#hero');
  hero.querySelectorAll('.slide').forEach(n => n.remove());
  slides.forEach((sl, i) => {
    const div = document.createElement('div');
    let slideClass = 'slide' + (i === 0 ? ' active' : '');
    if (sl.overlayActivo === false) slideClass += ' no-overlay';
    div.className = slideClass;
    div.style.backgroundImage = `url('${sl.imagen || ''}')`;
    const accion = generarAccionSlide(sl);
    const botonHtml = sl.textoBoton ? `<a href="#" class="slide-cta" data-accion-tipo="${accion.tipoAccion}" data-accion-valor="${esc(accion.accion)}">${esc(sl.textoBoton)} <i class="fa-solid fa-arrow-right"></i></a>` : '';
    div.innerHTML = `<div class="slide-content"><h1>${esc(sl.titulo)}</h1><p>${esc(sl.descripcion)}</p>${botonHtml}</div>`;
    hero.insertBefore(div, $('#hero-dots'));
  });
  const dots = $('#hero-dots'); dots.innerHTML = '';
  slides.forEach((_, i) => { const s = document.createElement('span'); s.className = i === 0 ? 'active' : ''; s.onclick = () => goSlide(i); dots.appendChild(s); });

  // Swipe para móviles
  const heroEl = $('#hero');
  if (heroEl && !heroEl.hasAttribute('data-swipe-bound')) {
    heroEl.setAttribute('data-swipe-bound', 'true');
    let touchStartX = 0;
    let touchEndX = 0;

    heroEl.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    heroEl.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      const diff = touchStartX - touchEndX;
      const threshold = 40;

      if (Math.abs(diff) > threshold) {
        if (diff > 0) {
          goSlide((slideIdx + 1) % slides.length);
        } else {
          goSlide((slideIdx - 1 + slides.length) % slides.length);
        }
      }
    }, { passive: true });
  }
}

function goSlide(i) {
  slideIdx = i;
  document.querySelectorAll('.slide').forEach((n, k) => n.classList.toggle('active', k === i));
  document.querySelectorAll('#hero-dots span').forEach((n, k) => n.classList.toggle('active', k === i));
  resetHeroInterval();
}

function updateHeroEditButton() {
  const hero = $('#hero');
  if (!hero) return;
  let existingBtn = document.getElementById('hero-edit-btn');

  if (state.role === 'admin') {
    if (!existingBtn) {
      const btnEdit = document.createElement('button');
      btnEdit.id = 'hero-edit-btn';
      btnEdit.className = 'btn';
      btnEdit.innerHTML = '<i class="fa-solid fa-edit"></i>';
      btnEdit.title = 'Editar hero slider';
      btnEdit.onclick = () => abrirEditorHeroSlides();
      btnEdit.style.cssText = 'position:absolute;top:20px;right:20px;z-index:100;background:rgba(255,255,255,0.9);color:var(--primary);border:none;cursor:pointer;padding:10px 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;width:44px;height:44px;';
      hero.style.position = 'relative';
      hero.appendChild(btnEdit);
    }
  } else {
    if (existingBtn) existingBtn.remove();
  }
}

resetHeroInterval();

function resetHeroInterval() {
  if (heroInterval) clearInterval(heroInterval);
  heroInterval = setInterval(() => goSlide((slideIdx + 1) % slides.length), 5500);
}

// ---------- ROLES ----------
function toggleRole() {
  const isLoggedIn = (typeof igsclacMediaNonce !== 'undefined' && igsclacMediaNonce.userLoggedIn);
  if (!isLoggedIn) {
    toast('Debes iniciar sesión para acceder al modo administrador', 'error');
    return;
  }

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
  const isLoggedIn = (typeof igsclacMediaNonce !== 'undefined' && igsclacMediaNonce.userLoggedIn);
  const container = $('#role-switch-container');

  if (isLoggedIn) {
    // Crear el role-switch solo si no existe ya
    if (container && !container.querySelector('.role-switch')) {
      const roleSwitch = document.createElement('div');
      roleSwitch.className = 'role-switch';
      roleSwitch.setAttribute('aria-live', 'polite');
      roleSwitch.innerHTML = `
        <i class="fa-solid fa-user-shield"></i>
        Modo: <span class="role-badge" id="role-label">Usuario General</span>
        <button onclick="toggleRole()" id="role-btn">Cambiar a Admin</button>
      `;
      container.appendChild(roleSwitch);
    }
    // Actualizar etiquetas según el rol actual
    $('#role-label').textContent = state.role === 'admin' ? 'Administrador' : 'Usuario General';
    $('#role-btn').textContent = state.role === 'admin' ? 'Cambiar a Usuario' : 'Cambiar a Admin';
  } else {
    // Usuario no autenticado: limpiar el contenedor y forzar rol 'user'
    if (container) container.innerHTML = '';
    state.role = 'user';
    localStorage.setItem('igsclac_role', 'user');
  }

  // Mostrar u ocultar enlace "Panel Admin" en el menú
  $('#nav-admin').style.display = state.role === 'admin' ? 'block' : 'none';
  updateHeroEditButton();
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
    default: await renderHome(c);
  }
  await renderUpcoming();
}

function toggleHomeSort() {
  const newSort = state.sortHome === 'date_asc' ? 'date_desc' : 'date_asc';
  setHomeSort(newSort);
}

function toggleAcademicSort() {
  const newSort = state.sortAcad === 'date_asc' ? 'date_desc' : 'date_asc';
  setEventSort('acad', newSort);
}

function toggleInvestigationSort() {
  const newSort = state.sortInv === 'date_asc' ? 'date_desc' : 'date_asc';
  setEventSort('inv', newSort);
}

async function renderHome(c) {
  setBreadcrumbs([{ view: 'home', label: 'Inicio' }]);

  const acad = await cargarEventos('académico', true);
  const inv = await cargarEventos('investigación', true);
  let all = [...acad, ...inv];

  all = filterEventsByStatus(all, state.filterHome);
  if (state.search) {
    all = all.filter(e => e.titulo.toLowerCase().includes(state.search));
  }

  let sortOrder = state.sortHome;
  if (state.filterHome === 'past') {
    sortOrder = (sortOrder === 'date_asc') ? 'date_desc' : 'date_asc';
  }
  all = sortEvents(all, sortOrder);

  const total = all.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const start = (state.pageHome - 1) * PER_PAGE;
  const paginatedEvents = all.slice(start, start + PER_PAGE);

  // Contenedor flexible sin salto de línea (scroll horizontal si necesario)
  const filterRow = `
    <div style="display:flex; gap:8px; flex-wrap:nowrap; overflow-x:auto; padding-bottom:4px; margin-bottom:16px;">
      <button class="btn ${state.filterHome === 'active' ? '' : 'btn-secondary'}" onclick="setHomeFilter('active')" style="${state.filterHome === 'active' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-circle-check"></i> Activos
      </button>
      <button class="btn ${state.filterHome === 'past' ? '' : 'btn-secondary'}" onclick="setHomeFilter('past')" style="${state.filterHome === 'past' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-calendar-check"></i> Pasados
      </button>
      <button class="btn btn-secondary filter-sort-btn"
              onclick="toggleHomeSort()"
              style="background:#fff; color:var(--primary); border:2px solid var(--primary); white-space:nowrap;"
              aria-label="Ordenar por fecha: ${state.sortHome === 'date_asc' ? 'cercanos primero' : 'lejanos primero'}">
        <i class="fa-solid ${state.sortHome === 'date_asc' ? 'fa-arrow-up-wide-short' : 'fa-arrow-down-wide-short'}"></i>
        <span class="sort-text">${state.sortHome === 'date_asc' ? 'Cercanos' : 'Lejanos'}</span>
      </button>
    </div>
  `;

  c.innerHTML = `
    <div class="section-title"><h2><i class="fa-solid fa-star"></i> Bienvenidos al portal de eventos</h2></div>
    <p style="margin-bottom:24px;color:var(--text-soft)">Explora todos los eventos académicos y de investigación de IGSCLAC. Mantente al día con la agenda institucional y regístrate en los eventos disponibles.</p>
    <div class="section-title"><h2>Todos los eventos${state.search ? ` · resultados para "${esc(state.search)}"` : ''}</h2></div>
    ${filterRow}
    ${paginatedEvents.length ? `<div class="events-grid" style="margin-top:24px">${(await Promise.all(paginatedEvents.map(e => cardHtml(e)))).join('')}</div>` : emptyHtml('No se encontraron eventos.')}
    ${paginationHtml(state.pageHome, totalPages, 'home')}
  `;
}

function setHomeFilter(filterValue) {
  state.filterHome = filterValue;
  state.pageHome = 1;
  render();
}

function setHomeSort(sortValue) {
  state.sortHome = sortValue;
  state.pageHome = 1;
  render();
}

async function renderEventList(c, tipo) {
  const isAcad = tipo === 'académico';
  const page = isAcad ? state.pageAcad : state.pageInv;
  const context = isAcad ? 'acad' : 'inv';
  const filter = isAcad ? state.filterAcad : state.filterInv;
  const sort = isAcad ? state.sortAcad : state.sortInv;

  setBreadcrumbs([
    { view: 'home', label: 'Inicio' },
    { view: state.view, label: isAcad ? 'Académicos' : 'Investigación' }
  ]);

  try {
    let all = await cargarEventos(tipo, true);
    all = filterEventsByStatus(all, filter);
    if (state.search) {
      all = all.filter(e => e.titulo.toLowerCase().includes(state.search));
    }

    let sortOrder = sort;
    if (filter === 'past') {
      sortOrder = (sortOrder === 'date_asc') ? 'date_desc' : 'date_asc';
    }
    all = sortEvents(all, sortOrder);

    const total = all.length;
    const totalPages = Math.ceil(total / PER_PAGE);
    let currentPage = Math.min(page, totalPages || 1);
    if (currentPage < 1) currentPage = 1;
    if (isAcad) state.pageAcad = currentPage;
    else state.pageInv = currentPage;

    const start = (currentPage - 1) * PER_PAGE;
    const paginatedEvents = all.slice(start, start + PER_PAGE);

    // Contenedor flexible sin salto de línea
    const filterRow = `
      <div style="display:flex; gap:8px; flex-wrap:nowrap; overflow-x:auto; padding-bottom:4px; margin-bottom:16px;">
        <button class="btn ${filter === 'active' ? '' : 'btn-secondary'}" onclick="setEventFilter('${context}','active')" style="${filter === 'active' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
          <i class="fa-solid fa-circle-check"></i> Activos
        </button>
        <button class="btn ${filter === 'past' ? '' : 'btn-secondary'}" onclick="setEventFilter('${context}','past')" style="${filter === 'past' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
          <i class="fa-solid fa-calendar-check"></i> Pasados
        </button>
        <button class="btn btn-secondary filter-sort-btn"
                onclick="${isAcad ? 'toggleAcademicSort()' : 'toggleInvestigationSort()'}"
                style="background:#fff; color:var(--primary); border:2px solid var(--primary); white-space:nowrap;"
                aria-label="Ordenar por fecha: ${sort === 'date_asc' ? 'cercanos primero' : 'lejanos primero'}">
          <i class="fa-solid ${sort === 'date_asc' ? 'fa-arrow-up-wide-short' : 'fa-arrow-down-wide-short'}"></i>
          <span class="sort-text">${sort === 'date_asc' ? 'Cercanos' : 'Lejanos'}</span>
        </button>
      </div>
    `;

    c.innerHTML = `
      <div class="section-title">
        <h2><i class="fa-solid fa-${isAcad ? 'book' : 'flask'}"></i> Eventos ${isAcad ? 'Académicos' : 'de Investigación'}</h2>
        ${state.role === 'admin' ? `<button class="btn" onclick="openEventForm('${tipo}')"><i class="fa-solid fa-plus"></i> Nuevo evento</button>` : ''}
      </div>
      ${filterRow}
      ${paginatedEvents.length ? `<div class="events-grid" style="margin-top:24px">${(await Promise.all(paginatedEvents.map(e => cardHtml(e)))).join('')}</div>` : emptyHtml('No hay eventos disponibles en este momento.')}
      ${paginationHtml(currentPage, totalPages, context)}
    `;
  } catch (err) {
    console.error(err);
    c.innerHTML = emptyHtml('Error al cargar eventos.');
  }
}

function setEventFilter(context, filterValue) {
  if (context === 'acad') {
    state.filterAcad = filterValue;
  } else if (context === 'inv') {
    state.filterInv = filterValue;
  }
  state.pageAcad = 1;
  state.pageInv = 1;
  render();
}

function setEventSort(context, sortValue) {
  if (context === 'acad') {
    state.sortAcad = sortValue;
  } else if (context === 'inv') {
    state.sortInv = sortValue;
  }
  state.pageAcad = 1;
  state.pageInv = 1;
  render();
}

function emptyHtml(msg) { return `<div class="empty"><i class="fa-regular fa-calendar-xmark"></i><p>${esc(msg)}</p></div>`; }

async function cardHtml(e) {
  const isAcad = e.tipo === 'académico';
  const regs = await cargarRegistros(e.id);
  const totalAsistentes = regs.length + (e.asistentes_manuales || 0);
  const lleno = totalAsistentes >= e.capacidad;
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
          <span><i class="fa-solid fa-users"></i> ${totalAsistentes}/${e.capacidad}</span>
        </div>
        <div class="actions">
          <button class="btn btn-secondary btn-sm" onclick="openEventDetail('${e.id}','${isAcad ? 'acad' : 'inv'}')"><i class="fa-solid fa-eye"></i> Ver más</button>
          ${e.registroHabilitado && state.role === 'user' && !isEventPast(e) ? `<button class="btn btn-sm" ${lleno ? 'disabled style="opacity:.6;cursor:not-allowed"' : ''} onclick="openRegister('${e.id}','${isAcad ? 'acad' : 'inv'}')"><i class="fa-solid fa-user-plus"></i> ${lleno ? 'Lleno' : 'Registrarse'}</button>` : ''}
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
  const eventos = tipoKey === 'acad' ? await cargarEventos('académico', true) : await cargarEventos('investigación', true);
  const e = eventos.find(x => x.id === id);
  if (!e) return;
  const originalRegistros = await cargarRegistros(id);
  const totalAsistentes = originalRegistros.length + (e.asistentes_manuales || 0);
  const pct = Math.min(100, Math.round((totalAsistentes / e.capacidad) * 100));
  const lleno = totalAsistentes >= e.capacidad;
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
    // Si no hay registros y el registro está deshabilitado, no mostrar nada
    if (!sorted.length && !e.registroHabilitado) {
      return '';
    }
    // Si no hay registros pero el registro está habilitado, mostrar mensaje
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
            <div class="${lleno ? 'capacity-full' : ''}"><strong>Capacidad</strong>${totalAsistentes}/${e.capacidad}<div class="capacity-bar ${lleno ? 'full' : ''}"><div style="width:${pct}%"></div></div></div>
            ${e.enlace ? `<div><strong>Enlace</strong><a href="${esc(e.enlace)}" target="_blank" rel="noopener">Abrir <i class="fa-solid fa-arrow-up-right-from-square"></i></a></div>` : ''}
        </div>
        <div class="detail-map">
            <iframe loading="lazy" title="Ubicación del evento" src="https://www.google.com/maps?q=${mapsQ}&output=embed"></iframe>
        </div>
        ${state.role === 'admin' ? `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:24px; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
            <h4 style="color:var(--primary); margin:0"><i class="fa-solid fa-clipboard-list"></i> Asistentes registrados (${totalAsistentes})</h4>
            <div style="display:flex; gap:8px;">
              ${originalRegistros.length > 0 ? `
              <select id="sort-attendees" class="btn btn-secondary btn-sm" style="background:#fff; color:var(--primary); border:1px solid var(--primary); width:auto;">
                <option value="default">Orden por defecto</option>
                <option value="lastname_asc">Apellido (A → Z)</option>
                <option value="lastname_desc">Apellido (Z → A)</option>
              </select>
              ` : ''}
              ${isEventPast(e) ? `
              <div style="position:relative; display:inline-block;">
                <button id="report-dropdown-btn" class="btn btn-sm" style="background:#2d883b; color:#fff;"><i class="fa-solid fa-file-export"></i> Generar informe <i class="fa-solid fa-caret-down"></i></button>
                <div id="report-dropdown" class="dropdown" style="display:none; position:absolute; right:0; top:100%; min-width:160px; z-index:400; background:#fff; box-shadow:var(--shadow); border-radius:6px;">
                  <a href="#" id="export-excel" style="display:block; padding:10px 14px; color:var(--text);"><i class="fa-solid fa-file-excel"></i> Excel </a>
                  <a href="#" id="export-pdf" style="display:block; padding:10px 14px; color:var(--text);"><i class="fa-solid fa-file-pdf"></i> PDF</a>
                </div>
              </div>
        ` : ''}
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

    const reportBtn = document.getElementById('report-dropdown-btn');
    const reportDropdown = document.getElementById('report-dropdown');
    if (reportBtn && reportDropdown) {
      reportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        reportDropdown.style.display = reportDropdown.style.display === 'block' ? 'none' : 'block';
      });

      const eventoDatos = e;

      document.getElementById('export-excel').addEventListener('click', (ev) => {
        ev.preventDefault();
        reportDropdown.style.display = 'none';
        downloadFullReportExcel(eventoDatos, originalRegistros);
      });

      document.getElementById('export-pdf').addEventListener('click', (ev) => {
        ev.preventDefault();
        reportDropdown.style.display = 'none';
        downloadFullReportPDF(eventoDatos, originalRegistros);
      });

      // Cerrar el dropdown al hacer clic fuera
      document.addEventListener('click', (ev) => {
        if (!reportBtn.contains(ev.target) && !reportDropdown.contains(ev.target)) {
          reportDropdown.style.display = 'none';
        }
      }, { once: true });
    }
  }

  $('#modal-footer').innerHTML = `
        ${e.registroHabilitado && state.role === 'user' && !isEventPast(e) ? `<button class="btn" ${lleno ? 'disabled style="opacity:.6;cursor:not-allowed"' : ''} onclick="openRegister('${e.id}','${tipoKey}')"><i class="fa-solid fa-user-plus"></i> ${lleno ? 'Cupo lleno' : 'Registrarse'}</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
    `;
  showModal();
}

function downloadFullReportExcel(evento, registros) {
  const totalAsistentes = registros.length + (evento.asistentes_manuales || 0);
  const wb = XLSX.utils.book_new();

  // ======= HOJA 1: Información del evento =======
  const infoData = [
    ['INFORME DE EVENTO - IGSCLAC'],
    [''],
    ['DATOS GENERALES'],
    ['Título', evento.titulo],
    ['Fecha', `${fmtDatePDF(evento.fechaInicio)}${evento.fechaFin && evento.fechaFin !== evento.fechaInicio ? ' - ' + fmtDatePDF(evento.fechaFin) : ''}`],
    ['Horario', `${formatTime(evento.horaInicio)} - ${formatTime(evento.horaFin)}`],
    ['Duración', `${calcDays(evento.fechaInicio, evento.fechaFin)} día(s)`],
    ['Tipo de evento', evento.tipoEvento],
    ['Clasificación', evento.clasificacion],
  ];

  if (evento.ejeTematico) {
    infoData.push(['Eje temático', evento.ejeTematico]);
  }

  infoData.push(
    ['Lugar', evento.lugar],
    ['Dirección', evento.direccion || ''],
    ['Comité organizador', evento.comite],
    ['Capacidad', String(evento.capacidad)],
    ['Registros reales', String(registros.length)],
  );

  if (evento.asistentes_manuales) {
    infoData.push(['Asistentes manuales', String(evento.asistentes_manuales)]);
  }

  infoData.push(
    ['Total asistentes', String(totalAsistentes)],
    ['Registro habilitado', evento.registroHabilitado ? 'Sí' : 'No'],
  );

  if (evento.enlace) {
    infoData.push(['Enlace', evento.enlace]);
  }

  // Descripción con ajuste de texto automático
  const MAX_CHARS = 80;
  const palabras = (evento.descripcion || '').split(' ');
  const lineas = [];
  let lineaActual = '';
  for (const palabra of palabras) {
    if ((lineaActual + ' ' + palabra).trim().length > MAX_CHARS) {
      if (lineaActual) lineas.push(lineaActual);
      lineaActual = palabra;
    } else {
      lineaActual = lineaActual ? lineaActual + ' ' + palabra : palabra;
    }
  }
  if (lineaActual) lineas.push(lineaActual);
  infoData.push(['Descripción', lineas.join('\n')]);

  // Crear hoja de información
  const wsInfo = XLSX.utils.aoa_to_sheet(infoData);

  // Ajustar anchos de columna
  wsInfo['!cols'] = [
    { wch: 25 },  // columna A (etiquetas)
    { wch: 60 }   // columna B (valores)
  ];

  // Aplicar wrapText a la celda de descripción (fila dinámica)
  const descRowIdx = infoData.findIndex(row => row[0] === 'Descripción');
  if (descRowIdx > -1) {
    const descCell = XLSX.utils.encode_cell({ r: descRowIdx, c: 1 });
    if (wsInfo[descCell]) {
      wsInfo[descCell].s = { alignment: { wrapText: true, vertical: 'top' } };
    }

    if (!wsInfo['!rows']) wsInfo['!rows'] = [];
    wsInfo['!rows'][descRowIdx] = { hpt: Math.max(15, lineas.length * 15) };
  }

  XLSX.utils.book_append_sheet(wb, wsInfo, 'Información del Evento');

  // ======= HOJA 2: Asistentes registrados =======
  const headers = [
    'Nombres', 'Apellidos', 'Email',
    'Tipo ID', 'Identificación', 'Cargo',
    'Institución', 'Fecha de registro'
  ];
  const rows = registros.length > 0
    ? registros.map(r => [
      r.nombres,
      r.apellidos,
      r.email,
      r.tipo_id,
      r.identificacion,
      r.cargo,
      r.institucion,
      new Date(r.fecha_registro).toLocaleString('es-CO')
    ])
    : [['Sin asistentes registrados']];

  const asistData = [headers, ...rows];
  const wsAsist = XLSX.utils.aoa_to_sheet(asistData);

  // Ancho de columnas para asistentes
  wsAsist['!cols'] = [
    { wch: 18 }, // Nombres
    { wch: 18 }, // Apellidos
    { wch: 30 }, // Email
    { wch: 10 }, // Tipo ID
    { wch: 18 }, // Identificación
    { wch: 20 }, // Cargo
    { wch: 30 }, // Institución
    { wch: 22 }  // Fecha de registro
  ];

  XLSX.utils.book_append_sheet(wb, wsAsist, 'Asistentes');

  // Generar archivo .xlsx
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `informe-${evento.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast('Informe Excel descargado');
}

async function downloadFullReportPDF(evento, registros) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 16;
  let y = 24;

  // ====== CABECERA INSTITUCIONAL ======
  doc.setFillColor(0, 156, 26);
  doc.rect(0, 0, pageWidth, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('IGSCLAC EVENTOS', margin, 16);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text('Informe de evento', margin, 24);

  // ====== TÍTULO DEL EVENTO ======
  y = 44;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  const titleLines = doc.splitTextToSize(evento.titulo, pageWidth - margin * 2);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 8 + 8;

  // Línea decorativa
  doc.setDrawColor(0, 156, 26);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ====== TABLA DE METADATOS (usa doc.rect para simular tabla) ======
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);

  // Preparar filas de metadatos
  const metaRows = [
    ['Fecha', `${fmtDatePDF(evento.fechaInicio)}${evento.fechaFin && evento.fechaFin !== evento.fechaInicio ? ' - ' + fmtDatePDF(evento.fechaFin) : ''}`],
    ['Horario', `${formatTime(evento.horaInicio)} - ${formatTime(evento.horaFin)}`],
    ['Duración', `${calcDays(evento.fechaInicio, evento.fechaFin)} día(s)`],
    ['Tipo de evento', evento.tipoEvento],
    ['Clasificación', evento.clasificacion],
  ];
  if (evento.ejeTematico) {
    metaRows.push(['Eje temático', evento.ejeTematico]);
  }
  metaRows.push(
    ['Lugar', evento.lugar],
    ['Dirección', evento.direccion || '-'],
    ['Comité organizador', evento.comite],
    ['Capacidad', String(evento.capacidad)],
    ['Registros reales', String(registros.length)],
  );
  if (evento.asistentes_manuales) {
    metaRows.push(['Asistentes manuales', String(evento.asistentes_manuales)]);
  }
  metaRows.push(['Total asistentes', String(registros.length + (evento.asistentes_manuales || 0))]);
  metaRows.push(['Registro habilitado', evento.registroHabilitado ? 'Sí' : 'No']);
  if (evento.enlace) {
    metaRows.push(['Enlace', evento.enlace]);
  }

  // Configuración de columnas
  const col1Width = 45;  // Ancho de la etiqueta
  const col2Width = pageWidth - margin * 2 - col1Width; // Ancho del valor
  const rowHeight = 7;
  const headerColor = [0, 156, 26];

  // Dibujar encabezado de la tabla de metadatos
  doc.setFillColor(headerColor[0], headerColor[1], headerColor[2]);
  doc.rect(margin, y, col1Width + col2Width, rowHeight, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('DATOS DEL EVENTO', margin + 2, y + 5);
  doc.setTextColor(0, 0, 0);
  y += rowHeight;

  // Dibujar filas de metadatos
  metaRows.forEach((row, index) => {
    if (index % 2 === 0) {
      doc.setFillColor(245, 249, 245);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.rect(margin, y, col1Width + col2Width, rowHeight, 'F');

    // Borde inferior suave
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    doc.line(margin, y + rowHeight, margin + col1Width + col2Width, y + rowHeight);

    // Etiqueta en negrita
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(row[0], margin + 2, y + 5);

    // Valor en normal
    doc.setFont(undefined, 'normal');
    // Si el valor es largo, usar splitTextToSize
    const valueLines = doc.splitTextToSize(row[1], col2Width - 4);
    doc.text(valueLines, margin + col1Width + 2, y + 5);

    const currentRowHeight = Math.max(rowHeight, (valueLines.length * 4.5) + 2);
    y += currentRowHeight;
  });

  y += 8;

  // ====== DESCRIPCIÓN ======
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.text('Descripción:', margin, y);
  y += 5;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9.5);
  const descLines = doc.splitTextToSize(evento.descripcion || '', pageWidth - margin * 2);
  doc.text(descLines, margin, y);
  y += descLines.length * 5 + 8;

  // ====== LISTA DE ASISTENTES ======
  doc.setFillColor(headerColor[0], headerColor[1], headerColor[2]);
  doc.rect(margin, y, col1Width + col2Width, rowHeight + 1, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('ASISTENTES REGISTRADOS', margin + 2, y + 5.5);
  doc.setTextColor(0, 0, 0);
  y += rowHeight + 3;

  if (registros.length > 0) {
    // Configuración de columnas de la tabla de asistentes
    const asistHeaders = ['Nombre completo', 'Identificación', 'Email', 'Cargo', 'Institución'];
    const asistColWidths = [45, 30, 45, 30, 30];
    const totalAsistWidth = asistColWidths.reduce((a, b) => a + b, 0);
    const startX = margin + (col1Width + col2Width - totalAsistWidth) / 2; // centrar

    // Cabecera de la tabla
    doc.setFillColor(headerColor[0], headerColor[1], headerColor[2]);
    doc.rect(startX, y, totalAsistWidth, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    let xPos = startX;
    asistHeaders.forEach((h, i) => {
      doc.text(h, xPos + 1, y + 5);
      xPos += asistColWidths[i];
    });
    y += 7;
    doc.setTextColor(0, 0, 0);

    // Filas de datos
    registros.forEach((r, idx) => {
      if (y > 265) {
        doc.addPage();
        y = 20;
        // Repetir cabecera en nueva página
        doc.setFillColor(headerColor[0], headerColor[1], headerColor[2]);
        doc.rect(startX, y, totalAsistWidth, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        let xPos2 = startX;
        asistHeaders.forEach((h, i) => {
          doc.text(h, xPos2 + 1, y + 5);
          xPos2 += asistColWidths[i];
        });
        y += 7;
        doc.setTextColor(0, 0, 0);
      }

      // Alternar color de fondo
      if (idx % 2 === 0) {
        doc.setFillColor(245, 249, 245);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(startX, y, totalAsistWidth, 6, 'F');

      doc.setFontSize(7.5);
      doc.setFont(undefined, 'normal');
      let xPosRow = startX;
      const rowData = [
        `${r.nombres} ${r.apellidos}`,
        `${r.tipo_id} ${r.identificacion}`,
        r.email,
        r.cargo,
        r.institucion
      ];
      rowData.forEach((cell, i) => {
        // Ajustar texto al ancho de columna
        const lines = doc.splitTextToSize(cell || '', asistColWidths[i] - 2);
        lines.forEach((line, lineIdx) => {
          doc.text(line, xPosRow + 1, y + 4 + lineIdx * 3.5);
        });
        xPosRow += asistColWidths[i];
      });
      y += 7;
    });
  } else {
    y += 5;
    doc.setFontSize(10);
    doc.text('No se registraron asistentes en este evento.', margin, y);
  }

  // ====== PIE DE PÁGINA ======
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.setFont(undefined, 'italic');
    doc.text(`Informe generado el ${new Date().toLocaleString('es-CO')}`, margin, 287);
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin - 20, 287);
  }

  doc.save(`informe-${evento.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
  toast('Informe PDF descargado');
}

// ---------- HERO SLIDER (ADMIN) ----------

function generarHTMLSlide(slide, index, mostrarReqAccion) {
  const tituloLength = slide.titulo ? slide.titulo.length : 0;
  const descLength = slide.descripcion ? slide.descripcion.length : 0;
  const botonLength = slide.textoBoton ? slide.textoBoton.length : 0;

  return `
      <div id="slide-container-${index}" class="slide-container" data-index="${index}" style="border:1px solid #ddd;padding:15px;border-radius:4px;background:#f9f9f9;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
          <h3 style="margin:0;color:var(--primary)">Slide ${index + 1}</h3>
          <button onclick="eliminarSlideHero(${index})" class="btn btn-secondary" style="padding:5px 10px;font-size:12px;">
            <i class="fa-solid fa-trash"></i> Eliminar
          </button>
        </div>
        <div class="form-group">
          <label>Título <span class="req">*</span> (máx 60)</label>
          <input type="text" class="slide-titulo-${index}" value="${esc(slide.titulo)}" maxlength="60" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
          <div class="char-counter" id="titulo-counter-${index}">${tituloLength}/60</div>
        </div>
        <div class="form-group">
          <label>Descripción (máx 190):</label>
          <textarea class="slide-descripcion-${index}" maxlength="190" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;min-height:80px;">${esc(slide.descripcion)}</textarea>
          <div class="char-counter" id="desc-counter-${index}">${descLength}/190</div>
        </div>
        <div class="form-group">
          <label>Imagen: <span class="req">*</span></label>
          <div style="display:flex; gap:8px;">
            <input type="url" class="slide-imagen-${index}" placeholder="https://..." value="${esc(slide.imagen)}" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;">
            <button type="button" class="btn btn-sm btn-secondary" onclick="uploadHeroSlideImage(this, ${index})" title="Subir imagen desde WordPress">
              <i class="fa-solid fa-upload"></i>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label>Texto del botón (máx 30):</label>
          <input type="text" class="slide-boton-${index}" value="${esc(slide.textoBoton)}" maxlength="30" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
          <div class="char-counter" id="boton-counter-${index}">${botonLength}/30</div>
        </div>
        <div class="form-group" style="margin-bottom: 20px;">
          <label class="checkbox-row">
            <input type="checkbox" class="slide-overlay-${index}" ${slide.overlayActivo ? 'checked' : ''}>
            Activar difuminado verde (overlay)
          </label>
        </div>
        <div class="form-group">
          <label>Tipo de acción:</label>
          <select class="slide-tipo-${index}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
            <option value="navegacion" ${slide.tipoAccion === 'navegacion' ? 'selected' : ''}>Navegación</option>
            <option value="evento" ${slide.tipoAccion === 'evento' ? 'selected' : ''}>Ir a Evento</option>
            <option value="evento_pasado" ${slide.tipoAccion === 'evento_pasado' ? 'selected' : ''}>Ir a Evento Pasado</option>
          </select>
        </div>
        <div class="form-group">
          <label>Acción: <span class="req-accion-${index}" style="color:#c0392b; display:${mostrarReqAccion ? 'inline' : 'none'};">*</span></label>
          <div class="slide-accion-container-${index}">
            ${renderAccionInput(index, slide, cachedAllEvents)}
          </div>
        </div>
      </div>
    `;
}

async function guardarHeroSlides(slides) {
  try {
    const response = await fetchAPI('/hero-slides', {
      method: 'POST',
      body: { slides: slides }
    });
    toast('Hero slider actualizado correctamente', 'success');
    // Recargar los slides
    await cargarHeroSlides();
    buildHero();
    return response;
  } catch (err) {
    toast('Error al guardar hero slider: ' + err.message, 'error');
    throw err;
  }
}

function cancelarEditorHero() {
  // Comparar si hay cambios
  const hayCambios = JSON.stringify(workingSlides) !== JSON.stringify(originalSlides);

  if (hayCambios) {
    if (!confirm('Hay cambios sin guardar. ¿Deseas descartarlos y cerrar el editor?')) {
      return;
    }
  }

  const modal = document.getElementById('hero-editor-modal');
  if (modal) modal.remove();

  slides = JSON.parse(JSON.stringify(originalSlides));
  workingSlides = [];
  originalSlides = [];

  buildHero();
}

function abrirEditorHeroSlides() {
  if (state.role !== 'admin') { toast('Solo el administrador puede editar el hero', 'error'); return; }

  // Crear copia profunda del estado actual
  workingSlides = JSON.parse(JSON.stringify(slides));
  originalSlides = JSON.parse(JSON.stringify(slides));

  // Cargar eventos una sola vez
  (async () => {
    const acad = await cargarEventos('académico', true);
    const inv = await cargarEventos('investigación', true);
    cachedAllEvents = [...acad, ...inv];

    const modal = `
      <div id="hero-editor-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this) cancelarEditorHero()">
        <div style="background:white;border-radius:8px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;padding:0;display:flex;flex-direction:column;">
          <style>
            #hero-editor-modal .form-group div[style*="display:flex"] { flex-wrap: wrap; }
            #hero-editor-modal .form-group .field-error { width: 100%; margin-top: 4px; }
          </style>
          <div class="modal-header" style="background:var(--primary);color:#fff;border-radius:8px 8px 0 0;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;color:#fff">Editar Hero Slider</h3>
            <button onclick="cancelarEditorHero()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#fff;">&times;</button>
          </div>
          <div style="padding:30px;">
            <div id="hero-editor-content"></div>
            <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">
              <button onclick="cancelarEditorHero()" class="btn btn-secondary">Cancelar</button>
              <button onclick="guardarHeroSlidesCambios()" class="btn">Guardar cambios</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modal);
    renderHeroSliderEditor();
  })();
}

async function renderHeroSliderEditor() {
  const content = document.getElementById('hero-editor-content');
  const slidesEditor = document.getElementById('hero-slides-editor');
  if (slidesEditor) slidesEditor.remove();

  const todosEventos = cachedAllEvents;

  let html = '<div id="hero-slides-editor" style="display:flex;flex-direction:column;gap:20px;">';

  workingSlides.forEach((slide, i) => {
    const mostrarReqAccion = slide.textoBoton && slide.textoBoton.trim() !== '';
    html += generarHTMLSlide(slide, i, mostrarReqAccion);
  });

  html += `
    <button id="agregar-slide-btn" class="btn" style="align-self:flex-start;">
      <i class="fa-solid fa-plus"></i> Agregar slide
    </button>
  </div>`;

  content.innerHTML = html;

  // Agregar event listeners para actualizar contadores
  for (let i = 0; i < workingSlides.length; i++) {
    const tituloInput = document.querySelector(`.slide-titulo-${i}`);
    const descInput = document.querySelector(`.slide-descripcion-${i}`);
    const botonInput = document.querySelector(`.slide-boton-${i}`);
    const tituloCounter = document.getElementById(`titulo-counter-${i}`);
    const descCounter = document.getElementById(`desc-counter-${i}`);
    const botonCounter = document.getElementById(`boton-counter-${i}`);

    if (tituloInput && tituloCounter) {
      const updateTituloCounter = () => {
        const len = tituloInput.value.length;
        tituloCounter.textContent = `${len}/60`;
        if (len >= 55) tituloCounter.classList.add('warning');
        else tituloCounter.classList.remove('warning');
      };
      tituloInput.addEventListener('input', updateTituloCounter);
      updateTituloCounter();
    }
    if (descInput && descCounter) {
      const updateDescCounter = () => {
        const len = descInput.value.length;
        descCounter.textContent = `${len}/190`;
        if (len >= 160) descCounter.classList.add('warning');
        else descCounter.classList.remove('warning');
      };
      descInput.addEventListener('input', updateDescCounter);
      updateDescCounter();
    }
    if (botonInput && botonCounter) {
      const updateBotonCounter = () => {
        const len = botonInput.value.length;
        botonCounter.textContent = `${len}/30`;
        if (len >= 28) botonCounter.classList.add('warning');
        else botonCounter.classList.remove('warning');
      };
      botonInput.addEventListener('input', updateBotonCounter);
      updateBotonCounter();
    }
  }

  renumberSlides();
  for (let i = 0; i < workingSlides.length; i++) {
    attachEventListenersToSlide(i);
  }

  // Asignar el evento click al botón de agregar
  document.getElementById('agregar-slide-btn').onclick = () => agregarSlideHero();

  // Agregar event listeners para cambio de tipo de acción
  workingSlides.forEach((_, i) => {
    const tipoSelect = document.querySelector(`.slide-tipo-${i}`);
    if (tipoSelect) {
      tipoSelect.addEventListener('change', () => {
        const container = document.querySelector(`.slide-accion-container-${i}`);
        const tipo = tipoSelect.value;
        const accionActual = document.querySelector(`.slide-accion-${i}`)?.value || workingSlides[i].accion;
        container.innerHTML = renderAccionInput(i, { tipoAccion: tipo, accion: accionActual }, todosEventos);
        const botonInput = document.querySelector(`.slide-boton-${i}`);
        const accionSelect = document.querySelector(`.slide-accion-${i}`);
        if (accionSelect && botonInput) accionSelect.disabled = botonInput.value.trim() === '';
      });
    }

    const botonInput = document.querySelector(`.slide-boton-${i}`);
    if (botonInput) {
      const asteriscoAccion = document.querySelector(`.req-accion-${i}`);
      const tipoSelect = document.querySelector(`.slide-tipo-${i}`);
      const toggleAsteriscoYDisabled = () => {
        const tieneTexto = botonInput.value.trim() !== '';
        if (asteriscoAccion) asteriscoAccion.style.display = tieneTexto ? 'inline' : 'none';
        if (tipoSelect) tipoSelect.disabled = !tieneTexto;
        const accionSelect = document.querySelector(`.slide-accion-${i}`);
        if (accionSelect) {
          accionSelect.disabled = !tieneTexto;
          if (!tieneTexto) {
            const existingError = accionSelect.parentNode.querySelector('.field-error');
            if (existingError) existingError.remove();
            accionSelect.classList.remove('error');
          }
        }
      };
      botonInput.addEventListener('input', toggleAsteriscoYDisabled);
      toggleAsteriscoYDisabled();
    }
  });
}

function renderAccionInput(index, slide, todosEventos = []) {
  if (slide.tipoAccion === 'evento') {
    const eventosActivos = todosEventos.filter(e => !isEventPast(e) && e.habilitado !== false);
    let optionsHtml = '<option value="">-- Selecciona un evento --</option>';
    eventosActivos.forEach(evt => {
      const selected = evt.id === slide.accion ? 'selected' : '';
      const label = `${evt.titulo} (${evt.tipo === 'académico' ? 'Académico' : 'Investigación'})`;
      optionsHtml += `<option value="${evt.id}" ${selected}>${esc(label)}</option>`;
    });
    return `
      <select class="slide-accion-${index}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
        ${optionsHtml}
      </select>
      <small style="color:#666;display:block;margin-top:5px;">Selecciona un evento activo para abrirlo al hacer clic en el botón.</small>
    `;
  } else if (slide.tipoAccion === 'evento_pasado') {
    const eventosPasados = todosEventos.filter(e => isEventPast(e));
    let optionsHtml = '<option value="">-- Selecciona un evento --</option>';
    eventosPasados.forEach(evt => {
      const selected = evt.id === slide.accion ? 'selected' : '';
      const label = `${evt.titulo} (${evt.tipo === 'académico' ? 'Académico' : 'Investigación'})`;
      optionsHtml += `<option value="${evt.id}" ${selected}>${esc(label)}</option>`;
    });
    return `
      <select class="slide-accion-${index}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
        ${optionsHtml}
      </select>
      <small style="color:#666;display:block;margin-top:5px;">Selecciona un evento pasado para mostrarlo como noticia.</small>
    `;
  } else {
    return `
      <select class="slide-accion-${index}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
        <option value="home" ${slide.accion === 'home' ? 'selected' : ''}>Inicio</option>
        <option value="academicos" ${slide.accion === 'academicos' ? 'selected' : ''}>Eventos Académicos</option>
        <option value="investigacion" ${slide.accion === 'investigacion' ? 'selected' : ''}>Eventos de Investigación</option>
      </select>
    `;
  }
}

function eliminarSlideHero(index) {
  if (workingSlides.length <= 1) {
    toast('Debes tener al menos 1 slide', 'error');
    return;
  }
  if (!confirm('¿Eliminar este slide?')) return;

  syncWorkingSlidesFromDOM();

  const container = document.getElementById(`slide-container-${index}`);
  if (container) container.remove();

  workingSlides.splice(index, 1);

  renumberSlides();

  syncWorkingSlidesFromDOM();

  for (let i = 0; i < workingSlides.length; i++) {
    attachEventListenersToSlide(i);
  }
}

async function agregarSlideHero() {
  syncWorkingSlidesFromDOM();

  const nuevoSlide = {
    titulo: 'Nuevo slide',
    descripcion: 'Descripción del nuevo slide',
    imagen: '',
    textoBoton: 'Botón',
    tipoAccion: 'navegacion',
    accion: 'home',
    overlayActivo: true
  };
  const nuevoIndex = workingSlides.length;
  workingSlides.push(nuevoSlide);

  const mostrarReqAccion = nuevoSlide.textoBoton && nuevoSlide.textoBoton.trim() !== '';
  const nuevoSlideHtml = generarHTMLSlide(nuevoSlide, nuevoIndex, mostrarReqAccion);

  const editorContainer = document.getElementById('hero-slides-editor');
  const addButton = document.getElementById('agregar-slide-btn');
  editorContainer.insertBefore(createElementFromHTML(nuevoSlideHtml), addButton);

  // Configurar contadores y eventos
  const tituloInput = document.querySelector(`.slide-titulo-${nuevoIndex}`);
  const descInput = document.querySelector(`.slide-descripcion-${nuevoIndex}`);
  const botonInput = document.querySelector(`.slide-boton-${nuevoIndex}`);
  const tituloCounter = document.getElementById(`titulo-counter-${nuevoIndex}`);
  const descCounter = document.getElementById(`desc-counter-${nuevoIndex}`);
  const botonCounter = document.getElementById(`boton-counter-${nuevoIndex}`);

  if (tituloInput && tituloCounter) {
    const updateTituloCounter = () => {
      const len = tituloInput.value.length;
      tituloCounter.textContent = `${len}/60`;
      if (len >= 55) tituloCounter.classList.add('warning');
      else tituloCounter.classList.remove('warning');
    };
    tituloInput.addEventListener('input', updateTituloCounter);
    updateTituloCounter();
  }
  if (descInput && descCounter) {
    const updateDescCounter = () => {
      const len = descInput.value.length;
      descCounter.textContent = `${len}/190`;
      if (len >= 160) descCounter.classList.add('warning');
      else descCounter.classList.remove('warning');
    };
    descInput.addEventListener('input', updateDescCounter);
    updateDescCounter();
  }
  if (botonInput && botonCounter) {
    const updateBotonCounter = () => {
      const len = botonInput.value.length;
      botonCounter.textContent = `${len}/30`;
      if (len >= 28) botonCounter.classList.add('warning');
      else botonCounter.classList.remove('warning');
    };
    botonInput.addEventListener('input', updateBotonCounter);
    updateBotonCounter();
  }

  renumberSlides();
  syncWorkingSlidesFromDOM();
  for (let i = 0; i < workingSlides.length; i++) {
    attachEventListenersToSlide(i);
  }
}

// Helper para convertir HTML string a nodo
function createElementFromHTML(htmlString) {
  const div = document.createElement('div');
  div.innerHTML = htmlString.trim();
  return div.firstChild;
}

// Actualizar los números de los títulos "Slide X" y los data-index
function updateSlideNumbers() {
  const slideContainers = document.querySelectorAll('#hero-slides-editor .slide-container');
  slideContainers.forEach((container, idx) => {
    const titleH3 = container.querySelector('h3');
    if (titleH3) titleH3.textContent = `Slide ${idx + 1}`;
    container.setAttribute('data-index', idx);
  });
}

// Adjuntar event listeners a un slide específico (cambio de tipoAcción, etc.)
function attachEventListenersToSlide(i) {
  const tipoSelect = document.querySelector(`.slide-tipo-${i}`);
  const botonInput = document.querySelector(`.slide-boton-${i}`);
  if (!tipoSelect || !botonInput) return;

  tipoSelect.addEventListener('change', () => {
    const container = document.querySelector(`.slide-accion-container-${i}`);
    const tipo = tipoSelect.value;
    const accionActual = document.querySelector(`.slide-accion-${i}`)?.value || workingSlides[i]?.accion || '';
    container.innerHTML = renderAccionInput(i, { tipoAccion: tipo, accion: accionActual }, cachedAllEvents);
    const accionSelect = document.querySelector(`.slide-accion-${i}`);
    if (accionSelect && botonInput) accionSelect.disabled = botonInput.value.trim() === '';
  });

  const asteriscoAccion = document.querySelector(`.req-accion-${i}`);
  const tipoSelect2 = document.querySelector(`.slide-tipo-${i}`);
  const toggleAsteriscoYDisabled = () => {
    const tieneTexto = botonInput.value.trim() !== '';
    if (asteriscoAccion) asteriscoAccion.style.display = tieneTexto ? 'inline' : 'none';
    if (tipoSelect2) tipoSelect2.disabled = !tieneTexto;
    const accionSelect = document.querySelector(`.slide-accion-${i}`);
    if (accionSelect) {
      accionSelect.disabled = !tieneTexto;
      if (!tieneTexto) {
        const existingError = accionSelect.parentNode.querySelector('.field-error');
        if (existingError) existingError.remove();
        accionSelect.classList.remove('error');
      }
    }
  };
  botonInput.addEventListener('input', toggleAsteriscoYDisabled);
  toggleAsteriscoYDisabled();
}

async function guardarHeroSlidesCambios() {
  // 1. Limpiar todos los errores previos en el modal del editor
  const editorModal = document.getElementById('hero-editor-modal');
  editorModal.querySelectorAll('.field-error').forEach(el => el.remove());
  editorModal.querySelectorAll('.error').forEach(el => el.classList.remove('error'));

  let hayErrores = false;

  // 2. Validar cada slide usando workingSlides (la copia de trabajo)
  for (let i = 0; i < workingSlides.length; i++) {
    // --- Validar título ---
    const tituloInput = document.querySelector(`.slide-titulo-${i}`);
    const titulo = tituloInput?.value?.trim() || '';
    if (!titulo) {
      showFieldError(tituloInput, 'El título del slide es obligatorio.');
      hayErrores = true;
    } else if (titulo.length > 60) {
      showFieldError(tituloInput, `El título no puede exceder 60 caracteres (actualmente ${titulo.length}).`);
      hayErrores = true;
    }

    // --- Validar descripción ---
    const descInput = document.querySelector(`.slide-descripcion-${i}`);
    const descripcion = descInput?.value || '';
    if (descripcion.length > 190) {
      showFieldError(descInput, `La descripción no puede exceder 190 caracteres (actualmente ${descripcion.length}).`);
      hayErrores = true;
    }

    // --- Validar imagen ---
    const imagenInput = document.querySelector(`.slide-imagen-${i}`);
    const imagen = imagenInput?.value?.trim() || '';
    if (!imagen) {
      showFieldError(imagenInput, 'La imagen es obligatoria para el slide.');
      hayErrores = true;
    }

    // --- Validar texto del botón ---
    const botonInput = document.querySelector(`.slide-boton-${i}`);
    const textoBoton = botonInput?.value?.trim() || '';
    if (textoBoton.length > 30) {
      showFieldError(botonInput, `El texto del botón no puede exceder 30 caracteres (actualmente ${textoBoton.length}).`);
      hayErrores = true;
    }

    // --- Validar acción SOLO si el texto del botón no está vacío ---
    if (textoBoton !== '') {
      const tipoAccion = document.querySelector(`.slide-tipo-${i}`)?.value || 'navegacion';
      if (tipoAccion === 'evento' || tipoAccion === 'evento_pasado') {
        const accionSelect = document.querySelector(`.slide-accion-${i}`);
        const accion = accionSelect?.value || '';
        if (!accion) {
          showFieldError(accionSelect, 'Debes seleccionar un evento para esta acción (el botón tiene texto).');
          hayErrores = true;
        }
      }
    } else {
      // Si no hay texto en el botón, limpiamos cualquier error previo del campo acción
      const accionSelect = document.querySelector(`.slide-accion-${i}`);
      if (accionSelect) {
        const existingError = accionSelect.parentNode.querySelector('.field-error');
        if (existingError) existingError.remove();
        accionSelect.classList.remove('error');
      }
    }
  }

  // 3. Si hay errores, mostrar el primer error y detener la ejecución
  if (hayErrores) {
    const primerError = editorModal.querySelector('.field-error');
    if (primerError) {
      primerError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  // 4. Construir el array definitivo con los valores actuales de los inputs
  const slidesEditados = [];
  for (let i = 0; i < workingSlides.length; i++) {
    const titulo = document.querySelector(`.slide-titulo-${i}`)?.value || '';
    const descripcion = document.querySelector(`.slide-descripcion-${i}`)?.value || '';
    const imagen = document.querySelector(`.slide-imagen-${i}`)?.value || '';
    const textoBoton = document.querySelector(`.slide-boton-${i}`)?.value || '';
    const tipoAccion = document.querySelector(`.slide-tipo-${i}`)?.value || 'navegacion';
    const accion = document.querySelector(`.slide-accion-${i}`)?.value || '';
    const overlayCheckbox = document.querySelector(`.slide-overlay-${i}`);
    const overlayActivo = overlayCheckbox ? overlayCheckbox.checked : true;

    slidesEditados.push({
      titulo, descripcion, imagen, textoBoton, tipoAccion, accion, overlayActivo
    });
  }

  // 5. Guardar en la base de datos
  await guardarHeroSlides(slidesEditados);

  // 6. Actualizar las variables globales con los nuevos datos
  slides = slidesEditados;
  originalSlides = JSON.parse(JSON.stringify(slidesEditados));
  workingSlides = [];

  editorModal.remove();
}

function renumberSlides() {
  const containers = document.querySelectorAll('#hero-slides-editor .slide-container');
  containers.forEach((container, newIndex) => {
    // Actualizar el id del contenedor principal
    if (container.id) {
      container.id = container.id.replace(/\d+$/, newIndex);
    }
    // Actualizar data-index
    container.setAttribute('data-index', newIndex);
    // Actualizar título <h3>
    const titleH3 = container.querySelector('h3');
    if (titleH3) titleH3.textContent = `Slide ${newIndex + 1}`;
    // Actualizar el onclick del botón eliminar
    const deleteBtn = container.querySelector('button[onclick^="eliminarSlideHero"]');
    if (deleteBtn) {
      deleteBtn.setAttribute('onclick', `eliminarSlideHero(${newIndex})`);
    }
    // Actualizar clases e IDs de todos los elementos dentro del slide
    const elementsWithIndex = container.querySelectorAll('[class*="-"], [id*="-"]');
    elementsWithIndex.forEach(el => {
      if (el.id) {
        el.id = el.id.replace(/\d+$/, newIndex);
      }
      if (el.className && typeof el.className === 'string') {
        el.className = el.className.replace(/-\d+\b/g, `-${newIndex}`);
      }
    });
  });
}

function syncWorkingSlidesFromDOM() {
  for (let i = 0; i < workingSlides.length; i++) {
    const titulo = document.querySelector(`.slide-titulo-${i}`)?.value || '';
    const descripcion = document.querySelector(`.slide-descripcion-${i}`)?.value || '';
    const imagen = document.querySelector(`.slide-imagen-${i}`)?.value || '';
    const textoBoton = document.querySelector(`.slide-boton-${i}`)?.value || '';
    const tipoAccion = document.querySelector(`.slide-tipo-${i}`)?.value || 'navegacion';
    const accion = document.querySelector(`.slide-accion-${i}`)?.value || '';
    const overlayCheckbox = document.querySelector(`.slide-overlay-${i}`);
    const overlayActivo = overlayCheckbox ? overlayCheckbox.checked : true;

    workingSlides[i] = {
      ...workingSlides[i],
      titulo,
      descripcion,
      imagen,
      textoBoton,
      tipoAccion,
      accion,
      overlayActivo
    };
  }
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
      const eventos = await cargarEventos(tipo, true);
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
          ${typeof e.habilitado !== 'undefined' ? `<input type="hidden" name="habilitado" value="${e.habilitado ? '1' : '0'}">` : ''}
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
  const eventos = tipoKey === 'acad' ? await cargarEventos('académico', true) : await cargarEventos('investigación', true);
  const original = eventos.find(x => x.id === id);
  if (!original) {
    toast('Evento no encontrado', 'error');
    return;
  }
  const clone = { ...original };
  delete clone.id;
  clone.fechaInicio = '';
  clone.fechaFin = '';
  clone.habilitado = false;
  const tipoOriginal = original.tipo === 'académico' ? 'académico' : 'investigación';
  openEventForm(tipoOriginal, null, clone);
}

// ---------- REGISTRO DE ASISTENTES ----------
async function openRegister(id, tipoKey) {
  const prevForm = document.getElementById('reg-form');
  if (prevForm) clearFieldErrors(prevForm);
  const eventos = tipoKey === 'acad' ? await cargarEventos('académico', state.role === 'admin') : await cargarEventos('investigación', state.role === 'admin');
  const e = eventos.find(x => x.id === id);
  if (!e) return;
  const regs = await cargarRegistros(id);
  if (regs.length >= e.capacidad) { toast('Lo sentimos, este evento ha alcanzado su capacidad máxima.', 'error'); return; }
  $('#modal-title').textContent = 'Registro de asistente · ' + e.titulo;
  $('#modal-body').innerHTML = `
    <p style="margin-bottom:14px;color:var(--text-soft)">Completa tus datos para registrarte. Cupos disponibles: <strong>${e.capacidad - regs.length}</strong> de ${e.capacidad}.</p>
    <form id="reg-form" novalidate>
      <div class="form-grid">
        <div class="form-group">
          <label>Nombres <span class="req">*</span></label>
          <input name="nombres" required maxlength="50">
          <div class="char-counter" id="counter-nombres">0/50</div>
        </div>
        <div class="form-group">
          <label>Apellidos <span class="req">*</span></label>
          <input name="apellidos" required maxlength="50">
          <div class="char-counter" id="counter-apellidos">0/50</div>
        </div>
        <div class="form-group">
          <label>Correo electrónico <span class="req">*</span></label>
          <input type="email" name="email" required maxlength="100">
          <div class="char-counter" id="counter-email">0/100</div>
        </div>
        <div class="form-group">
          <label>Tipo de identificación <span class="req">*</span></label>
          <select name="tipoId" required>
            <option value="CC">CC - Cédula de Ciudadanía</option>
            <option value="TI">TI - Tarjeta de Identidad</option>
            <option value="CE">CE - Cédula de Extranjería</option>
            <option value="PA">PA - Pasaporte</option>
            <option value="RC">RC - Registro Civil</option>
          </select>
        </div>
        <div class="form-group">
          <label>Identificación <span class="req">*</span></label>
          <input name="identificacion" required maxlength="10">
          <div class="char-counter" id="counter-identificacion">0/10</div>
        </div>
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
          <input type="text" name="cargoOtro" id="cargoOtro" placeholder="Especificar cargo" maxlength="100" style="display:none; margin-top:8px;">
          <div class="char-counter" id="counter-cargoOtro" style="display:none;">0/100</div>
        </div>
        <div class="form-group full">
          <label>Institución <span class="req">*</span></label>
          <input name="institucion" required maxlength="200">
          <div class="char-counter" id="counter-institucion">0/200</div>
        </div>
      </div>
    </form>
  `;
  $('#modal-footer').innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn" onclick="validateAndSubmitRegister('${id}','${tipoKey}')"><i class="fa-solid fa-check"></i> Confirmar registro</button>
  `;

  // Una vez insertado el HTML, añadimos los contadores y listeners
  const nombresInput = document.querySelector('input[name="nombres"]');
  const apellidosInput = document.querySelector('input[name="apellidos"]');
  const emailInput = document.querySelector('input[name="email"]');
  const identificacionInput = document.querySelector('input[name="identificacion"]');
  const institucionInput = document.querySelector('input[name="institucion"]');
  const cargoSelect = document.getElementById('cargoSelect');
  const cargoOtro = document.getElementById('cargoOtro');
  const counterCargoOtro = document.getElementById('counter-cargoOtro');

  function updateCounter(input, counterId, max) {
    const counter = document.getElementById(counterId);
    if (counter) {
      const len = input.value.length;
      counter.textContent = `${len}/${max}`;
      if (len >= max - 5) counter.classList.add('warning');
      else counter.classList.remove('warning');
    }
  }

  if (nombresInput) {
    nombresInput.addEventListener('input', () => updateCounter(nombresInput, 'counter-nombres', 50));
    updateCounter(nombresInput, 'counter-nombres', 50);
  }
  if (apellidosInput) {
    apellidosInput.addEventListener('input', () => updateCounter(apellidosInput, 'counter-apellidos', 50));
    updateCounter(apellidosInput, 'counter-apellidos', 50);
  }
  if (emailInput) {
    emailInput.addEventListener('input', () => updateCounter(emailInput, 'counter-email', 100));
    updateCounter(emailInput, 'counter-email', 100);
  }
  if (identificacionInput) {
    identificacionInput.addEventListener('input', () => updateCounter(identificacionInput, 'counter-identificacion', 10));
    updateCounter(identificacionInput, 'counter-identificacion', 10);
  }
  if (institucionInput) {
    institucionInput.addEventListener('input', () => updateCounter(institucionInput, 'counter-institucion', 200));
    updateCounter(institucionInput, 'counter-institucion', 200);
  }

  function toggleCargoOtro() {
    if (cargoSelect.value === 'Otro') {
      cargoOtro.style.display = 'block';
      counterCargoOtro.style.display = 'block';
      cargoOtro.required = true;
      // Activar contador para cargoOtro
      cargoOtro.addEventListener('input', () => updateCounter(cargoOtro, 'counter-cargoOtro', 100));
      updateCounter(cargoOtro, 'counter-cargoOtro', 100);
    } else {
      cargoOtro.style.display = 'none';
      counterCargoOtro.style.display = 'none';
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

  // Validaciones de campos obligatorios y longitud
  if (!nombres) {
    showFieldError(form.nombres, 'Los nombres son obligatorios.');
    isValid = false;
  } else if (nombres.length > 50) {
    showFieldError(form.nombres, 'Los nombres no pueden exceder 50 caracteres.');
    isValid = false;
  }

  if (!apellidos) {
    showFieldError(form.apellidos, 'Los apellidos son obligatorios.');
    isValid = false;
  } else if (apellidos.length > 50) {
    showFieldError(form.apellidos, 'Los apellidos no pueden exceder 50 caracteres.');
    isValid = false;
  }

  if (!email) {
    showFieldError(form.email, 'El correo electrónico es obligatorio.');
    isValid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFieldError(form.email, 'Ingresa un correo electrónico válido (ej: nombre@dominio.com).');
    isValid = false;
  } else if (email.length > 100) {
    showFieldError(form.email, 'El correo electrónico no puede exceder 100 caracteres.');
    isValid = false;
  }

  if (!identificacion) {
    showFieldError(form.identificacion, 'La identificación es obligatoria.');
    isValid = false;
  } else if (identificacion.length > 10) {
    showFieldError(form.identificacion, 'La identificación no puede exceder 10 caracteres.');
    isValid = false;
  }

  if (!cargo) {
    if (cargoSelect.value === 'Otro') {
      showFieldError(cargoOtro, 'Especifica tu cargo.');
    } else {
      showFieldError(cargoSelect, 'Selecciona tu cargo.');
    }
    isValid = false;
  } else if (cargoSelect.value === 'Otro' && cargo.length > 100) {
    showFieldError(cargoOtro, 'El cargo no puede exceder 100 caracteres.');
    isValid = false;
  }

  if (!institucion) {
    showFieldError(form.institucion, 'La institución es obligatoria.');
    isValid = false;
  } else if (institucion.length > 200) {
    showFieldError(form.institucion, 'La institución no puede exceder 200 caracteres.');
    isValid = false;
  }

  if (!isValid) return;

  const eventos = tipoKey === 'acad' ? await cargarEventos('académico', state.role === 'admin') : await cargarEventos('investigación', state.role === 'admin');
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

function uploadHeroSlideImage(btn, slideIndex) {
  if (window._igsclacMediaFrameHero) {
    try { window._igsclacMediaFrameHero.detach(); } catch (e) { }
    window._igsclacMediaFrameHero = null;
  }

  const frame = wp.media({
    title: 'Seleccionar imagen para el slide',
    button: { text: 'Usar esta imagen' },
    multiple: false
  });

  window._igsclacMediaFrameHero = frame;

  frame.on('select', function () {
    const attachment = frame.state().get('selection').first().toJSON();
    const input = document.querySelector(`.slide-imagen-${slideIndex}`);
    if (input) input.value = attachment.url;
  });

  frame.open();
}

function uploadEventImage(btn) {
  if (window._igsclacMediaFrame) {
    try { window._igsclacMediaFrame.detach(); } catch (e) { }
    window._igsclacMediaFrame = null;
  }

  const frame = wp.media({
    title: (typeof igsclacData !== 'undefined' && igsclacData.mediaTitle) || 'Seleccionar imagen',
    button: { text: (typeof igsclacData !== 'undefined' && igsclacData.mediaButton) || 'Usar esta imagen' },
    multiple: false
  });

  window._igsclacMediaFrame = frame;

  frame.on('select', function () {
    const attachment = frame.state().get('selection').first().toJSON();
    const input = btn.parentNode.querySelector('input[name="imagen"]');
    if (input) input.value = attachment.url;
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

  const acad = await cargarEventos('académico', true);
  const inv = await cargarEventos('investigación', true);

  cachedAcademicEvents = acad;
  cachedResearchEvents = inv;

  // Procesar eventos académicos con paginación
  let sortedAcad = sortEvents(acad, currentAcademicSort);
  sortedAcad = state.filterAdminAcad === 'all' ? sortedAcad : filterEventsByStatus(sortedAcad, state.filterAdminAcad);

  const totalAcad = sortedAcad.length;
  const totalPagesAcad = Math.ceil(totalAcad / PER_PAGE);
  let currentPageAcad = Math.min(state.pageAdminAcad, totalPagesAcad || 1);
  if (currentPageAcad < 1) currentPageAcad = 1;
  state.pageAdminAcad = currentPageAcad;

  const startAcad = (currentPageAcad - 1) * PER_PAGE;
  const paginatedAcad = sortedAcad.slice(startAcad, startAcad + PER_PAGE);

  // Procesar eventos de investigación con paginación
  let sortedInv = sortEvents(inv, currentResearchSort);
  sortedInv = state.filterAdminInv === 'all' ? sortedInv : filterEventsByStatus(sortedInv, state.filterAdminInv);

  const totalInv = sortedInv.length;
  const totalPagesInv = Math.ceil(totalInv / PER_PAGE);
  let currentPageInv = Math.min(state.pageAdminInv, totalPagesInv || 1);
  if (currentPageInv < 1) currentPageInv = 1;
  state.pageAdminInv = currentPageInv;

  const startInv = (currentPageInv - 1) * PER_PAGE;
  const paginatedInv = sortedInv.slice(startInv, startInv + PER_PAGE);

  let totalRegs = 0;
  for (const e of [...acad, ...inv]) {
    const regs = await cargarRegistros(e.id);
    totalRegs += regs.length;
  }

  const acadTableHtml = await adminTable(paginatedAcad, 'acad');
  const invTableHtml = await adminTable(paginatedInv, 'inv');

  const filterButtonsAcad = `
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button class="btn ${state.filterAdminAcad === 'all' ? '' : 'btn-secondary'}" onclick="setAdminEventFilter('acad','all')" style="${state.filterAdminAcad === 'all' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-list"></i> Todos
      </button>
      <button class="btn ${state.filterAdminAcad === 'active' ? '' : 'btn-secondary'}" onclick="setAdminEventFilter('acad','active')" style="${state.filterAdminAcad === 'active' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-circle-check"></i> Activos
      </button>
      <button class="btn ${state.filterAdminAcad === 'past' ? '' : 'btn-secondary'}" onclick="setAdminEventFilter('acad','past')" style="${state.filterAdminAcad === 'past' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-calendar-check"></i> Pasados
      </button>
      <button class="btn ${state.filterAdminAcad === 'drafts' ? '' : 'btn-secondary'}" onclick="setAdminEventFilter('acad','drafts')" style="${state.filterAdminAcad === 'drafts' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-file-pen"></i> Borradores
      </button>
    </div>
  `;

  const filterButtonsInv = `
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button class="btn ${state.filterAdminInv === 'all' ? '' : 'btn-secondary'}" onclick="setAdminEventFilter('inv','all')" style="${state.filterAdminInv === 'all' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-list"></i> Todos
      </button>
      <button class="btn ${state.filterAdminInv === 'active' ? '' : 'btn-secondary'}" onclick="setAdminEventFilter('inv','active')" style="${state.filterAdminInv === 'active' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-circle-check"></i> Activos
      </button>
      <button class="btn ${state.filterAdminInv === 'past' ? '' : 'btn-secondary'}" onclick="setAdminEventFilter('inv','past')" style="${state.filterAdminInv === 'past' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-calendar-check"></i> Pasados
      </button>
      <button class="btn ${state.filterAdminInv === 'drafts' ? '' : 'btn-secondary'}" onclick="setAdminEventFilter('inv','drafts')" style="${state.filterAdminInv === 'drafts' ? '' : 'background:#fff;color:var(--primary);border:2px solid var(--primary)'}">
        <i class="fa-solid fa-file-pen"></i> Borradores
      </button>
    </div>
  `;

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
            <h2><i class="fa-solid fa-book"></i> Eventos académicos (${totalAcad})</h2>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <select id="sort-academic" class="btn btn-secondary btn-sm" style="background:#fff; color:var(--primary); border:1px solid var(--primary);">
                    <option value="date_desc" ${currentAcademicSort === 'date_desc' ? 'selected' : ''}>Fecha ↓ (reciente → antiguo)</option>
                    <option value="date_asc" ${currentAcademicSort === 'date_asc' ? 'selected' : ''}>Fecha ↑ (antiguo → reciente)</option>
                    <option value="type_asc" ${currentAcademicSort === 'type_asc' ? 'selected' : ''}>Tipo (A → Z)</option>
                    <option value="type_desc" ${currentAcademicSort === 'type_desc' ? 'selected' : ''}>Tipo (Z → A)</option>
                </select>
                <button class="btn" onclick="openEventForm('académico')"><i class="fa-solid fa-plus"></i> Nuevo</button>
            </div>
        </div>
        ${filterButtonsAcad}
        <div id="academic-table-container" style="margin-top:16px">${acadTableHtml}</div>
        ${paginationHtml(currentPageAcad, totalPagesAcad, 'admin-acad')}
        
        <div class="section-title" style="margin-top:40px">
            <h2><i class="fa-solid fa-flask"></i> Eventos de investigación (${totalInv})</h2>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <select id="sort-research" class="btn btn-secondary btn-sm" style="background:#fff; color:var(--primary); border:1px solid var(--primary);">
                    <option value="date_desc" ${currentResearchSort === 'date_desc' ? 'selected' : ''}>Fecha ↓ (reciente → antiguo)</option>
                    <option value="date_asc" ${currentResearchSort === 'date_asc' ? 'selected' : ''}>Fecha ↑ (antiguo → reciente)</option>
                    <option value="type_asc" ${currentResearchSort === 'type_asc' ? 'selected' : ''}>Tipo (A → Z)</option>
                    <option value="type_desc" ${currentResearchSort === 'type_desc' ? 'selected' : ''}>Tipo (Z → A)</option>
                </select>
                <button class="btn" onclick="openEventForm('investigación')"><i class="fa-solid fa-plus"></i> Nuevo</button>
            </div>
        </div>
        ${filterButtonsInv}
        <div id="research-table-container" style="margin-top:16px">${invTableHtml}</div>
        ${paginationHtml(currentPageInv, totalPagesInv, 'admin-inv')}
    `;

  const sortAcademicSelect = document.getElementById('sort-academic');
  const sortResearchSelect = document.getElementById('sort-research');

  const updateAcademicTable = async () => {
    currentAcademicSort = sortAcademicSelect.value;
    state.pageAdminAcad = 1; // Resetear a página 1 al cambiar ordenamiento
    const filtered = state.filterAdminAcad === 'all' ? cachedAcademicEvents : filterEventsByStatus(cachedAcademicEvents, state.filterAdminAcad);
    const sorted = sortEvents(filtered, currentAcademicSort);

    const totalPages = Math.ceil(sorted.length / PER_PAGE);
    const start = 0;
    const paginated = sorted.slice(start, start + PER_PAGE);

    const newHtml = await adminTable(paginated, 'acad');
    const paginationHtmlString = paginationHtml(1, totalPages, 'admin-acad');
    const container = document.getElementById('academic-table-container');
    const paginationEl = document.getElementById('pagination-admin-acad');
    if (container) {
      container.innerHTML = newHtml;
      if (paginationEl) {
        paginationEl.outerHTML = paginationHtmlString;
      } else {
        container.insertAdjacentHTML('afterend', paginationHtmlString);
      }
    }
  };

  const updateResearchTable = async () => {
    currentResearchSort = sortResearchSelect.value;
    state.pageAdminInv = 1; // Resetear a página 1 al cambiar ordenamiento
    const filtered = state.filterAdminInv === 'all' ? cachedResearchEvents : filterEventsByStatus(cachedResearchEvents, state.filterAdminInv);
    const sorted = sortEvents(filtered, currentResearchSort);

    const totalPages = Math.ceil(sorted.length / PER_PAGE);
    const start = 0;
    const paginated = sorted.slice(start, start + PER_PAGE);

    const newHtml = await adminTable(paginated, 'inv');
    const paginationHtmlString = paginationHtml(1, totalPages, 'admin-inv');
    const container = document.getElementById('research-table-container');
    const paginationEl = document.getElementById('pagination-admin-inv');
    if (container) {
      container.innerHTML = newHtml;
      if (paginationEl) {
        paginationEl.outerHTML = paginationHtmlString;
      } else {
        container.insertAdjacentHTML('afterend', paginationHtmlString);
      }
    }
  };

  sortAcademicSelect.addEventListener('change', updateAcademicTable);
  sortResearchSelect.addEventListener('change', updateResearchTable);
}

function setAdminEventFilter(context, filterValue) {
  if (context === 'acad') {
    state.filterAdminAcad = filterValue;
    state.pageAdminAcad = 1; // Resetear a página 1 al cambiar filtro
  } else if (context === 'inv') {
    state.filterAdminInv = filterValue;
    state.pageAdminInv = 1; // Resetear a página 1 al cambiar filtro
  }
  render();
}

async function adminTable(list, tipoKey) {
  if (!list.length) return emptyHtml('Aún no hay eventos en esta categoría.');
  let rows = '';
  for (const e of list) {
    const regs = await cargarRegistros(e.id);
    const rCount = regs.length;
    const isPast = isEventPast(e);
    const isRegDisabled = !e.registroHabilitado;
    const totalAsistentes = rCount + (e.asistentes_manuales || 0);
    const canEditManual = isPast && isRegDisabled;

    const registroCell = canEditManual
      ? `<strong>${totalAsistentes}</strong> <button class="btn btn-sm btn-secondary" style="padding:2px 6px;margin-left:6px;" onclick="openEditAsistentes('${e.id}','${tipoKey}',${e.asistentes_manuales || 0})"><i class="fa-solid fa-pen"></i></button>`
      : `<strong>${totalAsistentes}</strong>`;

    rows += `
      <tr>
        <td style="text-align:center">
          <label class="toggle-switch">
            <input type="checkbox" ${e.habilitado ? 'checked' : ''} onchange="toggleEventVisibility(event, '${e.id}','${tipoKey}')">
            <span class="toggle-slider"></span>
          </label>
        </td>
        <td>${esc(e.titulo)}</td>
        <td>${fmtDate(e.fechaInicio)}</td>
        <td style="text-align:center">${esc(e.tipoEvento)}</td>
        <td style="text-align:center">${e.capacidad}</td>
        <td style="text-align:center">${registroCell}</td>
        <td style="text-align:center">${e.registroHabilitado ? '<span style="color:var(--secondary);font-weight:700">Sí</span>' : 'No'}</td>
        <td style="text-align:center">
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
    <thead><tr><th style="width:60px;text-align:center">Habilitado</th><th style="text-align:center">Título</th><th style="text-align:center">Fecha</th><th style="text-align:center">Tipo</th><th style="text-align:center">Capacidad</th><th style="text-align:center">Registros</th><th style="text-align:center">Reg. habilitado</th><th style="text-align:center">Acciones</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

async function openEditAsistentes(id, tipoKey, currentManual) {
  const eventos = tipoKey === 'acad' ? cachedAcademicEvents : cachedResearchEvents;
  const e = eventos.find(x => x.id === id);
  if (!e) { toast('Evento no encontrado', 'error'); return; }

  $('#modal-title').textContent = 'Registrar asistentes manuales · ' + e.titulo;
  $('#modal-body').innerHTML = `
    <p style="margin-bottom:14px;color:var(--text-soft)">Ingresa la cantidad de personas que asistieron al evento.</p>
    <div class="form-group">
      <label>Cantidad de asistentes manuales</label>
      <input type="number" id="edit-asistentes-input" min="0" value="${currentManual}" class="form-control" style="padding:10px;border:1px solid var(--border);border-radius:4px;">
      <small style="color:var(--text-soft);margin-top:8px;display:block;">No puede exceder la capacidad del evento (${e.capacidad})</small>
    </div>
  `;

  $('#modal-footer').innerHTML = `
    <button class="btn" onclick="saveAsistentes('${id}','${tipoKey}')"><i class="fa-solid fa-check"></i> Guardar</button>
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
  `;

  showModal();
}

async function saveAsistentes(id, tipoKey) {
  const input = document.getElementById('edit-asistentes-input');
  const inputValue = input.value.trim();

  // Validación: campo vacío
  if (!inputValue) {
    toast('Por favor ingresa una cantidad', 'error');
    input.focus();
    return;
  }

  const cantidad = parseInt(inputValue, 10);

  // Validación: NaN
  if (isNaN(cantidad)) {
    toast('La cantidad debe ser un número válido', 'error');
    input.focus();
    return;
  }

  // Obtener evento para validar capacidad
  const eventos = tipoKey === 'acad' ? cachedAcademicEvents : cachedResearchEvents;
  const evento = eventos.find(e => e.id === id);

  // Validación: negativo
  if (cantidad < 0) {
    toast('La cantidad no puede ser negativa', 'error');
    input.focus();
    return;
  }

  // Validación: no excede capacidad
  if (evento && cantidad > evento.capacidad) {
    toast(`La cantidad no puede ser mayor a ${evento.capacidad} (capacidad del evento)`, 'error');
    input.focus();
    return;
  }

  try {
    const response = await fetchAPI(`/eventos/${id}/asistentes-manuales`, {
      method: 'POST',
      body: { cantidad }
    });

    if (!response.success) {
      throw new Error('Error al guardar los datos');
    }

    // Actualizar caché local
    if (evento) {
      evento.asistentes_manuales = cantidad;
    }

    toast('✓ Asistentes guardados correctamente');
    closeModal();

    // Refrescar solo la tabla correspondiente
    await actualizarTablaAdmin(tipoKey);
  } catch (err) {
    console.error('Error:', err);
    toast('Error al guardar: ' + (err.message || 'Error desconocido'), 'error');
  }
}

async function actualizarTablaAdmin(tipoKey) {
  try {
    if (tipoKey === 'acad') {
      const filtered = state.filterAdminAcad === 'all' ? cachedAcademicEvents : filterEventsByStatus(cachedAcademicEvents, state.filterAdminAcad);
      const sorted = sortEvents(filtered, currentAcademicSort);
      const totalPages = Math.ceil(sorted.length / PER_PAGE);
      const currentPage = Math.min(state.pageAdminAcad, totalPages || 1);
      const start = (currentPage - 1) * PER_PAGE;
      const paginated = sorted.slice(start, start + PER_PAGE);

      const newHtml = await adminTable(paginated, 'acad');
      const container = document.getElementById('academic-table-container');
      if (container) {
        container.innerHTML = newHtml;
      }
    } else {
      const filtered = state.filterAdminInv === 'all' ? cachedResearchEvents : filterEventsByStatus(cachedResearchEvents, state.filterAdminInv);
      const sorted = sortEvents(filtered, currentResearchSort);
      const totalPages = Math.ceil(sorted.length / PER_PAGE);
      const currentPage = Math.min(state.pageAdminInv, totalPages || 1);
      const start = (currentPage - 1) * PER_PAGE;
      const paginated = sorted.slice(start, start + PER_PAGE);

      const newHtml = await adminTable(paginated, 'inv');
      const container = document.getElementById('research-table-container');
      if (container) {
        container.innerHTML = newHtml;
      }
    }
  } catch (err) {
    console.error('Error al actualizar tabla:', err);
  }
}

async function toggleEventVisibility(event, id, tipoKey) {
  if (state.role !== 'admin') { toast('Solo el administrador puede cambiar la visibilidad', 'error'); return; }

  const newState = event.target.checked;

  // Obtener el evento actual
  const eventos = tipoKey === 'acad' ? cachedAcademicEvents : cachedResearchEvents;
  const evento = eventos.find(e => e.id === id);

  if (!evento) { toast('Evento no encontrado', 'error'); event.target.checked = !newState; return; }

  // Validar: no se puede habilitar un evento antiguo
  if (newState && isEventPast(evento)) {
    toast('No se puede habilitar un evento pasado. Cambia la fecha a una mayor que hoy.', 'error');
    event.target.checked = !newState; // Revertir el estado del checkbox
    return;
  }

  try {
    await fetchAPI(`/eventos/${id}/toggle`, { method: 'POST', body: { habilitado: newState } });
    toast(newState ? 'Evento habilitado' : 'Evento deshabilitado');

    // Refrescar solo los eventos cacheados y regenerar tabla sin render() completo
    const acad = await cargarEventos('académico', true);
    const inv = await cargarEventos('investigación', true);

    cachedAcademicEvents = acad;
    cachedResearchEvents = inv;

    // Regenerar solo la tabla que necesita actualizar (con paginación)
    if (tipoKey === 'acad') {
      let sorted = sortEvents(acad, currentAcademicSort);
      // Aplicar filtro de estado actual
      sorted = state.filterAdminAcad === 'all' ? sorted : filterEventsByStatus(sorted, state.filterAdminAcad);

      const totalPages = Math.ceil(sorted.length / PER_PAGE);
      const currentPage = Math.min(state.pageAdminAcad, totalPages || 1);
      const start = (currentPage - 1) * PER_PAGE;
      const paginated = sorted.slice(start, start + PER_PAGE);

      const newHtml = await adminTable(paginated, 'acad');
      const paginationHtmlString = paginationHtml(currentPage, totalPages, 'admin-acad');
      const container = document.getElementById('academic-table-container');
      const paginationEl = document.getElementById('pagination-admin-acad');
      if (container) {
        container.innerHTML = newHtml;
        if (paginationEl) {
          paginationEl.outerHTML = paginationHtmlString;
        } else {
          container.insertAdjacentHTML('afterend', paginationHtmlString);
        }
      }
    } else {
      let sorted = sortEvents(inv, currentResearchSort);
      // Aplicar filtro de estado actual
      sorted = state.filterAdminInv === 'all' ? sorted : filterEventsByStatus(sorted, state.filterAdminInv);

      const totalPages = Math.ceil(sorted.length / PER_PAGE);
      const currentPage = Math.min(state.pageAdminInv, totalPages || 1);
      const start = (currentPage - 1) * PER_PAGE;
      const paginated = sorted.slice(start, start + PER_PAGE);

      const newHtml = await adminTable(paginated, 'inv');
      const paginationHtmlString = paginationHtml(currentPage, totalPages, 'admin-inv');
      const container = document.getElementById('research-table-container');
      const paginationEl = document.getElementById('pagination-admin-inv');
      if (container) {
        container.innerHTML = newHtml;
        if (paginationEl) {
          paginationEl.outerHTML = paginationHtmlString;
        } else {
          container.insertAdjacentHTML('afterend', paginationHtmlString);
        }
      }
    }
  } catch (err) {
    toast('Error al cambiar visibilidad: ' + err.message, 'error');
    event.target.checked = !newState; // Revertir el estado del checkbox si hay error
  }
}

// ---------- WIDGET PRÓXIMOS  ----------
async function renderUpcoming() {
  const acad = await cargarEventos('académico');
  const inv = await cargarEventos('investigación');
  const all = [...acad, ...inv];
  const now = new Date();

  const upcoming = all
    .filter(e => {
      // Construir fecha y hora de inicio (YYYY-MM-DDTHH:MM:SS)
      const startDateTime = new Date(`${e.fechaInicio}T${e.horaInicio || '00:00'}:00`);
      return startDateTime >= now;
    })
    .sort((a, b) => {
      const startA = new Date(`${a.fechaInicio}T${a.horaInicio || '00:00'}:00`);
      const startB = new Date(`${b.fechaInicio}T${b.horaInicio || '00:00'}:00`);
      return startA - startB;
    })
    .slice(0, 5);

  $('#widget-upcoming').innerHTML = upcoming.length
    ? upcoming.map(e => `
      <li><a href="#" onclick="openEventDetail('${e.id}','${e.tipo === 'académico' ? 'acad' : 'inv'}');return false;">
        <small>${fmtDate(e.fechaInicio)}</small>${esc(e.titulo)}
      </a></li>`).join('')
    : '<li style="color:var(--text-soft)">Sin eventos próximos.</li>';
}

// ---------- MODAL ----------
function showModal() {
  const modalOverlay = $('#modal-overlay');
  modalOverlay.classList.add('show');
  document.body.style.overflow = 'hidden';

  // Reiniciar el scroll del modal a la posición inicial
  const modalEl = modalOverlay.querySelector('.modal');
  if (modalEl) {
    modalEl.scrollTop = 0;
  }
}
function closeModal() { $('#modal-overlay').classList.remove('show'); document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- HERO ACTIONS HANDLER ----------
document.addEventListener('click', async (e) => {
  if (!e.target.classList.contains('slide-cta')) return;
  e.preventDefault();

  const tipoAccion = e.target.dataset.accionTipo;
  const accionValor = e.target.dataset.accionValor;

  if (tipoAccion === 'evento') {
    await showEventDetail(accionValor);
  } else if (tipoAccion === 'evento_pasado') {
    await showPastEventDetail(accionValor);
  } else {
    navigate(accionValor);
  }
}, true);

// ---------- FAB scroll ----------
window.addEventListener('scroll', () => { $('#fab-top').classList.toggle('show', window.scrollY > 400); });

// ---------- INIT ----------
cargarHeroSlides().then(() => {
  buildHero();
  applyRole();
});
render();
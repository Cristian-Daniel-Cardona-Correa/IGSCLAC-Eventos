<?php
/* Main Index Template */
?>

<!DOCTYPE html>
<html lang="es">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IGSCLAC Eventos | Módulo de Eventos Académicos y de Investigación</title>
	<?php wp_head(); ?>
    <meta name="description"
        content="Módulo oficial de eventos IGSCLAC. Consulta eventos académicos y de investigación, regístrate y participa." />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link
        href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Montserrat:wght@400;500;600;700&family=Poppins:wght@300;400;500;600&display=swap"
        rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
</head>

	<body>

    <!-- ============ TOPBAR ============ -->
    <div class="topbar">
        <div class="container topbar-inner">
            <ul class="topbar-menu" role="menubar" aria-label="Accesos rápidos"></ul>
            <form class="topbar-search" role="search" onsubmit="event.preventDefault();handleSearch();">
                <label for="search-input" class="sr-only" style="position:absolute;left:-9999px">Buscar eventos</label>
                <input id="search-input" type="search" placeholder="Buscar eventos por título..."
                    oninput="handleSearch()" />
                <button type="submit" aria-label="Buscar"><i class="fa-solid fa-magnifying-glass"></i></button>
            </form>
        </div>
    </div>

    <!-- ============ HEADER LOGO + ROLE SWITCH ============ -->
    <header class="header-logo">
        <div class="container"
            style="display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;width:100%">
            <a href="#" class="logo" onclick="navigate('home');return false;">
                <img src="https://net-talked-metric-obtained.trycloudflare.com/wp-content/uploads/2026/04/LogoIGSCLAC-1.png" alt="IGSCLAC Logo" style="height:55px; vertical-align:middle;">
					IGSCLAC <span
                    style="color:var(--text);font-weight:700">Eventos</span>
            </a>
            <div class="role-switch" aria-live="polite">
                <i class="fa-solid fa-user-shield"></i>
                Modo: <span class="role-badge" id="role-label">Usuario General</span>
                <button onclick="toggleRole()" id="role-btn">Cambiar a Admin</button>
            </div>
        </div>
    </header>

    <!-- ============ MAIN NAV ============ -->
    <nav class="main-nav" aria-label="Menú principal">
        <div class="container main-nav-inner">
            <button class="hamburger" onclick="document.getElementById('nav-list').classList.toggle('show')"
                aria-label="Abrir menú">
                <i class="fa-solid fa-bars"></i>
            </button>
            <ul class="nav-list" id="nav-list">
                <li><a href="#" onclick="navigate('home');return false;"><i class="fa-solid fa-house"></i> Inicio</a>
                </li>
                <li>
                    <button onclick="toggleDropdown(event)" aria-haspopup="true" aria-expanded="false">
                        <i class="fa-solid fa-calendar-days"></i> Eventos <i class="fa-solid fa-caret-down"
                            style="font-size:10px"></i>
                    </button>
                    <div class="dropdown" role="menu">
                        <a href="#" onclick="navigate('academicos');return false;"><i class="fa-solid fa-book"></i>
                            Académicos</a>
                        <a href="#" onclick="navigate('investigacion');return false;"><i class="fa-solid fa-flask"></i>
                            De Investigación</a>
                    </div>
                </li>
                <li id="nav-admin" style="display:none"><a href="#" onclick="navigate('admin');return false;"><i
                            class="fa-solid fa-gear"></i> Panel Admin</a></li>
                <li><a href="#" onclick="navigate('contacto');return false;"><i class="fa-solid fa-envelope"></i>
                        Contacto</a></li>
            </ul>
        </div>
    </nav>

    <!-- ============ HERO ============ -->
    <section class="hero" id="hero" aria-label="Banner principal">
        <div class="hero-dots" id="hero-dots"></div>
    </section>

    <!-- ============ BREADCRUMBS ============ -->
    <div class="breadcrumbs">
        <div class="container" id="breadcrumbs"></div>
    </div>

    <!-- ============ MAIN ============ -->
    <main class="container">
        <div class="main-layout">
            <section id="content" aria-live="polite"></section>
            <aside class="sidebar" aria-label="Barra lateral">
                <div class="widget">
                    <h3>Próximos eventos</h3>
                    <ul id="widget-upcoming"></ul>
                </div>
                <div class="widget">
                    <h3>Destacado</h3>
                    <img src="https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600"
                        alt="Evento destacado IGSCLAC" />
                    <p style="font-size:13px;margin-top:10px;color:var(--text-soft)">Conoce la programación académica y
                        de investigación de IGSCLAC para este semestre.</p>
                </div>
                <div class="widget">
                    <h3>Categorías</h3>
                    <ul>
                        <li><a href="#" onclick="navigate('academicos');return false;"><i class="fa-solid fa-book"></i>
                                Académicos</a></li>
                        <li><a href="#" onclick="navigate('investigacion');return false;"><i
                                    class="fa-solid fa-flask"></i> Investigación</a></li>
                    </ul>
                </div>
            </aside>
        </div>
    </main>

    <!-- ============ FOOTER ============ -->
    <footer>
        <div class="container">
            <div class="footer-grid">
                <div>
                    <h4><i class="fa-solid fa-location-dot"></i> Ubicación</h4>
                    <p>Unidad Central del Valle del Cauca, Tuluá, Valle del Cauca</p>
                    <p style="margin-top:8px;font-size:13px;color:var(--text-soft)">IGSCLAC — Centro Internacional de Ciencia Verde para Latinoamérica y el Caribe</p>
                </div>
                <div>
                    <h4><i class="fa-solid fa-phone"></i> Contacto</h4>
                    <ul>
                        <li><i class="fa-solid fa-envelope"></i> eventos@igsclac.com</li>
                        <li><i class="fa-solid fa-phone"></i> +57 (2) 224 5555</li>
                        <li><i class="fa-brands fa-whatsapp"></i> +57 300 123 4567</li>
                    </ul>
                    <div class="social">
                        <a href="#" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a>
                        <a href="#" aria-label="Instagram"><i class="fa-brands fa-instagram"></i></a>
                        <a href="#" aria-label="TikTok"><i class="fa-brands fa-tiktok"></i></a>
                        <a href="#" aria-label="X"><i class="fa-brands fa-x-twitter"></i></a>
                        <a href="#" aria-label="LinkedIn"><i class="fa-brands fa-linkedin-in"></i></a>
                        <a href="#" aria-label="YouTube"><i class="fa-brands fa-youtube"></i></a>
                        <a href="mailto:eventos@igsclac.com" aria-label="Gmail"><i class="fa-solid fa-envelope"></i></a>
                    </div>
                </div>
                <div>
                    <h4><i class="fa-solid fa-link"></i> Enlaces rápidos</h4>
                    <ul>
                        <li><a href="#" onclick="navigate('home');return false;">Inicio</a></li>
                        <li><a href="#" onclick="navigate('academicos');return false;">Eventos académicos</a></li>
                        <li><a href="#" onclick="navigate('investigacion');return false;">Eventos de investigación</a>
                        </li>
                        <li><a href="#" onclick="navigate('contacto');return false;">Contacto</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom">
                © 2026 IGSCLAC Eventos · <a href="https://igsclac.com/eventos" target="_blank"
                    rel="noopener">https://igsclac.com/eventos</a>
            </div>
        </div>
    </footer>

    <!-- Floating buttons -->
    <button class="fab fab-top" id="fab-top" onclick="window.scrollTo({top:0,behavior:'smooth'})"
        aria-label="Ir arriba"><i class="fa-solid fa-arrow-up"></i></button>
    <a class="fab fab-wa" href="https://wa.me/573001234567" target="_blank" rel="noopener" aria-label="WhatsApp"><i
            class="fa-brands fa-whatsapp"></i></a>

    <!-- Modals -->
    <div class="modal-overlay" id="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal modal-lg" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div class="modal-header">
                <h3 id="modal-title">Título</h3>
                <button class="modal-close" onclick="closeModal()" aria-label="Cerrar">&times;</button>
            </div>
            <div class="modal-body" id="modal-body"></div>
            <div class="modal-footer" id="modal-footer"></div>
        </div>
    </div>

    <div class="toast" id="toast" role="status" aria-live="polite"></div>
	<?php wp_footer(); ?>
</body>
</html>
<?php

/* =========================================================
   1. ASSETS (CSS + JS)
========================================================= */
function igsclac_assets() {
    
    wp_enqueue_style(
        'igsclac-style',
        get_stylesheet_uri(),
        array(),
        filemtime( get_template_directory() . '/style.css' )
    );

    wp_enqueue_media();

    wp_enqueue_script(
        'eventos-js',
        get_template_directory_uri() . '/eventos.js',
        array('jquery'),
        filemtime( get_template_directory() . '/eventos.js' ),
        true
    );

    // Librerías solo para admin (modo administrador)
    if ( is_user_logged_in() && current_user_can( 'manage_options' ) ) {
        wp_enqueue_script(
            'jspdf',
            'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
            array(),
            null,
            true
        );

        wp_enqueue_script(
            'sheetjs',
            'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
            array(),
            null,
            true
        );

        wp_enqueue_style(
            'select2-css',
            'https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css',
            array(),
            '4.1.0-rc.0'
        );
        wp_enqueue_script(
            'select2-js',
            'https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js',
            array('jquery'),
            '4.1.0-rc.0',
            true
        );
    }

    // Localizar variables
    wp_localize_script('eventos-js', 'wpApiSettings', array(
        'root'  => esc_url_raw(rest_url()),
        'nonce' => wp_create_nonce('wp_rest')
    ));

    wp_localize_script('eventos-js', 'igsclacData', array(
        'canUpload'   => true,
        'mediaTitle'  => 'Seleccionar o subir imagen del evento',
        'mediaButton' => 'Usar esta imagen'
    ));

    wp_localize_script('eventos-js', 'igsclacMediaNonce', array(
        'userLoggedIn' => is_user_logged_in(),
    ));
}
add_action('wp_enqueue_scripts', 'igsclac_assets');

/* ============================================================
   2. CREACIÓN DE TABLAS PERSONALIZADAS (al activar el tema)
============================================================ */
function igsclac_crear_tablas() {
    global $wpdb;
    $charset_collate = $wpdb->get_charset_collate();

    $tabla_eventos = $wpdb->prefix . 'igsclac_eventos';
    $sql_eventos = "CREATE TABLE IF NOT EXISTS $tabla_eventos (
        id VARCHAR(50) NOT NULL,
        tipo VARCHAR(20) NOT NULL COMMENT 'academico|investigacion',
        titulo VARCHAR(255) NOT NULL,
        descripcion TEXT NOT NULL,
        tipo_evento VARCHAR(100) NOT NULL,
        clasificacion VARCHAR(20) NOT NULL COMMENT 'interno|externo',
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL,
        hora_inicio TIME NOT NULL,
        hora_fin TIME NOT NULL,
        comite VARCHAR(255) NOT NULL,
        lugar VARCHAR(255) NOT NULL,
        direccion VARCHAR(255) NOT NULL,
        capacidad INT NOT NULL,
        imagen VARCHAR(500),
        enlace VARCHAR(500),
        registro_habilitado TINYINT(1) DEFAULT 1,
        habilitado TINYINT(1) DEFAULT 1,
        eje_tematico VARCHAR(255) NULL,
        asistentes_manuales INT DEFAULT 0 NOT NULL,
        PRIMARY KEY (id),
        KEY tipo (tipo),
        KEY fecha_inicio (fecha_inicio)
    ) $charset_collate;";

    $tabla_registros = $wpdb->prefix . 'igsclac_registros';
    $sql_registros = "CREATE TABLE IF NOT EXISTS $tabla_registros (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        evento_id VARCHAR(50) NOT NULL,
        nombres VARCHAR(100) NOT NULL,
        apellidos VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        tipo_id VARCHAR(5) NOT NULL COMMENT 'CC,TI,CE,PA,RC',
        identificacion VARCHAR(50) NOT NULL,
        cargo VARCHAR(100) NOT NULL,
        institucion VARCHAR(200) NOT NULL,
        fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY evento_identificacion (evento_id, identificacion),
        UNIQUE KEY evento_email (evento_id, email),
        KEY evento_id (evento_id)
    ) $charset_collate;";

    require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
    dbDelta($sql_eventos);
    dbDelta($sql_registros);
}
add_action('after_switch_theme', 'igsclac_crear_tablas');

/* ============================================================
   2.5 DESHABILITAR EVENTOS ANTIGUOS (mediante CRON)
============================================================ */
function igsclac_programar_cron() {
    if ( ! wp_next_scheduled( 'igsclac_limpiar_eventos_pasados' ) ) {
        wp_schedule_event( time(), 'twicedaily', 'igsclac_limpiar_eventos_pasados' );
    }
}
add_action( 'after_switch_theme', 'igsclac_programar_cron' );

// Cancelar al cambiar de tema
function igsclac_cancelar_cron() {
    wp_clear_scheduled_hook( 'igsclac_limpiar_eventos_pasados' );
}
add_action( 'switch_theme', 'igsclac_cancelar_cron' );

// La función que deshabilita eventos antiguos
function igsclac_deshabilitar_eventos_antiguos() {
    global $wpdb;
    $tabla = $wpdb->prefix . 'igsclac_eventos';
    $updated = $wpdb->query(
        "UPDATE $tabla SET habilitado = 0 
         WHERE CONCAT(fecha_fin, ' ', hora_fin) < NOW() 
         AND habilitado = 1"
    );
    
    if ($updated > 0) {
        igsclac_invalidate_eventos_cache();
    }
}
add_action( 'igsclac_limpiar_eventos_pasados', 'igsclac_deshabilitar_eventos_antiguos' );
add_action( 'wp_loaded', 'igsclac_deshabilitar_eventos_antiguos' );

/* ============================================================
   3. ENDPOINTS REST PARA EVENTOS Y REGISTROS (CON CACHÉ)
============================================================ */
add_action('rest_api_init', function () {
    // Obtener eventos académicos
    register_rest_route('igsclac/v1', '/eventos/academicos', array(
        'methods'             => 'GET',
        'callback'            => 'igsclac_obtener_eventos',
        'permission_callback' => '__return_true',
        'args'                => array(
            'tipo'     => array('default' => 'academico'),
            'page'     => array('default' => 1, 'sanitize_callback' => 'absint'),
            'per_page' => array('default' => 0, 'sanitize_callback' => 'absint'),
        )
    ));
    // Obtener eventos de investigación
    register_rest_route('igsclac/v1', '/eventos/investigacion', array(
        'methods'             => 'GET',
        'callback'            => 'igsclac_obtener_eventos',
        'permission_callback' => '__return_true',
        'args'                => array(
            'tipo'     => array('default' => 'investigacion'),
            'page'     => array('default' => 1, 'sanitize_callback' => 'absint'),
            'per_page' => array('default' => 0, 'sanitize_callback' => 'absint'),
        )
    ));
    // Crear/actualizar evento (solo admin)
    register_rest_route('igsclac/v1', '/eventos/(?P<tipo>academico|investigacion)', array(
        'methods'             => 'POST',
        'callback'            => 'igsclac_guardar_evento',
        'permission_callback' => '__return_true'
    ));
    // Toggle habilitado de evento (solo admin)
    register_rest_route('igsclac/v1', '/eventos/(?P<id>[a-z0-9_]+)/toggle', array(
        'methods'             => 'POST',
        'callback'            => 'igsclac_toggle_evento',
        'permission_callback' => '__return_true'
    ));
    // Eliminar evento (solo admin)
    register_rest_route('igsclac/v1', '/eventos/(?P<id>[a-z0-9_]+)', array(
        'methods'             => 'DELETE',
        'callback'            => 'igsclac_eliminar_evento',
        'permission_callback' => '__return_true'
    ));
    // Obtener registros de un evento
    register_rest_route('igsclac/v1', '/registros/(?P<evento_id>[a-z0-9_]+)', array(
        'methods'             => 'GET',
        'callback'            => 'igsclac_obtener_registros',
        'permission_callback' => '__return_true'
    ));
    // Crear registro de asistente
    register_rest_route('igsclac/v1', '/registros', array(
        'methods'             => 'POST',
        'callback'            => 'igsclac_crear_registro',
        'permission_callback' => '__return_true'
    ));
    // Actualizar asistentes manuales
    register_rest_route('igsclac/v1', '/eventos/(?P<id>[a-z0-9_]+)/asistentes-manuales', array(
        'methods'             => 'POST',
        'callback'            => 'igsclac_actualizar_asistentes_manuales',
        'permission_callback' => '__return_true'
    ));
    // Obtener slides del hero
    register_rest_route('igsclac/v1', '/hero-slides', array(
        'methods'             => 'GET',
        'callback'            => 'igsclac_obtener_hero_slides',
        'permission_callback' => '__return_true'
    ));
    // Guardar slides del hero (solo admin)
    register_rest_route('igsclac/v1', '/hero-slides', array(
        'methods'             => 'POST',
        'callback'            => 'igsclac_guardar_hero_slides',
        'permission_callback' => '__return_true'
    ));
});

// --- Funciones auxiliares de caché ---
function igsclac_get_cached_eventos( $tipo ) {
    // Los administradores siempre ven datos frescos (sin caché)
    if ( is_user_logged_in() && current_user_can( 'manage_options' ) ) {
        global $wpdb;
        $tabla = $wpdb->prefix . 'igsclac_eventos';
        $results = $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM $tabla WHERE tipo = %s ORDER BY fecha_inicio DESC",
            $tipo
        ), ARRAY_A );
        return array_map( function( $e ) {
            return array(
                'id'                 => $e['id'],
                'tipo'               => $e['tipo'] === 'academico' ? 'académico' : 'investigación',
                'titulo'             => $e['titulo'],
                'descripcion'        => $e['descripcion'],
                'tipoEvento'         => $e['tipo_evento'],
                'clasificacion'      => $e['clasificacion'],
                'fechaInicio'        => $e['fecha_inicio'],
                'fechaFin'           => $e['fecha_fin'],
                'horaInicio'         => $e['hora_inicio'],
                'horaFin'            => $e['hora_fin'],
                'comite'             => $e['comite'],
                'lugar'              => $e['lugar'],
                'direccion'          => $e['direccion'],
                'capacidad'          => (int) $e['capacidad'],
                'imagen'             => $e['imagen'],
                'enlace'             => $e['enlace'],
                'registroHabilitado' => (bool) $e['registro_habilitado'],
                'habilitado'         => isset($e['habilitado']) ? (bool) $e['habilitado'] : true,
                'ejeTematico'        => $e['eje_tematico'],
                'asistentes_manuales'=> isset($e['asistentes_manuales']) ? (int) $e['asistentes_manuales'] : 0,
            );
        }, $results );
    }

    // Para usuarios normales, usamos caché (transient)
    $cache_key = 'igsclac_eventos_' . $tipo;
    $eventos = get_transient( $cache_key );
    if ( false === $eventos ) {
        global $wpdb;
        $tabla = $wpdb->prefix . 'igsclac_eventos';
        $results = $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM $tabla WHERE tipo = %s ORDER BY fecha_inicio DESC",
            $tipo
        ), ARRAY_A );
        $eventos = array_map( function( $e ) {
            return array(
                'id'                 => $e['id'],
                'tipo'               => $e['tipo'] === 'academico' ? 'académico' : 'investigación',
                'titulo'             => $e['titulo'],
                'descripcion'        => $e['descripcion'],
                'tipoEvento'         => $e['tipo_evento'],
                'clasificacion'      => $e['clasificacion'],
                'fechaInicio'        => $e['fecha_inicio'],
                'fechaFin'           => $e['fecha_fin'],
                'horaInicio'         => $e['hora_inicio'],
                'horaFin'            => $e['hora_fin'],
                'comite'             => $e['comite'],
                'lugar'              => $e['lugar'],
                'direccion'          => $e['direccion'],
                'capacidad'          => (int) $e['capacidad'],
                'imagen'             => $e['imagen'],
                'enlace'             => $e['enlace'],
                'registroHabilitado' => (bool) $e['registro_habilitado'],
                'habilitado'         => isset($e['habilitado']) ? (bool) $e['habilitado'] : true,
                'ejeTematico'        => $e['eje_tematico'],
                'asistentes_manuales'=> isset($e['asistentes_manuales']) ? (int) $e['asistentes_manuales'] : 0,
            );
        }, $results );
        set_transient( $cache_key, $eventos, 1 * MINUTE_IN_SECONDS );
    }
    return $eventos;
}

function igsclac_invalidate_eventos_cache() {
    delete_transient( 'igsclac_eventos_academico' );
    delete_transient( 'igsclac_eventos_investigacion' );
}

// Callback optimizado con caché
function igsclac_obtener_eventos( $request ) {
    $tipo     = $request->get_param('tipo') === 'academico' ? 'academico' : 'investigacion';
    $page     = max( 1, (int) $request->get_param('page') );
    $per_page = (int) $request->get_param('per_page');
    
    $eventos = igsclac_get_cached_eventos( $tipo );
    $total = count( $eventos );

    if ( $per_page > 0 ) {
        $offset  = ( $page - 1 ) * $per_page;
        $results = array_slice( $eventos, $offset, $per_page );
        $total_pages = (int) ceil( $total / $per_page );
    } else {
        $results     = $eventos;
        $total_pages = 1;
        $page        = 1;
    }

    $response = rest_ensure_response( $results );
    $response->header( 'X-WP-Total',      $total );
    $response->header( 'X-WP-TotalPages', $total_pages );
    $response->header( 'X-WP-Page',       $page );
    $response->header( 'X-WP-PerPage',    $per_page );
    $response->header( 'Access-Control-Expose-Headers',
        'X-WP-Total, X-WP-TotalPages, X-WP-Page, X-WP-PerPage' );
    
    // Si es administrador, desactivamos la caché del navegador
    if ( is_user_logged_in() && current_user_can( 'manage_options' ) ) {
        $response->header( 'Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0' );
        $response->header( 'Pragma', 'no-cache' );
        $response->header( 'Expires', '0' );
    }
    
    return $response;
}

// Guardar evento con invalidación de caché
function igsclac_guardar_evento($request) {
    global $wpdb;
    $tipo = $request->get_param('tipo');
    $data = $request->get_json_params();
    $id = $data['id'] ?? null;
    $tabla = $wpdb->prefix . 'igsclac_eventos';

    $evento = array(
        'id' => $id ?: uniqid('e_'),
        'tipo' => $tipo,
        'titulo' => sanitize_text_field($data['titulo']),
        'descripcion' => sanitize_textarea_field($data['descripcion']),
        'tipo_evento' => sanitize_text_field($data['tipoEvento']),
        'clasificacion' => sanitize_text_field($data['clasificacion']),
        'fecha_inicio' => sanitize_text_field($data['fechaInicio']),
        'fecha_fin' => sanitize_text_field($data['fechaFin']),
        'hora_inicio' => sanitize_text_field($data['horaInicio']),
        'hora_fin' => sanitize_text_field($data['horaFin']),
        'comite' => sanitize_text_field($data['comite']),
        'lugar' => sanitize_text_field($data['lugar']),
        'direccion' => sanitize_text_field($data['direccion']),
        'capacidad' => intval($data['capacidad']),
        'imagen' => esc_url_raw($data['imagen']),
        'enlace' => esc_url_raw($data['enlace']),
        'registro_habilitado' => !empty($data['registroHabilitado']) ? 1 : 0,
        'eje_tematico' => isset($data['ejeTematico']) ? sanitize_text_field($data['ejeTematico']) : null
    );
    if (isset($data['habilitado'])) {
        $habilitado = $data['habilitado'];
        if (is_string($habilitado)) {
            $evento['habilitado'] = ($habilitado === '1' || strtolower($habilitado) === 'true') ? 1 : 0;
        } else {
            $evento['habilitado'] = !empty($habilitado) ? 1 : 0;
        }
    }

    if ($id) {
        $wpdb->update($tabla, $evento, array('id' => $id));
    } else {
        if (!isset($evento['habilitado'])) $evento['habilitado'] = 1;
        $wpdb->insert($tabla, $evento);
    }
    
    igsclac_invalidate_eventos_cache();
    return rest_ensure_response(['success' => true, 'id' => $evento['id']]);
}

function igsclac_eliminar_evento($request) {
    global $wpdb;
    $id = $request->get_param('id');
    $tabla_eventos = $wpdb->prefix . 'igsclac_eventos';
    $tabla_registros = $wpdb->prefix . 'igsclac_registros';
    $wpdb->delete($tabla_eventos, array('id' => $id));
    $wpdb->delete($tabla_registros, array('evento_id' => $id));
    igsclac_invalidate_eventos_cache();
    return rest_ensure_response(['success' => true]);
}

function igsclac_toggle_evento($request) {
    global $wpdb;
    $id = $request->get_param('id');
    $data = $request->get_json_params();
    $tabla = $wpdb->prefix . 'igsclac_eventos';

    if (isset($data['habilitado'])) {
        $habilitado = $data['habilitado'];
        if (is_bool($habilitado)) {
            $new = $habilitado ? 1 : 0;
        } else if (is_string($habilitado)) {
            $new = ($habilitado === 'true' || $habilitado === '1') ? 1 : 0;
        } else {
            $new = (int) $habilitado;
        }
    } else {
        $current = $wpdb->get_var( $wpdb->prepare("SELECT habilitado FROM $tabla WHERE id = %s", $id) );
        $new = $current ? 0 : 1;
    }

    if ($new === 1) {
        $evento = $wpdb->get_row($wpdb->prepare(
            "SELECT fecha_fin, hora_fin FROM $tabla WHERE id = %s",
            $id
        ));
        if ($evento) {
            $end_datetime = $evento->fecha_fin . ' ' . $evento->hora_fin;
            if ($end_datetime < current_time('mysql')) {
                return new WP_Error('evento_antiguo', 'No se puede habilitar un evento pasado', array('status' => 400));
            }
        }
    }

    $wpdb->update($tabla, array('habilitado' => $new), array('id' => $id));
    igsclac_invalidate_eventos_cache();
    return rest_ensure_response(array('success' => true, 'habilitado' => (bool) $new));
}

// Caché para registros (2 minutos)
function igsclac_obtener_registros($request) {
    global $wpdb;
    $evento_id = $request->get_param('evento_id');
    $cache_key = 'igsclac_registros_' . $evento_id;
    $registros = get_transient( $cache_key );
    if ( false === $registros ) {
        $tabla = $wpdb->prefix . 'igsclac_registros';
        $registros = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $tabla WHERE evento_id = %s ORDER BY fecha_registro DESC",
            $evento_id
        ), ARRAY_A );
        set_transient( $cache_key, $registros, 2 * MINUTE_IN_SECONDS );
    }
    return rest_ensure_response($registros);
}

function igsclac_crear_registro($request) {
    global $wpdb;
    $data = $request->get_json_params();
    $tabla_eventos = $wpdb->prefix . 'igsclac_eventos';
    $tabla_registros = $wpdb->prefix . 'igsclac_registros';
    $evento_id = $data['eventoId'];

    $evento = $wpdb->get_row($wpdb->prepare(
        "SELECT capacidad FROM $tabla_eventos WHERE id = %s",
        $evento_id
    ));
    if (!$evento) {
        return new WP_Error('not_found', 'Evento no encontrado', array('status' => 404));
    }
    $registros_actuales = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $tabla_registros WHERE evento_id = %s",
        $evento_id
    ));
    if ($registros_actuales >= $evento->capacidad) {
        return new WP_Error('full', 'Evento lleno', array('status' => 400));
    }

    $email_exists = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $tabla_registros WHERE evento_id = %s AND email = %s",
        $evento_id,
        $data['email']
    ));
    if ($email_exists > 0) {
        return new WP_Error('duplicate_email', 'El correo electrónico ya está registrado para este evento.', array('status' => 400));
    }

    $registro = array(
        'evento_id' => $evento_id,
        'nombres' => sanitize_text_field($data['nombres']),
        'apellidos' => sanitize_text_field($data['apellidos']),
        'email' => sanitize_email($data['email']),
        'tipo_id' => sanitize_text_field($data['tipoId']),
        'identificacion' => sanitize_text_field($data['identificacion']),
        'cargo' => sanitize_text_field($data['cargo']),
        'institucion' => sanitize_text_field($data['institucion']),
        'fecha_registro' => current_time('mysql')
    );
    $wpdb->insert($tabla_registros, $registro);
    
    delete_transient( 'igsclac_registros_' . $evento_id );
    return rest_ensure_response(['success' => true, 'id' => $wpdb->insert_id]);
}

function igsclac_actualizar_asistentes_manuales($request) {
    global $wpdb;
    $id = $request->get_param('id');
    $data = $request->get_json_params();
    $tabla = $wpdb->prefix . 'igsclac_eventos';

    $evento = $wpdb->get_row($wpdb->prepare("SELECT id, capacidad FROM $tabla WHERE id = %s", $id));
    if (!$evento) {
        return new WP_Error('not_found', 'Evento no encontrado', array('status' => 404));
    }

    $cantidad = isset($data['cantidad']) ? intval($data['cantidad']) : 0;
    if ($cantidad < 0) {
        return new WP_Error('invalid_quantity', 'La cantidad no puede ser negativa', array('status' => 400));
    }
    if ($cantidad > $evento->capacidad) {
        return new WP_Error('exceeds_capacity', 'La cantidad no puede ser mayor a la capacidad del evento (' . $evento->capacidad . ')', array('status' => 400));
    }

    $wpdb->query($wpdb->prepare(
        "UPDATE $tabla SET asistentes_manuales = %d WHERE id = %s",
        $cantidad,
        $id
    ));

    igsclac_invalidate_eventos_cache(); // porque cambió asistentes_manuales

    $verificar = $wpdb->get_var($wpdb->prepare(
        "SELECT asistentes_manuales FROM $tabla WHERE id = %s",
        $id
    ));

    return rest_ensure_response(array(
        'success' => true,
        'asistentes_manuales' => (int) $verificar,
        'evento_id' => $id,
        'capacidad' => (int) $evento->capacidad
    ));
}

/* ============================================================
   4. SEMBRAR DATOS INICIALES (si las tablas están vacías)
============================================================ */
function igsclac_sembrar_datos_iniciales() {
    global $wpdb;
    $tabla_eventos = $wpdb->prefix . 'igsclac_eventos';
    $count = $wpdb->get_var("SELECT COUNT(*) FROM $tabla_eventos");
    if ($count == 0) {
        $eventos_ejemplo = array(
            array(
                'id' => 'e_1', 'tipo' => 'academico', 'titulo' => 'Feria Estudiantil de Innovación 2025',
                'descripcion' => 'Encuentro anual donde estudiantes presentan sus proyectos más destacados de innovación y emprendimiento.',
                'tipo_evento' => 'Feria estudiantil', 'clasificacion' => 'interno',
                'fecha_inicio' => '2025-05-15', 'fecha_fin' => '2025-05-15',
                'hora_inicio' => '08:00', 'hora_fin' => '17:00',
                'comite' => 'Decanatura Académica, Bienestar Universitario',
                'lugar' => 'Campus Central IGSCLAC', 'direccion' => 'Calle 10 #5-23, Tuluá',
                'capacidad' => 300, 'imagen' => 'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=800',
                'enlace' => 'https://igsclac.com/feria', 'registro_habilitado' => 1, 'eje_tematico' => null
            ),
            array(
                'id' => 'e_2', 'tipo' => 'academico', 'titulo' => 'Muestra Tecnológica IGSCLAC',
                'descripcion' => 'Tres días de exhibiciones tecnológicas, robótica, IA aplicada y desarrollo de software.',
                'tipo_evento' => 'Muestra tecnológica', 'clasificacion' => 'externo',
                'fecha_inicio' => '2025-06-10', 'fecha_fin' => '2025-06-12',
                'hora_inicio' => '09:00', 'hora_fin' => '18:00',
                'comite' => 'Facultad de Ingeniería, Comité de Tecnología',
                'lugar' => 'Auditorio Principal', 'direccion' => 'Carrera 7 #12-45, Tuluá',
                'capacidad' => 200, 'imagen' => 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800',
                'enlace' => 'https://igsclac.com/muestra-tec', 'registro_habilitado' => 0, 'habilitado' => 1, 'eje_tematico' => null
            ),
            array(
                'id' => 'e_3', 'tipo' => 'investigacion', 'titulo' => 'Conferencia Internacional de Ciencias',
                'descripcion' => 'Conferencia magistral con investigadores de Latinoamérica.',
                'tipo_evento' => 'Conferencia', 'clasificacion' => 'externo',
                'fecha_inicio' => '2025-05-22', 'fecha_fin' => '2025-05-22',
                'hora_inicio' => '14:00', 'hora_fin' => '18:00',
                'comite' => 'Vicerrectoría de Investigación',
                'lugar' => 'Auditorio Mayor', 'direccion' => 'Calle 10 #5-23, Tuluá',
                'capacidad' => 150, 'imagen' => 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=800',
                'enlace' => 'https://facebook.com/igsclac', 'registro_habilitado' => 1, 'habilitado' => 1,
                'eje_tematico' => 'Sostenibilidad y desarrollo regional'
            ),
            array(
                'id' => 'e_4', 'tipo' => 'investigacion', 'titulo' => 'Seminario de Investigación Aplicada',
                'descripcion' => 'Dos días de ponencias y mesas redondas sobre investigación aplicada.',
                'tipo_evento' => 'Seminario', 'clasificacion' => 'interno',
                'fecha_inicio' => '2025-07-05', 'fecha_fin' => '2025-07-06',
                'hora_inicio' => '08:30', 'hora_fin' => '17:30',
                'comite' => 'Centro de Investigaciones IGSCLAC',
                'lugar' => 'Sala de conferencias B', 'direccion' => 'Carrera 7 #12-45, Tuluá',
                'capacidad' => 80, 'imagen' => 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800',
                'enlace' => 'https://instagram.com/igsclac', 'registro_habilitado' => 1, 'habilitado' => 1,
                'eje_tematico' => 'Innovación social y tecnología'
            )
        );
        foreach ($eventos_ejemplo as $evento) {
            $wpdb->insert($tabla_eventos, $evento);
        }
    }
}
add_action('after_switch_theme', 'igsclac_sembrar_datos_iniciales');

/* ============================================================
   5. HERO SLIDER PERSONALIZABLE (con caché)
============================================================ */

function igsclac_obtener_hero_slides_default() {
    return array(
        array(
            'titulo' => 'Bienvenidos a IGSCLAC Eventos',
            'descripcion' => 'Conferencias, ferias, seminarios y mucho más para la comunidad académica.',
            'imagen' => 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=1600',
            'textoBoton' => 'Ver eventos académicos',
            'tipoAccion' => 'navegacion',
            'accion' => 'academicos',
            'overlayActivo' => true
        ),
        array(
            'titulo' => 'Eventos de Investigación',
            'descripcion' => 'Participa en conferencias, foros y coloquios con investigadores destacados.',
            'imagen' => 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=1600',
            'textoBoton' => 'Explorar investigación',
            'tipoAccion' => 'navegacion',
            'accion' => 'investigacion',
            'overlayActivo' => true
        ),
        array(
            'titulo' => 'Inscríbete a nuestros eventos',
            'descripcion' => 'Cupos limitados. Asegura tu lugar y vive la experiencia IGSCLAC.',
            'imagen' => 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1600',
            'textoBoton' => 'Ver agenda completa',
            'tipoAccion' => 'navegacion',
            'accion' => 'home',
            'overlayActivo' => true
        )
    );
}

function igsclac_inicializar_hero_slides() {
    $slides = get_option('igsclac_hero_slides');
    if (!$slides || !is_array($slides)) {
        $default_slides = igsclac_obtener_hero_slides_default();
        update_option('igsclac_hero_slides', $default_slides);
    }
}
add_action('wp_loaded', 'igsclac_inicializar_hero_slides'); // Se ejecuta una vez y luego se cachea

// Con caché para evitar leer option en cada petición
function igsclac_obtener_hero_slides() {
    $cache_key = 'igsclac_hero_slides_cached';
    $slides = get_transient( $cache_key );
    if ( false === $slides ) {
        $slides = get_option('igsclac_hero_slides');
        if (!$slides || !is_array($slides)) {
            $slides = igsclac_obtener_hero_slides_default();
            update_option('igsclac_hero_slides', $slides);
        } else {
            foreach ($slides as &$slide) {
                if (!isset($slide['overlayActivo'])) {
                    $slide['overlayActivo'] = true;
                }
            }
            unset($slide);
        }
        set_transient( $cache_key, $slides, 10 * MINUTE_IN_SECONDS );
    }
    return rest_ensure_response($slides);
}

function igsclac_guardar_hero_slides($request) {
    $data = $request->get_json_params();
    
    if (!isset($data['slides']) || !is_array($data['slides'])) {
        return new WP_Error('invalid_slides', 'Los slides deben ser un array', array('status' => 400));
    }

    $slides = array();
    foreach ($data['slides'] as $slide) {
        $procesado = array(
            'titulo' => sanitize_text_field($slide['titulo'] ?? ''),
            'descripcion' => sanitize_textarea_field($slide['descripcion'] ?? ''),
            'imagen' => esc_url_raw($slide['imagen'] ?? ''),
            'textoBoton' => sanitize_text_field($slide['textoBoton'] ?? ''),
            'tipoAccion' => sanitize_text_field($slide['tipoAccion'] ?? 'navegacion'),
            'accion' => sanitize_text_field($slide['accion'] ?? ''),
            'overlayActivo' => isset($slide['overlayActivo']) ? (bool) $slide['overlayActivo'] : true
        );
        $slides[] = $procesado;
    }

    update_option('igsclac_hero_slides', $slides);
    delete_transient( 'igsclac_hero_slides_cached' );
    return rest_ensure_response(array('success' => true, 'slides' => $slides));
}
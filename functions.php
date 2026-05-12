<?php

/* =========================================================
   1. ASSETS (CSS + JS)
========================================================= */
function igsclac_assets() {

    wp_enqueue_style(
        'igsclac-style',
        get_stylesheet_uri()
    );

    wp_enqueue_media();

    wp_enqueue_script(
        'eventos-js',
        get_template_directory_uri() . '/eventos.js',
        ['jquery'],
        false,
        true
    );

    // Localizar variables para el script
    wp_localize_script('eventos-js', 'wpApiSettings', array(
        'root'  => esc_url_raw(rest_url()),
        'nonce' => wp_create_nonce('wp_rest')
    ));

    wp_localize_script('eventos-js', 'igsclacData', array(
        'canUpload'   => true,
        'mediaTitle'  => 'Seleccionar o subir imagen del evento',
        'mediaButton' => 'Usar esta imagen'
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
   2.5 MIGRACIÓN: Agregar columna habilitado si no existe
============================================================ */
function igsclac_migrar_habilitado() {
    global $wpdb;
    $tabla = $wpdb->prefix . 'igsclac_eventos';
    
    // Verificar si la columna ya existe
    $column_exists = $wpdb->get_results(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_NAME = '$tabla' AND COLUMN_NAME = 'habilitado'"
    );
    
    if (empty($column_exists)) {
        // La columna no existe, crearla
        $wpdb->query("ALTER TABLE $tabla ADD COLUMN habilitado TINYINT(1) DEFAULT 1");
    }
}
add_action('wp_loaded', 'igsclac_migrar_habilitado');

/* ============================================================
   2.6 DESHABILITAR EVENTOS ANTIGUOS AUTOMÁTICAMENTE
============================================================ */
function igsclac_deshabilitar_eventos_antiguos() {
    global $wpdb;
    $tabla = $wpdb->prefix . 'igsclac_eventos';
    $today = date('Y-m-d');
    
    // Actualizar eventos cuya fecha_fin sea menor que hoy y estén habilitados
    $wpdb->query(
        $wpdb->prepare(
            "UPDATE $tabla SET habilitado = 0 WHERE fecha_fin < %s AND habilitado = 1",
            $today
        )
    );
}
add_action('wp_loaded', 'igsclac_deshabilitar_eventos_antiguos');

/* ============================================================
   3. ENDPOINTS REST PARA EVENTOS Y REGISTROS
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
});

function igsclac_obtener_eventos( $request ) {
    global $wpdb;

    $tipo     = $request->get_param('tipo') === 'academico' ? 'academico' : 'investigacion';
    $page     = max( 1, (int) $request->get_param('page') );
    $per_page = (int) $request->get_param('per_page'); // 0 = sin límite
    $tabla    = $wpdb->prefix . 'igsclac_eventos';

    // Total sin paginar (para los headers)
    $total = (int) $wpdb->get_var( $wpdb->prepare(
        "SELECT COUNT(*) FROM $tabla WHERE tipo = %s",
        $tipo
    ));

    if ( $per_page > 0 ) {
        $offset  = ( $page - 1 ) * $per_page;
        $results = $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM $tabla WHERE tipo = %s ORDER BY fecha_inicio DESC LIMIT %d OFFSET %d",
            $tipo, $per_page, $offset
        ), ARRAY_A );
        $total_pages = (int) ceil( $total / $per_page );
    } else {
        $results     = $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM $tabla WHERE tipo = %s ORDER BY fecha_inicio DESC",
            $tipo
        ), ARRAY_A );
        $total_pages = 1;
        $page        = 1;
    }

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
        );
    }, $results );

    $response = rest_ensure_response( $eventos );
    $response->header( 'X-WP-Total',      $total );
    $response->header( 'X-WP-TotalPages', $total_pages );
    $response->header( 'X-WP-Page',       $page );
    $response->header( 'X-WP-PerPage',    $per_page );
    $response->header( 'Access-Control-Expose-Headers',
        'X-WP-Total, X-WP-TotalPages, X-WP-Page, X-WP-PerPage' );

    return $response;
}

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
    // manejar campo 'habilitado' solo si viene en el payload, para no sobrescribir en ediciones
    if (isset($data['habilitado'])) {
        // Convertir correctamente: si es string "1" o "0", o boolean true/false
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
        if (!isset($evento['habilitado'])) $evento['habilitado'] = 1; // default al crear
        $wpdb->insert($tabla, $evento);
    }
    return rest_ensure_response(['success' => true, 'id' => $evento['id']]);
}

function igsclac_eliminar_evento($request) {
    global $wpdb;
    $id = $request->get_param('id');
    $tabla_eventos = $wpdb->prefix . 'igsclac_eventos';
    $tabla_registros = $wpdb->prefix . 'igsclac_registros';
    $wpdb->delete($tabla_eventos, array('id' => $id));
    $wpdb->delete($tabla_registros, array('evento_id' => $id));
    return rest_ensure_response(['success' => true]);
}

function igsclac_toggle_evento($request) {
    global $wpdb;
    $id = $request->get_param('id');
    $data = $request->get_json_params();
    $tabla = $wpdb->prefix . 'igsclac_eventos';

    if (isset($data['habilitado'])) {
        $habilitado = $data['habilitado'];
        // Convertir explícitamente a boolean y luego a int
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

    $wpdb->update($tabla, array('habilitado' => $new), array('id' => $id));
    return rest_ensure_response(array('success' => true, 'habilitado' => (bool) $new));
}

function igsclac_obtener_registros($request) {
    global $wpdb;
    $evento_id = $request->get_param('evento_id');
    $tabla = $wpdb->prefix . 'igsclac_registros';
    $results = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM $tabla WHERE evento_id = %s ORDER BY fecha_registro DESC",
        $evento_id
    ), ARRAY_A);
    return rest_ensure_response($results);
}

function igsclac_crear_registro($request) {
    global $wpdb;
    $data = $request->get_json_params();
    $tabla_eventos = $wpdb->prefix . 'igsclac_eventos';
    $tabla_registros = $wpdb->prefix . 'igsclac_registros';

    $evento = $wpdb->get_row($wpdb->prepare(
        "SELECT capacidad FROM $tabla_eventos WHERE id = %s",
        $data['eventoId']
    ));
    if (!$evento) {
        return new WP_Error('not_found', 'Evento no encontrado', array('status' => 404));
    }
    $registros_actuales = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $tabla_registros WHERE evento_id = %s",
        $data['eventoId']
    ));
    if ($registros_actuales >= $evento->capacidad) {
        return new WP_Error('full', 'Evento lleno', array('status' => 400));
    }

    $email_exists = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $tabla_registros WHERE evento_id = %s AND email = %s",
        $data['eventoId'],
        $data['email']
    ));
    if ($email_exists > 0) {
        return new WP_Error('duplicate_email', 'El correo electrónico ya está registrado para este evento.', array('status' => 400));
    }

    $registro = array(
        'evento_id' => $data['eventoId'],
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
    return rest_ensure_response(['success' => true, 'id' => $wpdb->insert_id]);
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
   5. PERMITIR WP MEDIA UPLOADER SIN SESIÓN DE ADMIN
============================================================ */

add_filter('user_has_cap', function($allcaps, $caps, $args) {
    $needed = ['upload_files', 'delete_posts', 'delete_others_posts', 'edit_posts'];
    $intersect = array_intersect($needed, $caps);
    if (empty($intersect)) {
        return $allcaps;
    }
    if (is_admin() && !wp_doing_ajax()) {
        return $allcaps;
    }
    $referrer = $_SERVER['HTTP_REFERER'] ?? '';
    $site_url = home_url();
    if (!empty($referrer)
        && strpos($referrer, $site_url) === 0
        && strpos($referrer, admin_url()) === false) {
        $allcaps['upload_files']         = true;
        $allcaps['read']                 = true;
        $allcaps['edit_posts']           = true;
        $allcaps['delete_posts']         = true;
        $allcaps['delete_others_posts']  = true;
        $allcaps['edit_others_posts']    = true;
    }
    return $allcaps;
}, 10, 3);

add_action('init', function() {
    if (!wp_doing_ajax()) return;

    $action = $_REQUEST['action'] ?? '';
    $media_actions = [
        'upload-attachment',
        'query-attachments',
        'get-attachment',
        'send-attachment-to-editor',
        'save-attachment',
        'save-attachment-compat',
        'set-post-thumbnail',
        'delete-post',
        'trash-post',
        'untrash-post',
        'igsclac-delete-attachment',
    ];

    if (!in_array($action, $media_actions, true)) return;
    if (is_user_logged_in()) return;

    if (!defined('WP_ADMIN')) define('WP_ADMIN', true);

    require_once ABSPATH . 'wp-admin/includes/admin.php';
    require_once ABSPATH . 'wp-admin/includes/ajax-actions.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';
    require_once ABSPATH . 'wp-admin/includes/post.php';
    require_once ABSPATH . 'wp-admin/includes/taxonomy.php';
    require_once ABSPATH . 'wp-admin/includes/template.php';
    require_once ABSPATH . 'wp-admin/includes/meta-boxes.php';
}, 1);

add_action('wp_enqueue_scripts', function() {
    if (!wp_script_is('eventos-js', 'enqueued')) return;
    wp_localize_script('eventos-js', 'igsclacMediaNonce', array(
        'mediaForm'    => wp_create_nonce('media-form'),
        'deleteNonce'  => wp_create_nonce('igsclac-delete-attachment'),
        'ajaxurl'      => admin_url('admin-ajax.php'),
        'userLoggedIn' => is_user_logged_in(), // true si hay sesion WP activa
    ));
}, 20);

// Forzar nonce_user_logged_out a 0 para que los nonces anonimos sean validos
add_filter('nonce_user_logged_out', function($uid, $action) {
    $bypass = [
        'media-form',
        'save-attachment',
        'save-attachment-compat',
        'igsclac-delete-attachment',
    ];
    if (in_array($action, $bypass, true)) {
        return 0;
    }
    return $uid;
}, 10, 2);

// Subir archivo
add_action('wp_ajax_nopriv_upload-attachment', function() {
    $nonce = $_REQUEST['_wpnonce'] ?? '';
    if (!wp_verify_nonce($nonce, 'media-form')) {
        wp_send_json_error(['message' => 'Nonce inválido'], 403);
    }
    wp_ajax_upload_attachment();
}, 1);

// Listar archivos existentes
add_action('wp_ajax_nopriv_query-attachments', function() {
    wp_ajax_query_attachments();
}, 1);

// Obtener datos de un archivo
add_action('wp_ajax_nopriv_get-attachment', function() {
    wp_ajax_get_attachment();
}, 1);

// Enviar al editor
add_action('wp_ajax_nopriv_send-attachment-to-editor', function() {
    wp_ajax_send_attachment_to_editor();
}, 1);

// Guardar datos de un archivo (titulo, alt, etc.)
add_action('wp_ajax_nopriv_save-attachment', function() {
    wp_ajax_save_attachment();
}, 1);

add_action('wp_ajax_nopriv_save-attachment-compat', function() {
    wp_ajax_save_attachment_compat();
}, 1);

add_action('wp_ajax_nopriv_igsclac-delete-attachment', function() {
    $nonce = $_REQUEST['nonce'] ?? '';
    if (!wp_verify_nonce($nonce, 'igsclac-delete-attachment')) {
        wp_send_json_error(['message' => 'Nonce inválido'], 403);
    }
    $id = intval($_REQUEST['id'] ?? 0);
    if (!$id) {
        wp_send_json_error(['message' => 'ID inválido'], 400);
    }
    $result = wp_delete_attachment($id, true);
    if ($result) {
        wp_send_json_success(['deleted' => $id]);
    } else {
        wp_send_json_error(['message' => 'No se pudo eliminar'], 500);
    }
}, 1);
/**
 * Sistema de Control de Investigadores
 * Backend de Google Apps Script para GitHub Pages + Google Sheets + Google Drive.
 *
 * PASOS PREVIOS:
 * 1. Cree una hoja de cálculo vacía y una carpeta principal en Google Drive.
 * 2. Complete SETTINGS con sus identificadores, dominio de GitHub Pages y administrador inicial.
 * 3. Ejecute setupSystem() una sola vez desde el editor de Apps Script.
 * 4. Implemente como aplicación web: ejecutar como "Yo" y acceso "Cualquier usuario".
 */

const SETTINGS = Object.freeze({
  APP_NAME: 'Control de Investigadores',
  ORGANIZATION: 'Centro de Investigación Sustainability',
  TIMEZONE: 'America/Guayaquil',

  // IDs, no URLs completas.
  SPREADSHEET_ID: 'PEGAR_ID_DE_GOOGLE_SHEETS',
  ROOT_FOLDER_ID: 'PEGAR_ID_DE_CARPETA_DRIVE',

  // Solo orígenes, sin ruta final ni barra. Ejemplo: https://usuario.github.io
  ALLOWED_ORIGINS: ['https://PEGAR_USUARIO.github.io'],

  SESSION_HOURS: 6,
  MAX_FILE_BYTES: 8 * 1024 * 1024,
  PASSWORD_HASH_ROUNDS: 1200,

  // Cambie estos valores antes de ejecutar setupSystem().
  INITIAL_ADMIN: {
    username: 'admin',
    password: 'CAMBIAR_ESTA_CLAVE_123',
    full_name: 'Administrador General',
    email: ''
  }
});

const SHEETS = Object.freeze({
  USERS: 'Usuarios',
  INVESTIGATORS: 'Investigadores',
  PROCESSES: 'Procesos',
  DOCUMENTS: 'Documentos',
  CREDENTIALS: 'Credenciales',
  AUDIT: 'Auditoria',
  SESSIONS: 'Sesiones'
});

const HEADERS = Object.freeze({
  Usuarios: ['id', 'username', 'password_hash', 'salt', 'role', 'investigator_id', 'full_name', 'email', 'active', 'must_change_password', 'created_at', 'updated_at', 'last_login'],
  Investigadores: ['id', 'full_name', 'identification', 'email', 'phone', 'specialty', 'employment_type', 'status', 'drive_folder_id', 'drive_folder_url', 'created_at', 'updated_at'],
  Procesos: ['id', 'client', 'title', 'product', 'indexation', 'journal', 'status', 'priority', 'progress', 'investigator_id', 'contract_number', 'start_date', 'due_date', 'apc_type', 'apc_value', 'apc_status', 'next_action', 'observations', 'drive_folder_id', 'drive_folder_url', 'active', 'created_at', 'updated_at'],
  Documentos: ['id', 'process_id', 'investigator_id', 'file_id', 'file_name', 'mime_type', 'size_bytes', 'folder_id', 'folder_name', 'drive_url', 'version', 'notes', 'uploaded_by', 'created_at', 'active'],
  Credenciales: ['id', 'process_id', 'service', 'url', 'username', 'secret_encrypted', 'notes', 'created_by', 'created_at', 'updated_at', 'active'],
  Auditoria: ['id', 'user_id', 'user_name', 'action', 'entity', 'entity_id', 'detail', 'created_at'],
  Sesiones: ['id', 'token_hash', 'user_id', 'created_at', 'expires_at', 'active']
});

const STANDARD_PROCESS_FOLDERS = Object.freeze([
  '01_Contrato',
  '02_Manuscrito',
  '03_Datos_y_Anexos',
  '04_Correcciones',
  '05_Revista_y_Envio',
  '06_Aceptacion_y_Publicacion',
  '07_Entrega_Final'
]);

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Bridge');
  template.allowedOriginsJson = JSON.stringify(SETTINGS.ALLOWED_ORIGINS);
  template.appName = SETTINGS.APP_NAME;
  template.channel = e && e.parameter && e.parameter.channel ? String(e.parameter.channel) : '';
  return template.evaluate()
    .setTitle(SETTINGS.APP_NAME + ' - Bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Ejecutar una sola vez después de completar SETTINGS. */
function setupSystem() {
  validateSettings_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
    Object.keys(HEADERS).forEach(function (sheetName) {
      ensureSheet_(spreadsheet, sheetName, HEADERS[sheetName]);
    });

    const properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty('CREDENTIAL_MASTER_KEY')) {
      properties.setProperty('CREDENTIAL_MASTER_KEY', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
    }

    DriveApp.getFolderById(SETTINGS.ROOT_FOLDER_ID); // valida acceso

    const users = readObjects_(SHEETS.USERS);
    if (!users.length) {
      validatePassword_(SETTINGS.INITIAL_ADMIN.password);
      const salt = randomSalt_();
      appendObject_(SHEETS.USERS, {
        id: Utilities.getUuid(),
        username: normalizeUsername_(SETTINGS.INITIAL_ADMIN.username),
        password_hash: hashPassword_(SETTINGS.INITIAL_ADMIN.password, salt),
        salt: salt,
        role: 'admin',
        investigator_id: '',
        full_name: SETTINGS.INITIAL_ADMIN.full_name,
        email: SETTINGS.INITIAL_ADMIN.email,
        active: true,
        must_change_password: true,
        created_at: new Date(),
        updated_at: new Date(),
        last_login: ''
      });
    }

    return 'Configuración completada. Despliegue la aplicación web y cambie la contraseña inicial al ingresar.';
  } finally {
    lock.releaseLock();
  }
}

/** Punto único invocado desde Bridge.html. Siempre devuelve un sobre estructurado. */
function bridgeCall(request) {
  try {
    if (!request || !request.action) throwAppError_('BAD_REQUEST', 'La solicitud no contiene una acción válida.');
    const action = String(request.action);
    const payload = request.payload || {};
    const token = request.token || '';

    let result;
    switch (action) {
      case 'login': result = login_(payload); break;
      case 'logout': result = logout_(token); break;
      case 'getSession': result = getSession_(token); break;
      default:
        const session = requireSession_(token);
        result = routeAuthenticated_(action, payload, session);
    }
    return { ok: true, result: result };
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return {
      ok: false,
      error: {
        code: error && error.code ? error.code : 'SERVER_ERROR',
        message: error && error.message ? error.message : 'Error interno del servidor.'
      }
    };
  }
}

function routeAuthenticated_(action, payload, session) {
  switch (action) {
    case 'getDashboard': return getDashboard_(session);
    case 'listProcesses': return listProcesses_(payload, session);
    case 'createProcess': return createProcess_(payload, session);
    case 'updateProcess': return updateProcess_(payload, session);

    case 'listInvestigators': return listInvestigators_(payload, session);
    case 'createInvestigator': return createInvestigator_(payload, session);
    case 'updateInvestigator': return updateInvestigator_(payload, session);

    case 'listUsers': return listUsers_(session);
    case 'getUser': return getUser_(payload, session);
    case 'createUser': return createUser_(payload, session);
    case 'updateUser': return updateUser_(payload, session);
    case 'resetUserPassword': return resetUserPassword_(payload, session);
    case 'changeOwnPassword': return changeOwnPassword_(payload, session);

    case 'listFolderContents': return listFolderContents_(payload, session);
    case 'createFolder': return createFolder_(payload, session);
    case 'renameFolder': return renameFolder_(payload, session);
    case 'deleteFolder': return deleteFolder_(payload, session);
    case 'uploadFile': return uploadFile_(payload, session);
    case 'renameFile': return renameFile_(payload, session);
    case 'deleteFile': return deleteFile_(payload, session);

    case 'listCredentials': return listCredentials_(payload, session);
    case 'getCredential': return getCredential_(payload, session);
    case 'createCredential': return createCredential_(payload, session);
    case 'updateCredential': return updateCredential_(payload, session);
    case 'revealCredential': return revealCredential_(payload, session);
    case 'deleteCredential': return deleteCredential_(payload, session);

    case 'listAudit': return listAudit_(payload, session);
    default: throwAppError_('UNKNOWN_ACTION', 'La acción solicitada no existe.');
  }
}

// -----------------------------------------------------------------------------
// AUTENTICACIÓN Y SESIONES
// -----------------------------------------------------------------------------

function login_(payload) {
  const username = normalizeUsername_(payload.username || '');
  const password = String(payload.password || '');
  if (!username || !password) throwAppError_('INVALID_LOGIN', 'Ingrese usuario y contraseña.');

  checkLoginRateLimit_(username);
  const users = readObjects_(SHEETS.USERS);
  const user = users.find(function (item) { return normalizeUsername_(item.username) === username; });
  if (!user || !toBoolean_(user.active) || !safeEqual_(hashPassword_(password, user.salt), user.password_hash)) {
    registerLoginFailure_(username);
    throwAppError_('INVALID_LOGIN', 'Usuario o contraseña incorrectos.');
  }

  clearLoginFailures_(username);
  cleanupExpiredSessions_();
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const now = new Date();
  const expires = new Date(now.getTime() + SETTINGS.SESSION_HOURS * 60 * 60 * 1000);
  appendObject_(SHEETS.SESSIONS, {
    id: Utilities.getUuid(),
    token_hash: sha256_(token),
    user_id: user.id,
    created_at: now,
    expires_at: expires,
    active: true
  });
  updateObjectById_(SHEETS.USERS, user.id, { last_login: now, updated_at: now });
  audit_(user, 'LOGIN', 'Usuario', user.id, 'Inicio de sesión correcto.');
  return { token: token, user: publicUser_(user) };
}

function logout_(token) {
  if (!token) return { success: true };
  const tokenHash = sha256_(String(token));
  const sessions = readObjects_(SHEETS.SESSIONS);
  const record = sessions.find(function (item) { return item.token_hash === tokenHash && toBoolean_(item.active); });
  if (record) {
    updateObjectById_(SHEETS.SESSIONS, record.id, { active: false });
    const user = findById_(SHEETS.USERS, record.user_id);
    if (user) audit_(user, 'LOGOUT', 'Usuario', user.id, 'Cierre de sesión.');
  }
  return { success: true };
}

function getSession_(token) {
  const session = requireSession_(token);
  return { user: publicUser_(session.user), expires_at: session.session.expires_at };
}

function requireSession_(token) {
  if (!token) throwAppError_('AUTH_REQUIRED', 'La sesión no es válida o ha finalizado.');
  const tokenHash = sha256_(String(token));
  const sessions = readObjects_(SHEETS.SESSIONS);
  const record = sessions.find(function (item) { return item.token_hash === tokenHash && toBoolean_(item.active); });
  if (!record) throwAppError_('AUTH_REQUIRED', 'La sesión no es válida o ha finalizado.');

  const expiresAt = new Date(record.expires_at);
  if (isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    updateObjectById_(SHEETS.SESSIONS, record.id, { active: false });
    throwAppError_('AUTH_REQUIRED', 'La sesión ha caducado. Ingrese nuevamente.');
  }

  const user = findById_(SHEETS.USERS, record.user_id);
  if (!user || !toBoolean_(user.active)) throwAppError_('AUTH_REQUIRED', 'La cuenta está inactiva.');
  return { user: user, session: record };
}

function requireAdmin_(session) {
  if (!session || session.user.role !== 'admin') throwAppError_('FORBIDDEN', 'Esta operación requiere permisos de administrador.');
}

function publicUser_(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    investigator_id: user.investigator_id || '',
    full_name: user.full_name,
    email: user.email || '',
    active: toBoolean_(user.active),
    must_change_password: toBoolean_(user.must_change_password),
    last_login: user.last_login || ''
  };
}

function changeOwnPassword_(payload, session) {
  const current = String(payload.current_password || '');
  const next = String(payload.new_password || '');
  validatePassword_(next);
  const user = findById_(SHEETS.USERS, session.user.id);
  if (!user || !safeEqual_(hashPassword_(current, user.salt), user.password_hash)) {
    throwAppError_('INVALID_PASSWORD', 'La contraseña actual no es correcta.');
  }
  if (safeEqual_(hashPassword_(next, user.salt), user.password_hash)) {
    throwAppError_('INVALID_PASSWORD', 'La nueva contraseña debe ser diferente.');
  }
  const salt = randomSalt_();
  updateObjectById_(SHEETS.USERS, user.id, {
    salt: salt,
    password_hash: hashPassword_(next, salt),
    must_change_password: false,
    updated_at: new Date()
  });
  audit_(user, 'CHANGE_PASSWORD', 'Usuario', user.id, 'El usuario cambió su propia contraseña.');
  return { success: true };
}

function checkLoginRateLimit_(username) {
  const cache = CacheService.getScriptCache();
  const blocked = cache.get('login_block_' + username);
  if (blocked) throwAppError_('RATE_LIMIT', 'Demasiados intentos fallidos. Espere cinco minutos.');
}

function registerLoginFailure_(username) {
  const cache = CacheService.getScriptCache();
  const key = 'login_fail_' + username;
  const count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 300);
  if (count >= 5) cache.put('login_block_' + username, '1', 300);
}

function clearLoginFailures_(username) {
  const cache = CacheService.getScriptCache();
  cache.remove('login_fail_' + username);
  cache.remove('login_block_' + username);
}

function cleanupExpiredSessions_() {
  const sessions = readObjects_(SHEETS.SESSIONS);
  const now = Date.now();
  sessions.forEach(function (item) {
    if (toBoolean_(item.active)) {
      const expires = new Date(item.expires_at).getTime();
      if (!expires || expires <= now) updateObjectById_(SHEETS.SESSIONS, item.id, { active: false });
    }
  });
}

// -----------------------------------------------------------------------------
// PANEL Y PROCESOS
// -----------------------------------------------------------------------------

function getDashboard_(session) {
  const processes = accessibleProcesses_(session, false);
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const active = processes.filter(function (p) { return toBoolean_(p.active); });
  const dueSoon = active.filter(function (p) {
    if (!p.due_date) return false;
    const d = new Date(p.due_date);
    return !isNaN(d.getTime()) && d >= now && d <= sevenDays && !isTerminalStatus_(p.status);
  });
  const overdue = active.filter(function (p) {
    if (!p.due_date) return false;
    const d = new Date(p.due_date);
    return !isNaN(d.getTime()) && d < now && !isTerminalStatus_(p.status);
  });
  const average = active.length ? Math.round(active.reduce(function (sum, p) { return sum + Number(p.progress || 0); }, 0) / active.length) : 0;
  const byStatus = {};
  active.forEach(function (p) { byStatus[p.status || 'Sin estado'] = (byStatus[p.status || 'Sin estado'] || 0) + 1; });

  const priority = active.slice().sort(function (a, b) {
    const aScore = processPriorityScore_(a, now);
    const bScore = processPriorityScore_(b, now);
    return bScore - aScore;
  }).slice(0, 10);

  const audit = readObjects_(SHEETS.AUDIT)
    .filter(function (a) { return session.user.role === 'admin' || a.user_id === session.user.id; })
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
    .slice(0, 8);

  return {
    metrics: {
      active_processes: active.length,
      due_soon: dueSoon.length,
      overdue: overdue.length,
      average_progress: average
    },
    by_status: byStatus,
    priority_processes: enrichProcesses_(priority),
    recent_activity: audit
  };
}

function listProcesses_(payload, session) {
  const includeInactive = toBoolean_(payload.include_inactive);
  const processes = accessibleProcesses_(session, includeInactive);
  return { processes: enrichProcesses_(processes).sort(sortByUpdatedDesc_) };
}

function createProcess_(payload, session) {
  requireAdmin_(session);
  validateRequired_(payload, ['client', 'title']);
  const investigator = payload.investigator_id ? findById_(SHEETS.INVESTIGATORS, payload.investigator_id) : null;
  if (payload.investigator_id && (!investigator || investigator.status === 'Inactivo')) {
    throwAppError_('INVALID_INVESTIGATOR', 'El investigador seleccionado no está disponible.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const id = Utilities.getUuid();
    const root = getRootFolder_();
    let parent = root;
    if (investigator && investigator.drive_folder_id) parent = DriveApp.getFolderById(investigator.drive_folder_id);
    else parent = getOrCreateChildFolder_(root, '_PROCESOS_POR_ASIGNAR');

    const folderName = sanitizeDriveName_('PROC - ' + shortId_(id) + ' - ' + payload.client + ' - ' + payload.title);
    const processFolder = parent.createFolder(folderName);
    STANDARD_PROCESS_FOLDERS.forEach(function (name) { processFolder.createFolder(name); });

    const now = new Date();
    const record = {
      id: id,
      client: cleanText_(payload.client, 180),
      title: cleanText_(payload.title, 300),
      product: cleanText_(payload.product, 100),
      indexation: cleanText_(payload.indexation, 100),
      journal: cleanText_(payload.journal, 180),
      status: cleanText_(payload.status || 'Por asignar', 80),
      priority: cleanText_(payload.priority || 'Media', 40),
      progress: clampNumber_(payload.progress, 0, 100),
      investigator_id: investigator ? investigator.id : '',
      contract_number: cleanText_(payload.contract_number, 100),
      start_date: normalizeDate_(payload.start_date),
      due_date: normalizeDate_(payload.due_date),
      apc_type: cleanText_(payload.apc_type || 'Por confirmar', 60),
      apc_value: nonNegativeNumber_(payload.apc_value),
      apc_status: cleanText_(payload.apc_status || 'No aplica', 60),
      next_action: cleanText_(payload.next_action, 250),
      observations: cleanText_(payload.observations, 5000),
      drive_folder_id: processFolder.getId(),
      drive_folder_url: processFolder.getUrl(),
      active: true,
      created_at: now,
      updated_at: now
    };
    appendObject_(SHEETS.PROCESSES, record);
    audit_(session.user, 'CREATE', 'Proceso', id, 'Proceso creado para ' + record.client + '.');
    return { process: enrichProcesses_([record])[0] };
  } finally {
    lock.releaseLock();
  }
}

function updateProcess_(payload, session) {
  if (!payload.id) throwAppError_('BAD_REQUEST', 'No se indicó el proceso que debe actualizarse.');
  const process = requireProcessAccess_(session, payload.id);
  const changes = {};

  if (session.user.role === 'admin') {
    if (payload.client !== undefined) changes.client = cleanText_(payload.client, 180);
    if (payload.title !== undefined) changes.title = cleanText_(payload.title, 300);
    if (!changes.client && !process.client) throwAppError_('VALIDATION', 'El cliente es obligatorio.');
    if (!changes.title && !process.title) throwAppError_('VALIDATION', 'El título es obligatorio.');

    ['product', 'indexation', 'journal', 'priority', 'contract_number', 'apc_type', 'apc_status'].forEach(function (key) {
      if (payload[key] !== undefined) changes[key] = cleanText_(payload[key], key === 'journal' ? 180 : 100);
    });
    if (payload.start_date !== undefined) changes.start_date = normalizeDate_(payload.start_date);
    if (payload.due_date !== undefined) changes.due_date = normalizeDate_(payload.due_date);
    if (payload.apc_value !== undefined) changes.apc_value = nonNegativeNumber_(payload.apc_value);

    if (payload.investigator_id !== undefined && String(payload.investigator_id || '') !== String(process.investigator_id || '')) {
      const investigator = payload.investigator_id ? findById_(SHEETS.INVESTIGATORS, payload.investigator_id) : null;
      if (payload.investigator_id && !investigator) throwAppError_('INVALID_INVESTIGATOR', 'El investigador seleccionado no existe.');
      changes.investigator_id = investigator ? investigator.id : '';
      moveProcessFolder_(process, investigator);
    }
  }

  ['status', 'next_action', 'observations'].forEach(function (key) {
    if (payload[key] !== undefined) changes[key] = cleanText_(payload[key], key === 'observations' ? 5000 : 250);
  });
  if (payload.progress !== undefined) changes.progress = clampNumber_(payload.progress, 0, 100);
  changes.updated_at = new Date();

  updateObjectById_(SHEETS.PROCESSES, process.id, changes);
  audit_(session.user, 'UPDATE', 'Proceso', process.id, 'Campos actualizados: ' + Object.keys(changes).filter(function (k) { return k !== 'updated_at'; }).join(', ') + '.');
  return { process: enrichProcesses_([Object.assign({}, process, changes)])[0] };
}

function accessibleProcesses_(session, includeInactive) {
  let processes = readObjects_(SHEETS.PROCESSES);
  if (!includeInactive) processes = processes.filter(function (p) { return toBoolean_(p.active); });
  if (session.user.role !== 'admin') {
    if (!session.user.investigator_id) return [];
    processes = processes.filter(function (p) { return String(p.investigator_id) === String(session.user.investigator_id); });
  }
  return processes;
}

function requireProcessAccess_(session, processId) {
  const process = findById_(SHEETS.PROCESSES, processId);
  if (!process || !toBoolean_(process.active)) throwAppError_('NOT_FOUND', 'El proceso no existe o está inactivo.');
  if (session.user.role !== 'admin' && String(process.investigator_id) !== String(session.user.investigator_id || '')) {
    throwAppError_('FORBIDDEN', 'No tiene autorización para acceder a este proceso.');
  }
  return process;
}

function enrichProcesses_(processes) {
  const investigators = readObjects_(SHEETS.INVESTIGATORS);
  const map = {};
  investigators.forEach(function (i) { map[i.id] = i; });
  return processes.map(function (p) {
    const i = map[p.investigator_id] || null;
    return Object.assign({}, p, { investigator_name: i ? i.full_name : '' });
  });
}

function moveProcessFolder_(process, investigator) {
  if (!process.drive_folder_id) return;
  const root = getRootFolder_();
  let destination = root;
  if (investigator && investigator.drive_folder_id) destination = DriveApp.getFolderById(investigator.drive_folder_id);
  else destination = getOrCreateChildFolder_(root, '_PROCESOS_POR_ASIGNAR');
  DriveApp.getFolderById(process.drive_folder_id).moveTo(destination);
}

function isTerminalStatus_(status) {
  const value = normalizeText_(status);
  return ['finalizado', 'publicado', 'aceptado', 'suspendido'].indexOf(value) >= 0;
}

function processPriorityScore_(process, now) {
  let score = 0;
  const priority = normalizeText_(process.priority);
  if (priority === 'urgente') score += 100;
  else if (priority === 'alta') score += 70;
  else if (priority === 'media') score += 35;
  if (process.due_date) {
    const due = new Date(process.due_date);
    if (!isNaN(due.getTime())) {
      const days = Math.floor((due.getTime() - now.getTime()) / 86400000);
      if (days < 0) score += 150 + Math.min(60, Math.abs(days));
      else if (days <= 7) score += 80 - days * 5;
    }
  }
  score += Math.max(0, 30 - Number(process.progress || 0) * 0.3);
  return score;
}

// -----------------------------------------------------------------------------
// INVESTIGADORES
// -----------------------------------------------------------------------------

function listInvestigators_(payload, session) {
  if (session.user.role !== 'admin') {
    const own = session.user.investigator_id ? findById_(SHEETS.INVESTIGATORS, session.user.investigator_id) : null;
    return { investigators: own ? [own] : [] };
  }
  const includeInactive = toBoolean_(payload.include_inactive);
  let items = readObjects_(SHEETS.INVESTIGATORS);
  if (!includeInactive) items = items.filter(function (i) { return normalizeText_(i.status) !== 'inactivo'; });
  items.sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name), 'es'); });
  return { investigators: items };
}

function createInvestigator_(payload, session) {
  requireAdmin_(session);
  validateRequired_(payload, ['full_name']);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const id = Utilities.getUuid();
    const folder = getRootFolder_().createFolder(sanitizeDriveName_('INV - ' + payload.full_name + ' - ' + shortId_(id)));
    const now = new Date();
    const record = {
      id: id,
      full_name: cleanText_(payload.full_name, 180),
      identification: cleanText_(payload.identification, 80),
      email: cleanText_(payload.email, 180),
      phone: cleanText_(payload.phone, 80),
      specialty: cleanText_(payload.specialty, 180),
      employment_type: cleanText_(payload.employment_type, 80),
      status: cleanText_(payload.status || 'Activo', 40),
      drive_folder_id: folder.getId(),
      drive_folder_url: folder.getUrl(),
      created_at: now,
      updated_at: now
    };
    appendObject_(SHEETS.INVESTIGATORS, record);
    audit_(session.user, 'CREATE', 'Investigador', id, 'Investigador creado: ' + record.full_name + '.');
    return { investigator: record };
  } finally {
    lock.releaseLock();
  }
}

function updateInvestigator_(payload, session) {
  requireAdmin_(session);
  if (!payload.id) throwAppError_('BAD_REQUEST', 'No se indicó el investigador.');
  const existing = findById_(SHEETS.INVESTIGATORS, payload.id);
  if (!existing) throwAppError_('NOT_FOUND', 'El investigador no existe.');
  const changes = {};
  ['full_name', 'identification', 'email', 'phone', 'specialty', 'employment_type', 'status'].forEach(function (key) {
    if (payload[key] !== undefined) changes[key] = cleanText_(payload[key], key === 'full_name' || key === 'specialty' ? 180 : 80);
  });
  if (!changes.full_name && !existing.full_name) throwAppError_('VALIDATION', 'El nombre es obligatorio.');
  changes.updated_at = new Date();
  updateObjectById_(SHEETS.INVESTIGATORS, existing.id, changes);
  if (changes.full_name && existing.drive_folder_id) {
    DriveApp.getFolderById(existing.drive_folder_id).setName(sanitizeDriveName_('INV - ' + changes.full_name + ' - ' + shortId_(existing.id)));
  }
  audit_(session.user, 'UPDATE', 'Investigador', existing.id, 'Investigador actualizado.');
  return { investigator: Object.assign({}, existing, changes) };
}

// -----------------------------------------------------------------------------
// USUARIOS
// -----------------------------------------------------------------------------

function listUsers_(session) {
  requireAdmin_(session);
  const users = readObjects_(SHEETS.USERS);
  const investigators = readObjects_(SHEETS.INVESTIGATORS);
  const map = {};
  investigators.forEach(function (i) { map[i.id] = i.full_name; });
  const output = users.map(function (u) {
    const item = publicUser_(u);
    item.investigator_name = map[u.investigator_id] || '';
    return item;
  }).sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name), 'es'); });
  return { users: output };
}

function getUser_(payload, session) {
  requireAdmin_(session);
  const user = findById_(SHEETS.USERS, payload.id);
  if (!user) throwAppError_('NOT_FOUND', 'El usuario no existe.');
  return { user: publicUser_(user) };
}

function createUser_(payload, session) {
  requireAdmin_(session);
  validateRequired_(payload, ['username', 'full_name', 'role', 'password']);
  const username = normalizeUsername_(payload.username);
  if (!/^[a-z0-9._-]{3,80}$/.test(username)) throwAppError_('VALIDATION', 'El usuario solo puede contener letras minúsculas, números, punto, guion y guion bajo.');
  validatePassword_(String(payload.password));
  if (readObjects_(SHEETS.USERS).some(function (u) { return normalizeUsername_(u.username) === username; })) {
    throwAppError_('DUPLICATE', 'El nombre de usuario ya está registrado.');
  }
  const role = payload.role === 'admin' ? 'admin' : 'investigator';
  if (role === 'investigator') {
    if (!payload.investigator_id || !findById_(SHEETS.INVESTIGATORS, payload.investigator_id)) {
      throwAppError_('VALIDATION', 'Debe asociar la cuenta con un investigador válido.');
    }
    const duplicateLink = readObjects_(SHEETS.USERS).some(function (u) { return u.investigator_id === payload.investigator_id && toBoolean_(u.active); });
    if (duplicateLink) throwAppError_('DUPLICATE', 'Ese investigador ya tiene una cuenta activa.');
  }

  const salt = randomSalt_();
  const now = new Date();
  const record = {
    id: Utilities.getUuid(),
    username: username,
    password_hash: hashPassword_(String(payload.password), salt),
    salt: salt,
    role: role,
    investigator_id: role === 'investigator' ? payload.investigator_id : '',
    full_name: cleanText_(payload.full_name, 180),
    email: cleanText_(payload.email, 180),
    active: true,
    must_change_password: true,
    created_at: now,
    updated_at: now,
    last_login: ''
  };
  appendObject_(SHEETS.USERS, record);
  audit_(session.user, 'CREATE', 'Usuario', record.id, 'Cuenta creada para ' + record.username + '.');
  return { user: publicUser_(record) };
}

function updateUser_(payload, session) {
  requireAdmin_(session);
  const existing = findById_(SHEETS.USERS, payload.id);
  if (!existing) throwAppError_('NOT_FOUND', 'El usuario no existe.');
  const username = normalizeUsername_(payload.username || existing.username);
  if (readObjects_(SHEETS.USERS).some(function (u) { return u.id !== existing.id && normalizeUsername_(u.username) === username; })) {
    throwAppError_('DUPLICATE', 'El nombre de usuario ya está registrado.');
  }
  const role = payload.role === 'admin' ? 'admin' : 'investigator';
  if (role === 'investigator' && (!payload.investigator_id || !findById_(SHEETS.INVESTIGATORS, payload.investigator_id))) {
    throwAppError_('VALIDATION', 'Debe asociar la cuenta con un investigador válido.');
  }
  if (existing.id === session.user.id && payload.active === false) throwAppError_('VALIDATION', 'No puede desactivar su propia cuenta.');
  if (existing.id === session.user.id && role !== 'admin') throwAppError_('VALIDATION', 'No puede retirar sus propios permisos de administrador.');

  const changes = {
    username: username,
    full_name: cleanText_(payload.full_name || existing.full_name, 180),
    email: cleanText_(payload.email, 180),
    role: role,
    investigator_id: role === 'investigator' ? payload.investigator_id : '',
    active: payload.active !== false,
    updated_at: new Date()
  };
  updateObjectById_(SHEETS.USERS, existing.id, changes);
  audit_(session.user, 'UPDATE', 'Usuario', existing.id, 'Cuenta de usuario actualizada.');
  return { user: publicUser_(Object.assign({}, existing, changes)) };
}

function resetUserPassword_(payload, session) {
  requireAdmin_(session);
  const user = findById_(SHEETS.USERS, payload.id);
  if (!user) throwAppError_('NOT_FOUND', 'El usuario no existe.');
  validatePassword_(String(payload.password || ''));
  const salt = randomSalt_();
  updateObjectById_(SHEETS.USERS, user.id, {
    salt: salt,
    password_hash: hashPassword_(String(payload.password), salt),
    must_change_password: true,
    updated_at: new Date()
  });
  invalidateUserSessions_(user.id);
  audit_(session.user, 'RESET_PASSWORD', 'Usuario', user.id, 'Contraseña restablecida por un administrador.');
  return { success: true };
}

function invalidateUserSessions_(userId) {
  readObjects_(SHEETS.SESSIONS).forEach(function (s) {
    if (s.user_id === userId && toBoolean_(s.active)) updateObjectById_(SHEETS.SESSIONS, s.id, { active: false });
  });
}

// -----------------------------------------------------------------------------
// DOCUMENTOS Y CARPETAS DE GOOGLE DRIVE
// -----------------------------------------------------------------------------

function listFolderContents_(payload, session) {
  const process = requireProcessAccess_(session, payload.process_id);
  if (!process.drive_folder_id) throwAppError_('DRIVE_ERROR', 'El proceso no tiene una carpeta de Drive asociada.');
  const processFolder = DriveApp.getFolderById(process.drive_folder_id);
  const currentFolderId = payload.folder_id || process.drive_folder_id;
  assertFolderWithinProcess_(currentFolderId, process.drive_folder_id);
  const currentFolder = DriveApp.getFolderById(currentFolderId);

  const folders = [];
  const folderIterator = currentFolder.getFolders();
  while (folderIterator.hasNext()) {
    const folder = folderIterator.next();
    if (!folder.isTrashed()) folders.push(folderInfo_(folder));
  }
  folders.sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });

  const files = [];
  const fileIterator = currentFolder.getFiles();
  while (fileIterator.hasNext()) {
    const file = fileIterator.next();
    if (!file.isTrashed()) files.push(fileInfo_(file));
  }
  files.sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });

  const rootFolders = [];
  const rootIterator = processFolder.getFolders();
  while (rootIterator.hasNext()) {
    const folder = rootIterator.next();
    if (!folder.isTrashed()) rootFolders.push(folderInfo_(folder));
  }
  rootFolders.sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });

  return {
    process: enrichProcesses_([process])[0],
    current_folder: folderInfo_(currentFolder),
    breadcrumbs: buildBreadcrumbs_(currentFolder, processFolder),
    root_folders: rootFolders,
    folders: folders,
    files: files
  };
}

function createFolder_(payload, session) {
  const process = requireProcessAccess_(session, payload.process_id);
  const parentId = payload.parent_folder_id || process.drive_folder_id;
  assertFolderWithinProcess_(parentId, process.drive_folder_id);
  const name = sanitizeDriveName_(cleanText_(payload.name, 120));
  if (!name) throwAppError_('VALIDATION', 'El nombre de la carpeta es obligatorio.');
  const parent = DriveApp.getFolderById(parentId);
  const folder = parent.createFolder(name);
  audit_(session.user, 'CREATE_FOLDER', 'Proceso', process.id, 'Carpeta creada: ' + name + '.');
  return { folder: folderInfo_(folder) };
}

function renameFolder_(payload, session) {
  const process = requireProcessAccess_(session, payload.process_id);
  if (!payload.folder_id || payload.folder_id === process.drive_folder_id) {
    throwAppError_('VALIDATION', 'La carpeta principal del proceso no puede renombrarse desde esta opción.');
  }
  assertFolderWithinProcess_(payload.folder_id, process.drive_folder_id);
  const name = sanitizeDriveName_(cleanText_(payload.name, 120));
  if (!name) throwAppError_('VALIDATION', 'El nombre de la carpeta es obligatorio.');
  const folder = DriveApp.getFolderById(payload.folder_id);
  const previous = folder.getName();
  folder.setName(name);
  audit_(session.user, 'RENAME_FOLDER', 'Proceso', process.id, 'Carpeta renombrada: ' + previous + ' → ' + name + '.');
  return { folder: folderInfo_(folder) };
}

function deleteFolder_(payload, session) {
  requireAdmin_(session);
  const process = requireProcessAccess_(session, payload.process_id);
  if (!payload.folder_id || payload.folder_id === process.drive_folder_id) {
    throwAppError_('VALIDATION', 'La carpeta principal del proceso no puede eliminarse.');
  }
  assertFolderWithinProcess_(payload.folder_id, process.drive_folder_id);
  const folder = DriveApp.getFolderById(payload.folder_id);
  const name = folder.getName();
  folder.setTrashed(true);
  audit_(session.user, 'DELETE_FOLDER', 'Proceso', process.id, 'Carpeta enviada a la papelera: ' + name + '.');
  return { success: true };
}

function uploadFile_(payload, session) {
  const process = requireProcessAccess_(session, payload.process_id);
  const folderId = payload.folder_id || process.drive_folder_id;
  assertFolderWithinProcess_(folderId, process.drive_folder_id);
  const name = sanitizeDriveName_(cleanText_(payload.name, 180));
  if (!name || !payload.base64) throwAppError_('VALIDATION', 'El archivo no contiene nombre o contenido.');
  const declaredSize = Number(payload.size_bytes || 0);
  if (declaredSize > SETTINGS.MAX_FILE_BYTES) throwAppError_('FILE_TOO_LARGE', 'El archivo supera el tamaño máximo permitido.');

  let bytes;
  try {
    bytes = Utilities.base64Decode(String(payload.base64));
  } catch (error) {
    throwAppError_('INVALID_FILE', 'El contenido del archivo no es válido.');
  }
  if (bytes.length > SETTINGS.MAX_FILE_BYTES) throwAppError_('FILE_TOO_LARGE', 'El archivo supera el tamaño máximo permitido.');

  const folder = DriveApp.getFolderById(folderId);
  const blob = Utilities.newBlob(bytes, cleanText_(payload.mime_type, 150) || 'application/octet-stream', name);
  const file = folder.createFile(blob);
  const version = nextDocumentVersion_(process.id, folderId, name);
  const record = {
    id: Utilities.getUuid(),
    process_id: process.id,
    investigator_id: process.investigator_id || '',
    file_id: file.getId(),
    file_name: file.getName(),
    mime_type: file.getMimeType(),
    size_bytes: file.getSize(),
    folder_id: folder.getId(),
    folder_name: folder.getName(),
    drive_url: file.getUrl(),
    version: version,
    notes: cleanText_(payload.notes, 1000),
    uploaded_by: session.user.id,
    created_at: new Date(),
    active: true
  };
  appendObject_(SHEETS.DOCUMENTS, record);
  audit_(session.user, 'UPLOAD_FILE', 'Proceso', process.id, 'Archivo cargado: ' + name + ' (v' + version + ').');
  return { file: fileInfo_(file), document: record };
}

function renameFile_(payload, session) {
  const process = requireProcessAccess_(session, payload.process_id);
  if (!payload.file_id) throwAppError_('BAD_REQUEST', 'No se indicó el archivo.');
  assertFileWithinProcess_(payload.file_id, process.drive_folder_id);
  const name = sanitizeDriveName_(cleanText_(payload.name, 180));
  if (!name) throwAppError_('VALIDATION', 'El nombre del archivo es obligatorio.');
  const file = DriveApp.getFileById(payload.file_id);
  const previous = file.getName();
  file.setName(name);
  const document = readObjects_(SHEETS.DOCUMENTS).find(function (d) { return d.file_id === payload.file_id && toBoolean_(d.active); });
  if (document) updateObjectById_(SHEETS.DOCUMENTS, document.id, { file_name: name, drive_url: file.getUrl() });
  audit_(session.user, 'RENAME_FILE', 'Proceso', process.id, 'Archivo renombrado: ' + previous + ' → ' + name + '.');
  return { file: fileInfo_(file) };
}

function deleteFile_(payload, session) {
  requireAdmin_(session);
  const process = requireProcessAccess_(session, payload.process_id);
  if (!payload.file_id) throwAppError_('BAD_REQUEST', 'No se indicó el archivo.');
  assertFileWithinProcess_(payload.file_id, process.drive_folder_id);
  const file = DriveApp.getFileById(payload.file_id);
  const name = file.getName();
  file.setTrashed(true);
  readObjects_(SHEETS.DOCUMENTS).forEach(function (d) {
    if (d.file_id === payload.file_id && toBoolean_(d.active)) updateObjectById_(SHEETS.DOCUMENTS, d.id, { active: false });
  });
  audit_(session.user, 'DELETE_FILE', 'Proceso', process.id, 'Archivo enviado a la papelera: ' + name + '.');
  return { success: true };
}

function buildBreadcrumbs_(currentFolder, processFolder) {
  const items = [];
  let current = currentFolder;
  let guard = 0;
  while (current && guard < 20) {
    items.unshift(folderInfo_(current));
    if (current.getId() === processFolder.getId()) break;
    const parents = current.getParents();
    if (!parents.hasNext()) break;
    current = parents.next();
    guard++;
  }
  if (!items.length || items[0].id !== processFolder.getId()) return [folderInfo_(processFolder)];
  return items;
}

function assertFolderWithinProcess_(folderId, processFolderId) {
  if (!folderId || !processFolderId) throwAppError_('DRIVE_ERROR', 'La carpeta indicada no es válida.');
  if (folderId === processFolderId) return true;
  let queue = [DriveApp.getFolderById(folderId)];
  const visited = {};
  let guard = 0;
  while (queue.length && guard < 60) {
    const folder = queue.shift();
    if (visited[folder.getId()]) continue;
    visited[folder.getId()] = true;
    const parents = folder.getParents();
    while (parents.hasNext()) {
      const parent = parents.next();
      if (parent.getId() === processFolderId) return true;
      queue.push(parent);
    }
    guard++;
  }
  throwAppError_('FORBIDDEN', 'La carpeta no pertenece al proceso seleccionado.');
}

function assertFileWithinProcess_(fileId, processFolderId) {
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  while (parents.hasNext()) {
    const parent = parents.next();
    try {
      assertFolderWithinProcess_(parent.getId(), processFolderId);
      return true;
    } catch (error) {
      if (error.code !== 'FORBIDDEN') throw error;
    }
  }
  throwAppError_('FORBIDDEN', 'El archivo no pertenece al proceso seleccionado.');
}

function folderInfo_(folder) {
  return {
    id: folder.getId(),
    name: folder.getName(),
    url: folder.getUrl(),
    updated_at: folder.getLastUpdated()
  };
}

function fileInfo_(file) {
  return {
    id: file.getId(),
    name: file.getName(),
    url: file.getUrl(),
    mime_type: file.getMimeType(),
    size_bytes: file.getSize(),
    created_at: file.getDateCreated(),
    updated_at: file.getLastUpdated()
  };
}

function nextDocumentVersion_(processId, folderId, fileName) {
  const matches = readObjects_(SHEETS.DOCUMENTS).filter(function (d) {
    return d.process_id === processId && d.folder_id === folderId && normalizeText_(d.file_name) === normalizeText_(fileName);
  });
  return matches.length + 1;
}

// -----------------------------------------------------------------------------
// CREDENCIALES DE PLATAFORMAS
// -----------------------------------------------------------------------------

function listCredentials_(payload, session) {
  const credentials = readObjects_(SHEETS.CREDENTIALS).filter(function (c) { return toBoolean_(c.active); });
  const accessible = credentials.filter(function (c) {
    try {
      requireProcessAccess_(session, c.process_id);
      return true;
    } catch (error) {
      return false;
    }
  });
  const processes = enrichProcesses_(accessibleProcesses_(session, false));
  const processMap = {};
  processes.forEach(function (p) { processMap[p.id] = p.client + ' — ' + p.title; });
  return {
    credentials: accessible.map(function (c) {
      return {
        id: c.id,
        process_id: c.process_id,
        process_name: processMap[c.process_id] || '',
        service: c.service,
        url: c.url,
        username: c.username,
        masked_secret: '••••••••',
        notes: c.notes,
        created_at: c.created_at,
        updated_at: c.updated_at
      };
    }).sort(sortByUpdatedDesc_)
  };
}

function getCredential_(payload, session) {
  const credential = requireCredentialAccess_(session, payload.id);
  return {
    credential: {
      id: credential.id,
      process_id: credential.process_id,
      service: credential.service,
      url: credential.url,
      username: credential.username,
      notes: credential.notes
    }
  };
}

function createCredential_(payload, session) {
  validateRequired_(payload, ['process_id', 'service', 'secret']);
  const process = requireProcessAccess_(session, payload.process_id);
  const now = new Date();
  const record = {
    id: Utilities.getUuid(),
    process_id: process.id,
    service: cleanText_(payload.service, 180),
    url: cleanUrl_(payload.url),
    username: cleanText_(payload.username, 250),
    secret_encrypted: encryptSecret_(String(payload.secret)),
    notes: cleanText_(payload.notes, 1500),
    created_by: session.user.id,
    created_at: now,
    updated_at: now,
    active: true
  };
  appendObject_(SHEETS.CREDENTIALS, record);
  audit_(session.user, 'CREATE_CREDENTIAL', 'Proceso', process.id, 'Credencial creada para ' + record.service + '.');
  return { success: true };
}

function updateCredential_(payload, session) {
  const existing = requireCredentialAccess_(session, payload.id);
  const changes = {
    process_id: payload.process_id || existing.process_id,
    service: cleanText_(payload.service || existing.service, 180),
    url: cleanUrl_(payload.url),
    username: cleanText_(payload.username, 250),
    notes: cleanText_(payload.notes, 1500),
    updated_at: new Date()
  };
  requireProcessAccess_(session, changes.process_id);
  if (payload.secret) changes.secret_encrypted = encryptSecret_(String(payload.secret));
  updateObjectById_(SHEETS.CREDENTIALS, existing.id, changes);
  audit_(session.user, 'UPDATE_CREDENTIAL', 'Proceso', changes.process_id, 'Credencial actualizada: ' + changes.service + '.');
  return { success: true };
}

function revealCredential_(payload, session) {
  const credential = requireCredentialAccess_(session, payload.id);
  const secret = decryptSecret_(credential.secret_encrypted);
  audit_(session.user, 'REVEAL_CREDENTIAL', 'Proceso', credential.process_id, 'Se reveló la credencial de ' + credential.service + '.');
  return {
    credential: {
      id: credential.id,
      service: credential.service,
      url: credential.url,
      username: credential.username,
      secret: secret
    }
  };
}

function deleteCredential_(payload, session) {
  requireAdmin_(session);
  const credential = requireCredentialAccess_(session, payload.id);
  updateObjectById_(SHEETS.CREDENTIALS, credential.id, { active: false, updated_at: new Date() });
  audit_(session.user, 'DELETE_CREDENTIAL', 'Proceso', credential.process_id, 'Credencial eliminada: ' + credential.service + '.');
  return { success: true };
}

function requireCredentialAccess_(session, credentialId) {
  const credential = findById_(SHEETS.CREDENTIALS, credentialId);
  if (!credential || !toBoolean_(credential.active)) throwAppError_('NOT_FOUND', 'La credencial no existe.');
  requireProcessAccess_(session, credential.process_id);
  return credential;
}

/**
 * Cifrado autenticado basado en flujo HMAC con claves derivadas.
 * La clave maestra permanece en Script Properties y nunca llega al navegador ni a Sheets.
 */
function encryptSecret_(plainText) {
  const master = getCredentialMasterKey_();
  const encKey = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('enc-key', master));
  const macKey = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('mac-key', master));
  const nonce = Utilities.getUuid().replace(/-/g, '');
  const plainBytes = Utilities.newBlob(String(plainText)).getBytes();
  const cipherBytes = xorWithHmacStream_(plainBytes, nonce, encKey);
  const cipher = Utilities.base64EncodeWebSafe(cipherBytes);
  const mac = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(nonce + '.' + cipher, macKey));
  return ['v1', nonce, cipher, mac].join(':');
}

function decryptSecret_(encoded) {
  const parts = String(encoded || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throwAppError_('DECRYPT_ERROR', 'La credencial almacenada no tiene un formato válido.');
  const master = getCredentialMasterKey_();
  const encKey = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('enc-key', master));
  const macKey = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('mac-key', master));
  const nonce = parts[1];
  const cipher = parts[2];
  const expectedMac = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(nonce + '.' + cipher, macKey));
  if (!safeEqual_(expectedMac, parts[3])) throwAppError_('DECRYPT_ERROR', 'La credencial no superó la validación de integridad.');
  const cipherBytes = Utilities.base64DecodeWebSafe(cipher);
  const plainBytes = xorWithHmacStream_(cipherBytes, nonce, encKey);
  return Utilities.newBlob(plainBytes).getDataAsString('UTF-8');
}

function xorWithHmacStream_(inputBytes, nonce, key) {
  const output = [];
  let counter = 0;
  let offset = 0;
  while (offset < inputBytes.length) {
    const block = Utilities.computeHmacSha256Signature(nonce + ':' + counter, key);
    for (let i = 0; i < block.length && offset < inputBytes.length; i++, offset++) {
      const input = inputBytes[offset] < 0 ? inputBytes[offset] + 256 : inputBytes[offset];
      const stream = block[i] < 0 ? block[i] + 256 : block[i];
      const value = input ^ stream;
      output.push(value > 127 ? value - 256 : value);
    }
    counter++;
  }
  return output;
}

function getCredentialMasterKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('CREDENTIAL_MASTER_KEY');
  if (!key) throwAppError_('CONFIG_ERROR', 'No existe la clave maestra. Ejecute setupSystem().');
  return key;
}

// -----------------------------------------------------------------------------
// AUDITORÍA
// -----------------------------------------------------------------------------

function listAudit_(payload, session) {
  requireAdmin_(session);
  const limit = Math.min(1000, Math.max(1, Number(payload.limit || 300)));
  const audit = readObjects_(SHEETS.AUDIT)
    .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
    .slice(0, limit);
  return { audit: audit };
}

function audit_(user, action, entity, entityId, detail) {
  try {
    appendObject_(SHEETS.AUDIT, {
      id: Utilities.getUuid(),
      user_id: user.id || '',
      user_name: user.full_name || user.username || 'Sistema',
      action: action,
      entity: entity,
      entity_id: entityId || '',
      detail: cleanText_(detail, 1500),
      created_at: new Date()
    });
  } catch (error) {
    console.error('No se pudo escribir auditoría: ' + error.message);
  }
}

// -----------------------------------------------------------------------------
// UTILIDADES DE DATOS, SEGURIDAD Y VALIDACIÓN
// -----------------------------------------------------------------------------

function getSpreadsheet_() {
  validateSettings_();
  return SpreadsheetApp.openById(SETTINGS.SPREADSHEET_ID);
}

function getSheet_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throwAppError_('CONFIG_ERROR', 'No existe la hoja “' + sheetName + '”. Ejecute setupSystem().');
  return sheet;
}

function ensureSheet_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function readObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(function (row) { return row.some(function (value) { return value !== ''; }); }).map(function (row) {
    const item = {};
    headers.forEach(function (header, index) {
      item[header] = serializeValue_(row[index]);
    });
    return item;
  });
}

function appendObject_(sheetName, object) {
  const sheet = getSheet_(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const row = headers.map(function (header) { return object[header] !== undefined ? object[header] : ''; });
  sheet.appendRow(row);
  return object;
}

function updateObjectById_(sheetName, id, changes) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (!values.length) throwAppError_('CONFIG_ERROR', 'La hoja “' + sheetName + '” está vacía.');
  const headers = values[0].map(String);
  const idColumn = headers.indexOf('id');
  if (idColumn < 0) throwAppError_('CONFIG_ERROR', 'La hoja “' + sheetName + '” no tiene columna id.');
  let rowIndex = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idColumn]) === String(id)) { rowIndex = i + 1; break; }
  }
  if (rowIndex < 0) throwAppError_('NOT_FOUND', 'No se encontró el registro solicitado en “' + sheetName + '”.');
  Object.keys(changes).forEach(function (key) {
    const col = headers.indexOf(key);
    if (col >= 0) sheet.getRange(rowIndex, col + 1).setValue(changes[key]);
  });
  return true;
}

function findById_(sheetName, id) {
  if (!id) return null;
  return readObjects_(sheetName).find(function (item) { return String(item.id) === String(id); }) || null;
}

function serializeValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.toISOString();
  return value;
}

function validateSettings_() {
  if (!SETTINGS.SPREADSHEET_ID || SETTINGS.SPREADSHEET_ID.indexOf('PEGAR_') >= 0) {
    throwAppError_('CONFIG_ERROR', 'Configure SETTINGS.SPREADSHEET_ID en Code.gs.');
  }
  if (!SETTINGS.ROOT_FOLDER_ID || SETTINGS.ROOT_FOLDER_ID.indexOf('PEGAR_') >= 0) {
    throwAppError_('CONFIG_ERROR', 'Configure SETTINGS.ROOT_FOLDER_ID en Code.gs.');
  }
  if (!SETTINGS.ALLOWED_ORIGINS.length || SETTINGS.ALLOWED_ORIGINS.some(function (origin) { return origin.indexOf('PEGAR_') >= 0; })) {
    throwAppError_('CONFIG_ERROR', 'Configure SETTINGS.ALLOWED_ORIGINS con el dominio de GitHub Pages.');
  }
}

function getRootFolder_() {
  validateSettings_();
  return DriveApp.getFolderById(SETTINGS.ROOT_FOLDER_ID);
}

function getOrCreateChildFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  if (matches.hasNext()) return matches.next();
  return parent.createFolder(name);
}

function validateRequired_(payload, keys) {
  keys.forEach(function (key) {
    if (payload[key] === undefined || payload[key] === null || String(payload[key]).trim() === '') {
      throwAppError_('VALIDATION', 'El campo “' + key + '” es obligatorio.');
    }
  });
}

function cleanText_(value, maxLength) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function sanitizeDriveName_(value) {
  return cleanText_(value, 180).replace(/[\\/:*?"<>|#%{}]/g, '-').replace(/\s+/g, ' ').trim();
}

function cleanUrl_(value) {
  const url = cleanText_(value, 500);
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) throwAppError_('VALIDATION', 'La URL debe comenzar con http:// o https://.');
  return url;
}

function normalizeUsername_(value) {
  return normalizeText_(value).replace(/\s+/g, '');
}

function normalizeText_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeDate_(value) {
  if (!value) return '';
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throwAppError_('VALIDATION', 'La fecha “' + value + '” no es válida.');
  return text;
}

function clampNumber_(value, min, max) {
  const number = Number(value || 0);
  if (!isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function nonNegativeNumber_(value) {
  const number = Number(value || 0);
  return isFinite(number) && number >= 0 ? number : 0;
}

function toBoolean_(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', '1', 'si', 'sí', 'yes', 'activo'].indexOf(normalizeText_(value)) >= 0;
}

function shortId_(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

function sortByUpdatedDesc_(a, b) {
  const aDate = new Date(a.updated_at || a.created_at || 0).getTime() || 0;
  const bDate = new Date(b.updated_at || b.created_at || 0).getTime() || 0;
  return bDate - aDate;
}

function randomSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function validatePassword_(password) {
  const value = String(password || '');
  if (value.length < 8) throwAppError_('WEAK_PASSWORD', 'La contraseña debe tener al menos 8 caracteres.');
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(value) || !/\d/.test(value)) {
    throwAppError_('WEAK_PASSWORD', 'La contraseña debe incluir al menos una letra y un número.');
  }
  if (value.length > 128) throwAppError_('WEAK_PASSWORD', 'La contraseña no puede superar 128 caracteres.');
}

function hashPassword_(password, salt) {
  let current = String(salt) + '|' + String(password);
  for (let i = 0; i < SETTINGS.PASSWORD_HASH_ROUNDS; i++) {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, current, Utilities.Charset.UTF_8);
    current = Utilities.base64EncodeWebSafe(digest) + '|' + salt;
  }
  return current.split('|')[0];
}

function sha256_(value) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
  );
}

function safeEqual_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left.charCodeAt(i % Math.max(1, left.length)) || 0) ^ (right.charCodeAt(i % Math.max(1, right.length)) || 0);
  return diff === 0;
}

function throwAppError_(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

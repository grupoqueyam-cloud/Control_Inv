(function () {
  'use strict';

  const config = window.APP_CONFIG;
  const API = window.BackendAPI;

  const state = {
    session: null,
    currentView: 'dashboard',
    processes: [],
    investigators: [],
    selectedProcessId: '',
    selectedFolderId: '',
    folderData: null,
    filters: {
      processSearch: '',
      processStatus: '',
      processInvestigator: '',
      credentialSearch: ''
    }
  };

  const els = {};

  document.addEventListener('DOMContentLoaded', bootstrap);

  async function bootstrap() {
    cacheElements();
    applyBranding();
    bindGlobalEvents();

    if (!API.configured()) {
      showScreen('setup');
      return;
    }

    showScreen('loading');
    try {
      await API.init();
      const saved = loadStoredSession();
      if (saved && saved.token) {
        try {
          const result = await API.call('getSession', {}, saved.token);
          if (result && result.user) {
            state.session = { token: saved.token, user: result.user };
            showApp();
            await loadView('dashboard');
            return;
          }
        } catch (error) {
          clearStoredSession();
        }
      }
      showScreen('login');
    } catch (error) {
      showScreen('setup');
      toast('error', 'No se pudo conectar', error.message);
    }
  }

  function cacheElements() {
    Object.assign(els, {
      setupScreen: document.getElementById('setup-screen'),
      loadingScreen: document.getElementById('loading-screen'),
      loginScreen: document.getElementById('login-screen'),
      appShell: document.getElementById('app-shell'),
      loginForm: document.getElementById('login-form'),
      loginButton: document.getElementById('login-button'),
      nav: document.getElementById('main-nav'),
      viewContainer: document.getElementById('view-container'),
      viewTitle: document.getElementById('view-title'),
      viewSubtitle: document.getElementById('view-subtitle'),
      primaryAction: document.getElementById('primary-action-button'),
      refreshButton: document.getElementById('refresh-button'),
      logoutButton: document.getElementById('logout-button'),
      modalRoot: document.getElementById('modal-root'),
      sidebar: document.getElementById('sidebar'),
      sidebarToggle: document.getElementById('sidebar-toggle')
    });
  }

  function applyBranding() {
    document.title = config.APP_NAME;
    ['app-name', 'login-app-name'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = config.APP_NAME;
    });
    ['organization-name', 'login-organization'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = config.ORGANIZATION;
    });
  }

  function bindGlobalEvents() {
    els.loginForm.addEventListener('submit', handleLogin);
    els.logoutButton.addEventListener('click', logout);
    els.refreshButton.addEventListener('click', () => loadView(state.currentView, true));
    els.primaryAction.addEventListener('click', handlePrimaryAction);
    els.sidebarToggle.addEventListener('click', () => els.sidebar.classList.toggle('open'));

    els.nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      els.sidebar.classList.remove('open');
      loadView(button.dataset.view);
    });

    els.viewContainer.addEventListener('click', handleViewClick);
    els.viewContainer.addEventListener('change', handleViewChange);
    els.viewContainer.addEventListener('input', debounce(handleViewInput, 220));

    document.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-password]');
      if (!toggle) return;
      const input = document.getElementById(toggle.dataset.togglePassword);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    });

    els.modalRoot.addEventListener('click', (event) => {
      if (event.target.matches('[data-close-modal], .modal-backdrop')) closeModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    setButtonLoading(els.loginButton, true, 'Validando...');

    try {
      const result = await API.call('login', { username, password });
      state.session = { token: result.token, user: result.user };
      storeSession(state.session);
      document.getElementById('login-password').value = '';
      showApp();
      toast('success', 'Acceso correcto', `Bienvenido, ${result.user.full_name}.`);
      await loadView('dashboard');
      if (result.user.must_change_password) openChangePasswordModal(true);
    } catch (error) {
      toast('error', 'No se pudo iniciar sesión', error.message);
    } finally {
      setButtonLoading(els.loginButton, false, 'Ingresar');
    }
  }

  async function logout() {
    const token = state.session && state.session.token;
    clearStoredSession();
    state.session = null;
    state.processes = [];
    state.investigators = [];
    showScreen('login');
    if (token) {
      try { await API.call('logout', {}, token); } catch (error) { /* sesión local ya cerrada */ }
    }
  }

  function showScreen(name) {
    els.setupScreen.classList.toggle('hidden', name !== 'setup');
    els.loadingScreen.classList.toggle('hidden', name !== 'loading');
    els.loginScreen.classList.toggle('hidden', name !== 'login');
    els.appShell.classList.toggle('hidden', name !== 'app');
  }

  function showApp() {
    showScreen('app');
    const user = state.session.user;
    document.getElementById('sidebar-user-name').textContent = user.full_name;
    document.getElementById('sidebar-user-role').textContent = user.role === 'admin' ? 'Administrador' : 'Investigador';
    document.getElementById('user-avatar').textContent = initials(user.full_name);
    document.body.classList.toggle('role-admin', user.role === 'admin');
    document.querySelectorAll('.admin-only').forEach((el) => {
      el.classList.toggle('hidden', user.role !== 'admin');
    });
  }

  async function serverCall(action, payload = {}) {
    if (!state.session) throw new Error('No existe una sesión activa.');
    try {
      return await API.call(action, payload, state.session.token);
    } catch (error) {
      if (error.code === 'AUTH_REQUIRED' || /sesión|session/i.test(error.message)) {
        toast('error', 'Sesión finalizada', 'Ingrese nuevamente para continuar.');
        await logout();
      }
      throw error;
    }
  }

  async function loadView(view, force = false) {
    if (!state.session) return;
    if (state.session.user.role !== 'admin' && ['users', 'investigators', 'audit'].includes(view)) view = 'dashboard';

    state.currentView = view;
    setActiveNav(view);
    setViewHeader(view);
    renderLoading();

    try {
      switch (view) {
        case 'dashboard': await loadDashboard(); break;
        case 'processes': await loadProcesses(force); break;
        case 'documents': await loadDocuments(force); break;
        case 'credentials': await loadCredentials(); break;
        case 'investigators': await loadInvestigatorsView(force); break;
        case 'users': await loadUsers(); break;
        case 'audit': await loadAudit(); break;
        default: await loadDashboard();
      }
    } catch (error) {
      renderError(error);
    }
  }

  function setActiveNav(view) {
    els.nav.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  }

  function setViewHeader(view) {
    const admin = isAdmin();
    const configByView = {
      dashboard: ['Panel general', 'Resumen actualizado de los procesos, estados y actividades.', admin ? 'Nuevo proceso' : 'Actualizar progreso'],
      processes: ['Procesos', admin ? 'Administre asignaciones, plazos, revistas y avance.' : 'Consulte y actualice únicamente sus procesos.', admin ? 'Nuevo proceso' : 'Actualizar proceso'],
      documents: ['Documentos', 'Carpetas y archivos vinculados con Google Drive.', 'Subir archivo'],
      credentials: ['Credenciales', 'Accesos autorizados para revistas, plataformas y servicios.', 'Nueva credencial'],
      investigators: ['Investigadores', 'Directorio, especialidades, estado y carpeta principal.', 'Nuevo investigador'],
      users: ['Usuarios', 'Cuentas de acceso, roles y asociación con investigadores.', 'Nuevo usuario'],
      audit: ['Auditoría', 'Trazabilidad de accesos y cambios realizados en el sistema.', '']
    };
    const current = configByView[view] || configByView.dashboard;
    els.viewTitle.textContent = current[0];
    els.viewSubtitle.textContent = current[1];
    els.primaryAction.textContent = current[2];
    els.primaryAction.classList.toggle('hidden', !current[2] || (view === 'dashboard' && !admin));
    if (!admin && ['dashboard'].includes(view)) els.primaryAction.classList.add('hidden');
  }

  function renderLoading() {
    els.viewContainer.innerHTML = `
      <div class="metrics-grid">
        ${Array.from({ length: 4 }, () => '<div class="skeleton" style="height:126px"></div>').join('')}
      </div>
      <div class="skeleton" style="height:430px"></div>`;
  }

  function renderError(error) {
    els.viewContainer.innerHTML = `
      <div class="card"><div class="empty-state">
        <div class="empty-icon">!</div><h3>No fue posible cargar esta sección</h3>
        <p>${escapeHtml(error.message)}</p>
        <button class="button primary" data-action="retry-view">Intentar nuevamente</button>
      </div></div>`;
  }

  async function loadDashboard() {
    const data = await serverCall('getDashboard');
    const metrics = data.metrics || {};
    const statusRows = Object.entries(data.by_status || {}).sort((a, b) => b[1] - a[1]);
    const recent = data.recent_activity || [];
    const processes = data.priority_processes || [];

    els.viewContainer.innerHTML = `
      <div class="metrics-grid">
        ${metricCard('Procesos activos', metrics.active_processes || 0, 'Total visible para su cuenta')}
        ${metricCard('Por vencer', metrics.due_soon || 0, 'Dentro de los próximos 7 días')}
        ${metricCard('Atrasados', metrics.overdue || 0, 'Requieren atención inmediata')}
        ${metricCard('Avance promedio', `${metrics.average_progress || 0}%`, 'Promedio de procesos activos')}
      </div>
      <div class="content-grid">
        <div class="card">
          <div class="card-header"><h2>Procesos prioritarios</h2><button class="button secondary small" data-view-link="processes">Ver todos</button></div>
          <div class="card-body flush">${renderPriorityTable(processes)}</div>
        </div>
        <div class="card">
          <div class="card-header"><h2>Distribución por estado</h2></div>
          <div class="card-body">
            <div class="status-list">${statusRows.length ? statusRows.map(([name, count]) => `<div class="status-row"><span>${escapeHtml(name || 'Sin estado')}</span><strong>${count}</strong></div>`).join('') : '<p class="cell-subtitle">Sin procesos registrados.</p>'}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2>Actividad reciente</h2></div>
          <div class="card-body">
            <div class="activity-list">${recent.length ? recent.map((item) => `<div class="activity-item"><strong>${escapeHtml(item.action)}</strong><span>${escapeHtml(item.user_name || 'Sistema')} · ${formatDateTime(item.created_at)}</span></div>`).join('') : '<p class="cell-subtitle">Todavía no hay actividades registradas.</p>'}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2>Acciones rápidas</h2></div>
          <div class="card-body">
            <div class="status-list">
              <button class="button secondary full" data-view-link="documents">Abrir documentos</button>
              <button class="button secondary full" data-view-link="credentials">Consultar credenciales</button>
              <button class="button secondary full" data-action="change-own-password">Cambiar mi contraseña</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function metricCard(label, value, note) {
    return `<div class="metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(String(value))}</strong><span class="metric-note">${escapeHtml(note)}</span></div>`;
  }

  function renderPriorityTable(processes) {
    if (!processes.length) return emptyState('Sin procesos prioritarios', 'No existen procesos atrasados, urgentes o próximos a vencer.');
    return `<div class="table-wrap"><table><thead><tr><th>Proceso</th><th>Estado</th><th>Responsable</th><th>Vencimiento</th><th>Avance</th></tr></thead><tbody>
      ${processes.map((p) => `<tr>
        <td><strong>${escapeHtml(p.client)}</strong><span class="cell-subtitle">${escapeHtml(p.title)}</span></td>
        <td>${statusBadge(p.status)}</td>
        <td>${escapeHtml(p.investigator_name || 'Por asignar')}</td>
        <td>${formatDate(p.due_date)}</td>
        <td>${progressBar(p.progress)}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  async function ensureProcesses(force = false) {
    if (!state.processes.length || force) {
      const result = await serverCall('listProcesses', { include_inactive: false });
      state.processes = result.processes || [];
    }
    return state.processes;
  }

  async function ensureInvestigators(force = false) {
    if (!state.investigators.length || force) {
      const result = await serverCall('listInvestigators', { include_inactive: false });
      state.investigators = result.investigators || [];
    }
    return state.investigators;
  }

  async function loadProcesses(force = false) {
    await ensureProcesses(force);
    if (isAdmin()) await ensureInvestigators(force);
    renderProcesses();
  }

  function renderProcesses() {
    const search = normalize(state.filters.processSearch);
    const filtered = state.processes.filter((p) => {
      const matchesSearch = !search || normalize([p.client, p.title, p.contract_number, p.journal, p.investigator_name].join(' ')).includes(search);
      const matchesStatus = !state.filters.processStatus || p.status === state.filters.processStatus;
      const matchesInvestigator = !state.filters.processInvestigator || p.investigator_id === state.filters.processInvestigator;
      return matchesSearch && matchesStatus && matchesInvestigator;
    });
    const statuses = unique(state.processes.map((p) => p.status).filter(Boolean));

    els.viewContainer.innerHTML = `
      <div class="toolbar">
        <div class="search-box"><input id="process-search" data-filter="process-search" value="${escapeAttr(state.filters.processSearch)}" placeholder="Buscar cliente, tema, contrato o revista"></div>
        <select data-filter="process-status"><option value="">Todos los estados</option>${statuses.map((s) => `<option ${s === state.filters.processStatus ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
        ${isAdmin() ? `<select data-filter="process-investigator"><option value="">Todos los investigadores</option>${state.investigators.map((i) => `<option value="${escapeAttr(i.id)}" ${i.id === state.filters.processInvestigator ? 'selected' : ''}>${escapeHtml(i.full_name)}</option>`).join('')}</select>` : ''}
        <span class="spacer"></span><span class="cell-subtitle">${filtered.length} proceso(s)</span>
      </div>
      <div class="card"><div class="card-body flush">${renderProcessesTable(filtered)}</div></div>`;
  }

  function renderProcessesTable(processes) {
    if (!processes.length) return emptyState('No se encontraron procesos', 'Cambie los filtros o registre un nuevo proceso.');
    return `<div class="table-wrap"><table><thead><tr><th>Proceso</th><th>Estado y prioridad</th><th>Investigador</th><th>Plazo</th><th>Avance</th><th></th></tr></thead><tbody>
      ${processes.map((p) => `<tr>
        <td><strong>${escapeHtml(p.client)}</strong><span class="cell-subtitle">${escapeHtml(p.title)}</span><span class="cell-subtitle">${escapeHtml(p.product || '')}${p.contract_number ? ` · ${escapeHtml(p.contract_number)}` : ''}</span></td>
        <td>${statusBadge(p.status)}<span class="cell-subtitle"><span class="priority-dot ${normalize(p.priority)}"></span>${escapeHtml(p.priority || 'Normal')}</span></td>
        <td>${escapeHtml(p.investigator_name || 'Por asignar')}<span class="cell-subtitle">${escapeHtml(p.journal || 'Revista no definida')}</span></td>
        <td>${formatDate(p.due_date)}<span class="cell-subtitle">Inicio: ${formatDate(p.start_date)}</span></td>
        <td>${progressBar(p.progress)}</td>
        <td><div class="actions">
          <button class="button secondary small" data-action="open-process" data-id="${escapeAttr(p.id)}">${isAdmin() ? 'Editar' : 'Actualizar'}</button>
          <button class="button secondary small" data-action="process-documents" data-id="${escapeAttr(p.id)}">Archivos</button>
          ${p.drive_folder_url ? `<a class="button secondary small" href="${escapeAttr(p.drive_folder_url)}" target="_blank" rel="noopener">Drive</a>` : ''}
        </div></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  async function loadDocuments(force = false) {
    await ensureProcesses(force);
    if (!state.selectedProcessId || !state.processes.some((p) => p.id === state.selectedProcessId)) {
      state.selectedProcessId = state.processes[0] ? state.processes[0].id : '';
      state.selectedFolderId = '';
    }

    if (!state.selectedProcessId) {
      els.viewContainer.innerHTML = `<div class="card">${emptyState('No existen procesos disponibles', 'Primero debe registrarse y asignarse al menos un proceso.')}</div>`;
      return;
    }

    await loadFolderData(state.selectedProcessId, state.selectedFolderId);
    renderDocuments();
  }

  async function loadFolderData(processId, folderId = '') {
    state.folderData = await serverCall('listFolderContents', { process_id: processId, folder_id: folderId || '' });
    state.selectedProcessId = processId;
    state.selectedFolderId = state.folderData.current_folder.id;
  }

  function renderDocuments() {
    const data = state.folderData;
    const processOptions = state.processes.map((p) => `<option value="${escapeAttr(p.id)}" ${p.id === state.selectedProcessId ? 'selected' : ''}>${escapeHtml(p.client)} — ${escapeHtml(p.title)}</option>`).join('');
    const folders = data.folders || [];
    const files = data.files || [];
    const allItems = [
      ...folders.map((f) => renderFolderTile(f)),
      ...files.map((f) => renderFileTile(f))
    ];

    els.viewContainer.innerHTML = `
      <div class="toolbar">
        <select id="document-process-select" data-filter="document-process" style="min-width:min(520px,100%)">${processOptions}</select>
        <button class="button secondary" data-action="create-folder">Nueva carpeta</button>
        <button class="button primary" data-action="upload-file">Subir archivo</button>
        ${data.process.drive_folder_url ? `<a class="button secondary" href="${escapeAttr(data.process.drive_folder_url)}" target="_blank" rel="noopener">Abrir Drive</a>` : ''}
      </div>
      <div class="card">
        <div class="file-browser">
          <aside class="folder-panel">
            <h3>Carpetas del proceso</h3>
            <div class="folder-list">
              <button class="folder-item ${data.current_folder.id === data.process.drive_folder_id ? 'active' : ''}" data-action="open-folder" data-id="${escapeAttr(data.process.drive_folder_id)}">▣ Carpeta principal</button>
              ${(data.root_folders || []).map((f) => `<button class="folder-item ${data.current_folder.id === f.id ? 'active' : ''}" data-action="open-folder" data-id="${escapeAttr(f.id)}">▻ ${escapeHtml(f.name)}</button>`).join('')}
            </div>
          </aside>
          <section class="file-panel">
            <div class="file-breadcrumb">${(data.breadcrumbs || []).map((b, index) => `<button class="button ghost small" data-action="open-folder" data-id="${escapeAttr(b.id)}">${escapeHtml(b.name)}</button>${index < data.breadcrumbs.length - 1 ? '<span>›</span>' : ''}`).join('')}</div>
            <div class="file-grid">${allItems.length ? allItems.join('') : emptyState('Carpeta vacía', 'Cree una subcarpeta o cargue el primer documento.')}</div>
          </section>
        </div>
      </div>`;
  }

  function renderFolderTile(folder) {
    return `<div class="file-tile">
      <div class="file-icon">DIR</div><strong title="${escapeAttr(folder.name)}">${escapeHtml(folder.name)}</strong><span>Carpeta de Google Drive</span>
      <div class="actions"><button class="button secondary small" data-action="open-folder" data-id="${escapeAttr(folder.id)}">Abrir</button><button class="button ghost small" data-action="rename-folder" data-id="${escapeAttr(folder.id)}" data-name="${escapeAttr(folder.name)}">Renombrar</button>${isAdmin() ? `<button class="button danger small" data-action="delete-folder" data-id="${escapeAttr(folder.id)}">Eliminar</button>` : ''}</div>
    </div>`;
  }

  function renderFileTile(file) {
    return `<div class="file-tile">
      <div class="file-icon">${fileExtension(file.name)}</div><strong title="${escapeAttr(file.name)}">${escapeHtml(file.name)}</strong><span>${formatBytes(file.size_bytes)} · ${formatDateTime(file.created_at)}</span>
      <div class="actions"><a class="button secondary small" href="${escapeAttr(file.url)}" target="_blank" rel="noopener">Abrir</a><button class="button ghost small" data-action="rename-file" data-id="${escapeAttr(file.id)}" data-name="${escapeAttr(file.name)}">Renombrar</button>${isAdmin() ? `<button class="button danger small" data-action="delete-file" data-id="${escapeAttr(file.id)}">Eliminar</button>` : ''}</div>
    </div>`;
  }

  async function loadCredentials() {
    await ensureProcesses();
    const result = await serverCall('listCredentials', {});
    const credentials = result.credentials || [];
    const search = normalize(state.filters.credentialSearch);
    const filtered = credentials.filter((c) => !search || normalize([c.service, c.url, c.username, c.process_name].join(' ')).includes(search));

    els.viewContainer.innerHTML = `
      <div class="toolbar"><div class="search-box"><input data-filter="credential-search" value="${escapeAttr(state.filters.credentialSearch)}" placeholder="Buscar plataforma, usuario o proceso"></div><span class="spacer"></span><span class="cell-subtitle">${filtered.length} credencial(es)</span></div>
      <div class="card"><div class="card-body flush">${renderCredentialsTable(filtered)}</div></div>`;
  }

  function renderCredentialsTable(credentials) {
    if (!credentials.length) return emptyState('No existen credenciales', 'Registre accesos de revistas o plataformas vinculados con un proceso.');
    return `<div class="table-wrap"><table><thead><tr><th>Servicio</th><th>Proceso</th><th>Usuario</th><th>Contraseña</th><th></th></tr></thead><tbody>
      ${credentials.map((c) => `<tr>
        <td><strong>${escapeHtml(c.service)}</strong>${c.url ? `<a class="cell-subtitle" href="${escapeAttr(c.url)}" target="_blank" rel="noopener">Abrir plataforma</a>` : ''}</td>
        <td>${escapeHtml(c.process_name || 'General')}</td>
        <td>${escapeHtml(c.username || '—')}</td>
        <td><code>${escapeHtml(c.masked_secret || '••••••••')}</code></td>
        <td><div class="actions"><button class="button secondary small" data-action="reveal-credential" data-id="${escapeAttr(c.id)}">Mostrar</button><button class="button secondary small" data-action="edit-credential" data-id="${escapeAttr(c.id)}">Editar</button>${isAdmin() ? `<button class="button danger small" data-action="delete-credential" data-id="${escapeAttr(c.id)}">Eliminar</button>` : ''}</div></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  async function loadInvestigatorsView(force = false) {
    await ensureInvestigators(force);
    els.viewContainer.innerHTML = `<div class="card"><div class="card-body flush">${renderInvestigatorsTable(state.investigators)}</div></div>`;
  }

  function renderInvestigatorsTable(items) {
    if (!items.length) return emptyState('No existen investigadores', 'Registre el primer investigador para asignarle procesos.');
    return `<div class="table-wrap"><table><thead><tr><th>Investigador</th><th>Especialidad</th><th>Contacto</th><th>Estado</th><th></th></tr></thead><tbody>
      ${items.map((i) => `<tr>
        <td><strong>${escapeHtml(i.full_name)}</strong><span class="cell-subtitle">${escapeHtml(i.identification || 'Sin identificación')}</span></td>
        <td>${escapeHtml(i.specialty || 'No registrada')}<span class="cell-subtitle">${escapeHtml(i.employment_type || '')}</span></td>
        <td>${escapeHtml(i.email || '—')}<span class="cell-subtitle">${escapeHtml(i.phone || '')}</span></td>
        <td>${statusBadge(i.status || 'Activo')}</td>
        <td><div class="actions"><button class="button secondary small" data-action="edit-investigator" data-id="${escapeAttr(i.id)}">Editar</button>${i.drive_folder_url ? `<a class="button secondary small" href="${escapeAttr(i.drive_folder_url)}" target="_blank" rel="noopener">Drive</a>` : ''}</div></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  async function loadUsers() {
    await ensureInvestigators();
    const result = await serverCall('listUsers');
    const users = result.users || [];
    els.viewContainer.innerHTML = `<div class="card"><div class="card-body flush">${renderUsersTable(users)}</div></div>`;
  }

  function renderUsersTable(users) {
    if (!users.length) return emptyState('No existen usuarios', 'Cree cuentas para administradores e investigadores.');
    return `<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Investigador asociado</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr>
        <td><strong>${escapeHtml(u.full_name)}</strong><span class="cell-subtitle">${escapeHtml(u.username)} · ${escapeHtml(u.email || '')}</span></td>
        <td>${statusBadge(u.role === 'admin' ? 'Administrador' : 'Investigador')}</td>
        <td>${escapeHtml(u.investigator_name || 'No aplica')}</td>
        <td>${u.active ? '<span class="badge success">Activo</span>' : '<span class="badge danger">Inactivo</span>'}${u.must_change_password ? '<span class="cell-subtitle">Debe cambiar contraseña</span>' : ''}</td>
        <td>${formatDateTime(u.last_login)}</td>
        <td><div class="actions"><button class="button secondary small" data-action="edit-user" data-id="${escapeAttr(u.id)}">Editar</button><button class="button secondary small" data-action="reset-password" data-id="${escapeAttr(u.id)}">Restablecer clave</button></div></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }

  async function loadAudit() {
    const result = await serverCall('listAudit', { limit: 300 });
    const items = result.audit || [];
    els.viewContainer.innerHTML = `<div class="card"><div class="card-body flush">${items.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>${items.map((a) => `<tr><td>${formatDateTime(a.created_at)}</td><td>${escapeHtml(a.user_name || a.user_id)}</td><td><strong>${escapeHtml(a.action)}</strong></td><td>${escapeHtml(a.entity)}<span class="cell-subtitle">${escapeHtml(a.entity_id || '')}</span></td><td>${escapeHtml(a.detail || '')}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Sin registros de auditoría', 'Las acciones aparecerán después de utilizar el sistema.')}</div></div>`;
  }

  async function handleViewClick(event) {
    const viewLink = event.target.closest('[data-view-link]');
    if (viewLink) return loadView(viewLink.dataset.viewLink);

    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;

    try {
      switch (action) {
        case 'retry-view': return loadView(state.currentView, true);
        case 'change-own-password': return openChangePasswordModal(false);
        case 'open-process': return openProcessModal(state.processes.find((p) => p.id === id));
        case 'process-documents': state.selectedProcessId = id; state.selectedFolderId = ''; return loadView('documents');
        case 'open-folder': await loadFolderData(state.selectedProcessId, id); return renderDocuments();
        case 'create-folder': return openFolderModal();
        case 'rename-folder': return openFolderModal({ id, name: target.dataset.name });
        case 'delete-folder': return deleteFolder(id);
        case 'upload-file': return openUploadModal();
        case 'rename-file': return openRenameFileModal(id, target.dataset.name);
        case 'delete-file': return deleteFile(id);
        case 'reveal-credential': return revealCredential(id);
        case 'edit-credential': return openCredentialModal(id);
        case 'delete-credential': return deleteCredential(id);
        case 'edit-investigator': return openInvestigatorModal(state.investigators.find((i) => i.id === id));
        case 'edit-user': return openUserModal(id);
        case 'reset-password': return openResetPasswordModal(id);
        default: break;
      }
    } catch (error) {
      toast('error', 'Operación no completada', error.message);
    }
  }

  async function handleViewChange(event) {
    const filter = event.target.dataset.filter;
    if (!filter) return;
    if (filter === 'process-status') { state.filters.processStatus = event.target.value; renderProcesses(); }
    if (filter === 'process-investigator') { state.filters.processInvestigator = event.target.value; renderProcesses(); }
    if (filter === 'document-process') { state.selectedProcessId = event.target.value; state.selectedFolderId = ''; await loadDocuments(); }
  }

  function handleViewInput(event) {
    const filter = event.target.dataset.filter;
    if (filter === 'process-search') { state.filters.processSearch = event.target.value; renderProcesses(); focusAtEnd('process-search'); }
    if (filter === 'credential-search') { state.filters.credentialSearch = event.target.value; loadCredentials(); }
  }

  function handlePrimaryAction() {
    switch (state.currentView) {
      case 'dashboard':
      case 'processes': return isAdmin() ? openProcessModal() : openProcessModal(state.processes[0]);
      case 'documents': return openUploadModal();
      case 'credentials': return openCredentialModal();
      case 'investigators': return openInvestigatorModal();
      case 'users': return openUserModal();
      default: return undefined;
    }
  }

  async function openProcessModal(process = null) {
    if (isAdmin()) await ensureInvestigators();
    const p = process || {};
    const readOnlyMain = !isAdmin() && Boolean(process);
    const investigatorOptions = state.investigators.map((i) => `<option value="${escapeAttr(i.id)}" ${i.id === p.investigator_id ? 'selected' : ''}>${escapeHtml(i.full_name)}</option>`).join('');

    openModal({
      title: process ? (isAdmin() ? 'Editar proceso' : 'Actualizar mi proceso') : 'Nuevo proceso',
      subtitle: process ? `${p.client} — ${p.title}` : 'Se creará automáticamente una carpeta estructurada en Google Drive.',
      large: true,
      body: `<form id="process-form" class="form-grid">
        <div class="section-title">Información principal</div>
        <label>Cliente<input name="client" value="${escapeAttr(p.client || '')}" required ${readOnlyMain ? 'disabled' : ''}></label>
        <label>Número de contrato<input name="contract_number" value="${escapeAttr(p.contract_number || '')}" ${readOnlyMain ? 'disabled' : ''}></label>
        <label class="span-2">Título o tema<input name="title" value="${escapeAttr(p.title || '')}" required ${readOnlyMain ? 'disabled' : ''}></label>
        <label>Producto<select name="product" ${readOnlyMain ? 'disabled' : ''}>${options(['Artículo científico', 'Libro', 'Capítulo de libro', 'Tesis', 'Consultoría', 'Otro'], p.product)}</select></label>
        <label>Indexación<select name="indexation" ${readOnlyMain ? 'disabled' : ''}>${options(['Latindex', 'Latindex FastTrack', 'Scielo', 'Scielo FastTrack', 'Scopus Q4', 'Scopus Q3', 'Scopus Q2', 'Scopus Q1', 'Web of Science', 'Sin definir'], p.indexation)}</select></label>
        <label>Revista<input name="journal" value="${escapeAttr(p.journal || '')}" ${readOnlyMain ? 'disabled' : ''}></label>
        <label>Investigador<select name="investigator_id" ${readOnlyMain ? 'disabled' : ''}><option value="">Por asignar</option>${investigatorOptions}</select></label>
        <div class="section-title">Seguimiento</div>
        <label>Estado<select name="status">${options(['Por asignar', 'Elaboración', 'Revisión interna', 'Espera del cliente', 'Correcciones', 'Enviado a revista', 'En revisión editorial', 'Aceptado', 'Publicado', 'Finalizado', 'Suspendido'], p.status || 'Por asignar')}</select></label>
        <label>Prioridad<select name="priority" ${readOnlyMain ? 'disabled' : ''}>${options(['Baja', 'Media', 'Alta', 'Urgente'], p.priority || 'Media')}</select></label>
        <label>Avance (%)<input name="progress" type="number" min="0" max="100" step="1" value="${escapeAttr(String(p.progress || 0))}"></label>
        <label>Próxima acción<input name="next_action" value="${escapeAttr(p.next_action || '')}"></label>
        <label>Fecha de inicio<input name="start_date" type="date" value="${escapeAttr(toDateInput(p.start_date))}" ${readOnlyMain ? 'disabled' : ''}></label>
        <label>Fecha límite<input name="due_date" type="date" value="${escapeAttr(toDateInput(p.due_date))}" ${readOnlyMain ? 'disabled' : ''}></label>
        <div class="section-title">APC y observaciones</div>
        <label>Tipo de APC<select name="apc_type" ${readOnlyMain ? 'disabled' : ''}>${options(['Sin APC', 'Con APC', 'Por confirmar'], p.apc_type || 'Por confirmar')}</select></label>
        <label>Valor APC<input name="apc_value" type="number" min="0" step="0.01" value="${escapeAttr(String(p.apc_value || ''))}" ${readOnlyMain ? 'disabled' : ''}></label>
        <label>Estado APC<select name="apc_status" ${readOnlyMain ? 'disabled' : ''}>${options(['No aplica', 'Pendiente', 'Cotizado', 'Facturado', 'Pagado'], p.apc_status || 'No aplica')}</select></label>
        <label class="span-2">Observaciones<textarea name="observations">${escapeHtml(p.observations || '')}</textarea></label>
      </form>`,
      submitText: process ? 'Guardar cambios' : 'Crear proceso',
      onSubmit: async (button) => {
        const data = formToObject(document.getElementById('process-form'));
        data.id = p.id || '';
        data.progress = Number(data.progress || 0);
        data.apc_value = Number(data.apc_value || 0);
        setButtonLoading(button, true, 'Guardando...');
        try {
          await serverCall(process ? 'updateProcess' : 'createProcess', data);
          closeModal();
          state.processes = [];
          toast('success', process ? 'Proceso actualizado' : 'Proceso creado', 'La información y la carpeta de Drive quedaron sincronizadas.');
          await loadView('processes', true);
        } finally { setButtonLoading(button, false, process ? 'Guardar cambios' : 'Crear proceso'); }
      }
    });
  }

  function openFolderModal(folder = null) {
    if (!state.folderData) return toast('error', 'Seleccione un proceso', 'No existe una carpeta activa.');
    openModal({
      title: folder ? 'Renombrar carpeta' : 'Nueva carpeta',
      subtitle: `Dentro de: ${state.folderData.current_folder.name}`,
      body: `<form id="folder-form"><label>Nombre de la carpeta<input name="name" required maxlength="120" value="${escapeAttr(folder ? folder.name : '')}"></label></form>`,
      submitText: folder ? 'Renombrar' : 'Crear carpeta',
      onSubmit: async (button) => {
        const data = formToObject(document.getElementById('folder-form'));
        setButtonLoading(button, true, 'Guardando...');
        try {
          if (folder) await serverCall('renameFolder', { process_id: state.selectedProcessId, folder_id: folder.id, name: data.name });
          else await serverCall('createFolder', { process_id: state.selectedProcessId, parent_folder_id: state.selectedFolderId, name: data.name });
          closeModal();
          await loadFolderData(state.selectedProcessId, state.selectedFolderId);
          renderDocuments();
          toast('success', folder ? 'Carpeta renombrada' : 'Carpeta creada', 'El cambio se aplicó en Google Drive.');
        } finally { setButtonLoading(button, false, folder ? 'Renombrar' : 'Crear carpeta'); }
      }
    });
  }

  async function deleteFolder(id) {
    if (!window.confirm('¿Mover esta carpeta y todo su contenido a la papelera de Google Drive?')) return;
    await serverCall('deleteFolder', { process_id: state.selectedProcessId, folder_id: id });
    await loadFolderData(state.selectedProcessId, state.selectedFolderId);
    renderDocuments();
    toast('success', 'Carpeta eliminada', 'La carpeta fue movida a la papelera.');
  }

  function openUploadModal() {
    if (!state.folderData) return toast('error', 'Seleccione un proceso', 'Abra primero la sección de documentos de un proceso.');
    openModal({
      title: 'Subir archivo',
      subtitle: `Destino: ${state.folderData.current_folder.name}. Máximo ${config.MAX_FILE_SIZE_MB} MB por archivo.`,
      body: `<form id="upload-form" class="form-grid">
        <label class="span-2">Archivo<input id="upload-input" name="file" type="file" required></label>
        <label class="span-2">Descripción o nota<textarea name="notes" placeholder="Opcional"></textarea></label>
      </form>`,
      submitText: 'Subir a Drive',
      onSubmit: async (button) => {
        const input = document.getElementById('upload-input');
        const file = input.files && input.files[0];
        if (!file) throw new Error('Seleccione un archivo.');
        const max = config.MAX_FILE_SIZE_MB * 1024 * 1024;
        if (file.size > max) throw new Error(`El archivo supera el límite de ${config.MAX_FILE_SIZE_MB} MB.`);
        setButtonLoading(button, true, 'Leyendo archivo...');
        try {
          const base64 = await fileToBase64(file);
          setButtonLoading(button, true, 'Subiendo a Drive...');
          const form = formToObject(document.getElementById('upload-form'));
          await serverCall('uploadFile', {
            process_id: state.selectedProcessId,
            folder_id: state.selectedFolderId,
            name: file.name,
            mime_type: file.type || 'application/octet-stream',
            size_bytes: file.size,
            base64,
            notes: form.notes || ''
          });
          closeModal();
          await loadFolderData(state.selectedProcessId, state.selectedFolderId);
          renderDocuments();
          toast('success', 'Archivo cargado', 'El documento ya está disponible en Google Drive.');
        } finally { setButtonLoading(button, false, 'Subir a Drive'); }
      }
    });
  }

  function openRenameFileModal(id, name) {
    openModal({
      title: 'Renombrar archivo',
      body: `<form id="rename-file-form"><label>Nuevo nombre<input name="name" required maxlength="180" value="${escapeAttr(name)}"></label></form>`,
      submitText: 'Renombrar',
      onSubmit: async (button) => {
        const data = formToObject(document.getElementById('rename-file-form'));
        setButtonLoading(button, true, 'Guardando...');
        try {
          await serverCall('renameFile', { process_id: state.selectedProcessId, file_id: id, name: data.name });
          closeModal(); await loadFolderData(state.selectedProcessId, state.selectedFolderId); renderDocuments();
          toast('success', 'Archivo renombrado', 'El cambio se aplicó correctamente.');
        } finally { setButtonLoading(button, false, 'Renombrar'); }
      }
    });
  }

  async function deleteFile(id) {
    if (!window.confirm('¿Mover este archivo a la papelera de Google Drive?')) return;
    await serverCall('deleteFile', { process_id: state.selectedProcessId, file_id: id });
    await loadFolderData(state.selectedProcessId, state.selectedFolderId); renderDocuments();
    toast('success', 'Archivo eliminado', 'El archivo fue movido a la papelera.');
  }

  async function openCredentialModal(id = '') {
    await ensureProcesses();
    let c = {};
    if (id) {
      const result = await serverCall('getCredential', { id });
      c = result.credential || {};
    }
    const processOptions = state.processes.map((p) => `<option value="${escapeAttr(p.id)}" ${p.id === c.process_id ? 'selected' : ''}>${escapeHtml(p.client)} — ${escapeHtml(p.title)}</option>`).join('');
    openModal({
      title: id ? 'Editar credencial' : 'Nueva credencial',
      subtitle: 'La contraseña se cifra en el servidor y solo se revela mediante una acción auditada.',
      body: `<form id="credential-form" class="form-grid">
        <label class="span-2">Proceso<select name="process_id" required><option value="">Seleccione...</option>${processOptions}</select></label>
        <label>Servicio o plataforma<input name="service" required value="${escapeAttr(c.service || '')}" placeholder="ScholarOne, Editorial Manager..."></label>
        <label>URL<input name="url" type="url" value="${escapeAttr(c.url || '')}" placeholder="https://"></label>
        <label>Usuario o correo<input name="username" value="${escapeAttr(c.username || '')}"></label>
        <label>Contraseña<input name="secret" type="password" ${id ? '' : 'required'} placeholder="${id ? 'Dejar vacío para conservar' : ''}"></label>
        <label class="span-2">Notas<textarea name="notes">${escapeHtml(c.notes || '')}</textarea></label>
      </form>`,
      submitText: id ? 'Guardar cambios' : 'Registrar credencial',
      onSubmit: async (button) => {
        const data = formToObject(document.getElementById('credential-form'));
        data.id = id;
        setButtonLoading(button, true, 'Guardando...');
        try {
          await serverCall(id ? 'updateCredential' : 'createCredential', data);
          closeModal(); toast('success', 'Credencial guardada', 'El acceso quedó asociado al proceso seleccionado.'); await loadCredentials();
        } finally { setButtonLoading(button, false, id ? 'Guardar cambios' : 'Registrar credencial'); }
      }
    });
  }

  async function revealCredential(id) {
    const result = await serverCall('revealCredential', { id });
    openModal({
      title: 'Credencial revelada',
      subtitle: 'Esta consulta ha quedado registrada en auditoría.',
      body: `<div class="form-grid">
        <label>Servicio<input readonly value="${escapeAttr(result.credential.service)}"></label>
        <label>Usuario<input readonly value="${escapeAttr(result.credential.username || '')}"></label>
        <label class="span-2">Contraseña<div class="password-field"><input id="revealed-secret" readonly type="password" value="${escapeAttr(result.credential.secret)}"><button class="icon-button" type="button" data-toggle-password="revealed-secret">◉</button></div></label>
        ${result.credential.url ? `<a class="button secondary span-2" href="${escapeAttr(result.credential.url)}" target="_blank" rel="noopener">Abrir plataforma</a>` : ''}
      </div>`,
      submitText: '',
      cancelText: 'Cerrar'
    });
  }

  async function deleteCredential(id) {
    if (!window.confirm('¿Eliminar esta credencial del sistema?')) return;
    await serverCall('deleteCredential', { id });
    toast('success', 'Credencial eliminada', 'El registro ya no está disponible.');
    await loadCredentials();
  }

  function openInvestigatorModal(item = null) {
    const i = item || {};
    openModal({
      title: item ? 'Editar investigador' : 'Nuevo investigador',
      subtitle: item ? 'Actualice la información del directorio.' : 'Se creará una carpeta principal dentro del repositorio de Drive.',
      body: `<form id="investigator-form" class="form-grid">
        <label class="span-2">Nombres completos<input name="full_name" required value="${escapeAttr(i.full_name || '')}"></label>
        <label>Identificación<input name="identification" value="${escapeAttr(i.identification || '')}"></label>
        <label>Correo<input name="email" type="email" value="${escapeAttr(i.email || '')}"></label>
        <label>Teléfono<input name="phone" value="${escapeAttr(i.phone || '')}"></label>
        <label>Especialidad<input name="specialty" value="${escapeAttr(i.specialty || '')}"></label>
        <label>Modalidad<select name="employment_type">${options(['Presencial', 'Remoto', 'Híbrido', 'Tiempo parcial', 'Proveedor externo'], i.employment_type)}</select></label>
        <label>Estado<select name="status">${options(['Activo', 'Inactivo', 'Suspendido'], i.status || 'Activo')}</select></label>
      </form>`,
      submitText: item ? 'Guardar cambios' : 'Crear investigador',
      onSubmit: async (button) => {
        const data = formToObject(document.getElementById('investigator-form')); data.id = i.id || '';
        setButtonLoading(button, true, 'Guardando...');
        try {
          await serverCall(item ? 'updateInvestigator' : 'createInvestigator', data);
          closeModal(); state.investigators = []; toast('success', 'Investigador guardado', 'La información quedó sincronizada.'); await loadInvestigatorsView(true);
        } finally { setButtonLoading(button, false, item ? 'Guardar cambios' : 'Crear investigador'); }
      }
    });
  }

  async function openUserModal(id = '') {
    await ensureInvestigators();
    let u = {};
    if (id) {
      const result = await serverCall('getUser', { id });
      u = result.user || {};
    }
    const investigatorOptions = state.investigators.map((i) => `<option value="${escapeAttr(i.id)}" ${i.id === u.investigator_id ? 'selected' : ''}>${escapeHtml(i.full_name)}</option>`).join('');
    openModal({
      title: id ? 'Editar usuario' : 'Nuevo usuario',
      subtitle: id ? 'Cambie el rol, asociación o estado de la cuenta.' : 'La contraseña inicial deberá cambiarse en el primer ingreso.',
      body: `<form id="user-form" class="form-grid">
        <label>Nombre completo<input name="full_name" required value="${escapeAttr(u.full_name || '')}"></label>
        <label>Correo<input name="email" type="email" value="${escapeAttr(u.email || '')}"></label>
        <label>Usuario<input name="username" required minlength="3" value="${escapeAttr(u.username || '')}"></label>
        <label>Rol<select id="user-role" name="role">${options(['investigator', 'admin'], u.role || 'investigator', { investigator: 'Investigador', admin: 'Administrador' })}</select></label>
        <label class="span-2">Investigador asociado<select name="investigator_id"><option value="">No aplica / seleccione</option>${investigatorOptions}</select><span class="field-hint">Obligatorio cuando el rol sea Investigador.</span></label>
        ${id ? `<label class="checkbox-row span-2"><input name="active" type="checkbox" ${u.active ? 'checked' : ''}> Cuenta activa</label>` : `<label class="span-2">Contraseña temporal<input name="password" type="password" required minlength="8"></label>`}
      </form>`,
      submitText: id ? 'Guardar cambios' : 'Crear usuario',
      onSubmit: async (button) => {
        const data = formToObject(document.getElementById('user-form')); data.id = id; data.active = id ? Boolean(document.querySelector('#user-form [name="active"]').checked) : true;
        setButtonLoading(button, true, 'Guardando...');
        try {
          await serverCall(id ? 'updateUser' : 'createUser', data);
          closeModal(); toast('success', 'Usuario guardado', 'La cuenta ya puede utilizarse según el estado configurado.'); await loadUsers();
        } finally { setButtonLoading(button, false, id ? 'Guardar cambios' : 'Crear usuario'); }
      }
    });
  }

  function openResetPasswordModal(id) {
    openModal({
      title: 'Restablecer contraseña',
      subtitle: 'El usuario deberá cambiarla en el siguiente inicio de sesión.',
      body: `<form id="reset-password-form" class="form-grid"><label class="span-2">Nueva contraseña temporal<input name="password" type="password" required minlength="8"></label><label class="span-2">Confirmar contraseña<input name="confirm" type="password" required minlength="8"></label></form>`,
      submitText: 'Restablecer',
      onSubmit: async (button) => {
        const data = formToObject(document.getElementById('reset-password-form'));
        if (data.password !== data.confirm) throw new Error('Las contraseñas no coinciden.');
        setButtonLoading(button, true, 'Actualizando...');
        try { await serverCall('resetUserPassword', { id, password: data.password }); closeModal(); toast('success', 'Contraseña restablecida', 'La clave temporal quedó activa.'); await loadUsers(); }
        finally { setButtonLoading(button, false, 'Restablecer'); }
      }
    });
  }

  function openChangePasswordModal(required) {
    openModal({
      title: required ? 'Cambio de contraseña obligatorio' : 'Cambiar mi contraseña',
      subtitle: 'Use al menos 8 caracteres, incluyendo letras y números.',
      dismissible: !required,
      body: `<form id="change-password-form" class="form-grid">
        <label class="span-2">Contraseña actual<input name="current_password" type="password" required minlength="8"></label>
        <label>Nueva contraseña<input name="new_password" type="password" required minlength="8"></label>
        <label>Confirmar<input name="confirm" type="password" required minlength="8"></label>
      </form>`,
      submitText: 'Cambiar contraseña',
      cancelText: required ? '' : 'Cancelar',
      onSubmit: async (button) => {
        const data = formToObject(document.getElementById('change-password-form'));
        if (data.new_password !== data.confirm) throw new Error('Las contraseñas nuevas no coinciden.');
        setButtonLoading(button, true, 'Actualizando...');
        try {
          await serverCall('changeOwnPassword', data);
          state.session.user.must_change_password = false;
          storeSession(state.session);
          closeModal(true);
          toast('success', 'Contraseña actualizada', 'Use la nueva clave en su próximo ingreso.');
        } finally { setButtonLoading(button, false, 'Cambiar contraseña'); }
      }
    });
  }

  function openModal({ title, subtitle = '', body, submitText = 'Guardar', cancelText = 'Cancelar', large = false, dismissible = true, onSubmit = null }) {
    els.modalRoot.innerHTML = `<div class="modal-backdrop" ${dismissible ? '' : 'data-required-modal="true"'}>
      <div class="modal ${large ? 'large' : ''}" role="dialog" aria-modal="true">
        <div class="modal-header"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>${dismissible ? '<button class="icon-button" data-close-modal type="button">✕</button>' : ''}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">${cancelText ? `<button class="button secondary" ${dismissible ? 'data-close-modal' : ''} type="button">${escapeHtml(cancelText)}</button>` : ''}${submitText ? `<button id="modal-submit" class="button primary" type="button">${escapeHtml(submitText)}</button>` : ''}</div>
      </div></div>`;

    const submit = document.getElementById('modal-submit');
    if (submit && onSubmit) {
      submit.addEventListener('click', async () => {
        try {
          const form = els.modalRoot.querySelector('form');
          if (form && !form.reportValidity()) return;
          await onSubmit(submit);
        } catch (error) {
          toast('error', 'No se pudo guardar', error.message);
        }
      });
    }
    setTimeout(() => {
      const first = els.modalRoot.querySelector('input:not([type="hidden"]), select, textarea');
      if (first) first.focus();
    }, 30);
  }

  function closeModal(force = false) {
    const backdrop = els.modalRoot.querySelector('.modal-backdrop');
    if (backdrop && backdrop.dataset.requiredModal === 'true' && !force) return;
    els.modalRoot.innerHTML = '';
  }

  function formToObject(form) {
    const data = {};
    new FormData(form).forEach((value, key) => { data[key] = typeof value === 'string' ? value.trim() : value; });
    form.querySelectorAll('input[type="checkbox"]').forEach((input) => { data[input.name] = input.checked; });
    form.querySelectorAll(':disabled[name]').forEach((input) => {
      if (input.type !== 'file') data[input.name] = input.value;
    });
    return data;
  }

  function statusBadge(status) {
    const value = String(status || 'Sin estado');
    const n = normalize(value);
    let kind = 'neutral';
    if (/finalizado|publicado|aceptado|activo|administrador/.test(n)) kind = 'success';
    else if (/atrasado|suspendido|inactivo|rechazado/.test(n)) kind = 'danger';
    else if (/espera|correccion|pendiente|por asignar/.test(n)) kind = 'warning';
    else if (/elaboracion|revision|enviado|investigador/.test(n)) kind = 'info';
    return `<span class="badge ${kind}">${escapeHtml(value)}</span>`;
  }

  function progressBar(value) {
    const n = Math.max(0, Math.min(100, Number(value || 0)));
    return `<div class="progress"><span style="width:${n}%"></span></div><span class="progress-label">${n}%</span>`;
  }

  function emptyState(title, text) {
    return `<div class="empty-state"><div class="empty-icon">□</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
  }

  function options(values, selected, labels = {}) {
    return values.map((value) => `<option value="${escapeAttr(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join('');
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
    return new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
    return new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function toDateInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toISOString().slice(0, 10);
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function fileExtension(name) {
    const parts = String(name || '').split('.');
    return (parts.length > 1 ? parts.pop() : 'FILE').slice(0, 4).toUpperCase();
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('No fue posible leer el archivo seleccionado.'));
      reader.readAsDataURL(file);
    });
  }

  function setButtonLoading(button, loading, text) {
    button.disabled = loading;
    button.dataset.originalText = button.dataset.originalText || button.textContent;
    button.textContent = loading ? text : (text || button.dataset.originalText);
  }

  function toast(type, title, message) {
    const container = document.getElementById('toast-container');
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.innerHTML = `<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message || '')}</span></div>`;
    container.appendChild(item);
    setTimeout(() => item.remove(), 5200);
  }

  function storeSession(session) {
    localStorage.setItem(config.SESSION_STORAGE_KEY, JSON.stringify({ token: session.token, user: session.user }));
  }
  function loadStoredSession() {
    try { return JSON.parse(localStorage.getItem(config.SESSION_STORAGE_KEY) || 'null'); } catch (error) { return null; }
  }
  function clearStoredSession() { localStorage.removeItem(config.SESSION_STORAGE_KEY); }
  function isAdmin() { return state.session && state.session.user.role === 'admin'; }
  function initials(name) { return String(name || 'U').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase(); }
  function unique(values) { return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), 'es')); }
  function normalize(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function debounce(fn, wait) { let timer; return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), wait); }; }
  function focusAtEnd(id) { requestAnimationFrame(() => { const input = document.getElementById(id); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } }); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#096;'); }
})();

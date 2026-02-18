const state = {
  projects: [],
  selectedProjectId: null,
  selectedDeploymentId: null,
  selectedServerId: '',
  envVars: [],
  envExpanded: false,
  servers: [],
  masterServers: [],
  deployments: [],
  deploymentHistoryProjectId: null,
  deploymentFilter: 'all',
  deploymentsVisibleLimit: 8,
  expandedDeploymentIds: new Set(),
  editingProjectId: null,
  editingServerId: null,
  socket: null,
};

const DEPLOYMENTS_PAGE_SIZE = 8;

const els = {
  projectsList: document.getElementById('projectsList'),
  refreshProjectsBtn: document.getElementById('refreshProjectsBtn'),
  queueChip: document.getElementById('queueChip'),
  newProjectBtn: document.getElementById('newProjectBtn'),
  emptyState: document.getElementById('emptyState'),
  projectDetails: document.getElementById('projectDetails'),
  projectName: document.getElementById('projectName'),
  projectMeta: document.getElementById('projectMeta'),
  deployServerSelect: document.getElementById('deployServerSelect'),
  editProjectBtn: document.getElementById('editProjectBtn'),
  deleteProjectBtn: document.getElementById('deleteProjectBtn'),
  deployBtn: document.getElementById('deployBtn'),

  envList: document.getElementById('envList'),
  envCountBadge: document.getElementById('envCountBadge'),
  toggleEnvExpandBtn: document.getElementById('toggleEnvExpandBtn'),
  toggleEnvBulkBtn: document.getElementById('toggleEnvBulkBtn'),
  envBulkSection: document.getElementById('envBulkSection'),
  envBulkInput: document.getElementById('envBulkInput'),
  importEnvBtn: document.getElementById('importEnvBtn'),
  cancelEnvBulkBtn: document.getElementById('cancelEnvBulkBtn'),

  addServerBtn: document.getElementById('addServerBtn'),
  attachServerSelect: document.getElementById('attachServerSelect'),
  attachServerBtn: document.getElementById('attachServerBtn'),
  showServerFormBtn: document.getElementById('showServerFormBtn'),
  serverFormWrap: document.getElementById('serverFormWrap'),
  serverForm: document.getElementById('serverForm'),
  serverList: document.getElementById('serverList'),
  serverSubmitBtn: document.getElementById('serverSubmitBtn'),
  cancelServerEditBtn: document.getElementById('cancelServerEditBtn'),
  serverFormHint: document.getElementById('serverFormHint'),
  sName: document.getElementById('sName'),
  sHost: document.getElementById('sHost'),
  sPort: document.getElementById('sPort'),
  sUser: document.getElementById('sUser'),
  sAuthType: document.getElementById('sAuthType'),
  sDefault: document.getElementById('sDefault'),
  sPassword: document.getElementById('sPassword'),
  sPrivateKey: document.getElementById('sPrivateKey'),
  sPassphrase: document.getElementById('sPassphrase'),
  serverPasswordRow: document.getElementById('serverPasswordRow'),
  serverKeyRow: document.getElementById('serverKeyRow'),

  deploymentsList: document.getElementById('deploymentsList'),
  deploymentHistoryMeta: document.getElementById('deploymentHistoryMeta'),
  deploymentHistoryFilters: document.getElementById('deploymentHistoryFilters'),
  deploymentHistoryMoreRow: document.getElementById('deploymentHistoryMoreRow'),
  deploymentsShowMoreBtn: document.getElementById('deploymentsShowMoreBtn'),
  logsViewer: document.getElementById('logsViewer'),
  copyLogBtn: document.getElementById('copyLogBtn'),
  copyLogStatus: document.getElementById('copyLogStatus'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  activeLogLabel: document.getElementById('activeLogLabel'),

  projectDialog: document.getElementById('projectDialog'),
  projectDialogTitle: document.getElementById('projectDialogTitle'),
  closeDialogBtn: document.getElementById('closeDialogBtn'),
  projectForm: document.getElementById('projectForm'),
  projectSubmitBtn: document.getElementById('projectSubmitBtn'),
  applySmartDefaultsBtn: document.getElementById('applySmartDefaultsBtn'),
  stackGuide: document.getElementById('stackGuide'),
  pName: document.getElementById('pName'),
  pRepo: document.getElementById('pRepo'),
  pBranch: document.getElementById('pBranch'),
  pFramework: document.getElementById('pFramework'),
  pPackageManager: document.getElementById('pPackageManager'),
  pMigrationTool: document.getElementById('pMigrationTool'),
  pMigration: document.getElementById('pMigration'),
  pInstall: document.getElementById('pInstall'),
  pBuild: document.getElementById('pBuild'),
  pStart: document.getElementById('pStart'),
  pRestart: document.getElementById('pRestart'),
  pOutput: document.getElementById('pOutput'),
  pDeployPath: document.getElementById('pDeployPath'),
  pEnv: document.getElementById('pEnv'),

  projectCardTemplate: document.getElementById('projectCardTemplate'),
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json().catch(() => ({})) : {};

  if (!isJson) {
    throw new Error(`Unexpected response format from ${url}. Expected JSON API response.`);
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function alertError(error) {
  window.alert(error.message || 'Unexpected error');
}

function formatDate(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function withStatusClass(element, status) {
  element.className = 'status-chip';
  if (status) {
    element.classList.add(`status-${status}`);
  }
}

function normalizeDeploymentStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (['pending', 'running', 'success', 'failed', 'cancelled'].includes(normalized)) {
    return normalized;
  }
  return 'unknown';
}

function formatDeploymentDuration(deployment) {
  if (Number.isFinite(deployment.duration_ms) && deployment.duration_ms > 0) {
    const seconds = Math.max(1, Math.round(deployment.duration_ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remSeconds = seconds % 60;
    return remSeconds ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
  }

  if (deployment.status === 'running' && deployment.started_at) {
    const runningFor = Math.max(1, Math.round((Date.now() - new Date(deployment.started_at).getTime()) / 1000));
    if (runningFor < 60) return `running ${runningFor}s`;
    const minutes = Math.floor(runningFor / 60);
    return `running ${minutes}m`;
  }

  return '-';
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.selectedProjectId) || null;
}

function setLogs(text) {
  els.logsViewer.textContent = text || '';
  els.logsViewer.scrollTop = els.logsViewer.scrollHeight;
}

function appendLogLine(line) {
  els.logsViewer.textContent += `${line}\n`;
  els.logsViewer.scrollTop = els.logsViewer.scrollHeight;
}

function showCopyLogStatus(message) {
  els.copyLogStatus.textContent = message;
  els.copyLogStatus.classList.remove('hidden');
  window.setTimeout(() => {
    els.copyLogStatus.classList.add('hidden');
  }, 1800);
}

async function copyLogsToClipboard() {
  const text = String(els.logsViewer.textContent || '').trim();
  if (!text) {
    showCopyLogStatus('No logs to copy');
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (!ok) {
        throw new Error('copy-failed');
      }
    }
    showCopyLogStatus('Copied');
  } catch (_error) {
    showCopyLogStatus('Copy failed');
  }
}

function showServerEditor(mode) {
  if (mode === 'edit') {
    els.serverSubmitBtn.textContent = 'Update Server';
    els.serverFormHint.textContent = 'Editing server. Leave password/private key empty to keep existing secret.';
    els.sPassword.placeholder = 'For edit: leave empty to keep unchanged';
    els.sPrivateKey.placeholder = 'For edit: leave empty to keep existing key';
  } else {
    els.serverSubmitBtn.textContent = 'Save Server';
    els.serverFormHint.textContent = 'Create new SSH target for this project.';
    els.sPassword.placeholder = 'Required for password auth';
    els.sPrivateKey.placeholder = 'Paste private key for key auth';
  }

  els.serverFormWrap.classList.remove('hidden');
  els.cancelServerEditBtn.classList.toggle('hidden', mode === 'create' && state.servers.length === 0);
}

function hideServerEditor() {
  const keepVisibleForFirst = state.servers.length === 0;
  if (!keepVisibleForFirst) {
    els.serverFormWrap.classList.add('hidden');
  }
  state.editingServerId = null;
  resetServerForm();
}

function toggleServerAuthFields() {
  const isKey = els.sAuthType.value === 'key';
  els.serverPasswordRow.classList.toggle('hidden', isKey);
  els.serverKeyRow.classList.toggle('hidden', !isKey);
}

function resetServerForm() {
  els.serverForm.reset();
  els.sPort.value = '22';
  els.sDefault.value = 'false';
  els.sAuthType.value = 'password';
  els.sPassword.value = '';
  els.sPrivateKey.value = '';
  els.sPassphrase.value = '';
  toggleServerAuthFields();
}

function toggleEnvBulkSection(show) {
  els.envBulkSection.classList.toggle('hidden', !show);
  els.toggleEnvBulkBtn.textContent = show ? 'Close Editor' : 'Edit .env';

  if (show) {
    const content = state.envVars
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => `${entry.key}=${entry.value}`)
      .join('\n');
    els.envBulkInput.value = content;
  }
}

function updateEnvToolbar(total, limit) {
  els.envCountBadge.textContent = `${total} key${total === 1 ? '' : 's'}`;

  const canExpand = total > limit;
  if (!canExpand) {
    state.envExpanded = false;
  }

  els.toggleEnvExpandBtn.classList.toggle('hidden', !canExpand);
  if (canExpand) {
    els.toggleEnvExpandBtn.textContent = state.envExpanded ? 'See less' : `See all (${total})`;
  }
}

async function loadQueue() {
  try {
    const data = await api('/api/queue');
    const queue = data.queue || {};
    const pending = Number.isFinite(queue.pending) ? queue.pending : Number(queue.length || 0);
    const runningCount = Number.isFinite(queue.running_count) ? queue.running_count : (queue.running ? 1 : 0);
    els.queueChip.textContent = `Queue: ${pending} | Running: ${runningCount}`;
  } catch (_error) {
    els.queueChip.textContent = 'Queue: unavailable';
  }
}

async function loadProjects() {
  const data = await api('/api/projects');
  state.projects = data.projects || [];

  if (state.selectedProjectId && !state.projects.some((project) => project.id === state.selectedProjectId)) {
    state.selectedProjectId = null;
    state.selectedDeploymentId = null;
    state.selectedServerId = '';
  }

  if (!state.selectedProjectId && state.projects.length > 0) {
    state.selectedProjectId = state.projects[0].id;
  }

  renderProjects();
  await renderProjectDetails();
}

function renderProjects() {
  els.projectsList.innerHTML = '';

  if (state.projects.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No projects yet. Create your first project.';
    els.projectsList.appendChild(empty);
    return;
  }

  for (const project of state.projects) {
    const card = els.projectCardTemplate.content.firstElementChild.cloneNode(true);
    if (project.id === state.selectedProjectId) {
      card.classList.add('active');
    }

    const nameEl = card.querySelector('.project-name');
    const lineEl = card.querySelector('.project-line');
    const metaEl = card.querySelectorAll('.project-line')[1];
    const statusEl = card.querySelector('.status-chip');
    const openBtn = card.querySelector('.select-btn');

    nameEl.textContent = project.name;
    lineEl.textContent = `${project.framework} | ${project.branch}`;
    metaEl.textContent = `Last deploy: ${formatDate(project.last_deployment_at)}`;
    statusEl.textContent = project.last_deployment_status || 'idle';
    withStatusClass(statusEl, project.last_deployment_status || '');

    openBtn.addEventListener('click', async () => {
      state.selectedProjectId = project.id;
      state.selectedDeploymentId = null;
      state.editingServerId = null;
      renderProjects();
      await renderProjectDetails();
    });

    els.projectsList.appendChild(card);
  }
}

async function renderProjectDetails() {
  const project = selectedProject();
  if (!project) {
    els.emptyState.classList.remove('hidden');
    els.projectDetails.classList.add('hidden');
    return;
  }

  els.emptyState.classList.add('hidden');
  els.projectDetails.classList.remove('hidden');
  els.projectName.textContent = project.name;
  els.projectMeta.textContent = `${project.framework} | branch: ${project.branch} | deploy path: ${project.deploy_path || '(remote default path if empty)'}`;

  await Promise.all([loadEnvVars(), loadMasterServers(), loadServers(), loadDeployments()]);
}

async function loadEnvVars() {
  const project = selectedProject();
  if (!project) return;

  const data = await api(`/api/projects/${project.id}/env?environment=production`);
  state.envVars = data.variables || [];
  renderEnvVars();
}

function renderEnvVars() {
  els.envList.innerHTML = '';

  const total = state.envVars.length;
  const limit = 14;
  updateEnvToolbar(total, limit);

  const sorted = state.envVars.slice().sort((a, b) => a.key.localeCompare(b.key));
  const rows = state.envExpanded ? sorted : sorted.slice(0, limit);

  if (total === 0) {
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = 'No production env variables defined.';
    els.envList.appendChild(line);
    return;
  }

  const code = document.createElement('pre');
  code.className = 'env-code-block';
  code.textContent = rows.map((entry) => `${entry.key}=${entry.value}`).join('\n');
  els.envList.appendChild(code);

  if (!state.envExpanded && total > limit) {
    const more = document.createElement('p');
    more.className = 'muted small';
    more.textContent = `+ ${total - limit} more keys (click See all)`;
    els.envList.appendChild(more);
  }
}

async function handleEnvBulkImport() {
  const project = selectedProject();
  if (!project) return;

  const content = els.envBulkInput.value.trim();
  if (!content) {
    window.alert('Paste .env content first.');
    return;
  }

  const result = await api(`/api/projects/${project.id}/env/bulk`, {
    method: 'POST',
    body: JSON.stringify({ environment: 'production', content }),
  });

  window.alert(`${result.imported} variable(s) applied.`);
  toggleEnvBulkSection(false);
  await loadEnvVars();
}

async function loadMasterServers() {
  const data = await api('/api/servers');
  state.masterServers = data.servers || [];
  renderAttachServerSelect();
}

function renderAttachServerSelect() {
  const project = selectedProject();
  if (!project) {
    return;
  }

  const linkedIds = new Set(state.servers.map((server) => server.id));
  const reusable = state.masterServers.filter((server) => !linkedIds.has(server.id));

  els.attachServerSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = reusable.length > 0 ? 'Attach existing server...' : 'No reusable server available';
  els.attachServerSelect.appendChild(placeholder);

  for (const server of reusable) {
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = `${server.name} (${server.username}@${server.host}:${server.port})`;
    els.attachServerSelect.appendChild(option);
  }

  els.attachServerSelect.disabled = reusable.length === 0;
  els.attachServerBtn.disabled = reusable.length === 0;
}

async function loadServers() {
  const project = selectedProject();
  if (!project) return;

  const data = await api(`/api/projects/${project.id}/servers`);
  state.servers = data.servers || [];

  if (!state.servers.some((server) => server.id === state.selectedServerId)) {
    const defaultServer = state.servers.find((server) => server.default_server);
    state.selectedServerId = defaultServer ? defaultServer.id : '';
  }

  renderServers();
  renderDeployServerSelect();
  renderAttachServerSelect();

  els.showServerFormBtn.classList.toggle('hidden', state.servers.length > 0);
  els.addServerBtn.textContent = state.servers.length > 0 ? '+ Add Server' : 'Add Server';

  if (state.servers.length === 0 && !state.editingServerId) {
    showServerEditor('create');
  } else if (!state.editingServerId) {
    els.serverFormWrap.classList.add('hidden');
  }
}

async function handleAttachServer() {
  const project = selectedProject();
  if (!project) return;

  const serverId = String(els.attachServerSelect.value || '').trim();
  if (!serverId) {
    window.alert('Select a server to attach.');
    return;
  }

  const shouldBeDefault = state.servers.length === 0 || !state.servers.some((server) => server.default_server);
  await api(`/api/projects/${project.id}/servers/attach`, {
    method: 'POST',
    body: JSON.stringify({
      server_id: serverId,
      default_server: shouldBeDefault,
    }),
  });

  els.attachServerSelect.value = '';
  await Promise.all([loadMasterServers(), loadServers()]);
}

function renderDeployServerSelect() {
  els.deployServerSelect.innerHTML = '';

  const fallbackOption = document.createElement('option');
  fallbackOption.value = '';
  fallbackOption.textContent = 'Use default server (or local if none)';
  els.deployServerSelect.appendChild(fallbackOption);

  for (const server of state.servers) {
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = `${server.name} (${server.username}@${server.host})${server.default_server ? ' [default]' : ''}`;
    els.deployServerSelect.appendChild(option);
  }

  els.deployServerSelect.value = state.selectedServerId || '';
}

function beginCreateServer() {
  state.editingServerId = null;
  resetServerForm();
  showServerEditor('create');
}

function beginEditServer(server) {
  state.editingServerId = server.id;
  resetServerForm();

  els.sName.value = server.name || '';
  els.sHost.value = server.host || '';
  els.sPort.value = String(server.port || 22);
  els.sUser.value = server.username || '';
  els.sAuthType.value = server.auth_type || 'password';
  els.sDefault.value = server.default_server ? 'true' : 'false';
  els.sPassword.value = '';
  els.sPrivateKey.value = '';
  els.sPassphrase.value = '';

  toggleServerAuthFields();
  showServerEditor('edit');
}

function renderServers() {
  els.serverList.innerHTML = '';

  if (state.servers.length === 0) {
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = 'No SSH server configured yet.';
    els.serverList.appendChild(line);
    return;
  }

  for (const server of state.servers) {
    const item = document.createElement('div');
    item.className = 'server-item';
    if (state.editingServerId === server.id) {
      item.classList.add('active');
    }

    const left = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = server.name;
    const breakLine = document.createElement('br');
    const info = document.createElement('span');
    info.className = 'muted';
    const sharedLabel = Number(server.project_count || 0) > 1 ? ` | shared(${server.project_count})` : '';
    info.textContent = `${server.username}@${server.host}:${server.port} | ${server.auth_type}${server.default_server ? ' | default' : ''}${sharedLabel}`;
    left.appendChild(title);
    left.appendChild(breakLine);
    left.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'actions-row';

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-ghost btn-small';
    testBtn.textContent = 'Test';
    testBtn.addEventListener('click', async () => {
      const result = await api(`/api/servers/${server.id}/test`, { method: 'POST' });
      window.alert(result.message || 'SSH connection successful');
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary btn-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => beginEditServer(server));

    const defaultBtn = document.createElement('button');
    defaultBtn.className = 'btn btn-secondary btn-small';
    defaultBtn.textContent = 'Set Default';
    defaultBtn.disabled = server.default_server;
    defaultBtn.addEventListener('click', async () => {
      const project = selectedProject();
      if (!project) return;
      await api(`/api/servers/${server.id}/default`, {
        method: 'POST',
        body: JSON.stringify({ project_id: project.id }),
      });
      await loadServers();
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-small';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async () => {
      const project = selectedProject();
      if (!project) return;
      if (!window.confirm(`Detach server ${server.name} from this project?`)) return;
      await api(`/api/servers/${server.id}?project_id=${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      if (state.editingServerId === server.id) {
        state.editingServerId = null;
      }
      await Promise.all([loadMasterServers(), loadServers()]);
    });

    actions.appendChild(testBtn);
    actions.appendChild(editBtn);
    actions.appendChild(defaultBtn);
    actions.appendChild(delBtn);

    item.appendChild(left);
    item.appendChild(actions);
    els.serverList.appendChild(item);
  }
}

async function handleSaveServer(event) {
  event.preventDefault();
  const project = selectedProject();
  if (!project) return;

  const payload = {
    name: els.sName.value,
    host: els.sHost.value,
    port: Number(els.sPort.value || 22),
    username: els.sUser.value,
    auth_type: els.sAuthType.value,
    password: els.sPassword.value,
    private_key: els.sPrivateKey.value,
    passphrase: els.sPassphrase.value,
    default_server: els.sDefault.value === 'true',
  };

  if (state.editingServerId) {
    await api(`/api/servers/${state.editingServerId}`, {
      method: 'PUT',
      body: JSON.stringify({ ...payload, project_id: project.id }),
    });
  } else {
    const created = await api(`/api/projects/${project.id}/servers`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!created || !created.server || !created.server.id) {
      throw new Error('Server save did not return a valid server record');
    }
  }

  window.alert(state.editingServerId ? 'Server updated.' : 'Server added.');
  state.editingServerId = null;
  resetServerForm();
  await Promise.all([loadMasterServers(), loadServers()]);
  hideServerEditor();
}

async function loadDeployments() {
  const project = selectedProject();
  if (!project) return;

  if (state.deploymentHistoryProjectId !== project.id) {
    state.deploymentHistoryProjectId = project.id;
    state.deploymentFilter = 'all';
    state.deploymentsVisibleLimit = DEPLOYMENTS_PAGE_SIZE;
    state.expandedDeploymentIds = new Set();
  }

  const data = await api(`/api/projects/${project.id}/deployments?limit=50`);
  state.deployments = data.deployments || [];
  const existing = new Set(state.deployments.map((deployment) => deployment.id));
  state.expandedDeploymentIds = new Set(
    [...state.expandedDeploymentIds].filter((deploymentId) => existing.has(deploymentId))
  );
  renderDeployments();
}

function renderDeployments() {
  els.deploymentsList.innerHTML = '';
  els.deploymentHistoryFilters.innerHTML = '';
  els.deploymentHistoryMeta.innerHTML = '';
  els.deploymentHistoryMoreRow.classList.add('hidden');

  if (state.deployments.length === 0) {
    const totalChip = document.createElement('span');
    totalChip.className = 'chip small-chip';
    totalChip.textContent = '0 deployments';
    els.deploymentHistoryMeta.appendChild(totalChip);

    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = 'No deployments yet.';
    els.deploymentsList.appendChild(line);
    return;
  }

  const counts = {
    all: state.deployments.length,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const deployment of state.deployments) {
    const status = normalizeDeploymentStatus(deployment.status);
    if (status in counts) {
      counts[status] += 1;
    }
  }

  const filterDefs = [
    { key: 'all', label: 'All' },
    { key: 'running', label: 'Running' },
    { key: 'pending', label: 'Pending' },
    { key: 'success', label: 'Success' },
    { key: 'failed', label: 'Failed' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  for (const filter of filterDefs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `history-filter-chip ${state.deploymentFilter === filter.key ? 'active' : ''}`;
    button.textContent = `${filter.label} (${counts[filter.key] || 0})`;
    button.addEventListener('click', () => {
      state.deploymentFilter = filter.key;
      state.deploymentsVisibleLimit = DEPLOYMENTS_PAGE_SIZE;
      renderDeployments();
    });
    els.deploymentHistoryFilters.appendChild(button);
  }

  const filtered = state.deploymentFilter === 'all'
    ? state.deployments
    : state.deployments.filter((deployment) => normalizeDeploymentStatus(deployment.status) === state.deploymentFilter);

  const visible = filtered.slice(0, state.deploymentsVisibleLimit);

  const totalChip = document.createElement('span');
  totalChip.className = 'chip small-chip';
  totalChip.textContent = `${filtered.length} deployment${filtered.length === 1 ? '' : 's'}`;
  els.deploymentHistoryMeta.appendChild(totalChip);

  const showingChip = document.createElement('span');
  showingChip.className = 'chip small-chip';
  showingChip.textContent = `Showing ${visible.length}`;
  els.deploymentHistoryMeta.appendChild(showingChip);

  if (state.deploymentFilter !== 'all') {
    const filterChip = document.createElement('span');
    filterChip.className = 'chip small-chip';
    filterChip.textContent = `Filter: ${state.deploymentFilter}`;
    els.deploymentHistoryMeta.appendChild(filterChip);
  }

  if (filtered.length === 0) {
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = 'No deployments match this filter.';
    els.deploymentsList.appendChild(line);
    return;
  }

  for (const deployment of visible) {
    const status = normalizeDeploymentStatus(deployment.status);
    const details = document.createElement('details');
    details.className = `deployment-accordion deployment-${status}`;
    if (state.selectedDeploymentId === deployment.id) {
      details.classList.add('active');
    }
    if (state.expandedDeploymentIds.has(deployment.id)) {
      details.open = true;
    }
    details.addEventListener('toggle', () => {
      if (details.open) {
        state.expandedDeploymentIds.add(deployment.id);
      } else {
        state.expandedDeploymentIds.delete(deployment.id);
      }
    });

    const summary = document.createElement('summary');
    summary.className = 'deployment-summary';

    const summaryLeft = document.createElement('div');
    summaryLeft.className = 'deployment-summary-left';

    const idLine = document.createElement('div');
    idLine.className = 'deployment-mainline';
    idLine.textContent = `#${deployment.id.slice(0, 8)} · ${deployment.branch || 'n/a'}`;

    const serverLine = document.createElement('div');
    serverLine.className = 'deployment-subline';
    const serverText = deployment.server_name ? deployment.server_name : 'default/local';
    serverLine.textContent = `${serverText} · ${formatDate(deployment.created_at)}`;

    summaryLeft.appendChild(idLine);
    summaryLeft.appendChild(serverLine);

    const summaryRight = document.createElement('div');
    summaryRight.className = 'deployment-summary-right';

    const statusChip = document.createElement('span');
    withStatusClass(statusChip, status);
    statusChip.textContent = status;

    const durationChip = document.createElement('span');
    durationChip.className = 'chip small-chip';
    durationChip.textContent = formatDeploymentDuration(deployment);

    const caret = document.createElement('span');
    caret.className = 'deployment-caret';
    caret.textContent = '▾';

    summaryRight.appendChild(statusChip);
    summaryRight.appendChild(durationChip);
    summaryRight.appendChild(caret);

    summary.appendChild(summaryLeft);
    summary.appendChild(summaryRight);
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'deployment-details';

    const infoGrid = document.createElement('div');
    infoGrid.className = 'deployment-detail-grid';

    const commitHash = String(deployment.commit_hash || '');
    const commitMatch = commitHash.match(/[0-9a-f]{7,40}/i);
    const commitValue = commitMatch ? commitMatch[0].slice(0, 8) : '-';

    const detailPairs = [
      ['Trigger', deployment.trigger_type || '-'],
      ['Environment', deployment.environment || '-'],
      ['Server', deployment.server_name || 'default/local'],
      ['Commit', commitValue],
      ['Duration', formatDeploymentDuration(deployment)],
    ];

    if (deployment.release_path) {
      detailPairs.push(['Release', deployment.release_path]);
    }

    for (const [label, value] of detailPairs) {
      const item = document.createElement('div');
      item.className = 'deployment-detail';

      const key = document.createElement('span');
      key.className = 'deployment-detail-key';
      key.textContent = label;

      const val = document.createElement('span');
      val.className = 'deployment-detail-value';
      val.textContent = value;

      item.appendChild(key);
      item.appendChild(val);
      infoGrid.appendChild(item);
    }

    body.appendChild(infoGrid);

    if (deployment.error_message) {
      const errorLine = document.createElement('p');
      errorLine.className = 'deployment-error';
      errorLine.textContent = deployment.error_message;
      body.appendChild(errorLine);
    }

    const actions = document.createElement('div');
    actions.className = 'actions-row deployment-actions';

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-ghost btn-small';
    viewBtn.textContent = 'Logs';
    viewBtn.addEventListener('click', () => openDeploymentLogs(deployment.id));

    const redeployBtn = document.createElement('button');
    redeployBtn.className = 'btn btn-secondary btn-small';
    redeployBtn.textContent = 'Redeploy';
    redeployBtn.addEventListener('click', async () => {
      await api(`/api/deployments/${deployment.id}/redeploy`, { method: 'POST' });
      await Promise.all([loadDeployments(), loadProjects(), loadQueue()]);
    });

    actions.appendChild(viewBtn);
    actions.appendChild(redeployBtn);

    if (status === 'pending' || status === 'running') {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-danger btn-small';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', async () => {
        await api(`/api/deployments/${deployment.id}/cancel`, { method: 'POST' });
        await Promise.all([loadDeployments(), loadProjects(), loadQueue()]);
      });
      actions.appendChild(cancelBtn);
    }

    if (status !== 'running') {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-ghost btn-small';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (!window.confirm('Delete deployment record?')) return;
        await api(`/api/deployments/${deployment.id}`, { method: 'DELETE' });
        if (state.selectedDeploymentId === deployment.id) {
          state.selectedDeploymentId = null;
          els.activeLogLabel.textContent = 'No deployment selected';
          setLogs('Select a deployment to view logs...');
        }
        await Promise.all([loadDeployments(), loadProjects(), loadQueue()]);
      });
      actions.appendChild(delBtn);
    }

    body.appendChild(actions);
    details.appendChild(body);
    els.deploymentsList.appendChild(details);
  }

  const remaining = filtered.length - visible.length;
  if (remaining > 0) {
    els.deploymentHistoryMoreRow.classList.remove('hidden');
    els.deploymentsShowMoreBtn.textContent = `Show more (${remaining} left)`;
  }
}

async function openDeploymentLogs(deploymentId) {
  const data = await api(`/api/deployments/${deploymentId}`);
  state.selectedDeploymentId = deploymentId;
  els.activeLogLabel.textContent = `Deployment ${deploymentId.slice(0, 8)} (${data.deployment.status})`;
  setLogs(data.deployment.logs || 'No logs yet.');
  renderDeployments();
  subscribeToDeploymentLogs(deploymentId);
}

function subscribeToDeploymentLogs(deploymentId) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  state.socket.send(JSON.stringify({ type: 'subscribe', deploymentId }));
}

function connectSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  state.socket = socket;

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe_all' }));
    if (state.selectedDeploymentId) {
      subscribeToDeploymentLogs(state.selectedDeploymentId);
    }
  });

  socket.addEventListener('message', async (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === 'deployment:log' && payload.deploymentId === state.selectedDeploymentId) {
        appendLogLine(payload.message);
      }

      if (payload.type === 'deployment:status') {
        const project = selectedProject();
        if (project) {
          await Promise.all([loadDeployments(), loadProjects(), loadQueue()]);
        }
      }
    } catch (error) {
      console.error(error);
    }
  });

  socket.addEventListener('close', () => {
    setTimeout(connectSocket, 1200);
  });
}

function resetProjectForm() {
  els.projectForm.reset();
  els.pBranch.value = 'main';
  els.pFramework.value = 'node';
  els.pPackageManager.value = 'npm';
  els.pMigrationTool.value = 'none';
  els.pMigration.value = '';
  els.pEnv.value = '';
  state.editingProjectId = null;
}

function toAppName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'app';
}

async function fillProjectDefaults(framework, force = false, fillEmpty = true) {
  const params = new URLSearchParams();
  params.set('package_manager', els.pPackageManager.value || 'npm');
  params.set('migration_tool', els.pMigrationTool.value || 'none');
  const defaults = await api(`/api/defaults/${framework}?${params.toString()}`);

  const appName = toAppName(els.pName.value);
  const withAppName = (command) => String(command || '').replace(/<app-name>/g, appName);
  const installDefault = defaults.install || '';
  const buildDefault = defaults.build || '';
  const startDefault = withAppName(defaults.start || '');
  const restartDefault = withAppName(defaults.restart || '');
  const migrationDefault = defaults.migration || '';

  if (force || (fillEmpty && !els.pInstall.value.trim())) els.pInstall.value = installDefault;
  if (force || (fillEmpty && !els.pBuild.value.trim())) els.pBuild.value = buildDefault;
  if (force || (fillEmpty && !els.pStart.value.trim())) els.pStart.value = startDefault;
  if (force || (fillEmpty && !els.pRestart.value.trim())) els.pRestart.value = restartDefault;
  if (force || (fillEmpty && !els.pMigration.value.trim())) els.pMigration.value = migrationDefault;
  if (force || (fillEmpty && !els.pOutput.value.trim())) els.pOutput.value = defaults.outputDir || '';
  els.stackGuide.textContent = defaults.guide || '';
}

function openProjectDialog(mode) {
  resetProjectForm();

  if (mode === 'create') {
    els.projectDialogTitle.textContent = 'New Project';
    els.projectSubmitBtn.textContent = 'Create Project';
    els.projectDialog.showModal();
    fillProjectDefaults('node', true).catch(console.error);
    return;
  }

  const project = selectedProject();
  if (!project) return;

  state.editingProjectId = project.id;
  els.projectDialogTitle.textContent = 'Edit Project';
  els.projectSubmitBtn.textContent = 'Save Changes';
  els.pName.value = project.name || '';
  els.pRepo.value = project.repo_url || '';
  els.pBranch.value = project.branch || 'main';
  els.pFramework.value = project.framework || 'node';
  els.pPackageManager.value = project.package_manager || 'npm';
  els.pMigrationTool.value = project.migration_tool || 'none';
  els.pMigration.value = project.migration_command || '';
  els.pInstall.value = project.install_command || '';
  els.pBuild.value = project.build_command || '';
  els.pStart.value = project.start_command || '';
  els.pRestart.value = project.restart_command || '';
  els.pOutput.value = project.output_dir || '';
  els.pDeployPath.value = project.deploy_path || '';
  els.pEnv.value = '';

  els.projectDialog.showModal();
  fillProjectDefaults(els.pFramework.value, false, false).catch(console.error);
}

async function saveProject(event) {
  event.preventDefault();
  const appName = toAppName(els.pName.value);
  const resolveAppName = (command) => String(command || '').replace(/<app-name>/g, appName);

  const payload = {
    name: els.pName.value,
    repo_url: els.pRepo.value,
    branch: els.pBranch.value,
    framework: els.pFramework.value,
    package_manager: els.pPackageManager.value,
    migration_tool: els.pMigrationTool.value,
    migration_command: els.pMigration.value,
    install_command: els.pInstall.value,
    build_command: els.pBuild.value,
    start_command: resolveAppName(els.pStart.value),
    restart_command: resolveAppName(els.pRestart.value),
    output_dir: els.pOutput.value,
    deploy_path: els.pDeployPath.value,
    auto_deploy: false,
    env_content: els.pEnv.value,
  };

  if (state.editingProjectId) {
    await api(`/api/projects/${state.editingProjectId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  } else {
    await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  els.projectDialog.close();
  await Promise.all([loadProjects(), loadQueue()]);
}

async function handleDeploy() {
  const project = selectedProject();
  if (!project) return;

  await api(`/api/projects/${project.id}/deploy`, {
    method: 'POST',
    body: JSON.stringify({
      environment: 'production',
      server_id: state.selectedServerId || null,
    }),
  });

  await Promise.all([loadDeployments(), loadProjects(), loadQueue()]);
}

async function handleDeleteProject() {
  const project = selectedProject();
  if (!project) return;

  if (!window.confirm(`Delete project ${project.name}? This removes env vars, servers, and deployment history.`)) {
    return;
  }

  await api(`/api/projects/${project.id}`, { method: 'DELETE' });
  state.selectedProjectId = null;
  state.selectedDeploymentId = null;
  state.selectedServerId = '';
  state.editingServerId = null;
  await Promise.all([loadProjects(), loadQueue()]);
  setLogs('Select a deployment to view logs...');
}

function registerEvents() {
  els.refreshProjectsBtn.addEventListener('click', () => {
    Promise.all([loadProjects(), loadQueue()]).catch(alertError);
  });

  els.newProjectBtn.addEventListener('click', () => openProjectDialog('create'));
  els.editProjectBtn.addEventListener('click', () => openProjectDialog('edit'));
  els.deleteProjectBtn.addEventListener('click', () => {
    handleDeleteProject().catch(alertError);
  });
  els.deployBtn.addEventListener('click', () => {
    handleDeploy().catch(alertError);
  });

  els.deployServerSelect.addEventListener('change', () => {
    state.selectedServerId = els.deployServerSelect.value || '';
  });

  els.toggleEnvBulkBtn.addEventListener('click', () => {
    const willShow = els.envBulkSection.classList.contains('hidden');
    toggleEnvBulkSection(willShow);
  });

  els.toggleEnvExpandBtn.addEventListener('click', () => {
    state.envExpanded = !state.envExpanded;
    renderEnvVars();
  });

  els.cancelEnvBulkBtn.addEventListener('click', () => {
    toggleEnvBulkSection(false);
  });

  els.importEnvBtn.addEventListener('click', () => {
    handleEnvBulkImport().catch(alertError);
  });

  els.addServerBtn.addEventListener('click', () => beginCreateServer());
  els.showServerFormBtn.addEventListener('click', () => beginCreateServer());
  els.serverForm.addEventListener('submit', (event) => {
    handleSaveServer(event).catch(alertError);
  });
  els.cancelServerEditBtn.addEventListener('click', () => {
    state.editingServerId = null;
    hideServerEditor();
  });

  els.sAuthType.addEventListener('change', () => toggleServerAuthFields());

  els.copyLogBtn.addEventListener('click', () => {
    copyLogsToClipboard().catch(alertError);
  });
  els.clearLogBtn.addEventListener('click', () => setLogs(''));
  els.deploymentsShowMoreBtn.addEventListener('click', () => {
    state.deploymentsVisibleLimit += DEPLOYMENTS_PAGE_SIZE;
    renderDeployments();
  });

  els.closeDialogBtn.addEventListener('click', () => {
    els.projectDialog.close();
  });

  els.projectForm.addEventListener('submit', (event) => {
    saveProject(event).catch(alertError);
  });

  els.pFramework.addEventListener('change', () => {
    const isCreate = !state.editingProjectId;
    fillProjectDefaults(els.pFramework.value, isCreate, true).catch(alertError);
  });

  els.pPackageManager.addEventListener('change', () => {
    const isCreate = !state.editingProjectId;
    fillProjectDefaults(els.pFramework.value, isCreate, true).catch(alertError);
  });

  els.pMigrationTool.addEventListener('change', () => {
    const isCreate = !state.editingProjectId;
    fillProjectDefaults(els.pFramework.value, isCreate, true).catch(alertError);
  });

  els.applySmartDefaultsBtn.addEventListener('click', () => {
    fillProjectDefaults(els.pFramework.value, true, true).catch(alertError);
  });

  els.attachServerBtn.addEventListener('click', () => {
    handleAttachServer().catch(alertError);
  });
}

async function init() {
  registerEvents();
  toggleServerAuthFields();
  toggleEnvBulkSection(false);
  connectSocket();
  await Promise.all([loadProjects(), loadQueue()]);

  setInterval(() => {
    Promise.all([loadProjects(), loadQueue()]).catch(() => {});
  }, 12000);

  setInterval(() => {
    if (!selectedProject()) return;
    Promise.all([loadDeployments(), loadQueue()]).catch(() => {});
  }, 6000);
}

init().catch(alertError);

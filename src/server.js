require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { WebSocketServer, WebSocket } = require('ws');
const { Client } = require('ssh2');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');

const { createDb, nowIso } = require('./db');
const { DeployRunner, defaultCommands } = require('./deployRunner');
const { encryptSecret, decryptSecret, DEFAULT_KEY } = require('./crypto');

const PORT = Number(process.env.PORT || 3000);
const DATABASE_PATH = path.resolve(process.cwd(), process.env.DATABASE_PATH || './data/sshipit.db');
const WORKSPACE_ROOT = path.resolve(process.cwd(), process.env.WORKSPACE_ROOT || './data/workspaces');
const KEEP_RELEASES = Number(process.env.KEEP_RELEASES || 5);

if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY === DEFAULT_KEY) {
  // eslint-disable-next-line no-console
  console.warn('Warning: ENCRYPTION_KEY is not set. Configure it in .env for secure credential storage.');
}

fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });

const db = createDb(DATABASE_PATH);
const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(morgan('dev'));

const projectSchema = z.object({
  name: z.string().min(1),
  repo_url: z.string().min(3),
  branch: z.string().min(1).default('main'),
  framework: z.string().min(1).default('node'),
  package_manager: z.string().min(1).default('npm'),
  migration_tool: z.string().min(1).default('none'),
  migration_command: z.string().optional().default(''),
  install_command: z.string().optional().default(''),
  build_command: z.string().optional().default(''),
  start_command: z.string().optional().default(''),
  restart_command: z.string().optional().default(''),
  output_dir: z.string().optional().default(''),
  deploy_path: z.string().optional().default(''),
  auto_deploy: z.boolean().optional().default(false),
  env_content: z.string().optional().default(''),
});

const envSchema = z.object({
  environment: z.string().min(1).default('production'),
  key: z.string().min(1),
  value: z.string(),
});

const envBulkSchema = z.object({
  environment: z.string().min(1).default('production'),
  content: z.string().min(1),
});

const deploySchema = z.object({
  environment: z.string().min(1).default('production'),
  server_id: z.string().uuid().nullable().optional().default(null),
});

const serverSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional().default(22),
  username: z.string().min(1),
  auth_type: z.enum(['password', 'key']),
  password: z.string().optional().default(''),
  private_key: z.string().optional().default(''),
  passphrase: z.string().optional().default(''),
  default_server: z.boolean().optional().default(false),
});

const serverUpdateSchema = serverSchema.extend({
  project_id: z.string().uuid().optional().default(''),
});

const serverAttachSchema = z.object({
  server_id: z.string().uuid(),
  default_server: z.boolean().optional().default(false),
});

function normalizeProject(payload) {
  return {
    ...payload,
    name: payload.name.trim(),
    repo_url: payload.repo_url.trim(),
    branch: payload.branch.trim(),
    framework: payload.framework.trim().toLowerCase(),
    package_manager: payload.package_manager.trim().toLowerCase(),
    migration_tool: payload.migration_tool.trim().toLowerCase(),
    migration_command: payload.migration_command.trim(),
    install_command: payload.install_command.trim(),
    build_command: payload.build_command.trim(),
    start_command: payload.start_command.trim(),
    restart_command: payload.restart_command.trim(),
    output_dir: payload.output_dir.trim(),
    deploy_path: payload.deploy_path.trim(),
    auto_deploy: payload.auto_deploy ? 1 : 0,
  };
}

function normalizeEnv(payload) {
  return {
    ...payload,
    environment: payload.environment.trim(),
    key: payload.key.trim(),
  };
}

function parseEnvContent(content) {
  const lines = String(content || '').split(/\r?\n/);
  const parsed = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed.push({ key, value });
  }

  return parsed;
}

function normalizeServer(payload) {
  return {
    ...payload,
    name: payload.name.trim(),
    host: payload.host.trim(),
    username: payload.username.trim(),
    auth_type: payload.auth_type,
    port: Number(payload.port || 22),
    password: payload.password || '',
    private_key: payload.private_key || '',
    passphrase: payload.passphrase || '',
    default_server: payload.default_server ? 1 : 0,
  };
}

function assertServerAuth(payload, { allowEmptySecret = false } = {}) {
  if (payload.auth_type === 'password') {
    if (!allowEmptySecret && !payload.password.trim()) {
      return 'Password is required for password-based SSH authentication';
    }
    return null;
  }

  if (!allowEmptySecret && !payload.private_key.trim()) {
    return 'Private key is required for key-based SSH authentication';
  }
  return null;
}

function publicProject(project) {
  if (!project) {
    return null;
  }

  return {
    ...project,
    auto_deploy: Boolean(project.auto_deploy),
  };
}

function publicServer(server) {
  if (!server) {
    return null;
  }

  return {
    id: server.id,
    project_id: server.project_id,
    owner_project_id: server.owner_project_id || server.project_id,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth_type: server.auth_type,
    default_server: Boolean(server.default_server),
    project_count: Number(server.project_count || 0),
    created_at: server.created_at,
    updated_at: server.updated_at,
  };
}

function queueStatus(runner) {
  const pending = runner.queue.length;
  const runningCount = runner.isRunning ? 1 : 0;
  return {
    length: pending, // backward compatibility
    running: runner.isRunning, // backward compatibility
    pending,
    running_count: runningCount,
    total_active: pending + runningCount,
  };
}

async function verifyServerConnection(serverRecord) {
  const auth = JSON.parse(decryptSecret(serverRecord.encrypted_auth));

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const config = {
      host: serverRecord.host,
      port: Number(serverRecord.port) || 22,
      username: serverRecord.username,
      readyTimeout: 12000,
    };

    if (serverRecord.auth_type === 'password') {
      config.password = auth.password;
    } else {
      config.privateKey = auth.private_key;
      if (auth.passphrase) {
        config.passphrase = auth.passphrase;
      }
    }

    conn.on('ready', () => {
      conn.exec('echo LOCALDEPLOY_SSH_OK', (error, channel) => {
        if (error) {
          conn.end();
          reject(error);
          return;
        }

        let output = '';
        channel.on('data', (chunk) => {
          output += chunk.toString('utf8');
        });

        channel.on('close', (code) => {
          conn.end();
          if (code === 0 && output.includes('LOCALDEPLOY_SSH_OK')) {
            resolve(true);
            return;
          }
          reject(new Error('SSH test command did not complete successfully'));
        });
      });
    });

    conn.on('error', (error) => reject(error));
    conn.connect(config);
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function sendWs(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastLog(payload) {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) {
      continue;
    }

    if (ws.subscriptions.has(payload.deploymentId) || ws.subscriptions.has('*')) {
      sendWs(ws, { type: 'deployment:log', ...payload });
    }
  }
}

function broadcastStatus(payload) {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) {
      continue;
    }

    if (payload.deploymentId && !(ws.subscriptions.has(payload.deploymentId) || ws.subscriptions.has('*'))) {
      continue;
    }

    sendWs(ws, { ...payload, type: 'deployment:status' });
  }
}

const runner = new DeployRunner({
  db,
  workspaceRoot: WORKSPACE_ROOT,
  keepReleases: KEEP_RELEASES,
  onLog: broadcastLog,
  onStatus: broadcastStatus,
  decryptSecret,
});

wss.on('connection', (ws) => {
  ws.subscriptions = new Set();
  sendWs(ws, {
    type: 'hello',
    message: 'Connected to SSHipIt websocket',
  });

  ws.on('message', (buffer) => {
    try {
      const data = JSON.parse(buffer.toString('utf8'));
      if (data.type === 'subscribe' && data.deploymentId) {
        ws.subscriptions.add(data.deploymentId);
        sendWs(ws, { type: 'subscribed', deploymentId: data.deploymentId });
      }

      if (data.type === 'unsubscribe' && data.deploymentId) {
        ws.subscriptions.delete(data.deploymentId);
        sendWs(ws, { type: 'unsubscribed', deploymentId: data.deploymentId });
      }

      if (data.type === 'subscribe_all') {
        ws.subscriptions.add('*');
      }
    } catch (_error) {
      sendWs(ws, { type: 'error', message: 'Invalid websocket payload' });
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sshipit',
    queue: queueStatus(runner),
    uptimeSec: Math.round(process.uptime()),
  });
});

app.get('/api/defaults/:framework', (req, res) => {
  const defaults = defaultCommands(req.params.framework, {
    packageManager: req.query.package_manager ? String(req.query.package_manager) : undefined,
    migrationTool: req.query.migration_tool ? String(req.query.migration_tool) : undefined,
  });
  res.json(defaults);
});

app.get('/api/projects', (_req, res) => {
  const projects = db.listProjects().map(publicProject);
  res.json({ projects });
});

app.get('/api/projects/:id', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  return res.json({ project: publicProject(project) });
});

app.post('/api/projects', (req, res) => {
  const parsed = projectSchema.parse(req.body || {});
  const normalized = normalizeProject(parsed);
  const createdAt = nowIso();

  const created = db.createProject({
    id: uuidv4(),
    ...normalized,
    created_at: createdAt,
    updated_at: createdAt,
  });

  const envContent = String(parsed.env_content || '').trim();
  if (envContent) {
    const pairs = parseEnvContent(envContent);
    if (pairs.length > 0) {
      const rows = pairs.map((entry) => ({
        id: uuidv4(),
        project_id: created.id,
        environment: 'production',
        key: entry.key,
        value: entry.value,
        created_at: createdAt,
        updated_at: createdAt,
      }));
      db.upsertEnvVars(rows);
    }
  }

  res.status(201).json({ project: publicProject(created) });
});

app.put('/api/projects/:id', (req, res) => {
  const existing = db.getProjectById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const parsed = projectSchema.parse(req.body || {});
  const normalized = normalizeProject(parsed);

  const updated = db.updateProject({
    id: req.params.id,
    ...normalized,
    updated_at: nowIso(),
  });

  const envContent = String(parsed.env_content || '').trim();
  if (envContent) {
    const pairs = parseEnvContent(envContent);
    if (pairs.length > 0) {
      const now = nowIso();
      const rows = pairs.map((entry) => ({
        id: uuidv4(),
        project_id: req.params.id,
        environment: 'production',
        key: entry.key,
        value: entry.value,
        created_at: now,
        updated_at: now,
      }));
      db.upsertEnvVars(rows);
    }
  }

  return res.json({ project: publicProject(updated) });
});

app.delete('/api/projects/:id', (req, res) => {
  const existing = db.getProjectById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Project not found' });
  }

  db.removeProject(req.params.id);
  return res.status(204).send();
});

app.get('/api/projects/:id/env', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const env = req.query.environment ? String(req.query.environment) : undefined;
  const variables = db.listEnvVars(req.params.id, env);
  return res.json({ variables });
});

app.post('/api/projects/:id/env', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const parsed = envSchema.parse(req.body || {});
  const normalized = normalizeEnv(parsed);
  const createdAt = nowIso();

  const variable = db.createEnvVar({
    id: uuidv4(),
    project_id: req.params.id,
    ...normalized,
    created_at: createdAt,
    updated_at: createdAt,
  });

  return res.status(201).json({ variable });
});

app.post('/api/projects/:id/env/bulk', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const parsed = envBulkSchema.parse(req.body || {});
  const environment = parsed.environment.trim();
  const pairs = parseEnvContent(parsed.content);

  if (pairs.length === 0) {
    return res.status(400).json({ error: 'No valid KEY=VALUE lines found' });
  }

  const now = nowIso();
  const rows = pairs.map((entry) => ({
    id: uuidv4(),
    project_id: req.params.id,
    environment,
    key: entry.key,
    value: entry.value,
    created_at: now,
    updated_at: now,
  }));

  db.upsertEnvVars(rows);

  return res.json({
    message: 'Environment variables imported',
    imported: pairs.length,
    environment,
  });
});

app.put('/api/env/:id', (req, res) => {
  const existing = db.getEnvById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Environment variable not found' });
  }

  const parsed = envSchema.parse(req.body || {});
  const normalized = normalizeEnv(parsed);

  const variable = db.updateEnvVar({
    id: req.params.id,
    ...normalized,
    updated_at: nowIso(),
  });

  return res.json({ variable });
});

app.delete('/api/env/:id', (req, res) => {
  const existing = db.getEnvById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Environment variable not found' });
  }

  db.removeEnvVar(req.params.id);
  return res.status(204).send();
});

app.get('/api/projects/:id/servers', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const servers = db.listServers(req.params.id).map(publicServer);
  return res.json({ servers });
});

app.get('/api/servers', (_req, res) => {
  const servers = db.listAllServers().map(publicServer);
  return res.json({ servers });
});

app.post('/api/projects/:id/servers/attach', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const parsed = serverAttachSchema.parse(req.body || {});
  const existing = db.getServerById(parsed.server_id);
  if (!existing) {
    return res.status(404).json({ error: 'Server not found' });
  }

  db.attachServerToProject(req.params.id, existing.id, parsed.default_server);
  const attached = db.getServerById(existing.id);
  return res.status(201).json({ server: publicServer(attached) });
});

app.post('/api/projects/:id/servers', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const parsed = serverSchema.parse(req.body || {});
  const normalized = normalizeServer(parsed);
  const authError = assertServerAuth(normalized, { allowEmptySecret: false });
  if (authError) {
    return res.status(400).json({ error: authError });
  }

  const authPayload = normalized.auth_type === 'password'
    ? { password: normalized.password }
    : { private_key: normalized.private_key, passphrase: normalized.passphrase || '' };

  const createdAt = nowIso();
  const serverRecord = db.createServer({
    id: uuidv4(),
    project_id: req.params.id,
    name: normalized.name,
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    auth_type: normalized.auth_type,
    encrypted_auth: encryptSecret(JSON.stringify(authPayload)),
    default_server: normalized.default_server,
    created_at: createdAt,
    updated_at: createdAt,
  });

  return res.status(201).json({ server: publicServer(serverRecord) });
});

app.put('/api/servers/:id', (req, res) => {
  const existing = db.getServerById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const parsed = serverUpdateSchema.parse(req.body || {});
  const normalized = normalizeServer(parsed);
  const projectId = parsed.project_id || existing.project_id;
  const project = db.getProjectById(projectId);
  if (!project) {
    return res.status(400).json({ error: 'Valid project_id is required' });
  }

  if (!db.isServerLinkedToProject(projectId, existing.id)) {
    return res.status(400).json({ error: 'Server is not attached to the specified project' });
  }

  let authPayload;
  if (normalized.auth_type === 'password') {
    const current = JSON.parse(decryptSecret(existing.encrypted_auth));
    const resolvedPassword = normalized.password.trim() ? normalized.password : (current.password || '');
    if (!resolvedPassword.trim()) {
      return res.status(400).json({ error: 'Password is required for password-based SSH authentication' });
    }
    authPayload = { password: resolvedPassword };
  } else {
    const current = JSON.parse(decryptSecret(existing.encrypted_auth));
    const resolvedPrivateKey = normalized.private_key.trim() ? normalized.private_key : (current.private_key || '');
    const resolvedPassphrase = normalized.passphrase || current.passphrase || '';
    if (!resolvedPrivateKey.trim()) {
      return res.status(400).json({ error: 'Private key is required for key-based SSH authentication' });
    }
    authPayload = { private_key: resolvedPrivateKey, passphrase: resolvedPassphrase };
  }

  const updated = db.updateServer({
    id: existing.id,
    project_id: existing.project_id,
    name: normalized.name,
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    auth_type: normalized.auth_type,
    encrypted_auth: encryptSecret(JSON.stringify(authPayload)),
    default_server: normalized.default_server,
    updated_at: nowIso(),
  }, { project_id: projectId });

  return res.json({ server: publicServer(updated) });
});

app.post('/api/servers/:id/default', (req, res) => {
  const existing = db.getServerById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const projectId = String(req.body?.project_id || req.query?.project_id || '').trim() || existing.project_id;
  const project = db.getProjectById(projectId);
  if (!project) {
    return res.status(400).json({ error: 'Valid project_id is required' });
  }
  if (!db.isServerLinkedToProject(projectId, existing.id)) {
    return res.status(400).json({ error: 'Server is not attached to the specified project' });
  }

  db.setDefaultServerForProject(projectId, existing.id);
  return res.json({ message: 'Default server updated' });
});

app.post('/api/servers/:id/test', async (req, res) => {
  const existing = db.getServerById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Server not found' });
  }

  await verifyServerConnection(existing);
  return res.json({ ok: true, message: 'SSH connection successful' });
});

app.delete('/api/servers/:id', (req, res) => {
  const existing = db.getServerById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const projectId = String(req.body?.project_id || req.query?.project_id || '').trim();
  if (projectId) {
    const project = db.getProjectById(projectId);
    if (!project) {
      return res.status(400).json({ error: 'Valid project_id is required' });
    }
    if (!db.isServerLinkedToProject(projectId, existing.id)) {
      return res.status(400).json({ error: 'Server is not attached to this project' });
    }
    db.removeServerFromProject(projectId, existing.id);
    return res.status(204).send();
  }

  db.removeServer(existing.id);
  return res.status(204).send();
});

app.get('/api/projects/:id/deployments', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const limit = Number(req.query.limit || 50);
  const deployments = db.listDeployments(req.params.id, Number.isNaN(limit) ? 50 : limit);
  return res.json({ deployments });
});

app.get('/api/deployments/:id', (req, res) => {
  const deployment = db.getDeploymentById(req.params.id);
  if (!deployment) {
    return res.status(404).json({ error: 'Deployment not found' });
  }

  return res.json({ deployment });
});

app.post('/api/projects/:id/deploy', async (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const parsed = deploySchema.parse(req.body || {});

  const defaultServer = db.getDefaultServer(project.id);
  const effectiveServerId = parsed.server_id || (defaultServer ? defaultServer.id : null);

  if (parsed.server_id) {
    const targetServer = db.getServerById(parsed.server_id);
    if (!targetServer || !db.isServerLinkedToProject(project.id, targetServer.id)) {
      return res.status(400).json({ error: 'Invalid server_id for this project' });
    }
  }

  const deployment = db.createDeployment({
    id: uuidv4(),
    project_id: project.id,
    server_id: effectiveServerId,
    status: 'pending',
    trigger_type: 'manual',
    source_deployment_id: null,
    environment: parsed.environment,
    branch: project.branch,
    created_at: nowIso(),
  });

  await runner.enqueue(deployment.id);

  return res.status(202).json({
    message: 'Deployment queued',
    deployment,
    queue: queueStatus(runner),
  });
});

app.post('/api/deployments/:id/redeploy', async (req, res) => {
  const source = db.getDeploymentById(req.params.id);
  if (!source) {
    return res.status(404).json({ error: 'Source deployment not found' });
  }

  const project = db.getProjectById(source.project_id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const deployment = db.createDeployment({
    id: uuidv4(),
    project_id: project.id,
    server_id: source.server_id || null,
    status: 'pending',
    trigger_type: 'redeploy',
    source_deployment_id: source.id,
    environment: source.environment || 'production',
    branch: project.branch,
    created_at: nowIso(),
  });

  await runner.enqueue(deployment.id);

  return res.status(202).json({
    message: 'Redeploy queued',
    deployment,
    queue: queueStatus(runner),
  });
});

app.post('/api/deployments/:id/cancel', (req, res) => {
  const deployment = db.getDeploymentById(req.params.id);
  if (!deployment) {
    return res.status(404).json({ error: 'Deployment not found' });
  }

  if (deployment.status === 'success' || deployment.status === 'failed' || deployment.status === 'cancelled') {
    return res.status(400).json({ error: `Deployment is already ${deployment.status}` });
  }

  const hasActiveHandle = runner.hasActiveHandle(deployment.id);
  const isQueued = runner.isQueued(deployment.id);
  runner.cancel(deployment.id);

  if (deployment.status === 'pending') {
    db.setDeploymentStatus({
      id: deployment.id,
      status: 'cancelled',
      error_message: 'Cancelled while pending',
      started_at: null,
      completed_at: nowIso(),
      duration_ms: 0,
      release_path: null,
    });
    broadcastStatus({ deploymentId: deployment.id, status: 'cancelled', message: 'Cancelled while pending' });
    return res.json({ message: 'Pending deployment cancelled' });
  }

  // Recovery path: running in DB, but no active process/queue in current server process.
  if (deployment.status === 'running' && !hasActiveHandle && !isQueued) {
    db.setDeploymentStatus({
      id: deployment.id,
      status: 'cancelled',
      error_message: 'Force cancelled (stale running record)',
      started_at: null,
      completed_at: nowIso(),
      duration_ms: deployment.started_at
        ? Math.max(0, Date.now() - new Date(deployment.started_at).getTime())
        : 0,
      release_path: null,
    });
    broadcastStatus({ deploymentId: deployment.id, status: 'cancelled', message: 'Force cancelled stale deployment' });
    return res.json({ message: 'Stale running deployment force-cancelled' });
  }

  return res.json({ message: 'Cancellation requested for active deployment' });
});

app.delete('/api/deployments/:id', (req, res) => {
  const deployment = db.getDeploymentById(req.params.id);
  if (!deployment) {
    return res.status(404).json({ error: 'Deployment not found' });
  }

  if (deployment.status === 'running') {
    return res.status(400).json({ error: 'Cannot delete a running deployment' });
  }

  db.removeDeployment(req.params.id);
  return res.status(204).send();
});

app.get('/api/queue', (_req, res) => {
  res.json({ queue: queueStatus(runner), deployments: runner.queue });
});

app.use('/api', (req, res) => {
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(express.static(path.join(process.cwd(), 'public')));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: error.issues });
  }

  if (error && typeof error.message === 'string' && error.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: 'Unique constraint failed. Value already exists.' });
  }

  // eslint-disable-next-line no-console
  console.error(error);
  return res.status(500).json({ error: error.message || 'Internal server error' });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`SSHipIt running on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Database: ${DATABASE_PATH}`);
  // eslint-disable-next-line no-console
  console.log(`Workspace root: ${WORKSPACE_ROOT}`);
});

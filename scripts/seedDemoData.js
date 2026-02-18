#!/usr/bin/env node

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const { createDb } = require('../src/db');
const { encryptSecret } = require('../src/crypto');

const dbPath = path.resolve(rootDir, process.env.DATABASE_PATH || './data/sshipit.db');
const database = createDb(dbPath);
const db = database.raw;
const appendMode = process.argv.includes('--append');

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

const projects = [
  {
    id: 'demo-node-api',
    name: 'Acme API',
    repo_url: 'https://github.com/acme-inc/acme-api',
    branch: 'main',
    framework: 'node',
    package_manager: 'npm',
    migration_tool: 'prisma',
    migration_command: 'npx prisma generate && npx prisma migrate deploy',
    install_command: 'npm ci || npm install',
    build_command: '',
    start_command: 'npm start',
    restart_command: 'pm2 restart acme-api --update-env || pm2 start npm --name acme-api -- start',
    output_dir: '',
    deploy_path: '/var/www/acme-api',
    auto_deploy: 0,
  },
  {
    id: 'demo-next-web',
    name: 'Acme Web',
    repo_url: 'https://github.com/acme-inc/acme-web',
    branch: 'main',
    framework: 'nextjs',
    package_manager: 'npm',
    migration_tool: 'none',
    migration_command: '',
    install_command: 'npm ci || npm install',
    build_command: 'npm run build',
    start_command: 'npm start',
    restart_command: 'pm2 restart acme-web --update-env || pm2 start npm --name acme-web -- start',
    output_dir: '',
    deploy_path: '/var/www/acme-web',
    auto_deploy: 0,
  },
  {
    id: 'demo-react-admin',
    name: 'Acme Admin',
    repo_url: 'https://github.com/acme-inc/acme-admin',
    branch: 'main',
    framework: 'react',
    package_manager: 'npm',
    migration_tool: 'none',
    migration_command: '',
    install_command: 'npm ci || npm install',
    build_command: 'npm run build',
    start_command: '',
    restart_command: 'sudo systemctl reload nginx',
    output_dir: 'dist',
    deploy_path: '/var/www/acme-admin',
    auto_deploy: 0,
  },
];

const serverDefs = [
  {
    id: 'demo-server-prod',
    project_id: 'demo-node-api',
    name: 'production-1',
    host: '203.0.113.10',
    port: 22,
    username: 'deploy',
    auth_type: 'key',
    auth: {
      private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\\nDEMO_KEY_REDACTED\\n-----END OPENSSH PRIVATE KEY-----',
      passphrase: '',
    },
    default_server: 1,
  },
  {
    id: 'demo-server-staging',
    project_id: 'demo-next-web',
    name: 'staging-1',
    host: '198.51.100.25',
    port: 22,
    username: 'ubuntu',
    auth_type: 'password',
    auth: {
      password: 'demo-password',
    },
    default_server: 1,
  },
];

const envVars = [
  ['demo-node-api', 'NODE_ENV', 'production'],
  ['demo-node-api', 'PORT', '3030'],
  ['demo-node-api', 'DATABASE_URL', 'mysql://demo_user:demo_pass@127.0.0.1:3306/acme_api'],
  ['demo-node-api', 'JWT_SECRET', 'demo-jwt-secret'],
  ['demo-next-web', 'NODE_ENV', 'production'],
  ['demo-next-web', 'PORT', '3000'],
  ['demo-next-web', 'NEXT_PUBLIC_API_URL', 'https://api.acme.dev'],
  ['demo-next-web', 'NEXTAUTH_URL', 'https://app.acme.dev'],
  ['demo-react-admin', 'NODE_ENV', 'production'],
  ['demo-react-admin', 'VITE_API_URL', 'https://api.acme.dev'],
  ['demo-react-admin', 'VITE_SENTRY_DSN', 'https://demo@sentry.io/123'],
];

const deploymentRows = [
  {
    id: 'demo-deploy-node-success',
    project_id: 'demo-node-api',
    server_id: 'demo-server-prod',
    status: 'success',
    trigger_type: 'manual',
    environment: 'production',
    branch: 'main',
    commit_hash: '3f6c7b8a1e94fbeab1d9a7d2f8c8ec2f8a3df111',
    commit_message: 'feat: add billing webhooks',
    release_path: '/var/www/acme-api/releases/1771400500000-a1b2c3d4',
    logs: '[INFO] Connecting over SSH to deploy@203.0.113.10:22\n[INFO] Fetching main\n[INFO] Install dependencies (remote)\n[INFO] Run database migrations (remote)\n[SUCCESS] Deployment completed in 58s\n',
    error_message: null,
    duration_ms: 58000,
    started_at: isoMinutesAgo(85),
    completed_at: isoMinutesAgo(84),
    created_at: isoMinutesAgo(86),
  },
  {
    id: 'demo-deploy-node-failed',
    project_id: 'demo-node-api',
    server_id: 'demo-server-prod',
    status: 'failed',
    trigger_type: 'manual',
    environment: 'production',
    branch: 'main',
    commit_hash: 'f9f50adf92da2580deae2cdcb0f377ec2d15e2aa',
    commit_message: 'fix: tighten auth middleware',
    release_path: null,
    logs: '[INFO] Build project (remote)\n[ERROR] npm run build failed with exit code 1\n',
    error_message: 'Build project (remote) failed with exit code 1',
    duration_ms: 14000,
    started_at: isoMinutesAgo(41),
    completed_at: isoMinutesAgo(40),
    created_at: isoMinutesAgo(42),
  },
  {
    id: 'demo-deploy-next-running',
    project_id: 'demo-next-web',
    server_id: 'demo-server-staging',
    status: 'running',
    trigger_type: 'manual',
    environment: 'production',
    branch: 'main',
    commit_hash: 'e4ed0a5f1e43763b8822794f9f5064f2de77e333',
    commit_message: 'chore: update landing hero copy',
    release_path: null,
    logs: '[INFO] Preparing remote repository\n[INFO] Install dependencies (remote)\n[INFO] Build project (remote)\n',
    error_message: null,
    duration_ms: null,
    started_at: isoMinutesAgo(2),
    completed_at: null,
    created_at: isoMinutesAgo(3),
  },
  {
    id: 'demo-deploy-react-pending',
    project_id: 'demo-react-admin',
    server_id: 'demo-server-staging',
    status: 'pending',
    trigger_type: 'manual',
    environment: 'production',
    branch: 'main',
    commit_hash: null,
    commit_message: null,
    release_path: null,
    logs: '',
    error_message: null,
    duration_ms: null,
    started_at: null,
    completed_at: null,
    created_at: isoMinutesAgo(1),
  },
];

function wipeDemoRows() {
  db.prepare("DELETE FROM deployments WHERE id LIKE 'demo-%'").run();
  db.prepare("DELETE FROM project_servers WHERE project_id LIKE 'demo-%' OR server_id LIKE 'demo-%'").run();
  db.prepare("DELETE FROM env_vars WHERE project_id LIKE 'demo-%'").run();
  db.prepare("DELETE FROM servers WHERE id LIKE 'demo-%'").run();
  db.prepare("DELETE FROM projects WHERE id LIKE 'demo-%'").run();
}

function wipeAllRows() {
  db.prepare('DELETE FROM deployments').run();
  db.prepare('DELETE FROM project_servers').run();
  db.prepare('DELETE FROM env_vars').run();
  db.prepare('DELETE FROM servers').run();
  db.prepare('DELETE FROM projects').run();
}

const upsertProjectStmt = db.prepare(`
  INSERT INTO projects (
    id, name, repo_url, branch, framework, package_manager, migration_tool, migration_command,
    install_command, build_command, start_command, restart_command, output_dir, deploy_path,
    auto_deploy, created_at, updated_at
  ) VALUES (
    @id, @name, @repo_url, @branch, @framework, @package_manager, @migration_tool, @migration_command,
    @install_command, @build_command, @start_command, @restart_command, @output_dir, @deploy_path,
    @auto_deploy, @created_at, @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    repo_url = excluded.repo_url,
    branch = excluded.branch,
    framework = excluded.framework,
    package_manager = excluded.package_manager,
    migration_tool = excluded.migration_tool,
    migration_command = excluded.migration_command,
    install_command = excluded.install_command,
    build_command = excluded.build_command,
    start_command = excluded.start_command,
    restart_command = excluded.restart_command,
    output_dir = excluded.output_dir,
    deploy_path = excluded.deploy_path,
    auto_deploy = excluded.auto_deploy,
    updated_at = excluded.updated_at
`);

const upsertServerStmt = db.prepare(`
  INSERT INTO servers (
    id, project_id, name, host, port, username, auth_type, encrypted_auth, default_server, created_at, updated_at
  ) VALUES (
    @id, @project_id, @name, @host, @port, @username, @auth_type, @encrypted_auth, @default_server, @created_at, @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    project_id = excluded.project_id,
    name = excluded.name,
    host = excluded.host,
    port = excluded.port,
    username = excluded.username,
    auth_type = excluded.auth_type,
    encrypted_auth = excluded.encrypted_auth,
    default_server = excluded.default_server,
    updated_at = excluded.updated_at
`);

const upsertProjectServerStmt = db.prepare(`
  INSERT INTO project_servers (project_id, server_id, default_server, created_at, updated_at)
  VALUES (@project_id, @server_id, @default_server, @created_at, @updated_at)
  ON CONFLICT(project_id, server_id) DO UPDATE SET
    default_server = excluded.default_server,
    updated_at = excluded.updated_at
`);

const upsertEnvStmt = db.prepare(`
  INSERT INTO env_vars (id, project_id, environment, key, value, created_at, updated_at)
  VALUES (@id, @project_id, @environment, @key, @value, @created_at, @updated_at)
  ON CONFLICT(project_id, environment, key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);

const upsertDeploymentStmt = db.prepare(`
  INSERT INTO deployments (
    id, project_id, server_id, status, trigger_type, source_deployment_id, environment, branch,
    commit_hash, commit_message, logs, release_path, error_message, started_at, completed_at,
    duration_ms, created_at
  ) VALUES (
    @id, @project_id, @server_id, @status, @trigger_type, NULL, @environment, @branch,
    @commit_hash, @commit_message, @logs, @release_path, @error_message, @started_at, @completed_at,
    @duration_ms, @created_at
  )
  ON CONFLICT(id) DO UPDATE SET
    project_id = excluded.project_id,
    server_id = excluded.server_id,
    status = excluded.status,
    trigger_type = excluded.trigger_type,
    environment = excluded.environment,
    branch = excluded.branch,
    commit_hash = excluded.commit_hash,
    commit_message = excluded.commit_message,
    logs = excluded.logs,
    release_path = excluded.release_path,
    error_message = excluded.error_message,
    started_at = excluded.started_at,
    completed_at = excluded.completed_at,
    duration_ms = excluded.duration_ms,
    created_at = excluded.created_at
`);

const seedTx = db.transaction(() => {
  if (!appendMode) {
    wipeAllRows();
  } else {
    wipeDemoRows();
  }

  const now = new Date().toISOString();
  for (const project of projects) {
    upsertProjectStmt.run({
      ...project,
      created_at: now,
      updated_at: now,
    });
  }

  for (const server of serverDefs) {
    upsertServerStmt.run({
      id: server.id,
      project_id: server.project_id,
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      auth_type: server.auth_type,
      encrypted_auth: encryptSecret(JSON.stringify(server.auth)),
      default_server: server.default_server,
      created_at: now,
      updated_at: now,
    });
  }

  db.prepare('UPDATE project_servers SET default_server = 0').run();
  for (const project of projects) {
    const projectDefaultServer = project.id === 'demo-node-api' ? 'demo-server-prod' : 'demo-server-staging';
    upsertProjectServerStmt.run({
      project_id: project.id,
      server_id: projectDefaultServer,
      default_server: 1,
      created_at: now,
      updated_at: now,
    });
    db.prepare('UPDATE servers SET default_server = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE project_id = ?')
      .run(projectDefaultServer, project.id);
  }

  for (const [projectId, key, value] of envVars) {
    upsertEnvStmt.run({
      id: randomUUID(),
      project_id: projectId,
      environment: 'production',
      key,
      value,
      created_at: now,
      updated_at: now,
    });
  }

  for (const deployment of deploymentRows) {
    upsertDeploymentStmt.run(deployment);
  }
});

seedTx();

const projectCount = db.prepare('SELECT COUNT(*) AS count FROM projects').get().count;
const envCount = db.prepare('SELECT COUNT(*) AS count FROM env_vars').get().count;
const serverCount = db.prepare('SELECT COUNT(*) AS count FROM servers').get().count;
const deploymentCount = db.prepare('SELECT COUNT(*) AS count FROM deployments').get().count;

// eslint-disable-next-line no-console
console.log(`[seed:demo] Seed complete at ${dbPath}`);
// eslint-disable-next-line no-console
console.log(`[seed:demo] Projects=${projectCount}, EnvVars=${envCount}, Servers=${serverCount}, Deployments=${deploymentCount}`);
// eslint-disable-next-line no-console
console.log('[seed:demo] Open http://localhost:3000 and refresh.');

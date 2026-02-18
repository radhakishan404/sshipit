const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function nowIso() {
  return new Date().toISOString();
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function tableHasColumn(db, tableName, columnName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return cols.some((col) => col.name === columnName);
}

function createDb(databasePath) {
  ensureDirForFile(databasePath);
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      framework TEXT NOT NULL DEFAULT 'node',
      package_manager TEXT NOT NULL DEFAULT 'npm',
      migration_tool TEXT NOT NULL DEFAULT 'none',
      migration_command TEXT,
      install_command TEXT,
      build_command TEXT,
      start_command TEXT,
      restart_command TEXT,
      output_dir TEXT,
      deploy_path TEXT,
      auto_deploy INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS env_vars (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'production',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, environment, key),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      encrypted_auth TEXT NOT NULL,
      default_server INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_servers (
      project_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      default_server INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, server_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      server_id TEXT,
      status TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      source_deployment_id TEXT,
      environment TEXT NOT NULL DEFAULT 'production',
      branch TEXT,
      commit_hash TEXT,
      commit_message TEXT,
      logs TEXT NOT NULL DEFAULT '',
      release_path TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_env_vars_project_id ON env_vars(project_id);
    CREATE INDEX IF NOT EXISTS idx_servers_project_id ON servers(project_id);
    CREATE INDEX IF NOT EXISTS idx_servers_default ON servers(project_id, default_server);
    CREATE INDEX IF NOT EXISTS idx_project_servers_project_id ON project_servers(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_servers_server_id ON project_servers(server_id);
    CREATE INDEX IF NOT EXISTS idx_project_servers_default ON project_servers(project_id, default_server);
    CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
    CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
  `);

  if (!tableHasColumn(db, 'deployments', 'server_id')) {
    db.exec('ALTER TABLE deployments ADD COLUMN server_id TEXT');
  }

  if (!tableHasColumn(db, 'servers', 'default_server')) {
    db.exec('ALTER TABLE servers ADD COLUMN default_server INTEGER NOT NULL DEFAULT 0');
  }

  if (!tableHasColumn(db, 'projects', 'package_manager')) {
    db.exec('ALTER TABLE projects ADD COLUMN package_manager TEXT NOT NULL DEFAULT "npm"');
  }

  if (!tableHasColumn(db, 'projects', 'migration_tool')) {
    db.exec('ALTER TABLE projects ADD COLUMN migration_tool TEXT NOT NULL DEFAULT "none"');
  }

  if (!tableHasColumn(db, 'projects', 'migration_command')) {
    db.exec('ALTER TABLE projects ADD COLUMN migration_command TEXT');
  }

  const existingLinksCount = db.prepare('SELECT COUNT(*) AS count FROM project_servers').get().count;
  if (existingLinksCount === 0) {
    db.exec(`
      INSERT INTO project_servers (project_id, server_id, default_server, created_at, updated_at)
      SELECT project_id, id, COALESCE(default_server, 0), created_at, updated_at
      FROM servers
    `);
  }

  const statements = {
    insertProject: db.prepare(`
      INSERT INTO projects (
        id, name, repo_url, branch, framework, package_manager, migration_tool, migration_command,
        install_command, build_command,
        start_command, restart_command, output_dir, deploy_path, auto_deploy,
        created_at, updated_at
      ) VALUES (
        @id, @name, @repo_url, @branch, @framework, @package_manager, @migration_tool, @migration_command,
        @install_command, @build_command,
        @start_command, @restart_command, @output_dir, @deploy_path, @auto_deploy,
        @created_at, @updated_at
      )
    `),
    updateProject: db.prepare(`
      UPDATE projects SET
        name = @name,
        repo_url = @repo_url,
        branch = @branch,
        framework = @framework,
        package_manager = @package_manager,
        migration_tool = @migration_tool,
        migration_command = @migration_command,
        install_command = @install_command,
        build_command = @build_command,
        start_command = @start_command,
        restart_command = @restart_command,
        output_dir = @output_dir,
        deploy_path = @deploy_path,
        auto_deploy = @auto_deploy,
        updated_at = @updated_at
      WHERE id = @id
    `),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),

    insertEnv: db.prepare(`
      INSERT INTO env_vars (id, project_id, environment, key, value, created_at, updated_at)
      VALUES (@id, @project_id, @environment, @key, @value, @created_at, @updated_at)
    `),
    updateEnv: db.prepare(`
      UPDATE env_vars
      SET environment = @environment, key = @key, value = @value, updated_at = @updated_at
      WHERE id = @id
    `),
    upsertEnv: db.prepare(`
      INSERT INTO env_vars (id, project_id, environment, key, value, created_at, updated_at)
      VALUES (@id, @project_id, @environment, @key, @value, @created_at, @updated_at)
      ON CONFLICT(project_id, environment, key)
      DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
    deleteEnv: db.prepare('DELETE FROM env_vars WHERE id = ?'),

    insertServer: db.prepare(`
      INSERT INTO servers (
        id, project_id, name, host, port, username, auth_type, encrypted_auth,
        default_server, created_at, updated_at
      ) VALUES (
        @id, @project_id, @name, @host, @port, @username, @auth_type, @encrypted_auth,
        @default_server, @created_at, @updated_at
      )
    `),
    updateServer: db.prepare(`
      UPDATE servers
      SET name = @name,
          host = @host,
          port = @port,
          username = @username,
          auth_type = @auth_type,
          encrypted_auth = @encrypted_auth,
          default_server = @default_server,
          updated_at = @updated_at
      WHERE id = @id
    `),
    updateServerOwner: db.prepare(`
      UPDATE servers
      SET project_id = @project_id,
          updated_at = @updated_at
      WHERE id = @id
    `),
    deleteServer: db.prepare('DELETE FROM servers WHERE id = ?'),
    clearDefaultServers: db.prepare('UPDATE servers SET default_server = 0 WHERE project_id = ?'),
    setDefaultServer: db.prepare('UPDATE servers SET default_server = 1 WHERE id = ?'),
    upsertProjectServerLink: db.prepare(`
      INSERT INTO project_servers (project_id, server_id, default_server, created_at, updated_at)
      VALUES (@project_id, @server_id, @default_server, @created_at, @updated_at)
      ON CONFLICT(project_id, server_id)
      DO UPDATE SET
        default_server = excluded.default_server,
        updated_at = excluded.updated_at
    `),
    clearProjectDefaultServers: db.prepare('UPDATE project_servers SET default_server = 0 WHERE project_id = ?'),
    setProjectDefaultServer: db.prepare(`
      UPDATE project_servers
      SET default_server = 1, updated_at = @updated_at
      WHERE project_id = @project_id AND server_id = @server_id
    `),
    updateProjectServerDefaultFlag: db.prepare(`
      UPDATE project_servers
      SET default_server = @default_server, updated_at = @updated_at
      WHERE project_id = @project_id AND server_id = @server_id
    `),
    deleteProjectServerLink: db.prepare('DELETE FROM project_servers WHERE project_id = ? AND server_id = ?'),

    insertDeployment: db.prepare(`
      INSERT INTO deployments (
        id, project_id, server_id, status, trigger_type, source_deployment_id, environment,
        branch, created_at
      ) VALUES (
        @id, @project_id, @server_id, @status, @trigger_type, @source_deployment_id, @environment,
        @branch, @created_at
      )
    `),
    updateDeploymentStatus: db.prepare(`
      UPDATE deployments
      SET status = @status,
          error_message = @error_message,
          started_at = COALESCE(@started_at, started_at),
          completed_at = @completed_at,
          duration_ms = @duration_ms,
          release_path = COALESCE(@release_path, release_path)
      WHERE id = @id
    `),
    appendDeploymentLog: db.prepare(`
      UPDATE deployments
      SET logs = logs || @chunk
      WHERE id = @id
    `),
    updateDeploymentGitInfo: db.prepare(`
      UPDATE deployments
      SET commit_hash = @commit_hash,
          commit_message = @commit_message,
          branch = @branch
      WHERE id = @id
    `),
    deleteDeployment: db.prepare('DELETE FROM deployments WHERE id = ?'),
  };

  const setDefaultServerForProjectTx = db.transaction((projectId, serverId) => {
    const timestamp = nowIso();
    statements.clearProjectDefaultServers.run(projectId);
    statements.setProjectDefaultServer.run({ project_id: projectId, server_id: serverId, updated_at: timestamp });
    // Keep legacy column in sync for existing rows/queries.
    statements.clearDefaultServers.run(projectId);
    statements.setDefaultServer.run(serverId);
  });

  const attachServerToProjectTx = db.transaction((projectId, serverId, defaultServer = 0) => {
    const timestamp = nowIso();
    statements.upsertProjectServerLink.run({
      project_id: projectId,
      server_id: serverId,
      default_server: defaultServer ? 1 : 0,
      created_at: timestamp,
      updated_at: timestamp,
    });

    if (defaultServer) {
      setDefaultServerForProjectTx(projectId, serverId);
    }
  });

  const removeProjectTx = db.transaction((projectId) => {
    const ownedServers = db.prepare('SELECT id FROM servers WHERE project_id = ?').all(projectId);
    for (const row of ownedServers) {
      const replacement = db.prepare(`
        SELECT project_id
        FROM project_servers
        WHERE server_id = ? AND project_id <> ?
        ORDER BY created_at ASC
        LIMIT 1
      `).get(row.id, projectId);

      if (replacement && replacement.project_id) {
        statements.updateServerOwner.run({
          id: row.id,
          project_id: replacement.project_id,
          updated_at: nowIso(),
        });
      }
    }

    statements.deleteProject.run(projectId);
  });

  function listProjects() {
    return db.prepare(`
      SELECT
        p.*,
        (
          SELECT d.status
          FROM deployments d
          WHERE d.project_id = p.id
          ORDER BY d.created_at DESC
          LIMIT 1
        ) AS last_deployment_status,
        (
          SELECT d.created_at
          FROM deployments d
          WHERE d.project_id = p.id
          ORDER BY d.created_at DESC
          LIMIT 1
        ) AS last_deployment_at
      FROM projects p
      ORDER BY p.created_at DESC
    `).all();
  }

  function getProjectById(id) {
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  }

  function createProject(data) {
    statements.insertProject.run(data);
    return getProjectById(data.id);
  }

  function updateProject(data) {
    statements.updateProject.run(data);
    return getProjectById(data.id);
  }

  function removeProject(id) {
    removeProjectTx(id);
  }

  function listEnvVars(projectId, environment) {
    const query = environment
      ? 'SELECT * FROM env_vars WHERE project_id = ? AND environment = ? ORDER BY key ASC'
      : 'SELECT * FROM env_vars WHERE project_id = ? ORDER BY environment ASC, key ASC';
    const args = environment ? [projectId, environment] : [projectId];
    return db.prepare(query).all(...args);
  }

  function getEnvById(id) {
    return db.prepare('SELECT * FROM env_vars WHERE id = ?').get(id);
  }

  function createEnvVar(data) {
    statements.insertEnv.run(data);
    return getEnvById(data.id);
  }

  function updateEnvVar(data) {
    statements.updateEnv.run(data);
    return getEnvById(data.id);
  }

  function removeEnvVar(id) {
    statements.deleteEnv.run(id);
  }

  const upsertEnvVarsTx = db.transaction((rows) => {
    for (const row of rows) {
      statements.upsertEnv.run(row);
    }
  });

  function upsertEnvVars(rows) {
    upsertEnvVarsTx(rows);
  }

  function listServers(projectId) {
    return db.prepare(`
      SELECT
        s.id,
        ps.project_id,
        s.project_id AS owner_project_id,
        s.name,
        s.host,
        s.port,
        s.username,
        s.auth_type,
        ps.default_server,
        (
          SELECT COUNT(*)
          FROM project_servers ps2
          WHERE ps2.server_id = s.id
        ) AS project_count,
        s.created_at,
        s.updated_at
      FROM project_servers ps
      INNER JOIN servers s ON s.id = ps.server_id
      WHERE ps.project_id = ?
      ORDER BY ps.default_server DESC, s.created_at DESC
    `).all(projectId);
  }

  function listAllServers() {
    return db.prepare(`
      SELECT
        s.id,
        s.project_id,
        s.project_id AS owner_project_id,
        s.name,
        s.host,
        s.port,
        s.username,
        s.auth_type,
        s.created_at,
        s.updated_at,
        COUNT(ps.project_id) AS project_count
      FROM servers s
      LEFT JOIN project_servers ps ON ps.server_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `).all();
  }

  function isServerLinkedToProject(projectId, serverId) {
    const row = db.prepare(`
      SELECT 1
      FROM project_servers
      WHERE project_id = ? AND server_id = ?
      LIMIT 1
    `).get(projectId, serverId);
    return Boolean(row);
  }

  function getServerById(id) {
    return db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  }

  function getDefaultServer(projectId) {
    return db.prepare(`
      SELECT s.*
      FROM project_servers ps
      INNER JOIN servers s ON s.id = ps.server_id
      WHERE ps.project_id = ? AND ps.default_server = 1
      ORDER BY ps.updated_at DESC
      LIMIT 1
    `).get(projectId);
  }

  function createServer(data) {
    statements.insertServer.run(data);
    attachServerToProjectTx(data.project_id, data.id, data.default_server ? 1 : 0);
    return getServerById(data.id);
  }

  function updateServer(data, options = {}) {
    const linkProjectId = options.project_id || data.project_id;
    statements.updateServer.run(data);
    if (linkProjectId) {
      if (data.default_server) {
        setDefaultServerForProjectTx(linkProjectId, data.id);
      } else {
        statements.updateProjectServerDefaultFlag.run({
          project_id: linkProjectId,
          server_id: data.id,
          default_server: 0,
          updated_at: nowIso(),
        });
      }
    }
    return getServerById(data.id);
  }

  function setDefaultServerForProject(projectId, serverId) {
    attachServerToProjectTx(projectId, serverId, 0);
    setDefaultServerForProjectTx(projectId, serverId);
  }

  function attachServerToProject(projectId, serverId, defaultServer = false) {
    attachServerToProjectTx(projectId, serverId, defaultServer ? 1 : 0);
  }

  function removeServerFromProject(projectId, serverId) {
    statements.deleteProjectServerLink.run(projectId, serverId);
    const links = db.prepare('SELECT COUNT(*) AS count FROM project_servers WHERE server_id = ?').get(serverId);
    if (Number(links.count) === 0) {
      statements.deleteServer.run(serverId);
    }
  }

  function removeServer(id) {
    db.prepare('DELETE FROM project_servers WHERE server_id = ?').run(id);
    statements.deleteServer.run(id);
  }

  function listDeployments(projectId, limit = 50) {
    return db.prepare(`
      SELECT d.*, s.name AS server_name, s.host AS server_host
      FROM deployments d
      LEFT JOIN servers s ON s.id = d.server_id
      WHERE d.project_id = ?
      ORDER BY d.created_at DESC
      LIMIT ?
    `).all(projectId, limit);
  }

  function getDeploymentById(id) {
    return db.prepare(`
      SELECT d.*, s.name AS server_name, s.host AS server_host
      FROM deployments d
      LEFT JOIN servers s ON s.id = d.server_id
      WHERE d.id = ?
    `).get(id);
  }

  function createDeployment(data) {
    statements.insertDeployment.run(data);
    return getDeploymentById(data.id);
  }

  function setDeploymentStatus(data) {
    statements.updateDeploymentStatus.run(data);
    return getDeploymentById(data.id);
  }

  function appendDeploymentLog(id, chunk) {
    statements.appendDeploymentLog.run({ id, chunk });
  }

  function setDeploymentGitInfo(id, commitHash, commitMessage, branch) {
    statements.updateDeploymentGitInfo.run({
      id,
      commit_hash: commitHash,
      commit_message: commitMessage,
      branch,
    });
  }

  function removeDeployment(id) {
    statements.deleteDeployment.run(id);
  }

  return {
    raw: db,
    nowIso,
    listProjects,
    getProjectById,
    createProject,
    updateProject,
    removeProject,
    listEnvVars,
    getEnvById,
    createEnvVar,
    updateEnvVar,
    removeEnvVar,
    upsertEnvVars,
    listServers,
    listAllServers,
    isServerLinkedToProject,
    getServerById,
    getDefaultServer,
    createServer,
    updateServer,
    attachServerToProject,
    setDefaultServerForProject,
    removeServerFromProject,
    removeServer,
    listDeployments,
    getDeploymentById,
    createDeployment,
    setDeploymentStatus,
    appendDeploymentLog,
    setDeploymentGitInfo,
    removeDeployment,
  };
}

module.exports = {
  createDb,
  nowIso,
};

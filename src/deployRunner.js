const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('ssh2');

function splitLines(data) {
  return data.toString('utf8').split(/\r?\n/).filter(Boolean);
}

function repoDirNameFromUrl(repoUrl) {
  const raw = String(repoUrl || '').trim();
  if (!raw) return 'repo';

  let candidate = raw;

  // Handle scp-like git URLs: git@host:owner/repo.git
  const scpLike = raw.match(/^[^@]+@[^:]+:(.+)$/);
  if (scpLike && scpLike[1]) {
    candidate = scpLike[1];
  } else {
    try {
      const parsed = new URL(raw);
      candidate = parsed.pathname || raw;
    } catch (_error) {
      candidate = raw;
    }
  }

  const segments = candidate.split('/').filter(Boolean);
  const last = segments.length > 0 ? segments[segments.length - 1] : candidate;
  const noGit = last.replace(/\.git$/i, '');
  const sanitized = noGit.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'repo';
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function packageManagerCommands(packageManager) {
  const pm = String(packageManager || 'npm').toLowerCase();
  if (pm === 'pnpm') {
    return {
      install: 'pnpm install --frozen-lockfile || pnpm install',
      build: 'pnpm build',
      start: 'pnpm start',
      pm2Start: 'pm2 start pnpm --name <app-name> -- start',
      prisma: 'pnpm exec prisma',
      sequelize: 'pnpm exec sequelize-cli',
      knex: 'pnpm exec knex',
      typeorm: 'pnpm exec typeorm',
    };
  }

  if (pm === 'yarn') {
    return {
      install: 'yarn install --frozen-lockfile || yarn install',
      build: 'yarn build',
      start: 'yarn start',
      pm2Start: 'pm2 start yarn --name <app-name> -- start',
      prisma: 'yarn prisma',
      sequelize: 'yarn sequelize-cli',
      knex: 'yarn knex',
      typeorm: 'yarn typeorm',
    };
  }

  if (pm === 'bun') {
    return {
      install: 'bun install',
      build: 'bun run build',
      start: 'bun run start',
      pm2Start: 'pm2 start bun --name <app-name> -- run start',
      prisma: 'bunx prisma',
      sequelize: 'bunx sequelize-cli',
      knex: 'bunx knex',
      typeorm: 'bunx typeorm',
    };
  }

  return {
    install: 'npm ci || npm install',
    build: 'npm run build',
    start: 'npm start',
    pm2Start: 'pm2 start npm --name <app-name> -- start',
    prisma: 'npx prisma',
    sequelize: 'npx sequelize-cli',
    knex: 'npx knex',
    typeorm: 'npx typeorm',
  };
}

function defaultMigrationCommand(migrationTool, packageManager) {
  const tool = String(migrationTool || 'none').toLowerCase();
  const pm = packageManagerCommands(packageManager);

  if (tool === 'prisma') {
    return `${pm.prisma} generate && ${pm.prisma} migrate deploy`;
  }

  if (tool === 'sequelize') {
    return `${pm.sequelize} db:migrate`;
  }

  if (tool === 'knex') {
    return `${pm.knex} migrate:latest`;
  }

  if (tool === 'typeorm') {
    return `${pm.typeorm} migration:run || npx typeorm-ts-node-commonjs migration:run`;
  }

  return '';
}

function readPackageJson(repoDir) {
  try {
    const content = fsSync.readFileSync(path.join(repoDir, 'package.json'), 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function detectLocalMigrationTool(repoDir) {
  const pkg = readPackageJson(repoDir);
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
    ...(pkg.peerDependencies || {}),
  };

  const hasDep = (name) => Boolean(deps[name]);
  const hasPath = (relativePath) => fsSync.existsSync(path.join(repoDir, relativePath));

  if (
    hasPath('prisma/schema.prisma')
  ) {
    return 'prisma';
  }

  if (
    (hasDep('sequelize-cli') && hasPath('migrations'))
    || hasPath('.sequelizerc')
    || hasPath('sequelize.config.js')
    || hasPath('config/config.js')
    || hasPath('config/config.cjs')
  ) {
    return 'sequelize';
  }

  if (
    hasPath('knexfile.js')
    || hasPath('knexfile.ts')
    || hasPath('knexfile.cjs')
  ) {
    return 'knex';
  }

  if (
    (hasDep('typeorm') && (hasPath('src/migration') || hasPath('migration') || hasPath('migrations')))
    || hasPath('ormconfig.js')
    || hasPath('ormconfig.ts')
    || hasPath('ormconfig.json')
  ) {
    return 'typeorm';
  }

  return 'none';
}

function defaultCommands(framework, options = {}) {
  const normalized = String(framework || 'node').toLowerCase();
  const packageManager = String(options.packageManager || 'npm').toLowerCase();
  const migrationTool = String(options.migrationTool || 'none').toLowerCase();
  const pm = packageManagerCommands(packageManager);
  const migration = defaultMigrationCommand(migrationTool, packageManager);

  if (normalized === 'react') {
    return {
      install: pm.install,
      build: pm.build,
      start: '',
      restart: 'sudo systemctl reload nginx',
      outputDir: 'dist',
      migration,
      packageManager,
      guide: 'React static builds usually deploy dist/build to nginx and then reload nginx. Keep migration command empty unless this repo also includes backend migrations.',
    };
  }

  if (normalized === 'nextjs' || normalized === 'next') {
    return {
      install: pm.install,
      build: pm.build,
      start: pm.start,
      restart: `pm2 restart <app-name> --update-env || ${pm.pm2Start}`,
      outputDir: '',
      migration,
      packageManager,
      guide: 'Next.js usually runs via PM2. If this repo includes DB changes, set Migration Tool (Prisma/Sequelize/Knex/TypeORM) so migrations run before restart.',
    };
  }

  return {
    install: pm.install,
    build: pm.build,
    start: pm.start,
    restart: `pm2 restart <app-name> --update-env || ${pm.pm2Start}`,
    outputDir: '',
    migration,
    packageManager,
    guide: 'Node.js API services are commonly managed by PM2. Use Migration Tool when schema changes are required before restart.',
  };
}

class DeployRunner {
  constructor({ db, workspaceRoot, keepReleases, onLog, onStatus, decryptSecret }) {
    this.db = db;
    this.workspaceRoot = workspaceRoot;
    this.keepReleases = keepReleases;
    this.onLog = onLog;
    this.onStatus = onStatus;
    this.decryptSecret = decryptSecret;

    this.queue = [];
    this.isRunning = false;
    this.cancellations = new Set();
    this.runningProcesses = new Map();
  }

  async enqueue(deploymentId) {
    this.queue.push(deploymentId);
    this.onStatus({ type: 'queue', deploymentId, queueSize: this.queue.length });
    await this.#tick();
  }

  cancel(deploymentId) {
    this.cancellations.add(deploymentId);

    const handle = this.runningProcesses.get(deploymentId);
    if (handle && typeof handle.terminate === 'function') {
      handle.terminate();
    }

    this.queue = this.queue.filter((id) => id !== deploymentId);
  }

  hasActiveHandle(deploymentId) {
    return this.runningProcesses.has(deploymentId);
  }

  isQueued(deploymentId) {
    return this.queue.includes(deploymentId);
  }

  async #tick() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    while (this.queue.length > 0) {
      const deploymentId = this.queue.shift();
      // eslint-disable-next-line no-await-in-loop
      await this.#runDeployment(deploymentId);
    }
    this.isRunning = false;
  }

  #emitLog(deploymentId, message, level = 'info') {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    this.db.appendDeploymentLog(deploymentId, `${line}\n`);
    this.onLog({ deploymentId, message: line, level, timestamp: new Date().toISOString() });
  }

  #emitStatus(deploymentId, status, extra = {}) {
    this.onStatus({
      type: 'status',
      deploymentId,
      status,
      ...extra,
    });
  }

  #classifyStderrLine(line) {
    const text = String(line || '').toLowerCase();
    if (!text) {
      return 'error';
    }

    // Common non-fatal stderr output from npm/prisma/pm2.
    if (
      text.includes('npm warn')
      || text.includes(' warning ')
      || text.includes(' warn deprecated ')
      || text.startsWith('⚠')
      || text.includes('unsupported metadata viewport')
      || text.includes('the "middleware" file convention is deprecated')
      || text.includes('read more: https://nextjs.org/docs/')
      || text.includes(' update available ')
      || text.includes('tip:')
      || text.includes('in-memory pm2 is out-of-date')
      || text.includes('>>>> $ pm2 update')
      || text.includes("already on '")
      || text.includes('this server is powered by plesk')
      || text.includes("run the 'plesk login' command")
      || text.includes("use the 'plesk' command")
      || text.includes('error: write epipe')
    ) {
      return 'warn';
    }

    return 'error';
  }

  #resolveAutoMigrationCommandLocal(repoDir, packageManager) {
    const detectedTool = detectLocalMigrationTool(repoDir);
    if (!detectedTool || detectedTool === 'none') {
      return { tool: 'none', command: '' };
    }

    return {
      tool: detectedTool,
      command: defaultMigrationCommand(detectedTool, packageManager),
    };
  }

  async #resolveAutoMigrationCommandRemote(conn, remoteRepoDir, packageManager) {
    const detectorScript = `
      set +e
      cd ${quote(remoteRepoDir)} || exit 0
      HAS_DEP() { [ -f package.json ] && grep -Fq "\\"$1\\"" package.json; }
      if [ -f prisma/schema.prisma ]; then echo prisma; exit 0; fi
      if [ -f .sequelizerc ] || [ -f sequelize.config.js ] || [ -f config/config.js ] || [ -f config/config.cjs ] || (HAS_DEP "sequelize-cli" && [ -d migrations ]); then echo sequelize; exit 0; fi
      if [ -f knexfile.js ] || [ -f knexfile.ts ] || [ -f knexfile.cjs ]; then echo knex; exit 0; fi
      if [ -f ormconfig.js ] || [ -f ormconfig.ts ] || [ -f ormconfig.json ] || (HAS_DEP "typeorm" && ([ -d src/migration ] || [ -d migration ] || [ -d migrations ])); then echo typeorm; exit 0; fi
      echo none
    `;

    try {
      const output = await this.#captureRemoteCommand(conn, detectorScript);
      const lines = String(output || '').split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean);
      const detectedTool = lines.find((line) => ['prisma', 'sequelize', 'knex', 'typeorm', 'none'].includes(line)) || 'none';
      if (!detectedTool || detectedTool === 'none') {
        return { tool: 'none', command: '' };
      }

      return {
        tool: detectedTool,
        command: defaultMigrationCommand(detectedTool, packageManager),
      };
    } catch (_error) {
      return { tool: 'none', command: '' };
    }
  }

  #extractPm2AppName(command) {
    const text = String(command || '');
    const matcher = text.match(/pm2\s+(?:reload|restart)\s+([^\s|;&]+)/i);
    if (!matcher || !matcher[1]) {
      return null;
    }

    return matcher[1].replace(/^['"]|['"]$/g, '').trim() || null;
  }

  #shouldAttemptPm2Rebind(command) {
    const text = String(command || '');
    const hasReloadOrRestart = /pm2\s+(?:reload|restart)\s+/i.test(text);
    const hasFallbackStart = /\|\|[\s\S]*pm2\s+start\s+/i.test(text);
    return hasReloadOrRestart && hasFallbackStart;
  }

  #buildPm2RebindPrelude(appName) {
    const quotedName = quote(appName);
    const quotedAppName = quote(appName);

    return `
      if command -v pm2 >/dev/null 2>&1; then
        if pm2 describe ${quotedName} >/dev/null 2>&1; then
          PM2_CWD="$(APP_NAME=${quotedAppName} pm2 jlist | node -e 'const fs=require("fs"); const app=process.env.APP_NAME || ""; const list=JSON.parse(fs.readFileSync(0, "utf8")); const item=list.find((it)=>it && it.name===app); process.stdout.write((item && item.pm2_env && item.pm2_env.pm_cwd) ? String(item.pm2_env.pm_cwd) : "");' 2>/dev/null || true)"
          if [ -n "$PM2_CWD" ] && [ "$PM2_CWD" != "$PWD" ]; then
            echo "PM2 process ${appName} is bound to old cwd: $PM2_CWD. Rebinding to $PWD."
            pm2 delete ${quotedName} >/dev/null 2>&1 || true
          fi
        fi
      fi
    `;
  }

  #normalizeRestartCommand(command) {
    const text = String(command || '').trim();
    if (!text) {
      return text;
    }

    // PM2 reload sometimes fails to refresh env for fork-mode npm apps.
    // For deploy correctness, prefer restart when --update-env is requested.
    if (/pm2\s+reload\b/i.test(text) && /--update-env\b/i.test(text)) {
      return text.replace(/pm2\s+reload\b/gi, 'pm2 restart');
    }

    return text;
  }

  #decorateRestartCommandWithPm2Rebind(restartCommand, deployPathConfigured) {
    const normalizedRestartCommand = this.#normalizeRestartCommand(restartCommand);
    if (!deployPathConfigured) {
      return normalizedRestartCommand;
    }

    if (!this.#shouldAttemptPm2Rebind(normalizedRestartCommand)) {
      return normalizedRestartCommand;
    }

    const appName = this.#extractPm2AppName(normalizedRestartCommand);
    if (!appName) {
      return normalizedRestartCommand;
    }

    const prelude = this.#buildPm2RebindPrelude(appName);
    return `${prelude}\n${normalizedRestartCommand}`;
  }

  #withEnvLoad(command) {
    const text = String(command || '').trim();
    if (!text) {
      return text;
    }

    return `set -a; [ -f ./.env ] && . ./.env; [ -f ./.env.production ] && . ./.env.production; set +a; ${text}`;
  }

  #commandHandlesEnv(command) {
    const text = String(command || '').toLowerCase();
    if (!text) {
      return false;
    }

    return (
      text.includes('./.env')
      || text.includes('.env.production')
      || text.includes('source .env')
      || text.includes('set -a')
      || text.includes('export ')
    );
  }

  #withEnvLoadIfNeeded(command) {
    if (this.#commandHandlesEnv(command)) {
      return String(command || '').trim();
    }
    return this.#withEnvLoad(command);
  }

  #resolveLocalRepoDir(workspaceDir, project) {
    const preferredName = repoDirNameFromUrl(project.repo_url);
    const preferredDir = path.join(workspaceDir, preferredName);
    const legacyDir = path.join(workspaceDir, 'repo');

    if (fsSync.existsSync(path.join(preferredDir, '.git'))) {
      return preferredDir;
    }

    if (preferredName !== 'repo' && fsSync.existsSync(path.join(legacyDir, '.git'))) {
      return legacyDir;
    }

    return preferredDir;
  }

  async #resolveRemoteRepoDir(conn, remoteBase, project) {
    const preferredName = repoDirNameFromUrl(project.repo_url);
    const preferredDir = path.posix.join(remoteBase, preferredName);
    const legacyDir = path.posix.join(remoteBase, 'repo');

    if (preferredName === 'repo') {
      return preferredDir;
    }

    const checkScript = `
      set +e
      if [ -d ${quote(path.posix.join(preferredDir, '.git'))} ]; then echo preferred; exit 0; fi
      if [ -d ${quote(path.posix.join(legacyDir, '.git'))} ]; then echo legacy; exit 0; fi
      echo preferred
    `;

    try {
      const output = await this.#captureRemoteCommand(conn, checkScript);
      const marker = String(output || '').split(/\r?\n/).map((line) => line.trim().toLowerCase()).find(Boolean);
      if (marker === 'legacy') {
        return legacyDir;
      }
    } catch (_error) {
      // Fallback to preferred dir name.
    }

    return preferredDir;
  }

  async #runDeployment(deploymentId) {
    const deployment = this.db.getDeploymentById(deploymentId);
    if (!deployment) {
      return;
    }

    if (this.cancellations.has(deploymentId)) {
      this.db.setDeploymentStatus({
        id: deploymentId,
        status: 'cancelled',
        error_message: 'Cancelled before execution',
        started_at: null,
        completed_at: new Date().toISOString(),
        duration_ms: 0,
        release_path: null,
      });
      this.#emitStatus(deploymentId, 'cancelled', { message: 'Cancelled before run' });
      return;
    }

    const startedAt = Date.now();
    this.db.setDeploymentStatus({
      id: deploymentId,
      status: 'running',
      error_message: null,
      started_at: new Date(startedAt).toISOString(),
      completed_at: null,
      duration_ms: null,
      release_path: null,
    });
    this.#emitStatus(deploymentId, 'running', { message: 'Deployment started' });

    const project = this.db.getProjectById(deployment.project_id);
    if (!project) {
      this.db.setDeploymentStatus({
        id: deploymentId,
        status: 'failed',
        error_message: 'Project not found',
        started_at: null,
        completed_at: new Date().toISOString(),
        duration_ms: 0,
        release_path: null,
      });
      this.#emitStatus(deploymentId, 'failed', { message: 'Project not found' });
      return;
    }

    const defaults = defaultCommands(project.framework, {
      packageManager: project.package_manager,
      migrationTool: project.migration_tool,
    });
    const installCommand = project.install_command == null ? defaults.install : project.install_command;
    const buildCommand = project.build_command == null ? defaults.build : project.build_command;
    const configuredMigrationCommand = typeof project.migration_command === 'string'
      ? project.migration_command.trim()
      : '';
    const migrationCommand = configuredMigrationCommand || defaults.migration || '';
    const restartCommand = project.restart_command || project.start_command || defaults.start;
    const outputDir = project.output_dir || defaults.outputDir;

    const requestedServer = deployment.server_id ? this.db.getServerById(deployment.server_id) : null;
    const fallbackServer = requestedServer ? null : this.db.getDefaultServer(project.id);
    const targetServer = requestedServer || fallbackServer;

    let releasePath = null;

    try {
      if (targetServer) {
        releasePath = await this.#runRemoteDeployment({
          deployment,
          project,
          server: targetServer,
          installCommand,
          buildCommand,
          migrationCommand,
          restartCommand,
          outputDir,
        });
      } else {
        releasePath = await this.#runLocalDeployment({
          deployment,
          project,
          installCommand,
          buildCommand,
          migrationCommand,
          restartCommand,
          outputDir,
        });
      }

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startedAt;
      this.db.setDeploymentStatus({
        id: deploymentId,
        status: 'success',
        error_message: null,
        started_at: null,
        completed_at: completedAt,
        duration_ms: durationMs,
        release_path: releasePath,
      });
      this.#emitLog(deploymentId, `Deployment completed in ${Math.round(durationMs / 1000)}s`, 'success');
      this.#emitStatus(deploymentId, 'success', { message: 'Deployment succeeded' });
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startedAt;
      const finalStatus = this.cancellations.has(deploymentId) ? 'cancelled' : 'failed';
      const message = error && error.message ? error.message : 'Unknown deployment error';

      this.db.setDeploymentStatus({
        id: deploymentId,
        status: finalStatus,
        error_message: message,
        started_at: null,
        completed_at: completedAt,
        duration_ms: durationMs,
        release_path: releasePath,
      });

      this.#emitLog(deploymentId, message, 'error');
      this.#emitStatus(deploymentId, finalStatus, { message });
    } finally {
      this.cancellations.delete(deploymentId);
      this.runningProcesses.delete(deploymentId);
    }
  }

  async #runLocalDeployment({
    deployment,
    project,
    installCommand,
    buildCommand,
    migrationCommand,
    restartCommand,
    outputDir,
  }) {
    const deploymentId = deployment.id;
    const workspaceDir = path.resolve(this.workspaceRoot, project.id);
    const repoDir = this.#resolveLocalRepoDir(workspaceDir, project);
    let releasePath = null;

    await fs.mkdir(workspaceDir, { recursive: true });

    this.#emitLog(deploymentId, `Preparing local repository for ${project.name}`);
    await this.#prepareLocalRepository({ deploymentId, project, repoDir });

    if (this.cancellations.has(deploymentId)) {
      throw new Error('Deployment cancelled');
    }

    const gitInfo = await this.#gitInfoLocal(repoDir);
    this.db.setDeploymentGitInfo(deploymentId, gitInfo.hash, gitInfo.message, project.branch);
    this.#emitLog(deploymentId, `Checked out ${gitInfo.hash.slice(0, 8)} on branch ${project.branch}`);

    const envVars = this.db.listEnvVars(project.id, deployment.environment);
    await this.#writeLocalEnvFile(repoDir, envVars, deploymentId);

    if (installCommand) {
      await this.#runLocalCommand({ deploymentId, cwd: repoDir, command: installCommand, label: 'Install dependencies' });
    }

    if (buildCommand) {
      await this.#runLocalCommand({ deploymentId, cwd: repoDir, command: buildCommand, label: 'Build project' });
    }

    if (project.deploy_path) {
      releasePath = await this.#createLocalRelease({ deploymentId, project, repoDir, outputDir });
      await this.#switchLocalCurrentSymlink(project.deploy_path, releasePath);
      this.#emitLog(deploymentId, `Updated local current symlink to ${releasePath}`);
      await this.#cleanupLocalOldReleases(project.deploy_path);
    }

    let effectiveMigrationCommand = migrationCommand;
    if (!effectiveMigrationCommand) {
      const auto = this.#resolveAutoMigrationCommandLocal(repoDir, project.package_manager);
      if (auto.command) {
        effectiveMigrationCommand = auto.command;
        this.#emitLog(deploymentId, `Auto-detected migration tool: ${auto.tool}. Running default migration command.`);
      }
    }

    if (effectiveMigrationCommand) {
      await this.#runLocalCommand({
        deploymentId,
        cwd: repoDir,
        command: this.#withEnvLoadIfNeeded(effectiveMigrationCommand),
        label: 'Run database migrations',
      });
    }

    if (restartCommand) {
      const commandCwd = project.deploy_path ? path.join(project.deploy_path, 'current') : repoDir;
      const effectiveRestartCommand = this.#decorateRestartCommandWithPm2Rebind(
        restartCommand,
        Boolean(project.deploy_path),
      );
      await this.#runLocalCommand({
        deploymentId,
        cwd: commandCwd,
        command: this.#withEnvLoad(effectiveRestartCommand),
        label: 'Start/Restart service',
      });
    }

    return releasePath;
  }

  async #runRemoteDeployment({
    deployment,
    project,
    server,
    installCommand,
    buildCommand,
    migrationCommand,
    restartCommand,
    outputDir,
  }) {
    const deploymentId = deployment.id;
    const deployRoot = project.deploy_path && project.deploy_path.trim()
      ? project.deploy_path.trim()
      : `/opt/sshipit/${project.id}`;
    const remoteBase = deployRoot.replace(/\/$/, '');
    const remoteReleasesDir = path.posix.join(remoteBase, 'releases');
    const remoteCurrentDir = path.posix.join(remoteBase, 'current');

    if (!this.decryptSecret) {
      throw new Error('Decrypt function is not configured for SSH deployment');
    }

    const auth = JSON.parse(this.decryptSecret(server.encrypted_auth));

    this.#emitLog(deploymentId, `Connecting over SSH to ${server.username}@${server.host}:${server.port}`);
    const conn = await this.#connectRemote(server, auth);
    this.runningProcesses.set(deploymentId, { terminate: () => conn.end() });
    const remoteRepoDir = await this.#resolveRemoteRepoDir(conn, remoteBase, project);

    let releasePath = null;

    try {
      await this.#prepareRemoteRepository({
        conn,
        deploymentId,
        project,
        remoteRepoDir,
      });

      if (this.cancellations.has(deploymentId)) {
        throw new Error('Deployment cancelled');
      }

      const rawGitHash = (await this.#captureRemoteCommand(conn, `cd ${quote(remoteRepoDir)} && git rev-parse HEAD`)).trim();
      const rawGitMessage = (await this.#captureRemoteCommand(conn, `cd ${quote(remoteRepoDir)} && git log -1 --pretty=%s`)).trim();
      const hashLines = rawGitHash.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const messageLines = rawGitMessage.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const gitHash = hashLines.find((line) => /^[0-9a-f]{40}$/i.test(line)) || hashLines[hashLines.length - 1] || '';
      const gitMessage = messageLines[messageLines.length - 1] || '';

      this.db.setDeploymentGitInfo(deploymentId, gitHash, gitMessage, project.branch);
      this.#emitLog(deploymentId, `Remote repository at ${gitHash.slice(0, 8)} on ${project.branch}`);

      const envVars = this.db.listEnvVars(project.id, deployment.environment);
      const envContent = `${envVars.map((entry) => `${entry.key}=${entry.value}`).join('\n')}\n`;
      this.#emitLog(deploymentId, `Uploading remote env files (${envVars.length} key(s))`);
      await this.#writeRemoteFile(conn, path.posix.join(remoteRepoDir, '.env'), envContent);
      await this.#writeRemoteFile(conn, path.posix.join(remoteRepoDir, '.env.production'), envContent);
      this.#emitLog(deploymentId, `Uploaded ${envVars.length} environment variable(s) to remote .env and .env.production`);

      if (installCommand) {
        await this.#runRemoteCommand({
          conn,
          deploymentId,
          label: 'Install dependencies (remote)',
          command: `cd ${quote(remoteRepoDir)} && ${installCommand}`,
        });
      }

      if (buildCommand) {
        await this.#runRemoteCommand({
          conn,
          deploymentId,
          label: 'Build project (remote)',
          command: `cd ${quote(remoteRepoDir)} && ${buildCommand}`,
        });
      }

      if (project.deploy_path && project.deploy_path.trim()) {
        const releaseName = `${Date.now()}-${deploymentId.slice(0, 8)}`;
        releasePath = path.posix.join(remoteReleasesDir, releaseName);
        const sourceDir = outputDir ? path.posix.join(remoteRepoDir, outputDir) : remoteRepoDir;

        await this.#runRemoteCommand({
          conn,
          deploymentId,
          label: 'Create release (remote)',
          command: `
            set -e
            mkdir -p ${quote(remoteReleasesDir)}
            if [ ! -d ${quote(sourceDir)} ]; then
              echo "Output directory missing: ${sourceDir}"
              exit 1
            fi
            mkdir -p ${quote(releasePath)}
            cp -a ${quote(`${sourceDir}/.`)} ${quote(`${releasePath}/`)}
            ln -sfn ${quote(releasePath)} ${quote(remoteCurrentDir)}
          `,
        });

        await this.#runRemoteCommand({
          conn,
          deploymentId,
          label: 'Cleanup old releases (remote)',
          command: `
            set +e
            cd ${quote(remoteReleasesDir)}
            OLD="$(ls -1dt */ 2>/dev/null | tail -n +${this.keepReleases + 1})"
            if [ -n "$OLD" ]; then
              echo "$OLD" | while IFS= read -r d; do rm -rf "$d"; done
            fi
            exit 0
          `,
        });
      }

      let effectiveMigrationCommand = migrationCommand;
      if (!effectiveMigrationCommand) {
        const auto = await this.#resolveAutoMigrationCommandRemote(conn, remoteRepoDir, project.package_manager);
        if (auto.command) {
          effectiveMigrationCommand = auto.command;
          this.#emitLog(deploymentId, `Auto-detected migration tool on remote: ${auto.tool}. Running default migration command.`);
        }
      }

      if (effectiveMigrationCommand) {
        await this.#runRemoteCommand({
          conn,
          deploymentId,
          label: 'Run database migrations (remote)',
          command: `cd ${quote(remoteRepoDir)} && ${this.#withEnvLoadIfNeeded(effectiveMigrationCommand)}`,
        });
      }

      if (restartCommand) {
        const runPath = project.deploy_path && project.deploy_path.trim() ? remoteCurrentDir : remoteRepoDir;
        const effectiveRestartCommand = this.#decorateRestartCommandWithPm2Rebind(
          restartCommand,
          Boolean(project.deploy_path && project.deploy_path.trim()),
        );
        await this.#runRemoteCommand({
          conn,
          deploymentId,
          label: 'Start/Restart service (remote)',
          command: `cd ${quote(runPath)} && ${this.#withEnvLoad(effectiveRestartCommand)}`,
        });
      }

      return releasePath;
    } finally {
      conn.end();
    }
  }

  async #prepareLocalRepository({ deploymentId, project, repoDir }) {
    const gitDir = path.join(repoDir, '.git');
    const exists = fsSync.existsSync(gitDir);

    if (!exists) {
      await fs.rm(repoDir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(repoDir), { recursive: true });
      this.#emitLog(deploymentId, `Cloning ${project.repo_url} (${project.branch})`);
      await this.#runLocalCommand({
        deploymentId,
        cwd: path.dirname(repoDir),
        command: `git clone --branch ${quote(project.branch)} --single-branch ${quote(project.repo_url)} ${quote(path.basename(repoDir))}`,
        label: 'Clone repository',
      });
      return;
    }

    this.#emitLog(deploymentId, 'Repository exists locally, fetching latest changes');
    await this.#runLocalCommand({ deploymentId, cwd: repoDir, command: 'git fetch --all --prune', label: 'Fetch origin' });
    await this.#runLocalCommand({
      deploymentId,
      cwd: repoDir,
      command: `git checkout ${quote(project.branch)}`,
      label: 'Checkout branch',
    });
    await this.#runLocalCommand({
      deploymentId,
      cwd: repoDir,
      command: `git reset --hard ${quote(`origin/${project.branch}`)}`,
      label: 'Sync branch with origin',
    });
    await this.#runLocalCommand({ deploymentId, cwd: repoDir, command: 'git clean -fd', label: 'Clean workspace' });
  }

  async #prepareRemoteRepository({ conn, deploymentId, project, remoteRepoDir }) {
    await this.#runRemoteCommand({
      conn,
      deploymentId,
      label: 'Prepare remote repository',
      command: `
        set -e
        mkdir -p ${quote(path.posix.dirname(remoteRepoDir))}
        if [ ! -d ${quote(path.posix.join(remoteRepoDir, '.git'))} ]; then
          git clone --branch ${quote(project.branch)} --single-branch ${quote(project.repo_url)} ${quote(remoteRepoDir)}
        fi
        cd ${quote(remoteRepoDir)}
        git fetch --all --prune
        git checkout ${quote(project.branch)}
        git reset --hard ${quote(`origin/${project.branch}`)}
        git clean -fd
      `,
    });
  }

  async #gitInfoLocal(repoDir) {
    const hash = await this.#captureLocalCommand(repoDir, 'git rev-parse HEAD');
    const message = await this.#captureLocalCommand(repoDir, 'git log -1 --pretty=%s');
    return { hash: hash.trim(), message: message.trim() };
  }

  async #writeLocalEnvFile(repoDir, envVars, deploymentId) {
    const envContent = envVars.map((entry) => `${entry.key}=${entry.value}`).join('\n');
    const envData = `${envContent}\n`;
    const envPath = path.join(repoDir, '.env');
    const envProductionPath = path.join(repoDir, '.env.production');

    await fs.writeFile(envPath, envData, 'utf8');
    await fs.writeFile(envProductionPath, envData, 'utf8');
    this.#emitLog(deploymentId, `Wrote ${envVars.length} environment variable(s) to local .env and .env.production`);
  }

  async #createLocalRelease({ deploymentId, project, repoDir, outputDir }) {
    const deployPath = path.resolve(project.deploy_path);
    const releasesDir = path.join(deployPath, 'releases');
    await fs.mkdir(releasesDir, { recursive: true });

    const releaseName = `${Date.now()}-${deploymentId.slice(0, 8)}`;
    const releasePath = path.join(releasesDir, releaseName);
    await fs.mkdir(releasePath, { recursive: true });

    const source = outputDir ? path.join(repoDir, outputDir) : repoDir;

    if (!fsSync.existsSync(source)) {
      throw new Error(`Output source not found: ${source}. Set output_dir correctly for this project.`);
    }

    this.#emitLog(deploymentId, `Creating local release from ${source}`);

    await fs.cp(source, releasePath, {
      recursive: true,
      force: true,
      filter: (src) => {
        if (src.endsWith(path.sep + '.git') || src.includes(path.sep + '.git' + path.sep)) {
          return false;
        }
        if (src.endsWith(path.sep + 'node_modules') || src.includes(path.sep + 'node_modules' + path.sep)) {
          return false;
        }
        return true;
      },
    });

    return releasePath;
  }

  async #switchLocalCurrentSymlink(deployPath, releasePath) {
    const currentLink = path.join(path.resolve(deployPath), 'current');
    const tmpLink = `${currentLink}.tmp`;

    await fs.rm(tmpLink, { recursive: true, force: true });
    await fs.symlink(releasePath, tmpLink, 'dir');
    await fs.rename(tmpLink, currentLink);
  }

  async #cleanupLocalOldReleases(deployPath) {
    const releasesDir = path.join(path.resolve(deployPath), 'releases');
    if (!fsSync.existsSync(releasesDir)) {
      return;
    }

    const entries = await fs.readdir(releasesDir, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? 1 : -1));

    const toDelete = dirs.slice(this.keepReleases);
    for (const dir of toDelete) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(path.join(releasesDir, dir), { recursive: true, force: true });
    }
  }

  async #connectRemote(server, auth) {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      const config = {
        host: server.host,
        port: Number(server.port) || 22,
        username: server.username,
        readyTimeout: 15000,
      };

      if (server.auth_type === 'password') {
        config.password = auth.password;
      } else {
        config.privateKey = auth.private_key;
        if (auth.passphrase) {
          config.passphrase = auth.passphrase;
        }
      }

      conn.on('ready', () => resolve(conn));
      conn.on('error', (error) => reject(error));
      conn.connect(config);
    });
  }

  async #writeRemoteFile(conn, remotePath, content, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Timed out while writing remote file: ${remotePath}`));
      }, timeoutMs);

      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };

      conn.sftp((error, sftp) => {
        if (error) {
          fail(error);
          return;
        }

        sftp.open(remotePath, 'w', (openError, handle) => {
          if (openError) {
            fail(openError);
            return;
          }

          const payload = Buffer.from(content, 'utf8');
          if (payload.length === 0) {
            sftp.close(handle, (closeError) => {
              if (closeError) {
                fail(closeError);
                return;
              }
              done();
            });
            return;
          }

          const writeChunk = (position) => {
            if (position >= payload.length) {
              sftp.close(handle, (closeError) => {
                if (closeError) {
                  fail(closeError);
                  return;
                }
                done();
              });
              return;
            }

            const chunkSize = Math.min(32 * 1024, payload.length - position);
            const chunk = payload.subarray(position, position + chunkSize);

            sftp.write(handle, chunk, 0, chunk.length, position, (writeError, bytesWritten) => {
              if (writeError) {
                sftp.close(handle, () => {});
                fail(writeError);
                return;
              }

              const step = Number(bytesWritten) > 0 ? Number(bytesWritten) : chunk.length;
              writeChunk(position + step);
            });
          };

          writeChunk(0);
        });
      });
    });
  }

  async #captureRemoteCommand(conn, command) {
    return new Promise((resolve, reject) => {
      conn.exec(`bash -lc ${quote(command)}`, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }

        let stdout = '';
        let stderr = '';

        channel.on('data', (chunk) => {
          stdout += chunk.toString('utf8');
        });

        channel.stderr.on('data', (chunk) => {
          stderr += chunk.toString('utf8');
        });

        channel.on('close', (code) => {
          if (code === 0) {
            resolve(stdout.trim());
            return;
          }
          reject(new Error(stderr || `Remote command failed with exit code ${code}`));
        });
      });
    });
  }

  async #runRemoteCommand({ conn, deploymentId, command, label }) {
    this.#emitLog(deploymentId, `${label}: ${command.replace(/\s+/g, ' ').trim()}`);

    await new Promise((resolve, reject) => {
      conn.exec(`bash -lc ${quote(command)}`, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }

        this.runningProcesses.set(deploymentId, {
          terminate: () => {
            channel.close();
            conn.end();
          },
        });

        channel.on('data', (chunk) => {
          for (const line of splitLines(chunk)) {
            this.#emitLog(deploymentId, line);
          }
        });

        channel.stderr.on('data', (chunk) => {
          for (const line of splitLines(chunk)) {
            this.#emitLog(deploymentId, line, this.#classifyStderrLine(line));
          }
        });

        channel.on('close', (code, signal) => {
          if (this.cancellations.has(deploymentId)) {
            reject(new Error('Deployment process was terminated'));
            return;
          }

          if (signal) {
            reject(new Error(`${label} terminated by signal ${signal}`));
            return;
          }

          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(`${label} failed with exit code ${code}`));
        });
      });
    });
  }

  async #captureLocalCommand(cwd, command) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        env: process.env,
      });

      let output = '';
      let errorOutput = '';

      child.stdout.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk) => {
        errorOutput += chunk.toString('utf8');
      });

      child.on('error', (error) => reject(error));
      child.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
          return;
        }
        reject(new Error(errorOutput || `Command failed: ${command}`));
      });
    });
  }

  async #runLocalCommand({ deploymentId, cwd, command, label }) {
    this.#emitLog(deploymentId, `${label}: ${command}`);

    await new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        env: process.env,
      });

      this.runningProcesses.set(deploymentId, {
        terminate: () => child.kill('SIGTERM'),
      });

      child.stdout.on('data', (chunk) => {
        for (const line of splitLines(chunk)) {
          this.#emitLog(deploymentId, line);
        }
      });

      child.stderr.on('data', (chunk) => {
        for (const line of splitLines(chunk)) {
          this.#emitLog(deploymentId, line, this.#classifyStderrLine(line));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code, signal) => {
        if (signal === 'SIGTERM') {
          reject(new Error('Deployment process was terminated'));
          return;
        }

        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`${label} failed with exit code ${code}`));
      });
    });
  }
}

module.exports = {
  DeployRunner,
  defaultCommands,
};

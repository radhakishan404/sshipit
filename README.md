# SSHipIt

Self-hosted CI/CD over SSH for Node.js, Next.js, and React projects.

No GitHub Actions required. No "who has root access?" in team chat. No more terminal acrobatics.

## Name ideas (if you want alternatives)

- `SSHipIt` (recommended)
- `PushPilot`
- `DeployDost`
- `ShipStack`
- `ProdPush`

This repo is prepared with `SSHipIt` branding.

## Why this exists

I used to deploy like this:

1. SSH into server
2. pull code
3. run install
4. run build
5. run migration
6. restart PM2
7. pray

Repeat this for every project.

So I built SSHipIt to make deployments boring, repeatable, and safe.

## What SSHipIt does

- Project CRUD for Node.js, Next.js, React
- Reusable SSH servers across multiple projects
- Encrypted server secrets at rest (AES-256-GCM)
- Bulk `.env` management (because one-key-at-a-time is pain)
- Manual production deploy from UI
- Live streaming deploy logs
- Deployment history with status filters
- Redeploy / cancel / delete deployment records
- Smart stack defaults for commands
- Migration support (Prisma/Sequelize/Knex/TypeORM)
- Release directories + `current` symlink flow

## Quick start

```bash
git clone https://github.com/radhakishan404/sshipit.git
cd sshipit
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000` (or your configured `PORT`).

Required env vars:
- `PORT`
- `DATABASE_PATH`
- `WORKSPACE_ROOT`
- `KEEP_RELEASES`
- `ENCRYPTION_KEY` (set a strong random value)

## Manual deployment flow

1. Create project
2. Pick framework and apply smart defaults
3. Paste production env in bulk
4. Add/attach SSH server
5. Test SSH connection
6. Select target server
7. Click `Deploy Now`
8. Watch logs and go drink water

## API endpoints (high level)

- `GET /api/projects`
- `POST /api/projects`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/env`
- `POST /api/projects/:id/env/bulk`
- `GET /api/projects/:id/servers`
- `POST /api/projects/:id/deploy`
- `GET /api/projects/:id/deployments`
- `POST /api/deployments/:id/redeploy`
- `POST /api/deployments/:id/cancel`
- `DELETE /api/deployments/:id`

WebSocket: `ws://localhost:3000/ws`

## Open source launch checklist

When you create your GitHub repo:

1. Create repo (example): `radhakishan404/sshipit`
2. Push this code
3. Set repo description:
   - `Self-hosted CI/CD over SSH for Node.js, Next.js and React apps`
4. Add topics:
   - `cicd`, `self-hosted`, `ssh`, `deployment`, `nodejs`, `nextjs`, `react`
5. Add project screenshot in README
6. Pin repo on your profile
7. Post launch thread with a short story + demo gif

If you choose a different repo name than `sshipit`, update:
- `package.json` (`name`, `repository`, `homepage`, `bugs`)
- README clone URL

## Roadmap (future improvements)

PRs are welcome for all of these:

- Git webhook auto-deploy (GitHub/GitLab/Bitbucket)
- Build/test pipeline gates
- Health-check gate before success
- One-click rollback in UI
- Blue/green and canary strategies
- Better zero-downtime helpers
- Secret backends (Vault, SSM)
- Slack/Discord/Email notifications
- Multi-user auth + RBAC
- Audit export and reporting
- Docker and Compose deploy mode
- Kubernetes adapter
- Better deployment analytics

If you want to build any item from this roadmap, open a PR directly.

## Contributing

See `/CONTRIBUTING.md`.

Issues:
- Bugs: use bug template
- Ideas: use feature template

PRs:
- Keep changes focused
- Add logs/screenshots for deploy/UI changes
- Explain why this change is needed

## Security

See `/SECURITY.md` for responsible disclosure.

## License

MIT - see `/LICENSE`.

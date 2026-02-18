# Contributing to SSHipIt

Thanks for contributing.

## Quick rules

- Keep PRs focused (one problem per PR)
- Explain the real-world deploy problem being solved
- For UI changes, add screenshot(s)
- For deploy runner changes, add sample log output
- Do not commit secrets, `.env`, or database files

## Setup

```bash
npm install
cp .env.example .env
npm start
```

## Branch naming

Use clear names, for example:
- `fix/pm2-env-reload`
- `feat/github-webhook-trigger`
- `docs/readme-roadmap-update`

## Commit style

Small, readable commits are preferred.

Examples:
- `fix: load env before pm2 restart on remote`
- `feat: add bulk env import in project form`
- `docs: add open source roadmap`

## Pull request checklist

- [ ] I tested the change locally
- [ ] I did not break existing deploy flow
- [ ] I updated docs (if behavior changed)
- [ ] I added screenshots/log snippets (if useful)

## Good first issues

- Better deploy log readability
- Better framework defaults
- Validation hardening
- Docs improvements

If stuck, open a draft PR early.

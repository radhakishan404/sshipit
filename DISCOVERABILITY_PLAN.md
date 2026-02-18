# SSHipIt Discoverability Plan

This is a practical plan to help SSHipIt get discovered by developers who actually deploy over SSH.

## Goal

- Get first real users
- Get first 100+ stars
- Get first external PRs

## Positioning (one line)

`Self-hosted CI/CD over SSH for Node.js/Next.js/React. Deploy without giving your server to third-party CI.`

## Launch Week Checklist

- [ ] Pin repo on GitHub profile
- [ ] Add repo description and topics
- [ ] Add 1 clean screenshot and 1 short deploy GIF
- [ ] Create first release tag (`v1.0.0`)
- [ ] Publish a launch post on X + LinkedIn
- [ ] Submit to:
  - [ ] Hacker News ("Show HN")
  - [ ] Reddit: `r/selfhosted`, `r/node`, `r/devops`
  - [ ] dev.to article
  - [ ] Product Hunt (optional)

## GitHub Repo Optimization

- Topics:
  - `cicd`, `self-hosted`, `ssh`, `deployment`, `nodejs`, `nextjs`, `react`, `devops`
- Enable:
  - Discussions
  - Issue templates
  - PR template
- Add social preview image (1200x630)
- Keep README updated with latest screenshot/GIF

## Content Plan (2 weeks)

### Week 1

1. Post: "Why I built SSHipIt"
2. Post: "Deploy Next.js via SSH in 90 seconds"
3. Post: "How bulk env + migration support saves mistakes"
4. Post: "Live logs + rollback roadmap"

### Week 2

1. Comparison post: SSHipIt vs manual SSH deploy
2. Demo reel (short GIF/video)
3. "Good first issues" post for contributors
4. Share one real user setup (anonymized)

## Launch Post Templates

## X (Twitter)

```text
I got tired of deploying like this:
ssh -> git pull -> install -> build -> migrate -> pm2 restart -> pray 😅

So I built SSHipIt 🚀
Self-hosted CI/CD over SSH for Node.js / Next.js / React.

No GitHub Actions required.
No sharing production server with 3rd-party CI.

Repo: https://github.com/radhakishan404/sshipit
```

## LinkedIn

```text
I open sourced SSHipIt: a self-hosted CI/CD tool for Node.js, Next.js, and React apps.

Why I built it:
- I wanted complete control over production deployments
- I didn't want to rely on third-party CI for every deploy
- I wanted a clean UI for envs, logs, history, and server management

What it supports:
- SSH-based deployment
- Bulk production env management
- Live deployment logs
- Migration support (Prisma/Sequelize/Knex/TypeORM)

Would love feedback and contributions:
https://github.com/radhakishan404/sshipit
```

## dev.to Article Outline

- Problem: painful manual SSH deploy loops
- Why existing workflows felt heavy
- What SSHipIt does
- Demo GIF
- Architecture overview
- Roadmap + invite contributors

## Community Distribution Targets

- `r/selfhosted` (strong fit)
- `r/devops`
- `r/node`
- HN Show
- Indie Hackers
- Dev.to

## Contributor Funnel

- Add 5-10 labeled "good first issue" tickets
- Add one "help wanted" issue for roadmap items
- Reply quickly to first-time contributors
- Keep PR reviews fast and specific

## Metrics to Track Weekly

- GitHub stars
- New issues
- New PRs
- README views / unique visitors (GitHub insights)
- Deploy-related discussions

## Fast Improvements That Increase Adoption

- Add webhook auto deploy
- Add one-click rollback
- Add docs with stack recipes:
  - Next.js + Prisma
  - Node API + PM2
  - React static + Nginx

## Brand Consistency

Use same line everywhere:

`SSHipIt: Self-hosted CI/CD over SSH for Node.js, Next.js, and React apps.`


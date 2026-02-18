# Release Checklist

Use this checklist before every tag/release.

## Pre-release

- [ ] Pull latest `main`
- [ ] Ensure working tree is clean
- [ ] Run app locally (`npm start`)
- [ ] Verify key flows:
  - [ ] create project
  - [ ] save env in bulk
  - [ ] save/test SSH server
  - [ ] deploy and view live logs
- [ ] Update docs if behavior changed
- [ ] Update `CHANGELOG.md`

## Version and tag

- [ ] Bump version in `package.json` (if needed)
- [ ] Commit version/changelog updates
- [ ] Create annotated tag:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
```

- [ ] Push code and tags:

```bash
git push origin main
git push origin --tags
```

## GitHub release

- [ ] Open `Releases` > `Draft a new release`
- [ ] Select tag `vX.Y.Z`
- [ ] Title: `SSHipIt vX.Y.Z`
- [ ] Generate release notes
- [ ] Add a short “Highlights” section
- [ ] Publish release

## Post-release

- [ ] Update launch/discovery posts if major update
- [ ] Share release notes link
- [ ] Open follow-up issues for next cycle


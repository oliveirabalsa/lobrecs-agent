# Updates

Lobrecs Agent uses `electron-updater` with the publish target configured in
`electron-builder.yml`.

## Runtime Flow

1. A packaged app starts and checks for updates when
   `general.checkForUpdates` is enabled.
2. The renderer shows an update banner only when a newer version is available,
   downloading, or ready to install.
3. The app never installs immediately. The user must click `Download`, then
   `Restart to update`.
4. `Restart to update` calls `quitAndInstall`, so active agent sessions should
   be stopped or allowed to finish before restarting.

Development builds show updates as unavailable unless
`LOBRECS_AGENT_FORCE_DEV_UPDATE=1` and a matching `dev-app-update.yml` are
provided.

## Releasing A New macOS Build

Run `npm run release` (or `npm run release:minor`/`npm run release:major` for minor/major bumps).

The release script automates the entire process:

1. **Validates** git state (clean working directory, on `main` branch, up to date with origin)
2. **Validates** GitHub authentication (`GH_TOKEN`, `GITHUB_TOKEN`, or `gh cli`)
3. **Bumps** the version in `package.json` and `electron-builder.yml` (defaults to patch)
4. **Commits and tags** the version bump (`git commit` + `git tag v0.1.X`)
5. **Pushes** commits and tags to GitHub
6. **Builds and publishes** the DMG, ZIP, and metadata to `oliveirabalsa/lobrecs-agent-releases`

Users on older installed versions can check, download, and restart from inside the app.

### Setup (first time only)

If `oliveirabalsa/lobrecs-agent-releases` was created recently, seed it with an initial commit such as `README.md`. GitHub rejects releases for empty repositories.

macOS auto-updates require a signed app. Unsigned local builds can still create
DMGs, but automatic update installation may fail during platform validation.

## Feed Constraints

The bundled publish provider currently points at
`oliveirabalsa/lobrecs-agent-releases`. The source code repo can stay private,
but the releases repo must stay public so installed apps can read the feed
anonymously. Private GitHub update feeds require a GitHub token on the
installed machine, which should not be stored in the app. For broader
distribution, prefer a public releases-only repository or a generic static feed
on a VPS/object store.

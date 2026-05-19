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

1. Run `rtk gh auth status` and confirm the GitHub CLI session is logged in.
2. Bump `package.json` to a higher semver version.
3. If `oliveirabalsa/lobrecs-agent-releases` was created recently, seed it with
   an initial commit such as `README.md`. GitHub rejects releases for empty
   repositories.
4. Run `rtk npm run release:mac`.
5. Electron Builder creates the DMG, ZIP, and update metadata in
   `dist-electron/`, then publishes them to the configured GitHub release.
6. Users on an older installed version can check, download, and restart from
   inside the app.

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

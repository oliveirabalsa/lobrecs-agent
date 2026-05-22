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
3. **Validates** macOS Developer ID signing and notarization prerequisites
4. **Bumps** the version in `package.json` and `electron-builder.yml` (defaults to patch)
5. **Commits and tags** the version bump (`git commit` + `git tag v0.1.X`)
6. **Pushes** commits and tags to GitHub
7. **Builds, notarizes, and publishes** the DMG, ZIP, and metadata to `oliveirabalsa/lobrecs-agent`

For local packaging tests, use `npm run build:mac` or
`npm run release -- --local` (or `npm run release:local`). Local mode builds
unsigned macOS artifacts only. It does not tag or publish, because unsigned or
ad-hoc-signed ZIP assets cannot be installed by the macOS auto-updater.

Users on older installed versions can check, download, and restart from inside the app.

### Setup (first time only)

If the repository releases page hasn't been used yet, ensure it is set up. GitHub rejects releases for empty repositories.

macOS auto-updates require a Developer ID signed and notarized app. The updater
uses Squirrel.Mac, which validates the downloaded replacement `.app` before
installing it. Do not bypass this validation in production. Unsigned or
ad-hoc-signed builds can still create local DMGs, but they must be installed
manually. Publish builds fail before the version bump unless signing and
notarization are configured.

Configure one signing source:

- Install a `Developer ID Application` certificate in the macOS keychain and
  leave `CSC_IDENTITY_AUTO_DISCOVERY` enabled.
- Or set `CSC_NAME` to the installed certificate name.
- Or set `CSC_LINK` to a `.p12` certificate path/base64 value and set
  `CSC_KEY_PASSWORD` when the certificate has a password.

Configure one notarization source:

- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` (preferred).
  `APPLE_API_KEY` may be a `.p8` file path, raw `.p8` contents, or base64
  encoded `.p8` contents. `APPLE_API_KEY_BASE64` is also accepted for CI.
- Or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
- Or a notarytool keychain profile through `APPLE_KEYCHAIN_PROFILE` (with
  `APPLE_KEYCHAIN` when the profile is not in the default keychain).

Do not commit these values or store them in app persistence. Keep them in the
local shell, keychain, or CI secret store used for the release command.

### GitHub Actions signing secrets

The release workflow intentionally fails the macOS packaging step if signing or
notarization secrets are missing, instead of publishing an update that installed
apps cannot apply. Configure one signing source and one notarization source in
the `lobrecs-agent` workflow environment:

- `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD`, or `MAC_CSC_NAME`.
- `APPLE_API_KEY` or `APPLE_API_KEY_BASE64`, plus `APPLE_API_KEY_ID` and
  `APPLE_API_ISSUER`; or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
  `APPLE_TEAM_ID`; or `APPLE_KEYCHAIN_PROFILE` with optional `APPLE_KEYCHAIN`.

## Feed Constraints

The bundled publish provider currently points at
`oliveirabalsa/lobrecs-agent`. Since the repository is public, installed apps can
read the feed and download updates anonymously without any API keys or tokens.
Private GitHub update feeds require a GitHub token on the installed machine,
which should not be stored in the app. For broader distribution, prefer a
public repository or a generic static feed on a VPS/object store.

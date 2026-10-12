# Releasing Codepulse

Releases are created from tags on `main`. Do not create or publish the GitHub
Release manually in the GitHub UI: the Release workflow creates it only after
every binary passes validation.

CI runs tests/types/lint on Linux, macOS, and Windows without binary builds.
The Release workflow owns the six-platform build/sign/smoke/archive matrix.
Manual `workflow_dispatch` runs validate and upload test binaries without
creating or modifying a GitHub Release; publication requires a pushed version tag.

## Prepare

1. Update `package.json`, `bun.lock`, and `CHANGELOG.md` to the same version.
2. Update user documentation for changed controls and configuration. Run local
   checks and build the host-platform executable with its embedded-asset smoke test:

   ```sh
   bun install --frozen-lockfile
   bun run check
   bun run check:types
   bun run test
   CODEPULSE_BUILD_ASSET_SMOKE=1 bun run build
   ```

   The build replaces only its target directory under `dist/`. On macOS, sign both executables using the
   entitlements and commands in the Release workflow before running them.
   Verify the binary's `--version`, embedded assets, and interactive startup
   using `bun scripts/smoke-binary.ts <binary> <repository>` on every platform.
   This checks selector startup, resize fallback/recovery, repository re-exec,
   and quit using Bun's native PTY support; Expect is not required.
   Windows validation uses native x64/ARM64 runners for tests, CLI, embedded-asset,
   and interactive executable smoke checks. Manually test
   both Windows architectures in Windows Terminal: graph/details/diffs, keyboard,
   mouse, resize, clipboard/browser actions, repo switching, and terminal restoration.
   Manually check wide/compact resizing, mouse and keyboard navigation, dialog
   return paths, and repository switching before tagging.
3. Merge the release changes through `develop` and then `main`.
4. Confirm CI passes for the exact `main` commit being released. Verify the
   commit shown by the workflow run, not only the branch name:

```sh
git switch main
git pull --ff-only origin main
gh run list --branch main --workflow CI --limit 5
```

## Tag

Create and push an annotated version tag matching `package.json`:

```sh
version="$(bun -p "require('./package.json').version")"
git tag -a "v$version" -m "Release v$version"
git push origin "v$version"
```

## Monitor

```sh
run_id="$(gh run list --workflow Release --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id" --exit-status
```

The workflow validates the tagged source, builds and tests all supported
platform artifacts, creates checksums, and publishes the GitHub Release only
after every matrix job succeeds.

Release assets include four macOS/Linux tarballs, Windows x64/ARM64 ZIPs,
`SHA256SUMS`, `install.sh`, and `install.ps1`. Interactive-test ZIPs are CI
artifacts only, not published release assets. Publication waits for every target
in the six-platform build matrix, including native Windows tests and smoke checks.
Windows executables are unsigned; SmartScreen reputation warnings are possible.

## Verify

`bun scripts/test-install.ts` runs offline in CI and release builds on every
platform. It checks the native installer (`install.sh` or `install.ps1`):
success, checksum/archive/download failures, preservation of an existing
installation, and cleanup. Unix checks also cover glibc rejection and signing
failures. These are development regression tests, not part of normal installation.
Both installers stage the executable before replacing an existing binary.

Verify the published assets and test installation in a temporary directory:

```sh
version="$(bun -p "require('./package.json').version")"
gh release view "v$version"
test_root="$(mktemp -d)"
install_dir="$test_root/bin"
curl -fsSL https://github.com/andreduejon/codepulse/releases/latest/download/install.sh |
  CODEPULSE_INSTALL_DIR="$install_dir" sh
"$install_dir/codepulse" --version
rm -rf "$test_root"
```

After Windows assets are published, verify installation and replacement on
each native architecture in PowerShell:

```powershell
$env:CODEPULSE_VERSION = 'v<release-version>'
$env:CODEPULSE_INSTALL_DIR = Join-Path $env:TEMP ('codepulse-install-' + [guid]::NewGuid())
try {
    Invoke-WebRequest "https://github.com/andreduejon/codepulse/releases/download/$env:CODEPULSE_VERSION/install.ps1" -OutFile "$env:TEMP/codepulse-install.ps1"
    & "$env:TEMP/codepulse-install.ps1"
    & (Join-Path $env:CODEPULSE_INSTALL_DIR 'codepulse.exe') --version
    & "$env:TEMP/codepulse-install.ps1" # Verify replacement of an existing install.
} finally {
    Remove-Item $env:CODEPULSE_INSTALL_DIR -Recurse -Force
    Remove-Item "$env:TEMP/codepulse-install.ps1" -Force
    Remove-Item Env:CODEPULSE_INSTALL_DIR, Env:CODEPULSE_VERSION
}
```

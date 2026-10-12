# Windows feasibility testing

Experimental builds, not a Windows support claim. Native runtime testing is
still required for both x64 and ARM64. These builds retain the current package
version (0.11.0); they are development artifacts for the 0.12.0 work.

## Build on macOS/Linux

Use Bun 1.4.3, matching CI/release pins. Bun 1.3.14 cannot initialize OpenTUI
on native Windows ARM64 because that runtime lacks the required FFI support.

Install optional native dependencies for cross-compilation without changing the
lockfile, then build each architecture:

```sh
bun install --frozen-lockfile --os='*' --cpu='*'
CODEPULSE_BUILD_TARGET=bun-windows-x64 CODEPULSE_BUILD_ASSET_SMOKE=1 bun run build
CODEPULSE_BUILD_TARGET=bun-windows-arm64 CODEPULSE_BUILD_ASSET_SMOKE=1 bun run build
```

Each build replaces only its target directory. Outputs:

- `dist/windows-x64/codepulse.exe` and `smoke-opentui-assets.exe`
- `dist/windows-arm64/codepulse.exe` and `smoke-opentui-assets.exe`

Copy the directory matching the Windows machine's native architecture. Bun and
Node.js are not required on the test machine; Git for Windows is required.

## Test in Windows Terminal / PowerShell

Run from the copied directory, replacing the repository path:

```powershell
git --version
.\codepulse.exe --version
.\codepulse.exe --help
.\smoke-opentui-assets.exe
.\codepulse.exe "C:\path with spaces\repository"
```

Record stdout/stderr and exit status (`$LASTEXITCODE`) for any failed command.
The asset smoke must exit successfully and report syntax highlights. CLI help
alone does not prove native rendering works.

Interactive checklist:

- Graph renders; arrow keys and selection work.
- Mouse clicks/wheel work without unexpected focus changes.
- Resize the terminal, including compact layout; app remains responsive.
- Open details, a diff with syntax highlighting, Help, Theme, and Debug.
- Test clipboard/browser actions and repository switching where configured.
- Exit with `q`; terminal input, cursor, and display return to normal.
- Restart and check persisted configuration.

Windows configuration is stored at `%APPDATA%\codepulse\config.json`; provider
caches use `%LOCALAPPDATA%\codepulse\Cache\<provider>`. If those environment
variables are absent, the corresponding `AppData\Roaming` and `AppData\Local`
directories under the user's home are used. Earlier experimental builds used
`~/.config` and `~/.cache`; those files are not automatically migrated.

Send machine architecture, Windows/Windows Terminal versions, failed command,
exit code, error text, and screenshots for rendering/input failures. Do not
disable Windows security protections to run a flagged binary; report the
warning for investigation.

## Native CI and installation checks

CI and Release call the Windows validation workflow on native `windows-latest`
(x64) and `windows-11-arm` (ARM64) runners. It checks native architecture, runs
tests, verifies installer failure handling, builds executables, and runs CLI
and embedded-asset smoke checks. CI uploads `test-windows-x64` and
`test-windows-arm64` artifacts for manual interactive testing. These checks do
not replace Windows Terminal input/resize/exit testing.

The release workflow packages Windows executables as ZIPs, includes them in
`SHA256SUMS`, and publishes `install.ps1`. The installer defaults to
`%LOCALAPPDATA%\codepulse\bin`; it prints PATH instructions without silently
changing the user's PATH. It will work against published releases only after
a release containing Windows assets exists.

Run offline installer checks from a source checkout:

```powershell
pwsh -NoProfile -File scripts/test-install-windows.ps1
```

Snyk supports a native executable or standard npm global/local `.cmd` shims;
the latter are resolved to the package's JavaScript entrypoint and require
Node.js. Custom batch wrappers are not supported. Cancellation terminates the
Windows process tree before removing the scan worktree. Test with your actual
Snyk installation as well as the synthetic CI fixture.

Remaining validation gates: successful native CI on both architectures,
interactive x64 and ARM64 testing, provider-specific external tools, and a
clean install/upgrade from the first published Windows release. Do not infer
these passed from cross-compilation alone.

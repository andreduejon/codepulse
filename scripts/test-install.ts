// Run offline on Unix or Windows: bun scripts/test-install.ts
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const windows = process.platform === "win32";
const powershell = windows ? (Bun.which("pwsh") ?? Bun.which("powershell")) : null;
const realMktemp = windows ? null : Bun.which("mktemp");
assert(windows ? powershell : realMktemp, windows ? "PowerShell required" : "mktemp required");

// Keep the command fixed: paths and case inputs are data, never PowerShell source.
// shortcut: Windows checks restore user PATH in finally, use a disposable profile if forced termination is possible.
const driver = `
$ErrorActionPreference = 'Stop'
function Get-RegistryPath($Key) {
    $present = $Key.GetValueNames() -contains 'Path'
    [pscustomobject]@{
        present = $present
        value = $Key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        kind = if ($present) { $Key.GetValueKind('Path').ToString() } else { $null }
    }
}
$savedPath = $env:PATH
$userKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$machineKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')
$savedUserPath = Get-RegistryPath $userKey
$savedMachinePath = Get-RegistryPath $machineKey
$driverFailure = $null
$restoreFailures = [System.Collections.Generic.List[string]]::new()
$paths = [System.Collections.Generic.List[object]]::new()
$downloads = [System.Collections.Generic.List[object]]::new()
$failure = $null
try {
    $nativeArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    $arch = $nativeArch
    if ($env:TEST_ARCH) { $arch = $env:TEST_ARCH }
    $archive = "codepulse-windows-$($arch.ToLowerInvariant()).zip"
    $archivePath = Join-Path $env:TEST_FIXTURE $archive
    $sourceFile = Join-Path $env:TEST_SOURCE 'codepulse.exe'
    if ($env:TEST_CASE -eq 'missing executable') {
        $sourceFile = Join-Path $env:TEST_SOURCE 'other.txt'
    }
    Compress-Archive -LiteralPath $sourceFile -DestinationPath $archivePath -Force
    if ($env:TEST_CASE -eq 'invalid archive') {
        [System.IO.File]::WriteAllText($archivePath, 'not a zip')
    }
    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($env:TEST_CASE -eq 'bad checksum') { $hash = '0' * 64 }
    $checksumName = $archive
    if ($env:TEST_CASE -eq 'missing checksum') { $checksumName = 'unrelated.zip' }
    [System.IO.File]::WriteAllText((Join-Path $env:TEST_FIXTURE 'SHA256SUMS'), "$hash  $checksumName" + [Environment]::NewLine)

    $download = {
        param($Uri, $OutFile)
        $downloads.Add(@{ uri = $Uri; outFile = $OutFile })
        if ($env:TEST_CASE -eq 'download failure' -and $Uri.EndsWith('/SHA256SUMS')) {
            throw 'simulated download failure'
        }
        Copy-Item -LiteralPath (Join-Path $env:TEST_FIXTURE ($Uri.Split('/')[-1])) -Destination $OutFile
    }.GetNewClosure()
    $parameters = @{ Download = $download }
    if ($env:TEST_ARCH) { $parameters.OSArchitecture = $env:TEST_ARCH }
    $installDir = $env:CODEPULSE_INSTALL_DIR
    if (-not $installDir) { $installDir = Join-Path $env:LOCALAPPDATA 'codepulse\\bin' }
    $installDir = [System.IO.Path]::GetFullPath($installDir)
    $env:TEST_PATH_DIR = $installDir
    $scenarios = @($env:TEST_PATH_CASE)
    if ($env:TEST_PATH_CASE -in @('user matches', 'process matches')) {
        $scenarios = @('case', 'trailing slash', 'quoted', 'expanded')
        if ($env:TEST_PATH_CASE -eq 'user matches') { $scenarios += 'literal variable' }
    }
    foreach ($scenario in $scenarios) {
        $userKind = [Microsoft.Win32.RegistryValueKind]::ExpandString
        $userPath = '  "%SystemRoot%\\System32" ; C:\\existing user path\\  ;%SystemRoot%'
        # Retain real tool directories so archive commands work with the controlled PATH.
        $processPath = $savedPath + ';C:\\codepulse process sentinel'
        switch ($scenario) {
            'absent' { $userPath = $null }
            'empty' { $userPath = ''; $userKind = [Microsoft.Win32.RegistryValueKind]::String }
            'long' {
                $userPath = (1..120 | ForEach-Object { 'C:\\existing user path\\segment-' + $_ }) -join ';'
                $userKind = [Microsoft.Win32.RegistryValueKind]::String
            }
            'non-string' {
                $userPath = [string[]]@('%SystemRoot%\\System32', 'C:\\existing multi-string path')
                $userKind = [Microsoft.Win32.RegistryValueKind]::MultiString
            }
        }
        if ($env:TEST_PATH_CASE -in @('user matches', 'process matches')) {
            $match = switch ($scenario) {
                'case' { $installDir.ToUpperInvariant() }
                'trailing slash' { $installDir + '\\' }
                'quoted' { '  "' + $installDir + '"  ' }
                'expanded' { '%TEST_PATH_DIR%' }
                'literal variable' { '%TEST_PATH_DIR%' }
            }
            if ($env:TEST_PATH_CASE -eq 'user matches') {
                $userPath = 'C:\\other user path;' + $match
                if ($scenario -ne 'expanded') { $userKind = [Microsoft.Win32.RegistryValueKind]::String }
            } else {
                $processPath += ';' + $match
            }
        }
        if ($null -eq $userPath) {
            $userKey.DeleteValue('Path', $false)
        } else {
            $userKey.SetValue('Path', $userPath, $userKind)
        }
        $env:PATH = $processPath
        $repeats = if ($scenario -eq 'repeat') { 2 } else { 1 }
        for ($iteration = 0; $iteration -lt $repeats; $iteration++) {
            $userBefore = Get-RegistryPath $userKey
            $processBefore = $env:PATH
            $userMatch = $env:TEST_PATH_CASE -eq 'user matches' -and $scenario -notin @('quoted', 'literal variable')
            $expectedUserPath = if ($userMatch -or $env:TEST_PATH_CASE -eq 'non-string' -or $iteration -gt 0) {
                $userBefore.value
            } elseif ([string]::IsNullOrEmpty($userBefore.value)) {
                $installDir
            } else {
                $userBefore.value + ';' + $installDir
            }
            $processMatch = $env:TEST_PATH_CASE -eq 'process matches' -and $scenario -notin @('quoted', 'expanded')
            $expectedProcessPath = if ($processMatch -or $iteration -gt 0) {
                $processBefore
            } else {
                $processBefore + ';' + $installDir
            }
            $warnings = @()
            try {
                & $env:TEST_INSTALLER @parameters -WarningVariable warnings | Out-Null
            } catch {
                $failure = $_.Exception.Message
                if (-not $failure) { $failure = $_.ToString() }
            }
            $commands = @(Get-Command codepulse -CommandType Application -All -ErrorAction SilentlyContinue)
            $paths.Add(@{
                scenario = $scenario
                iteration = $iteration
                userBefore = $userBefore
                userAfter = Get-RegistryPath $userKey
                processBefore = $processBefore
                processAfter = $env:PATH
                expectedUserPath = $expectedUserPath
                expectedProcessPath = $expectedProcessPath
                commandSources = @($commands | ForEach-Object { $_.Source })
                warnings = @($warnings | ForEach-Object { $_.ToString() })
            })
            if ($failure) { break }
        }
        if ($failure) { break }
    }
    $machinePathAfter = Get-RegistryPath $machineKey
} catch {
    $driverFailure = $_
} finally {
    try {
        if ($savedUserPath.present) {
            $userKey.SetValue('Path', $savedUserPath.value, [Microsoft.Win32.RegistryValueKind]$savedUserPath.kind)
        } else {
            $userKey.DeleteValue('Path', $false)
        }
        $restoredUserPath = Get-RegistryPath $userKey
        if ('Codepulse.EnvironmentNotifier' -as [type]) {
            $broadcastResult = [UIntPtr]::Zero
            [Codepulse.EnvironmentNotifier]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$broadcastResult) | Out-Null
        }
    } catch {
        $restoreFailures.Add('User PATH restoration: ' + $_.Exception.Message)
    }
    try {
        $env:PATH = $savedPath
    } catch {
        $restoreFailures.Add('Process PATH restoration: ' + $_.Exception.Message)
    }
    $userKey.Close()
    $machineKey.Close()
}
if ($driverFailure) {
    if ($restoreFailures.Count) { Write-Warning ($restoreFailures -join '; ') }
    throw $driverFailure
}
$result = @{
    failure = $failure
    downloads = @($downloads.ToArray())
    paths = @($paths.ToArray())
    savedUserPath = $savedUserPath
    restoredUserPath = $restoredUserPath
    restoreFailures = @($restoreFailures.ToArray())
    processRestored = $env:PATH -ceq $savedPath
    machinePathBefore = $savedMachinePath
    machinePathAfter = $machinePathAfter
    nativeArch = $nativeArch
} | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($env:TEST_RESULT, $result)
`;

const cases: {
  name: string;
  arch: string;
  version: string;
  os?: string;
  defaultDir?: boolean;
  failure?: string;
  pathCase?: string;
}[] = [
  { name: "latest x64 default directory", arch: "X64", version: "", defaultDir: true, pathCase: "absent" },
  { name: "versioned ARM64 replacement", arch: "Arm64", version: "1.2.3", os: "Darwin", pathCase: "empty" },
  { name: "prefixed version", arch: "Arm64", version: "v1.2.3", pathCase: "expandable" },
  { name: "explicit latest", arch: "Arm64", version: "latest", pathCase: "long" },
  ...(windows
    ? [
        { name: "native architecture", arch: "", version: "", pathCase: "repeat" },
        { name: "existing user PATH matches", arch: "X64", version: "", pathCase: "user matches" },
        { name: "existing process PATH matches", arch: "X64", version: "", pathCase: "process matches" },
        { name: "non-string user PATH warning", arch: "X64", version: "", pathCase: "non-string" },
      ]
    : []),
  { name: "bad checksum", arch: "X64", version: "", failure: "checksum verification failed" },
  { name: "missing checksum", arch: "Arm64", version: "", failure: "missing or ambiguous checksum" },
  { name: "missing executable", arch: "X64", version: "", failure: "codepulse.exe is missing" },
  { name: "invalid archive", arch: "Arm64", version: "", failure: "any" },
  { name: "download failure", arch: "X64", version: "", failure: "simulated download failure" },
  ...(!windows
    ? [
        { name: "signing failure", arch: "X64", version: "", os: "Darwin", failure: "any" },
        { name: "musl", arch: "X64", version: "", failure: "any" },
      ]
    : []),
];

const root = await mkdtemp(join(tmpdir(), "codepulse installer checks ' $ "));
const bin = join(root, "bin");
const fixture = join(root, "release");
const source = join(root, "source");
const calls = join(root, "calls");
const dispatcher = join(root, "fake-command.cjs");
const executable = windows ? "codepulse.exe" : "codepulse";

try {
  for (const dir of [bin, fixture, source]) await mkdir(dir);
  await writeFile(join(source, executable), "new binary");
  await writeFile(join(source, "other.txt"), "not an executable");
  if (!windows) {
    await writeFile(
      dispatcher,
      `
const fs = require("node:fs");
const command = process.argv[2];
const args = process.argv.slice(3);
const env = process.env;
if (command === "uname") console.log(args[0] === "-s" ? env.TEST_OS : env.TEST_ARCH);
else if (command === "getconf") process.exit(env.TEST_CASE === "musl" ? 1 : 0);
else if (command === "curl") {
  const url = args[1];
  fs.appendFileSync(env.TEST_CALLS, url + "\\n");
  if (env.TEST_CASE === "download failure" && url.endsWith("SHA256SUMS")) process.exit(22);
  fs.copyFileSync(require("node:path").join(env.TEST_FIXTURE, url.split("/").pop()), args[3]);
} else if (command === "codesign") {
  fs.appendFileSync(env.TEST_CALLS, "codesign\\n");
  process.exit(env.TEST_CASE === "signing failure" ? 1 : 0);
} else if (command === "mktemp") {
  const result = Bun.spawnSync([env.TEST_MKTEMP, ...args], { stdout: "pipe", stderr: "inherit" });
  process.stdout.write(result.stdout);
  process.exit(result.exitCode);
}
`,
    );
    for (const command of ["uname", "getconf", "curl", "codesign", "mktemp"]) {
      const path = join(bin, command);
      await writeFile(path, `#!/bin/sh\nexec "$TEST_BUN" "$TEST_DISPATCHER" ${command} "$@"\n`);
      await chmod(path, 0o755);
    }
  }

  for (const [index, entry] of cases.entries()) {
    const home = join(root, `home ${index}`);
    const installDir = entry.defaultDir
      ? join(home, ...(windows ? ["codepulse", "bin"] : [".local", "bin"]))
      : join(root, `install ${index}`);
    const temp = join(root, `downloads ${index}`);
    const resultFile = join(root, `result ${index}.json`);
    await mkdir(temp);
    if (!entry.defaultDir) {
      await mkdir(installDir);
      await writeFile(join(installDir, executable), "good installed binary");
    }
    const env = {
      ...process.env,
      CODEPULSE_INSTALL_DIR: entry.defaultDir ? "" : installDir,
      CODEPULSE_VERSION: entry.version,
      TEST_CASE: entry.name,
      TEST_FIXTURE: fixture,
      TEST_SOURCE: source,
    };
    const os = entry.os ?? "Linux";
    let arch = entry.arch.toLowerCase();
    const platform = windows ? "windows" : os === "Darwin" ? "darwin" : "linux";
    let urls: string[];
    if (windows) {
      assert(powershell, "PowerShell required");
      const result = Bun.spawnSync([powershell, "-NoProfile", "-NonInteractive", "-Command", driver], {
        env: {
          ...env,
          TEMP: temp,
          TMP: temp,
          LOCALAPPDATA: home,
          TEST_INSTALLER: resolve(import.meta.dir, "..", "install.ps1"),
          TEST_RESULT: resultFile,
          TEST_ARCH: entry.arch,
          TEST_PATH_CASE: entry.pathCase ?? "expandable",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      assert.equal(result.exitCode, 0, `${entry.name}: ${result.stdout.toString()}\n${result.stderr.toString()}`);
      type RegistryPath = { present: boolean; value: unknown; kind: string | null };
      const report: {
        failure: string | null;
        downloads: { uri: string; outFile: string }[];
        paths: {
          scenario: string;
          iteration: number;
          userBefore: RegistryPath;
          userAfter: RegistryPath;
          processBefore: string;
          processAfter: string;
          expectedUserPath: string | string[];
          expectedProcessPath: string;
          commandSources: string[];
          warnings: string[];
        }[];
        savedUserPath: RegistryPath;
        restoredUserPath: RegistryPath;
        restoreFailures: string[];
        processRestored: boolean;
        machinePathBefore: RegistryPath;
        machinePathAfter: RegistryPath;
        nativeArch: string;
      } = JSON.parse(await readFile(resultFile, "utf8"));
      assert.deepEqual(report.restoreFailures, [], `${entry.name}: PATH restoration`);
      assert.deepEqual(
        report.restoredUserPath,
        report.savedUserPath,
        `${entry.name}: raw user PATH restored, including absence and kind`,
      );
      assert.equal(report.processRestored, true, `${entry.name}: process PATH restored`);
      assert.deepEqual(report.machinePathAfter, report.machinePathBefore, `${entry.name}: machine PATH unchanged`);
      if (entry.failure) {
        assert.notEqual(report.failure, null, `${entry.name} must fail`);
        if (entry.failure !== "any")
          assert(report.failure?.includes(entry.failure), `${entry.name}: ${report.failure}`);
      } else {
        assert.equal(report.failure, null, `${entry.name}: ${report.failure}`);
      }
      arch = arch || report.nativeArch.toLowerCase();
      const runCount =
        entry.pathCase === "user matches"
          ? 5
          : entry.pathCase === "process matches"
            ? 4
            : entry.pathCase === "repeat"
              ? 2
              : 1;
      assert.equal(report.paths.length, runCount, `${entry.name}: installation count`);
      assert.equal(report.downloads.length, runCount * 2, `${entry.name}: download count`);
      urls = report.downloads.slice(0, 2).map(request => request.uri);
      for (let index = 1; index < runCount; index++) {
        assert.deepEqual(
          report.downloads.slice(index * 2, index * 2 + 2).map(request => request.uri),
          urls,
          `${entry.name}: repeated installation URLs`,
        );
      }
      for (const request of report.downloads) {
        await assert.rejects(
          readdir(dirname(request.outFile)),
          { code: "ENOENT" },
          `${entry.name}: temporary directory cleanup`,
        );
      }
      for (const path of report.paths) {
        const label = `${entry.name}: ${path.scenario} run ${path.iteration + 1}`;
        if (entry.failure) {
          assert.deepEqual(path.userAfter, path.userBefore, `${label}: user PATH unchanged on failure`);
          assert.equal(path.processAfter, path.processBefore, `${label}: process PATH unchanged on failure`);
          continue;
        }
        assert.equal(path.userAfter.present, true, `${label}: user PATH present`);
        assert.deepEqual(path.userAfter.value, path.expectedUserPath, `${label}: raw user PATH preserved`);
        if (path.userBefore.present) {
          assert.equal(path.userAfter.kind, path.userBefore.kind, `${label}: user PATH kind preserved`);
        } else {
          assert(["String", "ExpandString"].includes(path.userAfter.kind ?? ""), `${label}: user PATH string kind`);
        }
        assert.equal(path.processAfter, path.expectedProcessPath, `${label}: independent process PATH update`);
        if (path.scenario === "absent") assert.equal(path.userBefore.present, false, `${label}: absent user PATH seed`);
        if (path.scenario === "empty") assert.equal(path.userBefore.value, "", `${label}: empty user PATH seed`);
        if (path.scenario === "long") {
          assert(
            typeof path.userBefore.value === "string" && path.userBefore.value.length > 1024,
            `${label}: long user PATH seed`,
          );
        }
        if (entry.pathCase === "non-string") {
          assert.deepEqual(path.userAfter, path.userBefore, `${label}: non-string user PATH untouched`);
          assert(
            path.warnings.some(
              warning => warning.includes("user PATH is not a string") && warning.includes("manually"),
            ),
            `${label}: manual PATH warning`,
          );
        } else {
          assert.deepEqual(path.warnings, [], `${label}: automatic PATH setup succeeds without warnings`);
        }
        assert(
          path.commandSources.some(
            source => resolve(source).toLowerCase() === resolve(installDir, executable).toLowerCase(),
          ),
          `${label}: Get-Command codepulse finds the installed fixture without executing it`,
        );
      }
    } else {
      assert(realMktemp, "mktemp required");
      await writeFile(calls, "");
      const archive = `codepulse-${platform}-${arch}.tar.gz`;
      const archivePath = join(fixture, archive);
      const tar = Bun.spawnSync([
        "tar",
        "-C",
        source,
        "-czf",
        archivePath,
        entry.name === "missing executable" ? "other.txt" : executable,
      ]);
      assert.equal(tar.exitCode, 0);
      if (entry.name === "invalid archive") await writeFile(archivePath, "invalid tar");
      const checksum =
        entry.name === "bad checksum"
          ? "0".repeat(64)
          : new Bun.CryptoHasher("sha256").update(await readFile(archivePath)).digest("hex");
      await writeFile(
        join(fixture, "SHA256SUMS"),
        `${checksum}  ${entry.name === "missing checksum" ? "unrelated" : archive}\n`,
      );
      const result = Bun.spawnSync(["sh", resolve(import.meta.dir, "..", "install.sh")], {
        env: {
          ...env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          TMPDIR: temp,
          HOME: home,
          TEST_OS: os,
          TEST_ARCH: arch === "x64" ? "x86_64" : os === "Darwin" ? "arm64" : "aarch64",
          TEST_BUN: process.execPath,
          TEST_DISPATCHER: dispatcher,
          TEST_CALLS: calls,
          TEST_MKTEMP: realMktemp,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      assert.equal(result.exitCode === 0, !entry.failure, `${entry.name}: ${result.stderr.toString()}`);
      const log = (await readFile(calls, "utf8")).split("\n").filter(Boolean);
      urls = log.filter(line => line !== "codesign");
      if (!entry.failure) assert.equal(log.includes("codesign"), os === "Darwin", `${entry.name}: signing`);
    }
    assert.equal(
      await readFile(join(installDir, executable), "utf8"),
      entry.failure ? "good installed binary" : "new binary",
      entry.name,
    );
    assert.deepEqual(await readdir(installDir), [executable], `${entry.name}: staging cleanup`);
    assert.deepEqual(await readdir(temp), [], `${entry.name}: temporary download cleanup`);
    const releasePath = !entry.version || entry.version === "latest" ? "latest/download" : "download/v1.2.3";
    const releaseUrl = `https://github.com/andreduejon/codepulse/releases/${releasePath}`;
    const archive = `codepulse-${platform}-${arch}.${windows ? "zip" : "tar.gz"}`;
    assert.deepEqual(
      urls,
      entry.name === "musl" ? [] : [`${releaseUrl}/${archive}`, `${releaseUrl}/SHA256SUMS`],
      `${entry.name}: architecture/version URLs`,
    );
    console.log(`PASS: ${entry.name}`);
  }
  console.log(`All ${windows ? "Windows" : "Unix"} installer checks passed.`);
} finally {
  await rm(root, { recursive: true, force: true });
}

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
const driver = `
$ErrorActionPreference = 'Stop'
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

$downloads = [System.Collections.Generic.List[object]]::new()
$download = {
    param($Uri, $OutFile)
    $downloads.Add(@{ uri = $Uri; outFile = $OutFile })
    if ($env:TEST_CASE -eq 'download failure' -and $Uri.EndsWith('/SHA256SUMS')) {
        throw 'simulated download failure'
    }
    Copy-Item -LiteralPath (Join-Path $env:TEST_FIXTURE ($Uri.Split('/')[-1])) -Destination $OutFile
}.GetNewClosure()
$savedPath = $env:PATH
$failure = $null
$parameters = @{ Download = $download }
if ($env:TEST_ARCH) { $parameters.OSArchitecture = $env:TEST_ARCH }
try {
    & $env:TEST_INSTALLER @parameters | Out-Null
} catch {
    $failure = $_.Exception.Message
}
$result = @{
    failure = $failure
    downloads = @($downloads.ToArray())
    pathUnchanged = $env:PATH -ceq $savedPath
    nativeArch = $nativeArch
} | ConvertTo-Json -Depth 4 -Compress
[System.IO.File]::WriteAllText($env:TEST_RESULT, $result)
`;

const cases: { name: string; arch: string; version: string; os?: string; defaultDir?: boolean; failure?: string }[] = [
  { name: "latest x64 default directory", arch: "X64", version: "", defaultDir: true },
  { name: "versioned ARM64 replacement", arch: "Arm64", version: "1.2.3", os: "Darwin" },
  { name: "prefixed version", arch: "Arm64", version: "v1.2.3" },
  { name: "explicit latest", arch: "Arm64", version: "latest" },
  ...(windows ? [{ name: "native architecture", arch: "", version: "" }] : []),
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
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      assert.equal(result.exitCode, 0, `${entry.name}: ${result.stdout.toString()}\n${result.stderr.toString()}`);
      const report: {
        failure: string | null;
        downloads: { uri: string; outFile: string }[];
        pathUnchanged: boolean;
        nativeArch: string;
      } = JSON.parse(await readFile(resultFile, "utf8"));
      if (entry.failure) {
        assert(report.failure, `${entry.name} must fail`);
        if (entry.failure !== "any") assert(report.failure.includes(entry.failure), `${entry.name}: ${report.failure}`);
      } else {
        assert.equal(report.failure, null, `${entry.name}: ${report.failure}`);
      }
      arch = arch || report.nativeArch.toLowerCase();
      urls = report.downloads.map(request => request.uri);
      for (const request of report.downloads) {
        await assert.rejects(
          readdir(dirname(request.outFile)),
          { code: "ENOENT" },
          `${entry.name}: temporary directory cleanup`,
        );
      }
      assert.equal(report.pathUnchanged, true, `${entry.name}: PATH unchanged`);
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

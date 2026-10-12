# Download may be injected for offline checks; OSArchitecture defaults to the
# native OS architecture, even when PowerShell runs under emulation.
[CmdletBinding()]
param(
    [scriptblock] $Download = {
        param($Uri, $OutFile)
        Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
    },
    [string] $OSArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
)

$ErrorActionPreference = 'Stop'

if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
    [System.Runtime.InteropServices.OSPlatform]::Windows
)) {
    throw 'codepulse: this installer requires Windows'
}

$arch = switch ($OSArchitecture) {
    'X64' { 'x64' }
    'Arm64' { 'arm64' }
    default { throw "codepulse: unsupported architecture: $OSArchitecture" }
}

$version = $env:CODEPULSE_VERSION
if (-not $version) { $version = 'latest' }
$installDir = $env:CODEPULSE_INSTALL_DIR
if (-not $installDir) {
    if (-not $env:LOCALAPPDATA) { throw 'codepulse: LOCALAPPDATA is not set' }
    $installDir = Join-Path $env:LOCALAPPDATA 'codepulse\bin'
}
$installDir = [System.IO.Path]::GetFullPath($installDir)

function Test-InstallDirectoryInPath {
    param([string] $PathValue)
    foreach ($entry in ($PathValue -split ';')) {
        # Quoted PATH entries are not searchable by PowerShell.
        $entry = $entry.Trim().Replace('/', '\').TrimEnd('\')
        if ($entry -ieq $installDir.Replace('/', '\').TrimEnd('\')) { return $true }
    }
    return $false
}

$releaseUrl = 'https://github.com/andreduejon/codepulse/releases'
if ($version -ceq 'latest') {
    $releaseUrl += '/latest/download'
} else {
    if (-not $version.StartsWith('v')) { $version = "v$version" }
    $releaseUrl += "/download/$version"
}

$archive = "codepulse-windows-$arch.zip"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("codepulse-" + [guid]::NewGuid())
$stagedFile = $null
try {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    $archivePath = Join-Path $tempDir $archive
    $sumsPath = Join-Path $tempDir 'SHA256SUMS'
    & $Download "$releaseUrl/$archive" $archivePath | Out-Null
    & $Download "$releaseUrl/SHA256SUMS" $sumsPath | Out-Null

    $checksums = @(foreach ($line in Get-Content -LiteralPath $sumsPath) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$' -and $Matches[2] -ceq $archive) {
            $Matches[1]
        }
    })
    if ($checksums.Count -ne 1) {
        throw "codepulse: missing or ambiguous checksum for $archive in SHA256SUMS"
    }
    $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actual -ine $checksums[0]) {
        throw "codepulse: checksum verification failed for $archive"
    }

    $extractedDir = Join-Path $tempDir 'extracted'
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractedDir
    $executable = Join-Path $extractedDir 'codepulse.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "codepulse: codepulse.exe is missing from $archive"
    }

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    $destination = Join-Path $installDir 'codepulse.exe'
    # Stage on the destination volume so replacement cannot leave a partial binary.
    $stagedFile = Join-Path $installDir (".codepulse-" + [guid]::NewGuid() + '.exe')
    Copy-Item -LiteralPath $executable -Destination $stagedFile
    if (Test-Path -LiteralPath $destination) {
        [System.IO.File]::Replace($stagedFile, $destination, [System.Management.Automation.Language.NullString]::Value)
    } else {
        [System.IO.File]::Move($stagedFile, $destination)
    }

    Write-Host "Installed codepulse to $destination"
    $userEnvironment = $null
    try {
        $userEnvironment = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
        # Keep expandable entries and their registry type, not the merged process PATH.
        $userPath = $userEnvironment.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -ne $userPath -and $userPath -isnot [string]) { throw 'user PATH is not a string' }
        $pathKind = if ($null -eq $userPath) { [Microsoft.Win32.RegistryValueKind]::ExpandString } else { $userEnvironment.GetValueKind('Path') }
        $matchingPath = if ($userPath -and $pathKind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) { [Environment]::ExpandEnvironmentVariables($userPath) } else { $userPath }
        if (-not (Test-InstallDirectoryInPath $matchingPath)) {
            $newPath = if ($userPath) { "$userPath;$installDir" } else { $installDir }
            $userEnvironment.SetValue('Path', $newPath, $pathKind)
            Write-Host "Added $installDir to your user PATH"

            # Notify Explorer so newly launched terminals inherit the updated PATH.
            if (-not ('Codepulse.EnvironmentNotifier' -as [type])) {
                Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace Codepulse {
    public static class EnvironmentNotifier {
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr SendMessageTimeout(IntPtr window, uint message,
            UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
    }
}
'@
            }
            $result = [UIntPtr]::Zero
            [Codepulse.EnvironmentNotifier]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result) | Out-Null
        }
    } catch {
        Write-Warning "codepulse is installed, but automatic user PATH setup failed: $($_.Exception.Message). Add $installDir to your user PATH manually for future terminals."
    } finally {
        if ($userEnvironment) { $userEnvironment.Dispose() }
    }
    if (-not (Test-InstallDirectoryInPath $env:PATH)) {
        $env:PATH = if ($env:PATH) { "$env:PATH;$installDir" } else { $installDir }
    }
    Write-Host 'Run codepulse now. Other open terminals may need to be restarted.'
} finally {
    if ($stagedFile -and (Test-Path -LiteralPath $stagedFile)) {
        Remove-Item -LiteralPath $stagedFile -Force
    }
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}

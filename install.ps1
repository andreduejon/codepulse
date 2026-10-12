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
        [System.IO.File]::Replace($stagedFile, $destination, $null)
    } else {
        [System.IO.File]::Move($stagedFile, $destination)
    }

    Write-Host "Installed codepulse to $destination"
    if ($installDir -notin ($env:PATH -split ';')) {
        Write-Host "Add $installDir to your user PATH via Settings > System > About > Advanced system settings > Environment Variables."
        Write-Host 'Open a new terminal afterward to run codepulse.'
    }
} finally {
    if ($stagedFile -and (Test-Path -LiteralPath $stagedFile)) {
        Remove-Item -LiteralPath $stagedFile -Force
    }
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force
    }
}

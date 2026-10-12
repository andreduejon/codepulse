# Run on Windows: pwsh -NoProfile -File scripts/test-install-windows.ps1
# Also supports Windows PowerShell 5.1; no network or executable launch required.
$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path $PSScriptRoot -Parent) 'install.ps1'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("codepulse-test-" + [guid]::NewGuid())
$savedVersion = $env:CODEPULSE_VERSION
$savedInstallDir = $env:CODEPULSE_INSTALL_DIR
$savedLocalAppData = $env:LOCALAPPDATA
$savedPath = $env:PATH

function Assert($Condition, $Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
}

try {
    New-Item -ItemType Directory -Path $root | Out-Null
    $env:LOCALAPPDATA = Join-Path $root 'Local App Data'
    $fixture = Join-Path $root 'release'
    $source = Join-Path $root 'source'
    New-Item -ItemType Directory -Path $fixture, $source | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $source 'codepulse.exe'), 'new binary')
    foreach ($arch in @('x64', 'arm64')) {
        Compress-Archive -LiteralPath (Join-Path $source 'codepulse.exe') -DestinationPath (Join-Path $fixture "codepulse-windows-$arch.zip")
    }

    $cases = @(
        @{ Name = 'latest x64 default directory'; Arch = 'X64'; Version = ''; DefaultDir = $true },
        @{ Name = 'versioned ARM64 replacement'; Arch = 'Arm64'; Version = '1.2.3' },
        @{ Name = 'prefixed version'; Arch = 'X64'; Version = 'v1.2.3' },
        @{ Name = 'bad checksum'; Arch = 'X64'; Failure = 'checksum verification failed' },
        @{ Name = 'missing checksum'; Arch = 'Arm64'; Failure = 'missing or ambiguous checksum' },
        @{ Name = 'missing executable'; Arch = 'X64'; Failure = 'codepulse.exe is missing' },
        @{ Name = 'invalid archive'; Arch = 'Arm64'; Failure = 'any' },
        @{ Name = 'download failure'; Arch = 'X64'; Failure = 'simulated download failure' }
    )

    foreach ($case in $cases) {
        $env:CODEPULSE_VERSION = $case.Version
        $installDir = Join-Path $root ("install " + $case.Name)
        if ($case.DefaultDir) {
            $env:CODEPULSE_INSTALL_DIR = ''
            $installDir = Join-Path $env:LOCALAPPDATA 'codepulse\bin'
        } else {
            $env:CODEPULSE_INSTALL_DIR = $installDir
            New-Item -ItemType Directory -Path $installDir | Out-Null
            [System.IO.File]::WriteAllText((Join-Path $installDir 'codepulse.exe'), 'good installed binary')
        }

        $archive = "codepulse-windows-$($case.Arch.ToLowerInvariant()).zip"
        $archivePath = Join-Path $fixture $archive
        if ($case.Name -eq 'missing executable') {
            [System.IO.File]::WriteAllText((Join-Path $source 'other.txt'), 'not an executable')
            Compress-Archive -LiteralPath (Join-Path $source 'other.txt') -DestinationPath $archivePath -Force
        } elseif ($case.Name -eq 'invalid archive') {
            [System.IO.File]::WriteAllText($archivePath, 'not a zip')
        }
        $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($case.Name -eq 'bad checksum') { $hash = '0' * 64 }
        $checksumName = $archive
        if ($case.Name -eq 'missing checksum') { $checksumName = 'unrelated.zip' }
        [System.IO.File]::WriteAllText((Join-Path $fixture 'SHA256SUMS'), "$hash  $checksumName`n")

        $downloads = [System.Collections.Generic.List[object]]::new()
        $download = {
            param($Uri, $OutFile)
            $downloads.Add(@{ Uri = $Uri; OutFile = $OutFile })
            if ($case.Name -eq 'download failure' -and $Uri.EndsWith('/SHA256SUMS')) {
                throw 'simulated download failure'
            }
            Copy-Item -LiteralPath (Join-Path $fixture ($Uri.Split('/')[-1])) -Destination $OutFile
        }.GetNewClosure()

        $failure = $null
        try {
            & $installer -Download $download -OSArchitecture $case.Arch
        } catch {
            $failure = $_
        }
        if ($case.Failure) {
            Assert ($null -ne $failure) "$($case.Name) must fail"
            if ($case.Failure -ne 'any') {
                Assert ($failure.Exception.Message.Contains($case.Failure)) "$($case.Name): unexpected error: $failure"
            }
            Assert ([System.IO.File]::ReadAllText((Join-Path $installDir 'codepulse.exe')) -ceq 'good installed binary') "$($case.Name) must preserve the existing executable"
        } else {
            Assert ($null -eq $failure) "$($case.Name): $failure"
            Assert ([System.IO.File]::ReadAllText((Join-Path $installDir 'codepulse.exe')) -ceq 'new binary') "$($case.Name) must install the executable"
        }

        $releaseUrl = 'https://github.com/andreduejon/codepulse/releases/latest/download'
        if ($case.Version) { $releaseUrl = 'https://github.com/andreduejon/codepulse/releases/download/v1.2.3' }
        Assert ($downloads.Count -eq 2) "$($case.Name) must request archive and checksums"
        Assert ($downloads[0].Uri -ceq "$releaseUrl/$archive") "$($case.Name) architecture/version URL"
        Assert ($downloads[1].Uri -ceq "$releaseUrl/SHA256SUMS") "$($case.Name) checksum URL"
        foreach ($request in $downloads) {
            Assert (-not (Test-Path -LiteralPath (Split-Path $request.OutFile -Parent))) "$($case.Name) must clean temporary downloads"
        }
        Assert (@(Get-ChildItem -LiteralPath $installDir -Force).Count -eq 1) "$($case.Name) must leave no staging files"
        Assert ($env:PATH -ceq $savedPath) "$($case.Name) must not change PATH"
        Write-Host "PASS: $($case.Name)"
    }

    Write-Host 'All Windows installer checks passed.'
} finally {
    $env:CODEPULSE_VERSION = $savedVersion
    $env:CODEPULSE_INSTALL_DIR = $savedInstallDir
    $env:LOCALAPPDATA = $savedLocalAppData
    $env:PATH = $savedPath
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}

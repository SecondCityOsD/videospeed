# Build Video Speed Controller UXP extension (Windows / PowerShell)
# Run from anywhere — paths are resolved relative to this script.
#
# Uses .NET ZipArchive directly so archive entry names use forward slashes,
# which the XPI/ZIP spec requires. PowerShell's Compress-Archive produces
# backslash-separated entries on Windows, which makes Pale Moon's chrome
# registry fail to resolve chrome://videospeed/content/* URLs.

$ErrorActionPreference = 'Stop'

$sourceDir = $PSScriptRoot
if (-not $sourceDir) { $sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

$installRdf = Join-Path $sourceDir 'install.rdf'
if (-not (Test-Path $installRdf)) {
    throw "install.rdf not found next to build-xpi.ps1: $installRdf"
}

$version = (Select-String -Path $installRdf -Pattern 'em:version').Line -replace '.*>([^<]+)<.*','$1'
if (-not $version) {
    throw "Could not parse em:version from $installRdf"
}

$xpiName = "videospeed-uxp-$version.xpi"
$xpiPath = Join-Path $sourceDir $xpiName

Write-Host "Building $xpiName from $sourceDir..."

if (Test-Path $xpiPath) { Remove-Item $xpiPath -Force }

$files = @(
    'install.rdf',
    'chrome.manifest',
    'LICENSE',
    'chrome\content\overlay.xul',
    'chrome\content\overlay.js',
    'chrome\content\popup\popup.xul',
    'chrome\content\popup\popup.js',
    'chrome\content\popup\popup.css',
    'chrome\content\options\options.xul',
    'chrome\content\options\options.js',
    'chrome\content\options\options.css',
    'chrome\modules\VSCPrefs.jsm',
    'defaults\preferences\prefs.js'
)

$scriptFiles = @(
    'src\utils\constants.js',
    'src\utils\key-maps.js',
    'src\utils\logger.js',
    'src\utils\dom-utils.js',
    'src\utils\event-manager.js',
    'src\utils\debug-helper.js',
    'src\core\state-manager.js',
    'src\core\storage-manager.js',
    'src\core\settings.js',
    'src\core\action-handler.js',
    'src\core\video-controller.js',
    'src\observers\media-observer.js',
    'src\observers\mutation-observer.js',
    'src\site-handlers\base-handler.js',
    'src\site-handlers\index.js',
    'src\site-handlers\youtube-handler.js',
    'src\site-handlers\netflix-handler.js',
    'src\site-handlers\facebook-handler.js',
    'src\site-handlers\amazon-handler.js',
    'src\site-handlers\apple-handler.js',
    'src\site-handlers\dailymotion-handler.js',
    'src\ui\shadow-dom.js',
    'src\ui\controls.js',
    'src\ui\drag-handler.js',
    'src\content\inject.js',
    'src\styles\controller-css-defaults.js',
    'src\styles\inject.css'
)

$allFiles = $files + $scriptFiles

$iconDir = 'src\assets\icons'
if (Test-Path (Join-Path $sourceDir $iconDir)) {
    Get-ChildItem -Path (Join-Path $sourceDir $iconDir) -File | ForEach-Object {
        $allFiles += "$iconDir\$($_.Name)"
    }
}

$skinDir = 'chrome\skin\classic'
if (Test-Path (Join-Path $sourceDir $skinDir)) {
    Get-ChildItem -Path (Join-Path $sourceDir $skinDir) -File | ForEach-Object {
        $allFiles += "$skinDir\$($_.Name)"
    }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipStream = [System.IO.File]::Open($xpiPath, [System.IO.FileMode]::CreateNew)
try {
    $archive = [System.IO.Compression.ZipArchive]::new(
        $zipStream,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        $copied = 0
        $skipped = @()
        foreach ($file in $allFiles) {
            $fullPath = Join-Path $sourceDir $file
            if (Test-Path $fullPath) {
                # XPI/ZIP spec requires forward slashes.
                $entryName = $file -replace '\\','/'
                $entry = $archive.CreateEntry(
                    $entryName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                )
                $entryStream = $entry.Open()
                try {
                    $sourceStream = [System.IO.File]::OpenRead($fullPath)
                    try {
                        $sourceStream.CopyTo($entryStream)
                    } finally {
                        $sourceStream.Dispose()
                    }
                } finally {
                    $entryStream.Dispose()
                }
                $copied++
            } else {
                $skipped += $file
            }
        }

        if ($skipped.Count -gt 0) {
            Write-Warning ("Skipped {0} missing file(s):`n  {1}" -f $skipped.Count, ($skipped -join "`n  "))
        }

        if ($copied -eq 0) {
            throw "No source files were found under $sourceDir. Build aborted."
        }
    } finally {
        $archive.Dispose()
    }
} finally {
    $zipStream.Dispose()
}

$size = [math]::Round((Get-Item $xpiPath).Length / 1KB, 1)
Write-Host "XPI built: $xpiPath ($size KB, $copied files)"

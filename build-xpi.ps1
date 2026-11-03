# Build Video Speed Controller UXP extension (Windows / PowerShell)
# Run from anywhere — paths are resolved relative to this script.
#
#   .\build-xpi.ps1                  # writes videospeed-uxp-<version>.xpi here
#   .\build-xpi.ps1 -OutDir <dir>    # writes it into <dir> instead
#
# Packages install.rdf, chrome.manifest, LICENSE and the whole chrome/,
# defaults/ and src/ trees (minus OS/editor droppings). Before writing
# anything it checks that the page-script list in chrome/content/overlay.js
# (_contentScripts) matches the .js files under src/ exactly, so a module
# can never be loaded-but-not-shipped (a silent 404 at injection time) or
# shipped-but-never-loaded. build.sh applies the same rules.
#
# Uses .NET ZipArchive directly so archive entry names use forward slashes,
# which the XPI/ZIP spec requires. PowerShell's Compress-Archive produces
# backslash-separated entries on Windows, which makes Pale Moon's chrome
# registry fail to resolve chrome://videospeed/content/* URLs.

param(
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$sourceDir = $PSScriptRoot
if (-not $sourceDir) { $sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$sourceDir = [System.IO.Path]::GetFullPath($sourceDir)
if (-not $OutDir) { $OutDir = $sourceDir }

$installRdf = Join-Path $sourceDir 'install.rdf'
if (-not (Test-Path -LiteralPath $installRdf)) {
    throw "install.rdf not found next to build-xpi.ps1: $installRdf"
}

$version = (Select-String -Path $installRdf -Pattern 'em:version').Line -replace '.*>([^<]+)<.*','$1'
if (-not $version) {
    throw "Could not parse em:version from $installRdf"
}

$xpiName = "videospeed-uxp-$version.xpi"
$xpiPath = Join-Path ([System.IO.Path]::GetFullPath($OutDir)) $xpiName

$rootFiles = @('install.rdf', 'chrome.manifest', 'LICENSE')
$treeDirs = @('chrome', 'defaults', 'src')
# Dotfiles and OS/editor droppings never belong in a release.
$junkPattern = '^\.|^(Thumbs\.db|desktop\.ini)$|~$|\.(swp|orig|rej|bak)$'

Write-Host "Building $xpiName from $sourceDir..."

# --- Collect package entries (forward-slash relative paths) -----------------
$entries = New-Object 'System.Collections.Generic.List[string]'
foreach ($file in $rootFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceDir $file) -PathType Leaf)) {
        throw "Missing required file: $file"
    }
    $entries.Add($file)
}
foreach ($dir in $treeDirs) {
    $dirPath = Join-Path $sourceDir $dir
    if (-not (Test-Path -LiteralPath $dirPath -PathType Container)) {
        throw "Missing required directory: $dir"
    }
    Get-ChildItem -LiteralPath $dirPath -Recurse -File |
        Where-Object { $_.Name -notmatch $junkPattern } |
        ForEach-Object {
            $entries.Add(($_.FullName.Substring($sourceDir.Length).TrimStart('\', '/') -replace '\\', '/'))
        }
}
# Ordinal sort: deterministic entry order regardless of filesystem order.
$entries.Sort([System.StringComparer]::Ordinal)

# --- Verify overlay.js's page-script list against src/ ----------------------
# Case-sensitive comparisons throughout: resource:// URLs inside the XPI are
# case-sensitive even though the Windows filesystem is not.
$overlay = [System.IO.File]::ReadAllText((Join-Path $sourceDir 'chrome\content\overlay.js'))
$listBlock = [regex]::Match($overlay, '_contentScripts:\s*\[(.*?)\r?\n\s*\],', 'Singleline')
if (-not $listBlock.Success) {
    throw 'Could not locate the _contentScripts list in chrome/content/overlay.js'
}
$listed = @([regex]::Matches($listBlock.Groups[1].Value, '"([^"]+\.js)"') |
    ForEach-Object { 'src/' + $_.Groups[1].Value })
$shipped = @($entries | Where-Object { $_.StartsWith('src/') -and $_.EndsWith('.js') })

$problems = @()
$problems += @($listed | Group-Object -CaseSensitive | Where-Object { $_.Count -gt 1 } |
    ForEach-Object { "listed twice in overlay.js: $($_.Name)" })
$problems += @($listed | Where-Object { $shipped -cnotcontains $_ } |
    ForEach-Object { "listed in overlay.js but missing from src/: $_" })
$problems += @($shipped | Where-Object { $listed -cnotcontains $_ } |
    ForEach-Object { "present in src/ but not loaded by overlay.js: $_" })
if ($problems.Count -gt 0) {
    throw ("Page-script list does not match src/ ({0} problem(s)):`n  {1}" -f $problems.Count, ($problems -join "`n  "))
}

# --- Write the XPI ----------------------------------------------------------
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path -LiteralPath $xpiPath) { Remove-Item -LiteralPath $xpiPath -Force }

$zipStream = [System.IO.File]::Open($xpiPath, [System.IO.FileMode]::CreateNew)
try {
    $archive = [System.IO.Compression.ZipArchive]::new(
        $zipStream,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        foreach ($entryName in $entries) {
            $entry = $archive.CreateEntry(
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            $entryStream = $entry.Open()
            try {
                $sourceStream = [System.IO.File]::OpenRead((Join-Path $sourceDir ($entryName -replace '/', '\')))
                try {
                    $sourceStream.CopyTo($entryStream)
                } finally {
                    $sourceStream.Dispose()
                }
            } finally {
                $entryStream.Dispose()
            }
        }
    } finally {
        $archive.Dispose()
    }
} finally {
    $zipStream.Dispose()
}

$size = [math]::Round((Get-Item -LiteralPath $xpiPath).Length / 1KB, 1)
Write-Host ("XPI built: {0} ({1} KB, {2} files; {3} page scripts match overlay.js)" -f $xpiPath, $size, $entries.Count, $listed.Count)

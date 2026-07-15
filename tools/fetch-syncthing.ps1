$ErrorActionPreference = 'Stop'

$version = '2.1.2'
$assetName = "syncthing-windows-amd64-v$version.zip"
$expectedSha256 = '4626c13012e9620ece2393bfc3300aeafead654695d5dc096a873c27a7543c96'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $projectRoot 'client\vendor\syncthing'
$binaryPath = Join-Path $targetDir 'syncthing.exe'

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

if (Test-Path -LiteralPath $binaryPath) {
  $versionOutput = & $binaryPath --version
  if ($versionOutput -match "syncthing v$([regex]::Escape($version))") {
    Write-Host "Syncthing v$version is ready."
    exit 0
  }
  throw "The existing Syncthing version does not match: $versionOutput"
}

$downloadUrl = "https://github.com/syncthing/syncthing/releases/download/v$version/$assetName"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "meshuttle-syncthing-$([guid]::NewGuid().ToString('N'))"
$archivePath = Join-Path $temporaryRoot $assetName
$extractPath = Join-Path $temporaryRoot 'extract'
New-Item -ItemType Directory -Path $temporaryRoot, $extractPath -Force | Out-Null

try {
  Write-Host "Downloading Syncthing v$version from the official GitHub Release..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
  $actualSha256 = Get-Sha256Hex -Path $archivePath
  if ($actualSha256 -ne $expectedSha256) {
    throw "Syncthing checksum mismatch. Expected $expectedSha256, got $actualSha256"
  }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $sourceDir = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
  if (-not $sourceDir) { throw 'Invalid Syncthing archive structure' }
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  foreach ($name in @('syncthing.exe', 'LICENSE.txt', 'AUTHORS.txt', 'README.txt')) {
    Copy-Item -LiteralPath (Join-Path $sourceDir.FullName $name) -Destination $targetDir -Force
  }
  & $binaryPath --version
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    $resolved = (Resolve-Path -LiteralPath $temporaryRoot).Path
    $tempBase = [IO.Path]::GetTempPath().TrimEnd('\')
    if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to clean a path outside the temporary directory: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

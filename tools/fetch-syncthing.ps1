$ErrorActionPreference = 'Stop'

$version = '2.1.2'
$assetName = "syncthing-windows-amd64-v$version.zip"
$expectedSha256 = '4626c13012e9620ece2393bfc3300aeafead654695d5dc096a873c27a7543c96'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $projectRoot 'client\vendor\syncthing'
$binaryPath = Join-Path $targetDir 'syncthing.exe'

if (Test-Path -LiteralPath $binaryPath) {
  $versionOutput = & $binaryPath --version
  if ($versionOutput -match "syncthing v$([regex]::Escape($version))") {
    Write-Host "Syncthing v$version 已就绪。"
    exit 0
  }
  throw "已有 Syncthing 版本不匹配：$versionOutput"
}

$downloadUrl = "https://github.com/syncthing/syncthing/releases/download/v$version/$assetName"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "meshuttle-syncthing-$([guid]::NewGuid().ToString('N'))"
$archivePath = Join-Path $temporaryRoot $assetName
$extractPath = Join-Path $temporaryRoot 'extract'
New-Item -ItemType Directory -Path $temporaryRoot, $extractPath -Force | Out-Null

try {
  Write-Host "正在从 Syncthing 官方 GitHub Release 下载 v$version..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
  $actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "Syncthing 下载校验失败。期望 $expectedSha256，实际 $actualSha256"
  }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath
  $sourceDir = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
  if (-not $sourceDir) { throw 'Syncthing 压缩包结构无效' }
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
      throw "拒绝清理临时目录之外的路径：$resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

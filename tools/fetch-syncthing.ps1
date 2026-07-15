$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'fetch-syncthing.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

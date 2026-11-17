param(
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"
$productRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $PSScriptRoot "docker-compose.dev09-acceptance.yml"

Push-Location $productRoot
try {
    if ($RemoveData) {
        docker compose -f $composeFile down -v
    }
    else {
        docker compose -f $composeFile down
    }
    if ($LASTEXITCODE -ne 0) {
        throw "acceptance environment stop failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

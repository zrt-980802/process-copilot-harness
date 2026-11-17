param(
    [string]$BuildTag = "acceptance-20261111"
)

$ErrorActionPreference = "Stop"
$productRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $PSScriptRoot "docker-compose.dev09-acceptance.yml"

function Assert-NativeSuccess {
    param([string]$Operation)

    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE"
    }
}

Push-Location $productRoot
try {
    & (Join-Path $PSScriptRoot "prepare-artifacts.ps1")

    $env:PC_BUILD_TAG = $BuildTag
    docker compose -f $composeFile build
    Assert-NativeSuccess "acceptance image build"

    docker compose -f $composeFile up -d
    Assert-NativeSuccess "acceptance environment start"

    docker compose -f $composeFile ps
    Assert-NativeSuccess "acceptance environment status"
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "SSTS minimum acceptance environment is ready:"
Write-Host "  URL:      http://127.0.0.1:18090"
Write-Host "  Tenant:   tenant_acceptance"
Write-Host "  Account:  pilot.acceptance"
Write-Host "  Password: LocalAcceptanceSecret123"

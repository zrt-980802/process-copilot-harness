param(
    [string]$BuildTag = "dev",
    [string]$BaseImage = "process-copilot-p1a-local-dsh-runtime-base:0.2.1-rc.3"
)

$ErrorActionPreference = "Stop"
$productRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $PSScriptRoot "docker-compose.p1a-local.yml"

function Assert-NativeSuccess {
    param([string]$Operation)
    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE"
    }
}

if ($env:DOCKER_HOST) {
    throw "Refusing to build while DOCKER_HOST is set. Use the local Docker Desktop context."
}

$context = (docker context show).Trim()
Assert-NativeSuccess "Docker context lookup"
if ($context -ne "desktop-linux") {
    throw "Expected Docker context desktop-linux, found '$context'."
}

$composeConfig = docker compose -f $composeFile config --format json | ConvertFrom-Json
Assert-NativeSuccess "Local Compose validation"
$runtimeService = $composeConfig.services."runtime-host"
$portsProperty = $runtimeService.PSObject.Properties["ports"]
if ($null -ne $portsProperty -and @($runtimeService.ports).Count -gt 0) {
    throw "The local P1-A Compose file must not publish host ports."
}

$dshSource = (
    powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File (Join-Path $PSScriptRoot "prepare-dsh-context.ps1") |
        Select-Object -Last 1
).Trim()

Push-Location $productRoot
try {
    docker build `
        --build-context "dsh-source=$dshSource" `
        --file deploy/dsh-runtime-base.Dockerfile `
        --tag $BaseImage `
        .
    Assert-NativeSuccess "DSH Runtime Base build"

    $env:DSH_RUNTIME_BASE_IMAGE = $BaseImage
    $env:PC_BUILD_TAG = $BuildTag
    docker compose -f $composeFile build runtime-host
    Assert-NativeSuccess "P1-A Runtime Host build"
}
finally {
    Pop-Location
}

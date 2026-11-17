$ErrorActionPreference = "Stop"

$productRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$deployRoot = Join-Path $productRoot ".docker"
$originalNodeEnv = $env:NODE_ENV
$originalCi = $env:CI

function Assert-NativeSuccess {
    param([string]$Operation)

    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE"
    }
}

if (Test-Path -LiteralPath $deployRoot) {
    $resolvedDeployRoot = (Resolve-Path -LiteralPath $deployRoot).Path
    $expectedPrefix = $productRoot.TrimEnd("\") + "\"
    if (-not $resolvedDeployRoot.StartsWith(
        $expectedPrefix,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to remove unexpected path: $resolvedDeployRoot"
    }
    Remove-Item -LiteralPath $resolvedDeployRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $deployRoot | Out-Null

Push-Location $productRoot
try {
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    $env:CI = "true"

    pnpm install --frozen-lockfile
    Assert-NativeSuccess "pnpm install"

    pnpm run check
    Assert-NativeSuccess "pnpm check"

    $apiArtifactRoot = Join-Path $deployRoot "api"
    $apiDistRoot = Join-Path $apiArtifactRoot "dist"
    New-Item -ItemType Directory -Path $apiDistRoot | Out-Null
    Copy-Item `
        -LiteralPath (Join-Path $productRoot "apps\api\package.json") `
        -Destination (Join-Path $apiArtifactRoot "package.json")

    pnpm exec esbuild apps/api/src/main.ts `
        --bundle `
        --platform=node `
        --format=esm `
        --target=node22 `
        "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" `
        --outfile=.docker/api/dist/main.js
    Assert-NativeSuccess "API bundle generation"

    Copy-Item `
        -LiteralPath (Join-Path $PSScriptRoot "verify-dev06-local.mjs") `
        -Destination (Join-Path $apiDistRoot "verify-dev06-local.mjs")
    Copy-Item `
        -LiteralPath (Join-Path $PSScriptRoot "verify-dev08-local.mjs") `
        -Destination (Join-Path $apiDistRoot "verify-dev08-local.mjs")
    Copy-Item `
        -LiteralPath (Join-Path $PSScriptRoot "verify-dev09-local.mjs") `
        -Destination (Join-Path $apiDistRoot "verify-dev09-local.mjs")

    # Runtime Host is bundled inside deploy/runtime-host.Dockerfile because it
    # also validates and layers the pinned Linux DSH runtime.
}
finally {
    if ($null -eq $originalNodeEnv) {
        Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    }
    else {
        $env:NODE_ENV = $originalNodeEnv
    }

    if ($null -eq $originalCi) {
        Remove-Item Env:CI -ErrorAction SilentlyContinue
    }
    else {
        $env:CI = $originalCi
    }

    Pop-Location
}

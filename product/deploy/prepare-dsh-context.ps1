param(
    [string]$DshCheckout = "E:\shanzi_workspace\dsh-lab\dsh",
    [string]$ContextRoot = "E:\shanzi_workspace\.build-context"
)

$ErrorActionPreference = "Stop"
$expectedRevision = "1f81c047fc48fa190a683e469daa699857e9afe8"
$expectedTag = "dsh-v0.2.1-rc.3"
$resolved = (Resolve-Path -LiteralPath $DshCheckout).Path

$dirty = & git -C $resolved status --short
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect DSH checkout: $resolved"
}
if ($dirty) {
    throw "The DSH checkout must remain clean before it is used as a build context."
}

$revision = (& git -C $resolved rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $revision -ne $expectedRevision) {
    throw "Expected DSH revision $expectedRevision, found '$revision'."
}

$tag = (& git -C $resolved describe --tags --exact-match HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $tag -ne $expectedTag) {
    throw "Expected DSH tag $expectedTag, found '$tag'."
}

$target = Join-Path $ContextRoot "dsh-$revision-clean"
if (Test-Path -LiteralPath $target) {
    $requiredPatch = Join-Path $target "patches\@earendil-works__pi-ai@1.1.0.patch"
    $pythonSdk = Join-Path $target "python\sdk\pyproject.toml"
    if (-not (Test-Path -LiteralPath $requiredPatch) -or -not (Test-Path -LiteralPath $pythonSdk)) {
        throw "Existing DSH build context is incomplete: $target"
    }
    Write-Output $target
    exit 0
}

New-Item -ItemType Directory -Path $ContextRoot -Force | Out-Null
git clone --quiet --no-hardlinks --no-checkout $resolved $target
if ($LASTEXITCODE -ne 0) {
    throw "Failed to clone the clean DSH build context."
}
git -C $target -c core.symlinks=false checkout --quiet --detach $revision
if ($LASTEXITCODE -ne 0) {
    throw "Failed to check out the pinned DSH revision."
}

$resolvedRoot = [IO.Path]::GetFullPath($ContextRoot).TrimEnd("\") + "\"
$gitMetadata = [IO.Path]::GetFullPath((Join-Path $target ".git"))
if (-not $gitMetadata.StartsWith(
    $resolvedRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Refusing to remove build metadata outside $resolvedRoot"
}
Remove-Item -LiteralPath $gitMetadata -Recurse -Force

Write-Output $target

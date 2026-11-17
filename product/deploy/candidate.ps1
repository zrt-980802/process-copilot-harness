param(
    [ValidateSet('freeze','start','health','prepare','verify','stop','rollback','status')]
    [string]$Action = 'verify',
    [string]$Candidate,
    [string]$ChangeRecord
)
$ErrorActionPreference = 'Stop'
$pythonPath = 'E:/shanzi_workspace/feishu-ee-agents/.venv/Scripts/python.exe'
$scriptArgs = @((Join-Path $PSScriptRoot 'dev09-candidate.py'), $Action)
if ($Candidate) { $scriptArgs += @('--candidate', $Candidate) }
if ($ChangeRecord) { $scriptArgs += @('--change-record', $ChangeRecord) }
& $pythonPath @scriptArgs
exit $LASTEXITCODE

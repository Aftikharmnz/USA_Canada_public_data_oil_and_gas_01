[CmdletBinding()]
param(
    [string]$PeriodStart = "2014-01-01",
    [string]$Store = "data/cache/eia",
    [string]$PromoteTo = "public/data/usa"
)

$ErrorActionPreference = "Stop"

$scriptSetCredential = $false
if ([string]::IsNullOrWhiteSpace($env:EIA_API_KEY)) {
    if ([Console]::IsInputRedirected) {
        throw "EIA_API_KEY is required when this script runs non-interactively."
    }
    $secureApiKey = Read-Host "EIA API key" -AsSecureString
    $promptedApiKey = [Net.NetworkCredential]::new("", $secureApiKey).Password
    if ([string]::IsNullOrWhiteSpace($promptedApiKey)) {
        throw "An EIA API key was not provided."
    }
    $env:EIA_API_KEY = $promptedApiKey
    $scriptSetCredential = $true
}

$locationPushed = $false
try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $registryPath = Join-Path $projectRoot "config/series/usa.json"
    $registry = Get-Content -Raw -LiteralPath $registryPath | ConvertFrom-Json
    $phase3Series = @(
        $registry.series |
            Where-Object {
                $_.activation_status -eq "active" -and $_.introduced_in_phase -eq 3
            } |
            Sort-Object id
    )

    if ($phase3Series.Count -ne 36) {
        throw "Expected 36 active Phase 3 series, found $($phase3Series.Count). Review the registry before fetching."
    }

    $refreshArguments = @(
        "-m", "pipeline.energy_dashboard.cli",
        "refresh-eia",
        "--store", $Store,
        "--promote-to", $PromoteTo,
        "--period-start", $PeriodStart,
        "--retain-generations", "2"
    )

    foreach ($seriesDefinition in $phase3Series) {
        $refreshArguments += @("--series-id", $seriesDefinition.id)
    }

    Push-Location $projectRoot
    $locationPushed = $true
    & python @refreshArguments
    if ($LASTEXITCODE -ne 0) {
        throw "The Phase 3 bootstrap failed with exit code $LASTEXITCODE. The last-known-good generation remains active."
    }
}
finally {
    if ($locationPushed) {
        Pop-Location
    }
    if ($scriptSetCredential) {
        Remove-Item Env:EIA_API_KEY -ErrorAction SilentlyContinue
    }
}

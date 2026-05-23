param(
  [string]$BaselineName = "20260517_000001_baseline",
  [string]$ForwardName = "20260517_000002_staff_user_management",
  [string]$SchemaPath = "prisma/schema.prisma"
)

$ErrorActionPreference = "Stop"

function Load-DotEnv {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) {
      continue
    }

    $parts = $line -split "=", 2
    if ($parts.Count -ne 2) {
      continue
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"')
    [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Normalize-DatabaseUrl {
  param([string]$Url)

  if (-not $Url) {
    return $Url
  }

  if ($Url.Contains("supabase.co:5432") -and -not $Url.Contains("sslmode=")) {
    if ($Url.Contains("?")) {
      return "$Url&sslmode=require"
    }

    return "$Url?sslmode=require"
  }

  return $Url
}

Load-DotEnv ".env"
Load-DotEnv ".env.local"

if (-not $env:DATABASE_URL) {
  throw "DATABASE_URL was not found in .env or .env.local."
}

$env:DATABASE_URL = Normalize-DatabaseUrl $env:DATABASE_URL

$migrationsRoot = Join-Path (Get-Location) "prisma/migrations"
$baselineDir = Join-Path $migrationsRoot $BaselineName
$forwardDir = Join-Path $migrationsRoot $ForwardName

New-Item -ItemType Directory -Force -Path $baselineDir | Out-Null
New-Item -ItemType Directory -Force -Path $forwardDir | Out-Null

$baselineSql = Join-Path $baselineDir "migration.sql"
$forwardSql = Join-Path $forwardDir "migration.sql"

npx.cmd prisma migrate diff --from-empty --to-url $env:DATABASE_URL --script | Set-Content -LiteralPath $baselineSql
$forwardDiff = npx.cmd prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel $SchemaPath --script

if ($forwardDiff.Trim() -eq "-- This is an empty migration.") {
  Remove-Item -Recurse -Force -LiteralPath $forwardDir
  $forwardSql = $null
} else {
  $forwardDiff | Set-Content -LiteralPath $forwardSql
}

Write-Host "Generated:"
Write-Host " - $baselineSql"
if ($forwardSql) {
  Write-Host " - $forwardSql"
} else {
  Write-Host " - no forward migration was needed"
}

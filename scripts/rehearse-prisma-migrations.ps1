<#
.SYNOPSIS
Runs a guarded Prisma migration rehearsal against a local or explicitly test-only database.

.DESCRIPTION
This command deliberately uses `prisma migrate deploy`; it never calls `prisma db push`.
It refuses production/staging environments and database URLs that are not demonstrably
loopback-local or an explicitly named test database. The output is designed to be saved
as a CI or release artifact and deliberately does not print connection strings.
#>

[CmdletBinding()]
param(
  [string]$SchemaPath = "prisma/schema.prisma",
  [string]$SmokeApiBaseUrl
)

$ErrorActionPreference = "Stop"
$script:RehearsalStartedAt = (Get-Date).ToUniversalTime().ToString("o")
$script:Report = [ordered]@{
  result = "FAILED"
  startedAtUtc = $script:RehearsalStartedAt
  completedAtUtc = $null
  environment = $null
  databaseSafetyClass = $null
  migrationCount = 0
  preDeployStatusExitCode = $null
  deployExitCode = $null
  postDeployStatusExitCode = $null
  smokeReadiness = "not-requested"
}

function Write-Rehearsal {
  param([string]$Message)
  Write-Host "MIGRATION_REHEARSAL $Message"
}

function Load-DotEnvIfUnset {
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
    $value = $parts[1].Trim().Trim('"').Trim("'")
    if (-not [System.Environment]::GetEnvironmentVariable($name, "Process")) {
      [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Get-DatabaseSafetyClass {
  param(
    [string]$Url,
    [string]$Label,
    [string]$AppEnvironment
  )

  if ([string]::IsNullOrWhiteSpace($Url)) {
    throw "$Label is required. Set DATABASE_URL (and DIRECT_URL when the schema requires it)."
  }

  try {
    $uri = [System.Uri]$Url
  } catch {
    throw "$Label is not a valid PostgreSQL connection URL."
  }

  if ($uri.Scheme -notin @("postgres", "postgresql")) {
    throw "$Label must use the postgres or postgresql scheme."
  }

  $databaseHost = $uri.Host.ToLowerInvariant()
  $databaseName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.Trim("/"))
  $loopbackHosts = @("localhost", "127.0.0.1", "::1")
  $isLoopback = $databaseHost -in $loopbackHosts
  $isExplicitTestDatabase = $databaseName -match "(^|[_-])(test|testing|sandbox)([_-]|$)" -or $databaseName -match "^(test|testing|sandbox)"
  $isTestEnvironment = $AppEnvironment -in @("test", "testing")

  if ($AppEnvironment -in @("production", "prod", "staging", "stage")) {
    throw "Refusing migration rehearsal because APP_ENV='$AppEnvironment'. Use a disposable local or test environment."
  }

  if ($isLoopback) {
    return "loopback-local"
  }

  if ($isTestEnvironment -and $isExplicitTestDatabase) {
    return "explicit-test"
  }

  throw "Refusing $Label because it is not loopback-local or an explicitly named test database in APP_ENV=test."
}

function Redact-Output {
  param([object[]]$Lines)

  foreach ($line in $Lines) {
    $text = [string]$line
    $text = $text -replace '(?i)(postgres(?:ql)?://)[^\s"'']+', '$1[REDACTED]'
    Write-Host $text
  }
}

function Invoke-PrismaCommand {
  param(
    [string]$Step,
    [string[]]$Arguments
  )

  Write-Rehearsal "STEP=$Step COMMAND=prisma $($Arguments -join ' ')"
  $output = & npx.cmd prisma @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  Redact-Output $output
  Write-Rehearsal "STEP=$Step EXIT_CODE=$exitCode"
  return $exitCode
}

function Invoke-ReadinessSmoke {
  param([string]$BaseUrl)

  if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    Write-Rehearsal "SMOKE_READINESS=GUIDANCE API health endpoints are not required for this local rehearsal. After starting the API, request /health/live and /health/ready without credentials."
    return "guidance-only"
  }

  $trimmedBaseUrl = $BaseUrl.TrimEnd("/")
  try {
    $uri = [System.Uri]$trimmedBaseUrl
  } catch {
    throw "SmokeApiBaseUrl must be a valid http(s) base URL."
  }

  if ($uri.Scheme -notin @("http", "https") -or -not [string]::IsNullOrWhiteSpace($uri.UserInfo)) {
    throw "SmokeApiBaseUrl must be an http(s) URL without embedded credentials."
  }

  foreach ($path in @("/health/live", "/health/ready")) {
    $endpoint = "$trimmedBaseUrl$path"
    try {
      $response = Invoke-WebRequest -Uri $endpoint -Method Get -TimeoutSec 5 -UseBasicParsing
      Write-Rehearsal "SMOKE_ENDPOINT=$path STATUS=$($response.StatusCode)"
    } catch {
      $statusCode = $null
      if ($_.Exception.Response) {
        $statusCode = [int]$_.Exception.Response.StatusCode
      }
      if ($statusCode) {
        Write-Rehearsal "SMOKE_ENDPOINT=$path STATUS=$statusCode NOTE=Health endpoint did not return success."
      } else {
        Write-Rehearsal "SMOKE_ENDPOINT=$path STATUS=UNAVAILABLE NOTE=Start the local API or implement the endpoint before release certification."
      }
    }
  }

  return "requested"
}

try {
  Load-DotEnvIfUnset ".env"
  Load-DotEnvIfUnset ".env.local"

  $appEnvironment = if ($env:APP_ENV) { $env:APP_ENV.ToLowerInvariant() } else { "unset" }
  $script:Report.environment = $appEnvironment
  $databaseSafety = Get-DatabaseSafetyClass -Url $env:DATABASE_URL -Label "DATABASE_URL" -AppEnvironment $appEnvironment
  $directUrl = if ($env:DIRECT_URL) { $env:DIRECT_URL } else { $env:DATABASE_URL }
  $directSafety = Get-DatabaseSafetyClass -Url $directUrl -Label "DIRECT_URL" -AppEnvironment $appEnvironment

  if ($databaseSafety -ne $directSafety) {
    throw "Refusing migration rehearsal because DATABASE_URL and DIRECT_URL do not have the same allowed safety class."
  }

  if (-not (Test-Path -LiteralPath $SchemaPath)) {
    throw "Prisma schema was not found at '$SchemaPath'."
  }

  # Prisma's datasource declares directUrl. Ensure it is present even for the local
  # single-URL setup, while preserving the caller's DATABASE_URL as the application URL.
  $env:DIRECT_URL = $directUrl
  $migrationsPath = Join-Path (Split-Path -Parent $SchemaPath) "migrations"
  $migrationCount = @(Get-ChildItem -LiteralPath $migrationsPath -Directory -ErrorAction Stop).Count

  $script:Report.databaseSafetyClass = $databaseSafety
  $script:Report.migrationCount = $migrationCount
  Write-Rehearsal "RESULT=STARTED STARTED_AT_UTC=$script:RehearsalStartedAt ENVIRONMENT=$appEnvironment DATABASE_SAFETY_CLASS=$databaseSafety MIGRATION_COUNT=$migrationCount"

  # A nonzero pre-deploy status may simply mean that migrations are pending; deploy is
  # still the authoritative rehearsal step. The post-deploy status must succeed.
  $script:Report.preDeployStatusExitCode = Invoke-PrismaCommand -Step "status-before" -Arguments @("migrate", "status", "--schema", $SchemaPath)
  $script:Report.deployExitCode = Invoke-PrismaCommand -Step "deploy" -Arguments @("migrate", "deploy", "--schema", $SchemaPath)
  if ($script:Report.deployExitCode -ne 0) {
    throw "prisma migrate deploy failed. Do not use db push, reset, or a destructive rollback. Follow the forward-repair checklist in docs/15-environment-and-local-development-guide.md."
  }

  $script:Report.postDeployStatusExitCode = Invoke-PrismaCommand -Step "status-after" -Arguments @("migrate", "status", "--schema", $SchemaPath)
  if ($script:Report.postDeployStatusExitCode -ne 0) {
    throw "Migration status is not healthy after deploy. Stop here and follow the forward-repair checklist."
  }

  $script:Report.smokeReadiness = Invoke-ReadinessSmoke -BaseUrl $SmokeApiBaseUrl
  $script:Report.result = "PASSED"
} catch {
  Write-Rehearsal "RESULT=FAILED REASON=$($_.Exception.Message)"
  throw
} finally {
  $script:Report.completedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  $json = $script:Report | ConvertTo-Json -Compress
  Write-Rehearsal "REPORT=$json"
}

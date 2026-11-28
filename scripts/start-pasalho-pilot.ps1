[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$localConfig = Join-Path $repoRoot ".env.pilot.local"
$expectedHost = "127.0.0.1"
$expectedPort = 55432
$expectedDatabase = "pasalho_pilot_acceptance"
$expectedSchema = "public"
$expectedUser = "postgres"
$webPort = 3000

if (-not (Test-Path -LiteralPath $localConfig -PathType Leaf)) {
  throw "Create .env.pilot.local from .env.pilot.local.example and set AUTH_SECRET."
}

$localSettings = @{}
foreach ($line in Get-Content -LiteralPath $localConfig) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
  $separator = $trimmed.IndexOf("=")
  if ($separator -lt 1) { throw "Invalid .env.pilot.local setting." }
  $key = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
  if ($key -ne "AUTH_SECRET") {
    throw "Only AUTH_SECRET is allowed in .env.pilot.local; the pilot database target is fixed in this launcher."
  }
  $localSettings[$key] = $value
}

$authSecret = $localSettings["AUTH_SECRET"]
if (-not $authSecret -or $authSecret.Length -lt 32 -or $authSecret -match "replace|changeme|example") {
  throw ".env.pilot.local must contain a private AUTH_SECRET of at least 32 characters."
}

if ($env:APP_ENV -and $env:APP_ENV -ne "test") {
  throw "Refusing inherited APP_ENV '$($env:APP_ENV)'; unset it before starting the local pilot."
}

$expectedDatabaseUrl = "postgresql://$expectedUser@$expectedHost`:$expectedPort/$expectedDatabase`?schema=$expectedSchema"
if ($env:DATABASE_URL) {
  try { $inheritedDatabaseUrl = [uri]$env:DATABASE_URL }
  catch { throw "Refusing an invalid inherited DATABASE_URL." }
  $inheritedDatabase = $inheritedDatabaseUrl.AbsolutePath.TrimStart("/")
  if (
    $inheritedDatabaseUrl.Scheme -notin @("postgres", "postgresql") -or
    $inheritedDatabaseUrl.Host -ne $expectedHost -or
    $inheritedDatabaseUrl.Port -ne $expectedPort -or
    $inheritedDatabase -ne $expectedDatabase -or
    $inheritedDatabaseUrl.UserInfo -ne $expectedUser -or
    $inheritedDatabaseUrl.Query -ne "?schema=$expectedSchema"
  ) {
    throw "Refusing an inherited DATABASE_URL that is not the password-free isolated pilot database."
  }
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $webPort -ErrorAction SilentlyContinue
if ($listener) {
  throw "Port $webPort is already in use. Identify and stop the existing local app before launching this pilot."
}

$env:DATABASE_URL = $expectedDatabaseUrl
$env:APP_ENV = "test"
$env:AUTH_SECRET = $authSecret
$env:APP_URL = "http://127.0.0.1:$webPort"
$nodeOptions = @($env:NODE_OPTIONS -split "\s+" | Where-Object { $_ })
if ($nodeOptions -notcontains "--trace-deprecation") {
  $nodeOptions += "--trace-deprecation"
}
$env:NODE_OPTIONS = $nodeOptions -join " "

Push-Location $repoRoot
try {
  & node "scripts/pilot-db-preflight.mjs"
  if ($LASTEXITCODE -ne 0) { throw "Pilot database identity check failed; the app was not started." }
  Write-Host "Starting PASALHO Lite against the isolated local pilot database on 127.0.0.1:$webPort."
  Write-Host "Press Ctrl+C to stop the local development server."
  & npm run dev -- --hostname 127.0.0.1 --port $webPort
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

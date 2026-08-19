param(
  [string]$ConsoleDir = (Join-Path $env:LOCALAPPDATA "Programs\Codex Asset Console"),
  [string]$BackendDir = (Join-Path $env:LOCALAPPDATA "CodexAssetConsoleService"),
  [int]$BackendPort = 5177
)

$ErrorActionPreference = "Stop"

function Get-NodeInfo {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if (-not $command) { return [ordered]@{ found = $false; path = $null; version = $null; compatible = $false } }
  $versionText = (& $command.Source --version 2>$null)
  $major = 0
  if ($versionText -match '^v(\d+)') { $major = [int]$Matches[1] }
  return [ordered]@{ found = $true; path = $command.Source; version = $versionText; compatible = ($major -ge 22) }
}

function Test-BackendHealth {
  param([int]$Port)
  try {
    $headers = @{}
    $tokenPath = Join-Path $BackendDir '.api-token'
    if (Test-Path -LiteralPath $tokenPath) {
      $token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
      if ($token) { $headers['x-asset-console-token'] = $token }
    }
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/projects" -Headers $headers -TimeoutSec 2
    return [ordered]@{ reachable = $true; projects = @($response.projects).Count; error = $null }
  } catch {
    return [ordered]@{ reachable = $false; projects = $null; error = $_.Exception.Message }
  }
}

$codexProcesses = @(Get-CimInstance Win32_Process -Filter "Name='Codex.exe'" -ErrorAction SilentlyContinue)
$backendServer = Join-Path $BackendDir "server.js"
$backendProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and $_.CommandLine.IndexOf($backendServer, [StringComparison]::OrdinalIgnoreCase) -ge 0
})

$result = [ordered]@{
  inspectedAt = [DateTimeOffset]::Now.ToString('o')
  platform = [Environment]::OSVersion.VersionString
  node = Get-NodeInfo
  codex = [ordered]@{
    running = ($codexProcesses.Count -gt 0)
    processCount = $codexProcesses.Count
  }
  console = [ordered]@{
    installed = (Test-Path -LiteralPath (Join-Path $ConsoleDir "scripts\injector.mjs"))
    installDir = $ConsoleDir
    manifest = (Test-Path -LiteralPath (Join-Path $ConsoleDir "install-manifest.json"))
  }
  service = [ordered]@{
    installed = (Test-Path -LiteralPath $backendServer)
    installDir = $BackendDir
    configPresent = (Test-Path -LiteralPath (Join-Path $BackendDir "asset-browser.config.json"))
    processCount = $backendProcesses.Count
    health = Test-BackendHealth -Port $BackendPort
  }
}

$result | ConvertTo-Json -Depth 8

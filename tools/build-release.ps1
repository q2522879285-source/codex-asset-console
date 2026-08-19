param(
  [string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) '.release'),
  [string]$OnepagerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\codex-asset-console-onepage.png')
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$outputRoot = [IO.Path]::GetFullPath($OutputDir).TrimEnd('\')
if (-not $outputRoot.StartsWith($repoRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputDir must stay inside the repository: $outputRoot"
}

$workRoot = Join-Path $outputRoot '.build'
if (Test-Path -LiteralPath $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null

function Copy-Tree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "Missing build input: $Source" }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Write-ShaSidecar([string]$FilePath) {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$FilePath.sha256.txt", "$hash  $([IO.Path]::GetFileName($FilePath))`n", (New-Object Text.UTF8Encoding($false)))
}

function Assert-ReleaseTree([string]$Root) {
  $forbiddenNames = '(?i)(^|[\\/])(\.api-token|asset-browser\.config\.json|\.asset-download-ledger\.json|[^\\/]*ledger[^\\/]*\.json|[^\\/]*\.(pid|log))$'
  $forbiddenDirs = '(?i)(^|[\\/])(ledgers|tickets|generated|downloads|runtime-state)([\\/]|$)'
  $mediaExtensions = @('.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.mkv', '.avi', '.wav', '.mp3', '.flac')
  $textExtensions = @('.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.py', '.txt', '.yaml', '.yml')
  $blockedTerms = @('li' + 'u1', 'yubo' + 'wen', 'q252' + '2879285', 'tap' + 'now') | ForEach-Object { [regex]::Escape($_) }
  $textPatterns = [ordered]@{
    personalString = '(?i)' + ($blockedTerms -join '|')
    privateUserPath = '(?i)([a-z]:\\Users\\[a-z0-9._-]+|/Users/[a-z0-9._-]+)'
    uuid = '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b'
  }

  foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -Force -File) {
    $relative = $file.FullName.Substring($Root.Length).TrimStart('\')
    if ($relative -match $forbiddenNames -or $relative -match $forbiddenDirs) {
      throw "Release privacy scan rejected runtime/state file: $relative"
    }
    $portableRelative = $relative.Replace('\', '/')
    $approvedMedia = $portableRelative -in @('docs/codex-asset-console-onepage.png', 'assets/onepager.png')
    if (($mediaExtensions -contains $file.Extension.ToLowerInvariant()) -and -not $approvedMedia) {
      throw "Release privacy scan rejected private media: $relative"
    }
    if ($textExtensions -contains $file.Extension.ToLowerInvariant()) {
      $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
      foreach ($entry in $textPatterns.GetEnumerator()) {
        if ($content -match $entry.Value) { throw "Release privacy scan rejected $($entry.Key) in $relative" }
      }
    }
  }
}

try {
  $frontendRoot = Join-Path $workRoot 'windows'
  New-Item -ItemType Directory -Path $frontendRoot -Force | Out-Null
  foreach ($relative in @('LICENSE', 'README.md', 'README-Windows.txt', 'SECURITY.md', 'VERIFICATION.txt', 'package.json', 'install-windows.ps1')) {
    Copy-Tree (Join-Path $repoRoot $relative) (Join-Path $frontendRoot $relative)
  }
  foreach ($relative in @('asset-console', 'inject', 'windows')) {
    Copy-Tree (Join-Path $repoRoot $relative) (Join-Path $frontendRoot $relative)
  }
  foreach ($relative in @(
    'lib\asset-console-embed.mjs', 'lib\card-view.mjs', 'lib\home-projects.mjs',
    'lib\injector-state.mjs', 'lib\preview-data.mjs', 'lib\usage-data.mjs',
    'scripts\cdp-client.mjs', 'scripts\injector.mjs', 'scripts\remove-injection.mjs'
  )) {
    Copy-Tree (Join-Path $repoRoot $relative) (Join-Path $frontendRoot $relative)
  }
  if (Test-Path -LiteralPath $OnepagerPath -PathType Leaf) {
    Copy-Tree $OnepagerPath (Join-Path $frontendRoot 'docs\codex-asset-console-onepage.png')
    $releaseOnepager = Join-Path $outputRoot 'codex-asset-console-onepage.png'
    Copy-Tree $OnepagerPath $releaseOnepager
    Write-ShaSidecar $releaseOnepager
  }
  Assert-ReleaseTree $frontendRoot

  $windowsZip = Join-Path $outputRoot 'codex-asset-console-windows.zip'
  Compress-Archive -Path (Join-Path $frontendRoot '*') -DestinationPath $windowsZip -CompressionLevel Optimal
  Write-ShaSidecar $windowsZip

  $skillRoot = Join-Path (Join-Path $workRoot 'skill') 'codex-asset-console'
  Copy-Tree (Join-Path $repoRoot 'skill-template\codex-asset-console') $skillRoot
  $runtimeRoot = Join-Path $skillRoot 'assets\runtime'
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  Copy-Tree $windowsZip (Join-Path $runtimeRoot 'codex-asset-console-windows.zip')

  $servicePayload = Join-Path $runtimeRoot 'service'
  Copy-Tree (Join-Path $repoRoot 'asset-browser') $servicePayload
  if (Test-Path -LiteralPath (Join-Path $servicePayload 'public')) { Remove-Item -LiteralPath (Join-Path $servicePayload 'public') -Recurse -Force }
  Copy-Tree (Join-Path $repoRoot 'asset-console\public') (Join-Path $servicePayload 'public')
  Assert-ReleaseTree $servicePayload

  if (Test-Path -LiteralPath $OnepagerPath -PathType Leaf) {
    Copy-Tree $OnepagerPath (Join-Path $skillRoot 'assets\onepager.png')
  }

  $manifestEntries = New-Object System.Collections.Generic.List[object]
  Get-ChildItem -LiteralPath $frontendRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($frontendRoot.Length).TrimStart('\').Replace('\', '/')
    $manifestEntries.Add([ordered]@{ path = "console/$relative"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant(); size = $_.Length }) | Out-Null
  }
  Get-ChildItem -LiteralPath $servicePayload -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($servicePayload.Length).TrimStart('\').Replace('\', '/')
    $manifestEntries.Add([ordered]@{ path = "service/$relative"; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant(); size = $_.Length }) | Out-Null
  }
  $manifest = [ordered]@{
    schemaVersion = 1
    product = 'codex-asset-console'
    version = '1.0.0'
    consoleZipSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $windowsZip).Hash.ToLowerInvariant()
    files = $manifestEntries
  }
  [IO.File]::WriteAllText((Join-Path $runtimeRoot 'manifest.sha256.json'), (($manifest | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding($false)))

  Assert-ReleaseTree $skillRoot

  $skillZip = Join-Path $outputRoot 'codex-asset-console-skill.zip'
  Compress-Archive -Path $skillRoot -DestinationPath $skillZip -CompressionLevel Optimal
  Write-ShaSidecar $skillZip

  Remove-Item -LiteralPath $workRoot -Recurse -Force
  [pscustomobject]@{
    outputDir = $outputRoot
    windowsZip = $windowsZip
    windowsSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $windowsZip).Hash.ToLowerInvariant()
    skillZip = $skillZip
    skillSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $skillZip).Hash.ToLowerInvariant()
    privacyScan = 'passed'
    onepagerIncluded = (Test-Path -LiteralPath $OnepagerPath -PathType Leaf)
    onepager = if (Test-Path -LiteralPath $OnepagerPath -PathType Leaf) { Join-Path $outputRoot 'codex-asset-console-onepage.png' } else { $null }
  } | ConvertTo-Json -Depth 4
} catch {
  if (Test-Path -LiteralPath $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
  throw
}

<#
  MoShu (墨枢) desktop launcher — starts every service the IDE needs.

  Flow:
    1. Add local Ollama (127.0.0.1:11434) for embeddings; reuse it if already running
    2. Make sure better-sqlite3 is built for Electron's ABI (electron-rebuild when stale)
    3. Start the renderer + Electron via `pnpm dev`
    4. When the Electron window closes, Vite exits; stop the Ollama instance we started

  Usage (double-click the desktop shortcut):
    powershell -NoProfile -ExecutionPolicy Bypass -File "F:\MoShu\scripts\start-moshu.ps1"

  Optional:
    -OllamaRoot <dir>   Ollama install directory (default F:\ollama)
    -KeepOllama         keep Ollama running after MoShu exits
    -SkipRebuild        skip the better-sqlite3 ABI check
#>

param(
  [string]$ProjectRoot = 'F:\MoShu',
  [string]$OllamaRoot = 'F:\ollama',
  [switch]$KeepOllama,
  [switch]$SkipRebuild,
  # Only verify services (Ollama + ABI) and exit without opening MoShu
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$ollamaExe = Join-Path $OllamaRoot 'ollama.exe'
$modelsDir = Join-Path $OllamaRoot 'models'
$homeDir = Join-Path $OllamaRoot 'home'
$apiBase = 'http://127.0.0.1:11434'
$launcherDir = Join-Path $ProjectRoot '.launcher'

function Write-Step($msg) { Write-Host "[MoShu] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[MoShu] $msg" -ForegroundColor Yellow }
function Fail($msg) {
  Write-Host "[MoShu] $msg" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

if (-not (Test-Path $ProjectRoot)) { Fail "Project directory not found: $ProjectRoot" }
New-Item -ItemType Directory -Force $launcherDir | Out-Null

# ---------- 0. Toolchain ----------
$pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpm) {
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
}
if (-not $pnpm) { Fail "pnpm not found in PATH. Install Node.js + pnpm first." }

if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Step "node_modules missing, installing dependencies (first run)..."
  Push-Location $ProjectRoot
  try { & $pnpm.Source install } finally { Pop-Location }
}

# ---------- 1. better-sqlite3 ABI ----------
# Dev mode loads better-sqlite3 inside Electron. A Node-ABI build fails there with
# NODE_MODULE_VERSION, so rebuild for Electron when the module currently loads in Node.
if (-not $SkipRebuild) {
  $nodeCheck = ''
  try {
    Push-Location $ProjectRoot
    $nodeCheck = (& node -e "try{require('better-sqlite3');console.log('NODE_OK')}catch(e){console.log('NODE_FAIL')}" 2>&1) -join "`n"
  } catch { $nodeCheck = 'NODE_FAIL' } finally { Pop-Location }

  if ($nodeCheck -match 'NODE_OK') {
    Write-Step "Rebuilding better-sqlite3 for Electron (one-time per ABI change)..."
    Push-Location $ProjectRoot
    try {
      & $pnpm.Source run rebuild
      if ($LASTEXITCODE -ne 0) { Write-Warn "electron-rebuild failed (exit $LASTEXITCODE); MoShu may fail to open the database." }
    } finally { Pop-Location }
  } else {
    Write-Step "better-sqlite3 already matches an Electron build, skipping rebuild."
  }
}

# ---------- 2. Ollama (embeddings) ----------
$ollamaProc = $null
$ollamaReady = $false
if (Test-Path $ollamaExe) {
  $running = $false
  try {
    $resp = Invoke-RestMethod "$apiBase/api/version" -TimeoutSec 3
    if ($resp.version) { $running = $true }
  } catch { }

  if ($running) {
    $ollamaReady = $true
    Write-Step "Ollama already running, reusing it."
  } else {
    Write-Step "Starting Ollama service ..."
    New-Item -ItemType Directory -Force $modelsDir, $homeDir, (Join-Path $homeDir '.ollama') | Out-Null

    $environmentNames = @('OLLAMA_MODELS', 'OLLAMA_HOME', 'USERPROFILE', 'OLLAMA_HOST', 'HTTP_PROXY', 'HTTPS_PROXY')
    $savedEnvironment = @{}
    foreach ($name in $environmentNames) {
      $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    try {
      $env:OLLAMA_MODELS = $modelsDir
      $env:OLLAMA_HOME = Join-Path $homeDir '.ollama'
      $env:USERPROFILE = $homeDir
      $env:OLLAMA_HOST = '127.0.0.1:11434'
      # Local calls must bypass the system proxy
      $env:HTTP_PROXY = ''
      $env:HTTPS_PROXY = ''
      $env:http_proxy = ''
      $env:https_proxy = ''

      $ollamaProc = Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $OllamaRoot 'serve.out.log') `
        -RedirectStandardError (Join-Path $OllamaRoot 'serve.err.log')
    } finally {
      foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
      }
    }

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 700
      try {
        $resp = Invoke-RestMethod "$apiBase/api/version" -TimeoutSec 3
        if ($resp.version) { $ollamaReady = $true; break }
      } catch { }
      if ($ollamaProc.HasExited) { break }
    }

    if ($ollamaReady) {
      Write-Step "Ollama ready at 127.0.0.1:11434."
      try {
        $tags = Invoke-RestMethod "$apiBase/api/tags" -TimeoutSec 5
        $names = @($tags.models | ForEach-Object { $_.name })
        if ($names.Count -eq 0) {
          Write-Warn "No Ollama model installed; semantic retrieval will be unavailable. Run: `"$ollamaExe`" pull bge-m3"
        } else {
          $hasEmbedding = $false
          foreach ($n in $names) { if ($n -like 'bge-m3*') { $hasEmbedding = $true } }
          if ($hasEmbedding) { Write-Step ("Models: " + ($names -join ', ')) }
          else { Write-Warn ("Models: " + ($names -join ', ') + " — bge-m3 is missing; semantic retrieval may fail.") }
        }
      } catch { }
    } else {
      Write-Warn "Ollama failed to start or timed out; MoShu still starts without semantic retrieval."
      Write-Warn "See $OllamaRoot\serve.err.log"
    }
  }
} else {
  Write-Warn "Ollama not found at $ollamaExe; starting MoShu without local embeddings."
}

# ---------- 3. Start MoShu (Vite + Electron) ----------
if ($VerifyOnly) {
  if ($ollamaReady) {
    Write-Step "Verify: Ollama reachable."
    try {
      $body = @{ model = 'bge-m3'; input = @('The protagonist pushed the tavern door open on a rainy night') } | ConvertTo-Json -Compress
      $emb = Invoke-RestMethod "$apiBase/v1/embeddings" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 120
      $dim = @($emb.data[0].embedding).Count
      Write-Step "Verify: embedding dimension $dim (bge-m3 should be 1024)."
      $verifyOk = ($dim -eq 1024)
    } catch {
      Write-Warn "Verify: embedding call failed: $($_.Exception.Message)"
      $verifyOk = $false
    }
  } else {
    Write-Warn "Verify: Ollama is not reachable; MoShu would start without semantic retrieval."
    $verifyOk = $false
  }
  if ($ollamaProc -and -not $ollamaProc.HasExited) {
    Stop-Process -Id $ollamaProc.Id -Force -ErrorAction SilentlyContinue
    Write-Step "Verify: stopped the test Ollama instance."
  }
  exit $(if ($verifyOk) { 0 } else { 1 })
}

Write-Step "Starting MoShu (Vite dev server + Electron window) ..."
$devProc = Start-Process -FilePath $env:ComSpec -ArgumentList '/c', 'pnpm dev' `
  -WorkingDirectory $ProjectRoot -PassThru -NoNewWindow
Write-Step "MoShu PID $($devProc.Id). Close the MoShu window to shut everything down."

try { $devProc.WaitForExit() } catch { }

# Safety net: vite-plugin-electron exits with Electron, but never leave a stray dev server
if (-not $devProc.HasExited) {
  & taskkill /PID $devProc.Id /T /F 2>$null | Out-Null
}

# ---------- 4. Cleanup ----------
Start-Sleep -Seconds 1
if ($ollamaProc -and -not $KeepOllama) {
  if (-not $ollamaProc.HasExited) {
    Write-Step "MoShu closed, stopping the Ollama instance started by this launcher ..."
    Stop-Process -Id $ollamaProc.Id -Force -ErrorAction SilentlyContinue
  }
} elseif ($ollamaProc -and $KeepOllama) {
  Write-Step "MoShu closed; Ollama stays running (-KeepOllama)."
} else {
  Write-Step "MoShu closed."
}

Start-Sleep -Seconds 2

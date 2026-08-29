param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectPath = $PSScriptRoot
$gameUrl = "https://localhost:8080/menu.html"
$serviceName = "postgresql-x64-17"

Set-Location -LiteralPath $projectPath

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$postgres = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($postgres -and $postgres.Status -ne "Running" -and -not (Test-IsAdministrator)) {
  $elevatedArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  if ($NoBrowser) {
    $elevatedArguments += " -NoBrowser"
  }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $elevatedArguments
  exit 0
}

try {
  $postgres = Get-Service -Name $serviceName -ErrorAction Stop
  if ($postgres.Status -ne "Running") {
    Start-Service -Name $serviceName
    $postgres.WaitForStatus("Running", [TimeSpan]::FromSeconds(20))
  }
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Cannot start PostgreSQL. Please ask the administrator to check the PostgreSQL service.`n`n$($_.Exception.Message)",
    "SongSong Game",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}

$serverReady = $false
try {
  $response = Invoke-WebRequest -Uri $gameUrl -UseBasicParsing -TimeoutSec 2
  $serverReady = $response.StatusCode -eq 200
} catch {}

if (-not $serverReady) {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $nodePath
  $startInfo.Arguments = "server.js"
  $startInfo.WorkingDirectory = $projectPath
  $startInfo.UseShellExecute = $true
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  [System.Diagnostics.Process]::Start($startInfo) | Out-Null

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri $gameUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $serverReady = $true
        break
      }
    } catch {}
  }
}

if (-not $serverReady) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "The game server could not start. Please contact the administrator.",
    "SongSong Game",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}

if (-not $NoBrowser) {
  # Route the URL through the interactive Windows shell. This reliably opens
  # the user's default browser even when this launcher runs as administrator.
  Start-Process -FilePath "explorer.exe" -ArgumentList $gameUrl
}

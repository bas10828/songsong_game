$ErrorActionPreference = "Stop"
$stopped = $false
$serviceName = "postgresql-x64-17"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$postgres = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($postgres -and $postgres.Status -ne "Stopped" -and -not (Test-IsAdministrator)) {
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  exit 0
}

$processIds = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
if ($processIds.Count -eq 0) {
  $processIds = @(netstat -ano | Select-String '0.0.0.0:8080\s+0.0.0.0:0\s+LISTENING' | ForEach-Object {
    [int](($_.ToString().Trim() -split '\s+')[-1])
  })
}

foreach ($processId in $processIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq "node") {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    $stopped = $true
  }
}

try {
  $postgres = Get-Service -Name $serviceName -ErrorAction Stop
  if ($postgres.Status -ne "Stopped") {
    Stop-Service -Name $serviceName -Force
    $postgres.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(20))
    $stopped = $true
  }
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "The game server was closed, but PostgreSQL could not be stopped.`n`n$($_.Exception.Message)",
    "SongSong Game",
    "OK",
    "Warning"
  ) | Out-Null
  exit 1
}

Add-Type -AssemblyName PresentationFramework
$message = if ($stopped) {
  "SongSong Game and PostgreSQL have been closed."
} else {
  "SongSong Game and PostgreSQL are already closed."
}
[System.Windows.MessageBox]::Show($message, "SongSong Game", "OK", "Information") | Out-Null

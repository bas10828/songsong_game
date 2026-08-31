param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectPath = $PSScriptRoot
$serviceName = "postgresql-x64-17"

Set-Location -LiteralPath $projectPath

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LanIPv4Address {
  $socket = [System.Net.Sockets.UdpClient]::new()
  try {
    # Connecting a UDP socket selects the active network route without
    # sending any data. Its local endpoint is this computer's current LAN IP.
    $socket.Connect("8.8.8.8", 53)
    return ([System.Net.IPEndPoint]$socket.Client.LocalEndPoint).Address.ToString()
  } catch {
    return "localhost"
  } finally {
    $socket.Dispose()
  }
}

function Test-GameServer {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.BeginConnect("127.0.0.1", 8080, $null, $null)
    if (-not $connection.AsyncWaitHandle.WaitOne(2000)) {
      return $false
    }
    $client.EndConnect($connection)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

$gameHost = Get-LanIPv4Address
$gameUrl = "https://${gameHost}:8080/menu.html"

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

$serverReady = Test-GameServer

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
    if (Test-GameServer) {
      $serverReady = $true
      break
    }
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

# Auto-start script for Saving Server via PM2
param(
    [switch]$NoDelay
)

$ErrorActionPreference = "Continue"

$logDir = Join-Path $env:USERPROFILE ".pm2\logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$logFile = Join-Path $logDir "startup.log"

function Log-Message {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Output $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

if (-not $NoDelay) {
    Log-Message "Auto-start triggered. Waiting 10 seconds for network and environment initialization..."
    Start-Sleep -Seconds 10
} else {
    Log-Message "Auto-start triggered without delay (test mode)."
}

# Ensure essential paths in environment
$nodePath = "C:\Program Files\nodejs"
$npmPath = Join-Path $env:APPDATA "npm"
if ($env:Path -notlike "*$npmPath*") {
    $env:Path = "$nodePath;$npmPath;$env:Path"
}
$env:PM2_HOME = Join-Path $env:USERPROFILE ".pm2"

$pm2Cmd = Join-Path $npmPath "pm2.cmd"
if (-not (Test-Path $pm2Cmd)) {
    $pm2Cmd = "pm2"
}

function Is-SavingBotRunning {
    try {
        $pidRaw = & $pm2Cmd pid saving-bot 2>$null
        $cleanPid = ($pidRaw | Out-String).Trim()
        $parsedPid = 0
        if ([int]::TryParse($cleanPid, [ref]$parsedPid) -and $parsedPid -gt 0) {
            $proc = Get-Process -Id $parsedPid -ErrorAction SilentlyContinue
            if ($proc -and -not $proc.HasExited) {
                return $parsedPid
            }
        }
    } catch {
        Log-Message "Error checking process status: $_"
    }
    return 0
}

# 1. Check if saving-bot is already running
$activePid = Is-SavingBotRunning
if ($activePid -gt 0) {
    Log-Message "saving-bot is already running (PID: $activePid). Server is healthy."
    exit 0
}

# 2. Try resurrecting from PM2 dump
Log-Message "saving-bot is not active. Attempting PM2 resurrect..."
$resurrectOutput = & $pm2Cmd resurrect 2>&1
Log-Message "PM2 resurrect output: $resurrectOutput"

Start-Sleep -Seconds 2

# 3. Verify if running after resurrect
$activePid = Is-SavingBotRunning
if ($activePid -gt 0) {
    Log-Message "saving-bot successfully restored and running (PID: $activePid)."
    exit 0
}

# 4. If resurrect didn't start it, start fresh from project directory
Log-Message "saving-bot not restored by resurrect. Starting fresh..."
$projectDir = "D:\My Projects\Saving"
$startOutput = & $pm2Cmd start (Join-Path $projectDir "index.js") --name "saving-bot" --cwd $projectDir 2>&1
Log-Message "PM2 start output: $startOutput"

Start-Sleep -Seconds 2
$activePid = Is-SavingBotRunning
if ($activePid -gt 0) {
    Log-Message "saving-bot started successfully (PID: $activePid). Saving PM2 dump..."
    & $pm2Cmd save 2>&1 | Out-Null
} else {
    Log-Message "Warning: saving-bot did not report running PID after start. Please check PM2 logs."
}

Log-Message "Auto-start script completed."

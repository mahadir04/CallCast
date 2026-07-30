# CallCast - Register PM2 as a Windows Startup Task
# Run this script ONCE from an Administrator PowerShell
# It creates a Scheduled Task that restores PM2 (and CallCast) on every login

$TaskName = "CallCast-PM2-Startup"
$PM2Path  = (Get-Command pm2 -ErrorAction SilentlyContinue).Source

if (-not $PM2Path) {
    Write-Host "[ERROR] pm2 not found in PATH. Run: npm install -g pm2 first." -ForegroundColor Red
    exit 1
}

# First, save the current PM2 process list so it can be restored
Write-Host "[1/3] Saving current PM2 process list..." -ForegroundColor Cyan
& pm2 save --force

# Remove old task if it exists
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Create the action: run "pm2 resurrect" at login to restore saved process list
$Action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c pm2 resurrect"
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$Principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Highest

Write-Host "[2/3] Registering Windows Scheduled Task: $TaskName ..." -ForegroundColor Cyan
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Force | Out-Null

Write-Host "[3/3] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "====================================================" -ForegroundColor Yellow
Write-Host "  CallCast is now registered as a Windows Startup Task" -ForegroundColor Yellow
Write-Host "====================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Every time you log in to Windows, PM2 will" -ForegroundColor White
Write-Host "  automatically restore CallCast on port 5000." -ForegroundColor White
Write-Host ""
Write-Host "  To verify: Get-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Gray
Write-Host ""

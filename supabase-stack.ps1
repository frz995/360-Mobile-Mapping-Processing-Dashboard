param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action = "status"
)

$projectDir = "$env:USERPROFILE\supabase\docker"
$stackName = "supabase"

function Show-Status {
    $running = docker ps --filter "name=supabase" --format "{{.Names}}" 2>$null
    if ($running) {
        Write-Host "Supabase stack: RUNNING ($(@($running).Count) containers)" -ForegroundColor Green
        docker ps --filter "name=supabase" --format "table {{.Names}}`t{{.Status}}" 2>$null
    } else {
        Write-Host "Supabase stack: STOPPED" -ForegroundColor Yellow
    }
}

switch ($Action) {
    "start" {
        Write-Host "Starting Supabase stack..." -ForegroundColor Cyan
        Push-Location $projectDir
        & "docker" compose --project-name $stackName up -d
        if ($?) { Write-Host "Supabase stack started." -ForegroundColor Green }
        Pop-Location
    }
    "stop" {
        Write-Host "Stopping Supabase stack..." -ForegroundColor Cyan
        Push-Location $projectDir
        & "docker" compose --project-name $stackName down
        if ($?) { Write-Host "Supabase stack stopped. WiFi pressure reduced." -ForegroundColor Green }
        Pop-Location
    }
    "restart" {
        Write-Host "Restarting Supabase stack..." -ForegroundColor Cyan
        Push-Location $projectDir
        & "docker" compose --project-name $stackName down
        & "docker" compose --project-name $stackName up -d
        if ($?) { Write-Host "Supabase stack restarted." -ForegroundColor Green }
        Pop-Location
    }
    "status" {
        Show-Status
    }
}
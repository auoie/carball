# Run once per Windows session in an ADMIN PowerShell: attaches the 18 TB data drives to WSL (bare, so LVM sees them)
# and mounts them inside the Arch WSL distro at the same paths as under Arch (/mnt/primary, /mnt/other).
# The Arch NVMe is not attached: Windows boots through the EFI partition on it, so Windows keeps that disk in use.
# The repository lives on the data drive (/mnt/primary/home/arch/rocket-league-reverse-engineering), for both systems.
#
#   powershell -ExecutionPolicy Bypass -File attach.ps1
#
# Arch must have been shut down fully (not suspended or hibernated): the data drives are mounted read-write.
#Requires -RunAsAdministrator
param([string]$Distro = "archlinux")

$windowsDisk = (Get-Partition -DriveLetter C).DiskNumber
$attached = 0
foreach ($d in Get-Disk) {
    if ($d.Number -eq $windowsDisk) { continue }
    $gib = [math]::Round($d.Size / 1GB)
    # The two 18 TB data drives (~18630 GiB)
    if ($gib -gt 18000) {
        Write-Host "attaching disk $($d.Number): $($d.FriendlyName), $gib GiB"
        wsl --mount "\\.\PHYSICALDRIVE$($d.Number)" --bare
        $attached++
    }
}
if ($attached -eq 0) { Write-Host "no matching disks found (Get-Disk lists them)"; exit 1 }

# mount-arch.sh sits next to this script (the Arch disk isn't readable before it's mounted); fed to bash as root
$mount = Get-Content -Raw (Join-Path $PSScriptRoot "mount-arch.sh")
# (the trailing exit stops bash before the CRLF PowerShell appends when piping to a native command)
(($mount -replace "`r", "") + "exit`n") | wsl -d $Distro -u root -- bash -s
if ($LASTEXITCODE -ne 0) { Write-Host "mounting inside WSL failed (see above)"; exit 1 }
Write-Host "done: in WSL (su - arch), cd /mnt/primary/home/arch/rocket-league-reverse-engineering and run claude"

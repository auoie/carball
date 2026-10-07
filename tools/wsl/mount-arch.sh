#!/bin/bash
# Inside the Arch WSL distro, as root (attach.ps1 runs it): activates the LVM volume groups on the attached disks and
# mounts them where Arch has them, so every path is the same as under Arch: /home/arch (repository, build directories,
# cargo, Claude Code's settings and memory) and /mnt/primary (replays, the game copy, local-only material).
# attach.ps1 feeds this file to bash in WSL (it can't be read from the Arch disk before that disk is mounted).
set -euo pipefail

vgchange -ay >/dev/null
for lv in /dev/primary_nvme/root /dev/primary_drive/primary_partition; do
	[ -e "$lv" ] || { echo "missing $lv (were the disks attached with attach.ps1?)"; exit 1; }
done

mkdir -p /mnt/arch /mnt/primary
mountpoint -q /mnt/arch || mount /dev/primary_nvme/root /mnt/arch
mountpoint -q /mnt/primary || mount /dev/primary_drive/primary_partition /mnt/primary
if [ -e /dev/other_drive/other_partition ]; then
	mkdir -p /mnt/other
	mountpoint -q /mnt/other || mount /dev/other_drive/other_partition /mnt/other
fi

# The same user as under Arch (uid 1000), with Arch's home on top of the distro's
id arch >/dev/null 2>&1 || useradd -u 1000 -m -G wheel arch
mountpoint -q /home/arch || mount --bind /mnt/arch/home/arch /home/arch
echo "mounted: /home/arch, /mnt/primary$( [ -d /mnt/other ] && echo ', /mnt/other')"

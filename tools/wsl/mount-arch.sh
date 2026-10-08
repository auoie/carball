#!/bin/bash
# Inside the Arch WSL distro, as root (attach.ps1 runs it): activates the LVM volume groups on the attached data drives
# and mounts them where Arch has them: /mnt/primary (the game copy, local-only material, the handoff copy of Claude's
# memory, and the repository, used from both systems) and /mnt/other. The Arch NVMe stays with Windows (its EFI
# partition boots Windows).
# attach.ps1 feeds this file to bash in WSL (it can't be read from the Arch disk before that disk is mounted).
set -euo pipefail

vgchange -ay >/dev/null
[ -e /dev/primary_drive/primary_partition ] || { echo "missing /dev/primary_drive/primary_partition (were the drives attached with attach.ps1?)"; exit 1; }

mkdir -p /mnt/primary
mountpoint -q /mnt/primary || mount /dev/primary_drive/primary_partition /mnt/primary
if [ -e /dev/other_drive/other_partition ]; then
	mkdir -p /mnt/other
	mountpoint -q /mnt/other || mount /dev/other_drive/other_partition /mnt/other
fi

# The same user as under Arch (uid 1000, so files on the data drives have the right owner)
id arch >/dev/null 2>&1 || useradd -u 1000 -m -G wheel arch
echo "mounted: /mnt/primary$( [ -d /mnt/other ] && echo ', /mnt/other')"

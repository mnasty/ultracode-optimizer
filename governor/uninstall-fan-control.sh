#!/bin/sh
# Remove the uc-optimizer fan helper and give the fans back to macOS:  sudo sh uninstall-fan-control.sh
set -eu
[ "$(id -u)" = 0 ] || { echo "run it with sudo: sudo sh $0"; exit 1; }
launchctl bootout system/com.uc-optimizer.fand 2>/dev/null || true
[ -x /usr/local/libexec/uc-ucsmc ] && /usr/local/libexec/uc-ucsmc fan auto || true
rm -f /Library/LaunchDaemons/com.uc-optimizer.fand.plist /usr/local/libexec/uc-ucsmc
echo "removed; fans are automatic"

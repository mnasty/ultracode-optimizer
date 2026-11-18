#!/bin/sh
# Install the uc-optimizer fan helper (macOS, once, with sudo):  sudo sh install-fan-control.sh
#
# What it installs:
#   /usr/local/libexec/uc-ucsmc                        the native SMC tool, built from native/ucsmc.c, owned by root
#   /Library/LaunchDaemons/com.uc-optimizer.fand.plist a root daemon: `uc-ucsmc fand <your ~/.uc-optimizer/fan-request.json>`
#
# How it behaves: every second it takes the higher of the governor's request {"frac": 0..1 | null, "t": ms} (sent while
# uc-optimizer work runs) and its own heat curve (always on: fan minimum at 50 C, full speed at 80 C, raised by macOS thermal
# pressure), and forces the fans to that share of their min..max range. After 30 cool seconds it gives them back to macOS.
# It shares the fans: a fan another controller (e.g. Macs Fan Control) forces faster is left alone, and it hands back only the
# fans it forced itself, so it never takes cooling away. Stopping the daemon (uninstall, or launchctl bootout) hands its fans back.
set -eu
[ "$(uname)" = Darwin ] || { echo "macOS only"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "run it with sudo: sudo sh $0"; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
USER_NAME=${SUDO_USER:-}
[ -n "$USER_NAME" ] || { echo "run it through sudo from your own account (SUDO_USER is empty)"; exit 1; }
USER_HOME=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory | awk '{print $2}')
REQ="$USER_HOME/.uc-optimizer/fan-request.json"
BIN=/usr/local/libexec/uc-ucsmc
PLIST=/Library/LaunchDaemons/com.uc-optimizer.fand.plist


install -d -o root -g wheel -m 755 /usr/local/libexec
clang -O2 -o "$BIN" "$HERE/native/ucsmc.c" -framework IOKit -framework CoreFoundation
chown root:wheel "$BIN"; chmod 755 "$BIN"
sudo -u "$USER_NAME" mkdir -p "$USER_HOME/.uc-optimizer"

# prove a forced write works on this Mac while no helper is running, then hand the fans back. Skipped while another
# controller holds the fans (it would lower a max set there): the helper's log shows its first write instead.
launchctl bootout system/com.uc-optimizer.fand 2>/dev/null || true
SUMMARY='import json,sys; d=json.load(sys.stdin); print(", ".join("fan%d %d rpm (target %d, mode %d)" % (f["id"], f["rpm"], f["target"], f["mode"]) for f in d["fans"]))'
if "$BIN" sense | /usr/bin/python3 -c 'import json,sys; sys.exit(0 if any(f["mode"] == 1 for f in json.load(sys.stdin)["fans"]) else 1)'; then
  echo "fans are forced by another controller right now ($("$BIN" sense | /usr/bin/python3 -c "$SUMMARY")): write proof skipped, left as they are"
elif "$BIN" fan frac 0.3; then
  sleep 4
  echo "fan write: $("$BIN" sense | /usr/bin/python3 -c "$SUMMARY")"
  "$BIN" fan auto && echo "fans back to automatic"
else echo "fan write FAILED (see: $BIN --dry fan frac 0.3)"; fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.uc-optimizer.fand</string>
  <key>ProgramArguments</key><array><string>$BIN</string><string>fand</string><string>$REQ</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/var/log/uc-fand.log</string>
</dict></plist>
EOF
chown root:wheel "$PLIST"; chmod 644 "$PLIST"
launchctl bootstrap system "$PLIST"
echo "installed: $PLIST (log: /var/log/uc-fand.log). uninstall: sudo sh $HERE/uninstall-fan-control.sh"

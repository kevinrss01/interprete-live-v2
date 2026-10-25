#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: bash scripts/verify-macos-dmg.sh <file.dmg>" >&2
  exit 1
fi

# Check the delivered bundle, not just the executable before packaging. A linker
# signature can be valid for the Mach-O while the .app has no sealed resources.
hdiutil verify "$1"
mountpoint=$(mktemp -d "${TMPDIR:-/tmp}/interprete-dmg-check.XXXXXX")
mounted=false
cleanup() {
  result=$?
  trap - EXIT
  if [ "$mounted" = true ]; then
    if ! hdiutil detach "$mountpoint"; then
      exit 1
    fi
  fi
  rmdir "$mountpoint"
  exit "$result"
}
trap cleanup EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$mountpoint" "$1"
mounted=true
app="$mountpoint/Interprete.app"
codesign --verify --deep --strict --verbose=2 "$app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = "ai.impulselab.interprete"
entitlements=$(codesign --display --entitlements - --xml "$app")
test "$(printf '%s' "$entitlements" | plutil -extract 'com\.apple\.security\.device\.audio-input' raw -o - -)" = true
echo "Packaged app signature, bundle identity and microphone entitlement verified."

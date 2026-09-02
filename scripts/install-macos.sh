#!/bin/sh
# Install the latest Open Pages release into /Applications.
#
# Downloading with curl instead of a browser means macOS never attaches
# com.apple.quarantine, so the ad-hoc signed bundle launches without the
# "damaged, move to trash" Gatekeeper dialog.
#
#   curl -fsSL https://raw.githubusercontent.com/cocofhu/open-pages/main/scripts/install-macos.sh | sh

set -eu

REPO=${OPEN_PAGES_REPO:-cocofhu/open-pages}
APP_NAME="Open Pages.app"
INSTALL_DIR=${OPEN_PAGES_INSTALL_DIR:-/Applications}

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer only supports macOS." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ASSET_SUFFIX="aarch64.dmg" ;;
  x86_64) ASSET_SUFFIX="x64.dmg" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

echo "Resolving latest release of $REPO ..."
DMG_URL=$(
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/.*"browser_download_url": *"\([^"]*\)".*/\1/p' |
    grep -- "$ASSET_SUFFIX" |
    head -n 1
)

if [ -z "$DMG_URL" ]; then
  echo "No *_$ASSET_SUFFIX asset found in the latest release of $REPO." >&2
  exit 1
fi

WORK_DIR=$(mktemp -d)
MOUNT_POINT="$WORK_DIR/mnt"
cleanup() {
  if [ -d "$MOUNT_POINT" ]; then
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

echo "Downloading $(basename "$DMG_URL") ..."
curl -fSL --progress-bar "$DMG_URL" -o "$WORK_DIR/open-pages.dmg"

echo "Mounting disk image ..."
mkdir -p "$MOUNT_POINT"
hdiutil attach "$WORK_DIR/open-pages.dmg" -mountpoint "$MOUNT_POINT" -nobrowse -quiet

if [ ! -d "$MOUNT_POINT/$APP_NAME" ]; then
  echo "Could not find '$APP_NAME' inside the disk image." >&2
  exit 1
fi

if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
  echo "Removing previous installation ..."
  rm -rf "$INSTALL_DIR/$APP_NAME"
fi

echo "Installing to $INSTALL_DIR ..."
cp -R "$MOUNT_POINT/$APP_NAME" "$INSTALL_DIR/"

# Belt and braces: strip quarantine in case the disk image itself carried it.
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

echo "Done. Launch it with: open -a \"Open Pages\""

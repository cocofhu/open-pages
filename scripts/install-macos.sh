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

# api.github.com allows only 60 unauthenticated requests per hour per IP, and a
# throttled installer must not look like a missing release. Resolve the tag and
# its assets from github.com, which is not rate limited, and keep the API as a
# fallback for the rare case the release pages change shape.
DMG_URL=""
TAG_URL=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" || true)
TAG=${TAG_URL##*/}

if [ -n "$TAG" ] && [ "$TAG" != "releases" ] && [ "$TAG" != "latest" ]; then
  DMG_URL=$(
    curl -fsSL "https://github.com/$REPO/releases/expanded_assets/$TAG" |
      tr '"' '\n' |
      grep '/releases/download/' |
      grep -- "$ASSET_SUFFIX" |
      head -n 1
  )
  case "$DMG_URL" in
    /*) DMG_URL="https://github.com$DMG_URL" ;;
  esac
fi

if [ -z "$DMG_URL" ]; then
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    RELEASE_JSON=$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$REPO/releases/latest" || true)
  else
    RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" || true)
  fi
  DMG_URL=$(
    printf '%s' "$RELEASE_JSON" |
      sed -n 's/.*"browser_download_url": *"\([^"]*\)".*/\1/p' |
      grep -- "$ASSET_SUFFIX" |
      head -n 1
  )
fi

if [ -z "$DMG_URL" ]; then
  echo "Could not resolve a *_$ASSET_SUFFIX asset from the latest release of $REPO." >&2
  echo "Download it manually from https://github.com/$REPO/releases/latest" >&2
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

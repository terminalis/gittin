#!/usr/bin/env bash
# Writes flatpak/node-sources.json: every npm package in package-lock.json as a Flatpak source, so the
# Flatpak build (which has no network) can build the desktop page. Gittin's addition beside app-starter's
# tools/flatpak-cargo-sources.sh, using Flathub's flatpak-node-generator from the same pinned commit,
# installed into a throwaway folder. Needs python3 with pip. Run from anywhere; CI and local builds both use it.
set -euo pipefail
cd "$(dirname "$0")/.."

commit=74697c75b630d7330e77250fc13cb5ea688d9479
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://github.com/flatpak/flatpak-builder-tools/archive/$commit.tar.gz" | tar -xz -C "$tmp" --strip-components=1
python3 -m pip install --quiet --disable-pip-version-check --root-user-action=ignore --target "$tmp/deps" "$tmp/node"
PYTHONPATH="$tmp/deps${PYTHONPATH:+:$PYTHONPATH}" \
  python3 -m flatpak_node_generator npm package-lock.json -o flatpak/node-sources.json

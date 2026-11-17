#!/bin/zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
channel="${1:-stable}"
case "${channel}" in
  stable)
    app_name="Alfred"
    bundle_identifier="dev.patryk.alfred.desktop"
    desktop_port="4310"
    user_data_dir=""
    ;;
  preview)
    app_name="Alfred Preview"
    bundle_identifier="dev.patryk.alfred.desktop.preview"
    user_data_dir="${HOME}/Library/Application Support/Alfred Preview"
    ;;
  *)
    echo "Usage: $0 [stable|preview]" >&2
    exit 1
    ;;
esac

app_dir="${HOME}/Applications/${app_name}.app"
contents_dir="${app_dir}/Contents"
macos_dir="${contents_dir}/MacOS"
resources_dir="${contents_dir}/Resources"
icon_name="alfred-icon.icns"
icon_source="${repo_root}/apps/desktop/assets/${icon_name}"

pnpm_bin="${PNPM_BIN:-/opt/homebrew/bin/pnpm}"

if [[ ! -f "${icon_source}" ]]; then
  echo "Alfred icon not found at ${icon_source}." >&2
  exit 1
fi

if [[ "${channel}" == "stable" && ! -x "${pnpm_bin}" ]]; then
  echo "pnpm not found at ${pnpm_bin}. Set PNPM_BIN to the pnpm executable path." >&2
  exit 1
fi

rm -rf "${app_dir}"
mkdir -p "${macos_dir}" "${resources_dir}"
cp "${icon_source}" "${resources_dir}/${icon_name}"

cat > "${contents_dir}/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${app_name}</string>
  <key>CFBundleExecutable</key>
  <string>Alfred</string>
  <key>CFBundleIdentifier</key>
  <string>${bundle_identifier}</string>
  <key>CFBundleIconFile</key>
  <string>${icon_name}</string>
  <key>CFBundleName</key>
  <string>${app_name}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.0.0</string>
  <key>CFBundleVersion</key>
  <string>0</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

if [[ "${channel}" == "preview" ]]; then
  # Preview runs the release scripts/deploy-preview.mjs built, never the source a worktree is editing.
  deploy_root="${HOME}/Library/Application Support/Alfred Deploy"
  cat > "${macos_dir}/Alfred" <<LAUNCHER
#!/bin/zsh
set -euo pipefail

export PATH="${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
deploy_root="${deploy_root}"
if [[ ! -e "\${deploy_root}/current" ]]; then
  message="Alfred Preview has no release yet. Run pnpm deploy:preview in ${repo_root}."
  echo "\${message}" >&2
  # Started from the Dock nobody reads stderr.
  if [[ ! -t 2 && -z "\${ALFRED_LAUNCHER_NO_ALERT:-}" ]]; then
    osascript -e "display alert \"Alfred Preview\" message \"\${message}\"" >/dev/null 2>&1 || true
  fi
  exit 1
fi
release="\$(realpath "\${deploy_root}/current")"
electron="\$(node -p 'require(process.argv[1]).electron' "\${release}/release.json")"
export ALFRED_DEPLOY_ROOT="\${deploy_root}"
export ALFRED_DEPLOY_CHECKOUT="${repo_root}"
export ALFRED_DESKTOP_WORKSPACE_CWD="${repo_root}"
cd "\${deploy_root}"
exec "\${electron}" "\${release}/apps/desktop" "--user-data-dir=${user_data_dir}"
LAUNCHER
else
  cat > "${macos_dir}/Alfred" <<LAUNCHER
#!/bin/zsh
set -euo pipefail

export PATH="${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DESKTOP_PORT="${desktop_port}"
cd "${repo_root}"
exec "${pnpm_bin}" --filter @alfred/desktop dev:electron
LAUNCHER
fi

chmod +x "${macos_dir}/Alfred"

echo "Installed ${app_dir}"

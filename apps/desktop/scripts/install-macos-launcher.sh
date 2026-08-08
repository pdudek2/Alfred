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
    desktop_port="4311"
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

if [[ ! -x "${pnpm_bin}" ]]; then
  echo "pnpm not found at ${pnpm_bin}. Set PNPM_BIN to the pnpm executable path." >&2
  exit 1
fi

if [[ -n "${user_data_dir}" ]]; then
  user_data_export="export ALFRED_DESKTOP_USER_DATA_DIR=\"${user_data_dir}\""
else
  user_data_export=""
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

cat > "${macos_dir}/Alfred" <<LAUNCHER
#!/bin/zsh
set -euo pipefail

export PATH="${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DESKTOP_PORT="${desktop_port}"
${user_data_export}
cd "${repo_root}"
exec "${pnpm_bin}" --filter @alfred/desktop dev:electron
LAUNCHER

chmod +x "${macos_dir}/Alfred"

echo "Installed ${app_dir}"

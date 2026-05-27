#!/bin/zsh
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
app_dir="${HOME}/Applications/Alfred.app"
contents_dir="${app_dir}/Contents"
macos_dir="${contents_dir}/MacOS"

pnpm_bin="${PNPM_BIN:-/opt/homebrew/bin/pnpm}"

if [[ ! -x "${pnpm_bin}" ]]; then
  echo "pnpm not found at ${pnpm_bin}. Set PNPM_BIN to the pnpm executable path." >&2
  exit 1
fi

rm -rf "${app_dir}"
mkdir -p "${macos_dir}"

cat > "${contents_dir}/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Alfred</string>
  <key>CFBundleExecutable</key>
  <string>Alfred</string>
  <key>CFBundleIdentifier</key>
  <string>dev.patryk.alfred.desktop</string>
  <key>CFBundleName</key>
  <string>Alfred</string>
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
cd "${repo_root}"
exec "${pnpm_bin}" --filter @alfred/desktop dev:electron
LAUNCHER

chmod +x "${macos_dir}/Alfred"

echo "Installed ${app_dir}"

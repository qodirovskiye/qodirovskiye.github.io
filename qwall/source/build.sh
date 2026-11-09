#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build/Qwall.app/Contents/MacOS build/Qwall.app/Contents/Resources/web downloads
cp native/Info.plist build/Qwall.app/Contents/Info.plist
cp web/*.html web/*.js web/*.css build/Qwall.app/Contents/Resources/web/
if [ -d web/fonts ]; then cp -R web/fonts build/Qwall.app/Contents/Resources/web/; fi
cp native/native.html build/Qwall.app/Contents/Resources/web/native.html
SWIFTC_PATH=/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc
if [ ! -x "$SWIFTC_PATH" ]; then SWIFTC_PATH=$(xcrun --find swiftc); fi
QWALL_SDK=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk
if [ ! -d "$QWALL_SDK" ]; then QWALL_SDK=$(xcrun --show-sdk-path); fi
"$SWIFTC_PATH" -O -sdk "$QWALL_SDK" -module-cache-path /private/tmp/qwall-swift-cache native/create-icon.swift -o build/create-icon
build/create-icon build/Qwall.iconset
if ! iconutil -c icns build/Qwall.iconset -o build/Qwall.app/Contents/Resources/Qwall.icns; then
    # Some build environments block iconutil's temporary-file service.
    python3 - build/Qwall.iconset/icon_512x512@2x.png build/Qwall.app/Contents/Resources/Qwall.icns <<'PYICON'
import pathlib, struct, sys
image = pathlib.Path(sys.argv[1]).read_bytes()
pathlib.Path(sys.argv[2]).write_bytes(struct.pack('>4sI4sI', b'icns', len(image) + 16, b'ic10', len(image) + 8) + image)
PYICON
fi
"$SWIFTC_PATH" -O -sdk "$QWALL_SDK" -swift-version 5 -target arm64-apple-macosx15.0 -module-cache-path /private/tmp/qwall-swift-cache -framework AppKit -framework AVFoundation -framework WebKit -framework IOKit native/main.swift native/SystemWallpaper.swift native/LidAngle.swift -o build/Qwall.app/Contents/MacOS/Qwall
codesign --force --sign - build/Qwall.app
ditto -c -k --sequesterRsrc --keepParent build/Qwall.app downloads/Qwall.zip
echo 'Built build/Qwall.app and downloads/Qwall.zip'

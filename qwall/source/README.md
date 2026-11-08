# Qwall

An independent wallpaper gallery and native Mac companion. The website runs on GitHub Pages at `https://qodirovskiye.github.io/qwall/`.

## Use

1. Open the website, download **Qwall for Mac**, and unzip it.
2. Open `Qwall.app`. It lives in the menu bar and includes the gallery offline.
3. Choose a scene and click **Set wallpaper**. Website requests open the companion through the `qwall:` URL scheme.
4. To use your own MP4/MOV/M4V, import it in the browser for preview, then select the original file when the companion asks. Videos remain on your Mac.

The download is built for Apple silicon and macOS 15 or later. It is locally signed, not Apple notarized; a downloaded copy may require the owner's approval in macOS Privacy & Security before it opens. No trial, license check, telemetry, account, or subscription.

## Implemented

- Eight original procedural animations: aurora, cosmos, ocean, sunset, ember, rain, dunes, forest.
- Responsive gallery, categories, search, favorites, previews, pause/resume.
- Local browser video library with IndexedDB persistence and removal.
- Native desktop scene/video playback behind icons on one or all connected displays.
- Native menu controls, battery/low-power/display-sleep pauses, and 15-minute scene rotation.
- Experimental Lock Screen and screen saver registration on macOS 26 and 27, using new Qwall entries in the per-user aerial catalog.
- Exact before/after backups for system wallpaper changes; restore avoids overwriting subsequent external edits.

## Practical limits

The browser cannot change system wallpaper by itself. Install and open the companion first. Browser previews do not imply that macOS applied the wallpaper.

Lock Screen integration uses undocumented macOS catalog formats. Catalog transforms and HEVC Main10 video conversion were tested, but actual Lock Screen playback and repeated lock/unlock cycles have **not been visually verified**. Short clips may hold their last frame. FileVault's pre-login screen is outside the signed-in user session. This is not full MacWall feature parity: there is no Music Sync, Bend lid effect, or MacWall catalog. Qwall does not bypass MacWall's trial or use its media or executable code.

## Build

Install Xcode or matching Command Line Tools, then run `bash build.sh` from this folder. Output: `build/Qwall.app` and `downloads/Qwall.zip`. No third-party dependencies are required. The script builds an Apple silicon app.

Run the built executable with `--smoke-test --no-gallery` for the desktop render check or `--export-test --no-gallery` for the six-second scene export check. These checks need a logged-in graphical Mac session and access to macOS video services. Pure wallpaper-selection fixtures are in `tests/`.

All generated scenes and Qwall source are original. Architecture references and runtime limitations are documented in `research/system-wallpaper.md`; local REA metadata is kept separately and is not published.

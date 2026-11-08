# Qwall system wallpaper integration

Status: implemented and compiled; catalog/index transforms and HEVC conversion verified. Actual Lock Screen playback is experimental and has not been visually verified by this workstream.

## Observations on this Mac

- macOS reports 27.0.1; full Xcode macOS 27 SDK is available.
- Apple's per-user store is `~/Library/Application Support/com.apple.wallpaper/Store/Index.plist`.
- The active `AllSpacesAndDisplays` selection has separate `Desktop` and `Idle` surfaces, both referring to provider `com.macwall.ogapps.extension` with configuration bytes `macwall`.
- Apple's own existing selections use provider `com.apple.wallpaper.choice.aerials` and nested binary plist configuration with an `assetID` string.
- The aerial catalog and downloaded videos live under `~/Library/Application Support/com.apple.wallpaper/aerials/`.
- No installed application code, catalog wallpaper video, Apple movie, or MacWall file was copied into Qwall.

## Design choice

Qwall's ordinary desktop playback belongs in its companion process. Experimental system playback adds a new, randomly generated UUID video and thumbnail, plus a Qwall category and asset in Apple's existing catalog. Original catalog assets and categories are retained. Existing Apple and MacWall media are never overwritten.

The selection transformer preserves the store's root and per-display/per-Space dictionaries. For `lock` it changes `Idle` and preserves `Desktop`; for `desktop` it changes `Desktop` and preserves `Idle`; for `both` it uses the system's `linked` structure at each existing selection node. These are undocumented implementation details, and Apple may change them.

Before a change, the app saves exact before/after catalog and selection files in `~/Library/Application Support/Qwall/SystemWallpaper/<transaction UUID>/`. Consecutive Qwall changes preserve the original baseline if the prior selection is still unchanged. Restore refuses to overwrite subsequent semantic selection edits or catalog edits; access timestamps alone are ignored for this comparison.

The video is converted to HEVC Main10 with a 10-bit decoded input, frequent keyframes, and frame reordering disabled. Conversion runs off the main thread. A process restart is restricted to the current user's `WallpaperAgent` and `WallpaperAerialsExtension`.

`nudgeIfActive()` only restarts system rendering if the current index still contains Qwall's selected asset. The companion can call it on lock notifications. A short custom clip may freeze at its end in Apple's player; repeated playback across lock cycles remains an important visual QA check. This implementation does not claim the private extension-based gapless playback used by MacWall.

## Validation

- `swiftc` compile passed with explicit full Xcode SDK and macOS 15 target. It emits deprecation warnings for synchronous AVAsset property access, which runs on a detached background task.
- Pure transforms were tested against read-only copies of the current actual catalog and index: three destinations, preservation of the opposing surface, original asset equality, percent-encoded file URLs, invalid target rejection, and unchanged source files all passed.
- A generated H264 fixture was converted to HEVC and all 15 output frames decoded as 10-bit video successfully. No system settings were touched. The restricted executor cannot reach macOS codecs (`AVFoundationErrorDomain -11834`); the same check passed when run with access to macOS video services.
- No real wallpaper apply, restore, lock, or unlock was performed by this workstream.

## Sources consulted

- [Phosphene architecture reference](https://github.com/kageroumado/phosphene/blob/main/REFERENCE.md): explains the substantially larger private extension/XPC/sample-buffer route. Qwall does not embed that project.
- [CaveWall system wallpaper internals](https://github.com/Vahsir7/cavewall#system-wallpaper-internals): documents custom catalog registration, HEVC Main10, the linked selection structure, and lock-event re-rendering. Its MIT source was inspected for the selection structure; Qwall's implementation was written separately.
- [Phonto live Lock Screen installer](https://github.com/museslabs/phonto/blob/main/src/macos_live_lockscreen/install.rs): documents catalog validation requirements and the importance of valid category/subcategory representatives.
- [Phonto transcoder](https://github.com/museslabs/phonto/blob/main/src/macos_live_lockscreen/transcode.rs): reports a two-temporal-sublayer strategy for repeated lock cycles. Qwall currently uses AVAssetWriter Main10 and a rendering nudge instead; it does not claim identical codec behavior.
- [Tahoe live Lock Screen project](https://github.com/AzhadArshad/tahoe-live-lockscreen): corroborates custom-file loop and lock-cycle limitations. Qwall does not replace one of Apple's downloaded movies as that script does.

These third-party descriptions are corroborating implementation references, not Apple API guarantees or proof of Qwall's runtime playback.

# MacWall inspection and Qwall validation

REA identified `/Applications/MacWall.app` as a universal native Mach-O application. Info.plist reports MacWall 4.1.0, bundle identifier `com.macwall.ogapps`, and the `macwall:` URL scheme. The executable SHA-256 was `dcca6499d10962939d587a4eb5dc31e225baaf11cda4cab0e69b06d59aa36917`.

Actual REA metadata evidence: `ev_28d1f983bed17624c796372f2cbdf12e8819a8c256701a0eed1741248a13616f` (plist) and `ev_4b3f52b3ddb00f2f946bffb7a64c8b559cfd8d6fc8298136e5bdab797d61c1cd` (Mach-O). Imports and exports are incomplete for stripped/toolchain-hidden symbols. These static observations do not establish runtime behavior.

Native function analysis returned `provider_unavailable`: no Hopper, Ghidra, IDA, or Kuna backend is configured. No source code was recovered. No configuration, analysis engine, trial limit, license check, MacWall binary, or MacWall wallpaper was modified. Qwall is an independent implementation, not a decompiled port.

## Verified

- Frontend JavaScript syntax checks passed.
- All eight procedural renderers exercised at multiple time values.
- Browser visual preview checked at desktop size; search `ocean` finds Blue hour; favorite persists across reload; preview pause toggles correctly.
- Qwall's signed native bundle compiled with the macOS SDK.
- Actual native desktop WebKit smoke test returned renderer ready and canvas width 2940 on this Mac.
- Actual scene-to-movie export produced a six-second playable video successfully.
- Pure target transforms preserve the opposing wallpaper surface, original catalog entries, unrelated metadata, and escaped file URLs; invalid destinations are rejected.
- Generated video converted to HEVC Main10 and all output frames decoded as 10-bit video by the macOS encoder test.

## Not verified

Actual Lock Screen rendering, repeated lock/unlock cycles, linked system playback, restore after a real system setting mutation, browser local-video persistence after storage eviction, Intel execution, fullscreen-app occlusion pause, launch at login, Music Sync, and lid-motion effects. The last four are not implemented in this version.

See `system-wallpaper.md` for the experimental system integration and sources.

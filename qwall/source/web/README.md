# Qwall web interface

A dependency-free wallpaper interface for static hosting and the Qwall Mac companion. `index.html`, `style.css`, `app.js`, and `scenes.js` work without a build step. Font assets and their SIL Open Font License notices live in `fonts/`.

## Interface

- Compact Discover / Library / Favorites navigation, search across scene IDs and descriptions, category filters, sorting, and comfortable or compact gallery density.
- Eight original deterministic canvas scenes. Only the hovered card animates; offscreen and background-tab activity pauses. Motion preferences respect the system or an explicit reduced-motion choice.
- Full-window detail with card-to-detail opening/closing animation, floating glass controls, destinations, favorite, related scenes, playback speed, video audio, and fullscreen where supported.
- Original scenes can be shared by URL or saved as a clearly labeled PNG preview. Imported videos can be downloaded unchanged.
- Browser video imports support file picking or drag-and-drop, visible progress, metadata, IndexedDB persistence, and deletion without changing the original file. Videos are never uploaded.
- Settings persist in `qwall-preferences`; favorites remain in `qwall-favorites`. Existing imports remain in IndexedDB database `qwall-library`, version 1, object store `videos`.
- Companion downloads fetch `downloads/Qwall.zip` and produce a ZIP download. Failures are visible. The installed app displays an installed state.

## Native integration

`qwall://apply?scene=aurora&target=desktop` applies a built-in scene. Destinations are `desktop`, `lock`, or `both`. Browser imports open `qwall://import?target=desktop` so the companion can ask for the original file. Lock Screen choices show experimental, unverified macOS 26/27 support contextually.

The companion injects `window.QWALL_IS_NATIVE = true` before page scripts. Only then are native desktop controls and the optional private `window.QWALL_LOCAL_LIBRARY` accepted. Native library entries are `{id,name,category,mood,description,resolution,duration,videoURL,nativeId}`. They appear in Library by default, play from the local `videoURL`, and apply directly through `qwall://apply-local?id=UUID&target=desktop`. Private entries have no share or destructive-delete controls. They are never part of hosted source files or website requests.

Native settings request `qwall://status` and subscribe to `qwall-native-status` CustomEvents. The `detail` object supplies `{paused,rotation,pauseOnBattery,muted,speed,scene,hasDesktop,displays,displayIndex,busy}`. Desktop controls send `qwall://control?action=...` using the agreed `pause`, `resume`, `next`, `stop`, `restore`, `battery`, `rotation`, `speed`, `mute`, and `display` commands. Browser preview speed and sound remain separate. The public website never claims to know the desktop's playback state.

## Renderer

`scenes.js` exposes `QwallScenes.data` and `QwallScenes.render(canvas, sceneId, timeSeconds)`. Set `canvas.dataset.renderWidth` and `canvas.dataset.renderHeight` for fixed-size frame output. Scene IDs remain `aurora`, `cosmos`, `ocean`, `sunset`, `ember`, `rain`, `dunes`, and `forest`.

# QMax

Free, private facial geometry exploration. A QOVES-inspired educational project with real on-device landmark detection, photo-based measurements, reports, and illustrative appearance previews.

## Run locally

Serve this directory over HTTP; opening index.html as a file will not load the worker and model correctly.

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173`. No package installation, build, API key, or backend is required. Use a current browser supporting WebAssembly, workers, OffscreenCanvas, and DecompressionStream.

## GitHub Pages

This build is prepared for the `qmax/` subdirectory of `qodirovskiye/qodirovskiye.github.io`, preserving the existing personal homepage. Its expected address is `https://qodirovskiye.github.io/qmax/`; treat it as live only after GitHub Pages deployment succeeds. All asset paths are relative, so the same directory also works in a separate project repository. The optional workflow under `.github/workflows/pages.yml` is for a standalone repository with GitHub Actions selected as its Pages source.

The repository contains only application code, a public sample portrait, and the bundled model/runtime. Never add visitor photos, personal reports, API credentials, or local browser data to GitHub. GitHub Pages is suitable here for a free educational project; it is not intended for commercial SaaS or payment collection.

## Features

- One-photo upload with permission and input checks; public sample portrait.
- Real Google MediaPipe landmark detection, running in a dedicated local worker.
- 22 explained photo measurements, pose/framing heuristics, and landmark overlays.
- Goal-specific styling/observation checklist, saved locally if requested.
- Illustrative local appearance studio: gentle geometric image adjustments, lip-color overlay, two glasses-frame overlays, original/preview comparison, labeled PNG export.
- Saved reports, checklist persistence, method-matched comparisons, JSON export, and browser print/PDF.
- Responsive layouts and keyboard-accessible report tabs.

See [RESEARCH.md](./RESEARCH.md) for sources, feature mapping, and boundaries. This is not QOVES's proprietary analysis, a medical service, an attractiveness predictor, or a validated demographic comparison tool. Preview controls manipulate image pixels; they do not use generative AI or predict cosmetic outcomes.

## Privacy

All photos are processed locally. The application only fetches its own static assets. Content Security Policy restricts network connections and scripts to the same origin. Optional saved reports include a photo preview and facial geometry in the current browser's IndexedDB. They do not sync. JSON exports omit the photo but still contain personal facial geometry.

## Files

- `app.js`: routing, photo intake, report UI and export.
- `analysis-worker.js`: local model initialization and detection.
- `measurements.js`: photo geometry, explanations, and exploration rules.
- `visualize.js`: local illustrative preview controls.
- `storage.js`: IndexedDB report storage.
- `vendor/` and `models/`: pinned MediaPipe runtime and Google model.

Runtime: `@mediapipe/tasks-vision@1.2.2`. Model: Google's Face Landmarker float16 version 1. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

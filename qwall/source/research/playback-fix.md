# Desktop playback freeze investigation

Scope: native desktop playback policy and its status display.

Reproduction before the fix: run the installed companion on this Mac with a selected 30.8-second MP4, no saved pauseOnBattery preference, and IOPS reporting Battery Power. Desktop window is visible, but the old default pauseOnBattery=true immediately pauses AVQueuePlayer. The gallery preview uses its own HTML video and continues playing.

The native regression check reproduced the failure before any policy change:
- initialRate = 0, finalRate = 0
- startSeconds = 0, endSeconds = 0
- loops = 0, battery = true, pauseOnBattery = true
- windowVisible = true

Fix: battery/Low Power pausing is opt-in (default false). Explicit saved preferences are preserved. The native status bridge reports effectivePaused and the actual pause reason; the settings view explains how to resume battery-paused motion instead of falsely labeling it Playing.

Regression: `Qwall --desktop-playback-test --quick --no-gallery` checks advancement; without --quick it also waits beyond the actual clip duration and requires AVPlayerLooper.loopCount > 0. It uses the real desktop surface and AVQueuePlayer, not the gallery preview. Final verification results follow below.

Final verification on this Mac (2026-11-08), using the selected Formula One Night Cockpit clip:
- Full desktop regression PASS, duration 30.8 seconds, battery = true, pauseOnBattery = false.
- initialRate = 1, finalRate = 1; startSeconds = 1.809159975, endSeconds = 4.79808009 after crossing the loop boundary.
- AVPlayerLooper.loopCount = 1; desktop window visible at level -2147483622.
- JavaScript syntax and SystemWallpaper fixtures pass; native release build succeeds.
- Restarted the fixed native app with the seven-item private library. The Lock Screen integration remains experimental; this test verifies desktop playback only.

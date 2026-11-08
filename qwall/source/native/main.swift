import AppKit
import AVFoundation
import WebKit
import UniformTypeIdentifiers
import IOKit.ps

enum QwallError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

struct WallpaperSelection: Codable {
    var scene: String?
    var file: String?
}

@MainActor final class DesktopSurface {
    let window: NSWindow
    var player: AVQueuePlayer?
    var looper: AVPlayerLooper?
    var web: WKWebView?

    init(screen: NSScreen, selection: WallpaperSelection) {
        window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.ignoresMouseEvents = true
        window.hidesOnDeactivate = false
        window.isReleasedWhenClosed = false
        window.backgroundColor = .black
        if let file = selection.file {
            let item = AVPlayerItem(url: URL(fileURLWithPath: file))
            let queue = AVQueuePlayer()
            queue.isMuted = true
            looper = AVPlayerLooper(player: queue, templateItem: item)
            player = queue
            let view = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
            view.wantsLayer = true
            let layer = AVPlayerLayer(player: queue)
            layer.videoGravity = .resizeAspectFill
            layer.frame = view.bounds
            view.layer = layer
            window.contentView = view
            queue.play()
        } else if let scene = selection.scene {
            let configuration = WKWebViewConfiguration()
            configuration.userContentController.addUserScript(WKUserScript(source: "window.QWALL_NATIVE={scene:'\(scene)',export:false};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            let view = WKWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: configuration)
            view.setValue(false, forKey: "drawsBackground")
            web = view
            window.contentView = view
            if let resource = Bundle.main.resourceURL?.appendingPathComponent("web/native.html") {
                view.loadFileURL(resource, allowingReadAccessTo: resource.deletingLastPathComponent())
            }
        }
        window.orderBack(nil)
    }

    func pause(_ paused: Bool) {
        if paused { player?.pause() } else { player?.play() }
        web?.evaluateJavaScript("window.setPaused(\(paused ? "true" : "false"))", completionHandler: nil)
    }

    func close() { player?.pause(); web?.stopLoading(); window.close() }
}

@MainActor final class SceneExporter: NSObject, WKNavigationDelegate {
    private var web: WKWebView?
    private var host: NSWindow?
    private var loaded: CheckedContinuation<Void, Error>?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded?.resume(); loaded = nil }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loaded?.resume(throwing: error); loaded = nil }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loaded?.resume(throwing: error); loaded = nil }

    func export(scene: String, to destination: URL, progress: (Double) -> Void) async throws {
        let width = 1280, height = 720, fps: Int32 = 24, frames = 144
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(WKUserScript(source: "window.QWALL_NATIVE={scene:'\(scene)',export:true};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: configuration)
        view.navigationDelegate = self
        web = view
        let window = NSWindow(contentRect: view.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.setFrameOrigin(NSPoint(x: -4000, y: -4000))
        window.contentView = view
        window.orderBack(nil)
        host = window
        defer { window.close(); host = nil; web = nil }
        guard let resource = Bundle.main.resourceURL?.appendingPathComponent("web/native.html") else { throw QwallError.message("The scene renderer is missing. Rebuild Qwall.") }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            loaded = c
            view.loadFileURL(resource, allowingReadAccessTo: resource.deletingLastPathComponent())
        }
        try? FileManager.default.removeItem(at: destination)
        let writer = try AVAssetWriter(outputURL: destination, fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width, AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 4_000_000, AVVideoMaxKeyFrameIntervalKey: fps]
        ])
        let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ])
        guard writer.canAdd(input) else { throw QwallError.message("Your Mac could not create a wallpaper video.") }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? QwallError.message("Video export failed to start.") }
        writer.startSession(atSourceTime: .zero)
        do {
            for frame in 0..<frames {
                _ = try await view.evaluateJavaScript("window.renderFrame(\(Double(frame) / Double(fps)))")
                let config = WKSnapshotConfiguration()
                config.snapshotWidth = NSNumber(value: width)
                config.afterScreenUpdates = true
                let image = try await view.takeSnapshot(configuration: config)
                var rect = NSRect(x: 0, y: 0, width: width, height: height)
                guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil),
                      let pool = adapter.pixelBufferPool else { throw QwallError.message("A scene frame could not be rendered.") }
                var buffer: CVPixelBuffer?
                guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { throw QwallError.message("Not enough memory to render this scene.") }
                CVPixelBufferLockBaseAddress(buffer, [])
                if let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) {
                    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
                }
                CVPixelBufferUnlockBaseAddress(buffer, [])
                var readinessWait = 0
                while !input.isReadyForMoreMediaData {
                    if writer.status == .failed || readinessWait > 1000 { throw writer.error ?? QwallError.message("Video encoder timed out.") }
                    try await Task.sleep(nanoseconds: 10_000_000)
                    readinessWait += 1
                }
                guard adapter.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: fps)) else { throw writer.error ?? QwallError.message("Could not encode a scene frame.") }
                progress(Double(frame + 1) / Double(frames))
            }
            input.markAsFinished()
            await writer.finishWriting()
            guard writer.status == .completed else { throw writer.error ?? QwallError.message("Video export did not finish.") }
        } catch { writer.cancelWriting(); throw error }
    }
}

@MainActor final class QwallApp: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    static let scenes = ["aurora", "cosmos", "ocean", "sunset", "ember", "rain", "dunes", "forest"]
    var surfaces: [DesktopSurface] = []
    var status: NSStatusItem!
    var gallery: NSWindow?
    var galleryWeb: WKWebView?
    var current: WallpaperSelection?
    var paused = false
    var suspended = false
    var pauseOnBattery = true
    var rotate = false
    var busy = false
    var targetScreen: Int?
    var timer: Timer?
    var rotationTimer: Timer?
    var exporter: SceneExporter?
    let defaults = UserDefaults.standard
    let dataRoot = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appendingPathComponent("Qwall", isDirectory: true)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "◒"
        status.button?.toolTip = "Qwall — Live wallpapers"
        pauseOnBattery = defaults.object(forKey: "pauseOnBattery") as? Bool ?? true
        if let data = defaults.data(forKey: "desktop"), let selection = try? JSONDecoder().decode(WallpaperSelection.self, from: data) {
            current = selection
            if let file = selection.file, !FileManager.default.fileExists(atPath: file) { current = nil }
        }
        makeMenu()
        NotificationCenter.default.addObserver(self, selector: #selector(rebuildScreens), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(self, selector: #selector(sleepScreens), name: NSWorkspace.screensDidSleepNotification, object: nil)
        workspace.addObserver(self, selector: #selector(wakeScreens), name: NSWorkspace.screensDidWakeNotification, object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(screenLocked), name: NSNotification.Name("com.apple.screenIsLocked"), object: nil)
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(screenUnlocked), name: NSNotification.Name("com.apple.screenIsUnlocked"), object: nil)
        if current != nil { rebuildScreens() }
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in Task { @MainActor in self?.updatePlayback() } }
        if CommandLine.arguments.contains("--smoke-test") { smokeTest(); return }
        if CommandLine.arguments.contains("--export-test") { exportTest(); return }
        if CommandLine.arguments.contains("--gallery-test") { galleryTest(); return }
        if !CommandLine.arguments.contains("--no-gallery") { openGallery() }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { handle(url) }
    }

    func handle(_ url: URL) {
        guard url.scheme == "qwall", let action = url.host,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let query = Dictionary(components.queryItems?.map { ($0.name, $0.value ?? "") } ?? [], uniquingKeysWith: { first, _ in first })
        let target = query["target"] ?? "desktop"
        guard ["desktop", "lock", "both"].contains(target) else { showError("Choose Desktop, Lock Screen, or Both."); return }
        guard !busy else { showError("A wallpaper is still being prepared. Please wait for it to finish."); return }
        switch action {
        case "apply":
            guard let scene = query["scene"], Self.scenes.contains(scene) else { showError("That wallpaper is not in the Qwall library."); return }
            Task { await apply(WallpaperSelection(scene: scene), target: target) }
        case "import": chooseVideo(target: target)
        case "gallery": openGallery()
        default: showError("This Qwall link is not supported.")
        }
    }

    func makeMenu() {
        let menu = NSMenu()
        @discardableResult func item(_ title: String, _ selector: Selector, key: String = "") -> NSMenuItem {
            let item = NSMenuItem(title: title, action: selector, keyEquivalent: key)
            item.target = self
            menu.addItem(item)
            return item
        }
        item("Open Qwall", #selector(openGallery), key: "o")
        menu.addItem(.separator())
        item(busy ? "Preparing wallpaper…" : (paused ? "Resume wallpaper" : "Pause wallpaper"), #selector(togglePause)).isEnabled = !busy
        item("Next wallpaper", #selector(nextScene), key: "n")
        item("Choose video for desktop…", #selector(importDesktop))
        item("Choose video for Lock Screen…", #selector(importLock))
        item("Choose video for both…", #selector(importBoth))
        menu.addItem(.separator())
        item("Pause on battery", #selector(toggleBattery)).state = pauseOnBattery ? .on : .off
        item("Rotate scenes every 15 minutes", #selector(toggleRotation)).state = rotate ? .on : .off
        let screensItem = NSMenuItem(title: "Display", action: nil, keyEquivalent: "")
        let screensMenu = NSMenu()
        let all = NSMenuItem(title: "All displays", action: #selector(selectScreen(_:)), keyEquivalent: "")
        all.target = self; all.tag = -1; all.state = targetScreen == nil ? .on : .off; screensMenu.addItem(all)
        for (index, screen) in NSScreen.screens.enumerated() {
            let item = NSMenuItem(title: screen.localizedName, action: #selector(selectScreen(_:)), keyEquivalent: "")
            item.target = self; item.tag = index; item.state = targetScreen == index ? .on : .off; screensMenu.addItem(item)
        }
        screensItem.submenu = screensMenu; menu.addItem(screensItem)
        menu.addItem(.separator())
        item("Stop desktop wallpaper", #selector(stopDesktop))
        item("Restore previous system wallpaper", #selector(restoreSystem))
        item("Quit Qwall", #selector(quit), key: "q")
        status.menu = menu
    }

    @objc func openGallery() {
        if let gallery { gallery.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Qwall"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 700, height: 500)
        let view = WKWebView(frame: NSRect(origin: .zero, size: window.contentLayoutRect.size))
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        window.contentView = view
        galleryWeb = view
        if let root = Bundle.main.resourceURL?.appendingPathComponent("web"), FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) {
            view.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        } else {
            showGalleryFailure("Qwall's bundled gallery is missing. Rebuild the Mac companion or open the online gallery.")
        }
        window.center(); window.makeKeyAndOrderFront(nil)
        gallery = window
        NSApp.activate(ignoringOtherApps: true)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if webView === galleryWeb { showGalleryFailure(error.localizedDescription) }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === galleryWeb { showGalleryFailure(error.localizedDescription) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === galleryWeb { showGalleryFailure("The gallery's web process stopped. Close and reopen Qwall, or use the online gallery.") }
    }
    func showGalleryFailure(_ detail: String) {
        let text = detail.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        galleryWeb?.loadHTMLString("""
        <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Qwall</title>
        <style>body{background:#101115;color:#f5f4ee;font:17px -apple-system;max-width:600px;padding:80px 48px;margin:auto}h1{font-size:40px}p{line-height:1.6;color:#b6b6bf}a{display:inline-block;background:#d9efb5;color:#101115;padding:14px 20px;border-radius:12px;text-decoration:none}</style>
        <h1>Qwall</h1><p>\(text)</p><a href="https://qodirovskiye.github.io/qwall/">Open the online gallery ↗</a>
        """, baseURL: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "qwall" { handle(url); decisionHandler(.cancel) }
        else if url.scheme == "https" || url.scheme == "http" { NSWorkspace.shared.open(url); decisionHandler(.cancel) }
        else if url.isFileURL || url.scheme == "about" || url.scheme == "blob" { decisionHandler(.allow) }
        else { decisionHandler(.cancel) }
    }

    @objc func importDesktop() { chooseVideo(target: "desktop") }
    @objc func importLock() { chooseVideo(target: "lock") }
    @objc func importBoth() { chooseVideo(target: "both") }

    func chooseVideo(target: String) {
        guard !busy else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.mpeg4Movie, .quickTimeMovie, .movie]
        panel.allowsMultipleSelection = false
        panel.message = "Choose a video for your \(target == "lock" ? "Lock Screen" : target == "both" ? "desktop and Lock Screen" : "desktop"). It stays on this Mac."
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            do {
                let asset = AVURLAsset(url: url)
                let tracks = try await asset.loadTracks(withMediaType: .video)
                guard !tracks.isEmpty else { throw QwallError.message("This file has no playable video track.") }
                let media = dataRoot.appendingPathComponent("Media", isDirectory: true)
                try FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
                let destination = media.appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension)
                try FileManager.default.copyItem(at: url, to: destination)
                await apply(WallpaperSelection(file: destination.path), target: target)
            } catch { showError(error.localizedDescription) }
        }
    }

    func apply(_ selection: WallpaperSelection, target: String) async {
        guard !busy else { return }
        if target == "desktop" || target == "both" {
            current = selection
            defaults.set(try? JSONEncoder().encode(selection), forKey: "desktop")
            paused = false
            rebuildScreens()
        }
        guard target == "lock" || target == "both" else { makeMenu(); return }
        busy = true; makeMenu()
        defer { busy = false; status.button?.title = "◒"; makeMenu() }
        do {
            let video: URL
            if let file = selection.file { video = URL(fileURLWithPath: file) }
            else if let scene = selection.scene {
                let cache = dataRoot.appendingPathComponent("Scenes", isDirectory: true)
                try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
                video = cache.appendingPathComponent("\(scene)-v1.mov")
                if !FileManager.default.fileExists(atPath: video.path) {
                    let renderer = SceneExporter(); exporter = renderer
                    defer { exporter = nil }
                    try await renderer.export(scene: scene, to: video) { value in self.status.button?.title = "\(Int(value * 100))%" }
                }
            } else { throw QwallError.message("No wallpaper was selected.") }
            try await SystemWallpaper.apply(videoURL: video, target: target)
            showInfo("Lock Screen wallpaper prepared", "Qwall registered your video with macOS. Lock the screen to check playback. This integration is experimental and may need reapplying after a macOS update. You can restore the previous wallpaper from Qwall’s menu.")
        } catch { showError(error.localizedDescription) }
    }

    @objc func rebuildScreens() {
        surfaces.forEach { $0.close() }; surfaces = []
        guard let current else { makeMenu(); return }
        for (index, screen) in NSScreen.screens.enumerated() where targetScreen == nil || targetScreen == index {
            surfaces.append(DesktopSurface(screen: screen, selection: current))
        }
        updatePlayback(); makeMenu()
    }
    @objc func sleepScreens() { suspended = true; updatePlayback() }
    @objc func wakeScreens() { suspended = false; updatePlayback() }
    @objc func screenLocked() { suspended = true; updatePlayback(); SystemWallpaper.nudgeIfActive() }
    @objc func screenUnlocked() { suspended = false; updatePlayback() }
    func onBattery() -> Bool {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let type = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() else { return false }
        return (type as String) == kIOPSBatteryPowerValue
    }
    func updatePlayback() {
        let stop = paused || suspended || (pauseOnBattery && onBattery()) || ProcessInfo.processInfo.isLowPowerModeEnabled
        surfaces.forEach { $0.pause(stop) }
    }
    @objc func togglePause() { paused.toggle(); updatePlayback(); makeMenu() }
    @objc func toggleBattery() { pauseOnBattery.toggle(); defaults.set(pauseOnBattery, forKey: "pauseOnBattery"); updatePlayback(); makeMenu() }
    @objc func nextScene() {
        let next = ((Self.scenes.firstIndex(of: current?.scene ?? "") ?? -1) + 1) % Self.scenes.count
        Task { await apply(WallpaperSelection(scene: Self.scenes[next]), target: "desktop") }
    }
    @objc func toggleRotation() {
        rotate.toggle(); rotationTimer?.invalidate(); rotationTimer = nil
        if rotate { rotationTimer = Timer.scheduledTimer(withTimeInterval: 900, repeats: true) { [weak self] _ in Task { @MainActor in self?.nextScene() } } }
        makeMenu()
    }
    @objc func selectScreen(_ sender: NSMenuItem) { targetScreen = sender.tag == -1 ? nil : sender.tag; rebuildScreens() }
    @objc func stopDesktop() { current = nil; defaults.removeObject(forKey: "desktop"); rebuildScreens() }
    @objc func restoreSystem() {
        do { try SystemWallpaper.restore(); showInfo("Previous wallpaper restored", "Your saved macOS wallpaper settings have been restored.") }
        catch { showError(error.localizedDescription) }
    }
    @objc func quit() { surfaces.forEach { $0.close() }; NSApp.terminate(nil) }
    func showError(_ text: String) { showInfo("Qwall", text) }
    func showInfo(_ title: String, _ text: String) {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = text
        alert.addButton(withTitle: "OK"); NSApp.activate(ignoringOtherApps: true); alert.runModal()
    }

    func smokeTest() {
        Task {
            let selection = WallpaperSelection(scene: "aurora")
            guard let screen = NSScreen.main else { print("SMOKE FAIL: no display"); NSApp.terminate(nil); return }
            let surface = DesktopSurface(screen: screen, selection: selection)
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            do {
                let result = try await surface.web?.evaluateJavaScript("({ready: !!window.QwallScenes, width: document.querySelector('canvas').width})")
                print("SMOKE: \(String(describing: result))")
                surface.close()
            } catch { print("SMOKE FAIL: \(error)") }
            NSApp.terminate(nil)
        }
    }
    func galleryTest() {
        openGallery()
        Task {
            for attempt in 0..<30 {
                do {
                    guard let view = galleryWeb else { throw QwallError.message("No gallery web view was created.") }
                    let result = try await view.evaluateJavaScript("({title:document.title,url:location.href,ready:document.readyState,cards:document.querySelectorAll('.wallpaper-card').length,scenes:!!window.QwallScenes,width:innerWidth,height:innerHeight})")
                    if let info = result as? [String: Any], let count = info["cards"] as? Int, count == 8,
                       let width = info["width"] as? Int, width > 600 {
                        print("GALLERY OK: \(info)")
                        NSApp.terminate(nil); return
                    }
                    if attempt == 29 { print("GALLERY FAIL: \(String(describing: result))") }
                } catch { if attempt == 29 { print("GALLERY FAIL: \(error)") } }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            NSApp.terminate(nil)
        }
    }
    func exportTest() {
        Task {
            do {
                let renderer = SceneExporter(); exporter = renderer
                let output = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("qwall-export-test.mov")
                try await renderer.export(scene: "aurora", to: output) { _ in }
                let asset = AVURLAsset(url: output)
                let duration = try await asset.load(.duration)
                print("EXPORT OK: \(duration.seconds)s at \(output.path)")
            } catch { print("EXPORT FAIL: \(error)") }
            NSApp.terminate(nil)
        }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = QwallApp()
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}

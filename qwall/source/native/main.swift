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
    var title: String?
    var localId: String?
}

@MainActor final class DesktopSurface: NSObject, WKNavigationDelegate {
    let window: NSWindow
    var player: AVQueuePlayer?
    var looper: AVPlayerLooper?
    var web: WKWebView?
    private let foldLayer: CALayer
    private let shade: CALayer
    let builtIn: Bool
    private var playbackPaused = false
    private var playbackSpeed = 1.0

    init(screen: NSScreen, selection: WallpaperSelection, offscreen: Bool = false) {
        let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        builtIn = number.map { CGDisplayIsBuiltin($0.uint32Value) != 0 } ?? false
        let canvas = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
        canvas.wantsLayer = true
        canvas.layer?.masksToBounds = true
        canvas.layer?.backgroundColor = NSColor.black.cgColor
        let wallpaper = NSView(frame: canvas.bounds)
        wallpaper.wantsLayer = true
        wallpaper.autoresizingMask = [.width, .height]
        canvas.addSubview(wallpaper)
        foldLayer = wallpaper.layer!
        shade = CALayer()
        shade.frame = wallpaper.bounds
        shade.backgroundColor = NSColor.black.cgColor
        shade.opacity = 0
        shade.zPosition = 1
        foldLayer.addSublayer(shade)
        window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        super.init()
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.ignoresMouseEvents = true
        window.hidesOnDeactivate = false
        window.isReleasedWhenClosed = false
        window.backgroundColor = .black
        window.contentView = canvas
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
            view.autoresizingMask = [.width, .height]
            wallpaper.addSubview(view)
            queue.play()
        } else if let scene = selection.scene {
            let configuration = WKWebViewConfiguration()
            configuration.userContentController.addUserScript(WKUserScript(source: "window.QWALL_NATIVE={scene:'\(scene)',export:false};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            let view = WKWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: configuration)
            view.setValue(false, forKey: "drawsBackground")
            web = view
            view.navigationDelegate = self
            view.autoresizingMask = [.width, .height]
            wallpaper.addSubview(view)
            if let resource = Bundle.main.resourceURL?.appendingPathComponent("web/native.html") {
                view.loadFileURL(resource, allowingReadAccessTo: resource.deletingLastPathComponent())
            }
        }
        if offscreen { window.setFrameOrigin(NSPoint(x: -4000, y: -4000)) }
        window.orderBack(nil)
    }

    func fold(_ amount: Double) {
        guard builtIn else { return }
        var perspective = CATransform3DIdentity
        perspective.m34 = -1 / max(foldLayer.bounds.height * 1.25, 1)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        foldLayer.transform = CATransform3DRotate(perspective, amount * .pi * 0.39, 1, 0, 0)
        shade.opacity = Float(amount * 0.62)
        CATransaction.commit()
    }

    func pause(_ paused: Bool, speed: Double = 1, muted: Bool = true) {
        playbackPaused = paused
        playbackSpeed = speed
        player?.isMuted = muted
        if paused { player?.pause() } else { player?.playImmediately(atRate: Float(speed)) }
        updateWebPlayback()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updateWebPlayback()
    }

    private func updateWebPlayback() {
        web?.evaluateJavaScript("window.setSpeed?.(\(playbackSpeed)); window.setPaused?.(\(playbackPaused));", completionHandler: nil)
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
    var speed = 1.0
    var muted = true
    var screenAsleep = false
    var locked = false
    var lidFold = false
    var lidSensor: LidAngleSensor?
    var lidTimer: Timer?
    var lidRestAngle: Double?
    var lastLidRead = Date.distantPast
    var foldAmount = 0.0
    var pauseOnBattery = false
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
        if CommandLine.arguments.contains("--smoke-test") { smokeTest(); return }
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "◒"
        status.button?.toolTip = "Qwall — Live wallpapers"
        lidFold = defaults.bool(forKey: "lidFold")
        pauseOnBattery = defaults.object(forKey: "pauseOnBattery") as? Bool ?? false
        speed = defaults.object(forKey: "speed") as? Double ?? 1
        muted = defaults.object(forKey: "muted") as? Bool ?? true
        let savedDisplay = defaults.integer(forKey: "display")
        targetScreen = defaults.object(forKey: "display") != nil && savedDisplay >= 0 && savedDisplay < NSScreen.screens.count ? savedDisplay : nil
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
        if defaults.bool(forKey: "rotation") { toggleRotation() }
        if CommandLine.arguments.contains("--export-test") { exportTest(); return }
        if CommandLine.arguments.contains("--gallery-test") { galleryTest(); return }
        if CommandLine.arguments.contains("--desktop-playback-test") { desktopPlaybackTest(); return }
        if !CommandLine.arguments.contains("--no-gallery") { openGallery() }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { handle(url) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openGallery(); return true }

    func handle(_ url: URL, fromGallery: Bool = false) {
        guard url.scheme == "qwall", let action = url.host,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let query = Dictionary(components.queryItems?.map { ($0.name, $0.value ?? "") } ?? [], uniquingKeysWith: { first, _ in first })
        if ["status", "control", "apply-local"].contains(action) && !fromGallery { return }
        if action == "status" { sendStatus(); return }
        if action == "control" { control(query); return }
        let target = query["target"] ?? "desktop"
        guard ["desktop", "lock", "both"].contains(target) else { showError("Choose Desktop, Lock Screen, or Both."); return }
        guard !busy else { showError("A wallpaper is still being prepared. Please wait for it to finish."); return }
        switch action {
        case "apply":
            guard let scene = query["scene"], Self.scenes.contains(scene) else { showError("That wallpaper is not in the Qwall library."); return }
            Task { await apply(WallpaperSelection(scene: scene), target: target) }
        case "import":
            let matches = fromGallery ? localLibrary().filter { ($0["name"] as? String)?.localizedCaseInsensitiveCompare(query["name"] ?? "") == .orderedSame } : []
            if matches.count == 1, let id = matches[0]["nativeId"] as? String, let selection = localSelection(id: id) {
                Task { await apply(selection, target: target) }
            } else { chooseVideo(target: target) }
        case "apply-local":
            guard let id = query["id"], let selection = localSelection(id: id) else { showError("This video is no longer in Qwall's local library. Import the file again."); return }
            Task { await apply(selection, target: target) }
        case "gallery": openGallery()
        default: showError("This Qwall link is not supported.")
        }
    }

    func control(_ query: [String: String]) {
        let enabled = query["enabled"] == "1"
        switch query["action"] {
        case "pause": paused = true; updatePlayback(); makeMenu()
        case "resume": paused = false; updatePlayback(); makeMenu()
        case "next": if !busy { nextScene() }
        case "stop": if !busy { stopDesktop() }
        case "restore": if !busy { restoreSystem() }
        case "battery": if pauseOnBattery != enabled { toggleBattery() }
        case "rotation": if rotate != enabled { toggleRotation() }
        case "lid": if lidFold != enabled { toggleLidFold() }
        case "mute": muted = enabled; defaults.set(muted, forKey: "muted"); updatePlayback(); makeMenu()
        case "speed":
            if let value = Double(query["value"] ?? ""), [0.5, 0.75, 1, 1.25, 1.5, 2].contains(value) {
                speed = value; defaults.set(speed, forKey: "speed"); updatePlayback(); makeMenu()
            }
        case "display":
            if let value = Int(query["index"] ?? ""), value == -1 || (0..<NSScreen.screens.count).contains(value) {
                targetScreen = value == -1 ? nil : value; defaults.set(value, forKey: "display"); rebuildScreens()
            }
        default: break
        }
        sendStatus()
    }

    func sendStatus() {
        let pauseReason = playbackPauseReason()
        let info: [String: Any] = ["paused": paused, "rotation": rotate, "pauseOnBattery": pauseOnBattery,
                                 "effectivePaused": pauseReason != nil, "pauseReason": pauseReason ?? "",
                                 "lidFold": lidFold, "lidSensorActive": lidSensor != nil,
                                 "muted": muted, "speed": speed, "scene": current?.scene ?? "",
                                 "hasDesktop": !surfaces.isEmpty, "localId": current?.localId ?? "",
                                 "title": current?.title ?? current?.scene ?? "", "libraryCount": localLibrary().count,
                                 "displays": NSScreen.screens.map(\.localizedName),
                                 "displayIndex": targetScreen.map { $0 as Any } ?? NSNull(), "busy": busy]
        guard let json = try? JSONSerialization.data(withJSONObject: info), let string = String(data: json, encoding: .utf8) else { return }
        galleryWeb?.evaluateJavaScript("window.QWALL_NATIVE_STATUS=\(string);window.dispatchEvent(new CustomEvent('qwall-native-status',{detail:window.QWALL_NATIVE_STATUS}));", completionHandler: nil)
    }

    func localLibrary() -> [[String: Any]] {
        guard let bytes = try? Data(contentsOf: dataRoot.appendingPathComponent("private-library.json")),
              let entries = try? JSONSerialization.jsonObject(with: bytes) as? [[String: Any]] else { return [] }
        let media = dataRoot.appendingPathComponent("Media", isDirectory: true)
        return entries.compactMap { entry in
            guard let id = entry["id"] as? String, UUID(uuidString: id) != nil,
                  let filename = entry["filename"] as? String, (filename as NSString).lastPathComponent == filename,
                  !filename.hasPrefix("."), let name = entry["name"] as? String else { return nil }
            let video = media.appendingPathComponent(filename)
            guard FileManager.default.fileExists(atPath: video.path), video.resolvingSymlinksInPath().deletingLastPathComponent().path == media.resolvingSymlinksInPath().path else { return nil }
            return ["id": "macwall-\(id)", "nativeId": id, "name": name,
                    "category": entry["category"] as? String ?? "Your video", "mood": "Saved on this Mac",
                    "description": "A video in your private Qwall library. Stored on this Mac.",
                    "resolution": entry["resolution"] as? String ?? "", "duration": entry["duration"] as? String ?? "",
                    "bytes": entry["bytes"] as? Int ?? 0,
                    "videoURL": video.absoluteString]
        }
    }

    func localSelection(id: String) -> WallpaperSelection? {
        guard let entry = localLibrary().first(where: { ($0["nativeId"] as? String)?.lowercased() == id.lowercased() }),
              let string = entry["videoURL"] as? String, let url = URL(string: string) else { return nil }
        return WallpaperSelection(file: url.path, title: entry["name"] as? String, localId: id.lowercased())
    }

    func prepareGalleryResources() throws -> URL {
        guard let source = Bundle.main.resourceURL?.appendingPathComponent("web"),
              let enumerator = FileManager.default.enumerator(at: source, includingPropertiesForKeys: [.isRegularFileKey]) else { throw QwallError.message("The bundled gallery could not be found.") }
        let target = dataRoot.appendingPathComponent("Gallery", isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        for case let file as URL in enumerator {
            guard (try file.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true else { continue }
            let relative = String(file.path.dropFirst(source.path.count + 1))
            let destination = target.appendingPathComponent(relative)
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            let bytes = try Data(contentsOf: file)
            if (try? Data(contentsOf: destination)) != bytes { try bytes.write(to: destination, options: .atomic) }
        }
        return target
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
        item(muted ? "Enable wallpaper sound" : "Mute wallpaper sound", #selector(toggleMute))
        let speedItem = NSMenuItem(title: "Playback speed", action: nil, keyEquivalent: "")
        let speedMenu = NSMenu()
        for value in [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] {
            let option = NSMenuItem(title: "\(value)×", action: #selector(selectSpeed(_:)), keyEquivalent: "")
            option.target = self; option.representedObject = NSNumber(value: value); option.state = speed == value ? .on : .off
            speedMenu.addItem(option)
        }
        speedItem.submenu = speedMenu; menu.addItem(speedItem)
        menu.addItem(.separator())
        item("Pause on battery", #selector(toggleBattery)).state = pauseOnBattery ? .on : .off
        item("Fold wallpaper with lid", #selector(toggleLidFold)).state = lidFold ? .on : .off
        item("Rotate library every 15 minutes", #selector(toggleRotation)).state = rotate ? .on : .off
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
        sendStatus()
    }

    @objc func openGallery() {
        if let gallery { gallery.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Qwall"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 700, height: 500)
        let configuration = WKWebViewConfiguration()
        let libraryData = (try? JSONSerialization.data(withJSONObject: localLibrary())) ?? Data("[]".utf8)
        let libraryJSON = String(data: libraryData, encoding: .utf8) ?? "[]"
        configuration.userContentController.addUserScript(WKUserScript(source: "window.QWALL_IS_NATIVE=true;window.QWALL_LOCAL_LIBRARY=\(libraryJSON);", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: NSRect(origin: .zero, size: window.contentLayoutRect.size), configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.navigationDelegate = self
        window.contentView = view
        galleryWeb = view
        do {
            let root = try prepareGalleryResources()
            view.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: dataRoot)
        } catch { showGalleryFailure(error.localizedDescription) }
        window.center(); window.makeKeyAndOrderFront(nil)
        gallery = window
        NSApp.activate(ignoringOtherApps: true)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === galleryWeb { sendStatus() }
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
        if url.scheme == "qwall" {
            if webView === galleryWeb && navigationAction.sourceFrame.isMainFrame {
                handle(url, fromGallery: true)
            }
            decisionHandler(.cancel)
        }
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
                await apply(WallpaperSelection(file: destination.path, title: url.deletingPathExtension().lastPathComponent), target: target)
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
        guard let current else { updateLidPolling(); makeMenu(); return }
        for (index, screen) in NSScreen.screens.enumerated() where targetScreen == nil || targetScreen == index {
            surfaces.append(DesktopSurface(screen: screen, selection: current))
        }
        updatePlayback(); makeMenu()
    }
    @objc func sleepScreens() { screenAsleep = true; updatePlayback() }
    @objc func wakeScreens() { screenAsleep = false; updatePlayback() }
    @objc func screenLocked() { locked = true; updatePlayback(); SystemWallpaper.nudgeIfActive() }
    @objc func screenUnlocked() { locked = false; updatePlayback() }

    @objc func toggleLidFold() {
        lidFold.toggle()
        defaults.set(lidFold, forKey: "lidFold")
        updateLidPolling()
        if lidFold && surfaces.contains(where: \.builtIn) && lidSensor == nil {
            showInfo("Lid sensor unavailable", "Qwall could not read the hinge sensor on this Mac. Wallpaper playback continues normally.")
        }
        makeMenu()
    }

    func updateLidPolling() {
        guard lidFold, !screenAsleep, !locked, surfaces.contains(where: \.builtIn) else {
            lidTimer?.invalidate()
            lidTimer = nil
            lidSensor = nil
            lidRestAngle = nil
            foldAmount = 0
            surfaces.forEach { $0.fold(0) }
            return
        }
        guard lidTimer == nil, let sensor = LidAngleSensor() else { return }
        lidSensor = sensor
        lidRestAngle = sensor.degrees().map { max(65, $0) }
        lastLidRead = Date()
        let timer = Timer(timeInterval: 1 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateLidFold() }
        }
        RunLoop.main.add(timer, forMode: .common)
        lidTimer = timer
    }

    func updateLidFold() {
        let now = Date()
        if let angle = lidSensor?.degrees() {
            let openAngle = max(lidRestAngle ?? 65, angle)
            lidRestAngle = openAngle
            let target = min(1, max(0, (openAngle - angle - 3) / (openAngle - 23)))
            foldAmount += (target - foldAmount) * 0.35
            if target == 0 && foldAmount < 0.002 { foldAmount = 0 }
            lastLidRead = now
        } else if now.timeIntervalSince(lastLidRead) > 0.5 {
            foldAmount = 0
        }
        surfaces.forEach { $0.fold(foldAmount) }
    }
    func onBattery() -> Bool {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let type = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() else { return false }
        return (type as String) == kIOPSBatteryPowerValue
    }
    func updatePlayback() {
        let stop = playbackPauseReason() != nil
        surfaces.forEach { $0.pause(stop, speed: speed, muted: muted) }
        updateLidPolling()
        sendStatus()
    }
    func playbackPauseReason() -> String? {
        if paused { return "Paused" }
        if screenAsleep || locked { return "Paused while the screen is asleep or locked" }
        if pauseOnBattery && onBattery() { return "Paused on battery — turn off Pause on battery to keep motion playing" }
        if pauseOnBattery && ProcessInfo.processInfo.isLowPowerModeEnabled { return "Paused for Low Power Mode — turn off Pause on battery to keep motion playing" }
        return nil
    }
    @objc func togglePause() { paused.toggle(); updatePlayback(); makeMenu() }
    @objc func toggleBattery() { pauseOnBattery.toggle(); defaults.set(pauseOnBattery, forKey: "pauseOnBattery"); updatePlayback(); makeMenu() }
    @objc func toggleMute() { muted.toggle(); defaults.set(muted, forKey: "muted"); updatePlayback(); makeMenu() }
    @objc func selectSpeed(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? NSNumber else { return }
        speed = value.doubleValue; defaults.set(speed, forKey: "speed"); updatePlayback(); makeMenu()
    }
    @objc func nextScene() {
        let library = localLibrary()
        if !library.isEmpty, current?.file != nil {
            let index = library.firstIndex(where: { ($0["nativeId"] as? String)?.lowercased() == current?.localId?.lowercased() }) ?? -1
            if let id = library[(index + 1) % library.count]["nativeId"] as? String, let selection = localSelection(id: id) {
                Task { await apply(selection, target: "desktop") }; return
            }
        }
        let next = ((Self.scenes.firstIndex(of: current?.scene ?? "") ?? -1) + 1) % Self.scenes.count
        Task { await apply(WallpaperSelection(scene: Self.scenes[next]), target: "desktop") }
    }
    @objc func toggleRotation() {
        rotate.toggle(); rotationTimer?.invalidate(); rotationTimer = nil
        defaults.set(rotate, forKey: "rotation")
        if rotate { rotationTimer = Timer.scheduledTimer(withTimeInterval: 900, repeats: true) { [weak self] _ in Task { @MainActor in
            guard let self, !self.surfaces.isEmpty, self.playbackPauseReason() == nil else { return }
            self.nextScene()
        } } }
        makeMenu()
    }
    @objc func selectScreen(_ sender: NSMenuItem) { targetScreen = sender.tag == -1 ? nil : sender.tag; defaults.set(sender.tag, forKey: "display"); rebuildScreens() }
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
            guard let screen = NSScreen.main else { print("SMOKE FAIL: no display"); exit(1) }
            let surface = DesktopSurface(screen: screen, selection: selection, offscreen: true)
            surface.pause(true, speed: 0.75)
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            do {
                let result = try await surface.web?.evaluateJavaScript("({ready: !!window.QwallScenes, width: document.querySelector('canvas').width, paused, speed})")
                guard let state = result as? [String: Any], state["ready"] as? Bool == true,
                      state["paused"] as? Bool == true, state["speed"] as? Double == 0.75,
                      let width = state["width"] as? Int, width > 0 else {
                    throw QwallError.message("Renderer did not load with the requested paused state and speed.")
                }
                surface.close()
                print("SMOKE PASS: desktop renderer loaded and preserved startup pause and playback speed.")
                exit(0)
            } catch {
                surface.close()
                print("SMOKE FAIL: \(error.localizedDescription)")
                exit(1)
            }
        }
    }
    func desktopPlaybackTest() {
        Task {
            if current?.file == nil, let entry = localLibrary().first, let id = entry["nativeId"] as? String, let selection = localSelection(id: id) {
                current = selection; rebuildScreens()
            }
            guard let surface = surfaces.first, let player = surface.player else {
                print("DESKTOP PLAYBACK FAIL: no desktop video player"); NSApp.terminate(nil); return
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            let start = player.currentTime().seconds
            let initialRate = player.rate
            let quick = CommandLine.arguments.contains("--quick")
            let duration = player.currentItem?.duration.seconds ?? 30
            let seconds = quick ? 4.0 : min(45, max(8, duration.isFinite ? duration + 3 : 35))
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            let end = player.currentTime().seconds
            let loops = surface.looper?.loopCount ?? 0
            let moving = initialRate > 0 && player.rate > 0 && (abs(end - start) > 1 || loops > 0)
            let passed = moving && (quick || loops > 0)
            let result: [String: Any] = ["passed": passed, "battery": onBattery(), "pauseOnBattery": pauseOnBattery,
                "initialRate": initialRate, "finalRate": player.rate, "startSeconds": start.isFinite ? start : -1,
                "endSeconds": end.isFinite ? end : -1, "loops": loops, "durationSeconds": duration.isFinite ? duration : -1,
                "windowVisible": surface.window.isVisible, "windowLevel": surface.window.level.rawValue]
            if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
                try? data.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("qwall-desktop-playback-test.json"))
            }
            print("DESKTOP PLAYBACK \(passed ? "PASS" : "FAIL"): \(result)")
            NSApp.terminate(nil)
        }
    }
    func galleryTest() {
        openGallery()
        Task {
            for attempt in 0..<30 {
                do {
                    guard let view = galleryWeb else { throw QwallError.message("No gallery web view was created.") }
                    let result = try await view.evaluateJavaScript("({title:document.title,url:location.href,ready:document.readyState,cards:document.querySelectorAll('.wallpaper-card').length,scenes:!!window.QwallScenes,native:window.QWALL_IS_NATIVE===true,status:!!window.QWALL_NATIVE_STATUS,localVideos:(window.QWALL_LOCAL_LIBRARY||[]).length,loadedVideos:[...document.querySelectorAll('.wallpaper-card video')].filter(v=>v.readyState>=1).length,width:innerWidth,height:innerHeight})")
                    if let info = result as? [String: Any], let count = info["cards"] as? Int, count >= 1,
                       (info["localVideos"] as? Int ?? 0) == 0 || (info["loadedVideos"] as? Int ?? 0) > 0,
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
    if CommandLine.arguments.contains("--lid-test") {
        guard let angle = LidAngleSensor()?.degrees() else {
            print("LID UNAVAILABLE")
            exit(1)
        }
        print("LID OK: \(angle)°")
        return
    }
    let app = NSApplication.shared
    let delegate = QwallApp()
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}

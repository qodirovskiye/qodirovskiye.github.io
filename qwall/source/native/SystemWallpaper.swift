import Foundation
import AVFoundation
import AppKit
import VideoToolbox

/// Experimental integration with Apple's per-user Aerial catalog. This is an
/// undocumented macOS format, not a public wallpaper-setting API.
enum SystemWallpaper {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private static let mutex = NSLock()
    private static let categoryID = "4D9ECF96-517E-4AA9-A9CE-58D1FD0A66BA"
    private static let subcategoryID = "96D7D336-CC5E-4932-B66B-FE6AF9F1E61F"
    private static let provider = "com.apple.wallpaper.choice.aerials"
    private static let fm = FileManager.default
    private static var home: URL { fm.homeDirectoryForCurrentUser }
    private static var support: URL { home.appendingPathComponent("Library/Application Support") }
    private static var aerials: URL { support.appendingPathComponent("com.apple.wallpaper/aerials") }
    private static var indexURL: URL { support.appendingPathComponent("com.apple.wallpaper/Store/Index.plist") }
    private static var manifestURL: URL { aerials.appendingPathComponent("manifest/entries.json") }
    private static var stateURL: URL { support.appendingPathComponent("Qwall/SystemWallpaper") }

    /// Heavy encoding and filesystem work happen off the main thread. Returns
    /// only after catalog and selection read back correctly, not visual proof.
    static func apply(videoURL: URL, target: String) async throws {
        try await Task.detached(priority: .userInitiated) {
            try applySynchronously(videoURL: videoURL, target: target)
        }.value
    }

    private static func applySynchronously(videoURL: URL, target: String) throws {
        mutex.lock(); defer { mutex.unlock() }
        guard ["desktop", "lock", "both"].contains(target) else {
            throw Failure(message: "Unknown wallpaper destination.")
        }
        let major = ProcessInfo.processInfo.operatingSystemVersion.majorVersion
        guard major == 26 || major == 27 else {
            throw Failure(message: "Qwall's experimental Lock Screen integration currently supports macOS 26 and 27.")
        }
        guard videoURL.isFileURL, fm.isReadableFile(atPath: videoURL.path) else {
            throw Failure(message: "Choose a readable video stored on this Mac.")
        }
        guard fm.fileExists(atPath: manifestURL.path), fm.fileExists(atPath: indexURL.path) else {
            throw Failure(message: "First download one Apple aerial in System Settings → Wallpaper, then try again.")
        }
        let id = UUID().uuidString.uppercased()
        let transaction = stateURL.appendingPathComponent(id)
        try fm.createDirectory(at: transaction, withIntermediateDirectories: true)
        let stagedVideo = transaction.appendingPathComponent("video.mov")
        let stagedThumb = transaction.appendingPathComponent("preview.png")
        try transcode(source: videoURL, destination: stagedVideo)
        try thumbnail(video: stagedVideo, destination: stagedThumb)
        let movie = aerials.appendingPathComponent("videos/\(id).mov")
        let thumb = aerials.appendingPathComponent("thumbnails/\(id).png")
        try fm.createDirectory(at: movie.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fm.createDirectory(at: thumb.deletingLastPathComponent(), withIntermediateDirectories: true)
        // New random UUIDs ensure an Apple/MacWall video is never replaced.
        guard !fm.fileExists(atPath: movie.path), !fm.fileExists(atPath: thumb.path) else {
            throw Failure(message: "A wallpaper identifier collision occurred. Try again.")
        }
        var committed = false
        defer {
            if !committed { try? fm.removeItem(at: movie); try? fm.removeItem(at: thumb) }
        }
        try fm.moveItem(at: stagedVideo, to: movie)
        try fm.moveItem(at: stagedThumb, to: thumb)

        stopAgent()
        defer { resumeAgent() }
        let beforeIndex = try Data(contentsOf: indexURL)
        let beforeManifest = try Data(contentsOf: manifestURL)
        var baselineIndex = beforeIndex, baselineManifest = beforeManifest
        var ownedIDs = [id]
        // Consecutive Qwall selections share the original baseline, so Restore
        // returns to the pre-Qwall wallpaper rather than another Qwall scene.
        if let previousID = try? String(contentsOf: stateURL.appendingPathComponent("latest"), encoding: .utf8),
           UUID(uuidString: previousID) != nil {
            let previous = stateURL.appendingPathComponent(previousID)
            if let previousIndex = try? Data(contentsOf: previous.appendingPathComponent("Index.after.plist")),
               let previousManifest = try? Data(contentsOf: previous.appendingPathComponent("entries.after.json")),
               try semanticIndex(beforeIndex) == semanticIndex(previousIndex),
               beforeManifest == previousManifest,
               let originalIndex = try? Data(contentsOf: previous.appendingPathComponent("Index.before.plist")),
               let originalManifest = try? Data(contentsOf: previous.appendingPathComponent("entries.before.json")) {
                baselineIndex = originalIndex; baselineManifest = originalManifest
                if let recordData = try? Data(contentsOf: previous.appendingPathComponent("transaction.json")),
                   let record = try? JSONSerialization.jsonObject(with: recordData) as? [String: Any],
                   let priorIDs = record["ownedIDs"] as? [String] {
                    ownedIDs += priorIDs.filter { UUID(uuidString: $0) != nil }
                } else { ownedIDs.append(previousID) }
            }
        }
        let patchedManifest = try catalogData(original: beforeManifest, assetID: id,
                                             movieURL: movie, thumbnailURL: thumb,
                                             title: "Qwall · \(videoURL.deletingPathExtension().lastPathComponent)")
        let patchedIndex = try selectionData(original: beforeIndex, assetID: id, target: target)
        try baselineIndex.write(to: transaction.appendingPathComponent("Index.before.plist"), options: .atomic)
        try baselineManifest.write(to: transaction.appendingPathComponent("entries.before.json"), options: .atomic)
        try patchedIndex.write(to: transaction.appendingPathComponent("Index.after.plist"), options: .atomic)
        try patchedManifest.write(to: transaction.appendingPathComponent("entries.after.json"), options: .atomic)
        let record: [String: Any] = ["assetID": id, "target": target, "movie": movie.path, "ownedIDs": ownedIDs,
                                    "thumbnail": thumb.path, "created": ISO8601DateFormatter().string(from: Date())]
        try JSONSerialization.data(withJSONObject: record, options: .prettyPrinted)
            .write(to: transaction.appendingPathComponent("transaction.json"), options: .atomic)
        do {
            try patchedManifest.write(to: manifestURL, options: .atomic)
            try patchedIndex.write(to: indexURL, options: .atomic)
            guard try Data(contentsOf: indexURL) == patchedIndex,
                  try Data(contentsOf: manifestURL) == patchedManifest else {
                throw Failure(message: "macOS changed its wallpaper settings during the update. Your previous settings were restored.")
            }
            try Data(id.utf8).write(to: stateURL.appendingPathComponent("latest"), options: .atomic)
            committed = true
        } catch {
            try? beforeManifest.write(to: manifestURL, options: .atomic)
            try? beforeIndex.write(to: indexURL, options: .atomic)
            throw error
        }
        restartRendering()
    }

    /// Restore the exact last selection, but only if nothing other than access
    /// timestamps has changed since Qwall wrote it. Never overwrite newer edits.
    static func restore() throws {
        mutex.lock(); defer { mutex.unlock() }
        let latest = stateURL.appendingPathComponent("latest")
        guard let id = try? String(contentsOf: latest, encoding: .utf8), UUID(uuidString: id) != nil else {
            throw Failure(message: "Qwall has no saved system wallpaper change to restore.")
        }
        let transaction = stateURL.appendingPathComponent(id)
        let beforeIndex = try Data(contentsOf: transaction.appendingPathComponent("Index.before.plist"))
        let beforeManifest = try Data(contentsOf: transaction.appendingPathComponent("entries.before.json"))
        let afterIndex = try Data(contentsOf: transaction.appendingPathComponent("Index.after.plist"))
        let afterManifest = try Data(contentsOf: transaction.appendingPathComponent("entries.after.json"))
        stopAgent(); defer { resumeAgent() }
        guard try semanticIndex(Data(contentsOf: indexURL)) == semanticIndex(afterIndex),
              try Data(contentsOf: manifestURL) == afterManifest else {
            throw Failure(message: "Wallpaper settings changed after Qwall applied them. Choose your preferred wallpaper in System Settings; the saved originals are in Qwall's Backups folder.")
        }
        let currentIndex = try Data(contentsOf: indexURL)
        let currentManifest = try Data(contentsOf: manifestURL)
        do {
            try beforeManifest.write(to: manifestURL, options: .atomic)
            try beforeIndex.write(to: indexURL, options: .atomic)
        } catch {
            try? currentManifest.write(to: manifestURL, options: .atomic)
            try? currentIndex.write(to: indexURL, options: .atomic)
            throw error
        }
        // Only files whose UUID belongs to this transaction chain are removed.
        let recordBytes = try? Data(contentsOf: transaction.appendingPathComponent("transaction.json"))
        let record = recordBytes.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let ownedIDs = (record?["ownedIDs"] as? [String] ?? [id]).filter { UUID(uuidString: $0) != nil }
        for ownedID in ownedIDs {
            try? fm.removeItem(at: aerials.appendingPathComponent("videos/\(ownedID).mov"))
            try? fm.removeItem(at: aerials.appendingPathComponent("thumbnails/\(ownedID).png"))
        }
        try? fm.removeItem(at: latest)
        restartRendering()
    }

    static var backupsDirectory: URL { stateURL }

    /// Nudge only while a Qwall selection is still active. Parent can call on
    /// distributed screen-lock events to re-arm Apple's aerial playback.
    static func nudgeIfActive() {
        guard let id = try? String(contentsOf: stateURL.appendingPathComponent("latest"), encoding: .utf8),
              UUID(uuidString: id) != nil,
              let data = try? Data(contentsOf: indexURL),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil),
              containsAsset(plist, id: id) else { return }
        restartRendering()
    }

    private static func containsAsset(_ node: Any, id: String) -> Bool {
        if let data = node as? Data,
           let config = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
           config["assetID"] as? String == id { return true }
        if let object = node as? [String: Any] { return object.values.contains { containsAsset($0, id: id) } }
        if let values = node as? [Any] { return values.contains { containsAsset($0, id: id) } }
        return false
    }

    // Pure functions exposed internally for fixture tests; they never write.
    static func catalogData(original: Data, assetID: String, movieURL: URL,
                            thumbnailURL: URL, title: String) throws -> Data {
        guard UUID(uuidString: assetID) != nil,
              var root = try JSONSerialization.jsonObject(with: original) as? [String: Any],
              var assets = root["assets"] as? [[String: Any]],
              var categories = root["categories"] as? [[String: Any]],
              !assets.contains(where: { $0["id"] as? String == assetID }) else {
            throw Failure(message: "The Apple aerial catalog has an unsupported format.")
        }
        let asset: [String: Any] = ["id": assetID, "categories": [categoryID],
            "subcategories": [subcategoryID], "accessibilityLabel": title,
            "localizedNameKey": title, "previewImage": thumbnailURL.absoluteString,
            "url-4K-SDR-240FPS": movieURL.absoluteString, "includeInShuffle": false,
            "pointsOfInterest": [String: Any](), "preferredOrder": 0,
            "shotID": "QWALL_\(assetID)", "showInTopLevel": true]
        assets.insert(asset, at: 0)
        let subcategory: [String: Any] = ["id": subcategoryID, "localizedNameKey": "Qwall",
            "localizedDescriptionKey": "Qwall", "representativeAssetID": assetID,
            "previewImage": thumbnailURL.absoluteString, "preferredOrder": 0]
        let category: [String: Any] = ["id": categoryID, "localizedNameKey": "Qwall",
            "localizedDescriptionKey": "Qwall", "representativeAssetID": assetID,
            "previewImage": thumbnailURL.absoluteString, "preferredOrder": -1,
            "subcategories": [subcategory]]
        if let i = categories.firstIndex(where: { $0["id"] as? String == categoryID }) {
            categories[i] = category
        } else { categories.append(category) }
        root["assets"] = assets; root["categories"] = categories
        return try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
    }

    static func selectionData(original: Data, assetID: String, target: String) throws -> Data {
        guard UUID(uuidString: assetID) != nil, ["desktop", "lock", "both"].contains(target),
              let root = try PropertyListSerialization.propertyList(from: original, format: nil) as? [String: Any],
              root["AllSpacesAndDisplays"] is [String: Any] else {
            throw Failure(message: "The macOS wallpaper store has an unsupported format.")
        }
        let config = try PropertyListSerialization.data(fromPropertyList: ["assetID": assetID], format: .binary, options: 0)
        let options = try PropertyListSerialization.data(fromPropertyList: ["values": [String: Any]()], format: .binary, options: 0)
        let content: [String: Any] = ["Choices": [["Provider": provider, "Files": [Any](), "Configuration": config]],
                                      "Shuffle": "$null", "EncodedOptionValues": options]
        let wallpaper: [String: Any] = ["LastSet": Date(), "LastUse": Date(), "Content": content]
        var changed = 0
        func patch(_ value: Any) -> Any {
            if var node = value as? [String: Any] {
                if node["Type"] is String,
                   node["Desktop"] != nil || node["Idle"] != nil || node["Linked"] != nil {
                    if target == "both" {
                        node.removeValue(forKey: "Desktop"); node.removeValue(forKey: "Idle")
                        node["Type"] = "linked"; node["Linked"] = wallpaper
                    } else {
                        if let linked = node.removeValue(forKey: "Linked") {
                            node["Desktop"] = linked; node["Idle"] = linked
                        }
                        node["Type"] = "individual"
                        node[target == "lock" ? "Idle" : "Desktop"] = wallpaper
                    }
                    changed += 1
                    return node
                }
                for (key, child) in node { node[key] = patch(child) }
                return node
            }
            if let values = value as? [Any] { return values.map(patch) }
            return value
        }
        let result = patch(root)
        guard changed > 0 else { throw Failure(message: "No supported wallpaper selection was found.") }
        return try PropertyListSerialization.data(fromPropertyList: result, format: .binary, options: 0)
    }

    private static func semanticIndex(_ data: Data) throws -> Data {
        func clean(_ value: Any) -> Any {
            if let dict = value as? [String: Any] {
                return dict.filter { $0.key != "LastUse" && $0.key != "LastSet" }.mapValues(clean)
            }
            if let list = value as? [Any] { return list.map(clean) }
            return value
        }
        let root = try PropertyListSerialization.propertyList(from: data, format: nil)
        return try PropertyListSerialization.data(fromPropertyList: clean(root), format: .xml, options: 0)
    }

    static func transcode(source: URL, destination: URL) throws {
        let asset = AVURLAsset(url: source)
        guard let track = asset.tracks(withMediaType: .video).first else {
            throw Failure(message: "That file contains no readable video track.")
        }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange])
        guard reader.canAdd(output) else { throw Failure(message: "macOS cannot decode this video for the Lock Screen.") }
        reader.add(output)
        let size = track.naturalSize
        let writer = try AVAssetWriter(outputURL: destination, fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: max(2, Int(size.width) / 2 * 2),
            AVVideoHeightKey: max(2, Int(size.height) / 2 * 2),
            AVVideoCompressionPropertiesKey: [
                AVVideoProfileLevelKey: kVTProfileLevel_HEVC_Main10_AutoLevel,
                AVVideoAverageBitRateKey: 12_000_000,
                AVVideoMaxKeyFrameIntervalKey: 1,
                AVVideoAllowFrameReorderingKey: false]])
        input.transform = track.preferredTransform
        guard writer.canAdd(input) else { throw Failure(message: "This Mac cannot encode HEVC Main10 wallpapers.") }
        writer.add(input)
        guard writer.startWriting(), reader.startReading() else {
            throw writer.error ?? reader.error ?? Failure(message: "The wallpaper video conversion could not start.")
        }
        writer.startSession(atSourceTime: .zero)
        var frameCount = 0
        let deadline = Date().addingTimeInterval(600)
        do {
            while let sample = output.copyNextSampleBuffer() {
                while !input.isReadyForMoreMediaData {
                    guard writer.status == .writing, Date() < deadline else {
                        throw writer.error ?? Failure(message: "Wallpaper video conversion timed out.")
                    }
                    Thread.sleep(forTimeInterval: 0.005)
                }
                guard input.append(sample) else {
                    throw writer.error ?? Failure(message: "macOS could not encode a wallpaper frame.")
                }
                frameCount += 1
            }
            guard reader.status == .completed, frameCount > 0 else {
                throw reader.error ?? Failure(message: "The video could not be read completely.")
            }
            input.markAsFinished()
            let completion = DispatchSemaphore(value: 0)
            writer.finishWriting { completion.signal() }
            guard completion.wait(timeout: .now() + 120) == .success, writer.status == .completed else {
                throw writer.error ?? Failure(message: "Wallpaper video conversion did not finish.")
            }
        } catch {
            reader.cancelReading(); writer.cancelWriting(); throw error
        }
    }

    private static func thumbnail(video: URL, destination: URL) throws {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: video))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 640, height: 400)
        let image = try generator.copyCGImage(at: .zero, actualTime: nil)
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw Failure(message: "The wallpaper preview could not be created.")
        }
        try data.write(to: destination, options: .atomic)
    }

    private static func signal(_ name: String, _ action: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
        process.arguments = ["-u", NSUserName(), "-\(action)", name]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run(); process.waitUntilExit() } catch { /* No running agent is valid. */ }
    }
    private static func stopAgent() { signal("WallpaperAgent", "STOP") }
    private static func resumeAgent() { signal("WallpaperAgent", "CONT") }
    private static func restartRendering() {
        signal("WallpaperAgent", "TERM"); signal("WallpaperAerialsExtension", "TERM")
    }
}

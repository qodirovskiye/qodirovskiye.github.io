import AppKit
import Foundation

let folder = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let factor = CGFloat(pixels) / 1024
        let transform = NSAffineTransform(); transform.scale(by: factor); transform.concat()
        let square = NSBezierPath(roundedRect: NSRect(x: 25, y: 25, width: 974, height: 974), xRadius: 218, yRadius: 218)
        NSGradient(starting: NSColor(calibratedRed: 0.14, green: 0.19, blue: 0.28, alpha: 1), ending: NSColor(calibratedRed: 0.035, green: 0.06, blue: 0.11, alpha: 1))!.draw(in: square, angle: -90)
        NSColor(calibratedWhite: 1, alpha: 0.14).setStroke(); square.lineWidth = 4; square.stroke()
        let ring = NSBezierPath(ovalIn: NSRect(x: 228, y: 272, width: 568, height: 568))
        NSGradient(starting: NSColor(calibratedRed: 0.4, green: 0.88, blue: 1, alpha: 1), ending: NSColor(calibratedRed: 0.04, green: 0.42, blue: 1, alpha: 1))!.draw(in: ring, angle: -60)
        NSColor(calibratedRed: 0.075, green: 0.12, blue: 0.19, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 356, y: 400, width: 312, height: 312)).fill()
        let stem = NSBezierPath(roundedRect: NSRect(x: 659, y: 148, width: 137, height: 413), xRadius: 68, yRadius: 68)
        NSColor(calibratedRed: 0.08, green: 0.49, blue: 1, alpha: 1).setFill(); stem.fill()
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        try bitmap.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}

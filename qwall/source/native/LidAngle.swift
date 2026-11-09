import Foundation
import IOKit.hid

/// Uses the Apple lid sensor's HID feature report. Some Macs expose no readable sensor.
final class LidAngleSensor {
    private let manager: IOHIDManager
    private let device: IOHIDDevice
    private static let options = IOOptionBits(kIOHIDOptionsTypeNone)

    init?() {
        let options = Self.options
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, options)
        IOHIDManagerSetDeviceMatching(manager, [
            kIOHIDVendorIDKey: 0x05AC, kIOHIDProductIDKey: 0x8104,
            kIOHIDDeviceUsagePageKey: 0x20, kIOHIDDeviceUsageKey: 0x8A
        ] as CFDictionary)
        guard IOHIDManagerOpen(manager, options) == kIOReturnSuccess else { return nil }
        for device in IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> ?? [] {
            guard IOHIDDeviceOpen(device, options) == kIOReturnSuccess else { continue }
            if Self.read(device) != nil {
                self.manager = manager
                self.device = device
                return
            }
            IOHIDDeviceClose(device, options)
        }
        IOHIDManagerClose(manager, options)
        return nil
    }

    deinit {
        IOHIDDeviceClose(device, Self.options)
        IOHIDManagerClose(manager, Self.options)
    }

    func degrees() -> Double? { Self.read(device) }

    private static func read(_ device: IOHIDDevice) -> Double? {
        var report = [UInt8](repeating: 0, count: 8)
        var length = report.count
        let result = IOHIDDeviceGetReport(device, kIOHIDReportTypeFeature, 1, &report, &length)
        guard result == kIOReturnSuccess, length >= 3, report[0] == 1 else { return nil }
        let degrees = Double(UInt16(report[1]) | (UInt16(report[2]) << 8))
        return (0...180).contains(degrees) ? degrees : nil
    }
}

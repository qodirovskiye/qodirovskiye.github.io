import Foundation

func require(_ value: Bool, _ message: String) {
    if !value { fatalError(message) }
}
let assetID = "E41EE49F-8986-49EF-9B5D-D61A5E27501F"
let originalSurface: [String: Any] = ["Content": ["Choices": [["Provider": "original", "Configuration": Data("original".utf8), "Files": [Any]()]]]]
let selection: [String: Any] = ["Type": "individual", "Desktop": originalSurface, "Idle": originalSurface, "Unrelated": "keep"]
let root: [String: Any] = ["AllSpacesAndDisplays": selection, "SystemDefault": selection, "Spaces": ["fixture": ["Default": selection]], "Unrelated": "keep"]
let original = try PropertyListSerialization.data(fromPropertyList: root, format: .binary, options: 0)
for target in ["desktop", "lock", "both"] {
    let changed = try SystemWallpaper.selectionData(original: original, assetID: assetID, target: target)
    let result = try PropertyListSerialization.propertyList(from: changed, format: nil) as! [String: Any]
    let main = result["AllSpacesAndDisplays"] as! [String: Any]
    require(result["Unrelated"] as? String == "keep", "Root metadata lost")
    require(main["Unrelated"] as? String == "keep", "Selection metadata lost")
    if target == "both" {
        require(main["Type"] as? String == "linked", "Both must be linked")
        require(main["Linked"] != nil, "Linked surface missing")
    } else {
        let preserved = main[target == "lock" ? "Desktop" : "Idle"] as! [String: Any]
        require(NSDictionary(dictionary: preserved).isEqual(to: originalSurface), "Opposite surface modified")
    }
}
let manifest = try JSONSerialization.data(withJSONObject: ["assets": [["id": "original", "preserve": true]], "categories": [["id": "original"]], "unrelated": "keep"])
let catalog = try SystemWallpaper.catalogData(original: manifest, assetID: assetID, movieURL: URL(fileURLWithPath: "/tmp/Qwall test.mov"), thumbnailURL: URL(fileURLWithPath: "/tmp/Qwall test.png"), title: "Test")
let result = try JSONSerialization.jsonObject(with: catalog) as! [String: Any]
let assets = result["assets"] as! [[String: Any]]
require(assets.count == 2, "Original asset removed")
require(assets[1]["preserve"] as? Bool == true, "Original asset changed")
require((assets[0]["url-4K-SDR-240FPS"] as! String).contains("%20"), "File URL incorrectly encoded")
do {
    _ = try SystemWallpaper.selectionData(original: original, assetID: assetID, target: "invalid")
    fatalError("Invalid target accepted")
} catch {}
print("PASS: desktop, lock, both, opposite surface preservation, catalog preservation, file URL encoding, invalid target rejection")

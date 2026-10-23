import AppKit
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(red: 0.16, green: 0.20, blue: 0.17, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 190, yRadius: 190).fill()
let style: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedSystemFont(ofSize: 630, weight: .bold), .foregroundColor: NSColor(red: 0.95, green: 0.94, blue: 0.90, alpha: 1)]
("H" as NSString).draw(at: NSPoint(x: 200, y: 142), withAttributes: style)
NSColor(red: 0.88, green: 0.69, blue: 0.39, alpha: 1).setFill()
NSBezierPath(rect: NSRect(x: 618, y: 218, width: 170, height: 48)).fill()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))

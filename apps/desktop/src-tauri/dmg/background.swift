// Run from the repository root: swift apps/desktop/src-tauri/dmg/background.swift
import AppKit

let width = 720
let height = 440
let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let context = NSGraphicsContext.current!.cgContext
context.translateBy(x: 0, y: CGFloat(height))
context.scaleBy(x: 1, y: -1)

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat) -> NSColor {
    NSColor(srgbRed: red / 255, green: green / 255, blue: blue / 255, alpha: 1)
}

color(250, 250, 249).setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

func text(_ value: String, x: CGFloat, y: CGFloat, size: CGFloat,
          weight: NSFont.Weight, ink: NSColor) {
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: ink,
    ]
    let line = NSAttributedString(string: value, attributes: attributes)
    // Text stays upright in the top-left coordinate system used by the layout.
    context.saveGState()
    context.translateBy(x: x, y: y + line.size().height)
    context.scaleBy(x: 1, y: -1)
    line.draw(at: .zero)
    context.restoreGState()
}

text("70+ languages. Just a drag away.", x: 48, y: 42, size: 30, weight: .semibold, ink: color(27, 27, 26))
text("Drag Interprète to Applications, then open it to start talking.", x: 49, y: 86,
     size: 14, weight: .regular, ink: color(107, 107, 102))

color(211, 58, 12).setStroke()
let arrow = NSBezierPath()
arrow.lineWidth = 4
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: 292, y: 248))
arrow.curve(to: NSPoint(x: 428, y: 226),
            controlPoint1: NSPoint(x: 326, y: 184),
            controlPoint2: NSPoint(x: 389, y: 182))
arrow.move(to: NSPoint(x: 408, y: 221))
arrow.line(to: NSPoint(x: 428, y: 226))
arrow.line(to: NSPoint(x: 425, y: 206))
arrow.stroke()

NSGraphicsContext.restoreGraphicsState()
let data = bitmap.representation(using: .png, properties: [:])!
precondition(NSBitmapImageRep(data: data)?.pixelsWide == width)
let destination = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("background.png")
try data.write(to: destination)

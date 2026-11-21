import AppKit

let S = 1024
let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: S, pixelsHigh: S,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
    isPlanar: false, colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
ctx.setAllowsAntialiasing(true)
ctx.setShouldAntialias(true)

func rgb(_ hex: String) -> NSColor {
    let v = UInt32(hex, radix: 16)!
    return NSColor(
        calibratedRed: CGFloat((v >> 16) & 0xFF) / 255,
        green: CGFloat((v >> 8) & 0xFF) / 255,
        blue: CGFloat(v & 0xFF) / 255, alpha: 1
    )
}

// 背景圆角方块
let bg = NSBezierPath(roundedRect: NSRect(x: 52, y: 52, width: 920, height: 920),
                      xRadius: 212, yRadius: 212)
let bgGrad = NSGradient(colors: [rgb("7d97ff"), rgb("8f8bff"), rgb("b18cff")],
                        atLocations: [0, 0.55, 1], colorSpace: .deviceRGB)!
bgGrad.draw(in: bg, angle: -55)

// 顶部柔光
NSGraphicsContext.saveGraphicsState()
bg.addClip()
let sheen = NSGradient(colors: [NSColor(calibratedWhite: 1, alpha: 0.32),
                                NSColor(calibratedWhite: 1, alpha: 0.03),
                                NSColor(calibratedWhite: 1, alpha: 0)],
                       atLocations: [0, 0.5, 1], colorSpace: .deviceRGB)!
sheen.draw(in: NSRect(x: 52, y: 512, width: 920, height: 460), angle: -90)
NSGraphicsContext.restoreGraphicsState()

// 锁梁
let shackle = NSBezierPath()
shackle.move(to: NSPoint(x: 392, y: 500))
shackle.line(to: NSPoint(x: 392, y: 624))
shackle.appendArc(withCenter: NSPoint(x: 512, y: 624), radius: 120,
                  startAngle: 180, endAngle: 0, clockwise: true)
shackle.line(to: NSPoint(x: 632, y: 500))
shackle.lineWidth = 76
shackle.lineCapStyle = .round
shackle.lineJoinStyle = .round
NSColor(calibratedWhite: 1, alpha: 1).setStroke()
shackle.stroke()

// 锁体
let body = NSBezierPath(roundedRect: NSRect(x: 316, y: 224, width: 392, height: 304),
                        xRadius: 76, yRadius: 76)
let bodyGrad = NSGradient(colors: [NSColor(calibratedWhite: 1, alpha: 1),
                                   rgb("e6eaff")],
                          atLocations: [0, 1], colorSpace: .deviceRGB)!
bodyGrad.draw(in: body, angle: -90)

// 钥匙孔
rgb("8b8fff").setFill()
NSBezierPath(ovalIn: NSRect(x: 482, y: 368, width: 60, height: 60)).fill()
NSBezierPath(roundedRect: NSRect(x: 496, y: 306, width: 32, height: 76),
             xRadius: 16, yRadius: 16).fill()

NSGraphicsContext.restoreGraphicsState()

let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
print("wrote \(CommandLine.arguments[1]) \(rep.pixelsWide)x\(rep.pixelsHigh)")

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let specURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outURL = URL(fileURLWithPath: CommandLine.arguments[2])
let spec = try! JSONSerialization.jsonObject(with: Data(contentsOf: specURL)) as! [String: Any]
let W = spec["w"] as! Int, H = spec["h"] as! Int
let cs = CGColorSpaceCreateDeviceRGB()
let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                    space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
var truth: [[String: Any]] = []
for raw in spec["items"] as! [[String: Any]] {
  let text = raw["text"] as! String
  let size = CGFloat(raw["size"] as! Double)
  let cx = CGFloat(raw["cx"] as! Double)
  let cyTop = CGFloat(raw["cy"] as! Double)
  let font = CTFontCreateWithName((raw["font"] as? String ?? "Helvetica") as CFString, size, nil)
  let attr = NSAttributedString(string: text, attributes: [
    kCTFontAttributeName as NSAttributedString.Key: font,
    kCTForegroundColorAttributeName as NSAttributedString.Key: CGColor(red: 0, green: 0, blue: 0, alpha: 1),
  ])
  let line = CTLineCreateWithAttributedString(attr)
  let b = CTLineGetBoundsWithOptions(line, .useOpticalBounds)
  let ox = cx - (b.origin.x + b.width / 2)
  let oy = (CGFloat(H) - cyTop) - (b.origin.y + b.height / 2)
  ctx.textPosition = CGPoint(x: ox, y: oy)
  CTLineDraw(line, ctx)
  truth.append(["text": text, "centerPx": ["x": cx, "y": cyTop]])
}
let img = ctx.makeImage()!
let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, img, nil)
CGImageDestinationFinalize(dest)
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ["items": truth], options: [.sortedKeys]))

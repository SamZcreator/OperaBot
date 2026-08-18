// The bot's face — the same silhouette the desktop draws.
//
// The desktop renders Blob Studio's "cursor" mascot from an SVG path
// (`src/components/CursorAvatar.tsx`, `SHAPE.body`). The phone used to draw a
// rounded blob instead, which meant a bot you know by its shape looked like a
// different bot on the two screens. This is that path, verbatim.
//
// Verbatim is the point: the alternative is redrawing it by eye, which starts
// close and drifts every time either side is touched. Copied here rather than
// generated at build time because the phone app has no build step that could
// read the web source, and a 4KB string is a cheap thing to keep in sync by
// hand — it has changed once in the life of this project.
//
// What is NOT copied: the desktop's 25 expressions, blinking, gaze tracking
// and motion. A 28-point avatar in a list is a silhouette and two eyes; the
// animation engine is 1,600 lines and would show up as nothing at this size.
import SwiftUI

enum MasquePalette {
    /// src/lib/mascot.ts — MASQUE_COLORS
    private static let hex: [String: String] = [
        "green": "#009957",
        "blue": "#377FE6",
        "red": "#D94B52",
        "orange": "#E78531",
        "purple": "#8057C8",
        "cyan": "#0EA5C6",
        "pink": "#D84F8B",
        "yellow": "#D8A729",
        "teal": "#01A492",
        "coral": "#E5634E",
    ]

    static func color(_ name: String) -> Color {
        Color(hex: hex[name] ?? "#8E8E93")
    }

}

/// The mascot silhouette, as an SVG path. Absolute `M`, `C` and `Z` only —
/// which is what makes the parser below twenty lines rather than a library.
enum MasqueSilhouette {
    static let path =
        """
        M 34.041 54 C 40.041 34 70.041 22 114.2705 22 C 158.5 22 188.5 34 194.5 54 C 200 84 197 120 188 148 C 176 184 148 210 114.2705 214 C 80.541 210 52.541 184 40.541 148 C 31.541 120 28.541 84 34.041 54 Z
        """

    /// The parsed silhouette, in its own coordinate space. Parsed once.
    ///
    /// This is a four-kilobyte string and a character-at-a-time parser, and
    /// the shape it produces never changes — but a chat list is hundreds of
    /// avatars, each redrawn on scroll, and running the parser inside `Canvas`
    /// ran it for every one of them on every frame. `static let` is lazy and
    /// evaluated exactly once, so what is left per draw is the affine
    /// transform below, which is the only part that depends on the rect.
    private static let parsed: Path = parse()

    /// Its bounding box, cached alongside — `boundingRect` walks the path.
    private static let parsedBounds: CGRect = parsed.boundingRect

    /// The silhouette normalised to fill `rect`, preserving aspect.
    ///
    /// The desktop maps this through a `fit` transform into a 228.541-unit
    /// face box. That is not reproduced: normalising to the actual bounds is
    /// equivalent for a shape drawn on its own, and it does not go stale if
    /// the artwork's framing changes.
    static func path(in rect: CGRect) -> Path {
        let bounds = parsedBounds
        guard bounds.width > 0, bounds.height > 0 else { return parsed }
        let scale = min(rect.width / bounds.width, rect.height / bounds.height)
        return parsed.applying(
            CGAffineTransform(translationX: -bounds.midX, y: -bounds.midY)
                .concatenating(CGAffineTransform(scaleX: scale, y: scale))
                .concatenating(CGAffineTransform(translationX: rect.midX, y: rect.midY))
        )
    }

    /// The SVG path data, once, into a `Path`. Only `M`, `C` and `Z` appear in
    /// the artwork, so only those are understood.
    private static func parse() -> Path {
        var raw = Path()
        var numbers: [CGFloat] = []
        var command: Character?
        var current = CGPoint.zero

        func flush() {
            guard let command else { return }
            switch command {
            case "M":
                guard numbers.count >= 2 else { break }
                current = CGPoint(x: numbers[0], y: numbers[1])
                raw.move(to: current)
            case "C":
                // several curves may follow one C, six numbers each
                var i = 0
                while i + 5 < numbers.count {
                    let to = CGPoint(x: numbers[i + 4], y: numbers[i + 5])
                    raw.addCurve(
                        to: to,
                        control1: CGPoint(x: numbers[i], y: numbers[i + 1]),
                        control2: CGPoint(x: numbers[i + 2], y: numbers[i + 3])
                    )
                    current = to
                    i += 6
                }
            default:
                break
            }
            numbers.removeAll()
        }

        var token = ""
        func takeNumber() {
            if !token.isEmpty, let value = Double(token) { numbers.append(CGFloat(value)) }
            token = ""
        }

        for character in path {
            if character.isNumber || character == "." || character == "e" {
                token.append(character)
            } else if character == "-" {
                // a minus starts a new number unless it is an exponent sign
                if token.hasSuffix("e") { token.append(character) } else { takeNumber(); token = "-" }
            } else if character == " " || character == "," || character == "\n" {
                takeNumber()
            } else if character == "Z" || character == "z" {
                takeNumber(); flush(); raw.closeSubpath(); command = nil
            } else {
                takeNumber(); flush(); command = character
            }
        }
        takeNumber()
        flush()
        return raw
    }
}

/// A bot, at whatever size the row needs.
struct MasqueAvatar: View {
    let color: String
    var size: CGFloat = 52

    var body: some View {
        Canvas { context, canvasSize in
            let rect = CGRect(origin: .zero, size: canvasSize)
            let body = MasqueSilhouette.path(in: rect)
            context.fill(body, with: .linearGradient(
                Gradient(stops: MasquePalette.gradientStops(color)),
                startPoint: CGPoint(x: rect.maxX, y: rect.minY),
                endPoint: CGPoint(x: rect.minX, y: rect.maxY)
            ))

            // Eyes and brows, at the desktop mask's face anchor expressed as
            // fractions of the silhouette's own bounding box (171.5 x 192),
            // which is what `path(in:)` normalises to — not the 228.541 face box
            // the desktop uses. Dark rather than white: on a mask
            // the features read as openings, and white ones turn it back into
            // a creature. The brows are what make it read as a mask at all,
            // so they are drawn even at this size.
            let eyeWidth = canvasSize.width * 0.1276
            let eyeHeight = eyeWidth * 1.637
            let gap = eyeWidth * 2.122
            let cx = rect.minX + canvasSize.width * 0.500
            let cy = rect.minY + canvasSize.height * 0.5417
            for dx in [-gap / 2, gap / 2] {
                let eye = Path(
                    roundedRect: CGRect(
                        x: cx + dx - eyeWidth / 2,
                        y: cy - eyeHeight / 2,
                        width: eyeWidth,
                        height: eyeHeight
                    ),
                    cornerRadius: eyeWidth / 2
                )
                context.fill(eye, with: .color(.black.opacity(0.58)))
            }

            let w = canvasSize.width, h = canvasSize.height
            for mirrored in [false, true] {
                let fx: (CGFloat) -> CGFloat = { mirrored ? 1 - $0 : $0 }
                var brow = Path()
                brow.move(to: CGPoint(x: rect.minX + w * fx(0.2069), y: rect.minY + h * 0.3750))
                brow.addQuadCurve(
                    to: CGPoint(x: rect.minX + w * fx(0.4673), y: rect.minY + h * 0.3333),
                    control: CGPoint(x: rect.minX + w * fx(0.3319), y: rect.minY + h * 0.2500)
                )
                context.stroke(
                    brow,
                    with: .color(.black.opacity(0.34)),
                    style: StrokeStyle(lineWidth: w * 0.0625, lineCap: .round)
                )
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The person, not a bot — the roster header and the settings row. A letter
/// rather than a mascot, deliberately: the mascots mean "this is a bot", and
/// giving the human one too would blur the only distinction the roster makes.
struct ProfileAvatar: View {
    let name: String
    var size: CGFloat = 34

    var body: some View {
        Circle()
            .fill(MasquePalette.color("green"))
            .frame(width: size, height: size)
            .overlay {
                Text(initial)
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(.white)
            }
    }

    private var initial: String {
        String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
    }
}

extension MasquePalette {
    /// The gradient as raw stops, for `Canvas`, which cannot take a
    /// `LinearGradient` directly.
    static func gradientStops(_ name: String) -> [Gradient.Stop] {
        let base = color(name)
        return [
            .init(color: base.mixed(with: .white, amount: 0.55), location: 0),
            .init(color: base, location: 0.55),
            .init(color: base.mixed(with: .black, amount: 0.42), location: 1),
        ]
    }
}

extension Color {
    init(hex: String) {
        var value: UInt64 = 0
        Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&value)
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }

    /// Linear mix in sRGB, matching the `mix()` the desktop uses to build its
    /// gradient stops. Not perceptually correct, and deliberately so: the
    /// point is to land on the same colours as the other screen.
    func mixed(with other: Color, amount: Double) -> Color {
        #if canImport(UIKit)
        let a = UIColor(self), b = UIColor(other)
        var ar: CGFloat = 0, ag: CGFloat = 0, ab: CGFloat = 0, aa: CGFloat = 0
        var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
        a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
        b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
        let t = CGFloat(amount)
        return Color(
            .sRGB,
            red: Double(ar + (br - ar) * t),
            green: Double(ag + (bg - ag) * t),
            blue: Double(ab + (bb - ab) * t),
            opacity: 1
        )
        #else
        return self
        #endif
    }
}

#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent / "Barakah_Brand_Assets_v1"
EXPORT_SPECS: dict[Path, tuple[Path, int | None, int | None]] = {}

COLORS = {
    "barakah_emerald": "#0B6B57",
    "midnight_green": "#102A43",
    "warm_ivory": "#F7F8F4",
    "white": "#FFFFFF",
    "charcoal": "#17211D",
    "muted_slate": "#5E6C65",
    "barakah_gold": "#D6B15B",
    "soft_mint": "#E3F3ED",
    "soft_sand": "#F5EEDC",
    "cool_border": "#DCE5E1",
    "income": "#087A62",
    "expense": "#B5473A",
    "receivable": "#2F6FED",
    "payable": "#8A5A1E",
    "zakat": "#7A4FB3",
    "warning": "#B86E00",
    "critical": "#B42318",
    "dark_background": "#071915",
    "dark_surface": "#0E2721",
    "dark_primary": "#5DDBB7",
}


def ensure_dirs() -> None:
    for name in [
        "01_Logos/SVG",
        "01_Logos/PNG_4K",
        "02_App_Icons/Android",
        "02_App_Icons/PWA",
        "03_Splash",
        "04_Web",
        "05_Social",
        "06_Brand_Guidelines",
        "07_Developer",
        "08_Source",
    ]:
        (ROOT / name).mkdir(parents=True, exist_ok=True)


def svg_document(viewbox: str, body: str, width: str | None = None, height: str | None = None) -> str:
    attrs = f' width="{width}" height="{height}"' if width and height else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}"{attrs} '
        'role="img" aria-labelledby="title desc">\n'
        '<title id="title">Barakah brand asset</title>\n'
        '<desc id="desc">Geometric Barakah B mark with a growth leaf and balanced ledger form.</desc>\n'
        f'{body}\n</svg>\n'
    )


def symbol_group(background: str = COLORS["barakah_emerald"], mark: str = COLORS["white"], gold: str = COLORS["barakah_gold"], include_tile: bool = True) -> str:
    tile = f'<rect x="72" y="72" width="880" height="880" rx="220" fill="{background}"/>' if include_tile else ""
    return f'''<g id="barakah-symbol">
  {tile}
  <path d="M330 238 V678 C330 792 414 856 520 856 C632 856 710 782 710 682 C710 580 632 506 522 506 H330"
        fill="none" stroke="{mark}" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M489 421 C522 326 607 291 674 318 C645 402 574 450 489 421 Z" fill="{gold}"/>
  <path d="M510 411 C555 378 598 350 651 326" fill="none" stroke="{background}" stroke-width="14" stroke-linecap="round"/>
  <path d="M274 608 H392 M274 674 H392" fill="none" stroke="{gold}" stroke-width="22" stroke-linecap="round"/>
</g>'''


def wordmark_group(color: str = COLORS["charcoal"], stroke: float = 14) -> str:
    # Custom monoline geometric wordmark; no external font dependency.
    return f'''<g id="barakah-wordmark" fill="none" stroke="{color}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 18 V126 M18 78 C18 50 39 34 64 34 C92 34 110 54 110 80 C110 107 91 126 63 126 C37 126 18 108 18 82"/>
  <path d="M139 80 C139 53 158 34 185 34 C213 34 231 54 231 80 C231 107 212 126 185 126 C158 126 139 107 139 80 Z M231 36 V126"/>
  <path d="M267 36 V126 M267 71 C270 48 287 35 310 35"/>
  <path d="M340 80 C340 53 359 34 386 34 C414 34 432 54 432 80 C432 107 413 126 386 126 C359 126 340 107 340 80 Z M432 36 V126"/>
  <path d="M470 18 V126 M470 85 L520 35 M483 72 L527 126"/>
  <path d="M552 80 C552 53 571 34 598 34 C626 34 644 54 644 80 C644 107 625 126 598 126 C571 126 552 107 552 80 Z M644 36 V126"/>
  <path d="M681 18 V126 M681 74 C681 50 699 34 722 34 C746 34 760 51 760 76 V126"/>
</g>'''


def write_svg(relative: str, viewbox: str, body: str, width: str | None = None, height: str | None = None) -> Path:
    path = ROOT / relative
    path.write_text(svg_document(viewbox, body, width, height), encoding="utf-8")
    return path


def export_png(svg: Path, png: Path, width: int | None = None, height: int | None = None) -> None:
    png.parent.mkdir(parents=True, exist_ok=True)
    EXPORT_SPECS[png] = (svg, width, height)
    last_error: OSError | None = None
    for attempt in range(3):
        png.unlink(missing_ok=True)
        cmd = ["inkscape", "--batch-process", str(svg), "--export-type=png", f"--export-filename={png}"]
        if width:
            cmd.append(f"--export-width={width}")
        if height:
            cmd.append(f"--export-height={height}")
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                with Image.open(png) as image:
                    image.load()
                return
            except OSError as error:
                last_error = error
                time.sleep(.1)
    raise RuntimeError(f"Could not produce a valid PNG: {png}") from last_error


def validate_png_exports() -> None:
    last_invalid: list[tuple[Path, OSError]] = []
    for _ in range(3):
        last_invalid = []
        for path in ROOT.rglob("*.png"):
            try:
                with Image.open(path) as image:
                    image.load()
            except OSError as error:
                last_invalid.append((path, error))
        if not last_invalid:
            return
        for path, _ in last_invalid:
            svg, width, height = EXPORT_SPECS[path]
            repair = path.with_name(f"{path.stem}.repair.png")
            repair.unlink(missing_ok=True)
            cmd = ["inkscape", "--batch-process", str(svg), "--export-type=png", f"--export-filename={repair}"]
            if width:
                cmd.append(f"--export-width={width}")
            if height:
                cmd.append(f"--export-height={height}")
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(4)
            with Image.open(repair) as image:
                image.load()
            repair.replace(path)
        time.sleep(2)
    details = "\n".join(f"{path.relative_to(ROOT)}: {error}" for path, error in last_invalid)
    raise RuntimeError("Invalid PNG exports after repair:\n" + details)


def make_logo_assets() -> dict[str, Path]:
    logos: dict[str, Path] = {}
    logos["symbol_primary"] = write_svg("01_Logos/SVG/barakah-symbol-primary.svg", "0 0 1024 1024", symbol_group())
    logos["symbol_reverse"] = write_svg(
        "01_Logos/SVG/barakah-symbol-reverse.svg", "0 0 1024 1024",
        symbol_group(COLORS["warm_ivory"], COLORS["barakah_emerald"], COLORS["barakah_gold"]),
    )
    logos["symbol_mono_dark"] = write_svg(
        "01_Logos/SVG/barakah-symbol-mono-dark.svg", "0 0 1024 1024",
        symbol_group(COLORS["charcoal"], COLORS["white"], COLORS["white"]),
    )
    logos["symbol_mono_light"] = write_svg(
        "01_Logos/SVG/barakah-symbol-mono-light.svg", "0 0 1024 1024",
        symbol_group(COLORS["white"], COLORS["charcoal"], COLORS["charcoal"]),
    )
    logos["wordmark_dark"] = write_svg("01_Logos/SVG/barakah-wordmark-dark.svg", "0 0 780 145", wordmark_group())
    logos["wordmark_light"] = write_svg("01_Logos/SVG/barakah-wordmark-light.svg", "0 0 780 145", wordmark_group(COLORS["white"]))

    horizontal_body = f'''<rect width="1800" height="520" fill="none"/>
<g transform="translate(42 24) scale(.46)">{symbol_group()}</g>
<g transform="translate(570 178) scale(1.48)">{wordmark_group()}</g>'''
    logos["horizontal"] = write_svg("01_Logos/SVG/barakah-logo-horizontal.svg", "0 0 1800 520", horizontal_body)

    horizontal_reverse = f'''<rect width="1800" height="520" fill="{COLORS['midnight_green']}"/>
<g transform="translate(42 24) scale(.46)">{symbol_group()}</g>
<g transform="translate(570 178) scale(1.48)">{wordmark_group(COLORS['white'])}</g>'''
    logos["horizontal_reverse"] = write_svg("01_Logos/SVG/barakah-logo-horizontal-reverse.svg", "0 0 1800 520", horizontal_reverse)

    stacked = f'''<rect width="1200" height="1400" fill="none"/>
<g transform="translate(240 70) scale(.70)">{symbol_group()}</g>
<g transform="translate(180 1050) scale(1.08)">{wordmark_group()}</g>'''
    logos["stacked"] = write_svg("01_Logos/SVG/barakah-logo-stacked.svg", "0 0 1200 1400", stacked)

    stacked_reverse = f'''<rect width="1200" height="1400" fill="{COLORS['midnight_green']}"/>
<g transform="translate(240 70) scale(.70)">{symbol_group()}</g>
<g transform="translate(180 1050) scale(1.08)">{wordmark_group(COLORS['white'])}</g>'''
    logos["stacked_reverse"] = write_svg("01_Logos/SVG/barakah-logo-stacked-reverse.svg", "0 0 1200 1400", stacked_reverse)

    for key, svg in logos.items():
        if key.startswith("wordmark"):
            width = 4096
        elif key.startswith("horizontal"):
            width = 4096
        else:
            width = 4096
        export_png(svg, ROOT / f"01_Logos/PNG_4K/{svg.stem}-4096.png", width=width)
    return logos


def make_icons(symbol_svg: Path) -> None:
    export_png(symbol_svg, ROOT / "02_App_Icons/Android/app-icon-1024.png", width=1024)
    export_png(symbol_svg, ROOT / "02_App_Icons/Android/app-icon-2048.png", width=2048)
    export_png(symbol_svg, ROOT / "02_App_Icons/Android/app-icon-4096.png", width=4096)

    foreground_body = f'''<rect width="1024" height="1024" fill="none"/>
<g transform="translate(128 128) scale(.75)">{symbol_group(include_tile=False)}</g>'''
    fg = write_svg("02_App_Icons/Android/adaptive-icon-foreground.svg", "0 0 1024 1024", foreground_body)
    export_png(fg, ROOT / "02_App_Icons/Android/adaptive-icon-foreground-1024.png", width=1024)

    mono_body = f'''<rect width="1024" height="1024" fill="none"/>
<g transform="translate(128 128) scale(.75)">{symbol_group(mark='#000000', gold='#000000', include_tile=False)}</g>'''
    mono = write_svg("02_App_Icons/Android/monochrome-icon.svg", "0 0 1024 1024", mono_body)
    export_png(mono, ROOT / "02_App_Icons/Android/monochrome-icon-1024.png", width=1024)

    notification_body = '''<rect width="512" height="512" fill="none"/>
<path d="M148 92 V330 C148 390 192 424 248 424 C308 424 350 384 350 330 C350 276 308 236 250 236 H148" fill="none" stroke="#FFFFFF" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M231 194 C250 144 298 124 336 140 C318 187 279 211 231 194 Z" fill="#FFFFFF"/>'''
    notif = write_svg("02_App_Icons/Android/notification-icon.svg", "0 0 512 512", notification_body)
    export_png(notif, ROOT / "02_App_Icons/Android/notification-icon-512.png", width=512)
    (ROOT / "02_App_Icons/Android/adaptive-icon-background.txt").write_text(COLORS["barakah_emerald"] + "\n", encoding="utf-8")

    for size in (192, 512, 1024):
        export_png(symbol_svg, ROOT / f"02_App_Icons/PWA/icon-{size}.png", width=size)
    maskable_body = f'''<rect width="1024" height="1024" fill="{COLORS['barakah_emerald']}"/>
<g transform="translate(128 128) scale(.75)">{symbol_group(include_tile=False)}</g>'''
    maskable = write_svg("02_App_Icons/PWA/maskable-icon.svg", "0 0 1024 1024", maskable_body)
    for size in (192, 512, 1024):
        export_png(maskable, ROOT / f"02_App_Icons/PWA/maskable-icon-{size}.png", width=size)


def make_splash() -> None:
    light = f'''<rect width="1440" height="3200" fill="{COLORS['warm_ivory']}"/>
<circle cx="720" cy="1380" r="330" fill="{COLORS['soft_mint']}"/>
<g transform="translate(400 1060) scale(.625)">{symbol_group()}</g>
<g transform="translate(325 2045) scale(1.02)">{wordmark_group()}</g>
<text x="720" y="2280" text-anchor="middle" fill="{COLORS['muted_slate']}" font-family="sans-serif" font-size="42" letter-spacing="3">PRIVATE • CLEAR • PURPOSEFUL</text>'''
    dark = f'''<rect width="1440" height="3200" fill="{COLORS['dark_background']}"/>
<circle cx="720" cy="1380" r="330" fill="{COLORS['dark_surface']}"/>
<g transform="translate(400 1060) scale(.625)">{symbol_group()}</g>
<g transform="translate(325 2045) scale(1.02)">{wordmark_group(COLORS['white'])}</g>
<text x="720" y="2280" text-anchor="middle" fill="#B8C8C1" font-family="sans-serif" font-size="42" letter-spacing="3">PRIVATE • CLEAR • PURPOSEFUL</text>'''
    light_svg = write_svg("03_Splash/splash-light.svg", "0 0 1440 3200", light)
    dark_svg = write_svg("03_Splash/splash-dark.svg", "0 0 1440 3200", dark)
    export_png(light_svg, ROOT / "03_Splash/splash-light-1440x3200.png", width=1440, height=3200)
    export_png(dark_svg, ROOT / "03_Splash/splash-dark-1440x3200.png", width=1440, height=3200)


def make_web_and_social(symbol_svg: Path) -> None:
    shutil.copy2(symbol_svg, ROOT / "04_Web/favicon.svg")
    for size in (16, 32, 48, 180, 512):
        name = "apple-touch-icon-180.png" if size == 180 else f"favicon-{size}.png"
        export_png(symbol_svg, ROOT / f"04_Web/{name}", width=size)
    subprocess.run(
        ["convert", str(ROOT / "04_Web/favicon-16.png"), str(ROOT / "04_Web/favicon-32.png"), str(ROOT / "04_Web/favicon-48.png"), str(ROOT / "04_Web/favicon.ico")],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    og = f'''<rect width="2400" height="1260" fill="{COLORS['warm_ivory']}"/>
<circle cx="2050" cy="150" r="620" fill="{COLORS['soft_mint']}"/>
<circle cx="2250" cy="1160" r="520" fill="{COLORS['soft_sand']}"/>
<g transform="translate(160 165) scale(.88)">{symbol_group()}</g>
<g transform="translate(1050 350) scale(1.42)">{wordmark_group()}</g>
<text x="1055" y="650" fill="{COLORS['barakah_emerald']}" font-family="sans-serif" font-size="64" font-weight="600">Private Islamic money management</text>
<text x="1055" y="755" fill="{COLORS['muted_slate']}" font-family="sans-serif" font-size="42">Income • Expenses • Debts • Zakat • Private Backup</text>
<rect x="1055" y="860" width="615" height="104" rx="52" fill="{COLORS['barakah_emerald']}"/>
<text x="1362" y="928" text-anchor="middle" fill="white" font-family="sans-serif" font-size="36" font-weight="600">barakah.money</text>'''
    og_svg = write_svg("04_Web/social-share-2x.svg", "0 0 2400 1260", og)
    export_png(og_svg, ROOT / "04_Web/social-share-2400x1260.png", width=2400, height=1260)

    profile = write_svg(
        "05_Social/profile-avatar.svg", "0 0 2048 2048",
        f'<g transform="scale(2)">{symbol_group()}</g>',
    )
    export_png(profile, ROOT / "05_Social/profile-avatar-2048.png", width=2048)
    launch = f'''<rect width="2160" height="2160" fill="{COLORS['midnight_green']}"/>
<circle cx="1840" cy="280" r="620" fill="{COLORS['barakah_emerald']}" opacity=".30"/>
<circle cx="260" cy="1980" r="650" fill="{COLORS['barakah_gold']}" opacity=".10"/>
<g transform="translate(570 250) scale(1.0)">{symbol_group()}</g>
<g transform="translate(690 1390) scale(1.0)">{wordmark_group(COLORS['white'])}</g>
<text x="1080" y="1720" text-anchor="middle" fill="#B8C8C1" font-family="sans-serif" font-size="54">Private money management, with purpose.</text>'''
    launch_svg = write_svg("05_Social/launch-template.svg", "0 0 2160 2160", launch)
    export_png(launch_svg, ROOT / "05_Social/launch-template-2160.png", width=2160)


def make_guidelines(logos: dict[str, Path]) -> None:
    palette_x = [155, 455, 755, 1055, 1355, 1655]
    palette_items = [
        ("Emerald", COLORS["barakah_emerald"]),
        ("Midnight", COLORS["midnight_green"]),
        ("Ivory", COLORS["warm_ivory"]),
        ("Charcoal", COLORS["charcoal"]),
        ("Gold", COLORS["barakah_gold"]),
        ("Mint", COLORS["soft_mint"]),
    ]
    swatches = []
    for x, (name, value) in zip(palette_x, palette_items):
        border = COLORS["cool_border"] if value in (COLORS["warm_ivory"], COLORS["soft_mint"]) else value
        swatches.append(f'<circle cx="{x}" cy="1645" r="92" fill="{value}" stroke="{border}" stroke-width="4"/>')
        swatches.append(f'<text x="{x}" y="1785" text-anchor="middle" fill="{COLORS["charcoal"]}" font-family="sans-serif" font-size="35" font-weight="600">{name}</text>')
        swatches.append(f'<text x="{x}" y="1835" text-anchor="middle" fill="{COLORS["muted_slate"]}" font-family="monospace" font-size="28">{value}</text>')
    board = f'''<rect width="3840" height="2160" fill="{COLORS['warm_ivory']}"/>
<rect x="0" y="0" width="3840" height="200" fill="{COLORS['midnight_green']}"/>
<text x="155" y="128" fill="white" font-family="sans-serif" font-size="72" font-weight="700">BARAKAH — BRAND SYSTEM v1</text>
<text x="155" y="350" fill="{COLORS['barakah_emerald']}" font-family="sans-serif" font-size="46" font-weight="700">PRIMARY MARK</text>
<g transform="translate(120 390) scale(.82)">{symbol_group()}</g>
<g transform="translate(1150 650) scale(1.65)">{wordmark_group()}</g>
<text x="1150" y="1090" fill="{COLORS['muted_slate']}" font-family="sans-serif" font-size="50">Private Islamic money management</text>
<rect x="2480" y="360" width="1120" height="820" rx="70" fill="{COLORS['midnight_green']}"/>
<g transform="translate(2650 370) scale(.65)">{symbol_group()}</g>
<g transform="translate(2680 975) scale(1.02)">{wordmark_group(COLORS['white'])}</g>
<text x="155" y="1445" fill="{COLORS['barakah_emerald']}" font-family="sans-serif" font-size="46" font-weight="700">COLOUR PALETTE</text>
{''.join(swatches)}
<text x="2180" y="1510" fill="{COLORS['barakah_emerald']}" font-family="sans-serif" font-size="46" font-weight="700">DESIGN PRINCIPLES</text>
<text x="2180" y="1635" fill="{COLORS['charcoal']}" font-family="sans-serif" font-size="42">Calm • Private • Clear • Responsible</text>
<text x="2180" y="1720" fill="{COLORS['muted_slate']}" font-family="sans-serif" font-size="34">Minimal geometry · restrained gold · generous space</text>
<text x="2180" y="1790" fill="{COLORS['muted_slate']}" font-family="sans-serif" font-size="34">No mosque, crescent, currency sign or transfer imagery</text>
<rect x="2180" y="1880" width="1180" height="8" rx="4" fill="{COLORS['barakah_gold']}"/>
<text x="2180" y="1985" fill="{COLORS['charcoal']}" font-family="sans-serif" font-size="36">barakah.money</text>'''
    board_svg = write_svg("06_Brand_Guidelines/brand-board-4k.svg", "0 0 3840 2160", board)
    export_png(board_svg, ROOT / "06_Brand_Guidelines/brand-board-3840x2160.png", width=3840, height=2160)

    clearspace = f'''<rect width="2400" height="1500" fill="{COLORS['warm_ivory']}"/>
<text x="140" y="150" fill="{COLORS['charcoal']}" font-family="sans-serif" font-size="70" font-weight="700">Logo clear space</text>
<rect x="430" y="300" width="1540" height="760" fill="none" stroke="{COLORS['barakah_gold']}" stroke-width="6" stroke-dasharray="24 20"/>
<g transform="translate(510 385) scale(.62)">{symbol_group()}</g>
<g transform="translate(1190 610) scale(1.0)">{wordmark_group()}</g>
<path d="M430 1130 H1970" stroke="{COLORS['cool_border']}" stroke-width="4"/>
<text x="1200" y="1230" text-anchor="middle" fill="{COLORS['muted_slate']}" font-family="sans-serif" font-size="42">Keep at least 25% of the symbol width clear on every side.</text>'''
    clear_svg = write_svg("06_Brand_Guidelines/logo-clear-space.svg", "0 0 2400 1500", clearspace)
    export_png(clear_svg, ROOT / "06_Brand_Guidelines/logo-clear-space-2400x1500.png", width=2400, height=1500)


def make_developer_files() -> None:
    (ROOT / "07_Developer/colors.json").write_text(json.dumps(COLORS, indent=2) + "\n", encoding="utf-8")
    tokens = {
        "brand": COLORS,
        "radius": {"small": 8, "medium": 12, "card": 16, "pill": 999},
        "spacing": {"xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32, "xxl": 48},
        "typography": {
            "latin": "Inter, system-ui, sans-serif",
            "bengali": "Noto Sans Bengali, Hind Siliguri, sans-serif",
            "number_feature": "tabular-nums",
        },
    }
    (ROOT / "07_Developer/design-tokens.json").write_text(json.dumps(tokens, indent=2) + "\n", encoding="utf-8")
    css_lines = [":root {"] + [f"  --barakah-{k.replace('_', '-')}: {v};" for k, v in COLORS.items()] + ["}\n"]
    (ROOT / "07_Developer/barakah-colors.css").write_text("\n".join(css_lines), encoding="utf-8")
    ts_lines = ["export const BarakahColors = {"] + [f"  {k}: '{v}'," for k, v in COLORS.items()] + ["} as const;\n"]
    (ROOT / "07_Developer/barakah-colors.ts").write_text("\n".join(ts_lines), encoding="utf-8")


def make_docs() -> None:
    readme = """# Barakah Brand Assets v1

This is a vector-first, high-resolution starter identity for Barakah.

## Core idea

The custom lowercase `b` combines a balanced ledger stroke, a small growth leaf and a protected rounded form. The identity avoids literal mosque, crescent, bank-card, currency-sign and remittance imagery.

## Start here

- `01_Logos/SVG/` — resolution-independent masters
- `01_Logos/PNG_4K/` — 4096-pixel high-resolution exports
- `02_App_Icons/Android/` — launcher, adaptive, monochrome and notification assets
- `02_App_Icons/PWA/` — standard and maskable icons
- `03_Splash/` — high-resolution light and dark splash artwork
- `04_Web/` — favicon and social sharing assets
- `05_Social/` — profile and launch templates
- `06_Brand_Guidelines/` — visual board and clear-space guide
- `07_Developer/` — colour and design tokens
- `08_Source/` — reproducible source generator

## Important status

This is Brand System v1 and must receive founder approval before production use. Trademark clearance and small-device testing are separate release tasks.

## Typography

- English: Inter
- Bengali: Noto Sans Bengali
- Financial figures: tabular numerals

Fonts are not bundled. Obtain them from their authoritative distributors and retain their licences.

## Core colours

- Emerald `#0B6B57`
- Midnight `#102A43`
- Ivory `#F7F8F4`
- Charcoal `#17211D`
- Gold `#D6B15B`

## Usage rules

1. Keep clear space equal to at least 25% of the symbol width.
2. Never stretch, skew, outline or recolour the logo arbitrarily.
3. Use the reverse logo on dark surfaces.
4. Do not use gold as body text on light backgrounds.
5. Use labels and icons as well as colour for financial states.
6. Do not place sensitive financial values inside marketing artwork.
7. Keep the master SVG files unchanged; create new export versions instead.
"""
    (ROOT / "README.md").write_text(readme, encoding="utf-8")

    guide = """# Barakah Brand Guidelines — v1

## Positioning

Barakah is a calm, privacy-first Islamic personal finance tool. It should feel responsible and human rather than institutional, ornamental or sales-led.

## Logo

The symbol uses a geometric lowercase `b`, two balanced ledger accents and a growth leaf. Rounded geometry supports a calm and approachable character.

### Clear space

Keep at least 25% of the symbol width clear on all sides.

### Minimum size

Use the simplified symbol below 32 px. Test every launcher and notification export on physical reference devices.

### Do not

- Stretch or skew the mark.
- Add shadows to the master logo.
- Replace approved colours.
- place the dark wordmark on low-contrast surfaces.
- combine it with mosque, crescent, currency or bank-card motifs.

## Colour

Emerald is the primary action and identity colour. Midnight anchors trust and dark surfaces. Ivory provides calm space. Gold is a restrained accent for Zakat, progress and moments of significance.

Income, expense, receivable and payable colours are semantic, not branding substitutes. Never communicate state through colour alone.

## Typography

Use Inter for English and Latin financial figures. Use Noto Sans Bengali for Bangla. Prefer medium and semibold weights for balances. Avoid very thin Bengali text.

## Photography and illustration

Prefer simple line illustration, real environments and natural light. Avoid stock imagery involving cash piles, trading screens, luxury or exaggerated religious decoration.

## Voice

Clear, respectful, calm and honest. Explain security limitations. Do not claim that the product is 100% secure, bank-grade or able to provide a fatwa.

## Production note

This pack is an initial design system. Founder approval, trademark review, platform testing and accessibility QA remain required before public release.
"""
    (ROOT / "06_Brand_Guidelines/BRAND-GUIDELINES.md").write_text(guide, encoding="utf-8")


def build_manifest() -> None:
    files = []
    for path in sorted(ROOT.rglob("*")):
        if path.is_file() and path.name != "asset-manifest.json":
            files.append({
                "path": str(path.relative_to(ROOT)).replace("\\", "/"),
                "bytes": path.stat().st_size,
                "extension": path.suffix.lower(),
            })
    manifest = {
        "package": "Barakah Brand Assets",
        "version": "1.0",
        "generated": "2026-09-12",
        "asset_count_excluding_manifest": len(files),
        "files": files,
    }
    (ROOT / "07_Developer/asset-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    if ROOT.exists():
        shutil.rmtree(ROOT)
    ensure_dirs()
    logos = make_logo_assets()
    make_icons(logos["symbol_primary"])
    make_splash()
    make_web_and_social(logos["symbol_primary"])
    make_guidelines(logos)
    make_developer_files()
    make_docs()
    shutil.copy2(Path(__file__), ROOT / "08_Source/generate_barakah_brand_assets.py")
    # Inkscape 1.2 can let its renderer finish after the CLI call returns.
    # Wait for detached writers, then validate every raster before packaging.
    time.sleep(10)
    for temporary in ROOT.rglob("*.tmp.png"):
        temporary.unlink()
    validate_png_exports()
    for repair in ROOT.rglob("*.repair.png"):
        repair.unlink()
    build_manifest()
    shutil.make_archive(str(ROOT), "zip", ROOT.parent, ROOT.name)


if __name__ == "__main__":
    main()

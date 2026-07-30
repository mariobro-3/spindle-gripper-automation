# Spindle Gripper Automation

A local Windows app for programming a Gimbel Automation two-op spindle gripper cell:
two air vises on an aluminum base plate with a QuickFlip180 flipper in the middle,
tended by a TSA spindle gripper on Haas mills. You describe the cell once, paste your
Op1/Op2 CAM code, and the app generates the complete Haas M97 program that runs the
whole tray of parts unattended.

Made by **Cole Studer, Miltech Manufacturing**.

![Made for Haas VF-series mills](https://img.shields.io/badge/Haas-VF--3SS%20%7C%20VF--4SS%20%7C%20VF--9SS-blue)

## Quick start

**Just want to run it?** Grab `Spindle Gripper Setup 1.0.0.exe` from
[Releases](../../releases) (or build it yourself, below), double-click, done. No other
software needed. Everything runs locally on your PC; nothing is hosted online.

**Developing / building from source** (needs [Node.js](https://nodejs.org) 20+):

```
npm install
npm run dev          # dev server at http://localhost:5178 (or use Start Gripper App.bat)
npm run installer    # builds release\Spindle Gripper Setup <version>.exe
```

Notes for installed copies:

- Saved jobs go to the user's **Documents\Spindle Gripper Jobs** folder
  (dev mode uses the `jobs/` folder in the project).
- The STEP models from `CAD Files/` are bundled into the installer, so the 3D viewer
  works out of the box.
- The installer is not code-signed, so Windows SmartScreen may warn the first time -
  click **More info > Run anyway**.

## How to use it

Work left to right through the tabs. Everything autosaves to the browser as you go;
use the Jobs tab to save named setups.

### 1. Machine Config

Pick your machine (VF-9SS, VF-3SS, and VF-4SS ship pre-configured) or click
**Add New Machine** to create your own. Per machine you set:

- **Bed size and T-slots** - drawn to scale in the viewer. Haas specs are seeded:
  VF-3SS/VF-4SS 0.63" slots on 3.15" centers (5 slots), VF-9SS on 4.92" centers (7 slots).
- **M-codes** - gripper close/open (defaults to the Haas through-tool air blast,
  M73 on / M74 off), vise 1 / vise 2 close/open, flipper rotation, and flipper grip.
- **Teed air circuits** - the flipper rotation AND the flipper grip each pick their air
  supply: own solenoid, teed to vise 1, or teed to vise 2. Example (VF-9SS default):
  rotation teed to vise 2 means `M70 P2` rotates CW and clamps vise 2 together, `M71 P2`
  rotates CCW and opens vise 2 - the generator uses those codes for the flip moves and
  warns if a teed vise would be left unclamped before machining.
- **Actuation delays (G04)** - a per-machine dwell table in milliseconds (Haas: integer
  `G04 P` = ms, so P4000 = 4 s) with before/after values for the spindle gripper, each
  vise, the flipper grip, and the flipper rotation. Emitted into the macros via `{D_*}`
  tokens; tune them to how fast your air actually actuates.
- **Gripper and chip fan tool numbers / H offsets**, and default feeds.
- **Second gripper for Op2** - optional; if the flipped part needs different jaws, gripper 1
  handles raw stock and the op1 part while gripper 2 takes over at the flipper and handles
  the flipped part through vise 2 and the finished drop. The generator inserts the extra
  tool changes automatically.
- **Haas chip fan table wash** - optional; when on, the fan program (from
  `NC add-ins/FAN.nc`) runs after each machining block, before the gripper grabs parts.

### 2. Fixture Setup

The 3D viewer shows the machine bed (gray, with T-slots), the base plate assembly, trays,
and the finished-parts bin. Use the view cube in the corner to snap views.

- Enter the **plate size** and the **station centers** (vise 1, flipper, vise 2) measured
  from the plate's front-left corner.
- **Placement on Bed** positions the whole assembly: pick a datum reference point on the
  plate, give its machine XY, and set the rotation. Plate, vises, and flipper move
  together as one assembly, and every work offset follows automatically.
- **Your own CAD** - upload your own STEP files (your vises, soft jaws) with
  **Add STEP file...** in the STEP Models section, then pick them in any model slot.
  There are dedicated soft-jaw slots for vise 1 and vise 2 with full alignment controls.
  In the installed app, uploaded files are kept in
  **Documents\Spindle Gripper Jobs\Custom CAD**.
- **Offset Sheet** - the work offset table lives right here next to the viewer. Type the
  machine X/Y/Z for every WCS directly into the table (values are seeded once from the
  fixture layout, then fully manual). Print it, copy it, or copy/download the `G10 L2`
  lines.
- **Simulate** - the button in the viewer's bottom bar runs a kinematic simulation of
  the whole tray: the gripper travels station to station, picks and places every part,
  the flipper swings 180, spindle orients rotate the part in the air, and the station
  rings turn green (clamped) / amber (open). Play/pause, 1-10x speed, and a scrub bar;
  dwell times come from the machine's delay table.

### 3. Datum & Offsets

Pick the base plate datum (which corner you reference and where it sits on the bed -
this places the whole assembly in the 3D viewer), assign WCS codes (G54-G59) per
station, and set the spindle orient angle for vise 1 / flipper / vise 2. WCS conflicts
are flagged. The offset coordinates themselves are typed into the Offset Sheet on the
Fixture Setup page.

### 4. Trays & Stock

Define the raw stock size and the stock tray grid: machine XY of the first (bottom-left)
pocket center, pocket counts, and pitch. Choose where finished parts go - a bin with a
drop point or a finished tray.

### 5. Tray Generator

Builds the physical load tray from the same tray definition, previewed as a real solid.

- **DXF export** for laser cutting (layers: OUTLINE, POCKETS, HOLES).
- **STEP export** for machining the tray.
- **Mounting holes** can auto-populate from the machine's T-slots: wherever the tray
  (at its position on the bed) sits over a slot, a hole pair is added. Corner holes are
  also available.

### 6. Program Builder

- Paste or load your posted **Op1** code (machines in vise 1) and **Op2** code (machines
  in vise 2). Program them in CAM as if the part sits alone in its vise, using that
  vise's work offset origin - the app does not transform your coordinates.
- The sanitizer strips whatever would break an M97 macro section (`%`, O-numbers, M30,
  G28/G30, G53 XY moves, N-numbers) and shows you exactly what it changed.
- Click **Build Program**: you get one complete program with the pipelined two-op flip
  cycle unrolled per pocket, prime and drain cycles at the start and end, and all the
  part-handling macros (N200-N210) generated from editable templates.
- Options: chip clearing between parts, embedded G10 offset lines, and Op1 facing
  compensation (the gripper reaches lower when regripping a faced part).
- **Spindle orientation (M19)** - optional per-station angles for the gripper jaws at the
  tray pick, vise 1, flipper, vise 2, and finished drop. The spindle re-orients while
  carrying the part, so a different tray angle vs. vise angle rotates the stock between
  pick-up and the vise - that is how you choose which way the stock goes into the vise.
  Angles other than 0 emit `M19 R` (requires the Haas spindle-orientation option).

### 7. Jobs

Saves the entire configuration (machines, fixture, datum, trays, templates, loaded NC
code) as a JSON file. Load one to bring back the whole cell setup.

## Two-op cycle order (as generated)

Per pocket: unload vise 1 -> load flipper + close grip -> rotate CCW -> unload vise 2 to
bin/tray -> load vise 1 from tray -> unload flipper -> load vise 2 -> rotate CW (re-clamps
vise 1 on the shared air line) -> chip clear -> machine Op1 + Op2. The first and last
parts are handled with dedicated prime/drain sequences.

## Folder layout

- `CAD Files/` - Gimbel STEP models (vise, flipper, gripper); loaded by the viewer
- `NC add-ins/` - source NC programs (Haas chip fan table wash)
- `jobs/` - saved job configurations (JSON, dev mode)
- `src/` - application source (React + TypeScript + Vite)
- `electron/` - desktop app shell (embedded local server + window)
- `scripts/` - installer build script
- `System Diagrams/` - Haas Dual Programmable Air installation reference
- `Start Gripper App.bat` - dev launcher

## Tech

React 19, TypeScript, Vite 8, Electron, three.js,
[occt-import-js](https://github.com/kovacsv/occt-import-js) (STEP parsing in a web
worker), [replicad](https://replicad.xyz) (tray solid modeling + STEP export), zustand.

## Safety

> **Always dry-run generated programs** with reduced rapid/feed overrides and verify
> every work offset before running the cell unattended. Machine motion is your
> responsibility; this tool only writes text.

## License

[MIT](LICENSE) - do whatever you want with it, just keep the credit.
Copyright (c) Cole Studer, Miltech Manufacturing.

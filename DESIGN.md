---
name: DeviceHub
description: Calm dark glass control room for one mouse, one headset, one keyboard and the PC around them.
colors:
  backdrop: "#050507"
  panel-solid: "#0f1014"
  text: "#f2f2f5"
  text-muted: "rgba(235, 235, 245, .66)"
  text-faint: "rgba(235, 235, 245, .55)"
  line: "rgba(255, 255, 255, .08)"
  line-strong: "rgba(255, 255, 255, .15)"
  sunk: "rgba(0, 0, 0, .35)"
  signal: "#dfe2e8"
  signal-ink: "#111216"
  good: "#7fbf95"
  warn: "#e2c14e"
  bad: "#e0675a"
  device-mouse: "#3f6db3"
  device-headset: "#c4483e"
  device-keyboard: "#4a9a5c"
typography:
  page-title:
    fontFamily: "IBM Plex Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(26px, 3vw, 36px)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  device-name:
    fontFamily: "IBM Plex Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  card-title:
    fontFamily: "IBM Plex Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "IBM Plex Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "IBM Plex Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  hint:
    fontFamily: "IBM Plex Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  label:
    fontFamily: "IBM Plex Sans, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0em"
  code:
    fontFamily: "Cascadia Mono, Consolas, monospace"
    fontSize: "12.5px"
rounded:
  card: "24px"
  inner: "14px"
  field: "8px"
  pill: "999px"
spacing:
  row: "13px"
  gap: "16px"
  card-x: "22px"
  card-y: "20px"
  page-x: "38px"
  page-top: "30px"
components:
  button:
    backgroundColor: "rgba(255, 255, 255, .1)"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  button-hover:
    backgroundColor: "rgba(255, 255, 255, .18)"
  button-small:
    rounded: "{rounded.pill}"
    padding: "5px 12px"
    height: "28px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
  card:
    rounded: "{rounded.card}"
    padding: "20px 22px"
  pill:
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
    typography: "{typography.label}"
  switch:
    backgroundColor: "rgba(255, 255, 255, .14)"
    rounded: "{rounded.pill}"
    width: "44px"
    height: "24px"
  switch-on:
    backgroundColor: "{colors.good}"
  choice:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "3px"
  nav-item:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
    height: "38px"
  nav-item-active:
    backgroundColor: "rgba(255, 255, 255, .09)"
    textColor: "{colors.text}"
---

# DeviceHub design

The source of truth is `public/style.css` (its `:root` block holds every token above). This file says how to use them.
A new screen is built from the pieces here; a value that is not here is either added to `:root` first or not used.

## Overview

DeviceHub is a desk tool someone glances at while playing or working: a dark room, three devices, a few numbers. The
window is a near-black backdrop with soft grey pools and a faint grain, and everything sits on panes of dark frosted glass.
It is calm on purpose. Nothing moves until something changes, and then only quickly.

**The Glance Rule.** Every screen answers "is it fine?" in one look: state lives in the device's pill, its battery and
its numbers, not in sentences. A line of explanation goes at the bottom of the page or in a hover, never under a title.

**The One Room Rule.** Settings > Appearance swaps the whole look (drawing styles such as Blueprint, Vector, Noir,
Outrun, Aero; backdrops such as Graphite, Black, Espresso, Terminal, Koi Pond) by redefining the tokens. A screen
that uses the tokens follows every look for free; a literal colour breaks at least one of them.

## Colors

- **Backdrop** (`backdrop`) is the page. **Glass panes** sit on it: a faint white gradient (6.5% to 2%), a hairline
  rim of light on the top edge, an 18px blur and a long soft drop shadow (`--glass`, `--rim`, `--blur`, `--lift`).
- **Text** comes in three strengths: `text` for values and names, `text-muted` for controls at rest, `text-faint`
  for hints and labels. Faint is the floor: it measures 4.5:1 on a pane, and nothing readable goes dimmer.
- **Signal** (`signal`, a cool silver) is the one accent: the focused control, a primary button's tint, the selected
  thing. It is never a fill behind running text.
- **Status** colours mean exactly one thing each: `good` is connected, on, healthy; `warn` is "needs you" and a
  battery at 20% or less; `bad` is a fault and a battery at 10% or less. They appear as a dot, a pill or a gauge,
  never as decoration.
- **Device colours** (`device-mouse` blue, `device-headset` red, `device-keyboard` green) tint only that device's
  drawing and its gauges, so the three tiles are told apart at a glance.

**The Grey Unless It Means Something Rule.** A new element is grey and white. Colour is added only for a state, a
device, or chart series that must be told apart.

## Typography

One family, IBM Plex Sans, bundled in `public/fonts` (never loaded from the internet), with even-width digits
everywhere (`tabular-nums` on the body) so numbers do not jump as they change. Cascadia Mono is for code-like text
only (byte dumps, file names, keys), never as a "technical" costume.

The scale is short: page title, device name, card title, body, control, hint, label. Labels are in normal case with
no letter-spacing.

**The Title Stands Alone Rule.** No kicker above a heading, no tag beside or under a card title, no subtitle that
repeats the title (Shawn, 3 Nov 2026). If a card needs a status, it goes in the card's own row as a pill on the right.

## Layout

- A rail on the left (rounded glass column, 12px from the window's edges) and one page beside it, at most 1240px wide.
- Cards sit in a grid with a 16px gap: two-up (`.grid.two`, at least 360px each) or three-up (at least 300px).
- Inside a card, settings are rows (`.srow`): name and hint on the left, the control on the right, a hairline between
  rows, 13px above and below.
- The Overview, Lighting and Monitors fit one screen without scrolling at desktop size; the rest scroll as one page.
- Below 820px the rail becomes a sticky bar of icons along the top and every grid becomes one column.

**The Same Edges Rule.** Tiles in a row share their top, their drawing's baseline and their name's line (the Overview
levels its three tiles' value rows to the tallest), so a long value never shifts its neighbours.

## Elevation & Depth

Depth is glass, not boxes: one level of pane over the backdrop. Panes do not nest a second glass pane; inside a card,
groups are separated by a hairline (`line`) or a sunk field (`sunk`). Dialogs and toasts are the only things above a
pane, with a slightly lighter tint (`--dialog-a`, `--dialog-b`). On battery with the saver on, panes drop the blur
and become solid (`data-saving`), so nothing may depend on what shows through.

## Shapes

Big soft corners for containers (24px cards, 14px inner blocks) and fully round ends for anything you press: buttons,
pills, switches, choice groups, the rail's items. Fields for typed text are round too. Sharp corners appear only
where a look asks for them (Terminal, Old School).

## Components

- **Button**: glass-white tint with a hairline border, round ends. `primary` takes a signal tint; `ghost` has no fill
  until hover; `small` (28px high) is the default inside cards. Destructive ones use `bad` text, never a red fill.
- **Pill**: a small round label for state (`good`, `warn`, `bad` carry a dot), placed at the right end of a row or a
  card's head.
- **Switch**: 44 by 24, `good` when on. Pressed, its knob stretches toward where it will go and settles with a slight
  overshoot; it flips at once and moves back if the device says no.
- **Choice group** (`segmented`): a sunk round track with a sliding thumb; the pressed option dips a little.
- **Slider**: the value at its right in even digits; a quick, harmless one follows the device while dragged.
- **Device tile** (Overview): the device's drawing, name and battery, then three values. A tap opens it in place,
  wider, with its everyday settings; Open page goes on to the full page.
- **Toast**: bottom of the window, for something that happened elsewhere or failed. No toast for a plain success the
  screen already shows.
- **Dialog**: only for a choice that needs an answer before going on (a restart, a firmware warning, Keep or Undo).

Motion: the shared curve is `--ease` (a quick ease-out). Hovers and presses take 0.08 to 0.2s; opening things takes
0.3 to 0.45s; rows that appear together arrive 60ms apart. Every animation has a `prefers-reduced-motion` answer that
keeps the change visible (it appears without moving).

## Do's and Don'ts

- Do take every colour, radius and shadow from the tokens; add a token to `:root` before using a new value twice.
- Do keep text at `text-faint` or brighter. A row that is "off" dims its controls, not its words.
- Do give every control a visible focus ring (the shared 2px `signal` outline) and a name a screen reader can say.
- Do check a new screen in demo mode at 1500 and 400 px wide (`node helpers/ui-audit.mjs`) and in at least two looks.
- Don't put labels, tags or subtitles around titles, or a line of explanation under each card's title.
- Don't use colour for decoration, gradients on text, coloured side stripes on cards, or emoji as icons.
- Don't add a pop-up for success, or motion that runs while nothing is changing (the Live battery look's liquid is the
  one exception, and it stops for reduced motion).
- Don't draw anything 3D; the drawings are flat, the depth is the glass.

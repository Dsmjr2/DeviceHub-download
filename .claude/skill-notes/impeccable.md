# impeccable in DeviceHub

Read DESIGN.md (repo root) first; it is the system. Shawn's rules in ~/.claude/CLAUDE.md win over both.

- Mode: Operate. DeviceHub is a desk tool, glanced at mid-game: precision and calm, no expression for its own sake.
- Every screen change: critique, then polish (status/DeviceHub.md in the setup repo says so too).
- Check rendered pages headless only, in demo mode (`http://127.0.0.1:5577/?demo#/<page>`), never on the real
  devices: `node helpers/ui-audit.mjs` (contrast, names, targets, phone-width overflow, headings, alt; desktop and
  400 px), then `npm test` (pages.mjs and choices-click.mjs open every page and press every choice).
- The detector engine is not installed; ui-audit.mjs is the measured part of `audit`. Its contrast check skips text
  with a shadow (it cannot measure it), such as the Lighting page's "+" custom swatch.
- Looks and backdrops (Settings > Appearance) redefine the tokens: check a change in Graphite (the default) and one
  strong look such as Terminal. Never add a literal colour a look cannot follow.
- The makers' product photos (public/img) stay on Shawn's PC: never put them in an artifact, a zip or a page that
  leaves this PC.
- After a change to public/, rebuild the DeviceHub Demo artifact (helpers/build-demo-artifact.mjs; check with
  tests/demo-artifact.mjs) when Shawn or the Manager asks for it.

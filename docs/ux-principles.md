# UX principles: simple, fast, stunning

The bar is **fast.com, excalidraw, jsonviewer, netron**: one obvious thing to do, instant
result, no setup, no account, no tour you have to sit through. Visual identity follows
[design.md](design.md).

## The whole product in one sentence

**Drop a trace. See what went wrong.**

## Rules

1. **One screen, one action.** The first screen has a single job: get a trace in. A big
   drop target, a paste hint, and a "try a sample" button. Nothing else competes.
2. **No setup.** No sign-in, no settings, no format picker, no onboarding modal. Format
   detection chooses for you; the override lives behind a small "detected as ..." chip.
3. **Answer before detail.** After load, the first thing visible is the verdict and the top
   findings, not a wall of spans. Detail is one click away, never hidden, never first.
4. **Progressive disclosure.** Overview → timeline/graph → span inspector → raw JSON. Each
   level is one click or one keypress from the previous one.
5. **Three clicks to root cause.** From drop to "this tool call failed because of this
   input" in at most three actions. Treat more as a bug.
6. **Instant means instant.** First paint streams in while the file parses. Never show a
   spinner for something that could show the first rows. Budgets: [architecture.md](architecture.md).
7. **Keyboard first, mouse friendly.** `j/k` or arrows move through spans, `/` searches,
   `f` jumps to next finding, `Enter` opens inspector, `Esc` backs out, `?` shows keys.
   Visible hints, not hidden power.
8. **No modals, no dialogs.** Panels slide, never block. Undo instead of confirm.
9. **Honest empty and error states.** Unrecognised file → show what we tried and a generic
   view, never a dead end. Missing data → a plain "coverage" note.
10. **Calm, not cluttered.** Colour means something (errors red, warnings orange). Most of
    the screen is quiet slate. Generous spacing, 1px hairlines, one accent.
11. **Delight is craft, not decoration.** Crisp type, tabular numbers, smooth 60 fps pan and
    zoom, small transitions (150 ms), thoughtful cursors and hover states. No gratuitous
    animation; respect reduced motion.
12. **Same on every surface.** Web, VS Code, desktop share the UI exactly. The CLI keeps the
    same words, order, and findings.

## Responsive by default **(decided)**

The UI must work well from a phone to an ultrawide monitor, not just "not break". Design
mobile-first and add space as it appears.

| Width | Layout |
|---|---|
| < 640px (phone) | One pane at a time. Bottom tab bar: Findings, Timeline, Inspector. Tapping a finding or span moves to the inspector pane; back returns. Drop zone becomes "Choose a file" (touch has no drag). |
| 640-1024px (tablet, small window) | Two panes: timeline plus a slide-over inspector. Findings collapse into a top strip/drawer. |
| > 1024px (laptop, desktop) | Three panes: findings, timeline/graph, inspector, as in the wireframe. |
| > 1800px (ultrawide) | Extra width goes to the timeline; panes get a max width; optional side-by-side diff. |

Rules:

- Layout is driven by **container size, not device type** (CSS container queries), because
  the library is embedded in other apps, VS Code side panels, and resizable windows.
- Touch targets at least 44px on coarse pointers; hover-only affordances always have a tap
  or keyboard equivalent.
- Canvas views handle pinch-zoom, two-finger pan, and wheel/trackpad gestures, and scale for
  device pixel ratio.
- Text stays readable: no horizontal page scroll; long payloads wrap or scroll inside their
  own pane.
- Font sizes and spacing use `rem` and the design tokens so zoom and OS text-size settings
  work.
- Every layout is tested at 360, 768, 1280 and 2560 px wide in Playwright, in light and dark,
  in the CI visual checks.
- The website works on mobile browsers; the desktop and VS Code shells follow the same
  container rules since their window sizes vary.
- Performance budgets also apply to a mid-range phone (reduced pixel work, fewer visible
  rows) **(to validate)**.

## First-run flow (web, desktop)

```
 ┌───────────────────────────────────────────────┐
 │  tracey                         ◐ theme   ?   │
 │                                               │
 │                                               │
 │          Drop a trace to see what              │
 │          your agent really did.                │
 │                                               │
 │     ┌───────────────────────────────────┐     │
 │     │     Drop file, or paste (⌘V)      │     │
 │     └───────────────────────────────────┘     │
 │            or  Try a sample  ▸                │
 │                                               │
 │   Runs entirely in your browser. Nothing      │
 │   is uploaded.                                │
 └───────────────────────────────────────────────┘
```

```
 After drop (<1s): detected chip, verdict, findings, timeline, inspector

 ┌──────────────────────────────────────────────────────────────┐
 │ tracey  ● OpenInference · 142 spans · 38s · 12.4k tok · $0.21 │
 ├───────────────┬───────────────────────────────┬──────────────┤
 │ FINDINGS      │ TIMELINE   [graph] [json]     │ INSPECTOR    │
 │ ▲ Tool failed │  agent ████████████████████   │ search_docs  │
 │ ◆ Loop x5     │   llm  ███                    │ input  ▸     │
 │ ◆ Slow llm    │   tool   ██ ✕                 │ output ▸     │
 │               │   llm      ████               │ error ...    │
 └───────────────┴───────────────────────────────┴──────────────┘
```

These sketches are structural only; real mockups come from the visual companion or a spike.

## Surfaces, simply

- **Website:** landing = the drop target above. Nothing else on the page.
- **Desktop:** opens straight to the last trace or the drop target; double-click a file and it
  just opens.
- **VS Code:** opening a trace file shows the result view directly, no landing.
- **CLI:** `tracey file` prints verdict + findings in under a screen, then (TTY) offers `↵`
  to explore.

## Anti-patterns

- A home screen with feature tiles, menus of views, or "get started" steps.
- Asking the user to choose the trace format, or which view to use first.
- A settings page before the product proves itself.
- Loading spinners over empty regions.
- Dense tables with no visual hierarchy.
- Charts that need a legend to be understood.

## How to test it

- **Five-second test:** show someone the landing page; they should say "drop a trace".
- **Stopwatch test:** drop a 1k-span sample; time to first findings visible.
- **Stranger test:** hand a failing trace to a developer who has never seen tracey; they
  should reach the cause without help.

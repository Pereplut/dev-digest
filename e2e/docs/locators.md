# Locator strategy

Flows must be deterministic. They never use agent-browser's AI `chat` command, and they don't
use CSS selectors that are tied to styling. A non-zero command exit is the assertion.

## Allowed commands
| Need | Command | Notes |
|---|---|---|
| Route loaded | `wait --url "/pulls/482"` | substring of the URL |
| Text visible | `wait --text "…"` | substring match on **rendered** text |
| Text gone | `wait --fn "!document.body.innerText.includes('…')"` | for filters and toggles that hide content |
| Click / hover a control | `find role button click\|hover --name "…" [--exact]` | the name is the accessible name (`aria-label` or text) |
| Click text | `find text "…" click` | |
| Settle | `wait --load networkidle` | after navigation to a data-heavy page |

## Gotchas (confirmed)
- **`wait --text` sees CSS `text-transform`.** A header styled `uppercase` reads `COST`, not `Cost`, so assert the text as it is displayed:
  - section headings from `SectionLabel`: "REVIEW RUNS"
  - popover titles: "2 FINDINGS IN THIS RUN"
  - severity pills: "1 CRITICAL"
- **`--name` matches substrings unless you pass `--exact`.** The Timeline chip trigger is named "1 critical, 1 warning", which contains the pill's name "1 warning". Flow 04 clicks the pill with `--name "1 warning" --exact`.
- **`find … click` doesn't scroll the app's inner scroll container.** The studio scrolls a nested container, not the window. A below-the-fold target reports `✓ Done` but receives no click (`hover` doesn't bring it into view either, and `scroll down` doesn't reach the container). Run `scrollintoview '<css>'` first, e.g. `scrollintoview 'button[aria-label="1 warning"]'` in flow 04. The same applies to `hover`, and in both directions: once flow 04 scrolls down to the pills, the Timeline chips are above the fold and need their own `scrollintoview` before the hover.
- **Hover cards:** give the trigger `role="button"` and an `aria-label`, hover it by name, then assert text that exists **only inside** the card.
- **`find … focus` is listed in `--help` but rejected** ("Unknown subaction: focus"). To test focus, use `eval` with `el.focus()`.
- **Never click mutating controls** (Accept / Reject, Delete, Run review). Later flows rely on the seed, and a model call breaks determinism. Assert that the control is present with `wait --text "Reject"` instead.
- **Clear filters you set.** Flows share one browser session per run, so a flow that toggles a filter must toggle it back.

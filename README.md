# aw-ext-chip-picker

An Agent Wrangler extension that lets you choose which chips appear in a session card's
meta row. Its settings dialog has a live sample card, with one checkbox per chip: the
core chips, plus `card.pill` chips from other extensions. It needs host API `^1.14.0`.

- `requires: ['cards:hideChips']`: a client-only capability that gates `api.cards`.
  Hiding is presentation only. It applies to board cards, not to the detail panel.
- The hidden list lives in the `hiddenChips` setting (`type: 'list'`, `hidden: true`).
  It is applied on load and again whenever the setting changes (for example, from
  another tab).
- Toggles only change a draft and the preview. **Done** saves the list, and Escape
  discards it. Saved keys that match no chip today are kept.
- A pill that renders nothing for the sample session is labelled *(not in preview)*.
- Disabling the extension brings every chip back.

## Install

Extensions panel → install by git URL. `package-lock.json` is committed because an
install refuses without one, even with no dependencies.

## Tests

```
npm test
```

The tests use a stub api and a minimal DOM stub (no jsdom). They cover load-time apply,
change re-apply, grouping, draft vs save, save errors, *(not in preview)*, and that the
manifest matches the package.json manifest.

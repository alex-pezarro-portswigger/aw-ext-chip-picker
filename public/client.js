// Browser half. Two jobs:
//  1. Apply the saved `hiddenChips` list to the board as soon as the module
//     loads, and again whenever the setting changes (another tab, a hand edit).
//  2. A `settings.panel` contribution: a live sample card plus one checkbox per
//     chip. Toggles only change a local draft; Done saves it (host API 1.14.0
//     awaits save()), Escape throws it away.

const SETTING = 'hiddenChips';

// Stored value → list of keys. Anything malformed reads as "hide nothing".
// Stale or unknown keys are passed through: the host ignores keys that match
// nothing, and a pill whose extension is disabled today may be back tomorrow.
function listFrom(value) {
  return Array.isArray(value) ? value.filter((k) => typeof k === 'string') : [];
}

const current = (api) => listFrom(api.settings()?.[SETTING]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Does the preview show anything for `key`? A pill that renders nothing for a
// sample session (session.sample === true) leaves an empty .ext-slot.
function rendersIn(previewEl, key) {
  const node = previewEl.querySelector(`[data-chip="${key.replace(/["\\]/g, '\\$&')}"]`);
  if (!node || node.hidden) return false;
  return Boolean(node.textContent?.trim()) || (node.children?.length ?? 0) > 0;
}

export default {
  register(reg) {
    let bound = null;

    // Idempotent: the first api seen wins. reg.api is the load-time api; the
    // panel's mount api is a fallback for a host that does not hand one over.
    function bind(api) {
      if (bound || !api) return;
      bound = api;
      api.cards.hideChips(current(api));
      // removeExtension drops this subscription on disable/uninstall.
      api.settings.onChange((values) => api.cards.hideChips(listFrom(values?.[SETTING])));
    }
    bind(reg.api);

    // Per-mount state, keyed by host element so a reopened dialog starts clean.
    const panels = new Map();

    reg.register('settings.panel', {
      id: 'picker',

      mount(host, api) {
        bind(api);
        const state = {
          api,
          draft: new Set(current(api)),
          // key → last known "renders in preview" answer, for keys the draft
          // currently hides (they are not mounted in the preview, so unknown).
          inPreview: new Map(),
          boxes: new Map(),
          notes: new Map(),
        };
        const root = el('div', 'chip-picker');
        state.preview = el('div', 'chip-picker-preview');
        // An off-screen sample with nothing hidden: the source for each row's
        // rendered pill, so a hidden chip still shows what it looks like.
        state.swatches = el('div', 'chip-picker-preview chip-picker-swatches');
        state.swatches.hidden = true;
        state.groups = el('div', 'chip-picker-groups');
        const actions = el('div', 'chip-picker-actions');
        const showAll = el('button', 'chip-picker-show-all', 'Show all');
        showAll.type = 'button';
        showAll.addEventListener('click', () => { state.draft.clear(); refresh(state); });
        actions.appendChild(showAll);
        state.error = el('div', 'chip-picker-error');
        state.error.hidden = true;
        state.showAll = showAll;
        root.appendChild(state.preview);
        root.appendChild(state.swatches);
        root.appendChild(state.groups);
        root.appendChild(actions);
        root.appendChild(state.error);
        host.appendChild(root);
        state.root = root;
        panels.set(host, state);
        build(state);
        refresh(state);
      },

      update(host) {
        const state = panels.get(host);
        if (state) { build(state); refresh(state); }
      },

      async save(host) {
        const state = panels.get(host);
        if (!state) return;
        const list = [...state.draft];
        state.error.hidden = true;
        state.error.textContent = '';
        try {
          await state.api.settings.set(SETTING, list);
        } catch (err) {
          state.error.textContent = err?.message || String(err);
          state.error.hidden = false;
          throw err;
        }
        state.api.cards.hideChips(list);
      },

      unmount(host) {
        const state = panels.get(host);
        if (!state) return;
        state.root.remove?.();
        panels.delete(host);
      },
    });
  },
};

// Build the checkbox groups from chips(): Core first, then one group per
// extension in the order chips() returns them. Keys in the draft that match no
// chip keep their place in the saved list and get no checkbox.
function build(state) {
  const groups = new Map();
  for (const chip of state.api.cards.chips()) {
    const source = chip.source === 'core' ? 'core' : String(chip.source);
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(chip);
  }
  const ordered = [...groups].sort(([a], [b]) => (a === 'core' ? -1 : b === 'core' ? 1 : 0));
  state.boxes.clear();
  state.notes.clear();
  state.api.cards.renderSample(state.swatches, { hidden: [] });
  const sections = ordered.map(([source, chips]) => {
    const section = el('fieldset', 'chip-picker-group');
    section.dataset.source = source;
    section.appendChild(el('legend', 'chip-picker-group-title', source === 'core' ? 'Core' : source));
    for (const chip of chips) {
      const label = el('label', 'chip-picker-item');
      const box = el('input');
      box.type = 'checkbox';
      box.dataset.key = chip.key;
      box.addEventListener('change', () => {
        if (box.checked) state.draft.delete(chip.key);
        else state.draft.add(chip.key);
        refresh(state);
      });
      const note = el('span', 'chip-picker-note');
      label.title = chip.label || chip.key;
      label.appendChild(box);
      label.appendChild(swatch(state, chip));
      label.appendChild(note);
      section.appendChild(label);
      state.boxes.set(chip.key, { box, source: chip.source });
      state.notes.set(chip.key, note);
    }
    return section;
  });
  state.groups.replaceChildren(...sections);
}

// The chip as the sample card draws it, cloned (inert) with its parent's
// classes so row-scoped styles still apply. Falls back to the label text.
function swatch(state, chip) {
  const wrap = el('span', 'chip-picker-label');
  const node = state.swatches.querySelector(`[data-chip="${chip.key.replace(/["\\]/g, '\\$&')}"]`);
  const drawn = node && !node.hidden && (node.textContent?.trim() || node.children?.length);
  if (!drawn || !node.cloneNode) { wrap.textContent = chip.label || chip.key; return wrap; }
  const ctx = el('span', `${node.parentNode?.className || ''} chip-picker-swatch`.trim());
  // Outside the card the dialog's label styles (uppercase, muted) would leak
  // in, so carry over the text styles the pill inherits inside the card.
  const cs = node.parentNode && globalThis.getComputedStyle?.(node.parentNode);
  if (cs) {
    for (const prop of ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform']) {
      ctx.style.setProperty(prop, cs.getPropertyValue(prop));
    }
  }
  ctx.appendChild(node.cloneNode(true));
  wrap.appendChild(ctx);
  return wrap;
}

// Redraw the preview from the draft, then re-sync checkboxes and notes.
function refresh(state) {
  state.api.cards.renderSample(state.preview, { hidden: [...state.draft] });
  for (const [key, { box, source }] of state.boxes) {
    box.checked = !state.draft.has(key);
    const note = state.notes.get(key);
    if (source === 'core') { note.textContent = ''; continue; }
    if (!state.draft.has(key)) state.inPreview.set(key, rendersIn(state.preview, key));
    note.textContent = state.inPreview.get(key) === false ? ' (not in preview)' : '';
  }
  state.showAll.disabled = state.draft.size === 0;
}

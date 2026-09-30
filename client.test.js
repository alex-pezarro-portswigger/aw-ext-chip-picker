import { test } from 'node:test';
import assert from 'node:assert/strict';
import client from './public/client.js';
import manifest from './index.js';
import pkg from './package.json' with { type: 'json' };

// ── A DOM just big enough for the panel ───────────────────────────────────
// No jsdom, matching Agent Wrangler's own public/ tests.
class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this._text = '';
    this.listeners = {};
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  replaceChildren(...kids) { this.children = []; for (const k of kids) this.appendChild(k); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] || []) fn(); }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelector(sel) {
    const m = sel.match(/^\[data-chip="(.*)"\]$/);
    if (!m) throw new Error(`stub querySelector: ${sel}`);
    for (const n of this.walk()) if (n.dataset.chip === m[1]) return n;
    return null;
  }
  find(pred) { for (const n of this.walk()) if (pred(n)) return n; return null; }
  findAll(pred) { return [...this.walk()].filter(pred); }
}
globalThis.document = { createElement: (tag) => new Node(tag) };

// ── A stub api ────────────────────────────────────────────────────────────
const CHIPS = [
  { key: 'core:age', label: 'Age', source: 'core' },
  { key: 'core:cost', label: 'Cost', source: 'core' },
  { key: 'peer:mail', label: 'Mail', source: 'peer' },
  { key: 'reg:note', label: 'Note', source: 'reg' },
];

function stubApi({ stored, setImpl } = {}) {
  let values = stored === undefined ? {} : { hiddenChips: stored };
  const calls = { hideChips: [], renderSample: [], set: [] };
  const changeFns = [];
  const settings = Object.assign(() => ({ ...values }), {
    set: async (key, value) => {
      calls.set.push([key, value]);
      if (setImpl) return setImpl(key, value);
      values = { ...values, [key]: value };
    },
    onChange: (fn) => { changeFns.push(fn); return () => {}; },
  });
  const api = {
    settings,
    cards: {
      chips: () => CHIPS.map((c) => ({ ...c })),
      hideChips: (keys) => calls.hideChips.push(keys),
      // The sample: core chips always, `peer:mail` renders content, `reg:note`
      // mounts but draws nothing for a sample session. Hidden pills unmounted.
      renderSample: (el, { hidden = [] } = {}) => {
        calls.renderSample.push(hidden);
        const card = new Node('div');
        for (const key of ['peer:mail', 'reg:note']) {
          if (hidden.includes(key)) continue;
          const pill = new Node('span');
          pill.dataset.chip = key;
          if (key === 'peer:mail') pill.textContent = '3';
          card.appendChild(pill);
        }
        el.replaceChildren(card);
      },
    },
  };
  return { api, calls, fireChange: (v) => { values = v; for (const fn of changeFns) fn({ ...v }); } };
}

function load(opts) {
  const stub = stubApi(opts);
  let panel = null;
  client.register({
    api: stub.api,
    register: (slot, c) => { assert.equal(slot, 'settings.panel'); panel = c; },
    onMessage: () => {},
  });
  return { ...stub, panel };
}

function mountPanel(opts) {
  const ctx = load(opts);
  const host = new Node('div');
  ctx.panel.mount(host, ctx.api);
  const box = (key) => host.find((n) => n.dataset.key === key);
  const label = (key) => box(key).parentNode;
  return { ...ctx, host, box, label };
}

const lastHidden = (calls) => calls.renderSample.at(-1);

// ── On load ───────────────────────────────────────────────────────────────

test('on load, hideChips gets the stored list', () => {
  const { calls } = load({ stored: ['core:cost', 'peer:mail'] });
  assert.deepEqual(calls.hideChips, [['core:cost', 'peer:mail']]);
});

test('on load, an unset or malformed setting hides nothing', () => {
  assert.deepEqual(load().calls.hideChips, [[]]);
  assert.deepEqual(load({ stored: 'core:age' }).calls.hideChips, [[]]);
  assert.deepEqual(load({ stored: ['core:age', 7] }).calls.hideChips, [['core:age']]);
});

test('a settings change re-applies the new list', () => {
  const { calls, fireChange } = load({ stored: [] });
  fireChange({ hiddenChips: ['core:age'] });
  assert.deepEqual(calls.hideChips.at(-1), ['core:age']);
});

test('without a load-time api the panel mount binds instead, once', () => {
  const stub = stubApi({ stored: ['core:age'] });
  let panel = null;
  client.register({ register: (_s, c) => { panel = c; } });
  assert.equal(stub.calls.hideChips.length, 0);
  panel.mount(new Node('div'), stub.api);
  panel.mount(new Node('div'), stub.api);
  assert.deepEqual(stub.calls.hideChips, [['core:age']]);
});

// ── The panel ─────────────────────────────────────────────────────────────

test('groups: Core first, then one per extension in chips() order', () => {
  const { host } = mountPanel();
  const groups = host.findAll((n) => n.tagName === 'fieldset');
  assert.deepEqual(groups.map((g) => g.dataset.source), ['core', 'peer', 'reg']);
  assert.equal(groups[0].children[0].textContent, 'Core');
  assert.deepEqual(groups[0].findAll((n) => n.dataset.key).map((n) => n.dataset.key), ['core:age', 'core:cost']);
});

test('checked means shown, from the stored list', () => {
  const { box } = mountPanel({ stored: ['core:cost'] });
  assert.equal(box('core:age').checked, true);
  assert.equal(box('core:cost').checked, false);
});

test('a toggle re-renders the preview with the draft and does not persist', () => {
  const { box, calls } = mountPanel();
  assert.deepEqual(lastHidden(calls), []);
  box('core:age').checked = false;
  box('core:age').fire('change');
  assert.deepEqual(lastHidden(calls), ['core:age']);
  assert.equal(calls.set.length, 0);
  assert.equal(calls.hideChips.length, 1); // only the load-time apply
});

test('Show all clears the draft', () => {
  const { host, box, calls } = mountPanel({ stored: ['core:age', 'peer:mail'] });
  host.find((n) => n.className === 'chip-picker-show-all').fire('click');
  assert.deepEqual(lastHidden(calls), []);
  assert.equal(box('core:age').checked, true);
  assert.equal(box('peer:mail').checked, true);
});

test('save persists then applies, keeping unknown keys', async () => {
  const { panel, host, box, calls } = mountPanel({ stored: ['gone:pill'] });
  box('core:cost').checked = false;
  box('core:cost').fire('change');
  await panel.save(host);
  assert.deepEqual(calls.set, [['hiddenChips', ['gone:pill', 'core:cost']]]);
  assert.deepEqual(calls.hideChips.at(-1), ['gone:pill', 'core:cost']);
});

test('save rejection shows the error, keeps the draft and propagates', async () => {
  const { panel, host, box, calls } = mountPanel({ setImpl: () => Promise.reject(new Error('nope')) });
  box('core:age').checked = false;
  box('core:age').fire('change');
  await assert.rejects(panel.save(host), /nope/);
  const err = host.find((n) => n.className === 'chip-picker-error');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'nope');
  assert.equal(calls.hideChips.length, 1); // not applied
  assert.equal(box('core:age').checked, false);
  assert.deepEqual(lastHidden(calls), ['core:age']);
});

test('a pill that draws nothing in the sample is marked (not in preview)', () => {
  const { label, box } = mountPanel();
  assert.match(label('reg:note').textContent, /\(not in preview\)/);
  assert.doesNotMatch(label('peer:mail').textContent, /not in preview/);
  assert.doesNotMatch(label('core:age').textContent, /not in preview/);
  // Hiding it keeps the last answer rather than guessing.
  box('reg:note').checked = false;
  box('reg:note').fire('change');
  assert.match(label('reg:note').textContent, /\(not in preview\)/);
});

test('unmount removes the panel and a later save is a no-op', async () => {
  const { panel, host, calls } = mountPanel();
  panel.unmount(host);
  assert.equal(host.children.length, 0);
  await panel.save(host);
  assert.equal(calls.set.length, 0);
});

// ── Manifest ──────────────────────────────────────────────────────────────

test('index.js and package.json wranglerExtension agree', () => {
  const w = pkg.wranglerExtension;
  assert.equal(w.id, manifest.id);
  assert.deepEqual(w.requires, manifest.requires);
  assert.deepEqual(w.settings, manifest.settings);
  assert.deepEqual(manifest.requires, ['cards:hideChips']);
  assert.equal(manifest.engines.wranglerApi, '^1.14.0');
});

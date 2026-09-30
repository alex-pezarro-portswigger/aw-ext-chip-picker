import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The loader resolves `client` inside this directory's public/ subdir, so the
// manifest has to say where it lives.
export const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  id: 'chip-picker',
  label: 'Card chips',
  help: 'Choose which chips appear on session cards.',
  defaultEnabled: true,
  // 1.14.0 serves api.cards, settings.panel, api.settings.set/onChange and the
  // `list` setting type; an older host quarantines this manifest.
  engines: { wranglerApi: '^1.14.0' },
  // Client-only capability: gates api.cards. Hiding is presentation only.
  requires: ['cards:hideChips'],
  // Managed by the panel, not a dialog row. No default: the client reads a
  // missing value as [].
  settings: [{ key: 'hiddenChips', type: 'list', label: 'Hidden chips', hidden: true, maxItems: 200 }],
  client: 'public/client.js',
  styles: 'public/chip-picker.css',
};

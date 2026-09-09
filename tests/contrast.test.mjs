/* WCAG AA contrast, checked from the stylesheet itself.

   Reads the colour tokens out of style.css for both themes and checks every
   pair that carries text. The brief asks for AA in both modes, and the muted
   tone it specifies sits just under 4.5:1 on the linen — which is why the
   stylesheet has a --muted-text token alongside --muted, and why this test
   exists: so nobody softens a colour later without finding out. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

function tokens(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} not found`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const block = css.slice(open + 1, close);
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

const light = tokens(':root {');
const dark = tokens(':root[data-theme="dark"]');

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const GROUNDS = ['bg', 'bg-sidebar', 'input-bg', 'output-bg', 'crisis-bg'];

for (const [name, t] of [['light', light], ['dark', dark]]) {
  test(`${name}: the tokens the brief names are present`, () => {
    for (const key of ['bg', 'bg-sidebar', 'text', 'muted', 'muted-text', 'input-bg', 'output-bg', 'on-accent', 'crisis-bg', 'crisis-accent', ...SEASONS]) {
      assert.ok(t[key], `${name} is missing --${key}`);
    }
  });

  test(`${name}: primary text is AA on every ground`, () => {
    for (const g of GROUNDS) {
      const r = ratio(t.text, t[g]);
      assert.ok(r >= 4.5, `text on ${g}: ${r.toFixed(2)}:1`);
    }
  });

  test(`${name}: secondary text is AA on every ground`, () => {
    for (const g of GROUNDS) {
      const r = ratio(t['muted-text'], t[g]);
      assert.ok(r >= 4.5, `muted-text on ${g}: ${r.toFixed(2)}:1`);
    }
  });

  test(`${name}: the decorative muted tone is at least 3:1 where it is used`, () => {
    for (const g of ['bg', 'bg-sidebar', 'input-bg']) {
      const r = ratio(t.muted, t[g]);
      assert.ok(r >= 3, `muted on ${g}: ${r.toFixed(2)}:1`);
    }
  });

  test(`${name}: button text is AA on every season, and on hover`, () => {
    for (const s of SEASONS) {
      const r = ratio(t['on-accent'], t[s]);
      assert.ok(r >= 4.5, `on-accent on ${s}: ${r.toFixed(2)}:1`);
      const h = ratio(t['on-accent'], t[`${s}-deep`]);
      assert.ok(h >= 4.5, `on-accent on ${s}-deep: ${h.toFixed(2)}:1`);
    }
  });

  test(`${name}: the seasonal ribbon and crisis accent are visible against the card`, () => {
    for (const s of SEASONS) {
      const r = ratio(t[s], t['output-bg']);
      assert.ok(r >= 1.6, `${s} ribbon on output-bg: ${r.toFixed(2)}:1`);
    }
    assert.ok(ratio(t['crisis-accent'], t['crisis-bg']) >= 2.5);
  });
}

test('the brief\'s exact palette values are the ones in use', () => {
  assert.equal(light.bg, '#F6F2EC');
  assert.equal(light['bg-sidebar'], '#EBE5DC');
  assert.equal(light.text, '#3A322B');
  assert.equal(light.muted, '#8A7E73');
  assert.equal(light['input-bg'], '#FDFAF6');
  assert.equal(light['output-bg'], '#FAF7F2');
  assert.equal(light.winter, '#8DA4B8');
  assert.equal(light.spring, '#C4929B');
  assert.equal(light.summer, '#C9A84C');
  assert.equal(light.autumn, '#B8895A');
  assert.equal(dark.bg, '#1C1916');
  assert.equal(dark['bg-sidebar'], '#15120F');
  assert.equal(dark.text, '#E0D8CC');
  assert.equal(dark.muted, '#8A7E6E');
  assert.equal(dark['input-bg'], '#221E1A');
  assert.equal(dark.border, '#3A332B');
});

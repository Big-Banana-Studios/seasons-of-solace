/* Seasons of Solace — a grief companion that runs on the person's own device.

   The shape mirrors the rest of the Lewis family suite: a worker holds the
   model, the page holds eight tabs, and nothing is sent anywhere. What is
   different here is who is sitting in front of it, and everything about the
   pacing follows from that.

   - Model text is never drawn as it arrives. It is checked in full first
     (see safety.js), and a slow pulse in the tab's own colour covers the wait.
   - Nothing typed or received is written to disk. localStorage holds four
     settings and nothing else: whether the welcome has been seen, the theme,
     the text size, and whether the model has been downloaded before. Inputs
     and outputs live in a plain object and die with the tab.
   - A reply that fails a check is retried once, quietly, at a lower
     temperature, with a one-line note to the model about what went wrong.
     A person who sees "something got in the way" twice concludes the app is
     broken, and usually it was one bad sample. */

'use strict';

import {
  TABS, TAB_BY_ID, buildSystem, pickSeed, prefillFor, isTelling,
  PHRASE_CORRECTION, CLARITY_CORRECTION, SAY_FORMAT_CORRECTION, LIST_FORMAT_CORRECTION,
} from './prompts.js';
import {
  checkInput, checkOutput, checkShape, ensureClose, scrub, trimSignOff, tidyOptions, stripVocative, capLength, warmFallback,
  composeToday, composeTelling, waveInstant, reminderInstant, themedReminder,
  CRISIS_RESPONSE, CRISIS_NOTE, WAVE_FALLBACK, SAY_FALLBACK, QUIET_FALLBACK, reminderFallback,
  MAX_INPUT_CHARS,
} from './safety.js';
import { createWelcome, hasSeenWelcome } from './welcome.js';

// Bump on every deploy, and keep APP_VERSION identical to VERSION in sw.js.
const APP_VERSION = 'v1.1.0';
const VERSION_DATE = 'Sep 2026';

const MODEL_MB = 1770;                   // LFM2.5-2.6B at q4, measured from the Hugging Face CDN
const NEEDED_BYTES = 2.2 * 1073741824;   // the model, the runtime, and headroom

const CACHED_FLAG = 'seasonsOfSolace_modelCached';
const THEME_KEY = 'seasonsOfSolace_theme';
const TEXT_SIZE_KEY = 'seasonsOfSolace_textSize';

/* Signs that the GPU gave out rather than the code being wrong. Chrome reports
   a lost WebGPU device as a failure to build a compute pipeline. */
const GPU_LOST = /Instance reference no longer exists|device.*lost|compute pipeline|OrtRun/i;

const $ = (id) => document.getElementById(id);

const el = {
  tabs: $('tabs'), panel: $('panel'), tabTitle: $('tabTitle'), tabDesc: $('tabDesc'),
  input: $('input'), counter: $('counter'), submitBtn: $('submitBtn'), clearBtn: $('clearBtn'),
  outputCard: $('outputCard'), outputLabel: $('outputLabel'), outputTools: $('outputTools'),
  output: $('output'), outputNote: $('outputNote'),
  copyBtn: $('copyBtn'), speakBtn: $('speakBtn'),
  status: $('status'), statusText: $('statusText'), statusMark: $('statusMark'),
  themeToggle: $('themeToggle'), themeToggleTop: $('themeToggleTop'),
  textSizeBtn: $('textSizeBtn'), aboutBtn: $('aboutBtn'),
  installBtn: $('installBtn'), install: $('install'), installSteps: $('installSteps'), installClose: $('installClose'),
  menuToggle: $('menuToggle'), sidebar: $('sidebar'), scrim: $('scrim'),
  toast: $('toast'), version: $('version'),
  gate: $('gate'), gateTitle: $('gateTitle'), gateBody: $('gateBody'), gateAction: $('gateAction'),
  bar: $('bar'), barFill: $('barFill'), barLabel: $('barLabel'),
  welcome: $('welcome'),
};

/* Session state. Deliberately a plain object with no persistence anywhere near
   it: close the tab and every word is gone. */
const state = {};
TABS.forEach((t) => {
  // kind: '' | 'model' | 'crisis' | 'notice' | 'human'
  state[t.id] = { input: '', output: '', kind: '' };
});

let activeTab = TABS[0].id;
let isLoading = false;
let modelReady = false;
let requestId = 0;
let pendingTab = null;
let pendingRun = null;          // { input, shown, empty, retried, correction }
let supportAnswer = null;       // held while the welcome is up
let welcome = null;
const fileProgress = new Map();

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const worker = new Worker('./worker.js', { type: 'module' });

/* If the worker dies before it can answer — a failed import, an old browser, no
   network — there is no message to react to, and without this the app sits on
   "Checking…" forever looking like it is still working. */
let answered = false;

function workerFailed(detail) {
  if (answered) return;
  answered = true;
  setStatus('error', "Couldn't start");
  showGate(
    'Having trouble loading',
    'Try refreshing the page.<br><br>'
    + `<code class="detail">${escapeHtml(detail)}</code><br><br>`
    + 'If you are offline, connect to wifi and reload.',
    'Reload', () => window.location.reload(),
  );
}

worker.addEventListener('error', (e) => {
  console.error('worker error', e);
  workerFailed(e.message || 'The part that runs the companion failed to load.');
});
worker.addEventListener('messageerror', () => workerFailed('The worker sent something unreadable.'));
window.setTimeout(() => {
  workerFailed('Timed out waiting for the graphics check. The model library may have failed to load.');
}, 25000);

/* ------------------------------------------------------------- rendering */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Bold only. The brief is right that italics have no place here.
function inline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '$1');
}

// Escapes first, then formats, so nothing the model writes can become markup.
function renderMarkdown(raw) {
  const lines = escapeHtml(raw).split('\n');
  const html = [];
  let list = null;
  let paragraph = [];

  // A single newline is a line break, not a space: the crisis card puts each
  // number on its own line, and What Do I Say puts each option on its own.
  const flushParagraph = () => {
    if (paragraph.length) { html.push(`<p>${inline(paragraph.join('<br>'))}</p>`); paragraph = []; }
  };
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  const openList = (kind) => {
    if (list !== kind) { closeList(); html.push(`<${kind}>`); list = kind; }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushParagraph(); closeList(); continue; }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) { flushParagraph(); openList('ol'); html.push(`<li>${inline(ordered[1])}</li>`); continue; }

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bullet) { flushParagraph(); openList('ul'); html.push(`<li>${inline(bullet[1])}</li>`); continue; }

    closeList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  closeList();
  return html.join('\n');
}

/* ------------------------------------------------------------------ tabs */

const currentTab = () => TAB_BY_ID[activeTab];

function buildTabs() {
  TABS.forEach((tab) => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.type = 'button';
    btn.dataset.tab = tab.id;
    btn.dataset.season = tab.season;
    btn.innerHTML = `<span class="tab-icon" aria-hidden="true">${tab.icon}</span><span class="tab-label"></span>`;
    btn.lastElementChild.textContent = tab.label;
    btn.addEventListener('click', () => selectTab(tab.id));
    el.tabs.appendChild(btn);
  });
}

/* The brief asks for a 400ms fade, slower than the rest of the suite. Half
   of it fading out, the content swapped in the middle, half fading back. */
function selectTab(id) {
  if (id === activeTab) { closeSidebar(); return; }
  saveInput();
  stopSpeaking();
  closeSidebar();
  const delay = reducedMotion() ? 0 : 200;
  el.panel.classList.add('is-switching');
  window.setTimeout(() => {
    activeTab = id;
    renderTab();
    el.panel.classList.remove('is-switching');
  }, delay);
}

function renderTab() {
  const tab = currentTab();
  const data = state[activeTab];

  document.querySelectorAll('.tab').forEach((btn) => {
    const on = btn.dataset.tab === activeTab;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-current', on ? 'page' : 'false');
  });

  el.panel.dataset.season = tab.season;
  el.tabTitle.textContent = tab.title;
  el.tabDesc.textContent = tab.desc;
  el.input.placeholder = tab.placeholder;
  el.input.value = data.input;
  el.input.classList.remove('nudge');

  updateCounter();
  if (isLoading && pendingTab === activeTab) showLoading();
  else renderStored();

  syncSubmit();
}

function renderStored() {
  const data = state[activeTab];
  if (data.kind === 'crisis') showCrisisCard();
  else if (data.kind === 'notice') showNotice(data.output);
  else renderOutput(data.output);
}

function renderOutput(text) {
  if (!text) {
    el.outputCard.hidden = true;
    el.output.innerHTML = '';
    el.outputNote.hidden = true;
    return;
  }
  el.outputCard.hidden = false;
  el.outputCard.classList.remove('is-crisis', 'is-notice');
  el.outputLabel.textContent = currentTab().id === 'remind' ? 'A small truth' : 'Here';
  el.output.innerHTML = renderMarkdown(text);
  el.outputTools.hidden = false;
  el.outputNote.hidden = true;
}

/* The crisis card. Hardcoded, never model-generated, and styled differently
   from an ordinary reply so it reads as somebody meaning it. The numbers are
   links, because at 3am on a phone a tap is easier than a copy. */
function showCrisisCard() {
  el.outputCard.hidden = false;
  el.outputCard.classList.add('is-crisis');
  el.outputCard.classList.remove('is-notice');
  el.outputLabel.textContent = 'Please read this';
  el.outputTools.hidden = true;
  el.output.innerHTML = renderMarkdown(CRISIS_RESPONSE)
    .replace(/<strong>988<\/strong>/g, '<a class="crisis-link" href="tel:988"><strong>988</strong></a>')
    .replace(/<strong>741741<\/strong>/g, '<a class="crisis-link" href="sms:741741?body=HOME"><strong>741741</strong></a>');
  el.outputNote.textContent = CRISIS_NOTE;
  el.outputNote.hidden = false;
  el.outputCard.focus();
}

function showNotice(message) {
  el.outputCard.hidden = false;
  el.outputCard.classList.remove('is-crisis');
  el.outputCard.classList.add('is-notice');
  el.outputLabel.textContent = 'A moment';
  el.outputTools.hidden = true;
  el.outputNote.hidden = true;
  el.output.innerHTML = `<p class="notice">${escapeHtml(message)}</p>`;
}

function showLoading(second = false) {
  el.outputCard.hidden = false;
  el.outputCard.classList.remove('is-crisis', 'is-notice');
  el.outputLabel.textContent = 'Here';
  el.outputTools.hidden = true;
  el.outputNote.hidden = true;
  el.output.innerHTML =
    '<div class="loading"><span class="pulse" aria-hidden="true"></span>'
    + `<span id="loadingText">${second ? 'One more moment…' : 'Taking this in…'}</span></div>`;
}

// Paints the buttons from whatever the current state happens to be.
function syncSubmit() {
  el.submitBtn.disabled = isLoading;
  el.submitBtn.textContent = isLoading ? 'One moment…' : currentTab().button;
}

function setLoading(loading) {
  isLoading = loading;
  syncSubmit();
}

function updateCounter() {
  const text = el.input.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  el.counter.textContent =
    `${words} ${words === 1 ? 'word' : 'words'} · ${text.length} of ${MAX_INPUT_CHARS} characters`;
  el.counter.classList.toggle('is-full', text.length >= MAX_INPUT_CHARS);
}

const saveInput = () => { state[activeTab].input = el.input.value; };

function scrollToOutput() {
  if (el.outputCard.hidden) return;
  try {
    el.outputCard.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  } catch { /* older browsers */ }
}

/* ------------------------------------------------------------ generation */

function run() {
  if (isLoading) return;

  const tab = currentTab();
  saveInput();
  const text = el.input.value.trim();
  const empty = !text;

  if (empty && !tab.allowEmpty) {
    el.input.classList.remove('nudge');
    void el.input.offsetWidth;                 // restart the animation
    el.input.classList.add('nudge');
    el.input.focus();
    return;
  }

  /* Layers 2 and 4. Nothing goes to the model until this has had a look at
     it — and this runs whether or not the model is ready, so the crisis card
     never waits on a download. */
  if (!empty) {
    const problem = checkInput(text);
    if (problem) {
      if (problem.kind === 'crisis') {
        state[activeTab].output = '';
        state[activeTab].kind = 'crisis';
        showCrisisCard();
      } else {
        state[activeTab].output = problem.message;
        state[activeTab].kind = 'notice';
        showNotice(problem.message);
      }
      scrollToOutput();
      return;
    }
  }

  /* Nothing typed on It Hit Me Again or Get Me Through Today: words written
     by people, shown at once. The brief asks for an immediate grounding
     response, and somebody who cannot type does not need to watch a pulse
     for seven seconds either. */
  const instant = (text) => {
    stopSpeaking();
    state[activeTab].output = text;
    state[activeTab].kind = 'human';
    renderOutput(text);
    scrollToOutput();
  };

  if (empty && tab.instantEmpty) {
    if (tab.id === 'wave') instant(waveInstant());
    else if (tab.id === 'remind') instant(reminderInstant());
    else instant(composeToday(null, { empty: true }));
    return;
  }

  // Telling somebody that someone died: templates, with the person's own
  // words for who and when. See safety.composeTelling for why.
  if (!empty && isTelling(tab, text)) {
    instant(composeTelling(text));
    return;
  }

  // A reminder for a kind of day people have written one for already — and,
  // for a day none of them fit, one from the bank rather than the model.
  if (!empty && tab.themedFirst) {
    const themed = themedReminder(text);
    if (themed) { instant(themed); return; }
    if (tab.bankWhenUnmatched) { instant(reminderInstant()); return; }
  }

  if (!modelReady) {
    showNotice("Still getting ready. Give it a moment, then try again.");
    return;
  }

  state[activeTab].output = '';
  state[activeTab].kind = '';
  pendingTab = activeTab;

  let input = text;
  if (empty) {
    input = tab.emptyInput;
    // Gentle Reminders with nothing typed gets a situation to write about, so
    // the button does not circle the same four reminders. Never shown.
    if (tab.id === 'remind') {
      input += ` If it helps, write the reminder for someone facing: ${pickSeed()}. Do not say that you were told this.`;
    }
  }

  pendingRun = { input, shown: empty ? '' : text, empty, retried: false, correction: null };
  requestId += 1;

  stopSpeaking();
  setLoading(true);
  showLoading(false);
  scrollToOutput();
  send();
}

function send() {
  const tab = TAB_BY_ID[pendingTab];
  worker.postMessage({
    type: 'generate',
    id: requestId,
    system: buildSystem(tab, { empty: pendingRun.empty, correction: pendingRun.correction }),
    input: pendingRun.input,
    shown: pendingRun.shown,
    prefill: prefillFor(tab, { empty: pendingRun.empty }),
    maxTokens: tab.maxTokens,
    // Cooler on a retry: most of what goes wrong is the model being freer
    // than it needed to be.
    temperature: pendingRun.retried ? Math.max(0.3, tab.temperature - 0.2) : tab.temperature,
  });
}

/* What to show when the model could not. The three tabs that work with
   nothing typed get words written by people, because "something got in the
   way" is the wrong thing to hand somebody who just pressed "I Need a
   Moment". */
function humanFallback(tab, { empty = false } = {}) {
  if (tab.id === 'wave') return WAVE_FALLBACK;
  if (tab.id === 'today') return composeToday(null, { empty });
  if (tab.id === 'remind') return reminderFallback();
  if (tab.id === 'say') return SAY_FALLBACK;
  if (tab.id === 'quiet') return QUIET_FALLBACK;
  // Talk To Me, I Don't Know What I Feel, Remember Them: the brief's
  // fallback line, with a sentence in the tab's own voice under it.
  return warmFallback(tab.id);
}

/* Get Me Through Today: the model's one or two sentences about this day,
   then the brief's own list, permission and close. Never more than three
   sentences from the model, however many it wrote. */
function composeIfNeeded(tab, text, empty) {
  if (!tab.compose) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return composeToday(sentences, { empty });
}

function settle(tabId, text, kind) {
  state[tabId].output = text;
  state[tabId].kind = kind;
  if (activeTab === tabId) {
    if (kind === 'crisis') showCrisisCard();
    else if (kind === 'notice') showNotice(text);
    else renderOutput(text);
    scrollToOutput();
  }
  setLoading(false);
}

/* Layers 3 and 5. Everything the model produced arrives here in one piece and
   has to get past all of it before a single character is drawn. */
function finish(raw) {
  const tabId = pendingTab;
  const tab = TAB_BY_ID[tabId];

  let cleaned = trimSignOff(stripVocative(scrub(String(raw || '')), pendingRun.shown), { keepQuestion: !!tab.keepQuestion });
  if (tab.shape === 'options') cleaned = tidyOptions(cleaned);
  const close = tab.compose ? null : (pendingRun.empty ? tab.closeEmpty : tab.close) || null;
  const finished = (text) => composeIfNeeded(
    tab,
    ensureClose(capLength(text, tab.maxChars), close, { dropQuestion: !!tab.closeQuestion }),
    pendingRun.empty,
  );

  const reason = checkOutput(cleaned, { input: pendingRun.shown })
    || checkShape(cleaned, tab.shape);

  if (!reason) {
    settle(tabId, finished(cleaned), 'model');
    return;
  }

  console.warn(`[safety] output rejected: ${reason}`);

  // The model went into its own crisis protocol, or said something it must
  // never say. Either way the hardcoded card, with the right numbers.
  if (reason.startsWith('crisis:')) {
    settle(tabId, '', 'crisis');
    return;
  }

  // Worth one more go, but only if the second attempt is told what it got
  // wrong — and told precisely one thing, which a model this small handles
  // far better than a longer, sterner version of the original instruction.
  if (!pendingRun.retried) {
    pendingRun.retried = true;
    if (reason.startsWith('platitude:')) {
      pendingRun.correction = PHRASE_CORRECTION.replace('{phrase}', reason.slice('platitude:'.length));
    } else if (reason === 'petname') {
      pendingRun.correction = PHRASE_CORRECTION.replace('{phrase}', 'pet names such as "dear" or "sweetheart"');
    } else if (reason === 'jargon') {
      pendingRun.correction = PHRASE_CORRECTION.replace('{phrase}', 'journey, healing, process, holding space, moving forward');
    } else if (reason === 'no-options') {
      pendingRun.correction = SAY_FORMAT_CORRECTION;
    } else if (reason === 'no-list') {
      pendingRun.correction = LIST_FORMAT_CORRECTION;
    } else {
      pendingRun.correction = CLARITY_CORRECTION;
    }
    requestId += 1;
    if (activeTab === tabId) showLoading(true);
    send();
    return;
  }

  // The retry did not fix it either. A pet name or a bit of therapy-speak is
  // untidy, not unsafe: something imperfect beats an apology for a question
  // that was fine.
  if (reason === 'petname' || reason === 'jargon') {
    settle(tabId, finished(cleaned), 'model');
    return;
  }

  settle(tabId, humanFallback(tab, { empty: pendingRun.empty }), 'human');
}

/* ---------------------------------------------------------------- model */

function setStatus(kind, text) {
  el.status.className = `status is-${kind}`;
  el.statusText.textContent = text;
  el.statusMark.textContent = kind === 'ok' ? '🍃' : '';
}

function showGate(title, body, actionLabel, onAction) {
  el.gate.hidden = false;
  el.gateTitle.textContent = title;
  el.gateBody.innerHTML = body;
  if (actionLabel) {
    el.gateAction.hidden = false;
    el.gateAction.textContent = actionLabel;
    el.gateAction.onclick = onAction;
  } else {
    el.gateAction.hidden = true;
  }
}

const hideGate = () => { el.gate.hidden = true; el.bar.hidden = true; };

function startDownload() {
  /* Ask the browser to keep this. Phones clear cached site data for sites you
     have not opened in a while, and being asked for the whole model again
     because you had a quiet fortnight is the fastest way to lose someone's
     trust. */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => { /* nothing to do about a no */ });
  }

  fileProgress.clear();
  el.gateAction.hidden = true;
  el.bar.hidden = false;
  el.barLabel.textContent = 'Starting…';
  el.gateTitle.textContent = 'Getting ready';
  el.gateBody.innerHTML =
    'This happens once. Keep this page open while it finishes — '
    + 'after that it stays on this device and works with no internet at all.';
  worker.postMessage({ type: 'load' });
}

function renderProgress() {
  let loaded = 0;
  let total = 0;
  fileProgress.forEach((f) => { loaded += f.loaded; total += f.total; });
  // The tokenizer and config files arrive first and are tiny, so for the
  // first second or two "total" is a few megabytes and the bar would read
  // 100% — then drop to 0% when the weights register. Hold at "Starting…"
  // until the real total is in.
  if (total < 50 * 1048576) return;
  const pct = Math.min(100, (loaded / total) * 100);
  el.barFill.style.width = `${pct.toFixed(1)}%`;
  el.barLabel.textContent =
    `${(loaded / 1048576).toFixed(0)} MB of about ${MODEL_MB} MB · ${pct.toFixed(0)}%`;
}

/* -------------------------------------------- what this device can do

   The check that runs before anything downloads. The brief's message is the
   first line; the device-specific note underneath is there because "try
   Chrome" is useless advice on an iPhone, where every browser is Safari. */

function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

const CANNOT_RUN = {
  ios:
    'On an iPhone or iPad this needs <strong>iOS 18 or newer</strong>. '
    + 'Every browser on an iPhone uses Safari underneath, so installing Chrome '
    + 'will not change this — it is the iOS version that matters.',
  android:
    'On Android this needs <strong>Chrome, on Android 12 or newer</strong>. '
    + 'Check for a Chrome update in the Play Store and try again.',
  desktop:
    'If you are already using Chrome or Edge, an update is usually what fixes it.',
};

async function spareRoom() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    return quota - usage;
  } catch { return null; }
}

const gigabytes = (bytes) => (bytes / 1073741824).toFixed(1);

function applySupport(msg) {
  if (welcome && welcome.isOpen) { supportAnswer = msg; return; }
  supportAnswer = null;

  if (msg.ok) {
    let cached = false;
    try { cached = !!localStorage.getItem(CACHED_FLAG); } catch { /* private mode */ }

    if (cached) {
      showGate('Waking up', 'Reading it back from this device. No download needed.', null);
      el.bar.hidden = false;
      el.barLabel.textContent = 'Loading…';
      worker.postMessage({ type: 'load' });
    } else {
      showGate(
        'One download, then it stays',
        'Seasons of Solace runs entirely on this device — nothing you write is ever sent '
        + `anywhere. It needs to fetch its companion once, about <strong>${MODEL_MB} MB</strong>. `
        + 'After that it lives here and works with no internet.<br><br>'
        + '<strong>Use wifi, not mobile data.</strong> It can take a few minutes.'
        + '<ul class="ready-list"><li>✓ This device can run it</li>'
        + '<li id="roomLine">… Checking space</li></ul>',
        'Get it ready', startDownload,
      );

      spareRoom().then((room) => {
        const line = $('roomLine');
        if (!line) return;
        if (room === null) { line.textContent = '✓ Space looks fine'; return; }
        const enough = room > NEEDED_BYTES;
        line.textContent = enough
          ? `✓ About ${gigabytes(room)} GB free`
          : `⚠ Only about ${gigabytes(room)} GB free — that may not be enough`;
        line.className = enough ? '' : 'is-warning';
      });
    }
  } else {
    showGate(
      "This device can't run Seasons of Solace",
      'This app needs a browser that supports WebGPU. Try the latest version of '
      + 'Chrome or Edge.<br><br>'
      + CANNOT_RUN[deviceKind()]
      + (msg.reason && msg.reason !== 'no-webgpu'
        ? `<br><br><code class="detail">${escapeHtml(msg.reason)}</code>`
        : ''),
      null,
    );
    setStatus('error', 'Not supported');
  }
}

worker.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'support' || msg.type === 'error') answered = true;

  switch (msg.type) {
    case 'support':
      applySupport(msg);
      break;

    case 'load-start':
      setStatus('busy', 'Getting ready…');
      break;

    case 'load-progress':
      fileProgress.set(msg.file, { loaded: msg.loaded, total: msg.total });
      renderProgress();
      break;

    case 'load-file-done':
      if (fileProgress.has(msg.file)) {
        const f = fileProgress.get(msg.file);
        fileProgress.set(msg.file, { loaded: f.total, total: f.total });
        renderProgress();
      }
      break;

    case 'ready':
      modelReady = true;
      try { localStorage.setItem(CACHED_FLAG, '1'); } catch { /* private mode */ }
      hideGate();
      setStatus('ok', 'Ready · works offline');
      setLoading(false);
      break;

    // Only ever a character count — see the note at the top of worker.js.
    case 'tick': {
      if (msg.id !== requestId || activeTab !== pendingTab) break;
      const label = $('loadingText');
      if (label && msg.chars > 80) label.textContent = 'Finding the words…';
      break;
    }

    case 'done':
      if (msg.id !== requestId) break;
      finish(msg.output);
      break;

    case 'error': {
      console.error(msg);
      if (!modelReady) {
        showGate(
          'Having trouble loading',
          'Try refreshing the page.<br><br>'
          + `<code class="detail">${escapeHtml(msg.message || 'Unknown problem.')}</code><br><br>`
          + 'Check your wifi and try again.',
          'Try again', startDownload,
        );
        setStatus('error', "Couldn't load");
        break;
      }
      if (msg.id !== requestId) break;
      const tab = TAB_BY_ID[pendingTab];
      if (GPU_LOST.test(msg.message || '')) {
        settle(pendingTab, 'This device ran out of room to think. Try closing some other tabs or apps, then ask again.', 'notice');
      } else if (tab) {
        settle(pendingTab, humanFallback(tab, { empty: !!(pendingRun && pendingRun.empty) }), 'human');
      } else {
        settle(pendingTab, "Something got in the way. Try again whenever you're ready.", 'notice');
      }
      break;
    }

    default:
      break;
  }
});

/* --------------------------------------------------------------- extras */

function clearAll() {
  // Only stops the run if it belongs to this tab — clearing one tab should not
  // quietly cancel a reply being written for another.
  if (isLoading && pendingTab === activeTab) {
    worker.postMessage({ type: 'stop' });
    requestId += 1;                      // orphan the in-flight reply
    setLoading(false);
  }
  stopSpeaking();
  const data = state[activeTab];
  data.input = '';
  data.output = '';
  data.kind = '';
  el.input.value = '';
  el.input.classList.remove('nudge');
  updateCounter();
  renderOutput('');
  el.input.focus();
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('is-visible');
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => el.toast.classList.remove('is-visible'), 2400);
}

async function copyText(text, note) {
  try {
    await navigator.clipboard.writeText(text);
    toast(note);
  } catch {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    document.execCommand('copy');
    scratch.remove();
    toast(note);
  }
}

/* Read aloud. Grieving people sometimes cannot focus enough to read but can
   listen. Slower than the default, and stopped by anything that changes the
   text on screen. */
let speaking = false;

function stopSpeaking() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  speaking = false;
  el.speakBtn.textContent = '🔈 Read aloud';
  el.speakBtn.setAttribute('aria-pressed', 'false');
}

function toggleSpeech() {
  if (!('speechSynthesis' in window)) { toast("This browser can't read aloud"); return; }
  if (speaking) { stopSpeaking(); return; }

  const text = state[activeTab].output;
  if (!text) return;

  const utterance = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, '').replace(/^- /gm, ''));
  utterance.rate = 0.85;
  utterance.pitch = 1;
  utterance.onend = stopSpeaking;
  utterance.onerror = stopSpeaking;
  window.speechSynthesis.speak(utterance);

  speaking = true;
  el.speakBtn.textContent = '⏹ Stop';
  el.speakBtn.setAttribute('aria-pressed', 'true');
}

function setTheme(theme, { remember = true } = {}) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  const label = dark ? '☀️ Day mode' : '🌙 Night mode';
  el.themeToggle.textContent = label;
  el.themeToggle.setAttribute('aria-pressed', String(dark));
  el.themeToggleTop.textContent = dark ? '☀️' : '🌙';
  el.themeToggleTop.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to night mode');
  el.themeToggleTop.setAttribute('aria-pressed', String(dark));
  if (remember) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  }
}

const toggleTheme = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

const TEXT_SIZES = ['normal', 'large', 'largest'];

function setTextSize(size) {
  document.documentElement.dataset.text = size;
  el.textSizeBtn.textContent = `🔠 Text size: ${size}`;
  try { localStorage.setItem(TEXT_SIZE_KEY, size); } catch { /* private mode */ }
}

/* Version readout. app.js is fetched network-first, so on its own it would
   report the newest version even while a stale service worker was still
   serving old files. So the worker in control is asked what version it is. */
function askWorkerVersion() {
  const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!controller) return Promise.resolve(null);

  return new Promise((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => done((e.data && e.data.version) || null);
    window.setTimeout(() => done(null), 2500);
    controller.postMessage({ type: 'version' }, [channel.port2]);
  });
}

async function showVersion() {
  el.version.textContent = `${APP_VERSION} · ${VERSION_DATE}`;
  el.version.className = 'version';

  if (!('serviceWorker' in navigator)) return;

  const cached = await askWorkerVersion();
  if (!cached || cached === APP_VERSION) return;

  el.version.textContent = `${APP_VERSION} · reload for the latest`;
  el.version.classList.add('is-stale');
  el.version.title = `This page is ${APP_VERSION} but the cache serving it is ${cached}. `
    + 'Reload once more to pick up the new version.';
}

/* ------------------------------------------------- add to home screen

   Chrome and Edge fire beforeinstallprompt, which can be saved and fired
   later from a button of our own — one tap, a proper install. iOS has no
   such API at all: on an iPhone the only way is Share → Add to Home Screen,
   by hand, and pretending otherwise would leave somebody tapping a button
   that does nothing. So the button always opens a panel. If the browser gave
   us a real prompt, the panel offers it. If not, it gives that device's
   actual steps. */

let installEvent = null;

const alreadyInstalled = () => window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

const INSTALL_STEPS = {
  ios:
    '<p><strong>On an iPhone or iPad, in Safari:</strong></p>'
    + '<ol class="install-steps"><li>Tap the <strong>Share</strong> button — the '
    + 'square with an arrow coming out of it.</li>'
    + '<li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>'
    + '<li>Tap <strong>Add</strong>.</li></ol>'
    + '<p class="install-note">Safari is the one that does this. If you are '
    + 'reading this in another browser on an iPhone, open the page in Safari first.</p>',
  android:
    '<p><strong>On Android, in Chrome:</strong></p>'
    + '<ol class="install-steps"><li>Tap the <strong>⋮</strong> menu at the top right.</li>'
    + '<li>Tap <strong>Add to Home screen</strong>, or <strong>Install app</strong> '
    + 'if you see that instead.</li>'
    + '<li>Tap <strong>Install</strong>.</li></ol>',
  desktop:
    '<p><strong>On a computer, in Chrome or Edge:</strong></p>'
    + '<ol class="install-steps"><li>Look for the install icon at the right-hand '
    + 'end of the address bar.</li>'
    + '<li>Or open the <strong>⋮</strong> menu and choose '
    + '<strong>Install Seasons of Solace</strong>.</li></ol>',
};

function openInstall() {
  closeSidebar();
  if (installEvent) {
    el.installSteps.innerHTML =
      '<p>Your browser can do this in one tap.</p>'
      + '<button class="btn install-now" id="installNow" type="button">Add it now</button>';
    $('installNow').addEventListener('click', async () => {
      const prompt = installEvent;
      installEvent = null;              // a prompt can only be used once
      closeInstall();
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') {
        el.installBtn.hidden = true;
        toast('Added to your home screen');
      }
    });
  } else {
    el.installSteps.innerHTML = INSTALL_STEPS[deviceKind()];
  }

  el.install.hidden = false;
  document.body.classList.add('is-locked');
  el.installClose.focus();
}

function closeInstall() {
  el.install.hidden = true;
  document.body.classList.remove('is-locked');
  el.installBtn.focus();
}

function openSidebar() {
  el.sidebar.classList.add('is-open');
  el.scrim.hidden = false;
  el.menuToggle.setAttribute('aria-expanded', 'true');
  el.menuToggle.setAttribute('aria-label', 'Hide the tabs');
}

function closeSidebar() {
  el.sidebar.classList.remove('is-open');
  el.scrim.hidden = true;
  el.menuToggle.setAttribute('aria-expanded', 'false');
  el.menuToggle.setAttribute('aria-label', 'Show the tabs');
}

/* ------------------------------------------------------------------ init */

function init() {
  // Night mode: whatever was chosen last time, or the device's own setting.
  // Somebody opening this at 3am with their phone already in dark mode should
  // not be met with a bright screen.
  let theme = null;
  try { theme = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setTheme(theme, { remember: false });
  } else {
    setTheme(theme);
  }

  let size = null;
  try { size = localStorage.getItem(TEXT_SIZE_KEY); } catch { /* private mode */ }
  setTextSize(TEXT_SIZES.includes(size) ? size : 'normal');

  buildTabs();
  renderTab();
  setLoading(false);
  showVersion();

  el.submitBtn.addEventListener('click', () => run());
  el.clearBtn.addEventListener('click', clearAll);
  el.copyBtn.addEventListener('click', () => {
    if (state[activeTab].output) copyText(state[activeTab].output, 'Copied');
  });
  el.speakBtn.addEventListener('click', toggleSpeech);

  el.input.setAttribute('maxlength', String(MAX_INPUT_CHARS));
  el.input.addEventListener('input', () => { updateCounter(); saveInput(); });
  el.input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  el.themeToggle.addEventListener('click', toggleTheme);
  el.themeToggleTop.addEventListener('click', toggleTheme);

  el.textSizeBtn.addEventListener('click', () => {
    const now = document.documentElement.dataset.text || 'normal';
    setTextSize(TEXT_SIZES[(TEXT_SIZES.indexOf(now) + 1) % TEXT_SIZES.length]);
  });

  el.menuToggle.addEventListener('click', () => {
    if (el.sidebar.classList.contains('is-open')) closeSidebar(); else openSidebar();
  });
  el.scrim.addEventListener('click', closeSidebar);

  welcome = createWelcome({
    root: el.welcome,
    onClose: () => {
      el.gate.classList.remove('is-hushed');
      if (supportAnswer) applySupport(supportAnswer);
    },
  });
  el.aboutBtn.addEventListener('click', () => {
    closeSidebar();
    // Reopening from the sidebar should not hide the app behind the gate
    // again; it is only hushed on the very first visit.
    welcome.show();
  });

  el.installBtn.addEventListener('click', openInstall);
  el.installClose.addEventListener('click', closeInstall);
  el.install.addEventListener('click', (e) => { if (e.target === el.install) closeInstall(); });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();               // keep it for our own button
    installEvent = e;
  });
  window.addEventListener('appinstalled', () => {
    el.installBtn.hidden = true;
    toast('Added to your home screen');
  });
  if (alreadyInstalled()) el.installBtn.hidden = true;

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.install.hidden) closeInstall();
    else if (el.sidebar.classList.contains('is-open')) closeSidebar();
  });

  if (!hasSeenWelcome()) {
    el.gate.classList.add('is-hushed');
    welcome.show();
  }

  worker.postMessage({ type: 'check' });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('sw', err));
  }
}

init();

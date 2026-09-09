/* The welcome — the first thing a person sees, once.

   Five cards, fewer words than any other app in the suite, and no rush. The
   only thing it writes down is a flag saying it has been seen; it never
   records anything about the person. It can be reopened any time from
   "About" in the sidebar. */

const SEEN_KEY = 'seasonsOfSolace_welcomed';

const CARDS = [
  {
    mark: '🍃',
    label: 'Welcome',
    lines: [
      'This is Seasons of Solace.',
      '',
      'A quiet place for grief —',
      'whatever kind, however long,',
      'wherever you are in it.',
    ],
    next: 'Next →',
  },
  {
    label: 'What this is',
    lines: [
      'Grief changes.',
      "Some days it's heavy.",
      "Some days it's quiet.",
      'Some days it hits out of nowhere.',
      '',
      'This app has a space',
      'for every one of those days.',
    ],
    next: 'Next →',
  },
  {
    mark: '🤍',
    label: "What this isn't",
    lines: [
      'This is not therapy.',
      'This is not crisis support.',
      'This is not a replacement',
      'for the people who love you.',
      '',
      'This is a place to sit',
      "with what you're carrying",
      'when you need somewhere to put it.',
    ],
    crisis: true,
    next: 'Next →',
  },
  {
    label: 'How it works',
    lines: [
      'Pick a tab that fits',
      'where you are right now.',
      '',
      'Type as much or as little',
      'as you want.',
      '',
      "There's no wrong way to grieve",
      "and there's no wrong way",
      'to use this.',
    ],
    next: 'Next →',
  },
  {
    mark: '🍃',
    label: 'Ready',
    lines: ['Take your time.'],
    next: 'Enter Seasons of Solace',
  },
];

export function hasSeenWelcome() {
  try { return localStorage.getItem(SEEN_KEY) === 'true'; } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, 'true'); } catch { /* private mode */ }
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function createWelcome({ root, onClose }) {
  let index = 0;
  let open = false;
  let lastFocus = null;

  root.innerHTML = `
    <div class="welcome-card" role="dialog" aria-modal="true"
         aria-labelledby="welcomeHeading" aria-describedby="welcomeBody">
      <button class="welcome-skip" type="button">Skip</button>
      <div class="welcome-stage" id="welcomeStage"></div>
      <div class="welcome-foot">
        <div class="welcome-dots" role="tablist" aria-label="Welcome pages"></div>
        <div class="welcome-nav">
          <button class="btn-ghost welcome-back" type="button">← Back</button>
          <button class="btn welcome-next" type="button"></button>
        </div>
      </div>
    </div>`;

  const card = root.querySelector('.welcome-card');
  const stage = root.querySelector('#welcomeStage');
  const dots = root.querySelector('.welcome-dots');
  const backBtn = root.querySelector('.welcome-back');
  const nextBtn = root.querySelector('.welcome-next');
  const skipBtn = root.querySelector('.welcome-skip');

  CARDS.forEach((c, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'welcome-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Page ${i + 1} of ${CARDS.length}: ${c.label}`);
    dot.addEventListener('click', () => go(i, i > index ? 'next' : 'back'));
    dots.appendChild(dot);
  });

  function paint(data) {
    const parts = [];
    if (data.mark) parts.push(`<div class="welcome-mark" aria-hidden="true">${data.mark}</div>`);
    parts.push('<div class="welcome-body" id="welcomeBody">');
    parts.push(`<h2 class="visually-hidden" id="welcomeHeading">${escapeHtml(data.label)}</h2>`);
    parts.push(`<p class="welcome-lines">${data.lines.map(escapeHtml).join('<br>')}</p>`);
    if (data.crisis) {
      parts.push(
        '<p class="welcome-crisis">If you\'re in crisis, please reach out:<br>'
        + '<strong>988 Suicide &amp; Crisis Lifeline</strong><br>'
        + '(call or text <a href="tel:988">988</a>)</p>',
      );
    }
    parts.push('</div>');
    return parts.join('');
  }

  function render(direction) {
    const data = CARDS[index];
    stage.innerHTML = paint(data);
    stage.classList.remove('slide-next', 'slide-back');
    void stage.offsetWidth;   // restart the animation even when moving the same way twice
    if (direction) stage.classList.add(direction === 'back' ? 'slide-back' : 'slide-next');

    nextBtn.textContent = data.next;
    backBtn.hidden = index === 0;
    skipBtn.hidden = index === CARDS.length - 1;

    [...dots.children].forEach((dot, i) => {
      dot.classList.toggle('is-on', i === index);
      dot.setAttribute('aria-selected', String(i === index));
    });

    card.scrollTop = 0;
  }

  function go(next, direction) {
    if (next < 0 || next >= CARDS.length) return;
    index = next;
    render(direction);
  }

  function show() {
    lastFocus = document.activeElement;
    open = true;
    index = 0;
    root.hidden = false;
    document.body.classList.add('is-locked');
    render(null);
    window.setTimeout(() => nextBtn.focus(), 30);
  }

  function close() {
    open = false;
    root.hidden = true;
    document.body.classList.remove('is-locked');
    markSeen();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    if (onClose) onClose();
  }

  nextBtn.addEventListener('click', () => {
    if (index === CARDS.length - 1) close(); else go(index + 1, 'next');
  });
  backBtn.addEventListener('click', () => go(index - 1, 'back'));
  skipBtn.addEventListener('click', close);

  root.addEventListener('keydown', (event) => {
    if (!open) return;

    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (index === CARDS.length - 1) close(); else go(index + 1, 'next');
      return;
    }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1, 'back'); return; }

    // Keep Tab inside the overlay — behind it is an app that is not ready yet.
    if (event.key === 'Tab') {
      const focusable = [...root.querySelectorAll('button:not([hidden]), a[href]')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
  });

  return { show, close, get isOpen() { return open; }, count: CARDS.length };
}

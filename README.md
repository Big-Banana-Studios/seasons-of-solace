# 🍃 Seasons of Solace

A grief companion. Eight tabs, one input, one quiet reply each — built for the
person sitting alone at 3am who needs someone to say "I'm here."

It runs entirely inside the browser, on your own device, using Liquid AI's
`LFM2.5-2.6B` through WebGPU. No server, no account, no API key, no bill.
Once the model has downloaded it works with no internet at all, and nothing
you write is ever stored or sent anywhere.

**This app is for emotional companionship and self-reflection only. It is not
therapy, not crisis counseling, and not a substitute for professional grief
support. If you're in crisis, call or text 988.**

**Version 1.1.0 · Sep 2026** — the fifth app in the Lewis family suite.

**Live:** <https://big-banana-studios.github.io/seasons-of-solace/>
(Chrome or Edge, up to date; the first visit downloads the 1.7 GB model once.)

---

## Try it right now

Double-click **`run.ps1`**, or from a terminal in this folder:

```powershell
.\run.ps1
```

That starts a small local server and opens the app in your browser. Stop it
with `Ctrl+C`. By hand: `npm start`, then open <http://localhost:8125/>.

It must be served over `http://` — opening `index.html` from the file system
will not work, because ES modules, the worker and the service worker all need
a real origin.

### What to expect the first time

1. **The welcome** — five short cards. Click through, or Skip.
2. **"One download, then it stays"** — the companion is about **1.7 GB** and
   downloads once. Use wifi. Keep the page open while the bar fills.
3. After that it is cached by the browser. Later visits take seconds and work
   with the wifi switched off.
4. The first reply after loading is the slowest; later ones are quicker.

### Will it run on this device?

Opening the link *is* the check — it runs before a single byte downloads.

| Device | Needs |
|---|---|
| Computer | Chrome or Edge, kept up to date. |
| iPhone / iPad | iOS 18 or newer. Every browser on iOS is Safari underneath, so installing Chrome changes nothing. |
| Android | Chrome, updated, on Android 12 or newer. |

**Add to home screen** in the sidebar gives it an icon and opens it
full-screen. On Chrome and Edge that is one tap, using the browser's own
install prompt. iOS has no install API at all, so there it shows the real
steps — Share, then Add to Home Screen — because a button that silently does
nothing is worse than none. The button hides itself once the app is installed.

### Deploying to GitHub Pages

Push this folder to a repo and turn on Pages. `.nojekyll` is already here.
Nothing else is needed — no build, no secrets. Bump `APP_VERSION` in `app.js`
and `VERSION` in `sw.js` together on every deploy; the sidebar compares them
and says so if the cache serving the page is stale.

---

## The eight tabs

| Tab | Season | What it does |
|---|---|---|
| 🌨️ Talk To Me | Winter | Listens and reflects. Never fixes, never advises. |
| 🌱 I Don't Know What I Feel | Spring | Helps name tangled feelings — relief and guilt, anger and love. |
| 🍂 What Do I Say | Autumn | Two or three things to say when someone asks, or when you have to tell them. |
| 🍁 Get Me Through Today | Autumn | Three or four tiny things for the next few hours. Works with nothing typed. |
| 🌻 I Need to Remember Them | Summer | Never gets tired of hearing about them. |
| 🌸 The Grief Nobody Talks About | Spring | Relief, anger, jealousy, guilt, the losses people don't count. Holding, not healing. |
| ❄️ It Hit Me Again | Winter | Emotional first aid for the wave. Works with nothing typed. |
| 🌾 Gentle Reminders | Summer | One true thing for a hard day. Works with nothing typed. |

Every prompt is the brief's, word for word, in `prompts.js`.

---

## How it is put together

```
seasons-of-solace/
├── index.html        # markup, including the permanent disclaimer and 988
├── style.css         # four-season theme, night mode, three text sizes
├── app.js            # tabs, state, the gate, rendering, read-aloud
├── prompts.js        # safety preamble + the eight system prompts
├── safety.js         # crisis detection, input/output filters, fallbacks
├── welcome.js        # the five welcome cards
├── worker.js         # the model, in a worker, via WebGPU
├── sw.js             # offline shell cache
├── assets/           # icon, and the two fonts served from here
├── tools/serve.mjs   # local server
└── tests/            # see below
```

### Decisions worth knowing about

**The 2.6B model, not the 1.2B.** Version 1.0.0 shipped on
`LFM2.5-1.2B-Instruct` like the rest of the suite. It loads in seconds and
runs on more phones, but its replies were generic — "healing journey", "sit
with these sensations together" — and a grief companion that sounds like a
poster is not worth having. `LFM2.5-2.6B` answers the actual sentence the
person typed: the two mugs where he used to sit, the pencil behind Ray's
ear, numbness as the body's protection against feeling everything at once.
It is one constant in `worker.js` (`MODEL_ID`) and one in `app.js`
(`MODEL_MB`); the smaller model is noted beside it if a device cannot
manage the larger download. Replies take ten to thirty seconds on a laptop
GPU rather than five to ten.

**The 2.6B is a thinking model, and thinking is switched off.** Its chat
template opens every reply with a `<think>` tag and offers no way not to.
Left alone it writes a page of analysis — "The user is sharing her grief…
looking at my safety guidelines…" — before a word of the reply, and spends
the token budget on it. None of that is for the person. `worker.js` closes
the think block before generation starts, so the model answers directly;
`safety.js` strips any think block that gets through and treats "the user",
"my guidelines" and clinical vocabulary as the model talking to itself
rather than to the person.

**Replies are not streamed.** The brief's output filters — platitudes, toxic
positivity, crisis language — can only be applied to a whole reply, and a
grieving person should not watch a sentence arrive and then get taken away.
So the worker accumulates the text, checks it as it grows, and hands it over
once. A slow pulse in the tab's colour covers the wait. Somebody who has been
told "everything happens for a reason" by a machine, even for two seconds,
has been told it.

**A reply that fails a check is retried once, quietly,** at a lower
temperature and with a one-line note to the model about what went wrong
("your last attempt used a phrase that is not allowed here: 'at least'").
Most of what a 1.2B model gets wrong is one bad sample; a person who sees
"something got in the way" twice concludes the app is broken.

**No tab ever answers with a bare error.** If the model fails twice, the
person gets words written by people: a grounding response on It Hit Me
Again, the brief's small things on Get Me Through Today, a reminder from the
bank, the brief's example lines on What Do I Say, and the brief's own
validation and close on The Quiet Grief. On the three listening tabs it is
the brief's fallback line ("Something got in the way. I'm still here…")
with one sentence in that tab's voice under it. Somebody who pressed "I
Need a Moment" and got an error has been let down at exactly the wrong
moment, and somebody who just said the thing they cannot say anywhere else
must never be told to "try again".

**Three replies start with words already written.** The first real-model run
showed what a 1.2B model does when asked nicely: What Do I Say answered
"consider reaching out to someone who cares about you" with no words to say;
It Hit Me Again with nothing typed produced three unrelated quoted lines. So
those replies are *prefilled* — generation starts partway through the answer
(`**If you want to keep it short:** "` / `I'm here. You don't have to
explain.` / `In the next hour, if you can:\n- `) and the model has committed
to the shape before it writes anything of its own. The brief's mandated
closing lines for the empty variants ("You're here. That counts." / "Take
your time. I'm not going anywhere.") are guaranteed by the app rather than
hoped for from the model.

**What Do I Say has a shape check, and two paths.** When people keep asking
how you are, the model answers, starting from the brief's own
boundary-setter written out in full, and it must produce at least two
things in quotation marks. Options written in the *coworker's* voice
("Let me know if there's anything I can do") are removed — a model this
size swaps the roles about one time in three — and a reply left with fewer
than two options is retried, then replaced with the brief's example lines.
When somebody has to *tell* people that someone died, the model is not used
at all: the reply is three templates with the person's own words for who
and when slotted in ("I wanted to let you know that my mum died on Sunday.
…"). In testing the model turned that sentence into "my family passed away
recently" and "we lost a family member", and a wrong fact in a death
notification is the one mistake this tab must never make.

**Gentle Reminders are written by people.** With nothing typed: a bank of
twenty-four reminders, one true thing each, never the same one twice
running. With something typed: the common kinds of day — a birthday, a
holiday, a good day and the guilt after it, "let me know if you need
anything", a day spent in bed, 3am, anger, guilt, grief that is years old,
a dream, loneliness, the funeral, going back to work, grieving children, a
pet — each have a reminder written for them (three are the brief's own
examples), and a day none of those fit gets one from the bank. Both models
were tried on this tab. The 1.2B's universal reminders were poster-speak at
best and, once, "the people who left may still be reaching out from
behind"; given "it's her birthday tomorrow" it wrote about "the day he was
meant to share his laughter". The 2.6B, given "I found his handwriting on a
shopping list", twice wrote about *him* finding comfort in a note. A
reminder that is true and general beats one that is specific and wrong.
The brief's prompts are still in `prompts.js`, one flag from being used.

**The brief's closing lines are guaranteed where it writes them.** I Don't
Know What I Feel ends on "Does that feel close to what's happening? …",
The Quiet Grief on "Thank you for trusting this space with that. …", It
Hit Me Again on "I'm right here. … Either way, I'm not going anywhere."
The model is told those lines are already written; if it writes a near
miss of its own, the near miss is replaced rather than doubled. Talk To Me
and Remember Them close in the model's own words, because the brief gives
them several to choose from.

**Get Me Through Today is composed, not generated.** In two full runs the
model never once produced the list the brief asks for — it wrote "water,
fresh air, a soft item, a moment of stillness" in a paragraph, or "1 small
breath together", even when told exactly what it had missed. The list is the
part a person who cannot get out of bed actually needs. So the model now
writes only the one or two sentences about *this* day, and the app adds
three or four of the brief's own small things (water first, or a window, or
toast), the permission, and the close, in the brief's words. Same reasoning
as OniKa SeeS drawing its own tarot cards: the model does the part it is good
at.

**Two empty presses are answered by people, at once.** Pressing It Hit Me
Again or Get Me Through Today with nothing typed shows human-written text
immediately — no pulse, no seven-second wait. The brief asks for an
*immediate* grounding response with a fixed first and last sentence, and in
testing the model's version of that was three unrelated quoted lines, then
"You are safe here. What happened isn't yours to fix." There are three
grounding variants for the wave (one per exercise in the brief) and a
random draw of small things for the day, so a second press is not the first
press again. All three empty-input prompts are still in `prompts.js`; each
tab has an `instantEmpty` flag, and turning it off sends them to the model
again with the prefilled opener and the guaranteed close.

**Therapy-speak is filtered.** "Healing journey", "part of the process",
"holding space", "a way forward" — the language of somebody who wants the
grief to be over. Caught like pet names: retried once, then shown anyway,
because it is untidy rather than unsafe.

**The crisis card does not wait for the model.** The input check runs
whether or not the download has finished, so the submit button is never
disabled while the model loads — only while a reply is being written.

**Bereavement by suicide is not crisis.** The brief's keyword list includes
`/suicide/`. Taken literally that would hand the crisis card to somebody whose
son died by suicide the moment they tried to talk about him — and those are
exactly the people everybody else has stopped listening to. So "my son died by
suicide" goes to the listener, while "thinking about suicide", "I'm suicidal"
and every first-person pattern in the brief go straight to the card. The
tests in `tests/safety.test.mjs` pin both sides of that line.

**"I can't do this anymore" is treated as crisis,** as the brief asks, even
though in a grief app it is more often exhaustion than danger. Erring toward
danger is right. To soften the cost of a false positive, a quieter line sits
under the card: "If I've misread this and you meant something else … I'm
still here." It takes nothing away from the numbers above it.

**Platitudes are checked with a negation window.** "You don't have to move
on" is the opposite of "move on", and some of the best sentences this app
produces are refusals of the things people say. "At least" is the one phrase
that is never allowed, negated or not.

**Fonts are served from this folder,** not from Google. The app promises that
nothing leaves the device; a webfont request to a third party would make
that a smaller truth than it should be. The only outside connections are
the pinned Transformers.js library and the model download from Hugging Face.

**Night mode follows the phone.** With no saved preference, the app opens in
whichever mode the device is in. Somebody opening this at 3am with their
phone already dark should not be met with a bright screen.

**Two colours were adjusted for contrast,** as in OniKa SeeS. The brief's
muted gray-brown (`#8A7E73`) sits at about 3.5:1 on the linen, under the
4.5:1 the same brief asks for. It is kept as `--muted` for dots and rules,
and a deeper `--muted-text` carries every line that has to be read — the
disclaimer above all. `tests/contrast.test.mjs` checks every text/ground pair
in both modes so nobody softens a colour later without finding out.

---

## Safety

Seven layers, as the brief numbers them.

1. **Safety preamble** — prepended to all eight prompts by `buildSystem()`.
   The app never reads a prompt any other way.
2. **Input filter** — 3000 character cap and a deliberately tight injection
   list. The one thing it stops that matters is the ask to impersonate the
   person who died.
3. **Output filter** — coherence and repetition, crisis language, the model
   invoking its own crisis protocol (replaced with the hardcoded card so the
   numbers are always right), the banned phrases, toxic positivity, and the
   model talking about being an AI.
4. **Hardcoded crisis response** — runs before the model, on the brief's
   patterns plus the same intent in other words. Shown as a distinct card
   with 988 and 741741 as tap-to-call links.
5. **Fallbacks** — the brief's three lines, plus the human-written ones for
   the three empty-input tabs.
6. **No data persistence** — inputs and outputs live in memory and die with
   the tab. `localStorage` holds four settings and nothing else:
   `seasonsOfSolace_welcomed`, `seasonsOfSolace_theme`,
   `seasonsOfSolace_textSize`, and `seasonsOfSolace_modelCached`. No
   analytics, no cookies. The smoke test checks that nothing typed ever
   appears in storage.
7. **Persistent disclaimer** — in `index.html`, sticky to the bottom of every
   screen, with 988 as a link. Not injected by script and not removable by
   any code path. It is also on the loading screen and on the "can't run"
   screen, so there is no state of the app without it.

---

## Testing

```powershell
npm test          # safety filters, prompts, contrast — a few hundred milliseconds
npm run smoke     # headless Chrome walks the whole UI; screenshots in .test-profile-shots/
npm run model     # the real model, every tab, printed in full — needs a GPU
npm run check     # test + smoke
```

`npm run model` is the one that matters most and the one that costs most:
it downloads the model into `.model-profile/` (once, 1.7 GB), presses every
tab with a realistic input, and prints every reply so a person can read the
tone. The filters can only say what a reply is *not*. Pass `--rounds=3` to
press everything three times, or `--headed` if headless Chrome will not give
you WebGPU.

`node tests/model.probe.mjs` asks the raw model the brief's prompts for the
tabs the app currently composes or answers by hand, unfiltered, through
`tests/probe.html`. It is for deciding what a new model can be trusted with,
not for checking the app.

---

## Nice-to-haves from the brief

Done: **Read aloud** (slower than the default rate, stops when the text
changes) and **font size** (three steps, everything scales together).

Not done, on purpose, for v1: session bookmarks, ambient sound, and a
separate "text this to someone" button. Every control on the page is one more
thing for a tired mind to look at; **Copy** already does what the last of
those would.

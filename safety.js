/* Safety layers.

   The model is a 1.2B parameter model running on the person's own device. It
   has nothing like the safety training of a large hosted model, so the safety
   lives here, in the app around it, and not in the model's good intentions.

   Layers, in the order the brief numbers them:

     1. Safety preamble on every system prompt              (prompts.js)
     2. Input filter — injection and length                  (this file)
     3. Output filter — coherence, crisis, platitudes         (this file)
     4. Hardcoded crisis response, before the model          (this file)
     5. Fallback responses when a check fails                (this file)
     6. Nothing typed is ever persisted                      (app.js)
     7. The disclaimer and 988 on every screen               (index.html)

   Two judgement calls, both explained where they are implemented:

   - Bereavement by suicide is not crisis. "My son died by suicide" has to
     reach the listener — people bereaved this way are exactly the ones
     everybody else has stopped listening to. First-person intent still goes
     straight to the crisis card, every time.
   - Platitudes are checked with a negation window. "You don't have to move
     on" is the opposite of "move on", and a filter that binned it would throw
     away some of the best sentences this app produces. */

export const MAX_INPUT_CHARS = 3000;

/* ------------------------------------------------------------ normalising */

/* Typographic punctuation, flattened to the plain ASCII the patterns below
   are written in. The model writes "don't" with a curly apostrophe far more
   often than a straight one, and so do phones. */
const straighten = (text) => String(text)
  .replace(/[‘’‛′]/g, "'")
  .replace(/[“”″]/g, '"')
  .replace(/[‐-―]/g, '-')
  .replace(/…/g, '...');

// Lowercase, plain-quoted, single-spaced: what every pattern expects to see.
export const flatten = (text) => straighten(text).toLowerCase().replace(/\s+/g, ' ');

/* ----------------------------------------------------- layer 4: crisis

   Checked first and separately from everything else, so a person in crisis
   who also typed something the injection filter dislikes still gets the
   crisis card and not a brush-off. Runs before the model, always. */

// The brief's list, with word boundaries and light tightening where the
// original would catch something plainly innocent ("end my shift", "join
// them for dinner"). Each is first-person intent, not the presence of a word.
const CRISIS = [
  /\bwant(s|ed|ing)?\s+to\s+die\b/,
  /\bwant(s|ed|ing)?\s+to\s+be\s+dead\b/,
  /\bkill(ing)?\s+myself\b/,
  /\bend\s+(my\s+(own\s+)?life|it\s+all|everything)\b/,
  /\b(want|wants|wanted|ready|going|thinking\s+about|thought\s+about|planning|plan)\s+to\s+end\s+it\b/,
  /\bdon'?t\s+want\s+to\s+(be\s+here|live|exist|wake\s+up|be\s+alive|go\s+on|carry\s+on|keep\s+going)\b/,
  /\bbetter\s+off\s+without\s+me\b/,
  /\bjoin\s+(them|him|her)\b(?!\s+(for|at|next|this|tomorrow|later|tonight|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)))/,
  /\bno\s+reason\s+to\s+(live|go\s+on|stay|be\s+here|keep\s+going|wake\s+up|get\s+up)\b/,
  /\bcan'?t\s+do\s+this\s+anymore\b/,
  /\bcan'?t\s+(go\s+on|keep\s+going)\b/,

  // Added: the same intent in the other words people actually use.
  /\bwish\s+i\s+(was|were)\s+dead\b/,
  /\bwish\s+i\s+(hadn'?t|didn'?t|never)\s+(woken?|wake|woke)\s+up\b/,
  /\bwish\s+i\s+(could|would)\s+(just\s+)?(die|disappear|not\s+wake\s+up|never\s+wake\s+up|stop\s+existing)\b/,
  /\b(sleep|go\s+to\s+sleep)\s+and\s+(never|not)\s+wake\s+up\b/,
  /\b(hurt|hurting|harm|harming|cut|cutting)\s+myself\b/,
  /\bself[\s-]?harm/,
  /\btake\s+my\s+(own\s+)?life\b/,
  /\b(life\s+(is|isn'?t|is\s+not)|not)\s+worth\s+living\b/,
  /\bno\s+point\s+(in\s+)?(living|going\s+on|being\s+here|staying|carrying\s+on|waking\s+up)\b/,
  /\b(nobody|no\s*one)\s+would\s+(miss|notice|care)\b/,
  /\b(this\s+is\s+)?goodbye\s+(everyone|forever|for\s+good)\b/,
  /\bgive\s+up\s+on\s+(life|living)\b/,
  /\b(going|want|planning|ready)\s+to\s+(jump|hang\s+myself|shoot\s+myself|overdose)\b/,
  /\bslit\s+my\s+wrists?\b/,
  /\bnot\s+(going\s+to|gonna)\s+be\s+(here|around)\s+(much\s+longer|anymore|tomorrow)\b/,

  // "suicide" and "overdose" with first-person intent in the same breath.
  /\b(thinking|think|thought|thoughts)\s+(about|of)\s+(suicide|killing\s+myself|ending\s+it|dying)\b/,
  /\b(considering|contemplating|planning|attempted|attempting)\s+suicide\b/,
  /\bmy\s+(own\s+)?suicide\b/,
  /\b(i'?m|i\s+am|i\s+feel|feeling|i\s+have\s+been|i'?ve\s+been|been|getting|get)\s+suicidal\b/,
  /\bsuicidal\s+(thoughts|ideation|feelings|again|lately)\b/,
];

/* Someone else's death, described. When "suicide" or "overdose" appears in
   one of these shapes and nowhere near first-person intent, it is a loss
   being talked about, and it goes to the listener like any other loss. */
const BEREAVEMENT = [
  /\bby\s+(suicide|overdose)\b/,
  /\b(died|death|dead|passed|lost|los[et]|gone|killed|took|found)\b[^.!?]{0,60}\b(suicide|overdos\w*)\b/,
  /\b(suicide|overdos\w*)\b[^.!?]{0,60}\b(died|death|dead|passed|took|lost|killed|gone|found)\b/,
  /\b(his|her|their|dad'?s|mom'?s|mum'?s|son'?s|daughter'?s|brother'?s|sister'?s|husband'?s|wife'?s|partner'?s|friend'?s|\w+'s)\s+(suicide|overdose)\b/,
  /\b(he|she|they)\s+(overdosed|od'?d|accidentally\s+overdosed)\b/,
  /\b(the|an|his|her|their)\s+overdose\s+(was|wasn'?t|had\s+been)\b/,
  /\baccidental\s+overdose\b/,
  /\bsuicide\s+(loss|survivor|survivors|prevention|note|awareness)\b/,
  /\b(killed|kill)\s+(himself|herself|themselves|themself)\b/,
  /\btook\s+(his|her|their)\s+(own\s+)?life\b/,
  /\bcommitted\s+suicide\b/,
  /\b(he|she|they)\s+(was|were|had\s+been|got)\s+suicidal\b/,
];

export function isCrisis(text) {
  const t = flatten(text);
  if (!t.trim()) return false;
  if (CRISIS.some((p) => p.test(t))) return true;

  // The bare words from the brief's list. Crisis unless every mention is
  // clearly about someone who has already died.
  if (/\bsuicide\b|\boverdos(e|ed|ing)\b/.test(t)) {
    return !BEREAVEMENT.some((p) => p.test(t));
  }
  if (/\bsuicidal\b/.test(t)) {
    return !BEREAVEMENT.some((p) => p.test(t));
  }
  return false;
}

/* The brief's hardcoded response. Shown in place of anything the model would
   have said. The numbers are for the US; the app is built there. */
export const CRISIS_RESPONSE =
  "I hear you, and what you're feeling matters. But I need you to talk to someone who can really help right now:\n\n"
  + '**988 Suicide & Crisis Lifeline** — call or text **988** (24/7)\n'
  + '**Crisis Text Line** — text **HOME** to **741741**\n\n'
  + "You don't have to carry this alone. Please reach out.";

/* Under the crisis card, quieter. The filter above cannot tell "I can't do
   this anymore" said in exhaustion from the same words said in danger, and it
   errs toward danger every time — which is right, and which also means it
   will sometimes show this card to somebody who only meant they are worn out.
   This line is for them. It takes nothing away from the card above it. */
export const CRISIS_NOTE =
  "If I've misread this and you meant something else — that you're exhausted, "
  + "that this is too much — that is real too, and I'm still here. You can keep talking in any tab.";

/* ------------------------------------------------- layer 2: input filter

   Attempts to talk past the system prompt. Deliberately tight: there is
   nothing behind this prompt worth stealing, so a false block — a grieving
   person told "I wasn't able to work with that" for an ordinary sentence —
   costs far more than a jailbreak would. The one thing genuinely worth
   stopping is the ask to impersonate the person who died. A model this size
   would do it badly, and even done well it is not something this app should
   be for. */
const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass)\s+(all\s+|your\s+|the\s+|any\s+|previous\s+|prior\s+|these\s+|above\s+|earlier\s+)*(instruction|rule|prompt|direction|guideline|safety|filter|restriction)/,
  /\bsystem\s+prompt\b/,
  /\byour\s+(system\s+)?(prompt|instructions|programming|guidelines)\b/,
  /\b(jailbreak|jailbroken|dan\s+mode|developer\s+mode|god\s+mode)\b/,
  /\bpretend\s+(you'?re|you\s+are|to\s+be|that\s+you|you\s+were)\b/,
  /\byou\s+are\s+now\s+(a|an|dan|free|unrestricted|unfiltered|my\s+(dead|late))\b/,
  /\bfrom\s+now\s+on\s+you\s+(are|will|must|should)\b/,
  /\bact\s+(as|like)\s+(if\s+you|though\s+you|you'?re|you\s+are|a\s+(therapist|counselor|counsellor|doctor|psychologist|chatbot|bot)|an?\s+ai|my\s+(dead|late|mom|mum|dad|father|mother|husband|wife|son|daughter|brother|sister|partner|friend|grandma|grandpa|nan|gran))\b/,
  /\b(be|become|speak\s+as|speak\s+like|talk\s+as|talk\s+like|write\s+as|reply\s+as|answer\s+as)\s+my\s+(dead|late)\b/,
  /\brole[\s-]?play\b/,
  /\bwithout\s+(any\s+)?(restrictions|filters|rules|limits|censorship)\b/,
  /\b(repeat|print|show|reveal|output|display)\s+(the|your)\s+(above|prompt|instructions|rules|system)\b/,
  /^\s*(system|assistant)\s*:/m,
  /<\|[^|]*\|>/,
  /\b(im_start|im_end|endoftext)\b/,
  /###\s*(instruction|system|response)/,
];

export const BLOCKED_MESSAGE =
  "I wasn't able to work with that. Try telling me what you're feeling in your own words.";

export const TOO_LONG_MESSAGE =
  "That's more than I can take in at once. Try a shorter piece of it — there's no rush, and the rest can come after.";

/* Returns null when the text can go to the model, otherwise
   { kind: 'crisis' | 'blocked' | 'too-long', message }. */
export function checkInput(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;

  if (isCrisis(raw)) return { kind: 'crisis', message: CRISIS_RESPONSE };

  if (raw.length > MAX_INPUT_CHARS) return { kind: 'too-long', message: TOO_LONG_MESSAGE };

  const t = flatten(raw);
  if (INJECTION.some((p) => p.test(t))) return { kind: 'blocked', message: BLOCKED_MESSAGE };

  return null;
}

/* ------------------------------------------------ layer 3: output filter */

/* Banned phrases. Each has a pattern; some have `allowIf`, tested against
   what the person typed, because "they're in a better place" is a platitude
   from the app and a belief when it is the person's own. `negatable` means
   the phrase is fine when it is being refused ("you don't have to move on"). */
const PLATITUDES = [
  { label: 'everything happens for a reason', re: /\beverything\s+happens\s+for\s+a\s+reason\b/, negatable: true },
  { label: 'happens for a reason', re: /\bhappen(s|ed)?\s+for\s+a\s+reason\b/, negatable: true },
  { label: 'in a better place', re: /\b(in|to|at)\s+a\s+better\s+place\b/, negatable: true, allowIf: /\bbetter\s+place\b/ },
  { label: "I'm sorry for your loss", re: /\bsorry\s+for\s+your\s+loss\b/, negatable: true },
  { label: 'time heals', re: /\btime\s+(heals|will\s+heal|is\s+a\s+(great\s+)?healer)\b/, negatable: true },
  { label: 'stay strong', re: /\b(stay|be|remain|keep)\s+strong\b/, negatable: true },
  { label: 'I know how you feel', re: /\bi\s+know\s+(exactly\s+)?(how|what)\s+you('re|\s+are)?\s+(feel|feeling|going\s+through)\b/, negatable: true },
  { label: 'at least', re: /\bat\s+(the\s+very\s+)?least\b/, negatable: false },
  { label: 'look on the bright side', re: /\bbright\s+side\b/, negatable: true },
  { label: 'be grateful', re: /\b(be|feel|stay)\s+grateful\b/, negatable: true },
  { label: 'could be worse', re: /\bcould\s+(be|have\s+been|always\s+be)\s+worse\b/, negatable: true },
  { label: 'others have it harder', re: /\b(others|other\s+people|some\s+people|many\s+people)\s+(have|has|had)\s+it\s+(harder|worse|so\s+much\s+worse)\b/, negatable: true },
  { label: 'silver lining', re: /\bsilver\s+lining\b/, negatable: true },
  { label: 'move on', re: /\bmov(e|ing)\s+on\b/, negatable: true },
  { label: 'get over it', re: /\bget(ting)?\s+over\s+(it|this|them|him|her)\b/, negatable: true },
  { label: 'closure', re: /\bclosure\b/, negatable: true },
  { label: 'stages of grief', re: /\b(stages?\s+of\s+grief|grief\s+stages?|(denial|bargaining|acceptance)\s+stage)\b/, negatable: true },
  { label: "they'd want you to be happy", re: /\b(would|'d)\s+want\s+you\s+to\s+(be\s+happy|move\s+on|smile|live|be\s+okay)\b/, negatable: true, allowIf: /\b(would|'d)\s+(have\s+)?want(ed)?\b/ },
  { label: 'watching over you', re: /\b(watching|looking)\s+(over|down\s+on)\s+you\b/, negatable: true, allowIf: /\b(watching|looking|heaven|angel|spirit|sign|signs)\b/ },
  { label: "it was their time", re: /\b(it\s+was|was\s+just)\s+(their|his|her)\s+time\b/, negatable: true },
  { label: "God's plan", re: /\b(god'?s\s+plan|part\s+of\s+(a|the|god'?s)\s+(bigger\s+|greater\s+|larger\s+)?plan|meant\s+to\s+be)\b/, negatable: true, allowIf: /\b(god|lord|plan|faith|pray|heaven|meant)\b/ },
  { label: 'a timeline for grief', re: /\b(by\s+now\s+you\s+should|it'?s\s+been\s+long\s+enough|should\s+be\s+over\s+(it|this)|long\s+enough\s+to\s+grieve)\b/, negatable: true },
  { label: 'suggesting therapy', re: /\b(you\s+(should|need\s+to|ought\s+to|might\s+want\s+to)\s+(talk\s+to|see|speak\s+to|find|consider)\s+(a\s+)?(therapist|counselor|counsellor|professional|doctor|psychologist|grief\s+counselor)|seek\s+professional\s+help|consider\s+(therapy|counseling|counselling|medication)|(therapy|counseling|counselling)\s+(can|could|might|would)\s+help)\b/, negatable: true, allowIf: /\b(therap|counsel|psych|doctor|medication|meds)\w*/ },
  { label: 'suggesting medication', re: /\b(antidepressants?|medication)\s+(can|could|might|may|would)\s+help\b/, negatable: true, allowIf: /\b(medication|meds|antidepressant)\w*/ },
  // "Reaching out to someone who cares could ease the load" — the brief's
  // Talk To Me rules forbid "you need to talk to someone" outside a crisis.
  // The person came here because everyone they could talk to has stopped
  // listening. Allowed when they raised it themselves.
  { label: 'telling them to talk to someone', re: /\b(reach(ing)?\s+out\s+to|talk(ing)?\s+(to|with)|lean(ing)?\s+on|open(ing)?\s+up\s+to)\s+(someone|somebody|a\s+friend|friends|family|loved\s+ones|people|others|a\s+support\s+group)\b[^.!?]{0,50}\b(care|cares|help|helps|ease|support|listen|trust|load)\b/, negatable: true, allowIf: /\b(friend|family|reach\s+out|talk\s+to|support\s+group)\b/ },
  // "Everyone carries scars; yours isn't unique" — the brief's quiet-grief
  // prompt asks the model to say a feeling is common, which is fine. Saying
  // the loss is ordinary is not.
  { label: 'comparing their grief', re: /\b((isn'?t|is\s+not|aren'?t|not)\s+(that\s+|so\s+)?unique|(everyone|everybody)\s+(carries|has|have)\s+(scars|their\s+own\s+(pain|grief|struggles|burdens))|no\s+different\s+from\s+anyone)\b/, negatable: false },
];

/* The voice slipping. Not dangerous, but it breaks the one thing this app is
   for, so it is worth a retry. */
const PRESENCE_BREAK = [
  /\bas\s+an?\s+(ai|artificial\s+intelligence|language\s+model|llm|chatbot|bot|virtual\s+assistant|digital\s+assistant|assistant)\b/,
  /\bi\s+am\s+(an?\s+)?(ai|artificial\s+intelligence|language\s+model|chatbot|bot|virtual\s+assistant|computer\s+program|program)\b/,
  /\bi'?m\s+(just\s+)?(an?\s+)?(ai|artificial\s+intelligence|language\s+model|chatbot|bot|virtual\s+assistant|computer\s+program|program)\b/,
  /\bas\s+(a\s+)?(grief\s+)?(companion|support\s+app|app)\b/,
  /\b(this|the)\s+(app|application|tool|program|chatbot)\s+(is|was|can|cannot|can'?t)\b/,
  /\b(system|safety)\s+(prompt|rules|preamble|protocol|instructions)\b/,
  /\bcrisis\s+(detection|protocol)\b/,
  /\bi\s+(don'?t|do\s+not|cannot|can'?t)\s+have\s+(feelings|emotions|personal\s+experiences)\b/,
  /\bi'?m\s+here\s+to\s+(help|assist|support\s+you\s+with)\b/,
  /\bhow\s+can\s+i\s+(help|assist)\s+you\b/,
  // The companion inserting itself into a memory it was never part of:
  // "his laughter filled the space between us", "Ray's voice in my mind".
  /\bbetween\s+us\b/, /\bboth\s+of\s+us\b/, /\bthe\s+two\s+of\s+us\b/, /\b(to|for|around|left|with|among|gave)\s+us\b/,
  /\bwe('re|\s+are)\s+both\b/, /\bconnected\s+we\s+are\b/,
  /\bin\s+my\s+(mind|memory|memories|heart)\b/,
  /\bi\s+(remember|recall|knew|met|miss|missed|loved|can\s+(still\s+)?(hear|see))\s+(him|her|them)\b/,
  /\b(reminded|reminds)\s+(me|us)\b/,
  /\bwe('re|\s+are)\s+(writing|going\s+through|carrying|in\s+this|sharing)\b/,
  /\b(hold|held|holding|took|take|squeeze|squeezed)\s+my\s+(hand|arm|shoulder)\b/,
  /\bwe\s+(worked|played|sat|laughed|talked|shared|spent|lived|grew\s+up|fixed|built|cooked)\s+together\b/,
  /\bwhen\s+we\s+(worked|were|played|sat|talked)\b/,
];

/* Untidy rather than wrong. Worth one retry; never worth throwing an
   otherwise good answer away for. */
const PET_NAMES = /\b(sweetheart|sweetie|honey|hun|darling|my\s+dear|dear\s+(one|friend|heart)|my\s+friend|my\s+love|dear)\b[,.!]?/;

/* Therapy-speak. Not a platitude exactly, but the language of somebody who
   wants the grief to be over — "healing journey", "part of the process",
   "a way forward". The brief's tone is a season, not a journey to an exit.
   Same handling as pet names: one retry, then shown anyway. Each is checked
   with the negation window, because "there is no process" is a fine thing to
   say. */
const JARGON = [
  /\b(healing|grief|grieving|your|this|the)\s+journey\b/, /\bjourney\s+(of|through)\s+(grief|healing|loss)\b/,
  /\b(healing|grief|grieving)\s+process\b/, /\bpart\s+of\s+(the|your|a)\s+(healing\s+)?process\b/, /\b(the|this|that)\s+process\b/,
  /\bhold(ing)?\s+space\b/, /\bsafe\s+space\b/,
  /\b(way|ways|path|step|steps)\s+forward\b/, /\bmov(e|ing)\s+forward\b/, /\bmov(e|ing)\s+past\s+(it|this)\b/,
  /\bself[\s-]?care\b/, /\bcoping\s+(strategies|mechanisms|skills)\b/,
  /\byour\s+healing\b/, /\bheal(s|ing|ed)?\s+(in|with|over)\s+time\b/, /\bhealing\s+(will|comes|takes|happens|begins|starts)\b/,
  /\bpart\s+of\s+(healing|grieving|the\s+grief)\b/,
  /\blet(ting)?\s+go\b/, /\b(we|us)\s+all\b/,
  // A hint at a crisis line with no crisis: "a line open 24 hours a day".
  // The number is in the footer already; the hint is the model being
  // clinical, not the person being in danger.
  /\b(24\s*\/\s*7|24\s+hours\s+a\s+day|a\s+line\s+open|someone\s+to\s+listen\s+without\s+judgment)\b/,
  // "You're safe here" and "we're here" are the app talking about itself as
  // a place with staff. There is no we, and the person is wherever they are.
  /\byou('re|\s+are)\s+safe\s+(here|now|in\s+this\s+(space|moment))\b/,
  /\bwe('re|\s+are)\s+here\b/, /\bwe('ve|\s+have)\s+got\s+you\b/,
];

/* Model output that would itself be dangerous, or that shows the model has
   gone into its own crisis protocol. Either way the hardcoded card replaces
   it, so the numbers on screen are always the right ones. */
const OUTPUT_CRISIS = [
  /\b(kill|hurt|harm|cut)\s+(yourself|themselves)\b/,
  /\byou\s+should\s+(die|end\s+it|give\s+up|join\s+(them|him|her))\b/,
  /\bjoin\s+(them|him|her)\b(?!\s+(for|at|next|this|tomorrow|later|tonight))/,
  /\bhow\s+to\s+(kill|hang|overdose|end\s+your\s+life|die)\b/,
  /\bend\s+your\s+(life|suffering|pain)\b/,
  /\b(painless|best|easiest)\s+way\s+to\s+die\b/,
  /\b(want|wanting)\s+to\s+die\s+is\s+(okay|fine|understandable|normal)\b/,
  /\bnobody\s+would\s+miss\s+you\b/,
  /\bbetter\s+off\s+without\s+you\b/,
];

const MODEL_PROTOCOL = [
  /\b988\b/, /\b741741\b/, /\bcrisis\s+(lifeline|line|text|hotline|helpline)\b/,
  /\bsuicide\s+(and|&)\s+crisis\b/, /\bnot\s+equipped\s+to\s+support\s+you\b/,
  /\b(hotline|helpline|lifeline)\b/,
];

/* Repeats within the text: the tell-tale of a small model going in circles. */
function isRepetitive(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => flatten(s).trim()).filter((s) => s.length >= 8);
  const seen = new Map();
  for (const s of sentences) {
    seen.set(s, (seen.get(s) || 0) + 1);
    if (seen.get(s) >= 3) return true;
  }
  const words = flatten(text).replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
  const grams = new Map();
  for (let i = 0; i + 5 <= words.length; i += 1) {
    const g = words.slice(i, i + 5).join(' ');
    grams.set(g, (grams.get(g) || 0) + 1);
    if (grams.get(g) >= 4) return true;
  }
  return false;
}

function isGarbled(text) {
  if (/```|<\|[^|]*\|>|\b(im_start|im_end|endoftext)\b/.test(text)) return true;
  if (/^\s*(system|user|assistant|human|ai)\s*:/im.test(text)) return true;
  // Several lines that each open with a quotation mark, and no labels to say
  // whose words they are: the model has written sample sentences at the
  // person rather than a reply to them.
  const quotedLines = (text.match(/^\s*["“]/gm) || []).length;
  if (quotedLines >= 2 && !/\*\*[^*\n]{3,80}\*\*/.test(text)) return true;
  // The model is multilingual and occasionally drifts. A word or two of
  // another script is survivable; a sentence is not. It also drops single
  // words of German or Spanish into English ("a birthday oder a holiday"),
  // which the script check cannot see, so the commonest function words are
  // listed — none of them is an English word.
  const other = (text.match(/[Ѐ-ӿ؀-ۿ぀-ヿ一-鿿가-힯]/g) || []).length;
  if (other > 3) return true;
  if (/\b(oder|und|nicht|aber|ich|dich|nein|avec|dans|pero|también|porque|usted|nada|sino)\b/i.test(text)) return true;
  const letters = (text.match(/[a-zA-Z]/g) || []).length;
  const total = text.replace(/\s/g, '').length;
  if (total > 40 && letters / total < 0.6) return true;
  if (/(.)\1{7,}/.test(text)) return true;
  return false;
}

function isEcho(output, input) {
  const inp = flatten(input || '').trim();
  const out = flatten(output).trim();
  if (!inp || inp.length < 40) return out === inp;
  if (out === inp) return true;
  // A long verbatim chunk of the input coming back is the model repeating
  // rather than responding.
  const chunk = inp.slice(10, 70);
  return chunk.length >= 50 && out.includes(chunk);
}

function negated(text, index) {
  const before = text.slice(Math.max(0, index - 50), index);
  return /\b(don'?t|doesn'?t|didn'?t|never|no\s+need|not|no\s+one|nobody|without|instead\s+of|rather\s+than|isn'?t|aren'?t|won'?t|wouldn'?t|shouldn'?t|can'?t|cannot|nor|refuse|no\s+such\s+thing|there\s+is\s+no|there'?s\s+no)\b/.test(before);
}

/* The first banned phrase in the text, or null. Takes the person's own words
   so a belief they voiced can be reflected back without tripping this. */
export function bannedPhrase(text, input = '') {
  const t = flatten(text);
  const inp = flatten(input);
  for (const p of PLATITUDES) {
    if (p.allowIf && p.allowIf.test(inp)) continue;
    const re = new RegExp(p.re.source, 'g');
    let m;
    while ((m = re.exec(t)) !== null) {
      if (p.negatable && negated(t, m.index)) continue;
      return p.label;
    }
  }
  return null;
}

/* The first piece of therapy-speak in the text, or null. */
export function jargon(text) {
  const t = flatten(text);
  for (const re of JARGON) {
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(t)) !== null) {
      if (!negated(t, m.index)) return m[0];
    }
  }
  return null;
}

/* Format checks for the two tabs whose reply has to be a particular shape:

     'options'  What Do I Say — at least two things to say, in quotation
                marks or under bold labels. "Consider reaching out to
                someone who cares about you" is advice, not words.
     'list'     Get Me Through Today — at least three small things on their
                own lines. A paragraph that mentions water and fresh air in
                passing is not a list somebody exhausted can follow.

   Returns null when the shape is right, otherwise 'no-options' | 'no-list'. */
export function checkShape(text, shape) {
  if (!shape) return null;
  const t = String(text || '');
  if (shape === 'options') {
    const quoted = (t.match(/["“][^"”\n]{12,}["”]/g) || []).length;
    const labels = (t.match(/\*\*[^*\n]{3,80}\*\*/g) || []).length;
    if (quoted < 2 && labels < 2) return 'no-options';
  }
  if (shape === 'list') {
    const items = (t.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gm) || []).length;
    if (items < 3) return 'no-list';
  }
  return null;
}

/* What Do I Say: the words in quotation marks are the grieving person's, to
   be said to somebody else. A model this size keeps swapping the roles and
   writing what the coworker would say back — "Let me know if you need
   anything", "I'm here if you need to talk". Those lines are removed, with
   their label, and anything after the last real option goes too. If fewer
   than two options survive, the shape check sends it round again. */
const COMFORTER = /\b(let\s+me\s+know|i'?m\s+here\s+(for\s+you|if|whenever|to)|if\s+you\s+(ever\s+)?need\s+(anything|to\s+talk|me|support|someone)|anything\s+i\s+can\s+do|take\s+care\s+of\s+yourself|you'?re\s+going\s+through|you\s+seem|i'?m\s+so\s+sorry|it'?s\s+okay\s+to\s+feel|how\s+are\s+you\s+(holding|doing|feeling)|check(ing)?\s+in\s+(with|on)\s+you)\b/i;

export function tidyOptions(text) {
  const lines = String(text || '').split('\n');
  const kept = [];
  for (const line of lines) {
    const quote = line.match(/["“]([^"”]+)["”]/);
    if (quote && COMFORTER.test(straighten(quote[1]))) {
      // Drop a bare label sitting on the line above it.
      if (kept.length && /^\s*\*\*[^*]+\*\*:?\s*$/.test(kept[kept.length - 1])) kept.pop();
      continue;
    }
    kept.push(line);
  }
  // Nothing after the last option: the brief says so, and the model's
  // "Remember — what you choose doesn't change…" paragraphs are padding.
  let last = -1;
  kept.forEach((line, i) => { if (/["“][^"”]{6,}["”]/.test(line)) last = i; });
  const trimmed = last >= 0 ? kept.slice(0, last + 1) : kept;
  return trimmed.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* Telling somebody that someone died. The brief asks for "a simple, direct
   template — clear and short". In testing the model turned "my mum died on
   Sunday" into "my family passed away recently" and "we lost a family
   member", and a wrong fact in a death notification is the one mistake this
   tab must never make. So the templates are written by people, and the
   person's own words for who and when are slotted in. */
const RELATION = /\b(my|our)\s+(mum|mom|mother|mam|ma|dad|father|pa|husband|wife|partner|fianc[ée]e?|boyfriend|girlfriend|son|daughter|baby|little\s+(?:boy|girl)|brother|sister|twin|grandma|grandmother|nan|nana|granny|gran|grandad|grandpa|granddad|grandfather|uncle|aunt|auntie|niece|nephew|cousin|best\s+friend|friend|colleague|neighbour|neighbor|dog|cat|horse)\b/i;
const WHEN = /\b(on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|yesterday|today|last\s+night|this\s+morning|last\s+(?:week|month|weekend)|(?:two|three|four|five|a\s+few|\d+)\s+(?:days|weeks)\s+ago|over\s+the\s+weekend|at\s+the\s+weekend)\b/i;

export function composeTelling(input) {
  const text = String(input || '');
  const rel = (text.match(RELATION) || [])[0];
  const who = rel ? rel.toLowerCase().replace(/^our\b/, 'my') : 'someone very close to me';
  const whenMatch = (text.match(WHEN) || [])[0];
  // Lowercased so "Yesterday" mid-sentence reads right, with the day names
  // put back in capitals.
  const when = whenMatch
    ? ` ${whenMatch.toLowerCase().replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/, (d) => d.charAt(0).toUpperCase() + d.slice(1))}`
    : '';
  const fact = `${who} died${when}`;
  const Fact = fact.charAt(0).toUpperCase() + fact.slice(1);
  return [
    "This doesn't need to be eloquent. It needs to be clear and short, and then it's done. Here are a few ways to say it — change the details to fit.",
    `**If you want to keep it simple:** "I wanted to let you know that ${fact}. I'll need some time, and I may not be able to talk about it for a while."`,
    `**If it's for work:** "I'm writing to let you know that ${fact}. I'll be away for the next few days and will let you know when I'm back. Thank you for understanding."`,
    `**If you're not ready to talk about it:** "${Fact}. I'm not able to talk about it yet, but I wanted you to know."`,
  ].join('\n\n');
}

/* Makes sure a reply ends on the sentence the brief says it must. The model
   usually gets close ("You're here. That matters.") and sometimes forgets;
   either way the person reads the line the brief wrote. A near-miss last
   sentence is replaced rather than doubled. */
export function ensureClose(text, close, { dropQuestion = false } = {}) {
  const t = String(text || '').trim();
  if (!close) return t;
  const norm = (s) => flatten(s).replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (norm(t).endsWith(norm(close))) return t;

  // Only the last line is touched, so a list above it keeps its line breaks.
  const lines = t.split('\n');
  let tail = lines.pop() || '';
  if (!/^\s*(?:[-*•]|\d+[.)])\s/.test(tail)) {
    const nearMiss = /not going anywhere|going nowhere|right here|that counts|that matters|that is enough|that's enough|you're here|you are here|take your time|trusting (this|me)|takes courage|thank you for (trusting|sharing|telling)|feel close|naming it|figured out|is enough for (right )?now/;
    const sentences = tail.split(/(?<=[.!?])\s+/);
    while (sentences.length && nearMiss.test(flatten(sentences[sentences.length - 1]))) sentences.pop();
    // Where the close asks its own question, the model's question goes.
    while (dropQuestion && sentences.length && /\?\s*$/.test(sentences[sentences.length - 1])) sentences.pop();
    tail = sentences.join(' ').trim();
  }
  if (tail) lines.push(tail);
  const body = lines.join('\n').trim();
  return body ? `${body}\n\n${close}` : close;
}

/* Everything the model produced arrives here in one piece. Returns null when
   it can be shown, otherwise a reason:

     'crisis:harm'      the text itself is dangerous          → crisis card
     'crisis:protocol'  the model invoked its own protocol    → crisis card
     'platitude:<x>'    a banned phrase                       → retry, then fallback
     'presence'         talked about being an AI / the app    → retry, then fallback
     'empty' | 'repetitive' | 'garbled' | 'echo'              → retry, then fallback
     'petname' | 'jargon'  untidy                             → retry, then show anyway */
export function checkOutput(text, { input = '' } = {}) {
  const raw = String(text || '');
  const t = flatten(raw);

  if (OUTPUT_CRISIS.some((p) => p.test(t))) return 'crisis:harm';
  if (MODEL_PROTOCOL.some((p) => p.test(t))) return 'crisis:protocol';

  const trimmed = raw.trim();
  if (trimmed && isGarbled(raw)) return 'garbled';
  if (trimmed.length < 25 || trimmed.split(/\s+/).length < 5) return 'empty';
  if (isRepetitive(raw)) return 'repetitive';
  if (isEcho(raw, input)) return 'echo';

  const phrase = bannedPhrase(raw, input);
  if (phrase) return `platitude:${phrase}`;

  if (PRESENCE_BREAK.some((p) => p.test(t))) return 'presence';
  if (PET_NAMES.test(t)) return 'petname';
  if (jargon(raw)) return 'jargon';

  return null;
}

/* Mid-generation check, run by the worker every few dozen characters so a
   run that has already gone wrong is stopped early rather than finished.
   A saving of time, not of safety: app.js checks the finished text again. */
export function outputWentWrong(partial, input = '') {
  const t = flatten(partial);
  if (OUTPUT_CRISIS.some((p) => p.test(t))) return true;
  if (MODEL_PROTOCOL.some((p) => p.test(t))) return true;
  if (PRESENCE_BREAK.some((p) => p.test(t))) return true;
  if (bannedPhrase(partial, input)) return true;
  if (isGarbled(partial)) return true;
  return false;
}

/* ---------------------------------------------------------------- tidying */

/* Removes what a small model adds that no person should see: invented links,
   phone numbers, emojis, headings, and any "Response:" label it decided to
   open with. Runs before the checks so a heading does not count as garbled. */
export function scrub(text) {
  // The model's own punctuation is left alone — a dash it wrote as a dash
  // should not come out as a hyphen jammed between two words. The checks
  // straighten their own copy. Only the ellipsis character is flattened,
  // because the font has no glyph for it worth keeping.
  let t = String(text || '').replace(/…/g, '...');
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, '');
  t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '');
  // Phone numbers other than the two on the crisis card. If the model
  // invented one it is wrong, and a wrong number on this card is dangerous.
  t = t.replace(/\b(?!988\b)(?!741741\b)(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '');
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '');
  // Zero-width characters and non-breaking spaces, which a tokenizer can
  // emit and which make "ends with a question mark" quietly false. The
  // character class below is written with the literal (invisible)
  // characters U+200B–U+200F, U+2060 and U+FEFF; the second is U+00A0.
  t = t.replace(/[​-‏⁠﻿]/g, '').replace(/ /g, ' ');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^\s*(response|answer|reply|assistant|companion|output)\s*:\s*/i, '');
  // Italic markers become nothing; bold is kept for the What Do I Say labels.
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
  t = t.replace(/_{1,2}([^_\n]+)_{1,2}/g, '$1');
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  t = t.trim();
  // A quotation mark left dangling at the very end, with nothing to close.
  const quotes = (t.match(/["“”]/g) || []).length;
  if (quotes % 2 === 1 && /["”]$/.test(t)) t = t.slice(0, -1).trim();
  return t;
}

/* Cuts the assistant-shaped sign-offs from the end. "Let me know if you need
   anything else" is, word for word, one of the phrases the brief names as
   what grieving people are tired of hearing. Removes from the end only, one
   sentence at a time, and never so far that the reply is gutted. */
const SIGN_OFF = [
  /\blet\s+me\s+know\b/, /\bfeel\s+free\s+to\b/, /\bdon'?t\s+hesitate\b/,
  /\bwould\s+you\s+like\s+me\s+to\b/, /\bwant\s+me\s+to\b/, /\bshall\s+i\b/,
  /\bif\s+you'?d\s+like,?\s+(we|i)\s+can\b/, /\bif\s+you\s+(want|like|are\s+comfortable|feel\s+ready),?\s+(we|i)\s+can\b/,
  /\bwe\s+can\s+(explore|take\s+it|try|work\s+through|talk\s+(about|through)|go\s+from\s+there)\b/,
  /\bwhenever\s+you'?re\s+ready,?\s+(we|i)\s+can\b/,
  /\bis\s+there\s+anything\s+else\b/, /\banything\s+else\s+(i\s+can|you'?d\s+like)\b/,
  /\bi\s+hope\s+this\s+helps\b/, /\bhope\s+that\s+helps\b/, /\bi'?m\s+here\s+to\s+help\b/,
  /\bhappy\s+to\s+help\b/, /\bhow\s+can\s+i\s+(help|assist)\b/, /\bif\s+you\s+need\s+(any\s+)?(further|more)\s+(help|support|assistance)\b/,
  /\btake\s+care\s*[!.]*$/, /\btake\s+care\s+of\s+yourself\b/, /\bsincerely\b/, /\bwarm(ly|\s+regards)\b/, /\bbest\s+wishes\b/,
];

export function trimSignOff(text, { keepQuestion = true } = {}) {
  const original = String(text || '').trim();
  const isSignOff = (s) => SIGN_OFF.some((p) => p.test(flatten(s)));
  const isQuestion = (s) => /\?["”’'*)]*\s*$/.test(s);
  // List items and quoted options are left exactly as they are.
  const isFixed = (p) => /^\s*(?:[-*•]|\d+[.)])\s/.test(p) || /["“]/.test(p);

  const parts = original.split(/\n\s*\n/).map((p) => (
    isFixed(p) ? { raw: p } : { sentences: p.split(/(?<=[.!?])\s+/) }
  ));

  // An offer to do something next is cut wherever it sits — the model likes
  // to tuck one into the middle of a reply as well as the end.
  for (const part of parts) {
    if (part.sentences) part.sentences = part.sentences.filter((s) => !isSignOff(s));
  }

  /* Questions. Where the tab asks for none — a reminder, a grounding line,
     words to say — every one goes, wherever it sits. Where the tab asks for
     one, the first is kept and the rest go: one question is an invitation,
     two is an interview. */
  let seen = 0;
  for (const part of parts) {
    if (!part.sentences) continue;
    part.sentences = part.sentences.filter((s) => {
      if (!isQuestion(s)) return true;
      seen += 1;
      return keepQuestion && seen === 1;
    });
  }

  const result = parts
    .map((part) => (part.raw !== undefined ? part.raw : part.sentences.join(' ').trim()))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  // Never gut it. A reply that was mostly sign-off was a bad reply anyway,
  // and the coherence check will see the short remainder and ask again.
  if (result.length < 12) return original;
  return result;
}

/* Hard length cap, cut at the end of a sentence so nothing trails off. */
export function capLength(text, maxChars) {
  const t = String(text || '').trim();
  if (!maxChars || t.length <= maxChars) return t;
  const head = t.slice(0, maxChars);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (cut > maxChars * 0.5) return head.slice(0, cut + 1).trim();
  const lastPeriod = head.lastIndexOf('.');
  if (lastPeriod > maxChars * 0.5) return head.slice(0, lastPeriod + 1).trim();
  return head.trim();
}

/* -------------------------------------------------- layer 5: fallbacks */

export const FALLBACK_RESPONSES = [
  "I'm here. Can you try telling me that in a different way?",
  "I want to hear you but that didn't come through clearly. Take your time and try again.",
  "Something got in the way. I'm still here — try again whenever you're ready.",
];

export function fallback() {
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}

/* The brief's fallback line, followed by a sentence in the tab's own voice,
   for the three listening tabs. "Something got in the way" on its own is
   an error message; with the second line it is somebody still there. */
const WARM_LINES = {
  talk: "You don't have to say it better, or say more. I'm here if you want to keep going, and I'm here if you don't.",
  name: "Whatever is in there — relief, anger, guilt, nothing at all — it's allowed, and it doesn't have to be sorted out tonight.",
  remember: "I want to hear about them. A memory, something they used to do, the way they said your name — there's no wrong way to start.",
};

export function warmFallback(tabId) {
  const line = WARM_LINES[tabId];
  return line ? `${fallback()}\n\n${line}` : fallback();
}

/* The Quiet Grief never gets an apology either. Somebody who just said the
   thing they cannot say anywhere else, and got "try again", has been told
   the one thing this tab exists to never tell them. Built from the brief's
   own validation and close. */
export const QUIET_FALLBACK =
  "What you just said is a real thing that real people feel, and there's nothing wrong with you for feeling it. "
  + "You're not the only person who has ever felt it. You're just one of the few who has said it out loud.\n\n"
  + "You don't have to resolve it. You don't owe anyone an explanation for it — not even yourself. It can just exist here.\n\n"
  + 'Thank you for trusting this space with that. It takes courage to say the things grief tells you to keep quiet.';

/* Written by people, for the tabs where an apology would land at the worst
   possible moment. Somebody who pressed "I Need a Moment" and got "something
   got in the way" has been let down exactly when it mattered.

   It Hit Me Again with nothing typed always gets one of these, at once —
   the brief asks for an immediate grounding response with a fixed first and
   last line, and that is a thing people can write better than a 1.2B model
   can improvise in seven seconds. Three variants, one per grounding
   exercise in the brief, so a second press is not the first press again. */
export const WAVE_INSTANT = [
  "I'm here. You don't have to explain.\n\n"
  + "Put your feet flat on the floor. Feel the ground under them — it's still there.\n\n"
  + "Grief doesn't expire. It lives in the places you shared with them, and sometimes you walk into one without warning. That isn't a setback. That's love with nowhere to go.\n\n"
  + "Take your time. I'm not going anywhere.",

  "I'm here. You don't have to explain.\n\n"
  + "Take one slow breath — in through your nose, out through your mouth. Just one.\n\n"
  + "This is a wave, and waves pass. Not because the love is any smaller, but because a body can only hold this much at once, and then it sets some down.\n\n"
  + "Take your time. I'm not going anywhere.",

  "I'm here. You don't have to explain.\n\n"
  + "Look around the room. Name one thing you can see. Just one.\n\n"
  + "It hit you out of nowhere because that is how grief works — it lives in ordinary things, and you cannot see them coming. That doesn't mean you're going backwards. It means you loved someone.\n\n"
  + "Take your time. I'm not going anywhere.",
];

export const WAVE_FALLBACK = WAVE_INSTANT[0];

export function waveInstant() {
  return WAVE_INSTANT[Math.floor(Math.random() * WAVE_INSTANT.length)];
}

/* Get Me Through Today. The brief's own small things, in the brief's own
   words. The model writes the one or two sentences about this particular
   day; everything after them comes from here. */
export const TODAY_THINGS = [
  'Drink a glass of water right now.',
  'Open a window, or step outside for two minutes.',
  "Eat something, even if it's just toast.",
  "Text one person back, even if it's just an emoji.",
  'Take a shower, or just wash your face.',
  'Lie on the floor for five minutes. Sometimes that actually helps.',
  'Change into different clothes.',
  "Put on a show you've seen before, so you don't have to think.",
];

// Water, air and toast are the ones that matter most; one of those three is
// always first, and the rest are drawn from the whole list.
function drawThings(count) {
  const first = TODAY_THINGS[Math.floor(Math.random() * 3)];
  const rest = TODAY_THINGS.filter((t) => t !== first);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest.slice(0, count - 1)];
}

export const TODAY_HEAD = "Today is hard. You don't have to explain why.";

export function composeToday(acknowledgment, { empty = false } = {}) {
  const head = (acknowledgment && acknowledgment.trim()) || TODAY_HEAD;
  const things = drawThings(empty ? 3 : 4);
  const intro = empty ? 'In the next hour, if you can:' : 'For the next few hours, if you can:';
  const permission = empty
    ? "That's all. You don't have to do anything else today. Existing is enough."
    : "If all you do today is get through today, that's enough. That's the whole job right now.";
  const close = empty
    ? "You're here. That counts."
    : "You don't have to be okay. You just have to be here. And you are.";
  return [head, `${intro}\n${things.map((t) => `- ${t}`).join('\n')}`, permission, close].join('\n\n');
}

export const TODAY_FALLBACK =
  "Today is hard. You don't have to explain why.\n\n"
  + "In the next hour, if you can:\n"
  + "- Drink a glass of water right now.\n"
  + "- Open a window, or step outside for two minutes.\n"
  + "- Eat something, even if it's just toast.\n\n"
  + "That's all. You don't have to do anything else today. Existing is enough.\n\n"
  + "You're here. That counts.";

/* The brief's own example lines, for when the model twice failed to hand
   over words. They are generic, which is the point: any of them can be said
   to anyone. */
export const SAY_FALLBACK =
  "There's no perfect thing to say here, and you don't need one. Here are a few things you could actually say.\n\n"
  + "**If you want to keep it short:** \"I'm taking it day by day. Thanks for asking.\"\n\n"
  + "**If you want to be honest:** \"Honestly, I'm not okay. But I'm here, and some days that's the whole job.\"\n\n"
  + "**If you're not ready to talk about it:** \"I appreciate you thinking of me. I'm not ready to talk about it yet, but I will be.\"";

/* Gentle Reminders with nothing typed. Written by people, one true thing
   each, in the brief's voice: meets grief where it lives, not where people
   wish it lived. Also the floor under the model's tailored reminders when
   one fails its checks twice. */
export const REMINDERS = [
  "Grief isn't a task you're behind on. There is no schedule, and nobody holding a clipboard. You're allowed to be exactly where you are.",
  "The people who went quiet didn't stop caring. Most of them just don't know what to say. That's about them, not about you or the person you lost.",
  "You can be fine at breakfast and undone by lunch. That isn't going backwards. That's what carrying someone looks like from the inside.",
  "Missing them this much is not a problem to solve. It's the shape love takes when there's nowhere left to put it.",
  "You don't owe anyone a version of this that's easier to watch. You're allowed to grieve in a way that makes other people uncomfortable.",
  "Some days the only thing you'll manage is to keep breathing. On those days, that is the whole job, and you did it.",
  "Forgetting for a minute isn't a betrayal. Neither is remembering for an hour. Both of them are just you, still loving someone.",
  "Nobody gets to tell you how long this should take. Not a calendar, not a coworker, not the part of you that thinks you should be further along.",
  "You didn't lose them once. You lose them again at every table set for one fewer, every time you reach for the phone. That isn't you failing. That's how big they were.",
  "There's no version of this where you did it right. Nobody does it right. You're allowed to stop grading yourself on a test that doesn't exist.",
  "The second year can be quieter and harder at the same time. The casseroles stop, the check-ins thin out, and the missing doesn't. You're not behind. The world moved on before you did, and it always does.",
  "If you can't remember their voice as clearly today, it isn't gone. It's underneath everything else you're carrying. It comes back at strange moments, usually when you've stopped reaching for it.",
  "You can be angry at someone and miss them in the same breath. Grief doesn't ask you to pick.",
  "A good day isn't a betrayal. It doesn't mean you've stopped loving them. It means your body found a few hours it could rest in, and it needed them.",
  "Crying in the car isn't a breakdown. It's the only room you've had to yourself all day.",
  "\"Let me know if you need anything\" means well, and it asks you to do the work. You're allowed to say what you need. You're also allowed to have no idea.",
  "The people who won't say their name aren't protecting you. They're protecting themselves. You can say it out loud as often as you want.",
  "You don't have to be strong for anyone today. You can be exactly as tired as you are.",
  "There is no amount of grief that proves you loved them enough. You already did.",
  "Nobody gets to say your loss counts less because of who they were to you, how long it's been, or what the paperwork called them.",
  "The house being quiet isn't peace. It's absence, and absence is loud. You're not imagining it.",
  "You don't have to keep everything, and you don't have to give anything away. The clothes can stay in the wardrobe for as long as they need to.",
  "Ordinary days can be the hardest ones. There's no ceremony for a Tuesday. There's just you, and the fact that they're not in it.",
  "You're allowed to want a break from grieving, and you're allowed to feel guilty about that too. Wanting rest doesn't mean wanting to forget.",
];

export const REMINDER_FALLBACKS = REMINDERS;

/* Tailored reminders. The brief asks for a reminder matched to the kind of
   day the person describes. In testing, the model given "it's her birthday
   tomorrow" wrote about "the day he was meant to share his laughter" and
   "if you see himself reflecting" — it cannot be trusted with the pronouns,
   let alone the day. So the common kinds of day are matched here, first
   match wins, and each has a reminder written by people (three of them are
   the brief's own examples). A day none of these fit goes to the model,
   with the general bank as the floor under it. */
export const THEMED_REMINDERS = [
  { theme: 'a pet', re: /\b(my\s+(dog|cat|horse|rabbit|bird|pet)|our\s+(dog|cat|horse|pet)|just\s+a\s+(dog|cat|pet|animal))\b/i,
    text: "A pet isn't 'just' anything. They were in every ordinary hour of your day, and now every ordinary hour has a gap in it. That's real grief, and it counts." },
  { theme: 'grieving children', re: /\b(my\s+(kids|children|son|daughter|boy|girl)|the\s+kids|the\s+children)\b/i,
    text: "Children grieve in pieces, between games and snacks, and then forget for a while. That isn't shallow. It's how they survive it. You don't have to have the answers to sit with them in the questions." },
  { theme: 'a birthday or anniversary', re: /\b(birthday|anniversary|would\s+have\s+been\s+\d+|the\s+date|a\s+year\s+(ago\s+)?today|one\s+year|months?\s+today)\b/i,
    text: "A birthday without them is a day the calendar didn't warn you about. You don't have to mark it and you don't have to ignore it. Whatever gets you to bedtime counts as getting through it." },
  { theme: 'a holiday', re: /\b(christmas|thanksgiving|easter|hanukkah|new\s+year|mother'?s\s+day|father'?s\s+day|valentine|holiday|holidays|the\s+festive)\b/i,
    text: "The holidays ask everyone to be glad on schedule, and grief doesn't keep a schedule. You're allowed to leave early, skip it, or sit in the car for a while. The day will end either way, and you'll have got through it." },
  { theme: 'the funeral', re: /\b(funeral|burial|cremation|memorial|the\s+service|(a|the)\s+wake|scatter(ing)?\s+(the\s+)?ashes)\b/i,
    text: "Funerals are for the living, and the living are exhausted. You don't have to say the right thing today, or feel the right thing, or hold it together for anyone." },
  { theme: 'the middle of the night', re: /\b(can'?t\s+sleep|not\s+sleeping|3\s*am|three\s+in\s+the\s+morning|middle\s+of\s+the\s+night|awake\s+(all\s+night|again)|insomnia|lying\s+awake)\b/i,
    text: "Three in the morning is when grief has the whole house to itself. Nothing you think at this hour is the final word on anything. Morning will come, and you can decide things then." },
  { theme: 'a dream about them', re: /\b(dream|dreamt|dreamed|dreaming)\b/i,
    text: "Dreaming about them isn't a setback and it isn't a message. It's your mind doing what minds do with people it loves. You're allowed to be glad it happened and wrecked that you woke up." },
  { theme: 'a good day, and guilt about it', re: /\b(laughed|laughing|smiled|smiling|a\s+good\s+day|felt\s+(okay|fine|happy|normal|good)|enjoyed|had\s+fun|forgot\s+for\s+a\s+(while|minute|moment)|guilty\s+for\s+(feeling|being)|feel\s+guilty)\b/i,
    text: "You laughed today and then felt guilty about it. The guilt is lying to you. Laughing doesn't mean you've forgotten. It means you're still alive, and they would want that." },
  { theme: 'people asking, and offers of help', re: /\b(let\s+me\s+know\s+if|keep\s+asking|keeps\s+asking|how\s+are\s+you|people\s+(ask|asking|say|keep)|offers?\s+(of|to)\s+help|need\s+anything)\b/i,
    text: "The people who say 'let me know if you need anything' mean well, but it puts the work on you. You're allowed to need things without being the one to organize the help." },
  { theme: 'a day when nothing got done', re: /\b(did\s+nothing|didn'?t\s+(do|get)\s+anything|couldn'?t\s+get\s+(up|out\s+of\s+bed)|stayed\s+in\s+bed|in\s+bed\s+all\s+day|wasted\s+the\s+day|so\s+tired|exhausted|no\s+energy|unproductive|lazy)\b/i,
    text: "If today all you did was exist, that was enough. The world asks too much of grieving people. You don't owe productivity to anyone right now." },
  { theme: 'anger', re: /\b(angry|anger|furious|rage|raging|so\s+mad|pissed\s+off|hate\s+everyone|want\s+to\s+scream)\b/i,
    text: "Anger is grief with its sleeves rolled up. It isn't a failure of love. It's love with nowhere to go, looking for something to do." },
  { theme: 'guilt about what could have been done', re: /\b(should\s+have|should'?ve|if\s+only|could\s+have\s+(saved|stopped|done)|my\s+fault|blame\s+myself|i\s+wasn'?t\s+there|didn'?t\s+(say|call|visit|notice))\b/i,
    text: "Guilt is grief looking for a door it could have closed. There wasn't one. Loving someone doesn't come with a way to have saved them." },
  { theme: 'grief that is years old', re: /\b(\d+\s+years|years\s+(ago|later|on|since)|a\s+long\s+time\s+ago|still\s+(hurts|miss|grieving|cry)|decades?)\b/i,
    text: "There's no expiry date on this. Years in, it still turns up, and it still counts. Missing someone for a long time isn't a problem. It's what loving them for a long time looks like." },
  { theme: 'loneliness', re: /\b(alone|lonely|loneliness|nobody\s+(calls|checks|asks|comes)|no\s*one\s+(calls|checks|asks|comes)|empty\s+house|on\s+my\s+own)\b/i,
    text: "Nobody warns you that grief is lonely even in a full room. The loneliness isn't a sign you've done this wrong. It's the size of the space they left." },
  { theme: 'going back to work', re: /\b(back\s+(to|at)\s+work|at\s+work|work\s+(tomorrow|today|on\s+monday|is\s+asking)|my\s+(job|boss|manager|office|desk|shift)|the\s+office|colleagues?|coworkers?|deadline|night\s+shift)\b/i,
    text: "Work will ask you to be normal before you are. You're allowed to do the minimum, close the door, and go home on time. Being back is not the same as being fine, and nobody there needs to know the difference." },
];

export function themedReminder(input) {
  const text = String(input || '');
  if (!text.trim()) return null;
  const hit = THEMED_REMINDERS.find((t) => t.re.test(text));
  return hit ? hit.text : null;
}

// Never the same one twice running: a second press is a second reminder.
let lastReminder = -1;

export function reminderInstant() {
  let i = Math.floor(Math.random() * REMINDERS.length);
  if (i === lastReminder) i = (i + 1) % REMINDERS.length;
  lastReminder = i;
  return REMINDERS[i];
}

export const reminderFallback = reminderInstant;

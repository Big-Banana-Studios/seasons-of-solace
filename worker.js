/* Runs the model, on the person's own device. Nothing typed here ever leaves
   the machine — there is no server to send it to.

   It lives in a worker because generation occupies a thread for tens of
   seconds, and on the main thread that would freeze the page, the typing and
   the breathing animation. Everything talks to app.js by postMessage.

   One rule shapes the file: **raw model text is never sent to the page while
   it is being generated.** The brief's output filters — platitudes, toxic
   positivity, crisis language — can only be applied to a whole reply, and a
   grieving person should not watch a sentence arrive and then get taken away.
   So the text accumulates here, gets checked here as it grows, and is posted
   exactly once, at the end, for app.js to check again before anything is
   drawn. What the page gets during generation is a character count, which is
   enough to keep the pulse honest. */

// Must be the package root, NOT /dist/transformers.web.js. That dist file
// imports 'onnxruntime-common' and 'onnxruntime-web/webgpu' as bare specifiers,
// which no browser can resolve without an import map — it throws on the first
// line and takes the whole worker down with it.
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

import { outputWentWrong } from './safety.js';

/* The 2.6B model. The app shipped on LFM2.5-1.2B-Instruct-ONNX (814 MB),
   which loads faster and runs on more phones, but its replies were generic
   — "healing journey", "sit with these sensations together" — and a grief
   companion that sounds like a poster is not worth having. Keep MODEL_MB
   in app.js in step with whatever is chosen here.
     Smaller: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX'  (~814 MB at q4)          */
const MODEL_ID = 'LiquidAI/LFM2.5-2.6B-ONNX';
const DTYPE = 'q4';

// No model files ship with this site — GitHub Pages cannot host an 814MB file —
// so everything comes from the Hugging Face CDN and is cached by the browser.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;

let tokenizer = null;
let model = null;
let loading = null;
let stopper = null;
let support = null;

const post = (msg) => self.postMessage(msg);

/* Cached deliberately. Each requestAdapter() hands back an adapter that is then
   dropped for the garbage collector, and a released adapter is one of the ways
   the underlying WebGPU instance goes away. Ask once, keep the answer. */
async function checkSupport() {
  if (support) return support;

  if (!('gpu' in self.navigator)) {
    support = { ok: false, reason: 'no-webgpu' };
    return support;
  }
  try {
    const adapter = await self.navigator.gpu.requestAdapter();
    support = adapter ? { ok: true } : { ok: false, reason: 'no-adapter' };
  } catch (err) {
    support = { ok: false, reason: err.message };
  }
  return support;
}

async function load() {
  const state = await checkSupport();
  if (!state.ok) {
    const err = new Error(state.reason);
    err.code = state.reason;
    throw err;
  }

  post({ type: 'load-start' });

  // Reports bytes per file, so the first run shows real progress instead of an
  // unexplained several-minute wait.
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.file && p.total) {
      post({ type: 'load-progress', file: p.file, loaded: p.loaded, total: p.total });
    } else if (p.status === 'done' && p.file) {
      post({ type: 'load-file-done', file: p.file });
    }
  };

  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });
  model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    device: 'webgpu',
    dtype: DTYPE,
    progress_callback,
  });

  post({ type: 'ready' });
}

async function ensureLoaded() {
  if (model && tokenizer) return;
  if (!loading) {
    loading = load().catch((err) => {
      loading = null;      // let a later attempt retry rather than wedge
      throw err;
    });
  }
  await loading;
}

async function generate({ id, system, input, maxTokens, temperature = 0.6, shown = '', prefill = '' }) {
  stopper = new InterruptableStoppingCriteria();
  await ensureLoaded();

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: input },
  ];

  /* Putting words in the model's mouth.

     What Do I Say owes the person words in quotation marks, and It Hit Me
     Again with nothing typed owes them "I'm here. You don't have to explain."
     Asking nicely does not reliably get either from a model this small — it
     answered the first with "consider reaching out to someone who cares" and
     the second with three unrelated quoted lines. So generation starts
     partway through the answer, and the model has committed to the shape
     before it writes anything of its own.

     Wrapped in a try because it depends on the tokenizer accepting the
     untokenised form of the template. If it ever doesn't, an ordinary prompt
     is far better than a broken app, and the output checks catch the rest. */
  /* Thinking off.

     LFM2.5-2.6B is a thinking model: its chat template opens every reply
     with "<think>", and left alone the model writes a page of analysis —
     "The user is sharing her grief… looking at my safety guidelines…" —
     before a word of the reply, spending the whole token budget on it. None
     of that is for the person. There is no switch in the template, so the
     think block is closed here before generation starts, and the model
     answers directly. The 1.2B template has no "<think>", and this leaves
     it alone. */
  let inputs = null;
  let opener = prefill || '';

  try {
    const promptText = tokenizer.apply_chat_template(messages, {
      tokenize: false,
      add_generation_prompt: true,
    });
    if (typeof promptText !== 'string' || !promptText) throw new Error('template did not render');
    const thinks = /<think>\s*$/.test(promptText);
    if (thinks || opener) {
      const hidden = thinks ? '</think>\n\n' : '';
      // add_special_tokens: false because the template has already put them in.
      inputs = tokenizer(promptText + hidden + opener, { add_special_tokens: false });
    }
  } catch (err) {
    console.warn('Prefill unavailable, using the plain prompt:', err);
    inputs = null;
    opener = '';
  }

  if (!inputs) {
    inputs = tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      return_dict: true,
    });
  }

  let text = opener;
  let checkedAt = 0;
  let aborted = false;

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (chunk) => {
      text += chunk;

      // The page only ever learns how much has been written, never what.
      post({ type: 'tick', id, chars: text.length });

      /* Stop a run that has already gone wrong rather than let it finish. A
         saving of time, not of safety — app.js checks the finished text again
         regardless, and a run stopped here still returns its text so that
         check can see what happened. Every 60 characters is often enough to
         catch a bad turn quickly and rare enough not to slow generation. */
      if (!aborted && text.length - checkedAt >= 60) {
        checkedAt = text.length;
        if (outputWentWrong(text, shown)) {
          aborted = true;
          stopper.interrupt();
        }
      }
    },
  });

  // Sampling rather than greedy: greedy makes a model this small repeat itself.
  await model.generate({
    ...inputs,
    max_new_tokens: maxTokens,
    do_sample: true,
    temperature,
    top_p: 0.9,
    repetition_penalty: 1.15,
    streamer,
    // Must be an ITERABLE of criteria — transformers.js merges this with its own
    // list, so a bare object throws "requires ...iterable[Symbol.iterator]".
    stopping_criteria: [stopper],
  });

  post({ type: 'done', id, output: text.trim(), aborted });
}

self.addEventListener('message', async (event) => {
  const { type } = event.data;

  try {
    if (type === 'check') {
      post({ type: 'support', ...(await checkSupport()) });
    } else if (type === 'load') {
      await ensureLoaded();
    } else if (type === 'generate') {
      await generate(event.data);
    } else if (type === 'stop') {
      if (stopper) stopper.interrupt();
    }
  } catch (err) {
    // WebGPU and ONNX Runtime failures often carry the useful part in the error
    // name or the first stack frame rather than the message, and on a phone
    // there is no console to go and look at, so send all of it.
    const parts = [];
    if (err && err.name && err.name !== 'Error') parts.push(err.name);
    parts.push((err && err.message) || String(err));
    if (err && err.stack) {
      const frame = String(err.stack).split('\n').find((l) => /:\d+:\d+/.test(l));
      if (frame) parts.push(frame.trim());
    }
    post({
      type: 'error',
      id: event.data.id,
      code: (err && err.code) || 'failed',
      message: parts.join(' — '),
    });
  }
});

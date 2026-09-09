/* Raw model probe.

   Asks the model the brief's prompts directly, through tests/probe.html,
   for the tabs the app currently composes or answers by hand — the
   Get Me Through Today list, the empty presses, the death notification, the
   tailored reminder. Prints what comes back, unfiltered, so a person can
   decide whether a bigger model can be trusted with them.

   Shares .model-profile/ with the end-to-end test, so the model is not
   downloaded twice. Run with: node tests/model.probe.mjs [--rounds=N] */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8197;
const DEBUG_PORT = 9336;
const ORIGIN = `http://localhost:${PORT}/`;
const ROUNDS = Number((process.argv.find((a) => a.startsWith('--rounds=')) || '--rounds=1').split('=')[1]);

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiting = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve: done, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else done(msg.result);
      }
    });
  }
  send(method, params = {}, timeout = 20000) {
    this.id += 1; const id = this.id;
    return new Promise((done, reject) => {
      this.waiting.set(id, { resolve: done, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.waiting.has(id)) { this.waiting.delete(id); reject(new Error(`${method} timed out`)); } }, timeout);
    });
  }
  async eval(expression, timeout = 20000) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true,
    }, timeout);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluation failed');
    return result.result.value;
  }
}

const browser = CHROMES.find((p) => existsSync(p));
if (!browser) { console.error('No Chrome or Edge found.'); process.exit(1); }

const server = spawn(process.execPath, [resolve(ROOT, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
const profile = resolve(ROOT, '.model-profile');
mkdirSync(profile, { recursive: true });
const chrome = spawn(browser, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=WebGPU,Vulkan', '--ignore-gpu-blocklist',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`,
  `${ORIGIN}tests/probe.html`,
], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch { /* gone */ } try { server.kill(); } catch { /* gone */ } };
process.on('exit', stop);

/* The brief's prompts, raw, for the places the app does not currently let
   the model speak — plus the prefilled variants it would use if it did. */
const PROBES = [
  { label: 'today, with input, raw', tab: 'today', input: "I haven't got out of bed. It's 2pm. The house is a mess and I can't face any of it.", rawSystem: true },
  { label: 'today, empty, prefilled', tab: 'today', empty: true, prefill: "Today is hard. You don't have to explain why.\n\nIn the next hour, if you can:\n- " },
  { label: 'wave, empty, prefilled', tab: 'wave', empty: true, prefill: "I'm here. You don't have to explain.\n\n" },
  { label: 'remind, empty (seeded)', tab: 'remind', empty: true },
  { label: 'remind, empty (seeded) again', tab: 'remind', empty: true },
  { label: 'remind, birthday', tab: 'remind', input: "It's her birthday tomorrow and I don't know how to get through it." },
  { label: 'say, telling, prefilled', tab: 'say', input: 'My mum died on Sunday. I need to tell my team at work and I have no idea how to word it.', prefill: "This doesn't need to be eloquent. It needs to be clear and short, and then it's done. Here are a few ways to say it.\n\n**If you want to keep it simple:** \"I wanted to let you know that " },
  { label: 'say, asked, raw (no prefill)', tab: 'say', input: "People at work keep asking how I'm doing and I don't know what to say. I don't want to cry at my desk but I also don't want to lie." },
];

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith(ORIGIN));
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome never opened the page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    ws.addEventListener('open', done, { once: true });
    ws.addEventListener('error', () => reject(new Error('debugger socket failed')), { once: true });
  });
  const page = new Session(ws);
  await page.send('Runtime.enable');

  let hasProbe = false;
  for (let i = 0; i < 60 && !hasProbe; i += 1) {
    await sleep(250);
    try { hasProbe = await page.eval('return typeof window.probe === "function";'); } catch { /* loading */ }
  }
  if (!hasProbe) throw new Error('probe.html did not load');

  process.stdout.write('loading the model… ');
  const t0 = Date.now();
  await page.eval('await window.probeReady(); return 1;', 20 * 60 * 1000);
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const p of PROBES) {
      const t1 = Date.now();
      const text = await page.eval(`return await window.probe(${JSON.stringify({
        tab: p.tab, input: p.input || '', empty: !!p.empty, prefill: p.prefill || '', rawSystem: !!p.rawSystem,
      })});`, 5 * 60 * 1000);
      console.log(`--- ${p.label}${ROUNDS > 1 ? ` #${round}` : ''} · ${((Date.now() - t1) / 1000).toFixed(1)}s\n${p.input ? `> ${p.input}\n` : '> (nothing typed)\n'}\n${text}\n`);
    }
  }
} catch (err) {
  console.log(`\nFAIL — ${err.message}`);
  process.exitCode = 1;
} finally {
  stop();
}

/* Tests for the prompts: that every tab carries the safety preamble, that the
   brief's wording is intact, and that the tab table matches the brief. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TABS, TAB_BY_ID, buildSystem, SAFETY_PREAMBLE, VOICE_RULES,
  PHRASE_CORRECTION, CLARITY_CORRECTION, REMINDER_SEEDS, pickSeed, prefillFor, isTelling, TELLING,
} from '../prompts.js';

test('there are eight tabs, in the order the brief lists them', () => {
  assert.deepEqual(TABS.map((t) => t.id), ['talk', 'name', 'say', 'today', 'remember', 'quiet', 'wave', 'remind']);
});

test('each tab has the season the brief assigns', () => {
  const seasons = {
    talk: 'winter', wave: 'winter',
    name: 'spring', quiet: 'spring',
    remember: 'summer', remind: 'summer',
    say: 'autumn', today: 'autumn',
  };
  for (const [id, season] of Object.entries(seasons)) {
    assert.equal(TAB_BY_ID[id].season, season, id);
  }
});

test('names, descriptions, placeholders and buttons are the brief\'s', () => {
  const t = TAB_BY_ID;
  assert.equal(t.talk.label, 'Talk To Me');
  assert.equal(t.talk.desc, "Say whatever you need to say. I'm here.");
  assert.equal(t.talk.placeholder, "You don't have to make sense. Just talk...");
  assert.equal(t.talk.button, "I'm Listening");

  assert.equal(t.name.label, "I Don't Know What I Feel");
  assert.equal(t.name.button, 'Help Me Name It');

  assert.equal(t.say.label, 'What Do I Say');
  assert.equal(t.say.button, 'Find the Words');

  assert.equal(t.today.label, 'Get Me Through Today');
  assert.equal(t.today.desc, 'Not tomorrow. Not next week. Just today.');
  assert.equal(t.today.button, 'Just Today');

  assert.equal(t.remember.label, 'Remember Them');
  assert.equal(t.remember.title, 'I Need to Remember Them');
  assert.equal(t.remember.desc, 'Tell me about them. I want to hear.');
  assert.equal(t.remember.button, "I'm Listening");

  assert.equal(t.quiet.label, 'The Quiet Grief');
  assert.equal(t.quiet.title, 'The Grief Nobody Talks About');
  assert.equal(t.quiet.button, "I Won't Judge");

  assert.equal(t.wave.label, 'It Hit Me Again');
  assert.equal(t.wave.desc, "You were fine. And then you weren't. I'm here.");
  assert.equal(t.wave.button, 'I Need a Moment');

  assert.equal(t.remind.label, 'Gentle Reminders');
  assert.equal(t.remind.desc, 'A small truth for a hard day. No input needed.');
  assert.equal(t.remind.button, 'Remind Me');
});

test('exactly the three tabs the brief names work with nothing typed', () => {
  const empty = TABS.filter((t) => t.allowEmpty).map((t) => t.id);
  assert.deepEqual(empty, ['today', 'wave', 'remind']);
  for (const id of empty) {
    assert.ok(TAB_BY_ID[id].systemEmpty, `${id} needs an empty-input prompt`);
    assert.ok(TAB_BY_ID[id].emptyInput, `${id} needs an empty-input user turn`);
  }
  for (const t of TABS.filter((t) => !t.allowEmpty)) {
    assert.equal(t.systemEmpty, undefined, `${t.id} should not have an empty variant`);
  }
});

test('every system prompt starts with the safety preamble', () => {
  for (const tab of TABS) {
    const full = buildSystem(tab);
    assert.ok(full.startsWith(SAFETY_PREAMBLE), tab.id);
    assert.ok(full.includes(tab.system), tab.id);
    assert.ok(full.includes(VOICE_RULES), tab.id);
    if (tab.systemEmpty) {
      const empty = buildSystem(tab, { empty: true });
      assert.ok(empty.startsWith(SAFETY_PREAMBLE), `${tab.id} empty`);
      assert.ok(empty.includes(tab.systemEmpty), `${tab.id} empty`);
      assert.ok(!empty.includes(tab.system), `${tab.id} empty should not carry the full prompt too`);
    }
  }
});

test('the preamble carries the exact crisis protocol from the brief', () => {
  assert.match(SAFETY_PREAMBLE, /CRISIS RESPONSE \(use this EXACTLY — do not modify\)/);
  assert.match(SAFETY_PREAMBLE, /988 Suicide & Crisis Lifeline — call or text 988, available 24\/7/);
  assert.match(SAFETY_PREAMBLE, /Crisis Text Line — text HOME to 741741/);
  assert.match(SAFETY_PREAMBLE, /NEVER use the phrase "I'm sorry for your loss"/);
  assert.match(SAFETY_PREAMBLE, /You are NOT a therapist, counselor, crisis worker, or medical professional/);
});

test('a correction is appended last, where a small model reads it', () => {
  const full = buildSystem(TAB_BY_ID.talk, { correction: PHRASE_CORRECTION.replace('{phrase}', 'at least') });
  assert.ok(full.endsWith('Say the true thing and stay with the person.'));
  assert.match(full, /"at least"/);
  assert.ok(buildSystem(TAB_BY_ID.talk, { correction: CLARITY_CORRECTION }).includes(CLARITY_CORRECTION));
});

test('the prompts themselves never carry a phone number other than the two real ones', () => {
  const numbers = new Set();
  for (const tab of TABS) {
    const full = buildSystem(tab);
    for (const m of full.matchAll(/\b\d{5,}\b/g)) numbers.add(m[0]);
    assert.doesNotMatch(full, /\b1[\s.-]?800\b|\(\d{3}\)\s*\d{3}/, tab.id);
    assert.match(full, /\b988\b/, tab.id);
  }
  assert.deepEqual([...numbers], ['741741']);
});

test('token ceilings sit under the character caps', () => {
  for (const tab of TABS) {
    assert.ok(tab.maxTokens * 3.4 <= tab.maxChars * 1.05, `${tab.id}: ${tab.maxTokens} tokens vs ${tab.maxChars} chars`);
    assert.ok(tab.temperature >= 0.4 && tab.temperature <= 0.9, tab.id);
  }
});

test('What Do I Say recognises when somebody has to tell people', () => {
  const say = TAB_BY_ID.say;
  const asked = "people keep asking if I'm okay and I don't know what to say";
  const telling = 'I need to tell my coworkers what happened';
  assert.ok(isTelling(say, telling));
  assert.ok(!isTelling(say, asked));
  assert.ok(!isTelling(TAB_BY_ID.talk, telling), 'only What Do I Say composes templates');
  assert.ok(prefillFor(say).includes("I'm taking it day by day. Thanks for asking."));
  assert.ok(TELLING.test('how do I tell my kids'));
  assert.ok(TELLING.test('I have to let everyone know about the funeral'));
  assert.ok(!TELLING.test('my aunt said at least she is not suffering and I wanted to scream'));
  assert.equal(prefillFor(TAB_BY_ID.talk), '');
  assert.equal(prefillFor(TAB_BY_ID.wave), TAB_BY_ID.wave.prefill);
  assert.equal(prefillFor(TAB_BY_ID.wave, { empty: true }), TAB_BY_ID.wave.prefillEmpty);
});

test('the shapes, openers and closes are on the tabs the brief singles out', () => {
  const t = TAB_BY_ID;
  assert.equal(t.say.shape, 'options');
  assert.ok(t.say.prefill.endsWith('**If you want to be honest:** "'));
  assert.equal(t.name.closeQuestion, true);
  assert.match(t.name.close, /^Does that feel close/);
  assert.match(t.quiet.close, /^Thank you for trusting this space/);
  assert.equal(t.wave.prefill, "It hit you. I'm here. You don't have to do anything right now.\n\n");
  assert.match(t.wave.close, /Either way, I'm not going anywhere\.$/);
  assert.equal(t.talk.close, undefined, 'Talk To Me closes in its own words each time');
  assert.equal(t.today.compose, true);
  assert.equal(t.today.instantEmpty, true);
  assert.match(t.today.system, /YOUR PART: Write ONLY step 1/);
  assert.equal(t.wave.instantEmpty, true);
  assert.equal(t.wave.prefillEmpty, "I'm here. You don't have to explain.\n\n");
  assert.equal(t.wave.closeEmpty, "Take your time. I'm not going anywhere.");
  assert.equal(t.remind.instantEmpty, true);
  assert.equal(t.remind.themedFirst, true);
  assert.equal(t.remind.bankWhenUnmatched, true);
  assert.ok(t.remind.systemEmpty && t.remind.system, 'the brief\'s reminder prompts are kept, one flag away');
  for (const tab of TABS) {
    if (tab.prefillEmpty || tab.closeEmpty || tab.instantEmpty) assert.ok(tab.allowEmpty, `${tab.id} has an empty opener but no empty variant`);
  }
});

test('reminder seeds are plentiful and pickSeed draws from them', () => {
  assert.ok(REMINDER_SEEDS.length >= 20);
  for (let i = 0; i < 50; i += 1) assert.ok(REMINDER_SEEDS.includes(pickSeed()));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywords, matchCoin } from '../src/newsmatch.js';

const kws = (t, o) => extractKeywords(t, o).map(k => k.kw);

test('pet name in a post becomes a strong watch word', () => {
  const k = extractKeywords('Say hi to Elsa, my new dog 🐶', { ignore: ['elonmusk'] });
  const elsa = k.find(x => x.kw === 'elsa');
  assert.ok(elsa, JSON.stringify(k));
  assert.equal(elsa.strong, true);
});

test('stop words and the poster are ignored', () => {
  const k = kws('This is the best day ever on X', { ignore: ['elonmusk'] });
  for (const w of ['this', 'the', 'best', 'day', 'ever']) assert.ok(!k.includes(w), w);
});

test('hashtags, cashtags and quotes are strong', () => {
  const k = extractKeywords('Loving "Doge Rocket" today #MARSHOUSE $GROK');
  for (const w of ['dogerocket', 'marshouse', 'grok']) assert.equal(k.find(x => x.kw === w)?.strong, true, w);
});

test('headlines only keep names they clearly introduce', () => {
  const k = extractKeywords('Elon Musk adopts puppy named Biscuit as Tesla shares rise', { headline: true, ignore: ['Elon', 'Musk'] });
  assert.ok(k.some(x => x.kw === 'biscuit' && x.strong));
  assert.ok(!k.some(x => x.kw === 'elon'));
});

test('coin matching', () => {
  assert.equal(matchCoin({ symbol: 'ELSA', name: 'Elsa' }, 'elsa'), 'exact');
  assert.equal(matchCoin({ symbol: 'ELSAINU', name: 'Elsa Inu' }, 'elsa'), 'close');
  assert.equal(matchCoin({ symbol: 'DOGE', name: 'First Dog of Elsa' }, 'elsa'), 'close');
  assert.equal(matchCoin({ symbol: 'TELSAX', name: 'Telsax' }, 'elsa'), null);
  assert.equal(matchCoin({ symbol: 'AB', name: 'ab' }, 'ab'), null);
});

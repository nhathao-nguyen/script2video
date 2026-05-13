import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIntentQueries, extractEntityNames, inferSearchIntent, normalizeMediaTypeForIntent, providerPriorityForIntent } from '../src/lib/scriptIntent';

test('detects Donald Trump as a real person and builds exact-entity queries', () => {
  const text = 'Donald Trump announced a new policy during a White House speech.';
  const entities = extractEntityNames(text);
  const intent = inferSearchIntent(text, entities);
  const queries = buildIntentQueries(['nature landscape power'], 'Trump speech', entities, intent);

  assert.ok(entities.includes('Donald Trump'));
  assert.equal(intent, 'real_person');
  assert.equal(queries[0], 'Donald Trump portrait');
  assert.ok(queries.some(query => query.includes('Donald Trump speech')));
});

test('routes real people to documentary sources and prefers image unless motion is explicit', () => {
  assert.deepEqual(providerPriorityForIntent('real_person', 'image').slice(0, 3), ['wikimedia', 'government', 'openverse']);
  assert.equal(normalizeMediaTypeForIntent('video', 'real_person', 'Donald Trump portrait in the White House'), 'image');
  assert.equal(normalizeMediaTypeForIntent('video', 'real_person', 'Donald Trump speaking at a rally'), 'video');
});

test('keeps ordinary scenes on stock providers', () => {
  const text = 'A traveler walks through a misty forest at sunrise.';
  const intent = inferSearchIntent(text, extractEntityNames(text));

  assert.equal(intent, 'stock');
  assert.deepEqual(providerPriorityForIntent(intent, 'video').slice(0, 2), ['pexels', 'pixabay']);
});

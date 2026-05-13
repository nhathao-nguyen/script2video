import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIntentQueries, extractEntityNames, inferSearchIntent, normalizeMediaTypeForIntent, providerPriorityForIntent } from '../src/lib/scriptIntent';

test('detects named public figures with generic rules and builds exact-entity queries', () => {
  const text = 'Alex Morgan announced a new policy during a government speech.';
  const entities = extractEntityNames(text);
  const intent = inferSearchIntent(text, entities);
  const queries = buildIntentQueries(['nature landscape power'], 'policy speech', entities, intent);

  assert.ok(entities.includes('Alex Morgan'));
  assert.equal(intent, 'real_person');
  assert.equal(queries[0], 'Alex Morgan portrait');
  assert.ok(queries.some(query => query.includes('Alex Morgan speech')));
});

test('routes real people to documentary sources and prefers image unless motion is explicit', () => {
  assert.deepEqual(providerPriorityForIntent('real_person', 'image').slice(0, 3), ['wikimedia', 'government', 'openverse']);
  assert.equal(normalizeMediaTypeForIntent('video', 'real_person', 'Alex Morgan portrait in a government building'), 'image');
  assert.equal(normalizeMediaTypeForIntent('video', 'real_person', 'Alex Morgan speaking at a rally'), 'video');
});

test('keeps ordinary scenes on stock providers', () => {
  const text = 'A traveler walks through a misty forest at sunrise.';
  const intent = inferSearchIntent(text, extractEntityNames(text));

  assert.equal(intent, 'stock');
  assert.deepEqual(providerPriorityForIntent(intent, 'video').slice(0, 2), ['pexels', 'pixabay']);
});

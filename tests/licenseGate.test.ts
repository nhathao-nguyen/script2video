import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLicense } from '../src/lib/licenseGate';

test('approves stock providers', () => {
  assert.equal(classifyLicense({ provider: 'pexels' }).licenseStatus, 'approved');
  assert.equal(classifyLicense({ provider: 'pixabay' }).licenseStatus, 'approved');
});

test('approves public domain and CC0 assets', () => {
  assert.equal(classifyLicense({
    provider: 'wikimedia',
    licenseName: 'CC0 1.0 Universal Public Domain Dedication',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  }).licenseStatus, 'approved');

  assert.equal(classifyLicense({
    provider: 'wikimedia',
    licenseName: 'Public domain',
  }).licenseStatus, 'approved');
});

test('requires attribution for complete CC BY assets', () => {
  const decision = classifyLicense({
    provider: 'wikimedia',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    creator: 'Example Creator',
    title: 'Example Title',
    attributionText: '"Example Title" by Example Creator. Source: https://commons.wikimedia.org/wiki/File:Example.jpg. License: CC BY 4.0.',
  });

  assert.equal(decision.licenseStatus, 'attribution_required');
});

test('requires review for CC BY-SA and Openverse assets', () => {
  assert.equal(classifyLicense({
    provider: 'wikimedia',
    licenseName: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  }).licenseStatus, 'review_required');

  const openverse = classifyLicense({
    provider: 'openverse',
    licenseName: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  });
  assert.equal(openverse.licenseStatus, 'review_required');
  assert.ok(openverse.riskFlags.includes('openverse_unverified'));
});

test('rejects NC, ND, unknown, all rights reserved, and incomplete CC BY', () => {
  assert.equal(classifyLicense({ provider: 'wikimedia', licenseName: 'CC BY-NC 4.0' }).licenseStatus, 'rejected');
  assert.equal(classifyLicense({ provider: 'wikimedia', licenseName: 'CC BY-ND 4.0' }).licenseStatus, 'rejected');
  assert.equal(classifyLicense({ provider: 'wikimedia', licenseName: 'Unknown' }).licenseStatus, 'rejected');
  assert.equal(classifyLicense({ provider: 'wikimedia', licenseName: 'All rights reserved' }).licenseStatus, 'rejected');
  assert.equal(classifyLicense({
    provider: 'wikimedia',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  }).licenseStatus, 'rejected');
});

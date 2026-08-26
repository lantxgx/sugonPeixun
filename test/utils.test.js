import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaType, normalizeClass, normalizeIdentity, normalizeTeam } from '../src/utils.js';

test('normalizes Arabic digits and missing suffixes', () => {
  assert.equal(normalizeTeam('5'), '五连');
  assert.equal(normalizeTeam('第5队'), '五连');
  assert.equal(normalizeClass('1'), '一班');
  assert.equal(normalizeIdentity(' 兰天笑 ', '5', '1'), '兰天笑+五连+一班');
});

test('recognizes common image/video formats', () => {
  assert.equal(mediaType('image/jpeg', 'a.jpg'), 'image');
  assert.equal(mediaType('video/mp4', 'a.mp4'), 'video');
  assert.equal(mediaType('application/octet-stream', 'a.heic'), 'image');
  assert.equal(mediaType('application/pdf', 'a.pdf'), null);
});

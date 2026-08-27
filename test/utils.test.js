import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDanmaku, inferAiAction, inferRenameTitle, mediaType, normalizeClass, normalizeIdentity, normalizeTeam } from '../src/utils.js';

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

test('filters inappropriate danmaku and links', () => {
  assert.equal(filterDanmaku('大家都是傻逼'), '大家都是**');
  assert.equal(filterDanmaku('看看 https://example.com/a'), '看看 [链接已过滤]');
});

test('infers login and rename AI actions', () => {
  assert.equal(inferAiAction('我是五连1班兰天笑，帮我直接登录'), 'login');
  assert.equal(inferAiAction('把我的中国心改成歌唱祖国'), 'rename');
  assert.equal(inferRenameTitle('把我的中国心改成歌唱祖国'), '歌唱祖国');
});

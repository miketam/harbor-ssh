const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { en } = require('../dist-electron/locales/en');
const { translate, normalizeLocale } = require('../dist-electron/locales');
test('locale fallback, interpolation and unknown diagnostics', () => {
  for (const value of [null, undefined, '', 'fr', '{broken', {}, 'zh-CN']) assert.equal(normalizeLocale(value), 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en-US');
  assert.equal(translate('关闭标签 {0}', 'en-US', '服务器 $& {1}'), 'Close tab 服务器 $& {1}');
  assert.equal(translate('关闭标签 {0}', 'zh-CN', 'dev'), '关闭标签 dev');
  assert.equal(translate('Unknown diagnostic', 'en-US'), 'Unknown diagnostic');
  assert.equal(translate('请填写主机名称', 'en-US'), 'Enter host name');
});
test('English catalog preserves placeholders and covers application messages', () => {
  const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
  for (const [source, target] of Object.entries(en)) {
    assert(target.trim(), source);
    assert(!/\p{Script=Han}/u.test(target), source);
    assert.deepEqual(placeholders(target), placeholders(source), source);
  }
  for (const directory of ['src', 'electron']) {
    for (const name of readdirSync(join(__dirname, '..', directory)).filter(name => /\.tsx?$/.test(name))) {
      const source = readFileSync(join(__dirname, '..', directory, name), 'utf8');
      // Application strings are single-line literals; server data is not translated.
      for (const match of source.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g)) {
        const literal = match[1] ?? match[2];
        if (/\p{Script=Han}/u.test(literal)) assert(Object.hasOwn(en, literal), `${directory}/${name}: missing ${literal}`);
      }
    }
  }
});

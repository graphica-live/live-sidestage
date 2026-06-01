'use strict';

const request = require('supertest');
const { CaptionCorrector, app, loadSettings, DEFAULT_SETTINGS } = require('../server');

// ── CaptionCorrector ─────────────────────────────────────────────────────────

describe('CaptionCorrector', () => {
  test('empty rules: passthrough', () => {
    expect(new CaptionCorrector([]).apply('hello world')).toBe('hello world');
  });

  test('no rules (undefined): passthrough', () => {
    expect(new CaptionCorrector().apply('hello')).toBe('hello');
  });

  test('plain: replaces all occurrences', () => {
    const c = new CaptionCorrector([{ from: 'foo', to: 'bar' }]);
    expect(c.apply('foo baz foo')).toBe('bar baz bar');
  });

  test('plain: special regex chars in from are literal', () => {
    const c = new CaptionCorrector([{ from: '(foo)', to: 'bar' }]);
    expect(c.apply('(foo) baz')).toBe('bar baz');
  });

  test('plain: to defaults to empty string when omitted', () => {
    const c = new CaptionCorrector([{ from: 'foo' }]);
    expect(c.apply('foo bar')).toBe(' bar');
  });

  test('plain: empty from is skipped', () => {
    const c = new CaptionCorrector([{ from: '', to: 'x' }]);
    expect(c.apply('hello')).toBe('hello');
  });

  test('regex: replaces matches', () => {
    const c = new CaptionCorrector([{ from: '\\d+', to: 'N', useRegex: true }]);
    expect(c.apply('abc 123 def 456')).toBe('abc N def N');
  });

  test('regex: uses custom flags', () => {
    const c = new CaptionCorrector([{ from: 'foo', to: 'bar', useRegex: true, flags: 'gi' }]);
    expect(c.apply('FOO foo')).toBe('bar bar');
  });

  test('regex: invalid pattern is skipped, text unchanged', () => {
    const c = new CaptionCorrector([{ from: '[invalid', to: 'x', useRegex: true }]);
    expect(c.apply('hello')).toBe('hello');
  });

  test('multiple rules applied in order', () => {
    const c = new CaptionCorrector([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]);
    expect(c.apply('a')).toBe('c');
  });
});

// ── loadSettings ─────────────────────────────────────────────────────────────

describe('loadSettings', () => {
  test('returns object with all DEFAULT_SETTINGS keys', () => {
    const s = loadSettings();
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      expect(s).toHaveProperty(key);
    }
  });

  test('returns a copy, not the internal reference', () => {
    const a = loadSettings();
    const b = loadSettings();
    expect(a).not.toBe(b);
    a.fontSize = 999;
    expect(loadSettings().fontSize).not.toBe(999);
  });
});

// ── REST API ─────────────────────────────────────────────────────────────────

describe('GET /api/caption/config', () => {
  test('200 with settings object', async () => {
    const res = await request(app).get('/api/caption/config');
    expect(res.status).toBe(200);
    expect(typeof res.body.vadThreshold).toBe('number');
    expect(typeof res.body.correctionRules).toBe('object');
  });
});

describe('PATCH /api/caption/config', () => {
  test('updates known key, returns updated settings', async () => {
    const original = await request(app).get('/api/caption/config');
    const newVal = original.body.fontSize === 52 ? 60 : 52;

    const res = await request(app)
      .patch('/api/caption/config')
      .send({ fontSize: newVal });

    expect(res.status).toBe(200);
    expect(res.body.fontSize).toBe(newVal);
  });

  test('ignores unknown keys', async () => {
    const res = await request(app)
      .patch('/api/caption/config')
      .send({ __unknown__: 'hack' });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('__unknown__');
  });
});

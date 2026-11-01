import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

const defaults = { TELEGRAM_BOT_TOKEN: '123456789:XYZ', PANEL_API_TOKEN: 'SECRET',
  ADMIN_TELEGRAM_IDS: '123456789,987654321', PANEL_URL: 'https://example.com/private/' };

test('config parses nested panel base and permitted ids', () => {
  const conf = loadConfig(defaults);
  assert.equal(conf.panelBase, 'https://example.com/private/');
  assert.equal(conf.adminIds.has('987654321'), true);
});

test('remote plaintext HTTP and malformed id are rejected', () => {
  assert.throws(() => loadConfig({ ...defaults, PANEL_URL: 'http://example.com/' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...defaults, ADMIN_TELEGRAM_IDS: 'alice' }), /عددی/);
});

test('panel URL must not end in /panel (avoids /panel/panel/api)', () => {
  assert.throws(() => loadConfig({ ...defaults, PANEL_URL: 'https://example.com/secret/panel' }), /\/panel/);
});

test('custom Telegram API base is normalized and insecure public HTTP is rejected', () => {
  const conf = loadConfig({ ...defaults, TELEGRAM_API_BASE_URL: 'https://gateway.example.com/prefix' });
  assert.equal(conf.telegramApiBase, 'https://gateway.example.com/prefix/');
  assert.throws(() => loadConfig({ ...defaults, TELEGRAM_API_BASE_URL: 'http://gateway.example.com/' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...defaults, TELEGRAM_API_BASE_URL: 'https://evil.example/?token=abc' }), /نباید/);
});

test('http CONNECT proxy URL is accepted but SOCKS URL is rejected', () => {
  const conf = loadConfig({ ...defaults, TELEGRAM_PROXY_URL: 'http://host.docker.internal:3128' });
  assert.equal(conf.telegramProxyUrl, 'http://host.docker.internal:3128/');
  assert.throws(() => loadConfig({ ...defaults, TELEGRAM_PROXY_URL: 'socks5://localhost:1080' }), /HTTP/);
});

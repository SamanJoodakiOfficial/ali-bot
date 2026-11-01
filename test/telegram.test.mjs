import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient } from '../src/telegram.mjs';
import { configureTelegramProxy } from '../src/network.mjs';

test('TelegramClient honors custom gateway prefix and never prints the token', async () => {
  let target;
  const client = new TelegramClient({
    token: 'FAKE-TEST-TOKEN',
    apiBaseUrl: 'https://gateway.example.com/prefix/',
    fetchImpl: async (url, options) => {
      target = String(url);
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => ({ ok: true, result: { username: 'bot' } }) };
    },
  });
  assert.deepEqual(await client.call('getMe'), { username: 'bot' });
  assert.equal(target, 'https://gateway.example.com/prefix/botFAKE-TEST-TOKEN/getMe');
});

test('failed fetch returns diagnostic code, not URL or token', async () => {
  const client = new TelegramClient({ token: 'VERY-SECRET',
    fetchImpl: async () => { const e = new Error('https://api.telegram.org/botVERY-SECRET/'); e.cause = { code: 'ENOTFOUND' }; throw e; },
  });
  await assert.rejects(() => client.call('getMe'), e =>
    e.code === 'ENOTFOUND' && /ENOTFOUND/.test(e.message) && !e.message.includes('VERY-SECRET'));
});

test('proxy excludes the panel host and uses Telegram HTTPS proxy', () => {
  let configSeen;
  const result = configureTelegramProxy({
    telegramProxyUrl: 'http://host.docker.internal:3128/', panelBase: 'https://pn.example.com/abc/',
  }, config => { configSeen = config; });
  assert.equal(result, true);
  assert.equal(configSeen.HTTPS_PROXY, 'http://host.docker.internal:3128/');
  assert.ok(configSeen.NO_PROXY.split(',').includes('pn.example.com'));
});

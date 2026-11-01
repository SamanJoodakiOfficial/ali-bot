import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramApi } from '../src/telegram.mjs';

const token = '1234567890:EXAMPLE_SECRET';
test('URL construction with colon in Telegram token keeps HTTPS scheme', () => {
  const api = new TelegramApi({token, baseUrl: 'https://api.telegram.org/'});
  assert.equal(api.url, 'https://api.telegram.org/bot1234567890:EXAMPLE_SECRET/');
  assert.equal(new URL(api.url).protocol, 'https:');
});
test('API gateways with base paths retain their path', () => {
  const api = new TelegramApi({token, baseUrl: 'https://gateway.example.com/api/'});
  assert.equal(api.url, 'https://gateway.example.com/api/bot1234567890:EXAMPLE_SECRET/');
});
test('getMe is correctly sent to HTTPS endpoint', async () => {
  let called = null;
  const api = new TelegramApi({token, baseUrl:'https://api.telegram.org/', fetchImpl: async(url, options) => {
    called = {url, options};
    return {status:200, ok:true, json:async()=>({ok:true,result:{username:'sample_bot'}})};
  }});
  const result=await api.call('getMe');
  assert.equal(result.username,'sample_bot');
  assert.equal(called.url,'https://api.telegram.org/bot1234567890:EXAMPLE_SECRET/getMe');
  assert.equal(called.options.method,'POST');
});

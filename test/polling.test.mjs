import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptivePolling} from '../src/polling.mjs';
import {TelegramApi} from '../src/telegram.mjs';
import {loadConfig} from '../src/config.mjs';
const env={TELEGRAM_BOT_TOKEN:'fake-token',PANEL_API_TOKEN:'fake-panel',OWNER_TELEGRAM_IDS:'11111111',PANEL_URL:'https://panel.example.net/base/'};
test('config starts at short 5 second polling; allows explicit zero',()=>{
  assert.equal(loadConfig(env).telegramPollSeconds,5);
  assert.equal(loadConfig({...env,TELEGRAM_POLL_TIMEOUT_SECONDS:'0'}).telegramPollSeconds,0);
  assert.throws(()=>loadConfig({...env,TELEGRAM_POLL_TIMEOUT_SECONDS:'30'}));
});
test('two transport failures downgrade long to short polling',()=>{
  const poll=new AdaptivePolling(5);
  const network={isNetworkFailure:true};
  assert.equal(poll.requestTimeoutMs,17000);
  assert.equal(poll.failure(network),false);
  assert.equal(poll.failure(network),true);
  assert.equal(poll.seconds,0);
  assert.equal(poll.requestTimeoutMs,12000);
  poll.success();
  assert.equal(poll.failure(network),false);
});
test('normal HTTP 401/409 errors do not downgrade polling',()=>{
  const poll=new AdaptivePolling(5);
  for(let i=0;i<3;i++)assert.equal(poll.failure({code:409}),false);
  assert.equal(poll.seconds,5);
});
test('successful request clears consecutive transport failures',()=>{
  const poll=new AdaptivePolling(5);
  poll.failure({isNetworkFailure:true});
  poll.success();
  assert.equal(poll.failure({isNetworkFailure:true}),false);
  assert.equal(poll.seconds,5);
});
test('TelegramApi includes timeout in safe error without leaking bot token',async()=>{
  const tg=new TelegramApi({token:'123456:SECRET',baseUrl:'https://api.telegram.org/',fetchImpl: async()=>{throw new DOMException('timeout','TimeoutError')}});
  await assert.rejects(tg.call('getUpdates',{timeout:5}),error=>{
    assert.equal(error.code,'TIMEOUT');
    assert.equal(error.isNetworkFailure,true);
    assert.doesNotMatch(error.message,/SECRET/);
    return true;
  });
});

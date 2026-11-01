import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.mjs';
import { Store } from '../src/db.mjs';
import { escapeHtml, dateFa, latestMessages } from '../src/format.mjs';

class TelegramStub {
  constructor() { this.sent = []; this.callbacks = []; }
  async send(chat, text) { this.sent.push({ chat, text }); }
  async answerCallback(id, text) { this.callbacks.push({ id, text }); }
}

function fixture() {
  const db = new Store(':memory:');
  const telegram = new TelegramStub();
  const panel = {
    clients: async () => ({ items: [{ email: 'alice@example.com', id: 1,
      createdAt: 1735000000000, updatedAt: null, expiryTime: null, expiryRaw: 0,
      enabled: true, totalBytes: 1024 ** 3, usedBytes: 100,
      group: 'staff', comment: '', inboundIds: [3] }], total: 1, filtered: 1, approximate: false }),
    stats: async () => ({ total: 1, active: 1, exact: true }),
  };
  const config = { adminIds: new Set(['101']), timezone: 'Asia/Tehran' };
  return { db, telegram, bot: new Bot({ config, db, telegram, panel }) };
}

test('only whitelisted private users may see the latest clients', async () => {
  const { db, telegram, bot } = fixture();
  try {
    await bot.handle({ message: { from: { id: 999 }, chat: { id: 999, type: 'private' }, text: '/latest' } });
    assert.match(telegram.sent[0].text, /مجوز/);
    await bot.handle({ message: { from: { id: 101 }, chat: { id: -5, type: 'group' }, text: '/latest' } });
    assert.equal(telegram.sent.length, 1);
    await bot.handle({ message: { from: { id: 101 }, chat: { id: 101, type: 'private' }, text: '/latest' } });
    assert.match(telegram.sent[1].text, /alice@example.com/);
    assert.equal(db.cachedCount(), 1);
  } finally { db.close(); }
});

test('whoami is available without admin access', async () => {
  const { db, telegram, bot } = fixture();
  try {
    await bot.handle({ message: { from: { id: 555 }, chat: { id: 555, type: 'private' }, text: '/whoami' } });
    assert.match(telegram.sent[0].text, /555/);
  } finally { db.close(); }
});

test('HTML is escaped, Persian dates are present, messages split into batches', () => {
  assert.equal(escapeHtml('<a&b>'), '&lt;a&amp;b&gt;');
  assert.notEqual(dateFa(1735000000000), 'نامشخص');
  const many = Array.from({ length: 10 }, (_, i) => ({ email: `<${i}&>`, enabled: true,
    createdAt: 1735000000000, expiryRaw: 0, totalBytes: 0, usedBytes: 0, group: '' }));
  const messages = latestMessages(many, { title: 'کاربران', timezone: 'Asia/Tehran' });
  assert.equal(messages.length, 2);
  assert.match(messages[0], /&lt;0&amp;&gt;/);
});

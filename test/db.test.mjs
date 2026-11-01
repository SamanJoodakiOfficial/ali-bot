import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/db.mjs';

function c(email, createdAt) {
  return { email, id: 1, createdAt, updatedAt: null,
    expiryTime: null, expiryRaw: 0, enabled: true, totalBytes: 0,
    usedBytes: 0, group: '', comment: '', inboundIds: [1] };
}

test('sqlite persists cache snapshots, updates and key/value', () => {
  const db = new Store(':memory:');
  try {
    db.remember([c('old', 1735000000000), c('new', 1736000000000)]);
    assert.equal(db.cachedCount(), 2);
    assert.deepEqual(db.cachedLatest(1).map(x => x.email), ['new']);
    db.remember([c('new', 1737000000000)]);
    assert.equal(db.cachedCount(), 2);
    assert.equal(db.cachedLatest(1)[0].createdAt, 1737000000000);
    db.set('telegram_last_update_id', '22');
    assert.equal(db.get('telegram_last_update_id'), '22');
    db.audit('123456789', 'latest');
  } finally { db.close(); }
});

// SEC-003: exports leave out device secrets; encrypted backups round-trip and
// refuse wrong passwords; importing never brings in another device's wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
const { exportJson, getState, importJson, update, todayKey, emptyDay } = await import('../public/js/store.js');
const { decryptBackup, encryptBackup, isEncryptedBackup } = await import('../public/js/backup.js');

test('exports keep records but drop push wiring and the access code', () => {
  update((s) => {
    s.settings.pushCode = 'correct-horse-42';
    s.notify = { ...s.notify, enabled: true, push: true, endpoint: 'https://fcm.googleapis.com/fcm/send/secret', once: { gap: 'msg_9' } };
    s.days[todayKey()] = { ...emptyDay(), pouches: [{ ts: 1, flags: [] }] };
    s.vitality = [{ date: todayKey(), sec: 30, ts: 2 }];
  });
  const text = exportJson();
  assert.doesNotMatch(text, /correct-horse-42|fcm\.googleapis|msg_9/);
  const out = JSON.parse(text);
  assert.equal(out.days[todayKey()].pouches.length, 1);
  assert.equal(out.vitality.length, 1); // private records stay in your own backup
  assert.ok(out.exportedAt > 0);
});

test('importing keeps this device’s push wiring and access code', () => {
  const backup = JSON.parse(exportJson());
  backup.settings.pushCode = 'someone-elses-code';
  backup.notify = { endpoint: 'https://evil.example/push' };
  importJson(JSON.stringify(backup));
  assert.equal(getState().settings.pushCode, 'correct-horse-42');
  assert.equal(getState().notify.endpoint, 'https://fcm.googleapis.com/fcm/send/secret');
  assert.equal(getState().days[todayKey()].pouches.length, 1);
});

test('encrypted backups round-trip and reject a wrong password', async () => {
  const text = exportJson();
  const sealed = await encryptBackup(text, 'tansen-free-2026');
  assert.ok(isEncryptedBackup(sealed));
  assert.equal(isEncryptedBackup(text), false);
  assert.doesNotMatch(sealed, /pouches|vitality/);
  const f = JSON.parse(sealed);
  assert.equal(f.kdf.iterations, 600000);
  assert.equal(await decryptBackup(sealed, 'tansen-free-2026'), text);
  await assert.rejects(decryptBackup(sealed, 'wrong-password'), /Wrong password/);
  const tampered = JSON.stringify({ ...f, data: f.data.slice(0, -4) + 'AAAA' });
  await assert.rejects(decryptBackup(tampered, 'tansen-free-2026'), /Wrong password or damaged/);
  await assert.rejects(encryptBackup(text, 'short'), /at least 8/);
  // Two backups of the same data never look alike (fresh salt and IV).
  assert.notEqual(JSON.parse(await encryptBackup(text, 'tansen-free-2026')).data, f.data);
});

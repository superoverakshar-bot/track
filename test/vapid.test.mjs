import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { generateVapidKeys } from '../public/js/vapid.js';

test('browser-generated VAPID keys are accepted by web-push', async () => {
  const { publicKey, privateKey } = await generateVapidKeys();
  assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
  assert.equal(Buffer.from(privateKey, 'base64url').length, 32);
  assert.doesNotThrow(() => webpush.setVapidDetails('mailto:test@example.com', publicKey, privateKey));
  const headers = webpush.getVapidHeaders('https://fcm.googleapis.com', 'mailto:test@example.com', publicKey, privateKey, 'aes128gcm');
  assert.match(headers.Authorization, /^vapid t=.+, k=/);
});

// Generate a Web Push (VAPID) key pair locally with WebCrypto, in the same
// base64url format as `web-push generate-vapid-keys`. Nothing leaves the device.
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const { d: privateKey } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateKey };
}

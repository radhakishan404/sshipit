const crypto = require('node:crypto');

const DEFAULT_KEY = 'sshipit-dev-key-change-this';

function getKeyMaterial() {
  const source = process.env.ENCRYPTION_KEY || DEFAULT_KEY;
  return crypto.createHash('sha256').update(source).digest();
}

function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const key = getKeyMaterial();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(payload) {
  if (!payload || typeof payload !== 'string') {
    throw new Error('Invalid encrypted payload');
  }

  const [version, ivBase64, tagBase64, encryptedBase64] = payload.split(':');
  if (version !== 'v1' || !ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('Encrypted payload format is invalid');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const key = getKeyMaterial();

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return plain.toString('utf8');
}

module.exports = {
  encryptSecret,
  decryptSecret,
  DEFAULT_KEY,
};

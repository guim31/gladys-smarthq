// -----------------------------------------------------------------------------
// The SmartHQ refresh token, kept in /data/smarthq-auth.json (mode 600).
//
// With it, a restart signs in again without the password, and above all
// without a new verification code on an account protected by multi-factor
// authentication. It belongs to one account: the file remembers a fingerprint
// (SHA-256) of the e-mail and region it was obtained with, and another
// account in the configuration starts from the password again.
//
// The access token stays in memory. Nothing here reaches a log line or the
// Gladys configuration.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEFAULT_DATA_DIR = '/data';
const FILE_NAME = 'smarthq-auth.json';

/** Fingerprint of a text: enough to tell two apart, useless to anyone else. */
export function fingerprint(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

/** The account a refresh token belongs to. */
export function accountSeed(config) {
  return fingerprint(`${config.username.trim().toLowerCase()}|${config.region}`);
}

/**
 * @param {object} [options]
 * @param {string} [options.dir] where the file lives (tests use a temp dir)
 */
export function createTokenStore({ dir = process.env.DATA_DIR || DEFAULT_DATA_DIR } = {}) {
  const file = join(dir, FILE_NAME);
  let cache = null;

  async function load() {
    if (cache) {
      return cache;
    }
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      // Missing (first start) or unreadable: sign in with the password.
      cache = {};
    }
    return cache;
  }

  async function save(next) {
    cache = next;
    await mkdir(dirname(file), { recursive: true });
    // Write then rename: a crash in between never leaves half a file.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
    await rename(tmp, file);
  }

  return {
    file,

    /** The refresh token of this account, or null. */
    async refreshToken(seed) {
      const data = await load();
      return data.seed === seed && typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : null;
    },

    async save(seed, refreshToken) {
      await save({ seed, refresh_token: refreshToken });
    },

    async clear() {
      await save({});
    },
  };
}

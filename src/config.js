// -----------------------------------------------------------------------------
// Integration configuration: the defaults (mirroring the manifest
// `config_schema`) and the normalization of what Gladys sends.
//
// The password stays in the Gladys configuration; the refresh token obtained
// with it lives in /data (src/ge/token-store.js).
// -----------------------------------------------------------------------------

import { LANGUAGES, pickLanguage } from './i18n.js';

export { LANGUAGES };

export const REGIONS = ['US', 'EU'];
export const UNITS = ['celsius', 'fahrenheit'];

// Must match the `default` values of the manifest (test/manifest.test.js).
export const DEFAULT_CONFIG = {
  username: '',
  password: '',
  region: 'US',
  temperature_unit: 'celsius',
  language: 'fr',
};

/**
 * @param {Record<string, unknown>} [raw] config as Gladys sends it
 */
export function normalizeConfig(raw = {}) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const region = text(raw.region).toUpperCase();
  const unit = text(raw.temperature_unit).toLowerCase();
  return {
    username: text(raw.username),
    // A password may begin or end with a space: kept as typed.
    password: typeof raw.password === 'string' ? raw.password : '',
    region: REGIONS.includes(region) ? region : DEFAULT_CONFIG.region,
    temperature_unit: UNITS.includes(unit) ? unit : DEFAULT_CONFIG.temperature_unit,
    language: pickLanguage(raw.language ?? DEFAULT_CONFIG.language),
  };
}

/** Whether the e-mail and the password are filled in. */
export function hasCredentials(config) {
  return config.username !== '' && config.password !== '';
}

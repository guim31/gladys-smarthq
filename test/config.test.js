import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, normalizeConfig } from '../src/config.js';

test('the configuration is normalized, with the manifest defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(
    normalizeConfig({
      username: ' jane@example.com ',
      password: ' p ',
      region: 'eu',
      temperature_unit: 'Fahrenheit',
      language: 'de',
    }),
    {
      username: 'jane@example.com',
      password: ' p ',
      region: 'EU',
      temperature_unit: 'fahrenheit',
      language: 'de',
    },
  );
  assert.equal(normalizeConfig({ region: 'mars', language: 'it' }).region, 'US');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(hasCredentials(normalizeConfig({ username: 'a' })), false);
  assert.equal(hasCredentials(normalizeConfig({ username: 'a', password: 'b' })), true);
});

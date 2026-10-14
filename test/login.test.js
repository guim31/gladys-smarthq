// -----------------------------------------------------------------------------
// The SmartHQ sign-in, end to end on the fake SmartHQ: the HTML walk, the
// refresh token kept in /data, a refused password never tried again, the
// verification code, new terms of use.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { alertText, csrfToken, formInputs, mfaMethods, parseAttributes } from '../src/ge/login.js';
import { PASSWORD, createFakeSmartHq } from './helpers/fake-smarthq.js';
import { CONFIG, createWorld, settle, waitFor } from './helpers/world.js';

test('the HTML helpers read forms, CSRF tokens and errors', () => {
  assert.deepEqual(parseAttributes('<input name="a" value=\'b&amp;c\' disabled>'), {
    name: 'a',
    value: 'b&c',
    disabled: '',
  });
  const page = `<form id="other"><input name="x" value="1"></form>
    <form method="post" id="frmsignin"><input type="hidden" name="_csrf" value="t0k"><input name="username"></form>`;
  assert.deepEqual(formInputs(page, 'frmsignin'), { _csrf: 't0k', username: '' });
  assert.equal(formInputs(page, 'missing'), null);
  assert.equal(csrfToken('<meta name="_csrf" content="m3ta">'), 'm3ta');
  assert.deepEqual(mfaMethods('<button name="email_btn" value="email"><button name="go">'), [
    'email',
  ]);
  assert.equal(alertText('<div id="alert_pane"><b>Wrong</b> password</div>'), 'Wrong password');
});

test('signs in with the password, then keeps the refresh token in /data (mode 600)', async () => {
  const world = await createWorld({ smarthq: { authorizePage: true } });
  try {
    assert.equal(world.smarthq.signIns, 1);
    assert.equal(world.gladys.fake.connectionStatus.connected, true);
    const file = join(world.dataDir, 'smarthq-auth.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.match(saved.refresh_token, /^refresh-/);
    assert.ok(!JSON.stringify(saved).includes(PASSWORD), 'the password is not copied to /data');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await world.close();
  }
});

test('a restart signs in with the stored refresh token, without the password', async () => {
  const first = await createWorld({ addAll: false });
  await first.close({ keepData: true });
  const smarthq = first.smarthq;
  const signIns = smarthq.signIns;
  const second = await createWorld({ smarthqFake: smarthq, dataDir: first.dataDir, addAll: false });
  try {
    assert.equal(smarthq.signIns, signIns, 'no new sign-in with the password');
    assert.equal(smarthq.refreshes, 1);
    assert.equal(second.gladys.fake.connectionStatus.connected, true);
  } finally {
    await second.close();
  }
});

test('a revoked refresh token falls back to the password', async () => {
  const first = await createWorld({ addAll: false });
  await first.close({ keepData: true });
  first.smarthq.refreshTokens.clear();
  const second = await createWorld({
    smarthqFake: first.smarthq,
    dataDir: first.dataDir,
    addAll: false,
  });
  try {
    assert.equal(first.smarthq.signIns, 2);
    assert.equal(second.gladys.fake.connectionStatus.connected, true);
  } finally {
    await second.close();
  }
});

test('a refused password is not tried again until the configuration changes', async () => {
  const world = await createWorld({
    config: { ...CONFIG, password: 'wrong-password' },
    waitDevices: false,
    app: { timers: true, hubOptions: { timing: { reconnectMinMs: 5, reconnectMaxMs: 10 } } },
  });
  try {
    await waitFor(() => world.gladys.fake.connectionStatus?.connected === false, {
      label: 'status',
    });
    await settle(80);
    assert.equal(world.smarthq.failedSignIns, 1, 'one attempt only: no lockout loop');
    assert.match(
      world.gladys.fake.connectionStatus.message.en,
      /refused the e-mail or the password/,
    );
    const ack = await world.gladys.fake.action('test_connection', {});
    assert.equal(ack.success, false);
    assert.equal(world.smarthq.failedSignIns, 1, 'the test does not retry a refused password');

    await world.gladys.fake.configUpdated({ ...CONFIG });
    await waitFor(() => world.gladys.fake.connectionStatus?.connected === true, {
      label: 'connected',
    });
    assert.equal(world.smarthq.failedSignIns, 1);
  } finally {
    await world.close();
  }
});

test('an account with a verification code waits for the actions, then connects', async () => {
  const world = await createWorld({ smarthq: { mfa: true }, waitDevices: false, addAll: false });
  try {
    await waitFor(() => world.gladys.fake.connectionStatus?.connected === false, {
      label: 'status',
    });
    assert.match(world.gladys.fake.connectionStatus.message.en, /verification code/);
    assert.deepEqual(world.smarthq.sentCodes, [], 'no code sent without the user asking');

    const send = await world.gladys.fake.action('send_code', {});
    assert.equal(send.success, true, JSON.stringify(send));
    assert.deepEqual(world.smarthq.sentCodes, ['email']);
    assert.match(send.data.message.en, /e-mail/);

    const wrong = await world.gladys.fake.action('submit_code', { code: '000000' });
    assert.equal(wrong.success, false);
    const empty = await world.gladys.fake.action('submit_code', { code: '  ' });
    assert.equal(empty.success, false);

    const right = await world.gladys.fake.action('submit_code', { code: '123 456' });
    assert.equal(right.success, true, JSON.stringify(right));
    await waitFor(() => world.gladys.fake.discoveredDevices.length > 0, { label: 'devices' });
    assert.equal(world.gladys.fake.connectionStatus.connected, true);
  } finally {
    await world.close();
  }
});

test('new terms of use are left to the user, never accepted on their behalf', async () => {
  const world = await createWorld({ smarthq: { terms: true }, waitDevices: false });
  try {
    await waitFor(() => world.gladys.fake.connectionStatus?.connected === false, {
      label: 'status',
    });
    assert.match(world.gladys.fake.connectionStatus.message.en, /terms of use/);
    assert.ok(!world.smarthq.requests.some((line) => line.includes('/oauth2/terms/accept')));
  } finally {
    await world.close();
  }
});

test('without credentials, the status says what to fill in and nothing is called', async () => {
  const smarthq = createFakeSmartHq();
  const world = await createWorld({ config: {}, smarthqFake: smarthq, waitDevices: false });
  try {
    assert.equal(world.gladys.fake.connectionStatus.connected, false);
    assert.match(world.gladys.fake.connectionStatus.message.en, /e-mail and password/);
    assert.deepEqual(smarthq.requests, []);
  } finally {
    await world.close();
  }
});

test('SmartHQ down: the status says so, and the connection is tried again', async () => {
  const world = await createWorld({
    smarthq: { down: true },
    waitDevices: false,
    app: { timers: true, hubOptions: { timing: { reconnectMinMs: 10, reconnectMaxMs: 20 } } },
  });
  try {
    await waitFor(() => world.gladys.fake.connectionStatus?.connected === false, {
      label: 'status',
    });
    assert.match(world.gladys.fake.connectionStatus.message.en, /cannot be reached/);
    world.smarthq.down = false;
    await waitFor(() => world.gladys.fake.discoveredDevices.length > 0, { label: 'devices' });
    assert.equal(world.gladys.fake.connectionStatus.connected, true);
    const warnings = world.logger.at('warn');
    assert.equal(warnings.length, 1, `one warning for the outage: ${warnings}`);
    assert.ok(world.logger.at('info').some((line) => /reachable again/.test(line)));
  } finally {
    await world.close();
  }
});

// -----------------------------------------------------------------------------
// The live picture: states from the socket, the container's own refresh
// (Gladys#3198: without onPoll), reconnection, scene triggers, quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEARTBEAT_MS } from '../src/hub.js';
import { PASSWORD, WS_SECRET, idOf } from './helpers/fake-smarthq.js';
import { createWorld, settle, waitFor } from './helpers/world.js';

test('the states of the added devices reach Gladys, in the configured unit', async () => {
  const world = await createWorld();
  try {
    assert.equal(world.state('washer', 'status'), 'En marche');
    assert.equal(world.state('washer', 'cycle'), 'Normal or mixed load');
    assert.equal(world.state('washer', 'remaining_time'), 45);
    assert.equal(world.state('dishwasher', 'phase'), 'Lavage principal');
    assert.equal(world.state('dishwasher', 'alerts'), 'Liquide de rinçage bas');
    assert.equal(world.state('dryer', 'status'), 'Cycle terminé');
    // 37 °F and 0 °F, in °C by default.
    assert.equal(world.state('fridge', 'fridge_temperature'), 2.8);
    assert.equal(world.state('fridge', 'freezer_target_temperature'), -17.8);
    assert.equal(world.state('fridge', 'water_filter_life'), 15);
    assert.equal(world.state('wall_oven', 'status'), 'Cuisson');
    assert.equal(world.state('wall_oven', 'lower_status'), 'Arrêté');
    assert.equal(world.state('wall_oven', 'temperature'), 171.1);
    assert.equal(world.state('water_heater', 'water_temperature'), 45.6);
    assert.equal(world.state('water_heater', 'heater_mode'), 'Hybride');
    assert.equal(world.state('ice_maker', 'status'), 'Production de glace');
    // Window AC: cooling (Gladys AC_MODE 1), medium fan (3), 72 °F.
    assert.equal(world.state('window_ac', 'mode'), 1);
    assert.equal(world.state('window_ac', 'fan_speed'), 3);
    assert.equal(world.state('window_ac', 'target_temperature'), 22.2);
    const badges = world.gladys.fake.transports;
    assert.ok(badges.length >= 12);
    assert.ok(badges.every((badge) => badge.transport === 'cloud'));
  } finally {
    await world.close();
  }
});

test('in Fahrenheit, the native values are published as they are', async () => {
  const world = await createWorld({
    config: {
      username: 'jane.doe@example.com',
      password: PASSWORD,
      temperature_unit: 'fahrenheit',
      language: 'en',
    },
  });
  try {
    assert.equal(world.state('fridge', 'fridge_temperature'), 37);
    assert.equal(world.state('window_ac', 'target_temperature'), 72);
    const feature = world
      .device('window_ac')
      .features.find((f) => f.external_id.endsWith(':target_temperature'));
    assert.deepEqual([feature.unit, feature.min, feature.max], ['fahrenheit', 64, 86]);
    assert.equal(world.state('washer', 'status'), 'Running');
  } finally {
    await world.close();
  }
});

test('doors follow Gladys: 0 open, 1 closed', async () => {
  const world = await createWorld();
  try {
    assert.equal(world.state('washer', 'door'), 1);
    assert.equal(world.state('washer_dryer', 'door'), 0);
    assert.equal(world.state('fridge', 'door'), 1);
    world.smarthq.change(idOf('fridge'), '0x1016', '000100FF');
    await waitFor(() => world.state('fridge', 'door') === 0, { label: 'fridge door open' });
    world.smarthq.change(idOf('dishwasher'), '0x3037', '00');
    await waitFor(() => world.state('dishwasher', 'door') === 0, { label: 'dishwasher door' });
  } finally {
    await world.close();
  }
});

test('a change pushed by SmartHQ is published within moments, only what changed', async () => {
  const world = await createWorld();
  try {
    const before = world.gladys.fake.states.length;
    world.smarthq.change(idOf('washer'), '0x2007', '0258'); // 600 s
    await waitFor(() => world.state('washer', 'remaining_time') === 10, { label: 'time left' });
    await settle();
    const sent = world.gladys.fake.states.slice(before);
    assert.deepEqual(
      sent.map((state) => state.device_feature_external_id.split(':').pop()).sort(),
      ['end_time', 'remaining_time'],
    );
  } finally {
    await world.close();
  }
});

test('the container refreshes the states by itself, without onPoll (Gladys#3198)', async (t) => {
  const world = await createWorld({
    app: { timers: true, hubOptions: { timing: { fullReadMs: 60 } } },
  });
  try {
    const poll = t.mock.method(world.app.hub, 'poll');
    // A change the socket never pushed: only a full read sees it.
    world.smarthq.setQuietly(idOf('water_heater'), '0x4026', '04B0');
    await waitFor(() => world.state('water_heater', 'water_temperature') === 48.9, {
      label: 'self refresh',
    });
    assert.equal(poll.mock.callCount(), 0);
  } finally {
    await world.close();
  }
});

test('onPoll stays a fallback, skipped when the container read recently', async () => {
  const world = await createWorld();
  try {
    const reads = () =>
      world.smarthq.received.filter((message) => message.id === 'List-appliances').length;
    const before = reads();
    const ack = await world.gladys.fake.poll(world.device('washer'));
    assert.equal(ack.success, true);
    assert.equal(reads(), before, 'just read: no new read');
  } finally {
    await world.close();
  }
});

test('the states are deduplicated with a heartbeat under 12 hours', async (t) => {
  const world = await createWorld({ addAll: false });
  try {
    const calls = t.mock.method(world.gladys, 'publishChangedStates');
    await world.gladys.fake.deviceCreated(world.device('washer'));
    assert.ok(calls.mock.callCount() >= 1);
    const options = calls.mock.calls[0].arguments[1];
    assert.ok(options.heartbeat > 0 && options.heartbeat <= 12 * 3600_000);
    assert.equal(options.heartbeat, HEARTBEAT_MS);
  } finally {
    await world.close();
  }
});

test('a device added in Gladys receives its states at once, and the widget is nudged', async () => {
  const world = await createWorld({ addAll: false });
  try {
    assert.equal(world.gladys.fake.states.length, 0, 'nothing before the user adds a device');
    const refreshes = world.gladys.fake.widgetRefreshes.length;
    await world.gladys.fake.deviceCreated(world.device('dishwasher'));
    assert.equal(world.state('dishwasher', 'remaining_time'), 52);
    assert.ok(world.gladys.fake.widgetRefreshes.length > refreshes);
    assert.deepEqual(world.gladys.fake.transports.at(-1), {
      device_external_id: world.device('dishwasher').external_id,
      transport: 'cloud',
    });
  } finally {
    await world.close();
  }
});

test('an appliance offline: badge unreachable, state "not connected", other values kept', async () => {
  const world = await createWorld({
    app: { timers: true, hubOptions: { timing: { fullReadMs: 60 } } },
  });
  try {
    world.smarthq.appliances.get(idOf('dishwasher')).online = 'OFFLINE';
    await waitFor(() => world.state('dishwasher', 'status') === 'Non connecté', {
      label: 'offline',
    });
    const last = world.gladys.fake.transports
      .filter((b) => b.device_external_id === world.device('dishwasher').external_id)
      .at(-1);
    assert.equal(last.transport, 'unreachable');
    assert.equal(world.state('dishwasher', 'remaining_time'), 52, 'last value kept');
    assert.ok(world.logger.at('info').some((line) => /not connected to SmartHQ/.test(line)));
  } finally {
    await world.close();
  }
});

test('a lost socket is opened again with a fresh token, and logged once', async () => {
  const world = await createWorld({
    app: { timers: true, hubOptions: { timing: { reconnectMinMs: 10, fullReadMs: 60_000 } } },
  });
  try {
    const sockets = world.smarthq.sockets.length;
    world.smarthq.dropSockets();
    await waitFor(() => world.app.hub.connected && world.smarthq.sockets.length > sockets, {
      label: 'reconnected',
    });
    world.smarthq.change(idOf('washer'), '0x2000', '03');
    await waitFor(() => world.state('washer', 'status') === 'En pause', { label: 'live again' });
    assert.equal(world.logger.at('warn').length, 1);
    assert.ok(world.logger.at('info').some((line) => /connection is back/.test(line)));
  } finally {
    await world.close();
  }
});

test('an expired access token on the socket reconnects with a refreshed one', async () => {
  const world = await createWorld({
    app: { timers: true, hubOptions: { timing: { reconnectMinMs: 10 } } },
  });
  try {
    const refreshes = world.smarthq.refreshes;
    world.smarthq.accessTokens.clear();
    world.smarthq.broadcast({
      kind: 'websocket#api',
      id: 'x',
      success: false,
      code: 401,
      reason: 'Access token expired',
    });
    await waitFor(() => world.smarthq.refreshes > refreshes && world.app.hub.connected, {
      label: 'refreshed',
    });
    assert.equal(world.smarthq.signIns, 1, 'the refresh token was enough');
    assert.deepEqual(world.logger.at('warn'), [], 'a routine renewal is not an outage');
  } finally {
    await world.close();
  }
});

test('cycle_finished fires once at the end of a cycle, never at startup', async () => {
  const world = await createWorld();
  try {
    assert.deepEqual(world.gladys.fake.sceneEvents, [], 'the finished dryer at startup is a state');
    world.smarthq.change(idOf('washer'), '0x2000', '04');
    await waitFor(() => world.gladys.fake.sceneEvents.length === 1, { label: 'trigger' });
    assert.deepEqual(world.gladys.fake.sceneEvents[0], {
      key: 'cycle_finished',
      data: {
        device: world.device('washer').external_id,
        device_name: 'Washer',
        cycle: 'Normal or mixed load',
      },
    });
    world.smarthq.change(idOf('washer'), '0x2007', '0000');
    await settle();
    assert.equal(world.gladys.fake.sceneEvents.length, 1, 'one event per transition');
  } finally {
    await world.close();
  }
});

test('a dishwasher back to idle with no time left counts as finished; a stop does not', async () => {
  const world = await createWorld();
  try {
    const id = idOf('dishwasher');
    world.smarthq.change(id, '0x3001', '02'); // standby, 52 min left: a stop
    await settle();
    assert.equal(world.gladys.fake.sceneEvents.length, 0);
    world.smarthq.change(id, '0x3001', '05');
    world.smarthq.change(id, '0xd004', '0001');
    await settle();
    world.smarthq.change(id, '0x3001', '02');
    await waitFor(() => world.gladys.fake.sceneEvents.length === 1, { label: 'finished' });
    assert.equal(world.gladys.fake.sceneEvents[0].data.cycle, 'AutoSense');
  } finally {
    await world.close();
  }
});

test('a timed oven cook that runs out fires cycle_finished', async () => {
  const world = await createWorld();
  try {
    const id = idOf('wall_oven');
    world.smarthq.change(id, '0x5104', '0001');
    await settle();
    world.smarthq.change(id, '0x5101', '00');
    await waitFor(() => world.gladys.fake.sceneEvents.length === 1, { label: 'oven finished' });
    assert.equal(world.gladys.fake.sceneEvents[0].key, 'cycle_finished');
  } finally {
    await world.close();
  }
});

test('appliance_alert fires for each new alert, in the configured language', async () => {
  const world = await createWorld();
  try {
    world.smarthq.change(idOf('fridge'), '0x1009', '02000000000000000A');
    await waitFor(() => world.gladys.fake.sceneEvents.length === 1, { label: 'alert' });
    assert.deepEqual(world.gladys.fake.sceneEvents[0], {
      key: 'appliance_alert',
      data: {
        device: world.device('fridge').external_id,
        device_name: 'Fridge',
        alert: 'Filtre à eau périmé',
        code: 'water_filter_expired',
      },
    });
    // Newer refrigerators: the alert bits of ERD 0x122e (bit 120: fridge door).
    const notifications = (1n << 120n).toString(16).padStart(32, '0');
    world.smarthq.change(idOf('fridge'), '0x122e', `${'0'.repeat(32)}${notifications}`);
    await waitFor(() => world.gladys.fake.sceneEvents.length === 2, { label: 'door alert' });
    assert.equal(world.gladys.fake.sceneEvents[1].data.code, 'fridge_door');
    assert.match(world.state('fridge', 'alerts'), /Porte du réfrigérateur ouverte/);
  } finally {
    await world.close();
  }
});

test('a normal cycle writes nothing at info level, and no secret ever reaches the logs', async () => {
  const world = await createWorld({
    app: { timers: true, hubOptions: { timing: { fullReadMs: 40 } } },
  });
  try {
    world.logger.clear();
    world.smarthq.change(idOf('washer'), '0x2007', '0500');
    world.smarthq.change(idOf('window_ac'), '0x7a02', '0050');
    await settle(200); // a few full reads
    assert.deepEqual(world.logger.at('info'), []);
    assert.deepEqual(world.logger.at('warn'), []);
    // A user command: one info line.
    await world.gladys.fake.setValue(
      world.device('window_ac'),
      { external_id: world.feature('window_ac', 'power') },
      0,
    );
    assert.equal(world.logger.at('info').length, 1);
    const all = world.logger.lines.map((line) => line.text).join('\n');
    for (const secret of [PASSWORD, WS_SECRET, 'access-', 'refresh-', 'jane.doe']) {
      assert.ok(!all.includes(secret), `"${secret}" found in the logs`);
    }
  } finally {
    await world.close();
  }
});

test('an unsupported appliance is announced once and never published', async () => {
  const world = await createWorld();
  try {
    assert.equal(world.device('toaster_oven'), undefined);
    const lines = world.logger.at('info').filter((line) => /0x22 not supported/.test(line));
    assert.equal(lines.length, 1);
  } finally {
    await world.close();
  }
});

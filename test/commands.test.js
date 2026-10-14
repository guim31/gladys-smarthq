// -----------------------------------------------------------------------------
// Commands: what may be changed remotely (refrigerator setpoints, air
// conditioners, a dishwasher paused or stopped), and everything refused —
// above all, nothing that heats is ever driven.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_KEYS, featureDefs } from '../src/appliances.js';
import { normalizeCode } from '../src/erd.js';
import { loadFixture, idOf } from './helpers/fake-smarthq.js';
import { createWorld, settle, waitFor } from './helpers/world.js';

const set = (world, name, key, value) =>
  world.gladys.fake.setValue(world.device(name), { external_id: world.feature(name, key) }, value);

const lastWrite = (world) => world.smarthq.writes.at(-1);

test('only refrigerator setpoints and air conditioners are writable, on every fixture', () => {
  for (const name of [
    'washer',
    'dryer',
    'washer_dryer',
    'dishwasher',
    'wall_oven',
    'range',
    'fridge',
    'beverage_center',
    'window_ac',
    'portable_ac',
    'water_heater',
    'ice_maker',
  ]) {
    const fixture = loadFixture(name);
    const erds = Object.fromEntries(
      Object.entries(fixture.erds).map(([code, value]) => [normalizeCode(code), value]),
    );
    const appliance = { id: fixture.applianceId, nickname: '', online: true, erds };
    for (const def of featureDefs(appliance, { language: 'en', unit: 'celsius' })) {
      const writable = !def.spec.read_only;
      const family = Object.keys(COMMAND_KEYS).find((key) => COMMAND_KEYS[key].includes(def.key));
      assert.equal(writable, Boolean(def.write), `${name}.${def.key}`);
      if (writable) {
        assert.ok(['fridge', 'air_conditioner'].includes(family), `${name}.${def.key} writable`);
        assert.ok(['fridge', 'beverage_center', 'window_ac', 'portable_ac'].includes(name));
      }
    }
  }
});

test('a refrigerator setpoint in °C becomes whole °F, the other compartment unchanged', async () => {
  const world = await createWorld();
  try {
    const ack = await set(world, 'fridge', 'fridge_target_temperature', 4);
    assert.equal(ack.success, true, JSON.stringify(ack));
    // 4 °C = 39.2 °F → 39 (0x27), freezer 0 °F (0x00) sent back as it was.
    assert.deepEqual(lastWrite(world), {
      applianceId: idOf('fridge'),
      erd: '0x1005',
      value: '2700',
      userId: 'user-0001',
    });
    assert.equal(world.state('fridge', 'fridge_target_temperature'), 3.9);
    await waitFor(() => world.state('fridge', 'fridge_target_temperature') === 3.9, {
      label: 'confirmed',
    });
    // -20 °C = -4 °F (0xFC), the fridge setpoint (39 °F, 0x27) sent back.
    await set(world, 'fridge', 'freezer_target_temperature', -20);
    assert.equal(lastWrite(world).value, '27FC');
  } finally {
    await world.close();
  }
});

test('a setpoint outside the limits of the appliance is refused before sending', async () => {
  const world = await createWorld();
  try {
    const writes = world.smarthq.writes.length;
    const ack = await set(world, 'fridge', 'fridge_target_temperature', 12);
    assert.equal(ack.success, false);
    assert.match(ack.error, /hors limites/);
    assert.equal(world.smarthq.writes.length, writes);
  } finally {
    await world.close();
  }
});

test('an air conditioner: power, mode, setpoint and fan, as the appliance offers them', async () => {
  const world = await createWorld();
  try {
    await set(world, 'window_ac', 'power', 0);
    assert.deepEqual([lastWrite(world).erd, lastWrite(world).value], ['0x7A0F', '00']);
    await set(world, 'window_ac', 'mode', 4); // fan only
    assert.deepEqual([lastWrite(world).erd, lastWrite(world).value], ['0x7A01', '01']);
    await set(world, 'window_ac', 'mode', 0); // auto: energy saver on this model
    assert.equal(lastWrite(world).value, '02');
    const heat = await set(world, 'window_ac', 'mode', 2);
    assert.equal(heat.success, false, 'this window unit cannot heat');
    await set(world, 'window_ac', 'target_temperature', 24); // 75.2 °F → 75
    assert.deepEqual([lastWrite(world).erd, lastWrite(world).value], ['0x7003', '004B']);
    await set(world, 'window_ac', 'fan_speed', 5); // high
    assert.deepEqual([lastWrite(world).erd, lastWrite(world).value], ['0x7A00', '08']);
    const hot = await set(world, 'window_ac', 'target_temperature', 35);
    assert.equal(hot.success, false);
    const heatPump = await set(world, 'portable_ac', 'mode', 2);
    assert.equal(heatPump.success, true, 'the portable unit offers heat');
    await waitFor(() => world.state('window_ac', 'fan_speed') === 5, { label: 'fan state' });
  } finally {
    await world.close();
  }
});

test('nothing that heats is driven: ovens and water heaters refuse every command', async () => {
  const world = await createWorld();
  try {
    const writes = world.smarthq.writes.length;
    for (const [name, key, value] of [
      ['wall_oven', 'target_temperature', 180],
      ['range', 'status', 1],
      ['water_heater', 'water_target_temperature', 60],
      ['washer', 'status', 1],
      ['dishwasher', 'remote_control', 1],
    ]) {
      const ack = await set(world, name, key, value);
      assert.equal(ack.success, false, `${name}.${key}`);
    }
    assert.equal(world.smarthq.writes.length, writes);
    for (const name of ['wall_oven', 'range', 'water_heater']) {
      for (const feature of world.device(name).features) {
        assert.equal(feature.read_only, true, `${name}: ${feature.external_id}`);
      }
    }
  } finally {
    await world.close();
  }
});

test('the scene action pauses or stops a dishwasher, never starts anything', async () => {
  const world = await createWorld();
  try {
    const device = world.device('dishwasher').external_id;
    const pause = await world.gladys.fake.sceneAction('appliance_command', {
      device,
      command: 'pause',
    });
    assert.deepEqual(pause, { success: true, data: { outputs: { sent: true } } });
    assert.deepEqual([lastWrite(world).erd, lastWrite(world).value], ['0x3204', '03']);

    world.smarthq.change(idOf('dishwasher'), '0x3001', '04'); // paused
    await waitFor(() => world.state('dishwasher', 'status') === 'En pause', { label: 'paused' });
    const pauseAgain = await world.gladys.fake.sceneAction('appliance_command', {
      device,
      command: 'pause',
    });
    assert.equal(pauseAgain.success, false);
    const stop = await world.gladys.fake.sceneAction('appliance_command', {
      device,
      command: 'stop',
    });
    assert.equal(stop.success, true);
    assert.equal(lastWrite(world).value, '02');
    const start = await world.gladys.fake.sceneAction('appliance_command', {
      device,
      command: 'start',
    });
    assert.equal(start.success, false, 'no start command exists');
    assert.ok(
      !world.smarthq.writes.some((write) => write.value === '01' && write.erd === '0x3204'),
    );
  } finally {
    await world.close();
  }
});

test('the scene action is refused without remote control, or on another appliance', async () => {
  const world = await createWorld();
  try {
    world.smarthq.change(idOf('dishwasher'), '0x3087', '00');
    await settle();
    const refused = await world.gladys.fake.sceneAction('appliance_command', {
      device: world.device('dishwasher').external_id,
      command: 'stop',
    });
    assert.equal(refused.success, false);
    assert.match(refused.error, /commande à distance/);
    const washer = await world.gladys.fake.sceneAction('appliance_command', {
      device: world.device('washer').external_id,
      command: 'stop',
    });
    assert.equal(washer.success, false);
    assert.match(washer.error, /lave-vaisselle/);
    const unknown = await world.gladys.fake.sceneAction('appliance_command', {
      device: 'ext:test-integration:appliance:000000000000',
      command: 'stop',
    });
    assert.equal(unknown.success, false);
  } finally {
    await world.close();
  }
});

test('a command SmartHQ refuses is reported with its reason, in one info line', async () => {
  const world = await createWorld();
  try {
    world.smarthq.refuseWrites.push(400);
    world.logger.clear();
    const ack = await set(world, 'window_ac', 'power', 0);
    assert.equal(ack.success, false);
    assert.match(ack.error, /SmartHQ a refusé la commande/);
    assert.equal(world.logger.at('info').length, 1);
  } finally {
    await world.close();
  }
});

// The dashboard widget: what is running, the busiest first, within the core budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { formatMinutes } from '../src/widgets.js';
import { idOf } from './helpers/fake-smarthq.js';
import { createWorld, waitFor } from './helpers/world.js';

const content = async (world, language = 'fr') => {
  const ack = await world.gladys.fake.widgetGet('running_appliances', { settings: {}, language });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  return ack.data.content;
};

test('times read as people say them', () => {
  assert.equal(formatMinutes(42), '42 min');
  assert.equal(formatMinutes(65), '1 h 05');
});

test('the widget lists what runs, the busiest first, with the time left', async () => {
  const world = await createWorld();
  try {
    const { components } = await content(world);
    assert.equal(components[0].text, '4 en marche');
    const list = components.find((component) => component.type === 'card-list');
    assert.deepEqual(
      list.items.map((item) => [item.title, item.badge.text]),
      [
        ['Wall oven', '45 min'],
        ['Washer', '45 min'],
        ['Dishwasher', '52 min'],
        ['Range', 'Préchauffage'],
        ['Dryer', 'Terminé'],
      ],
    );
    assert.match(list.items[2].subtitle, /^AutoSense · Lavage principal · fin à \d\d:\d\d$/);
    const english = await content(world, 'en');
    assert.equal(english.components[0].text, '4 running');
  } finally {
    await world.close();
  }
});

test('nothing running: one line says so; nothing added: one line says how', async () => {
  const world = await createWorld({ addAll: false });
  try {
    assert.match((await content(world)).components[0].text, /onglet Découverte/);
    await world.gladys.fake.deviceCreated(world.device('fridge'));
    assert.equal(
      (await content(world)).components[0].text,
      'Aucun appareil en marche pour le moment.',
    );
    await world.gladys.fake.deviceCreated(world.device('washer'));
    world.smarthq.change(idOf('washer'), '0x2000', '00');
    await waitFor(async () => (await content(world)).components[0].text.startsWith('Aucun'), {
      label: 'idle',
    });
  } finally {
    await world.close();
  }
});

test('without credentials, the widget says what to fill in', async () => {
  const world = await createWorld({ config: {}, waitDevices: false });
  try {
    assert.match((await content(world, 'en')).components[0].text, /e-mail and password/);
  } finally {
    await world.close();
  }
});

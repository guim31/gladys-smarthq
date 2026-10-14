// -----------------------------------------------------------------------------
// The whole integration on the SDK's fake Gladys and a fake SmartHQ: what a
// user sees after installing it, filling in the SmartHQ e-mail and password,
// and adding the appliances.
// -----------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { PASSWORD, USERNAME, createFakeSmartHq, idOf } from './fake-smarthq.js';

export const CONFIG = { username: USERNAME, password: PASSWORD, language: 'fr' };

/** A logger that keeps every line, by level. */
export function createCaptureLogger() {
  const lines = [];
  const write =
    (level) =>
    (...args) => {
      lines.push({
        level,
        text: args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '),
      });
    };
  const logger = {
    lines,
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    at: (level) => lines.filter((line) => line.level === level).map((line) => line.text),
    clear: () => lines.splice(0),
  };
  logger.child = () => logger;
  return logger;
}

/** Wait until `check()` is truthy (polled), or fail. */
export async function waitFor(check, { timeout = 3000, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const result = await check();
    if (result) {
      return result;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Let the fake socket answer (a few ms of timers). */
export const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} [options]
 * @param {object} [options.config]
 * @param {boolean} [options.addAll] the user adds every discovered device
 * @param {object} [options.smarthq] options of the fake SmartHQ
 * @param {object} [options.smarthqFake] reuse a fake SmartHQ (a restart)
 * @param {object} [options.app] extra options of createApp
 * @param {string} [options.dataDir] reuse a /data directory (a restart)
 * @param {boolean} [options.waitDevices] wait for the discovered devices
 */
export async function createWorld({
  config = CONFIG,
  addAll = true,
  smarthq: smarthqOptions,
  smarthqFake,
  app: appOptions = {},
  dataDir: givenDataDir,
  waitDevices = true,
} = {}) {
  const dataDir = givenDataDir ?? (await mkdtemp(join(tmpdir(), 'gladys-smarthq-')));
  const smarthq = smarthqFake ?? createFakeSmartHq(smarthqOptions);
  const gladys = createFakeGladys({ config });
  const logger = createCaptureLogger();
  const app = createApp({
    gladys,
    fetch: smarthq.fetch,
    WebSocket: smarthq.WebSocket,
    dataDir,
    timers: false,
    logger,
    ...appOptions,
    hubOptions: {
      timing: { coalesceMs: 5, ...(appOptions.hubOptions?.timing ?? {}) },
      ...(appOptions.hubOptions ?? {}),
    },
  });
  await gladys.connect();
  const expected = [...smarthq.appliances.values()].filter((a) => a.erds['0x0008'] !== '22').length;
  if (waitDevices && expected > 0) {
    await waitFor(() => (gladys.fake.discoveredDevices ?? []).length >= expected, {
      label: 'discovered devices',
    });
    await settle();
  }
  if (addAll) {
    for (const device of gladys.fake.discoveredDevices ?? []) {
      await gladys.fake.deviceCreated(device);
    }
  }
  return {
    gladys,
    app,
    smarthq,
    logger,
    dataDir,
    /** The discovered device of a fixture appliance ("washer", "fridge"…). */
    device: (name) =>
      gladys.fake.discoveredDevices.find((d) => d.external_id.endsWith(`:appliance:${idOf(name)}`)),
    /** The external id of a feature of a fixture appliance. */
    feature(name, key) {
      return `${this.device(name).external_id}:${key}`;
    },
    /** The last state Gladys received for a feature. */
    state(name, key) {
      return gladys.fake.lastState(this.feature(name, key));
    },
    async close({ keepData = false } = {}) {
      app.stop();
      await gladys.disconnect().catch(() => {});
      if (!keepData) {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  };
}

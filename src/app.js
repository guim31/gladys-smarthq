// -----------------------------------------------------------------------------
// The integration, wired on a Gladys client: every handler registered before
// connect(). index.js gives it the real client; the tests give it the SDK's
// fake Gladys and a fake SmartHQ (`fetch` and `WebSocket`), and run it end to
// end.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { applianceName, familyOf } from './appliances.js';
import { normalizeConfig } from './config.js';
import { createSmartHqClient } from './ge/client.js';
import { createTokenStore } from './ge/token-store.js';
import { createHub } from './hub.js';
import { CODE_TEXT, TEST_TEXT, fillAll } from './i18n.js';
import { createSceneActions } from './scenes.js';
import { createWidgets } from './widgets.js';

const defaultLogger = createLogger({ name: 'smarthq' });

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration, or the SDK's fake Gladys
 * @param {typeof fetch} [options.fetch] the network (a fake SmartHQ in the tests)
 * @param {typeof WebSocket} [options.WebSocket] the socket client (a fake in the tests)
 * @param {string} [options.dataDir] where the refresh token lives (/data)
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] full reads and reconnections (off in most tests)
 * @param {object} [options.hubOptions] timing overrides of the hub (tests)
 * @param {object} [options.logger]
 */
export function createApp({
  gladys,
  fetch = globalThis.fetch,
  WebSocket = globalThis.WebSocket,
  dataDir,
  now = () => Date.now(),
  timers = true,
  hubOptions = {},
  logger = defaultLogger,
}) {
  let config = normalizeConfig(gladys.config ?? {});
  const getConfig = () => config;
  const store = createTokenStore({ dir: dataDir });
  const client = createSmartHqClient({ getConfig, store, fetch, now });
  const hub = createHub({
    gladys,
    client,
    getConfig,
    WebSocket,
    now,
    timers,
    logger,
    ...hubOptions,
  });
  const restart = () => hub.start().catch((err) => logger.error(`Start failed (${err.message})`));

  // --- Devices ----------------------------------------------------------------
  gladys.onScanRequest(() => hub.scan());
  gladys.onPoll(() => hub.poll());
  gladys.onSetValue((device, feature, value) => hub.setValue(device, feature, value));
  gladys.onDeviceCreated((device) => hub.deviceCreated(device));
  gladys.onDeviceUpdated((device) => hub.deviceCreated(device));

  // --- Configuration actions ----------------------------------------------------
  gladys.onAction('test_connection', async () => {
    try {
      const list = await hub.ensureList();
      const names = list
        .filter((appliance) => familyOf(appliance))
        .map(
          (appliance) => hub.displayName(appliance.id) || applianceName(appliance, config.language),
        );
      logger.info(`Connection test: ${list.length} appliance(s)`);
      if (list.length === 0) {
        return TEST_TEXT.none;
      }
      return fillAll(TEST_TEXT.ok, {
        n: list.length,
        list: (names.length > 0 ? names.join(', ') : '…').slice(0, 120),
      });
    } catch (err) {
      logger.info(`Connection test failed: ${err.message}`);
      throw new Error(fillAll(TEST_TEXT.failed, { detail: err.message })[config.language], {
        cause: err,
      });
    }
  });

  gladys.onAction('send_code', async () => {
    try {
      const method = await client.sendCode();
      if (method === null) {
        logger.info('Verification code: SmartHQ signed in without one');
        await restart();
        return CODE_TEXT.notNeeded;
      }
      logger.info(`Verification code requested (${method})`);
      return method === 'email' ? CODE_TEXT.sentEmail : fillAll(CODE_TEXT.sentOther, { method });
    } catch (err) {
      logger.info(`Verification code not sent: ${err.message}`);
      throw new Error(fillAll(CODE_TEXT.failed, { detail: err.message })[config.language], {
        cause: err,
      });
    }
  });

  gladys.onAction('submit_code', async (fields) => {
    const code = String(fields?.code ?? '').replace(/\s+/g, '');
    if (code === '') {
      throw new Error(CODE_TEXT.missing[config.language]);
    }
    try {
      await client.submitCode(code);
    } catch (err) {
      logger.info(`Verification code refused: ${err.message}`);
      throw new Error(fillAll(CODE_TEXT.failed, { detail: err.message })[config.language], {
        cause: err,
      });
    }
    logger.info('Verification code accepted');
    await restart();
    return CODE_TEXT.accepted;
  });

  // --- Scenes and widgets -------------------------------------------------------
  for (const [key, handler] of Object.entries(createSceneActions({ hub }))) {
    gladys.onSceneAction(key, handler);
  }
  for (const [key, widget] of Object.entries(createWidgets({ gladys, hub }))) {
    gladys.onWidgetGet(key, widget.get);
  }

  // --- Life cycle ---------------------------------------------------------------
  gladys.onConfigUpdated(async (raw) => {
    const next = normalizeConfig(raw);
    const changed = JSON.stringify(next) !== JSON.stringify(config);
    if (
      next.username !== config.username ||
      next.password !== config.password ||
      next.region !== config.region
    ) {
      client.reset();
    }
    config = next;
    if (changed) {
      logger.info('Configuration updated');
      await restart();
    }
  });

  gladys.on('connected', async () => {
    config = normalizeConfig(gladys.config ?? (await gladys.getConfig()));
    await restart();
  });

  gladys.on('disconnected', () => hub.stop());

  return { hub, client, store, getConfig, stop: () => hub.stop() };
}

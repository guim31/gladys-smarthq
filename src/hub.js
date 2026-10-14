// -----------------------------------------------------------------------------
// The live picture of the SmartHQ account, and everything that follows.
//
// Sources, in order of preference:
//   1. the SmartHQ socket (src/ge/socket.js): every ERD change within seconds;
//   2. a full read by the container's own timer, through the same socket (the
//      list of appliances, then every ERD of each one): every 10 minutes, the
//      safety net and the heartbeat of the values that never change;
//   3. the core's onPoll, a fallback only: Gladys#3198 makes it unreliable,
//      and it is skipped whenever the container read recently.
//
// The connection: tokens (src/ge/client.js), then the socket. Lost, it is
// opened again after 10 s, then 20 s, 40 s… 15 minutes at most. A refused
// password, a verification code to type or new terms to accept stop
// everything until the user acts: no retry loop that could lock the account.
//
// What follows from a change: the states of the devices the user added (only
// the changes, `publishChangedStates`), their cloud/unreachable badge, the
// scene triggers (`cycle_finished`, `appliance_alert`: one event per
// transition, never at startup), and a nudge to the dashboard widget.
//
// Logs stay quiet: a normal cycle writes nothing at info level. The life
// cycle does (account connected, appliance found, connection lost and back,
// one line per user command), and a repeated failure writes one line when it
// starts and one when it is over (src/issues.js).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  CYCLE_FAMILIES,
  LAUNDRY_FAMILIES,
  alertCodes,
  alertText,
  applianceName,
  buildDevice,
  buildStates,
  cycleCommand,
  cycleText,
  cycleTiming,
  familyOf,
  featureDefs,
  idsOf,
  isActive,
  isConnected,
  ovenZones,
  statusKey,
  typeCode,
  zoneStatus,
} from './appliances.js';
import { CommandError } from './command-error.js';
import { hasCredentials } from './config.js';
import {
  FULL_READ_INTERVAL_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  RESPONSE_TIMEOUT_MS,
} from './ge/constants.js';
import { MfaRequiredError, TermsRequiredError } from './ge/client.js';
import { CommandRefusedError, openSocket } from './ge/socket.js';
import { COMMAND_TEXT, CONNECTION_TEXT, fillAll } from './i18n.js';
import { createIssueLog } from './issues.js';

/** A value that never changes is sent again this often (Gladys flags 48 h). */
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
/** Changes of one appliance arriving together are published together. */
export const COALESCE_MS = 300;
export const WIDGET_KEY = 'running_appliances';
export const TRIGGERS = { FINISHED: 'cycle_finished', ALERT: 'appliance_alert' };

const defaultLogger = createLogger({ name: 'smarthq' });

const RUNNING_KEYS = ['RUNNING', 'PAUSED'];

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {ReturnType<import('./ge/client.js').createSmartHqClient>} options.client
 * @param {() => object} options.getConfig the current normalized config
 * @param {typeof WebSocket} [options.WebSocket] the socket client (a fake in the tests)
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] full reads and reconnections (tests may turn them off)
 * @param {object} [options.timing] delays overrides (tests)
 * @param {object} [options.socketOptions] extra options of openSocket (tests)
 * @param {object} [options.logger]
 */
export function createHub({
  gladys,
  client,
  getConfig,
  WebSocket,
  now = () => Date.now(),
  timers = true,
  timing = {},
  socketOptions = {},
  logger = defaultLogger,
}) {
  const fullReadMs = timing.fullReadMs ?? FULL_READ_INTERVAL_MS;
  const reconnectMinMs = timing.reconnectMinMs ?? RECONNECT_MIN_MS;
  const reconnectMaxMs = timing.reconnectMaxMs ?? RECONNECT_MAX_MS;
  const responseTimeoutMs = timing.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS;
  const coalesceMs = timing.coalesceMs ?? COALESCE_MS;

  const issues = createIssueLog(logger);
  /** MAC → { id, nickname, online, erds } */
  const appliances = new Map();
  /** MAC → what was seen last, for the triggers */
  const previous = new Map();
  /** MAC → last transport published */
  const transports = new Map();
  /** appliance ids (and unsupported types) already announced in the logs */
  const announced = new Set();
  /** MAC → timer of a coalesced socket update */
  const pending = new Map();
  /** MACs whose full ERD list is awaited */
  const awaited = new Set();
  let published = new Set();
  let socket = null;
  let connecting = null;
  let running = false;
  let configured = false;
  let accountAnnounced = false;
  let everConnected = false;
  let listReceived = false;
  let lastReadAt = null;
  let lastListRequest = 0;
  let reported = null;
  let widgetSignature = '';
  let reconnectTimer = null;
  /** The socket is closed on purpose, to reconnect with a renewed token. */
  let renewing = false;
  let reconnectDelay = reconnectMinMs;
  let readTimer = null;
  let responseTimer = null;
  /** Resolvers of the callers waiting for the list of appliances. */
  let listWaiters = [];

  const options = () => ({
    language: getConfig().language,
    unit: getConfig().temperature_unit,
    now: now(),
  });
  const createdIds = () => new Set((gladys.devices ?? []).map((device) => device.external_id));
  const supported = () => [...appliances.values()].filter((appliance) => familyOf(appliance));

  /** The connection badge of the Configuration screen, sent on change only. */
  async function report(key) {
    if (reported === key) {
      return;
    }
    reported = key;
    try {
      if (key === 'ok') {
        await gladys.setConnectionStatus(true);
      } else {
        await gladys.setConnectionStatus(false, CONNECTION_TEXT[key]);
      }
    } catch (err) {
      reported = null;
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  function findId(externalId) {
    for (const id of appliances.keys()) {
      if (idsOf(gladys, id).device === externalId) {
        return id;
      }
    }
    return null;
  }

  /** The name the user sees: the Gladys device name, else ours. */
  function displayName(id) {
    const ids = idsOf(gladys, id);
    const created = (gladys.devices ?? []).find((device) => device.external_id === ids.device);
    return created?.name || applianceName(appliances.get(id), getConfig().language);
  }

  async function publishDiscovered() {
    const list = supported();
    const devices = [];
    for (const appliance of list) {
      const device = buildDevice(gladys, appliance, options());
      if (!device) {
        continue;
      }
      devices.push(device);
      if (!announced.has(appliance.id)) {
        announced.add(appliance.id);
        logger.info(`GE appliance found: ${device.name} (${familyOf(appliance)})`);
      }
    }
    try {
      await gladys.publishDiscoveredDevices(devices);
      published = new Set(list.map((appliance) => appliance.id));
      issues.ok('discovery', 'Appliances published to Gladys again');
    } catch (err) {
      issues.fail('discovery', `Publishing the appliances to Gladys failed (${err.message})`);
    }
  }

  /** States of the given appliances, those the user added only. */
  async function publishStates(list, { onlyIds } = {}) {
    const created = onlyIds ?? createdIds();
    const opts = options();
    const states = list
      .filter((appliance) => created.has(idsOf(gladys, appliance.id).device))
      .flatMap((appliance) => buildStates(gladys, appliance, opts));
    if (states.length === 0) {
      return;
    }
    try {
      const result = await gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      logger.debug(`${result?.count ?? 0} state(s) sent to Gladys`);
      issues.ok('states', 'States reach Gladys again');
    } catch (err) {
      issues.fail('states', `Sending the states to Gladys failed (${err.message})`);
    }
  }

  async function publishTransports(list, { force = false } = {}) {
    const created = createdIds();
    const entries = [];
    for (const appliance of list) {
      const externalId = idsOf(gladys, appliance.id).device;
      const transport = isConnected(appliance) && socket ? 'cloud' : 'unreachable';
      if (!created.has(externalId) || (!force && transports.get(appliance.id) === transport)) {
        continue;
      }
      transports.set(appliance.id, transport);
      entries.push({ external_id: externalId, transport });
    }
    if (entries.length > 0) {
      await gladys.publishTransports(entries).catch((err) => {
        logger.debug(`Transport badges not sent (${err.message})`);
      });
    }
  }

  /** What the triggers compare: state, time left, alerts, per cavity for an oven. */
  function snapshot(appliance) {
    const family = familyOf(appliance);
    const zones = family === 'oven' ? ovenZones(appliance) : [];
    const status = statusKey(appliance);
    const cycle = cycleText(appliance);
    return {
      status,
      alerts: alertCodes(appliance),
      left: cycleTiming(appliance).left,
      cycle,
      zones: Object.fromEntries(
        zones.map((zone) => [
          zone,
          { status: zoneStatus(appliance, zone), left: cycleTiming(appliance, zone).left },
        ]),
      ),
    };
  }

  /** Scene events for the transitions of one appliance. */
  async function fireTriggers(appliance) {
    if (!isConnected(appliance) || !familyOf(appliance)) {
      return;
    }
    const before = previous.get(appliance.id);
    const now = snapshot(appliance);
    // Keep the cycle seen while running: some appliances clear it at the end.
    if (!now.cycle || !(isActive(now.status) || now.status === 'END_OF_CYCLE')) {
      now.cycle = before?.cycle ?? null;
    }
    previous.set(appliance.id, now);
    if (!before) {
      // First sight (startup, new appliance): a state, not a transition.
      return;
    }
    const device = idsOf(gladys, appliance.id).device;
    const name = displayName(appliance.id);
    const family = familyOf(appliance);
    const events = [];
    if (LAUNDRY_FAMILIES.includes(family) || family === 'dishwasher') {
      const wasRunning = RUNNING_KEYS.includes(before.status);
      const endedNow = now.status === 'END_OF_CYCLE' && before.status !== 'END_OF_CYCLE';
      // Some appliances go back to idle without an "end of cycle" state: a cycle
      // that ran its time out counts as finished, a stop at mid-cycle does not.
      const ranOut =
        ['OFF', 'STANDBY'].includes(now.status) &&
        before.status === 'RUNNING' &&
        (before.left ?? 0) <= 2;
      if (wasRunning && (endedNow || ranOut)) {
        events.push([TRIGGERS.FINISHED, { device, device_name: name, cycle: now.cycle ?? '' }]);
      }
    }
    if (family === 'oven') {
      // A timed cook that ran out (the oven turns itself off); never a manual stop.
      for (const [zone, state] of Object.entries(now.zones)) {
        const was = before.zones?.[zone];
        if (
          was &&
          ['COOKING', 'PREHEATING'].includes(was.status) &&
          state.status === 'OFF' &&
          was.left !== null &&
          was.left <= 2
        ) {
          events.push([TRIGGERS.FINISHED, { device, device_name: name, cycle: '' }]);
          break;
        }
      }
    }
    const fresh = now.alerts.filter((code) => !before.alerts.includes(code)).slice(0, 5);
    for (const code of fresh) {
      events.push([
        TRIGGERS.ALERT,
        { device, device_name: name, alert: alertText(code, getConfig().language), code },
      ]);
    }
    for (const [key, data] of events) {
      logger.debug(`Scene trigger ${key} for ${name}`);
      await gladys.publishSceneEvent(key, data).catch((err) => {
        logger.warn(`Scene trigger ${key} not delivered (${err.message})`);
      });
    }
  }

  /** Nudge the widget when what it lists changes (states, not minutes). */
  function nudgeWidget({ force = false } = {}) {
    const signature = JSON.stringify(
      supported()
        .filter((appliance) => CYCLE_FAMILIES.includes(familyOf(appliance)))
        .map((appliance) => [appliance.id, statusKey(appliance)]),
    );
    if (!force && signature === widgetSignature) {
      return;
    }
    widgetSignature = signature;
    try {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh not requested (${err.message})`);
    }
  }

  /** Take in appliances read in full or changed by the socket. */
  async function apply(list) {
    const ready = [];
    for (const appliance of list) {
      const family = familyOf(appliance);
      if (!family) {
        const type = typeCode(appliance);
        const key = `type:${type}`;
        if (type && !announced.has(key)) {
          announced.add(key);
          logger.info(`GE appliance of type 0x${type} not supported yet: not published`);
        }
        continue;
      }
      ready.push(appliance);
    }
    if (ready.length === 0) {
      return;
    }
    for (const appliance of ready) {
      await fireTriggers(appliance);
    }
    if (ready.some((appliance) => !published.has(appliance.id))) {
      await publishDiscovered();
    }
    await publishStates(ready);
    await publishTransports(ready);
    nudgeWidget();
  }

  // --- The socket ------------------------------------------------------------------

  function onAppliances(items) {
    clearTimeout(responseTimer);
    responseTimer = null;
    listReceived = true;
    lastReadAt = now();
    const changed = [];
    for (const item of items) {
      const id = String(item?.applianceId ?? '').toUpperCase();
      if (!/^[0-9A-F]{6,}$/.test(id)) {
        continue;
      }
      const online = String(item.online ?? 'ONLINE').toUpperCase() === 'ONLINE';
      const nickname = typeof item.nickname === 'string' ? item.nickname.trim() : '';
      const known = appliances.get(id);
      if (known) {
        if (known.online !== online) {
          // The appliance itself (its Wi-Fi module), not the connection of the integration.
          logger.info(
            `${displayName(id)}: ${online ? 'connected to SmartHQ again' : 'not connected to SmartHQ'}`,
          );
          changed.push(known);
        }
        known.online = online;
        known.nickname = nickname || known.nickname;
      } else {
        appliances.set(id, { id, nickname, online, erds: {} });
      }
      awaited.add(id);
      try {
        socket?.requestAll(id);
      } catch (err) {
        logger.debug(`Full read of an appliance not requested (${err.message})`);
      }
    }
    if (!accountAnnounced) {
      accountAnnounced = true;
      logger.info(`SmartHQ account connected: ${items.length} appliance(s)`);
    }
    for (const resolve of listWaiters) {
      resolve();
    }
    listWaiters = [];
    if (changed.length > 0) {
      apply(changed).catch((err) => logger.debug(`Update failed (${err.message})`));
    }
  }

  function onErds(id, values) {
    const appliance = appliances.get(id);
    if (!appliance) {
      return;
    }
    awaited.delete(id);
    appliance.erds = { ...values };
    apply([appliance]).catch((err) => logger.debug(`Update failed (${err.message})`));
  }

  function onErd(id, code, value) {
    const appliance = appliances.get(id);
    if (!appliance) {
      // A new appliance: read the list again (at most once a minute).
      if (socket && now() - lastListRequest > 60_000) {
        requestList();
      }
      return;
    }
    appliance.erds[code] = value;
    if (pending.has(id)) {
      return;
    }
    const flush = setTimeout(() => {
      pending.delete(id);
      const current = appliances.get(id);
      if (current) {
        apply([current]).catch((err) => logger.debug(`Update failed (${err.message})`));
      }
    }, coalesceMs);
    flush.unref?.();
    pending.set(id, flush);
  }

  function requestList() {
    if (!socket) {
      return;
    }
    lastListRequest = now();
    try {
      socket.requestList();
    } catch (err) {
      logger.debug(`List of appliances not requested (${err.message})`);
      return;
    }
    if (!responseTimer) {
      // No answer: the socket is dead even if it looks open.
      responseTimer = setTimeout(() => {
        responseTimer = null;
        logger.debug('No answer from SmartHQ: reopening the connection');
        socket?.close();
      }, responseTimeoutMs);
      responseTimer.unref?.();
    }
  }

  function scheduleReads() {
    clearInterval(readTimer);
    readTimer = null;
    if (!timers || !running) {
      return;
    }
    readTimer = setInterval(() => {
      if (lastReadAt === null || now() - lastReadAt >= fullReadMs / 2) {
        requestList();
      }
    }, fullReadMs);
    readTimer.unref?.();
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (!timers || !running) {
      return;
    }
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    reconnectTimer.unref?.();
  }

  function onClosed(reason) {
    socket = null;
    clearTimeout(responseTimer);
    responseTimer = null;
    clearInterval(readTimer);
    readTimer = null;
    if (!running) {
      return;
    }
    if (renewing) {
      renewing = false;
    } else {
      issues.fail('connection', `SmartHQ connection lost (${reason}), reconnecting`);
    }
    publishTransports(supported()).catch(() => {});
    scheduleReconnect();
  }

  /** Why the connection failed: stop (the user must act) or try again later. */
  async function handleFailure(err) {
    if (client.refusedReason) {
      issues.fail(
        'auth',
        `SmartHQ refused the sign-in: nothing tried until the configuration changes (${client.refusedReason})`,
      );
      await report('refused');
      return;
    }
    if (err instanceof MfaRequiredError) {
      issues.fail(
        'auth',
        'SmartHQ asks for a verification code: waiting for the configuration actions',
      );
      await report('codeNeeded');
      return;
    }
    if (err instanceof TermsRequiredError) {
      issues.fail('auth', 'SmartHQ asks to accept new terms of use in the SmartHQ app');
      await report('terms');
      return;
    }
    issues.fail(
      'connection',
      `SmartHQ cannot be reached (${err.message}), next attempt in ${Math.round(reconnectDelay / 1000)} s`,
    );
    await report('unreachable');
    scheduleReconnect();
  }

  /** Tokens, then the socket, then the first full read. Never throws. */
  function connect() {
    if (!running || socket) {
      return Promise.resolve();
    }
    connecting ??= (async () => {
      try {
        const { endpoint, userId } = await client.websocketCredentials();
        if (!running) {
          return;
        }
        let self = null;
        const opened = await openSocket({
          endpoint,
          userId,
          WebSocket,
          logger,
          ...socketOptions,
          on: {
            appliances: onAppliances,
            erds: onErds,
            erd: onErd,
            authExpired() {
              // A routine renewal, not an outage: no warning.
              logger.debug('SmartHQ access token expired: reconnecting with a new one');
              client.invalidate();
              reconnectDelay = reconnectMinMs;
              renewing = true;
              socket?.close();
            },
            closed(reason) {
              if (socket !== null && socket === self) {
                onClosed(reason);
              }
            },
          },
        });
        if (!running) {
          opened.close();
          return;
        }
        if (!opened.open) {
          throw new Error('SmartHQ socket closed as soon as opened');
        }
        self = opened;
        socket = opened;
        reconnectDelay = reconnectMinMs;
        issues.ok('auth', 'SmartHQ accepted the sign-in again');
        if (everConnected) {
          issues.ok('connection', 'SmartHQ connection is back');
        } else {
          issues.ok('connection', 'SmartHQ reachable again');
        }
        everConnected = true;
        await report('ok');
        requestList();
        scheduleReads();
      } catch (err) {
        await handleFailure(err);
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  }

  function stopAll() {
    running = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearInterval(readTimer);
    readTimer = null;
    clearTimeout(responseTimer);
    responseTimer = null;
    for (const flush of pending.values()) {
      clearTimeout(flush);
    }
    pending.clear();
    const open = socket;
    socket = null;
    open?.close();
    for (const resolve of listWaiters) {
      resolve();
    }
    listWaiters = [];
  }

  /** Turn a failed command into the message the user reads. */
  function commandFailure(err) {
    const language = getConfig().language;
    if (err instanceof CommandError) {
      return err;
    }
    if (err instanceof CommandRefusedError) {
      return new CommandError(fillAll(COMMAND_TEXT.failed, { detail: err.message }), language);
    }
    return new CommandError(COMMAND_TEXT.notLinked, language);
  }

  /**
   * Check then send a user command: one info line whatever the outcome.
   * @param {object} appliance
   * @param {() => { code: string, value: string }} build throws a CommandError when refused
   * @param {string} what for the log line
   * @returns {Promise<{ code: string, value: string }>}
   */
  async function send(appliance, build, what) {
    const name = displayName(appliance.id);
    const language = getConfig().language;
    let write;
    try {
      if (!socket) {
        throw new CommandError(COMMAND_TEXT.notLinked, language);
      }
      if (!isConnected(appliance)) {
        throw new CommandError(COMMAND_TEXT.offline, language);
      }
      write = build();
      await socket.setErd(appliance.id, write.code, write.value);
    } catch (err) {
      const failure = commandFailure(err);
      logger.info(`${what} on ${name} refused: ${failure.message}`);
      throw failure;
    }
    logger.info(`${what} sent to ${name}`);
    return write;
  }

  function applianceFor(externalId) {
    const id = findId(externalId);
    const appliance = id ? appliances.get(id) : null;
    if (!appliance || !familyOf(appliance)) {
      throw new CommandError(COMMAND_TEXT.unknownDevice, getConfig().language);
    }
    return appliance;
  }

  return {
    get appliances() {
      return appliances;
    },
    get configured() {
      return configured;
    },
    get connected() {
      return socket !== null;
    },

    /** (Re)start: on connection to Gladys, a new configuration. */
    async start() {
      stopAll();
      appliances.clear();
      previous.clear();
      transports.clear();
      awaited.clear();
      published = new Set();
      listReceived = false;
      lastReadAt = null;
      reported = null;
      reconnectDelay = reconnectMinMs;
      gladys.forgetPublishedStates?.();
      configured = hasCredentials(getConfig());
      if (!configured) {
        await report('missingCredentials');
        nudgeWidget({ force: true });
        return;
      }
      running = true;
      await connect();
    },

    stop: stopAll,

    /** Ask SmartHQ for everything again (the full read). */
    refresh: requestList,

    /** The core's onPoll (fallback): reads unless the container just did. */
    async poll() {
      if (lastReadAt === null || now() - lastReadAt >= fullReadMs * 0.9) {
        requestList();
      }
    },

    /** Gladys asks for the device list (Discover tab). */
    async scan() {
      if (lastReadAt === null || now() - lastReadAt > 60_000) {
        requestList();
      }
      await publishDiscovered();
    },

    /** A device was added (or updated) in Gladys: send everything now. */
    async deviceCreated(device) {
      const id = findId(device.external_id);
      if (!id) {
        return;
      }
      await publishStates([appliances.get(id)], { onlyIds: new Set([device.external_id]) });
      transports.delete(id);
      await publishTransports([appliances.get(id)], { force: true });
      nudgeWidget({ force: true });
    },

    /** onSetValue: a command on a feature (setpoint, power, mode, fan). */
    async setValue(device, feature, value) {
      const appliance = applianceFor(device.external_id);
      const key = feature.external_id.slice(device.external_id.length + 1);
      const def = featureDefs(appliance, options()).find((candidate) => candidate.key === key);
      const write = await send(
        appliance,
        () => {
          if (!def?.write) {
            throw new CommandError(COMMAND_TEXT.readOnly, getConfig().language);
          }
          return def.write(value);
        },
        `Command ${key}=${value}`,
      );
      // SmartHQ acknowledged: the value is taken in at once (gehomesdk does the
      // same), the socket confirms it a moment later.
      appliance.erds[write.code] = write.value;
      await apply([appliance]);
    },

    /** The `appliance_command` scene action (pause, stop a dishwasher). */
    async runCommand(deviceExternalId, commandKey) {
      const appliance = applianceFor(deviceExternalId);
      await send(
        appliance,
        () => cycleCommand(appliance, commandKey, getConfig().language),
        `Command ${commandKey}`,
      );
    },

    /**
     * Connected, with the list of appliances: for the "Test the connection"
     * action. Connects now when needed; throws why it cannot.
     */
    async ensureList({ timeoutMs = 15_000 } = {}) {
      if (!configured) {
        throw new Error('no e-mail or password in the configuration');
      }
      if (!running) {
        running = true;
      }
      if (!socket) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        await connect();
      }
      if (!socket) {
        throw new Error(
          reported && reported !== 'ok' ? CONNECTION_TEXT[reported].en : 'not connected',
        );
      }
      if (!listReceived) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          timer.unref?.();
          listWaiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      if (!listReceived) {
        throw new Error('SmartHQ sent no list of appliances');
      }
      return [...appliances.values()];
    },

    displayName,
    findId,
  };
}

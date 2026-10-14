// -----------------------------------------------------------------------------
// The SmartHQ real-time socket (GE's "pseudo-MQTT" WebSocket), as gehomesdk
// (clients/websocket_client.py) speaks it:
//
//   → { kind: "websocket#subscribe", action: "subscribe", resources: ["/appliance/*/erd/*"] }
//   → { kind: "websocket#api", action: "api", method: "GET", path: "/v1/appliance", id: "List-appliances" }
//   → { ... method: "GET", path: "/v1/appliance/<mac>/erd", id: "<mac>-allErd" }
//   → { ... method: "POST", path: "/v1/appliance/<mac>/erd/<code>", id: "<mac>-setErd-<code>", body }
//   → { kind: "websocket#ping", id: "keepalive-ping", action: "ping" }    every 30 s
//   ← { kind: "publish#erd", item: { applianceId, erd, value } }         a value changed
//   ← { kind: "websocket#api", id, success, code, body }                 an answer
//
// Node 22 ships a WebSocket client (no dependency); the tests give a fake one.
// The address carries a credential: it never reaches a log line.
// -----------------------------------------------------------------------------

import { API_HOST, PING_INTERVAL_MS } from './constants.js';
import { normalizeCode, wireCode } from '../erd.js';

export const LIST_ID = 'List-appliances';
const SET_ERD = 'setErd';
const ALL_ERD = 'allErd';

/** The socket said the access token expired (a new one, then reconnect). */
export class SocketAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SocketAuthError';
  }
}

/** A command the appliance or the cloud refused. */
export class CommandRefusedError extends Error {
  constructor(message, { code = 0 } = {}) {
    super(message);
    this.name = 'CommandRefusedError';
    this.code = code;
  }
}

const mac = (value) => String(value ?? '').toUpperCase();

/**
 * Open the socket. Resolves once it is open and subscribed.
 * @param {object} options
 * @param {string} options.endpoint wss:// address (secret)
 * @param {string} options.userId
 * @param {typeof WebSocket} [options.WebSocket]
 * @param {object} options.on callbacks:
 *   appliances(items), erds(mac, { code: value }), erd(mac, code, value),
 *   authExpired(), closed(reason)
 * @param {number} [options.pingMs]
 * @param {number} [options.commandTimeoutMs]
 * @param {number} [options.openTimeoutMs]
 * @param {object} [options.logger]
 */
export function openSocket({
  endpoint,
  userId,
  WebSocket: WebSocketImpl = globalThis.WebSocket,
  on,
  pingMs = PING_INTERVAL_MS,
  commandTimeoutMs = 15_000,
  openTimeoutMs = 20_000,
  logger,
}) {
  if (typeof WebSocketImpl !== 'function') {
    return Promise.reject(new Error('no WebSocket client in this Node.js version'));
  }
  /** id → { resolve, reject, timer } of the commands awaiting their answer */
  const commands = new Map();
  let ping = null;
  let closed = false;
  let opened = false;

  const ws = new WebSocketImpl(endpoint);

  function send(message) {
    if (ws.readyState !== 1) {
      throw new Error('SmartHQ socket not open');
    }
    ws.send(JSON.stringify(message));
  }

  const api = (method, path, id, body) => ({
    kind: 'websocket#api',
    action: 'api',
    host: API_HOST,
    method,
    path,
    id,
    ...(body ? { body } : {}),
  });

  function finish(reason) {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(ping);
    for (const { reject, timer } of commands.values()) {
      clearTimeout(timer);
      reject(new Error('SmartHQ socket closed'));
    }
    commands.clear();
    if (opened) {
      on.closed?.(reason);
    }
  }

  function handle(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
    } catch {
      logger?.debug('SmartHQ socket: unreadable message ignored');
      return;
    }
    const kind = String(message?.kind ?? '').toLowerCase();
    const id = typeof message?.id === 'string' ? message.id : '';
    const failed =
      message?.success === false || (message?.code !== undefined && Number(message.code) !== 200);
    if (failed) {
      const code = Number(message.code) || 0;
      const reason = typeof message.reason === 'string' ? message.reason : '';
      if (code === 401 || code === 403 || /token expired/i.test(reason)) {
        on.authExpired?.();
        return;
      }
      const pendingCommand = commands.get(id);
      if (pendingCommand) {
        commands.delete(id);
        clearTimeout(pendingCommand.timer);
        pendingCommand.reject(
          new CommandRefusedError(`refused by SmartHQ (${code || reason || 'error'})`, { code }),
        );
        return;
      }
      logger?.debug(`SmartHQ socket: request ${id || kind} failed (${code || reason})`);
      return;
    }
    if (kind === 'publish#erd') {
      const item = message.item ?? {};
      const code = normalizeCode(item.erd);
      if (item.applianceId && code && typeof item.value === 'string') {
        on.erd?.(mac(item.applianceId), code, item.value);
      }
      return;
    }
    if (kind !== 'websocket#api') {
      return;
    }
    const body = message.body ?? {};
    if (id === LIST_ID) {
      on.appliances?.(Array.isArray(body.items) ? body.items : []);
    } else if (id.endsWith(`-${ALL_ERD}`)) {
      const values = {};
      for (const item of Array.isArray(body.items) ? body.items : []) {
        const code = normalizeCode(item?.erd);
        if (code && typeof item.value === 'string') {
          values[code] = item.value;
        }
      }
      on.erds?.(mac(body.applianceId ?? id.slice(0, -ALL_ERD.length - 1)), values);
    } else if (commands.has(id)) {
      const { resolve, timer } = commands.get(id);
      commands.delete(id);
      clearTimeout(timer);
      resolve();
    }
  }

  const socket = {
    /** Ask for the list of appliances (answer through on.appliances). */
    requestList() {
      send(api('GET', '/v1/appliance', LIST_ID));
    },

    /** Ask for every ERD of one appliance (answer through on.erds). */
    requestAll(applianceId) {
      send(api('GET', `/v1/appliance/${mac(applianceId)}/erd`, `${mac(applianceId)}-${ALL_ERD}`));
    },

    /**
     * Write one ERD. Resolves when SmartHQ acknowledges it.
     * @param {string} applianceId
     * @param {string} code "0x1005"
     * @param {string} value hex
     */
    setErd(applianceId, code, value) {
      const wire = wireCode(code);
      const id = `${mac(applianceId)}-${SET_ERD}-${wire}`;
      return new Promise((resolve, reject) => {
        const previous = commands.get(id);
        if (previous) {
          clearTimeout(previous.timer);
          previous.reject(new CommandRefusedError('replaced by a newer command'));
        }
        const timer = setTimeout(() => {
          commands.delete(id);
          reject(new CommandRefusedError('no answer from SmartHQ'));
        }, commandTimeoutMs);
        timer.unref?.();
        commands.set(id, { resolve, reject, timer });
        try {
          send(
            api('POST', `/v1/appliance/${mac(applianceId)}/erd/${wire}`, id, {
              kind: 'appliance#erdListEntry',
              userId,
              applianceId: mac(applianceId),
              erd: wire,
              value,
              ackTimeout: 10,
              delay: 0,
            }),
          );
        } catch (err) {
          clearTimeout(timer);
          commands.delete(id);
          reject(err);
        }
      });
    },

    get open() {
      return !closed && ws.readyState === 1;
    },

    close() {
      if (!closed) {
        try {
          ws.close();
        } catch {
          // Already closing.
        }
        finish('closed by the integration');
      }
    },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('SmartHQ socket did not open'));
      socket.close();
    }, openTimeoutMs);
    timer.unref?.();
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      opened = true;
      try {
        send({
          kind: 'websocket#subscribe',
          action: 'subscribe',
          resources: ['/appliance/*/erd/*'],
        });
      } catch (err) {
        reject(err);
        return;
      }
      ping = setInterval(() => {
        try {
          send({ kind: 'websocket#ping', id: 'keepalive-ping', action: 'ping' });
        } catch {
          // The close event follows.
        }
      }, pingMs);
      ping.unref?.();
      resolve(socket);
    });
    ws.addEventListener('message', (event) => handle(event.data));
    ws.addEventListener('error', () => {
      if (!opened) {
        clearTimeout(timer);
        reject(new Error('SmartHQ socket refused the connection'));
      }
    });
    ws.addEventListener('close', (event) => {
      clearTimeout(timer);
      if (!opened) {
        reject(new Error(`SmartHQ socket closed before opening (${event?.code ?? '?'})`));
      }
      finish(`closed by SmartHQ (${event?.code ?? '?'})`);
    });
  });
}

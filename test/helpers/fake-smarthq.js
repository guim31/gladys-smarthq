// -----------------------------------------------------------------------------
// A fake SmartHQ, in memory: the sign-in pages and the token service (a
// `fetch`), and the real-time socket (a `WebSocket` class), serving the
// appliances of test/fixtures/smarthq/. It behaves like gehomesdk describes
// the real service: HTML forms with a CSRF token and cookies, redirects
// carrying the authorization code, single-use refresh tokens, and the
// "pseudo-MQTT" messages of the socket.
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs';
import {
  API_URL,
  LOGIN_URL,
  MFA_OPTIONS_PATH,
  OAUTH2_CLIENT_ID,
  OAUTH2_CLIENT_SECRET,
  OAUTH2_REDIRECT_URI,
} from '../../src/ge/constants.js';
import { normalizeCode } from '../../src/erd.js';

export const USERNAME = 'jane.doe@example.com';
export const PASSWORD = 'S3cret-p4ssw0rd!';
export const WS_SECRET = 'ws-secret-0123456789';

const dir = new URL('../fixtures/smarthq/', import.meta.url);
export const FIXTURE_NAMES = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -5))
  .sort();
/** Supported appliances: every fixture but the toaster oven. */
export const SUPPORTED_NAMES = FIXTURE_NAMES.filter((name) => name !== 'toaster_oven');

export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
}

export const idOf = (name) => loadFixture(name).applianceId;

const html = (body, { status = 200, cookies = [] } = {}) =>
  new Response(`<!doctype html><html><body>${body}</body></html>`, {
    status,
    headers: [['content-type', 'text/html'], ...cookies.map((cookie) => ['set-cookie', cookie])],
  });
const redirect = (location, { cookies = [] } = {}) =>
  new Response(null, {
    status: 302,
    headers: [['location', location], ...cookies.map((cookie) => ['set-cookie', cookie])],
  });
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * @param {object} [options]
 * @param {string[]} [options.appliances] fixture names served (all by default)
 * @param {boolean} [options.mfa] the account asks for a verification code
 * @param {boolean} [options.terms] the account must accept new terms first
 * @param {boolean} [options.authorizePage] the "authorize this app" page shows once
 * @param {boolean} [options.down] every request fails (network)
 * @param {number} [options.expiresIn] lifetime of the access tokens, in seconds
 */
export function createFakeSmartHq(options = {}) {
  const fake = {
    password: PASSWORD,
    mfa: Boolean(options.mfa),
    terms: Boolean(options.terms),
    authorizePage: Boolean(options.authorizePage),
    down: Boolean(options.down),
    /** Appliances by MAC: { applianceId, nickname, online, erds } */
    appliances: new Map(),
    accessTokens: new Set(),
    refreshTokens: new Set(),
    codes: new Set(),
    sentCodes: [],
    mfaCode: '123456',
    signIns: 0,
    failedSignIns: 0,
    refreshes: 0,
    sockets: [],
    /** Messages received by the socket, parsed. */
    received: [],
    /** ERD writes received: { applianceId, erd, value } */
    writes: [],
    /** setErd refused with this code (e.g. 400), once per entry. */
    refuseWrites: [],
    requests: [],
    counter: 0,
    sessions: new Map(),
  };
  for (const name of options.appliances ?? FIXTURE_NAMES) {
    const fixture = loadFixture(name);
    const erds = {};
    for (const [code, value] of Object.entries(fixture.erds)) {
      erds[normalizeCode(code)] = value;
    }
    fake.appliances.set(fixture.applianceId, { ...fixture, erds });
  }

  const next = (prefix) => `${prefix}-${++fake.counter}`;

  function issueTokens() {
    const access = next('access');
    const refresh = next('refresh');
    fake.accessTokens.add(access);
    fake.refreshTokens.add(refresh);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: options.expiresIn ?? 3600,
    };
  }

  function session(request) {
    const cookie = request.headers.get('cookie') ?? '';
    const match = cookie.match(/SESSION=([^;]+)/);
    return match ? fake.sessions.get(match[1]) : undefined;
  }

  function codeRedirect() {
    const code = next('code');
    fake.codes.add(code);
    return redirect(`${OAUTH2_REDIRECT_URI}?code=${code}&state=x`);
  }

  async function login(request, url) {
    const path = url.pathname;
    const form = request.method === 'POST' ? new URLSearchParams(await request.text()) : null;
    if (path === '/oauth2/auth' && request.method === 'GET') {
      if (url.searchParams.get('client_id') !== OAUTH2_CLIENT_ID) {
        return html('bad client', { status: 400 });
      }
      const id = next('sess');
      fake.sessions.set(id, {
        csrf: next('csrf'),
        region: /abgea_region=([\w-]+)/.exec(request.headers.get('cookie') ?? '')?.[1],
      });
      const csrf = fake.sessions.get(id).csrf;
      return html(
        `<form id="frmsignin" action="/oauth2/g_authenticate" method="post">
          <input type="hidden" name="_csrf" value="${csrf}">
          <input type="hidden" name="client_id" value="${OAUTH2_CLIENT_ID}">
          <input type="text" name="username"><input type="password" name="password">
        </form>`,
        { cookies: [`SESSION=${id}; Path=/; HttpOnly`] },
      );
    }
    if (path === '/oauth2/token') {
      const basic = `Basic ${Buffer.from(`${OAUTH2_CLIENT_ID}:${OAUTH2_CLIENT_SECRET}`).toString('base64')}`;
      if (request.headers.get('authorization') !== basic) {
        return json({ error: 'invalid_client' }, 401);
      }
      if (form.get('grant_type') === 'authorization_code') {
        if (!fake.codes.delete(form.get('code'))) {
          return json({ error: 'invalid_grant' }, 400);
        }
        return json(issueTokens());
      }
      if (form.get('grant_type') === 'refresh_token') {
        fake.refreshes += 1;
        if (!fake.refreshTokens.delete(form.get('refresh_token'))) {
          return json({ error: 'invalid_grant' }, 400);
        }
        return json(issueTokens());
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    const current = session(request);
    if (!current) {
      return html('session expired', { status: 403 });
    }
    if (path === '/oauth2/g_authenticate') {
      if (form.get('_csrf') !== current.csrf) {
        return html('csrf', { status: 403 });
      }
      fake.signIns += 1;
      if (form.get('username') !== USERNAME || form.get('password') !== fake.password) {
        fake.failedSignIns += 1;
        return html(
          `<div id="alert_pane" class="alert">Invalid username &amp; password.</div>
           <form id="frmsignin"><input type="hidden" name="_csrf" value="${current.csrf}"></form>`,
        );
      }
      if (fake.terms) {
        return html(`<form action="/oauth2/terms/accept"><input name="developerTerms"></form>`);
      }
      if (fake.mfa) {
        current.mfa = true;
        return html(
          `<form id="verifyOptionForm" action="${MFA_OPTIONS_PATH}">
            <input type="hidden" name="_csrf" value="${current.csrf}">
            <button name="email_btn" value="email">E-mail</button>
            <button name="sms_btn" value="sms">Text</button>
          </form>`,
        );
      }
      if (fake.authorizePage) {
        fake.authorizePage = false;
        return redirect('/oauth2/authorize-page');
      }
      return codeRedirect();
    }
    if (path === '/oauth2/authorize-page') {
      return html(
        `<form id="frmsignin" action="/oauth2/code"><input type="hidden" name="authorized" value="">
         <input type="hidden" name="_csrf" value="${current.csrf}"></form>`,
      );
    }
    if (path === '/oauth2/code') {
      return form.get('authorized') === 'yes' ? codeRedirect() : html('denied', { status: 403 });
    }
    if (path === '/account/active/security/verify/sendtotp') {
      if (!current.mfa || form.get('_csrf') !== current.csrf) {
        return html('no', { status: 403 });
      }
      current.csrf = next('csrf');
      return html(`<input type="hidden" name="_csrf" value="${current.csrf}">`);
    }
    if (path === '/account/active/security/verify/sendtotp/process') {
      if (!current.mfa || form.get('_csrf') !== current.csrf) {
        return html('no', { status: 403 });
      }
      fake.sentCodes.push(form.get('mfaType'));
      current.csrf = next('csrf');
      return html(`<meta name="_csrf" content="${current.csrf}">`);
    }
    if (path === '/account/active/security/verify/totpcode/process') {
      if (form.get('_csrf') !== current.csrf) {
        return html('no', { status: 403 });
      }
      if (form.get('totpCode') !== fake.mfaCode) {
        current.csrf = next('csrf');
        return html(`<input type="hidden" name="_csrf" value="${current.csrf}"> wrong code`);
      }
      return codeRedirect();
    }
    return html('not found', { status: 404 });
  }

  fake.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    fake.requests.push(`${request.method} ${url.origin}${url.pathname}`);
    if (fake.down) {
      throw new TypeError('fetch failed');
    }
    if (request.url.startsWith(LOGIN_URL)) {
      return login(request, url);
    }
    if (request.url === `${API_URL}/v1/websocket`) {
      const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
      if (!fake.accessTokens.has(token)) {
        return json({ error: 'unauthorized' }, 401);
      }
      return json({
        kind: 'websocket#endpoint',
        userId: 'user-0001',
        endpoint: `wss://ws.example.invalid/socket?access_token=${WS_SECRET}-${token}`,
      });
    }
    return json({ error: 'not found' }, 404);
  };

  /** Send a message to every open socket. */
  fake.broadcast = (message) => {
    for (const socket of fake.sockets.filter((s) => s.readyState === 1)) {
      socket.deliver(message);
    }
  };

  /** An ERD of an appliance changes, pushed as `publish#erd`. */
  fake.change = (applianceId, code, value) => {
    const appliance = fake.appliances.get(applianceId);
    appliance.erds[normalizeCode(code)] = value;
    fake.broadcast({
      kind: 'publish#erd',
      userId: 'user-0001',
      item: {
        applianceId: applianceId.toLowerCase(),
        erd: code,
        time: new Date().toISOString(),
        value,
      },
      resource: `/appliance/${applianceId}/erd/${code}`,
    });
  };

  /** An ERD changes on the appliance, silently (only a full read sees it). */
  fake.setQuietly = (applianceId, code, value) => {
    fake.appliances.get(applianceId).erds[normalizeCode(code)] = value;
  };

  /** Close every socket from the server side. */
  fake.dropSockets = (code = 1006) => {
    for (const socket of fake.sockets.filter((s) => s.readyState === 1)) {
      socket.serverClose(code);
    }
  };

  function answer(socket, message) {
    if (
      message.kind === 'websocket#api' &&
      message.method === 'GET' &&
      message.path === '/v1/appliance'
    ) {
      socket.deliver({
        kind: 'websocket#api',
        id: message.id,
        success: true,
        code: 200,
        body: {
          kind: 'appliance#applianceList',
          userId: 'user-0001',
          items: [...fake.appliances.values()].map((appliance) => ({
            applianceId: appliance.applianceId,
            type: appliance.type ?? 'Unknown',
            brand: 'GE',
            jid: `${appliance.applianceId.toLowerCase()}_user-0001`,
            nickname: appliance.nickname,
            online: appliance.online,
          })),
        },
      });
      return;
    }
    const all = /^\/v1\/appliance\/([0-9A-F]+)\/erd$/.exec(message.path ?? '');
    if (message.kind === 'websocket#api' && message.method === 'GET' && all) {
      const appliance = fake.appliances.get(all[1]);
      socket.deliver({
        kind: 'websocket#api',
        id: message.id,
        success: true,
        code: 200,
        body: {
          kind: 'appliance#erdList',
          userId: 'user-0001',
          applianceId: all[1],
          items: Object.entries(appliance?.erds ?? {}).map(([erd, value]) => ({
            erd: erd.toUpperCase().replace('0X', '0x'),
            time: '2026-10-14T08:00:00Z',
            value,
          })),
        },
      });
      return;
    }
    const set = /^\/v1\/appliance\/([0-9A-F]+)\/erd\/(0x[0-9A-F]{4})$/.exec(message.path ?? '');
    if (message.kind === 'websocket#api' && message.method === 'POST' && set) {
      fake.writes.push({
        applianceId: set[1],
        erd: set[2],
        value: message.body?.value,
        userId: message.body?.userId,
      });
      const refusal = fake.refuseWrites.shift();
      if (refusal) {
        socket.deliver({
          kind: 'websocket#api',
          id: message.id,
          success: false,
          code: refusal,
          reason: 'Bad Request',
        });
        return;
      }
      socket.deliver({ kind: 'websocket#api', id: message.id, success: true, code: 200, body: {} });
      setTimeout(() => fake.change(set[1], set[2], message.body.value), 1);
    }
  }

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = {};
      fake.sockets.push(this);
      setTimeout(() => {
        const token = new URL(url).searchParams.get('access_token') ?? '';
        if (
          !token.startsWith(WS_SECRET) ||
          !fake.accessTokens.has(token.slice(WS_SECRET.length + 1))
        ) {
          this.readyState = 3;
          this.emit('error', {});
          this.emit('close', { code: 1008 });
          return;
        }
        this.readyState = 1;
        this.emit('open', {});
      }, 1);
    }
    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }
    emit(type, event) {
      for (const listener of this.listeners[type] ?? []) {
        listener(event);
      }
    }
    send(data) {
      if (this.readyState !== 1) {
        throw new Error('not open');
      }
      const message = JSON.parse(data);
      fake.received.push(message);
      setTimeout(() => this.readyState === 1 && answer(this, message), 1);
    }
    deliver(message) {
      if (this.readyState === 1) {
        this.emit('message', { data: JSON.stringify(message) });
      }
    }
    serverClose(code) {
      this.readyState = 3;
      this.emit('close', { code });
    }
    close() {
      if (this.readyState === 3) {
        return;
      }
      this.readyState = 3;
      setTimeout(() => this.emit('close', { code: 1000 }), 0);
    }
  }
  fake.WebSocket = FakeWebSocket;
  return fake;
}

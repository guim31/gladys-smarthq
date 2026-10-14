// -----------------------------------------------------------------------------
// The SmartHQ account: tokens and the WebSocket address.
//
// An access token is obtained, in order of preference:
//   1. from the refresh token kept in /data (no password, no code);
//   2. by signing in with the e-mail and password of the configuration.
// A refused password is never tried again until the configuration changes:
// repeated wrong attempts could lock the account. An account that asks for a
// verification code waits for the user (configuration actions "Send the
// code", then "Enter the code"), and never receives a code they did not ask
// for.
//
// The WebSocket address (GET /v1/websocket) embeds a credential: it is used,
// never logged.
// -----------------------------------------------------------------------------

import { API_URL } from './constants.js';
import {
  AuthError,
  MfaRequiredError,
  ServerError,
  TermsRequiredError,
  createLoginSession,
  refreshTokens,
} from './login.js';
import { accountSeed, fingerprint } from './token-store.js';

export { AuthError, MfaRequiredError, ServerError, TermsRequiredError };

/** The password was refused earlier: nothing is tried until the configuration changes. */
export class CredentialsRefusedError extends AuthError {
  constructor(reason) {
    super(reason);
    this.name = 'CredentialsRefusedError';
  }
}

/** A verification is pending: it expires on GE's side after a while. */
const MFA_SESSION_MS = 15 * 60 * 1000;
/** An access token is renewed this long before it expires. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

/**
 * @param {object} options
 * @param {() => object} options.getConfig normalized config
 * @param {ReturnType<import('./token-store.js').createTokenStore>} options.store
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 */
export function createSmartHqClient({
  getConfig,
  store,
  fetch = globalThis.fetch,
  now = Date.now,
}) {
  let accessToken = null;
  let expiresAt = 0;
  /** Signature (fingerprint) of the credentials SmartHQ refused, and why. */
  let refused = null;
  /** A sign-in stopped at the verification code: { session, methods, signature, at }. */
  let pending = null;
  let tokenRequest = null;

  const signature = (config) =>
    fingerprint(`${config.username.trim().toLowerCase()}|${config.password}|${config.region}`);

  async function accept(tokens) {
    accessToken = tokens.access_token;
    const seconds = Number(tokens.expires_in);
    expiresAt = now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000;
    if (typeof tokens.refresh_token === 'string' && tokens.refresh_token !== '') {
      await store.save(accountSeed(getConfig()), tokens.refresh_token);
    }
  }

  async function signIn() {
    const config = getConfig();
    const sig = signature(config);
    if (refused?.signature === sig) {
      throw new CredentialsRefusedError(refused.reason);
    }
    const session = createLoginSession({ fetch, region: config.region });
    try {
      await accept(await session.signIn(config.username, config.password));
      pending = null;
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        pending = { session, methods: err.methods, signature: sig, at: now() };
      } else if (err instanceof AuthError) {
        refused = { signature: sig, reason: err.message };
      }
      throw err;
    }
  }

  async function obtainToken() {
    const seed = accountSeed(getConfig());
    const stored = await store.refreshToken(seed);
    if (stored) {
      try {
        await accept(await refreshTokens(fetch, stored));
        return;
      } catch (err) {
        if (!(err instanceof AuthError)) {
          throw err;
        }
        // Revoked or expired: back to the password.
        await store.clear();
      }
    }
    await signIn();
  }

  /** A valid access token (one request at a time). */
  async function token() {
    if (accessToken && now() < expiresAt - EXPIRY_MARGIN_MS) {
      return accessToken;
    }
    tokenRequest ??= obtainToken().finally(() => {
      tokenRequest = null;
    });
    await tokenRequest;
    return accessToken;
  }

  async function apiGet(path) {
    const bearer = await token();
    let response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ServerError(`network (${err.message})`);
    }
    if (response.status === 401 || response.status === 403) {
      accessToken = null;
      throw new AuthError(`SmartHQ refused the access token (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new ServerError(`SmartHQ answered HTTP ${response.status}`, {
        status: response.status,
      });
    }
    try {
      return await response.json();
    } catch {
      throw new ServerError('SmartHQ sent no JSON');
    }
  }

  return {
    /**
     * The address of the real-time socket and the account id.
     * @returns {Promise<{ endpoint: string, userId: string }>}
     */
    async websocketCredentials() {
      let answer;
      try {
        answer = await apiGet('/v1/websocket');
      } catch (err) {
        if (!(err instanceof AuthError) || err instanceof CredentialsRefusedError || !err.status) {
          throw err;
        }
        // The access token was refused: once more with a fresh one.
        answer = await apiGet('/v1/websocket');
      }
      if (typeof answer?.endpoint !== 'string' || !/^wss?:\/\//.test(answer.endpoint)) {
        throw new ServerError('SmartHQ sent no WebSocket address');
      }
      return { endpoint: answer.endpoint, userId: String(answer.userId ?? '') };
    },

    /** Forget the access token (the socket said it expired). */
    invalidate() {
      accessToken = null;
      expiresAt = 0;
    },

    /** New credentials in the configuration: everything starts again. */
    reset() {
      accessToken = null;
      expiresAt = 0;
      refused = null;
      pending = null;
    },

    /** Why SmartHQ refused these credentials, or null (never tried, or accepted). */
    get refusedReason() {
      return refused?.signature === signature(getConfig()) ? refused.reason : null;
    },

    /** Whether a verification code is awaited. */
    get awaitingCode() {
      return pending !== null;
    },

    /**
     * Have SmartHQ send a verification code. Resolves the method used
     * ("email", "sms"), or null when the account signed in without one.
     */
    async sendCode() {
      const config = getConfig();
      if (
        !pending ||
        pending.signature !== signature(config) ||
        now() - pending.at > MFA_SESSION_MS
      ) {
        try {
          await signIn();
          return null;
        } catch (err) {
          if (!(err instanceof MfaRequiredError)) {
            throw err;
          }
        }
      }
      const method = pending.methods.includes('email') ? 'email' : pending.methods[0];
      await pending.session.sendCode(method);
      pending.at = now();
      return method;
    },

    /** Complete the sign-in with the code received. */
    async submitCode(code) {
      if (!pending) {
        throw new AuthError('no verification in progress: send the code first');
      }
      const tokens = await pending.session.submitCode(code);
      pending = null;
      await accept(tokens);
    },
  };
}

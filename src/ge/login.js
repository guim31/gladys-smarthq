// -----------------------------------------------------------------------------
// The SmartHQ sign-in: OAuth2 "authorization code" through the HTML pages of
// accounts.brillion.geappliances.com, as gehomesdk (simbaja/gehome, MIT,
// clients/async_login_flows.py and smart_hq_login.py) walks it.
//
//   1. GET /oauth2/auth (region cookie set first) → the sign-in form;
//   2. POST /oauth2/g_authenticate with the form, the e-mail and password;
//   3. follow the redirects by hand (cookies kept) until one carries `code=`,
//      answering the pages met on the way: the "authorize this app" page (yes),
//      the "add a second factor" nudge (skipped, as the SmartHQ app does);
//   4. POST /oauth2/token: the code becomes an access and a refresh token.
//
// Two pages stop the walk: a verification code to type (multi-factor
// authentication, completed by the configuration actions) and new terms of
// use, which the user accepts in the SmartHQ app themselves: the integration
// never accepts terms on their behalf.
//
// No HTML parser dependency: the pages are small and the few fields read here
// are found with tolerant regular expressions.
// -----------------------------------------------------------------------------

import {
  LOGIN_REGIONS,
  LOGIN_REGION_COOKIE,
  LOGIN_URL,
  MFA_OPTIONS_PATH,
  MFA_SENDTOTP_PATH,
  MFA_SENDTOTP_PROCESS_PATH,
  MFA_VERIFY_PATH,
  OAUTH2_CLIENT_ID,
  OAUTH2_CLIENT_SECRET,
  OAUTH2_REDIRECT_URI,
} from './constants.js';

const MAX_REDIRECTS = 10;

/** The account refused the e-mail, the password, a token or a code. */
export class AuthError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** The account asks for a verification code (multi-factor authentication). */
export class MfaRequiredError extends Error {
  constructor(methods) {
    super('SmartHQ asks for a verification code');
    this.name = 'MfaRequiredError';
    this.methods = methods;
  }
}

/** The account must accept new terms of use in the SmartHQ app first. */
export class TermsRequiredError extends Error {
  constructor() {
    super('SmartHQ asks to accept new terms of use');
    this.name = 'TermsRequiredError';
  }
}

/** GE answered 5xx, or an unexpected page: worth trying again later. */
export class ServerError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'ServerError';
    this.status = status;
  }
}

// --- HTML ----------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" };

function decodeEntities(text) {
  return text.replace(/&(#?\w+);/g, (match, name) => {
    if (ENTITIES[name] !== undefined) {
      return ENTITIES[name];
    }
    if (/^#\d+$/.test(name)) {
      return String.fromCodePoint(Number(name.slice(1)));
    }
    if (/^#x[0-9a-f]+$/i.test(name)) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    return match;
  });
}

/** Attributes of one tag: `<input name="a" value='b' disabled>` → { name, value, disabled }. */
export function parseAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const body = tag.replace(/^<\s*\w+/, '').replace(/\/?>$/, '');
  for (const match of body.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** The inputs of a form (by id, or the first form): { name: value }. */
export function formInputs(html, formId) {
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((match) => match[0]);
  const form = formId
    ? forms.find((candidate) => {
        const open = candidate.match(/<form\b[^>]*>/i)[0];
        return parseAttributes(open).id === formId;
      })
    : forms[0];
  if (!form) {
    return null;
  }
  const inputs = {};
  for (const match of form.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (attributes.name) {
      inputs[attributes.name] = attributes.value ?? '';
    }
  }
  return inputs;
}

/** The CSRF token of a page (hidden input, else meta tag). */
export function csrfToken(html) {
  for (const match of html.matchAll(/<(input|meta)\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (attributes.name === '_csrf') {
      const value = match[1].toLowerCase() === 'input' ? attributes.value : attributes.content;
      if (value) {
        return value;
      }
    }
  }
  return null;
}

/** The verification methods offered (buttons named `*_btn`): ["email", "sms"]. */
export function mfaMethods(html) {
  const methods = [];
  for (const match of html.matchAll(/<button\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if ((attributes.name ?? '').endsWith('_btn') && attributes.value) {
      methods.push(attributes.value);
    }
  }
  return methods;
}

/** The error shown by the sign-in page ("Invalid username or password"), or null. */
export function alertText(html) {
  const match = html.match(/<div\b[^>]*\bid\s*=\s*["']alert_pane["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!match) {
    return null;
  }
  const text = decodeEntities(match[1].replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? null : text.slice(0, 160);
}

// --- HTTP with cookies -----------------------------------------------------------

/** The cookies of the sign-in site, kept between the pages of one login. */
export function createCookieJar() {
  const cookies = new Map();
  return {
    set(name, value) {
      cookies.set(name, value);
    },
    take(headers) {
      const list =
        typeof headers.getSetCookie === 'function'
          ? headers.getSetCookie()
          : [headers.get('set-cookie')].filter(Boolean);
      for (const line of list) {
        const [pair] = String(line).split(';');
        const index = pair.indexOf('=');
        if (index > 0) {
          cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
      }
    },
    header() {
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    },
  };
}

const form = (data) => new URLSearchParams(data).toString();
const basicAuth = () =>
  `Basic ${Buffer.from(`${OAUTH2_CLIENT_ID}:${OAUTH2_CLIENT_SECRET}`).toString('base64')}`;

/** The `code` of a redirect location, or null. */
function codeOf(location) {
  try {
    return new URL(location, LOGIN_URL).searchParams.get('code');
  } catch {
    return null;
  }
}

/**
 * One login attempt: a cookie jar and the pages walked with it. Kept alive
 * between the steps of a verification code.
 * @param {object} options
 * @param {typeof fetch} options.fetch
 * @param {string} [options.region] "US" or "EU"
 */
export function createLoginSession({ fetch, region = 'US' }) {
  const jar = createCookieJar();
  jar.set(LOGIN_REGION_COOKIE, LOGIN_REGIONS[region] ?? LOGIN_REGIONS.US);
  let csrf = null;
  let mfaMethod = 'email';

  async function request(url, { method = 'GET', body, headers = {} } = {}) {
    let response;
    try {
      response = await fetch(new URL(url, LOGIN_URL).toString(), {
        method,
        redirect: 'manual',
        headers: {
          cookie: jar.header(),
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ServerError(`network (${err.message})`);
    }
    jar.take(response.headers);
    return response;
  }

  function checkStatus(response) {
    if (response.status >= 500) {
      throw new ServerError(`SmartHQ sign-in answered HTTP ${response.status}`, {
        status: response.status,
      });
    }
    if (response.status >= 400) {
      throw new AuthError(`SmartHQ sign-in refused (HTTP ${response.status})`, {
        status: response.status,
      });
    }
  }

  /** Follow a response to the authorization code. */
  async function follow(response, depth = 0) {
    if (depth > MAX_REDIRECTS) {
      throw new ServerError('too many redirects during the SmartHQ sign-in');
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') ?? '';
      const code = codeOf(location);
      if (code) {
        return code;
      }
      if (location === '') {
        throw new ServerError('SmartHQ sign-in redirect without a location');
      }
      return follow(await request(location), depth + 1);
    }
    checkStatus(response);
    if (response.status !== 200) {
      throw new ServerError(`unexpected SmartHQ sign-in answer (HTTP ${response.status})`);
    }
    return answerPage(await response.text(), depth);
  }

  /** A page met on the way: answer it, or stop with the reason. */
  async function answerPage(html, depth) {
    if (html.includes(MFA_OPTIONS_PATH) || html.includes('verifyOptionForm')) {
      csrf = csrfToken(html);
      const methods = mfaMethods(html);
      throw new MfaRequiredError(methods.length > 0 ? methods : ['email']);
    }
    if (
      html.includes('addMfaForm') ||
      html.includes('/account/active/security/add/mfamethod') ||
      html.includes('Multi-Factor Authentication')
    ) {
      // The nudge to add a second factor: skipped, as the SmartHQ app allows.
      const inputs = formInputs(html, 'addMfaForm');
      if (!inputs) {
        throw new AuthError('SmartHQ asks to set up multi-factor authentication first');
      }
      return follow(
        await request('/account/active/redirect', { method: 'POST', body: form(inputs) }),
        depth + 1,
      );
    }
    if (html.includes('/oauth2/terms/accept')) {
      throw new TermsRequiredError();
    }
    const signin = formInputs(html, 'frmsignin');
    if (signin && 'authorized' in signin) {
      // "Allow this application to access your appliances?": the user installed
      // the integration for that.
      return follow(
        await request('/oauth2/code', {
          method: 'POST',
          body: form({ ...signin, authorized: 'yes' }),
        }),
        depth + 1,
      );
    }
    const reason = alertText(html);
    if (reason) {
      throw new AuthError(`SmartHQ refused the sign-in: ${reason}`);
    }
    throw new AuthError('SmartHQ refused the sign-in (unknown page)');
  }

  async function exchange(code) {
    return tokenRequest(fetch, {
      code,
      client_id: OAUTH2_CLIENT_ID,
      client_secret: OAUTH2_CLIENT_SECRET,
      redirect_uri: OAUTH2_REDIRECT_URI,
      grant_type: 'authorization_code',
    });
  }

  return {
    /**
     * Sign in with the e-mail and the password. Resolves the tokens, or
     * throws MfaRequiredError (then sendCode and submitCode), AuthError,
     * TermsRequiredError or ServerError.
     */
    async signIn(username, password) {
      const query = new URLSearchParams({
        client_id: OAUTH2_CLIENT_ID,
        response_type: 'code',
        access_type: 'offline',
        redirect_uri: OAUTH2_REDIRECT_URI,
      });
      let page = await request(`/oauth2/auth?${query}`);
      for (let hop = 0; page.status >= 300 && page.status < 400 && hop < MAX_REDIRECTS; hop++) {
        page = await request(page.headers.get('location') ?? '/');
      }
      checkStatus(page);
      const html = page.status === 200 ? await page.text() : '';
      const inputs = formInputs(html, 'frmsignin') ?? {};
      const response = await request('/oauth2/g_authenticate', {
        method: 'POST',
        body: form({ ...inputs, username: username.trim(), password }),
      });
      checkStatus(response);
      return exchange(await follow(response));
    },

    /** Have SmartHQ send the verification code (e-mail or text message). */
    async sendCode(method = 'email') {
      if (!csrf) {
        throw new AuthError('no verification in progress: sign in first');
      }
      mfaMethod = method;
      for (const path of [MFA_SENDTOTP_PATH, MFA_SENDTOTP_PROCESS_PATH]) {
        const response = await request(path, {
          method: 'POST',
          body: form({ mfaType: method, _csrf: csrf }),
        });
        checkStatus(response);
        if (response.status === 200) {
          csrf = csrfToken(await response.text()) ?? csrf;
        }
      }
    },

    /** Type the verification code: resolves the tokens. */
    async submitCode(code) {
      if (!csrf) {
        throw new AuthError('no verification in progress: sign in first');
      }
      const response = await request(MFA_VERIFY_PATH, {
        method: 'POST',
        body: form({ mfaType: mfaMethod, totpCode: String(code).trim(), _csrf: csrf }),
      });
      if (response.status === 200) {
        // A wrong or expired code shows the page again.
        csrf = csrfToken(await response.text()) ?? csrf;
        throw new AuthError('invalid or expired verification code');
      }
      checkStatus(response);
      return exchange(await follow(response));
    },
  };
}

/** POST /oauth2/token: { access_token, refresh_token, expires_in }. */
async function tokenRequest(fetch, data) {
  let response;
  try {
    response = await fetch(`${LOGIN_URL}/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: basicAuth(),
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: form(data),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ServerError(`network (${err.message})`);
  }
  if (response.status >= 500) {
    throw new ServerError(`SmartHQ token service answered HTTP ${response.status}`, {
      status: response.status,
    });
  }
  if (response.status >= 400) {
    throw new AuthError(`SmartHQ refused the token (HTTP ${response.status})`, {
      status: response.status,
    });
  }
  let token;
  try {
    token = await response.json();
  } catch {
    throw new ServerError('SmartHQ token service sent no JSON');
  }
  if (typeof token?.access_token !== 'string' || token.access_token === '') {
    throw new AuthError('SmartHQ sent no access token');
  }
  return token;
}

/** Renew the tokens with a refresh token (no password, no verification code). */
export function refreshTokens(fetch, refreshToken) {
  return tokenRequest(fetch, {
    redirect_uri: OAUTH2_REDIRECT_URI,
    client_id: OAUTH2_CLIENT_ID,
    client_secret: OAUTH2_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

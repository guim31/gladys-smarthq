// -----------------------------------------------------------------------------
// SmartHQ (GE Appliances "Brillion" cloud): endpoints, OAuth2 client, timings.
//
// The values come from gehomesdk (simbaja/gehome, MIT), the library of the
// Home Assistant integration `ge_home`: the OAuth2 client is the one of the
// SmartHQ Android app, published there in clear. GE documents no public API
// and no quota; the cadence below follows gehomesdk's (ping every 30 s, list
// of appliances every 10 minutes) and stays below it.
// -----------------------------------------------------------------------------

export const LOGIN_URL = 'https://accounts.brillion.geappliances.com';
export const API_URL = 'https://api.brillion.geappliances.com';
/** The host the WebSocket "api" messages are relayed to. */
export const API_HOST = 'api.brillion.geappliances.com';

export const OAUTH2_CLIENT_ID = '564c31616c4f7474434b307435412b4d2f6e7672';
export const OAUTH2_CLIENT_SECRET =
  '6476512b5246446d452f697154444941387052645938466e5671746e5847593d';
export const OAUTH2_REDIRECT_URI =
  'brillion.4e617a766474657344444e562b5935566e51324a://oauth/redirect';

/** The login region is a cookie set before the sign-in page. */
export const LOGIN_REGIONS = { US: 'us-east-1', EU: 'eu-west-1' };
export const LOGIN_REGION_COOKIE = 'abgea_region';

/** The multi-factor verification pages (an emailed or texted code). */
export const MFA_OPTIONS_PATH = '/account/active/security/verify/options';
export const MFA_SENDTOTP_PATH = '/account/active/security/verify/sendtotp';
export const MFA_SENDTOTP_PROCESS_PATH =
  '/account/active/security/verify/sendtotp/process?emailType=MFA_VERIFICATION';
export const MFA_VERIFY_PATH = '/account/active/security/verify/totpcode/process';

/** WebSocket keep-alive, as gehomesdk. */
export const PING_INTERVAL_MS = 30_000;
/** Full read of the account (list + every ERD of every appliance): the safety net and the heartbeat. */
export const FULL_READ_INTERVAL_MS = 10 * 60 * 1000;
/** Reconnection delays after a lost or refused connection: 10 s, doubled, 15 min at most. */
export const RECONNECT_MIN_MS = 10_000;
export const RECONNECT_MAX_MS = 15 * 60 * 1000;
/**
 * A full read that brings no answer this long means a dead socket (GE does not
 * document whether it answers the pings: an unanswered read is the sure sign).
 */
export const RESPONSE_TIMEOUT_MS = 60_000;

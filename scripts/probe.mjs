#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe the real SmartHQ cloud with the integration's own client, read only,
// from a machine that has the network. Prints what the integration would make
// of the account, never a password, a token, the WebSocket address or a full
// MAC address.
//
// 1. Without credentials: a sign-in with a fake account. Expected: a clean
//    refusal ("SmartHQ refused the sign-in"), no crash.
//      node scripts/probe.mjs
// 2. With a real account (read only: no ERD is ever written):
//      SMARTHQ_USERNAME=… SMARTHQ_PASSWORD=… node scripts/probe.mjs
//    signs in, opens the socket, lists the appliances, builds their Gladys
//    devices and states, then listens to the live changes for 60 s.
//    Add `--dump` to print every ERD received (serial and model numbers
//    masked): the shape of test/fixtures/smarthq/, to replace the fixtures
//    built by hand with real answers.
//    SMARTHQ_REGION=EU for a European account. An account that asks for a
//    verification code: SMARTHQ_CODE=… after a first run that sent it.
//
// The refresh token obtained is kept in ./probe-data/smarthq-auth.json (mode
// 600) so a second run needs no code. DATA_DIR overrides ./probe-data.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDevice, familyOf, stateValues } from '../src/appliances.js';
import { normalizeConfig } from '../src/config.js';
import { ERD } from '../src/erd.js';
import { MfaRequiredError, createSmartHqClient } from '../src/ge/client.js';
import { openSocket } from '../src/ge/socket.js';
import { createTokenStore } from '../src/ge/token-store.js';

const real = Boolean(process.env.SMARTHQ_USERNAME && process.env.SMARTHQ_PASSWORD);
const dump = process.argv.includes('--dump');
const config = normalizeConfig({
  username: process.env.SMARTHQ_USERNAME ?? 'probe.fake.account@example.com',
  password: process.env.SMARTHQ_PASSWORD ?? 'probe-fake-password',
  region: process.env.SMARTHQ_REGION ?? 'US',
  language: process.env.SMARTHQ_LANGUAGE ?? 'fr',
  temperature_unit: process.env.SMARTHQ_UNIT ?? 'celsius',
});
const store = createTokenStore({ dir: process.env.DATA_DIR ?? './probe-data' });
const client = createSmartHqClient({ getConfig: () => config, store });
const mask = (mac) => `${String(mac).slice(0, 6)}…${String(mac).slice(-2)}`;

async function credentials() {
  try {
    return await client.websocketCredentials();
  } catch (err) {
    if (!(err instanceof MfaRequiredError)) {
      throw err;
    }
    if (!process.env.SMARTHQ_CODE) {
      const method = await client.sendCode();
      console.log(`SmartHQ asks for a verification code: sent (${method}).`);
      console.log('Run again within 15 minutes with SMARTHQ_CODE=<the code>.');
      process.exit(3);
    }
    await client.sendCode();
    await client.submitCode(process.env.SMARTHQ_CODE);
    return client.websocketCredentials();
  }
}

if (!real) {
  console.log('No credentials: one sign-in with a fake account.');
  try {
    await client.websocketCredentials();
    console.log('UNEXPECTED: the fake account was accepted.');
    process.exit(1);
  } catch (err) {
    if (/network/.test(err.message)) {
      console.log(`SmartHQ not reached from this machine: ${err.message}`);
      process.exit(2);
    }
    console.log(`Refused as expected: ${err.name}: ${err.message}`);
    process.exit(0);
  }
}

const { endpoint, userId } = await credentials();
console.log(`Signed in; socket address received (user id ${userId ? 'present' : 'absent'}).`);
const appliances = new Map();
const gladys = createFakeGladys();
let listed = null;
const listedPromise = new Promise((resolve) => {
  listed = resolve;
});

const socket = await openSocket({
  endpoint,
  userId,
  on: {
    appliances(items) {
      console.log(`List of appliances: ${items.length}`);
      for (const item of items) {
        const id = String(item.applianceId).toUpperCase();
        appliances.set(id, {
          id,
          nickname: item.nickname ?? '',
          online: item.online !== 'OFFLINE',
          erds: {},
        });
        console.log(`  ${mask(id)} online=${item.online} type=${item.type ?? '?'}`);
        socket.requestAll(id);
      }
      listed();
    },
    erds(id, values) {
      const appliance = appliances.get(id);
      if (!appliance) {
        return;
      }
      appliance.erds = values;
      const family = familyOf(appliance);
      console.log(
        `\n${mask(id)}: ${Object.keys(values).length} ERD(s), family ${family ?? 'not supported'}`,
      );
      if (dump) {
        const masked = { ...values };
        for (const code of [ERD.SERIAL_NUMBER]) {
          if (masked[code]) {
            masked[code] = '…masked…';
          }
        }
        console.log(JSON.stringify(masked, null, 2));
      }
      const options = { language: config.language, unit: config.temperature_unit, now: Date.now() };
      const device = buildDevice(gladys, appliance, options);
      if (device) {
        console.log(`  Gladys device "${device.name}": ${device.features.length} feature(s)`);
        console.log(`  States: ${JSON.stringify(stateValues(appliance, options))}`);
      }
    },
    erd(id, code, value) {
      console.log(`live: ${mask(id)} ${code} = ${code === ERD.SERIAL_NUMBER ? '…' : value}`);
    },
    authExpired() {
      console.log('SmartHQ says the access token expired.');
    },
    closed(reason) {
      console.log(`Socket closed: ${reason}`);
    },
  },
});
socket.requestList();
await Promise.race([listedPromise, new Promise((resolve) => setTimeout(resolve, 20_000))]);
console.log('\nListening to live changes for 60 s (read only)…');
await new Promise((resolve) => setTimeout(resolve, 60_000));
socket.close();
process.exit(0);

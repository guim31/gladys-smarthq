# GE Appliances (SmartHQ) for Gladys Assistant

Follow — and, where it is safe, control — your connected **GE Appliances** (GE, GE Profile, Café,
Monogram, Haier US, Hotpoint) in [Gladys Assistant](https://gladysassistant.com), through the
**SmartHQ** cloud: washers, dryers, washer-dryers, dishwashers, ovens and ranges, refrigerators and
beverage centers, window, portable and split air conditioners, GeoSpring water heaters and Opal nugget
ice makers.

> **Developed without the hardware: feedback welcome.** Neither a GE appliance nor a SmartHQ account
> was available while writing it, and the SmartHQ servers were not reachable from the development
> machine: the code is tested against values built to the byte layouts of gehomesdk, the library of the
> Home Assistant integration. Please report what works and what does not.
>
> Community project, **not affiliated with GE Appliances or Haier**. GE, SmartHQ, Café, Monogram,
> Profile and Hotpoint are trademarks of their owners.

## Features

- **One Gladys device per appliance**, built from the ERD data codes it reports:
  - washers, dryers and washer-dryers: state, cycle, time left, expected end, delayed start, door,
    alerts (drain problem, blocked dryer vent);
  - dishwashers: state, cycle, phase, time left, expected end, door, remote control enabled, alerts
    (rinse aid, filter);
  - ovens and ranges, one or two cavities: state, temperature, setpoint, time left, kitchen timer;
  - refrigerators: fridge and freezer temperatures and **setpoints**, door, water filter state and life,
    alerts (filter, leak, door left open, too warm);
  - air conditioners: **on/off, mode, setpoint, fan speed**, room temperature, filter alert;
  - GeoSpring water heaters: water temperature, setpoint, mode; Opal ice makers: state, alerts.
- **Safe commands only**: refrigerator setpoints (within the appliance's limits), air conditioners, and
  pause or stop of a dishwasher whose remote control is enabled (scene action). **Nothing that heats is
  ever started remotely**: ovens, ranges and water heaters are read only, a dishwasher is never
  started, washers and dryers are read only.
- **Real time** through the SmartHQ WebSocket, with a full read every 10 minutes by the container
  itself: no reliance on Gladys polling (GladysAssistant/Gladys#3198).
- **Temperatures in °C or °F**, converted from GE's native °F.
- **Scene triggers** "GE cycle finished" and "GE appliance alert", **scene action** "Pause or stop a GE
  dishwasher", **dashboard widget** "GE appliances" (what runs, time left).
- **Accounts with a verification code** (multi-factor authentication): two configuration actions send
  and enter the code; the refresh token is kept in `/data`, so no code is asked again.
- Four languages: English, French, German, Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later.
- Appliances paired in the **SmartHQ** app, and the e-mail and password of that account.
- Internet access: GE appliances have no local API.

## Installation

1. In Gladys: **Integrations → Install from GitHub**, with `https://github.com/guim31/gladys-smarthq`
   (or from the store once published).
2. In the integration's **Configuration** tab: fill in the SmartHQ e-mail and password, the region
   (United States for nearly every account), the temperature unit and the language, then save.
3. If SmartHQ asks for a verification code: run **Send the verification code**, then **Enter the
   verification code**.
4. Add the appliances from the **Discover** tab.

The full user documentation is in [`docs/en.md`](docs/en.md) (also [French](docs/fr.md),
[German](docs/de.md), [Spanish](docs/es.md)).

## How it works

- **Sign-in**: the OAuth2 flow of the SmartHQ app on `accounts.brillion.geappliances.com` (HTML forms,
  authorization code, then access and refresh tokens), as gehomesdk does it. The refresh token is kept
  in `/data/smarthq-auth.json` (mode 600). A refused password is never retried until the configuration
  changes (no lockout loop); new terms of use are never accepted on the user's behalf.
- **Real time**: `GET /v1/websocket` gives the address of a WebSocket ("pseudo-MQTT") that pushes every
  ERD change (`publish#erd`) and relays API requests (list of appliances, full ERD read, ERD writes).
  Node 22's built-in WebSocket client is used: no extra dependency.
- **ERDs**: the appliance type (0x0008) gives the family; every feature comes from an ERD the appliance
  reports, decoded as gehomesdk does (`src/erd.js`, `src/appliances.js`).
- **Quotas**: GE publishes none. The integration keeps gehomesdk's pace: one connection, a keep-alive
  every 30 s, a full read every 10 minutes, commands only on user action, reconnection after 10 s
  doubling up to 15 minutes.

## Limitations

- Oven doors, refrigerator dispensers and ice makers inside refrigerators are not read.
- Washers and dryers cannot be paused or stopped (GE exposes no such ERD command).
- Microwaves, Advantium, cooktops, hoods, dehumidifiers, coffee makers, water filters and softeners are
  not supported yet.
- Washer and dryer cycle names stay in English, as GE names them.
- Cloud only.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run the whole integration on the SDK's fake Gladys and a fake SmartHQ (sign-in pages, token
service, WebSocket) serving the appliances of `test/fixtures/smarthq/`; they never touch the network.
`scripts/probe.mjs` checks the real cloud, read only, from a machine with network access (without
credentials it expects a clean refusal; `--dump` prints real ERD values to replace the fixtures).

Project rules: [`CLAUDE.md`](CLAUDE.md). Changes: [`CHANGELOG.md`](CHANGELOG.md). Security:
[`SECURITY.md`](SECURITY.md).

## Credits

- [`simbaja/gehome`](https://github.com/simbaja/gehome) (gehomesdk, MIT): the SmartHQ sign-in flow, the
  WebSocket protocol, the ERD codes and their decoding, the washer and dryer cycle names.
- [`simbaja/ha_gehome`](https://github.com/simbaja/ha_gehome) (MIT), the Home Assistant integration
  `ge_home`: which ERDs each appliance type exposes, the air conditioner modes and ranges, the
  refrigerator setpoint limits.
- [`guim31/gladys-electrolux`](https://github.com/guim31/gladys-electrolux) and
  [`guim31/gladys-miele`](https://github.com/guim31/gladys-miele): the same family of appliances, the
  same safety choices.
- [Gladys Assistant](https://github.com/GladysAssistant/Gladys) and its
  [integration SDK](https://github.com/GladysAssistant/integration-sdk-js).

## Disclaimer

This integration is not affiliated with, endorsed by or supported by GE Appliances or Haier. It uses
the undocumented SmartHQ cloud the official app uses; GE may change it at any time. Use it at your own
risk.

## License

[Apache-2.0](LICENSE).

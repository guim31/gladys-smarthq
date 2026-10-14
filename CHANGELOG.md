# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- GE Appliances (GE, GE Profile, Café, Monogram, Haier US, Hotpoint) in Gladys through the SmartHQ
  cloud, with the e-mail and password of the SmartHQ app. Accounts with a verification code are
  supported through two configuration actions; the refresh token is kept in the integration's `/data`
  volume, so no code is asked again at restart.
- One device per appliance, built from the data it reports: washers, dryers and washer-dryers (state,
  cycle, time left, expected end, delayed start, door, alerts), dishwashers (state, cycle, phase, time
  left, door, remote control, alerts), ovens and ranges with one or two cavities (state, temperature,
  setpoint, time left, kitchen timer), refrigerators and beverage centers (temperatures, setpoints, door,
  water filter, alerts), air conditioners (on/off, mode, setpoint, fan speed, room temperature),
  GeoSpring water heaters and Opal ice makers.
- Safe commands: refrigerator setpoints and air conditioners. Nothing that heats is ever started
  remotely: ovens, ranges, water heaters, washers and dryers are read only.
- Temperatures in °C or °F, converted from the appliances' native °F.
- Real time through the SmartHQ connection, with a full read every 10 minutes by the integration itself:
  no reliance on Gladys polling.
- Scene triggers "GE cycle finished" and "GE appliance alert", scene action "Pause or stop a GE
  dishwasher", dashboard widget "GE appliances" (what runs, time left).
- Documentation in English, French, German and Spanish.

# GE Appliances (SmartHQ)

## Overview

This integration brings the connected appliances of **GE Appliances** into Gladys, through the
**SmartHQ** cloud: GE, GE Profile, Café, Monogram, Haier (United States) and Hotpoint. Washers, dryers
and dishwashers show their state, cycle and time left; ovens and ranges their temperature and timers;
refrigerators their temperatures, setpoints, doors and water filter; window and portable air
conditioners can be driven like any Gladys air conditioner.

Changes arrive within seconds through the SmartHQ real-time connection. Two scene triggers ("cycle
finished", "appliance alert"), a scene action (pause or stop a dishwasher) and a dashboard widget
(appliances running, time left) complete the devices.

**Safety first**: nothing that heats is ever started remotely. Ovens, ranges and water heaters are read
only; a dishwasher can be paused or stopped, never started; washers and dryers are read only.

Developed without the hardware: feedback welcome. This integration is not affiliated with GE
Appliances or Haier; GE, SmartHQ, Café, Monogram, Profile and Hotpoint are their trademarks.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Appliances already paired in the **SmartHQ** app (the North American app of GE Appliances), with
  their Wi-Fi module connected.
- The e-mail and password of that SmartHQ account. An account protected by a verification code
  (multi-factor authentication) works too: see Configuration.
- Internet access from Gladys: GE appliances have no local API, everything goes through the SmartHQ
  cloud.

## Configuration

1. In Gladys, open **Integrations**, install **GE Appliances (SmartHQ)**, then open its
   **Configuration** tab.
2. Fill in the **e-mail** and **password** of your SmartHQ account. Keep the **account region** on
   "United States" unless your account was created in Europe.
3. Choose the **temperature unit** (°C by default; GE appliances work in °F and the values are
   converted) and the **language** of the feature names. Choose both before adding the devices: the
   names and units of a device are frozen when it is added.
4. Save. The status turns to "connected" and the appliances appear in the **Discover** tab: add the
   ones you want.
5. If SmartHQ asks for a **verification code**, the status says so. Run the action **Send the
   verification code** (SmartHQ sends it by e-mail), then **Enter the verification code** with the code
   received, within 15 minutes. The integration then keeps a refresh token in its private volume: no
   code is asked again at the next restart.

The action **Test the connection** lists the appliances of the account.

A refused password is never tried again until you change it and save: repeated wrong attempts could
lock the account. If SmartHQ asks to accept new terms of use, accept them in the SmartHQ app, then save
the configuration again: the integration never accepts terms on your behalf.

## The devices

One Gladys device per appliance, named after its SmartHQ nickname. A feature is created only when the
appliance reports the data behind it.

- **Washers, dryers, washer-dryers**: state, cycle (GE names, in English), time left, expected end,
  delayed start, door, alerts (drain problem, dryer vent blocked). Read only.
- **Dishwashers**: state, cycle, cycle phase (pre-wash, main wash, drying…), time left, expected end,
  door, remote control enabled, alerts (rinse aid low, filter to clean). Paused or stopped by the scene
  action only.
- **Ovens and ranges**: for each cavity (upper and lower on a double oven), state (preheating, cooking,
  keeping warm, cleaning…), temperature reached, set temperature, time left of a timed cook, kitchen
  timer. Read only: no setting, no start.
- **Refrigerators and beverage centers**: fridge and freezer temperatures, fridge and freezer
  **setpoints** (writable, within the limits the appliance gives), door (open when any door is open),
  water filter state and life left, alerts (filter, leak, door left open, too warm).
- **Air conditioners** (window, portable, split, built-in): **on/off, mode** (cooling, fan only,
  drying, heating and auto as the unit offers them), **setpoint** (in whole degrees), **fan speed**
  (auto, low, medium, high), room temperature, filter alert.
- **GeoSpring water heaters**: water temperature, setpoint and mode, read only.
- **Opal nugget ice makers**: state (making ice, ice bin full, add water…) and alerts, read only.

Doors follow Gladys: 0 means open, 1 closed. An appliance disconnected from SmartHQ keeps its last
values, shows "Not connected" as state, and its badge turns to "unreachable".

## Widget

The **GE appliances** widget lists what is running: washers, dryers, dishwashers and ovens, the busiest
first, with their cycle, phase and expected end, and a badge with the time left (or "Paused",
"Finished", "Alarm"). When nothing runs, one line says so. It refreshes every minute and as soon as an
appliance starts or stops.

## Scene triggers and action

- **GE cycle finished**: a washer, dryer or dishwasher finished its cycle, or a timed cook of an oven
  ran out. Filter: the appliance. Variables: appliance name, cycle.
- **GE appliance alert**: an appliance raises a new alert (door left open, water leak, water filter,
  rinse aid, blocked dryer vent, air conditioner filter, ice maker…). Filters: the appliance, the
  alerts. Variables: appliance name, alert (in the configured language), alert code.
- **Pause or stop a GE dishwasher** (action): pauses or stops the cycle of a dishwasher whose remote
  control is enabled on the appliance. It never starts nor resumes a cycle. Output: command sent.

A trigger fires once per transition, never at startup.

## Scene examples

- **Laundry done**: trigger "GE cycle finished" on the washer → send the message "The washer is done
  ({{triggerEvent.data.cycle}})" to the family.
- **Fridge door left open**: trigger "GE appliance alert", alert "Fridge door open" → notification, and
  flash the kitchen light.
- **Quiet hours**: at 10 p.m. → "Pause or stop a GE dishwasher" with "Pause" (refused without harm
  when nothing runs).
- **Cool the bedroom before bedtime**: at 9 p.m. in summer → bedroom air conditioner on, cooling mode,
  setpoint 22 °C.

## Refresh and quotas

The integration does not rely on the polling of Gladys, which is unreliable for external integrations
(GladysAssistant/Gladys#3198): it keeps one SmartHQ real-time connection open, receives every change
within seconds, and reads every appliance in full every 10 minutes by itself (the safety net, and the
heartbeat of the values that never change). Gladys only receives the values that changed, and an
unchanged value again every 6 hours.

GE publishes no API terms nor quota for SmartHQ. The integration follows the pace of gehomesdk, the
library of the Home Assistant integration: one connection, a keep-alive every 30 seconds, the list of
appliances every 10 minutes, commands only when you act. A lost connection is opened again after 10
seconds, then 20, 40… up to 15 minutes.

## Troubleshooting

- **"SmartHQ refused the e-mail or the password"**: check them in the SmartHQ app, correct them, save.
- **"SmartHQ asks for a verification code"**: run "Send the verification code", then "Enter the
  verification code" within 15 minutes.
- **"New terms of use"**: open the SmartHQ app, accept them, then save the configuration again.
- **An appliance is missing**: it must appear in the SmartHQ app of the same account. Unsupported
  appliance types (microwaves, cooktops, hoods, toaster ovens…) are not published; the logs say so once.
- **Temperatures in the wrong unit**: change the unit, save, then use **Update** on the device in the
  Discover tab (or delete and add it again).
- **More detail**: set `LOG_LEVEL=debug` on the integration. The logs never contain the password, the
  tokens nor the connection address.

## Limits

- Developed and tested without GE appliances nor a SmartHQ account, on values built from gehomesdk:
  feedback welcome, especially on the values your appliances report.
- Cloud only: without internet, nothing is updated.
- Oven doors, refrigerator dispensers and ice makers inside refrigerators are not reported by the data
  this integration reads.
- Washers and dryers cannot be paused or stopped remotely (GE exposes no such command); a dishwasher
  only when its remote control is enabled on the appliance.
- Microwaves, Advantium, cooktops, hoods, dehumidifiers, coffee makers, water filters and softeners are
  not supported yet.
- Washer and dryer cycle names stay in English, as GE names them.

// -----------------------------------------------------------------------------
// One Gladys device per GE appliance: its features, built from the ERD codes
// the appliance reports, and their states.
//
// An appliance, as the hub keeps it: { id (MAC address, upper case),
// nickname, online, erds: { "0x2000": "02", … } }. Its family comes from ERD
// 0x0008 (appliance type); a feature is declared when the appliance reports
// the ERD behind it, never from a list of models.
//
// External ids are forever: `appliance:<MAC>` for the device (the id SmartHQ
// keys the appliance on), a fixed English key per feature, which never moves
// to another device.
//
// Safety (Guilhem's rule, the OctoPrint lesson): nothing that heats is driven
// remotely. Ovens, ranges and water heaters are read only; a dishwasher can be
// paused or stopped (scene action), never started; washers and dryers are
// read only. Writable: the refrigerator setpoints (within the limits the
// appliance gives) and the air conditioners (power, mode, setpoint, fan).
// A feature is writable only when its family allows it (COMMAND_KEYS),
// checked again when a command arrives.
//
// Temperatures travel in °F; they are published in the unit chosen in the
// configuration (°C by default) and converted back for a command.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { CommandError } from './command-error.js';
import {
  ERD,
  cleanHex,
  decodeBool,
  decodeInt,
  decodeModelSerial,
  decodeSignedByte,
  decodeString,
  decodeTimespan,
  encodeInt,
  encodeSignedByte,
  toCelsius,
  toFahrenheit,
} from './erd.js';
import {
  ALERT_TEXT,
  COMMAND_TEXT,
  FILTER_TEXT,
  HEATER_MODE_TEXT,
  NAMES,
  OPTION_TEXT,
  PHASE_TEXT,
  STATUS_TEXT,
  TYPE_NAMES,
  ZONE_NAMES,
  fill,
  fillAll,
  pickLanguage,
} from './i18n.js';
import { laundryCycleText } from './laundry-cycles.js';

/** Shown in a text feature that has no value (Gladys ignores an empty text). */
export const NO_VALUE = '—';

/** ERD 0x0008 → family. Unlisted types are not published. */
const FAMILIES = {
  '00': 'water_heater',
  '01': 'dryer',
  '02': 'washer',
  '03': 'fridge',
  '06': 'dishwasher',
  '07': 'oven',
  '08': 'oven', // electric range
  '09': 'oven', // gas range
  '0A': 'air_conditioner', // window
  '0E': 'air_conditioner', // split
  16: 'air_conditioner', // portable
  17: 'washer_dryer',
  19: 'fridge', // beverage center (no freezer)
  '1B': 'ice_maker', // Opal nugget ice maker
  '1F': 'air_conditioner', // built-in
};

export const LAUNDRY_FAMILIES = ['washer', 'dryer', 'washer_dryer'];
/** Families with a program whose end is news (`cycle_finished`, widget). */
export const CYCLE_FAMILIES = [...LAUNDRY_FAMILIES, 'dishwasher', 'oven'];

/** The feature keys that accept a command, per family (checked again on each command). */
export const COMMAND_KEYS = {
  fridge: ['fridge_target_temperature', 'freezer_target_temperature'],
  air_conditioner: ['power', 'mode', 'target_temperature', 'fan_speed'],
};

export function isCommandAllowed(family, key) {
  return (COMMAND_KEYS[family] ?? []).includes(key);
}

// --- Reading the ERDs ------------------------------------------------------------

/** The raw hex of an ERD, or null. */
export function raw(appliance, code) {
  return cleanHex(appliance.erds?.[code]);
}

const has = (appliance, code) => raw(appliance, code) !== null;
const int = (appliance, code) => decodeInt(raw(appliance, code));

/** The appliance type code ("02"), or null. */
export function typeCode(appliance) {
  const value = raw(appliance, ERD.APPLIANCE_TYPE);
  return value ? value.slice(-2) : null;
}

/** The family of an appliance, or null when unknown or not supported. */
export function familyOf(appliance) {
  return FAMILIES[typeCode(appliance)] ?? null;
}

export function modelOf(appliance) {
  return decodeModelSerial(raw(appliance, ERD.MODEL_NUMBER));
}

/** The name shown: the nickname given in SmartHQ, else "GE <kind>". */
export function applianceName(appliance, language) {
  if (appliance.nickname) {
    return appliance.nickname;
  }
  const family = familyOf(appliance);
  return `GE ${TYPE_NAMES[pickLanguage(language)][family] ?? 'appliance'}`;
}

export function isConnected(appliance) {
  return appliance.online !== false;
}

const LAUNDRY_STATES = {
  0: 'OFF',
  1: 'STANDBY',
  2: 'RUNNING',
  3: 'PAUSED',
  4: 'END_OF_CYCLE',
  5: 'DELAYED_START',
  6: 'DELAYED_START',
  7: 'PAUSED',
  8: 'ALARM', // drain timeout
  9: 'STANDBY', // commissioning
  10: 'RUNNING', // bulk flush
  128: 'STANDBY', // "clean speak"
};

const DISHWASHER_STATES = {
  0: 'OFF',
  1: 'STANDBY',
  2: 'STANDBY',
  3: 'DELAYED_START',
  4: 'PAUSED',
  5: 'RUNNING',
  6: 'END_OF_CYCLE',
  7: 'STANDBY',
  8: 'STANDBY',
  9: 'STANDBY',
  11: 'OFF',
  17: 'STANDBY',
  18: 'ALARM',
  19: 'LOCKED',
  20: 'ALARM',
};

const ICE_MAKER_STATES = {
  0: 'MAKING_ICE',
  1: 'DEFROSTING',
  2: 'CLEANING',
  3: 'ICE_FULL',
  4: 'ADD_WATER',
  5: 'BIN_MISSING',
  6: 'IDLE',
  7: 'NO_WATER_SOURCE',
  8: 'LID_OPEN',
};

/** Oven cavity state (ERD 0x5101/0x5201), after gehomesdk's ErdOvenStateConverter. */
function ovenState(code) {
  if (code === null) {
    return 'UNKNOWN';
  }
  if (code === 0) {
    return 'OFF';
  }
  if (code >= 1 && code <= 4) {
    return 'PREHEATING';
  }
  if (code === 18) {
    return 'WARMING';
  }
  if (code === 19) {
    return 'PROOFING';
  }
  if (code >= 21 && code <= 26) {
    return 'CLEANING';
  }
  if (code === 27) {
    return 'DELAYED_START';
  }
  if ((code >= 5 && code <= 20) || (code >= 33 && code <= 59) || code === 90 || code === 91) {
    return 'COOKING';
  }
  return 'OFF';
}

/** The cavities of an oven: ['upper'] or ['upper', 'lower']. */
export function ovenZones(appliance) {
  const config = int(appliance, ERD.OVEN_CONFIGURATION);
  if (config !== null) {
    return config & 8 ? ['upper', 'lower'] : ['upper'];
  }
  // No configuration ERD (Home Assistant's fallback): a lower cavity that reports a mode.
  const lowerMode = raw(appliance, ERD.LOWER_OVEN_COOK_MODE);
  return lowerMode && decodeInt(lowerMode.slice(0, 2)) ? ['upper', 'lower'] : ['upper'];
}

const ZONE_ERDS = {
  upper: {
    mode: ERD.UPPER_OVEN_COOK_MODE,
    state: ERD.UPPER_OVEN_CURRENT_STATE,
    left: ERD.UPPER_OVEN_COOK_TIME_REMAINING,
    timer: ERD.UPPER_OVEN_KITCHEN_TIMER,
    temperature: ERD.UPPER_OVEN_DISPLAY_TEMPERATURE,
  },
  lower: {
    mode: ERD.LOWER_OVEN_COOK_MODE,
    state: ERD.LOWER_OVEN_CURRENT_STATE,
    left: ERD.LOWER_OVEN_COOK_TIME_REMAINING,
    timer: ERD.LOWER_OVEN_KITCHEN_TIMER,
    temperature: ERD.LOWER_OVEN_DISPLAY_TEMPERATURE,
  },
};

export function zoneStatus(appliance, zone) {
  return ovenState(int(appliance, ZONE_ERDS[zone].state));
}

const ACTIVE = [
  'RUNNING',
  'PAUSED',
  'DELAYED_START',
  'PREHEATING',
  'COOKING',
  'WARMING',
  'PROOFING',
  'CLEANING',
];
const OVEN_PRIORITY = [
  'COOKING',
  'PREHEATING',
  'CLEANING',
  'WARMING',
  'PROOFING',
  'DELAYED_START',
  'OFF',
  'UNKNOWN',
];

/**
 * The state key of an appliance (a key of STATUS_TEXT), or null for the
 * families without one (refrigerator, air conditioner, water heater).
 */
export function statusKey(appliance) {
  const family = familyOf(appliance);
  if (!isConnected(appliance)) {
    return 'NOT_CONNECTED';
  }
  if (LAUNDRY_FAMILIES.includes(family)) {
    return LAUNDRY_STATES[int(appliance, ERD.LAUNDRY_MACHINE_STATE)] ?? 'UNKNOWN';
  }
  if (family === 'dishwasher') {
    return DISHWASHER_STATES[int(appliance, ERD.DISHWASHER_OPERATING_MODE)] ?? 'UNKNOWN';
  }
  if (family === 'oven') {
    const states = ovenZones(appliance).map((zone) => zoneStatus(appliance, zone));
    return OVEN_PRIORITY.find((state) => states.includes(state)) ?? 'UNKNOWN';
  }
  if (family === 'ice_maker') {
    if (decodeInt(raw(appliance, ERD.OIM_POWER)) === 0) {
      return 'OFF';
    }
    return ICE_MAKER_STATES[int(appliance, ERD.OIM_STATUS)] ?? 'UNKNOWN';
  }
  return null;
}

export function isActive(status) {
  return ACTIVE.includes(status);
}

/** The cycle (program) in words, or null. */
export function cycleText(appliance) {
  const family = familyOf(appliance);
  if (LAUNDRY_FAMILIES.includes(family)) {
    return laundryCycleText(int(appliance, ERD.LAUNDRY_CYCLE));
  }
  if (family === 'dishwasher') {
    const name = decodeString(raw(appliance, ERD.DISHWASHER_CYCLE_NAME));
    // gehomesdk: "AutoSense…" names carry a suffix the app does not show.
    return name?.startsWith('AutoSense') ? 'AutoSense' : name;
  }
  return null;
}

const DISHWASHER_PHASES = {
  1: 'PRE_WASH',
  10: 'PRE_WASH',
  12: 'PRE_WASH',
  13: 'PRE_WASH',
  14: 'PRE_WASH',
  15: 'PRE_WASH',
  2: 'SENSING',
  3: 'MAIN_WASH',
  7: 'MAIN_WASH',
  4: 'DRYING',
  5: 'SANITIZING',
  6: 'RINSING',
  9: 'RINSING',
  11: 'RINSING',
  16: 'RINSING',
  8: 'PAUSE',
};

/** Dishwasher phase key, or null. */
export function phaseKey(appliance) {
  return DISHWASHER_PHASES[int(appliance, ERD.DISHWASHER_CYCLE_STATE)] ?? null;
}

/**
 * Timing of the cycle, in minutes: time left, time before a delayed start.
 * Null when unknown. Zone '' for laundry and dishwashers, 'upper'/'lower' for ovens.
 */
export function cycleTiming(appliance, zone = '') {
  const family = familyOf(appliance);
  if (LAUNDRY_FAMILIES.includes(family)) {
    const seconds = decodeTimespan(raw(appliance, ERD.LAUNDRY_TIME_REMAINING));
    return {
      left: seconds === null ? null : Math.ceil(seconds / 60),
      startIn: decodeTimespan(raw(appliance, ERD.LAUNDRY_DELAY_TIME_REMAINING)),
    };
  }
  if (family === 'dishwasher') {
    return { left: decodeTimespan(raw(appliance, ERD.DISHWASHER_TIME_REMAINING)), startIn: null };
  }
  if (family === 'oven') {
    return {
      left: decodeTimespan(raw(appliance, ZONE_ERDS[zone || 'upper'].left)),
      startIn: null,
    };
  }
  return { left: null, startIn: null };
}

/** Minutes before the expected end, or null. */
export function minutesToEnd(appliance, zone = '') {
  const status = zone ? zoneStatus(appliance, zone) : statusKey(appliance);
  const { left, startIn } = cycleTiming(appliance, zone);
  if (status === 'DELAYED_START' && startIn && left) {
    return startIn + left;
  }
  if (['RUNNING', 'COOKING', 'PREHEATING', 'CLEANING'].includes(status) && left) {
    return left;
  }
  return null;
}

/** "14:35" in the time zone of Gladys (TZ, set by the supervisor). */
export function clockTime(date, language) {
  return new Intl.DateTimeFormat(pickLanguage(language), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** Refrigerator water filter status key (ERD 0x1009), or null. */
function waterFilterKey(appliance) {
  const value = raw(appliance, ERD.WATER_FILTER_STATUS);
  if (!value) {
    return null;
  }
  // Byte 0 is the filter status; when it is "good", byte 1 (the order status) tells more.
  const status = value.slice(0, 2) === '00' ? value.slice(2, 4) : value.slice(0, 2);
  return (
    { '00': 'GOOD', '01': 'REPLACE', '02': 'EXPIRED', '03': 'UNFILTERED', '04': 'LEAK_DETECTED' }[
      status || '00'
    ] ?? null
  );
}

/** Bits of the "notifications" half of ERD 0x122e (newer refrigerators). */
function fridgeNotification(appliance, bit) {
  const value = raw(appliance, ERD.FRIDGE_ALERT_NOTIFICATIONS);
  if (!value || value.length < 64) {
    return false;
  }
  return ((BigInt(`0x${value.slice(32, 64)}`) >> BigInt(bit)) & 1n) === 1n;
}

const FRIDGE_NOTIFICATIONS = [
  [120, 'fridge_door'],
  [121, 'freezer_door'],
  [122, 'water_filter_replace'],
  [123, 'water_filter_expired'],
  [124, 'fridge_too_warm'],
  [125, 'freezer_too_warm'],
  [112, 'water_leak'],
];

/** Active alerts of an appliance, as codes (keys of ALERT_TEXT), sorted. */
export function alertCodes(appliance) {
  const family = familyOf(appliance);
  const codes = new Set();
  if (LAUNDRY_FAMILIES.includes(family)) {
    if (int(appliance, ERD.LAUNDRY_MACHINE_STATE) === 8) {
      codes.add('drain');
    }
    if (decodeBool(raw(appliance, ERD.LAUNDRY_DRYER_BLOCKED_VENT_FAULT))) {
      codes.add('vent_blocked');
    }
  }
  if (family === 'dishwasher') {
    const reminders = int(appliance, ERD.DISHWASHER_REMINDERS);
    if (reminders !== null && reminders & 1) {
      codes.add('clean_filter');
    }
    if (reminders !== null && reminders & 2) {
      codes.add('rinse_aid');
    }
  }
  if (family === 'fridge') {
    const filter = waterFilterKey(appliance);
    if (filter === 'REPLACE') {
      codes.add('water_filter_replace');
    } else if (filter === 'EXPIRED') {
      codes.add('water_filter_expired');
    } else if (filter === 'LEAK_DETECTED') {
      codes.add('water_leak');
    }
    for (const [bit, code] of FRIDGE_NOTIFICATIONS) {
      if (fridgeNotification(appliance, bit)) {
        codes.add(code);
      }
    }
  }
  if (family === 'air_conditioner' && int(appliance, ERD.AC_FILTER_STATUS) === 1) {
    codes.add('ac_filter');
  }
  if (family === 'ice_maker') {
    const status = int(appliance, ERD.OIM_STATUS);
    if (status === 4) {
      codes.add('ice_add_water');
    } else if (status === 5) {
      codes.add('ice_bin_missing');
    } else if (status === 7) {
      codes.add('ice_water_source');
    }
    if (int(appliance, ERD.OIM_FILTER_STATUS) === 1) {
      codes.add('ice_filter');
    }
  }
  return [...codes].sort();
}

/** Whether the family can raise alerts (the `alerts` feature). */
function hasAlerts(appliance) {
  const family = familyOf(appliance);
  return (
    LAUNDRY_FAMILIES.includes(family) ||
    (family === 'dishwasher' && has(appliance, ERD.DISHWASHER_REMINDERS)) ||
    (family === 'fridge' &&
      (has(appliance, ERD.WATER_FILTER_STATUS) ||
        has(appliance, ERD.FRIDGE_ALERT_NOTIFICATIONS))) ||
    (family === 'air_conditioner' && has(appliance, ERD.AC_FILTER_STATUS)) ||
    family === 'ice_maker'
  );
}

export function alertText(code, language) {
  return ALERT_TEXT[pickLanguage(language)][code] ?? code;
}

// --- Temperatures ---------------------------------------------------------------

const round1 = (value) => Math.round(value * 10) / 10;

/** °F from the appliance → the configured unit. */
function temperatureOut(fahrenheit, unit) {
  return unit === 'fahrenheit' ? round1(fahrenheit) : round1(toCelsius(fahrenheit));
}

/** A command in the configured unit → whole °F for the appliance. */
function temperatureIn(value, unit) {
  return Math.round(unit === 'fahrenheit' ? value : toFahrenheit(value));
}

/** Refrigerator compartment temperatures (ERD 0x1004 / 0x1005): { fridge, freezer } in °F. */
function compartments(appliance, code) {
  const value = raw(appliance, code);
  if (!value || value.length < 4) {
    return { fridge: null, freezer: null };
  }
  const read = (hex) => {
    const number = decodeSignedByte(hex);
    // -128 (0x80) marks a compartment the appliance does not have.
    return number === null || number === -128 ? null : number;
  };
  return { fridge: read(value.slice(0, 2)), freezer: read(value.slice(2, 4)) };
}

/** Setpoint limits in °F: { fridge: [min, max], freezer: [min, max] } (Home Assistant's defaults otherwise). */
function setpointLimits(appliance) {
  const value = raw(appliance, ERD.SETPOINT_LIMITS);
  const bytes =
    value && value.length >= 8
      ? [0, 2, 4, 6].map((i) => decodeSignedByte(value.slice(i, i + 2)))
      : null;
  const valid = (min, max) => min !== null && max !== null && min < max;
  return {
    fridge: bytes && valid(bytes[0], bytes[1]) ? [bytes[0], bytes[1]] : [32, 46],
    freezer: bytes && valid(bytes[2], bytes[3]) ? [bytes[2], bytes[3]] : [-6, 7],
    known: Boolean(bytes),
    freezerKnown: Boolean(bytes && valid(bytes[2], bytes[3])),
  };
}

/** Whether the refrigerator has a freezer (a beverage center has none). */
function hasFreezer(appliance) {
  const limits = setpointLimits(appliance);
  if (limits.known) {
    return limits.freezerKnown;
  }
  return (
    typeCode(appliance) === '03' &&
    compartments(appliance, ERD.TEMPERATURE_SETTING).freezer !== null
  );
}

// --- Air conditioners -------------------------------------------------------------

/** GE operation mode (ERD 0x7a01) → Gladys AC_MODE. */
const AC_MODE_TO_GLADYS = { 0: 1, 1: 4, 2: 0, 3: 2, 4: 3, 5: 0, 6: 1, 7: 1 };
/** GE fan setting (ERD 0x7a00) → Gladys AC_FAN_SPEED (auto 0, low 1, medium 3, high 5). */
const FAN_TO_GLADYS = { 1: 0, 2: 1, 3: 1, 4: 3, 5: 3, 8: 5, 9: 5 };
const FAN_FROM_GLADYS = { 0: 1, 1: 2, 3: 4, 5: 8 };
const AC_MODE_LABELS = { 0: 'ac_auto', 1: 'ac_cool', 2: 'ac_heat', 3: 'ac_dry', 4: 'ac_fan' };
const FAN_LABELS = { 0: 'fan_auto', 1: 'fan_low', 3: 'fan_medium', 5: 'fan_high' };

/** Gladys mode → GE mode, as the appliance declares them (ERD 0x7b00). */
function acModes(appliance) {
  const bits = int(appliance, ERD.AC_AVAILABLE_MODES);
  const modes = new Map([
    [1, 0], // cool
    [4, 1], // fan only
  ]);
  if (bits !== null) {
    if (bits & 32) {
      modes.set(0, 5); // auto
    } else if (bits & 4) {
      modes.set(0, 2); // energy saver stands for auto, as in Home Assistant
    }
    if (bits & 1) {
      modes.set(2, 3); // heat
    }
    if (bits & 2) {
      modes.set(3, 4); // dry
    }
  }
  return new Map([...modes.entries()].sort((a, b) => a[0] - b[0]));
}

/** Gladys fan speeds offered (ERD 0x7b0b; all four when absent). */
function acFanSpeeds(appliance) {
  const bits = int(appliance, ERD.AC_AVAILABLE_FAN_SPEEDS);
  if (bits === null || (bits & 15) === 0) {
    return [0, 1, 3, 5];
  }
  return [
    [0, 1],
    [1, 8],
    [3, 4],
    [5, 2],
  ]
    .filter(([, bit]) => bits & bit)
    .map(([code]) => code);
}

/** Setpoint range in °F (ERD 0x7b06 on split and portable units, else 64-86 °F). */
function acRange(appliance) {
  const value = raw(appliance, ERD.SAC_TARGET_TEMPERATURE_RANGE);
  if (value && value.length >= 4) {
    const min = decodeInt(value.slice(0, 2));
    const max = decodeInt(value.slice(2, 4));
    if (min !== 255 && max !== 255 && min < max) {
      return [min, max];
    }
    return [60, 86];
  }
  return [64, 86];
}

// --- The features ---------------------------------------------------------------

const TEXT = {
  category: CAT.TEXT,
  type: TYPES.TEXT.TEXT,
  min: 0,
  max: 0,
  read_only: true,
  has_feedback: false,
  keep_history: false,
};
const DURATION = {
  category: CAT.DURATION,
  type: TYPES.DURATION.INTEGER,
  unit: UNITS.MINUTES,
  min: 0,
  max: 1440,
  read_only: true,
  has_feedback: false,
  keep_history: false,
};
const OPENING = {
  category: CAT.OPENING_SENSOR,
  type: TYPES.SENSOR.BINARY,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
};
const INPUT = {
  category: CAT.INPUT,
  type: TYPES.SENSOR.BINARY,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
};

const unitOf = (unit) => (unit === 'fahrenheit' ? UNITS.FAHRENHEIT : UNITS.CELSIUS);

function temperatureSensor(unit, minF, maxF) {
  return {
    category: CAT.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: unitOf(unit),
    min: Math.floor(temperatureOut(minF, unit)),
    max: Math.ceil(temperatureOut(maxF, unit)),
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
}

const command = (category, type, extra = {}) => ({
  category,
  type,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  ...extra,
});

/**
 * The feature definitions of an appliance: the Gladys declaration (`spec`,
 * `name`), how to read its state (`read`), and for a command how to build the
 * ERD write (`write`: value → { code, value }).
 * @param {object} appliance
 * @param {{ language: string, unit: string }} options
 */
export function featureDefs(appliance, { language, unit }) {
  const lang = pickLanguage(language);
  const family = familyOf(appliance);
  const defs = [];
  const nameOf = (key, zone) =>
    zone
      ? fill(NAMES[lang].zoned, { name: NAMES[lang][key], zone: ZONE_NAMES[lang][zone] })
      : NAMES[lang][key];
  const add = (key, nameKey, zone, spec, read, write) => {
    const allowed = Boolean(write) && isCommandAllowed(family, key);
    defs.push({
      key,
      name: nameOf(nameKey, zone),
      spec: allowed ? spec : { ...spec, read_only: true, has_feedback: false },
      read,
      write: allowed ? write : undefined,
    });
  };
  const text = (value) => ({
    text: value === null || value === undefined || value === '' ? NO_VALUE : value,
  });
  const statusText = (key) => text(STATUS_TEXT[lang][key ?? 'UNKNOWN']);
  const alerts = () =>
    text(
      alertCodes(appliance)
        .map((code) => alertText(code, lang))
        .join(', ')
        .slice(0, 250),
    );
  const endTime = (minutes, now) =>
    text(minutes ? clockTime(new Date(now + minutes * 60_000), lang) : null);

  // --- Washers, dryers, washer-dryers, dishwashers: the cycle ------------------
  if (LAUNDRY_FAMILIES.includes(family) || family === 'dishwasher') {
    const laundry = family !== 'dishwasher';
    add('status', 'status', '', TEXT, () => statusText(statusKey(appliance)));
    if (has(appliance, laundry ? ERD.LAUNDRY_CYCLE : ERD.DISHWASHER_CYCLE_NAME)) {
      add('cycle', 'cycle', '', TEXT, () =>
        text(
          isActive(statusKey(appliance)) || statusKey(appliance) === 'END_OF_CYCLE'
            ? cycleText(appliance)
            : null,
        ),
      );
    }
    if (!laundry && has(appliance, ERD.DISHWASHER_CYCLE_STATE)) {
      add('phase', 'phase', '', TEXT, () => {
        const phase = phaseKey(appliance);
        return text(isActive(statusKey(appliance)) && phase ? PHASE_TEXT[lang][phase] : null);
      });
    }
    if (has(appliance, laundry ? ERD.LAUNDRY_TIME_REMAINING : ERD.DISHWASHER_TIME_REMAINING)) {
      add('remaining_time', 'remaining_time', '', DURATION, () => {
        const { left } = cycleTiming(appliance);
        return isActive(statusKey(appliance)) && left ? left : 0;
      });
      add('end_time', 'end_time', '', TEXT, (now) => endTime(minutesToEnd(appliance), now));
    }
    if (laundry && has(appliance, ERD.LAUNDRY_DELAY_TIME_REMAINING)) {
      add('start_in', 'start_in', '', DURATION, () => {
        const { startIn } = cycleTiming(appliance);
        return statusKey(appliance) === 'DELAYED_START' && startIn ? startIn : 0;
      });
    }
    const door = laundry ? ERD.LAUNDRY_DOOR : ERD.DISHWASHER_DOOR_STATUS;
    if (has(appliance, door)) {
      // GE: 0 open, 1 closed — the same as Gladys' OPENING_SENSOR_STATE (0 open, 1 closed).
      add('door', 'door', '', OPENING, () => {
        const value = int(appliance, door);
        return value === 0 || value === 1 ? value : null;
      });
    }
    if (!laundry && has(appliance, ERD.DISHWASHER_REMOTE_START_ENABLE)) {
      add('remote_control', 'remote_control', '', INPUT, () => {
        const value = decodeBool(raw(appliance, ERD.DISHWASHER_REMOTE_START_ENABLE));
        return value === null ? null : Number(value);
      });
    }
  }

  // --- Ovens and ranges: read only, one or two cavities --------------------------
  if (family === 'oven') {
    const zones = ovenZones(appliance);
    for (const zone of zones) {
      const erds = ZONE_ERDS[zone];
      const prefix = zone === 'lower' ? 'lower_' : '';
      const label = zones.length > 1 ? zone : '';
      add(`${prefix}status`, 'status', label, TEXT, () => statusText(zoneStatus(appliance, zone)));
      if (has(appliance, erds.temperature)) {
        add(`${prefix}temperature`, 'temperature', label, temperatureSensor(unit, 0, 600), () => {
          const value = int(appliance, erds.temperature);
          // 0 when the cavity is off: no reading then.
          return value ? temperatureOut(value, unit) : null;
        });
      }
      if (has(appliance, erds.mode)) {
        add(
          `${prefix}target_temperature`,
          'target_temperature',
          label,
          temperatureSensor(unit, 0, 600),
          () => {
            const mode = raw(appliance, erds.mode);
            const setpoint =
              mode && mode.length >= 6 && decodeInt(mode.slice(0, 2))
                ? decodeInt(mode.slice(2, 6))
                : null;
            return setpoint ? temperatureOut(setpoint, unit) : null;
          },
        );
      }
      if (has(appliance, erds.left)) {
        add(`${prefix}remaining_time`, 'remaining_time', label, DURATION, () => {
          const { left } = cycleTiming(appliance, zone);
          return isActive(zoneStatus(appliance, zone)) && left ? left : 0;
        });
      }
      if (has(appliance, erds.timer)) {
        add(
          `${prefix}kitchen_timer`,
          'kitchen_timer',
          label,
          DURATION,
          () => decodeTimespan(raw(appliance, erds.timer)) ?? 0,
        );
      }
    }
  }

  // --- Refrigerators: temperatures, setpoints, doors, water filter --------------
  if (family === 'fridge') {
    const limits = setpointLimits(appliance);
    const zones = hasFreezer(appliance) ? ['fridge', 'freezer'] : ['fridge'];
    for (const zone of zones) {
      if (has(appliance, ERD.CURRENT_TEMPERATURE)) {
        add(
          `${zone}_temperature`,
          `${zone}_temperature`,
          '',
          temperatureSensor(unit, -20, 60),
          () => {
            const value = compartments(appliance, ERD.CURRENT_TEMPERATURE)[zone];
            return value === null ? null : temperatureOut(value, unit);
          },
        );
      }
      if (has(appliance, ERD.TEMPERATURE_SETTING)) {
        const [minF, maxF] = limits[zone];
        const min = temperatureOut(minF, unit);
        const max = temperatureOut(maxF, unit);
        add(
          `${zone}_target_temperature`,
          `${zone}_target_temperature`,
          '',
          command(CAT.THERMOSTAT, TYPES.THERMOSTAT.TARGET_TEMPERATURE, {
            unit: unitOf(unit),
            min: Math.floor(min),
            max: Math.ceil(max),
          }),
          () => {
            const value = compartments(appliance, ERD.TEMPERATURE_SETTING)[zone];
            return value === null ? null : temperatureOut(value, unit);
          },
          (value) => {
            const number = Number(value);
            const wanted = Number.isFinite(number) ? temperatureIn(number, unit) : NaN;
            if (!(wanted >= minF && wanted <= maxF)) {
              throw new CommandError(fillAll(COMMAND_TEXT.outOfRange, { min, max }), lang);
            }
            const current = compartments(appliance, ERD.TEMPERATURE_SETTING);
            const next = { ...current, [zone]: wanted };
            if (next.fridge === null || (zones.includes('freezer') && next.freezer === null)) {
              throw new CommandError(COMMAND_TEXT.unsupported, lang);
            }
            // Both setpoints travel together: the other one is sent back unchanged.
            const other = raw(appliance, ERD.TEMPERATURE_SETTING).slice(
              zone === 'fridge' ? 2 : 0,
              zone === 'fridge' ? 4 : 2,
            );
            return {
              code: ERD.TEMPERATURE_SETTING,
              value:
                zone === 'fridge'
                  ? `${encodeSignedByte(wanted)}${other}`
                  : `${other}${encodeSignedByte(wanted)}`,
            };
          },
        );
      }
    }
    if (has(appliance, ERD.DOOR_STATUS)) {
      add('door', 'door', '', OPENING, () => {
        const value = raw(appliance, ERD.DOOR_STATUS);
        const doors = [0, 2, 4, 6]
          .map((i) => value.slice(i, i + 2))
          .filter((byte) => byte === '00' || byte === '01');
        if (doors.length === 0) {
          return null;
        }
        // Any door open → open (0); all known doors closed → closed (1).
        return doors.includes('01') ? 0 : 1;
      });
    }
    if (has(appliance, ERD.WATER_FILTER_STATUS)) {
      add('water_filter', 'water_filter', '', TEXT, () => {
        const key = waterFilterKey(appliance);
        return text(key ? FILTER_TEXT[lang][key] : null);
      });
      if (raw(appliance, ERD.WATER_FILTER_STATUS).length >= 6) {
        add(
          'water_filter_life',
          'water_filter_life',
          '',
          {
            category: CAT.MAINTENANCE,
            type: TYPES.MAINTENANCE.LIFE_REMAINING,
            unit: UNITS.PERCENT,
            min: 0,
            max: 100,
            read_only: true,
            has_feedback: false,
            keep_history: true,
          },
          () => {
            const percent = decodeInt(raw(appliance, ERD.WATER_FILTER_STATUS).slice(4, 6));
            return percent === null || percent > 100 ? null : percent;
          },
        );
      }
    }
  }

  // --- Air conditioners ------------------------------------------------------------
  if (family === 'air_conditioner') {
    if (has(appliance, ERD.AC_POWER_STATUS)) {
      add(
        'power',
        'power',
        '',
        command(CAT.AIR_CONDITIONING, TYPES.AIR_CONDITIONING.BINARY),
        () => {
          const value = raw(appliance, ERD.AC_POWER_STATUS);
          return value === '01' ? 1 : value === '00' ? 0 : null;
        },
        (value) => ({ code: ERD.AC_POWER_STATUS, value: Number(value) === 1 ? '01' : '00' }),
      );
    }
    if (has(appliance, ERD.AC_OPERATION_MODE)) {
      const modes = acModes(appliance);
      const codes = [...modes.keys()];
      add(
        'mode',
        'mode',
        '',
        command(CAT.AIR_CONDITIONING, TYPES.AIR_CONDITIONING.MODE, {
          min: Math.min(...codes),
          max: Math.max(...codes),
          supported_options: codes.map((code, index) => ({
            value: code,
            label: OPTION_TEXT[lang][AC_MODE_LABELS[code]],
            sort_order: index,
          })),
        }),
        () => AC_MODE_TO_GLADYS[int(appliance, ERD.AC_OPERATION_MODE)] ?? null,
        (value) => {
          const ge = modes.get(Number(value));
          if (ge === undefined) {
            throw new CommandError(COMMAND_TEXT.unsupported, lang);
          }
          return { code: ERD.AC_OPERATION_MODE, value: encodeInt(ge, 1) };
        },
      );
    }
    if (has(appliance, ERD.AC_TARGET_TEMPERATURE)) {
      const [minF, maxF] = acRange(appliance);
      const min = Math.ceil(temperatureOut(minF, unit));
      const max = Math.floor(temperatureOut(maxF, unit));
      add(
        'target_temperature',
        'target_temperature',
        '',
        command(CAT.AIR_CONDITIONING, TYPES.AIR_CONDITIONING.TARGET_TEMPERATURE, {
          unit: unitOf(unit),
          min,
          max,
        }),
        () => {
          const value = int(appliance, ERD.AC_TARGET_TEMPERATURE);
          return value ? temperatureOut(value, unit) : null;
        },
        (value) => {
          const number = Number(value);
          const wanted = Number.isFinite(number) ? temperatureIn(number, unit) : NaN;
          if (!(wanted >= minF && wanted <= maxF)) {
            throw new CommandError(fillAll(COMMAND_TEXT.outOfRange, { min, max }), lang);
          }
          return { code: ERD.AC_TARGET_TEMPERATURE, value: encodeInt(wanted, 2) };
        },
      );
    }
    if (has(appliance, ERD.AC_FAN_SETTING)) {
      const speeds = acFanSpeeds(appliance);
      add(
        'fan_speed',
        'fan_speed',
        '',
        command(CAT.AIR_CONDITIONING, TYPES.AIR_CONDITIONING.FAN_SPEED, {
          min: Math.min(...speeds),
          max: Math.max(...speeds),
          supported_options: speeds.map((code, index) => ({
            value: code,
            label: OPTION_TEXT[lang][FAN_LABELS[code]],
            sort_order: index,
          })),
        }),
        () => FAN_TO_GLADYS[int(appliance, ERD.AC_FAN_SETTING)] ?? null,
        (value) => {
          const code = Number(value);
          if (!speeds.includes(code)) {
            throw new CommandError(COMMAND_TEXT.unsupported, lang);
          }
          return { code: ERD.AC_FAN_SETTING, value: encodeInt(FAN_FROM_GLADYS[code], 1) };
        },
      );
    }
    if (has(appliance, ERD.AC_AMBIENT_TEMPERATURE)) {
      add('temperature', 'temperature', '', temperatureSensor(unit, -40, 140), () => {
        const value = int(appliance, ERD.AC_AMBIENT_TEMPERATURE);
        return value ? temperatureOut(value, unit) : null;
      });
    }
  }

  // --- GeoSpring water heaters: read only ----------------------------------------
  if (family === 'water_heater') {
    const tenths = (code) => {
      const value = int(appliance, code);
      return value ? temperatureOut(value / 10, unit) : null;
    };
    if (has(appliance, ERD.WH_HEATER_TEMPERATURE)) {
      add('water_temperature', 'water_temperature', '', temperatureSensor(unit, 32, 212), () =>
        tenths(ERD.WH_HEATER_TEMPERATURE),
      );
    }
    if (has(appliance, ERD.WH_HEATER_TARGET_TEMPERATURE)) {
      // The setpoint is shown, never set: a water heater heats.
      add(
        'water_target_temperature',
        'water_target_temperature',
        '',
        temperatureSensor(unit, 32, 212),
        () => tenths(ERD.WH_HEATER_TARGET_TEMPERATURE),
      );
    }
    if (has(appliance, ERD.WH_HEATER_MODE)) {
      add('heater_mode', 'heater_mode', '', TEXT, () => {
        const key = ['HYBRID', 'STANDARD_ELECTRIC', 'HEAT_PUMP', 'HIGH_DEMAND', 'VACATION'][
          int(appliance, ERD.WH_HEATER_MODE)
        ];
        return text(key ? HEATER_MODE_TEXT[lang][key] : null);
      });
    }
  }

  // --- Opal ice makers: read only --------------------------------------------------
  if (family === 'ice_maker') {
    add('status', 'status', '', TEXT, () => statusText(statusKey(appliance)));
  }

  if (hasAlerts(appliance)) {
    add('alerts', 'alerts', '', TEXT, alerts);
  }
  return defs;
}

/** The scene action `appliance_command` (pause, stop): the ERD write, or a refusal. */
export function cycleCommand(appliance, commandKey, language) {
  const lang = pickLanguage(language);
  if (familyOf(appliance) !== 'dishwasher') {
    throw new CommandError(COMMAND_TEXT.notDishwasher, lang);
  }
  if (!isConnected(appliance)) {
    throw new CommandError(COMMAND_TEXT.offline, lang);
  }
  if (decodeBool(raw(appliance, ERD.DISHWASHER_REMOTE_START_ENABLE)) !== true) {
    throw new CommandError(COMMAND_TEXT.remoteDisabled, lang);
  }
  const status = statusKey(appliance);
  // GE's remote command (ERD 0x3204): 1 start/resume (never sent), 2 cancel, 3 pause.
  if (commandKey === 'pause' && status === 'RUNNING') {
    return { code: ERD.DISHWASHER_REMOTE_COMMAND, value: '03' };
  }
  if (commandKey === 'stop' && ['RUNNING', 'PAUSED', 'DELAYED_START'].includes(status)) {
    return { code: ERD.DISHWASHER_REMOTE_COMMAND, value: '02' };
  }
  if (commandKey !== 'pause' && commandKey !== 'stop') {
    throw new CommandError(COMMAND_TEXT.unsupported, lang);
  }
  throw new CommandError(COMMAND_TEXT.notRunning, lang);
}

// --- The Gladys device and its states -------------------------------------------

/** External ids of an appliance. */
export function idsOf(gladys, applianceId) {
  return gladys.externalIds('appliance', applianceId);
}

/**
 * The device published to Gladys for an appliance (null for an unsupported family).
 * @param {object} gladys GladysIntegration (externalIds)
 * @param {object} appliance
 * @param {{ language: string, unit: string }} options
 */
export function buildDevice(gladys, appliance, options) {
  const family = familyOf(appliance);
  if (!family) {
    return null;
  }
  const ids = idsOf(gladys, appliance.id);
  const params = [{ name: 'smarthq_type', value: family }];
  const model = modelOf(appliance);
  if (model) {
    params.push({ name: 'model', value: model });
  }
  return {
    name: applianceName(appliance, options.language),
    external_id: ids.device,
    // The container refreshes by itself (live socket + its own full read, see
    // src/hub.js): Gladys#3198 makes the core's polling unreliable. onPoll
    // stays as a fallback, and skips when the container read recently.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params,
    features: featureDefs(appliance, options).map(({ key, name, spec }) => ({
      name,
      external_id: ids.feature(key),
      ...spec,
    })),
  };
}

/**
 * The states of an appliance, keyed by feature key (a number, or `{ text }`).
 * A value the appliance does not give is left out: Gladys keeps the last one.
 * @param {object} appliance
 * @param {{ language: string, unit: string, now: number }} options
 */
export function stateValues(appliance, options) {
  const values = {};
  const connected = isConnected(appliance);
  for (const def of featureDefs(appliance, options)) {
    if (!connected && !def.key.endsWith('status')) {
      // Not connected: the last known values stay, the state says why.
      continue;
    }
    const value = def.read(options.now);
    if (value !== null && value !== undefined) {
      values[def.key] = value;
    }
  }
  return values;
}

/** The states of an appliance in the `publishStates` format. */
export function buildStates(gladys, appliance, options) {
  if (!familyOf(appliance)) {
    return [];
  }
  const ids = idsOf(gladys, appliance.id);
  return Object.entries(stateValues(appliance, options)).map(([key, value]) =>
    typeof value === 'number'
      ? { device_feature_external_id: ids.feature(key), state: value }
      : { device_feature_external_id: ids.feature(key), text: value.text },
  );
}

// -----------------------------------------------------------------------------
// ERD ("Entity Reference Designator"): the data codes GE appliances expose.
//
// Each ERD is a 16-bit code ("0x2007") whose value travels as a hex string of
// bytes, big endian. The codes and their decoding come from gehomesdk
// (simbaja/gehome, MIT: gehomesdk/erd/erd_codes.py, erd_configuration.py and
// the converters), reduced to what this integration publishes.
//
// Temperatures are in °F on the wire whatever the unit shown on the
// appliance (gehomesdk notes it, Home Assistant hard-codes it).
// -----------------------------------------------------------------------------

export const ERD = {
  MODEL_NUMBER: '0x0001',
  SERIAL_NUMBER: '0x0002',
  APPLIANCE_TYPE: '0x0008',

  // Washers, dryers, washer-dryers
  LAUNDRY_MACHINE_STATE: '0x2000',
  LAUNDRY_END_OF_CYCLE: '0x2002',
  LAUNDRY_TIME_REMAINING: '0x2007', // seconds
  LAUNDRY_CYCLE: '0x200a',
  LAUNDRY_DELAY_TIME_REMAINING: '0x2010', // minutes
  LAUNDRY_DOOR: '0x2012', // 0 open, 1 closed
  LAUNDRY_DRYER_BLOCKED_VENT_FAULT: '0x206f',

  // Dishwashers
  DISHWASHER_OPERATING_MODE: '0x3001',
  DISHWASHER_REMINDERS: '0x3003',
  DISHWASHER_CYCLE_STATE: '0x300e',
  DISHWASHER_CYCLE_NAME: '0x301c',
  DISHWASHER_DOOR_STATUS: '0x3037', // 0 open, 1 closed
  DISHWASHER_REMOTE_START_ENABLE: '0x3087',
  DISHWASHER_REMOTE_COMMAND: '0x3204',
  DISHWASHER_TIME_REMAINING: '0xd004', // minutes

  // Ovens and ranges (read only)
  OVEN_CONFIGURATION: '0x5007',
  UPPER_OVEN_COOK_MODE: '0x5100',
  UPPER_OVEN_CURRENT_STATE: '0x5101',
  UPPER_OVEN_COOK_TIME_REMAINING: '0x5104', // minutes
  UPPER_OVEN_KITCHEN_TIMER: '0x5105', // minutes
  UPPER_OVEN_DISPLAY_TEMPERATURE: '0x5109', // °F, 0 when off
  LOWER_OVEN_COOK_MODE: '0x5200',
  LOWER_OVEN_CURRENT_STATE: '0x5201',
  LOWER_OVEN_COOK_TIME_REMAINING: '0x5204',
  LOWER_OVEN_KITCHEN_TIMER: '0x5205',
  LOWER_OVEN_DISPLAY_TEMPERATURE: '0x5209',

  // Refrigerators
  CURRENT_TEMPERATURE: '0x1004', // fridge, freezer: signed bytes, °F
  TEMPERATURE_SETTING: '0x1005', // same layout, writable
  WATER_FILTER_STATUS: '0x1009',
  SETPOINT_LIMITS: '0x100b', // fridge min, max, freezer min, max
  DOOR_STATUS: '0x1016', // fridge right, left, freezer, drawer: 00 closed, 01 open
  FRIDGE_ALERT_NOTIFICATIONS: '0x122e',

  // Air conditioners (window, portable, split, built-in)
  AC_TARGET_TEMPERATURE: '0x7003', // °F
  AC_FAN_SETTING: '0x7a00',
  AC_OPERATION_MODE: '0x7a01',
  AC_AMBIENT_TEMPERATURE: '0x7a02', // °F
  AC_FILTER_STATUS: '0x7a04',
  AC_POWER_STATUS: '0x7a0f',
  AC_AVAILABLE_MODES: '0x7b00',
  AC_AVAILABLE_FAN_SPEEDS: '0x7b0b',
  SAC_TARGET_TEMPERATURE_RANGE: '0x7b06',

  // GeoSpring water heaters (read only)
  WH_HEATER_MODE: '0x4020',
  WH_HEATER_TARGET_TEMPERATURE: '0x4024', // °F × 10
  WH_HEATER_TEMPERATURE: '0x4026', // °F × 10

  // Opal nugget ice makers (read only)
  OIM_STATUS: '0x9100',
  OIM_FILTER_STATUS: '0x9104',
  OIM_POWER: '0x9107',
};

/** "0X2007", "2007", "0x2007" → "0x2007": the key the cache uses. */
export function normalizeCode(code) {
  const hex = String(code ?? '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase();
  return /^[0-9a-f]{1,4}$/.test(hex) ? `0x${hex.padStart(4, '0')}` : null;
}

/** "0x2007" → "0x2007" as GE writes it in paths ("0x" then upper case). */
export function wireCode(code) {
  return `0x${normalizeCode(code).slice(2).toUpperCase()}`;
}

/** A value as it travels: hex digits only (spaces dropped), or null. */
export function cleanHex(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value.replace(/\s+/g, '');
  return hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex)
    ? hex.toUpperCase()
    : null;
}

/** Unsigned big-endian integer of a hex string, or null. */
export function decodeInt(value) {
  const hex = cleanHex(value);
  if (hex === null || hex.length > 12) {
    return null;
  }
  return Number.parseInt(hex, 16);
}

/** One byte, signed (GE's "hextodec"): "FA" → -6. */
export function decodeSignedByte(hex) {
  const value = decodeInt(hex);
  if (value === null || value > 0xff) {
    return null;
  }
  return value > 127 ? value - 256 : value;
}

export function encodeSignedByte(value) {
  const byte = Math.round(value) < 0 ? Math.round(value) + 256 : Math.round(value);
  return byte.toString(16).padStart(2, '0').toUpperCase();
}

/** Big-endian hex of an integer on `length` bytes. */
export function encodeInt(value, length = 1) {
  return Math.round(value)
    .toString(16)
    .padStart(length * 2, '0')
    .slice(-length * 2)
    .toUpperCase();
}

/** A time span: 0xFFFF means "none" (gehomesdk). */
export function decodeTimespan(value) {
  const number = decodeInt(value);
  return number === null || number === 0xffff ? null : number;
}

/** "01" → true, "00" → false, "FF" or garbage → null. */
export function decodeBool(value) {
  const number = decodeInt(value);
  if (number === null || number === 0xff) {
    return null;
  }
  return number !== 0;
}

/** ASCII text, trailing NUL bytes dropped (the dishwasher cycle name). */
export function decodeString(value) {
  const hex = cleanHex(value);
  if (hex === null) {
    return null;
  }
  const text = Buffer.from(hex, 'hex')
    .toString('latin1')
    .replace(/\0+$/, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-￿]/g, '')
    .trim();
  return text === '' ? null : text;
}

/**
 * Model or serial number: a length byte, then ASCII padded with 00 or FF.
 * Some firmwares send a certificate on this code: anything not printable is
 * refused (gehomesdk issue 490).
 */
export function decodeModelSerial(value) {
  const hex = cleanHex(value);
  if (hex === null || hex.length < 4) {
    return null;
  }
  const bytes = Buffer.from(hex, 'hex');
  const end = Math.min(1 + bytes[0], bytes.length);
  let data = bytes.subarray(1, end);
  while (data.length > 0 && (data.at(-1) === 0 || data.at(-1) === 0xff)) {
    data = data.subarray(0, -1);
  }
  const text = data.toString('latin1');
  return text !== '' && /^[\x20-\x7e]+$/.test(text) ? text.trim() : null;
}

/** Celsius of a Fahrenheit value. */
export function toCelsius(fahrenheit) {
  return ((fahrenheit - 32) * 5) / 9;
}

/** Fahrenheit of a Celsius value. */
export function toFahrenheit(celsius) {
  return (celsius * 9) / 5 + 32;
}

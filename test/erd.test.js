// The ERD decoders, on the byte layouts of gehomesdk's converters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBool,
  decodeInt,
  decodeModelSerial,
  decodeSignedByte,
  decodeString,
  decodeTimespan,
  encodeInt,
  encodeSignedByte,
  normalizeCode,
  toCelsius,
  toFahrenheit,
  wireCode,
} from '../src/erd.js';
import { laundryCycleText } from '../src/laundry-cycles.js';

test('ERD codes are normalized whatever their case', () => {
  assert.equal(normalizeCode('0X2007'), '0x2007');
  assert.equal(normalizeCode('2007'), '0x2007');
  assert.equal(normalizeCode('0xD004'), '0xd004');
  assert.equal(normalizeCode('x'), null);
  assert.equal(wireCode('0xd004'), '0xD004');
});

test('integers, signed bytes, booleans and time spans', () => {
  assert.equal(decodeInt('0A8C'), 2700);
  assert.equal(decodeInt('zz'), null);
  assert.equal(decodeInt('0'), null, 'an odd number of digits is not a value');
  assert.equal(decodeSignedByte('FA'), -6);
  assert.equal(decodeSignedByte('25'), 37);
  assert.equal(encodeSignedByte(-6), 'FA');
  assert.equal(encodeSignedByte(37), '25');
  assert.equal(encodeInt(72, 2), '0048');
  assert.equal(encodeInt(5, 1), '05');
  assert.equal(decodeBool('01'), true);
  assert.equal(decodeBool('00'), false);
  assert.equal(decodeBool('FF'), null);
  assert.equal(decodeTimespan('002D'), 45);
  assert.equal(decodeTimespan('FFFF'), null, '65535 means "none"');
});

test('text, model and serial numbers', () => {
  const text = Buffer.from('AutoSense Wash').toString('hex') + '000000';
  assert.equal(decodeString(text), 'AutoSense Wash');
  const model = `0B${Buffer.from('GFW850SPNRS').toString('hex')}00000000`;
  assert.equal(decodeModelSerial(model), 'GFW850SPNRS');
  assert.equal(decodeModelSerial(`04${Buffer.from('AB').toString('hex')}FFFF`), 'AB');
  // A certificate sent on the serial number code (gehomesdk issue 490) is refused.
  assert.equal(decodeModelSerial(`05${Buffer.from('-\n-\n-').toString('hex')}`), null);
});

test('temperatures convert both ways', () => {
  assert.equal(Math.round(toCelsius(212)), 100);
  assert.equal(toFahrenheit(0), 32);
});

test('washer and dryer cycles keep GE names', () => {
  assert.equal(laundryCycleText(8), 'Normal or mixed load');
  assert.equal(laundryCycleText(50), 'Eco 40 to 60');
  assert.equal(laundryCycleText(134), 'Steam refresh');
  assert.equal(laundryCycleText(0), null);
  assert.equal(laundryCycleText(999), null);
});

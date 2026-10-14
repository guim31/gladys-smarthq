// -----------------------------------------------------------------------------
// Dashboard widget "GE appliances": what is running, and for how long.
//
// One row per appliance of interest (washing, drying, dishes, an oven:
// running, waiting for a delayed start, paused, in alarm, just finished), the
// busiest first: its cycle and phase, when it should end, and a badge with the
// time left or the state. Nothing running: one line says so. Read only:
// commands stay with the device features and the scene action.
//
// Pre-localized from the language Gladys sends with each request (the core
// caches per language). Refreshed every minute (the time left moves), and
// nudged by the hub when an appliance starts, stops or changes state.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  CYCLE_FAMILIES,
  clockTime,
  cycleText,
  cycleTiming,
  familyOf,
  idsOf,
  isConnected,
  minutesToEnd,
  ovenZones,
  phaseKey,
  statusKey,
  zoneStatus,
} from './appliances.js';
import { WIDGET_KEY } from './hub.js';
import { PHASE_TEXT, STATUS_TEXT, WIDGET_TEXT, fill, pickLanguage } from './i18n.js';

/** Rows the widget can show (card-list, list display). */
export const MAX_ROWS = 8;

/** "42 min" or "1 h 05". */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) {
    return `${total} min`;
  }
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`;
}

/** Order of the rows: running first, then waiting, paused, alarm, finished. */
const RANK = {
  RUNNING: 0,
  COOKING: 0,
  PREHEATING: 0,
  CLEANING: 0,
  WARMING: 1,
  PROOFING: 1,
  DELAYED_START: 1,
  PAUSED: 2,
  ALARM: 3,
  END_OF_CYCLE: 4,
};

/** The busiest cavity of an oven (or the appliance itself): { status, zone }. */
function mainState(appliance) {
  if (familyOf(appliance) !== 'oven') {
    return { status: statusKey(appliance), zone: '' };
  }
  const zones = ovenZones(appliance).map((zone) => ({ status: zoneStatus(appliance, zone), zone }));
  return zones.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9))[0];
}

function minutesLeft(appliance) {
  const { zone } = mainState(appliance);
  const { left } = cycleTiming(appliance, zone);
  return left !== null && left > 0 ? left : null;
}

function badgeOf(appliance, lang) {
  const text = WIDGET_TEXT[lang];
  const { status } = mainState(appliance);
  const left = minutesLeft(appliance);
  if (RANK[status] === 0 && left !== null) {
    return { text: formatMinutes(left), color: WIDGET_COLORS.PRIMARY };
  }
  if (status === 'ALARM') {
    return { text: text.alarm, color: WIDGET_COLORS.DANGER };
  }
  if (status === 'END_OF_CYCLE') {
    return { text: text.finished, color: WIDGET_COLORS.SUCCESS };
  }
  if (status === 'PAUSED') {
    return { text: text.paused, color: WIDGET_COLORS.WARNING };
  }
  return { text: STATUS_TEXT[lang][status].slice(0, 16), color: WIDGET_COLORS.INFO };
}

function subtitleOf(appliance, lang, now) {
  const text = WIDGET_TEXT[lang];
  const { status, zone } = mainState(appliance);
  const parts = [];
  if (familyOf(appliance) === 'oven') {
    parts.push(STATUS_TEXT[lang][status]);
  } else {
    const phase = phaseKey(appliance);
    parts.push(
      cycleText(appliance),
      phase && status === 'RUNNING' ? PHASE_TEXT[lang][phase] : null,
    );
  }
  const { startIn } = cycleTiming(appliance, zone);
  if (status === 'DELAYED_START' && startIn) {
    parts.push(fill(text.startsIn, { d: formatMinutes(startIn) }));
  }
  const end = minutesToEnd(appliance, zone);
  if (end) {
    parts.push(fill(text.endsAt, { t: clockTime(new Date(now + end * 60_000), lang) }));
  }
  const shown = parts.filter(Boolean);
  return shown.length > 0 ? shown.join(' · ') : STATUS_TEXT[lang][status];
}

/**
 * The widget content.
 * @param {object} options
 * @param {object} options.gladys
 * @param {ReturnType<import('./hub.js').createHub>} options.hub
 * @param {string} options.language sent by Gladys with the request
 * @param {number} [options.now]
 */
export function buildWidgetContent({ gladys, hub, language, now = Date.now() }) {
  const lang = pickLanguage(language);
  const text = WIDGET_TEXT[lang];
  const body = (value) => ({
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: value }],
  });
  if (!hub.configured) {
    return body(text.notConfigured);
  }
  if (!hub.connected && hub.appliances.size === 0) {
    return body(text.notConnected);
  }
  const created = new Set((gladys.devices ?? []).map((device) => device.external_id));
  const appliances = [...hub.appliances.values()].filter(
    (appliance) => familyOf(appliance) && created.has(idsOf(gladys, appliance.id).device),
  );
  if (appliances.length === 0) {
    return body(text.noDevice);
  }
  const active = appliances
    .filter((appliance) => CYCLE_FAMILIES.includes(familyOf(appliance)))
    .filter((appliance) => isConnected(appliance) && mainState(appliance).status in RANK)
    .sort(
      (a, b) =>
        RANK[mainState(a).status] - RANK[mainState(b).status] ||
        (minutesLeft(a) ?? Infinity) - (minutesLeft(b) ?? Infinity),
    );
  if (active.length === 0) {
    return body(text.nothing);
  }
  const runningCount = active.filter((appliance) => RANK[mainState(appliance).status] === 0).length;
  const components = [];
  if (runningCount > 0) {
    components.push({
      type: 'text',
      variant: 'heading',
      text: fill(text.running, { n: runningCount }),
    });
  }
  components.push({
    type: 'card-list',
    display: 'list',
    items: active.slice(0, MAX_ROWS).map((appliance) => ({
      title: hub.displayName(appliance.id).slice(0, 60),
      subtitle: subtitleOf(appliance, lang, now),
      badge: badgeOf(appliance, lang),
    })),
  });
  return { ttl_seconds: 60, components };
}

/** Handlers of the widgets declared in the manifest, by key. */
export function createWidgets({ gladys, hub }) {
  return {
    [WIDGET_KEY]: {
      get: ({ language }) => buildWidgetContent({ gladys, hub, language }),
    },
  };
}

// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface: English, French, German (informal "du") and Spanish (formal
// "usted"). Brands (GE Appliances, SmartHQ, GeoSpring, Opal, Gladys) are never
// translated; the vocabulary follows the Gladys interface
// (front/src/config/i18n). Washer and dryer cycle names stay GE's, in English.
//
// Two shapes:
//   - tables written one language at a time (NAMES, STATUS_TEXT…):
//     `TABLE[lang][key]`;
//   - multi-language objects sent to Gladys as such (connection statuses,
//     action messages): `{ en, fr, de, es }`, Gladys picks the user's language.
// test/i18n.test.js checks both: same keys in every language, no empty text.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/** The language to use, French when unknown (Guilhem's default). */
export function pickLanguage(language) {
  return LANGUAGES.includes(language) ? language : 'fr';
}

/** "{n} appliances" with `{ n: 3 }` → "3 appliances". */
export function fill(text, values = {}) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) =>
    values[key] === undefined ? match : String(values[key]),
  );
}

/** `fill` on every language of a multi-language object. */
export function fillAll(texts, values) {
  return Object.fromEntries(
    Object.entries(texts).map(([lang, text]) => [lang, fill(text, values)]),
  );
}

/** Names of the device features, frozen by Gladys when the device is added. */
export const NAMES = {
  en: {
    status: 'State',
    alerts: 'Alerts',
    cycle: 'Cycle',
    phase: 'Cycle phase',
    remaining_time: 'Remaining time',
    end_time: 'Expected end',
    start_in: 'Delayed start in',
    door: 'Door',
    remote_control: 'Remote control enabled',
    temperature: 'Temperature',
    target_temperature: 'Set temperature',
    kitchen_timer: 'Kitchen timer',
    fridge_temperature: 'Fridge temperature',
    freezer_temperature: 'Freezer temperature',
    fridge_target_temperature: 'Fridge set temperature',
    freezer_target_temperature: 'Freezer set temperature',
    water_filter: 'Water filter',
    water_filter_life: 'Water filter life',
    power: 'On/Off',
    mode: 'Mode',
    fan_speed: 'Fan speed',
    water_temperature: 'Water temperature',
    water_target_temperature: 'Water set temperature',
    heater_mode: 'Heating mode',
    zoned: '{name} ({zone})',
  },
  fr: {
    status: 'État',
    alerts: 'Alertes',
    cycle: 'Programme',
    phase: 'Phase du cycle',
    remaining_time: 'Temps restant',
    end_time: 'Fin prévue',
    start_in: 'Départ différé dans',
    door: 'Porte',
    remote_control: 'Commande à distance activée',
    temperature: 'Température',
    target_temperature: 'Température de consigne',
    kitchen_timer: 'Minuteur',
    fridge_temperature: 'Température du réfrigérateur',
    freezer_temperature: 'Température du congélateur',
    fridge_target_temperature: 'Consigne du réfrigérateur',
    freezer_target_temperature: 'Consigne du congélateur',
    water_filter: 'Filtre à eau',
    water_filter_life: 'Durée de vie du filtre à eau',
    power: 'Marche/Arrêt',
    mode: 'Mode',
    fan_speed: 'Vitesse de ventilation',
    water_temperature: "Température de l'eau",
    water_target_temperature: "Consigne de l'eau",
    heater_mode: 'Mode de chauffe',
    zoned: '{name} ({zone})',
  },
  de: {
    status: 'Zustand',
    alerts: 'Warnungen',
    cycle: 'Programm',
    phase: 'Programmphase',
    remaining_time: 'Restzeit',
    end_time: 'Voraussichtliches Ende',
    start_in: 'Startvorwahl in',
    door: 'Tür',
    remote_control: 'Fernsteuerung aktiviert',
    temperature: 'Temperatur',
    target_temperature: 'Solltemperatur',
    kitchen_timer: 'Kurzzeitwecker',
    fridge_temperature: 'Kühlschranktemperatur',
    freezer_temperature: 'Gefrierfachtemperatur',
    fridge_target_temperature: 'Kühlschrank-Sollwert',
    freezer_target_temperature: 'Gefrierfach-Sollwert',
    water_filter: 'Wasserfilter',
    water_filter_life: 'Lebensdauer des Wasserfilters',
    power: 'Ein/Aus',
    mode: 'Modus',
    fan_speed: 'Lüftergeschwindigkeit',
    water_temperature: 'Wassertemperatur',
    water_target_temperature: 'Warmwasser-Sollwert',
    heater_mode: 'Heizmodus',
    zoned: '{name} ({zone})',
  },
  es: {
    status: 'Estado',
    alerts: 'Alertas',
    cycle: 'Programa',
    phase: 'Fase del ciclo',
    remaining_time: 'Tiempo restante',
    end_time: 'Fin previsto',
    start_in: 'Inicio diferido en',
    door: 'Puerta',
    remote_control: 'Control remoto activado',
    temperature: 'Temperatura',
    target_temperature: 'Temperatura de consigna',
    kitchen_timer: 'Temporizador',
    fridge_temperature: 'Temperatura del frigorífico',
    freezer_temperature: 'Temperatura del congelador',
    fridge_target_temperature: 'Consigna del frigorífico',
    freezer_target_temperature: 'Consigna del congelador',
    water_filter: 'Filtro de agua',
    water_filter_life: 'Vida útil del filtro de agua',
    power: 'Encendido/Apagado',
    mode: 'Modo',
    fan_speed: 'Velocidad del ventilador',
    water_temperature: 'Temperatura del agua',
    water_target_temperature: 'Consigna del agua',
    heater_mode: 'Modo de calentamiento',
    zoned: '{name} ({zone})',
  },
};

/** The two cavities of a double oven. */
export const ZONE_NAMES = {
  en: { upper: 'upper oven', lower: 'lower oven' },
  fr: { upper: 'four du haut', lower: 'four du bas' },
  de: { upper: 'oberer Backofen', lower: 'unterer Backofen' },
  es: { upper: 'horno superior', lower: 'horno inferior' },
};

/** States of an appliance (the `status` feature and the widget). */
export const STATUS_TEXT = {
  en: {
    OFF: 'Off',
    STANDBY: 'Standby',
    RUNNING: 'Running',
    PAUSED: 'Paused',
    END_OF_CYCLE: 'Cycle finished',
    DELAYED_START: 'Delayed start',
    ALARM: 'Alarm',
    LOCKED: 'Controls locked',
    PREHEATING: 'Preheating',
    COOKING: 'Cooking',
    WARMING: 'Keeping warm',
    PROOFING: 'Proofing',
    CLEANING: 'Cleaning',
    MAKING_ICE: 'Making ice',
    DEFROSTING: 'Defrosting',
    ICE_FULL: 'Ice bin full',
    ADD_WATER: 'Add water',
    BIN_MISSING: 'Ice bin missing',
    NO_WATER_SOURCE: 'No water source',
    LID_OPEN: 'Lid open',
    IDLE: 'Idle',
    NOT_CONNECTED: 'Not connected',
    UNKNOWN: 'Unknown',
  },
  fr: {
    OFF: 'Arrêté',
    STANDBY: 'En veille',
    RUNNING: 'En marche',
    PAUSED: 'En pause',
    END_OF_CYCLE: 'Cycle terminé',
    DELAYED_START: 'Départ différé',
    ALARM: 'Alarme',
    LOCKED: 'Commandes verrouillées',
    PREHEATING: 'Préchauffage',
    COOKING: 'Cuisson',
    WARMING: 'Maintien chaud',
    PROOFING: 'Levée de pâte',
    CLEANING: 'Nettoyage',
    MAKING_ICE: 'Production de glace',
    DEFROSTING: 'Dégivrage',
    ICE_FULL: 'Bac à glaçons plein',
    ADD_WATER: "Ajouter de l'eau",
    BIN_MISSING: 'Bac à glaçons absent',
    NO_WATER_SOURCE: "Pas d'arrivée d'eau",
    LID_OPEN: 'Couvercle ouvert',
    IDLE: 'Inactif',
    NOT_CONNECTED: 'Non connecté',
    UNKNOWN: 'Inconnu',
  },
  de: {
    OFF: 'Aus',
    STANDBY: 'Bereitschaft',
    RUNNING: 'Läuft',
    PAUSED: 'Pausiert',
    END_OF_CYCLE: 'Programm beendet',
    DELAYED_START: 'Startvorwahl',
    ALARM: 'Alarm',
    LOCKED: 'Tasten gesperrt',
    PREHEATING: 'Vorheizen',
    COOKING: 'Garen',
    WARMING: 'Warmhalten',
    PROOFING: 'Gärstufe',
    CLEANING: 'Reinigung',
    MAKING_ICE: 'Eisbereitung',
    DEFROSTING: 'Abtauen',
    ICE_FULL: 'Eisbehälter voll',
    ADD_WATER: 'Wasser nachfüllen',
    BIN_MISSING: 'Eisbehälter fehlt',
    NO_WATER_SOURCE: 'Kein Wasserzulauf',
    LID_OPEN: 'Deckel offen',
    IDLE: 'Inaktiv',
    NOT_CONNECTED: 'Nicht verbunden',
    UNKNOWN: 'Unbekannt',
  },
  es: {
    OFF: 'Apagado',
    STANDBY: 'En espera',
    RUNNING: 'En marcha',
    PAUSED: 'En pausa',
    END_OF_CYCLE: 'Ciclo terminado',
    DELAYED_START: 'Inicio diferido',
    ALARM: 'Alarma',
    LOCKED: 'Mandos bloqueados',
    PREHEATING: 'Precalentando',
    COOKING: 'Cocinando',
    WARMING: 'Mantener calor',
    PROOFING: 'Fermentando masa',
    CLEANING: 'Limpieza',
    MAKING_ICE: 'Haciendo hielo',
    DEFROSTING: 'Descongelando',
    ICE_FULL: 'Depósito de hielo lleno',
    ADD_WATER: 'Añadir agua',
    BIN_MISSING: 'Falta el depósito de hielo',
    NO_WATER_SOURCE: 'Sin toma de agua',
    LID_OPEN: 'Tapa abierta',
    IDLE: 'Inactivo',
    NOT_CONNECTED: 'No conectado',
    UNKNOWN: 'Desconocido',
  },
};

/** Phases of a dishwasher cycle (ERD 0x300e). */
export const PHASE_TEXT = {
  en: {
    PRE_WASH: 'Pre-wash',
    SENSING: 'Sensing',
    MAIN_WASH: 'Main wash',
    DRYING: 'Drying',
    SANITIZING: 'Sanitizing',
    RINSING: 'Rinsing',
    PAUSE: 'Pause',
  },
  fr: {
    PRE_WASH: 'Prélavage',
    SENSING: 'Détection',
    MAIN_WASH: 'Lavage principal',
    DRYING: 'Séchage',
    SANITIZING: 'Désinfection',
    RINSING: 'Rinçage',
    PAUSE: 'Pause',
  },
  de: {
    PRE_WASH: 'Vorspülen',
    SENSING: 'Erkennung',
    MAIN_WASH: 'Hauptspülgang',
    DRYING: 'Trocknen',
    SANITIZING: 'Hygienespülen',
    RINSING: 'Klarspülen',
    PAUSE: 'Pause',
  },
  es: {
    PRE_WASH: 'Prelavado',
    SENSING: 'Detección',
    MAIN_WASH: 'Lavado principal',
    DRYING: 'Secado',
    SANITIZING: 'Desinfección',
    RINSING: 'Aclarado',
    PAUSE: 'Pausa',
  },
};

/** States of a refrigerator water filter (ERD 0x1009). */
export const FILTER_TEXT = {
  en: {
    GOOD: 'Good',
    REPLACE: 'Order a new filter',
    EXPIRED: 'Replace now',
    UNFILTERED: 'Bypass plug (no filter)',
    LEAK_DETECTED: 'Leak detected',
  },
  fr: {
    GOOD: 'Bon',
    REPLACE: 'Commander un filtre',
    EXPIRED: 'À remplacer',
    UNFILTERED: 'Bouchon (sans filtre)',
    LEAK_DETECTED: 'Fuite détectée',
  },
  de: {
    GOOD: 'Gut',
    REPLACE: 'Neuen Filter bestellen',
    EXPIRED: 'Jetzt ersetzen',
    UNFILTERED: 'Blindstopfen (kein Filter)',
    LEAK_DETECTED: 'Leck erkannt',
  },
  es: {
    GOOD: 'Bueno',
    REPLACE: 'Pedir un filtro nuevo',
    EXPIRED: 'Reemplazar ahora',
    UNFILTERED: 'Tapón (sin filtro)',
    LEAK_DETECTED: 'Fuga detectada',
  },
};

/** Modes of a GeoSpring water heater (ERD 0x4020). */
export const HEATER_MODE_TEXT = {
  en: {
    HYBRID: 'Hybrid',
    STANDARD_ELECTRIC: 'Standard electric',
    HEAT_PUMP: 'Heat pump',
    HIGH_DEMAND: 'High demand',
    VACATION: 'Vacation',
  },
  fr: {
    HYBRID: 'Hybride',
    STANDARD_ELECTRIC: 'Électrique standard',
    HEAT_PUMP: 'Pompe à chaleur',
    HIGH_DEMAND: 'Forte demande',
    VACATION: 'Vacances',
  },
  de: {
    HYBRID: 'Hybrid',
    STANDARD_ELECTRIC: 'Elektrisch (Standard)',
    HEAT_PUMP: 'Wärmepumpe',
    HIGH_DEMAND: 'Hoher Bedarf',
    VACATION: 'Urlaub',
  },
  es: {
    HYBRID: 'Híbrido',
    STANDARD_ELECTRIC: 'Eléctrico estándar',
    HEAT_PUMP: 'Bomba de calor',
    HIGH_DEMAND: 'Alta demanda',
    VACATION: 'Vacaciones',
  },
};

/** Alerts (the `alerts` feature and the `appliance_alert` trigger). */
export const ALERT_TEXT = {
  en: {
    drain: 'Drain problem',
    vent_blocked: 'Dryer vent blocked',
    rinse_aid: 'Rinse aid low',
    clean_filter: 'Clean the filter',
    water_filter_replace: 'Order a new water filter',
    water_filter_expired: 'Water filter expired',
    water_leak: 'Water leak detected',
    fridge_door: 'Fridge door open',
    freezer_door: 'Freezer door open',
    fridge_too_warm: 'Fridge too warm',
    freezer_too_warm: 'Freezer too warm',
    ac_filter: 'Clean the air filter',
    ice_add_water: 'Add water to the ice maker',
    ice_bin_missing: 'Ice bin missing',
    ice_water_source: 'Ice maker without water',
    ice_filter: 'Ice maker filter expired',
  },
  fr: {
    drain: 'Problème de vidange',
    vent_blocked: 'Évacuation du sèche-linge bouchée',
    rinse_aid: 'Liquide de rinçage bas',
    clean_filter: 'Nettoyer le filtre',
    water_filter_replace: 'Commander un filtre à eau',
    water_filter_expired: 'Filtre à eau périmé',
    water_leak: "Fuite d'eau détectée",
    fridge_door: 'Porte du réfrigérateur ouverte',
    freezer_door: 'Porte du congélateur ouverte',
    fridge_too_warm: 'Réfrigérateur trop chaud',
    freezer_too_warm: 'Congélateur trop chaud',
    ac_filter: 'Nettoyer le filtre à air',
    ice_add_water: "Ajouter de l'eau à la machine",
    ice_bin_missing: 'Bac à glaçons absent',
    ice_water_source: 'Machine à glaçons sans eau',
    ice_filter: 'Filtre de la machine périmé',
  },
  de: {
    drain: 'Abpumpproblem',
    vent_blocked: 'Trockner-Abluft verstopft',
    rinse_aid: 'Klarspüler fast leer',
    clean_filter: 'Filter reinigen',
    water_filter_replace: 'Neuen Wasserfilter bestellen',
    water_filter_expired: 'Wasserfilter abgelaufen',
    water_leak: 'Wasserleck erkannt',
    fridge_door: 'Kühlschranktür offen',
    freezer_door: 'Gefrierfachtür offen',
    fridge_too_warm: 'Kühlschrank zu warm',
    freezer_too_warm: 'Gefrierfach zu warm',
    ac_filter: 'Luftfilter reinigen',
    ice_add_water: 'Wasser in die Eismaschine füllen',
    ice_bin_missing: 'Eisbehälter fehlt',
    ice_water_source: 'Eismaschine ohne Wasser',
    ice_filter: 'Filter der Eismaschine abgelaufen',
  },
  es: {
    drain: 'Problema de desagüe',
    vent_blocked: 'Salida de la secadora obstruida',
    rinse_aid: 'Abrillantador bajo',
    clean_filter: 'Limpiar el filtro',
    water_filter_replace: 'Pedir un filtro de agua',
    water_filter_expired: 'Filtro de agua caducado',
    water_leak: 'Fuga de agua detectada',
    fridge_door: 'Puerta del frigorífico abierta',
    freezer_door: 'Puerta del congelador abierta',
    fridge_too_warm: 'Frigorífico demasiado caliente',
    freezer_too_warm: 'Congelador demasiado caliente',
    ac_filter: 'Limpiar el filtro de aire',
    ice_add_water: 'Añadir agua a la máquina de hielo',
    ice_bin_missing: 'Falta el depósito de hielo',
    ice_water_source: 'Máquina de hielo sin agua',
    ice_filter: 'Filtro de la máquina caducado',
  },
};

/** Labels of the air conditioner modes and fan speeds (Gladys codes). */
export const OPTION_TEXT = {
  en: {
    ac_auto: 'Auto',
    ac_cool: 'Cooling',
    ac_heat: 'Heating',
    ac_dry: 'Drying',
    ac_fan: 'Fan only',
    fan_auto: 'Auto',
    fan_low: 'Low',
    fan_medium: 'Medium',
    fan_high: 'High',
  },
  fr: {
    ac_auto: 'Auto',
    ac_cool: 'Froid',
    ac_heat: 'Chaud',
    ac_dry: 'Déshumidification',
    ac_fan: 'Ventilation',
    fan_auto: 'Auto',
    fan_low: 'Basse',
    fan_medium: 'Moyenne',
    fan_high: 'Haute',
  },
  de: {
    ac_auto: 'Auto',
    ac_cool: 'Kühlen',
    ac_heat: 'Heizen',
    ac_dry: 'Entfeuchten',
    ac_fan: 'Nur Lüfter',
    fan_auto: 'Auto',
    fan_low: 'Niedrig',
    fan_medium: 'Mittel',
    fan_high: 'Hoch',
  },
  es: {
    ac_auto: 'Auto',
    ac_cool: 'Frío',
    ac_heat: 'Calor',
    ac_dry: 'Deshumidificación',
    ac_fan: 'Solo ventilador',
    fan_auto: 'Auto',
    fan_low: 'Baja',
    fan_medium: 'Media',
    fan_high: 'Alta',
  },
};

/** Default device names, when the appliance has no nickname in SmartHQ. */
export const TYPE_NAMES = {
  en: {
    washer: 'Washer',
    dryer: 'Dryer',
    washer_dryer: 'Washer-dryer',
    dishwasher: 'Dishwasher',
    oven: 'Oven',
    fridge: 'Refrigerator',
    air_conditioner: 'Air conditioner',
    water_heater: 'Water heater',
    ice_maker: 'Ice maker',
  },
  fr: {
    washer: 'Lave-linge',
    dryer: 'Sèche-linge',
    washer_dryer: 'Lavante-séchante',
    dishwasher: 'Lave-vaisselle',
    oven: 'Four',
    fridge: 'Réfrigérateur',
    air_conditioner: 'Climatiseur',
    water_heater: 'Chauffe-eau',
    ice_maker: 'Machine à glaçons',
  },
  de: {
    washer: 'Waschmaschine',
    dryer: 'Trockner',
    washer_dryer: 'Waschtrockner',
    dishwasher: 'Geschirrspüler',
    oven: 'Backofen',
    fridge: 'Kühlschrank',
    air_conditioner: 'Klimagerät',
    water_heater: 'Warmwasserbereiter',
    ice_maker: 'Eismaschine',
  },
  es: {
    washer: 'Lavadora',
    dryer: 'Secadora',
    washer_dryer: 'Lavadora-secadora',
    dishwasher: 'Lavavajillas',
    oven: 'Horno',
    fridge: 'Frigorífico',
    air_conditioner: 'Climatizador',
    water_heater: 'Calentador de agua',
    ice_maker: 'Máquina de hielo',
  },
};

/** Texts of the dashboard widget. */
export const WIDGET_TEXT = {
  en: {
    notConfigured: 'Fill in the SmartHQ e-mail and password in the integration settings.',
    notConnected: 'SmartHQ is not connected: see the integration settings.',
    noDevice: 'Add your GE appliances in Gladys (Discover tab) to see them here.',
    nothing: 'No appliance running right now.',
    running: '{n} running',
    endsAt: 'ends at {t}',
    startsIn: 'starts in {d}',
    finished: 'Finished',
    paused: 'Paused',
    alarm: 'Alarm',
  },
  fr: {
    notConfigured:
      "Renseignez l'e-mail et le mot de passe SmartHQ dans les réglages de l'intégration.",
    notConnected: "SmartHQ n'est pas connecté : voyez les réglages de l'intégration.",
    noDevice: 'Ajoutez vos appareils GE dans Gladys (onglet Découverte) pour les voir ici.',
    nothing: 'Aucun appareil en marche pour le moment.',
    running: '{n} en marche',
    endsAt: 'fin à {t}',
    startsIn: 'départ dans {d}',
    finished: 'Terminé',
    paused: 'En pause',
    alarm: 'Alarme',
  },
  de: {
    notConfigured:
      'Trag die E-Mail-Adresse und das Passwort von SmartHQ in den Einstellungen der Integration ein.',
    notConnected: 'SmartHQ ist nicht verbunden: Sieh in den Einstellungen der Integration nach.',
    noDevice: 'Füge deine GE-Geräte in Gladys hinzu (Reiter Entdecken), um sie hier zu sehen.',
    nothing: 'Gerade läuft kein Gerät.',
    running: '{n} laufen',
    endsAt: 'Ende um {t}',
    startsIn: 'Start in {d}',
    finished: 'Beendet',
    paused: 'Pausiert',
    alarm: 'Alarm',
  },
  es: {
    notConfigured:
      'Indique el correo electrónico y la contraseña de SmartHQ en los ajustes de la integración.',
    notConnected: 'SmartHQ no está conectado: consulte los ajustes de la integración.',
    noDevice: 'Añada sus aparatos GE en Gladys (pestaña Descubrir) para verlos aquí.',
    nothing: 'Ningún aparato en marcha en este momento.',
    running: '{n} en marcha',
    endsAt: 'termina a las {t}',
    startsIn: 'empieza en {d}',
    finished: 'Terminado',
    paused: 'En pausa',
    alarm: 'Alarma',
  },
};

/** Connection statuses shown in the Configuration screen. */
export const CONNECTION_TEXT = {
  missingCredentials: {
    en: 'Fill in the e-mail and password of your SmartHQ account.',
    fr: 'Renseignez l’e-mail et le mot de passe de votre compte SmartHQ.',
    de: 'Trag die E-Mail-Adresse und das Passwort deines SmartHQ-Kontos ein.',
    es: 'Indique el correo electrónico y la contraseña de su cuenta SmartHQ.',
  },
  refused: {
    en: 'SmartHQ refused the e-mail or the password. Correct them and save: the integration does not try again before.',
    fr: "SmartHQ a refusé l'e-mail ou le mot de passe. Corrigez-les et enregistrez : l'intégration ne réessaie pas avant.",
    de: 'SmartHQ hat die E-Mail-Adresse oder das Passwort abgelehnt. Korrigiere sie und speichere: Vorher versucht es die Integration nicht erneut.',
    es: 'SmartHQ rechazó el correo electrónico o la contraseña. Corríjalos y guarde: la integración no lo vuelve a intentar antes.',
  },
  codeNeeded: {
    en: 'SmartHQ asks for a verification code: run the action "Send the verification code", then "Enter the verification code".',
    fr: "SmartHQ demande un code de vérification : lancez l'action « Envoyer le code de vérification », puis « Saisir le code de vérification ».",
    de: 'SmartHQ verlangt einen Bestätigungscode: Führe die Aktion „Bestätigungscode senden“ aus, dann „Bestätigungscode eingeben“.',
    es: 'SmartHQ pide un código de verificación: ejecute la acción «Enviar el código de verificación» y luego «Introducir el código de verificación».',
  },
  terms: {
    en: 'SmartHQ asks to accept new terms of use: open the SmartHQ app, accept them, then save the configuration again.',
    fr: "SmartHQ demande d'accepter de nouvelles conditions d'utilisation : ouvrez l'application SmartHQ, acceptez-les, puis enregistrez de nouveau la configuration.",
    de: 'SmartHQ verlangt, neue Nutzungsbedingungen zu akzeptieren: Öffne die SmartHQ-App, akzeptiere sie und speichere dann die Konfiguration erneut.',
    es: 'SmartHQ pide aceptar nuevas condiciones de uso: abra la aplicación SmartHQ, acéptelas y guarde de nuevo la configuración.',
  },
  unreachable: {
    en: 'The SmartHQ cloud cannot be reached right now: the integration keeps trying.',
    fr: "Le cloud SmartHQ est injoignable pour le moment : l'intégration réessaie.",
    de: 'Die SmartHQ-Cloud ist gerade nicht erreichbar: Die Integration versucht es weiter.',
    es: 'No se puede acceder a la nube de SmartHQ en este momento: la integración sigue intentándolo.',
  },
};

/** Messages of a refused command (device feature or scene action). */
export const COMMAND_TEXT = {
  unknownDevice: {
    en: 'This appliance is not (or no longer) in the SmartHQ account.',
    fr: "Cet appareil n'est pas (ou plus) dans le compte SmartHQ.",
    de: 'Dieses Gerät ist nicht (mehr) im SmartHQ-Konto.',
    es: 'Este aparato no está (o ya no está) en la cuenta SmartHQ.',
  },
  notLinked: {
    en: 'SmartHQ is not connected: see the integration settings.',
    fr: "SmartHQ n'est pas connecté : voyez les réglages de l'intégration.",
    de: 'SmartHQ ist nicht verbunden: Sieh in den Einstellungen der Integration nach.',
    es: 'SmartHQ no está conectado: consulte los ajustes de la integración.',
  },
  offline: {
    en: 'The appliance is not connected to SmartHQ right now.',
    fr: "L'appareil n'est pas connecté à SmartHQ pour le moment.",
    de: 'Das Gerät ist gerade nicht mit SmartHQ verbunden.',
    es: 'El aparato no está conectado a SmartHQ en este momento.',
  },
  readOnly: {
    en: 'This value is read only: the integration never changes it remotely.',
    fr: "Cette valeur est en lecture seule : l'intégration ne la change jamais à distance.",
    de: 'Dieser Wert ist schreibgeschützt: Die Integration ändert ihn nie aus der Ferne.',
    es: 'Este valor es de solo lectura: la integración nunca lo cambia a distancia.',
  },
  outOfRange: {
    en: 'Value out of range ({min} to {max}).',
    fr: 'Valeur hors limites ({min} à {max}).',
    de: 'Wert außerhalb des Bereichs ({min} bis {max}).',
    es: 'Valor fuera de rango ({min} a {max}).',
  },
  unsupported: {
    en: 'This appliance does not offer this choice.',
    fr: 'Cet appareil ne propose pas ce choix.',
    de: 'Dieses Gerät bietet diese Auswahl nicht an.',
    es: 'Este aparato no ofrece esta opción.',
  },
  notDishwasher: {
    en: 'Pause and stop are only possible on a dishwasher.',
    fr: "La pause et l'arrêt ne sont possibles que sur un lave-vaisselle.",
    de: 'Pausieren und Stoppen gehen nur bei einem Geschirrspüler.',
    es: 'La pausa y la parada solo son posibles en un lavavajillas.',
  },
  remoteDisabled: {
    en: 'Remote control is not enabled on the dishwasher: enable it on the appliance first.',
    fr: "La commande à distance n'est pas activée sur le lave-vaisselle : activez-la d'abord sur l'appareil.",
    de: 'Die Fernsteuerung ist am Geschirrspüler nicht aktiviert: Aktiviere sie zuerst am Gerät.',
    es: 'El control remoto no está activado en el lavavajillas: actívelo primero en el aparato.',
  },
  notRunning: {
    en: 'No cycle running: nothing to pause or stop.',
    fr: 'Aucun cycle en cours : rien à mettre en pause ni à arrêter.',
    de: 'Kein Programm läuft: Nichts zu pausieren oder zu stoppen.',
    es: 'Ningún ciclo en curso: nada que pausar ni detener.',
  },
  failed: {
    en: 'SmartHQ refused the command ({detail}).',
    fr: 'SmartHQ a refusé la commande ({detail}).',
    de: 'SmartHQ hat den Befehl abgelehnt ({detail}).',
    es: 'SmartHQ rechazó la orden ({detail}).',
  },
};

/** Messages of the "Test the connection" action. */
export const TEST_TEXT = {
  ok: {
    en: 'Connected to SmartHQ: {n} appliance(s): {list}.',
    fr: 'Connecté à SmartHQ : {n} appareil(s) : {list}.',
    de: 'Mit SmartHQ verbunden: {n} Gerät(e): {list}.',
    es: 'Conectado a SmartHQ: {n} aparato(s): {list}.',
  },
  none: {
    en: 'Connected to SmartHQ, but the account has no appliance: pair them in the SmartHQ app first.',
    fr: "Connecté à SmartHQ, mais le compte n'a aucun appareil : associez-les d'abord dans l'application SmartHQ.",
    de: 'Mit SmartHQ verbunden, aber das Konto hat kein Gerät: Kopple sie zuerst in der SmartHQ-App.',
    es: 'Conectado a SmartHQ, pero la cuenta no tiene aparatos: vincúlelos primero en la aplicación SmartHQ.',
  },
  failed: {
    en: 'SmartHQ cannot be reached: {detail}',
    fr: 'SmartHQ est injoignable : {detail}',
    de: 'SmartHQ ist nicht erreichbar: {detail}',
    es: 'No se puede acceder a SmartHQ: {detail}',
  },
};

/** Messages of the verification code actions (multi-factor authentication). */
export const CODE_TEXT = {
  sentEmail: {
    en: 'SmartHQ sent a verification code by e-mail: type it with the action "Enter the verification code" within 15 minutes.',
    fr: "SmartHQ a envoyé un code de vérification par e-mail : saisissez-le avec l'action « Saisir le code de vérification » sous 15 minutes.",
    de: 'SmartHQ hat einen Bestätigungscode per E-Mail gesendet: Gib ihn innerhalb von 15 Minuten mit der Aktion „Bestätigungscode eingeben“ ein.',
    es: 'SmartHQ envió un código de verificación por correo electrónico: introdúzcalo con la acción «Introducir el código de verificación» en 15 minutos.',
  },
  sentOther: {
    en: 'SmartHQ sent a verification code ({method}): type it with the action "Enter the verification code" within 15 minutes.',
    fr: "SmartHQ a envoyé un code de vérification ({method}) : saisissez-le avec l'action « Saisir le code de vérification » sous 15 minutes.",
    de: 'SmartHQ hat einen Bestätigungscode gesendet ({method}): Gib ihn innerhalb von 15 Minuten mit der Aktion „Bestätigungscode eingeben“ ein.',
    es: 'SmartHQ envió un código de verificación ({method}): introdúzcalo con la acción «Introducir el código de verificación» en 15 minutos.',
  },
  notNeeded: {
    en: 'SmartHQ signed in without a verification code: the integration is connecting.',
    fr: "SmartHQ a accepté la connexion sans code de vérification : l'intégration se connecte.",
    de: 'SmartHQ hat die Anmeldung ohne Bestätigungscode angenommen: Die Integration verbindet sich.',
    es: 'SmartHQ aceptó el inicio de sesión sin código de verificación: la integración se está conectando.',
  },
  accepted: {
    en: 'Code accepted: the integration is connecting to SmartHQ.',
    fr: "Code accepté : l'intégration se connecte à SmartHQ.",
    de: 'Code angenommen: Die Integration verbindet sich mit SmartHQ.',
    es: 'Código aceptado: la integración se está conectando a SmartHQ.',
  },
  missing: {
    en: 'Type the code SmartHQ sent you.',
    fr: 'Saisissez le code envoyé par SmartHQ.',
    de: 'Gib den Code ein, den SmartHQ dir gesendet hat.',
    es: 'Introduzca el código que le envió SmartHQ.',
  },
  failed: {
    en: 'Verification failed: {detail}',
    fr: 'La vérification a échoué : {detail}',
    de: 'Die Bestätigung ist fehlgeschlagen: {detail}',
    es: 'La verificación falló: {detail}',
  },
};

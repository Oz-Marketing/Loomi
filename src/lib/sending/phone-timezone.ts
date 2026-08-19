// NANP area code → IANA timezone, for TCPA quiet-hours evaluation.
//
// WHY AREA CODE
// ─────────────
// TCPA restricts marketing calls and texts by the time of day at the CALLED
// PARTY's location, not the sender's. We hold no timezone on Contact and no
// reliable city data, but we always hold the phone number we are about to text
// — so its area code is the best proxy available with no new data collection.
//
// It is a proxy, not a fact: numbers port, and people move without changing
// them. That is exactly why ambiguity is modeled explicitly below rather than
// rounded away.
//
// AMBIGUOUS AREA CODES RETURN MULTIPLE ZONES
// ──────────────────────────────────────────
// Several area codes straddle a timezone boundary — 850 covers both Tallahassee
// (Eastern) and Pensacola (Central); 867 covers three Canadian zones. For those
// the lookup returns every candidate, and the quiet-hours check requires the
// send instant to be legal in ALL of them. That intersection is narrower than
// any single zone, which is the correct direction to err: a false "too early"
// costs a short delay, a false "it's fine" costs $500–$1,500 per message.

/** Canonical zones, grouped so the table below stays readable. */
const ZONE = {
  eastern: 'America/New_York',
  central: 'America/Chicago',
  mountain: 'America/Denver',
  /** Arizona — Mountain standard time, no DST. */
  arizona: 'America/Phoenix',
  pacific: 'America/Los_Angeles',
  alaska: 'America/Anchorage',
  hawaii: 'Pacific/Honolulu',
  atlantic: 'America/Halifax',
  newfoundland: 'America/St_Johns',
  /** Saskatchewan — Central standard time, no DST. */
  saskatchewan: 'America/Regina',
  puertoRico: 'America/Puerto_Rico',
  guam: 'Pacific/Guam',
  samoa: 'Pacific/Pago_Pago',
} as const;

/**
 * Area codes that sit wholly inside one zone, written zone-first because that
 * grouping is far easier to audit against a map than a flat 300-row list.
 */
const SINGLE_ZONE: Record<string, string[]> = {
  [ZONE.eastern]: [
    // Northeast
    '203', '475', '860', '959',              // CT
    '302',                                    // DE
    '202',                                    // DC
    '207',                                    // ME
    '410', '443', '667', '240', '301', '227', // MD
    '617', '857', '508', '774', '781', '339', '978', '351', '413', // MA
    '603',                                    // NH
    '201', '551', '609', '640', '732', '848', '856', '862', '973', '908', // NJ
    '212', '646', '332', '917', '718', '347', '929', '516', '631', '934',
    '845', '838', '914', '518', '315', '680', '607', '716', '585',         // NY
    '215', '267', '445', '484', '610', '835', '412', '878', '717', '223',
    '570', '272', '814', '582',               // PA
    '401',                                    // RI
    '802',                                    // VT
    // Southeast
    '404', '470', '678', '762', '706', '912', '229', // GA
    '704', '980', '828', '336', '743', '919', '984', '252', '910', // NC
    '803', '839', '843', '854', '864',        // SC
    '703', '571', '804', '686', '757', '948', '540', '826', '276', '434', // VA
    '304', '681',                             // WV
    '502', '859', '606',                      // KY (eastern half)
    '423', '865',                             // TN (eastern)
    // Florida (all but the western panhandle)
    '305', '786', '321', '407', '689', '352', '386', '561', '727', '754',
    '954', '772', '813', '656', '863', '904', '941', '239',
    // Midwest / Great Lakes
    '216', '330', '234', '440', '419', '567', '513', '283', '614', '380',
    '740', '220', '937', '326',               // OH
    '313', '679', '248', '947', '517', '616', '734', '810', '989', '231',
    '269', '586',                             // MI (lower peninsula)
    '317', '463', '260', '574', '765',        // IN (Indianapolis + north)
    // Canada — Ontario / Quebec
    '416', '647', '437', '905', '289', '365', '742', '613', '343', '519',
    '226', '548', '705', '249',
    '514', '438', '450', '579', '819', '873', '418', '581', '367',
  ],
  [ZONE.central]: [
    '205', '659', '251', '256', '938', '334', // AL
    '501', '479', '870',                      // AR
    '312', '872', '773', '224', '847', '630', '331', '708', '464', '815',
    '779', '217', '447', '309', '618', '730', // IL
    '515', '319', '563', '641', '712',        // IA
    '316', '785', '913',                      // KS (eastern/central)
    '270', '364',                             // KY (western)
    '504', '225', '318', '337', '985',        // LA
    '612', '651', '763', '952', '218', '320', '507', // MN
    '601', '769', '662', '228',               // MS
    '314', '557', '636', '816', '975', '573', '417', // MO
    '402', '531',                             // NE (eastern)
    '405', '572', '918', '539', '580',        // OK
    '615', '629', '731', '901', '931',        // TN (middle/west)
    '214', '469', '972', '945', '210', '726', '512', '737', '361', '806',
    '817', '682', '903', '430', '409', '936', '979', '956', '254', '325',
    '432', '713', '281', '832', '346', '940', '830',                // TX
    '414', '274', '262', '608', '353', '715', '534', '920',         // WI
    '219',                                    // IN (northwest)
    '204', '431',                             // Canada — Manitoba
  ],
  [ZONE.mountain]: [
    '303', '720', '983', '719', '970',        // CO
    '406',                                    // MT
    '505', '575',                             // NM
    '385', '801', '435',                      // UT
    '307',                                    // WY
    '915',                                    // TX — El Paso
    '403', '587', '825', '780', '368',        // Canada — Alberta
  ],
  [ZONE.arizona]: [
    '480', '602', '623', '520',               // AZ (no DST)
  ],
  [ZONE.pacific]: [
    '213', '323', '310', '424', '820', '626', '661', '562', '714', '657',
    '949', '909', '840', '951', '805', '831', '408', '669', '650', '415',
    '628', '510', '341', '925', '707', '369', '916', '279', '530', '559',
    '442', '760', '619', '858', '935', '209', '350',                // CA
    '702', '725', '775',                      // NV
    '503', '971', '458',                      // OR (west)
    '206', '253', '425', '564', '360', '509',  // WA
    '604', '778', '236', '672', '250',         // Canada — BC
  ],
  [ZONE.alaska]: ['907'],
  [ZONE.hawaii]: ['808'],
  [ZONE.atlantic]: ['902', '782', '506'],
  [ZONE.newfoundland]: ['709'],
  [ZONE.saskatchewan]: ['306', '639'],
  [ZONE.puertoRico]: ['787', '939', '340'],
  [ZONE.guam]: ['671', '670'],
  [ZONE.samoa]: ['684'],
};

/**
 * Area codes crossing a timezone line. Every listed zone must permit the send.
 * Kept separate from SINGLE_ZONE so the ambiguity is visible rather than
 * buried in a decision someone made once.
 */
const MULTI_ZONE: Record<string, string[]> = {
  // Florida panhandle: Tallahassee is Eastern, Pensacola is Central.
  '850': [ZONE.eastern, ZONE.central],
  '448': [ZONE.eastern, ZONE.central],
  // Southwest Indiana around Evansville is Central.
  '812': [ZONE.eastern, ZONE.central],
  '930': [ZONE.eastern, ZONE.central],
  // Michigan's Upper Peninsula: four western counties are Central.
  '906': [ZONE.eastern, ZONE.central],
  // Western halves of the Plains states are Mountain.
  '620': [ZONE.central, ZONE.mountain],   // KS
  '308': [ZONE.central, ZONE.mountain],   // NE
  '701': [ZONE.central, ZONE.mountain],   // ND
  '605': [ZONE.central, ZONE.mountain],   // SD
  // Northern Idaho is Pacific, southern is Mountain.
  '208': [ZONE.mountain, ZONE.pacific],
  '986': [ZONE.mountain, ZONE.pacific],
  // Malheur County, Oregon runs on Mountain time.
  '541': [ZONE.pacific, ZONE.mountain],
  // Navajo Nation observes DST while the rest of Arizona does not.
  '928': [ZONE.arizona, ZONE.mountain],
  // Northwestern Ontario west of Thunder Bay is Central.
  '807': [ZONE.eastern, ZONE.central],
  // One area code for all three Canadian territories.
  '867': [ZONE.pacific, ZONE.mountain, ZONE.central],
};

/** Flattened area code → candidate zones, built once at module load. */
const AREA_CODE_ZONES: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [zone, codes] of Object.entries(SINGLE_ZONE)) {
    for (const code of codes) map.set(code, [zone]);
  }
  // Multi-zone entries deliberately overwrite any single-zone entry.
  for (const [code, zones] of Object.entries(MULTI_ZONE)) map.set(code, zones);
  return map;
})();

/**
 * Pull the 3-digit NANP area code out of a phone number.
 *
 * Accepts E.164 (+14355550123), 11-digit (14355550123) and 10-digit
 * (4355550123) forms, plus any punctuation. Returns '' for anything that
 * isn't a plausible NANP number — including non-NANP international numbers,
 * which must not be silently treated as US.
 */
export function areaCodeOf(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  let national = digits;
  if (national.length === 11 && national.startsWith('1')) {
    national = national.slice(1);
  }
  if (national.length !== 10) return '';

  const area = national.slice(0, 3);
  // NANP area codes never start with 0 or 1, and the exchange code can't
  // either. A number failing this isn't dialable as NANP.
  if (!/^[2-9]\d\d$/.test(area)) return '';
  if (!/^[2-9]/.test(national.slice(3, 4))) return '';

  return area;
}

/**
 * Candidate IANA timezones for a phone number.
 *
 * Empty array = unknown (unrecognized or non-NANP area code). Callers decide
 * the fallback; see resolveRecipientZones in sms-quiet-hours.ts, which falls
 * back to the sending account's own timezone rather than guessing.
 */
export function timezonesForPhone(phone: string | null | undefined): string[] {
  const area = areaCodeOf(phone);
  if (!area) return [];
  return AREA_CODE_ZONES.get(area) ?? [];
}

/** True when the area code maps to more than one possible zone. */
export function isAmbiguousAreaCode(phone: string | null | undefined): boolean {
  return timezonesForPhone(phone).length > 1;
}

/** Every area code the table knows. Exposed for coverage tests. */
export function knownAreaCodes(): string[] {
  return [...AREA_CODE_ZONES.keys()];
}

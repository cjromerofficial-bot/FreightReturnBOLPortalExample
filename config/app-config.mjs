// Single place for warehouse, document and freight settings.
// Anything marked confirmed:false is a PLACEHOLDER; in live mode the portal refuses
// to create a BOL that would print a placeholder.

const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);

export const WAREHOUSES = {
  CA: {
    key: 'CA',
    label: 'California (Riverside)',
    name: 'ACME FITNESS RIVERSIDE, CA',
    address1: '100 EXAMPLE AVE',
    address2: '',
    city: 'RIVERSIDE',
    state: 'CA',
    zip: '92501',
    phone: '5555550101',
    email: 'info@example.com',
    hours: '9AM - 5PM',
    confirmed: true,
  },
  PA: {
    key: 'PA',
    label: 'Pennsylvania (Harrisburg)',
    name: 'ACME FITNESS HARRISBURG, PA',
    address1: '200 SAMPLE RD',
    address2: 'SUITE 10',
    city: 'HARRISBURG',
    state: 'PA',
    zip: '17101',
    phone: '5555550102',
    email: 'info@example.com',
    hours: '9AM - 5PM',
    confirmed: true,
  },
};

export const BILL_TO = {
  name: '% EXAMPLE 3PL BILLING',
  company: 'ACME FITNESS LLC',
  address1: 'PO BOX 1000',
  city: 'SPRINGFIELD',
  state: 'IL',
  zip: '62701',
  lines: ['% EXAMPLE 3PL BILLING', 'ACME FITNESS LLC', 'PO BOX 1000', 'SPRINGFIELD, IL  62701'],
  confirmed: true,
};

export const CS_CONTACT = {
  line: 'Acme Customer Support: support@example.com | 5555550100',
  confirmed: true,
};

export const CARRIER = { name: 'R+L CARRIERS', short: 'R+L', serviceLevel: 'STANDARD' };

// Common Acme return packaging (from the original outbound BOLs).
export const PALLET_PRESETS = [
  { label: '48x40x60 Crate', type: 'Crate', length: 48, width: 40, height: 60 },
  { label: '73x46x33 Pallet', type: 'Pallet', length: 73, width: 46, height: 33 },
  { label: '96x40x20 Pallet', type: 'Pallet', length: 96, width: 40, height: 20 },
];

// Acme's NMFC 015520 density subs. Lower bound inclusive, upper bound exclusive (lb/ft³).
export const NMFC_15520_DENSITY_TABLE = [
  { sub: '01', min: 0, max: 1, freightClass: '400' },
  { sub: '02', min: 1, max: 2, freightClass: '300' },
  { sub: '03', min: 2, max: 4, freightClass: '250' },
  { sub: '04', min: 4, max: 6, freightClass: '175' },
  { sub: '05', min: 6, max: 8, freightClass: '125' },
  { sub: '06', min: 8, max: 10, freightClass: '100' },
  { sub: '07', min: 10, max: 12, freightClass: '92.5' },
  { sub: '08', min: 12, max: 15, freightClass: '85' },
  { sub: '09', min: 15, max: 22.5, freightClass: '70' },
  { sub: '10', min: 22.5, max: 30, freightClass: '65' },
  { sub: '11', min: 30, max: 35, freightClass: '60' },
  { sub: '12', min: 35, max: 50, freightClass: '55' },
  { sub: '13', min: 50, max: Infinity, freightClass: '50' },
];

export const FREIGHT = {
  commodity: 'Home Gym Equipment',
  nmfcBase: '015520',
  densityTable: NMFC_15520_DENSITY_TABLE,
  classToolUrl: env('CLASS_TOOL_URL') || 'https://www.freightclasscalc.com/calculator.php',
  palletPresets: PALLET_PRESETS,
  // "Double-check this" ranges. Warn only, never block. (Open question: confirm ranges.)
  ranges: { palletWeightLb: [75, 2500], densityPcf: [3, 30] },
  validClasses: ['50', '55', '60', '65', '70', '77.5', '85', '92.5', '100', '110', '125', '150', '175', '200', '250', '300', '400', '500'],
  maxPallets: 10,
  maxQuoteDaysAhead: 30, // R+L rejects rate quotes with pickup dates more than 30 days out
  // Acme return-pickup policy: R+L needs ~2 business days' notice (no same/next-day), Mon–Fri only,
  // and pickups are always 1–5 PM customer local time (drivers have offloaded and have room).
  minPickupBusinessDays: 2,
  pickupWindow: { ready: '13:00', close: '17:00', label: '1:00–5:00 PM' },
  // R+L's Rate Quote response has no expiration. Open question: how long Acme treats a quote as valid.
  quoteValidHours: Number(env('QUOTE_VALID_HOURS')) || 24,
};

export const RETENTION_DAYS = Number(env('RETENTION_DAYS')) || 365;

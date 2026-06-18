// STB Master Calendar — structure config.
// SECTIONS is the fixed set of colored bands, used directly at runtime.
// OWNERS and CATEGORIES below are the original seed data; at runtime the app
// loads owners and categories live from Notion (see scripts/seed-structure.mjs).

export const SECTIONS = [
  { id: 'campaigns', label: 'CAMPAIGNS',                color: '#2f6fb0' },
  { id: 'holidays',  label: 'HOLIDAYS',                 color: '#c9772f' },
  { id: 'internal',  label: 'INTERNAL',                 color: '#3f9b5c' },
  { id: 'comms',     label: 'COMMS',                    color: '#c0568f' },
  { id: 'products',  label: 'PRODUCTS & DISTRIBUTION',  color: '#7d5ba6' },
  { id: 'events',    label: 'EVENTS / ACTIVATIONS',     color: '#bf4f4c' },
]

export const OWNERS = {
  JO: { name: 'Johnnyo',         color: '#2f6fb0' },
  MS: { name: 'Marin Slanina',   color: '#3f9b5c' },
  BC: { name: 'Brody Chapman',   color: '#c9772f' },
  AH: { name: 'Amy Ha',          color: '#7d5ba6' },
  CC: { name: 'Carlos Cortez',   color: '#bf4f4c' },
  AG: { name: 'Anthony Gorrity', color: '#c0568f' },
}

// 27 categories, grouped by section, in display order.
export const CATEGORIES = [
  // CAMPAIGNS
  { id: 'campaign',          label: 'Campaign',                       section: 'campaigns', owner: 'JO' },
  { id: 'primary-messaging', label: 'Primary Messaging',              section: 'campaigns', owner: 'JO' },
  { id: 'private-events',    label: 'Private Events',                 section: 'campaigns', owner: 'MS' },
  { id: 'lead-products',     label: 'Lead Products',                  section: 'campaigns', owner: 'MS' },
  { id: 'discount-promo',    label: 'Discount / Promo',               section: 'campaigns', owner: 'MS' },
  { id: 'radio-ad',          label: 'Radio Ad Messaging',             section: 'campaigns', owner: 'BC' },
  // HOLIDAYS
  { id: 'brand-holiday',     label: 'Brand Holiday',                  section: 'holidays',  owner: 'MS' },
  { id: 'external-holiday',  label: 'External Holiday',               section: 'holidays',  owner: 'MS' },
  // INTERNAL
  { id: 'content-capture',   label: 'Content Capture', sublabel: 'A: BTS  ·  B: LFS', section: 'internal', owner: 'JO' },
  { id: 'social-giveaways',  label: 'Social Giveaways',               section: 'internal', owner: 'JO' },
  // COMMS
  { id: 'email',             label: 'Email',                          section: 'comms', owner: 'AG' },
  { id: 'social-organic',    label: 'Social Organic',                 section: 'comms', owner: 'AG' },
  // PRODUCTS & DISTRIBUTION
  { id: 'draft-release',     label: 'Draft Release',                  section: 'products', owner: 'AH' },
  { id: 'pkg-taproom',       label: 'Packaging - Taproom Release',    section: 'products', owner: 'AH' },
  { id: 'pkg-distro',        label: 'Packaging - Distro Availability', section: 'products', owner: 'AH' },
  { id: 'seasonal',          label: 'Seasonal',                       section: 'products', owner: 'AH' },
  { id: 'key-chain',         label: 'Key Chain Info', sublabel: 'Grocery & National', section: 'products', owner: 'CC' },
  // EVENTS / ACTIVATIONS  (rows grouped by owner)
  { id: 'daily-activation',  label: 'Daily Taproom Activation',       section: 'events', owner: 'MS' },
  { id: 'taproom-hours',     label: 'Taproom Hours', sublabel: 'blank = business as usual', section: 'events', owner: 'MS' },
  { id: 'food-service',      label: 'Food Service / Menu',            section: 'events', owner: 'MS' },
  { id: 'pavilion-rentals',  label: 'SpindleBarn Rental',             section: 'events', owner: 'MS' },
  { id: 'full-rentals',      label: 'Full Facility Rental',           section: 'events', owner: 'MS' },
  { id: 'semi-rentals',      label: 'Production Room Rental',         section: 'events', owner: 'MS' },
  { id: 'beer-garden',       label: 'Beer Garden Rentals',            section: 'events', owner: 'MS' },
  { id: 'local-events',      label: 'Local Market Events',            section: 'events', owner: 'CC' },
  { id: 'external-events',   label: 'External / Non-Local Market Events', section: 'events', owner: 'CC' },
  { id: 'demos',             label: 'Demos / Samplings',              section: 'events', owner: 'CC' },
]

// ---- Matching an entry's stored category text to a live category row ----

// Normalize a category name for tolerant (case/punctuation-insensitive) matching.
export function norm(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Legacy spreadsheet category names -> the current category label they map to,
// so historical entries still land on the right row.
export const CATEGORY_ALIASES = {
  KEYCHAININFOGROCERYNATIONALINFORMATION: 'Key Chain Info',
  KEYCHAINGROCERYNATIONALINFORMATION: 'Key Chain Info',
  PACKAGINGTAPROOMRELEASE: 'Packaging - Taproom Release',
  PACKAGINGDISTROAVAILABILITY: 'Packaging - Distro Availability',
  CONTENTCAPTUREABTSBLFS: 'Content Capture',
  TAPROOMHOURSBLANKBUSINESSASUSUAL: 'Taproom Hours',
  EXTERNALNONLOCALMARKETEVENTS: 'External / Non-Local Market Events',
  PAVILIONRENTALS: 'SpindleBarn Rental',
  FULLPRIVATEEVENTRENTALS: 'Full Facility Rental',
  SEMIPRIVATERENTALS: 'Production Room Rental',
  SEMIPRIVATERENTALSBREWERYROOM: 'Production Room Rental',
}

// Resolve an entry's stored Category text to one of the live category rows.
// Returns the category id, or null when nothing matches.
export function resolveCategoryId(name, categories) {
  const n = norm(name)
  for (const c of categories) if (norm(c.label) === n) return c.id
  const aliasLabel = CATEGORY_ALIASES[n]
  if (aliasLabel) {
    const an = norm(aliasLabel)
    for (const c of categories) if (norm(c.label) === an) return c.id
  }
  return null
}

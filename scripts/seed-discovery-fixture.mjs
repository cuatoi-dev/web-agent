/**
 * Seed script for the discovery-fixture data stream.
 * Proves data stream mapping resolution and the unsupported-type report.
 * Reads DEV_ES_URL, DEV_ES_USER, DEV_ES_PASSWORD from process.env.
 * Holds no secrets, logs no secrets.
 *
 * Usage:
 *   node scripts/seed-discovery-fixture.mjs          # create
 *   node scripts/seed-discovery-fixture.mjs --drop   # remove
 */

const ES_URL = (process.env.DEV_ES_URL || 'http://elasticsearch:9200').replace(/\/+$/, '');
const ES_USER = process.env.DEV_ES_USER || '';
const ES_PASSWORD = process.env.DEV_ES_PASSWORD || '';
const DS_NAME = 'discovery-fixture-ds';
const TEMPLATE_NAME = 'discovery-fixture-ds-tpl';

const MAPPING_PROPERTIES = {
  '@timestamp': { type: 'date' },
  level: { type: 'keyword' },
  msg: { type: 'text' },                        // no keyword subfield
  latency_ms: { type: 'double' },
  mot_notes: { type: 'match_only_text' },
  geo: { type: 'geo_point' },                   // unsupported
  metric: {                                     // unsupported
    type: 'aggregate_metric_double',
    metrics: ['min', 'max', 'sum', 'value_count'],
    default_metric: 'max',
  },
  span: { type: 'integer_range' },              // unsupported
};

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (ES_USER || ES_PASSWORD) {
    const token = Buffer.from(`${ES_USER}:${ES_PASSWORD}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }
  return headers;
}

async function esRequest(path, options = {}) {
  const url = `${ES_URL}${path}`;
  const headers = { ...getAuthHeaders(), ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  return res;
}

async function dropFixture() {
  console.log(`Dropping data stream ${DS_NAME} and template ${TEMPLATE_NAME}...`);
  const dsRes = await esRequest(`/_data_stream/${DS_NAME}`, { method: 'DELETE' });
  if (dsRes.ok || dsRes.status === 404) {
    console.log(`Data stream ${DS_NAME} dropped (or was absent: ${dsRes.status})`);
  } else {
    console.warn(`DELETE data stream answered ${dsRes.status}`);
  }

  const tplRes = await esRequest(`/_index_template/${TEMPLATE_NAME}`, { method: 'DELETE' });
  if (tplRes.ok || tplRes.status === 404) {
    console.log(`Index template ${TEMPLATE_NAME} dropped (or was absent: ${tplRes.status})`);
  } else {
    console.warn(`DELETE template answered ${tplRes.status}`);
  }
}

async function createFixture() {
  console.log(`Creating index template ${TEMPLATE_NAME}...`);
  const tplBody = {
    index_patterns: [`${DS_NAME}*`],
    data_stream: {},
    template: {
      mappings: {
        properties: MAPPING_PROPERTIES,
      },
    },
  };

  const tplRes = await esRequest(`/_index_template/${TEMPLATE_NAME}`, {
    method: 'PUT',
    body: JSON.stringify(tplBody),
  });
  if (!tplRes.ok) {
    const errText = await tplRes.text();
    throw new Error(`Failed to create index template (${tplRes.status}): ${errText}`);
  }
  console.log(`Index template ${TEMPLATE_NAME} created.`);

  console.log(`Writing 2 bulk documents to ${DS_NAME}...`);
  const now = new Date().toISOString();
  const bulkLines = [
    JSON.stringify({ create: {} }),
    JSON.stringify({
      '@timestamp': now,
      level: 'INFO',
      msg: 'Initial diagnostic message',
      latency_ms: 12.5,
      mot_notes: 'Searchable log note 1',
    }),
    JSON.stringify({ create: {} }),
    JSON.stringify({
      '@timestamp': new Date(Date.now() + 1000).toISOString(),
      level: 'WARN',
      msg: 'Second diagnostic message',
      latency_ms: 45.2,
      mot_notes: 'Searchable log note 2',
    }),
  ];
  const bulkBody = bulkLines.join('\n') + '\n';

  const bulkRes = await esRequest(`/${DS_NAME}/_bulk?refresh=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: bulkBody,
  });
  if (!bulkRes.ok) {
    const errText = await bulkRes.text();
    throw new Error(`Failed to bulk index documents (${bulkRes.status}): ${errText}`);
  }
  const bulkJson = await bulkRes.json();
  if (bulkJson.errors) {
    throw new Error(`Bulk write had errors: ${JSON.stringify(bulkJson.items)}`);
  }
  console.log(`Bulk write successful.`);

  console.log(`Rolling over ${DS_NAME} to generate a second backing index...`);
  const rolloverRes = await esRequest(`/${DS_NAME}/_rollover`, { method: 'POST' });
  if (!rolloverRes.ok) {
    const errText = await rolloverRes.text();
    throw new Error(`Failed to rollover data stream (${rolloverRes.status}): ${errText}`);
  }
  console.log(`Rollover successful.`);

  console.log(`Verifying ${DS_NAME} mapping keys...`);
  const mapRes = await esRequest(`/${DS_NAME}/_mapping`, { method: 'GET' });
  if (!mapRes.ok) {
    const errText = await mapRes.text();
    throw new Error(`Failed to get mapping (${mapRes.status}): ${errText}`);
  }
  const mapJson = await mapRes.json();
  const keys = Object.keys(mapJson);
  console.log(`Backing index keys (${keys.length}): ${keys.join(', ')}`);

  if (keys.length !== 2) {
    throw new Error(`Expected exactly 2 backing index keys, found ${keys.length}`);
  }

  for (const key of keys) {
    const props = mapJson[key]?.mappings?.properties || {};
    const propKeys = Object.keys(props);
    console.log(`Index ${key} property count: ${propKeys.length}`);
    if (propKeys.length !== 8) {
      throw new Error(`Index ${key} expected 8 properties, found ${propKeys.length}: ${propKeys.join(', ')}`);
    }
  }

  console.log(`Discovery fixture ${DS_NAME} successfully seeded.`);
}

async function main() {
  const isDrop = process.argv.includes('--drop');
  if (isDrop) {
    await dropFixture();
  } else {
    // Drop existing first if any, then create
    await dropFixture();
    await createFixture();
  }
}

main().catch((err) => {
  console.error('Error seeding discovery fixture:', err);
  process.exit(1);
});

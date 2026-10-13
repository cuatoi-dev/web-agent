/**
 * Seed script for wide-fixture-v1 Elasticsearch index.
 * Creates a 300-column index with hostile schema features and 500 populated rows.
 * Reads DEV_ES_URL, DEV_ES_USER, DEV_ES_PASSWORD from process.env.
 * Holds no secrets, logs no secrets.
 */

const ES_URL = (process.env.DEV_ES_URL || 'http://elasticsearch:9200').replace(/\/+$/, '');
const ES_USER = process.env.DEV_ES_USER || '';
const ES_PASSWORD = process.env.DEV_ES_PASSWORD || '';
const INDEX_NAME = 'wide-fixture-v1';
const ALIAS_NAME = 'wide-fixture';
const DOC_COUNT = 500;
const BATCH_SIZE = 250;

function getAuthHeaders() {
  const headers = {};
  if (ES_USER || ES_PASSWORD) {
    const token = Buffer.from(`${ES_USER}:${ES_PASSWORD}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }
  return headers;
}

function buildMappingProperties() {
  const properties = {};

  // 1. 60 keyword fields
  properties['id'] = { type: 'keyword' };
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    properties[`category_code_${num}`] = { type: 'keyword' };
  }
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    properties[`status_code_${num}`] = { type: 'keyword' };
  }
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    properties[`region_code_${num}`] = { type: 'keyword' };
  }
  for (let i = 1; i <= 15; i++) {
    const num = String(i).padStart(2, '0');
    properties[`sku_code_${num}`] = { type: 'keyword' };
  }
  for (let i = 1; i <= 14; i++) {
    const num = String(i).padStart(2, '0');
    properties[`tag_code_${num}`] = { type: 'keyword' };
  }

  // 2. 60 text fields WITH .keyword subfield
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`title_${num}`] = {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    };
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`description_${num}`] = {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    };
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`notes_searchable_${num}`] = {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    };
  }

  // 3. 10 text fields WITHOUT keyword subfield
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    properties[`unindexed_notes_${num}`] = { type: 'text' };
  }

  // 4. 60 double fields
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`price_${num}`] = { type: 'double' };
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`revenue_${num}`] = { type: 'double' };
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`score_${num}`] = { type: 'double' };
  }

  // 5. 60 integer / long fields
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`quantity_${num}`] = { type: 'integer' };
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`count_${num}`] = { type: 'integer' };
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    properties[`duration_ms_${num}`] = { type: 'long' };
  }

  // 6. 25 date fields
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    properties[`created_at_${num}`] = { type: 'date' };
  }
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    properties[`updated_at_${num}`] = { type: 'date' };
  }
  for (let i = 1; i <= 5; i++) {
    const num = String(i).padStart(2, '0');
    properties[`event_time_${num}`] = { type: 'date' };
  }

  // 7. 20 boolean fields
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    properties[`is_active_${num}`] = { type: 'boolean' };
  }
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    properties[`flag_enabled_${num}`] = { type: 'boolean' };
  }

  // 8. 2 alias fields
  properties['alias_customer_id'] = { type: 'alias', path: 'id' };
  properties['alias_status'] = { type: 'alias', path: 'status_code_01' };

  // 9. 1 flattened field
  properties['metadata_flat'] = { type: 'flattened' };

  // 10. 1 ip field
  properties['client_ip'] = { type: 'ip' };

  // 11. 1 version field
  properties['app_version'] = { type: 'version' };

  return properties;
}

function generateDocument(index) {
  const numId = String(index).padStart(4, '0');
  const docId = `wf-${numId}`;
  const doc = {};

  // Keyword fields
  doc['id'] = docId;
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    doc[`category_code_${num}`] = `CAT-${((index + i) % 5) + 1}`;
  }
  const statuses = ['PENDING', 'ACTIVE', 'CLOSED', 'SHIPPED', 'CANCELLED'];
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    doc[`status_code_${num}`] = statuses[(index + i) % statuses.length];
  }
  const regions = ['US-EAST', 'US-WEST', 'EU-CENTRAL', 'AP-SOUTHEAST', 'AP-NORTHEAST'];
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    doc[`region_code_${num}`] = regions[(index + i) % regions.length];
  }
  for (let i = 1; i <= 15; i++) {
    const num = String(i).padStart(2, '0');
    doc[`sku_code_${num}`] = `SKU-${((index * 7 + i) % 100) + 100}`;
  }
  for (let i = 1; i <= 14; i++) {
    const num = String(i).padStart(2, '0');
    doc[`tag_code_${num}`] = `TAG-${((index * 3 + i) % 20) + 1}`;
  }

  // Text with keyword
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`title_${num}`] = `Item ${docId} Title ${num}`;
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`description_${num}`] = `Detailed description for item ${docId} field ${num}`;
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`notes_searchable_${num}`] = `Searchable note for item ${docId} entry ${num}`;
  }

  // Text without keyword
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    doc[`unindexed_notes_${num}`] = `Unindexed note body ${docId}-${num}`;
  }

  // Doubles
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`price_${num}`] = Math.round(((index * 1.5 + i * 0.75) % 500 + 9.99) * 100) / 100;
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`revenue_${num}`] = Math.round(((index * 12.3 + i * 4.5) % 10000 + 50.0) * 100) / 100;
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`score_${num}`] = Math.round(((index * 0.1 + i * 0.05) % 10) * 100) / 100;
  }

  // Integer / Long
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`quantity_${num}`] = ((index + i) % 50) + 1;
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`count_${num}`] = ((index * 2 + i) % 100);
  }
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    doc[`duration_ms_${num}`] = ((index * 150 + i * 25) % 50000) + 100;
  }

  // Date
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    doc[`created_at_${num}`] = new Date(Date.UTC(2026, 0, 1 + ((index + i) % 200), (index % 24), (index * 7 + i) % 60)).toISOString();
  }
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    doc[`updated_at_${num}`] = new Date(Date.UTC(2026, 0, 1 + ((index + i) % 200) + 1, (index % 24), (index * 11 + i) % 60)).toISOString();
  }
  for (let i = 1; i <= 5; i++) {
    const num = String(i).padStart(2, '0');
    doc[`event_time_${num}`] = new Date(Date.UTC(2026, 0, 1 + ((index + i) % 200), (index % 24), (index * 13 + i) % 60)).toISOString();
  }

  // Boolean
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    doc[`is_active_${num}`] = ((index + i) % 2 === 0);
  }
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    doc[`flag_enabled_${num}`] = ((index + i) % 3 === 0);
  }

  // Flattened
  doc['metadata_flat'] = {
    env: 'production',
    tier: (index % 3) + 1,
    custom_tag: `tag-${index % 10}`,
  };

  // IP
  doc['client_ip'] = `192.168.${(index >> 8) & 255}.${index & 255}`;

  // Version
  doc['app_version'] = `1.${(index % 10)}.${(index % 20)}`;

  // Note: alias fields are not populated in document body

  return { docId, doc };
}

async function main() {
  const authHeaders = getAuthHeaders();

  console.log(`Target cluster: ${ES_URL}`);
  console.log(`Index: ${INDEX_NAME}, Alias: ${ALIAS_NAME}`);

  // Step 1: Check if index exists and delete it (idempotency)
  const headRes = await fetch(`${ES_URL}/${INDEX_NAME}`, {
    method: 'HEAD',
    headers: authHeaders,
  });

  if (headRes.status === 200) {
    console.log(`Index ${INDEX_NAME} exists. Deleting...`);
    const deleteRes = await fetch(`${ES_URL}/${INDEX_NAME}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    if (!deleteRes.ok && deleteRes.status !== 404) {
      const errText = await deleteRes.text().catch(() => '');
      throw new Error(`Failed to delete index ${INDEX_NAME}: ${deleteRes.status} ${errText}`);
    }
    console.log(`Index ${INDEX_NAME} deleted.`);
  }

  // Step 2: Build mappings and create index with alias
  const properties = buildMappingProperties();
  const propertyKeys = Object.keys(properties);
  console.log(`Built mapping with ${propertyKeys.length} properties.`);

  if (propertyKeys.length !== 300) {
    throw new Error(`Expected exactly 300 properties, but built ${propertyKeys.length}`);
  }

  const createBody = {
    aliases: {
      [ALIAS_NAME]: {},
    },
    mappings: {
      properties,
    },
  };

  const createRes = await fetch(`${ES_URL}/${INDEX_NAME}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new Error(`Failed to create index ${INDEX_NAME}: ${createRes.status} ${errText}`);
  }
  console.log(`Index ${INDEX_NAME} created with alias ${ALIAS_NAME}.`);

  // Step 3: Generate and bulk index 500 documents
  console.log(`Generating and indexing ${DOC_COUNT} documents in batches of ${BATCH_SIZE}...`);
  let sampleDoc = null;

  for (let start = 1; start <= DOC_COUNT; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, DOC_COUNT);
    let ndjson = '';

    for (let i = start; i <= end; i++) {
      const { docId, doc } = generateDocument(i);
      if (!sampleDoc) sampleDoc = doc;
      ndjson += JSON.stringify({ index: { _index: INDEX_NAME, _id: docId } }) + '\n';
      ndjson += JSON.stringify(doc) + '\n';
    }

    const bulkRes = await fetch(`${ES_URL}/${INDEX_NAME}/_bulk?refresh=wait_for`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        ...authHeaders,
      },
      body: ndjson,
    });

    if (!bulkRes.ok) {
      const errText = await bulkRes.text().catch(() => '');
      throw new Error(`Bulk indexing batch ${start}-${end} failed: ${bulkRes.status} ${errText}`);
    }

    const bulkJson = await bulkRes.json();
    if (bulkJson.errors) {
      const firstError = bulkJson.items?.find((item) => item.index?.error)?.index?.error;
      throw new Error(`Bulk indexing error: ${JSON.stringify(firstError)}`);
    }
    console.log(`Indexed batch ${start}-${end} successfully.`);
  }

  // Step 4: Validate count and mappings
  const countRes = await fetch(`${ES_URL}/${INDEX_NAME}/_count`, {
    headers: authHeaders,
  });
  const countJson = await countRes.json();

  const aliasCountRes = await fetch(`${ES_URL}/${ALIAS_NAME}/_count`, {
    headers: authHeaders,
  });
  const aliasCountJson = await aliasCountRes.json();

  const mappingRes = await fetch(`${ES_URL}/${INDEX_NAME}/_mapping`, {
    headers: authHeaders,
  });
  const mappingJson = await mappingRes.json();
  const mappingProperties = mappingJson[INDEX_NAME]?.mappings?.properties || {};
  const mappedFieldCount = Object.keys(mappingProperties).length;

  const mappingCharLength = JSON.stringify(mappingJson).length;
  const sampleDocCharLength = sampleDoc ? JSON.stringify(sampleDoc).length : 0;

  console.log('\n--- Wide Fixture Summary ---');
  console.log(`Index:                  ${INDEX_NAME}`);
  console.log(`Alias:                  ${ALIAS_NAME}`);
  console.log(`Total Mapped Fields:    ${mappedFieldCount}`);
  console.log(`Document Count (Index): ${countJson.count}`);
  console.log(`Document Count (Alias): ${aliasCountJson.count}`);
  console.log(`Raw Schema Size:        ${mappingCharLength} chars`);
  console.log(`Sample Row Size:        ${sampleDocCharLength} chars`);
  console.log('----------------------------\n');

  if (mappedFieldCount !== 300) {
    throw new Error(`Mapping verification failed: expected 300 properties, found ${mappedFieldCount}`);
  }
  if (countJson.count !== DOC_COUNT) {
    throw new Error(`Index count verification failed: expected ${DOC_COUNT}, found ${countJson.count}`);
  }
  if (aliasCountJson.count !== DOC_COUNT) {
    throw new Error(`Alias count verification failed: expected ${DOC_COUNT}, found ${aliasCountJson.count}`);
  }

  console.log('Seeding completed successfully.');
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});

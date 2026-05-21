const fetch = require('node-fetch')
const { Redis } = require('@upstash/redis')

// Initialize Redis directly in script
// Using environment variables
const getRedis = () => {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    throw new Error(
      'Redis environment variables not set. ' +
      'Set KV_REST_API_URL and KV_REST_API_TOKEN'
    )
  }

  return new Redis({ url, token })
}

const PEERINGDB_API =
  'https://www.peeringdb.com/api/net?' +
  'depth=0&limit=10000&' +
  'fields=id,name,asn,info_type,' +
  'info_traffic,info_prefixes4,' +
  'info_prefixes6,policy_general,' +
  'website,status'

const PEERINGDB_CACHE_KEY = 'peeringdb:networks'
const PEERINGDB_INDEX_PREFIX = 'peeringdb:asn-index'
const TTL_SECONDS = 604800 // 7 days

const delay = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms))

const fetchPeeringDB = async (url, attempt = 1) => {
  const MAX_ATTEMPTS = 3

  try {
    console.log(
      `Fetching PeeringDB... attempt ${attempt}`
    )

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      30000
    )

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'IntelreapSync/1.0',
        'Accept': 'application/json'
      }
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(
        `PeeringDB responded with: ${response.status}`
      )
    }

    const data = await response.json()
    console.log(
      `Fetched ${data.data?.length || 0} networks`
    )
    return data

  } catch (error) {
    if (attempt < MAX_ATTEMPTS) {
      const waitMs = attempt * 5000
      console.log(
        `Attempt ${attempt} failed: ${error.message}. ` +
        `Retrying in ${waitMs / 1000}s...`
      )
      await delay(waitMs)
      return fetchPeeringDB(url, attempt + 1)
    }
    throw error
  }
}

const syncPeeringDB = async () => {
  console.log('Starting PeeringDB sync...')
  console.log(
    `Timestamp: ${new Date().toISOString()}`
  )

  const redis = getRedis()

  // Fetch full dataset
  const data = await fetchPeeringDB(PEERINGDB_API)

  if (!data.data || data.data.length === 0) {
    throw new Error('PeeringDB returned no data')
  }

  const networks = data.data.filter(
    n => n.status === 'ok' && n.asn
  )

  console.log(
    `Processing ${networks.length} active networks...`
  )

  // Store full dataset
  await redis.setex(
    PEERINGDB_CACHE_KEY,
    TTL_SECONDS,
    JSON.stringify({
      networks: networks,
      syncedAt: new Date().toISOString(),
      count: networks.length
    })
  )

  console.log('Full dataset stored in cache')

  // Build ASN index for fast lookups
  // Process in batches to avoid memory issues
  const BATCH_SIZE = 100
  let indexed = 0
  let failed = 0

  for (
    let i = 0;
    i < networks.length;
    i += BATCH_SIZE
  ) {
    const batch = networks.slice(i, i + BATCH_SIZE)
    const pipeline = redis.pipeline()

    for (const network of batch) {
      if (!network.asn) continue

      const indexKey =
        `${PEERINGDB_INDEX_PREFIX}:${network.asn}`

      pipeline.setex(
        indexKey,
        TTL_SECONDS,
        JSON.stringify({
          id: network.id,
          name: network.name,
          asn: network.asn,
          info_type: network.info_type,
          info_traffic: network.info_traffic,
          info_prefixes4: network.info_prefixes4,
          info_prefixes6: network.info_prefixes6,
          policy_general: network.policy_general,
          website: network.website
        })
      )

      indexed++
    }

    try {
      await pipeline.exec()
    } catch (batchError) {
      console.error(
        `Batch ${i / BATCH_SIZE + 1} failed:`,
        batchError.message
      )
      failed += batch.length
      indexed -= batch.length
    }

    // Small delay between batches
    // to avoid Redis rate limits
    if (i + BATCH_SIZE < networks.length) {
      await delay(100)
    }

    // Progress reporting
    const progress = Math.min(
      100,
      Math.round(
        ((i + BATCH_SIZE) / networks.length) * 100
      )
    )
    console.log(`Indexing progress: ${progress}%`)
  }

  // Store sync metadata
  await redis.setex(
    'peeringdb:sync-meta',
    TTL_SECONDS,
    JSON.stringify({
      syncedAt: new Date().toISOString(),
      totalNetworks: networks.length,
      indexed: indexed,
      failed: failed,
      nextSync: new Date(
        Date.now() + TTL_SECONDS * 1000
      ).toISOString()
    })
  )

  console.log('\nPeeringDB sync complete:')
  console.log(`Total networks: ${networks.length}`)
  console.log(`Indexed: ${indexed}`)
  console.log(`Failed: ${failed}`)
  console.log(
    `Next sync due: ${new Date(
      Date.now() + TTL_SECONDS * 1000
    ).toISOString()}`
  )
}

// Run sync
syncPeeringDB()
  .then(() => {
    console.log('\nSync completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\nSync failed:', error.message)
    process.exit(1)
  })

const fetch = require('node-fetch')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const tar = require('tar')

const ACCOUNT_ID =
  process.env.MAXMIND_ACCOUNT_ID
const LICENSE_KEY =
  process.env.MAXMIND_LICENSE_KEY

const DATABASES = [
  {
    name: 'GeoLite2-City',
    url: 'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz',
    filename: 'GeoLite2-City.mmdb'
  },
  {
    name: 'GeoLite2-ASN',
    url: 'https://download.maxmind.com/geoip/databases/GeoLite2-ASN/download?suffix=tar.gz',
    filename: 'GeoLite2-ASN.mmdb'
  }
]

const OUTPUT_DIR = path.join(
  __dirname,
  '..',
  'data',
  'geoip'
)

const delay = (ms) =>
  new Promise(resolve => setTimeout(resolve, ms))

const downloadDatabase = async (
  db,
  attempt = 1
) => {
  const MAX_ATTEMPTS = 3

  try {
    console.log(
      `Downloading ${db.name}... attempt ${attempt}`
    )

    if (!ACCOUNT_ID || !LICENSE_KEY) {
      throw new Error(
        'MAXMIND_ACCOUNT_ID and ' +
        'MAXMIND_LICENSE_KEY must be set'
      )
    }

    // Build authenticated URL
    const authUrl = db.url.replace(
      'https://',
      `https://${ACCOUNT_ID}:${LICENSE_KEY}@`
    )

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      120000 // 2 minute timeout for large files
    )

    const response = await fetch(authUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'IntelreapService/1.0'
      }
    })

    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText}`
      )
    }

    const contentLength =
      response.headers.get('content-length')
    console.log(
      `File size: ${
        contentLength
          ? Math.round(contentLength / 1024 / 1024) + 'MB'
          : 'unknown'
      }`
    )

    // Save compressed file temporarily
    const tempFile = path.join(
      OUTPUT_DIR,
      `${db.name}.tar.gz`
    )

    const buffer = await response.buffer()
    fs.writeFileSync(tempFile, buffer)

    console.log(
      `Downloaded ${db.name} successfully`
    )

    return tempFile

  } catch (error) {
    if (attempt < MAX_ATTEMPTS) {
      const waitMs = attempt * 5000
      console.log(
        `Attempt ${attempt} failed: ` +
        `${error.message}. ` +
        `Retrying in ${waitMs / 1000}s...`
      )
      await delay(waitMs)
      return downloadDatabase(db, attempt + 1)
    }
    throw error
  }
}

const extractDatabase = async (
  tempFile,
  db
) => {
  console.log(`Extracting ${db.name}...`)

  // Extract tar.gz
  await tar.extract({
    file: tempFile,
    cwd: OUTPUT_DIR,
    filter: (filePath) =>
      filePath.endsWith('.mmdb')
  })

  // Find the extracted .mmdb file
  // MaxMind nests it in a dated folder
  const extractedFiles = []
  const walkDir = (dir) => {
    const files = fs.readdirSync(dir)
    files.forEach(file => {
      const fullPath = path.join(dir, file)
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        walkDir(fullPath)
      } else if (file.endsWith('.mmdb')) {
        extractedFiles.push(fullPath)
      }
    })
  }
  walkDir(OUTPUT_DIR)

  // Move .mmdb to output directory root
  const targetFile = path.join(
    OUTPUT_DIR,
    db.filename
  )

  for (const extractedFile of extractedFiles) {
    if (
      path.basename(extractedFile) === db.filename
    ) {
      fs.renameSync(extractedFile, targetFile)
      console.log(
        `Extracted to: ${targetFile}`
      )
      break
    }
  }

  // Clean up temp files
  fs.unlinkSync(tempFile)

  // Clean up extracted dated folders
  const items = fs.readdirSync(OUTPUT_DIR)
  items.forEach(item => {
    const fullPath = path.join(OUTPUT_DIR, item)
    if (
      fs.statSync(fullPath).isDirectory()
    ) {
      fs.rmSync(fullPath, { recursive: true })
    }
  })

  // Verify the file exists
  if (!fs.existsSync(targetFile)) {
    throw new Error(
      `${db.filename} not found after extraction`
    )
  }

  const stats = fs.statSync(targetFile)
  console.log(
    `${db.filename} ready: ` +
    `${Math.round(stats.size / 1024 / 1024)}MB`
  )
}

const verifyDatabase = (db) => {
  const filePath = path.join(
    OUTPUT_DIR,
    db.filename
  )

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Verification failed: ${db.filename} not found`
    )
  }

  const stats = fs.statSync(filePath)
  if (stats.size < 1024 * 1024) {
    throw new Error(
      `Verification failed: ${db.filename} is too small (${stats.size} bytes)`
    )
  }

  console.log(
    `Verified: ${db.filename} ` +
    `(${Math.round(stats.size / 1024 / 1024)}MB)`
  )
}

const main = async () => {
  console.log('MaxMind database download starting...')
  console.log(
    `Timestamp: ${new Date().toISOString()}`
  )
  console.log(
    `Account ID: ${ACCOUNT_ID || 'NOT SET'}`
  )
  console.log(
    `License Key: ${LICENSE_KEY ? 'SET' : 'NOT SET'}`
  )

  // Create output directory if needed
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    console.log(`Created directory: ${OUTPUT_DIR}`)
  }

  const results = []

  for (const db of DATABASES) {
    try {
      console.log(`\nProcessing ${db.name}...`)

      const tempFile = await downloadDatabase(db)
      await extractDatabase(tempFile, db)
      verifyDatabase(db)

      results.push({
        name: db.name,
        status: 'success',
        file: db.filename
      })

      console.log(`${db.name} complete`)

    } catch (error) {
      console.error(
        `${db.name} failed: ${error.message}`
      )
      results.push({
        name: db.name,
        status: 'failed',
        error: error.message
      })
    }
  }

  console.log('\nDownload summary:')
  results.forEach(r => {
    const icon = r.status === 'success'
      ? '✓'
      : '✗'
    console.log(
      `${icon} ${r.name}: ${r.status}` +
      (r.error ? ` — ${r.error}` : '')
    )
  })

  const allSucceeded = results.every(
    r => r.status === 'success'
  )

  if (!allSucceeded) {
    const failed = results
      .filter(r => r.status === 'failed')
      .map(r => r.name)
      .join(', ')
    throw new Error(
      `Failed databases: ${failed}`
    )
  }

  console.log(
    '\nAll databases downloaded successfully'
  )
  console.log(
    `Ready at: ${OUTPUT_DIR}`
  )
}

main()
  .then(() => {
    console.log('Download script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error(
      'Download script failed:',
      error.message
    )
    process.exit(1)
  })

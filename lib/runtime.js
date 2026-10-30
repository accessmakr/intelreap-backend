// Detects whether the code runs on Cloudflare Workers
// (the Cache API object caches.default exists there).
const isWorkers =
  typeof caches !== 'undefined' &&
  typeof caches.default !== 'undefined'

module.exports = { isWorkers }

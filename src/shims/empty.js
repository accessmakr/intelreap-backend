// Stand-in for Node-only packages that are not used on Workers.
class Redis {}
module.exports = { Redis, open: async () => { throw new Error('not available on Workers') } }

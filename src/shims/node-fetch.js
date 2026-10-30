// Workers already provide fetch. This lets the existing
// require('node-fetch') calls use it unchanged.
module.exports = (...args) => fetch(...args)
module.exports.default = module.exports

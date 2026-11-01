// The browser never uses the desktop's connections; web/transport.js stands in.
module.exports = class NoHyperswarm { constructor () { throw new Error('Use WebSwarm in the browser') } }

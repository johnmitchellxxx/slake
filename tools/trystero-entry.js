// The one outside library Slake uses: it connects browsers to each other.
// `npm run vendor` bundles it into site/trystero.js (committed, so the site needs no build).
export { joinRoom, selfId } from 'trystero/nostr'

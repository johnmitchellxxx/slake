// Node basics some libraries expect to find in the browser.
import { Buffer } from 'buffer'
export { Buffer }
export const process = { env: {}, nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)), browser: true, version: '', versions: {} }

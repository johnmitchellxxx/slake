// The Theme Studio's live preview loads this same page with #preview and
// sample chat (ui/demo.js); it must not start a real Slake.
if (location.hash !== '#preview') require('./host')

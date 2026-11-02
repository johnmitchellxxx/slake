# Slake

Start a lounge, send the link, talk. No accounts, no passwords, no server.

A lounge is a WebRTC room. Messages live only in the browsers inside it, so when
everyone leaves, the lounge is gone. Public Nostr relays only pass along the
introductions (encrypted with the lounge's secret); after that, browsers talk
directly to each other.

## What's here

- `site/` is the whole app: `index.html`, `app.js` (~190 lines), `style.css`, `themes/*.css`.
  No build step. Open it with any static file server.
- `site/trystero.js` is the one outside library (it connects browsers). Rebuild it with `npm run vendor`.
- `test/lounge.js` runs three browsers through a real lounge (needs Playwright; uses a local relay).

## Run it

    npm install
    npm run serve        # http://localhost:8080

## Make it yours

A theme is one CSS file in `site/themes/`. Copy one, change the variables at the
top (colors, fonts), and add its name to `THEMES` at the top of `site/app.js`.

## How a lounge works

- The link is `https://…/#Lounge-Name~secret`. The secret never leaves the link:
  it's the lounge's password for the relays, so anyone with the link can join.
- Everyone in a lounge sends messages to everyone else. Someone who joins late is
  sent the history by whoever is already there.
- Names are just labels. There are no accounts, so anyone in a lounge could use any name.

## Publish

`tools/publish-web.sh` uploads `site/` to Vercel (needs `VERCEL_TOKEN`).

## The older, bigger Slake

The version with desktop apps, accounts, files, DMs, rooms and the Theme Studio is
saved under the git tag `full-app-0.9.1`.

# Notes for whoever works on Slake next

Slake is a serverless, peer-to-peer chat app (Electron + Hyperswarm). The
owner, Mr. Mitchell, isn't a professional developer: explain things in plain
language, keep the window clean and minimal, keep it hackable.

## How it's built

- `core.js`: the whole engine, no Electron in it. Identity keys, spaces and
  rooms, signed records, the peer protocol, fleeting files, short codes.
- `main.js`: Electron wrapper. Window, menu bar (tray), right-click menus,
  dialogs, update check, IPC handlers. `present()` shapes records for the UI.
- `preload.js`: the only bridge the page gets (`window.slake`).
- `ui/`: plain HTML/CSS/JS. `style.css` is the default look; themes override it.
- `themes/*.css`: shipped themes, copied into the user's themes folder on
  first launch (live-reload on save).
- `test.js`: `npm test` runs several copies on a private offline network.
  Run it after any engine change.

## Model

- Everyone has a **space**; rooms live in their owner's space.
- Each room has its own key (by "epoch"). Holding the key = being in the room.
  Only the owner invites (full invite = the key) or removes (re-key: new key
  sealed to each remaining member).
- Everything in a room is a signed **record**: `room`, `join`, `msg`, `file`,
  `profile`, `rekey`. Sync is "have ids / send missing".
- **Files are fleeting**: 1 hour / 1 day / 1 week, then every copy is deleted;
  the record stays as a stub. Bytes go peer-to-peer, checked by SHA-256. No
  size limit. Files ≤ 50 MB fetch themselves.
- **Short codes**: 5 chars, 15 minutes, owner must be online. Joiner proves
  the code; owner seals the full invite to them. Slow-hashed meeting point.
  Fine for a small group; strengthen as it grows.
- Presence: peers sign their identity into each connection's hello, so
  `onlineIn(room)` knows exactly who's on.
- Names: the emoji pair (from the key) is hidden unless two people share a
  name. Whoever took the name second is asked to rename.

## Theme hooks

Themes can restyle anything. Useful hooks:
- `.msg[data-mine="true"]` your own messages; `data-kind` is `msg` or `file`
- `html[data-platform="mac" | "win" | "other"]`
- `slake: glass` in a theme turns on Mac vibrancy at runtime. **Broken:** on a
  real Mac it shows a plain grey window. Likely fix: create the window with
  vibrancy + transparent background from the start and let opaque themes
  cover it. Glass theme is retired until that's tested on a Mac.
- Fonts: system fonts only (the page's security policy blocks web fonts).

## Theme Studio and wallpapers

- `ui/studio.html/.css/.js`: the Studio window. `ui/studio-gen.js` turns
  settings into CSS and back; Studio themes keep their settings as JSON in a
  `/* slake-studio {...} */` comment so they reopen exactly.
- Preview: the Studio embeds `index.html#preview`; `ui/demo.js` gives it
  sample data when there's no real app behind it, and repaints on
  `postMessage({ type: 'slake-preview', css, wallpaper })`.
- Fonts: a long list of common Mac/Windows fonts, filtered to those
  installed (canvas width check). Plus System / Rounded / Serif / Monospace.
- Wallpapers (`ui/wallpapers.js`): built-ins drawn in CSS/SVG; your own
  pictures are resized and stored in `userData/wallpapers`, served as
  `slakewall://w/<file>`. Settings: `wallpaper` (default) and
  `roomWallpapers[roomId]`. The default never overwrites a room's own.
- `SLAKE_SHOOT=<folder>` runs the real app, drives the Studio, saves a
  theme, sets a room background and writes screenshots. Used to check UI.

## Releasing

Bump `version` in `package.json`, commit, `git tag vX.Y.Z && git push --tags`.
GitHub Actions builds the Mac .dmg and Windows installer and posts them to
Releases. The app checks Releases on launch and every 6 hours. Ask the owner
before tagging: releases are public.

## Decided, for later

- Login (name + password = identity) and device sync, so phones and second
  machines see your rooms. Planned for when there are more than ~5 users.
- Theme Studio and wallpapers are built (see below). Glass-style window
  vibrancy is still off.
- Plugins: only from the user's own plugins folder, never run from chat.
- Phone app comes after login + device sync.
- Friends list. (DMs exist: a DM is a two-person room with `dm: true`; the
  invite is sealed to the other person and delivered once you're connected.)

## Theme preview on the web

`node tools/build-web-preview.js <folder>` builds a static page: the real UI
with sample chat (`ui/demo.js`) and a row of theme buttons. It lives at
pantheon.live/slake. To update it, in the Pantheon Replit shell (repo root):

    rm -rf /tmp/slake && git clone -q --depth 1 https://github.com/johnmitchellxxx/slake /tmp/slake && node /tmp/slake/tools/build-web-preview.js artifacts/pantheon/public/slake && bash scripts/publish-pantheon.sh

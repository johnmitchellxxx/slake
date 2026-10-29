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
- Names: the emoji pair (from the key) is hidden unless two people share a
  name. Whoever took the name second is asked to rename.

## Theme hooks

Themes can restyle anything. Useful hooks:
- `.msg[data-mine="true"]` your own messages; `data-kind` is `msg` or `file`
- `html[data-platform="mac" | "win" | "other"]`
- Put `slake: glass` anywhere in a theme (e.g. its top comment) to get a
  see-through window on Mac (Electron vibrancy). Make backgrounds translucent.
- Fonts: system fonts only (the page's security policy blocks web fonts).

## Releasing

Bump `version` in `package.json`, commit, `git tag vX.Y.Z && git push --tags`.
GitHub Actions builds the Mac .dmg and Windows installer and posts them to
Releases. The app checks Releases on launch and every 6 hours. Ask the owner
before tagging: releases are public.

## Decided, for later

- Login (name + password = identity) and device sync, so phones and second
  machines see your rooms. Planned for when there are more than ~5 users.
- Plugins: only from the user's own plugins folder, never run from chat.
- Phone app comes after login + device sync.
- Friends + DMs (a DM is a two-person room).

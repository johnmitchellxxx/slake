# slake

Chat that lives on your friends' computers. No server, no bill.

Everyone has a **space**. Rooms live in their owner's space. The owner invites
people to a room, and can remove them. Your sidebar shows your own space plus
every room you've been invited to, grouped by whose space it's in.

Every copy of Slake keeps the history of its rooms and passes new messages
along to whoever else in that room is online, the way gossip spreads.

## Run it on your Mac (or PC)

You need Node.js once. If `node --version` in Terminal prints nothing,
install it from https://nodejs.org (the "LTS" button).

Then, in Terminal, from this folder:

```
npm install
npm start
```

The first `npm install` takes a minute (it downloads the app shell).

**One-click launch:** double-click `start-slake.command` in this folder. To put it
on a Stream Deck, drag the **Open** action (under System) onto a key and choose
that file as the App/File. Pressing the key opens Terminal and starts Slake.

**Try it with two people on one computer:** leave the first window open,
open a second Terminal tab in the same folder, and run `npm run second`.
That's a separate person with their own identity. In one window, make a room
with **+ new room**, click **Copy invite**, paste it into the other window's
"Paste an invite" box, and say hi.

**Try it with a friend:** they download this folder, run the same two
commands, and paste your room invite. That's it — no accounts, no sign-up.

## How it works (plain version)

- **You are a key.** On first launch Slake makes a private key that never
  leaves your computer. Every message you send is signed with it, so nobody
  can fake a message from you. The little emoji pair next to each name comes
  from that key — the real Duke always has the same pair.
- **Every room has its own key.** Holding the key is what being in the room
  means. People in one of your rooms can't see your other rooms, or even tell
  they exist.
- **Only the owner invites.** A room's invite carries its key, and only the
  owner can make one. Anyone with the invite can join, so share it privately.
- **Removing someone** makes a fresh room key. Slake seals a copy to each
  remaining member's identity, so only they can open it. The removed person
  keeps what they already saw but can't follow anything new, and posts they
  try to sneak in with the old key get refused.
- **Finding each other.** Computers meet through a big public "phone book"
  spread across thousands of machines that nobody owns. The phone book only
  ever sees a scrambled fingerprint of each room key, never the key.
- **Proving membership.** When two computers connect, each proves which room
  keys it holds without ever sending them. Strangers get disconnected before
  they see anything. The connection itself is encrypted.
- **History.** When you come online you swap notes with whoever's in your
  rooms and catch up on what you missed.

## Make it yours

Click **Edit** next to the theme picker. That opens your themes folder.
Each `.css` file in there is a theme; copy one, rename it, change the colors
at the top, and save — the app repaints instantly. Two examples are included:
`grapevine.css` (light, work-ready) and `terminal.css` (green on black).

Coder friends can go further: the screen is plain HTML/CSS/JS in `ui/`,
the networking is all in `core.js`.

## Where your stuff lives

On a Mac: `~/Library/Application Support/slake/`
- `data/identity.json` — **your private key. Back this file up.** Lose it and
  that identity is gone (there's no "forgot password").
- `data/rooms/<id>.json` — a room's name, owner and keys.
- `data/rooms/<id>.ndjson` — that room's history, one record per line.
- `themes/` — your themes.

## Known limits (on purpose, for now)

- Only the owner can invite or remove. If the owner is offline, the room still
  works, but nobody can be added or removed until they're back.
- An invite made before someone was removed stops working for new messages
  (whoever uses it ends up seeing "You're no longer in this room").
- Messages only travel when at least two members of a room are online at once.
- No direct messages yet (they'll just be two-person rooms), no phones, no
  notifications while the app is closed.
- No recovery phrase yet. Back up `identity.json` by hand.

## For developers

`npm test` runs three copies on a private offline network. John makes two
rooms and invites Bob to one and Sam to both, checks Bob never sees the other
room, joins a room in Bob's space, removes Bob from a room and confirms Bob is
cut off while Sam keeps going, checks forged and tampered records are refused,
and that rooms, keys and history survive a restart.

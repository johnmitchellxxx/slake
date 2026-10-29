# gossip

Chat that lives on your friends' computers. No server, no bill.

Every copy of Gossip keeps the whole conversation and passes new messages
along to whoever else is online — like gossip.

## Run it on your Mac (or PC)

You need Node.js once. If `node --version` in Terminal prints nothing,
install it from https://nodejs.org (the "LTS" button).

Then, in Terminal, from this folder:

```
npm install
npm start
```

The first `npm install` takes a minute (it downloads the app shell).

**Try it with two people on one computer:** leave the first window open,
open a second Terminal tab in the same folder, and run `npm run second`.
That's a separate person with their own identity. Start a group in one,
click **Copy invite link**, paste it into the other, and say hi.

**Try it with a friend:** they download this folder, run the same two
commands, and paste your invite link. That's it — no accounts, no sign-up.

## How it works (plain version)

- **You are a key.** On first launch Gossip makes a private key that never
  leaves your computer. Every message you send is signed with it, so nobody
  can fake a message from you. The little emoji pair next to each name comes
  from that key — the real Duke always has the same pair.
- **The invite link is the house key.** It contains the group's secret.
  Anyone with the link can join and read everything, so share it privately.
- **Finding each other.** Computers meet through a big public "phone book"
  spread across thousands of machines that nobody owns. The phone book only
  ever sees a scrambled fingerprint of your group, never the secret.
- **Proving membership.** When two computers connect, each proves it knows
  the secret without ever sending it. Strangers who find the fingerprint get
  disconnected before they see anything. The connection itself is encrypted.
- **History.** When you come online you swap notes with whoever's there and
  catch up on what you missed. Anything new gets passed along to everyone.

## Make it yours

Click **Edit** next to the theme picker. That opens your themes folder.
Each `.css` file in there is a theme; copy one, rename it, change the colors
at the top, and save — the app repaints instantly. Two examples are included:
`grapevine.css` (light, work-ready) and `terminal.css` (green on black).

Coder friends can go further: the screen is plain HTML/CSS/JS in `ui/`,
the networking is all in `core.js`.

## Where your stuff lives

On a Mac: `~/Library/Application Support/gossip/`
- `data/identity.json` — **your private key. Back this file up.** Lose it and
  that identity is gone (there's no "forgot password").
- `data/group.json` — the group secret.
- `data/messages.ndjson` — the full history, one message per line.
- `themes/` — your themes.

## Known limits of v0.1 (on purpose)

- One group per install.
- Messages only travel when at least two members are online at the same time.
- No phones yet, no notifications while the app is closed, no removing people
  (to kick someone out today: start a fresh group and re-invite everyone else).
- No recovery phrase yet — back up `identity.json` by hand.

## For developers

`npm test` runs three copies on a private offline network: Alice starts a
group, Bob joins late and catches up, and Mallory tries to sneak in with the
group's fingerprint but the wrong secret (she gets kicked). It also checks
that tampered messages are refused and that history survives a restart.

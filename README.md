# slake

Chat that lives on your friends' computers. No server, no bill.

Everyone has a **space**. Rooms live in their owner's space. The owner invites
people to a room, and can remove them. Your sidebar shows your own space plus
every room you've been invited to, grouped by whose space it's in.

Every copy of Slake keeps the history of its rooms and passes new messages
along to whoever else in that room is online, the way gossip spreads.

## Get the app

Download the newest **Slake** from the
[Releases page](https://github.com/johnmitchellxxx/slake/releases):

- **Mac:** `Slake-x.y.z-arm64.dmg` for Apple Silicon (M1 and newer),
  `Slake-x.y.z-x64.dmg` for older Intel Macs. Open it and drag Slake into
  Applications. The first time, macOS will say it can't check the app: go to
  **System Settings → Privacy & Security**, scroll down, and click
  **Open Anyway**. (That goes away once Slake has a paid Apple certificate.)
- **Windows:** `Slake-Setup-x.y.z.exe`. Windows may show "Windows protected
  your PC": click **More info → Run anyway**.

Slake lives in your menu bar (the system tray on Windows). Closing the window
keeps it running, so you stay reachable and others can still grab files
you've shared. Quit from the menu bar icon. Turn on **Open at login** there
too, if you like.

Every time it opens, and every few hours after, Slake checks for a newer
version and shows a note at the bottom of the sidebar when there is one.

**Making a new release** (for whoever maintains this): bump `version` in
`package.json`, commit, then `git tag v0.4.1 && git push --tags`. GitHub builds
both installers and posts them to Releases (see `.github/workflows/release.yml`).

## Run it from the code instead

You need Node.js once. If `node --version` in Terminal prints nothing,
install it from https://nodejs.org (the "LTS" button).

Then, in Terminal, from this folder:

```
npm install
npm start
```

The first `npm install` takes a minute (it downloads the app shell).

**On Windows:** same idea. Install Node.js (LTS) from https://nodejs.org and
Git from https://git-scm.com, then in Command Prompt or PowerShell:

```
git clone https://github.com/johnmitchellxxx/slake.git
cd slake
npm install
npm start
```

After that, double-click `start-slake.bat` in the slake folder to launch.

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

## Files are fleeting

Drag a file onto a room (or click **+**), pick how long it lasts (**1 hour,
1 day or 1 week**), and send. It goes straight from your computer to the
others in the room. There's no upload, no server, and no size limit.
Files up to 50 MB download by themselves; bigger ones have a **Download**
button. Save what you want to keep.

When time's up, every copy of Slake deletes its copy. What stays is a stub
with the file name, when it was sent and when it disappeared. Right-click a
stub to **Ask [them] to resend**, or **Send it again…** if it was yours.
Slake isn't storage; it's delivery.

Someone who has the file needs to be online for you to get it.

## Search

**⌘F** (Ctrl+F on Windows) searches every room, messages and file names.
Click a result to jump to it.

## Make it yours

**Theme Studio:** pick **Make your own…** at the bottom of the theme list (or
click **Edit** next to it). Start from any theme, then change colors, fonts
(any font installed on your computer), text size, corners, spacing, picture
shape, glow, grain, shadows, see-through panels, chat bubbles and cue numbers.
The preview on the right updates as you go. Name it and **Save theme**; it
goes in your list. Studio themes open back up in the Studio exactly as you
left them. Themes are yours alone: nobody else sees them.

**Backgrounds:** the Studio's **Default background** applies to every room
that doesn't have its own. Built in: glass swirl, aurora, dusk, blueprint,
dials and lake contours, or **+** to use your own picture. Blur and Dim keep
text readable. To give one room its own background, right-click it →
**Background…**. Changing the default never touches a room's own background.

### Editing themes by hand

In the Theme Studio, click **Open themes folder**.
Each `.css` file in there is a theme; copy one, rename it, change the colors
at the top, and save — the app repaints instantly. Included:

- **Default**, in Lake (blue), Jade, Iris, Rose or Brass
- **Bubbles**: a texting layout, your messages on the right
- **Showfile**: a lighting console, with a cue number on every message
- **After Hours**: neon signs at night
- **Orchard**: forest green and mandarin orange, with a touch of crest yellow
- **Indigo Mint**: onyx and electric indigo, with a touch of tropical mint
- **Harbor**: navy and seal blue, with a touch of crimson pink
- **Necklace**: Lake Merritt after dark, with the string of lights across each room
- **Terminal**: green on black

Themes can restyle anything, not just colors. Look at `bubbles.css` for an
example that changes the layout, and `necklace.css` for one that draws its own decoration.

**Who's online.** A green dot on someone's picture means their Slake is
connected right now. Each room's header lists who's on.

**Direct messages.** Right-click anyone and choose **Message [name]**. DMs
live in their own section below your rooms. A DM is a private two-person
room; it reaches the other person the moment you're both online.

**Delete a room you own:** right-click it → **Delete room…**. It's gone from
your sidebar right away. Guests see it marked "deleted" for 24 hours, then it
leaves their sidebar too, and nobody can post in it. Each Slake clears the
room from disk a week later (that week lets the news reach people who were
offline).

**Invite with a code.** Right-click a room you own and choose **Invite with a
code…** for a 5-character code like `K7Q2M`. Anyone who types it in the join
box gets in, for 15 minutes, while your Slake is running.

**Names.** If someone else was already using your name in a room you share,
Slake asks you to pick another. When two people do share a name, a ⚠️ and an
emoji pair appear next to each; the pair comes from each person's identity
key, so it tells them apart and can't be faked.

**Right-click is where the actions live.** Right-click a room for its invite,
members, or to leave it. Right-click a message to copy it, or (in your own
rooms) to remove its author.

Coder friends can go further: the screen is plain HTML/CSS/JS in `ui/`,
the networking is all in `core.js`.

## Where your stuff lives

On a Mac: `~/Library/Application Support/slake/`
- `data/identity.json` — **your private key. Back this file up.** Lose it and
  that identity is gone (there's no "forgot password").
- `data/rooms/<id>.json` — a room's name, owner and keys.
- `data/rooms/<id>.ndjson` — that room's history, one record per line.
- `data/files/` — files that haven't disappeared yet. Slake empties this on its own.
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

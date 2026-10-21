# Scythe

*spaCy, but cleaner: a Prodigy for les terminales.*

Scythe is a debate card cutter that doubles as a span-labeling tool. Each team gets its own Scythe server: its accounts, its cards and their history live there and never leave it.

This repo is the **open-source half**:

| | |
| --- | --- |
| `frontend/` | The web app (React + Vite). Each team's server serves it from its own domain. |
| `api/` | The contract every client builds against: [`openapi.json`](api/openapi.json) (the HTTP API), [`format.md`](api/format.md) (the card, source and settings files) and [`nsda_topics.json`](api/nsda_topics.json). |
| `features/` | What Scythe should do, as Gherkin features written from a debater's side. |
| `scripts/` | [`nsda_topics.py`](scripts/nsda_topics.py): refreshes `api/nsda_topics.json` from [speechanddebate.org/topics](https://www.speechanddebate.org/topics/). The `topics` workflow runs it monthly and opens a PR. It only adds topics: slugs are ids, and cards are filed under them. |

The server itself is private. The iOS app is a separate, private repo.

**How Scythe works:**
- **Git is the record.** A team's server holds a bare git repository:
  - each card is `cards/<n>.md`
  - each source is `sources/<n>.md`
  - each case is `cases/<n>.md`: a title, then the case in Markdown; written in the case editor (`/cases/`, served by the team's server); a line read from a card is `[“its exact words”](/#/cards/<n>?words=<start>-<end>)`, checked against the card when it's added, and opens the card with those words marked
  - shared labels, custom topics and the library order are in `scythe.json`

  Every edit is a commit authored by the person who made it, under their public handle.
- **Saves are compare-and-swap.** A save is pinned to the version of the file you opened. If someone else committed first, the server refuses it the way git refuses a non-fast-forward push (409, with their version). The app then offers *rebase mine onto theirs*, *keep theirs*, or *force mine*.
- **The index is derived.** Search, the knowledge graph, spaCy tokens, entities and model suggestions are rebuilt from the files and never committed.
- **Spans are token-aligned.** Every span is snapped to spaCy's tokens exactly as `doc.char_span(..., alignment_mode="expand")` would (see [`api/format.md`](api/format.md#token-alignment)).
- **Accounts are Scythe's own, and a team's server is members only.** Nothing can be read or changed without signing in. A new account needs an invite code from one of the team's admins. People sign in with a passkey or an email + password. Sign in with Apple becomes available once the account holds a passkey.
- **No LLMs anywhere.** The NLP is spaCy (`en_core_web_sm`) and nothing else.

### Sign in

| Method | What Scythe stores |
| --- | --- |
| **Passkey** (WebAuthn: Face ID / Touch ID / device passcode required) | The credential id and public key only. The private key stays on the person's devices; Apple syncs it through iCloud Keychain, end-to-end encrypted. Passkeys are discoverable, so signing in needs no handle or email. |
| **Email + password** | An HMAC digest of the email for lookup, plus a Fernet-encrypted copy. The password is hashed with Argon2. |
| **Sign in with Apple** (only once the account has a passkey) | An HMAC digest of Apple's per-app user id. The identity token is checked against Apple's keys, our audiences, expiry and a single-use nonce. |

The rules:
- An account must always keep a passkey or an email + password.
- Removing the last passkey also unlinks Apple.
- Sign-in returns a bearer token (`Authorization: Bearer scy_…`). Only its SHA-256 is stored, and it lasts 30 days.
- Making an account needs an invite: `invite` on `POST /api/auth/register` and on `POST /api/auth/passkeys/register/options`. A code is used up when the account is made, expires after 14 days by default, and can be revoked. Only an HMAC digest of it is stored.
- Admins make and revoke invites, list members, remove them and make them admins (`/api/auth/invites`, `/api/auth/members`). Removing a member revokes all of their sign-ins at once. A team always keeps at least one admin.
- Commits carry the handle at `users.noreply.scythe` and never a real email. Many users are minors.

### What Scythe should do

[`features/`](features/) holds 18 Gherkin features, each scenario tagged `@built`, `@partly` or `@missing`. The server's CI runs them all in a browser against a throwaway server and this web app. [`features/README.md`](features/README.md) has the gap table.

### The API

Every team server serves the same API at `/api/`. The contract is [`api/openapi.json`](api/openapi.json), generated from the server; the server's CI fails if the two drift.

| | |
| --- | --- |
| `/api/auth/…` | `register`, `login`, `password`, `passkeys/register/{options,verify}`, `passkeys/login/{options,verify}`, `apple/nonce`, `apple`, `apple/link`, `me`, `logout` |
| `/api/git/…` | File-level record, as the apps save it: `GET file?path=`, `GET log?path=`, `POST cards {content}`, `PUT cards/<n> {content, sha, message}` (409 `{diverged, theirs}`), `POST cards/<n>/archive`, `POST sources {content \| url}`, `GET/PUT settings` |
| `/cases/` | The case editor: a separate app on the team's server, with its own pages and its own API (`/cases/api/…`, a member's token) |
| `/api/cards`, `/api/spans`, … | Structured edits: each is a commit, then a re-index. Also `history` and `backlinks`. |
| `/api/search`, `/api/graph/…` | Full-text search and the knowledge graph |
| `/api/spacy/…`, `/api/model` | DocBin, Doc JSON and Prodigy exports and imports (an import is one commit), spancat training, suggestions |
| `/.well-known/apple-app-site-association` | `webcredentials` for the iOS app's passkeys |

### The apps

- **Web (`frontend/`).** Built into each team's server image and served from the team's own origin. A production build without `VITE_API_URL` talks to the origin it was served from. For development, `VITE_API_URL` points it at a server (`http://localhost:8000` by default), and `VITE_APPLE_CLIENT_ID` sets the Sign in with Apple Services ID.
- **Notifications.** A member can turn on nudges as browser notifications on the account page (`frontend/src/lib/push.ts`, `frontend/public/sw.js`): standard Web Push from the team's server. On an iPhone, add Scythe to the Home Screen first (`public/manifest.webmanifest`).
- **iOS** (a separate, private repo). It talks to the same API and reads and writes the same files.

## Develop the web app

Requires Node 20+.

```bash
make install
make web     # Vite on :5173, against VITE_API_URL
make test    # tsc + eslint
make build   # → frontend/dist/
```

`client.yml` runs the lint and the build on every push.

### How a card is stored

```
---
{
  "id": 2,
  "title": "Nuclear winter starves billions",
  "topic": {"slug": "cx-2025-26-exploration-development-arctic", "event": "policy", ...},
  "file": "Aff",
  "block": "Advantage 1",
  "approved": false,
  "cite": "Xia 22, Lili Xia, Alan Robock, ...",
  "url": "https://www.nature.com/articles/s43016-022-00573-0",
  "source": 1,
  "links": [],
  "spans": [
    {"label": "underline", "key": "sc", "style": "underline", "start_char": 31, "end_char": 83, "src": "manual"}
  ],
  "text": "The resulting “nuclear winter” would collapse global agriculture, ..."
}
---

#### Nuclear winter starves billions
...
```

- The front matter is the record, and the Markdown below it is a readable rendering.
- Spans and links are one per line, so `git log -p` shows each label change.
- Span offsets count UTF-16 code units, as the web and iOS apps do.
- Archiving a card deletes its file in a commit; its history keeps every version.

The full spec is [`api/format.md`](api/format.md). The web app implements it in `frontend/src/lib/doc.ts`.

### Topics

Every card is filed under a debate topic. When you create a card without one, Scythe asks you to choose one and remembers it for the next card. [`api/nsda_topics.json`](api/nsda_topics.json) holds 542 past NSDA national topics (Policy, LD, PF, Big Questions), which every team server seeds and the apps bundle. Custom topics are added to the team's `scythe.json`.

## Using Scythe

**Cutting.** In the reader, open a link, or paste text or page HTML (for paywalled articles, add the link, authors and publication yourself). Then select a passage, or paste a copied passage to locate it. The cut card is an exact substring of `Source.full_text`, and an `excerpt_of` edge records its character offsets. The card shows up immediately after tokenizing. A background job then runs NER, links entities and chunks, and summarizes the source.

**Labeling.** Select text in the editor; the selection snaps to tokens. Press `1`–`3` (or a custom label's hotkey) to apply a label. Click a span to select it, `⌫` removes it, and `Enter` accepts a model suggestion. Labels belong to a `spans_key`, so custom ML labels can live in their own span groups.

**Training.** Train on the server (or use the Data page) to fit a `spancat` model on gold spans (`manual` and `import`). Then click **Suggest** on a card. Suggestions are pending spans in the index; accepting one commits it to the card file as gold, which closes the active-learning loop.

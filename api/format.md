# The record format

A team's record is a git repository on its server. Every save is one commit. The clients read and write these files over the API (`/api/git/*`, see `openapi.json`). They are the contract the web app, the iOS app and the server share.

```
cards/<n>.md     a card: JSON front matter (the record), then the card as Scythe Markdown
sources/<n>.md   a source: JSON front matter, then the article's verbatim text
scythe.json      the team's shared settings: labels, custom topics, the library's file and block order
names.json       the team's names: people and organizations it added, and its verdicts on who a name is
cases/<n>.md     a case: JSON front matter (id, title), then the case in Markdown
rounds/<n>.md    a round the timer kept: JSON front matter (its times and what was opened when), then the notes
```

## cards/&lt;n&gt;.md

```
---
{
  "id": 12,
  "title": "Soot blocks sunlight",
  "topic": {"slug": "…", "event": "policy", "season": "2025-2026", "period": "", "resolution": "…"},
  "file": null,
  "block": null,
  "approved": false,
  "cite": "Robock 22",
  "url": "https://…",
  "source": 4,
  "at": 120,
  "links": [{"rel": "supports", "to": 9}],
  "spans": [
    {"label": "underline", "key": "sc", "style": "underline", "start_char": 45, "end_char": 62, "src": "manual"}
  ],
  "text": "Alan Robock of Rutgers University found that soot from burning cities would block sunlight."
}
---

#### Soot blocks sunlight

Alan Robock of Rutgers University found that <u>soot from burning</u> cities would block sunlight.
```

**The front matter:**
- **It is the record.** The Markdown below it is a readable rendering, regenerated from the front matter.
- **It is diffable JSON.** The keys come in the fixed order above, with one span or link per line.
- **`id` is the card number.** It is `null` before the server assigns one. Older files name it `issue`; both are read.
- **`text` is verbatim.** It never changes once the card is cut. A card with a `source` is one stretch of it: `text` is the source's words from `at`.
- **`at`** is where the card's words start in its source, in UTF-16 units. The server sets it. A client that doesn't know `at` may leave it out of a save; the server keeps the file's.
- **`brief`** (after `at`, only on a card scanned from a brief): `{"name": "Aff case v2", "pages": [7, 8]}`, the brief the card was read from and the brief's pages it was on (1-based, in the order scanned; two pages when the card ran over a page break). A brief is its name and a page is its number: neither is a file, and the server's index lists a brief's cards from them (`GET /api/cards?brief=`, by first page). A client that doesn't know `brief` may leave it out of a save; the server keeps the file's.
- **A card is at most 400 words**, a source 20,000, and a page scanned at once 1,000; a source gives at most ten cards. Words are runs of non-space characters.
- **`links[].rel`** is one of: `answers`, `supports`, `contradicts`, `elaborates`, `same_claim`, `quotes`, `cites`, `derived_from` or `related`.

**Spans:**
- **Offsets count UTF-16 code units,** as JavaScript and Swift strings do. `start_char` is inclusive and `end_char` exclusive. A character outside the BMP, like 🔥 or 𝒳, counts as two.
- **`key`** is the spaCy spans key. `sc` holds debaters' marks. `ents` holds named entities, which only the index has, so files never hold `ents` spans.
- **`style`** is how the label is drawn: `underline`, `highlight`, `emphasis`, or `custom`.
- **`src`** says where the span came from: `manual` for a debater's mark, or the model that suggested it.
- **A card with a source shares its spans with every card cut from the same words.** The spans live in the source's front matter; a card file holds its share of them, written by the server. When a save adds or removes a span, the server applies the change to the source and rewrites every card of that source, in one commit. A refreshed card has a new sha, so a save from its old version is a divergence (409).
- **A card with no source** (or one whose words aren't in its source) keeps its own spans.

**Names** (`names`, after `spans`):
- **The names the team settled,** one per line: `{"start_char", "end_char", "label", "id"}`, with UTF-16 offsets like spans.
  - `label` is the spaCy entity label (`PERSON`, `ORG`, `GPE`…), or `null` when the words aren't a name.
  - `id` is who it is: a Wikidata item (`Q4707647`), one of the team's own authors or publications (`scythe:author:<name>`, `scythe:pub:<name>`), or `null` for "nobody we can name".
- **Scythe's guesses stay in the index.** Only settled names are in the file.
- **A card cut since names were checked has `names`,** even if empty. Such a card can't be approved (`approved: true`) while any person, place or organization Scythe found in it is unsettled; the server refuses with 422. A card without `names` was cut before, and approves as it always did.
- **A client that doesn't know `names` yet** may leave it out of a save; the server keeps the file's.

**Scythe Markdown:**
- `<u>underline</u>`, `==highlight==` and `**emphasis**`.
- When marks overlap, they nest in that fixed order.
- Unmarked text is escaped where it would read as markup.

## Token alignment

The server indexes every saved card with spaCy (`en_core_web_sm`):
- **Every span covers whole tokens.** A span's character range snaps outward to the tokens it touches, exactly as `doc.char_span(start, end, alignment_mode="expand")` would on the code-point offsets.
- **A range that touches no token is dropped.** For example, one that covers only whitespace.
- **The index reports both kinds of offsets:** `start_tok`/`end_tok`, with `end_tok` exclusive, and code-point `start_char`/`end_char`, so `text[start_char:end_char]` is the span's `text`.
- **A card is "checked"** when the index's processed sha equals the blob sha of the `cards/<n>.md` the client loaded.

## names.json

```
{
  "items": [
    {"id": "Q123456", "name": "Alan Robock", "description": "American footballer", "kind": "person", "aliases": []}
  ],
  "verdicts": [
    {"text": "Alan Robock", "id": "Q4707647", "right": 0, "wrong": 1},
    {"text": "Alan Robock", "id": "Q123456", "right": 1, "wrong": 0}
  ]
}
```

- **`items`** are who the team named that the server's Wikidata slice doesn't have, so every server can load them offline.
- **`verdicts`** count, per name as written and per item, how often the team said that name is (`right`) or isn't (`wrong`) that item. The server's knowledge base weighs them against Wikidata's own prior, so its guesses learn the team's names.
- **The server writes it** when a debater settles a name (`POST /api/spans/{id}/name`), in the same commit as the card's `names`.

## sources/&lt;n&gt;.md

The front matter holds `id`, `title`, `url`, `publisher`, `published`, `authors`, `cite` and `fetched`, and, once any card of it is marked, `spans`: the debaters' marks, with UTF-16 offsets into the source's text, shared by every card cut from it. Only the server writes a source's `spans`. The article's verbatim text follows the closing `---` and never changes.

`published` may be a day (`2024-03-15`), a month (`2024-03`) or a year (`2024`). Cards carry it as written, as `published` in `/api/cards` and `/api/search`.

## rounds/&lt;n&gt;.md

A round the timer kept, saved when it ends (features/25). The clock itself runs on the device; only the finished
round comes to the server, as one commit.

```
---
{
  "id": 3,
  "title": "Round 2 vs Lincoln",
  "format": "LD",
  "started": "2026-10-24T14:00:12Z",
  "ended": "2026-10-24T14:47:03Z",
  "blocks": [
    {"name": "Affirmative Constructive", "short": "1AC", "seconds": 360, "used": 362},
    {"name": "Cross-Examination", "short": "CX", "seconds": 180, "used": 171}
  ],
  "prep": {"sides": ["Affirmative", "Negative"], "seconds": 240, "used": [180, 240]},
  "cases": [4],
  "log": [
    {"at": "2026-10-24T14:00:15Z", "during": "Affirmative Constructive", "did": "began"},
    {"at": "2026-10-24T14:01:30Z", "during": "Affirmative Constructive", "did": "opened case", "case": 4},
    {"at": "2026-10-24T14:09:02Z", "during": "Negative Constructive", "did": "found card", "card": 12, "query": "soot"},
    {"at": "2026-10-24T14:09:04Z", "during": "Negative Constructive", "did": "opened card", "card": 12},
    {"at": "2026-10-24T14:20:41Z", "during": "Negative prep", "did": "scanned card", "card": 30}
  ]
}
---

Judge wanted more weighing.
```

- **`format`** is `LD`, `PF`, `Policy`, or the name the debater gave their custom times.
- **`blocks`** are the round's speeches in order: `seconds` is the time allowed, `used` the time the clock ran (more than allowed when a speech ran over; 0 for one never started).
- **`prep`** names the two sides and each one's prep: allowed (`seconds`) and used.
- **`log`** is what was done while the clock ran, oldest first. `at` is UTC; `during` is the speech or prep the clock was on. `did` is one of `began` (a speech or prep started), `opened card`, `found card` (picked from search; `query` is what was searched), `scanned card`, or `opened case`.
- **`by`**, in a round teammates followed live, is the member who did it.
- **`cases`** are the cases opened during the round. The server works them out from the log.
- **The notes** follow the front matter, as Markdown. They may be empty.
- A round is saved once, when it ends. The server numbers it and refuses one that's malformed (`422`).

## scythe.json labels

- **`underline`, `highlight` and `emphasis` (key `sc`) are every team's.** A `scythe.json` that lists labels without them is refused (`422`). A file with no `labels` reads as having these three. Their hotkeys may change, and nothing else about them can.
- **A label a card uses joins the list.** When a saved card has a mark whose `label` and `key` aren't listed, the server adds the label to `scythe.json` in a commit of its own, with the mark's `style` and no hotkey.

## Search

`GET /api/search?q=…` takes what people type into Google:

- `"block sunlight"`: a phrase, those words side by side;
- `-termination`, `-"termination shock"`: leave those cards out;
- `soot OR ash`: either one (`OR` in capitals);
- the last word, with no space after it, matches as a prefix (`carb` finds *carbon*).

Results come in tiers, best first: the words as a phrase, then every word anywhere, then any of the words (not offered when the query has quotes or `OR`: then it says just what it means). Each result carries `tier` (0, 1, 2) and `match` (`phrase`, `every word`, `any word`). A semantic stage, cards near the query's meaning, will join the last tier, so it never outranks a word match. `sort` is `best` (tier, then rank), `recent` (last change) or `published` (the source's date, newest first). `month=2024-03` keeps cards whose source was published that month. A source dated just `2024` is in no month.

## Saving

- **A save sends the whole file with the sha it was based on.** If someone else saved first, the server refuses it with `409 {"diverged": true, "theirs": …}`, like a non-fast-forward push. The client shows both versions.
- **Settings in `scythe.json` the client doesn't know** must survive a save unchanged.

## nsda_topics.json

The NSDA topics every server seeds, bundled into the clients.

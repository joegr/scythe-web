# Features

Eighteen Gherkin features describe Scythe from a debater's side: cards and the words in them first, then what Scythe reads in the language, then sources, then organizing and team work. They are the spec the app is built and tested against.

## Two registers

- **The steps are technical.** They name what really happens:
  - spaCy tokens and `char_span(alignment_mode="expand")`
  - span labels and offsets
  - `cards/<n>.md` front matter and the blob sha a save is pinned to
  - the 409 and `theirs`
  - issue labels such as `scythe:fetch-failed`, and NSDA topic slugs
  An engineer can test against every line.
- **The screens speak debate.** Any text a debater sees, quoted in a `see` / `sees` step, must be plain debate language. The server's checks fail if a quoted on-screen string uses repo, commit, issue, spaCy, sha, API, server, rebase, main, markdown, token or entities.

| Today on screen | Production copy |
| --- | --- |
| repository / repo | the team's evidence (on GitHub) |
| commit / save | saved, with "who changed what" in the card's history |
| issue #n | card 12, source 4 |
| spaCy processing / up to date | checking words / words checked |
| entities (PERSON, ORG…) | names, organizations, places, dates |
| condensed / "read" mode | read-aloud |
| md mode | plain text |
| diverged | your partner saved this card first |
| rebase / keep theirs / force | add my change to theirs / keep theirs / keep mine |
| fine-grained token | a GitHub sign-in key |

## Status tags

Each scenario carries exactly one status tag. An outline can tag its Examples tables separately.

| Tag | Meaning | In the test run |
| --- | --- | --- |
| `@built` | Works today, as written. | Must pass. |
| `@partly` | The behavior exists only in part: wrong copy, a known bug, or only on the local API. A `# today:` comment says what happens now. | Must fail. |
| `@missing` | Not built. | Must fail. |

`@partly` and `@missing` scenarios still run, driving the debate-language screen they describe, and are marked as expected failures. When one starts passing, the run reports it as "unexpectedly passed": retag it `@built`.

## `@mvp`: the landing page's promises, and what server checks run

`@mvp` marks the `@built` scenarios that guard a promise the landing page (joegr/scythe-landing) makes: a card is the author's exact words, marks cover whole words, no one's work is overwritten, every card has a resolution, everything prints, members only by invite, the card and source limits, and each step of "How it works". A scenario for a new promise on the landing page gets `@mvp`; a second way to do the same thing doesn't.

Pull request checks run only `@mvp`. Every feature file runs before a release: see *Releases*.

## Releases

Each release publishes the features with it: every `.feature` file, this README and `scythe-features-<tag>.zip` are attached to the GitHub release, with the "Where things stand" table in its notes. A release is cut only after every scenario but `@slow` passes.

Other tags:
- `@signed-in`: the scenario needs a signed-in debater.
- `@two-debaters`: two browsers on the same card.
- `@slow`: waits on background work or a live article fetch, usually 1–5 minutes.

## Where things stand

The table is rebuilt on `main` after every merge (`.github/workflows/features-table.yml` runs `node features/table.mjs`), so pull requests leave it alone.

| Feature | Built | Partly | Missing |
| --- | ---: | ---: | ---: |
| `01_cutting_a_card.feature` | 9 | 0 | 2 |
| `02_marking_up_words.feature` | 9 | 2 | 1 |
| `03_tag_and_cite.feature` | 5 | 2 | 0 |
| `04_reading_a_card.feature` | 3 | 1 | 1 |
| `05_signing_in.feature` | 12 | 0 | 0 |
| `06_scythe_reads_the_card.feature` | 4 | 1 | 0 |
| `07_names_places_and_dates.feature` | 3 | 0 | 0 |
| `08_suggested_highlights.feature` | 5 | 0 | 0 |
| `09_opening_an_article_by_link.feature` | 4 | 1 | 1 |
| `10_pasting_an_article.feature` | 4 | 2 | 0 |
| `11_finding_a_copied_passage.feature` | 2 | 1 | 1 |
| `12_the_source_shelf.feature` | 4 | 1 | 1 |
| `13_choosing_the_resolution.feature` | 5 | 3 | 0 |
| `14_files_blocks_and_approval.feature` | 3 | 2 | 1 |
| `15_answering_and_linking_cards.feature` | 4 | 3 | 0 |
| `16_card_history_and_removing.feature` | 1 | 2 | 2 |
| `17_two_debaters_one_card.feature` | 4 | 2 | 0 |
| `18_searching_printing_and_copying.feature` | 11 | 0 | 0 |
| `19_scanning_a_card.feature` | 7 | 0 | 0 |
| `20_writing_a_case.feature` | 12 | 0 | 0 |
| `21_joining_a_team.feature` | 5 | 0 | 0 |
| **All 21** | **116** | **23** | **10** |

## Running them

The server's checks run these features in a browser against a throwaway server of their own. `@partly` and `@missing` scenarios are expected to fail; one that starts passing fails the run until it's retagged `@built`.

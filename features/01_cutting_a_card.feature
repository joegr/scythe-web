Feature: Cutting a card from a source
  A card is a verbatim excerpt of a source: the debater selects the passage, writes the tag and
  checks the cite. Scythe never rewrites the words. The server numbers the card and commits
  cards/<n>.md, whose JSON front matter holds the tag (title), cite, source number, topic and the
  exact text.

  Background:
    Given I am signed in to the team's evidence
    And my resolution is "cx-2025-26-exploration-development-arctic"
    And a pasted source "Nuclear winter study <run>" by "Alan Robock" in "Nature Food" on "2022-08-15" with text:
      """
      Nuclear war would cause human extinction. Scientists at Rutgers University found that soot from burning cities would block sunlight for a decade.

      The resulting nuclear winter would collapse global agriculture, starving billions of people within two years.
      """

  @built @signed-in @mvp
  Scenario: Cut a passage exactly as written
    When I open that source in the reader
    And I select "soot from burning cities would block sunlight for a decade" in the source
    And I write the tag "Nuclear war causes extinction <run>"
    And I cut the card
    Then I am on the new card
    And the card's text in git is exactly "soot from burning cities would block sunlight for a decade"
    And the card's front matter has "title" "Nuclear war causes extinction <run>"
    And the card's front matter has "source" set to that source
    And the card's front matter has the topic slug "cx-2025-26-exploration-development-arctic"
    And the first commit to the card reads "card: Nuclear war causes extinction <run> (#<n>)"

  @built @signed-in
  Scenario: Whitespace around a selection is trimmed, nothing else changes
    When I open that source in the reader
    And I select " soot from burning cities " in the source
    And I write the tag "Soot <run>"
    And I cut the card
    Then I am on the new card
    And the card's text in git is exactly "soot from burning cities"

  @built @signed-in @mvp
  Scenario: A selection snaps to whole words
    When I open that source in the reader
    And I select "oot from burning citi" in the source
    Then the reader shows "soot from burning cities" picked
    When I write the tag "Soot <run>"
    And I cut the card
    Then I am on the new card
    And the card's text in git is exactly "soot from burning cities"

  @built @signed-in
  Scenario: Cut from the tooltip over the selected words
    Pointing at the selected words shows a "cut" button just above them; with no tag written yet,
    the card's tag starts as the passage's first words.
    When I open that source in the reader
    And I select "soot from burning cities would block sunlight for a decade" in the source
    And I point at the selected words
    And I press "cut" in the tooltip
    Then I am on the new card
    And the card's text in git is exactly "soot from burning cities would block sunlight for a decade"
    And the card's front matter has "title" "soot from burning cities would block sunlight for…"

  @built @signed-in @mvp
  Scenario: A card needs a tag before it can be cut
    When I open that source in the reader
    And I select "The resulting nuclear winter" in the source
    Then the cut button is disabled
    When I write the tag "Winter <run>"
    Then the cut button is enabled

  @built @signed-in
  Scenario: The cite, file and block stay filled in for the next cut
    Given I cut "Nuclear war would cause human extinction." from that source into file "Aff" block "Extinction"
    When I return to that source
    Then the cite still reads the source's cite
    And the file still reads "Aff" and the block "Extinction"
    And the tag is empty

  @built @signed-in
  Scenario: Cut with the keyboard alone
    When I open that source in the reader
    And I move the cursor to "starving billions" and extend the selection with Shift and the arrow keys
    And I write the tag "Famine <run>"
    And I press Cmd+Enter
    Then I am on the new card
    And the card's text in git is exactly "starving billions"

  @built @signed-in
  Scenario: Quick card from a clip, with a cite and no duplicates
    A clip is the author's words as pasted: Scythe saves them as a source, and the card is that
    whole source, so a quick card is the source's own words too.
    When I paste a clip "Soot blocks the sun." tagged "Soot <run>" with cite "Robock 22"
    And I press "Create card" twice quickly
    Then exactly one card is created
    And the card's front matter has "cite" "Robock 22"

  @built @signed-in @mvp
  Scenario: The server keeps a card to its source's exact words
    Whatever app sends the save, a card cut from a source must be in that source word for word,
    and a card's words never change after it's cut (its marks, tag, cite and links can).
    Given I am signed in to the team's evidence
    Then the server refuses a card whose words aren't in its source
    And the server refuses to change the card's words

  @built @signed-in @mvp
  Scenario: A card is at most 400 words
    A card is a short span of an author's words. The reader counts the words picked; past 400 it says so and
    won't cut, and the server refuses a longer card from any app (413).
    Given a pasted source "Long study <run>" of 600 words
    When I open that source in the reader
    And I find the source's first 401 words
    And I write the tag "Too long <run>"
    Then I see "401 of 400 words: too long for a card"
    And the cut button is disabled

  @built @signed-in @mvp
  Scenario: A source gives at most ten cards
    Ten cards from one source is the most it can give (cards that were removed don't count); the reader says so
    and won't cut an eleventh, and the server refuses one from any app (409).
    Given 10 cards cut from that source
    When I open that source in the reader
    And I select "soot from burning cities" in the source
    And I write the tag "Eleventh <run>"
    Then I see "This source already has 10 cards cut from it, the most one source can have. Remove one of them to cut another."
    And the cut button is disabled

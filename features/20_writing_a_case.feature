Feature: Writing a case
  A case is a debater's speech, written in the case editor: a separate app on the team's server
  (/cases/), a plain text editor beside a card finder that searches the cards in the team's record. Each case
  is one Markdown file, cases/<n>.md, in that record. Reading a line from a card puts the card's exact words in
  the case, quoted and linked back to where they are in the card; the server checks every new read line
  against the card in git, so a case can only quote what a card says. A case prints from its file.

  Background:
    Given a card "Case soot <run>" with the text "Soot from burning cities would block sunlight for a decade."

  @built @signed-in @mvp
  Scenario: Read a line from a card into a case
    Given I am signed in to the team's evidence
    When I start a case "Aff <run>"
    And I write "Plan: the United States should adopt a no-first-use policy." in the case
    And I find the card "Case soot <run>" beside the case
    And I select "block sunlight for a decade" in the card beside the case
    And I read it into the case
    And I save the case
    Then I see "saved" beside the save button
    And the case in git reads the card's words "block sunlight for a decade" with a link to them
    And the latest commit to the case starts with "case: Aff <run>"

  @built @signed-in
  Scenario: Reading on from the same card keeps one tag and cite
    Given I am signed in to the team's evidence
    When I start a case "Aff <run>"
    And I find the card "Case soot <run>" beside the case
    And I select "Soot from burning cities" in the card beside the case
    And I read it into the case
    And I select "block sunlight for a decade" in the card beside the case
    And I read it into the case
    And I save the case
    Then the case in git has the card's tag once
    And the case in git reads "Soot from burning cities" and "block sunlight for a decade" on one line

  @built @signed-in
  Scenario: Read a card as it was cut
    Given the card has a "underline" span over "Soot from burning cities"
    And the card has a "highlight" span over "block sunlight"
    And I am signed in to the team's evidence
    When I start a case "Aff <run>"
    And I find the card "Case soot <run>" beside the case
    Then the card beside the case shows "Soot from burning cities" underlined and "block sunlight" highlighted
    When I read what's marked into the case
    And I save the case
    Then the case in git has the card's tag once
    And the case in git reads "Soot from burning cities" and "block sunlight" on one line

  @built @signed-in @mvp
  Scenario: Pockets, hats, blocks and tags
    Given I am signed in to the team's evidence
    When I start a case "Aff <run>"
    And I write "Contention 1 is Famine" in the case
    And I make that line a "hat"
    And I add the line "Nuclear war causes mass starvation"
    And I make that line a "tag"
    And I save the case
    Then the case in git has the line "## Contention 1 is Famine"
    And the case in git has the line "#### Nuclear war causes mass starvation"
    When I print the case
    Then the print has "Contention 1 is Famine" as a hat and "Nuclear war causes mass starvation" as a tag

  @built @signed-in
  Scenario: A selection in the card snaps to whole words
    Given the card has a "highlight" span over "block sunlight"
    And I am signed in to the team's evidence
    When I start a case "Aff <run>"
    And I find the card "Case soot <run>" beside the case
    And I select "lock sunlight for a dec" in the card beside the case
    Then the selection in the card is "block sunlight for a decade"
    When I read it into the case
    And I save the case
    Then the case in git reads the card's words "block sunlight for a decade" with a link to them

  @built @signed-in @mvp
  Scenario: A line read from a card links back to its exact words
    Given a case "Aff <run>" that reads "block sunlight for a decade" from the card
    And I am signed in to the team's evidence
    When I open the case
    Then the page is titled with the case's title
    When I follow the line read from the card
    Then the card opens with "block sunlight for a decade" marked

  @built @mvp
  Scenario: A case can only quote what the card says
    When a case is saved reading "block sunlight for a century" from the card
    Then the save is refused because those aren't the card's words

  @built @signed-in @mvp
  Scenario: Print a case from its file
    Given a case "Aff <run>" that reads "block sunlight for a decade" from the card
    And I am signed in to the team's evidence
    When I print the case
    Then the print has the case's title, its writing, and "block sunlight for a decade"

  @built @signed-in
  Scenario: Find a card beside the case as I type
    The finder searches the way the app's search does: the phrase first, then every word, then any word.
    Given I am signed in to the team's evidence
    When I start a case "Aff <run>"
    And I type "<run> case so" in the card finder
    Then the finder suggests "Case soot <run>"

  @built @signed-in
  Scenario: A case has a word limit
    A case is a speech: 10,000 words at most, counted as the editor counts them.
    Given I am signed in to the team's evidence
    When I start a case "Aff <run>"
    And I write 10001 words in the case
    Then the editor reads "10,001 / 10,000 words: too long to save"
    And I can't save the case
    And the server refuses a case of 10001 words

  @built @two-debaters @mvp
  Scenario: Someone saved the case first
    Given a case "Aff <run>" that reads "block sunlight for a decade" from the card
    And Ana and Ben are signed in to the team's evidence
    And Ana and Ben both have the case open
    When Ana adds "Contention 2 is Proliferation" to the case and saves it
    And Ben adds "Contention 2 is Warming" to the case and saves it
    Then Ben sees "Ana saved this case first."
    And Ben sees the choices "Keep theirs" and "Keep mine"
    When Ben keeps theirs
    Then Ben's case has "Contention 2 is Proliferation"
    And Ben sees "Your version, not saved" with "Contention 2 is Warming" in it to copy from

  @built @signed-in
  Scenario: A paste that would make a case too long isn't taken in
    A case is at most 10,000 words. A paste that would go past it is refused whole, and the case stays as it was.
    When I start a case "Long case <run>"
    And I paste 10001 words into the case
    Then I see "That paste would make the case 10,001 words. A case can be 10,000 at most: paste less."
    And the case is empty

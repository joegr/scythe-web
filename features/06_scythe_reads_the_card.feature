Feature: Scythe reads the card's words
  After every save the server indexes the new cards/<n>.md:
  - It tokenizes the text and snaps every span out to whole tokens, dropping spans that cover none.
  - Background work then finds the entities and the graph.
  The card is "checked" when the index's processed sha equals the blob sha of the cards/<n>.md the
  page loaded. Entities and the graph are never committed. Marks are: each save's marks are grown to
  the same whole words before the file is committed, so git and Scythe agree on every mark.

  Background:
    Given I am signed in to the team's evidence
    And a card "Checked <run>" with the text:
      """
      Alan Robock of Rutgers University found that soot from burning cities would block sunlight.
      """

  @built @signed-in @mvp
  Scenario: After a save, Scythe checks that exact version
    When I open the card
    And I select "soot from burning" in the card
    And I press "1"
    Then within a minute Scythe has checked the card's latest version
    And the index's "underline" span over "soot from burning" has token offsets with start before end

  @built
  Scenario: Scythe keeps the card's marks as Scythe Markdown
    Given the card has a "underline" span over "soot from burning cities"
    And the card has a "highlight" span over "block sunlight"
    Then the card's Markdown from Scythe contains "<u>soot from burning cities</u>"
    And the card's Markdown from Scythe contains "==block sunlight=="
    And the index files the card under the topic "cx-2025-26-exploration-development-arctic"

  @built @signed-in
  # While Scythe checks a save the card waits; checking often takes well under a second, so the page
  # can go straight to "Words checked". What matters is that it's said for the version just saved.
  Scenario: The card says when its words have been checked
    When I open the card
    And I select "block sunlight" in the card
    And I press "2"
    Then the index's "highlight" span over "block sunlight" has token offsets with start before end
    And within a minute Scythe has checked the card's latest version
    And within 5 minutes I see "Words checked"

  @partly @slow @signed-in
  # today: the page re-checks for 15 minutes, backing off to once a minute, then stops until reload
  Scenario: Checking never gets stuck on screen
    Given checking the card takes 4 minutes
    When I keep the card open
    Then I see "Words checked" without reloading

  @built
  Scenario: When Scythe's word boundaries differ, the card in git follows Scythe
    Whatever app sends the save, the server grows each mark to the words spaCy reads before committing, so the
    file in git never holds a mark that starts or ends inside a word.
    Given the card has a "underline" span whose browser snapping differs from spaCy's tokens
    When Scythe has checked the card
    Then cards/<n>.md holds the spaCy-snapped character offsets

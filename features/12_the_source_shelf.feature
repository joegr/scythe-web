Feature: The source shelf
  Every source is sources/<n>.md; every card cut from it records "source": n in its front matter,
  and the server's index links the two (an excerpt_of edge with character anchors). A debater
  should be able to browse sources, see what was cut from each, and go back for more.

  Background:
    Given I am signed in to the team's evidence
    And a pasted source "Shelf study <run>" by "Alan Robock" in "Nature Food" on "2022-08-15" with text:
      """
      Soot from burning cities would block sunlight for a decade.
      """
    And a card "Shelf card <run>" cut from that source

  @built @signed-in @mvp
  Scenario: Go back to a card's source to cut more
    When I open the card
    And I open the card's source
    Then the reader shows the source "Shelf study <run>"
    And the reader shows "Soot from burning cities would block sunlight for a decade."

  @built @signed-in
  Scenario: Recent sources are a click away when cutting
    When I open the reader
    Then the recent sources include "Shelf study <run>"

  @built
  Scenario: The source knows the cards cut from it
    Then the index lists the card under the source

  @built
  Scenario: Browse every source and what was cut from it
    When I open the library
    Then I see a "Sources" section listing "Shelf study <run>"
    And under it the card "Shelf card <run>"

  @built
  Scenario: Remove a source nobody cut from
    A source cards were cut from stays: their words are its words.
    Given a source with no cards
    When I remove the source
    Then its file is deleted

  @built @signed-in
  Scenario: A card links back to the original article
    Given a card "Linked card <run>" from the article at "https://example.org/soot-<run>"
    When I open the card
    Then the card links to "https://example.org/soot-<run>" as "original, example.org"

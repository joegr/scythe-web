Feature: A card's history, and removing a card
  Every change to a card is a commit of cards/<n>.md, so `git log -- cards/<n>.md` is the card's
  history: who changed what, and when. Removing (archiving) a card deletes the file with a
  commit; the index keeps it as removed. Every version stays in git.

  Background:
    Given I am signed in to the team's evidence
    And a card "History <run>" with the text "Soot from burning cities would block sunlight for a decade."

  @built @signed-in @mvp
  Scenario: The history lists every change, newest first
    Given the card has a "underline" span over "Soot from burning cities"
    And the card has a "highlight" span over "block sunlight"
    When I open the card
    And I open the card's history
    Then the history lists, newest first:
      | You highlighted “block sunlight”          |
      | You underlined “Soot from burning cities” |
      | You cut the card “History <run>”          |
    And each history entry names who made it
    And no one's email is in the history, on screen or in what the server sends

  @built @signed-in
  Scenario: History reads as sentences
    Given the card has a "highlight" span over "block sunlight"
    When I open the card
    And I open the card's history
    Then I see "You highlighted “block sunlight”"

  @built @signed-in
  Scenario: Open an earlier version
    Given the card has a "highlight" span over "block sunlight"
    When I open the version before the highlight
    Then the card shows no highlight
    And I can put that version back, which saves it as a new change

  @built @signed-in
  Scenario: Removing a card asks first, and says if it failed
    When I open the card
    And I remove the card
    Then I see "Remove this card? It stays in the history and can be brought back."
    When I confirm
    Then cards/<n>.md is deleted with the commit "archive: History <run> (#<n>)"

  @built @signed-in
  Scenario: Bring a removed card back
    Given the card was removed
    When I search the removed cards and open it
    And I bring it back
    Then cards/<n>.md is restored from its last version

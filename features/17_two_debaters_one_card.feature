Feature: Two debaters mark up the same card
  Partners prep the same file. A save is a commit of cards/<n>.md pinned to the blob sha the editor
  loaded. If someone committed first, the server refuses the stale sha (the save is a
  compare-and-swap) and answers 409 with
  theirs = {content, sha, commit}. The
  debater then picks: replay my change on their version (rebase), keep theirs, or keep mine
  (commit my whole file on their sha; theirs stays in history). Nobody's work disappears silently.

  Background:
    Given a card "Race <run>" with the text "Soot from burning cities would block sunlight for a decade."
    And Ana and Ben are signed in to the team's evidence
    And Ana and Ben both have the card open at the same version

  @built @two-debaters @mvp
  Scenario: Same second: one save lands, the other is stopped with both changes shown
    When Ana selects "block sunlight" and Ben selects "Soot from burning"
    And Ana presses "2" and Ben presses "1" in the same second
    Then exactly one of their saves lands
    And the other is shown the change that landed and their own unsaved change

  @built @two-debaters @mvp
  Scenario: Add my change to theirs (the usual choice)
    Given Ana's "highlight" over "block sunlight" landed first and Ben's "underline" over "Soot from burning" was stopped
    When Ben takes the first choice
    Then the card in git has a "highlight" span over "block sunlight"
    And the card in git has a "underline" span over "Soot from burning"
    And the card's history has both commits

  @built @two-debaters @mvp
  Scenario: Keep theirs
    Given Ana's "highlight" over "block sunlight" landed first and Ben's "underline" over "Soot from burning" was stopped
    When Ben takes the second choice
    Then the card in git has a "highlight" span over "block sunlight"
    And the card in git has no "underline" span over "Soot from burning"
    And Ben's page shows the card as Ana saved it

  @built @two-debaters @mvp
  Scenario: Keep mine; theirs stays in the history
    Given Ana's "highlight" over "block sunlight" landed first and Ben's "underline" over "Soot from burning" was stopped
    When Ben takes the third choice
    Then the card in git has a "underline" span over "Soot from burning"
    And the card in git has no "highlight" span over "block sunlight"
    And the latest commit to the card starts with "underline: \"Soot from burning\", replacing "
    And the card's history still has Ana's commit

  @built @two-debaters
  Scenario: The stopped save speaks debate
    Given Ana's "highlight" over "block sunlight" landed first and Ben's "underline" over "Soot from burning" was stopped
    Then Ben sees "Ana saved this card first"
    And Ben sees "Ana highlighted “block sunlight”"
    And Ben sees "You underlined “Soot from burning” (not saved yet)"
    And Ben sees the choices "Add my change to theirs", "Keep theirs" and "Keep mine"

  @built @two-debaters
  Scenario: A problem while settling shows in the dialog
    Given Ben's save was stopped
    And the network drops
    When Ben takes the first choice
    Then Ben sees the problem inside the dialog

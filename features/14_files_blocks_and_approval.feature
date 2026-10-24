Feature: Files, blocks and approval
  A debater files a card into a file (e.g. "Aff", "Neg – Arctic DA") and a block within it (e.g.
  "Inherency", "Uniqueness"). Filing is a commit setting front matter "file" and "block"; the
  server's index groups cards by them for the library and print. Approval sets "approved": true:
  the card is ready for rounds.

  Background:
    Given I am signed in to the team's evidence
    And a card "Filed <run>" with the text "Soot from burning cities would block sunlight for a decade."

  @built @signed-in @mvp
  Scenario: File a card under a file and a block
    When I open the card
    And I file it under file "Aff <run>" and block "Inherency"
    Then the card's front matter has "file" "Aff <run>" and "block" "Inherency"
    And the latest commit to the card reads "file: Aff <run> / Inherency (#<n>)"
    And the card shows "Aff <run> / Inherency"

  @built @signed-in @mvp
  Scenario: Approve a card for rounds, and take it back
    When I open the card
    And I approve the card
    Then the card's front matter has "approved" true
    And the latest commit to the card reads "approve (#<n>)"
    When I unapprove the card
    Then the card's front matter has "approved" false

  @built @mvp
  Scenario: Filed cards appear under their file and block in the library
    Given the card is filed under file "Lib <run>" and block "Solvency"
    When I open the library
    And I open the file "Lib <run>"
    Then I see the block "Solvency" with the card "Filed <run>"

  @partly @signed-in
  # today: a file whose cards have no block doesn't appear in the library's list of files
  Scenario: A file with no block still shows in the library
    When I open the card
    And I file it under file "Loose <run>" and no block
    Then the library shows "Loose <run>" with the card under "Unfiled"

  @built
  Scenario: A long file name isn't cut short
    When I file a card under "Neg – Arctic militarization DA – Russia escalation links"
    Then the library shows the whole name

  @missing @signed-in
  Scenario: Approval says what it means
    When I open the card
    Then the approve button explains "Approve when the card is cut and checked, ready for rounds."

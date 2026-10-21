Feature: Suggested highlighting
  Scythe can learn a team's cutting style: a spaCy spancat model trained on the marks (manual,
  imported and scanned) on the cards the team approved proposes underline and highlight spans on
  new cards. Suggestions are spans with source "model", a score and accepted=false in the index
  (never in git) until a debater accepts one, which commits it as a "manual" span; a rejected
  suggestion is remembered, so it isn't offered on that card again. The team page trains
  (POST /api/model/train); the card page asks for suggestions (POST /api/cards/{id}/suggest).

  Background:
    Given the team has approved at least 50 cut cards
    And a model has been trained on the team's accepted spans

  @built @signed-in
  Scenario: Train on the team's cutting
    When the coach starts training from the team page
    Then I see how many approved cards it is learning from
    And I see how often the suggestions match the team's own highlighting

  @built @signed-in @mvp
  Scenario: Suggestions appear on a new card, waiting for a yes
    Given a new card "Suggest <run>" with no marks
    When I ask for suggestions
    Then suggested highlights are drawn as dotted underlines
    And none of them is in the card in git until I accept it

  @built @signed-in @mvp
  Scenario: Accept a suggestion with Enter
    Given the card shows a suggested "highlight" over "block sunlight"
    When I click the suggestion
    And I press "Enter"
    Then the card in git gains a "highlight" span over "block sunlight"
    And the latest commit to the card reads "highlight: \"block sunlight\" (#<n>)"

  @built @signed-in @mvp
  Scenario: Reject a suggestion with x, and it stays rejected
    Given the card shows a suggested "underline" over "for a decade"
    When I click the suggestion
    And I press "x"
    And I ask for suggestions again
    Then "for a decade" is not suggested again

  @built @mvp
  Scenario: Suggestions only learn from cards the team approved
    Given an unapproved card with a "highlight" over every word
    When the model is trained
    Then that card is not in the training data

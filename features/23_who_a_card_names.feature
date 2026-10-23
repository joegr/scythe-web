Feature: Who a card names
  Scythe knows who the names in a card are: the world's best-known people, countries, cities, governments,
  agencies, alliances, parties, think tanks, universities, newspapers, journals, treaties and wars (from Wikidata),
  plus the team's own authors and publications, taken from the sources it cites. Pointing at a name says who it
  is, with a link to its Wikidata page. The team settles each name with one of four verdicts, and the verdict applies
  to every card that names them. A team's verdicts are its own: they live in the team's names.json, in its own
  record. A card cut since names were checked keeps its settled names in its file ("names") and can't be approved
  until every person, place and organization Scythe found in it is settled (422 from the server). A card cut before
  that approves as it always did.

  Background:
    Given I am signed in to the team's evidence
    And a card "Who <run>" with the text:
      """
      Barack Obama said in 2015 that the United Nations should lead.
      """
    And Scythe has checked the card

  @built @signed-in
  Scenario: Point at a name to see who it is
    When I open the card
    And I show names and places
    Then pointing at "Barack Obama" says "Barack Obama: 44th president of the United States"
    And the tooltip links to the name's page on Wikidata

  @built @signed-in
  Scenario: Confirm a name
    When I open the card
    And I settle "Barack Obama" as "right"
    Then the card's file lists "Barack Obama" with the id "Q76"
    And I see "Barack Obama" marked as checked

  @built @signed-in
  Scenario: It's someone else
    When I open the card
    And I settle "Barack Obama" as "it's someone else" and pick another person
    Then the card's file lists "Barack Obama" with the id I picked

  @built @signed-in
  Scenario: Nobody we can name
    When I open the card
    And I settle "Barack Obama" as "nobody we can name"
    Then the card's file lists "Barack Obama" with a label and no id

  @built @signed-in
  Scenario: Not a name
    When I open the card
    And I settle "United Nations" as "not a name"
    Then the card's file lists "United Nations" with no label and no id
    And the card no longer asks me to check "United Nations"

  @built @signed-in
  Scenario: A correction applies to every card that names them
    Given a second card that also names "Barack Obama"
    When I settle "Barack Obama" as "right" on the first card
    Then the second card shows "Barack Obama" as checked too

  @built @signed-in
  Scenario: A team's verdicts are its own
    When I settle "Barack Obama" as "right"
    Then the verdict is in this team's names.json
    And no other team's Scythe has it

  @built @signed-in
  Scenario: A new card is approved only when its names are checked
    When I open the card
    And I try to approve the card
    Then I see "Check the names in this card first: 2 to check."
    When I settle every name in the card
    And I approve the card
    Then the card's front matter has "approved" true

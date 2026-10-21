Feature: Names, places and dates in a card
  Scythe reads the names out of every checked card. Entities are spans with key "ents", source "ner"
  and spaCy labels (PERSON, ORG, GPE, DATE, …), never committed to git.
  Debaters use them to see who said it, where they work and when, and to find every card naming a person.

  Background:
    Given a card "Names <run>" with the text:
      """
      Alan Robock of Rutgers University warned in 2022 that a war between India and Pakistan would starve billions.
      """

  @built @mvp
  Scenario: Scythe finds the people, organizations, places and dates
    Then within a minute Scythe lists these names in the card:
      | label  | text               |
      | PERSON | Alan Robock        |
      | ORG    | Rutgers University |
      | DATE   | 2022               |
      | GPE    | India              |
      | GPE    | Pakistan           |

  @built
  Scenario: Show the names in a card in plain words
    Given Scythe has checked the card
    When I open the card
    And I show names and places
    Then pointing at "Alan Robock" says "Person"
    And pointing at "Rutgers University" says "Organization"
    And pointing at "India" says "Place"
    And pointing at "2022" says "Date"

  @built @mvp
  Scenario: Find every card that quotes the same person
    Cards whose words name the person (spaCy's names), and cards cut from a source they wrote, by either
    "First Last" or "Last, First".
    Given two checked cards both name "Alan Robock"
    When I search for the person "Alan Robock"
    Then both cards are listed

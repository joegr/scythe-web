Feature: Searching, printing and copying
  Search is full-text search over the index (tag weighted above cite above text), typed as into
  Google ("a phrase", -leave out, a OR b) and ranked phrase first, then every word, then any word; filtered by
  topic slug, by approved or removed, and by the month the source was published. Print renders
  canonical Scythe MD for one card or a whole file. Copy puts Word-ready HTML on the clipboard in
  Verbatim style: underline, cyan (#00ffff) highlight, bold boxed emphasis, 8pt unread text.

  Background:
    Given a card "Searchable soot <run>" with the text "Soot from burning cities would block sunlight for a decade."
    And the card has a "highlight" span over "block sunlight"

  @built @mvp
  Scenario: Find a card by the words in its tag
    When I search the team's evidence for "Searchable soot <run>"
    Then within a minute the results include "Searchable soot <run>"

  @built
  Scenario: The count reads like English
    When I search the team's evidence for "Searchable soot <run>"
    Then I see "1 card"

  @built
  Scenario: Share a search as a link
    When I search the team's evidence for "Searchable soot <run>"
    Then the address includes the search
    And opening that address shows the same results

  @built @mvp
  Scenario: Print a card
    When I open the card's print page
    Then the print shows the tag "Searchable soot <run>"
    And the print shows "block sunlight" highlighted

  @built @signed-in @mvp
  Scenario: Copy into Word with Verbatim formatting
    Given I am signed in to the team's evidence
    When I open the card
    And I copy the card
    Then the clipboard's HTML draws "block sunlight" with background "#00ffff"
    And the clipboard's HTML draws unmarked words at "8pt"

  @built @signed-in @mvp
  Scenario: Print a file as a speech document
    Every card prints from its committed file, so the speech document is exactly what was cut and marked.
    Marks print the way Scythe shows them: underline thin, highlight heavy, emphasis double, all underlines.
    Given I am signed in to the team's evidence
    And cards filed under file "Aff" in blocks "Inherency" and "Solvency"
    When I print the file "Aff"
    Then the print has the file name, then each block, then each card with its tag, cite and marked text
    And highlighted words print as a heavy underline, with no color

  @built @signed-in @mvp
  Scenario: Search the way Google does
    Typed as into Google: "a phrase", -leave out, a OR b. The words as a phrase rank first, then every word
    anywhere, then any of the words.
    Given I am signed in to the team's evidence
    And another card "Searchable ash <run>" with the text "Ash from burning forests would block sunlight for a year."
    When I search the team's evidence for "<run> -ash"
    Then the results are just "Searchable soot <run>"
    When I search the team's evidence for '<run> "sunlight for a decade"'
    Then the results are just "Searchable soot <run>"
    When I search the team's evidence for "<run> soot OR ash"
    Then the results are just "Searchable soot <run>" and "Searchable ash <run>"

  @built @signed-in @mvp
  Scenario: Suggestions while typing
    Given I am signed in to the team's evidence
    When I type "<run> searchable so" in the search box
    Then a suggestion reads "Searchable soot <run>"
    When I pick the suggestion "Searchable soot <run>"
    Then the card "Searchable soot <run>" opens

  @built @signed-in
  Scenario: Approved and removed are one view at a time
    Choosing one clears the other: the address never asks for approved cards that were removed.
    Given I am signed in to the team's evidence
    And the card is approved
    And another card "Removed soot <run>" with the text "Soot fell as black rain." that was removed
    When I search the team's evidence for "<run>"
    And I show the "removed" cards
    Then the results are just "Removed soot <run>"
    When I show the "approved only" cards
    Then the address has "approved=1" and not "archived"
    And the results are just "Searchable soot <run>"

  @built @signed-in
  Scenario: Cards by the month their source was published
    Given I am signed in to the team's evidence
    And a pasted source "Dated study <run>" by "Alan Robock" in "Nature Food" on "2022-08-15" with text:
      """
      Soot from burning cities would block sunlight for a decade.
      """
    And a card "Dated card <run>" cut from that source
    When I open the card
    And I follow the card's date "August 15, 2022"
    Then the search lists cards published in "August 2022", newest first
    And within a minute the results include "Dated card <run>"

  @built @signed-in
  Scenario: The copy button says what it copies
    Given I am signed in to the team's evidence
    When I open the card
    And I switch to the plain text view
    Then I see the choice "copy md"

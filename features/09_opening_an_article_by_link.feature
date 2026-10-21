Feature: Opening an article by its link
  Pasting a link asks the server to read it: it extracts the article, the text is cleaned
  with the same rules as sanitizeText(), and sources/<n>.md is committed (front matter: title, url,
  publisher, published, authors, fetched). A link the team already has opens that source instead.
  A page with no readable article (paywall, PDF, a file) is refused with 422 and nothing is saved.

  Background:
    Given I am signed in to the team's evidence

  @built @slow @signed-in
  Scenario: A link becomes clean text you can cut from
    When I open the reader
    And I fetch the link "https://en.wikipedia.org/wiki/Nuclear_winter"
    Then within 5 minutes the reader shows the source "Nuclear winter"
    And the source's file in git has "url" "https://en.wikipedia.org/wiki/Nuclear_winter"
    And the source's text in git has no blank line inside a paragraph and exactly one between paragraphs

  @built @slow @signed-in
  Scenario: Double-clicking a paragraph selects all of it
    The browser's own double click picks one word; the reader widens it to the paragraph's whole
    span, from its first character to its last, ready to cut, and puts its text in the find field.
    When I open the reader
    And I fetch the link "https://en.wikipedia.org/wiki/Nuclear_winter"
    And within 5 minutes the reader shows the source "Nuclear winter"
    And I double-click the source's first paragraph
    Then the selection is the source's whole first paragraph
    And the find field holds the source's whole first paragraph

  @partly @signed-in
  # today: "Reading the article…", for the second or two the server takes
  Scenario: Waiting for the article says what's happening in plain words
    When I open the reader
    And I fetch the link "https://en.wikipedia.org/wiki/Nuclear_winter"
    Then I see "Reading the article… this takes about a minute"

  @built @signed-in @mvp
  Scenario: A paywalled page asks for the text instead
    When I open the reader
    And I fetch a link to a page with no readable article
    Then no source is saved for that link
    And I see "Couldn't read this page. Paste the article's text instead."
    And the paste form is open with the link already filled in

  @missing @signed-in
  Scenario: The same link twice opens the same source
    Given the source for "https://en.wikipedia.org/wiki/Nuclear_winter" is already in the team's evidence
    When I fetch the link "https://en.wikipedia.org/wiki/Nuclear_winter"
    Then the reader opens that source at once
    And no new source is made

  @built @slow @signed-in
  Scenario: The cite is drafted from the fetched page
    The server drafts it from the page's byline, date and site, and saves it in the source's file:
    the last name and two-digit year first ("Turner 22,"), an organization by its whole name.
    When the article has been fetched
    Then the cite field starts with the first author's last name and the two-digit year

Feature: Scanning a brief
  A brief is a printed file of cards, forty pages and a hundred cards at a time. On a phone, a signed-in member
  names the brief once, then photographs it page after page: each picture is sent as soon as it's taken, the camera
  stays ready for the next page, and nothing waits on the team's server. The server reads the pages in its own queue,
  a few at a time (the picture is read in memory and never kept), cuts each page into its cards (a tag, a cite, the
  words), and joins a card that runs on from one page to the next. The cards wait, grouped by brief and in page order,
  for the member who scanned them, on any device, until each is checked and saved, or the whole brief is saved at
  once. A saved card carries the brief's name and its pages as a tag, so the brief's cards can be listed in page
  order; the card is still its own source's words, cut word for word. A page the server couldn't read (the server
  restarted, or the page is too dense: a page is 1,000 words at most, a card 400) says so, and the phone sends it
  again from the picture it kept, or drops it.

  @missing @phone @signed-in
  Scenario: Scan a brief page by page without waiting
    Given I am signed in to the team's evidence
    When I start scanning the brief "Aff v2 <run>"
    And I scan 2 pages of the brief from saved photos
    Then the scanner says "2 of 2 pages read"
    And the cards to check are grouped under "Aff v2 <run>"

  @missing @phone @signed-in
  Scenario: A card that runs over a page break is one card
    Given I am signed in to the team's evidence
    When I start scanning the brief "Aff v2 <run>"
    And I scan 2 pages of the brief from saved photos
    Then a card to check is from pages 1 and 2 of the brief

  @missing @phone @signed-in
  Scenario: Save the brief at once
    Given I am signed in to the team's evidence
    When I start scanning the brief "Aff v2 <run>"
    And I scan 2 pages of the brief from saved photos
    And I save the brief
    Then the cards of "Aff v2 <run>" are listed in page order
    And the card in git names the brief "Aff v2 <run>" and its pages

  @missing @phone @signed-in
  Scenario: Split a card the server read as one
    Given I am signed in to the team's evidence
    When I scan a printed card from a saved photo
    And I split the card before "Soot from burning cities"
    Then 2 cards wait to be checked

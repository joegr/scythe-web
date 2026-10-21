Feature: Scanning a printed card
  On a phone or tablet, a signed-in member can scan a printed page of cards: "Scan a card" is the first thing on the
  cut page, and "scan" is first in the menu, after the logo. Scythe asks for the camera only when they press it;
  without the camera, they can take a photo with the phone's own camera, or choose a saved photo or screenshot. The
  picture goes to the team's server as it is, and the answer comes at once: the server reads pictures in its own
  queue, a few at a time, and the phone asks after the page until it's read. A screenshot is read as it is; a photo
  of paper is squared up first, on the server: it finds the page's four corners and undoes its tilt toward the
  camera, and they can drag the corners and read it again. Scythe tells a screenshot from a photo by the file (a
  camera names itself in every photo), and they can switch it. The server reads the picture with OCR (it isn't
  kept) and cuts the page into its cards, each a draft: tag, cite and body, as Scythe Markdown, and the marks on the
  paper (underlines, highlighter, boxes) as spans over the body. A page is 1,000 words at most and a card 400; the
  member can split a card the server read as one, or join two it read apart. Highlights are expected, and are kept
  as Scythe draws every mark: an underline of the same words (a highlighter's is the heavy one), never colour. Each
  card waits for the member who scanned it, on any device, until they check its words, fix its tag and cite, mark
  it, and save it, or discard it; the camera stays ready for the next page meanwhile. Only the words wait, never the
  picture. Saving makes what was read the card's source, and cuts the card from it word for word, with its marks. A
  photo of a page (a book, a printout, a screenshot) can also become a source to cut from, on any device. OCR is the
  one model that shapes words, and only here, upstream. A whole brief is scanned the same way, page after page: see
  "Scanning a brief".

  @built @phone @signed-in @mvp @ocr
  Scenario: Scan a card with the phone's camera
    Given I am signed in to the team's evidence
    When I scan a printed card with the camera
    Then the draft has the card's tag, cite and words
    When I save the scanned card
    Then the card is its source's own words, as read from the photo

  @built @phone @signed-in @mvp @ocr
  Scenario: Scan a card from a saved photo
    Given I am signed in to the team's evidence
    When I scan a printed card from a saved photo
    Then the draft has the card's tag, cite and words
    When I save the scanned card
    Then the card is its source's own words, as read from the photo

  @built @phone @signed-in @ocr
  Scenario: A screenshot is read as it is
    Given I am signed in to the team's evidence
    When I scan a screenshot of a card
    Then the draft says it was read as a screenshot
    And the draft has the card's tag, cite and words

  @built @phone @signed-in @ocr
  Scenario: Mark a scanned card before saving it
    Given I am signed in to the team's evidence
    When I scan a printed card from a saved photo
    And I highlight "Soot from burning cities" in the draft
    And I save the scanned card
    Then the card in git has a "highlight" span over "Soot from burning cities"

  @built @phone @signed-in @ocr
  Scenario: Scanned cards wait to be checked
    Given I am signed in to the team's evidence
    When I scan a printed card from a saved photo
    And I scan a screenshot of a card
    Then 2 cards wait to be checked
    When I discard the scans
    Then nothing waits to be checked

  @built @phone @signed-in @ocr
  Scenario: A page with two cards gives two cards to check
    Given I am signed in to the team's evidence
    When I scan a screenshot of a page with two cards
    Then 2 cards wait to be checked
    And the cards to check are tagged "Nuclear war causes global famine" and "Fires start winter"

  @built @signed-in @mvp @ocr
  Scenario: A photo of a page becomes a source
    Given I am signed in to the team's evidence
    When I open a source from a photo of a page
    Then the reader shows the page's words to check before reading it
    When I read it
    Then the source is the page's words, as read from the photo

  @built @signed-in
  Scenario: A computer doesn't offer scanning
    Given I am signed in to the team's evidence
    Then there is no way to scan a card here

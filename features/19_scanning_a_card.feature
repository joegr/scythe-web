Feature: Scanning a printed card
  On a phone or tablet, a signed-in member can scan a printed card: "Scan a card" is the first thing on the cut
  page, and "scan" is first in the menu, after the logo. Scythe asks for the camera only when they press it, and
  draws the card's outline over the camera as it finds it (OpenCV, in the browser); without the camera, they can
  take a photo with the phone's own camera, or choose a saved photo or screenshot. Before anything is read, the
  picture is squared up to the card's four corners, undoing its tilt toward the camera; they can drag the corners
  and read it again. A photo of a page (a book, a printout, a screenshot) can also become a source to cut from, on
  any device. The photo goes to the team's server, which reads it with OCR (on the server; the photo
  isn't kept) into a draft: tag, cite and body, as Scythe Markdown, and the marks on the paper (underlines,
  highlighter, boxes) as spans over the body. Highlights are expected, and are kept as Scythe draws every mark: an
  underline of the same words (a highlighter's is the heavy one), never colour. Saving makes what was read the
  card's source, and cuts the card from it word for word, with its marks. OCR is the one model that shapes words,
  and only here, upstream.

  @built @phone @signed-in @mvp
  Scenario: Scan a card with the phone's camera
    Given I am signed in to the team's evidence
    When I scan a printed card with the camera
    Then the draft has the card's tag, cite and words
    When I save the scanned card
    Then the card is its source's own words, as read from the photo

  @built @phone @signed-in @mvp
  Scenario: Scan a card from a saved photo
    Given I am signed in to the team's evidence
    When I scan a printed card from a saved photo
    Then the draft has the card's tag, cite and words
    When I save the scanned card
    Then the card is its source's own words, as read from the photo

  @built @signed-in @mvp
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

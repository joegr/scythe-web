Feature: Reading in your own browser
  Some sites turn Scythe away, or are paywalled for everyone but subscribers. The debater can still read them in their
  own browser, and the "Read in Scythe" bookmark (a javascript: link, lib/bookmarklet.ts, nothing loaded from outside
  it) brings the page they're reading into the reader's paste form. It reads the article on that page: an <article>,
  else the element holding most of the page's paragraphs, with nav / header / footer / aside / form and hidden
  elements left out and paragraphs kept. Title, link (rel=canonical), authors, publication and date come from the
  page's meta tags and schema.org details. It opens Scythe at #/?read=1 with the page in the new window's name (a
  postMessage from the opening window if the browser cleared the name), never in the link. The reader takes it only
  in the bookmark's shape, cleans it as the server will, and caps it at the source limit, then tells the bookmark it
  came. A site that cuts its windows off (Cross-Origin-Opener-Policy: same-origin) leaves neither the name nor the
  opener: no word comes back, and the bookmark puts a button on the article that copies the page for the reader's
  article box. Nothing reaches the server until the debater presses Read: then it is the same create-source call as
  any paste, with the link kept.

  Background:
    Given I am signed in to the team's evidence

  @built @signed-in
  Scenario: The bookmark is on the account page, ready to drag
    When I open my account
    Then I see "Drag this to your bookmarks bar. On an article Scythe can’t read, click it to read it here."
    And "Read in Scythe" is a bookmark link that loads nothing from another site

  @built @signed-in
  Scenario: A refused link offers the bookmark under the message
    When I open the reader
    And I fetch a link to a page that refuses readers
    Then I see "Open it in your browser and paste the article's text instead; the link is kept."
    And the reader offers the "Read in Scythe" bookmark

  @built @signed-in
  Scenario: The bookmark brings the article into the paste form
    Given an article page "Soot and the harvest <run>" by "Alan Robock" in "Nature Food" on "2022-08-15"
    When I click "Read in Scythe" on that page
    Then Scythe opens in a new window with the reader's paste form filled in
    And the paste form has the title "Soot and the harvest <run>", authors "Alan Robock", publication "Nature Food" and date "2022-08-15"
    And the paste form's link is the page's canonical link
    And the paste form's text is exactly:
      """
      Soot from burning cities would block sunlight for a decade.

      Global agriculture would collapse.

      “Nothing grows,” the study found.
      """
    And the new window shows "in your browser. Check the words and details against the page, then read it."
    And the article page offers nothing to copy

  @built @signed-in
  Scenario: Read, it's a source with the link kept
    Given an article page "Soot and the harvest <run>" by "Alan Robock" in "Nature Food" on "2022-08-15"
    When I click "Read in Scythe" on that page
    And I read the article in the new window
    Then the new window's reader shows the source "Soot and the harvest <run>"
    And the source's front matter has "authors" ["Alan Robock"], "publisher" "Nature Food" and "published" "2022-08-15"
    And the source's link is the page's canonical link

  @built @signed-in
  Scenario: The page's words never go in Scythe's link
    Given an article page "Soot and the harvest <run>" by "Alan Robock" in "Nature Food" on "2022-08-15"
    When I click "Read in Scythe" on that page
    Then the new window was opened at Scythe's "#/?read=1" and nothing more
    And no request carried the article's words before I pressed Read

  @built @signed-in
  Scenario: A site that keeps its windows apart: copy the article, then paste it
    The article's site sends Cross-Origin-Opener-Policy: same-origin, so the new window has no name and no opener.
    Given an article page "Kept apart <run>" by "Owen Toon" in "Science" on "2019-10-02" that cuts its windows off
    When I click "Read in Scythe" on that page
    Then the new window shows "Nothing came from the article’s page: some sites keep their windows apart."
    When I click "Copy the article for Scythe" on the article page
    And I paste into the new window's article box
    Then the paste form has the title "Kept apart <run>", authors "Owen Toon", publication "Science" and date "2019-10-02"
    And the paste form's link is the page's canonical link

  @built @signed-in
  Scenario: An article over the source limit comes in at the limit, and says so
    Given an article page of 20050 words
    When I click "Read in Scythe" on that page
    Then Scythe opens in a new window with the reader's paste form filled in
    And the paste form's text is 20000 words
    And the new window shows "A source can be 20,000 words at most. This one is 20,050"

  @built @signed-in
  Scenario: The reader opened without the bookmark fills nothing in
    A page that opens Scythe and sends it something not in the bookmark's shape is ignored.
    Given a page that opens Scythe's reader and sends it "<script>alert(1)</script>"
    Then the new window shows "Nothing came from the article’s page"
    And the new window's article box is empty

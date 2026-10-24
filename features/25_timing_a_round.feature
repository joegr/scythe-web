Feature: Timing a round
  The timer keeps a round's time: every speech, cross-examination and each side's prep, in the format the
  round is in. It opens on four choices: LD, PF, Policy and custom times, a list of blocks the debater writes
  (each a name and a length), kept on this device to use again. The clock is local: it runs on the device, in
  the browser or the app, and needs nothing from the server to keep time. A round survives a reload.

  Scythe keeps working while the clock runs. On the web the timer floats above the app, small, in a corner,
  and opens to fill the screen when tapped; on iOS it fills the screen, and shrinks to a bar while the
  debater cuts, scans or searches. Everything opened while it runs is written down with when, and during
  which speech: cards opened, found by search or scanned, and cases opened. A case is opened from the round,
  so it's written down whichever page it's on.

  When the round ends, the debater can add notes and save it: rounds/<n>.md in the team's record holds the
  format, its times, when it started and ended, the cases used, what was opened when, and the notes. Then
  another round starts, or the timer goes away.

  Times are the NSDA's: LD speeches 6, 3, 7, 3, 4, 6 and 3 minutes, with 4 minutes of prep a side; PF 4, 4, 3,
  4, 4, 3, 3, 3, 3, 2 and 2, with 3 minutes of prep a side (its speeches are named first and second, since a coin
  flip decides which side speaks first); Policy 8 for each constructive, 3 for each cross-examination and 5 for
  each rebuttal, with 8 minutes of prep a side.

  Background:
    Given I am signed in to the team's evidence

  @missing @signed-in
  Scenario: The timer opens on the formats
    When I open the timer
    Then I see the choices "LD", "PF", "Policy" and "custom times"

  @missing @signed-in
  Scenario Outline: A format brings its speeches and prep
    When I open the timer
    And I choose "<format>"
    Then the first speech is "<first>" at "<length>"
    And each side has "<prep>" of prep

    Examples:
      | format | first                     | length | prep |
      | LD     | Affirmative Constructive  | 6:00   | 4:00 |
      | PF     | First Constructive        | 4:00   | 3:00 |
      | Policy | First Affirmative Constructive | 8:00 | 8:00 |

  @missing @signed-in
  Scenario: The clock runs down, then counts what's over
    When I open the timer
    And I choose "LD"
    And I start the clock
    And 6 minutes and 5 seconds pass
    Then the clock reads "0:05 over"
    When I go to the next speech
    Then the clock reads "3:00" and isn't running

  @missing @signed-in
  Scenario: Each side's prep runs on its own
    When I open the timer
    And I choose "LD"
    And I start the affirmative's prep
    And 1 minute passes
    And I stop the prep
    Then the affirmative has "3:00" of prep left
    And the negative has "4:00" of prep left

  @missing @signed-in
  Scenario: Custom times are a list of blocks, kept to use again
    When I open the timer
    And I write custom times "Opening 5:00", "Questions 2:00" and "Closing 3:00" with "2:00" of prep
    And I name them "Parli practice <run>" and start
    Then the first speech is "Opening" at "5:00"
    When I end the round without saving
    And I open the timer
    Then I see the choice "Parli practice <run>"

  @missing @signed-in
  Scenario: Scythe keeps working while the clock runs
    When I open the timer
    And I choose "LD"
    And I start the clock
    And I search the team's evidence for "Searchable soot <run>"
    Then the clock floats over the page, running
    When I open the card from the results
    Then the round notes that I opened the card during "Affirmative Constructive"

  @missing @signed-in
  Scenario: A case opened from the round is a case it used
    Given a case "Aff <run>"
    When I open the timer
    And I choose "LD"
    And I start the clock
    And I open the case "Aff <run>" from the round
    Then the round notes that I opened the case during "Affirmative Constructive"

  @missing @signed-in
  Scenario: A round in progress survives a reload
    When I open the timer
    And I choose "PF"
    And I start the clock
    And 30 seconds pass
    And I reload the page
    Then the clock floats over the page, running
    And the clock reads "3:30"

  @missing @signed-in
  Scenario: The round is saved to the team's record, with what was opened when
    When I open the timer
    And I choose "LD"
    And I start the clock
    And I search the team's evidence for "Searchable soot <run>"
    And I open the card from the results
    And I end the round
    And I write the notes "Judge wanted more weighing <run>"
    And I save the round
    Then the team's record has the round, in LD, with the card opened during "Affirmative Constructive"
    And the round's notes in the record read "Judge wanted more weighing <run>"
    And I can start another round or close the timer

  @missing @phone @signed-in
  Scenario: A card scanned during a round is noted in it
    When I open the timer
    And I choose "Policy"
    And I start the clock
    And I scan a card and save it
    Then the round notes that I scanned the card during "First Affirmative Constructive"

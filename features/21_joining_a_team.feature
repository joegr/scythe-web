Feature: Joining a team
  Every team runs its own Scythe, at https://scythe-team-<team>.fly.dev, and every team is a school's own: there is
  no open one. Signed out, each one opens on the same front door: a code with a "join team" button, and nothing
  else (members who already have an account sign in below it). A code names its team (lsn-7hqkz-2pzmw-…: every code starts with its team), so
  the app builds that team's address from the code and asks its server, at /api/door/check, whether the code
  works; it never uses the code up. Nothing lists the teams: a school's Scythe is found only by someone holding
  one of its codes. A code for this team fills in the sign-up here; one for another team goes there, in ?invite=.

  A school code is a member invite with hundreds of uses for a year. Every new account waits for an admin of
  the team to let it in: it can sign in and manage itself (/api/auth/*), and sees none of the team's work until
  then (403 waiting_for_approval). Only an admin invite lets someone straight in.

  Background:
    Given I am not signed in

  @built
  Scenario: The door asks for a code and nothing else
    When I open Scythe
    Then the door asks for a code and nothing else

  @built @mvp
  Scenario: A school's code opens its sign-up
    Given an admin of the team made a school code
    When I open Scythe
    And I join with the school code
    Then the sign-up is open with the school code filled in

  @built
  Scenario: A code that opens nothing says so
    When I open Scythe
    And I join with the code "zzz-aaaaa-bbbbb-ccccc-ddddd"
    Then I see "That code doesn’t open a team. Check it with your coach."

  @built @mvp
  Scenario: A new account waits until an admin lets it in
    Given an admin of the team made a school code
    When I open Scythe
    And I join with the school code
    And I finish signing up as "newcomer-<run>" with an email and password
    Then I see "will let you in"
    When an admin of the team lets "newcomer-<run>" in
    And I check again
    Then I see "Open a source to cut a card from it"

  @built @mvp
  Scenario: An admin lets people in from the account page
    Given an admin of the team made a school code
    And "waiting-<run>" signed up with the school code
    And I am signed in as an admin of the team
    When I open my account
    Then "waiting-<run>" is waiting to be let in
    When I let "waiting-<run>" in
    Then I see "is in."
    And the server lets "waiting-<run>" read the team's cards

  @built @mvp
  Scenario: An invite runs out after 14 days, and an admin can take it back
    Given I am signed in as an admin of the team
    When I open my account
    And I make an invite
    Then the newest invite is open and expires 14 days from today
    When I revoke the newest invite
    Then I see "Invite revoked."
    And the server makes no account with that invite

  @built @mvp
  Scenario: A school code lets up to 500 people ask to join, for a year
    Given I am signed in as an admin of the team
    When I open my account
    And I make a school code
    Then the newest invite is open and expires a year from today
    And the server has the school code down for 500 sign-ups

  @built @mvp
  Scenario: Removing a member signs them out everywhere
    An admin removes someone from the team: every sign-in they have, on every device, stops at once.
    Given "gone-<run>" is a member signed in on a laptop and a phone
    And I am signed in as an admin of the team
    When I open my account
    And I remove "gone-<run>"
    Then I see "gone-<run> was removed."
    And neither of "gone-<run>"'s sign-ins reads the team's cards

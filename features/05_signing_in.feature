Feature: Signing in
  A team's Scythe is open only to its members. Nothing can be read or changed without signing in, and
  a new account needs an invite code from one of the team's admins, then waits for an admin to let it in
  (21_joining_a_team.feature). A code works once (or as many times
  as the admin chose) and expires after 14 days unless revoked sooner; the server keeps only a keyed
  digest of it. A Scythe account signs in with:
  - a passkey: WebAuthn with user verification required. It is discoverable, so no name or email is
    asked for. On Apple devices it syncs through iCloud Keychain, end-to-end encrypted, and the server
    keeps only its public key.
  - an email and password: the password is hashed with Argon2, and the email is kept as a keyed
    digest plus an encrypted copy.
  - Sign in with Apple, offered once the account holds a passkey.
  Signing in returns a bearer token kept only in this browser. Commits are authored by the account's
  public handle at a no-reply address.

  @built @mvp
  Scenario: Nothing is readable without signing in
    Given I am not signed in
    And a card "Closed evidence <run>" with the text "Only members read this."
    When I go to the card's address
    Then I see "Sign in to use Scythe."
    And the page doesn't show "Only members read this."
    And the server refuses to show the card to someone who isn't signed in

  @built @mvp
  Scenario: Join the team with an invite
    Given I am not signed in
    And an admin of the team gave me an invite
    When I open Scythe
    And I start signing in
    And I make a new account "dee-<run>" with an email and password and that invite
    Then I am signed in as "dee-<run>"

  @built @mvp
  Scenario: Without an invite, no account is made
    Given I am not signed in
    When I open Scythe
    And I start signing in
    And I make a new account "eve-<run>" with an email and password and no invite
    Then I see "Scythe is open only to this team's members. Ask your team's admin for an invite code."
    And no account "eve-<run>" was made

  @built @mvp
  Scenario: An admin invites someone from the account page
    Given I am signed in as an admin of the team
    When I open my account
    And I make an invite
    Then I see the new invite code once
    And the invite is listed as open

  @built @mvp
  Scenario: Make an account with a passkey
    Given I am not signed in
    And this browser can make passkeys
    When I open Scythe
    And I start signing in
    And I make a new account "ana-<run>" with a passkey
    Then I am signed in as "ana-<run>"
    And the server keeps one passkey for "ana-<run>" and no password

  @built @mvp
  Scenario: Sign in again with the passkey
    Given I am not signed in
    And this browser can make passkeys
    And I made the account "ben-<run>" with a passkey and signed out
    When I start signing in
    And I sign in with my passkey
    Then I am signed in as "ben-<run>"

  @built @mvp
  Scenario: Make an account with an email and password, then sign in with them
    Given I am not signed in
    When I open Scythe
    And I start signing in
    And I make a new account "cam-<run>" with an email and password
    Then I am signed in as "cam-<run>"
    When I sign out
    And I start signing in
    And I sign in with that email and password
    Then I am signed in as "cam-<run>"

  @built @mvp
  Scenario: A wrong password is refused
    Given I am not signed in
    When I open Scythe
    And I start signing in
    And I sign in with the email "nobody-<run>@example.org" and the password "not the password"
    Then I see "That email and password don't match an account."

  @built @mvp
  Scenario: Sign in with Apple is offered once the account has a passkey
    Given I am signed in to the team's evidence
    And this browser can make passkeys
    When I open my account
    Then I see "Sign in with Apple becomes available once you add a passkey."
    When I add a passkey
    Then I see the choice "Add Sign in with Apple"

  @built @mvp
  Scenario: Opt in to nudges
    Nudges are off until a member turns them on. Turning them on shares the handle, role and email with
    the team's mailing list, which emails a nudge after 3 days without storing a card.
    Given I am signed in to the team's evidence
    When I open my account
    And I turn on nudges
    Then I see "Nudges are on."
    And the team's server has me down for nudges

  @built @signed-in @mvp
  Scenario: My changes are saved under my name
    Given I am signed in to the team's evidence
    And a card "Mine <run>" with the text "Soot from burning cities would block sunlight."
    When I open the card
    And I select "Soot" in the card
    And I press "1"
    Then the latest commit to the card is by me

  @built @signed-in @mvp
  Scenario: The same cards on a laptop and a phone
    Every device reads the team's one record, so a mark made on one shows on the next.
    Given I am signed in to the team's evidence
    And a card "Everywhere <run>" with the text "Soot from burning cities would block sunlight."
    When I open the card
    And I select "Soot" in the card
    And I press "1"
    Then on my phone, signed in as me, the card shows "Soot" marked

  @built
  Scenario: Signing out is in the top bar, and asks first
    Given I am signed in to the team's evidence
    When I click "sign out" in the top bar
    Then I see "Sign out of Scythe on this browser?"
    And I am still signed in until I confirm

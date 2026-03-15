# FR-007: User Accounts

## Metadata
- **Area:** User Accounts
- **Priority:** MUST
- **Source:** constitution.md — Tech Stack / Auth; Functional Requirements / Notifications & Alerts

## Description

The system must support user registration and authentication to enable personalised features: saved jobs, saved searches, job alerts, and notification preferences. Users must be able to register with email and password, or via OAuth2 social sign-in (Google and LinkedIn). Authentication must use JWT tokens. Users must be able to manage their profile, notification preferences, saved jobs list, and alert subscriptions from an account settings area. The system must store only the minimum PII required for notification delivery; excess personal data must not be collected or retained. Passwords must be hashed using a strong one-way algorithm (bcrypt or argon2).

## Acceptance criteria

```gherkin
Feature: User Accounts

  Scenario: User registers with email and password
    Given an unregistered visitor provides a valid email address and a password of at least 10 characters
    When the visitor submits the registration form
    Then a new user account must be created with the email stored and password hashed (bcrypt/argon2)
    And the plain-text password must never be stored or logged
    And the user must receive a verification email with a confirmation link

  Scenario: User logs in with email and password
    Given a registered user with a verified email address
    When the user submits valid credentials on the login page
    Then the system must issue a JWT access token and a refresh token
    And the user must be redirected to the page they were attempting to access (or the home page)

  Scenario: User signs in via Google OAuth2
    Given an unregistered or registered visitor selects "Sign in with Google"
    When the visitor completes the Google OAuth2 flow and grants consent
    Then the system must create or retrieve the user account linked to the Google identity
    And the user must be logged in with a valid JWT session

  Scenario: User signs in via LinkedIn OAuth2
    Given an unregistered or registered visitor selects "Sign in with LinkedIn"
    When the visitor completes the LinkedIn OAuth2 flow and grants consent
    Then the system must create or retrieve the user account linked to the LinkedIn identity
    And the user must be logged in with a valid JWT session

  Scenario: User saves a job listing
    Given a logged-in user is viewing a job detail page
    When the user clicks "Save job"
    Then the job must be added to the user's saved jobs list
    And the saved jobs list must be accessible from the user's account area

  Scenario: User removes a saved job
    Given a logged-in user has a job in their saved jobs list
    When the user clicks "Remove" on that job
    Then the job must be removed from the saved jobs list
    And the removal must take effect without a page reload

  Scenario: User updates notification preferences
    Given a logged-in user navigates to notification preferences
    When the user toggles email notifications off and push notifications on
    Then the updated preferences must be stored
    And subsequent alert notifications must be sent only via the push channel

  Scenario: Unauthenticated user is prompted to log in for personalised features
    Given an unauthenticated visitor attempts to save a job
    When the visitor clicks "Save job"
    Then the system must display a prompt to log in or register
    And after successful login the save action must be completed automatically

  Scenario: JWT access token expires and is refreshed
    Given a logged-in user's JWT access token has expired
    When the user makes an authenticated API request
    Then the system must automatically use the refresh token to issue a new access token
    And the user must not be required to log in again within the refresh token validity window
```

## Related
- NFR: NFR-004 (PII minimisation, password hashing, JWT security), NFR-005 (Privacy Act compliance)
- Depends on: none (foundational)

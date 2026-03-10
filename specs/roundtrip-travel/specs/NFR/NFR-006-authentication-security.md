# NFR-006: Authentication Security

## Metadata
- **Category:** Security
- **Priority:** MUST

## Description
All user authentication must support email/password and at least one social login provider (Google). Passwords must be hashed using bcrypt or Argon2. Session tokens must expire after 30 days of inactivity. The system must support multi-factor authentication (MFA) as an optional setting.

## Acceptance criteria

```gherkin
Feature: Authentication Security

  Scenario: User registers and logs in with email/password
    Given an unregistered user provides a valid email and password
    When the user completes registration
    Then the password must be stored as a bcrypt or Argon2 hash
    And on subsequent login, the provided password must be verified against the stored hash

  Scenario: Session token expires after inactivity
    Given a user is logged in and has been inactive for 30 days
    When the user attempts to access a protected resource
    Then the session must be expired
    And the user must be redirected to the login page

  Scenario: User enables MFA on their account
    Given a logged-in user navigates to account security settings
    When the user enables MFA and registers an authenticator app
    Then subsequent logins must require a valid TOTP code in addition to password
```

## Related
- FR: FR-003 (User Profile)

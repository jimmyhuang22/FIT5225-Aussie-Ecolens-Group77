# AWS Cognito PreSignUp Trigger

This Lambda is intended to be attached to the Cognito User Pool `PreSignUp`
trigger. It rejects new registrations that omit the profile attributes required
by the assignment:

- `email`
- `given_name`
- `family_name`

Cognito standard attributes can be difficult to change from optional to required
after a user pool exists, so the trigger enforces the rule at sign-up time while
keeping the infrastructure deployable across fresh and existing environments.

## Handler

```text
app.handler
```

## Expected Event Shape

```json
{
  "request": {
    "userAttributes": {
      "email": "user@example.com",
      "given_name": "First",
      "family_name": "Last"
    }
  }
}
```

When all required values are present, the event is returned unchanged. Missing
or blank values raise `ValueError`, which Cognito surfaces as a failed sign-up.


---
name: analytics-qa
description: Review the GTM container export and validate analytics tracking configuration for the Monks challenge.
---

# Analytics QA

Review the analytics implementation in this repository.

## Scope

- Inspect `gtm-container.json`.
- Inspect the website source code when needed.
- Check the `add_to_cart` event transformation and its parameters.
- Check the newsletter success and error tracking.
- Identify potential duplicate events, missing parameters, and inconsistent triggers.

## Validation rules

1. Verify that the `add_to_cart` event includes `currency`, `value`, and `items`.
2. Check that the 21% tax calculation is applied correctly.
3. Verify that newsletter success events do not send `form_error`.
4. Verify that newsletter error events include `form_error`.
5. Check whether tags and triggers could generate duplicate GA4 events.
6. Report missing or inconsistent configuration.

## Reporting

Produce a report with:

- Passed checks
- Failed checks
- Warnings
- Recommended improvements

Clearly distinguish static configuration checks from behavior that requires testing in GTM Preview or GA4 DebugView.

Do not modify repository files unless explicitly requested.

---
name: apps-script-qa
description: Review and test Google Apps Script solutions for the Monks technical challenge.
---

# Apps Script QA

Review the Google Apps Script implementation for the Monks challenge.

## Sources

- Challenge instructions and README
- `data/bixby_employees.csv`
- Apps Script source files, when available

## Review checklist

1. Verify that the script uses the correct sheet ranges and columns.
2. Review the timestamp update logic and possible edit-trigger issues.
3. Validate the hash counting algorithm against the exact challenge requirements.
4. Check that character aliases are unique.
5. Review API calls, error handling, and authorization requirements.
6. Verify that the custom menu contains the required actions.
7. Check that the implementation does not rely on spreadsheet formulas.

## Testing

- Propose edge cases and expected results.
- Prefer independently testable JavaScript functions.
- Create automated tests only when explicitly requested.
- Distinguish local tests from tests performed inside Google Sheets.

## Reporting

Provide:
- Passed checks
- Failed checks
- Warnings
- Recommended improvements

Do not modify files unless explicitly requested.
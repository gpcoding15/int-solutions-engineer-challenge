# Challenge submission

**Candidate name:** Gisela Nahir Pardini  
**Date completed:** 2026-10-22

---

## Part 1 — Google Tag Manager

**Web container ID:** GTM-56SFWK74  
**GA4 measurement ID:** G-LZ7M6MZPJ2  
**Google Sheet is not part of this section.**

### Email to the Director of Analytics

**Subject:** Add-to-cart and newsletter tracking improvements

Hi,

We've finished two tracking improvements on the Pipo site. Here's what changed and why it matters.

**1. Add to cart now follows GA4's ecommerce standard.**
The site already recorded add-to-cart actions, but in a custom format that GA4 doesn't recognize as ecommerce. We now convert that data into Google's recommended format. That keeps add-to-cart data consistent with GA4's ecommerce model, so we can analyze cart activity by product, brand, category and value instead of just counting clicks. We also add a 21% tax amount to each product, and the cart value includes it. The developers didn't need to change the website: we reused the data it already sends, so it will stay accurate as the catalog changes.

**2. The newsletter form now records the outcome, not just the click.**
A click on "Subscribe" doesn't mean anyone signed up, because the email field could be empty or the address could be invalid. We now record one event per submission. The event says which form was used, whether it passed the site's validation, and, when it failed, why ("Empty email" or "Wrong format"). That lets us tell real interest apart from friction. If many people hit errors, the form may need clearer guidance. One limit: a successful submission means the form accepted the address. It doesn't confirm that a subscriber was created in the email platform.

**What's needed to see this in reports:** the events and their details are already arriving in GA4. Some of the extra details, such as the form status, the error reason and the per-item tax, have to be registered as custom definitions in GA4 before they show up in standard reports and explorations. These custom definitions can be configured in GA4 to make the additional details available for reporting.

Both changes were validated using GTM Preview and GA4 DebugView.

Best,
Gisela Pardini

### How you validated

All GTM tests ran on `http://localhost:5500`, with GTM Preview (Tag Assistant) and GA4 DebugView open at the same time.

**Add to cart (`#shop`)**
- Added two products whose prices test the tax rounding:
  - $7.00 item → tax 1.47, `value` 8.47
  - $5.95 item → tax 1.25, `value` 7.20 (21% of 5.95 isn't a round number)
- In Preview, each add pushed `{ ecommerce: null }` first, then the transformed `add_to_cart` object. Checked that each item kept its original fields and gained `tax`, and that `currency` came from the original push.
- Exactly one `GA4 - Add to Cart` tag fired per add.
- In DebugView, `add_to_cart` arrived with the expected `value`, `currency` and `items`.

**Newsletter (`#workshop`, footer form)**
- Submitted the form three ways:
  - Empty → `formStatus: Error`, `formError: Empty email`
  - Not an email → `formStatus: Error`, `formError: Wrong format`
  - Valid email → `formStatus: Ok`
- The triggers filter on `formName = Newsletter` plus `formStatus = Ok` (success) or `formStatus = Error` (error). Each submission fired exactly one GA4 event tag: `GA4 - Newsletter Success` or `GA4 - Newsletter Error`, never both.
- Submitted a valid email right after an error. Only the success tag fired, and the event carried no `form_error`.
- In DebugView, `newsletter_submission` arrived with `form_name` and `form_status` on every submission, and with `form_error` only on errors.

**Final checks**
- GTM container version 3 is published, and `gtm-container.json` is its export.
- With version 3, `add_to_cart` and `newsletter_submission` were tested again in GTM Preview and GA4 DebugView, and both events arrived as expected.
- The files in `apps-script/` match the live bound Apps Script project byte for byte.
- In the Google Sheet, Validaciones → Conteo, run from a different tab, wrote the counts to the employee sheet (E4 = 4, E5 = 3, E6 = 3).
- Validaciones → Alias, also run from a different tab, assigned 100 unique aliases in the employee sheet.
- Editing an employee cell updated the date and time in B1.
- `npm test` passes all 102 automated tests.

---

## Part 2 — Apps Script

**Google Sheet URL:** https://docs.google.com/spreadsheets/d/1qmVAqvj5T0PoIql0Op52EvIeQb0RWPYFqbKtxZ-N8Ak/edit?gid=499706961#gid=499706961

### Email to the client developer

**Subject:** Apps Script for the Bixby staff sheet: how it works and why

Hi,

Here's an overview of the Apps Script behind the Bixby staff sheet, with the reasoning behind the main decisions, so you can maintain or extend it with confidence.

**Last-change timestamp (`onEdit`)**
Every edit to the staff sheet writes the current date and time into its B1. I used the simple `onEdit` trigger because it needs no installation or extra authorization. It also can't loop: Apps Script doesn't fire `onEdit` for changes made by a script, so the write to B1 doesn't trigger another update. Two things to keep in mind: edits to other tabs are ignored, because the script only recognizes the staff sheet by its row-3 headers, and a manual edit to B1 is replaced with the timestamp right away.

**Validaciones menu (`onOpen`)**
The menu is built in `onOpen`, so it appears every time the spreadsheet is opened or reloaded. "Conteo" calls `runSecurityCount` and "Alias" calls `generateAliases`. The menu labels stay in Spanish as specified, and the code is in English.

**Security count**
`getSecurityCount` makes one pass over each hash. It tracks the current run of letters that keep moving forward in the alphabet, and it tracks whether that run contains a vowel. A letter equal to or earlier than the previous one starts a new run. The longest run is only recorded once it contains a vowel, so a longer run without vowels never wins. If no run qualifies, the result is 0. The hash is lowercased first, and an empty hash cell leaves its count blank instead of writing 0. The logic sits in its own function, separate from the sheet, so you can test it without a spreadsheet; `testSecurityCount` logs a set of sample cases to the console.

**Batch reads and writes**
Both menu actions read a whole column with one `getValues()` call and write the results with one `setValues()` call, instead of touching cells one at a time. Calls to the Sheets service are the slowest part of a script, so this keeps the run fast and well within Apps Script's execution limits as the list grows. Data starts at row 4, below the timestamp row, a blank row and the headers.

**Harry Potter API and aliases**
`generateAliases` loads the character list from hp-api.onrender.com with `UrlFetchApp`. Before it uses the data, it cleans it:
- removes empty or missing names and trims whitespace
- removes duplicates ignoring case, so "Harry Potter" and "harry potter" count as one name

The cleaned list is shuffled with a Fisher-Yates shuffle, which makes every order equally likely. Each employee then takes the next name from the shuffled list. Because every name is used at most once, two employees can never get the same alias in a run, and running Alias again assigns a new random set. Rows with no employee name get an empty alias.

**Validation and error handling**
My main goal was that a failure never leaves the sheet half-updated or wipes out good data. Nothing is written until every check has passed:
- If the API call fails, doesn't return HTTP 200, returns invalid JSON or doesn't return a list, the script shows an alert with the reason and stops. Existing aliases are untouched.
- If there are fewer unique names than employees, the script reports both numbers and stops instead of reusing names.
- If there's no employee data, both actions say so instead of failing silently.

The first time Alias runs, Google asks for permission to connect to an external service. That's expected, because the script calls the API.

**Things worth knowing**
- The script finds the staff sheet by its row-3 headers (`Name`, `Mail`, `Alias`, `Hash`, `Conteo de Seguridad`), not by the open tab, so the menu actions never write into an unrelated sheet. If those headers are renamed, the actions stop with an error instead of writing.
- The API is hosted on Render and can take a few seconds to respond on the first request, so the Alias action may feel slow at first.

Happy to walk through any of this or adjust it to your setup.

Best,
Gisela Pardini

### Decisions worth knowing

**GTM and GA4**
- **GTM setup:** The container is installed in `website/index.html` because the shop and workshop pages are loaded dynamically through hash navigation. This avoids loading GTM multiple times.
- **Add-to-cart tracking:** The original dataLayer event remains unchanged. A GTM Custom HTML tag transforms it into a standard GA4 `add_to_cart` event, preserving product details and adding a 21% tax per item. The total value includes tax and quantity. Tax and value are calculated in integer cents to avoid floating-point rounding errors (for example, $21.50 gives a tax of $4.52, not $4.51). The tag validates the incoming data: if the parameters, items or currency are missing, or any item has an invalid price or quantity, the whole transformed event is rejected with a console warning instead of sending incomplete ecommerce data. A missing quantity defaults to 1, matching GA4. A separate trigger sends the transformed event to GA4, avoiding duplicate tracking.
- **Newsletter tracking:** Success and error submissions are handled by separate triggers and tags. Both send `newsletter_submission`, including the form name and status, with an error reason only for failed submissions. This prevents stale error information from being sent after a successful submission.
- **Validation:** Both implementations were tested using GTM Preview and GA4 DebugView, including different product prices and newsletter submission outcomes.
- **Limitation:** Custom GA4 definitions for newsletter parameters and item-level tax have not been configured, so these values are not yet available in standard reports.

**Apps Script** (source in `apps-script/Código.js`, bound to the sheet above)
- **Hash count:** `getSecurityCount` makes one pass over the hash. A run continues only while each letter is strictly later than the previous one, so a repeated letter starts a new run. The best length is updated only after the current run contains a vowel, so the result is the length of the longest run that has a vowel, or 0 if none does. It is a pure function, so `testSecurityCount` can run it from the editor without touching the sheet. Empty or invalid hashes (anything other than letters) leave the count cell blank, and the final message reports how many rows had an invalid hash.
- **Unique aliases:**
  1. Character names are trimmed, and empty names are dropped.
  2. Duplicates are removed ignoring case.
  3. The list is shuffled with Fisher-Yates.
  4. Each employee row takes the next name, so no name is ever used twice.

  The script checks that there are at least as many names as employees before writing anything. Each run replaces the whole column with a new random set.
- **Failures:** if the request fails, returns a non-200 status, returns invalid JSON or returns something that isn't a list, or if there aren't enough names, the script stops before writing, so the existing aliases stay as they are.
- **Batch I/O:** each menu action reads a column with one `getValues()` call and writes it with one `setValues()` call, starting at row 4.
- **Staff sheet:** both actions locate the staff sheet by its row-3 headers. They use the active tab if it is the staff sheet, otherwise the only sheet with those headers, and show an error without writing if none (or more than one) is found. `onEdit` uses the same check, so edits to other tabs don't update B1.

**Automated tests**
- The repository includes a Node.js test suite in `tests/` with no external dependencies. Run it from the repository root with `npm test` (Node.js 20 or later).
- The tests run the actual code from `apps-script/Código.js`, `gtm-container.json` and `website/js/newsletter.js` against local mocks of Google Sheets, the Harry Potter API and the dataLayer, plus a minimal simulation of the exported GTM triggers. They cover the security count, alias generation and its failure cases, the add-to-cart tax and value calculations and input validation, the newsletter events, and the GA4 tag configuration.
- They are local simulations: they check the code and the exported configuration, not the live GTM container, GA4 or the real spreadsheet. GTM Preview, GA4 DebugView and testing in Google Sheets are still required, including after the latest changes to the add-to-cart tag and the Apps Script are synchronized.

**Tooling**
- I used reusable Claude Code skills and a dedicated review agent to support implementation, QA, and code review. All findings were evaluated against automated tests and manual validation where applicable.

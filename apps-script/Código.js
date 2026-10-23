const HEADER_ROW = 3;
const STAFF_HEADERS = ["Name", "Mail", "Alias", "Hash", "Conteo de Seguridad"];

function onEdit(e) {
  // Running onEdit manually from the editor passes no event object.
  if (!e || !e.range) {
    return;
  }

  const sheet = e.range.getSheet();

  if (!isStaffSheet(sheet)) {
    return;
  }

  sheet.getRange("B1").setValue(new Date());
}

// The staff sheet is recognized by its headers in row 3, so the script never
// writes into an unrelated tab, whatever the tab is called.
function isStaffSheet(sheet) {
  if (sheet.getMaxRows() < HEADER_ROW || sheet.getMaxColumns() < STAFF_HEADERS.length) {
    return false;
  }

  const headers = sheet
    .getRange(HEADER_ROW, 1, 1, STAFF_HEADERS.length)
    .getValues()[0];

  return headers.every((header, i) => String(header).trim() === STAFF_HEADERS[i]);
}

// Prefers the active tab when it is a staff sheet; otherwise uses the only
// staff sheet in the spreadsheet. Throws if there is none or it is ambiguous.
function getStaffSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const activeSheet = spreadsheet.getActiveSheet();
  const staffSheets = spreadsheet.getSheets().filter(isStaffSheet);

  if (staffSheets.some(sheet => sheet.getSheetId() === activeSheet.getSheetId())) {
    return activeSheet;
  }

  if (staffSheets.length === 1) {
    return staffSheets[0];
  }

  if (staffSheets.length === 0) {
    throw new Error(
      `Staff sheet not found. Expected these headers in row ${HEADER_ROW}: ` +
      `${STAFF_HEADERS.join(", ")}.`
    );
  }

  throw new Error("Several staff sheets were found. Open the one to update and try again.");
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Validaciones")
    .addItem("Conteo", "runSecurityCount")
    .addItem("Alias", "generateAliases")
    .addToUi();
}


// A valid hash contains only letters (any case), ignoring surrounding spaces.
function isValidHash(hash) {
  return typeof hash === "string" && /^[a-z]+$/i.test(hash.trim());
}

function getSecurityCount(hash) {
  if (!isValidHash(hash)) {
    throw new Error(`Invalid hash: ${JSON.stringify(hash)}`);
  }

  const text = hash.trim().toLowerCase();
  const vowels = "aeiou";

  let maxLength = 0;
  let currentLength = 0;
  let hasVowel = false;

  for (let i = 0; i < text.length; i++) {
    const currentChar = text[i];
    const previousChar = text[i - 1];

    if (i === 0 || currentChar <= previousChar) {
      currentLength = 1;
      hasVowel = vowels.includes(currentChar);
    } else {
      currentLength++;
      if (vowels.includes(currentChar)) {
        hasVowel = true;
      }
    }

    if (hasVowel) {
      maxLength = Math.max(maxLength, currentLength);
    }
  }

  return maxLength;
}


function testSecurityCount() {
  const testCases = [
    { hash: "abcxyz", expected: 6 },
    { hash: "bcdfg", expected: 0 },
    { hash: "aabbc", expected: 2 },
    { hash: "xyzade", expected: 3 },
    { hash: "a", expected: 1 },
    { hash: "zzz", expected: 0 }
  ];

  testCases.forEach(({ hash, expected }) => {
    const actual = getSecurityCount(hash);
    const result = actual === expected ? "PASS" : "FAIL";

    console.log(
      `${result} | ${hash} | Expected: ${expected} | Actual: ${actual}`
    );
  });
}

function runSecurityCount() {
  let sheet;
  try {
    sheet = getStaffSheet();
  } catch (error) {
    SpreadsheetApp.getUi().alert(error.message);
    return;
  }

  const firstDataRow = 4;
  const lastRow = sheet.getLastRow();

  if (lastRow < firstDataRow) {
    SpreadsheetApp.getUi().alert("No employee data found.");
    return;
  }

  const hashes = sheet
    .getRange(firstDataRow, 4, lastRow - firstDataRow + 1, 1)
    .getValues();

  // Blank and invalid hashes get an empty count instead of stopping the run.
  let invalidCount = 0;
  const results = hashes.map(([hash]) => {
    if (String(hash).trim() === "") {
      return [""];
    }
    if (!isValidHash(hash)) {
      invalidCount++;
      return [""];
    }
    return [getSecurityCount(hash)];
  });

  sheet
    .getRange(firstDataRow, 5, results.length, 1)
    .setValues(results);

  SpreadsheetApp.getUi().alert(
    invalidCount === 0
      ? "Security counts calculated successfully."
      : `Security counts calculated. ${invalidCount} row(s) with an invalid hash were left blank.`
  );
}


const CHARACTERS_API_URL = "https://hp-api.onrender.com/api/characters";

function generateAliases() {
  const ui = SpreadsheetApp.getUi();
  let sheet;
  try {
    sheet = getStaffSheet();
  } catch (error) {
    ui.alert(error.message);
    return;
  }

  const firstDataRow = 4;
  const nameColumn = 1;
  const aliasColumn = 3;
  const lastRow = sheet.getLastRow();

  if (lastRow < firstDataRow) {
    ui.alert("No employee data found.");
    return;
  }

  const rowCount = lastRow - firstDataRow + 1;
  const employeeNames = sheet
    .getRange(firstDataRow, nameColumn, rowCount, 1)
    .getValues();
  const employeeCount = employeeNames
    .filter(([name]) => String(name).trim() !== "")
    .length;

  if (employeeCount === 0) {
    ui.alert("No employee data found.");
    return;
  }

  // Nothing is written to the sheet until the API call and all checks succeed,
  // so existing aliases are kept if anything fails.
  let uniqueNames;
  try {
    uniqueNames = getUniqueCharacterNames(fetchCharacters());
  } catch (error) {
    console.error(error);
    ui.alert(`Could not load characters. Existing aliases were kept.\n\n${error.message}`);
    return;
  }

  if (uniqueNames.length < employeeCount) {
    ui.alert(
      `Not enough unique characters to assign aliases ` +
      `(${uniqueNames.length} available, ${employeeCount} needed). ` +
      `Existing aliases were kept.`
    );
    return;
  }

  const shuffledNames = shuffle(uniqueNames);
  let nextNameIndex = 0;

  // Rows without an employee name get an empty alias.
  const aliases = employeeNames.map(([name]) =>
    String(name).trim() === "" ? [""] : [shuffledNames[nextNameIndex++]]
  );

  sheet
    .getRange(firstDataRow, aliasColumn, aliases.length, 1)
    .setValues(aliases);

  ui.alert("Unique aliases assigned successfully.");
}

function fetchCharacters() {
  const response = UrlFetchApp.fetch(CHARACTERS_API_URL, {
    muteHttpExceptions: true
  });
  const statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error(`API responded with HTTP ${statusCode}.`);
  }

  let characters;
  try {
    characters = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error("API response is not valid JSON.");
  }

  if (!Array.isArray(characters)) {
    throw new Error("API response is not a list of characters.");
  }

  return characters;
}

// Returns trimmed, non-empty names, removing duplicates case-insensitively.
function getUniqueCharacterNames(characters) {
  const seenNames = new Set();
  const uniqueNames = [];

  characters.forEach(character => {
    const name = character && typeof character.name === "string"
      ? character.name.trim()
      : "";
    const key = name.toLowerCase();

    if (name !== "" && !seenNames.has(key)) {
      seenNames.add(key);
      uniqueNames.push(name);
    }
  });

  return uniqueNames;
}

// Fisher-Yates shuffle on a copy of the input array.
function shuffle(values) {
  const result = values.slice();

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function testUniqueCharacterNames() {
  const characters = [
    { name: "Harry Potter" },
    { name: " Harry Potter " },
    { name: "harry potter" },
    { name: "" },
    { name: "   " },
    { name: null },
    {},
    null,
    { name: "Hermione Granger" }
  ];
  const expected = ["Harry Potter", "Hermione Granger"];
  const actual = getUniqueCharacterNames(characters);
  const result = JSON.stringify(actual) === JSON.stringify(expected) ? "PASS" : "FAIL";

  console.log(`${result} | Expected: ${JSON.stringify(expected)} | Actual: ${JSON.stringify(actual)}`);
}

function testHarryPotterApi() {
  const url = "https://hp-api.onrender.com/api/characters";

  const response = UrlFetchApp.fetch(url);
  const characters = JSON.parse(response.getContentText());

  console.log(`Characters received: ${characters.length}`);
  console.log(`First character: ${characters[0].name}`);
}

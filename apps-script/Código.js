function onEdit(e) {
  const sheet = e.range.getSheet();

  sheet.getRange("B1").setValue(new Date());
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Validaciones")
    .addItem("Conteo", "runSecurityCount")
    .addItem("Alias", "generateAliases")
    .addToUi();
}


function getSecurityCount(hash) {
  const text = String(hash).toLowerCase();
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const firstDataRow = 4;
  const lastRow = sheet.getLastRow();

  if (lastRow < firstDataRow) {
    SpreadsheetApp.getUi().alert("No employee data found.");
    return;
  }

  const hashes = sheet
    .getRange(firstDataRow, 4, lastRow - firstDataRow + 1, 1)
    .getValues();

  const results = hashes.map(([hash]) => [
    hash === "" ? "" : getSecurityCount(hash)
  ]);

  sheet
    .getRange(firstDataRow, 5, results.length, 1)
    .setValues(results);

  SpreadsheetApp.getUi().alert("Security counts calculated successfully.");
}


const CHARACTERS_API_URL = "https://hp-api.onrender.com/api/characters";

function generateAliases() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
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

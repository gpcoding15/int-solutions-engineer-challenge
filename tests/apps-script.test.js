const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  STAFF_HEADERS,
  employeeRows,
  fakeSheet,
  staffSheet,
  httpResponse,
  loadAppsScript
} = require("./helpers");

const API_URL = "https://hp-api.onrender.com/api/characters";

function csvStaffSheet(options) {
  return fakeSheet(employeeRows(), options);
}

function otherSheet() {
  return fakeSheet([
    ["Budget", "2026"],
    ["", ""],
    ["Item", "Amount"],
    ["Snacks", 120]
  ], { id: 99 });
}

function characters(count) {
  return Array.from({ length: count }, (_, i) => ({ name: `Character ${i + 1}` }));
}

describe("getSecurityCount", () => {
  const { script } = loadAppsScript();

  const cases = [
    ["acbcrxorzeh", 3, "README example"],
    ["abcxyz", 6, "whole hash is one run with a vowel"],
    ["bcdfg", 0, "no vowels"],
    ["aabbc", 2, "repeated letters start a new run"],
    ["xyzade", 3, "best run is at the end"],
    ["a", 1, "single vowel"],
    ["zzz", 0, "single consonant repeated"],
    ["abba", 2, "tie-breaking does not matter"],
    ["bcdfgha", 1, "long run without vowel loses to a single vowel"],
    ["bcdfgu", 6, "vowel at the end of the run counts"],
    ["bcdxyzae", 2, "longer run without vowel loses"],
    ["bcdfghjklmnpqrstvwxyz", 0, "ascending consonants only"],
    ["zyxwvutsrqponmlkjihgfedcba", 1, "strictly descending alphabet"],
    ["ACBCRXORZEH", 3, "uppercase is lowercased"],
    ["  acbcrxorzeh  ", 3, "surrounding spaces are ignored"],
    ["a".repeat(50), 1, "50 identical vowels"],
    ["b".repeat(50), 0, "50 identical consonants"]
  ];

  cases.forEach(([hash, expected, description]) => {
    test(`${JSON.stringify(hash)} -> ${expected} (${description})`, () => {
      assert.equal(script.getSecurityCount(hash), expected);
    });
  });

  test("first employee hashes in the CSV give 4, 3 and 3", () => {
    const rows = employeeRows();
    assert.deepEqual(
      [3, 4, 5].map(index => script.getSecurityCount(rows[index][3])),
      [4, 3, 3]
    );
  });

  [null, undefined, 123, "", "   ", "abc1", "ab cd", "ñandú", ["abc"]].forEach(value => {
    test(`throws for invalid input ${JSON.stringify(value) ?? "undefined"}`, () => {
      assert.throws(() => script.getSecurityCount(value), /Invalid hash/);
    });
  });
});

describe("runSecurityCount", () => {
  test("writes every count to column E of the staff sheet from row 4", () => {
    const staff = csvStaffSheet();
    const { script, alerts } = loadAppsScript({ sheets: [staff] });

    script.runSecurityCount();

    assert.equal(staff.writes.length, 1);
    const [write] = staff.writes;
    assert.deepEqual(
      { row: write.row, column: write.column, numRows: write.numRows, numColumns: write.numColumns },
      { row: 4, column: 5, numRows: 100, numColumns: 1 }
    );
    assert.deepEqual(write.values.slice(0, 3), [[4], [3], [3]]);
    write.values.forEach(([count]) => {
      assert.ok(Number.isInteger(count) && count >= 0 && count <= 50, `unexpected count ${count}`);
    });
    assert.deepEqual(alerts, ["Security counts calculated successfully."]);
  });

  test("uses the staff sheet even when another tab is active", () => {
    const staff = csvStaffSheet();
    const other = otherSheet();
    const { script } = loadAppsScript({ sheets: [other, staff], activeSheet: other });

    script.runSecurityCount();

    assert.equal(other.writes.length, 0);
    assert.equal(staff.writes.length, 1);
  });

  test("prefers the active tab when several staff sheets exist", () => {
    const first = csvStaffSheet({ id: 1 });
    const second = csvStaffSheet({ id: 2 });
    const { script } = loadAppsScript({ sheets: [first, second], activeSheet: second });

    script.runSecurityCount();

    assert.equal(first.writes.length, 0);
    assert.equal(second.writes.length, 1);
  });

  test("leaves empty and invalid hashes blank and reports invalid rows", () => {
    const staff = staffSheet([
      { name: "Ana", hash: "acbcrxorzeh" },
      { name: "Bea", hash: "" },
      { name: "Cris", hash: "bad1" },
      { name: "Dani", hash: "   " },
      { name: "Eli", hash: 12345 }
    ]);
    const { script, alerts } = loadAppsScript({ sheets: [staff] });

    script.runSecurityCount();

    assert.deepEqual(staff.writes[0].values, [[3], [""], [""], [""], [""]]);
    assert.deepEqual(alerts, ["Security counts calculated. 2 row(s) with an invalid hash were left blank."]);
  });

  test("shows an error and writes nothing when no staff sheet exists", () => {
    const other = otherSheet();
    const narrow = fakeSheet([[""], [""], ["Name"]], { id: 3, maxColumns: 3 });
    const { script, alerts } = loadAppsScript({ sheets: [other, narrow], activeSheet: other });

    script.runSecurityCount();

    assert.equal(other.writes.length + narrow.writes.length, 0);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Staff sheet not found/);
    assert.match(alerts[0], new RegExp(STAFF_HEADERS.join(", ")));
  });

  test("shows an error when several staff sheets exist and none is active", () => {
    const first = csvStaffSheet({ id: 1 });
    const second = csvStaffSheet({ id: 2 });
    const other = otherSheet();
    const { script, alerts } = loadAppsScript({ sheets: [first, second, other], activeSheet: other });

    script.runSecurityCount();

    assert.equal(first.writes.length + second.writes.length + other.writes.length, 0);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Several staff sheets/);
  });

  test("reports missing employee data without writing", () => {
    const staff = staffSheet([]);
    const { script, alerts } = loadAppsScript({ sheets: [staff] });

    script.runSecurityCount();

    assert.equal(staff.writes.length, 0);
    assert.deepEqual(alerts, ["No employee data found."]);
  });
});

describe("onEdit", () => {
  test("does nothing when called without an event", () => {
    const staff = csvStaffSheet();
    const { script } = loadAppsScript({ sheets: [staff] });

    assert.doesNotThrow(() => script.onEdit());
    assert.doesNotThrow(() => script.onEdit({}));
    assert.equal(staff.writes.length, 0);
  });

  test("writes the current date to B1 of the staff sheet", () => {
    const staff = csvStaffSheet();
    const { script } = loadAppsScript({ sheets: [staff] });
    const before = Date.now();

    script.onEdit({ range: staff.getRange(5, 1) });

    assert.equal(staff.writes.length, 1);
    const [write] = staff.writes;
    assert.deepEqual([write.row, write.column], [1, 2]);
    const stamp = write.values[0][0];
    assert.ok(stamp instanceof Date, "B1 should hold a Date");
    assert.ok(stamp.getTime() >= before && stamp.getTime() <= Date.now());
  });

  test("ignores edits to other tabs", () => {
    const staff = csvStaffSheet();
    const other = otherSheet();
    const { script } = loadAppsScript({ sheets: [staff, other] });

    script.onEdit({ range: other.getRange(4, 2) });

    assert.equal(other.writes.length + staff.writes.length, 0);
  });
});

describe("onOpen", () => {
  test("adds the Validaciones menu with Conteo and Alias", () => {
    const { script, menus } = loadAppsScript();

    script.onOpen();

    assert.deepEqual(menus, [{
      name: "Validaciones",
      items: [
        { label: "Conteo", functionName: "runSecurityCount" },
        { label: "Alias", functionName: "generateAliases" }
      ]
    }]);
    assert.equal(typeof script.runSecurityCount, "function");
    assert.equal(typeof script.generateAliases, "function");
  });
});

describe("generateAliases", () => {
  test("assigns 100 unique aliases in one write to column C", () => {
    const staff = csvStaffSheet();
    const list = [
      ...characters(150),
      { name: "character 1" },
      { name: "  Character 2  " },
      { name: "" },
      { name: null },
      null
    ];
    const { script, alerts, fetchCalls } = loadAppsScript({
      sheets: [staff],
      fetch: () => httpResponse(200, list)
    });

    script.generateAliases();

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, API_URL);
    assert.equal(fetchCalls[0].options.muteHttpExceptions, true);

    assert.equal(staff.writes.length, 1);
    const [write] = staff.writes;
    assert.deepEqual(
      { row: write.row, column: write.column, numRows: write.numRows, numColumns: write.numColumns },
      { row: 4, column: 3, numRows: 100, numColumns: 1 }
    );
    const aliases = write.values.map(([alias]) => alias);
    const allowed = new Set(characters(150).map(({ name }) => name));
    aliases.forEach(alias => assert.ok(allowed.has(alias), `unexpected alias ${JSON.stringify(alias)}`));
    assert.equal(new Set(aliases.map(alias => alias.toLowerCase())).size, 100);
    assert.deepEqual(alerts, ["Unique aliases assigned successfully."]);
  });

  test("leaves the alias empty for rows without a name", () => {
    const staff = staffSheet([
      { name: "Ana", alias: "OLD-1" },
      { name: "", alias: "OLD-2" },
      { name: "Bea", alias: "OLD-3" }
    ]);
    const { script } = loadAppsScript({
      sheets: [staff],
      fetch: () => httpResponse(200, characters(2))
    });

    script.generateAliases();

    const aliases = staff.writes[0].values.map(([alias]) => alias);
    assert.equal(aliases[1], "");
    assert.deepEqual([aliases[0], aliases[2]].sort(), ["Character 1", "Character 2"]);
  });

  test("shuffles the API names before assigning them", () => {
    const staff = staffSheet([{ name: "Ana" }, { name: "Bea" }, { name: "Cris" }]);
    // With Math.random() always 0, Fisher-Yates turns [1, 2, 3] into [2, 3, 1].
    const { script } = loadAppsScript({
      sheets: [staff],
      fetch: () => httpResponse(200, characters(3)),
      random: () => 0
    });

    script.generateAliases();

    const aliases = staff.writes[0].values.map(([alias]) => alias);
    assert.deepEqual(aliases, ["Character 2", "Character 3", "Character 1"]);
    assert.notDeepEqual(aliases, characters(3).map(({ name }) => name));
  });

  test("uses the staff sheet even when another tab is active", () => {
    const staff = csvStaffSheet();
    const other = otherSheet();
    const { script } = loadAppsScript({
      sheets: [other, staff],
      activeSheet: other,
      fetch: () => httpResponse(200, characters(100))
    });

    script.generateAliases();

    assert.equal(other.writes.length, 0);
    assert.equal(staff.writes.length, 1);
  });

  test("shows an error and does not call the API when no staff sheet exists", () => {
    const other = otherSheet();
    const { script, alerts, fetchCalls } = loadAppsScript({
      sheets: [other],
      fetch: () => httpResponse(200, characters(100))
    });

    script.generateAliases();

    assert.equal(fetchCalls.length, 0);
    assert.equal(other.writes.length, 0);
    assert.match(alerts[0], /Staff sheet not found/);
  });

  const failures = [
    ["HTTP 500", () => httpResponse(500, "Internal Server Error"), /Could not load characters\. Existing aliases were kept\.[\s\S]*HTTP 500/],
    ["invalid JSON", () => httpResponse(200, "<html>Service unavailable</html>"), /Could not load characters\. Existing aliases were kept\.[\s\S]*not valid JSON/],
    ["object instead of a list", () => httpResponse(200, { characters: [] }), /Could not load characters\. Existing aliases were kept\.[\s\S]*not a list/],
    ["network error", () => { throw new Error("DNS lookup failed"); }, /Could not load characters\. Existing aliases were kept\.[\s\S]*DNS lookup failed/],
    [
      "not enough unique names",
      () => httpResponse(200, [...characters(99), { name: "CHARACTER 1" }, { name: "Character 2 " }]),
      /Not enough unique characters to assign aliases \(99 available, 100 needed\)\. Existing aliases were kept\./
    ]
  ];

  failures.forEach(([description, fetch, expectedAlert]) => {
    test(`keeps existing aliases on ${description}`, () => {
      const staff = csvStaffSheet();
      staff.data.slice(3).forEach((row, i) => {
        row[2] = `OLD-${i}`;
      });
      const before = structuredClone(staff.data);
      const { script, alerts } = loadAppsScript({ sheets: [staff], fetch });

      script.generateAliases();

      assert.equal(staff.writes.length, 0);
      assert.deepEqual(staff.data, before);
      assert.equal(alerts.length, 1);
      assert.match(alerts[0], expectedAlert);
    });
  });
});

describe("fake sheet", () => {
  test("rejects zero-row and zero-column ranges like Apps Script", () => {
    const sheet = fakeSheet([["a"]]);
    assert.throws(() => sheet.getRange(4, 1, 0, 1), /number of rows/);
    assert.throws(() => sheet.getRange(1, 1, 1, 0), /number of columns/);
  });

  test("gives each sheet a distinct ID by default", () => {
    assert.notEqual(fakeSheet([]).getSheetId(), fakeSheet([]).getSheetId());
  });
});

describe("getUniqueCharacterNames", () => {
  test("trims names, drops empty ones and removes duplicates ignoring case", () => {
    const { script } = loadAppsScript();

    const names = script.getUniqueCharacterNames([
      { name: "Harry Potter" },
      { name: " Harry Potter " },
      { name: "harry potter" },
      { name: "" },
      { name: "   " },
      { name: null },
      {},
      null,
      { name: "Hermione Granger" }
    ]);

    assert.deepEqual(structuredClone(names), ["Harry Potter", "Hermione Granger"]);
  });
});

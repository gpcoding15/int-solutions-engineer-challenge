// Loads the real production code (Apps Script source, GTM export, website
// script) into Node's vm module with mocked Google and browser services.
// Values coming out of a vm context are passed through structuredClone so
// assert.deepStrictEqual compares them as ordinary objects.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const APPS_SCRIPT_PATH = path.join(ROOT, "apps-script", "Código.js");
const GTM_EXPORT_PATH = path.join(ROOT, "gtm-container.json");
const NEWSLETTER_PATH = path.join(ROOT, "website", "js", "newsletter.js");
const EMPLOYEES_CSV_PATH = path.join(ROOT, "data", "bixby_employees.csv");

// ---------------------------------------------------------------------------
// Apps Script
// ---------------------------------------------------------------------------

// Converts an A1 cell reference such as "B1" into row and column numbers.
function parseA1(reference) {
  const match = /^([A-Z]+)(\d+)$/.exec(reference);
  if (!match) {
    throw new Error(`Unsupported A1 reference: ${reference}`);
  }
  const column = match[1]
    .split("")
    .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  return { row: Number(match[2]), column };
}

// Sheet IDs assigned when a test does not pass one, so two fake sheets are
// never mistaken for the same tab.
let nextSheetId = 1000;

// In-memory sheet with the subset of the Sheet and Range APIs the script uses.
// Every write is recorded so tests can assert that nothing was written.
function fakeSheet(rows, { id = nextSheetId++, maxRows = 1000, maxColumns = 26 } = {}) {
  const data = rows.map(row => row.slice());
  const writes = [];

  const cell = (row, column) => {
    const value = (data[row - 1] || [])[column - 1];
    return value === undefined ? "" : value;
  };

  const setCell = (row, column, value) => {
    while (data.length < row) {
      data.push([]);
    }
    data[row - 1][column - 1] = value;
  };

  const sheet = {
    data,
    writes,
    getSheetId: () => id,
    getMaxRows: () => Math.max(maxRows, data.length),
    getMaxColumns: () => maxColumns,
    getLastRow() {
      for (let row = data.length; row > 0; row--) {
        if (data[row - 1].some(value => value !== "" && value !== undefined)) {
          return row;
        }
      }
      return 0;
    },
    getRange(row, column, numRows = 1, numColumns = 1) {
      if (typeof row === "string") {
        ({ row, column } = parseA1(row));
      }
      // Apps Script rejects ranges with zero rows or columns.
      if (numRows < 1) {
        throw new Error("The number of rows in the range must be at least 1.");
      }
      if (numColumns < 1) {
        throw new Error("The number of columns in the range must be at least 1.");
      }
      if (row < 1 || column < 1 ||
          row + numRows - 1 > sheet.getMaxRows() ||
          column + numColumns - 1 > maxColumns) {
        throw new Error(`Range out of bounds: (${row}, ${column}, ${numRows}, ${numColumns})`);
      }

      return {
        getSheet: () => sheet,
        getValues() {
          return Array.from({ length: numRows }, (_, i) =>
            Array.from({ length: numColumns }, (_, j) => cell(row + i, column + j))
          );
        },
        setValues(values) {
          // Sheets rejects arrays whose size does not match the range.
          if (values.length !== numRows || values.some(line => line.length !== numColumns)) {
            throw new Error(
              `Data has ${values.length} rows but the range has ${numRows} rows and ${numColumns} columns.`
            );
          }
          const copy = structuredClone(values);
          writes.push({ row, column, numRows, numColumns, values: copy });
          copy.forEach((line, i) => line.forEach((value, j) => setCell(row + i, column + j, value)));
        },
        setValue(value) {
          const copy = structuredClone(value);
          writes.push({ row, column, numRows: 1, numColumns: 1, values: [[copy]] });
          setCell(row, column, copy);
        }
      };
    }
  };

  return sheet;
}

// Rows of data/bixby_employees.csv: two blank rows, headers in row 3, data from row 4.
function employeeRows() {
  return fs.readFileSync(EMPLOYEES_CSV_PATH, "utf8")
    .trim()
    .split(/\r?\n/)
    .map(line => line.split(","));
}

const STAFF_HEADERS = ["Name", "Mail", "Alias", "Hash", "Conteo de Seguridad"];

// Builds a staff sheet with the challenge layout from [name, hash, alias] rows.
function staffSheet(employees, options) {
  const rows = [
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    STAFF_HEADERS.slice(),
    ...employees.map(({ name = "", hash = "", alias = "" }) => [name, `${name}@bixby.com`, alias, hash, ""])
  ];
  return fakeSheet(rows, options);
}

// Mocked HTTPResponse returned by UrlFetchApp.fetch.
function httpResponse(statusCode, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    getResponseCode: () => statusCode,
    getContentText: () => text
  };
}

// Runs apps-script/Código.js in a fresh context with mocked SpreadsheetApp and
// UrlFetchApp. Top-level functions of the script become properties of `script`.
// Pass `random` to replace Math.random inside the script for deterministic runs.
function loadAppsScript({ sheets = [], activeSheet = sheets[0], fetch, random } = {}) {
  const alerts = [];
  const menus = [];
  const fetchCalls = [];

  const ui = {
    alert: message => {
      alerts.push(message);
    },
    createMenu(name) {
      const menu = {
        name,
        items: [],
        addItem(label, functionName) {
          menu.items.push({ label, functionName });
          return menu;
        },
        addToUi() {
          menus.push({ name: menu.name, items: menu.items });
        }
      };
      return menu;
    }
  };

  const script = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      getUi: () => ui,
      getActiveSpreadsheet: () => ({
        getActiveSheet: () => activeSheet,
        getSheets: () => sheets
      })
    },
    UrlFetchApp: {
      fetch(url, options) {
        fetchCalls.push({ url, options: structuredClone(options) });
        if (!fetch) {
          throw new Error("UrlFetchApp.fetch was called but not mocked.");
        }
        return fetch(url, options);
      }
    }
  });

  vm.runInContext(fs.readFileSync(APPS_SCRIPT_PATH, "utf8"), script, { filename: APPS_SCRIPT_PATH });

  if (random) {
    script.__random = random;
    vm.runInContext("Math.random = __random;", script);
  }

  return { script, alerts, menus, fetchCalls };
}

// ---------------------------------------------------------------------------
// GTM
// ---------------------------------------------------------------------------

function loadGtmExport() {
  return JSON.parse(fs.readFileSync(GTM_EXPORT_PATH, "utf8")).containerVersion;
}

function findByName(list, name) {
  const entity = (list || []).find(item => item.name === name);
  if (!entity) {
    throw new Error(`"${name}" not found in gtm-container.json`);
  }
  return entity;
}

function parameterValue(entity, key) {
  const parameter = (entity.parameter || []).find(item => item.key === key);
  return parameter && parameter.value;
}

function getPath(object, dottedPath) {
  return dottedPath.split(".").reduce(
    (value, key) => (value !== null && typeof value === "object" ? value[key] : undefined),
    object
  );
}

// Replaces every {{Variable Name}} with a call that resolves it at run time,
// the same way GTM injects variables into Custom HTML and Custom JavaScript.
function bindVariables(code) {
  return code.replace(/\{\{([^}]+)\}\}/g, (_, name) => `__gtmVariable(${JSON.stringify(name.trim())})`);
}

// Resolves a GTM variable against a data layer model. Only the variable types
// used by this container are supported; anything else throws.
function resolveVariable(container, name, model, context) {
  if (name === "_event") {
    return model.event;
  }

  const variable = findByName(container.variable, name);

  if (variable.type === "v") {
    return getPath(model, parameterValue(variable, "name"));
  }

  if (variable.type === "jsm") {
    const code = `(${bindVariables(parameterValue(variable, "javascript"))})`;
    const variableContext = context || vm.createContext({});
    variableContext.__gtmVariable = innerName => resolveVariable(container, innerName, model, variableContext);
    return vm.runInContext(code, variableContext)();
  }

  throw new Error(`Variable type "${variable.type}" of "${name}" is not supported by the test helpers.`);
}

// Resolves a parameter that is either a literal or exactly one {{variable}}.
function resolveTemplate(container, template, model) {
  const match = /^\{\{([^}]+)\}\}$/.exec(template);
  if (match) {
    return resolveVariable(container, match[1].trim(), model);
  }
  if (template.includes("{{")) {
    throw new Error(`Mixed template "${template}" is not supported by the test helpers.`);
  }
  return template;
}

// Runs the "HTML - Transform Add to Cart" tag exactly as exported, for a
// ga4.trackEvent push that carries `eventParams`.
function runAddToCartTag(eventParams) {
  const container = loadGtmExport();
  const tag = findByName(container.tag, "HTML - Transform Add to Cart");
  const html = parameterValue(tag, "html");
  const match = /^\s*<script>([\s\S]*)<\/script>\s*$/.exec(html);
  if (!match) {
    throw new Error("The add-to-cart tag is expected to be a single <script> block.");
  }

  const model = { event: "ga4.trackEvent", eventName: "add_to_cart", eventParams };
  const dataLayer = [];
  const warnings = [];
  const context = vm.createContext({
    window: { dataLayer },
    console: {
      log() {},
      warn: (...args) => {
        warnings.push(args.filter(arg => typeof arg === "string").join(" "));
      }
    }
  });
  context.__gtmVariable = name => resolveVariable(container, name, model, context);

  vm.runInContext(bindVariables(match[1]), context);

  return { pushes: structuredClone(dataLayer), warnings };
}

// Merges a push into the data layer model like GTM does: plain objects and
// arrays are merged recursively, any other value replaces the previous one.
function mergeIntoModel(model, push) {
  Object.keys(push).forEach(key => {
    const value = push[key];
    const current = model[key];
    const mergeable = item => item !== null && typeof item === "object";

    if (mergeable(value) && mergeable(current) && Array.isArray(value) === Array.isArray(current)) {
      mergeIntoModel(current, value);
    } else {
      model[key] = mergeable(value) ? structuredClone(value) : value;
    }
  });
}

// GTM exports "does not equal" as EQUALS with negate=true. Any other filter
// type or option (ignore_case, unknown keys) throws instead of being ignored.
function filterMatches(container, filter, model) {
  if (filter.type !== "EQUALS") {
    throw new Error(`Filter type "${filter.type}" is not supported by the test helpers.`);
  }

  const keys = (filter.parameter || []).map(({ key }) => key);
  const unsupported = keys.filter(key => !["arg0", "arg1", "negate"].includes(key));
  if (unsupported.length > 0 || !keys.includes("arg0") || !keys.includes("arg1")) {
    throw new Error(`Filter options ${JSON.stringify(keys)} are not supported by the test helpers.`);
  }

  const negate = parameterValue(filter, "negate");
  if (negate !== undefined && negate !== "true" && negate !== "false") {
    throw new Error(`Unexpected negate value ${JSON.stringify(negate)}.`);
  }

  const arg0 = resolveTemplate(container, parameterValue(filter, "arg0"), model);
  const arg1 = resolveTemplate(container, parameterValue(filter, "arg1"), model);
  const equal = String(arg0) === String(arg1);
  return negate === "true" ? !equal : equal;
}

function triggerMatches(container, trigger, model) {
  if (trigger.type !== "CUSTOM_EVENT") {
    throw new Error(`Trigger type "${trigger.type}" of "${trigger.name}" is not supported by the test helpers.`);
  }
  return [...(trigger.customEventFilter || []), ...(trigger.filter || [])]
    .every(filter => filterMatches(container, filter, model));
}

// Minimal trigger evaluation over the exported container. It supports only
// CUSTOM_EVENT triggers with EQUALS filters (optionally negated) and throws on
// anything else, including paused tags and tag sequencing, so a test can
// never pass because of an unsupported configuration. For each push
// it returns the tags that fire and, for GA4 event tags, the event they send.
function simulateTriggers(pushes, container = loadGtmExport()) {
  const model = {};

  return pushes.map(push => {
    mergeIntoModel(model, push);

    if (!("event" in push)) {
      return [];
    }

    const firedTriggerIds = new Set(
      container.trigger
        .filter(trigger => triggerMatches(container, trigger, model))
        .map(trigger => trigger.triggerId)
    );

    return container.tag
      .filter(tag => (tag.firingTriggerId || []).some(id => firedTriggerIds.has(id)))
      .map(tag => {
        if (tag.blockingTriggerId && tag.blockingTriggerId.length > 0) {
          throw new Error(`Blocking triggers on "${tag.name}" are not supported by the test helpers.`);
        }
        if (tag.paused) {
          throw new Error(`Tag "${tag.name}" is paused, which the test helpers do not simulate.`);
        }
        if (tag.setupTag || tag.teardownTag) {
          throw new Error(`Tag sequencing on "${tag.name}" is not supported by the test helpers.`);
        }
        const fired = { name: tag.name };
        if (tag.type === "gaawe") {
          const table = (tag.parameter.find(item => item.key === "eventSettingsTable") || { list: [] }).list;
          fired.eventName = parameterValue(tag, "eventName");
          fired.parameters = {};
          table.forEach(row => {
            const name = row.map.find(item => item.key === "parameter").value;
            const value = row.map.find(item => item.key === "parameterValue").value;
            fired.parameters[name] = resolveTemplate(container, value, model);
          });
          fired.parameters = structuredClone(fired.parameters);
        }
        return fired;
      });
  });
}

// ---------------------------------------------------------------------------
// Website
// ---------------------------------------------------------------------------

// Runs website/js/newsletter.js against a minimal DOM and submits each email
// in order. Returns the dataLayer pushes made by the real site code.
function runNewsletterSubmissions(emails) {
  const dataLayer = [];
  const input = { value: "" };
  const success = { hidden: true, textContent: "" };
  const warning = { hidden: true, textContent: "" };
  let submitHandler;
  let domReadyHandler;

  const form = {
    dataset: {},
    querySelector: selector => ({
      "[data-newsletter-email]": input,
      "[data-message='success']": success,
      "[data-message='warning']": warning
    })[selector] || null,
    addEventListener(type, handler) {
      if (type === "submit") {
        submitHandler = handler;
      }
    }
  };

  const context = vm.createContext({
    window: { dataLayer },
    document: {
      querySelector: selector => (selector === "[data-newsletter]" ? form : null),
      addEventListener(type, handler) {
        if (type === "DOMContentLoaded") {
          domReadyHandler = handler;
        }
      }
    }
  });

  vm.runInContext(fs.readFileSync(NEWSLETTER_PATH, "utf8"), context, { filename: NEWSLETTER_PATH });
  domReadyHandler();

  if (!submitHandler) {
    throw new Error("newsletter.js did not bind a submit handler.");
  }

  emails.forEach(email => {
    input.value = email;
    submitHandler({ preventDefault() {} });
  });

  return structuredClone(dataLayer);
}

module.exports = {
  STAFF_HEADERS,
  employeeRows,
  fakeSheet,
  staffSheet,
  httpResponse,
  loadAppsScript,
  loadGtmExport,
  findByName,
  runAddToCartTag,
  simulateTriggers,
  runNewsletterSubmissions
};

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  loadGtmExport,
  findByName,
  runAddToCartTag,
  simulateTriggers,
  runNewsletterSubmissions
} = require("./helpers");

// dataLayer push from README.md (Children's Beach Boat).
function beachBoatPush() {
  return {
    event: "ga4.trackEvent",
    eventName: "add_to_cart",
    eventParams: {
      section: "shop",
      value: 7,
      currency: "USD",
      items: [{
        item_id: "20017478",
        item_name: "Children's Beach Boat",
        item_brand: "Pipo Toys & Random Stuff",
        price: 7,
        item_category: "Children's Stuff",
        item_variant: "Limited edition",
        quantity: 1
      }],
      site: "pipo sandbox"
    }
  };
}

function item(price, quantity, extra) {
  return Object.assign({ item_id: "sku", item_name: "Product", price, quantity }, extra);
}

function params(items, currency = "USD") {
  return { section: "shop", currency, items, site: "pipo sandbox" };
}

// Runs the tag and returns the transformed add_to_cart push, failing if the
// tag did not produce exactly { ecommerce: null } followed by the event.
function transform(eventParams) {
  const { pushes, warnings } = runAddToCartTag(eventParams);
  assert.equal(pushes.length, 2, `expected 2 pushes, got ${pushes.length}; warnings: ${warnings.join(" | ")}`);
  assert.deepEqual(pushes[0], { ecommerce: null });
  assert.equal(pushes[1].event, "add_to_cart");
  return pushes[1].ecommerce;
}

function assertRejected(eventParams, expectedWarning) {
  const { pushes, warnings } = runAddToCartTag(eventParams);
  assert.deepEqual(pushes, [], "no push should reach the dataLayer");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^add_to_cart not sent: /);
  if (expectedWarning) {
    assert.match(warnings[0], expectedWarning);
  }
}

describe("add_to_cart transformation", () => {
  test("produces the README output for the beach boat", () => {
    const { pushes } = runAddToCartTag(beachBoatPush().eventParams);

    assert.deepEqual(pushes, [
      { ecommerce: null },
      {
        event: "add_to_cart",
        ecommerce: {
          value: 8.47,
          currency: "USD",
          items: [{
            item_id: "20017478",
            item_name: "Children's Beach Boat",
            item_brand: "Pipo Toys & Random Stuff",
            price: 7,
            tax: 1.47,
            item_category: "Children's Stuff",
            item_variant: "Limited edition",
            quantity: 1
          }]
        }
      }
    ]);
  });

  [
    [5.95, 1.25, 7.2],
    [21.5, 4.52, 26.02],
    [22.5, 4.73, 27.23],
    [29.5, 6.2, 35.7],
    [15, 3.15, 18.15],
    [22, 4.62, 26.62],
    [40000, 8400, 48400],
    [92000, 19320, 111320],
    [0, 0, 0]
  ].forEach(([price, tax, value]) => {
    test(`price ${price} -> tax ${tax}, value ${value}`, () => {
      const ecommerce = transform(params([item(price, 1)]));
      assert.equal(ecommerce.items[0].tax, tax);
      assert.equal(ecommerce.value, value);
    });
  });

  test("rounds 21% half up for every price from 0.01 to 100.00", () => {
    const prices = Array.from({ length: 10000 }, (_, i) => (i + 1) / 100);
    const ecommerce = transform(params(prices.map(price => item(price, 1))));

    const wrong = ecommerce.items.filter((result, i) => {
      // 21% of a whole number of cents, rounded half up, computed exactly.
      const cents = i + 1;
      const expectedTax = Math.floor((cents * 21 + 50) / 100) / 100;
      return result.tax !== expectedTax;
    });

    assert.deepEqual(wrong.map(({ price, tax }) => ({ price, tax })), []);
  });

  test("multiplies unit price plus tax by quantity", () => {
    assert.equal(transform(params([item(5.95, 3)])).value, 21.6);
  });

  test("adds up several items", () => {
    const ecommerce = transform(params([item(7, 1), item(5.95, 2)]));
    assert.equal(ecommerce.value, 22.87);
    assert.deepEqual(ecommerce.items.map(({ tax }) => tax), [1.47, 1.25]);
  });

  test("accepts numeric strings and outputs numbers", () => {
    const ecommerce = transform(params([item("7", "2")]));
    assert.equal(ecommerce.items[0].price, 7);
    assert.equal(ecommerce.items[0].quantity, 2);
    assert.equal(ecommerce.value, 16.94);
  });

  test("defaults a missing quantity to 1", () => {
    const ecommerce = transform(params([{ item_id: "sku", item_name: "Product", price: 7 }]));
    assert.equal(ecommerce.items[0].quantity, 1);
    assert.equal(ecommerce.value, 8.47);
  });

  test("keeps the original item fields, drops section and site, takes currency from the push", () => {
    const ecommerce = transform(params([item(7, 1, { item_brand: "Brand", item_list_id: "list" })], "EUR"));
    assert.deepEqual(Object.keys(ecommerce).sort(), ["currency", "items", "value"]);
    assert.equal(ecommerce.currency, "EUR");
    assert.equal(ecommerce.items[0].item_brand, "Brand");
    assert.equal(ecommerce.items[0].item_list_id, "list");
  });

  test("does not modify the original event parameters", () => {
    const original = beachBoatPush().eventParams;
    const snapshot = structuredClone(original);
    runAddToCartTag(original);
    assert.deepEqual(original, snapshot);
  });

  describe("rejects the whole event", () => {
    test("when eventParams is missing", () => assertRejected(undefined, /parameters are missing or invalid/));
    test("when items is missing", () => assertRejected({ currency: "USD" }, /items or currency/));
    test("when items is not a list", () => assertRejected({ currency: "USD", items: "boat" }, /items or currency/));
    test("when items is empty", () => assertRejected(params([]), /items list is empty/));
    test("when currency is missing", () => assertRejected({ items: [item(7, 1)] }, /items or currency/));
    test("when currency is empty", () => assertRejected(params([item(7, 1)], ""), /items or currency/));
    test("when an item is null", () => assertRejected(params([null]), /item 0 is not an object/));
    test("when an item is a string", () => assertRejected(params(["boat"]), /item 0 is not an object/));

    [
      ["missing", undefined],
      ["null", null],
      ["empty string", ""],
      ["text", "abc"],
      ["negative", -1]
    ].forEach(([description, price]) => {
      test(`when a price is ${description}`, () => {
        const broken = item(price, 1);
        if (price === undefined) {
          delete broken.price;
        }
        assertRejected(params([broken]), /item 0 has an invalid price or quantity/);
      });
    });

    [
      ["zero", 0],
      ["negative", -1],
      ["fractional", 1.5],
      ["text", "x"],
      ["null", null]
    ].forEach(([description, quantity]) => {
      test(`when a quantity is ${description}`, () => {
        assertRejected(params([item(7, quantity)]), /item 0 has an invalid price or quantity/);
      });
    });

    test("when one item is invalid and the others are valid", () => {
      assertRejected(params([item(7, 1), item("abc", 1), item(5.95, 1)]), /item 1 has an invalid price or quantity/);
    });
  });
});

describe("add_to_cart triggers", () => {
  test("the site push fires only the transformation tag", () => {
    const [fired] = simulateTriggers([beachBoatPush()]);
    assert.deepEqual(fired.map(({ name }) => name), ["HTML - Transform Add to Cart"]);
  });

  test("the transformed push fires one GA4 add_to_cart with value, currency and items", () => {
    const { pushes } = runAddToCartTag(beachBoatPush().eventParams);
    const [afterClear, afterEvent] = simulateTriggers(pushes);

    assert.deepEqual(afterClear, []);
    assert.equal(afterEvent.length, 1);
    assert.equal(afterEvent[0].name, "GA4 - Add to Cart");
    assert.equal(afterEvent[0].eventName, "add_to_cart");
    assert.equal(afterEvent[0].parameters.value, 8.47);
    assert.equal(afterEvent[0].parameters.currency, "USD");
    assert.deepEqual(afterEvent[0].parameters.items, pushes[1].ecommerce.items);
  });

  test("clears ecommerce so items from an earlier add_to_cart do not leak into the next", () => {
    const first = runAddToCartTag(params([item(7, 1, { item_id: "boat" }), item(5.95, 1, { item_id: "shovel" })]));
    const second = runAddToCartTag(params([item(15, 1, { item_id: "bucket" })]));
    const fired = simulateTriggers([...first.pushes, ...second.pushes]);

    const sentItems = fired
      .flat()
      .filter(({ name }) => name === "GA4 - Add to Cart")
      .map(({ parameters }) => parameters.items.map(({ item_id }) => item_id));

    assert.deepEqual(sentItems, [["boat", "shovel"], ["bucket"]]);
    assert.equal(fired[3][0].parameters.value, 18.15);
  });

  test("other ga4.trackEvent events do not fire the transformation", () => {
    const [fired] = simulateTriggers([{ event: "ga4.trackEvent", eventName: "view_item", eventParams: {} }]);
    assert.deepEqual(fired, []);
  });
});

describe("GA4 configuration", () => {
  const MEASUREMENT_ID = "G-LZ7M6MZPJ2";
  const INITIALIZATION_ALL_PAGES = "2147479573";

  test("has exactly one Google Tag for the property, fired on Initialization", () => {
    const googleTags = loadGtmExport().tag.filter(({ type }) => type === "googtag");
    assert.equal(googleTags.length, 1);
    assert.equal(googleTags[0].parameter.find(({ key }) => key === "tagId").value, MEASUREMENT_ID);
    assert.deepEqual(googleTags[0].firingTriggerId, [INITIALIZATION_ALL_PAGES]);
  });

  test("every GA4 event tag sends to the same measurement ID", () => {
    const eventTags = loadGtmExport().tag.filter(({ type }) => type === "gaawe");
    assert.deepEqual(
      eventTags.map(({ name }) => name).sort(),
      ["GA4 - Add to Cart", "GA4 - Newsletter Error", "GA4 - Newsletter Success"]
    );
    eventTags.forEach(tag => {
      const override = tag.parameter.find(({ key }) => key === "measurementIdOverride");
      assert.equal(override && override.value, MEASUREMENT_ID, `${tag.name} measurement ID`);
    });
  });

  test("the add_to_cart tag maps ecommerce parameters manually", () => {
    const tag = findByName(loadGtmExport().tag, "GA4 - Add to Cart");
    const setting = tag.parameter.find(({ key }) => key === "sendEcommerceData");
    assert.equal(setting && setting.value, "false");
  });

  test("no tag is paused or sequenced", () => {
    loadGtmExport().tag.forEach(tag => {
      assert.notEqual(tag.paused, true, `${tag.name} is paused`);
      assert.equal(tag.setupTag, undefined, `${tag.name} has a setup tag`);
      assert.equal(tag.teardownTag, undefined, `${tag.name} has a teardown tag`);
    });
  });
});

describe("trigger simulator", () => {
  // Returns a copy of the export where the formName filter of the success
  // trigger gets an extra parameter.
  function withSuccessFilterParameter(parameter) {
    const container = loadGtmExport();
    const trigger = findByName(container.trigger, "CE - Newsletter Success");
    const filter = trigger.filter.find(({ parameter: args }) =>
      args.some(({ value }) => value === "{{DLV - formName}}")
    );
    filter.parameter.push(parameter);
    return container;
  }

  const okPush = { event: "formSubmission", formName: "Newsletter", formStatus: "Ok" };
  const contactPush = { event: "formSubmission", formName: "Contact", formStatus: "Ok" };

  test("treats negate=true as does-not-equal", () => {
    const container = withSuccessFilterParameter({ type: "BOOLEAN", key: "negate", value: "true" });
    const names = pushes => simulateTriggers(pushes, container).map(fired => fired.map(({ name }) => name));

    assert.deepEqual(names([okPush]), [[]]);
    assert.deepEqual(names([contactPush]), [["GA4 - Newsletter Success"]]);
  });

  test("throws on filter options it does not simulate", () => {
    const container = withSuccessFilterParameter({ type: "BOOLEAN", key: "ignore_case", value: "true" });
    assert.throws(() => simulateTriggers([okPush], container), /not supported/);
  });

  test("throws when a fired tag is paused", () => {
    const container = loadGtmExport();
    findByName(container.tag, "GA4 - Newsletter Success").paused = true;
    assert.throws(() => simulateTriggers([okPush], container), /paused/);
  });
});

describe("newsletter", () => {
  test("the site pushes the expected status and error for each outcome", () => {
    const pushes = runNewsletterSubmissions(["", "not-an-email", "ana@example.com"]);

    assert.deepEqual(pushes, [
      { event: "formSubmission", formName: "Newsletter", formStatus: "Error", formError: "Empty email" },
      { event: "formSubmission", formName: "Newsletter", formStatus: "Error", formError: "Wrong format" },
      { event: "formSubmission", formName: "Newsletter", formStatus: "Ok" }
    ]);
  });

  test("each submission sends exactly one newsletter_submission with the right parameters", () => {
    const fired = simulateTriggers(runNewsletterSubmissions(["", "not-an-email", "ana@example.com"]));

    assert.deepEqual(fired, [
      [{
        name: "GA4 - Newsletter Error",
        eventName: "newsletter_submission",
        parameters: { form_name: "Newsletter", form_status: "Error", form_error: "Empty email" }
      }],
      [{
        name: "GA4 - Newsletter Error",
        eventName: "newsletter_submission",
        parameters: { form_name: "Newsletter", form_status: "Error", form_error: "Wrong format" }
      }],
      // formError from the previous push is still in the data layer model,
      // but the success tag must not send it.
      [{
        name: "GA4 - Newsletter Success",
        eventName: "newsletter_submission",
        parameters: { form_name: "Newsletter", form_status: "Ok" }
      }]
    ]);
  });

  test("other forms do not fire newsletter tags", () => {
    const fired = simulateTriggers([
      { event: "formSubmission", formName: "Contact", formStatus: "Ok" },
      { event: "formSubmission", formName: "Contact", formStatus: "Error", formError: "Empty email" }
    ]);
    assert.deepEqual(fired, [[], []]);
  });

  test("the success tag has no form_error parameter and the error tag has one", () => {
    const container = loadGtmExport();
    const parameterNames = name => findByName(container.tag, name)
      .parameter.find(({ key }) => key === "eventSettingsTable")
      .list.map(row => row.map.find(({ key }) => key === "parameter").value);

    assert.deepEqual(parameterNames("GA4 - Newsletter Success"), ["form_name", "form_status"]);
    assert.deepEqual(parameterNames("GA4 - Newsletter Error"), ["form_name", "form_status", "form_error"]);
  });
});

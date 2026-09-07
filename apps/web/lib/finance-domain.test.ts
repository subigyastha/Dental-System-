import assert from "node:assert/strict";
import test from "node:test";

import {
  canRecordPaymentForStatus,
  formatNpr,
  isPositiveMoney,
  maskFinanceReference,
  requiresPaymentReference,
} from "./finance-domain";

test("formats financial values as NPR with two decimal places", () => {
  assert.equal(formatNpr("1250.5"), "NPR 1,250.50");
  assert.equal(formatNpr("not-a-number"), "NPR —");
});

test("accepts only positive decimal amounts with at most two decimals", () => {
  assert.equal(isPositiveMoney("100"), true);
  assert.equal(isPositiveMoney("0.01"), true);
  assert.equal(isPositiveMoney("0"), false);
  assert.equal(isPositiveMoney("-1"), false);
  assert.equal(isPositiveMoney("1.001"), false);
  assert.equal(isPositiveMoney("1e3"), false);
});

test("masks long provider references while preserving reconciliation hints", () => {
  assert.equal(maskFinanceReference("FONEPAY-ABC-123456"), "FON•••456");
  assert.equal(maskFinanceReference(undefined), "Not recorded");
});

test("requires references for every non-cash receipt", () => {
  assert.equal(requiresPaymentReference("Cash"), false);
  assert.equal(requiresPaymentReference("Card"), true);
  assert.equal(requiresPaymentReference("MobileWallet"), true);
});

test("records payments only against issued unpaid lifecycle states", () => {
  assert.equal(canRecordPaymentForStatus("Draft"), false);
  assert.equal(canRecordPaymentForStatus("Issued"), true);
  assert.equal(canRecordPaymentForStatus("PartiallyPaid"), true);
  assert.equal(canRecordPaymentForStatus("Paid"), false);
  assert.equal(canRecordPaymentForStatus("Void"), false);
});

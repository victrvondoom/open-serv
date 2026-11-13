import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "@/lib/actions/policy";

const flagged = { doc1: { severity: "HIGH" as const, categories: ["EXTERNAL_COMM_REDIRECT"], deterministic: true, reviewed: false } };
const third = [{ sourceId: "doc1", kind: "THIRD_PARTY" as const }];

describe("action policy (deterministic, fail-closed)", () => {
  it("blocks secrets and financial actions for everyone", () => {
    for (const actorType of ["USER", "AGENT", "SYSTEM"] as const) {
      expect(evaluatePolicy({ actionType: "ACCESS_SECRET", actorType, params: {}, sourceRefs: [] }, { flagged: {} }).decision).toBe("BLOCK");
      expect(evaluatePolicy({ actionType: "FINANCIAL_ACTION", actorType, params: {}, sourceRefs: [] }, { flagged: {} }).decision).toBe("BLOCK");
    }
  });
  it("blocks recipient change influenced by third-party content, even by a USER", () => {
    const r = evaluatePolicy({ actionType: "MODIFY_RFQ_RECIPIENT", actorType: "USER", params: { to: "a@b.c" }, sourceRefs: third, userConfirmed: true }, { flagged });
    expect(r.decision).toBe("BLOCK");
  });
  it("blocks agent requirement changes; allows only confirmed user changes", () => {
    expect(evaluatePolicy({ actionType: "MODIFY_PROJECT_REQUIREMENTS", actorType: "AGENT", params: {}, sourceRefs: [] }, { flagged: {} }).decision).toBe("BLOCK");
    expect(evaluatePolicy({ actionType: "MODIFY_PROJECT_REQUIREMENTS", actorType: "USER", params: {}, sourceRefs: [] }, { flagged: {} }).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluatePolicy({ actionType: "MODIFY_PROJECT_REQUIREMENTS", actorType: "USER", params: {}, sourceRefs: [], userConfirmed: true }, { flagged: {} }).decision).toBe("ALLOW");
  });
  it("never lets an agent send; recipient must be on the RFQ", () => {
    const ctx = { flagged: {}, rfqRecipients: ["ok@x.test"] };
    expect(evaluatePolicy({ actionType: "SEND_RFQ_EMAIL", actorType: "AGENT", params: { to: "evil@x.test" }, sourceRefs: [] }, ctx).decision).toBe("BLOCK");
    expect(evaluatePolicy({ actionType: "SEND_RFQ_EMAIL", actorType: "AGENT", params: { to: "ok@x.test" }, sourceRefs: [] }, ctx).decision).toBe("REQUIRE_APPROVAL");
  });
  it("requires approval matching content hash for user sends", () => {
    const base = { actionType: "SEND_RFQ_EMAIL" as const, actorType: "USER" as const, params: { to: "ok@x.test" }, sourceRefs: [] };
    expect(evaluatePolicy(base, { flagged: {}, rfqRecipients: ["ok@x.test"] }).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluatePolicy(base, { flagged: {}, rfqRecipients: ["ok@x.test"], rfqApproval: { contentHashMatches: false, approvedEmails: ["ok@x.test"] } }).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluatePolicy(base, { flagged: {}, rfqRecipients: ["ok@x.test"], rfqApproval: { contentHashMatches: true, approvedEmails: ["ok@x.test"] }, recipientNeedsManualConfirmation: true }).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluatePolicy(base, { flagged: {}, rfqRecipients: ["ok@x.test"], rfqApproval: { contentHashMatches: true, approvedEmails: ["ok@x.test"] } }).decision).toBe("ALLOW");
  });
  it("quarantines agent drafts derived from flagged sources; requires approval without provenance", () => {
    expect(evaluatePolicy({ actionType: "CREATE_RFQ_DRAFT", actorType: "AGENT", params: {}, sourceRefs: third }, { flagged }).decision).toBe("QUARANTINE");
    expect(evaluatePolicy({ actionType: "CREATE_RFQ_DRAFT", actorType: "AGENT", params: {}, sourceRefs: [] }, { flagged: {} }).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluatePolicy({ actionType: "CREATE_RFQ_DRAFT", actorType: "AGENT", params: {}, sourceRefs: [{ sourceId: "d", kind: "THIRD_PARTY" }] }, { flagged: {} }).decision).toBe("ALLOW");
  });
  it("fails closed on unknown actions", () => {
    expect(evaluatePolicy({ actionType: "NOPE" as never, actorType: "USER", params: {}, sourceRefs: [] }, { flagged: {} }).decision).toBe("BLOCK");
  });
});

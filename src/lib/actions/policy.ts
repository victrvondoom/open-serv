import type { ActionType, ActorType, PolicyDecision } from "@/generated/prisma/client";

/** Where a piece of information that influenced an action came from. */
export interface SourceRef {
  sourceId: string; // SourceDocument id (or benchmark source id)
  passageId?: string;
  kind: "USER" | "SYSTEM" | "THIRD_PARTY" | "MODEL";
  url?: string;
  contentHash?: string;
}
export interface PolicyInput {
  actionType: ActionType;
  actorType: ActorType;
  params: Record<string, unknown>;
  sourceRefs: SourceRef[];
  /** The caller asserts an explicit, human, UI-level confirmation (only honoured for actorType USER). */
  userConfirmed?: boolean;
}
export interface FlaggedSource { severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; categories: string[]; deterministic: boolean; reviewed: boolean }
export interface PolicyContext {
  flagged: Record<string, FlaggedSource>;
  /** Emails that are on the RFQ the action refers to. */
  rfqRecipients?: string[];
  rfqApproval?: { contentHashMatches: boolean; approvedEmails: string[] } | null;
  recipientNeedsManualConfirmation?: boolean;
  recipientManuallyConfirmed?: boolean;
  /** Raw text of third-party sources referenced, used to detect "recipient came from untrusted text". */
  thirdPartyText?: string;
}
export interface PolicyReason { code: string; message: string }
export interface PolicyResult { decision: PolicyDecision; reasons: PolicyReason[] }

const MEDIUM_UP = new Set(["MEDIUM", "HIGH", "CRITICAL"]);
const R = (decision: PolicyDecision, ...reasons: PolicyReason[]): PolicyResult => ({ decision, reasons });
const reason = (code: string, message: string): PolicyReason => ({ code, message });

/**
 * Deterministic action policy. Pure function: no model, no network, no randomness.
 * Anything not explicitly allowed is blocked (fail closed).
 */
export function evaluatePolicy(input: PolicyInput, ctx: PolicyContext): PolicyResult {
  try {
    const thirdParty = input.sourceRefs.filter((s) => s.kind === "THIRD_PARTY");
    const flaggedRefs = thirdParty.filter((s) => {
      const f = ctx.flagged[s.sourceId];
      return !!f && f.deterministic && MEDIUM_UP.has(f.severity) && !f.reviewed;
    });
    const agent = input.actorType === "AGENT";
    const userConfirmed = input.actorType === "USER" && input.userConfirmed === true && thirdParty.length === 0;

    switch (input.actionType) {
      case "ACCESS_SECRET":
        return R("BLOCK", reason("SECRETS_PROHIBITED", "Access to secrets, credentials and environment variables is prohibited for every actor."));
      case "FINANCIAL_ACTION":
        return R("BLOCK", reason("FINANCIAL_UNSUPPORTED", "Payments, transfers and financial account actions are not supported."));
      case "FETCH_URL":
        if (agent || thirdParty.length) return R("BLOCK", reason("FETCH_NOT_AGENT_CONTROLLED", "URL retrieval is performed only by the controlled retrieval service; agents and third-party content cannot trigger fetches."));
        return R("ALLOW", reason("RETRIEVAL_SERVICE", "Public retrieval through the controlled retrieval service."));

      case "MODIFY_RFQ_RECIPIENT":
      case "MODIFY_PROJECT_REQUIREMENTS": {
        const what = input.actionType === "MODIFY_RFQ_RECIPIENT" ? "RFQ recipient" : "approved sourcing requirement";
        if (thirdParty.length) {
          const base = reason("THIRD_PARTY_INFLUENCE", `A change to the ${what} was proposed with third-party (retrieved) content in its provenance. Retrieved content can never change ${what}s.`);
          return flaggedRefs.length ? R("BLOCK", base, reason("SOURCE_FLAGGED", `Referenced source(s) carry unreviewed ${flaggedRefs.map((s) => ctx.flagged[s.sourceId].categories.join("/")).join(", ")} findings.`)) : R("BLOCK", base);
        }
        if (agent) return R("BLOCK", reason("AGENT_CANNOT_MODIFY", `Agents cannot change the ${what}; only the user can.`));
        if (input.actorType === "SYSTEM") return R("BLOCK", reason("SYSTEM_CANNOT_MODIFY", `Automated processes cannot change the ${what}.`));
        if (userConfirmed) return R("ALLOW", reason("USER_CONFIRMED", `User explicitly confirmed the ${what} change.`));
        return R("REQUIRE_APPROVAL", reason("CONFIRMATION_REQUIRED", `Changing the ${what} requires explicit user confirmation.`));
      }

      case "SEND_RFQ_EMAIL": {
        const to = String(input.params.to ?? "").toLowerCase();
        const onRfq = !!to && (ctx.rfqRecipients ?? []).map((e) => e.toLowerCase()).includes(to);
        if (input.actorType === "SYSTEM") return R("BLOCK", reason("SYSTEM_CANNOT_SEND", "Automated processes cannot send external email."));
        if (flaggedRefs.length) return R("QUARANTINE", reason("SOURCE_FLAGGED", "The message is derived from a source with unreviewed security findings. Review the findings before sending."));
        if (!onRfq) return R("BLOCK", reason("RECIPIENT_NOT_ON_RFQ", "The recipient is not one of the user-approved recipients on this RFQ."));
        if (agent) return R("REQUIRE_APPROVAL", reason("AGENT_NEEDS_HUMAN", "Agents can only propose sends; a human must explicitly approve the exact recipients and content."));
        if (thirdParty.length && ctx.thirdPartyText && ctx.thirdPartyText.toLowerCase().includes(to) && !ctx.rfqApproval) return R("BLOCK", reason("RECIPIENT_FROM_UNTRUSTED_TEXT", "The recipient address appears only in third-party text, not in verified evidence."));
        if (!ctx.rfqApproval || !ctx.rfqApproval.contentHashMatches || !ctx.rfqApproval.approvedEmails.map((e) => e.toLowerCase()).includes(to)) return R("REQUIRE_APPROVAL", reason("EXPLICIT_APPROVAL_REQUIRED", "Sending external email requires the user to approve the exact recipients and content."));
        if (ctx.recipientNeedsManualConfirmation && !ctx.recipientManuallyConfirmed) return R("REQUIRE_APPROVAL", reason("RECIPIENT_UNVERIFIED", "The recipient address is not corroborated by reliable evidence and has not been manually confirmed."));
        return R("ALLOW", reason("USER_APPROVED", "Recipients and content were explicitly approved by the user and are unchanged."));
      }

      case "CREATE_SUPPLIER_RECORD":
      case "UPDATE_SUPPLIER_NOTES":
      case "CREATE_COMPARISON":
      case "CREATE_RFQ_DRAFT":
      case "EXPORT_RFQ": {
        if (flaggedRefs.length && (agent || input.actorType === "SYSTEM") && input.actionType !== "CREATE_SUPPLIER_RECORD" && input.actionType !== "EXPORT_RFQ")
          return R("QUARANTINE", reason("SOURCE_FLAGGED", `Action derived from source(s) with unreviewed ${flaggedRefs.map((s) => ctx.flagged[s.sourceId].categories.join("/")).join(", ")} findings; quarantined until reviewed.`));
        if (agent && input.actionType !== "EXPORT_RFQ" && input.sourceRefs.length === 0 && input.params.derivedFromEvidence !== false)
          return R("REQUIRE_APPROVAL", reason("MISSING_PROVENANCE", "An agent-proposed action has no source references. PROXY never invents citations; a human must approve."));
        return R("ALLOW", reason("PERMITTED", "Action is within the permitted set and has valid provenance."));
      }
      default:
        return R("BLOCK", reason("UNKNOWN_ACTION", "Unknown action type — blocked (fail closed)."));
    }
  } catch (e) {
    return R("BLOCK", reason("POLICY_ERROR", `Policy evaluation failed (${e instanceof Error ? e.message : "error"}); blocked (fail closed).`));
  }
}

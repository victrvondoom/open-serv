# Threat model

**Assets:** user-approved sourcing requirements, RFQ recipients and content, API secrets, supplier evidence integrity, audit trail.
**Adversary:** a party that controls text a supplier website, search snippet, Maps description or review will deliver to PROXY (or to an AI agent using PROXY).
**Trust levels:** USER (UI actions) › SYSTEM (pipeline) › MODEL output › THIRD_PARTY retrieved content (always untrusted data, never instructions).

| Threat | Mitigation | Residual risk |
|---|---|---|
| Prompt injection / instruction override in retrieved content | Content is stored and displayed as data. Deterministic scanner (rules v2026.11.1) runs on every passage including hidden text; flagged passages are never sent to LLMs; LLM output is schema-validated. | Novel phrasings evade rules (see benchmark HOLDOUT recall); the action layer is the backstop. |
| Exfiltration of secrets | Secrets exist only in server env; no tool/path exposes them; `ACCESS_SECRET` is always `BLOCK`; scanner flags requests for them. | A compromised server environment is out of scope. |
| Recipient redirection / contact substitution | `MODIFY_RFQ_RECIPIENT` with any third-party provenance or agent actor → `BLOCK`; sends require an approval bound to content hash + recipient list; weakly supported addresses require manual confirmation. | A user can still approve a malicious address after ignoring warnings. |
| Requirement tampering | `MODIFY_PROJECT_REQUIREMENTS` allowed only for a confirmed user; agents/system blocked. | — |
| Tool invocation from content | Agents propose actions only; policy never lets third-party text trigger fetch/send/secret access. | — |
| SSRF through supplier URLs | Single retrieval service: http(s) only, ports allow-list, DNS resolved and each address validated at connect time (rebinding-safe), redirects revalidated and capped, size/time limits, content-type allow-list, no JS execution. | Allowed public hosts can still be slow/hostile (bounded by timeouts and size). `robots.txt` is not consulted. |
| Obfuscation (zero-width, homoglyphs, base64/hex/URL, ROT13, leetspeak, spaced letters, Unicode tags, hidden HTML) | Normalisation + decoded-variant rescans; hidden-text channel scanned and severity-bumped. | Unknown encodings. |
| Fabricated provenance | Claims require a stored passage; LLM quotes verified verbatim; citations never invented. | Passage text itself can be false (it is evidence of what a source said, not of truth). |
| False accusations of fraud | Disagreement is only recorded as `CONFLICTING` with an explicit disclaimer; no fraud classification exists. | — |
| Unauthorised cross-tenant access | All queries scoped by `workspaceId`. | Authentication is local-mode only (see limitations). |
| Abuse / cost | DB-backed rate limits on research, benchmarks, sends, agent runs, health checks; SerpApi pacing. | Single-node limiter granularity is per window. |
| Audit tampering | Hash-chained action receipts verified in the UI. | An attacker with database write access can recompute the chain. |

No security guarantee is claimed. Detection is heuristic; measured rates are in the Benchmark Lab and depend on the (synthetic, author-written) corpus.

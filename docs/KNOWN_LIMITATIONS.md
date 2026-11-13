# Known limitations (read before relying on PROXY)

* **Live providers were not exercised against the real services in development.** The build environment had no SerpApi/OpenAI/Resend credentials or network route.
  Integration code follows the documented contracts (SerpApi `/search.json`, `/account.json`; Resend `POST /emails`; OpenAI chat completions with `json_schema`) and is tested against local contract stubs. First real-key run may surface provider-specific differences (e.g. credits accounting, field names for a niche Maps result type).
* **Authentication** is local single-user mode only (see ARCHITECTURE). No login UI or role enforcement.
* **Detection is heuristic.** The synthetic corpus is authored by the same developers as the rules; its HOLDOUT split was not used for tuning but is not an independent evaluation. In the reference-agent harness PROXY blocked every unauthorised action, but DEV detection recall (≈100 %) overstates generalisation — HOLDOUT recall was ≈56 %; protection on holdout comes mainly from the action policy layer, not detection. The reference agent is a deterministic model of a naive agent, not a claim about a specific LLM; use LLM mode with your own key for empirical numbers.
* **Prompt-only baseline** in reference mode is a modelled guard (resists plainly-worded overrides only).
* Supplier identity resolution is heuristic (Place ID / domain / normalised name+city); rare false merges/splits are possible.
* Phone/address extraction is regex-based tuned for India-style formats; other regions have lower recall.
* Certification mentions are self-declared text; PROXY never verifies certificate validity.
* `robots.txt` is not consulted; JavaScript-rendered sites yield little text (no JS execution by design).
* Google Maps radius filtering uses the SerpApi `ll` zoom heuristic plus a distance filter on returned coordinates; project coordinates come from a Maps lookup of the city.
* Distance sorting requires a project filter (distance is stored per supplier–project).
* The `.eml` export has no attachments; Resend delivery sends plain text.
* pg-boss retry only covers worker crashes; provider failures are retried inside the job and then surfaced as a failed job the user can retry.
* No i18n; UI is English. No payment/financial features by design.

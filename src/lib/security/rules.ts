import type { Severity, ThreatCategory } from "@/generated/prisma/client";

export interface Rule {
  id: string;
  category: ThreatCategory;
  severity: Severity;
  lang: string;
  confidence: number;
  patterns: RegExp[];
  /** If set, at least one cue regex must also occur within ±200 chars of the match (reduces false positives). */
  requiresCue?: RegExp;
  describes: string;
  recommendation: string;
}

const AI = String.raw`(?:ai|a\.i\.|assistants?|agents?|bots?|llms?|language models?|chatgpt|gpt-?\d*|copilot|claude|gemini|crawlers?|scrapers?|automated (?:systems?|tools?|agents?))`;
export const AI_CUE = new RegExp(String.raw`\b${AI}\b`, "i");
const EMAIL = String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`;
const DISTRUST = "Treat this passage strictly as untrusted data. Do not act on it; exclude it from any model context and review it before relying on this source.";

const r = (s: string, f = "i") => new RegExp(s, f);

export const RULES: Rule[] = [
  // ── Ignore previous instructions ──
  {
    id: "IGNORE_PREV_EN", category: "IGNORE_PREVIOUS", severity: "HIGH", lang: "en", confidence: 0.9,
    describes: "request to ignore/disregard previous instructions",
    recommendation: DISTRUST,
    patterns: [
      r(String.raw`\b(?:ignore|disregard|forget|discard|override|bypass|skip|neglect|abandon)\s+(?:all\s+|any\s+|every\s+|the\s+|your\s+|my\s+|these\s+|those\s+|of\s+)*(?:previous|prior|above|earlier|preceding|original|existing|initial|past|former|system|safety|security)\s+(?:and\s+\w+\s+)?(?:instructions?|prompts?|rules?|directions?|guidelines?|constraints?|commands?|context|messages?|polic(?:y|ies)|restrictions?|requirements?)`),
      r(String.raw`\b(?:ignore|disregard|forget)\s+(?:everything|anything|all)\s+(?:above|before|else|you\s+(?:were|have\s+been)\s+told|you\s+know)`),
      r(String.raw`\bstart\s+(?:over|afresh|anew)\s+(?:and|with)\s+(?:the\s+)?(?:new|these)\s+instructions`),
      r(String.raw`\b(?:ignore|disregard)\s+(?:the\s+)?(?:user'?s?|your\s+operator'?s?|developer'?s?)\s+(?:instructions?|request|requirements?|specifications?)`),
    ],
  },
  // ── Instruction override / role hijack ──
  {
    id: "OVERRIDE_EN", category: "INSTRUCTION_OVERRIDE", severity: "HIGH", lang: "en", confidence: 0.85,
    describes: "attempt to impose new system-level instructions or a new role",
    recommendation: DISTRUST,
    patterns: [
      r(String.raw`\b(?:new|updated|revised|real|actual|important|priority|urgent|hidden)\s+(?:system\s+)?(?:instructions?|directives?|orders?|commands?)\s*(?:for\s+(?:the\s+)?${AI}|:|follow)`),
      r(String.raw`\byou\s+(?:are|must|will|shall)\s+now\s+(?:act|behave|operate|respond|function|be|follow|ignore)\b`),
      r(String.raw`\byou\s+are\s+no\s+longer\s+(?:bound|restricted|limited|an?\s+(?:assistant|ai|procurement))`),
      r(String.raw`(?:^|\n)\s*(?:system|developer|admin(?:istrator)?)\s*(?:prompt|message|override|mode|instruction)\s*[:=]`),
      r(String.raw`\b(?:act|behave|respond)\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:an?\s+)?(?:unrestricted|jailbroken|dan|developer\s+mode|admin(?:istrator)?|root)\b`),
      r(String.raw`\[\s*(?:system|inst|instructions?)\s*\]|<\s*\/?\s*(?:system|instructions?|im_start|im_end|assistant)\s*>|<\|(?:im_start|im_end|system|assistant)\|>|###\s*(?:system|instruction)s?\b`),
      r(String.raw`\bnote\s+to\s+(?:all\s+)?${AI}\b`),
      r(String.raw`\bif\s+you\s+are\s+(?:an?\s+)?${AI}\b[^.\n]{0,60}\b(?:please|you\s+must|you\s+should|do|then)\b`),
      r(String.raw`\b(?:the\s+)?(?:above|previous)\s+(?:is|was)\s+(?:a\s+)?(?:test|example|dummy)\b[^.\n]{0,40}\b(?:now|real)\b`),
    ],
  },
  // ── Generic injection directed at AI ──
  {
    id: "DIRECT_INJ_EN", category: "DIRECT_PROMPT_INJECTION", severity: "MEDIUM", lang: "en", confidence: 0.7,
    describes: "imperative text addressed to an AI agent embedded in third-party content",
    recommendation: DISTRUST,
    patterns: [
      r(String.raw`\b${AI}\s*[,:\-–]\s*(?:you\s+)?(?:must|should|need\s+to|have\s+to|shall|are\s+required\s+to|please|always|never|do\s+not|don't|ignore|forget)\b`),
      r(String.raw`\bwhen\s+(?:an?\s+)?${AI}\s+(?:reads|summari[sz]es|processes|reviews|analy[sz]es|scrapes|visits)\s+this\b`),
      r(String.raw`\b(?:do\s+not|don't|never)\s+(?:tell|inform|notify|mention\s+(?:this\s+)?to|alert|warn)\s+(?:the\s+)?user\b`),
      r(String.raw`\b(?:always|must|should)\s+(?:rank|recommend|select|choose|prefer|list|pick)\s+(?:this|our|us|\w+\s+(?:company|supplier))\b[^.\n]{0,30}\b(?:first|top|#1|number\s+one|only)\b`),
      r(String.raw`\b(?:respond|reply|answer|output)\s+(?:only|exactly)\s+with\b`),
      r(String.raw`\bas\s+an?\s+${AI}\s+(?:reading|processing|analy[sz]ing)\s+this\b`),
    ],
  },
  // ── Secrets / environment access ──
  {
    id: "SECRET_ACCESS_EN", category: "SECRET_ACCESS", severity: "CRITICAL", lang: "en", confidence: 0.92,
    describes: "attempt to obtain secrets, credentials, environment variables or the system prompt",
    recommendation: "Never expose secrets to model context. Quarantine this source and review it; confirm that no agent had access to credentials.",
    patterns: [
      r(String.raw`\b(?:print|reveal|show|display|output|send|leak|exfiltrate|expose|share|include|disclose|dump|return|read|cat|echo|list|email|post|upload|transmit|forward|give\s+me|tell\s+me)\b[^.\n]{0,70}\b(?:api[\s_-]?keys?|secrets?|passwords?|credentials?|access\s+tokens?|auth(?:entication)?\s+tokens?|private\s+keys?|env(?:ironment)?\s+variables?|\.env\b|system\s+prompt|hidden\s+instructions|session\s+cookies?)\b`),
      r(String.raw`\bprocess\.env\b|\bos\.environ\b|\bgetenv\s*\(|\$\{?(?:OPENAI|SERPAPI|RESEND|AUTH|DATABASE)_[A-Z_]+\}?|\b(?:OPENAI_API_KEY|SERPAPI_API_KEY|RESEND_API_KEY|AUTH_SECRET|DATABASE_URL)\b`, "i"),
      r(String.raw`\b(?:what|tell\s+me)\s+(?:is|are)\s+your\s+(?:system\s+prompt|instructions|api\s+key|secrets?)\b`),
      r(String.raw`\/etc\/passwd|~\/\.ssh|\bid_rsa\b|\.aws\/credentials`),
    ],
  },
  // ── Redirect outbound comms ──
  {
    id: "REDIRECT_COMMS_EN", category: "EXTERNAL_COMM_REDIRECT", severity: "HIGH", lang: "en", confidence: 0.88,
    describes: "instruction to redirect, copy or reroute outbound communication to a different address",
    recommendation: "Never change an RFQ recipient based on third-party content. Verify the address through independent evidence; the action controller blocks this change automatically.",
    patterns: [
      r(String.raw`\b(?:instead|rather\s+than|regardless|automatically|silently|secretly|override|ignore|do\s+not\s+use|don't\s+use|not\s+to\s+the)\b[^.\n]{0,90}?${EMAIL}`),
      r(String.raw`${EMAIL}[^.\n]{0,70}\b(?:instead|rather\s+than|regardless|automatically|silently|secretly)\b`),
      r(String.raw`\b(?:bcc|b\.c\.c\.?)\b[^.\n]{0,25}${EMAIL}`),
      r(String.raw`\b${AI}\b[^.\n]{0,90}\b(?:send|forward|email|mail|route|redirect|copy|cc)\b[^.\n]{0,90}${EMAIL}`),
      r(String.raw`\b(?:send|forward|route|redirect|copy)\s+(?:all\s+|any\s+|every\s+)?(?:rfqs?|quot(?:e|ation)s?|enquir(?:y|ies)|inquir(?:y|ies)|emails?|messages?|orders?|correspondence|conversations?|results|summary|reports?)\b[^.\n]{0,40}\b(?:to|at)\s+${EMAIL}[^.\n]{0,60}\b(?:ai|you|assistant|agent|automatically|always)\b`),
    ],
  },
  // ── Contact substitution ──
  {
    id: "CONTACT_SUBST_EN", category: "CONTACT_SUBSTITUTION", severity: "HIGH", lang: "en", confidence: 0.8,
    describes: "statement trying to invalidate other contact details or substitute new ones",
    recommendation: "Do not adopt this contact detail. Verify it via an independent source (official website, maps listing, call-back) before use.",
    patterns: [
      r(String.raw`\b(?:our|the|this)\s+(?:old|previous|former|other|listed|official)\s+(?:e-?mail|phone|number|contact|address|website)(?:es|s)?\s+(?:is|are|has|have)\s+(?:no\s+longer|not)\s+(?:valid|in\s+use|active|working|monitored)`),
      r(String.raw`\b(?:use|contact|call|email|reach|write\s+to)\s+(?:us\s+)?(?:only\s+)?(?:at|on|via)\s+(?:this|the\s+following)\s+(?:new\s+)?(?:e-?mail|number|address)\s+instead`),
      r(String.raw`\b(?:do\s+not|don't|never)\s+(?:use|contact|call|e-?mail|trust)\s+(?:the\s+)?(?:other|any\s+other|listed|previous|old|google|maps|official)\s+(?:e-?mail|number|phone|contact|listing|website)s?`),
      r(String.raw`\b(?:bank|account|ifsc|swift|upi|iban)\b[^.\n]{0,50}\b(?:changed|new|updated|replaced|different)\b`),
      r(String.raw`\b(?:our\s+)?(?:contact|e-?mail|phone|mobile|whatsapp)\s+(?:details?|number|id|address)?\s+(?:has|have)\s+(?:changed|been\s+(?:changed|updated|replaced))\b`),
    ],
  },
  {
    id: "CONTACT_SUBST_WEAK_EN", category: "CONTACT_SUBSTITUTION", severity: "LOW", lang: "en", confidence: 0.45,
    describes: "announcement of new/updated contact details (may be legitimate but cannot be corroborated by this statement alone)",
    recommendation: "Treat the new contact as uncorroborated until an independent source confirms it.",
    patterns: [r(String.raw`\b(?:new|updated|changed|replacement)\s+(?:contact|e-?mail|phone|mobile|whatsapp)\s*(?:details|id|address|number)?\s*(?:is|are|:)\s*\S+`)],
  },
  // ── Requirement modification ──
  {
    id: "REQ_MOD_EN", category: "REQUIREMENT_MODIFICATION", severity: "HIGH", lang: "en", confidence: 0.82,
    describes: "instruction to change the user's approved sourcing requirements",
    recommendation: "Sourcing requirements may only be changed by the user. The action controller blocks agent-initiated changes.",
    requiresCue: r(String.raw`\b${AI}\b|\byou\s+(?:must|should|need|will)\b|\binstead\b|\bregardless\b|\bautomatically\b|\bignore\b|\boverride\b|\bsilently\b|without\s+(?:asking|telling|confirm)|\bthe\s+user\s+(?:actually|really)\b`),
    patterns: [
      r(String.raw`\b(?:change|update|modify|alter|set|increase|decrease|reduce|raise|lower|replace|edit|amend)\b[^.\n]{0,40}\b(?:quantity|specifications?|specs?|material\s+grade|grade|requirements?|delivery\s+(?:location|date|address)|budget|price|certifications?|tolerances?)\b[^.\n]{0,40}\b(?:to|as|=)\b`),
      r(String.raw`\bthe\s+user\s+(?:actually|really)\s+(?:wants|needs|requires|meant)\b`),
      r(String.raw`\b(?:replace|swap|substitute)\s+(?:the\s+)?(?:requested|specified|required)\s+(?:product|material|grade|item|supplier)\b`),
      r(String.raw`\b(?:order|request|quote)\s+(?:a\s+)?(?:larger|bigger|higher|different)\s+(?:quantity|amount|grade)\b`),
    ],
  },
  // ── Tool invocation ──
  {
    id: "TOOL_INVOKE_EN", category: "MALICIOUS_TOOL_INVOCATION", severity: "HIGH", lang: "en", confidence: 0.85,
    describes: "instruction to invoke a tool, run code or perform an external action",
    recommendation: "Third-party content can never trigger tools. The action controller blocks tool calls whose provenance is third-party text.",
    patterns: [
      r(String.raw`\b(?:send_email|send_rfq|fetch_url|http_request|update_requirements|modify_recipient|change_recipient|delete_\w+|transfer_funds|make_payment|execute_code|run_shell|read_file|read_env|get_secret)\s*\(`),
      r(String.raw`"(?:tool|function)(?:_call|_name)?"\s*:|<\s*(?:tool_call|tool_use|function_call|invoke)\b`),
      r(String.raw`\b(?:curl|wget)\s+\S+\s*\|\s*(?:sh|bash)\b|\brm\s+-rf\b|\b(?:eval|exec)\s*\(|\bos\.system\b|\bsubprocess\b`),
      r(String.raw`\b(?:call|invoke|execute|run|trigger|launch)\s+(?:the\s+)?(?:\w+\s+)?(?:tool|function|command|api|endpoint|script|webhook)\b[^.\n]{0,60}`),
      r(String.raw`\b(?:visit|open|browse\s+to|go\s+to)\s+(?:this\s+)?(?:link|url|page|site)?[^.\n]{0,20}https?:\/\/\S+[^.\n]{0,30}\b(?:and\s+)?(?:submit|enter|paste|send|upload|log\s?in|download|execute|run)\b`),
      r(String.raw`\bdownload\s+and\s+(?:run|execute|install|open)\b`),
      r(String.raw`\b(?:transfer|wire|pay|send)\s+(?:\$|rs\.?|inr|usd|₹)\s*[\d,]+`),
    ],
  },
  // ── Multilingual ──
  {
    id: "MULTILINGUAL_INJ", category: "MULTILINGUAL_INJECTION", severity: "HIGH", lang: "multi", confidence: 0.85,
    describes: "instruction-override or exfiltration phrase in a non-English language",
    recommendation: DISTRUST,
    patterns: [
      r(String.raw`\b(?:ignora|ignore|olvida)\s+(?:todas?\s+)?(?:las\s+)?instrucciones\s+(?:anteriores|previas)`), // es
      r(String.raw`\bolvida\s+(?:todas?\s+)?(?:las\s+)?instrucciones`),
      r(String.raw`\b(?:env[ií]a|reenv[ií]a|manda)\s+(?:todos\s+)?(?:los\s+)?(?:correos|emails|mensajes|cotizaciones)\s+a\s+\S+@`),
      r(String.raw`\b(?:muestra|revela|env[ií]a)\s+(?:tu\s+|la\s+)?(?:clave|contraseña|api\s*key)`),
      r(String.raw`\bignore[rz]?\s+(?:toutes\s+)?(?:les\s+)?instructions\s+(?:précédentes|anterieures|antérieures|ci-dessus)`), // fr
      r(String.raw`\boubliez?\s+(?:toutes\s+)?(?:les\s+)?instructions`),
      r(String.raw`\benvoy(?:ez|er)\s+(?:tous\s+)?(?:les\s+)?(?:courriels|e-?mails|messages)\s+à\s+\S+@`),
      r(String.raw`\bignoriere?\s+(?:alle\s+)?(?:vorherigen|früheren|obigen|bisherigen)\s+(?:anweisungen|instruktionen|befehle)`), // de
      r(String.raw`\bvergiss\s+(?:alle\s+)?(?:vorherigen\s+)?anweisungen`),
      r(String.raw`\bsende\s+(?:alle\s+)?(?:e-?mails|anfragen|nachrichten)\s+an\s+\S+@`),
      r(String.raw`\bignore\s+(?:todas\s+)?as\s+instruções\s+anteriores`), // pt
      r(String.raw`\bignora\s+(?:tutte\s+)?le\s+istruzioni\s+precedenti`), // it
      r(String.raw`игнорируй(?:те)?\s+(?:все\s+)?(?:предыдущие|прежние|прошлые)\s+(?:инструкции|указания|команды)`), // ru
      r(String.raw`забудь(?:те)?\s+(?:все\s+)?(?:предыдущие\s+)?инструкции`),
      r(String.raw`отправ(?:ь|ьте|ляйте)\s+(?:все\s+)?(?:письма|сообщения|запросы)\s+на\s+\S+@`),
      r(String.raw`(?:忽略|无视|忽视)(?:之前|以前|上面|先前|以上|所有|前面)(?:的)?(?:所有)?(?:指令|指示|说明|提示|规则|命令)`), // zh
      r(String.raw`(?:把|将)?(?:所有)?(?:邮件|电子邮件|报价|询价|消息).{0,10}(?:发送|转发)(?:到|至|给)\s*\S*@`),
      r(String.raw`(?:以前|これまで|上記)の(?:指示|命令|指令)を(?:すべて)?(?:無視|忘れ)`), // ja
      r(String.raw`이전\s*(?:의\s*)?(?:모든\s*)?(?:지시|지침|명령)(?:사항)?(?:을|를)?\s*(?:무시|잊)`), // ko
      r(String.raw`تجاهل\s+(?:جميع\s+|كل\s+)?(?:التعليمات|الأوامر)\s+(?:السابقة|أعلاه)`), // ar
      r(String.raw`(?:पिछले|पिछली|पहले\s+के|सभी|पूर्व)\s*(?:सभी\s*)?(?:निर्देशों?|आदेशों?)\s*(?:को\s*)?(?:अनदेखा|नज़रअंदाज़|नजरअंदाज|भूल)`), // hi
      r(String.raw`(?:एपीआई\s*कुंजी|पासवर्ड|गुप्त\s*जानकारी)\s*(?:बताएं|दिखाएं|भेजें|साझा)`),
      r(String.raw`(?:सभी\s+)?(?:ईमेल|मेल|संदेश)\s*(?:को\s*)?\S*@\S+\s*(?:पर|को)\s*(?:भेजें|भेजो)`),
      r(String.raw`முந்தைய\s*(?:அனைத்து\s*)?(?:அறிவுறுத்தல்களை|வழிமுறைகளை|கட்டளைகளை|உத்தரவுகளை)\s*(?:புறக்கணி|மறந்து|மீறு)`), // ta
      r(String.raw`(?:கடவுச்சொல்|API\s*key)\S*\s*(?:காட்டு|அனுப்பு|வெளியிடு)`),
    ],
  },
];

export const RULES_VERSION = "2026.11.1";
export const SEVERITY_ORDER: Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const bumpSeverity = (s: Severity): Severity => SEVERITY_ORDER[Math.min(SEVERITY_ORDER.length - 1, SEVERITY_ORDER.indexOf(s) + 1)];

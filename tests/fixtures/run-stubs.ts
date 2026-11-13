// TEST-ONLY: starts local SerpApi / Resend / OpenAI / supplier-site stand-ins for the Playwright run.
import { startStubs } from "./stubs";

startStubs({ ports: { serp: 4101, resend: 4102, openai: 4103, site: 4104 } }).then((s) => {
  console.log(`[stubs] serp ${s.serpUrl} resend ${s.resendUrl} openai ${s.openaiUrl} sites :${s.sitePort}`);
  process.on("SIGTERM", () => s.close().then(() => process.exit(0)));
  process.on("SIGINT", () => s.close().then(() => process.exit(0)));
});

import { randomUUID } from "node:crypto";

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/** Builds an RFC 5322 / MIME message (UTF-8, base64 body) suitable for opening in any mail client. */
export function buildEml(opts: { from?: string; to: string; subject: string; body: string; date?: Date; messageId?: string; draft?: boolean }): string {
  const body = Buffer.from(opts.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const headers = [
    ...(opts.from ? [`From: ${opts.from}`] : []),
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject.replace(/[\r\n]+/g, " "))}`,
    `Date: ${(opts.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${opts.messageId ?? randomUUID()}@proxy.local>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    ...(opts.draft !== false ? ["X-Unsent: 1"] : []),
  ];
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
}

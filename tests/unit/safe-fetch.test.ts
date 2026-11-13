import { describe, expect, it } from "vitest";
import { FetchBlockedError, safeFetch, validateUrl } from "@/lib/fetcher/safe-fetch";
import { classifyBlockedIp } from "@/lib/fetcher/ip";
import { extractHtml } from "@/lib/fetcher/html";

describe("SSRF protection", () => {
  it.each([
    "http://localhost/", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.16.0.1/", "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/", "http://[fd00:ec2::254]/", "http://[::ffff:127.0.0.1]/", "ftp://example.com/", "file:///etc/passwd", "http://user:pw@example.com/", "https://example.com:22/", "http://foo.internal/", "http://metadata.google.internal/",
  ])("rejects %s", (u) => {
    expect(() => validateUrl(u)).toThrow(FetchBlockedError);
  });
  it("accepts public http(s)", () => {
    expect(validateUrl("https://example.com/a").hostname).toBe("example.com");
  });
  it("classifies private ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "100.64.0.1", "169.254.169.254", "::1", "fe80::1", "fc00::1"]) expect(classifyBlockedIp(ip)).toBeTruthy();
    expect(classifyBlockedIp("8.8.8.8")).toBeNull();
    expect(classifyBlockedIp("2606:4700:4700::1111")).toBeNull();
  });
  it("blocks a hostname that resolves to loopback (DNS check at connect time)", async () => {
    await expect(safeFetch("http://localtest.me/")).rejects.toThrow();
  });
});

describe("HTML extraction", () => {
  it("drops scripts, keeps hidden text separate, parses JSON-LD without executing", () => {
    const p = extractHtml(`<html><head><title>T</title><script type="application/ld+json">{"@type":"Organization","telephone":"123"}</script></head><body><script>evil()</script><p>Visible</p><div style="display:none">secret instruction</div><!-- comment note --></body></html>`);
    expect(p.visibleText).toContain("Visible");
    expect(p.visibleText).not.toContain("evil");
    expect(p.visibleText).not.toContain("secret instruction");
    expect(p.hiddenText).toContain("secret instruction");
    expect(p.hiddenText).toContain("comment note");
    expect(p.jsonLd).toHaveLength(1);
  });
});

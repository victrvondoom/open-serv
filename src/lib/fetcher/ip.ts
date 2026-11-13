import net from "node:net";

/** Returns a reason string if the IP is not a public unicast address, else null. */
export function classifyBlockedIp(ip: string): string | null {
  if (net.isIPv4(ip)) return classify4(ip);
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return classify4(mapped[1]);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
      return classify4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (lower === "::" || lower === "::1") return "loopback address";
    if (/^f[cd]/.test(lower)) {
      if (lower.startsWith("fd00:ec2")) return "cloud metadata address";
      return "unique-local address";
    }
    if (/^fe[89ab]/.test(lower)) return "link-local address";
    if (lower.startsWith("ff")) return "multicast address";
    if (lower.startsWith("64:ff9b")) return "NAT64 address";
    if (lower.startsWith("2001:db8")) return "documentation address";
    return null;
  }
  return "not an IP address";
}

function classify4(ip: string): string | null {
  const [a, b] = ip.split(".").map(Number);
  if (ip === "169.254.169.254" || ip === "169.254.170.2" || ip === "100.100.100.200") return "cloud metadata address";
  if (a === 0) return "unspecified address";
  if (a === 10) return "private network (10.0.0.0/8)";
  if (a === 127) return "loopback address";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT range";
  if (a === 169 && b === 254) return "link-local address";
  if (a === 172 && b >= 16 && b <= 31) return "private network (172.16.0.0/12)";
  if (a === 192 && b === 168) return "private network (192.168.0.0/16)";
  if (a === 192 && b === 0) return "reserved address";
  if (a === 198 && (b === 18 || b === 19)) return "benchmark network";
  if (a >= 224) return "multicast/reserved address";
  return null;
}

import * as cheerio from "cheerio";

export interface ExtractedPage {
  title: string;
  description: string;
  /** Text a human visitor would see. */
  visibleText: string;
  /** Text a human would NOT see (comments, display:none, aria-hidden, zero-size, meta). Kept for security scanning only. */
  hiddenText: string;
  headings: string[];
  listItems: string[];
  links: { href: string; text: string }[];
  mailto: string[];
  tel: string[];
  jsonLd: unknown[];
}

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0(?![.\d])|height\s*:\s*0(?!\.)|width\s*:\s*0(?!\.)|left\s*:\s*-\d{3,}|text-indent\s*:\s*-\d{3,}|clip\s*:\s*rect\(0/i;

/** Readable-text extraction. Scripts / styles / frames are dropped and NEVER executed. */
export function extractHtml(html: string): ExtractedPage {
  const $ = cheerio.load(html);
  const hidden: string[] = [];
  const jsonLd: unknown[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).text());
      jsonLd.push(...(Array.isArray(j) ? j : j["@graph"] ? j["@graph"] : [j]));
    } catch {
      /* malformed JSON-LD ignored */
    }
  });

  // HTML comments are invisible to users but visible to scrapers → treat as hidden text.
  $("*")
    .contents()
    .each((_, node) => {
      if (node.type === "comment") {
        const d = (node as unknown as { data?: string }).data?.trim();
        if (d) hidden.push(d);
      }
    });

  const title = $("title").first().text().trim();
  const description = ($('meta[name="description"]').attr("content") ?? "").trim();
  if (description) hidden.push(description);
  $("meta[name='keywords'], meta[property^='og:description']").each((_, el) => {
    const c = $(el).attr("content");
    if (c) hidden.push(c.trim());
  });
  $("[alt],[title]").each((_, el) => {
    for (const a of ["alt", "title"]) {
      const v = $(el).attr(a);
      if (v && v.length > 40) hidden.push(v.trim());
    }
  });

  const links: { href: string; text: string }[] = [];
  const mailto: string[] = [];
  const tel: string[] = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (/^mailto:/i.test(href)) mailto.push(decodeURIComponent(href.replace(/^mailto:/i, "").split("?")[0]).trim());
    else if (/^tel:/i.test(href)) tel.push(decodeURIComponent(href.replace(/^tel:/i, "")).trim());
    else if (href && !href.startsWith("#") && !/^javascript:/i.test(href)) links.push({ href, text });
  });

  // Remove non-content and move hidden elements' text to the hidden bucket.
  $("script, style, noscript, iframe, object, embed, svg, canvas, template, link, head").remove();
  $("[hidden], [aria-hidden='true'], [style]").each((_, el) => {
    const $el = $(el);
    const isHidden = $el.attr("hidden") !== undefined || $el.attr("aria-hidden") === "true" || HIDDEN_STYLE.test($el.attr("style") ?? "");
    if (isHidden) {
      const t = $el.text().replace(/\s+/g, " ").trim();
      if (t) hidden.push(t);
      $el.remove();
    }
  });
  $("input[type='hidden'], textarea").each((_, el) => {
    const v = ($(el).attr("value") ?? $(el).text()).trim();
    if (v.length > 20) hidden.push(v);
  });
  $("input, textarea, select, button, form").remove();

  const headings: string[] = [];
  $("h1,h2,h3").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && t.length < 160) headings.push(t);
  });
  const listItems: string[] = [];
  $("li").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && t.length < 200) listItems.push(t);
  });

  $("br").replaceWith("\n");
  $("p,div,section,article,li,tr,h1,h2,h3,h4,h5,h6,header,footer,address,ul,ol,table").each((_, el) => {
    $(el).append("\n");
  });
  const visibleText = $("body")
    .text()
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    title,
    description,
    visibleText,
    hiddenText: [...new Set(hidden)].join("\n"),
    headings: [...new Set(headings)],
    listItems: [...new Set(listItems)],
    links,
    mailto: [...new Set(mailto)],
    tel: [...new Set(tel)],
    jsonLd,
  };
}

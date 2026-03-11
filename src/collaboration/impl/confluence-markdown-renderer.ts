/**
 * Markdown-to-Confluence Storage Format renderer.
 * Converts Markdown to Confluence XHTML storage format.
 *
 * Supported:
 *   # Heading → <h1>Heading</h1>
 *   ```lang → Confluence code macro
 *   | table | → <table>
 *   **bold** → <strong>
 *   [link](url) → <a href="url">
 *   ![img](url) → <ac:image>
 *   Paragraphs and newlines
 *
 * Unsupported constructs (footnotes, raw HTML) pass through as escaped text.
 */

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  // Bold: **text**
  let out = text.replace(/\*\*(.+?)\*\*/g, (_: string, inner: string) => `<strong>${escapeXml(inner)}</strong>`);
  // Italic: *text* (not preceded or followed by another *)
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_: string, inner: string) => `<em>${escapeXml(inner)}</em>`);
  out = out.replace(/_(.+?)_/g, (_: string, inner: string) => `<em>${escapeXml(inner)}</em>`);
  // Inline code: `code`
  out = out.replace(/`([^`]+)`/g, (_: string, code: string) => `<code>${escapeXml(code)}</code>`);
  // Image: ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_: string, _alt: string, url: string) =>
    `<ac:image><ri:url ri:value="${escapeXml(url)}" /></ac:image>`,
  );
  // Link: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_: string, label: string, url: string) =>
    `<a href="${escapeXml(url)}">${escapeXml(label)}</a>`,
  );
  return out;
}

function renderTable(lines: string[]): string {
  const rows = lines
    .filter(l => l.trim().startsWith("|"))
    .filter(l => !/^\|[-\s|]+\|$/.test(l.trim())); // skip separator rows

  const tableRows = rows.map((row, rowIdx) => {
    const cells = row.split("|").slice(1, -1).map(c => c.trim());
    const tag = rowIdx === 0 ? "th" : "td";
    return "<tr>" + cells.map(c => `<${tag}>${renderInline(c)}</${tag}>`).join("") + "</tr>";
  });

  return `<table><tbody>${tableRows.join("")}</tbody></table>`;
}

function renderCodeBlock(lang: string, code: string): string {
  const escapedCode = code.replace(/\]\]>/g, "]]&gt;");
  return (
    `<ac:structured-macro ac:name="code">` +
    (lang ? `<ac:parameter ac:name="language">${escapeXml(lang)}</ac:parameter>` : "") +
    `<ac:plain-text-body><![CDATA[${escapedCode}]]></ac:plain-text-body>` +
    `</ac:structured-macro>`
  );
}

export function markdownToConfluenceStorage(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Code block: ```lang
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const codeLine = lines[i] ?? "";
        if (codeLine.startsWith("```")) break;
        codeLines.push(codeLine);
        i++;
      }
      i++; // skip closing ```
      output.push(renderCodeBlock(lang, codeLines.join("\n")));
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? "";
      const headingText = headingMatch[2] ?? "";
      const level = hashes.length;
      output.push(`<h${level}>${renderInline(headingText)}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      output.push("<hr />");
      i++;
      continue;
    }

    // Table: collect contiguous table lines
    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length) {
        const tableLine = lines[i] ?? "";
        if (!tableLine.trim().startsWith("|")) break;
        tableLines.push(tableLine);
        i++;
      }
      output.push(renderTable(tableLines));
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const listLine = lines[i] ?? "";
        if (!/^[-*]\s/.test(listLine)) break;
        items.push(`<li>${renderInline(listLine.slice(2).trim())}</li>`);
        i++;
      }
      output.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const listLine = lines[i] ?? "";
        if (!/^\d+\.\s/.test(listLine)) break;
        const text = listLine.replace(/^\d+\.\s/, "").trim();
        items.push(`<li>${renderInline(text)}</li>`);
        i++;
      }
      output.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const quoteLine = lines[i] ?? "";
        if (!quoteLine.startsWith("> ")) break;
        quoteLines.push(quoteLine.slice(2));
        i++;
      }
      output.push(`<blockquote><p>${renderInline(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }

    // Empty line — paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-special lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const paraLine = lines[i] ?? "";
      if (
        paraLine.trim() === "" ||
        paraLine.startsWith("#") ||
        paraLine.startsWith("```") ||
        paraLine.trim().startsWith("|") ||
        /^[-*]\s/.test(paraLine) ||
        /^\d+\.\s/.test(paraLine) ||
        paraLine.startsWith("> ") ||
        /^---+$/.test(paraLine.trim())
      ) {
        break;
      }
      paraLines.push(paraLine);
      i++;
    }
    if (paraLines.length > 0) {
      output.push(`<p>${renderInline(paraLines.join(" "))}</p>`);
    }
  }

  return output.join("\n");
}

/**
 * Convert Confluence storage format (XHTML) back to plain Markdown.
 * Best-effort — used by getPage() to populate body_markdown.
 */
export function confluenceStorageToMarkdown(storage: string): string {
  let out = storage;
  // Code macros
  out = out.replace(
    /<ac:structured-macro[^>]*ac:name="code"[^>]*>(?:<ac:parameter[^>]*ac:name="language"[^>]*>([^<]*)<\/ac:parameter>)?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body><\/ac:structured-macro>/g,
    (_match: string, lang: string | undefined, code: string | undefined) =>
      `\`\`\`${lang ?? ""}\n${code ?? ""}\n\`\`\``,
  );
  // Headings
  for (let n = 6; n >= 1; n--) {
    out = out.replace(new RegExp(`<h${n}>(.*?)<\\/h${n}>`, "g"), "#".repeat(n) + " $1");
  }
  // Bold
  out = out.replace(/<strong>(.*?)<\/strong>/g, "**$1**");
  // Italic
  out = out.replace(/<em>(.*?)<\/em>/g, "*$1*");
  // Links
  out = out.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, "[$2]($1)");
  // Images
  out = out.replace(/<ac:image><ri:url ri:value="([^"]+)" \/><\/ac:image>/g, "![]($1)");
  // Strip remaining tags
  out = out.replace(/<[^>]+>/g, "");
  // Unescape XML entities
  out = out
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return out.trim();
}

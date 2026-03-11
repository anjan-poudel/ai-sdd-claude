/**
 * Confluence adapter tests — XHTML rendering edge cases, mock adapter, fixture-based parsing.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { markdownToConfluenceStorage, confluenceStorageToMarkdown } from "../../../../src/collaboration/impl/confluence-markdown-renderer.ts";
import { MockDocumentAdapter } from "../../../../src/collaboration/impl/mock-document-adapter.ts";

const FIXTURES_DIR = join(import.meta.dir, "../../../fixtures/confluence");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8"));
}

describe("markdownToConfluenceStorage", () => {
  it("converts headings", () => {
    const out = markdownToConfluenceStorage("# Heading 1\n## Heading 2");
    expect(out).toContain("<h1>Heading 1</h1>");
    expect(out).toContain("<h2>Heading 2</h2>");
  });

  it("converts bold text", () => {
    const out = markdownToConfluenceStorage("This is **bold** text.");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("converts inline code", () => {
    const out = markdownToConfluenceStorage("Use `const x = 1;`");
    expect(out).toContain("<code>const x = 1;</code>");
  });

  it("converts fenced code blocks to Confluence code macro", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const out = markdownToConfluenceStorage(md);
    expect(out).toContain(`ac:name="code"`);
    expect(out).toContain(`ac:name="language">typescript`);
    expect(out).toContain("<![CDATA[");
    expect(out).toContain("const x = 1;");
  });

  it("converts code blocks without language", () => {
    const out = markdownToConfluenceStorage("```\nplain code\n```");
    expect(out).toContain(`ac:name="code"`);
    expect(out).toContain("plain code");
  });

  it("converts links", () => {
    const out = markdownToConfluenceStorage("[Click here](https://example.com)");
    expect(out).toContain(`href="https://example.com"`);
    expect(out).toContain("Click here");
  });

  it("converts images", () => {
    const out = markdownToConfluenceStorage("![alt](https://example.com/img.png)");
    expect(out).toContain(`<ac:image>`);
    expect(out).toContain(`ri:value="https://example.com/img.png"`);
  });

  it("converts table", () => {
    const md = "| Col 1 | Col 2 |\n|-------|-------|\n| A     | B     |";
    const out = markdownToConfluenceStorage(md);
    expect(out).toContain("<table>");
    expect(out).toContain("<th>Col 1</th>");
    expect(out).toContain("<td>A</td>");
  });

  it("wraps paragraphs in <p> tags", () => {
    const out = markdownToConfluenceStorage("This is a paragraph.");
    expect(out).toContain("<p>This is a paragraph.</p>");
  });

  it("converts unordered list", () => {
    const out = markdownToConfluenceStorage("- Item 1\n- Item 2");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>Item 1</li>");
    expect(out).toContain("<li>Item 2</li>");
  });

  it("converts ordered list", () => {
    const out = markdownToConfluenceStorage("1. First\n2. Second");
    expect(out).toContain("<ol>");
    expect(out).toContain("<li>First</li>");
    expect(out).toContain("<li>Second</li>");
  });

  it("escapes XML special characters in text content", () => {
    const out = markdownToConfluenceStorage("Use `a < b && b > c`");
    expect(out).not.toContain("a < b");
    expect(out).toContain("&lt;");
  });

  it("does not escape CDATA content in code blocks", () => {
    const out = markdownToConfluenceStorage("```\na < b\n```");
    // Inside CDATA, raw < is OK.
    expect(out).toContain("<![CDATA[");
  });
});

describe("confluenceStorageToMarkdown", () => {
  it("converts headings back to markdown", () => {
    const storage = "<h1>Heading 1</h1>";
    expect(confluenceStorageToMarkdown(storage)).toContain("# Heading 1");
  });

  it("converts bold back", () => {
    const storage = "<strong>bold</strong>";
    expect(confluenceStorageToMarkdown(storage)).toContain("**bold**");
  });

  it("converts links back", () => {
    const storage = `<a href="https://example.com">Click</a>`;
    const md = confluenceStorageToMarkdown(storage);
    expect(md).toContain("[Click](https://example.com)");
  });
});

describe("MockDocumentAdapter", () => {
  it("creates and retrieves a page", async () => {
    const adapter = new MockDocumentAdapter();
    const createResult = await adapter.createPage("PROJ", "Specs", "My Page", "# Hello");
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;

    const getResult = await adapter.getPage(createResult.value);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.title).toBe("My Page");
    expect(getResult.value.body_markdown).toContain("Hello");
  });

  it("updates a page and increments version", async () => {
    const adapter = new MockDocumentAdapter();
    const createResult = await adapter.createPage("PROJ", "Specs", "My Page", "# Hello");
    if (!createResult.ok) return;

    const updateResult = await adapter.updatePage(createResult.value, "# Updated");
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.value.version).toBe(2);
  });

  it("returns NOT_FOUND for unknown page", async () => {
    const adapter = new MockDocumentAdapter();
    const result = await adapter.getPage({ provider: "mock", id: "nonexistent", url: "", version: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("posts and retrieves comments", async () => {
    const adapter = new MockDocumentAdapter();
    const createResult = await adapter.createPage("PROJ", "Specs", "My Page", "Content");
    if (!createResult.ok) return;

    await adapter.postComment(createResult.value, "Great work!");
    const commentsResult = await adapter.getComments(createResult.value);
    expect(commentsResult.ok).toBe(true);
    if (!commentsResult.ok) return;
    expect(commentsResult.value).toHaveLength(1);
    const firstComment = commentsResult.value[0];
    expect(firstComment).toBeDefined();
    if (!firstComment) return;
    expect(firstComment.body).toBe("Great work!");
  });

  it("filters comments by since timestamp", async () => {
    const adapter = new MockDocumentAdapter();
    const createResult = await adapter.createPage("PROJ", "Specs", "My Page", "Content");
    if (!createResult.ok) return;

    await adapter.postComment(createResult.value, "Old comment");
    // Capture cutoff AFTER the old comment is added.
    const since = new Date().toISOString();
    // Ensure next comment is strictly after the cutoff.
    await new Promise(r => setTimeout(r, 5));
    await adapter.postComment(createResult.value, "New comment");

    const newComments = await adapter.getComments(createResult.value, since);
    expect(newComments.ok).toBe(true);
    if (!newComments.ok) return;
    expect(newComments.value).toHaveLength(1);
    const newComment = newComments.value[0];
    expect(newComment).toBeDefined();
    if (!newComment) return;
    expect(newComment.body).toBe("New comment");
  });
});

describe("Confluence fixtures (Dev Standard #4)", () => {
  it("validates create-page-response fixture structure", () => {
    const fixture = loadFixture("create-page-response.json") as {
      id: string;
      title: string;
      version: { number: number };
      body: { storage: { value: string } };
    };

    // Validate the fixture has the fields our adapter expects.
    expect(fixture.id).toBeTruthy();
    expect(fixture.title).toBeTruthy();
    expect(fixture.version.number).toBeGreaterThan(0);
    expect(fixture.body.storage.value).toBeTruthy();
  });
});

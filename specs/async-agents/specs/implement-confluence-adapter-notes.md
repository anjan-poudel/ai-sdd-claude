---
description: Confluence document adapter implementation — custom Markdown-to-XHTML renderer, REST API v2 adapter, mock test double, and fixture-based tests.
---

# Implementation Notes: Confluence Document Adapter

## Summary

Implemented the Confluence Cloud document adapter (real + mock) plus a custom Markdown-to-Confluence-XHTML renderer.

## Files Created

- `src/collaboration/impl/confluence-markdown-renderer.ts` — Custom line-by-line Markdown parser producing Confluence Storage Format XHTML. Handles headings, bold/italic, inline code, fenced code blocks (Confluence code macro with CDATA), links, images, tables, lists, and paragraph wrapping. Also implements `confluenceStorageToMarkdown()` for best-effort reverse conversion.
- `src/collaboration/impl/confluence-document-adapter.ts` — Real Confluence Cloud REST adapter using `/wiki/api/v2/pages` and `/wiki/api/v2/footer-comments` endpoints. Handles version tracking with 409 Conflict retry.
- `src/collaboration/impl/mock-document-adapter.ts` — In-memory test double with version increment, comment storage, and `since`-based filtering (strict greater-than).

## Testing

Tests in `tests/collaboration/adapters/impl/confluence.test.ts`:
- 12 markdownToConfluenceStorage tests (headings, code blocks, tables, lists, escaping)
- 3 confluenceStorageToMarkdown tests
- 6 MockDocumentAdapter CRUD tests
- 1 fixture validation test against `tests/fixtures/confluence/create-page-response.json`

## Key Design Decisions

- Custom renderer chosen over markdown-it to avoid external dependency and Confluence-specific macro requirements.
- All regex callbacks explicitly typed for TypeScript strict mode.
- XML special characters escaped in text content but NOT inside CDATA sections.

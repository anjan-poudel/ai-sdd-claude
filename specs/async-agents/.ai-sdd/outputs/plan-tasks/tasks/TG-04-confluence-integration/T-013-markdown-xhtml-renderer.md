# T-013: Markdown-to-XHTML Renderer

## Metadata
- **Group:** [TG-04 -- Confluence Integration](index.md)
- **Component:** confluence-storage-renderer (markdown-it plugin)
- **Agent:** dev
- **Effort:** L
- **Risk:** HIGH
- **Depends on:** --
- **Blocks:** T-012
- **Requirements:** [FR-006](../../../define-requirements/FR/FR-006-confluence-document-authoring.md)

## Description
Implement a markdown-it custom renderer plugin that converts Markdown to Confluence storage format (XHTML). Must handle headings, code blocks (with `ac:structured-macro`), tables, bold, links, and images (with `ac:image`). Unsupported constructs (footnotes, raw HTML) are escaped with a warning logged. Includes a validation step to check XHTML well-formedness before returning.

## Acceptance criteria

```gherkin
Feature: Markdown-to-XHTML renderer

  Scenario: Code block rendered as Confluence macro
    Given Markdown containing a fenced code block with language "typescript"
    When the renderer converts the Markdown
    Then the output contains ac:structured-macro with ac:name="code"
    And the language parameter is "typescript"
    And the code body is wrapped in CDATA

  Scenario: Unsupported construct is escaped safely
    Given Markdown containing raw HTML "<script>alert('xss')</script>"
    When the renderer converts the Markdown
    Then the output contains escaped text (not raw HTML)
    And a warning is logged about the unsupported construct
```

## Implementation notes
- File: `src/collaboration/adapters/confluence/storage-renderer.ts`
- Dependency: `markdown-it` (add to package.json)
- Conversion table from L2 design: headings, code, tables, bold, links, images
- XHTML validation: check for well-formed XML before returning; fallback to `<pre>` wrap on failure
- Performance target: < 50ms per page (L2 design)
- No network calls -- pure in-process transformation

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] All 6 Markdown construct types from L2 design tested
- [ ] XSS-safe: raw HTML in Markdown is always escaped

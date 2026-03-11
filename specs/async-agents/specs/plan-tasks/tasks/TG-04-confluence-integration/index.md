# TG-04: Confluence Integration

> **Jira Epic:** Confluence Integration

## Description
Implements the ConfluenceDocumentAdapter for page CRUD operations, comment support (inline and standard), and the Markdown-to-XHTML renderer using markdown-it with a custom Confluence storage format plugin. Covers FR-006 and FR-007.

## Tasks

| ID | Title | Effort | Depends on | Risk |
|----|-------|--------|------------|------|
| [T-012](T-012-confluence-document-adapter.md) | ConfluenceDocumentAdapter -- Page CRUD | M | T-005, T-006 | MEDIUM |
| [T-013](T-013-markdown-xhtml-renderer.md) | Markdown-to-XHTML Renderer | L | -- | HIGH |
| [T-014](T-014-confluence-comments.md) | Confluence Comment Support | S | T-012 | LOW |

## Group effort estimate
- Optimistic (full parallel): 2 days
- Realistic (2 devs): 3 days

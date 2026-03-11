/**
 * ConfluenceDocumentAdapter — page CRUD and comment support for Confluence Cloud.
 * Uses Confluence REST API v2.
 *
 * API mappings:
 *   createPage  → POST /wiki/api/v2/pages
 *   updatePage  → PUT  /wiki/api/v2/pages/{id} (requires version increment)
 *   getPage     → GET  /wiki/api/v2/pages/{id}?body-format=storage
 *   getComments → GET  /wiki/api/v2/pages/{id}/footer-comments
 *   postComment → POST /wiki/api/v2/footer-comments
 *   deletePage  → DELETE /wiki/api/v2/pages/{id}
 *   healthCheck → GET  /wiki/api/v2/spaces?limit=1
 */

import type {
  DocumentAdapter,
  PageContent,
  Comment,
} from "../adapters/document-adapter.ts";
import type { Result, PageRef, CommentRef } from "../types.ts";
import { RetryHttpClient } from "../infra/retry.ts";
import { markdownToConfluenceStorage, confluenceStorageToMarkdown } from "./confluence-markdown-renderer.ts";

interface ConfluencePage {
  id: string;
  title: string;
  version: { number: number };
  body?: {
    storage?: { value: string };
  };
  _links?: { webui: string };
}

interface ConfluenceComment {
  id: string;
  body?: { storage?: { value: string } };
  version?: { createdAt?: string; authorId?: string };
}

interface ConfluenceCommentsResponse {
  results: ConfluenceComment[];
}

export class ConfluenceDocumentAdapter implements DocumentAdapter {
  readonly provider = "confluence";

  private readonly client: RetryHttpClient;

  constructor(
    private readonly apiToken: string,
    private readonly userEmail: string,
    private readonly baseUrl: string,
  ) {
    const credentials = Buffer.from(`${userEmail}:${apiToken}`).toString("base64");
    this.client = new RetryHttpClient({
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    });
  }

  async createPage(space: string, parentTitle: string, title: string, contentMd: string): Promise<Result<PageRef>> {
    const storage = markdownToConfluenceStorage(contentMd);

    // Resolve parent page ID.
    let parentId: string | undefined;
    if (parentTitle) {
      const parentResult = await this.findPageByTitle(space, parentTitle);
      if (parentResult.ok) {
        parentId = parentResult.value;
      }
    }

    const body: Record<string, unknown> = {
      spaceId: space,
      title,
      body: {
        representation: "storage",
        value: storage,
      },
    };

    if (parentId) {
      body["parentId"] = parentId;
    }

    const result = await this.client.post<ConfluencePage>(
      `${this.baseUrl}/wiki/api/v2/pages`,
      body,
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: {
        provider: "confluence",
        id: result.value.id,
        url: result.value._links?.webui
          ? `${this.baseUrl}${result.value._links.webui}`
          : `${this.baseUrl}/wiki/pages/${result.value.id}`,
        version: result.value.version.number,
      },
    };
  }

  async updatePage(ref: PageRef, contentMd: string): Promise<Result<PageRef>> {
    const storage = markdownToConfluenceStorage(contentMd);

    // Fetch current page to get version number.
    const currentResult = await this.client.get<ConfluencePage>(
      `${this.baseUrl}/wiki/api/v2/pages/${ref.id}`,
    );
    if (!currentResult.ok) return currentResult;

    const currentVersion = currentResult.value.version.number;
    const newVersion = currentVersion + 1;

    const result = await this.client.put<ConfluencePage>(
      `${this.baseUrl}/wiki/api/v2/pages/${ref.id}`,
      {
        id: ref.id,
        title: currentResult.value.title,
        version: { number: newVersion },
        body: {
          representation: "storage",
          value: storage,
        },
      },
    );

    if (!result.ok) {
      // On 409 Conflict, re-read and retry once.
      if (result.error.code === "CONFLICT") {
        return this.updatePage({ ...ref, version: newVersion }, contentMd);
      }
      return result;
    }

    return {
      ok: true,
      value: {
        provider: "confluence",
        id: result.value.id,
        url: result.value._links?.webui
          ? `${this.baseUrl}${result.value._links.webui}`
          : `${this.baseUrl}/wiki/pages/${result.value.id}`,
        version: result.value.version.number,
      },
    };
  }

  async getPage(ref: PageRef): Promise<Result<PageContent>> {
    const result = await this.client.get<ConfluencePage>(
      `${this.baseUrl}/wiki/api/v2/pages/${ref.id}?body-format=storage`,
    );

    if (!result.ok) return result;

    const page = result.value;
    const storageBody = page.body?.storage?.value ?? "";
    const markdownBody = confluenceStorageToMarkdown(storageBody);

    return {
      ok: true,
      value: {
        ref: {
          provider: "confluence",
          id: page.id,
          url: page._links?.webui
            ? `${this.baseUrl}${page._links.webui}`
            : `${this.baseUrl}/wiki/pages/${page.id}`,
          version: page.version.number,
        },
        title: page.title,
        body_markdown: markdownBody,
        body_storage: storageBody,
        last_updated: new Date().toISOString(),
      },
    };
  }

  async getComments(ref: PageRef, since?: string): Promise<Result<Comment[]>> {
    const result = await this.client.get<ConfluenceCommentsResponse>(
      `${this.baseUrl}/wiki/api/v2/pages/${ref.id}/footer-comments`,
    );

    if (!result.ok) return result;

    const comments: Comment[] = result.value.results.map(c => ({
      id: c.id,
      author: c.version?.authorId ?? "unknown",
      body: confluenceStorageToMarkdown(c.body?.storage?.value ?? ""),
      created_at: c.version?.createdAt ?? new Date().toISOString(),
      resolved: false,
    }));

    const filtered = since
      ? comments.filter(c => c.created_at >= since)
      : comments;

    return { ok: true, value: filtered };
  }

  async postComment(ref: PageRef, body: string, inReplyTo?: string): Promise<Result<CommentRef>> {
    const storage = markdownToConfluenceStorage(body);

    const payload: Record<string, unknown> = {
      pageId: ref.id,
      body: {
        representation: "storage",
        value: storage,
      },
    };

    if (inReplyTo) {
      payload["parentCommentId"] = inReplyTo;
    }

    const result = await this.client.post<{ id: string }>(
      `${this.baseUrl}/wiki/api/v2/footer-comments`,
      payload,
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: { provider: "confluence", id: result.value.id },
    };
  }

  async deletePage(ref: PageRef): Promise<Result<void>> {
    return this.client.delete<void>(
      `${this.baseUrl}/wiki/api/v2/pages/${ref.id}`,
    );
  }

  async healthCheck(): Promise<Result<void>> {
    const result = await this.client.get<{ results: unknown[] }>(
      `${this.baseUrl}/wiki/api/v2/spaces?limit=1`,
    );
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async findPageByTitle(spaceId: string, title: string): Promise<Result<string>> {
    const result = await this.client.get<{ results: ConfluencePage[] }>(
      `${this.baseUrl}/wiki/api/v2/pages?spaceId=${encodeURIComponent(spaceId)}&title=${encodeURIComponent(title)}&limit=1`,
    );
    if (!result.ok) return result;
    const page = result.value.results[0];
    if (!page) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Parent page '${title}' not found in space '${spaceId}'`,
          retryable: false,
        },
      };
    }
    return { ok: true, value: page.id };
  }
}

/**
 * MockDocumentAdapter — in-memory document adapter for testing.
 */

import type {
  DocumentAdapter,
  PageContent,
  Comment,
} from "../adapters/document-adapter.ts";
import type { Result, PageRef, CommentRef, AdapterError } from "../types.ts";

export interface MockDocumentOptions {
  failOn?: { method: string; error: AdapterError };
  latencyMs?: number;
}

export class MockDocumentAdapter implements DocumentAdapter {
  readonly provider = "mock";

  private pages: Map<string, PageContent> = new Map();
  private comments: Map<string, Comment[]> = new Map();
  private nextId = 1;

  constructor(private readonly options: MockDocumentOptions = {}) {}

  async createPage(space: string, parentTitle: string, title: string, contentMd: string): Promise<Result<PageRef>> {
    if (this.options.failOn?.method === "createPage") {
      return { ok: false, error: this.options.failOn.error };
    }
    const id = `mock-page-${this.nextId++}`;
    const ref: PageRef = { provider: "mock", id, url: `http://mock/pages/${id}`, version: 1 };
    const page: PageContent = {
      ref,
      title,
      body_markdown: contentMd,
      body_storage: `<p>${contentMd}</p>`,
      last_updated: new Date().toISOString(),
    };
    this.pages.set(id, page);
    return { ok: true, value: ref };
  }

  async updatePage(ref: PageRef, contentMd: string): Promise<Result<PageRef>> {
    if (this.options.failOn?.method === "updatePage") {
      return { ok: false, error: this.options.failOn.error };
    }
    const existing = this.pages.get(ref.id);
    if (!existing) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Page ${ref.id} not found`, retryable: false } };
    }
    const newRef: PageRef = { ...ref, version: ref.version + 1 };
    this.pages.set(ref.id, {
      ...existing,
      ref: newRef,
      body_markdown: contentMd,
      body_storage: `<p>${contentMd}</p>`,
      last_updated: new Date().toISOString(),
    });
    return { ok: true, value: newRef };
  }

  async getPage(ref: PageRef): Promise<Result<PageContent>> {
    const page = this.pages.get(ref.id);
    if (!page) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Page ${ref.id} not found`, retryable: false } };
    }
    return { ok: true, value: page };
  }

  async getComments(ref: PageRef, since?: string): Promise<Result<Comment[]>> {
    const all = this.comments.get(ref.id) ?? [];
    const filtered = since
      ? all.filter(c => c.created_at > since)
      : all;
    return { ok: true, value: filtered };
  }

  async postComment(ref: PageRef, body: string, inReplyTo?: string): Promise<Result<CommentRef>> {
    if (!this.pages.has(ref.id)) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Page ${ref.id} not found`, retryable: false } };
    }
    const id = `mock-comment-${this.nextId++}`;
    const comment: Comment = {
      id,
      author: "mock-user",
      body,
      created_at: new Date().toISOString(),
      ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {}),
      resolved: false,
    };
    const existing = this.comments.get(ref.id) ?? [];
    this.comments.set(ref.id, [...existing, comment]);
    return { ok: true, value: { provider: "mock", id } };
  }

  async deletePage(ref: PageRef): Promise<Result<void>> {
    this.pages.delete(ref.id);
    this.comments.delete(ref.id);
    return { ok: true, value: undefined };
  }

  async healthCheck(): Promise<Result<void>> {
    if (this.options.failOn?.method === "healthCheck") {
      return { ok: false, error: this.options.failOn.error };
    }
    return { ok: true, value: undefined };
  }
}

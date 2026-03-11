/**
 * DocumentAdapter interface — abstracts Confluence (and future document providers).
 * Implementations: ConfluenceDocumentAdapter, MockDocumentAdapter.
 */

import type { Result, PageRef, CommentRef } from "../types.ts";

export interface PageContent {
  ref: PageRef;
  title: string;
  body_markdown: string;   // converted back from storage format
  body_storage: string;    // raw storage format (XHTML)
  last_updated: string;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  created_at: string;
  in_reply_to?: string | undefined;
  resolved: boolean;
}

export interface DocumentAdapter {
  readonly provider: string;

  createPage(space: string, parentTitle: string, title: string, contentMd: string): Promise<Result<PageRef>>;
  updatePage(ref: PageRef, contentMd: string): Promise<Result<PageRef>>;
  getPage(ref: PageRef): Promise<Result<PageContent>>;
  getComments(ref: PageRef, since?: string): Promise<Result<Comment[]>>;
  postComment(ref: PageRef, body: string, inReplyTo?: string): Promise<Result<CommentRef>>;
  deletePage(ref: PageRef): Promise<Result<void>>;
  healthCheck(): Promise<Result<void>>;
}

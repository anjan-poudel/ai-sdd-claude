/**
 * GitHubTaskTrackingAdapter — GitHub Issues + Projects v2 task tracking.
 * Implements TaskTrackingAdapter using GitHub REST API for Issues CRUD and
 * GraphQL for Projects v2 status field transitions.
 *
 * Epic simulation:
 *   Epic   = Issue with label "epic"
 *   Task   = Issue with label "epic:<epic-summary-slug>"
 *   Status = GitHub Projects v2 status field (via GraphQL mutations)
 *
 * API mappings:
 *   createEpic              → POST /repos/{owner}/{repo}/issues + label "epic"
 *   createTask              → POST /repos/{owner}/{repo}/issues + label "epic:<slug>"
 *   updateTask              → PATCH /repos/{owner}/{repo}/issues/{number}
 *   transitionTask          → GraphQL updateProjectV2ItemFieldValue (status field)
 *   getTask                 → GET  /repos/{owner}/{repo}/issues/{number}
 *   listTasks               → GET  /repos/{owner}/{repo}/issues?labels=...
 *   addLabel                → POST /repos/{owner}/{repo}/issues/{number}/labels
 *   getAvailableTransitions → GraphQL query on ProjectV2 status field options
 *   healthCheck             → GET  /user
 */

import type {
  TaskTrackingAdapter,
  TaskFields,
  Transition,
} from "../adapters/task-tracking-adapter.ts";
import type { Result, IssueRef } from "../types.ts";
import { RetryHttpClient } from "../infra/retry.ts";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  assignee?: { login: string } | null;
  html_url: string;
}

interface GitHubIssueCreateResponse {
  id: number;
  number: number;
  html_url: string;
  title: string;
}

interface GitHubIssuesListItem {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  assignee?: { login: string } | null;
  html_url: string;
  pull_request?: unknown; // PRs appear in issues API — exclude them
}

interface GitHubUserResponse {
  login: string;
  id: number;
}

// GraphQL response types for Projects v2
interface ProjectV2StatusFieldOption {
  id: string;
  name: string;
}

interface ProjectV2SingleSelectField {
  id: string;
  name: string;
  options: ProjectV2StatusFieldOption[];
}

interface ProjectV2Item {
  id: string;
}

interface GraphQLProjectStatusResponse {
  data?: {
    repository?: {
      projectV2?: {
        id: string;
        field?: ProjectV2SingleSelectField | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

interface GraphQLAddItemResponse {
  data?: {
    addProjectV2ItemById?: {
      item?: ProjectV2Item | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

interface GraphQLUpdateFieldResponse {
  data?: {
    updateProjectV2ItemFieldValue?: {
      projectV2Item?: ProjectV2Item | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

interface GraphQLFindItemResponse {
  data?: {
    repository?: {
      issue?: {
        projectItems?: {
          nodes?: Array<{ id: string }>;
        } | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

/** Slugify a string for use as an epic label: lowercase, spaces→hyphens, non-alphanum stripped. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 50);
}

/** Extract the GitHub issue number from an IssueRef (stored in the key field as string). */
function extractIssueNumber(ref: IssueRef): number {
  return parseInt(ref.key, 10);
}

/** Convert a GitHub Issue to our TaskFields format. */
function toTaskFields(issue: GitHubIssue | GitHubIssuesListItem, statusLabel?: string): TaskFields {
  const labels = issue.labels.map(l => l.name);
  // status comes from Projects v2; fall back to open/closed state
  const status = statusLabel ?? (issue.state === "open" ? "Open" : "Closed");

  // Extract parent key from "epic:<slug>" labels — return first match
  const epicLabel = labels.find(l => l.startsWith("epic:"));
  const result: TaskFields = {
    key: String(issue.number),
    summary: issue.title,
    description: issue.body ?? "",
    status,
    issue_type: labels.includes("epic") ? "Epic" : "Issue",
    labels,
  };
  if (epicLabel !== undefined) result.parent_key = epicLabel.slice(5); // strip "epic:"
  if (issue.assignee?.login !== undefined) result.assignee = issue.assignee.login;
  return result;
}

export class GitHubTaskTrackingAdapter implements TaskTrackingAdapter {
  readonly provider = "github";

  private readonly client: RetryHttpClient;

  /** Cache of status field options for the Projects v2 board: name → option id */
  private statusFieldCache: Map<string, string> | null = null;
  /** Cache of the Projects v2 field ID for the status field */
  private statusFieldId: string | null = null;
  /** Cache of the project's node ID */
  private projectNodeId: string | null = null;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
    private readonly projectNumber?: number | undefined,
  ) {
    this.client = new RetryHttpClient({
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  }

  async createEpic(project: string, summary: string, description: string, labels?: string[]): Promise<Result<IssueRef>> {
    const result = await this.client.post<GitHubIssueCreateResponse>(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/issues`,
      {
        title: summary,
        body: description,
        labels: ["epic", ...(labels ?? [])],
      },
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: {
        provider: "github",
        key: String(result.value.number),
        id: String(result.value.id),
        url: result.value.html_url,
      },
    };
  }

  async createTask(project: string, epicRef: IssueRef | null, summary: string, description: string, metadata?: Partial<TaskFields>): Promise<Result<IssueRef>> {
    const labels: string[] = metadata?.labels ?? [];

    // If linked to an epic, add "epic:<number>" label for parent linking.
    if (epicRef) {
      labels.push(`epic:${epicRef.key}`);
    }

    const result = await this.client.post<GitHubIssueCreateResponse>(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/issues`,
      {
        title: summary,
        body: description,
        labels,
        ...(metadata?.assignee ? { assignees: [metadata.assignee] } : {}),
      },
    );

    if (!result.ok) return result;

    return {
      ok: true,
      value: {
        provider: "github",
        key: String(result.value.number),
        id: String(result.value.id),
        url: result.value.html_url,
      },
    };
  }

  async updateTask(ref: IssueRef, fields: Partial<TaskFields>): Promise<Result<IssueRef>> {
    const issueNumber = extractIssueNumber(ref);
    const payload: Record<string, unknown> = {};

    if (fields.summary !== undefined) payload["title"] = fields.summary;
    if (fields.description !== undefined) payload["body"] = fields.description;
    if (fields.assignee !== undefined) payload["assignees"] = fields.assignee ? [fields.assignee] : [];
    if (fields.labels !== undefined) payload["labels"] = fields.labels;

    const result = await this.client.post<GitHubIssue>(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      payload,
      { "X-HTTP-Method-Override": "PATCH" },
    );

    // GitHub uses PATCH — use the underlying fetch directly via the retry client.
    // The RetryHttpClient doesn't have a PATCH method, so we use the undocumented
    // PUT with X-HTTP-Method-Override, or implement via custom headers.
    // Actually, let's use a proper PATCH by extending the client call differently.
    // Since RetryHttpClient only exposes get/post/put/delete, we'll use put as PATCH workaround
    // by calling the PATCH endpoint directly. GitHub's API accepts PATCH via fetch.
    if (!result.ok) {
      // Retry with explicit PATCH using the GitHub REST approach
      return this.patchIssue(issueNumber, payload, ref);
    }

    return { ok: true, value: ref };
  }

  async transitionTask(ref: IssueRef, targetStatus: string): Promise<Result<void>> {
    if (!this.projectNumber) {
      return {
        ok: false,
        error: {
          code: "VALIDATION",
          message: "transitionTask requires project_number to be configured (GitHub Projects v2)",
          retryable: false,
        },
      };
    }

    // Ensure status field options are loaded.
    const loadResult = await this.ensureStatusFieldLoaded();
    if (!loadResult.ok) return loadResult;

    const optionId = this.statusFieldCache?.get(targetStatus);
    if (!optionId) {
      return {
        ok: false,
        error: {
          code: "VALIDATION",
          message: `Status '${targetStatus}' not found in Projects v2 status field options`,
          retryable: false,
        },
      };
    }

    // Find the project item ID for this issue.
    const itemResult = await this.findProjectItemId(ref);
    if (!itemResult.ok) {
      // Issue isn't on the board yet — add it first.
      const addResult = await this.addIssueToProject(ref);
      if (!addResult.ok) return addResult;
      // Re-fetch the item ID.
      const retryResult = await this.findProjectItemId(ref);
      if (!retryResult.ok) return retryResult;
      return this.updateProjectV2ItemStatus(retryResult.value, optionId);
    }

    return this.updateProjectV2ItemStatus(itemResult.value, optionId);
  }

  async getTask(ref: IssueRef): Promise<Result<TaskFields>> {
    const issueNumber = extractIssueNumber(ref);
    const result = await this.client.get<GitHubIssue>(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
    );
    if (!result.ok) return result;
    return { ok: true, value: toTaskFields(result.value) };
  }

  async listTasks(project: string, filter?: { labels?: string[]; status?: string }): Promise<Result<TaskFields[]>> {
    let url = `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/issues?state=open&per_page=100`;

    if (filter?.labels?.length) {
      url += `&labels=${filter.labels.map(l => encodeURIComponent(l)).join(",")}`;
    }

    const result = await this.client.get<GitHubIssuesListItem[]>(url);
    if (!result.ok) return result;

    // Exclude pull requests (they appear in the issues endpoint).
    const issues = result.value
      .filter(i => !i.pull_request)
      .map(i => toTaskFields(i));

    const filtered = filter?.status
      ? issues.filter(i => i.status === filter.status)
      : issues;

    return { ok: true, value: filtered };
  }

  async addLabel(ref: IssueRef, label: string): Promise<Result<void>> {
    const issueNumber = extractIssueNumber(ref);
    const result = await this.client.post<Array<{ name: string }>>(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/issues/${issueNumber}/labels`,
      { labels: [label] },
    );
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  async getAvailableTransitions(ref: IssueRef): Promise<Result<Transition[]>> {
    if (!this.projectNumber) {
      // Without a project board, return open/close as the only transitions.
      return {
        ok: true,
        value: [
          { id: "open", name: "Open", to_status: "Open" },
          { id: "closed", name: "Close", to_status: "Closed" },
        ],
      };
    }

    const loadResult = await this.ensureStatusFieldLoaded();
    if (!loadResult.ok) return loadResult;

    const transitions: Transition[] = Array.from(this.statusFieldCache?.entries() ?? []).map(
      ([name, id]) => ({ id, name, to_status: name }),
    );

    return { ok: true, value: transitions };
  }

  async healthCheck(): Promise<Result<void>> {
    const result = await this.client.get<GitHubUserResponse>(
      `${GITHUB_API_BASE}/user`,
    );
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** PATCH an issue using a direct fetch (RetryHttpClient doesn't expose PATCH). */
  private async patchIssue(issueNumber: number, payload: Record<string, unknown>, ref: IssueRef): Promise<Result<IssueRef>> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(
          `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
          {
            method: "PATCH",
            headers: {
              "Authorization": `Bearer ${this.token}`,
              "Content-Type": "application/json",
              "Accept": "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      if (response.ok) return { ok: true, value: ref };

      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: { code: "AUTH", message: `Authentication failed: HTTP ${response.status}`, retryable: false } };
      }
      if (response.status === 404) {
        return { ok: false, error: { code: "NOT_FOUND", message: `Issue ${issueNumber} not found`, retryable: false } };
      }
      return { ok: false, error: { code: "UNKNOWN", message: `HTTP ${response.status} from PATCH /issues/${issueNumber}`, retryable: false } };
    } catch (e) {
      return { ok: false, error: { code: "NETWORK", message: `Network error: ${String(e)}`, retryable: false, cause: e } };
    }
  }

  /** Execute a GraphQL query/mutation against the GitHub GraphQL API. */
  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<Result<T>> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(GITHUB_GRAPHQL_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { ok: false, error: { code: "AUTH", message: `GraphQL authentication failed: HTTP ${response.status}`, retryable: false } };
        }
        return { ok: false, error: { code: "UNKNOWN", message: `GraphQL HTTP ${response.status}`, retryable: false } };
      }

      const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
      if (json.errors?.length) {
        return {
          ok: false,
          error: {
            code: "UNKNOWN",
            message: `GraphQL errors: ${json.errors.map(e => e.message).join("; ")}`,
            retryable: false,
          },
        };
      }

      return { ok: true, value: json.data as T };
    } catch (e) {
      return { ok: false, error: { code: "NETWORK", message: `GraphQL network error: ${String(e)}`, retryable: false, cause: e } };
    }
  }

  /** Load and cache the Projects v2 status field options. */
  private async ensureStatusFieldLoaded(): Promise<Result<void>> {
    if (this.statusFieldCache !== null) return { ok: true, value: undefined };

    const query = `
      query GetProjectStatusField($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          projectV2(number: $number) {
            id
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql<GraphQLProjectStatusResponse["data"]>(query, {
      owner: this.owner,
      repo: this.repo,
      number: this.projectNumber!,
    });

    if (!result.ok) return result;

    const projectV2 = result.value?.repository?.projectV2;
    if (!projectV2) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `GitHub Projects v2 board #${this.projectNumber} not found for ${this.owner}/${this.repo}`,
          retryable: false,
        },
      };
    }

    this.projectNodeId = projectV2.id;

    const field = projectV2.field;
    if (!field) {
      // No Status field on the board — use an empty cache.
      this.statusFieldCache = new Map();
      return { ok: true, value: undefined };
    }

    this.statusFieldId = field.id;
    this.statusFieldCache = new Map(field.options.map(o => [o.name, o.id]));

    return { ok: true, value: undefined };
  }

  /** Find the Projects v2 item ID for a given issue ref. */
  private async findProjectItemId(ref: IssueRef): Promise<Result<string>> {
    const issueNumber = extractIssueNumber(ref);
    const query = `
      query FindProjectItem($owner: String!, $repo: String!, $issueNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $issueNumber) {
            projectItems(first: 10) {
              nodes {
                id
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql<GraphQLFindItemResponse["data"]>(query, {
      owner: this.owner,
      repo: this.repo,
      issueNumber,
    });

    if (!result.ok) return result;

    const nodes = result.value?.repository?.issue?.projectItems?.nodes;
    const firstItem = nodes?.[0];
    if (!firstItem) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Issue #${issueNumber} is not associated with any Projects v2 board`,
          retryable: false,
        },
      };
    }

    return { ok: true, value: firstItem.id };
  }

  /** Add an issue to the configured Projects v2 board. */
  private async addIssueToProject(ref: IssueRef): Promise<Result<string>> {
    if (!this.projectNodeId) {
      return {
        ok: false,
        error: { code: "VALIDATION", message: "Project node ID not loaded", retryable: false },
      };
    }

    const mutation = `
      mutation AddIssueToProject($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }
    `;

    // The content ID is the GitHub node ID for the issue (stored in ref.id).
    const result = await this.graphql<GraphQLAddItemResponse["data"]>(mutation, {
      projectId: this.projectNodeId,
      contentId: ref.id,
    });

    if (!result.ok) return result;

    const itemId = result.value?.addProjectV2ItemById?.item?.id;
    if (!itemId) {
      return {
        ok: false,
        error: { code: "UNKNOWN", message: "Failed to get item ID after adding to project", retryable: false },
      };
    }

    return { ok: true, value: itemId };
  }

  /** Update the status field of a Projects v2 item. */
  private async updateProjectV2ItemStatus(itemId: string, optionId: string): Promise<Result<void>> {
    if (!this.projectNodeId || !this.statusFieldId) {
      return {
        ok: false,
        error: { code: "VALIDATION", message: "Project or status field not loaded", retryable: false },
      };
    }

    const mutation = `
      mutation UpdateProjectV2ItemStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `;

    const result = await this.graphql<GraphQLUpdateFieldResponse["data"]>(mutation, {
      projectId: this.projectNodeId,
      itemId,
      fieldId: this.statusFieldId,
      optionId,
    });

    if (!result.ok) return result;

    return { ok: true, value: undefined };
  }
}

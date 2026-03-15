/**
 * CollaborationAdapterFactory — instantiates and caches adapter instances from configuration.
 * Validates required env vars at creation time (fail-fast).
 * Credentials are registered with log-sanitizer on instantiation.
 */

import type { Result, CollaborationAdaptersConfig, AdapterError, MentionConfig } from "../types.ts";
import type { NotificationAdapter } from "../adapters/notification-adapter.ts";
import type { NotificationChannel } from "../adapters/notification-channel.ts";
import type { DocumentAdapter } from "../adapters/document-adapter.ts";
import type { TaskTrackingAdapter } from "../adapters/task-tracking-adapter.ts";
import type { CodeReviewAdapter } from "../adapters/code-review-adapter.ts";

/** Required env vars per adapter type. */
const REQUIRED_ENV_VARS: Record<string, string[]> = {
  slack:       ["SLACK_BOT_TOKEN"],
  confluence:  ["CONFLUENCE_API_TOKEN", "CONFLUENCE_USER_EMAIL", "CONFLUENCE_BASE_URL"],
  jira:        ["JIRA_API_TOKEN", "JIRA_USER_EMAIL", "JIRA_BASE_URL"],
  bitbucket:   ["BITBUCKET_APP_PASSWORD", "BITBUCKET_USERNAME", "BITBUCKET_WORKSPACE"],
  github:      ["GITHUB_TOKEN"],
  mock:        [],
};

export interface CollaborationAdapterFactory {
  getNotificationAdapter(): NotificationAdapter;
  getNotificationChannel(channel: string, mentionConfig?: MentionConfig): NotificationChannel;
  getDocumentAdapter(): DocumentAdapter;
  getTaskTrackingAdapter(): TaskTrackingAdapter;
  getCodeReviewAdapter(): CodeReviewAdapter;
  validateCredentials(): Result<void>;
}

/**
 * Validate required env vars for a given adapter type.
 * Returns a list of missing variable names.
 */
function getMissingEnvVars(adapterType: string): string[] {
  const required = REQUIRED_ENV_VARS[adapterType] ?? [];
  return required.filter(v => !process.env[v]);
}

/**
 * Register credential values with the log sanitizer to prevent leaks.
 * Looks up env vars by name and registers their values.
 */
function registerCredentials(adapterType: string): void {
  const required = REQUIRED_ENV_VARS[adapterType] ?? [];
  // Lazy import to avoid circular deps — sanitizer may not be present in test env.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerSecret } = require("../../security/log-sanitizer.ts") as {
      registerSecret: (value: string) => void;
    };
    for (const varName of required) {
      const value = process.env[varName];
      if (value) registerSecret(value);
    }
  } catch {
    // Log sanitizer not available — silently skip.
  }
}

export class DefaultCollaborationAdapterFactory implements CollaborationAdapterFactory {
  private notificationAdapter?: NotificationAdapter;
  private documentAdapter?: DocumentAdapter;
  private taskTrackingAdapter?: TaskTrackingAdapter;
  private codeReviewAdapter?: CodeReviewAdapter;

  constructor(private readonly config: CollaborationAdaptersConfig) {}

  getNotificationChannel(channel: string, mentionConfig: MentionConfig = {}): NotificationChannel {
    const adapter = this.getNotificationAdapter();
    if (this.config.notification === "slack") {
      const { SlackNotificationChannel } = require("../impl/slack-notification-channel.ts") as {
        SlackNotificationChannel: new (adapter: NotificationAdapter, channel: string, mentionConfig: MentionConfig) => NotificationChannel;
      };
      return new SlackNotificationChannel(adapter, channel, mentionConfig);
    }
    const { MockNotificationChannel } = require("../impl/mock-notification-channel.ts") as {
      MockNotificationChannel: new () => NotificationChannel;
    };
    return new MockNotificationChannel();
  }

  getNotificationAdapter(): NotificationAdapter {
    if (!this.notificationAdapter) {
      this.notificationAdapter = this.createNotificationAdapter();
    }
    return this.notificationAdapter;
  }

  getDocumentAdapter(): DocumentAdapter {
    if (!this.documentAdapter) {
      this.documentAdapter = this.createDocumentAdapter();
    }
    return this.documentAdapter;
  }

  getTaskTrackingAdapter(): TaskTrackingAdapter {
    if (!this.taskTrackingAdapter) {
      this.taskTrackingAdapter = this.createTaskTrackingAdapter();
    }
    return this.taskTrackingAdapter;
  }

  getCodeReviewAdapter(): CodeReviewAdapter {
    if (!this.codeReviewAdapter) {
      this.codeReviewAdapter = this.createCodeReviewAdapter();
    }
    return this.codeReviewAdapter;
  }

  /**
   * Validate that all required environment variables are present.
   * Returns ok:false with a descriptive error if any are missing.
   * Should be called at startup before adapters are used.
   */
  validateCredentials(): Result<void> {
    const missing: string[] = [];

    for (const adapterType of [
      this.config.notification,
      this.config.document,
      this.config.task_tracking,
      this.config.code_review,
    ]) {
      const vars = getMissingEnvVars(adapterType);
      missing.push(...vars.map(v => `${v} (required for ${adapterType})`));
    }

    if (missing.length > 0) {
      const error: AdapterError = {
        code: "AUTH",
        message: `Missing required environment variables:\n  ${missing.join("\n  ")}`,
        retryable: false,
      };
      return { ok: false, error };
    }

    return { ok: true, value: undefined };
  }

  // ── Private factory methods ────────────────────────────────────────────────

  private createNotificationAdapter(): NotificationAdapter {
    registerCredentials(this.config.notification);
    if (this.config.notification === "slack") {
      // Lazy load to avoid import of Slack-specific deps until needed.
      const { SlackNotificationAdapter } = require("../impl/slack-notification-adapter.ts") as {
        SlackNotificationAdapter: new (token: string) => NotificationAdapter;
      };
      return new SlackNotificationAdapter(process.env["SLACK_BOT_TOKEN"]!);
    }
    // mock
    const { MockNotificationAdapter } = require("../impl/mock-notification-adapter.ts") as {
      MockNotificationAdapter: new () => NotificationAdapter;
    };
    return new MockNotificationAdapter();
  }

  private createDocumentAdapter(): DocumentAdapter {
    registerCredentials(this.config.document);
    if (this.config.document === "confluence") {
      const { ConfluenceDocumentAdapter } = require("../impl/confluence-document-adapter.ts") as {
        ConfluenceDocumentAdapter: new (token: string, email: string, baseUrl: string) => DocumentAdapter;
      };
      return new ConfluenceDocumentAdapter(
        process.env["CONFLUENCE_API_TOKEN"]!,
        process.env["CONFLUENCE_USER_EMAIL"]!,
        process.env["CONFLUENCE_BASE_URL"]!,
      );
    }
    const { MockDocumentAdapter } = require("../impl/mock-document-adapter.ts") as {
      MockDocumentAdapter: new () => DocumentAdapter;
    };
    return new MockDocumentAdapter();
  }

  private createTaskTrackingAdapter(): TaskTrackingAdapter {
    registerCredentials(this.config.task_tracking);
    if (this.config.task_tracking === "jira") {
      const { JiraTaskTrackingAdapter } = require("../impl/jira-task-tracking-adapter.ts") as {
        JiraTaskTrackingAdapter: new (token: string, email: string, baseUrl: string) => TaskTrackingAdapter;
      };
      return new JiraTaskTrackingAdapter(
        process.env["JIRA_API_TOKEN"]!,
        process.env["JIRA_USER_EMAIL"]!,
        process.env["JIRA_BASE_URL"]!,
      );
    }
    if (this.config.task_tracking === "github") {
      const { GitHubTaskTrackingAdapter } = require("../impl/github-task-tracking-adapter.ts") as {
        GitHubTaskTrackingAdapter: new (token: string) => TaskTrackingAdapter;
      };
      return new GitHubTaskTrackingAdapter(process.env["GITHUB_TOKEN"]!);
    }
    const { MockTaskTrackingAdapter } = require("../impl/mock-task-tracking-adapter.ts") as {
      MockTaskTrackingAdapter: new () => TaskTrackingAdapter;
    };
    return new MockTaskTrackingAdapter();
  }

  private createCodeReviewAdapter(): CodeReviewAdapter {
    registerCredentials(this.config.code_review);
    if (this.config.code_review === "bitbucket") {
      const { BitbucketCodeReviewAdapter } = require("../impl/bitbucket-code-review-adapter.ts") as {
        BitbucketCodeReviewAdapter: new (password: string, username: string, workspace: string) => CodeReviewAdapter;
      };
      return new BitbucketCodeReviewAdapter(
        process.env["BITBUCKET_APP_PASSWORD"]!,
        process.env["BITBUCKET_USERNAME"]!,
        process.env["BITBUCKET_WORKSPACE"]!,
      );
    }
    if (this.config.code_review === "github") {
      const { GitHubCodeReviewAdapter } = require("../impl/github-code-review-adapter.ts") as {
        GitHubCodeReviewAdapter: new (token: string) => CodeReviewAdapter;
      };
      return new GitHubCodeReviewAdapter(process.env["GITHUB_TOKEN"]!);
    }
    const { MockCodeReviewAdapter } = require("../impl/mock-code-review-adapter.ts") as {
      MockCodeReviewAdapter: new () => CodeReviewAdapter;
    };
    return new MockCodeReviewAdapter();
  }
}

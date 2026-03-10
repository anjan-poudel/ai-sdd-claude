/**
 * ReviewLog — append-only review audit log.
 * Written to .ai-sdd/state/review-logs/<task-id>.json.
 * Each iteration is appended atomically (tmp+rename) for corruption resistance.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";

export interface ReviewDecision {
  task_id: string;
  reviewer_agent: string;
  coder_agent: string;
  iteration: number;
  decision: "GO" | "NO_GO";
  feedback: string;
  quality_checks?: {
    acceptance_criteria_met?: boolean;
    code_standards_met?: boolean;
    test_coverage_adequate?: boolean;
    security_review_passed?: boolean;
  };
  timestamp: string;
}

export interface ReviewLog {
  task_id: string;
  overlay: "agentic_review";
  iterations: ReviewDecision[];
  final_decision?: "GO" | "NO_GO";
  completed_at?: string;
}

export class ReviewLogWriter {
  private readonly filePath: string;

  constructor(private readonly logDir: string, private readonly taskId: string) {
    this.filePath = join(logDir, `${taskId}.json`);
  }

  read(): ReviewLog {
    if (!existsSync(this.filePath)) {
      return { task_id: this.taskId, overlay: "agentic_review", iterations: [] };
    }
    return JSON.parse(readFileSync(this.filePath, "utf-8")) as ReviewLog;
  }

  append(decision: ReviewDecision): void {
    const log = this.read();
    log.iterations.push(decision);
    this.write(log);
  }

  finalize(finalDecision: "GO" | "NO_GO"): void {
    const log = this.read();
    log.final_decision = finalDecision;
    log.completed_at = new Date().toISOString();
    this.write(log);
  }

  private write(log: ReviewLog): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = join(tmpdir(), `review-log-${this.taskId}-${Date.now()}.json.tmp`);
    writeFileSync(tmp, JSON.stringify(log, null, 2), "utf-8");
    renameSync(tmp, this.filePath);
  }

  static logDir(projectRoot: string): string {
    return join(projectRoot, ".ai-sdd", "state", "review-logs");
  }
}

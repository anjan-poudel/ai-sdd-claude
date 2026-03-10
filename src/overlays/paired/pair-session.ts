/**
 * PairSession — persistent state for the driver/challenger loop.
 * State is written to .ai-sdd/state/pair-sessions/<task-id>.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

export interface PairHistoryEntry {
  iteration: number;
  driver_output_summary: string;
  challenger_feedback: string;
  challenger_approved: boolean;
}

export interface PairSessionState {
  task_id: string;
  driver_agent: string;
  challenger_agent: string;
  current_role_driver: string;  // which agent is currently acting as driver
  role_switch: "session" | "subtask" | "checkpoint";
  iteration: number;
  max_iterations: number;
  history: PairHistoryEntry[];
  challenger_approved: boolean;
}

export class PairSession {
  private state: PairSessionState;
  private readonly filePath: string;

  constructor(
    private readonly sessionDir: string,
    taskId: string,
    initial?: Partial<PairSessionState>,
  ) {
    this.filePath = join(sessionDir, `${taskId}.json`);
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, "utf-8");
      this.state = JSON.parse(raw) as PairSessionState;
    } else {
      this.state = {
        task_id: taskId,
        driver_agent: initial?.driver_agent ?? "",
        challenger_agent: initial?.challenger_agent ?? "",
        current_role_driver: initial?.driver_agent ?? "",
        role_switch: initial?.role_switch ?? "session",
        iteration: 0,
        max_iterations: initial?.max_iterations ?? 3,
        history: [],
        challenger_approved: false,
        ...initial,
      };
      this.persist();
    }
  }

  get taskId(): string { return this.state.task_id; }
  get iteration(): number { return this.state.iteration; }
  get maxIterations(): number { return this.state.max_iterations; }
  get challengerApproved(): boolean { return this.state.challenger_approved; }
  get currentDriverAgent(): string { return this.state.current_role_driver; }
  get challengerAgent(): string { return this.state.challenger_agent; }
  get history(): PairHistoryEntry[] { return this.state.history; }
  get roleSwitch(): "session" | "subtask" | "checkpoint" { return this.state.role_switch; }

  recordIteration(entry: PairHistoryEntry): void {
    this.state.iteration = entry.iteration;
    this.state.history.push(entry);
    if (entry.challenger_approved) {
      this.state.challenger_approved = true;
    }
    this.persist();
  }

  /**
   * Switch driver/challenger roles for `subtask` mode.
   */
  switchRoles(): void {
    const prev = this.state.current_role_driver;
    this.state.current_role_driver = this.state.challenger_agent === prev
      ? this.state.driver_agent
      : this.state.challenger_agent;
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
  }

  static sessionDir(projectRoot: string): string {
    return join(projectRoot, ".ai-sdd", "state", "pair-sessions");
  }
}

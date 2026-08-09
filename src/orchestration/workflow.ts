import { GoalStatus, TaskStatus } from "@prisma/client";
import { prisma } from "../database/prisma.js";
import { DiscorpError } from "../utils/errors.js";

/**
 * Goal workflow state machine:
 * PENDING → ANALYZING → IN_PROGRESS ⇄ REVIEWING → COMPLETED | FAILED
 */
export class Workflow {
  async setGoalStatus(goalId: string, status: GoalStatus): Promise<void> {
    await prisma.goal.update({ where: { id: goalId }, data: { status } });
  }

  async transition(from: GoalStatus, to: GoalStatus, goalId: string): Promise<boolean> {
    const goal = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) return false;
    if (goal.status !== from) return false;
    await prisma.goal.update({ where: { id: goalId }, data: { status: to } });
    return true;
  }

  async startAnalysis(goalId: string): Promise<void> {
    if (!(await this.transition(GoalStatus.PENDING, GoalStatus.ANALYZING, goalId))) {
      throw new DiscorpError(`Goal ${goalId} is not in PENDING state`);
    }
  }

  async markInProgress(goalId: string): Promise<void> {
    await this.transition(GoalStatus.ANALYZING, GoalStatus.IN_PROGRESS, goalId);
  }

  async startReview(goalId: string): Promise<void> {
    await this.transition(GoalStatus.IN_PROGRESS, GoalStatus.REVIEWING, goalId);
  }

  async complete(goalId: string): Promise<void> {
    await this.transition(GoalStatus.REVIEWING, GoalStatus.COMPLETED, goalId);
    // Close any dangling tasks
    await prisma.task.updateMany({
      where: { goalId, status: { in: [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] } },
      data: { status: TaskStatus.DONE },
    });
  }

  async fail(goalId: string, reason: string): Promise<void> {
    await prisma.goal.update({
      where: { id: goalId },
      data: { status: GoalStatus.FAILED },
    });
    await prisma.task.updateMany({
      where: { goalId, status: { in: [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] } },
      data: { status: TaskStatus.FAILED },
    });
  }
}

export const workflow = new Workflow();

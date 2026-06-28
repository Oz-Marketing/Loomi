import { createNotification } from '@/lib/notifications/service';

/**
 * Projects (App surface) notification triggers — thin wrappers over
 * createNotification so the call sites in the projects service stay readable.
 * Links point at the App-surface task detail (browser path on app.loomilm.com).
 */

const taskLink = (taskId: string) => `/projects/tasks/${taskId}`;

export async function notifyTaskAssigned(args: {
  assigneeUserId: string;
  byUserId: string | null;
  taskId: string;
  taskTitle: string;
  accountDealer: string | null;
}) {
  if (args.assigneeUserId === args.byUserId) return; // no self-assign pings
  await createNotification({
    userId: args.assigneeUserId,
    type: 'task_assigned',
    severity: 'info',
    title: `Assigned: "${args.taskTitle}"`,
    body: args.accountDealer
      ? `${args.accountDealer} · open the task to get started.`
      : 'Open the task to get started.',
    link: taskLink(args.taskId),
    meta: { taskId: args.taskId },
    sendEmailNow: true,
  });
}

export async function notifyTicketFiled(args: {
  recipientUserIds: string[];
  byUserId: string | null;
  teamName: string;
  taskId: string;
  taskTitle: string;
  accountDealer: string | null;
}) {
  for (const userId of new Set(args.recipientUserIds)) {
    if (userId === args.byUserId) continue;
    await createNotification({
      userId,
      type: 'ticket_filed',
      severity: 'info',
      title: `New ${args.teamName} ticket: "${args.taskTitle}"`,
      body: args.accountDealer
        ? `${args.accountDealer} · filed to your team.`
        : 'Filed to your team.',
      link: taskLink(args.taskId),
      meta: { taskId: args.taskId },
      sendEmailNow: true,
    });
  }
}

export async function notifyTaskDueSoon(args: {
  userId: string;
  taskId: string;
  taskTitle: string;
  accountDealer: string | null;
}) {
  // Digest channel — no immediate email; the daily scan bundles these into one
  // digest email (see scanTaskDueDates). Returns null if the user disabled it.
  return createNotification({
    userId: args.userId,
    type: 'task_due_soon',
    severity: 'warning',
    title: `Due soon: "${args.taskTitle}"`,
    body: args.accountDealer
      ? `${args.accountDealer} · due in the next couple of days.`
      : 'Due in the next couple of days.',
    link: taskLink(args.taskId),
    meta: { taskId: args.taskId },
  });
}

export async function notifyTaskOverdue(args: {
  userId: string;
  taskId: string;
  taskTitle: string;
  accountDealer: string | null;
}) {
  return createNotification({
    userId: args.userId,
    type: 'task_overdue',
    severity: 'critical',
    title: `Overdue: "${args.taskTitle}"`,
    body: args.accountDealer
      ? `${args.accountDealer} · past its due date and not done.`
      : 'Past its due date and not done.',
    link: taskLink(args.taskId),
    meta: { taskId: args.taskId },
  });
}

export async function notifyTaskComment(args: {
  recipientUserId: string;
  byUserId: string | null;
  taskId: string;
  taskTitle: string;
  mention: boolean;
}) {
  if (args.recipientUserId === args.byUserId) return;
  await createNotification({
    userId: args.recipientUserId,
    type: args.mention ? 'task_mention' : 'task_comment',
    severity: 'info',
    title: args.mention
      ? `Mentioned on "${args.taskTitle}"`
      : `New comment on "${args.taskTitle}"`,
    body: 'Open the task to reply.',
    link: taskLink(args.taskId),
    meta: { taskId: args.taskId },
    sendEmailNow: true,
  });
}

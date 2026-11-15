import type {
  NotificationCategory,
  NotificationKind,
} from "~/lib/notifications";

// ─── Cadence names → Knock keys ───
// Used only by the Knock adapters (server and client). Each Notification kind
// is one Knock workflow with an in-app feed step; each preference category is
// one Knock workflow category. The keys happen to match Cadence's names today,
// but nothing outside the adapters may rely on that.

export const knockWorkflowKey: Record<NotificationKind, string> = {
  "discussion-reply": "discussion-reply",
};

export const knockCategoryKey: Record<NotificationCategory, string> = {
  "refund-request-updates": "refund-request-updates",
  "open-refund-requests": "open-refund-requests",
  "seat-claims": "seat-claims",
  enrollments: "enrollments",
  "discussion-questions": "discussion-questions",
  "discussion-replies": "discussion-replies",
};

/** The Knock channel type behind Cadence's `feed` channel. */
export const KNOCK_FEED_CHANNEL_TYPE = "in_app_feed";

export function kindOfKnockWorkflow(
  workflowKey: string
): NotificationKind | undefined {
  const entry = Object.entries(knockWorkflowKey).find(
    ([, key]) => key === workflowKey
  );
  return entry?.[0] as NotificationKind | undefined;
}

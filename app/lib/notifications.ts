import { z } from "zod";

// ─── Notifications: the shared vocabulary ───
// What Cadence calls each Notification, the preference category it belongs
// to, and the data it carries. Shared by the server (which triggers them) and
// the Notification Feed (which draws them). No vendor names here: the adapters
// map these to whatever the vendor calls them.
//
// Data is a flat object (no nesting) so a vendor can filter on any field, and
// it holds everything a row needs, because Cadence writes the row text itself.
// Money stays in integer cents (docs/adr/0005) and is formatted when drawn.

const linkTarget = z.string().nullable();

const discussionData = {
  commentId: z.number(),
  lessonId: z.number(),
  lessonTitle: z.string(),
  courseTitle: z.string(),
  courseSlug: z.string(),
  snippet: z.string(),
  url: linkTarget,
};

const refundData = {
  refundRequestId: z.number(),
  purchaseId: z.number(),
  courseTitle: z.string(),
  courseSlug: z.string(),
  /** What the buyer paid, in cents. */
  amount: z.number(),
  url: linkTarget,
};

/** Every Notification kind, with the data it carries. */
export const notificationPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("discussion-question"),
    data: z.object(discussionData),
  }),
  z.object({
    kind: z.literal("discussion-reply"),
    data: z.object({ ...discussionData, questionId: z.number() }),
  }),
  z.object({
    kind: z.literal("new-enrollment"),
    data: z.object({
      enrollmentId: z.number(),
      courseId: z.number(),
      courseTitle: z.string(),
      courseSlug: z.string(),
      studentName: z.string(),
      url: linkTarget,
    }),
  }),
  z.object({
    kind: z.literal("seat-claimed"),
    data: z.object({
      seatId: z.number(),
      purchaseId: z.number(),
      courseTitle: z.string(),
      courseSlug: z.string(),
      seatsLeft: z.number(),
      url: linkTarget,
    }),
  }),
  z.object({
    kind: z.literal("refund-request-confirmed"),
    data: z.object(refundData),
  }),
  z.object({
    kind: z.literal("open-refund-request"),
    data: z.object({ ...refundData, reason: z.string() }),
  }),
  z.object({
    kind: z.literal("refund-request-approved"),
    data: z.object({ ...refundData, decisionNote: z.string().nullable() }),
  }),
  z.object({
    kind: z.literal("refund-request-declined"),
    data: z.object({ ...refundData, decisionNote: z.string() }),
  }),
]);

/** A Notification's kind and data, correlated: narrowing `kind` narrows `data`. */
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export type NotificationKind = NotificationPayload["kind"];

// ─── Preference categories ───
// Everyone switches Notifications on or off per category, on the `feed`
// channel (the only channel in v1; email will be a second one).

export const notificationCategories = [
  "refund-request-updates",
  "open-refund-requests",
  "seat-claims",
  "enrollments",
  "discussion-questions",
  "discussion-replies",
] as const;

export type NotificationCategory = (typeof notificationCategories)[number];

export type NotificationChannel = "feed";

/** Only categories someone has a stored choice for are present. */
export type NotificationPreferences = Partial<
  Record<NotificationCategory, Record<NotificationChannel, boolean>>
>;

/**
 * What Cadence writes for a person the first time they're synced: everything
 * on, except Enrollments, which an Instructor opts into so a popular course
 * doesn't flood their feed.
 */
export const DEFAULT_PREFERENCES: Required<NotificationPreferences> = {
  "refund-request-updates": { feed: true },
  "open-refund-requests": { feed: true },
  "seat-claims": { feed: true },
  enrollments: { feed: false },
  "discussion-questions": { feed: true },
  "discussion-replies": { feed: true },
};

export const categoryOfKind: Record<NotificationKind, NotificationCategory> = {
  "discussion-question": "discussion-questions",
  "discussion-reply": "discussion-replies",
  "new-enrollment": "enrollments",
  "seat-claimed": "seat-claims",
  "refund-request-confirmed": "refund-request-updates",
  "open-refund-request": "open-refund-requests",
  "refund-request-approved": "refund-request-updates",
  "refund-request-declined": "refund-request-updates",
};

// ─── Snippets and link targets ───

const SNIPPET_LENGTH = 140;

/** One line of a comment, for a Notification row. Markdown is left as typed. */
export function snippetOf(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > SNIPPET_LENGTH
    ? `${oneLine.slice(0, SNIPPET_LENGTH - 1)}…`
    : oneLine;
}

export function commentAnchor(commentId: number): string {
  return `comment-${commentId}`;
}

export function commentUrl(
  courseSlug: string,
  lessonId: number,
  commentId: number
): string {
  return `/courses/${courseSlug}/lessons/${lessonId}#${commentAnchor(commentId)}`;
}

// ─── The Notification Feed ───

/**
 * What the browser needs to read one person's Notification Feed: a token
 * signed for them alone, and the vendor's public identifiers.
 */
export type FeedSession = {
  recipientId: string;
  token: string;
  publicKey: string;
  channelId: string;
};

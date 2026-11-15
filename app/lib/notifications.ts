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

export const notificationDataSchemas = {
  "discussion-reply": z.object({ ...discussionData, questionId: z.number() }),
} as const;

export type NotificationKind = keyof typeof notificationDataSchemas;

export type NotificationData<K extends NotificationKind = NotificationKind> =
  z.infer<(typeof notificationDataSchemas)[K]>;

export const notificationKinds = Object.keys(
  notificationDataSchemas
) as NotificationKind[];

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
  "discussion-reply": "discussion-replies",
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

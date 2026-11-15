import type { FeedItem } from "~/lib/notification-feed";
import { formatPrice } from "~/lib/utils";

// ─── What each Notification says in the feed ───
// Cadence writes the row text itself from the Notification's data, not from
// the vendor's templates. Money is formatted here, at draw time.

export type RowIcon = "discussion" | "refund" | "team" | "enrollment";

export type NotificationRow = {
  icon: RowIcon;
  title: string;
  snippet: string;
  /** Where clicking goes. Null: it only marks itself read. */
  url: string | null;
};

export function describeNotification(item: FeedItem): NotificationRow {
  const actor = item.actor?.name ?? "Someone";

  switch (item.kind) {
    case "discussion-question":
      return {
        icon: "discussion",
        title: `${actor} asked a question`,
        snippet: `${item.data.lessonTitle}: “${item.data.snippet}”`,
        url: item.data.url,
      };
    case "discussion-reply":
      return {
        icon: "discussion",
        title: `${actor} replied to your question`,
        snippet: `${item.data.lessonTitle}: “${item.data.snippet}”`,
        url: item.data.url,
      };
    case "refund-request-confirmed":
      return {
        icon: "refund",
        title: "We've received your Refund Request",
        snippet: `${formatPrice(item.data.amount)} for ${item.data.courseTitle} is under review.`,
        url: item.data.url,
      };
    case "open-refund-request":
      return {
        icon: "refund",
        title: `${actor} requested a ${formatPrice(item.data.amount)} refund`,
        snippet: `${item.data.courseTitle}: “${item.data.reason}”`,
        url: item.data.url,
      };
    case "refund-request-approved":
      return {
        icon: "refund",
        title: "Your Refund Request was approved",
        snippet: item.data.decisionNote
          ? `${item.data.courseTitle}: “${item.data.decisionNote}”`
          : `${formatPrice(item.data.amount)} for ${item.data.courseTitle} is on its way back.`,
        url: item.data.url,
      };
    case "refund-request-declined":
      return {
        icon: "refund",
        title: "Your Refund Request was declined",
        snippet: `${item.data.courseTitle}: “${item.data.decisionNote}” You can ask again.`,
        url: item.data.url,
      };
  }
}

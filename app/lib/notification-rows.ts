import type { FeedItem } from "~/lib/notification-feed";

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
    case "discussion-reply":
      return {
        icon: "discussion",
        title: `${actor} replied to your question`,
        snippet: `${item.data.lessonTitle}: “${item.data.snippet}”`,
        url: item.data.url,
      };
  }
}

import type { FeedSession, NotificationPayload } from "~/lib/notifications";

// ─── The client feed port ───
// What the Notification Feed components ask of the vendor, in Cadence's
// words. The Knock adapter (notification-feed.knock.ts) talks to Knock from
// the browser with the public key and a signed user token; the components
// only ever see this interface.

export type FeedActor = { name: string; avatarUrl: string | null };

export type FeedItem = NotificationPayload & {
  id: string;
  /** Null when Cadence itself sent it. */
  actor: FeedActor | null;
  insertedAt: string;
  seenAt: string | null;
  readAt: string | null;
};

export type FeedState = {
  /** Newest first. */
  items: FeedItem[];
  unseenCount: number;
  unreadCount: number;
  hasMore: boolean;
  loading: boolean;
};

export const EMPTY_FEED: FeedState = {
  items: [],
  unseenCount: 0,
  unreadCount: 0,
  hasMore: false,
  loading: false,
};

export interface NotificationFeedClient {
  getState(): FeedState;
  /**
   * Calls `listener` whenever the feed changes, including Notifications
   * arriving live. Returns an unsubscribe function.
   */
  subscribe(listener: (state: FeedState) => void): () => void;
  /** Loads the newest page. */
  load(): Promise<void>;
  /** Loads the next older page, if there is one. */
  loadMore(): Promise<void>;
  markRead(itemId: string): Promise<void>;
  /** Every Notification in the feed, loaded or not. */
  markAllSeen(): Promise<void>;
  /** Every Notification in the feed, loaded or not. */
  markAllRead(): Promise<void>;
  /** Closes the live connection. The client can't be used afterwards. */
  teardown(): void;
}

export type CreateFeedClient = (
  session: FeedSession,
  refreshToken: () => Promise<string | null>
) => NotificationFeedClient;

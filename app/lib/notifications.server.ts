import type {
  FeedSession,
  NotificationPayload,
  NotificationPreferences,
} from "~/lib/notifications";
import { serverEnv } from "~/lib/env.server";
import { knockNotifications } from "~/lib/notifications.knock.server";

// ─── The server Notifications port ───
// Everything Cadence asks of a notification vendor, in Cadence's own words.
// Services take a `Notifications` as a parameter, like `db` and `now`. Three
// adapters implement it:
//
// - Knock (notifications.knock.server.ts), when KNOCK_SECRET_API_KEY is set
// - a no-op that logs, when it isn't (local dev without keys)
// - an in-memory fake that records every call, for tests
//
// Mirrors the mail transport in mailer.server.ts.

/** A Cadence user, as a vendor needs to know them. */
export type NotificationPerson = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

export type Notification = NotificationPayload & {
  recipients: NotificationPerson[];
  /** Who did the thing. Null when Cadence itself is the sender. */
  actor: NotificationPerson | null;
  /** One per domain event, so a retry can never send a duplicate. */
  idempotencyKey: string;
};

export interface Notifications {
  trigger(notification: Notification): Promise<void>;
  /**
   * Archives every Notification a comment caused (the Instructor's Discussion
   * Question Notification, or the author's Discussion Reply Notification), so
   * it leaves the recipient's feed.
   */
  archiveCausedByComment(commentId: number): Promise<void>;
  /** Creates or updates the person's identity: name, email and avatar. */
  identify(person: NotificationPerson): Promise<void>;
  /** The person's stored preferences, or null if they have none yet. */
  getPreferences(userId: number): Promise<NotificationPreferences | null>;
  /** Replaces the person's whole preference set. */
  setPreferences(
    userId: number,
    preferences: NotificationPreferences
  ): Promise<void>;
  /** Signs a token that reads only this user's feed. Null without keys. */
  feedSession(userId: number): Promise<FeedSession | null>;
}

// ─── Best effort ───

/**
 * Runs a call to the Notifications port without letting it fail the domain
 * action around it. Notifications are sent after the write commits; if the
 * vendor is down the action has still happened, so the error is only logged.
 * There are no retries in v1 (the idempotency keys leave room for them).
 */
export async function bestEffort(
  description: string,
  call: () => Promise<void>
): Promise<void> {
  try {
    await call();
  } catch (error) {
    console.error(`[notifications] ${description} failed`, error);
  }
}

// ─── Adapters ───

export function loggingNotifications(): Notifications {
  return {
    async trigger(notification) {
      console.info(
        `[notifications] ${notification.kind} → ${notification.recipients
          .map((r) => r.id)
          .join(", ")} (no KNOCK_SECRET_API_KEY, not sent)`,
        notification.data
      );
    },
    async archiveCausedByComment(commentId) {
      console.info(
        `[notifications] archive Notifications for comment ${commentId} (no keys, skipped)`
      );
    },
    async identify(person) {
      console.info(`[notifications] identify ${person.id} (no keys, skipped)`);
    },
    async getPreferences() {
      return null;
    },
    async setPreferences(userId) {
      console.info(
        `[notifications] set preferences for ${userId} (no keys, skipped)`
      );
    },
    async feedSession() {
      return null;
    },
  };
}

export type FakeNotifications = Notifications & {
  triggered: Notification[];
  archivedForComments: number[];
  identified: Map<number, NotificationPerson>;
  preferences: Map<number, NotificationPreferences>;
  /** Makes every later call throw, like a vendor outage. */
  breakDown(): void;
};

export function fakeNotifications(): FakeNotifications {
  let broken = false;
  const triggered: Notification[] = [];
  const archivedForComments: number[] = [];
  const identified = new Map<number, NotificationPerson>();
  const preferences = new Map<number, NotificationPreferences>();

  function failIfBroken() {
    if (broken) throw new Error("Notification vendor is down");
  }

  return {
    triggered,
    archivedForComments,
    identified,
    preferences,
    breakDown() {
      broken = true;
    },
    async trigger(notification) {
      failIfBroken();
      triggered.push(notification);
    },
    async archiveCausedByComment(commentId) {
      failIfBroken();
      archivedForComments.push(commentId);
    },
    async identify(person) {
      failIfBroken();
      identified.set(person.id, person);
    },
    async getPreferences(userId) {
      failIfBroken();
      return preferences.get(userId) ?? null;
    },
    async setPreferences(userId, set) {
      failIfBroken();
      preferences.set(userId, set);
    },
    async feedSession(userId) {
      failIfBroken();
      return {
        recipientId: String(userId),
        token: `token-for-${userId}`,
        publicKey: "public",
        channelId: "feed",
      };
    },
  };
}

let instance: Notifications | undefined;

/** The adapter for this process: Knock with keys, the logging no-op without. */
export function getNotifications(): Notifications {
  if (!instance) {
    const secretKey = serverEnv("KNOCK_SECRET_API_KEY");
    instance = secretKey
      ? knockNotifications({
          secretKey,
          publicKey: serverEnv("KNOCK_PUBLIC_API_KEY"),
          signingKey: serverEnv("KNOCK_SIGNING_KEY"),
          channelId: serverEnv("KNOCK_FEED_CHANNEL_ID"),
        })
      : loggingNotifications();
  }
  return instance;
}

/**
 * The signed-in user's feed session for the browser, or null without keys.
 * A vendor error turns the feed off for this page rather than failing it.
 */
export async function getFeedSession(
  notifications: Notifications,
  userId: number
): Promise<FeedSession | null> {
  try {
    return await notifications.feedSession(userId);
  } catch (error) {
    console.error("[notifications] signing a feed token failed", error);
    return null;
  }
}

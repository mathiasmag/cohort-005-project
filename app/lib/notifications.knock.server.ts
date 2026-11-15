import Knock, { NotFoundError, signUserToken } from "@knocklabs/node";
import type { PreferenceSet } from "@knocklabs/node/resources/recipients/preferences";
import {
  KNOCK_FEED_CHANNEL_TYPE,
  knockCategoryKey,
  knockWorkflowKey,
} from "~/lib/knock-keys";
import {
  notificationCategories,
  type FeedSession,
  type NotificationPreferences,
} from "~/lib/notifications";
import type {
  NotificationPerson,
  Notifications,
} from "~/lib/notifications.server";

// ─── Knock adapter for the server Notifications port ───
// The only server code that talks to Knock. Cadence user ids are Knock user
// ids. People are identified inline on every trigger, so names and avatars
// (Knock's standard `avatar` property) stay current on older Notifications.

const TOKEN_LIFETIME_SECONDS = 60 * 60;
const PREFERENCE_SET = "default";

type KnockConfig = {
  secretKey: string;
  publicKey: string | undefined;
  signingKey: string | undefined;
  channelId: string | undefined;
};

export function knockUserId(cadenceUserId: number): string {
  return String(cadenceUserId);
}

function toKnockUser(person: NotificationPerson) {
  return {
    id: knockUserId(person.id),
    name: person.name,
    email: person.email,
    avatar: person.avatarUrl,
  };
}

type KnockCategories = NonNullable<PreferenceSet["categories"]>;

// A category set to a plain boolean covers every channel; an object holds a
// per-channel-type switch. A channel type left out of the object is on.
function feedSwitch(setting: KnockCategories[string]): boolean {
  if (typeof setting === "boolean") return setting;
  const feed = setting.channel_types?.[KNOCK_FEED_CHANNEL_TYPE];
  return typeof feed === "boolean" ? feed : true;
}

function fromKnockCategories(
  categories: KnockCategories
): NotificationPreferences | null {
  const preferences: NotificationPreferences = {};
  for (const category of notificationCategories) {
    const setting = categories[knockCategoryKey[category]];
    if (setting !== undefined) {
      preferences[category] = { feed: feedSwitch(setting) };
    }
  }
  return Object.keys(preferences).length > 0 ? preferences : null;
}

function toKnockCategories(
  preferences: NotificationPreferences
): KnockCategories {
  const categories: KnockCategories = {};
  for (const category of notificationCategories) {
    const setting = preferences[category];
    if (setting) {
      categories[knockCategoryKey[category]] = {
        channel_types: { [KNOCK_FEED_CHANNEL_TYPE]: setting.feed },
      };
    }
  }
  return categories;
}

export function knockNotifications(config: KnockConfig): Notifications {
  const knock = new Knock({ apiKey: config.secretKey });

  return {
    async trigger(notification) {
      await knock.workflows.trigger(
        knockWorkflowKey[notification.kind],
        {
          recipients: notification.recipients.map(toKnockUser),
          actor: notification.actor ? toKnockUser(notification.actor) : null,
          data: notification.data,
        },
        { idempotencyKey: notification.idempotencyKey }
      );
    },

    async identify(person) {
      const { id, ...properties } = toKnockUser(person);
      await knock.users.update(id, properties);
    },

    async getPreferences(userId) {
      try {
        const set = await knock.users.getPreferences(
          knockUserId(userId),
          PREFERENCE_SET
        );
        return fromKnockCategories(set.categories ?? {});
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },

    // Knock's set call replaces the whole set; callers pass a merged one.
    async setPreferences(userId, preferences) {
      await knock.users.setPreferences(knockUserId(userId), PREFERENCE_SET, {
        categories: toKnockCategories(preferences),
      });
    },

    async feedSession(userId): Promise<FeedSession | null> {
      const { publicKey, signingKey, channelId } = config;
      if (!publicKey || !signingKey || !channelId) {
        console.warn(
          "[notifications] KNOCK_PUBLIC_API_KEY, KNOCK_SIGNING_KEY or KNOCK_FEED_CHANNEL_ID is missing, so the Notification Feed is off"
        );
        return null;
      }

      return {
        recipientId: knockUserId(userId),
        token: await signUserToken(knockUserId(userId), {
          signingKey,
          expiresInSeconds: TOKEN_LIFETIME_SECONDS,
        }),
        publicKey,
        channelId,
      };
    },
  };
}

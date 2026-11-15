import Knock, { signUserToken } from "@knocklabs/node";
import { knockWorkflowKey } from "~/lib/knock-keys";
import type { FeedSession } from "~/lib/notifications";
import type {
  NotificationPerson,
  Notifications,
} from "~/lib/notifications.server";

// ─── Knock adapter for the server Notifications port ───
// The only server code that talks to Knock. Cadence user ids are Knock user
// ids. People are identified inline on every trigger, so names and avatars
// (Knock's standard `avatar` property) stay current on older Notifications.

const TOKEN_LIFETIME_SECONDS = 60 * 60;

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

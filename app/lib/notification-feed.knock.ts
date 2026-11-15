import Knock, {
  type FeedItem as KnockFeedItem,
  type FeedStoreState,
} from "@knocklabs/client";
import { kindOfKnockWorkflow } from "~/lib/knock-keys";
import { notificationPayloadSchema } from "~/lib/notifications";
import type {
  CreateFeedClient,
  FeedActor,
  FeedItem,
  FeedState,
} from "~/lib/notification-feed";

// ─── Knock adapter for the client feed port ───
// The only browser code that talks to Knock. Reads one person's feed with the
// public key and a token signed for them, and keeps one real-time socket open
// for live updates. Knock rate-limits rapid feed reads, so nothing here polls.

const PAGE_SIZE = 20;

function toActor(item: KnockFeedItem): FeedActor | null {
  const actor = item.actors[0];
  if (!actor || !("name" in actor) || typeof actor.name !== "string") {
    return null;
  }
  const avatar = "avatar" in actor ? actor.avatar : null;
  return {
    name: actor.name,
    avatarUrl: typeof avatar === "string" ? avatar : null,
  };
}

// Only Notifications Cadence knows how to draw make it into the feed. Anything
// else (an unknown workflow, data in an old shape) is left out, not drawn wrong.
function toFeedItem(item: KnockFeedItem): FeedItem | null {
  const kind = kindOfKnockWorkflow(item.source.key);
  if (!kind) return null;

  const parsed = notificationPayloadSchema.safeParse({ kind, data: item.data });
  if (!parsed.success) return null;

  return {
    ...parsed.data,
    id: item.id,
    actor: toActor(item),
    insertedAt: item.inserted_at,
    seenAt: item.seen_at,
    readAt: item.read_at,
  };
}

function toFeedState(state: FeedStoreState): FeedState {
  return {
    items: state.items
      .map(toFeedItem)
      .filter((item): item is FeedItem => item !== null),
    unseenCount: state.metadata.unseen_count,
    unreadCount: state.metadata.unread_count,
    hasMore: state.pageInfo.after !== null,
    loading: state.loading,
  };
}

export const createKnockFeedClient: CreateFeedClient = (
  session,
  refreshToken
) => {
  const knock = new Knock(session.publicKey);
  knock.authenticate({ id: session.recipientId }, session.token, {
    // Cadence syncs users from the server; the browser never identifies.
    identificationStrategy: "skip",
    onUserTokenExpiring: async () => (await refreshToken()) ?? undefined,
  });

  const feed = knock.feeds.initialize(session.channelId, {
    page_size: PAGE_SIZE,
    archived: "exclude",
  });
  feed.listenForUpdates();

  let current = toFeedState(feed.store.getState());

  return {
    getState: () => current,

    subscribe(listener) {
      return feed.store.subscribe((state) => {
        current = toFeedState(state);
        listener(current);
      });
    },

    async load() {
      await feed.fetch();
    },

    async loadMore() {
      const state = feed.store.getState();
      if (state.loading || state.pageInfo.after === null) return;
      await feed.fetchNextPage();
    },

    async markRead(itemId) {
      const item = feed.store
        .getState()
        .items.find((candidate) => candidate.id === itemId);
      if (!item || item.read_at) return;
      await feed.markAsRead(item);
    },

    // Bulk by channel, so Notifications that haven't loaded are covered too.
    // Skipped when there's nothing to mark: Knock answers 422 to an empty set.
    async markAllSeen() {
      if (feed.store.getState().metadata.unseen_count === 0) return;
      await feed.markAllAsSeen();
    },

    async markAllRead() {
      if (feed.store.getState().metadata.unread_count === 0) return;
      await feed.markAllAsRead();
    },

    teardown() {
      feed.dispose();
      knock.teardown();
    },
  };
};

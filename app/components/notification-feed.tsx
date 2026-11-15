import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link, useNavigate } from "react-router";
import {
  Bell,
  Check,
  GraduationCap,
  MessageSquare,
  Receipt,
  Settings,
  UsersRound,
} from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import type { FeedSession } from "~/lib/notifications";
import {
  EMPTY_FEED,
  type FeedItem,
  type FeedState,
  type NotificationFeedClient,
} from "~/lib/notification-feed";
import { describeNotification, type RowIcon } from "~/lib/notification-rows";
import { cn, formatRelativeTime } from "~/lib/utils";

// ─── The Notification Feed ───
// A bell in the sidebar header with an unseen badge, opening a popover beside
// the sidebar. The feed talks to the vendor only through the client feed port;
// the Knock adapter is loaded in the browser, never during server rendering.

type FeedContextValue = {
  client: NotificationFeedClient | null;
};

const FeedContext = createContext<FeedContextValue | null>(null);

async function fetchFreshToken(): Promise<string | null> {
  const response = await fetch("/api/notification-feed-token");
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof body.token === "string"
    ? body.token
    : null;
}

/**
 * Holds one live feed connection per signed-in person. When the DevUI
 * switches user, the session's recipient changes: the old connection is torn
 * down and a new one opened with the new token.
 */
export function NotificationFeedProvider({
  session,
  signedIn,
  children,
}: {
  /** Null without vendor keys: the bell shows an empty feed. */
  session: FeedSession | null;
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const [client, setClient] = useState<NotificationFeedClient | null>(null);

  // A token refreshed by a later page load is used for the existing
  // connection; only a different person reconnects.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const recipientId = session?.recipientId ?? null;

  useEffect(() => {
    const current = sessionRef.current;
    if (!current || recipientId === null) return;

    let cancelled = false;
    let opened: NotificationFeedClient | null = null;

    import("~/lib/notification-feed.knock").then(
      ({ createKnockFeedClient }) => {
        if (cancelled) return;
        opened = createKnockFeedClient(current, fetchFreshToken);
        setClient(opened);
        opened.load().catch((error: unknown) => {
          console.error("[notifications] loading the feed failed", error);
        });
      }
    );

    return () => {
      cancelled = true;
      opened?.teardown();
      setClient(null);
    };
  }, [recipientId]);

  return (
    <FeedContext.Provider value={signedIn ? { client } : null}>
      {children}
    </FeedContext.Provider>
  );
}

const noopSubscribe = () => () => {};
const emptyFeed = () => EMPTY_FEED;

function useFeedState(client: NotificationFeedClient | null): FeedState {
  const subscribe = useCallback(
    (listener: () => void) =>
      client ? client.subscribe(listener) : noopSubscribe(),
    [client]
  );
  const getSnapshot = useCallback(
    () => (client ? client.getState() : EMPTY_FEED),
    [client]
  );
  return useSyncExternalStore(subscribe, getSnapshot, emptyFeed);
}

// A failed feed call is logged, never thrown: the feed is a side panel and
// mustn't break the page around it.
function logFailure(description: string) {
  return (error: unknown) => {
    console.error(`[notifications] ${description} failed`, error);
  };
}

export function NotificationBell() {
  const context = useContext(FeedContext);
  const client = context?.client ?? null;
  const feed = useFeedState(client);
  const [open, setOpen] = useState(false);

  if (!context) return null;

  const badge = feed.unseenCount > 9 ? "9+" : String(feed.unseenCount);

  // Opening marks everything seen (not read), loaded or not, so the badge
  // clears but the rows stay unread.
  function toggle() {
    const opening = !open;
    setOpen(opening);
    if (opening) client?.markAllSeen().catch(logFailure("mark all seen"));
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={
          feed.unseenCount > 0
            ? `Notifications, ${feed.unseenCount} unseen`
            : "Notifications"
        }
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {feed.unseenCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <NotificationPopover
            feed={feed}
            client={client}
            close={() => setOpen(false)}
          />
        </>
      )}
    </>
  );
}

const rowIcons: Record<RowIcon, React.ReactNode> = {
  discussion: <MessageSquare />,
  refund: <Receipt />,
  team: <UsersRound />,
  enrollment: <GraduationCap />,
};

function NotificationAvatar({ item, icon }: { item: FeedItem; icon: RowIcon }) {
  const read = item.readAt !== null;
  return (
    <span className="relative shrink-0">
      {item.actor ? (
        <UserAvatar
          name={item.actor.name}
          avatarUrl={item.actor.avatarUrl}
          className={cn("size-9", read && "opacity-60")}
        />
      ) : (
        // Sent by Cadence itself, e.g. a Refund Request confirmation.
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground",
            read && "opacity-60"
          )}
        >
          C
        </span>
      )}
      <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-popover text-muted-foreground ring-1 ring-border [&_svg]:size-2.5">
        {rowIcons[icon]}
      </span>
    </span>
  );
}

function NotificationPopover({
  feed,
  client,
  close,
}: {
  feed: FeedState;
  client: NotificationFeedClient | null;
  close: () => void;
}) {
  const navigate = useNavigate();
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMore = useCallback(() => {
    client?.loadMore().catch(logFailure("loading older Notifications"));
  }, [client]);

  // Infinite scroll: reaching the bottom loads the next older page.
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !feed.hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [feed.hasMore, loadMore]);

  function markRead(item: FeedItem) {
    if (item.readAt) return;
    client?.markRead(item.id).catch(logFailure("mark read"));
  }

  // Clicking marks the row read and goes to the most specific place there
  // is. With nowhere to go, the popover stays open.
  function openRow(item: FeedItem, url: string | null) {
    markRead(item);
    if (url === null) return;
    close();
    navigate(url);
  }

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="fixed top-2 left-56 z-50 ml-2 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="flex items-center gap-2 bg-muted/60 px-4 py-3">
        <Bell className="size-4" />
        <span className="font-semibold">Notifications</span>
        <button
          type="button"
          onClick={() =>
            client?.markAllRead().catch(logFailure("mark all read"))
          }
          disabled={feed.unreadCount === 0}
          className="ml-auto text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:hover:no-underline"
        >
          Mark all as read
        </button>
        <Link
          to="/settings#notifications"
          onClick={close}
          title="Notification settings"
          aria-label="Notification settings"
          className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        {feed.items.length === 0 && !feed.loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            You're all caught up.
          </p>
        ) : (
          feed.items.map((item) => {
            const row = describeNotification(item);
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent"
              >
                <NotificationAvatar item={item} icon={row.icon} />
                <button
                  type="button"
                  onClick={() => openRow(item, row.url)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className={cn(
                      "block truncate text-sm",
                      !item.readAt && "font-semibold"
                    )}
                  >
                    {row.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.snippet} · {formatRelativeTime(item.insertedAt)}
                  </span>
                </button>
                {!item.readAt && (
                  <button
                    type="button"
                    onClick={() => markRead(item)}
                    title="Mark as read"
                    aria-label="Mark as read"
                    className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-background hover:text-primary"
                  >
                    <Check className="size-4" />
                  </button>
                )}
              </div>
            );
          })
        )}
        <div
          ref={sentinel}
          className="p-3 text-center text-xs text-muted-foreground"
        >
          {feed.loading && "Loading…"}
        </div>
      </div>
    </div>
  );
}

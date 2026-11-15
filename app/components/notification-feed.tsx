import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Bell } from "lucide-react";
import type { FeedSession } from "~/lib/notifications";
import {
  EMPTY_FEED,
  type FeedState,
  type NotificationFeedClient,
} from "~/lib/notification-feed";
import { describeNotification } from "~/lib/notification-rows";
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

export function NotificationBell() {
  const context = useContext(FeedContext);
  const client = context?.client ?? null;
  const feed = useFeedState(client);
  const [open, setOpen] = useState(false);

  if (!context) return null;

  const badge = feed.unseenCount > 9 ? "9+" : String(feed.unseenCount);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
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
          <NotificationPopover feed={feed} />
        </>
      )}
    </>
  );
}

function NotificationPopover({ feed }: { feed: FeedState }) {
  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="fixed top-2 left-56 z-50 ml-2 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="flex items-center gap-2 bg-muted/60 px-4 py-3">
        <Bell className="size-4" />
        <span className="font-semibold">Notifications</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {feed.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            You're all caught up.
          </p>
        ) : (
          feed.items.map((item) => {
            const row = describeNotification(item);
            return (
              <div key={item.id} className="px-4 py-2.5 hover:bg-accent">
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
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

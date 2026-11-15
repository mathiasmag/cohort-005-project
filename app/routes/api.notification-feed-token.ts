import type { Route } from "./+types/api.notification-feed-token";
import { requireUserId } from "~/lib/access.server";
import { getFeedSession, getNotifications } from "~/lib/notifications.server";

// A fresh feed token for the signed-in user, fetched by the Notification Feed
// shortly before its current token expires.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const session = await getFeedSession(getNotifications(), userId);
  return Response.json({ token: session?.token ?? null });
}

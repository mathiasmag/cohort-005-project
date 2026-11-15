import { asc, eq } from "drizzle-orm";
import { UserRole, users } from "~/db/schema";
import { DEFAULT_PREFERENCES } from "~/lib/notifications";
import {
  bestEffort,
  type NotificationPerson,
  type Notifications,
} from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";

// ─── Users ───
// Signing up, editing a profile, and keeping each user in sync with the
// notification vendor. Syncing is best effort: it never fails the action.

type User = typeof users.$inferSelect;

/** A user as the Notifications port knows them. */
export function getPerson(
  db: Db,
  userId: number
): NotificationPerson | undefined {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/** Everyone with the Platform Admin role right now, oldest account first. */
export function getPlatformAdmins(db: Db): NotificationPerson[] {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .orderBy(asc(users.id))
    .all();
}

/**
 * Sends the user's name, email and avatar to the vendor, and writes the
 * default preference set if they have none yet. Role is never synced: who
 * gets a Notification is worked out by Cadence when it fires.
 */
export async function syncUser(
  db: Db,
  notifications: Notifications,
  userId: number
): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return;

  await bestEffort(`syncing user ${userId}`, async () => {
    await notifications.identify({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    });

    const existing = await notifications.getPreferences(user.id);
    if (existing === null) {
      await notifications.setPreferences(user.id, DEFAULT_PREFERENCES);
    }
  });
}

/**
 * Signs someone up as a Student. An email that's already signed up gets
 * that user back instead of a second account.
 */
export async function signUp(
  db: Db,
  notifications: Notifications,
  name: string,
  email: string,
  now: Date
): Promise<User> {
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return existing;

  const user = db
    .insert(users)
    .values({
      name,
      email,
      role: UserRole.Student,
      avatarUrl: null,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();

  await syncUser(db, notifications, user.id);
  return user;
}

/** Someone editing their own name and bio on /settings. */
export async function updateProfile(
  db: Db,
  notifications: Notifications,
  userId: number,
  name: string,
  bio: string | null
): Promise<void> {
  db.update(users).set({ name, bio }).where(eq(users.id, userId)).run();
  await syncUser(db, notifications, userId);
}

/**
 * Syncs every user, one at a time (the vendor rate-limits bursts). Used by
 * seeding and the one-off backfill. Returns how many users were synced.
 */
export async function syncAllUsers(
  db: Db,
  notifications: Notifications
): Promise<number> {
  const ids = db.select({ id: users.id }).from(users).all();
  for (const { id } of ids) {
    await syncUser(db, notifications, id);
  }
  return ids.length;
}

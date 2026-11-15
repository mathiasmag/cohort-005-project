import { eq } from "drizzle-orm";
import { coupons, courses, purchases, users, UserRole } from "~/db/schema";
import {
  DEFAULT_PREFERENCES,
  notificationCategories,
  type NotificationCategory,
  type NotificationPreferences,
} from "~/lib/notifications";
import type { Notifications } from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";

// ─── Notification preferences ───
// The switches on /settings. Someone sees only the categories that can
// concern them, judged by what they are or have; a switch they don't see
// keeps its default.

export type NotificationSwitch = {
  category: NotificationCategory;
  on: boolean;
};

function hasPurchase(db: Db, userId: number): boolean {
  return !!db
    .select({ id: purchases.id })
    .from(purchases)
    .where(eq(purchases.userId, userId))
    .get();
}

/** A Team Admin on at least one Team Licence: a Purchase that granted Seats. */
function hasTeamLicence(db: Db, userId: number): boolean {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .where(eq(purchases.userId, userId))
    .get();
}

/** An Instructor is someone who owns a course. */
function ownsCourse(db: Db, userId: number): boolean {
  return !!db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.instructorId, userId))
    .get();
}

function isPlatformAdmin(db: Db, userId: number): boolean {
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user?.role === UserRole.Admin;
}

function visibleCategories(db: Db, userId: number): NotificationCategory[] {
  const visible: Record<NotificationCategory, boolean> = {
    "refund-request-updates": hasPurchase(db, userId),
    "open-refund-requests": isPlatformAdmin(db, userId),
    "seat-claims": hasTeamLicence(db, userId),
    enrollments: ownsCourse(db, userId),
    "discussion-questions": ownsCourse(db, userId),
    "discussion-replies": true,
  };
  return notificationCategories.filter((category) => visible[category]);
}

function feedSwitch(
  stored: NotificationPreferences | null,
  category: NotificationCategory
): boolean {
  return (stored?.[category] ?? DEFAULT_PREFERENCES[category]).feed;
}

/** The switches this person sees, with their current values. */
export async function getNotificationSwitches(
  db: Db,
  notifications: Notifications,
  userId: number
): Promise<NotificationSwitch[]> {
  const stored = await notifications.getPreferences(userId);
  return visibleCategories(db, userId).map((category) => ({
    category,
    on: feedSwitch(stored, category),
  }));
}

/**
 * Turns one category on or off and leaves the rest as they are. The vendor
 * replaces the whole set on write, so the change is merged into what's stored,
 * over the defaults: a category missing from the stored set would otherwise
 * count as on, which is wrong for Enrollments. Unlike sending a Notification, a failure
 * here is thrown: the person flipped the switch and must hear it didn't save.
 */
export async function changePreference(
  db: Db,
  notifications: Notifications,
  userId: number,
  category: NotificationCategory,
  on: boolean
): Promise<void> {
  if (!visibleCategories(db, userId).includes(category)) {
    throw new Error("That Notification setting isn't available to you.");
  }

  const stored = await notifications.getPreferences(userId);
  await notifications.setPreferences(userId, {
    ...DEFAULT_PREFERENCES,
    ...stored,
    [category]: { feed: on },
  });
}

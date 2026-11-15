import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  coupons,
  purchases,
  teamMembers,
  teams,
  TeamMemberRole,
} from "~/db/schema";
import { enroll } from "~/lib/enrollments.server";
import type { Notifications } from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";

// ─── Purchases ───
// An Individual Purchase gives the buyer an Enrollment. A Team Licence gives
// its buyer Seats instead, and no Enrollment: buying one alone doesn't make
// anyone a Student on the course. See GLOSSARY.md and docs/adr/0004.

function createPurchase(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  now: Date
) {
  return db
    .insert(purchases)
    .values({
      userId: buyerId,
      courseId,
      amountPaid,
      country,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();
}

/** An Individual Purchase: pays for the course and enrols the buyer. */
export async function buyForSelf(
  db: Db,
  notifications: Notifications,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  now: Date
) {
  const purchase = createPurchase(
    db,
    buyerId,
    courseId,
    amountPaid,
    country,
    now
  );
  const enrollment = await enroll(db, notifications, buyerId, courseId, now);
  return { purchase, enrollment };
}

function getOrCreateTeamForAdmin(db: Db, userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  const existing = membership
    ? db.select().from(teams).where(eq(teams.id, membership.teamId)).get()
    : undefined;
  if (existing) return existing;

  const team = db.insert(teams).values({}).returning().get();
  db.insert(teamMembers)
    .values({ teamId: team.id, userId, role: TeamMemberRole.Admin })
    .run();
  return team;
}

/** A Team Licence: pays for `quantity` Seats, which others claim. */
export function buyTeamLicence(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  quantity: number,
  now: Date
) {
  const purchase = createPurchase(
    db,
    buyerId,
    courseId,
    amountPaid,
    country,
    now
  );
  const team = getOrCreateTeamForAdmin(db, buyerId);
  const seats = Array.from({ length: quantity }, () =>
    db
      .insert(coupons)
      .values({
        teamId: team.id,
        courseId,
        code: crypto.randomBytes(12).toString("base64url"),
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, team, seats };
}

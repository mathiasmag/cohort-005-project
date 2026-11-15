import { and, eq, isNull } from "drizzle-orm";
import { coupons, courses, enrollments, purchases } from "~/db/schema";
import { bestEffort, type Notifications } from "~/lib/notifications.server";
import { getSeatAvailability, type Db } from "~/lib/refunds.server";
import { getPerson } from "~/lib/users.server";

// ─── Enrollments and Seat claims ───
// Giving a Student an Enrollment, and a Student claiming a Seat on a Team
// Licence. Every function takes the database first and `now` last.
// See GLOSSARY.md and docs/adr/0002–0004.

type Enrollment = typeof enrollments.$inferSelect;

export function findEnrollment(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/**
 * Gives a Student an Enrollment on a course. A Student has at most one
 * Enrollment per course; a Lapsed Student, whose Enrollment has ended, can be
 * enrolled again.
 */
export function enroll(
  db: Db,
  studentId: number,
  courseId: number,
  now: Date
): Enrollment {
  if (findEnrollment(db, studentId, courseId)) {
    throw new Error("User is already enrolled in this course");
  }

  const course = db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) {
    throw new Error("Course not found");
  }

  return db
    .insert(enrollments)
    .values({ userId: studentId, courseId, enrolledAt: now.toISOString() })
    .returning()
    .get();
}

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export type ClaimResult =
  | { ok: true; enrollment: Enrollment }
  | { ok: false; error: string };

/**
 * A Student claims a Seat by its code, which enrols them on the course. A
 * Seat can't be claimed while its Team Licence has an Open Refund Request, nor
 * after that request is approved (docs/adr/0003), nor from another country
 * than the buyer's.
 *
 * A successful claim tells the Team Admin who owns the Team Licence, with how
 * many Seats are left.
 */
export async function claimSeat(
  db: Db,
  notifications: Notifications,
  code: string,
  studentId: number,
  studentCountry: string,
  now: Date
): Promise<ClaimResult> {
  const seat = db.select().from(coupons).where(eq(coupons.code, code)).get();
  if (!seat) {
    return { ok: false, error: "Coupon not found" };
  }

  if (seat.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  const availability = getSeatAvailability(db, seat);
  if (availability === "on_hold") {
    return { ok: false, error: SEAT_ON_HOLD };
  }
  if (availability === "refunded") {
    return { ok: false, error: SEAT_REFUNDED };
  }

  if (findEnrollment(db, studentId, seat.courseId)) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, seat.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== studentCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  db.update(coupons)
    .set({ redeemedByUserId: studentId, redeemedAt: now.toISOString() })
    .where(eq(coupons.id, seat.id))
    .run();

  const enrollment = enroll(db, studentId, seat.courseId, now);

  if (purchase) {
    await bestEffort(`seat-claimed for seat ${seat.id}`, () =>
      notifyTeamAdmin(db, notifications, seat.id, purchase, studentId)
    );
  }

  return { ok: true, enrollment };
}

/** Seats on a Team Licence nobody has claimed and that weren't refunded. */
function countSeatsLeft(db: Db, purchaseId: number): number {
  return db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.purchaseId, purchaseId),
        isNull(coupons.redeemedAt),
        isNull(coupons.refundedAt)
      )
    )
    .all().length;
}

async function notifyTeamAdmin(
  db: Db,
  notifications: Notifications,
  seatId: number,
  teamLicence: typeof purchases.$inferSelect,
  studentId: number
) {
  const teamAdmin = getPerson(db, teamLicence.userId);
  const student = getPerson(db, studentId);
  const course = db
    .select({ title: courses.title, slug: courses.slug })
    .from(courses)
    .where(eq(courses.id, teamLicence.courseId))
    .get();
  if (!teamAdmin || !student || !course) return;

  await notifications.trigger({
    kind: "seat-claimed",
    recipients: [teamAdmin],
    actor: student,
    data: {
      seatId,
      purchaseId: teamLicence.id,
      courseTitle: course.title,
      courseSlug: course.slug,
      seatsLeft: countSeatsLeft(db, teamLicence.id),
      url: "/team",
    },
    idempotencyKey: `seat-claimed:${seatId}`,
  });
}

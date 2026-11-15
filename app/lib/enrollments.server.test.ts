import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { RefundStatus, UserRole } from "~/db/schema";
import { claimSeat, enroll } from "./enrollments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

function enrollmentsOf(userId: number) {
  return db
    .select()
    .from(schema.enrollments)
    .where(
      and(
        eq(schema.enrollments.userId, userId),
        eq(schema.enrollments.courseId, base.course.id)
      )
    )
    .all();
}

function buyTeamLicence(buyerId: number, seats: number, country: string | null = null) {
  const team = db.insert(schema.teams).values({}).returning().get();
  db.insert(schema.teamMembers)
    .values({ teamId: team.id, userId: buyerId, role: schema.TeamMemberRole.Admin })
    .run();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: buyerId,
      courseId: base.course.id,
      amountPaid: 7900 * seats,
      country,
    })
    .returning()
    .get();
  const seatRows = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

describe("enrolling a Student", () => {
  it("gives the Student an Enrollment on the course", () => {
    const enrollment = enroll(db, base.user.id, base.course.id, NOW);

    expect(enrollment).toMatchObject({
      userId: base.user.id,
      courseId: base.course.id,
      enrolledAt: NOW.toISOString(),
    });
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });

  it("refuses a second Enrollment on the same course", () => {
    enroll(db, base.user.id, base.course.id, NOW);

    expect(() => enroll(db, base.user.id, base.course.id, NOW)).toThrow(
      "User is already enrolled in this course"
    );
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });

  it("lets a Lapsed Student enrol again", () => {
    enroll(db, base.user.id, base.course.id, NOW);
    db.delete(schema.enrollments).run();

    enroll(db, base.user.id, base.course.id, NOW);

    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
  });
});

describe("claiming a Seat", () => {
  it("claims the Seat and enrols the Student", () => {
    const priya = addStudent("Priya");
    const { seats } = buyTeamLicence(priya.id, 2);

    const result = claimSeat(db, seats[0].code, base.user.id, "", NOW);

    expect(result).toMatchObject({ ok: true });
    expect(enrollmentsOf(base.user.id)).toHaveLength(1);
    const seat = db
      .select()
      .from(schema.coupons)
      .where(eq(schema.coupons.id, seats[0].id))
      .get();
    expect(seat).toMatchObject({
      redeemedByUserId: base.user.id,
      redeemedAt: NOW.toISOString(),
    });
  });

  it("refuses a Seat on hold during an Open Refund Request", () => {
    const priya = addStudent("Priya");
    const { purchase, seats } = buyTeamLicence(priya.id, 2);
    db.insert(schema.refunds)
      .values({ purchaseId: purchase.id, status: RefundStatus.Open, reason: "No" })
      .run();

    const result = claimSeat(db, seats[0].code, base.user.id, "", NOW);

    expect(result).toMatchObject({ ok: false });
    expect(enrollmentsOf(base.user.id)).toHaveLength(0);
  });

  it("refuses a Seat that has already been claimed", () => {
    const priya = addStudent("Priya");
    const sam = addStudent("Sam");
    const { seats } = buyTeamLicence(priya.id, 1);
    claimSeat(db, seats[0].code, sam.id, "", NOW);

    expect(claimSeat(db, seats[0].code, base.user.id, "", NOW)).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
  });

  it("refuses a claim from another country than the buyer's", () => {
    const priya = addStudent("Priya");
    const { seats } = buyTeamLicence(priya.id, 1, "IN");

    expect(claimSeat(db, seats[0].code, base.user.id, "US", NOW)).toMatchObject({
      ok: false,
    });
  });
});

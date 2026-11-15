import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  changePreference,
  getNotificationSwitches,
} from "./notification-preferences.server";
import {
  fakeNotifications,
  type FakeNotifications,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotifications();
});

function addUser(name: string, role: UserRole) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}@example.com`, role })
    .returning()
    .get();
}

function buy(userId: number, seats = 0) {
  const purchase = db
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 4900 })
    .returning()
    .get();
  if (seats === 0) return;
  const team = db.insert(schema.teams).values({}).returning().get();
  for (let i = 0; i < seats; i++) {
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .run();
  }
}

async function visible(userId: number) {
  return (await getNotificationSwitches(db, notifications, userId)).map(
    (s) => s.category
  );
}

describe("which Notification switches someone sees", () => {
  it("shows a newcomer only Discussion Replies", async () => {
    expect(await visible(base.user.id)).toEqual(["discussion-replies"]);
  });

  it("adds Refund Request updates once they have a Purchase", async () => {
    buy(base.user.id);

    expect(await visible(base.user.id)).toEqual([
      "refund-request-updates",
      "discussion-replies",
    ]);
  });

  it("adds Seat claims for a Team Admin with a Team Licence", async () => {
    buy(base.user.id, 2);

    expect(await visible(base.user.id)).toEqual([
      "refund-request-updates",
      "seat-claims",
      "discussion-replies",
    ]);
  });

  it("adds Enrollments and Discussion Questions for an Instructor with a course", async () => {
    expect(await visible(base.instructor.id)).toEqual([
      "enrollments",
      "discussion-questions",
      "discussion-replies",
    ]);
  });

  it("goes by courses owned, not the Instructor role", async () => {
    const newInstructor = addUser("Nia", UserRole.Instructor);

    expect(await visible(newInstructor.id)).toEqual(["discussion-replies"]);
  });

  it("adds Open Refund Requests for a Platform Admin", async () => {
    const admin = addUser("Pat", UserRole.Admin);

    expect(await visible(admin.id)).toEqual([
      "open-refund-requests",
      "discussion-replies",
    ]);
  });

  it("shows the defaults when nothing is stored yet", async () => {
    const switches = await getNotificationSwitches(db, notifications, base.instructor.id);

    expect(switches).toMatchObject([
      { category: "enrollments", on: false },
      { category: "discussion-questions", on: true },
      { category: "discussion-replies", on: true },
    ]);
  });

  it("shows what is stored", async () => {
    notifications.preferences.set(base.instructor.id, {
      enrollments: { feed: true },
      "discussion-replies": { feed: false },
    });

    const switches = await getNotificationSwitches(db, notifications, base.instructor.id);

    expect(switches).toMatchObject([
      { category: "enrollments", on: true },
      { category: "discussion-questions", on: true },
      { category: "discussion-replies", on: false },
    ]);
  });
});

describe("changing a preference", () => {
  it("merges one category into the stored set and keeps the others", async () => {
    notifications.preferences.set(base.instructor.id, {
      enrollments: { feed: false },
      "discussion-questions": { feed: false },
      "discussion-replies": { feed: true },
    });

    await changePreference(db, notifications, base.instructor.id, "enrollments", true);

    expect(notifications.preferences.get(base.instructor.id)).toMatchObject({
      enrollments: { feed: true },
      "discussion-questions": { feed: false },
      "discussion-replies": { feed: true },
    });
  });

  it("starts from the defaults when nothing is stored yet", async () => {
    await changePreference(db, notifications, base.user.id, "discussion-replies", false);

    expect(notifications.preferences.get(base.user.id)).toMatchObject({
      enrollments: { feed: false },
      "seat-claims": { feed: true },
      "discussion-replies": { feed: false },
    });
  });

  it("refuses a switch the person can't see", async () => {
    await expect(
      changePreference(db, notifications, base.user.id, "open-refund-requests", false)
    ).rejects.toThrow();
    expect(notifications.preferences.get(base.user.id)).toBeUndefined();
  });

  it("fails when the vendor is down, so the switch can be put back", async () => {
    notifications.breakDown();

    await expect(
      changePreference(db, notifications, base.user.id, "discussion-replies", false)
    ).rejects.toThrow();
  });
});

describe("changing a preference on a partial set", () => {
  it("fills a missing category with its default rather than leaving it on", async () => {
    notifications.preferences.set(base.instructor.id, {
      "discussion-replies": { feed: true },
    });

    await changePreference(db, notifications, base.instructor.id, "discussion-questions", false);

    expect(notifications.preferences.get(base.instructor.id)).toMatchObject({
      enrollments: { feed: false },
      "discussion-questions": { feed: false },
      "discussion-replies": { feed: true },
    });
  });
});

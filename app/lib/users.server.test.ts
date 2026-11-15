import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { signUp, syncUser, updateProfile } from "./users.server";
import {
  fakeNotifications,
  type FakeNotifications,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

const DEFAULTS = {
  "refund-request-updates": { feed: true },
  "open-refund-requests": { feed: true },
  "seat-claims": { feed: true },
  enrollments: { feed: false },
  "discussion-questions": { feed: true },
  "discussion-replies": { feed: true },
};

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotifications();
});

function userNamed(email: string) {
  return db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
}

describe("signing up", () => {
  it("creates a Student and syncs them with the default preferences", async () => {
    const user = await signUp(db, notifications, "Liam Park", "liam@example.com", NOW);

    expect(user).toMatchObject({ name: "Liam Park", role: "student" });
    expect(notifications.identified.get(user.id)).toEqual({
      id: user.id,
      name: "Liam Park",
      email: "liam@example.com",
      avatarUrl: null,
    });
    expect(notifications.preferences.get(user.id)).toEqual(DEFAULTS);
  });

  it("returns the existing user for an email that's already signed up", async () => {
    const user = await signUp(db, notifications, "Someone", "test@example.com", NOW);

    expect(user.id).toBe(base.user.id);
  });

  it("still signs up when the vendor is down", async () => {
    notifications.breakDown();

    await signUp(db, notifications, "Liam Park", "liam@example.com", NOW);

    expect(userNamed("liam@example.com")).toMatchObject({ name: "Liam Park" });
  });
});

describe("syncing a user", () => {
  it("leaves preferences the person already has untouched", async () => {
    notifications.preferences.set(base.user.id, {
      enrollments: { feed: true },
      "discussion-replies": { feed: false },
    });

    await syncUser(db, notifications, base.user.id);

    expect(notifications.preferences.get(base.user.id)).toEqual({
      enrollments: { feed: true },
      "discussion-replies": { feed: false },
    });
    expect(notifications.identified.get(base.user.id)).toMatchObject({
      name: "Test User",
    });
  });
});

describe("updating a profile", () => {
  it("saves the new name and syncs it", async () => {
    await updateProfile(db, notifications, base.user.id, "Tess User", "Hi");

    expect(userNamed("test@example.com")).toMatchObject({
      name: "Tess User",
      bio: "Hi",
    });
    expect(notifications.identified.get(base.user.id)).toMatchObject({
      name: "Tess User",
    });
  });

  it("still saves when the vendor is down", async () => {
    notifications.breakDown();

    await updateProfile(db, notifications, base.user.id, "Tess User", null);

    expect(userNamed("test@example.com")?.name).toBe("Tess User");
  });
});

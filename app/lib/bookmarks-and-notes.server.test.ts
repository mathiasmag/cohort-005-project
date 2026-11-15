import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  isBookmarked,
  listBookmarks,
  toggleBookmark,
} from "./bookmarks.server";
import { findNote, listNotes, saveNote } from "./notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 7, 9, 30, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonIds = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
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

describe("bookmarking a Lesson", () => {
  it("adds a Bookmark, and removes it when toggled again", () => {
    expect(toggleBookmark(db, base.user.id, lessonIds[0], NOW)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonIds[0], LATER)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(false);
  });

  it("never leaves two Bookmarks on the same Lesson", () => {
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonIds[0] })
        .run()
    ).toThrow();

    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates the Note on a Lesson with none", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "  Revisit the loader part.  ",
      NOW
    );

    expect(result.ok).toBe(true);
    expect(findNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Revisit the loader part.",
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on", () => {
    saveNote(db, base.user.id, lessonIds[0], "First thought", NOW);

    saveNote(db, base.user.id, lessonIds[0], "Second thought", LATER);

    expect(findNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Second thought",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    expect(
      saveNote(db, base.user.id, lessonIds[0], "a".repeat(2000), NOW).ok
    ).toBe(true);
  });

  it("refuses a Note over 2,000 characters with a message", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "a".repeat(2001),
      NOW
    );

    expect(result).toEqual({
      ok: false,
      error: "A Note can be at most 2000 characters.",
    });
    expect(findNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("keeps Markdown characters exactly as typed", () => {
    saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "# not a heading\n*not bold*",
      NOW
    );

    expect(findNote(db, base.user.id, lessonIds[0])?.body).toBe(
      "# not a heading\n*not bold*"
    );
  });

  it("removes the Note when the box is saved empty", () => {
    saveNote(db, base.user.id, lessonIds[0], "Something", NOW);

    saveNote(db, base.user.id, lessonIds[0], "   ", LATER);

    expect(findNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });
});

describe("the Saved lists", () => {
  it("hold only the Student's own rows, newest first, with Lesson and Course", () => {
    const other = addStudent("Sam");
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    toggleBookmark(db, base.user.id, lessonIds[1], LATER);
    toggleBookmark(db, other.id, lessonIds[0], NOW);
    saveNote(db, base.user.id, lessonIds[1], "Older", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Newer", LATER);
    saveNote(db, other.id, lessonIds[0], "Sam's private note", LATER);

    expect(listBookmarks(db, base.user.id)).toMatchObject([
      {
        lessonId: lessonIds[1],
        lessonTitle: "Lesson 2",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      {
        lessonId: lessonIds[0],
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
    ]);
    expect(listNotes(db, base.user.id)).toMatchObject([
      { body: "Newer", lessonId: lessonIds[0], courseTitle: "Test Course" },
      { body: "Older", lessonId: lessonIds[1], courseTitle: "Test Course" },
    ]);
  });
});

describe("an approved Refund", () => {
  it("leaves the Student's Bookmarks and Notes in place", async () => {
    const notifications = fakeNotifications();
    const admin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: NOW.toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    toggleBookmark(db, base.user.id, lessonIds[0], NOW);
    saveNote(db, base.user.id, lessonIds[0], "Keep me", NOW);

    const raised = await raiseRefundRequest(
      db,
      notifications,
      purchase.id,
      base.user.id,
      "Not for me",
      NOW
    );
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(
      db,
      notifications,
      raised.refundRequestId,
      admin.id,
      null,
      NOW
    );

    expect(approved.ok).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonIds[0])).toBe(true);
    expect(findNote(db, base.user.id, lessonIds[0])?.body).toBe("Keep me");
  });
});

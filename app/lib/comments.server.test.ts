import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment, deleteComment } from "./comments.server";
import {
  fakeNotifications,
  type FakeNotifications,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let notifications: FakeNotifications;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotifications();
  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Hello", position: 1 })
    .returning()
    .get().id;
});

describe("creating a Discussion Question", () => {
  it("saves a trimmed top-level comment on the lesson", async () => {
    const question = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      null,
      "  How does this work?  ",
      NOW
    );

    expect(question).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How does this work?",
      createdAt: NOW.toISOString(),
    });
  });
});

function ask(authorId = base.user.id) {
  return createComment(db, notifications, authorId, lessonId, null, "A question", NOW);
}

describe("creating a Discussion Reply", () => {
  it("saves a reply under the Discussion Question", async () => {
    const question = await ask();

    const reply = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "Like this.",
      NOW
    );

    expect(reply).toMatchObject({ parentId: question.id, body: "Like this." });
  });

  it("refuses a reply to a reply", async () => {
    const question = await ask();
    const reply = await createComment(db, notifications, base.instructor.id, lessonId, question.id, "Yes", NOW);

    await expect(
      createComment(db, notifications, base.user.id, lessonId, reply.id, "Nested", NOW)
    ).rejects.toThrow("Replies can only be one level deep");
  });

  it("refuses an empty comment", async () => {
    await expect(
      createComment(db, notifications, base.user.id, lessonId, null, "   ", NOW)
    ).rejects.toThrow("Comment cannot be empty");
  });
});

describe("deleting a comment", () => {
  it("lets the author soft-delete their Discussion Question", async () => {
    const question = await ask();

    const deleted = deleteComment(db, question.id, base.user.id, false, NOW);

    expect(deleted.deletedAt).toBe(NOW.toISOString());
  });

  it("lets the author soft-delete their Discussion Reply", async () => {
    const question = await ask();
    const reply = await createComment(db, notifications, base.instructor.id, lessonId, question.id, "Yes", NOW);

    const deleted = deleteComment(db, reply.id, base.instructor.id, false, NOW);

    expect(deleted.deletedAt).toBe(NOW.toISOString());
  });

  it("refuses someone else's comment unless they are staff", async () => {
    const question = await ask();

    expect(() =>
      deleteComment(db, question.id, base.instructor.id, false, NOW)
    ).toThrow("You can only delete your own comments");
    expect(
      deleteComment(db, question.id, base.instructor.id, true, NOW).deletedAt
    ).toBe(NOW.toISOString());
  });

  it("leaves an already deleted comment as it was", async () => {
    const question = await ask();
    deleteComment(db, question.id, base.user.id, false, NOW);
    const later = new Date(NOW.getTime() + 60_000);

    const again = deleteComment(db, question.id, base.user.id, false, later);

    expect(again.deletedAt).toBe(NOW.toISOString());
  });
});

describe("the Discussion Reply Notification", () => {
  it("tells the question's author that someone else replied", async () => {
    const question = await ask();

    const reply = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "Use a   discriminated union.",
      NOW
    );

    expect(notifications.triggered).toEqual([
      {
        kind: "discussion-reply",
        recipients: [
          {
            id: base.user.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.instructor.id,
          name: "Test Instructor",
          email: "instructor@example.com",
          avatarUrl: null,
        },
        data: {
          commentId: reply.id,
          questionId: question.id,
          lessonId,
          lessonTitle: "Hello",
          courseTitle: "Test Course",
          courseSlug: "test-course",
          snippet: "Use a discriminated union.",
          url: `/courses/test-course/lessons/${lessonId}#comment-${reply.id}`,
        },
        idempotencyKey: `discussion-reply:${reply.id}`,
      },
    ]);
  });

  it("sends nothing when the author replies to their own question", async () => {
    const question = await ask();

    await createComment(db, notifications, base.user.id, lessonId, question.id, "Me again", NOW);

    expect(notifications.triggered).toEqual([]);
  });

  it("still saves the reply when the vendor is down", async () => {
    const question = await ask();
    notifications.breakDown();

    const reply = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "Saved anyway",
      NOW
    );

    const saved = db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, reply.id))
      .get();
    expect(saved?.body).toBe("Saved anyway");
  });
});

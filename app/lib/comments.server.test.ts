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

    const deleted = await deleteComment(db, notifications, question.id, base.user.id, false, NOW);

    expect(deleted.deletedAt).toBe(NOW.toISOString());
  });

  it("lets the author soft-delete their Discussion Reply", async () => {
    const question = await ask();
    const reply = await createComment(db, notifications, base.instructor.id, lessonId, question.id, "Yes", NOW);

    const deleted = await deleteComment(db, notifications, reply.id, base.instructor.id, false, NOW);

    expect(deleted.deletedAt).toBe(NOW.toISOString());
  });

  it("refuses someone else's comment unless they are staff", async () => {
    const question = await ask();

    await expect(
      deleteComment(db, notifications, question.id, base.instructor.id, false, NOW)
    ).rejects.toThrow("You can only delete your own comments");
    expect(
      (await deleteComment(db, notifications, question.id, base.instructor.id, true, NOW))
        .deletedAt
    ).toBe(NOW.toISOString());
  });

  it("leaves an already deleted comment as it was", async () => {
    const question = await ask();
    await deleteComment(db, notifications, question.id, base.user.id, false, NOW);
    const later = new Date(NOW.getTime() + 60_000);

    const again = await deleteComment(db, notifications, question.id, base.user.id, false, later);

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

    expect(
      notifications.triggered.filter((n) => n.kind === "discussion-reply")
    ).toEqual([
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

    expect(
      notifications.triggered.filter((n) => n.kind === "discussion-reply")
    ).toEqual([]);
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

function addAdmin() {
  return db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: schema.UserRole.Admin })
    .returning()
    .get();
}

describe("the Discussion Question Notification", () => {
  it("tells the course's Instructor about a Student's question", async () => {
    const question = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      null,
      "Why does `in` not narrow?",
      NOW
    );

    expect(notifications.triggered).toEqual([
      {
        kind: "discussion-question",
        recipients: [
          {
            id: base.instructor.id,
            name: "Test Instructor",
            email: "instructor@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        data: {
          commentId: question.id,
          lessonId,
          lessonTitle: "Hello",
          courseTitle: "Test Course",
          courseSlug: "test-course",
          snippet: "Why does `in` not narrow?",
          url: `/courses/test-course/lessons/${lessonId}#comment-${question.id}`,
        },
        idempotencyKey: `discussion-question:${question.id}`,
      },
    ]);
  });

  it("sends nothing when the Instructor asks on their own course", async () => {
    await ask(base.instructor.id);

    expect(notifications.triggered).toEqual([]);
  });

  it("tells the Instructor about a Platform Admin's question", async () => {
    const admin = addAdmin();

    await ask(admin.id);

    expect(notifications.triggered).toMatchObject([
      { kind: "discussion-question", recipients: [{ id: base.instructor.id }] },
    ]);
  });

  it("still saves the question when the vendor is down", async () => {
    notifications.breakDown();

    const question = await ask();

    expect(question.body).toBe("A question");
  });
});

describe("archiving Notifications on delete", () => {
  it("archives the Instructor's Notification when a Discussion Question is deleted", async () => {
    const question = await ask();

    await deleteComment(db, notifications, question.id, base.user.id, false, NOW);

    expect(notifications.archivedForComments).toEqual([question.id]);
  });

  it("archives the author's Notification when a Discussion Reply is deleted", async () => {
    const question = await ask();
    const reply = await createComment(db, notifications, base.instructor.id, lessonId, question.id, "Yes", NOW);

    await deleteComment(db, notifications, reply.id, base.instructor.id, false, NOW);

    expect(notifications.archivedForComments).toEqual([reply.id]);
  });

  it("leaves the Reply Notifications under a deleted question alone", async () => {
    const question = await ask();
    const reply = await createComment(db, notifications, base.instructor.id, lessonId, question.id, "Yes", NOW);

    await deleteComment(db, notifications, question.id, base.user.id, false, NOW);

    expect(notifications.archivedForComments).not.toContain(reply.id);
  });

  it("archives nothing for a comment that was already deleted", async () => {
    const question = await ask();
    await deleteComment(db, notifications, question.id, base.user.id, false, NOW);

    await deleteComment(db, notifications, question.id, base.user.id, false, NOW);

    expect(notifications.archivedForComments).toEqual([question.id]);
  });

  it("still deletes when the vendor is down", async () => {
    const question = await ask();
    notifications.breakDown();

    const deleted = await deleteComment(db, notifications, question.id, base.user.id, false, NOW);

    expect(deleted.deletedAt).toBe(NOW.toISOString());
  });
});

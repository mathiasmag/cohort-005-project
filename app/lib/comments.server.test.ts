import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment, deleteComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
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
  it("saves a trimmed top-level comment on the lesson", () => {
    const question = createComment(
      db,
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
  return createComment(db, authorId, lessonId, null, "A question", NOW);
}

describe("creating a Discussion Reply", () => {
  it("saves a reply under the Discussion Question", () => {
    const question = ask();

    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Like this.",
      NOW
    );

    expect(reply).toMatchObject({ parentId: question.id, body: "Like this." });
  });

  it("refuses a reply to a reply", () => {
    const question = ask();
    const reply = createComment(db, base.instructor.id, lessonId, question.id, "Yes", NOW);

    expect(() =>
      createComment(db, base.user.id, lessonId, reply.id, "Nested", NOW)
    ).toThrow("Replies can only be one level deep");
  });

  it("refuses an empty comment", () => {
    expect(() =>
      createComment(db, base.user.id, lessonId, null, "   ", NOW)
    ).toThrow("Comment cannot be empty");
  });
});

describe("deleting a comment", () => {
  it("lets the author soft-delete their Discussion Question", () => {
    const question = ask();

    const deleted = deleteComment(db, question.id, base.user.id, false, NOW);

    expect(deleted.deletedAt).toBe(NOW.toISOString());
  });

  it("lets the author soft-delete their Discussion Reply", () => {
    const question = ask();
    const reply = createComment(db, base.instructor.id, lessonId, question.id, "Yes", NOW);

    const deleted = deleteComment(db, reply.id, base.instructor.id, false, NOW);

    expect(deleted.deletedAt).toBe(NOW.toISOString());
  });

  it("refuses someone else's comment unless they are staff", () => {
    const question = ask();

    expect(() =>
      deleteComment(db, question.id, base.instructor.id, false, NOW)
    ).toThrow("You can only delete your own comments");
    expect(
      deleteComment(db, question.id, base.instructor.id, true, NOW).deletedAt
    ).toBe(NOW.toISOString());
  });

  it("leaves an already deleted comment as it was", () => {
    const question = ask();
    deleteComment(db, question.id, base.user.id, false, NOW);
    const later = new Date(NOW.getTime() + 60_000);

    const again = deleteComment(db, question.id, base.user.id, false, later);

    expect(again.deletedAt).toBe(NOW.toISOString());
  });
});

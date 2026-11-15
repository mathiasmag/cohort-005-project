import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { commentUrl, snippetOf } from "~/lib/notifications";
import { bestEffort, type Notifications } from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";
import { getPerson } from "~/lib/users.server";

// ─── Discussions ───
// Creating and soft-deleting Discussion Questions and Discussion Replies.
// Every function takes the database first and `now` last, so tests can hand
// in an in-memory database and a fixed clock, and the Notifications port when
// it sends any. Validation failures throw an Error whose message is safe to
// show the person who posted.

type Comment = typeof comments.$inferSelect;

export function getComment(db: Db, commentId: number): Comment | undefined {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

export function getCourseForLesson(db: Db, lessonId: number) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
      lessonTitle: lessons.title,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

export function assertValidBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

/**
 * Posts a Discussion Question (`parentId` null) or a Discussion Reply to one.
 * Replies are one level deep and must be on the same lesson as their parent.
 *
 * A Discussion Question by anyone but the course's Instructor notifies the
 * Instructor. A Discussion Reply by anyone but the question's author notifies
 * that author. Notifications are a snapshot: editing a comment later doesn't
 * change them.
 */
export async function createComment(
  db: Db,
  notifications: Notifications,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  now: Date
): Promise<Comment> {
  const trimmed = assertValidBody(body);

  const course = getCourseForLesson(db, lessonId);
  if (!course) {
    throw new Error("Lesson not found");
  }

  let parent: Comment | undefined;
  if (parentId !== null) {
    parent = getComment(db, parentId);
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  const comment = db
    .insert(comments)
    .values({
      userId: authorId,
      lessonId,
      parentId,
      body: trimmed,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();

  if (!parent && authorId !== course.instructorId) {
    await bestEffort(`discussion-question for comment ${comment.id}`, () =>
      notifyInstructor(db, notifications, comment, course)
    );
  }

  if (parent && parent.userId !== authorId) {
    const question = parent;
    await bestEffort(`discussion-reply for comment ${comment.id}`, () =>
      notifyQuestionAuthor(db, notifications, comment, question, course)
    );
  }

  return comment;
}

type LessonCourse = NonNullable<ReturnType<typeof getCourseForLesson>>;

function discussionData(comment: Comment, course: LessonCourse) {
  return {
    commentId: comment.id,
    lessonId: comment.lessonId,
    lessonTitle: course.lessonTitle,
    courseTitle: course.courseTitle,
    courseSlug: course.courseSlug,
    snippet: snippetOf(comment.body),
    url: commentUrl(course.courseSlug, comment.lessonId, comment.id),
  };
}

async function notifyInstructor(
  db: Db,
  notifications: Notifications,
  question: Comment,
  course: LessonCourse
) {
  const instructor = getPerson(db, course.instructorId);
  const asker = getPerson(db, question.userId);
  if (!instructor || !asker) return;

  await notifications.trigger({
    kind: "discussion-question",
    recipients: [instructor],
    actor: asker,
    data: discussionData(question, course),
    idempotencyKey: `discussion-question:${question.id}`,
  });
}

async function notifyQuestionAuthor(
  db: Db,
  notifications: Notifications,
  reply: Comment,
  question: Comment,
  course: LessonCourse
) {
  const questionAuthor = getPerson(db, question.userId);
  const replier = getPerson(db, reply.userId);
  if (!questionAuthor || !replier) return;

  await notifications.trigger({
    kind: "discussion-reply",
    recipients: [questionAuthor],
    actor: replier,
    data: { ...discussionData(reply, course), questionId: question.id },
    idempotencyKey: `discussion-reply:${reply.id}`,
  });
}

/**
 * Soft-deletes a comment. Its author may, and so may staff (the course's
 * Instructor or a Platform Admin). Deleting an already deleted comment leaves
 * it as it was. A deleted Discussion Question keeps its replies readable.
 *
 * The Notifications the comment caused are archived, so nobody is sent to
 * content that's gone. Reply Notifications under a deleted Discussion
 * Question stay, because those replies are still visible.
 */
export async function deleteComment(
  db: Db,
  notifications: Notifications,
  commentId: number,
  userId: number,
  isStaff: boolean,
  now: Date
): Promise<Comment> {
  const existing = getComment(db, commentId);
  if (!existing) {
    throw new Error("Comment not found");
  }
  if (existing.userId !== userId && !isStaff) {
    throw new Error("You can only delete your own comments");
  }
  if (existing.deletedAt !== null) {
    return existing;
  }

  const deleted = db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  await bestEffort(`archiving Notifications for comment ${commentId}`, () =>
    notifications.archiveCausedByComment(commentId)
  );

  return deleted;
}

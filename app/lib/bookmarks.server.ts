import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules } from "~/db/schema";

// ─── Bookmarks ───
// A Student's flag on a Lesson. One per Student per Lesson, enforced by the
// unique index on (user_id, lesson_id). See GLOSSARY.md.

type Db = BetterSQLite3Database<typeof schema>;

export function isBookmarked(db: Db, studentId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(
      and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
    )
    .get();
}

/** Adds the Bookmark if there is none, removes it if there is one. Returns whether the Lesson is now bookmarked. */
export function toggleBookmark(
  db: Db,
  studentId: number,
  lessonId: number,
  now: Date
): boolean {
  return db.transaction((tx) => {
    const removed = tx
      .delete(bookmarks)
      .where(
        and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
      )
      .returning()
      .all();
    if (removed.length > 0) return false;

    tx.insert(bookmarks)
      .values({ userId: studentId, lessonId, createdAt: now.toISOString() })
      .onConflictDoNothing()
      .run();
    return true;
  });
}

/** The Student's Bookmarks, newest first, each with its Lesson and Course. */
export function listBookmarks(db: Db, studentId: number) {
  return db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, studentId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

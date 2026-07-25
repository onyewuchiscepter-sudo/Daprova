import { Kysely, sql } from 'kysely';

// Restructures Framework/Course/Area from "Framework has Areas; Course is an
// independent sibling; Cohort links one Course + one Framework together" into
// a single nested hierarchy: Framework -> Course -> Competency Area ->
// Question, with Cohort just picking a Course (its framework/areas come
// along implicitly). Agreed trade-off: an area can no longer be shared
// across courses — a framework used by more than one course today gets its
// areas (and their questions) duplicated per extra course below, rather than
// silently dropped from any course.
//
// is_locked also moves from framework to course, since areas (and therefore
// "can this still be edited") are now a course-level concern.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('courses').addColumn('framework_id', 'uuid').execute();
  await db.schema.alterTable('courses').addColumn('is_locked', 'boolean', (c) => c.notNull().defaultTo(false)).execute();
  await db.schema.alterTable('courses').addColumn('is_template', 'boolean', (c) => c.notNull().defaultTo(false)).execute();
  await db.schema.alterTable('competency_areas').addColumn('course_id', 'uuid').execute();

  // Snapshot the OLD course<->framework pairing from cohorts before that
  // column is dropped — this is the only source of truth for "which course
  // was this framework actually being used by" once real data exists.
  const pairings = await db.selectFrom('cohorts').select(['course_id', 'framework_id']).distinct().execute();
  const courseIdsByFramework = new Map<string, Set<string>>();
  const frameworkIdByCourse = new Map<string, string>();
  for (const p of pairings as Array<{ course_id: string; framework_id: string }>) {
    if (!courseIdsByFramework.has(p.framework_id)) courseIdsByFramework.set(p.framework_id, new Set());
    courseIdsByFramework.get(p.framework_id)!.add(p.course_id);
    if (!frameworkIdByCourse.has(p.course_id)) frameworkIdByCourse.set(p.course_id, p.framework_id);
  }

  // Every course needs exactly one framework. A course with no cohorts yet
  // (so no pairing above) gets a brand-new empty framework of its own.
  const allCourses = await db.selectFrom('courses').select(['id', 'org_id', 'name', 'category']).execute();
  for (const course of allCourses as Array<{ id: string; org_id: string; name: string; category: string }>) {
    let frameworkId = frameworkIdByCourse.get(course.id);
    if (!frameworkId) {
      const created = await db
        .insertInto('competency_frameworks')
        .values({ org_id: course.org_id, name: `${course.name} framework`, category: course.category })
        .returning('id')
        .executeTakeFirstOrThrow();
      frameworkId = created.id as string;
    }
    await db.updateTable('courses').set({ framework_id: frameworkId }).where('id', '=', course.id).execute();
  }

  // Move (or duplicate) each framework's areas onto the course(s) that used it.
  const allFrameworks = await db
    .selectFrom('competency_frameworks')
    .select(['id', 'is_template', 'is_locked', 'org_id', 'name', 'category'])
    .execute();
  for (const fw of allFrameworks as Array<{ id: string; is_template: boolean; is_locked: boolean; org_id: string; name: string; category: string }>) {
    const areas = await db.selectFrom('competency_areas').selectAll().where('framework_id', '=', fw.id).execute();
    if (areas.length === 0) continue;

    let targetCourseIds: string[];
    if (fw.is_template) {
      // Templates become a template Course nested under their (still
      // template) Framework, so cloning a template still clones one
      // self-contained unit — see frameworkService.ts's new clone logic.
      const templateCourse = await db
        .insertInto('courses')
        .values({ org_id: fw.org_id, name: fw.name, category: fw.category, framework_id: fw.id, is_locked: true, is_template: true })
        .returning('id')
        .executeTakeFirstOrThrow();
      targetCourseIds = [templateCourse.id as string];
    } else {
      const used = courseIdsByFramework.get(fw.id);
      if (used && used.size > 0) {
        targetCourseIds = [...used];
      } else {
        // A real (non-template) framework nobody ever assigned to a cohort —
        // give it one placeholder course so its areas have somewhere to live.
        const placeholder = await db
          .insertInto('courses')
          .values({ org_id: fw.org_id, name: fw.name, category: fw.category, framework_id: fw.id, is_locked: fw.is_locked })
          .returning('id')
          .executeTakeFirstOrThrow();
        targetCourseIds = [placeholder.id as string];
      }
    }

    const [firstCourseId, ...extraCourseIds] = targetCourseIds;
    for (const area of areas as Array<{ id: string }>) {
      await db.updateTable('competency_areas').set({ course_id: firstCourseId }).where('id', '=', area.id).execute();
    }

    // Any additional course sharing this framework gets a full duplicate of
    // every area and its questions — the one place data is intentionally
    // duplicated rather than lost.
    for (const extraCourseId of extraCourseIds) {
      for (const area of areas as Array<{ id: string; name: string; description: string | null; display_order: number; is_active: boolean }>) {
        const questions = await db.selectFrom('questions').selectAll().where('area_id', '=', area.id).execute();
        const newArea = await db
          .insertInto('competency_areas')
          .values({
            // framework_id is still NOT NULL at this point in the migration
            // (that column isn't dropped until later below) — set it to the
            // source framework purely to satisfy the constraint transiently.
            framework_id: fw.id,
            course_id: extraCourseId,
            name: area.name,
            description: area.description,
            display_order: area.display_order,
            is_active: area.is_active,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (questions.length > 0) {
          await db
            .insertInto('questions')
            .values(
              (questions as Array<Record<string, unknown>>).map((q) => ({
                area_id: newArea.id,
                question_text: q.question_text,
                option_a: q.option_a,
                option_b: q.option_b,
                option_c: q.option_c,
                option_d: q.option_d,
                correct_option: q.correct_option,
                assessment_type: q.assessment_type,
                is_active: q.is_active,
              })),
            )
            .execute();
        }
      }
    }
  }

  await db.schema.alterTable('courses').alterColumn('framework_id', (ac: any) => ac.setNotNull()).execute();
  await sql`ALTER TABLE courses ADD CONSTRAINT courses_framework_id_fkey FOREIGN KEY (framework_id) REFERENCES competency_frameworks(id)`.execute(db);

  await db.schema.alterTable('competency_areas').alterColumn('course_id', (ac: any) => ac.setNotNull()).execute();
  await sql`ALTER TABLE competency_areas ADD CONSTRAINT competency_areas_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id)`.execute(db);
  await db.schema.alterTable('competency_areas').dropColumn('framework_id').execute();

  await db.schema.alterTable('cohorts').dropColumn('framework_id').execute();
}

// Not meaningfully reversible (the duplication in `up` can't be losslessly
// collapsed back), so `down` restores the columns/shape only, not the
// pre-migration data — consistent with this being a one-way structural move.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('cohorts').addColumn('framework_id', 'uuid').execute();
  await db.schema.alterTable('competency_areas').addColumn('framework_id', 'uuid').execute();
  await db.schema.alterTable('courses').dropColumn('is_template').execute();
  await db.schema.alterTable('courses').dropColumn('is_locked').execute();
  await db.schema.alterTable('courses').dropColumn('framework_id').execute();
}

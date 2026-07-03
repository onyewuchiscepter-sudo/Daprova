import { db } from '../index.js';
import * as analyticsService from '../../services/analyticsService.js';
import * as dataQualityService from '../../services/dataQualityService.js';

// Replaces the real "DEA dataset (245 responses)" the spec references for
// validating S5's analytics (no such dataset is available for this build) —
// generates a synthetic cohort with realistic score distributions and
// demographic spread, then runs the actual analytics queries against it so
// the results can be sanity-checked against the known generation parameters.
const N_LEARNERS = 245;
const MEAN_ABILITY_PRE = 0.4;
const SD_ABILITY_PRE = 0.15;
const MEAN_GAIN = 0.15;
const SD_GAIN = 0.1;

function randNormal(mean: number, sd: number): number {
  // Box-Muller transform.
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function weightedChoice<T extends string>(weights: Array<[T, number]>): T {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of weights) {
    r -= w;
    if (r <= 0) return value;
  }
  return weights[weights.length - 1][0];
}

async function main() {
  const org = await db.selectFrom('organisations').selectAll().where('slug', '=', 'acme-edtech-dev').executeTakeFirstOrThrow();
  const adminUser = await db.selectFrom('users').selectAll().where('org_id', '=', org.id).where('role', '=', 'admin').executeTakeFirstOrThrow();
  const template = await db
    .selectFrom('competency_frameworks')
    .selectAll()
    .where('category', '=', 'digital_skills')
    .where('is_template', '=', true)
    .executeTakeFirstOrThrow();

  console.log('[synthetic] cloning a fresh framework from the Digital Skills template...');
  const framework = await db
    .insertInto('competency_frameworks')
    .values({ org_id: org.id, name: 'Synthetic Validation Framework', category: template.category, created_by: adminUser.id })
    .returningAll()
    .executeTakeFirstOrThrow();

  const templateAreas = await db.selectFrom('competency_areas').selectAll().where('framework_id', '=', template.id).execute();
  const areaIdMap = new Map<string, string>();
  for (const area of templateAreas) {
    const newArea = await db
      .insertInto('competency_areas')
      .values({ framework_id: framework.id, name: area.name, description: area.description, display_order: area.display_order, is_active: area.is_active })
      .returningAll()
      .executeTakeFirstOrThrow();
    areaIdMap.set(area.id, newArea.id);

    const questions = await db.selectFrom('questions').selectAll().where('area_id', '=', area.id).execute();
    if (questions.length > 0) {
      await db
        .insertInto('questions')
        .values(
          questions.map((q) => ({
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

  const course = await db
    .insertInto('courses')
    .values({ org_id: org.id, name: 'Synthetic Validation Bootcamp', category: 'digital_skills' })
    .returningAll()
    .executeTakeFirstOrThrow();

  const cohort = await db
    .insertInto('cohorts')
    .values({
      course_id: course.id,
      framework_id: framework.id,
      name: `Synthetic Cohort (n=${N_LEARNERS})`,
      pre_link_token: crypto.randomUUID(),
      post_link_token: crypto.randomUUID(),
      created_by: adminUser.id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const questions = await db
    .selectFrom('questions')
    .innerJoin('competency_areas', 'competency_areas.id', 'questions.area_id')
    .select(['questions.id', 'questions.area_id', 'questions.correct_option', 'questions.assessment_type'])
    .where('competency_areas.framework_id', '=', framework.id)
    .execute();
  const preQuestions = questions.filter((q) => q.assessment_type === 'pre' || q.assessment_type === 'both');
  const postQuestions = questions.filter((q) => q.assessment_type === 'post' || q.assessment_type === 'both');
  const OPTIONS = ['a', 'b', 'c', 'd'] as const;

  console.log(`[synthetic] generating ${N_LEARNERS} learners with pre+post sessions...`);
  for (let i = 0; i < N_LEARNERS; i++) {
    const gender = weightedChoice([
      ['male', 48],
      ['female', 48],
      ['other', 2],
      ['prefer_not_to_say', 2],
    ]);
    const ageGroup = weightedChoice([
      ['15-24', 45],
      ['25-34', 35],
      ['35-44', 15],
      ['45+', 5],
    ]);
    const locationType = weightedChoice([
      ['urban', 55],
      ['rural', 30],
      ['peri-urban', 15],
    ]);
    const disability = weightedChoice([
      ['no', 90],
      ['yes', 7],
      ['prefer_not_to_say', 3],
    ]);

    const learner = await db
      .insertInto('learners')
      .values({ cohort_id: cohort.id, learner_token: crypto.randomUUID(), gender, age_group: ageGroup, location_type: locationType, disability })
      .returningAll()
      .executeTakeFirstOrThrow();

    const abilityPre = clamp(randNormal(MEAN_ABILITY_PRE, SD_ABILITY_PRE), 0.05, 0.95);
    const gain = randNormal(MEAN_GAIN, SD_GAIN);
    const abilityPost = clamp(abilityPre + gain, 0.05, 0.98);

    await simulateSession(learner.id, cohort.id, 'pre', preQuestions, abilityPre, areaIdMap);
    await simulateSession(learner.id, cohort.id, 'post', postQuestions, abilityPost, areaIdMap);

    if ((i + 1) % 50 === 0) console.log(`[synthetic] ...${i + 1}/${N_LEARNERS}`);
  }

  async function simulateSession(
    learnerId: string,
    cohortId: string,
    sessionType: 'pre' | 'post',
    sessionQuestions: typeof questions,
    ability: number,
    areaMap: Map<string, string>,
  ) {
    const durationSecs = Math.round(200 + Math.random() * 700); // well above the 180s gaming threshold
    const session = await db
      .insertInto('assessment_sessions')
      .values({ learner_id: learnerId, cohort_id: cohortId, session_type: sessionType, status: 'started' })
      .returningAll()
      .executeTakeFirstOrThrow();

    let correct = 0;
    const responseRows = sessionQuestions.map((q) => {
      const isCorrect = Math.random() < ability;
      if (isCorrect) correct++;
      const selected = isCorrect ? q.correct_option : OPTIONS.filter((o) => o !== q.correct_option)[Math.floor(Math.random() * 3)];
      return { session_id: session.id, question_id: q.id, area_id: q.area_id, selected_option: selected, is_correct: isCorrect };
    });
    if (responseRows.length > 0) await db.insertInto('question_responses').values(responseRows).execute();

    const totalScore = sessionQuestions.length > 0 ? Math.round((correct / sessionQuestions.length) * 10000) / 100 : 0;
    await db
      .updateTable('assessment_sessions')
      .set({ status: 'completed', completed_at: new Date(), total_score: totalScore, duration_secs: durationSecs })
      .where('id', '=', session.id)
      .execute();

    // FR-M2-10: confidence rating per area, correlated with ability plus noise.
    const distinctAreaIds = Array.from(new Set(sessionQuestions.map((q) => q.area_id)));
    if (distinctAreaIds.length > 0) {
      await db
        .insertInto('confidence_ratings')
        .values(
          distinctAreaIds.map((areaId) => ({
            session_id: session.id,
            area_id: areaId,
            rating: Math.round(clamp(ability * 5 + randNormal(0, 0.6), 1, 5)),
          })),
        )
        .execute();
    }
  }

  console.log('[synthetic] done generating. Running analytics for a sanity check...\n');

  const gains = await analyticsService.getMeanGain(cohort.id);
  console.log('Mean gain:', gains);

  const effectSize = await analyticsService.getCohensD(cohort.id);
  console.log("Cohen's d:", effectSize);

  const breakdown = await analyticsService.getCompetencyBreakdown(cohort.id, framework.id);
  console.log('Competency breakdown:', breakdown);

  for (const dim of ['gender', 'age_group', 'location_type', 'disability'] as const) {
    const equity = await analyticsService.getEquityBreakdown(cohort.id, dim);
    console.log(`Equity (${dim}):`, equity.groups);
  }

  const outliers = await dataQualityService.runOutlierDetection(cohort.id);
  console.log('Outlier detection:', outliers);

  console.log(`\n[synthetic] Expected roughly: mean_gain ~${Math.round(MEAN_GAIN * 100)} pts, cohens_d in the medium-large range given sd_gain=${SD_GAIN}.`);
  await db.destroy();
}

main().catch((err) => {
  console.error('[synthetic] failed', err);
  process.exit(1);
});

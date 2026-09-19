export type QuestionType = 'mcq' | 'true_false' | 'scenario' | 'self_rating';

export type QuestionFormValues = {
  question_type: QuestionType;
  question_text: string;
  scenario_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'a' | 'b' | 'c' | 'd';
  assessment_type: 'pre' | 'post' | 'both';
};

export const EMPTY_QUESTION_FORM: QuestionFormValues = {
  question_type: 'mcq',
  question_text: '',
  scenario_text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_option: 'a',
  assessment_type: 'both',
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'Multiple choice',
  true_false: 'True / false',
  scenario: 'Scenario',
  self_rating: 'Self-rating (1–5)',
};

const TYPE_HINT: Record<QuestionType, string> = {
  mcq: 'Four options, one correct.',
  true_false: 'Two options, one correct. Change the labels if you like (e.g. Agree / Disagree).',
  scenario: 'Describe a real situation, then ask what the learner should do. Four options, one correct.',
  self_rating: 'The learner rates themselves from 1 to 5. Not scored — reported separately as self-rated confidence.',
};

export function questionFormValid(v: QuestionFormValues): boolean {
  if (!v.question_text.trim()) return false;
  if (v.question_type === 'self_rating') return true;
  if (v.question_type === 'true_false') return ['a', 'b'].includes(v.correct_option);
  if (v.question_type === 'scenario' && !v.scenario_text.trim()) return false;
  return Boolean(v.option_a && v.option_b && v.option_c && v.option_d);
}

// What the API expects for each type (it re-validates everything).
export function questionPayload(v: QuestionFormValues) {
  const base = { question_type: v.question_type, question_text: v.question_text, assessment_type: v.assessment_type };
  if (v.question_type === 'self_rating') return { ...base, option_a: v.option_a || null, option_b: v.option_b || null };
  if (v.question_type === 'true_false') return { ...base, option_a: v.option_a || 'True', option_b: v.option_b || 'False', correct_option: v.correct_option };
  return {
    ...base,
    scenario_text: v.question_type === 'scenario' ? v.scenario_text : null,
    option_a: v.option_a,
    option_b: v.option_b,
    option_c: v.option_c,
    option_d: v.option_d,
    correct_option: v.correct_option,
  };
}

export function QuestionForm(props: {
  values: QuestionFormValues;
  onChange: (v: QuestionFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  error?: string | null;
}) {
  const { values, onChange, onSubmit, onCancel, submitting, submitLabel, error } = props;
  const type = values.question_type;
  const letters: Array<'a' | 'b' | 'c' | 'd'> = type === 'true_false' ? ['a', 'b'] : ['a', 'b', 'c', 'd'];

  function setType(next: QuestionType) {
    const patch: Partial<QuestionFormValues> = { question_type: next };
    if (next === 'true_false') {
      patch.option_a = values.option_a || 'True';
      patch.option_b = values.option_b || 'False';
      if (!['a', 'b'].includes(values.correct_option)) patch.correct_option = 'a';
    }
    if (next === 'self_rating') {
      patch.option_a = 'Not confident';
      patch.option_b = 'Very confident';
    }
    onChange({ ...values, ...patch });
  }

  return (
    <div className="bg-ground rounded p-3 space-y-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Question type">
        {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className={`text-xs rounded-full px-2.5 py-1 border ${type === t ? 'bg-ink text-white border-ink' : 'bg-paper border-rule text-ink-soft hover:border-ink'}`}
          >
            {QUESTION_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="text-xs text-sage">{TYPE_HINT[type]}</p>

      {type === 'scenario' && (
        <textarea
          className="w-full border rounded px-2 py-1.5 text-sm"
          rows={3}
          placeholder="Scenario — e.g. Ada runs a shop and has 200 rows of sales. She wants the total for each month."
          value={values.scenario_text}
          onChange={(e) => onChange({ ...values, scenario_text: e.target.value })}
        />
      )}
      <input
        className="w-full border rounded px-2 py-1.5 text-sm"
        placeholder={type === 'self_rating' ? 'e.g. How confident are you building a budget in a spreadsheet?' : 'Question text'}
        value={values.question_text}
        onChange={(e) => onChange({ ...values, question_text: e.target.value })}
      />

      {type === 'self_rating' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-ink-soft">
            Label for 1
            <input className="mt-1 w-full border rounded px-2 py-1.5 text-sm" value={values.option_a} onChange={(e) => onChange({ ...values, option_a: e.target.value })} />
          </label>
          <label className="text-xs text-ink-soft">
            Label for 5
            <input className="mt-1 w-full border rounded px-2 py-1.5 text-sm" value={values.option_b} onChange={(e) => onChange({ ...values, option_b: e.target.value })} />
          </label>
        </div>
      ) : (
        letters.map((letter) => {
          const key = `option_${letter}` as const;
          return (
            <div key={key} className="flex items-center gap-2">
              <input
                type="radio"
                name="correct_option"
                checked={values.correct_option === letter}
                onChange={() => onChange({ ...values, correct_option: letter })}
                aria-label={`Option ${letter.toUpperCase()} is correct`}
                title="Mark as correct answer"
              />
              <input
                className="flex-1 border rounded px-2 py-1.5 text-sm"
                placeholder={`Option ${letter.toUpperCase()}`}
                value={values[key]}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
              />
            </div>
          );
        })
      )}
      {type !== 'self_rating' && <p className="text-[11px] text-sage">Select the circle next to the correct answer.</p>}

      {error && <p className="text-xs text-flag">{error}</p>}
      <div className="flex items-center justify-between">
        <label className="text-xs text-ink-soft flex items-center gap-2">
          Used for
          <select
            className="border rounded px-2 py-1 text-xs"
            value={values.assessment_type}
            onChange={(e) => onChange({ ...values, assessment_type: e.target.value as QuestionFormValues['assessment_type'] })}
          >
            <option value="both">Pre and post</option>
            <option value="pre">Pre only</option>
            <option value="post">Post only</option>
          </select>
        </label>
        <div className="flex gap-3">
          <button onClick={onCancel} className="text-xs text-ink-soft hover:underline">
            Cancel
          </button>
          <button onClick={onSubmit} disabled={!questionFormValid(values) || submitting} className="bg-gain text-white text-xs rounded px-3 py-1.5 disabled:opacity-50">
            {submitting ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';

const CATEGORIES = [
  ['digital_skills', 'Digital Skills'],
  ['financial_literacy', 'Financial Literacy'],
  ['coding', 'Coding & Web Dev'],
  ['vocational', 'Vocational & Trade'],
  ['agricultural', 'Agricultural & Rural'],
  ['creator_economy', 'Creator Economy'],
];

export default function NewCoursePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0][0]);

  const createMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/courses', { method: 'POST', body: JSON.stringify({ name, category }) }),
    onSuccess: async (course) => {
      await queryClient.invalidateQueries({ queryKey: ['courses'] });
      navigate(`/courses/${course.id}`);
    },
  });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-6">New Course</h1>
      <div className="bg-white rounded-lg shadow p-6 max-w-md space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Course name
          <input className="mt-1 w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Category
          <select className="mt-1 w-full border rounded px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {createMutation.isError && <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>}
        <button
          onClick={() => createMutation.mutate()}
          disabled={!name || createMutation.isPending}
          className="bg-slate-900 text-white text-sm rounded px-4 py-2 disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating…' : 'Create course'}
        </button>
      </div>
    </div>
  );
}

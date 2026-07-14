import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api';
import { useAuth } from '../auth';

type Member = { id: string; email: string; display_name: string | null; role: 'admin' | 'viewer'; created_at: string };
type PendingInvite = { id: string; email: string; role: 'admin' | 'viewer'; expires_at: string; created_at: string };
type TeamData = { members: Member[]; pending_invites: PendingInvite[] };

export default function TeamPage() {
  const { org } = useAuth();
  const queryClient = useQueryClient();

  const { data } = useQuery<TeamData>({ queryKey: ['org-users'], queryFn: () => apiFetch('/api/v1/org/users') });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'viewer'>('viewer');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [orgName, setOrgName] = useState(org?.name ?? '');
  const [contactEmail, setContactEmail] = useState(org?.contact_email ?? '');
  const [profileError, setProfileError] = useState<string | null>(null);

  const inviteMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/org/users/invite', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-users'] });
      setInviteEmail('');
      setInviteRole('viewer');
      setInviteError(null);
    },
    onError: (err: Error) => setInviteError(err.message),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'admin' | 'viewer' }) =>
      apiFetch(`/api/v1/org/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org-users'] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/v1/org/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org-users'] }),
  });

  const profileMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/org', { method: 'PATCH', body: JSON.stringify({ name: orgName, contact_email: contactEmail }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org'] });
      setProfileError(null);
    },
    onError: (err: Error) => setProfileError(err.message),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Team & organisation settings</h1>

      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="font-medium text-slate-900 mb-3">Organisation profile</h2>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <label className="text-xs text-slate-500">
            Name
            <input className="mt-1 block w-full border rounded px-2 py-1.5 text-sm" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">
            Contact email
            <input
              className="mt-1 block w-full border rounded px-2 py-1.5 text-sm"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </label>
        </div>
        {profileError && <p className="text-xs text-red-600 mb-2">{profileError}</p>}
        <button
          onClick={() => profileMutation.mutate()}
          disabled={profileMutation.isPending}
          className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          {profileMutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="font-medium text-slate-900 mb-3">Invite a teammate</h2>
        <div className="flex gap-2 items-end mb-2">
          <label className="text-xs text-slate-500 flex-1">
            Email
            <input
              type="email"
              className="mt-1 block w-full border rounded px-2 py-1.5 text-sm"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-500">
            Role
            <select
              className="mt-1 block border rounded px-2 py-1.5 text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'viewer')}
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            onClick={() => inviteMutation.mutate()}
            disabled={!inviteEmail || inviteMutation.isPending}
            className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
          >
            {inviteMutation.isPending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        {inviteError && <p className="text-xs text-red-600">{inviteError}</p>}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <h2 className="font-medium text-slate-900 p-4 pb-0">Members</h2>
        <table className="w-full text-sm mt-3">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="p-3">Email</th>
              <th className="p-3">Name</th>
              <th className="p-3">Role</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data?.members.map((m) => (
              <tr key={m.id}>
                <td className="p-3">{m.email}</td>
                <td className="p-3">{m.display_name ?? '—'}</td>
                <td className="p-3">
                  <select
                    className="border rounded px-1.5 py-1 text-xs capitalize"
                    value={m.role}
                    onChange={(e) => roleMutation.mutate({ id: m.id, role: e.target.value as 'admin' | 'viewer' })}
                  >
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="p-3">
                  <button onClick={() => removeMutation.mutate(m.id)} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {roleMutation.isError && <p className="text-xs text-red-600 p-3">{(roleMutation.error as Error).message}</p>}
        {removeMutation.isError && <p className="text-xs text-red-600 p-3">{(removeMutation.error as Error).message}</p>}
      </div>

      {!!data?.pending_invites.length && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <h2 className="font-medium text-slate-900 p-4 pb-0">Pending invites</h2>
          <table className="w-full text-sm mt-3">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="p-3">Email</th>
                <th className="p-3">Role</th>
                <th className="p-3">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.pending_invites.map((i) => (
                <tr key={i.id}>
                  <td className="p-3">{i.email}</td>
                  <td className="p-3 capitalize">{i.role}</td>
                  <td className="p-3 text-slate-500">{new Date(i.expires_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

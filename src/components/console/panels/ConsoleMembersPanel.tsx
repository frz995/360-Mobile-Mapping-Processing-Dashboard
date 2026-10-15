/**
 * Team members: invite staff, set their company role, suspend access.
 *
 * WHY THIS PANEL IS THE MOST IMPORTANT ONE IN THE CONSOLE
 *   Without it, a company created in the console is unusable. `organization_members`
 *   has `user_id UUID NOT NULL REFERENCES auth.users(id)` (migration 0036:191),
 *   no code anywhere wrote that table, and even a hand-written insert lands on
 *   `status='invited'`, which `sec.current_org()` excludes (0036:197, :388).
 *   Every tenant created before this panel existed could therefore never have a
 *   single member, and all of its data was invisible to every human.
 *
 * THE FOUR STATES, AND WHY THEY ARE NOT COLLAPSED
 *   `invited` + email unconfirmed  -> has an account, cannot prove they own the
 *                                     address, grants nothing.
 *   `invited` + email confirmed    -> clicked the link, has not signed in yet,
 *                                     still grants nothing.
 *   `active`                       -> signed in; `sec.current_org()` resolves.
 *   `suspended`                    -> revoked; excluded from `current_org()` so
 *                                     the row is unreadable, not merely unused.
 *
 *   `status` and `email_confirmed_at` are independent facts from different
 *   tables. Reporting either one as "registered" is how an invite queue starts
 *   claiming staff are set up when nobody has been able to sign in.
 *
 * WHAT AN INVITE DOES AND DOES NOT DO
 *   Creates or resolves an auth account, then writes a membership at `invited`.
 *   It grants nothing. Access begins only when the invited person signs in with
 *   a confirmed address (`public.activate_pending_memberships()`). That gate is
 *   the whole security property: with Supabase's "Confirm email" setting off,
 *   `signUp` returns a session immediately with an unverified address, and any
 *   email-keyed grant would then be account takeover.
 */

import React from 'react';
import { UserPlus, Users, ShieldAlert, Trash2, RotateCcw, Ban, Building2, Copy, Check } from 'lucide-react';
import type { ConsoleDirectory } from '../useConsoleDirectory';
import { STATUS_LABEL } from '../useConsoleDirectory';
import {
  fetchOrganizationMembers,
  resolveInviteeAccount,
  inviteOrganizationMember,
  setOrganizationMemberStatus,
  removeOrganizationMember,
  type OrganizationMemberSummary
} from '../../../services/consoleAccess';
import {
  ConfirmDialog,
  Field,
  ModalShell,
  PanelCard,
  PanelHeader,
  PrimaryButton,
  ReadFailure,
  SecondaryButton,
  inputClass
} from './consoleUi';
import { toast } from '../../common/toast';

const MEMBER_ROLES = [
  { value: 'CompanyAdmin', label: 'Company Admin' },
  { value: 'Operator', label: 'Operator' },
  { value: 'Inspector', label: 'Inspector' },
  { value: 'Viewer', label: 'Viewer' }
];

function roleLabel(value: string): string {
  return MEMBER_ROLES.find((r) => r.value === value)?.label || value;
}

interface Props {
  directory: ConsoleDirectory;
  selectedOrgId: string;
  onSelectOrg: (orgId: string) => void;
}

/** The one place the four states are named, so the panel cannot drift from them. */
function describeState(member: OrganizationMemberSummary): { label: string; detail: string; tone: string } {
  const confirmed = Boolean(member.emailConfirmedAt);
  if (member.status === 'suspended') {
    return { label: 'Suspended', detail: 'Access revoked. Their data is not readable.', tone: 'text-rose-600' };
  }
  if (member.status === 'active') {
    return { label: 'Active', detail: 'Signed in and working in this company.', tone: 'text-emerald-600' };
  }
  if (!confirmed) {
    return {
      label: 'Invited — awaiting confirmation',
      detail: 'Has an account but has not confirmed the email address. Grants no access yet.',
      tone: 'text-amber-600'
    };
  }
  return {
    label: 'Confirmed — awaiting first sign-in',
    detail: 'The address is verified. Access begins the first time they sign in.',
    tone: 'text-slate-700'
  };
}

interface InviteModalProps {
  orgId: string;
  orgName: string;
  onClose: () => void;
  onInvited: (email: string) => void;
}

const InviteMemberModal: React.FC<InviteModalProps> = ({ orgId, orgName, onClose, onInvited }) => {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('Operator');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [directLink, setDirectLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    // Two writes with different failure modes, reported separately. Collapsing
    // them into one boolean is how "account created, membership refused" gets
    // reported to the seller as "invited".
    const account = await resolveInviteeAccount(email);
    if (!account.ok) {
      setError(account.error);
      setBusy(false);
      return;
    }

    // Platform administrators already possess global access across all tenants,
    // but writing an explicit company membership row ensures they are listed on
    // this company's staff directory for operational and testing visibility.
    if (account.outcome.alreadyPlatformAdmin) {
      // Intentional pass-through: allow adding platform admin to tenant roster
    }

    const membership = await inviteOrganizationMember(orgId, account.outcome.userId, role);
    if (!membership.success) {
      setError(
        `${membership.error || 'The membership was refused.'} The sign-in account was ${
          account.outcome.created ? 'created' : 'found'
        }, but this person is not a member of ${orgName}.`
      );
      setBusy(false);
      return;
    }

    if (account.outcome.inviteLink) {
      setDirectLink(account.outcome.inviteLink);
      setBusy(false);
    } else {
      onInvited(email.trim().toLowerCase());
    }
  };

  const handleFinish = () => {
    onInvited(email.trim().toLowerCase());
    onClose();
  };

  return (
    <ModalShell title={`Invite to ${orgName}`} onClose={handleFinish}>
      {directLink ? (
        <div className="p-6 space-y-4 text-slate-800">
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 space-y-2">
            <p className="font-bold text-sm text-emerald-900">Member Invited Successfully!</p>
            <p className="text-emerald-700 leading-relaxed">
              An invitation email has been dispatched to <strong>{email}</strong>.
            </p>
            <p className="text-slate-600 pt-1">
              If the recipient cannot find the email in their inbox or spam, you can share this direct activation link with them:
            </p>
            <div className="flex items-center gap-2 pt-1">
              <input readOnly value={directLink} className={`${inputClass} font-mono text-[11px] select-all`} />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(directLink);
                  setCopied(true);
                  toast.success('Direct invite link copied!');
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[#0c0d0e] hover:bg-black text-white shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{copied ? 'Copied' : 'Copy Link'}</span>
              </button>
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleFinish}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-[#0c0d0e] hover:bg-black text-white cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-slate-800">
          <Field label="Email Address" required>
            <input
              type="email"
              required
              placeholder="name@client.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>

          <Field label="Company Role">
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
              {MEMBER_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed space-y-1.5">
            <p className="font-bold text-slate-800 text-xs">What happens next</p>
            <p>
              An invitation email is sent directly to their address. If they do not see it, a direct invite link will also be provided for manual sharing.
            </p>
            <p>
              <strong className="text-slate-800">An invite grants nothing on its own.</strong> Access starts only after
              they confirm the address and sign in for the first time.
            </p>
          </div>

          {error ? (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
              <ShieldAlert size={14} className="shrink-0 mt-0.5 text-rose-600" />
              <span className="text-xs text-rose-700 font-medium leading-tight">{error}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              style={{ backgroundColor: '#121316', borderRadius: '12px' }}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white hover:bg-black transition-colors cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
            >
              <UserPlus size={13} />
              {busy ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
};

export const ConsoleMembersPanel: React.FC<Props> = ({ directory, selectedOrgId, onSelectOrg }) => {
  const { organizations } = directory;

  const [members, setMembers] = React.useState<OrganizationMemberSummary[]>([]);
  const [membersError, setMembersError] = React.useState<string | null>(null);
  const [isLoadingMembers, setIsLoadingMembers] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [pendingRemove, setPendingRemove] = React.useState<OrganizationMemberSummary | null>(null);
  const [busyUserId, setBusyUserId] = React.useState<string | null>(null);

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId) || null;

  const loadMembers = React.useCallback(async (orgId: string) => {
    if (!orgId) {
      setMembers([]);
      setMembersError(null);
      return;
    }
    setIsLoadingMembers(true);
    const result = await fetchOrganizationMembers(orgId);
    setMembers(result.members);
    // A failed read is NOT an empty staff list. An empty list invites the seller
    // to invite everyone again, which is how duplicate invites happen.
    setMembersError(result.error);
    setIsLoadingMembers(false);
  }, []);

  React.useEffect(() => {
    void loadMembers(selectedOrgId);
  }, [selectedOrgId, loadMembers]);

  const refresh = async () => {
    await Promise.all([directory.reload(), loadMembers(selectedOrgId)]);
  };

  const changeStatus = async (member: OrganizationMemberSummary, status: 'active' | 'suspended') => {
    setBusyUserId(member.userId);
    const result = await setOrganizationMemberStatus(selectedOrgId, member.userId, status);
    setBusyUserId(null);
    if (!result.success) {
      toast.error(result.error || 'The membership was not changed.');
      return;
    }
    toast.success(status === 'active' ? 'Member restored.' : 'Member suspended.');
    await loadMembers(selectedOrgId);
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setBusyUserId(pendingRemove.userId);
    const result = await removeOrganizationMember(selectedOrgId, pendingRemove.userId);
    setBusyUserId(null);
    if (!result.success) {
      toast.error(result.error || 'The member was not removed.');
      return;
    }
    setPendingRemove(null);
    toast.success('Member removed.');
    await loadMembers(selectedOrgId);
  };

  const handleInvited = async (email: string) => {
    setInviteOpen(false);
    toast.success(`Invite created for ${email}. It grants no access until they confirm the address and sign in.`);
    await loadMembers(selectedOrgId);
  };

  return (
    <div className="space-y-6">
      <PanelCard>
        <PanelHeader
          title="Team Members"
          subtitle="Nobody can reach a company until somebody is added to it here."
          actions={
            selectedOrg ? (
              <PrimaryButton onClick={() => setInviteOpen(true)} icon={<UserPlus size={14} />}>
                Invite Member
              </PrimaryButton>
            ) : null
          }
        />

        {organizations.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">
            No companies exist yet. Provision one from the Companies panel first.
          </p>
        ) : (
          <div className="mt-5">
            <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="member-org-select">
              Company
            </label>
            <select
              id="member-org-select"
              value={selectedOrgId}
              onChange={(e) => onSelectOrg(e.target.value)}
              className={`${inputClass} max-w-sm`}
            >
              <option value="">Select a company…</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                  {org.status !== 'active' ? ` (${STATUS_LABEL[org.status]})` : ''}
                </option>
              ))}
            </select>
            {selectedOrg && selectedOrg.status !== 'active' ? (
              <p className="text-[11px] text-amber-600 font-semibold mt-2">
                This company is {STATUS_LABEL[selectedOrg.status].toLowerCase()}. Invitations can still be created,
                but a suspended company grants no access to anyone.
              </p>
            ) : null}
          </div>
        )}
      </PanelCard>

      {selectedOrg ? (
        <PanelCard>
          <PanelHeader
            title={`${selectedOrg.name} — Staff`}
            subtitle="Every row is a sign-in account joined to a company membership."
            actions={
              <SecondaryButton onClick={() => void refresh()} disabled={isLoadingMembers} icon={<Users size={13} />}>
                Refresh
              </SecondaryButton>
            }
          />

          {membersError ? (
            <ReadFailure
              reason={membersError}
              subject="member list"
              onRetry={() => void loadMembers(selectedOrgId)}
              retryLabel="Retry Read"
            />
          ) : isLoadingMembers ? (
            <div className="space-y-3 p-4 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 bg-slate-50 border border-slate-100 rounded-2xl" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 size={24} className="mx-auto mb-2 text-slate-400" />
              <div className="font-bold text-sm text-slate-800">Nobody is on this company yet</div>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
                Until somebody is invited here, no one can sign in to this company. The bootstrap organization is the
                only tenant whose members work without this step.
              </p>
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-[#0c0d0e] hover:bg-black text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus size={14} />
                <span>Invite the first member</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-100 mt-5">
              <table className="w-full text-left text-xs text-slate-700">
                <thead
                  className="border-b font-bold uppercase tracking-wider text-[10px]"
                  style={{ backgroundColor: '#f8fafc' }}
                >
                  <tr>
                    <th className="px-6 py-3.5">Email</th>
                    <th className="px-6 py-3.5">Role</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Invited</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((member) => {
                    const state = describeState(member);
                    const busy = busyUserId === member.userId;
                    return (
                      <tr key={member.userId} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-900 font-mono text-xs">{member.email || '—'}</div>
                          {/* A null `email_confirmed_at` means no auth account
                              exists at all, which is unknown — not
                              "confirmed" and not "unconfirmed". */}
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {member.emailConfirmedAt
                              ? `Address confirmed ${new Date(member.emailConfirmedAt).toLocaleDateString()}`
                              : member.email
                                ? 'Address not confirmed'
                                : 'No linked sign-in account'}
                          </div>
                        </td>
                        <td className="px-6 py-4">{roleLabel(member.role)}</td>
                        <td className="px-6 py-4">
                          <div className={`font-bold ${state.tone}`}>{state.label}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5 max-w-xs">{state.detail}</div>
                        </td>
                        <td className="px-6 py-4 text-slate-500">
                          {member.invitedAt ? new Date(member.invitedAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {member.status === 'suspended' ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void changeStatus(member, 'active')}
                                title="Restore access"
                                className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <RotateCcw size={12} />
                                <span>Restore</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void changeStatus(member, 'suspended')}
                                title="Suspend access"
                                className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <Ban size={12} />
                                <span>Suspend</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setPendingRemove(member)}
                              title={`Remove ${member.email || 'this member'}`}
                              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PanelCard>
      ) : null}

      {inviteOpen && selectedOrg ? (
        <InviteMemberModal
          orgId={selectedOrg.id}
          orgName={selectedOrg.name}
          onClose={() => setInviteOpen(false)}
          onInvited={(email) => void handleInvited(email)}
        />
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove this member?"
        body={`“${pendingRemove?.email || 'this member'}” will lose access to ${
          selectedOrg?.name ?? 'this company'
        } immediately. Their sign-in account and any data they created are not deleted.`}
        confirmLabel="Remove Member"
        destructive
        busy={busyUserId === pendingRemove?.userId}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
};

export default ConsoleMembersPanel;
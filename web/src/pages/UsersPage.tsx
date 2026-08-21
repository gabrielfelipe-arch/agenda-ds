import { useEffect, useState } from 'react';
import { api, ROLE_LABELS, type Role, type User } from '../api';
import { useAuth } from '../auth';
import { Icon, Modal, formatDateTimeBR, initials, useToast } from '../ui';

export default function UsersPage() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [items, setItems] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ items: User[] }>('/admin/users');
      setItems(res.items);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(u: User) {
    try {
      const res = await api.patch<{ items: User[] }>(`/admin/users/${u.id}`, { active: !u.active });
      setItems(res.items);
      toast.ok(u.active ? 'Usuário desativado.' : 'Usuário reativado.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function remove(u: User) {
    if (!confirm(`Excluir o usuário ${u.name}?`)) return;
    try {
      const res = await api.del<{ items: User[] }>(`/admin/users/${u.id}`);
      setItems(res.items);
      toast.ok('Usuário excluído.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Usuários</h1>
          <p className="page-sub">Somente administradores podem criar e editar acessos</p>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Icon.Plus />
          Novo usuário
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Perfis de acesso</div>
        <div className="grid-2">
          <div>
            <span className="pill-role admin">Administrador</span>
            <p className="hint" style={{ marginTop: 8 }}>
              Faz tudo: cria e edita usuários, altera o formulário, configura o Google Agenda, gerencia
              solicitações, exporta relatórios e exclui registros.
            </p>
          </div>
          <div>
            <span className="pill-role gerente">Gerente de agenda</span>
            <p className="hint" style={{ marginTop: 8 }}>
              Confirma e altera o status dos agendamentos, entra em contato com o solicitante pelo WhatsApp,
              consulta a agenda e exporta relatórios. Não cria usuários nem altera configurações.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-page">
          <div className="spinner dark" />
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Perfil</th>
                  <th>Situação</th>
                  <th>Último acesso</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span className="avatar">{initials(u.name)}</span>
                        <div>
                          <div className="cell-strong">
                            {u.name}
                            {u.id === me?.id && <span className="cell-soft"> (você)</span>}
                          </div>
                          <div className="cell-soft">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`pill-role ${u.role}`}>{ROLE_LABELS[u.role]}</span>
                    </td>
                    <td>
                      <span className={`badge ${u.active ? 'confirmado' : 'cancelado'}`}>
                        {u.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="cell-soft">
                      {u.last_login_at ? formatDateTimeBR(u.last_login_at) : 'Nunca acessou'}
                    </td>
                    <td>
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>
                          Editar
                        </button>
                        {u.id !== me?.id && (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => void toggleActive(u)}>
                              {u.active ? 'Desativar' : 'Ativar'}
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => void remove(u)}>
                              <Icon.Trash />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-list">
            {items.map((u) => (
              <div className="req-card" key={u.id}>
                <div className="req-card-top">
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="avatar">{initials(u.name)}</span>
                    <div>
                      <h3>{u.name}</h3>
                      <div className="cell-soft">{u.email}</div>
                    </div>
                  </div>
                  <span className={`pill-role ${u.role}`}>{u.role === 'admin' ? 'Admin' : 'Gerente'}</span>
                </div>
                <div className="req-line">
                  <Icon.Clock />
                  <span>{u.last_login_at ? formatDateTimeBR(u.last_login_at) : 'Nunca acessou'}</span>
                </div>
                <div className="row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(u)}>
                    Editar
                  </button>
                  {u.id !== me?.id && (
                    <button className="btn btn-ghost btn-sm" onClick={() => void toggleActive(u)}>
                      {u.active ? 'Desativar' : 'Ativar'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(list) => {
            setItems(list);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function UserModal({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: (items: User[]) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState<Role>(user?.role || 'gerente');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = user
        ? await api.patch<{ items: User[] }>(`/admin/users/${user.id}`, {
            name,
            email,
            role,
            ...(password ? { password } : {}),
          })
        : await api.post<{ items: User[] }>('/admin/users', { name, email, role, password });
      toast.ok(user ? 'Usuário atualizado.' : 'Usuário criado.');
      onSaved(res.items);
    } catch (err) {
      toast.err((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={user ? `Editar ${user.name}` : 'Novo usuário'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy && <div className="spinner" />}
            Salvar
          </button>
        </>
      }
    >
      <form onSubmit={save}>
        <div className="field">
          <label className="label">Nome completo</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} />
        </div>
        <div className="field">
          <label className="label">E-mail</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="label">Perfil</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="gerente">Gerente de agenda</option>
            <option value="admin">Administrador</option>
          </select>
          <span className="hint">
            {role === 'admin'
              ? 'Acesso total, inclusive criação de usuários e configurações.'
              : 'Confirma agendas, fala com o solicitante e vê relatórios. Não cria usuários.'}
          </span>
        </div>
        <div className="field">
          <label className="label">{user ? 'Nova senha (opcional)' : 'Senha inicial'}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required={!user}
            autoComplete="new-password"
            placeholder={user ? 'Deixe em branco para manter' : 'Mínimo 8 caracteres'}
          />
          {user && (
            <span className="hint">
              Ao trocar a senha, as biometrias cadastradas por este usuário são removidas por segurança.
            </span>
          )}
        </div>
      </form>
    </Modal>
  );
}

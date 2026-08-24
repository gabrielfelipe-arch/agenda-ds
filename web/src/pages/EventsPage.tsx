import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  api,
  downloadFile,
  eventPublicUrl,
  type Attendee,
  type EventItem,
} from '../api';
import { Icon, Modal, formatDateBR, maskPhone, todayISO, useToast, weekdayLong } from '../ui';

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function EventsPage() {
  const toast = useToast();
  const location = useLocation();
  const [items, setItems] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState<EventItem | 'new' | null>(null);
  const [attendeesOf, setAttendeesOf] = useState<EventItem | null>(null);
  const [messageOpen, setMessageOpen] = useState(false);

  // Evento recém-gerado a partir de uma solicitação: abre direto na edição
  // (e inclui os passados no filtro, para ele aparecer na lista mesmo com data antiga).
  useEffect(() => {
    const opened = (location.state as { open?: EventItem } | null)?.open;
    if (!opened) return;
    setEditing(opened);
    if (opened.event_date < todayISO()) setShowPast(true);
    window.history.replaceState({}, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (!showPast && from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const res = await api.get<{ items: EventItem[] }>(`/admin/events${qs ? `?${qs}` : ''}`);
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
  }, [from, to, showPast]);

  async function copyLink(ev: EventItem) {
    try {
      await navigator.clipboard.writeText(eventPublicUrl(ev.slug));
      toast.ok('Link de inscrição copiado!');
    } catch {
      toast.err('Não foi possível copiar. Copie manualmente: ' + eventPublicUrl(ev.slug));
    }
  }

  const totalInscritos = useMemo(() => items.reduce((acc, e) => acc + e.attendee_count, 0), [items]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Eventos</h1>
          <p className="page-sub">{loading ? 'Carregando…' : `${items.length} evento(s) no período`}</p>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
          <Icon.Refresh />
          Atualizar
        </button>
        <button className="btn btn-whats btn-sm" onClick={() => setMessageOpen(true)}>
          <Icon.Whats />
          Mensagem da semana
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Icon.Plus />
          Novo evento
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <b>{items.length}</b>
          <span>Eventos</span>
        </div>
        <div className="stat confirmado">
          <b>{totalInscritos}</b>
          <span>Inscritos</span>
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="field" style={{ margin: 0 }}>
          <label className="label">De</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} disabled={showPast} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="label">Até</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <label className="switch" style={{ alignSelf: 'flex-end' }}>
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          <span>Incluir passados</span>
        </label>
      </div>

      {loading ? (
        <div className="loading-page">
          <div className="spinner dark" />
        </div>
      ) : items.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">📅</div>
          <p>Nenhum evento no período. Crie o primeiro para gerar o link de inscrição.</p>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <Icon.Plus />
            Novo evento
          </button>
        </div>
      ) : (
        <div className="table-wrap table-viewport" style={{ maxHeight: 'calc(100dvh - 380px)' }}>
          <table>
            <thead>
              <tr>
                <th>Data / hora</th>
                <th>Evento</th>
                <th>Local</th>
                <th>Inscritos</th>
                <th>Inscrições</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ev) => (
                <tr key={ev.id} style={ev.status === 'cancelado' ? { opacity: 0.55 } : undefined}>
                  <td>
                    <div className="cell-strong">{formatDateBR(ev.event_date)}</div>
                    <div className="cell-soft">
                      {weekdayLong(ev.event_date)} · {ev.start_time}
                      {ev.end_time ? ` às ${ev.end_time}` : ''}
                    </div>
                  </td>
                  <td>
                    <div className="cell-strong">{ev.title}</div>
                    {ev.status === 'cancelado' && <span className="badge">Cancelado</span>}
                    {ev.request_id && <div className="cell-soft">origem: solicitação</div>}
                  </td>
                  <td className="cell-soft" style={{ maxWidth: 260 }}>
                    <div className="cell-clamp" title={ev.location}>
                      {ev.location}
                    </div>
                  </td>
                  <td>
                    <button className="link-btn" onClick={() => setAttendeesOf(ev)}>
                      {ev.attendee_count} inscrito{ev.attendee_count === 1 ? '' : 's'}
                    </button>
                  </td>
                  <td className="cell-soft">{ev.registration_open ? 'Abertas' : 'Encerradas'}</td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-ghost btn-sm btn-icon"
                        onClick={() => void copyLink(ev)}
                        title="Copiar link de inscrição"
                        aria-label={`Copiar link de ${ev.title}`}
                      >
                        <Icon.Pin />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(ev)}>
                        <Icon.Eye />
                        Abrir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EventModal
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {attendeesOf && <AttendeesModal item={attendeesOf} onClose={() => setAttendeesOf(null)} />}

      {messageOpen && <WeekMessageModal onClose={() => setMessageOpen(false)} />}
    </>
  );
}

/* ------------------------------ criar/editar ------------------------------ */

interface EventForm {
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  description: string;
  collect_open: boolean;
}

function EventModal({
  item,
  onClose,
  onSaved,
}: {
  item: EventItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<EventForm>({
    title: item?.title || '',
    event_date: item?.event_date || '',
    start_time: item?.start_time || '',
    end_time: item?.end_time || '',
    location: item?.location || '',
    description: item?.description || '',
    collect_open: item ? item.collect_open : true,
  });
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => setData((p) => ({ ...p, [k]: v }));

  async function save() {
    if (data.title.trim().length < 3) return toast.err('Informe o nome do evento.');
    if (!data.event_date) return toast.err('Informe a data.');
    if (!data.start_time) return toast.err('Informe o horário.');
    if (data.location.trim().length < 3) return toast.err('Informe o local.');
    setBusy(true);
    try {
      if (item) {
        await api.patch(`/admin/events/${item.id}`, data);
        toast.ok('Evento atualizado.');
      } else {
        await api.post(`/admin/events`, data);
        toast.ok('Evento criado! O link de inscrição já está disponível.');
      }
      onSaved();
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelEvent() {
    if (!item) return;
    if (!window.confirm('Cancelar este evento? Ele sai da mensagem da semana e o link deixa de aceitar inscrições.')) return;
    setBusy(true);
    try {
      await api.patch(`/admin/events/${item.id}`, { status: 'cancelado', collect_open: false });
      toast.ok('Evento cancelado.');
      onSaved();
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent() {
    if (!item) return;
    if (!window.confirm('Excluir o evento e TODOS os inscritos dele? Essa ação não tem volta.')) return;
    setBusy(true);
    try {
      await api.del(`/admin/events/${item.id}`);
      toast.ok('Evento excluído.');
      onSaved();
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={item ? 'Editar evento' : 'Novo evento'}
      onClose={onClose}
      footer={
        <>
          {item && (
            <>
              <button className="btn btn-danger btn-sm" onClick={() => void removeEvent()} disabled={busy}>
                <Icon.Trash />
                Excluir
              </button>
              {item.status === 'ativo' && (
                <button className="btn btn-ghost btn-sm" onClick={() => void cancelEvent()} disabled={busy}>
                  Cancelar evento
                </button>
              )}
            </>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Fechar
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? <div className="spinner" /> : <Icon.Check />}
            {item ? 'Salvar alterações' : 'Criar evento'}
          </button>
        </>
      }
    >
      {item && (
        <div className="alert alert-ok" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, wordBreak: 'break-all' }}>{eventPublicUrl(item.slug)}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void navigator.clipboard.writeText(eventPublicUrl(item.slug)).then(
                () => toast.ok('Link copiado!'),
                () => toast.err('Copie manualmente o link acima.')
              );
            }}
          >
            Copiar link
          </button>
        </div>
      )}

      <div className="field">
        <label className="label">
          Nome do evento<span className="req">*</span>
        </label>
        <input
          className="input"
          value={data.title}
          onChange={(e) => set('title', e.target.value.toUpperCase())}
          placeholder="BANDEIRADA + ENTREGA DE MATERIAL"
          maxLength={200}
        />
      </div>

      <div className="grid-3">
        <div className="field">
          <label className="label">
            Data<span className="req">*</span>
          </label>
          <input type="date" className="input" value={data.event_date} onChange={(e) => set('event_date', e.target.value)} />
        </div>
        <div className="field">
          <label className="label">
            Início<span className="req">*</span>
          </label>
          <input type="time" className="input" value={data.start_time} onChange={(e) => set('start_time', e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Término (opcional)</label>
          <input type="time" className="input" value={data.end_time} onChange={(e) => set('end_time', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label className="label">
          Local<span className="req">*</span>
        </label>
        <input
          className="input"
          value={data.location}
          onChange={(e) => set('location', e.target.value.toUpperCase())}
          placeholder="PRAÇA NELSON MANDELA - BOTAFOGO"
          maxLength={300}
        />
      </div>

      <div className="field">
        <label className="label">Detalhes (aparecem na página de inscrição)</label>
        <textarea
          className="textarea"
          rows={3}
          value={data.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={4000}
        />
      </div>

      <label className="switch">
        <input type="checkbox" checked={data.collect_open} onChange={(e) => set('collect_open', e.target.checked)} />
        <span>Inscrições abertas (lista de presença)</span>
      </label>

      <p className="hint" style={{ marginTop: 12 }}>
        A imagem do topo da página de inscrição é a mesma do cabeçalho do formulário (Configurações).
      </p>
    </Modal>
  );
}

/* ------------------------------ inscritos ------------------------------ */

function AttendeesModal({ item, onClose }: { item: EventItem; onClose: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Attendee[] | null>(null);

  useEffect(() => {
    api
      .get<{ items: Attendee[] }>(`/admin/events/${item.id}/attendees`)
      .then((r) => setRows(r.items))
      .catch((e) => {
        toast.err((e as Error).message);
        setRows([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function remove(a: Attendee) {
    if (!window.confirm(`Remover ${a.name} da lista?`)) return;
    try {
      const r = await api.del<{ items: Attendee[] }>(`/admin/events/${item.id}/attendees/${a.id}`);
      setRows(r.items);
      toast.ok('Removido da lista.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  async function exportXlsx() {
    try {
      await downloadFile(`/admin/events/${item.id}/attendees.xlsx`, 'presenca.xlsx');
      toast.ok('Planilha gerada.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  return (
    <Modal
      title={`Lista de presença — ${item.title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
          <button className="btn btn-primary" onClick={() => void exportXlsx()} disabled={!rows?.length}>
            <Icon.Download />
            Exportar Excel
          </button>
        </>
      }
    >
      <p className="hint" style={{ marginBottom: 10 }}>
        {formatDateBR(item.event_date)} · {item.start_time} · {item.location}
      </p>
      {rows === null ? (
        <div className="loading-page" style={{ minHeight: 120 }}>
          <div className="spinner dark" />
        </div>
      ) : rows.length === 0 ? (
        <div className="empty" style={{ padding: '28px 0' }}>
          <div className="empty-icon">🙋</div>
          <p>Ninguém se inscreveu ainda. Divulgue o link do evento nos grupos.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Nome</th>
                <th>WhatsApp</th>
                <th>Bairro</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={a.id}>
                  <td className="cell-soft">{i + 1}</td>
                  <td className="cell-strong">{a.name}</td>
                  <td>
                    <a
                      className="link-btn"
                      href={`https://wa.me/${a.whatsapp.length <= 11 ? `55${a.whatsapp}` : a.whatsapp}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {maskPhone(a.whatsapp)}
                    </a>
                  </td>
                  <td className="cell-soft">
                    {a.district || '—'}
                    {a.city ? ` · ${a.city}` : ''}
                  </td>
                  <td>
                    <button className="icon-btn" onClick={() => void remove(a)} aria-label={`Remover ${a.name}`}>
                      <Icon.Trash />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* --------------------------- mensagem da semana --------------------------- */

function WeekMessageModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(addDaysISO(todayISO(), 6));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const res = await api.get<{ text: string }>(`/admin/events/message?from=${from}&to=${to}`);
      setText(res.text);
    } catch (e) {
      setText('');
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.ok('Mensagem copiada! Cole no grupo do WhatsApp.');
    } catch {
      toast.err('Não foi possível copiar automaticamente. Selecione o texto e copie.');
    }
  }

  return (
    <Modal
      title="Mensagem da semana"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
          <button className="btn btn-ghost" onClick={() => void copy()} disabled={!text}>
            Copiar
          </button>
          <a
            className={`btn btn-whats ${text ? '' : 'disabled'}`}
            href={text ? `https://wa.me/?text=${encodeURIComponent(text)}` : undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!text) e.preventDefault();
            }}
          >
            <Icon.Whats />
            Abrir no WhatsApp
          </a>
        </>
      }
    >
      <div className="grid-2" style={{ alignItems: 'end' }}>
        <div className="field">
          <label className="label">De</label>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Até</label>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => void generate()} disabled={busy} style={{ marginBottom: 12 }}>
        {busy ? <div className="spinner" /> : <Icon.Refresh />}
        Gerar novamente
      </button>

      {text ? (
        <textarea
          className="textarea msg-preview"
          rows={16}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ fontSize: '0.85rem', lineHeight: 1.5 }}
        />
      ) : (
        <div className="empty" style={{ padding: '20px 0' }}>
          <p>Nenhum evento ativo no período. Ajuste as datas e gere novamente.</p>
        </div>
      )}
      <p className="hint" style={{ marginTop: 8 }}>
        Você pode ajustar o texto antes de copiar. O cabeçalho e o rodapé são editáveis em Configurações.
      </p>
    </Modal>
  );
}

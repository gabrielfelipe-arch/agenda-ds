import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile, EVENT_TYPES, STATUS_LABELS, type AgendaRequest, type EventItem, type Status } from '../api';
import { useAuth } from '../auth';
import {
  Icon,
  Modal,
  DURATION_VALUES,
  MultiSelect,
  StatusBadge,
  addHours,
  durationLabel,
  formatAddress,
  formatDateBR,
  formatDateTimeBR,
  formatStreetLine,
  maskPhone,
  useToast,
  isMobileDevice,
  waPhone,
  weekdayLong,
  whatsappUrl,
  type MultiOption,
} from '../ui';

export interface Filters {
  status: string[];
  from: string;
  to: string;
  q: string;
  city: string[];
  district: string[];
  audience: string[];
  type: string[];
}

export interface FilterOptions {
  statuses: { value: string; count: number }[];
  cities: { value: string; count: number }[];
  districts: { value: string; city: string; count: number }[];
  audiences: { value: string; count: number }[];
  types: { value: string; count: number }[];
  total: number;
}

export const EMPTY_OPTIONS: FilterOptions = {
  statuses: [],
  cities: [],
  districts: [],
  audiences: [],
  types: [],
  total: 0,
};

export const EMPTY_FILTERS: Filters = {
  status: [],
  from: '',
  to: '',
  q: '',
  city: [],
  district: [],
  audience: [],
  type: [],
};

export function buildQuery(f: Filters): string {
  const p = new URLSearchParams();
  // Listas vão como parâmetros repetidos: seguro para valores que contenham vírgula.
  f.status.forEach((v) => p.append('status', v));
  f.city.forEach((v) => p.append('city', v));
  f.district.forEach((v) => p.append('district', v));
  f.audience.forEach((v) => p.append('audience', v));
  f.type.forEach((v) => p.append('type', v));
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function countActiveFilters(f: Filters): number {
  return (
    f.status.length +
    f.city.length +
    f.district.length +
    f.audience.length +
    f.type.length +
    (f.from ? 1 : 0) +
    (f.to ? 1 : 0) +
    (f.q ? 1 : 0)
  );
}

type WaKind = 'confirm' | 'reject' | 'reschedule';

interface WaPreview {
  item: AgendaRequest;
  kind: WaKind;
  message: string;
  phone: string;
}

export default function RequestsPage() {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showClosed, setShowClosed] = useState(false);
  const [items, setItems] = useState<AgendaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AgendaRequest | null>(null);
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [waPreview, setWaPreview] = useState<WaPreview | null>(null);
  const [, setWaLoadingId] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<AgendaRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Lista inicial mostra só o que precisa de atenção (pendentes e confirmadas).
      // A caixinha ou um filtro explícito de status liberam as demais.
      const effective =
        filters.status.length || showClosed
          ? filters
          : { ...filters, status: ['pendente', 'confirmado'] };
      const res = await api.get<{ items: AgendaRequest[] }>(`/admin/requests${buildQuery(effective)}`);
      setItems(res.items);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, showClosed]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api
      .get<FilterOptions>('/admin/options')
      .then(setOptions)
      .catch(() => undefined);
  }, [items.length]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [items]);

  function upsert(item: AgendaRequest) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    setSelected((prev) => (prev && prev.id === item.id ? item : prev));
  }

  /** Abre a prévia da mensagem — direto da lista ou de dentro do detalhe. */
  const openWhats = useCallback(async (item: AgendaRequest, kind: WaKind = 'confirm') => {
    setWaLoadingId(item.id);
    try {
      // No computador a mensagem abre no WhatsApp Web: pedimos a versao sem emojis
      // quando as configuracoes estiverem no modo automatico.
      const plain = isMobileDevice() ? '' : '&plain=1';
      const res = await api.get<{ message: string; phone: string }>(
        `/admin/requests/${item.id}/whatsapp?kind=${kind}${plain}`
      );
      setWaPreview({ item, kind, message: res.message, phone: res.phone });
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setWaLoadingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportXlsx() {
    try {
      await downloadFile(`/admin/export.xlsx${buildQuery(filters)}`, 'solicitacoes-agenda.xlsx');
      toast.ok('Planilha gerada.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Solicitações de agenda</h1>
          <p className="page-sub">
            {loading ? 'Carregando…' : `${items.length} solicitação(ões) no filtro atual`}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
          <Icon.Refresh />
          Atualizar
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => void exportXlsx()}>
          <Icon.Download />
          Exportar Excel
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <b>{items.length}</b>
          <span>No filtro</span>
        </div>
        <div className="stat pendente">
          <b>{counts.pendente || 0}</b>
          <span>Pendentes</span>
        </div>
        <div className="stat confirmado">
          <b>{counts.confirmado || 0}</b>
          <span>Confirmadas</span>
        </div>
        <div className="stat recusado">
          <b>{counts.recusado || 0}</b>
          <span>Recusadas</span>
        </div>
      </div>

      <FiltersBar filters={filters} setFilters={setFilters} options={options} />

      <label className="switch" style={{ margin: '10px 0 14px' }}>
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
        <span>Exibir realizadas, recusadas e canceladas</span>
      </label>

      {loading ? (
        <div className="loading-page">
          <div className="spinner dark" />
        </div>
      ) : items.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">🗓️</div>
          <p>Nenhuma solicitação encontrada com os filtros atuais.</p>
          {countActiveFilters(filters) > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="table-wrap table-viewport" style={{ maxHeight: 'calc(100dvh - 430px)' }}>
            <table>
              <thead>
                <tr>
                  <th>Protocolo</th>
                  <th>Data / hora</th>
                  <th>Solicitante</th>
                  <th>Local</th>
                  <th>Bairro</th>
                  <th>Cidade</th>
                  <th>Pauta / briefing</th>
                  <th>Público</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-soft">{r.protocol}</td>
                    <td>
                      <div className="cell-strong">{formatDateBR(r.event_date)}</div>
                      <div className="cell-soft">
                        {r.start_time} às {addHours(r.start_time, r.duration_hours)} · chegada {r.arrival_time}
                      </div>
                    </td>
                    <td>
                      <div className="cell-strong">{r.requester_name}</div>
                      <div className="cell-soft">{maskPhone(r.whatsapp)}</div>
                    </td>
                    <td className="cell-soft" style={{ maxWidth: 220 }}>
                      {formatStreetLine(r)}
                    </td>
                    <td className="cell-soft">{r.district || '—'}</td>
                    <td className="cell-soft">
                      {r.city}
                      {r.state ? ` - ${r.state}` : ''}
                    </td>
                    <td className="cell-soft">
                      <div className="cell-clamp" title={r.agenda}>
                        {r.agenda}
                      </div>
                    </td>
                    <td className="cell-soft">{r.audience}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        <a
                          className="btn btn-whats btn-sm btn-icon"
                          href={whatsappUrl(waPhone(r.whatsapp), '')}
                          target="_blank"
                          rel="noreferrer"
                          title={`Conversar com ${r.requester_name} no WhatsApp`}
                          aria-label={`Conversar com ${r.requester_name} no WhatsApp`}
                        >
                          <Icon.Whats />
                        </a>
                        <button
                          className="btn btn-ghost btn-sm btn-icon"
                          onClick={() => setReschedule(r)}
                          title="Reagendar"
                          aria-label={`Reagendar ${r.protocol}`}
                        >
                          <Icon.Reschedule />
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setSelected(r)}>
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

          <div className="card-list">
            {items.map((r) => (
              <div className="req-card" key={r.id}>
                <div className="req-card-top">
                  <div>
                    <h3>{r.requester_name}</h3>
                    <div className="cell-soft">{r.protocol}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="req-line">
                  <Icon.Calendar />
                  <span>
                    {formatDateBR(r.event_date)} · {r.start_time}–{addHours(r.start_time, r.duration_hours)}
                  </span>
                </div>
                <div className="req-line">
                  <Icon.Pin />
                  <span>
                    {formatStreetLine(r)}
                    <br />
                    <strong>{r.district || 'Bairro não informado'}</strong>
                    {r.city ? ` · ${r.city}` : ''}
                    {r.state ? ` - ${r.state}` : ''}
                  </span>
                </div>
                <div className="req-line">
                  <Icon.Group />
                  <span>{r.audience}</span>
                </div>
                <div className="req-line">
                  <Icon.List />
                  <span className="cell-clamp" style={{ maxWidth: 'none' }}>
                    {r.agenda}
                  </span>
                </div>
                <div className="row-actions">
                  <a
                    className="btn btn-whats btn-sm btn-icon"
                    href={whatsappUrl(waPhone(r.whatsapp), '')}
                    target="_blank"
                    rel="noreferrer"
                    title={`Conversar com ${r.requester_name} no WhatsApp`}
                    aria-label={`Conversar com ${r.requester_name} no WhatsApp`}
                  >
                    <Icon.Whats />
                  </a>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => setReschedule(r)}
                    title="Reagendar"
                    aria-label={`Reagendar ${r.protocol}`}
                  >
                    <Icon.Reschedule />
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setSelected(r)}>
                    <Icon.Eye />
                    Detalhes
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selected && (
        <RequestModal
          item={selected}
          onClose={() => setSelected(null)}
          onChanged={upsert}
          onWhats={openWhats}
          onReschedule={setReschedule}
          onDeleted={(id) => {
            setItems((prev) => prev.filter((i) => i.id !== id));
            setSelected(null);
          }}
        />
      )}

      {reschedule && (
        <RescheduleModal
          item={reschedule}
          onClose={() => setReschedule(null)}
          onSaved={(updated, avisar) => {
            upsert(updated);
            setReschedule(null);
            if (avisar) void openWhats(updated, 'reschedule');
          }}
        />
      )}

      {waPreview && (
        <WhatsAppModal
          preview={waPreview}
          onClose={() => setWaPreview(null)}
          onSwitchKind={(kind) => void openWhats(waPreview.item, kind)}
        />
      )}
    </>
  );
}

/* ------------------------------- filtros ------------------------------- */

export function FiltersBar({
  filters,
  setFilters,
  options,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  options: FilterOptions;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });

  const statusOptions: MultiOption[] = options.statuses.map((s) => ({
    value: s.value,
    label: STATUS_LABELS[s.value as Status] || s.value,
    count: s.count,
  }));

  const cityOptions: MultiOption[] = options.cities.map((c) => ({
    value: c.value,
    label: c.value,
    count: c.count,
  }));

  // Com cidades escolhidas, só fazem sentido os bairros dessas cidades.
  const districtOptions: MultiOption[] = useMemo(() => {
    const relevant = options.districts.filter(
      (d) => filters.city.length === 0 || filters.city.some((c) => c.toLowerCase() === d.city.toLowerCase())
    );
    const merged = new Map<string, number>();
    for (const d of relevant) merged.set(d.value, (merged.get(d.value) || 0) + d.count);
    return [...merged.entries()]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [options.districts, filters.city]);

  const audienceOptions: MultiOption[] = options.audiences.map((a) => ({
    value: a.value,
    label: a.value,
    count: a.count,
  }));

  const typeOptions: MultiOption[] = options.types.map((t) => ({
    value: t.value,
    label: t.value,
    count: t.count,
  }));

  const active = countActiveFilters(filters);

  return (
    <>
      <div className="toolbar">
        <div className="field" style={{ flex: '2 1 220px' }}>
          <label className="label">Buscar</label>
          <input
            className="input"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Nome, WhatsApp, protocolo, pauta…"
          />
        </div>

        <MultiSelect
          label="Status"
          options={statusOptions}
          selected={filters.status}
          onChange={(v) => set('status', v)}
          emptyHint="Sem solicitações"
        />

        <MultiSelect
          label="Tipo"
          options={typeOptions}
          selected={filters.type}
          onChange={(v) => set('type', v)}
          emptyHint="Sem tipos"
        />

        <div className="field" style={{ flex: '1 1 140px' }}>
          <label className="label">De</label>
          <input className="input" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label className="label">Até</label>
          <input className="input" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </div>

        <MultiSelect
          label="Cidade"
          options={cityOptions}
          selected={filters.city}
          onChange={(v) =>
            // Ao trocar a cidade, descarta bairros que não pertencem mais à seleção.
            setFilters({
              ...filters,
              city: v,
              district: filters.district.filter((d) =>
                options.districts.some(
                  (od) =>
                    od.value === d && (v.length === 0 || v.some((c) => c.toLowerCase() === od.city.toLowerCase()))
                )
              ),
            })
          }
          allLabel="Todas"
          emptyHint="Sem cidades"
        />

        <MultiSelect
          label="Bairro"
          options={districtOptions}
          selected={filters.district}
          onChange={(v) => set('district', v)}
          emptyHint="Sem bairros"
        />

        <MultiSelect
          label="Público"
          options={audienceOptions}
          selected={filters.audience}
          onChange={(v) => set('audience', v)}
          emptyHint="Sem registros"
        />

        <button className="btn btn-ghost btn-sm" onClick={() => setFilters(EMPTY_FILTERS)} disabled={active === 0}>
          Limpar
        </button>
      </div>

      {active > 0 && <ActiveFilters filters={filters} setFilters={setFilters} />}
    </>
  );
}

function ActiveFilters({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const chips: { key: string; label: string; remove: () => void }[] = [];

  const listKeys: { key: 'status' | 'city' | 'district' | 'audience'; prefix: string }[] = [
    { key: 'status', prefix: 'Status' },
    { key: 'city', prefix: 'Cidade' },
    { key: 'district', prefix: 'Bairro' },
    { key: 'audience', prefix: 'Público' },
  ];

  for (const { key, prefix } of listKeys) {
    for (const v of filters[key]) {
      chips.push({
        key: `${key}:${v}`,
        label: `${prefix}: ${key === 'status' ? STATUS_LABELS[v as Status] || v : v}`,
        remove: () => setFilters({ ...filters, [key]: filters[key].filter((x) => x !== v) }),
      });
    }
  }
  if (filters.from) {
    chips.push({
      key: 'from',
      label: `De ${formatDateBR(filters.from)}`,
      remove: () => setFilters({ ...filters, from: '' }),
    });
  }
  if (filters.to) {
    chips.push({
      key: 'to',
      label: `Até ${formatDateBR(filters.to)}`,
      remove: () => setFilters({ ...filters, to: '' }),
    });
  }
  if (filters.q) {
    chips.push({
      key: 'q',
      label: `Busca: ${filters.q}`,
      remove: () => setFilters({ ...filters, q: '' }),
    });
  }

  return (
    <div className="filters-summary">
      <span>Filtros ativos:</span>
      {chips.map((c) => (
        <span className="filter-chip" key={c.key}>
          {c.label}
          <button onClick={c.remove} aria-label={`Remover ${c.label}`}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/* ------------------------ prévia da mensagem ------------------------ */

function WhatsAppModal({
  preview,
  onClose,
  onSwitchKind,
}: {
  preview: WaPreview;
  onClose: () => void;
  onSwitchKind: (kind: WaKind) => void;
}) {
  const toast = useToast();
  const { item, kind, message, phone } = preview;
  const link = whatsappUrl(phone, message);

  return (
    <Modal
      title={
        kind === 'confirm'
          ? 'Mensagem de confirmação'
          : kind === 'reschedule'
            ? 'Mensagem de remarcação'
            : 'Mensagem de retorno'
      }
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-ghost"
            onClick={() => {
              void navigator.clipboard.writeText(message);
              toast.ok('Mensagem copiada.');
            }}
          >
            Copiar texto
          </button>
          <a className="btn btn-whats" href={link} target="_blank" rel="noreferrer" onClick={onClose}>
            <Icon.Whats />
            Abrir WhatsApp
          </a>
        </>
      }
    >
      <p className="hint" style={{ marginBottom: 10 }}>
        Enviando para <strong>{item.requester_name}</strong> · {maskPhone(item.whatsapp)}. O WhatsApp abre com o
        texto pronto — basta tocar em enviar.
      </p>
      <div className="msg-preview">{message}</div>
      <div className="seg" style={{ marginTop: 14 }}>
        <button className={kind === 'confirm' ? 'active' : ''} onClick={() => onSwitchKind('confirm')}>
          Confirmação
        </button>
        <button className={kind === 'reschedule' ? 'active' : ''} onClick={() => onSwitchKind('reschedule')}>
          Remarcação
        </button>
        <button className={kind === 'reject' ? 'active' : ''} onClick={() => onSwitchKind('reject')}>
          Recusa
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------- detalhe / ações ---------------------------- */

function RequestModal({
  item,
  onClose,
  onChanged,
  onDeleted,
  onWhats,
  onReschedule,
}: {
  item: AgendaRequest;
  onClose: () => void;
  onChanged: (r: AgendaRequest) => void;
  onDeleted: (id: string) => void;
  onWhats: (item: AgendaRequest, kind?: WaKind) => Promise<void>;
  onReschedule: (item: AgendaRequest) => void;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(item.admin_notes || '');
  const [tipo, setTipo] = useState(item.event_type || '');
  const [material, setMaterial] = useState(item.needs_material ? 'sim' : 'nao');
  const [equipe, setEquipe] = useState(item.team_size != null ? String(item.team_size) : '');

  /** Salva tipo, material e equipe — permite completar solicitações antigas. */
  async function saveExtras() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { needs_material: material === 'sim' };
      if (tipo) payload.event_type = tipo;
      const n = Number(equipe);
      if (equipe && n >= 1 && n <= 500) payload.team_size = n;
      const res = await api.patch<{ item: AgendaRequest }>(`/admin/requests/${item.id}`, payload);
      onChanged(res.item);
      toast.ok('Dados da atividade atualizados.');
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Cria um evento com lista de presença a partir desta solicitação. */
  async function gerarEvento() {
    setBusy(true);
    try {
      const res = await api.post<{ item: EventItem }>('/admin/events', { request_id: item.id });
      toast.ok('Evento criado! Ajuste os detalhes e copie o link de inscrição.');
      navigate('/admin/eventos', { state: { open: res.item } });
    } catch (e) {
      toast.err((e as Error).message);
      setBusy(false);
    }
  }

  async function changeStatus(status: Status) {
    setBusy(true);
    try {
      const res = await api.patch<{ item: AgendaRequest; warnings: string[] }>(`/admin/requests/${item.id}`, {
        status,
        admin_notes: notes,
      });
      onChanged(res.item);
      toast.ok(`Status alterado para ${STATUS_LABELS[status]}.`);
      res.warnings?.forEach((w) => toast.err(w));
      if (status === 'confirmado') await onWhats(res.item, 'confirm');
      if (status === 'recusado') await onWhats(res.item, 'reject');
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    setBusy(true);
    try {
      const res = await api.patch<{ item: AgendaRequest }>(`/admin/requests/${item.id}`, { admin_notes: notes });
      onChanged(res.item);
      toast.ok('Observações salvas.');
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Excluir definitivamente a solicitação ${item.protocol}?`)) return;
    setBusy(true);
    try {
      await api.del(`/admin/requests/${item.id}`);
      toast.ok('Solicitação excluída.');
      onDeleted(item.id);
    } catch (e) {
      toast.err((e as Error).message);
      setBusy(false);
    }
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(item))}`;

  return (
    <Modal
      title={`${item.protocol} · ${item.requester_name}`}
      onClose={onClose}
      wide
      footer={
        <>
          {can('admin') && (
            <button className="btn btn-danger btn-sm" onClick={() => void remove()} disabled={busy}>
              <Icon.Trash />
              Excluir
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-ghost"
            onClick={() => {
              onClose();
              onReschedule(item);
            }}
            disabled={busy}
          >
            <Icon.Reschedule />
            Reagendar
          </button>
          <button className="btn btn-whats" onClick={() => void onWhats(item)} disabled={busy}>
            <Icon.Whats />
            Mensagem
          </button>
          {(item.status === 'confirmado' || item.status === 'realizado') && (
            <button className="btn btn-ghost" onClick={() => void gerarEvento()} disabled={busy}>
              <Icon.Group />
              Gerar evento
            </button>
          )}
          {item.status !== 'confirmado' && (
            <button className="btn btn-primary" onClick={() => void changeStatus('confirmado')} disabled={busy}>
              <Icon.Check />
              Confirmar agenda
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatusBadge status={item.status} />
        <span className="cell-soft">Recebida em {formatDateTimeBR(item.created_at)}</span>
        {item.google_event_link && (
          <a className="cell-soft" href={item.google_event_link} target="_blank" rel="noreferrer">
            Ver no Google Agenda ↗
          </a>
        )}
      </div>

      <div className="section-title">Evento</div>
      <div className="detail-grid">
        <Detail k="Data" v={`${formatDateBR(item.event_date)} (${weekdayLong(item.event_date)})`} />
        <Detail k="Início" v={item.start_time} />
        <Detail
          k="Duração"
          v={`${durationLabel(item.duration_hours)} — término ${addHours(item.start_time, item.duration_hours)}`}
        />
        <Detail k="Chegada da equipe" v={item.arrival_time} />
        <Detail k="Público estimado" v={item.audience} />
        <Detail k="Tipo de evento" v={item.event_type || 'Não informado'} />
        <Detail k="Material de divulgação" v={item.needs_material ? 'Sim' : 'Não'} />
        <Detail k="Pessoas na equipe" v={item.team_size != null ? String(item.team_size) : '—'} />
      </div>

      <div className="section-title">Solicitante</div>
      <div className="detail-grid">
        <Detail k="Nome" v={item.requester_name} />
        <Detail k="WhatsApp" v={maskPhone(item.whatsapp)} />
      </div>

      <div className="section-title">Local</div>
      <div className="detail-grid">
        <Detail k="Endereço" v={formatAddress(item)} />
        {item.reference && <Detail k="Referência" v={item.reference} />}
      </div>
      <a className="btn btn-ghost btn-sm" href={mapsUrl} target="_blank" rel="noreferrer">
        <Icon.Pin />
        Abrir no Google Maps
      </a>

      <div className="section-title">Pauta / briefing</div>
      <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>{item.agenda}</p>

      <div className="section-title">Gestão</div>
      <div className="field">
        <label className="label">Alterar status</label>
        <div className="chips">
          {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
            <button
              key={s}
              className="chip"
              aria-pressed={item.status === s}
              disabled={busy}
              onClick={() => void changeStatus(s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="label">Dados da atividade</label>
        <div className="grid-3">
          <div className="field" style={{ margin: 0 }}>
            <span className="hint">Tipo de evento</span>
            <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Não informado</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <span className="hint">Material de divulgação</span>
            <select className="select" value={material} onChange={(e) => setMaterial(e.target.value)}>
              <option value="nao">Não</option>
              <option value="sim">Sim</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <span className="hint">Pessoas na equipe</span>
            <input
              className="input"
              value={equipe}
              onChange={(e) => setEquipe(e.target.value.replace(/\D+/g, '').slice(0, 3))}
              placeholder="Ex.: 10"
              inputMode="numeric"
            />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => void saveExtras()} disabled={busy}>
            Salvar dados da atividade
          </button>
        </div>
      </div>

      <div className="field">
        <label className="label">Observações internas</label>
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => void saveNotes()} disabled={busy}>
            Salvar observações
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="detail-item">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}


/* --------------------------- reagendamento --------------------------- */

function RescheduleModal({
  item,
  onClose,
  onSaved,
}: {
  item: AgendaRequest;
  onClose: () => void;
  onSaved: (updated: AgendaRequest, avisar: boolean) => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(item.event_date);
  const [start, setStart] = useState(item.start_time);
  const [arrival, setArrival] = useState(item.arrival_time);
  const [duration, setDuration] = useState<number>(item.duration_hours || 1);
  const [confirmar, setConfirmar] = useState(item.status !== 'confirmado');
  const [busy, setBusy] = useState(false);

  const mudou = date !== item.event_date || start !== item.start_time;
  const jaConfirmada = item.status === 'confirmado' || item.status === 'realizado';

  async function salvar(avisar: boolean) {
    if (arrival > start) {
      toast.err('A chegada da equipe deve ser antes ou no mesmo horário do início.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        event_date: date,
        start_time: start,
        arrival_time: arrival,
        duration_hours: duration,
      };
      if (confirmar && !jaConfirmada) payload.status = 'confirmado';

      const res = await api.patch<{ item: AgendaRequest; warnings: string[] }>(
        `/admin/requests/${item.id}`,
        payload
      );
      res.warnings?.forEach((w) => toast.err(w));
      toast.ok(mudou ? 'Agenda reagendada.' : 'Horários atualizados.');
      onSaved(res.item, avisar);
    } catch (e) {
      toast.err((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Reagendar · ${item.requester_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-ghost" onClick={() => void salvar(false)} disabled={busy}>
            Salvar sem avisar
          </button>
          <button className="btn btn-whats" onClick={() => void salvar(true)} disabled={busy}>
            {busy ? <div className="spinner dark" /> : <Icon.Whats />}
            Salvar e enviar mensagem
          </button>
        </>
      }
    >
      <div className="alert alert-warn" style={{ marginBottom: 16 }}>
        <strong>Data atual:</strong> {formatDateBR(item.event_date)} ({weekdayLong(item.event_date)}) às{' '}
        {item.start_time} · <StatusBadge status={item.status} />
      </div>

      <div className="field">
        <label className="label">Nova data</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {date && <span className="hint">{weekdayLong(date)}</span>}
      </div>

      <div className="field">
        <div className="grid-2 keep">
          <div className="field">
            <label className="label">Horário de início</label>
            <input
              className="input"
              type="time"
              step={300}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Chegada da equipe</label>
            <input
              className="input"
              type="time"
              step={300}
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="field">
        <label className="label">Duração</label>
        <div className="chips">
          {DURATION_VALUES.map((h) => (
            <button
              key={h}
              type="button"
              className="chip"
              aria-pressed={duration === h}
              onClick={() => setDuration(h)}
            >
              {durationLabel(h)}
            </button>
          ))}
        </div>
        {start && (
          <span className="hint">
            Término previsto às <strong>{addHours(start, duration)}</strong>.
          </span>
        )}
      </div>

      {!jaConfirmada && (
        <div className="field">
          <label className="switch">
            <input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} />
            <span>Confirmar a agenda nesta nova data</span>
          </label>
          <span className="hint">
            Ao confirmar, o evento entra no Google Agenda automaticamente (se a conta estiver conectada).
          </span>
        </div>
      )}

      {jaConfirmada && (
        <div className="alert alert-ok">
          Esta agenda já está confirmada — ao salvar, o evento no Google Agenda é atualizado para a nova data.
        </div>
      )}
    </Modal>
  );
}

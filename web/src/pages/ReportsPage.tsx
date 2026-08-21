import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, downloadFile, STATUS_LABELS, type AgendaRequest, type Status } from '../api';
import {
  Icon,
  Modal,
  StatusBadge,
  addHours,
  durationLabel,
  formatAddress,
  formatDateBR,
  formatDateTimeBR,
  maskCep,
  maskPhone,
  useToast,
  weekdayLong,
} from '../ui';
import {
  EMPTY_FILTERS,
  EMPTY_OPTIONS,
  FiltersBar,
  buildQuery,
  type FilterOptions,
  type Filters,
} from './RequestsPage';

/** Uma coluna por campo do formulário — a tela espelha exatamente a planilha exportada. */
interface Column {
  key: string;
  header: string;
  value: (r: AgendaRequest) => string;
  width?: number;
  clamp?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'protocol', header: 'Protocolo', value: (r) => r.protocol, width: 120 },
  { key: 'status', header: 'Status', value: (r) => STATUS_LABELS[r.status], width: 115 },
  { key: 'event_date', header: 'Data do evento', value: (r) => formatDateBR(r.event_date), width: 120 },
  { key: 'weekday', header: 'Dia da semana', value: (r) => weekdayLong(r.event_date), width: 110 },
  { key: 'start_time', header: 'Início', value: (r) => r.start_time, width: 80 },
  { key: 'end_time', header: 'Término', value: (r) => addHours(r.start_time, r.duration_hours), width: 85 },
  { key: 'duration', header: 'Duração', value: (r) => durationLabel(r.duration_hours), width: 130 },
  { key: 'arrival_time', header: 'Chegada', value: (r) => r.arrival_time, width: 90 },
  { key: 'requester_name', header: 'Solicitante', value: (r) => r.requester_name, width: 190 },
  { key: 'whatsapp', header: 'WhatsApp', value: (r) => maskPhone(r.whatsapp), width: 140 },
  { key: 'cep', header: 'CEP', value: (r) => (r.cep ? maskCep(r.cep) : '—'), width: 110 },
  { key: 'street', header: 'Rua / Avenida', value: (r) => r.street || '—', width: 190 },
  { key: 'number', header: 'Número', value: (r) => r.number || '—', width: 90 },
  { key: 'complement', header: 'Complemento', value: (r) => r.complement || '—', width: 150 },
  { key: 'district', header: 'Bairro', value: (r) => r.district || '—', width: 150 },
  { key: 'city', header: 'Cidade', value: (r) => r.city || '—', width: 150 },
  { key: 'state', header: 'UF', value: (r) => r.state || '—', width: 60 },
  { key: 'reference', header: 'Ponto de referência', value: (r) => r.reference || '—', width: 190, clamp: true },
  { key: 'audience', header: 'Público estimado', value: (r) => r.audience, width: 165 },
  { key: 'agenda', header: 'Pauta / briefing', value: (r) => r.agenda, width: 260, clamp: true },
  {
    key: 'admin_notes',
    header: 'Observações internas',
    value: (r) => r.admin_notes || '—',
    width: 220,
    clamp: true,
  },
  { key: 'created_at', header: 'Recebida em', value: (r) => formatDateTimeBR(r.created_at), width: 150 },
  {
    key: 'confirmed_at',
    header: 'Confirmada em',
    value: (r) => (r.confirmed_at ? formatDateTimeBR(r.confirmed_at) : '—'),
    width: 150,
  },
  {
    key: 'google',
    header: 'Google Agenda',
    value: (r) => (r.google_event_link ? 'Sincronizada' : '—'),
    width: 135,
  },
];

export default function ReportsPage() {
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<AgendaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<FilterOptions>(EMPTY_OPTIONS);
  const [detail, setDetail] = useState<AgendaRequest | null>(null);
  const [view, setView] = useState<'respostas' | 'resumo'>('respostas');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: AgendaRequest[] }>(`/admin/requests${buildQuery(filters)}`);
      setItems(res.items);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api
      .get<FilterOptions>('/admin/options')
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  const summary = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byCity: Record<string, number> = {};
    const byDistrict: Record<string, number> = {};
    const byAudience: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    const byWeekday: Record<string, number> = {};
    let hours = 0;

    for (const r of items) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      const city = r.city || 'Não informada';
      byCity[city] = (byCity[city] || 0) + 1;
      const district = r.district || 'Não informado';
      byDistrict[district] = (byDistrict[district] || 0) + 1;
      byAudience[r.audience] = (byAudience[r.audience] || 0) + 1;
      const month = r.event_date.slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
      const wd = weekdayLong(r.event_date);
      byWeekday[wd] = (byWeekday[wd] || 0) + 1;
      if (r.status === 'confirmado' || r.status === 'realizado') hours += r.duration_hours;
    }

    const top = (o: Record<string, number>, n = 8): [string, number][] =>
      Object.entries(o)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);

    return {
      byStatus,
      topCities: top(byCity),
      topDistricts: top(byDistrict),
      topAudiences: top(byAudience),
      topWeekdays: top(byWeekday, 7),
      months: Object.entries(byMonth).sort((a, b) => (a[0] > b[0] ? 1 : -1)) as [string, number][],
      hours,
    };
  }, [items]);

  async function exportXlsx() {
    try {
      await downloadFile(`/admin/export.xlsx${buildQuery(filters)}`, 'relatorio-agenda.xlsx');
      toast.ok('Planilha gerada com os filtros aplicados.');
    } catch (e) {
      toast.err((e as Error).message);
    }
  }

  const maxOf = (rows: [string, number][]) => Math.max(1, ...rows.map(([, n]) => n));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="page-sub">
            {loading ? 'Carregando…' : `${items.length} resposta(s) · todos os campos do formulário`}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <div className="seg">
          <button className={view === 'respostas' ? 'active' : ''} onClick={() => setView('respostas')}>
            Respostas
          </button>
          <button className={view === 'resumo' ? 'active' : ''} onClick={() => setView('resumo')}>
            Resumo
          </button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => void exportXlsx()}>
          <Icon.Download />
          Exportar Excel
        </button>
      </div>

      <FiltersBar filters={filters} setFilters={setFilters} options={options} />

      {loading ? (
        <div className="loading-page">
          <div className="spinner dark" />
        </div>
      ) : items.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">📊</div>
          <p>Nenhuma resposta encontrada com os filtros atuais.</p>
        </div>
      ) : view === 'resumo' ? (
        <div className="summary-grid">
          <div className="card">
            <div className="section-title">Totais</div>
            <div className="stats" style={{ marginBottom: 0 }}>
              <div className="stat">
                <b>{items.length}</b>
                <span>Respostas</span>
              </div>
              {(Object.keys(STATUS_LABELS) as Status[])
                .filter((s) => summary.byStatus[s])
                .map((s) => (
                  <div className={`stat ${s}`} key={s}>
                    <b>{summary.byStatus[s]}</b>
                    <span>{STATUS_LABELS[s]}</span>
                  </div>
                ))}
              <div className="stat confirmado">
                <b>{summary.hours}h</b>
                <span>Horas de agenda</span>
              </div>
            </div>
          </div>

          <Panel
            title="Agendas por mês"
            rows={summary.months.map(([m, n]) => [monthLabel(m), n] as [string, number])}
            max={maxOf(summary.months)}
          />
          <Panel title="Principais cidades" rows={summary.topCities} max={maxOf(summary.topCities)} />
          <Panel title="Principais bairros" rows={summary.topDistricts} max={maxOf(summary.topDistricts)} />
          <Panel title="Público estimado" rows={summary.topAudiences} max={maxOf(summary.topAudiences)} />
          <Panel title="Dia da semana" rows={summary.topWeekdays} max={maxOf(summary.topWeekdays)} />
        </div>
      ) : (
        <>
          <p className="hint" style={{ margin: '-6px 0 12px' }}>
            Todos os campos do formulário, um por coluna — as mesmas da planilha exportada. Role a tabela na
            horizontal, ou clique em uma linha para abrir a resposta completa.
          </p>

          <div className="table-wrap table-viewport">
            <table className="table-full">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} style={{ minWidth: c.width }}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} onClick={() => setDetail(r)} style={{ cursor: 'pointer' }}>
                    {COLUMNS.map((c) => {
                      const v = c.value(r);
                      return (
                        <td key={c.key} className={c.key === 'protocol' ? 'cell-strong' : 'cell-soft'}>
                          {c.key === 'status' ? (
                            <StatusBadge status={r.status} />
                          ) : c.clamp ? (
                            <div className="cell-clamp" title={v} style={{ maxWidth: c.width }}>
                              {v}
                            </div>
                          ) : (
                            v
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-list">
            {items.map((r) => (
              <button className="req-card" key={r.id} onClick={() => setDetail(r)} style={{ textAlign: 'left' }}>
                <div className="req-card-top">
                  <div>
                    <h3>{r.requester_name}</h3>
                    <div className="cell-soft">
                      {r.protocol} · {formatDateBR(r.event_date)} · {r.start_time}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="cell-soft">Toque para ver a resposta completa</div>
              </button>
            ))}
          </div>
        </>
      )}

      {detail && <ResponseModal item={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

/** Resposta individual com todos os campos — equivale à visão individual do Google Forms. */
function ResponseModal({ item, onClose }: { item: AgendaRequest; onClose: () => void }) {
  return (
    <Modal title={`${item.protocol} · resposta completa`} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <StatusBadge status={item.status} />
        <span className="cell-soft">Recebida em {formatDateTimeBR(item.created_at)}</span>
      </div>

      <div className="section-title">Dados do solicitante</div>
      <div className="detail-grid">
        <Item k="Nome completo" v={item.requester_name} />
        <Item k="WhatsApp" v={maskPhone(item.whatsapp)} />
      </div>

      <div className="section-title">Data e horários</div>
      <div className="detail-grid">
        <Item k="Data do evento" v={`${formatDateBR(item.event_date)} (${weekdayLong(item.event_date)})`} />
        <Item k="Horário de início" v={item.start_time} />
        <Item k="Duração" v={durationLabel(item.duration_hours)} />
        <Item k="Término previsto" v={addHours(item.start_time, item.duration_hours)} />
        <Item k="Horário para chegada" v={item.arrival_time} />
      </div>

      <div className="section-title">Endereço do evento</div>
      <div className="detail-grid">
        <Item k="CEP" v={item.cep ? maskCep(item.cep) : '—'} />
        <Item k="Rua / Avenida" v={item.street || '—'} />
        <Item k="Número" v={item.number || '—'} />
        <Item k="Complemento" v={item.complement || '—'} />
        <Item k="Bairro" v={item.district || '—'} />
        <Item k="Cidade" v={item.city || '—'} />
        <Item k="UF" v={item.state || '—'} />
        <Item k="Ponto de referência" v={item.reference || '—'} />
      </div>
      <a
        className="btn btn-ghost btn-sm"
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(item))}`}
        target="_blank"
        rel="noreferrer"
      >
        <Icon.Pin />
        Abrir no Google Maps
      </a>

      <div className="section-title">Sobre a atividade</div>
      <div className="detail-grid">
        <Item k="Público estimado" v={item.audience} />
      </div>
      <div className="detail-item" style={{ marginTop: 12 }}>
        <div className="k">Pauta / briefing</div>
        <div className="v" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {item.agenda}
        </div>
      </div>

      <div className="section-title">Gestão interna</div>
      <div className="detail-grid">
        <Item k="Confirmada em" v={item.confirmed_at ? formatDateTimeBR(item.confirmed_at) : '—'} />
        <Item k="Última alteração" v={formatDateTimeBR(item.updated_at)} />
        <Item k="Google Agenda" v={item.google_event_link ? 'Sincronizada' : 'Não sincronizada'} />
      </div>
      <div className="detail-item" style={{ marginTop: 12 }}>
        <div className="k">Observações internas</div>
        <div className="v" style={{ whiteSpace: 'pre-wrap' }}>
          {item.admin_notes || '—'}
        </div>
      </div>
      {item.google_event_link && (
        <a
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 14 }}
          href={item.google_event_link}
          target="_blank"
          rel="noreferrer"
        >
          Ver evento no Google Agenda
        </a>
      )}
    </Modal>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="detail-item">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function Panel({ title, rows, max }: { title: string; rows: [string, number][]; max: number }) {
  return (
    <div className="card">
      <div className="section-title">{title}</div>
      {rows.length === 0 ? (
        <p className="cell-soft">Sem dados no período.</p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {rows.map(([label, value]) => (
            <Bar key={label} label={label} value={value} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', marginBottom: 4 }}>
        <span style={{ textTransform: 'capitalize' }}>{label}</span>
        <strong>{value}</strong>
      </div>
      <div style={{ background: 'var(--blue-50)', borderRadius: 999, height: 9, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.round((value / max) * 100)}%`,
            height: '100%',
            background: 'linear-gradient(90deg, var(--navy-400), var(--navy))',
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}

function monthLabel(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

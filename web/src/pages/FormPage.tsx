import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type FormConfig } from '../api';
import { DURATION_VALUES, Icon, arrivalSlots, durationLabel, maskCep, maskPhone, onlyDigits, todayISO } from '../ui';

interface FormData {
  requester_name: string;
  whatsapp: string;
  event_date: string;
  start_time: string;
  duration_hours: number;
  arrival_time: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  reference: string;
  audience: string;
  agenda: string;
}

const EMPTY: FormData = {
  requester_name: '',
  whatsapp: '',
  event_date: '',
  start_time: '',
  duration_hours: 1,
  arrival_time: '',
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  reference: '',
  audience: '',
  agenda: '',
};

type Errors = Partial<Record<keyof FormData, string>>;

/** Texto do solicitante entra sempre em caixa alta — o servidor reforça a mesma regra. */
const UPPERCASE_FIELDS: ReadonlySet<keyof FormData> = new Set([
  'requester_name',
  'street',
  'number',
  'complement',
  'district',
  'city',
  'state',
  'reference',
  'agenda',
]);

function toUpper(value: string): string {
  return value.toUpperCase();
}

export default function FormPage() {
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [data, setData] = useState<FormData>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [done, setDone] = useState<{ protocol: string; message: string } | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [bgOk, setBgOk] = useState(true);
  const numberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<FormConfig>('/public/form')
      .then(setConfig)
      .catch(() => setGlobalError('Não foi possível carregar o formulário. Recarregue a página.'));
  }, []);

  useEffect(() => {
    if (!config?.backgroundUrl) return;
    const img = new Image();
    img.onload = () => setBgOk(true);
    img.onerror = () => setBgOk(false);
    img.src = config.backgroundUrl;
  }, [config?.backgroundUrl]);

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    const normalized =
      typeof value === 'string' && UPPERCASE_FIELDS.has(key) ? (toUpper(value) as FormData[K]) : value;
    setData((prev) => {
      const next = { ...prev, [key]: normalized };
      // Mudar o início invalida uma chegada que tenha ficado depois dele.
      if (key === 'start_time' && next.arrival_time && next.arrival_time > String(normalized)) {
        next.arrival_time = '';
      }
      return next;
    });
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const endTime = useMemo(
    () => (data.start_time ? addHoursLocal(data.start_time, data.duration_hours) : ''),
    [data.start_time, data.duration_hours]
  );

  async function lookupCep(raw: string) {
    const cep = onlyDigits(raw);
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const json = (await res.json()) as {
        erro?: boolean | string;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (json.erro) {
        setErrors((p) => ({ ...p, cep: 'CEP não encontrado. Preencha o endereço manualmente.' }));
        return;
      }
      setData((prev) => ({
        ...prev,
        street: toUpper(json.logradouro || prev.street),
        district: toUpper(json.bairro || prev.district),
        city: toUpper(json.localidade || prev.city),
        state: toUpper(json.uf || prev.state),
      }));
      setErrors((p) => ({ ...p, cep: undefined, street: undefined, city: undefined }));
      setTimeout(() => numberRef.current?.focus(), 120);
    } catch {
      setErrors((p) => ({ ...p, cep: 'Não foi possível consultar o CEP. Preencha manualmente.' }));
    } finally {
      setCepLoading(false);
    }
  }

  function validate(): boolean {
    const e: Errors = {};
    if (data.requester_name.trim().length < 3) e.requester_name = 'Informe o nome completo';
    const phone = onlyDigits(data.whatsapp);
    if (phone.length < 10 || phone.length > 11) e.whatsapp = 'Informe o WhatsApp com DDD';
    if (!data.event_date) e.event_date = 'Selecione a data do evento';
    else if (data.event_date < todayISO()) e.event_date = 'A data não pode ser no passado';
    if (!data.start_time) e.start_time = 'Informe o horário de início';
    if (!data.arrival_time) e.arrival_time = 'Informe o horário de chegada';
    else if (data.start_time && data.arrival_time > data.start_time)
      e.arrival_time = 'A chegada deve ser antes ou no mesmo horário do início';
    if (data.street.trim().length < 3) e.street = 'Informe a rua / avenida';
    if (!data.number.trim()) e.number = 'Informe o número';
    if (data.city.trim().length < 2) e.city = 'Informe a cidade';
    if (!data.audience) e.audience = 'Selecione o público estimado';
    if (data.agenda.trim().length < 10) e.agenda = 'Descreva a pauta com pelo menos 10 caracteres';
    setErrors(e);
    if (Object.keys(e).length) {
      const first = document.querySelector('.input.error, .select.error, .textarea.error, [data-error="true"]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setGlobalError('');
    if (!validate()) return;
    setSending(true);
    try {
      const res = await api.post<{ protocol: string; successMessage: string }>('/public/requests', {
        ...data,
        whatsapp: onlyDigits(data.whatsapp),
        cep: onlyDigits(data.cep),
      });
      setDone({ protocol: res.protocol, message: res.successMessage || config?.successMessage || '' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setGlobalError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const bgStyle = bgOk && config?.backgroundUrl ? ({ '--form-bg': `url("${config.backgroundUrl}")` } as React.CSSProperties) : undefined;

  if (!config) {
    return (
      <div className="loading-page">
        <div className="spinner dark" />
        <span>Carregando formulário…</span>
      </div>
    );
  }

  if (done) {
    return (
      <div className="form-shell" style={bgStyle}>
        <div className="form-container">
          <div className="card card-head success-box">
            <div className="success-icon">
              <Icon.Check />
            </div>
            <h1 className="form-title" style={{ fontSize: '1.4rem' }}>
              Solicitação enviada!
            </h1>
            <p className="form-description" style={{ textAlign: 'center' }}>
              {done.message}
            </p>
            <div className="protocol">Protocolo {done.protocol}</div>
            <div style={{ marginTop: 26 }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setDone(null);
                  setData(EMPTY);
                }}
              >
                Enviar outra solicitação
              </button>
            </div>
          </div>
          <footer className="form-footer">
            <p className="footer-brand">Seu voto é + saúde para sua família</p>
            <Link className="admin-link" to="/login">
              <Icon.Lock />
              Área restrita da equipe
            </Link>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="form-shell" style={bgStyle}>
      <div className="form-container">
        <div className={`card card-head ${config.headerImageUrl ? 'has-banner' : ''}`}>
          {config.headerImageUrl && (
            <img
              className="form-banner"
              src={config.headerImageUrl}
              alt="Daniel Soranz 5588, deputado federal, e Eduardo Paes 55, governador — seu voto é + saúde para sua família"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          )}
          <h1 className="form-title">{config.title}</h1>
          <p className="form-description">{config.description}</p>
          <div className="form-note">* Indica uma pergunta obrigatória</div>
        </div>

        {!config.open && (
          <div className="card">
            <div className="alert alert-warn">
              O formulário está temporariamente fechado para novas solicitações. Tente novamente mais tarde.
            </div>
          </div>
        )}

        {globalError && (
          <div className="card">
            <div className="alert alert-error">{globalError}</div>
          </div>
        )}

        <form onSubmit={submit} noValidate>
          {/* --------------------------- solicitante --------------------------- */}
          <div className="card">
            <div className="section-title">Dados do solicitante</div>

            <div className="field">
              <label className="label" htmlFor="nome">
                Nome completo do solicitante<span className="req">*</span>
              </label>
              <input
                id="nome"
                className={`input ${errors.requester_name ? 'error' : ''}`}
                value={data.requester_name}
                onChange={(e) => set('requester_name', e.target.value)}
                placeholder="DIGITE SEU NOME COMPLETO"
                autoComplete="name"
                maxLength={150}
              />
              {errors.requester_name && <span className="error-text">{errors.requester_name}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="whats">
                WhatsApp do solicitante<span className="req">*</span>
              </label>
              <span className="hint">O retorno sobre a agenda será feito por este número.</span>
              <input
                id="whats"
                className={`input ${errors.whatsapp ? 'error' : ''}`}
                value={data.whatsapp}
                onChange={(e) => set('whatsapp', maskPhone(e.target.value))}
                placeholder="(21) 99999-9999"
                inputMode="tel"
                autoComplete="tel-national"
              />
              {errors.whatsapp && <span className="error-text">{errors.whatsapp}</span>}
            </div>
          </div>

          {/* ----------------------------- evento ----------------------------- */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Data e horários</div>

            <div className="field">
              <label className="label" htmlFor="data">
                Data do evento<span className="req">*</span>
              </label>
              <input
                id="data"
                type="date"
                className={`input ${errors.event_date ? 'error' : ''}`}
                value={data.event_date}
                min={todayISO()}
                onChange={(e) => set('event_date', e.target.value)}
              />
              {errors.event_date && <span className="error-text">{errors.event_date}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="inicio">
                Horário de início do evento<span className="req">*</span>
              </label>
              <input
                id="inicio"
                type="time"
                className={`input ${errors.start_time ? 'error' : ''}`}
                value={data.start_time}
                onChange={(e) => set('start_time', e.target.value)}
                step={300}
              />
              {errors.start_time && <span className="error-text">{errors.start_time}</span>}
            </div>

            <div className="field" data-error={errors.duration_hours ? 'true' : 'false'}>
              <label className="label">
                Duração<span className="req">*</span>
              </label>
              <div className="chips">
                {DURATION_VALUES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    className="chip"
                    aria-pressed={data.duration_hours === h}
                    onClick={() => set('duration_hours', h)}
                  >
                    {durationLabel(h)}
                  </button>
                ))}
              </div>
              {endTime && (
                <span className="hint">
                  {data.duration_hours >= 4 ? (
                    <>
                      Término a combinar — a equipe reserva a partir das <strong>{endTime}</strong>.
                    </>
                  ) : (
                    <>
                      Término previsto às <strong>{endTime}</strong>.
                    </>
                  )}
                </span>
              )}
            </div>

            <div className="field">
              <label className="label" htmlFor="chegada">
                Horário de chegada da equipe<span className="req">*</span>
              </label>
              <span className="hint">
                {data.start_time
                  ? 'Quanto antes do evento a equipe deve chegar ao local.'
                  : 'Informe primeiro o horário de início do evento.'}
              </span>
              <select
                id="chegada"
                className={`select ${errors.arrival_time ? 'error' : ''}`}
                value={data.arrival_time}
                onChange={(e) => set('arrival_time', e.target.value)}
                disabled={!data.start_time}
              >
                <option value="">
                  {data.start_time ? 'Selecione…' : 'Escolha o horário de início primeiro'}
                </option>
                {arrivalSlots(data.start_time).map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}
              </select>
              {errors.arrival_time && <span className="error-text">{errors.arrival_time}</span>}
            </div>
          </div>

          {/* ----------------------------- endereço ----------------------------- */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Endereço do evento</div>

            <div className="field">
              <label className="label" htmlFor="cep">
                CEP
              </label>
              <span className="hint">Digite o CEP e o endereço será preenchido automaticamente.</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  id="cep"
                  className={`input ${errors.cep ? 'error' : ''}`}
                  value={data.cep}
                  onChange={(e) => {
                    const v = maskCep(e.target.value);
                    set('cep', v);
                    if (onlyDigits(v).length === 8) void lookupCep(v);
                  }}
                  onBlur={(e) => void lookupCep(e.target.value)}
                  placeholder="00000-000"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  style={{ maxWidth: 180 }}
                />
                {cepLoading && <div className="spinner dark" />}
              </div>
              {errors.cep && <span className="error-text">{errors.cep}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="rua">
                Rua / Avenida<span className="req">*</span>
              </label>
              <input
                id="rua"
                className={`input ${errors.street ? 'error' : ''}`}
                value={data.street}
                onChange={(e) => set('street', e.target.value)}
                placeholder="EX.: AV. PRESIDENTE VARGAS"
                autoComplete="address-line1"
              />
              {errors.street && <span className="error-text">{errors.street}</span>}
            </div>

            <div className="field">
              <div className="grid-2 keep grid-num">
                <div className="field">
                  <label className="label" htmlFor="numero">
                    Número<span className="req">*</span>
                  </label>
                  <input
                    id="numero"
                    ref={numberRef}
                    className={`input ${errors.number ? 'error' : ''}`}
                    value={data.number}
                    onChange={(e) => set('number', e.target.value)}
                    placeholder="123"
                    inputMode="numeric"
                  />
                  {errors.number && <span className="error-text">{errors.number}</span>}
                </div>
                <div className="field">
                  <label className="label" htmlFor="compl">
                    Complemento
                  </label>
                  <input
                    id="compl"
                    className="input"
                    value={data.complement}
                    onChange={(e) => set('complement', e.target.value)}
                    placeholder="SALA, BLOCO, ANDAR…"
                  />
                </div>
              </div>
            </div>

            <div className="field">
              <div className="grid-3 grid-addr">
                <div className="field">
                  <label className="label" htmlFor="bairro">
                    Bairro
                  </label>
                  <input
                    id="bairro"
                    className="input"
                    value={data.district}
                    onChange={(e) => set('district', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="cidade">
                    Cidade<span className="req">*</span>
                  </label>
                  <input
                    id="cidade"
                    className={`input ${errors.city ? 'error' : ''}`}
                    value={data.city}
                    onChange={(e) => set('city', e.target.value)}
                  />
                  {errors.city && <span className="error-text">{errors.city}</span>}
                </div>
                <div className="field">
                  <label className="label" htmlFor="uf">
                    UF
                  </label>
                  <input
                    id="uf"
                    className="input"
                    value={data.state}
                    onChange={(e) => set('state', e.target.value.slice(0, 2))}
                    maxLength={2}
                    placeholder="RJ"
                  />
                </div>
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="ref">
                Ponto de referência
              </label>
              <input
                id="ref"
                className="input"
                value={data.reference}
                onChange={(e) => set('reference', e.target.value)}
                placeholder="EX.: EM FRENTE À PRAÇA, AO LADO DA UPA…"
              />
            </div>
          </div>

          {/* ------------------------------ público ------------------------------ */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="section-title">Sobre a atividade</div>

            <div className="field">
              <label className="label" htmlFor="publico">
                Público estimado<span className="req">*</span>
              </label>
              <select
                id="publico"
                className={`select ${errors.audience ? 'error' : ''}`}
                value={data.audience}
                onChange={(e) => set('audience', e.target.value)}
              >
                <option value="">Selecione…</option>
                {config.audienceOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              {errors.audience && <span className="error-text">{errors.audience}</span>}
            </div>

            <div className="field">
              <label className="label" htmlFor="pauta">
                Pauta ou briefing da agenda<span className="req">*</span>
              </label>
              <span className="hint">
                Conte o objetivo do encontro, quem estará presente e o que se espera da participação.
              </span>
              <textarea
                id="pauta"
                className={`textarea ${errors.agenda ? 'error' : ''}`}
                value={data.agenda}
                onChange={(e) => set('agenda', e.target.value)}
                maxLength={4000}
                placeholder="DESCREVA A PAUTA DA AGENDA…"
              />
              {errors.agenda && <span className="error-text">{errors.agenda}</span>}
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={sending || !config.open}>
                {sending && <div className="spinner" />}
                {sending ? 'Enviando…' : 'Enviar solicitação'}
              </button>
              <span className="hint">Nunca envie senhas pelo formulário.</span>
            </div>
          </div>
        </form>

        <footer className="form-footer">
          <p className="footer-brand">Seu voto é + saúde para sua família</p>
          <Link className="admin-link" to="/login">
            <Icon.Lock />
            Área restrita da equipe
          </Link>
        </footer>
      </div>
    </div>
  );
}

function addHoursLocal(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + hours * 60;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

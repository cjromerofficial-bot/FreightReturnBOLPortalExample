import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import RouteMap from './RouteMap.jsx';

// three.js is only downloaded when step 2 is shown.
const PalletScene = lazy(() => import('./PalletScene.jsx'));
import { api, docUrl, newId, remember } from './api.js';
import {
  validateShipment, validatePickup, prefillPallets, palletWeight, suggestClass, autoClass, densityPcf, totals,
  quoteInputs, todayIso, isWeekend, nextBusinessDay, earliestPickupDate, accessorialList, ACCESSORIAL_LABELS,
} from '../lib/freight.mjs';

const TIPS = {
  liftgate: 'A powered platform on the back of the truck that lowers the pallet to the ground. Homes almost never have a loading dock, so residential pickups need it.',
  limited: 'Use for places that are hard for a big truck to reach or enter, such as schools, churches, military bases, storage units, or gated communities.',
  inside: 'The driver comes inside (e.g., a garage) to get the freight instead of picking it up at the curb. Extra charge.',
  nmfc: 'The National Motor Freight Classification number for the product. Acme equipment uses 015520 plus a "sub" (like -07) based on density.',
  class: 'A number (50 to 500) that tells R+L how costly the freight is to move. Denser freight gets a lower class and a cheaper rate.',
  density: 'Weight divided by cubic feet (L×W×H in inches ÷ 1728). Freight class for Acme equipment is based on density.',
  window: 'Acme always books return pickups 1–5 PM. By then the driver has unloaded most deliveries and has room for our pallets, so the pickup is less likely to be refused.',
  dates: "R+L needs 2 business days' notice and doesn't pick up on weekends. Ask the customer for 1–3 days they can be home to hand the driver the BOL.",
  residential: 'R+L charges extra to pick up at a home. Leave this on for residential addresses so the quote and BOL match what R+L will bill.',
  pro: 'R+L\'s tracking number for this shipment. It goes on the BOL, labels, and the RMA.',
};

function Tip({ k }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="tip">
      <button type="button" className="linkish" onClick={() => setOpen(!open)} aria-expanded={open}>What's this?</button>
      {open && <span className="tip-body" role="note">{TIPS[k]}</span>}
    </span>
  );
}

function Copy({ value, label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="copy" onClick={async () => { try { await navigator.clipboard.writeText(String(value)); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}>
      {done ? 'Copied ✓' : `Copy${label ? ' ' + label : ''}`}
    </button>
  );
}

const Step = ({ n, title, children, disabled, done }) => (
  <section id={`step-${n}`} className={`step ${disabled ? 'disabled' : ''} ${done ? 'done' : ''}`} aria-disabled={disabled}>
    <h2><span className="num">{done ? '✓' : n}</span>{title}</h2>
    {!disabled && children}
  </section>
);

export const REPO_URL = 'https://github.com/cjromerofficial-bot/FreightReturnBOLPortalExample';

/** Slim header link for the portfolio demo. */
const AboutBar = () => (
  <div className="about-bar">
    <a href={REPO_URL} target="_blank" rel="noreferrer">About This Project ↗</a>
    <span className="hint">Portfolio demo · all data is fake</span>
  </div>
);

const money = (n) => `$${Number(n).toFixed(2)}`;

/** Counts up to a dollar amount (skipped when the user prefers reduced motion). */
function CountUp({ value }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    const start = performance.now(), dur = 700;
    let raf;
    const tick = (t) => { const k = Math.min(1, (t - start) / dur); setShown(value * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{money(shown)}</>;
}

const RAIL = ['Find RMA', 'Pallets', 'Destination & dates', 'Quote', 'Pickup', 'Create BOL'];
const RAIL_ITEM = 72; // px per checkpoint (keep in sync with .rail li height in styles.css)

/** Top-down R+L truck (bird's-eye, shaded so it reads as 3D). Faces down the road. */
function TruckTop() {
  return (
    <svg viewBox="0 0 30 62" width="30" height="62" aria-hidden="true">
      <defs>
        <linearGradient id="roof" x1="0" x2="1"><stop offset="0" stopColor="#f8fafc" /><stop offset=".55" stopColor="#e2e8f0" /><stop offset="1" stopColor="#94a3b8" /></linearGradient>
        <linearGradient id="cab" x1="0" x2="1"><stop offset="0" stopColor="#3b82f6" /><stop offset="1" stopColor="#1e3a8a" /></linearGradient>
      </defs>
      <rect x="4" y="2" width="22" height="40" rx="2.5" fill="url(#roof)" stroke="#64748b" strokeWidth="1" />
      <text x="15" y="25" fontSize="6.5" fontWeight="800" textAnchor="middle" fill="#1e3a8a" transform="rotate(90 15 22)">R+L</text>
      <rect x="11" y="42" width="8" height="3" fill="#334155" />
      <rect x="5" y="45" width="20" height="15" rx="4" fill="url(#cab)" stroke="#1e3a8a" strokeWidth="1" />
      <rect x="7.5" y="53" width="15" height="4.5" rx="1.5" fill="#bfdbfe" opacity=".9" />
      <rect x="2" y="47" width="3" height="5" rx="1" fill="#111827" /><rect x="25" y="47" width="3" height="5" rx="1" fill="#111827" />
      <rect x="2" y="6" width="3" height="6" rx="1" fill="#111827" /><rect x="25" y="6" width="3" height="6" rx="1" fill="#111827" />
      <rect x="2" y="30" width="3" height="6" rx="1" fill="#111827" /><rect x="25" y="30" width="3" height="6" rx="1" fill="#111827" />
    </svg>
  );
}

/**
 * Vertical progress "road" on the left: a truck drives down to the step the rep is on.
 * Sticky, so it stays in view while scrolling. Click a checkpoint to jump to that step.
 * On narrow screens it becomes a compact horizontal bar (CSS).
 */
function ProgressRail({ done }) {
  const allDone = done.every(Boolean);
  const current = allDone ? done.length - 1 : done.findIndex((d) => !d);
  const [moving, setMoving] = useState(false);
  const prev = useRef(current);
  useEffect(() => {
    if (prev.current === current) return;
    prev.current = current;
    setMoving(true);
    const t = setTimeout(() => setMoving(false), 900);
    return () => clearTimeout(t);
  }, [current]);
  const y = current * RAIL_ITEM + RAIL_ITEM / 2 - 31;
  return (
    <nav className="rail" aria-label={`Progress: step ${current + 1} of ${RAIL.length}, ${RAIL[current]}`}>
      <div className="road" aria-hidden="true">
        <div className="road-done" style={{ height: `${current * RAIL_ITEM + RAIL_ITEM / 2}px` }} />
        <div className={`truck-top ${moving ? 'moving' : ''} ${allDone ? 'arrived' : ''}`} style={{ transform: `translate(-50%, ${y}px)` }}><TruckTop /></div>
      </div>
      <ol>
        {RAIL.map((label, i) => (
          <li key={label} className={done[i] ? 'done' : i === current ? 'current' : ''}>
            <button type="button" onClick={() => document.getElementById(`step-${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span className="dot">{done[i] ? '✓' : i + 1}</span>
              <span className="lbl">{label}{i === 4 && <em> (optional)</em>}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** First screen: who is creating this BOL? (Printed on the documents and saved in history.) */
function NameGate({ initial, onDone }) {
  const [name, setName] = useState(initial || '');
  const ok = name.trim().length >= 2;
  return (
    <div className="gate">
      <AboutBar />
      <form className="gate-card" onSubmit={(e) => { e.preventDefault(); if (ok) onDone(name.trim()); }}>
        <div className="gate-truck"><TruckTop /></div>
        <h1>Freight Returns BOL</h1>
        <p className="sub">Create the BOL, packing list and labels for an R+L freight return in about 2 minutes.</p>
        <label>Your name <span className="req" aria-hidden="true">*</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" autoFocus required aria-required="true" maxLength={60} />
        </label>
        <p className="hint">It's printed on the BOL and saved with the shipment history. We'll remember it on this computer.</p>
        <button className="primary big" disabled={!ok}>Start a return</button>
      </form>
    </div>
  );
}

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [rep, setRep] = useState(() => remember('repName'));
  const [rmaInput, setRmaInput] = useState('');
  const [lookup, setLookup] = useState(null);
  const [lookupErr, setLookupErr] = useState('');
  const [busy, setBusy] = useState('');
  const [shipment, setShipment] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteKey, setQuoteKey] = useState('');
  const [quoteErr, setQuoteErr] = useState('');
  const [checklist, setChecklist] = useState({});
  const [result, setResult] = useState(null);
  const [submitErr, setSubmitErr] = useState(null);
  const [askName, setAskName] = useState(false); // re-open the name screen ("Change")
  const [view, setView] = useState('new'); // 'new' | 'history'
  const [replacing, setReplacing] = useState(null); // voided BOL being corrected via Duplicate & edit
  const submitting = useRef(false);
  const submissionId = useRef(newId());

  const loadConfig = () => api('api/config').then((c) => { setCfg(c); if (c.user) setRep(c.user); }).catch((e) => e.needsLogin && setNeedsLogin(true));
  useEffect(() => { loadConfig(); }, []);

  const lines = lookup?.rma.lines || [];
  const check = useMemo(() => (shipment && lookup ? validateShipment(shipment, lookup, { skipPickup: true }) : { errors: [], warnings: [] }), [shipment, lookup]);
  const pickupCheck = useMemo(() => validatePickup(shipment?.pickup), [shipment]);
  const currentKey = useMemo(() => (shipment && lookup ? JSON.stringify(quoteInputs(shipment, lookup)) : ''), [shipment, lookup]);
  const quoteValid = quote && quoteKey === currentKey && Date.parse(quote.expiresAt) > Date.now();
  // Progress rail: pallets are "done" when only destination/date are still missing.
  const palletsOk = useMemo(() => (shipment && lookup
    ? validateShipment({ ...shipment, destination: 'CA', pickupDate: earliestPickupDate(todayIso()), altDates: [] }, lookup, { skipPickup: true }).errors.length === 0
    : false), [shipment, lookup]);
  const stepDone = [!!lookup && !lookup.existingBol, palletsOk, palletsOk && check.errors.length === 0, !!quoteValid, !!quoteValid && pickupCheck.errors.length === 0, !!result];

  // Any change to a quote input invalidates the quote and the checklist.
  useEffect(() => {
    if (quote && quoteKey !== currentKey) { setQuote(null); setChecklist({}); submissionId.current = newId(); }
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setLookup(null); setShipment(null); setQuote(null); setChecklist({}); setResult(null); setSubmitErr(null);
    setLookupErr(''); setQuoteErr(''); setReplacing(null); submissionId.current = newId(); submitting.current = false;
  }

  async function doLookup(e) {
    e.preventDefault();
    reset();
    await loadRma(rmaInput);
  }

  /** Look up the RMA and build the form. `prefill` = a voided BOL's saved input (Duplicate & edit). */
  async function loadRma(rmaNumber, prefill) {
    setBusy('lookup');
    try {
      const data = await api('api/lookup', { rmaNumber });
      setLookup(data);
      const today = todayIso();
      const fresh = {
        rmaNumber: data.rma.number,
        destination: '',
        accessorials: { residential: !!data.customer.residential, liftgate: !!data.customer.residential, limitedAccess: false, insidePickup: false },
        altDates: [],
        pickupDate: earliestPickupDate(today),
        pickup: { schedule: false, contactName: data.customer.attn || data.customer.name, contactPhone: data.customer.phone, instructions: '' },
        pallets: prefillPallets(data),
      };
      setShipment(prefill ? {
        ...fresh, ...prefill, rmaNumber: data.rma.number,
        // Dates from the voided BOL are kept only if still allowed (2 business days' notice, weekdays).
        pickupDate: prefill.pickupDate >= earliestPickupDate(today) && !isWeekend(prefill.pickupDate) ? prefill.pickupDate : earliestPickupDate(today),
        altDates: (prefill.altDates || []).filter((d) => d >= earliestPickupDate(today) && !isWeekend(d)),
        pickup: prefill.pickup || fresh.pickup,
      } : fresh);
    } catch (err) {
      if (err.needsLogin) setNeedsLogin(true);
      setLookupErr(err.message);
    } finally { setBusy(''); }
  }

  const upd = (patch) => setShipment((s) => ({ ...s, ...patch }));
  // Class/NMFC re-fill from the density table whenever size or items change (unless edited by hand).
  const updPallet = (i, patch) => setShipment((s) => ({ ...s, pallets: s.pallets.map((p, j) => (j === i ? autoClass({ ...p, ...patch }, lines) : p)) }));
  const setQty = (i, lineId, qty) => setShipment((s) => ({
    ...s,
    pallets: s.pallets.map((p, j) => {
      if (j !== i) return p;
      const items = p.items.filter((x) => x.lineId !== lineId);
      return autoClass({ ...p, items: qty > 0 ? [...items, { lineId, qty }] : items }, lines);
    }),
  }));
  const addPallet = () => setShipment((s) => ({
    ...s,
    pallets: [...s.pallets, { id: newId(), type: 'Pallet', length: '', width: '', height: '', freightClass: '', nmfc: '', classManual: false, items: [] }],
  }));
  const removePallet = (i) => setShipment((s) => ({ ...s, pallets: s.pallets.filter((_, j) => j !== i) }));

  async function getQuote() {
    setQuoteErr(''); setBusy('quote');
    try {
      const q = await api('api/quote', { shipment, repName: rep });
      setQuote(q); setQuoteKey(currentKey); setChecklist({});
    } catch (err) { setQuoteErr(err.message); } finally { setBusy(''); }
  }

  async function createBol() {
    if (submitting.current) return; // double-click guard (server also de-dupes by submissionId)
    submitting.current = true; setBusy('bol'); setSubmitErr(null);
    try {
      const rec = await api('api/create-bol', { shipment, quoteNumber: quote.quoteNumber, submissionId: submissionId.current, repName: rep, checklist, replaces: replacing || undefined });
      setResult(rec);
    } catch (err) {
      setSubmitErr(err);
      // Only allow another click when the server says nothing was created.
      if (!err.unknown && !err.existingBol && !err.inProgress) submitting.current = false;
    } finally { setBusy(''); }
  }

  /** After a BOL is voided in History: reopen the form prefilled from it. */
  async function startDuplicate(voidedRec) {
    reset();
    setView('new');
    setRmaInput(voidedRec.rmaNumber);
    await loadRma(voidedRec.rmaNumber, voidedRec.input);
    setReplacing(voidedRec.bolNumber);
  }

  if (needsLogin) return <Login onDone={() => { setNeedsLogin(false); loadConfig(); }} />;
  if (!cfg) return <div className="wrap"><p>Loading…</p></div>;
  // Name first: it's required on every BOL, so ask for it before showing the form (skipped when the hub signs the rep in).
  if (!cfg.user && (!rep.trim() || askName)) return <NameGate initial={rep} onDone={(n) => { setRep(remember('repName', n)); setAskName(false); }} />;

  const allChecked = ['address', 'items', 'dimensions', 'freightClass', 'destination'].every((k) => checklist[k]);
  const t = shipment ? totals(shipment, lines) : null;

  return (
    <div className="wrap">
      <AboutBar />
      {cfg.mock && (
        <div className="mock-banner">
          MOCK MODE: NetSuite data is {cfg.modes.netsuite === 'live' ? 'LIVE' : 'fake'}; R+L is {cfg.modes.rl === 'live' ? 'LIVE (real quotes)' : cfg.modes.rl === 'sandbox' ? 'the R+L sandbox' : 'fake'}. Nothing here is a real shipment.
        </div>
      )}
      <header className="top">
        <div>
          <h1>Freight Returns BOL</h1>
          <p className="sub">R+L Carriers return: RMA → quote → BOL. Follow the steps in order.</p>
        </div>
        <nav className="tabs" aria-label="Pages">
          <button className={view === 'new' ? 'tab on' : 'tab'} onClick={() => setView('new')}>New return</button>
          <button className={view === 'history' ? 'tab on' : 'tab'} onClick={() => setView('history')}>History</button>
        </nav>
        <div className="rep-chip" title="Printed on the BOL">
          <span className="k">CS rep</span> <strong>{rep}</strong>
          {!cfg.user && <button type="button" className="linkish" onClick={() => setAskName(true)}>Change</button>}
        </div>
      </header>

      {view === 'history' ? <History rep={rep} onDuplicate={startDuplicate} /> : (
        <div className="layout">
          <ProgressRail done={result ? RAIL.map(() => true) : stepDone} />
          <div className="main">
          {result ? <Results rec={result} rep={rep} onNew={() => { reset(); setRmaInput(''); }} /> : (
        <>
          <p className="req-note">Fields marked <span className="req">*</span> are required.</p>
          {replacing && (
            <div className="warn" role="status">
              <strong>Correcting voided BOL {replacing}.</strong> Everything is filled in from it. Fix what was wrong, get a new quote, and create the replacement BOL.
            </div>
          )}
          <Step n={1} title="Find the return" done={stepDone[0]}>
            <form onSubmit={doLookup} className="row">
              <label>RMA number <span className="req" aria-hidden="true">*</span>
                <input value={rmaInput} onChange={(e) => setRmaInput(e.target.value)} placeholder="e.g. RMA100001" autoFocus />
              </label>
              <button className="primary" disabled={!rmaInput.trim() || busy === 'lookup'}>{busy === 'lookup' ? 'Looking up…' : 'Look up RMA'}</button>
            </form>
            {lookupErr && <p className="error" role="alert">{lookupErr}</p>}
            {lookup && <Customer lookup={lookup} />}
            {lookup?.existingBol && (
              <div className="error" role="alert">
                <strong>This RMA already has a BOL</strong>
                {lookup.existingBol.status === 'created'
                  ? <> (PRO {lookup.existingBol.proNumber}, created by {lookup.existingBol.repName}). Don't create another one. <a href={docUrl(lookup.existingBol.bolNumber, 'bundle')}>Reprint the documents</a>, or to correct it use <button className="linkish" onClick={() => setView('history')}>Duplicate &amp; edit in History</button>.</>
                  : <>: status "{lookup.existingBol.status}". Ask a lead to check R+L before doing anything else.</>}
              </div>
            )}
          </Step>

          <Step n={2} title="Pallets, weights & freight class" done={stepDone[1]} disabled={!shipment || lookup?.existingBol}>
            {shipment && <Pallets {...{ shipment, lines, cfg, updPallet, setQty, addPallet, removePallet }} setPallets={(pallets) => upd({ pallets })} guess={() => prefillPallets(lookup)} />}
          </Step>

          <Step n={3} title="Destination, pickup date & extras" done={stepDone[2]} disabled={!shipment || lookup?.existingBol}>
            {shipment && (
              <div className="grid3">
                <fieldset>
                  <legend>Where is it going? <span className="req" aria-hidden="true">*</span></legend>
                  {cfg.warehouses.map((w) => (
                    <label key={w.key} className="radio">
                      <input type="radio" name="dest" checked={shipment.destination === w.key} onChange={() => upd({ destination: w.key })} />
                      {w.label}{!w.confirmed && <em className="ph">&nbsp;(address is a placeholder)</em>}
                    </label>
                  ))}
                </fieldset>
                <PickupDates shipment={shipment} upd={upd} window={cfg.freight.pickupWindow} />
                <fieldset>
                  <legend>Pickup extras</legend>
                  <label className="check"><input type="checkbox" checked={shipment.accessorials.residential} onChange={(e) => upd({ accessorials: { ...shipment.accessorials, residential: e.target.checked } })} /> Residential pickup <Tip k="residential" /></label>
                  {lookup.customer.residential && <p className="hint">NetSuite marks this as a residential address, so this is on by default.</p>}
                  <label className="check"><input type="checkbox" checked={shipment.accessorials.liftgate} onChange={(e) => upd({ accessorials: { ...shipment.accessorials, liftgate: e.target.checked } })} /> Liftgate <Tip k="liftgate" /></label>
                  {shipment.accessorials.residential && !shipment.accessorials.liftgate && <p className="warn">Residential pickups almost always need a liftgate. Only turn it off if the customer has a loading dock.</p>}
                  <label className="check"><input type="checkbox" checked={shipment.accessorials.limitedAccess} onChange={(e) => upd({ accessorials: { ...shipment.accessorials, limitedAccess: e.target.checked } })} /> Limited access <Tip k="limited" /></label>
                  <label className="check"><input type="checkbox" checked={shipment.accessorials.insidePickup} onChange={(e) => upd({ accessorials: { ...shipment.accessorials, insidePickup: e.target.checked } })} /> Inside pickup <Tip k="inside" /></label>
                </fieldset>
              </div>
            )}
          </Step>

          <Step n={4} title="Get the R+L quote" done={stepDone[3]} disabled={!shipment || lookup?.existingBol}>
            {shipment && (
              <>
                {check.errors.length > 0 && (
                  <div className="todo"><strong>Before you can get a quote:</strong><ul>{check.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
                )}
                {check.warnings.length > 0 && <ul className="warn-list">{check.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
                <button className="primary" onClick={getQuote} disabled={check.errors.length > 0 || busy === 'quote' || !rep}>
                  {busy === 'quote' ? 'Getting quote…' : quoteValid ? 'Get a new quote' : 'Get Quote'}
                </button>
                {quoteErr && <p className="error" role="alert">{quoteErr}</p>}
                {quoteValid && (
                  <div className="charge">
                    <div className="charge-label">Deduct this from the customer's refund on the RMA</div>
                    <div className="charge-amt"><CountUp value={quote.totalCharge} /> <Copy value={quote.totalCharge.toFixed(2)} label="amount" /></div>
                    <div className="charge-meta">R+L quote #{quote.quoteNumber} <Copy value={quote.quoteNumber} /> · expires {new Date(quote.expiresAt).toLocaleString()}</div>
                    <details><summary>Charge breakdown</summary><ul>{quote.charges.map((c) => <li key={c.label}>{c.label}: {money(c.amount)}</li>)}</ul></details>
                  </div>
                )}
                {!quoteValid && quote === null && quoteKey && <p className="warn">You changed something, so the old quote no longer applies. Get a new quote.</p>}
              </>
            )}
          </Step>

          <Step n={5} title="Schedule R+L pickup (optional)" disabled={!shipment || lookup?.existingBol}>
            {shipment && <PickupForm pickup={shipment.pickup} onChange={(pickup) => upd({ pickup })} />}
            {pickupCheck.errors.map((e) => <p key={e} className="error">{e}</p>)}
            {pickupCheck.warnings.map((w) => <p key={w} className="warn">⚠ {w}</p>)}
          </Step>

          <Step n={6} title="Review & create the BOL" disabled={!quoteValid}>
            {quoteValid && (
              <>
                <div className="summary">
                  <p>
                    <strong>{lookup.customer.name}</strong> in {lookup.customer.city}, {lookup.customer.state} is returning{' '}
                    <strong>{t.qty} item{t.qty === 1 ? '' : 's'}</strong> on <strong>{t.pallets} {t.pallets === 1 ? 'pallet' : 'pallets'}</strong>{' '}
                    ({t.weightLb} lb total) to <strong>{cfg.warehouses.find((w) => w.key === shipment.destination)?.label}</strong>.
                    R+L picks up on <strong>{shipment.pickupDate}</strong>
                    {accessorialList(shipment, lookup.customer).length > 0 && <> with {accessorialList(shipment, lookup.customer).map((a) => ACCESSORIAL_LABELS[a]).join(', ')}</>}.
                    The customer will be charged <strong>{money(quote.totalCharge)}</strong>.
                  </p>
                </div>
                <fieldset className="checklist">
                  <legend>Tick each box after you've checked it <span className="req" aria-hidden="true">*</span></legend>
                  {[
                    ['address', `Customer pickup address is correct (${lookup.customer.address1}, ${lookup.customer.city})`],
                    ['items', `Item count is correct (${t.qty} items on RMA ${lookup.rma.number})`],
                    ['dimensions', 'Pallet dimensions and weights are confirmed'],
                    ['freightClass', 'Freight class and NMFC are confirmed'],
                    ['destination', `Destination warehouse is correct (${shipment.destination})`],
                  ].map(([k, label]) => (
                    <label key={k} className="check"><input type="checkbox" checked={!!checklist[k]} onChange={(e) => setChecklist({ ...checklist, [k]: e.target.checked })} /> {label}</label>
                  ))}
                </fieldset>
                <button className="primary big" onClick={createBol} disabled={!allChecked || pickupCheck.errors.length > 0 || busy === 'bol' || submitting.current}>
                  {busy === 'bol' ? 'Creating BOL… don\'t close this page' : 'Create BOL'}
                </button>
                {submitErr && (
                  <div className="error" role="alert">
                    {submitErr.message}
                    {submitErr.existingBol && <> <a href={docUrl(submitErr.existingBol.bolNumber)}>Reprint the existing BOL</a></>}
                  </div>
                )}
              </>
            )}
          </Step>
        </>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

function Customer({ lookup }) {
  const c = lookup.customer;
  return (
    <div className="card">
      <div><span className="k">Customer</span> {c.name}{c.residential && <span className="pill">Residential</span>}</div>
      <div><span className="k">Pickup address</span> {c.address1}{c.address2 ? `, ${c.address2}` : ''}, {c.city}, {c.state} {c.zip}</div>
      <div><span className="k">Phone</span> {c.phone} · <span className="k">Email</span> {c.email}</div>
      <div><span className="k">Sales order</span> {lookup.salesOrder.number} · <span className="k">PO</span> {lookup.salesOrder.po || '—'}</div>
      {lookup.rma.memo && <div><span className="k">RMA memo</span> {lookup.rma.memo}</div>}
      <div className="hint">Prefilled from NetSuite. If the address is wrong, fix it in NetSuite and look up the RMA again.</div>
    </div>
  );
}

/**
 * "Drop the original BOL or packing list": exact container sizes (and, from a packing list,
 * which items were on each container). Optional; the smart guess is already filled in.
 */
function DocDrop({ rmaNumber, onPallets, onUndo, applied }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef(null);
  async function send(file) {
    if (!file) return;
    setErr(''); setBusy(true);
    try {
      const res = await fetch(`api/parse-doc?rma=${encodeURIComponent(rmaNumber)}`, { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: file, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'We couldn’t read that file.');
      onPallets(data, file.name);
    } catch (e) { setErr(e.message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  if (applied) {
    const d = applied.data;
    return (
      <div className="doc-applied" role="status">
        <div>
          <strong>Filled in from the original {d.kind === 'bol' ? 'BOL' : 'packing list'}</strong>{d.ifNumber && <> {d.ifNumber}</>}
          {d.pro && <> · original PRO {d.pro}</>} · {d.containers.length} container{d.containers.length === 1 ? '' : 's'}
          <span className="hint"> ({applied.name})</span>
        </div>
        {d.soMismatch && <div className="warn">This document is for sales order {d.salesOrder}, not this RMA's order. Double-check this.</div>}
        {d.unmatched?.length > 0 && <div className="warn">Not on the original {d.kind === 'bol' ? 'BOL' : 'packing list'}: {d.unmatched.join(', ')}. We put {d.unmatched.length === 1 ? 'it' : 'them'} on the biggest pallet. Move {d.unmatched.length === 1 ? 'it' : 'them'} if needed.</div>}
        {d.dropped > 0 && <div className="hint">{d.dropped} original container{d.dropped === 1 ? ' isn’t' : 's aren’t'} part of this return, so {d.dropped === 1 ? 'it was' : 'they were'} left out.</div>}
        <button type="button" className="linkish" onClick={onUndo}>Undo, go back to the suggested pallets</button>
      </div>
    );
  }
  return (
    <div
      className={`doc-drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files?.[0]); }}
    >
      <div>
        <strong>Have the original BOL or packing list?</strong> Drop the PDF here for exact sizes{' '}
        <span className="hint">(optional; the packing list also shows which items were on each pallet)</span>
      </div>
      <button type="button" className="small-btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Reading…' : 'Choose PDF'}</button>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => send(e.target.files?.[0])} />
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function Pallets({ shipment, lines, cfg, updPallet, setQty, addPallet, removePallet, setPallets, guess }) {
  const [applied, setApplied] = useState(null); // original document used to fill the pallets
  const assigned = (lineId) => shipment.pallets.reduce((s, p) => s + (p.items.find((x) => x.lineId === lineId)?.qty || 0), 0);
  const fr = cfg.freight;
  const [active, setActive] = useState(null);
  const weights = shipment.pallets.map((p) => palletWeight(p, lines));
  return (
    <>
      <Suspense fallback={<div className="scene scene-loading">Loading 3D view…</div>}>
        <PalletScene pallets={shipment.pallets} weights={weights} active={active} />
      </Suspense>
      <DocDrop rmaNumber={shipment.rmaNumber} applied={applied}
        onPallets={(data, name) => { setPallets(data.pallets); setApplied({ data, name }); }}
        onUndo={() => { setPallets(guess()); setApplied(null); }} />
      <p className="hint">{applied ? 'Sizes are from the original shipment.' : 'We guessed the pallets from the RMA items (see why on each one).'} If the customer is using a different pallet or crate, pick a common size or type the dimensions.</p>
      <table className="assign">
        <thead>
          <tr><th>Item on the RMA</th><th>RMA qty</th>{shipment.pallets.map((_, i) => <th key={i}>Pallet {i + 1}</th>)}<th>Left to assign</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const left = l.qty - assigned(l.lineId);
            return (
              <tr key={l.lineId}>
                <td><strong>{l.sku}</strong><br /><span className="hint">{l.description} · {l.unitWeightLb} lb each</span></td>
                <td>{l.qty}</td>
                {shipment.pallets.map((p, i) => (
                  <td key={i}>
                    <input type="number" min="0" max={l.qty} step="1" className="qty" aria-label={`${l.sku} on pallet ${i + 1}`}
                      value={p.items.find((x) => x.lineId === l.lineId)?.qty || 0}
                      onChange={(e) => setQty(i, l.lineId, Math.max(0, Math.min(l.qty, parseInt(e.target.value || '0', 10))))} />
                  </td>
                ))}
                <td className={left === 0 ? 'ok' : 'bad'}>{left === 0 ? '✓ all assigned' : left > 0 ? `${left} left` : `${-left} too many`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="pallets">
        {shipment.pallets.map((p, i) => {
          const wt = palletWeight(p, lines);
          const dims = [p.length, p.width, p.height].map(Number);
          const dens = dims.every((x) => x > 0) && wt > 0 ? densityPcf(wt, ...dims) : null;
          const sug = suggestClass(dens);
          return (
            <div className={active === i ? 'pallet on' : 'pallet'} key={p.id} onFocusCapture={() => setActive(i)} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
              <div className="pallet-head">
                <strong>{p.type === 'Crate' ? 'Crate' : 'Pallet'} {i + 1}</strong>
                <select value={p.type} onChange={(e) => updPallet(i, { type: e.target.value })} aria-label="Pallet or crate">
                  <option>Pallet</option><option>Crate</option>
                </select>
                {shipment.pallets.length > 1 && <button type="button" className="linkish" onClick={() => removePallet(i)}>Remove</button>}
              </div>
              {p.reason && <div className="reason"><span className="k">Why this size</span> {p.reason}</div>}
              <div className="presets" role="group" aria-label="Common sizes">
                {fr.palletPresets.map((ps) => (
                  <button type="button" key={ps.label}
                    className={p.length === ps.length && p.width === ps.width && p.height === ps.height && p.type === ps.type ? 'chip on' : 'chip'}
                    onClick={() => updPallet(i, { type: ps.type, length: ps.length, width: ps.width, height: ps.height, reason: 'Picked by you' })}>
                    {ps.label}
                  </button>
                ))}
              </div>
              <div className="dims">
                {['length', 'width', 'height'].map((k) => (
                  <label key={k}>{k[0].toUpperCase() + k.slice(1)} (in) <span className="req" aria-hidden="true">*</span>
                    <input type="number" min="1" value={p[k]} onChange={(e) => updPallet(i, { [k]: e.target.value === '' ? '' : Number(e.target.value), reason: 'Entered by you' })} />
                  </label>
                ))}
              </div>
              <div className="dens">
                Weight: <strong>{wt ? `${wt} lb` : '—'}</strong> <span className="hint">(from NetSuite item weights)</span>
                {' · '}Density <Tip k="density" />: <strong>{dens ? `${dens} lb/ft³` : '—'}</strong>
              </div>
              {!p.classManual ? (
                <div className={p.freightClass ? 'suggest ok-box' : 'suggest'}>
                  {p.freightClass
                    ? <>Class <strong>{p.freightClass}</strong> <Tip k="class" /> · NMFC <strong>{p.nmfc}</strong> <Tip k="nmfc" /> <span className="hint">(from Acme's density table)</span></>
                    : <>Enter the dimensions and the class fills in automatically.</>}
                  <button type="button" className="small-btn" onClick={() => updPallet(i, { classManual: true })}>Edit</button>
                </div>
              ) : (
                <div className="manual-box">
                  <div className="dims">
                    <label>Freight class <Tip k="class" />
                      <select value={p.freightClass} onChange={(e) => updPallet(i, { freightClass: e.target.value })}>
                        <option value="">Choose…</option>{fr.validClasses.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </label>
                    <label>NMFC <Tip k="nmfc" />
                      <input value={p.nmfc} placeholder={`${fr.nmfcBase}-07`} onChange={(e) => updPallet(i, { nmfc: e.target.value.trim() })} />
                    </label>
                  </div>
                  <p className="hint">
                    {sug && <>Acme's table suggests {sug.nmfc} / class {sug.freightClass}. </>}
                    <button type="button" className="linkish" onClick={() => updPallet(i, { classManual: false })}>Go back to the suggested class</button>
                    {' · '}<a href={fr.classToolUrl} target="_blank" rel="noreferrer">Class tool</a>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={addPallet} disabled={shipment.pallets.length >= fr.maxPallets}>+ Add another pallet or crate</button>
    </>
  );
}

/** Step 3: the customer's 1–3 available pickup days (first choice drives the quote, BOL and pickup). */
function PickupDates({ shipment, upd, window }) {
  const min = earliestPickupDate(todayIso());
  const alts = shipment.altDates || [];
  const setAlt = (i, v) => upd({ altDates: alts.map((d, j) => (j === i ? v : d)) });
  return (
    <fieldset>
      <legend>Customer's available days <Tip k="dates" /></legend>
      <p className="hint">Mon–Fri, earliest {min}. Pickup is always {window.label}.</p>
      <label>1st choice <span className="req" aria-hidden="true">*</span>
        <input type="date" value={shipment.pickupDate} min={min} onChange={(e) => upd({ pickupDate: e.target.value })} />
      </label>
      {alts.map((d, i) => (
        <label key={i}>{i === 0 ? '2nd' : '3rd'} choice <button type="button" className="linkish" onClick={() => upd({ altDates: alts.filter((_, j) => j !== i) })}>Remove</button>
          <input type="date" value={d} min={min} onChange={(e) => setAlt(i, e.target.value)} />
        </label>
      ))}
      {alts.length < 2 && <button type="button" className="small-btn" onClick={() => upd({ altDates: [...alts, ''] })}>+ Add another day</button>}
    </fieldset>
  );
}

function PickupForm({ pickup, onChange, showToggle = true }) {
  const set = (patch) => onChange({ ...pickup, ...patch });
  return (
    <>
      {showToggle && (
        <label className="check"><input type="checkbox" checked={pickup.schedule} onChange={(e) => set({ schedule: e.target.checked })} /> Schedule R+L pickup <span className="hint">&nbsp;(on the first-choice date; alternates are sent to R+L)</span></label>
      )}
      {(pickup.schedule || !showToggle) && (
        <div className="grid3">
          <div className="fixed-window"><span className="k">Pickup window</span><strong>1:00–5:00 PM</strong> customer's local time, Mon–Fri <Tip k="window" /></div>
          <label>Customer contact name <span className="req" aria-hidden="true">*</span>
            <input value={pickup.contactName} maxLength={50} onChange={(e) => set({ contactName: e.target.value })} />
          </label>
          <label>Customer phone <span className="req" aria-hidden="true">*</span>
            <input value={pickup.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} />
          </label>
          <label className="wide">Notes for the driver (optional)
            <input value={pickup.instructions} maxLength={200} placeholder="e.g. Pallet is in the garage, call 30 min before" onChange={(e) => set({ instructions: e.target.value })} />
          </label>
        </div>
      )}
    </>
  );
}

function Results({ rec: initial, onNew, rep }) {
  const [rec, setRec] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [later, setLater] = useState(null);
  const pu = rec.pickup || { status: 'not-requested' };

  async function retry(pickup) {
    if (busy) return;
    setBusy(true); setErr('');
    try { setRec(await api('api/retry-pickup', { bolNumber: rec.bolNumber, pickup, repName: rep })); setLater(null); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="step results">
      <div className="done-hero">
        <svg className="done-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M15 27 l7 7 l15 -16" /></svg>
        <div><h2>BOL created</h2><p className="sub">{rec.shipFrom.name} · {rec.rmaNumber} → {rec.shipTo.label || rec.shipTo.name}</p></div>
      </div>
      <RouteMap fromState={rec.shipFrom.state} fromCity={rec.shipFrom.city} toKey={rec.shipTo.key} toLabel={rec.shipTo.label || rec.shipTo.city} pickupDate={rec.pickupDate} serviceDays={rec.quote.serviceDays} />
      {rec.mock && <p className="warn">Mock mode: these numbers are not a real shipment.</p>}
      {rec.carrierWarning && <p className="warn">{rec.carrierWarning}</p>}
      <div className="result-grid">
        <div><span className="k">PRO # <Tip k="pro" /></span><div className="big">{rec.proNumber} <Copy value={rec.proNumber} /></div></div>
        <div><span className="k">Deduct from refund on the RMA</span><div className="big">{money(rec.quote.totalCharge)} <Copy value={rec.quote.totalCharge.toFixed(2)} /></div></div>
        <div><span className="k">R+L quote #</span><div>{rec.quote.quoteNumber} <Copy value={rec.quote.quoteNumber} /></div></div>
        <div><span className="k">BOL #</span><div>{rec.bolNumber} <Copy value={rec.bolNumber} /></div></div>
      </div>

      <div className="status-list">
        <div className="status ok">✓ Step 1: BOL created with R+L</div>
        {pu.status === 'scheduled' && <div className="status ok">✓ Step 2: Pickup scheduled for {rec.pickupDate}, 1:00–5:00 PM{rec.altDates?.length ? ` (customer also available ${rec.altDates.join(', ')})` : ''}. Pickup # <strong>{pu.id}</strong> <Copy value={pu.id} /></div>}
        {pu.status === 'failed' && (
          <div className="status bad">
            ✗ Step 2: Pickup NOT scheduled. {pu.error}<br />
            The BOL is fine and is kept. Only the pickup needs to be retried.
            <div><button className="primary small-btn" disabled={busy} onClick={() => retry()}>{busy ? 'Retrying…' : 'Retry pickup only'}</button></div>
          </div>
        )}
        {pu.status === 'unknown' && <div className="status bad">? Step 2: {pu.error}</div>}
        {pu.status === 'not-requested' && (
          <div className="status">
            Step 2: No R+L pickup requested.{' '}
            {!later && <button className="linkish" onClick={() => setLater({ schedule: true, contactName: rec.shipFrom.attn || rec.shipFrom.name, contactPhone: rec.shipFrom.phone, instructions: '' })}>Schedule it now</button>}
            {later && (
              <div className="later">
                <PickupForm pickup={later} onChange={setLater} showToggle={false} />
                <button className="primary small-btn" disabled={busy} onClick={() => retry(later)}>{busy ? 'Scheduling…' : 'Schedule pickup'}</button>
              </div>
            )}
          </div>
        )}
        <WriteBackStatus rec={rec} onChange={setRec} rep={rep} />
        {err && <div className="error" role="alert">{err}</div>}
      </div>

      <div className="downloads">
        <a className="primary big as-btn" href={docUrl(rec.bolNumber, 'bundle')}>Download all (PDF)</a>
        <div className="small-links">
          <a href={docUrl(rec.bolNumber, 'bol')}>BOL</a>
          <a href={docUrl(rec.bolNumber, 'packing')}>Packing list</a>
          <a href={docUrl(rec.bolNumber, 'labels4x6')}>Labels 4x6</a>
          <a href={docUrl(rec.bolNumber, 'labelsLetter')}>Labels (letter paper)</a>
        </div>
        <p className="hint">"Download all" has the BOL, the packing list, and one letter-size label per pallet, ready to email.</p>
      </div>

      <div className="next">
        <strong>Next steps</strong>
        <ol>
          <li>Email the "Download all" PDF to the customer ({rec.shipFrom.email}) using the saved freight-return response.</li>
          <li>On RMA {rec.rmaNumber}, deduct <strong>{money(rec.quote.totalCharge)}</strong> from the refund.</li>
          {rec.writeBack?.status !== 'saved' && <li>Add PRO {rec.proNumber}{pu.id ? ` and pickup # ${pu.id}` : ''} to the RMA (NetSuite save didn't work).</li>}
        </ol>
      </div>
      <button type="button" onClick={onNew}>Start another return</button>
    </section>
  );
}


/** Step 3 on the results page: was the PRO / pickup # saved to the RMA? */
function WriteBackStatus({ rec, onChange, rep }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const wb = rec.writeBack || { status: 'pending' };
  const pickupId = rec.pickup?.status === 'scheduled' ? rec.pickup.id : '';
  async function retry() {
    if (busy) return;
    setBusy(true); setErr('');
    try { onChange(await api('api/retry-writeback', { bolNumber: rec.bolNumber, repName: rep })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  if (wb.status === 'saved') {
    return <div className="status ok">✓ Step 3: Saved PRO {wb.pro}{wb.pickupId ? ` and pickup # ${wb.pickupId}` : ''} to RMA {rec.rmaNumber} in NetSuite.</div>;
  }
  return (
    <div className="status bad">
      ✗ Step 3: Couldn't save to RMA {rec.rmaNumber} in NetSuite. {wb.error}<br />
      <strong>Add these to the RMA manually:</strong> PRO {rec.proNumber} <Copy value={rec.proNumber} />
      {pickupId && <> · Pickup # {pickupId} <Copy value={pickupId} /></>}
      <div><button className="small-btn" disabled={busy} onClick={retry}>{busy ? 'Trying again…' : 'Try saving to NetSuite again'}</button></div>
      {err && <div>{err}</div>}
    </div>
  );
}

const badge = (cls, text) => <span className={`badge ${cls}`}>{text}</span>;

function History({ rep, onDuplicate }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [voiding, setVoiding] = useState(null);

  async function load(query) {
    setErr('');
    try { setRows(await api(`api/history?q=${encodeURIComponent(query)}`)); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { const t = setTimeout(() => load(q), 250); return () => clearTimeout(t); }, [q]);

  return (
    <section className="step">
      <h2>Shipment history</h2>
      <label>Search by RMA, PRO, BOL #, sales order, or customer
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. RMA100001 or Helms" autoFocus />
      </label>
      {err && <p className="error">{err}</p>}
      {rows && rows.length === 0 && <p className="hint">No returns found{q ? ` for "${q}"` : ' yet'}.</p>}
      <div className="hist">
        {rows?.map((r) => (
          <div key={r.bolNumber} className={`hist-row ${r.status === 'voided' ? 'voided' : ''}`}>
            <div className="hist-main">
              <div>
                <strong>{r.rmaNumber}</strong> · {r.customer} <span className="hint">({r.city} → {r.destination})</span>
              </div>
              <div className="hint">
                BOL {r.bolNumber} · PRO <strong>{r.proNumber}</strong> <Copy value={r.proNumber} /> · {money(r.amount)} · {r.pallets} pallet{r.pallets === 1 ? '' : 's'} · {new Date(r.createdAt).toLocaleString()} by {r.repName}
              </div>
              <div className="badges">
                {r.status === 'voided' ? badge('bad', 'Voided') : badge('ok', 'Active')}
                {r.pickup?.status === 'scheduled' && badge('ok', `Pickup #${r.pickup.id}`)}
                {r.pickup?.status === 'cancelled' && badge('', 'Pickup cancelled')}
                {r.pickup?.status === 'failed' && badge('bad', 'Pickup failed')}
                {r.pickup?.status === 'unknown' && badge('bad', 'Pickup unknown')}
                {r.status !== 'voided' && (r.writeBack?.status === 'saved' ? badge('ok', 'Saved to RMA') : badge('bad', 'Not saved to RMA'))}
                {r.replaces && badge('', `Replaces ${r.replaces}`)}
                {r.replacedBy && badge('', `Replaced by ${r.replacedBy}`)}
                {r.mock && badge('', 'Mock')}
              </div>
              {r.voidReason && <div className="hint">Void reason: {r.voidReason}</div>}
            </div>
            <div className="hist-actions">
              <a className="primary small-btn as-btn" href={docUrl(r.bolNumber, 'bundle')}>Reprint all</a>
              <details className="more">
                <summary>Single documents</summary>
                <a href={docUrl(r.bolNumber, 'bol')}>BOL</a>
                <a href={docUrl(r.bolNumber, 'packing')}>Packing list</a>
                <a href={docUrl(r.bolNumber, 'labels4x6')}>Labels 4x6</a>
                <a href={docUrl(r.bolNumber, 'labelsLetter')}>Labels (letter)</a>
              </details>
              {r.status !== 'voided' && !r.replacedBy && (
                <button className="small-btn" onClick={() => setVoiding(r)}>Duplicate &amp; edit</button>
              )}
            </div>
            {voiding?.bolNumber === r.bolNumber && (
              <VoidPanel row={r} rep={rep} onCancel={() => setVoiding(null)} onVoided={async (rec) => { setVoiding(null); await onDuplicate(rec); }} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Duplicate & edit": void the original (R+L has no BOL void API), then reopen the form prefilled. */
function VoidPanel({ row, rep, onCancel, onVoided }) {
  const [reason, setReason] = useState('');
  const [called, setCalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const { record } = await api('api/void-bol', { bolNumber: row.bolNumber, reason, confirmedRlVoid: called, repName: rep });
      await onVoided(record);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="void-panel">
      <strong>Make a corrected BOL for {row.rmaNumber}</strong>
      <ol>
        <li>Call R+L at <strong>800-543-5589</strong> and ask them to <strong>void PRO {row.proNumber}</strong> <Copy value={row.proNumber} />. R+L doesn't let us void BOLs online.</li>
        {row.pickup?.status === 'scheduled' && <li>We'll cancel R+L pickup #{row.pickup.id} for you automatically.</li>}
        <li>We'll open the form with everything filled in from this BOL. Fix what was wrong, get a new quote, and create the replacement.</li>
      </ol>
      <label>What needs correcting?
        <input value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong pallet size, should be 73x46x33" />
      </label>
      <label className="check"><input type="checkbox" checked={called} onChange={(e) => setCalled(e.target.checked)} /> I asked R+L to void PRO {row.proNumber}</label>
      <div className="row">
        <button className="primary" disabled={!called || !reason.trim() || busy} onClick={go}>{busy ? 'Voiding…' : 'Void this BOL and start the correction'}</button>
        <button onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="wrap narrow">
      <h1>Freight Returns BOL</h1>
      <form onSubmit={async (e) => { e.preventDefault(); try { await api('api/login', { password: pw }); onDone(); } catch (x) { setErr(x.message); } }}>
        <label>Portal password <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
        <button className="primary">Sign in</button>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  );
}

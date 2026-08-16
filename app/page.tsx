"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import tripSeed from "./data/trip-share.json";
import packingSeed from "./data/packing.json";

type Tab =
  | "today"
  | "itinerary"
  | "travel"
  | "lodging"
  | "cruise"
  | "tours"
  | "packing"
  | "connectivity"
  | "safety"
  | "vault"
  | "pending"
  | "home";
type PackingPerson = string;
type PackingItem = {
  id: string;
  person: PackingPerson;
  category: string;
  item: string;
  packIn: string;
  when: string;
  notes: string;
};
type SharedState = {
  checks: Record<string, boolean>;
  assignments: Record<string, string>;
  pending: Record<string, string>;
  syncedAt?: string;
};
type QueueItem =
  | { kind: "checklist"; payload: { id: string; checked: boolean } }
  | { kind: "assignment"; payload: { slot: number; person: string } }
  | { kind: "pending"; payload: { id: string; value: string } };

// The JSON seed intentionally contains heterogeneous records (for example,
// different fields for air, rail, lodging, and activity records).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseRecord = Record<string, any>;

type TripData = {
  identity: LooseRecord;
  travelers: LooseRecord[];
  airports: Record<string, string>;
  onward_steps: Record<string, string>;
  flights: LooseRecord[];
  ground_transport: LooseRecord[];
  lodging: LooseRecord[];
  cruise: LooseRecord;
  tours: LooseRecord[];
  connectivity: LooseRecord;
  safety_accessibility: LooseRecord;
  pending_updates: LooseRecord[];
  daily_plan: LooseRecord[];
  preparation_groups: Record<string, string[]>;
  demo_vault_groups: LooseRecord[];
};
const initialTrip = tripSeed as unknown as TripData;
const packing = packingSeed as Record<PackingPerson, PackingItem[]>;
const packingPeople = Object.keys(packing) as PackingPerson[];
const CACHE_KEY = "travel-reference-state-v1";
const QUEUE_KEY = "travel-reference-queue-v1";
const SHARE_CACHE_KEY = "travel-reference-share-state-v1";
const SHARE_QUEUE_KEY = "travel-reference-share-queue-v1";

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}
function mapUrl(value: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`;
}
function readableDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}
function clock(value?: string) {
  if (!value) return "Pending live update";
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return value;
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours >= 12 ? "PM" : "AM"}`;
}
function getQueue(shareMode: boolean): QueueItem[] {
  try {
    const queue = JSON.parse(
      localStorage.getItem(shareMode ? SHARE_QUEUE_KEY : QUEUE_KEY) || "[]",
    );
    return shareMode
      ? queue.filter((item: QueueItem) => item.kind === "checklist")
      : queue;
  } catch {
    return [];
  }
}
function setQueue(queue: QueueItem[], shareMode: boolean) {
  localStorage.setItem(
    shareMode ? SHARE_QUEUE_KEY : QUEUE_KEY,
    JSON.stringify(queue),
  );
}
function cachedState(shareMode: boolean): SharedState {
  try {
    const value = JSON.parse(
      localStorage.getItem(shareMode ? SHARE_CACHE_KEY : CACHE_KEY) || "{}",
    );
    return shareMode
      ? {
          checks: value.checks || {},
          assignments: {},
          pending: {},
          syncedAt: value.syncedAt,
        }
      : value;
  } catch {
    return { checks: {}, assignments: {}, pending: {} };
  }
}

function useSharedState(shareMode: boolean) {
  const [state, setState] = useState<SharedState>(() => {
    const local = cachedState(shareMode);
    return {
      checks: local.checks || {},
      assignments: local.assignments || {},
      pending: local.pending || {},
      syncedAt: local.syncedAt,
    };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queueSize, setQueueSize] = useState(() => getQueue(shareMode).length);

  const remember = useCallback((next: SharedState) => {
    const stored = shareMode
      ? { ...next, assignments: {}, pending: {} }
      : next;
    setState(stored);
    localStorage.setItem(
      shareMode ? SHARE_CACHE_KEY : CACHE_KEY,
      JSON.stringify(stored),
    );
  }, [shareMode]);

  const request = useCallback(async (item: QueueItem) => {
    const route =
      item.kind === "checklist"
        ? "/api/checklist"
        : item.kind === "assignment"
          ? "/api/esim-assignment"
          : "/api/pending";
    const response = await fetch(`${route}${shareMode ? "?share=1" : ""}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item.payload),
    });
    if (!response.ok) throw new Error("The server did not save this change.");
  }, [shareMode]);

  const retry = useCallback(async () => {
    const queue = getQueue(shareMode);
    if (!queue.length) {
      setError("");
      setQueueSize(0);
      return;
    }
    const remaining: QueueItem[] = [];
    for (const item of queue) {
      try {
        await request(item);
      } catch {
        remaining.push(item);
      }
    }
    setQueue(remaining, shareMode);
    setQueueSize(remaining.length);
    setError(
      remaining.length
        ? `${remaining.length} change${remaining.length === 1 ? "" : "s"} still waiting to sync.`
        : "",
    );
  }, [request, shareMode]);

  const refresh = useCallback(
    async (quiet = false) => {
      try {
        const response = await fetch(
          `/api/state${shareMode ? "?share=1" : ""}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("Shared state unavailable");
        let server = await response.json();
        const local = cachedState(shareMode);
        const importable = Object.fromEntries(
          Object.entries(local.checks || {}).filter(([id]) => id.includes(":")),
        );
        if (!server.hasChecklistState && Object.keys(importable).length) {
          const imported = await fetch(
            `/api/checklist/import${shareMode ? "?share=1" : ""}`,
            {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ checks: importable }),
            },
          );
          if (imported.ok) server = await imported.json();
        }
        remember({
          checks: server.checks || {},
          assignments: server.assignments || {},
          pending: server.pending || {},
          syncedAt: server.syncedAt,
        });
        setError("");
        await retry();
      } catch {
        if (!quiet)
          setError(
            "Offline: showing saved trip data. New checklist changes will queue for retry.",
          );
      } finally {
        setLoading(false);
      }
    },
    [remember, retry, shareMode],
  );

  useEffect(() => {
    const kickoff = window.setTimeout(() => refresh(), 0);
    const timer = window.setInterval(() => refresh(true), 15_000);
    const visible = () => {
      if (document.visibilityState === "visible") refresh(true);
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);

  const push = useCallback(
    async (item: QueueItem, optimistic: (old: SharedState) => SharedState) => {
      setState((old) => {
        const next = optimistic(old);
        localStorage.setItem(
          shareMode ? SHARE_CACHE_KEY : CACHE_KEY,
          JSON.stringify(next),
        );
        return next;
      });
      try {
        await request(item);
        setError("");
        setState((old) => ({ ...old, syncedAt: new Date().toISOString() }));
      } catch {
        const queue = [
          ...getQueue(shareMode).filter(
            (queued) =>
              !(
                queued.kind === item.kind &&
                JSON.stringify(queued.payload) === JSON.stringify(item.payload)
              ),
          ),
          item,
        ];
        setQueue(queue, shareMode);
        setQueueSize(queue.length);
        setError(
          "A change is saved on this device but has not reached the reference server yet.",
        );
      }
    },
    [request, shareMode],
  );

  const setCheck = (id: string, checked: boolean) =>
    push({ kind: "checklist", payload: { id, checked } }, (old) => ({
      ...old,
      checks: { ...old.checks, [id]: checked },
    }));
  const setAssignment = (slot: number, person: string) =>
    push({ kind: "assignment", payload: { slot, person } }, (old) => ({
      ...old,
      assignments: { ...old.assignments, [String(slot)]: person },
    }));
  const setPending = (id: string, value: string) =>
    push({ kind: "pending", payload: { id, value } }, (old) => ({
      ...old,
      pending: { ...old.pending, [id]: value },
    }));
  return {
    state,
    loading,
    error,
    queueSize,
    setCheck,
    setAssignment,
    setPending,
    retry: () => {
      retry();
      refresh(true);
    },
  };
}

function Secret({
  label,
  value,
  shareMode = false,
}: {
  label: string;
  value: string;
  shareMode?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  if (shareMode) return null;
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="secret private-field">
      <small>{label}</small>
      <button
        className="secret-value"
        onClick={() => setRevealed((old) => !old)}
      >
        {revealed ? value : "••••••••"}
        <em>{revealed ? "Hide" : "Tap to reveal"}</em>
      </button>
      <button className="copy-button" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function CheckButton({
  id,
  text,
  note,
  checked,
  onChange,
}: {
  id: string;
  text: string;
  note?: string;
  checked: boolean;
  onChange: (id: string, value: boolean) => void;
}) {
  return (
    <div className={`check-row ${checked ? "checked" : ""}`}>
      <button
        data-check-id={id}
        onClick={() => onChange(id, !checked)}
        aria-pressed={checked}
      >
        <span className="checkbox">{checked ? "✓" : ""}</span>
        <span>
          <strong>{text}</strong>
          {note && <small>{note}</small>}
        </span>
      </button>
      {checked && (
        <button className="reopen" onClick={() => onChange(id, false)}>
          Undo / Reopen
        </button>
      )}
    </div>
  );
}

function FlightCard({
  flight,
  airports,
  onwardSteps,
  shareMode,
  compact = false,
}: {
  flight: LooseRecord;
  airports: Record<string, string>;
  onwardSteps: Record<string, string>;
  shareMode: boolean;
  compact?: boolean;
}) {
  const number =
    "flight_number" in flight
      ? flight.flight_number
      : `${flight.marketed_flight_number} / ${flight.operated_flight_number}`;
  const airline = flight.marketing_airline
    ? `${flight.marketing_airline} marketed • ${flight.operating_airline} operated`
    : flight.operating_airline;
  const seats =
    typeof flight.seats === "string"
      ? flight.seats
      : Object.entries(flight.seats || {})
          .map(
            ([name, seat]) =>
              `${name[0].toUpperCase()}${name.slice(1)} ${seat}`,
          )
          .join(" • ");
  const onward = onwardSteps[`${flight.route.from}-${flight.route.to}`];
  return (
    <article className={`flight-card ${compact ? "compact" : ""}`}>
      <div className="route-head">
        <span>{readableDate(flight.date)}</span>
        <strong>
          {flight.route.from} → {flight.route.to}
        </strong>
        <b>{number}</b>
      </div>
      <div className="flight-times">
        <div>
          <small>Depart</small>
          <strong>{clock(flight.departure_local)}</strong>
          <span>
            {airports[flight.route.from]} ({flight.route.from})
          </span>
          <em>
            {"departure_terminal" in flight && flight.departure_terminal
              ? flight.departure_terminal
              : "Terminal pending live update"}
          </em>
          <em>
            Gate{" "}
            {"departure_gate_snapshot" in flight &&
            flight.departure_gate_snapshot
              ? `${flight.departure_gate_snapshot} — subject to change`
              : "pending live update"}
          </em>
        </div>
        <i>→</i>
        <div>
          <small>Arrive</small>
          <strong>{clock(flight.arrival_local)}</strong>
          <span>
            {airports[flight.route.to]} ({flight.route.to})
          </span>
          <em>
            {"arrival_terminal" in flight && flight.arrival_terminal
              ? flight.arrival_terminal
              : "Terminal pending live update"}
          </em>
          <em>
            Gate{" "}
            {"arrival_gate_snapshot" in flight && flight.arrival_gate_snapshot
              ? `${flight.arrival_gate_snapshot} — subject to change`
              : "pending live update"}
          </em>
        </div>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Airline / number</dt>
          <dd>
            {airline} • {number}
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{flight.duration}</dd>
        </div>
        {!shareMode && "aircraft" in flight && (
          <div>
            <dt>Aircraft</dt>
            <dd>{flight.aircraft}</dd>
          </div>
        )}
        {!shareMode && "fare" in flight && (
          <div>
            <dt>Fare / class</dt>
            <dd>{flight.fare}</dd>
          </div>
        )}
        {!shareMode && "seats" in flight && (
          <div className="private-field">
            <dt>Seats</dt>
            <dd>{seats}</dd>
          </div>
        )}
        {!shareMode && "confirmation" in flight && (
          <div className="private-field">
            <dt>Confirmation</dt>
            <dd>{flight.confirmation}</dd>
          </div>
        )}
        {onward && (
          <div>
            <dt>Connection / next step</dt>
            <dd>{onward}</dd>
          </div>
        )}
      </dl>
      {!compact && "baggage_note" in flight && (
        <p className="notice">
          <strong>Baggage:</strong> {flight.baggage_note}
        </p>
      )}
      {!compact && "e_tickets" in flight && (
        <div className="ticket-list private-field">
          {Object.entries(flight.e_tickets).map(([name, ticket]) => (
            <span key={name}>
              <small>{name}</small>
              {String(ticket)}
            </span>
          ))}
        </div>
      )}
      {!compact && (
        <div className="note-list">
          {flight.notes?.map((note: string) => (
            <span key={note}>{note}</span>
          ))}
          {"critical_note" in flight && <span>{flight.critical_note}</span>}
        </div>
      )}
    </article>
  );
}

function DayCard({
  day,
  flights,
  airports,
  onwardSteps,
  shareMode,
  firstDay,
}: {
  day: LooseRecord;
  flights: LooseRecord[];
  airports: Record<string, string>;
  onwardSteps: Record<string, string>;
  shareMode: boolean;
  firstDay: boolean;
}) {
  return (
    <details
      className={`day-card tone-${day.tone}`}
      open={firstDay}
    >
      <summary>
        <div className="day-date">
          <b>{new Date(`${day.date}T12:00:00`).getDate()}</b>
          <small>
            {new Intl.DateTimeFormat("en-US", { month: "short" })
              .format(new Date(`${day.date}T12:00:00`))
              .toUpperCase()}
          </small>
        </div>
        <div className="day-title">
          <small>{readableDate(day.date)}</small>
          <strong>{day.place}</strong>
        </div>
        <span className="expand">+</span>
      </summary>
      <div className="timeline">
        {day.events.map(([time, title, detail]: [string, string, string?]) => (
          <div className="event" key={`${time}-${title}`}>
            <time>{time}</time>
            <i></i>
            <div>
              <h3>{title}</h3>
              {detail &&
                !(
                  shareMode &&
                  /DEMO-|confirmation|booking|reservation|access/i.test(detail)
                ) && <p>{detail}</p>}
            </div>
          </div>
        ))}
        {"flights" in day &&
          day.flights?.map((index: number) => (
            <FlightCard
              key={index}
              flight={flights[index]}
              airports={airports}
              onwardSteps={onwardSteps}
              shareMode={shareMode}
              compact
            />
          ))}
        <div className="know">
          <strong>What to know</strong>
          <p>{day.know}</p>
        </div>
      </div>
    </details>
  );
}

function PendingEditor({
  update,
  value,
  save,
}: {
  update: LooseRecord;
  value?: string;
  save: (id: string, value: string) => void;
}) {
  const [draft, setDraft] = useState(value || "");
  return (
    <article className="pending-card">
      <div>
        <span className="pending-badge">Pending live update</span>
        <b>{update.due}</b>
      </div>
      <h3>{update.text}</h3>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Add the confirmed detail here so it appears on every phone…"
      />
      <button className="primary-button" onClick={() => save(update.id, draft)}>
        Save shared update
      </button>
      {value && <small>Current shared value: {value}</small>}
    </article>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("today");
  const [person, setPerson] = useState<PackingPerson>(packingPeople[0]);
  const [packFilter, setPackFilter] = useState<
    "all" | "remaining" | "completed"
  >("all");
  const [query, setQuery] = useState("");
  const [shareMode] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("share") === "1",
  );
  const [trip, setTrip] = useState<TripData>(initialTrip);
  const shared = useSharedState(shareMode);

  const travelers = trip.travelers;
  const travelerNames = travelers.map(
    ({ display_name: name }) => name as string,
  );
  const airports = trip.airports;
  const onwardSteps = trip.onward_steps;
  const dailyPlan = trip.daily_plan;
  const prepGroups = trip.preparation_groups;

  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js?v=3", { updateViaCache: "none" })
        .catch(() => undefined);
    if (!shareMode) {
      fetch("/api/trip", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Private reference data unavailable");
          return response.json();
        })
        .then((value) => setTrip(value as TripData))
        .catch(() => undefined);
    }
  }, [shareMode]);

  const nav: { id: Tab; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "itinerary", label: "Itinerary" },
    { id: "travel", label: "Flights + Transport" },
    { id: "lodging", label: "Lodging" },
    { id: "cruise", label: "Cruise" },
    { id: "tours", label: "Tours" },
    { id: "packing", label: "Packing" },
    { id: "connectivity", label: "Connectivity" },
    { id: "safety", label: "Safety & Accessibility" },
    { id: "vault", label: "Bookings + Access" },
    { id: "pending", label: "Pending" },
    { id: "home", label: "Home Preparation" },
  ];
  const go = (id: Tab) => {
    setTab(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toggleShareMode = () => {
    const url = new URL(window.location.href);
    if (shareMode) url.searchParams.delete("share");
    else url.searchParams.set("share", "1");
    window.location.assign(url);
  };

  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayPlan =
    dailyPlan.find((day) => day.date === todayIso) ||
    dailyPlan.find((day) => day.date >= todayIso) ||
    dailyPlan.at(-1)!;
  const packRows = useMemo(
    () =>
      packing[person].filter((item) => {
        const checked = Boolean(shared.state.checks[item.id]);
        const matchesState =
          packFilter === "all" ||
          (packFilter === "completed" ? checked : !checked);
        const search = query.toLowerCase();
        return (
          matchesState &&
          (!search ||
            [item.category, item.item, item.packIn, item.when, item.notes].some(
              (value) => value.toLowerCase().includes(search),
            ))
        );
      }),
    [person, packFilter, query, shared.state.checks],
  );
  const groupedPack = Object.groupBy(packRows, (item) => item.category);
  const completed = packing[person].filter(
    (item) => shared.state.checks[item.id],
  ).length;

  return (
    <main className={shareMode ? "share-mode" : ""}>
      <header className="topbar">
        <button className="brand" onClick={() => go("today")}>
          <span>FT</span>
          <div>
            <strong>{trip.identity.short_name}</strong>
            <small>{trip.identity.trip_name}</small>
          </div>
        </button>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => go(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button
          className="privacy-toggle"
          onClick={toggleShareMode}
        >
          {shareMode ? "Private view" : "Share-safe view"}
        </button>
      </header>
      <div className="shell">
        {shared.error && (
          <div className="sync-alert">
            <strong>{shared.error}</strong>
            {shared.queueSize > 0 && <span>{shared.queueSize} queued</span>}
            <button onClick={shared.retry}>Retry sync</button>
          </div>
        )}
        {!shared.error && (
          <div className="sync-status">
            <span className={shared.loading ? "dot loading" : "dot"}></span>
            {shared.loading
              ? "Connecting to shared reference state…"
              : `Shared state synced${shared.state.syncedAt ? ` • ${new Date(shared.state.syncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}
          </div>
        )}

        {tab === "today" && (
          <section>
            <div className="hero">
              <span className="eyebrow">{trip.identity.trip_dates.label}</span>
              <h1>
                {trip.identity.hero_title[0]}
                <br />
                {trip.identity.hero_title[1]}
              </h1>
              <p>{trip.identity.hero_description}</p>
              <div className="hero-actions">
                <button
                  className="primary-button"
                  onClick={() => go("itinerary")}
                >
                  Open full itinerary
                </button>
                <button
                  className="secondary-button"
                  onClick={() => go("vault")}
                >
                  Bookings & access
                </button>
              </div>
              <div className="hero-art">
                <span></span>
                <i></i>
              </div>
            </div>
            <div className="today-grid">
              <article className="card next-up">
                <span className="kicker">Today / Next up</span>
                <h2>
                  {readableDate(todayPlan.date)} — {todayPlan.place}
                </h2>
                <div className="next-event">
                  <b>{todayPlan.events[0][0]}</b>
                  <strong>{todayPlan.events[0][1]}</strong>
                  <p>{todayPlan.events[0][2]}</p>
                </div>
                <button className="text-button" onClick={() => go("itinerary")}>
                  See the complete day →
                </button>
              </article>
              <article className="card">
                <span className="kicker">Team readiness</span>
                <h2>
                  {Object.values(shared.state.checks).filter(Boolean).length}{" "}
                  completed
                </h2>
                <p>
                  Demonstration progress is shared across reference devices and
                  preserved by the local state service.
                </p>
                <button className="text-button" onClick={() => go("packing")}>
                  Continue packing →
                </button>
              </article>
              <article className="card">
                <span className="kicker">Pending live details</span>
                <h2>{trip.pending_updates.length} tracked fields</h2>
                <p>
                  Nothing is silently omitted. Add gates, contacts, storage, and
                  onboard deadlines as they arrive.
                </p>
                <button className="text-button" onClick={() => go("pending")}>
                  Review pending updates →
                </button>
              </article>
            </div>
          </section>
        )}

        {tab === "itinerary" && (
          <section className="page">
            <PageIntro
               kicker={`${dailyPlan.length} days • all times local`}
              title="Daily itinerary"
              text="Every travel step, meeting point, buffer, reservation, and safety deadline in one offline-ready timeline."
            />
            <div className="day-list">
              {dailyPlan.map((day, index) => (
                <DayCard
                  key={day.date}
                  day={day}
                  flights={trip.flights}
                  airports={airports}
                  onwardSteps={onwardSteps}
                  shareMode={shareMode}
                  firstDay={index === 0}
                />
              ))}
            </div>
          </section>
        )}

        {tab === "travel" && (
          <section className="page">
            <PageIntro
               kicker={`${trip.flights.length} fictional flight legs`}
              title="Flights & transportation"
               text="Fictional terminal snapshots, seats, transport records, and onward steps in one reference view."
            />
            <div className="stack">
              {trip.flights.map((flight) => (
                <FlightCard
                  key={
                    "flight_number" in flight
                      ? flight.flight_number
                      : flight.operated_flight_number
                  }
                  flight={flight}
                  airports={airports}
                  onwardSteps={onwardSteps}
                  shareMode={shareMode}
                />
              ))}
            </div>
            <h2 className="section-title">Ground transportation</h2>
            <div className="card-grid">
              {trip.ground_transport.map((record) => (
                <article
                  className="card"
                  key={`${record.date}-${record.route}`}
                >
                  <span className="status-badge">
                    {record.status.replaceAll("_", " ")}
                  </span>
                  <h2>{record.route}</h2>
                  <p>
                    <strong>{readableDate(record.date)}</strong>
                  </p>
                  {"service" in record && (
                    <dl className="detail-grid">
                      <div>
                        <dt>Service</dt>
                        <dd>{record.service}</dd>
                      </div>
                      <div>
                        <dt>Time</dt>
                        <dd>
                          {clock(record.departure_local)}–
                          {clock(record.arrival_local)}
                        </dd>
                      </div>
                      {!shareMode && "pnr" in record && (
                        <div>
                          <dt>PNR / coach</dt>
                          <dd>
                            {record.pnr} • Coach {record.coach}
                          </dd>
                        </div>
                      )}
                      {!shareMode && "seats" in record && (
                        <div>
                          <dt>Seats</dt>
                          <dd>
                            {Object.entries(record.seats)
                              .map(([name, seat]) => `${name} ${seat}`)
                              .join(" • ")}
                          </dd>
                        </div>
                      )}
                      {!shareMode && "boarding_codes" in record && (
                        <div>
                          <dt>Boarding codes</dt>
                          <dd>
                            {Object.entries(record.boarding_codes)
                              .map(([name, code]) => `${name} ${code}`)
                              .join(" • ")}
                          </dd>
                        </div>
                      )}
                      {!shareMode && "fare" in record && (
                        <div>
                          <dt>Fare</dt>
                          <dd>
                            {record.fare}, {record.class} • {record.price_total}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {"primary_plan" in record && (
                    <>
                      <p>
                        <strong>Primary:</strong> {record.primary_plan}
                      </p>
                      <p>
                        <strong>Backup:</strong> {record.backup_plan}
                      </p>
                    </>
                  )}
                  {"preferred_plan" in record && <p>{record.preferred_plan}</p>}
                  {"target_airport_arrival" in record && (
                    <p>
                      <strong>Target:</strong> {record.target_airport_arrival};
                      depart {record.suggested_departure_window}.
                    </p>
                  )}
                  {"still_needed" in record && (
                    <div className="pending-list">
                      {(Array.isArray(record.still_needed)
                        ? record.still_needed
                        : [record.still_needed]
                      ).map((item: string) => (
                        <span key={item}>Pending live update: {item}</span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "lodging" && (
          <section className="page">
            <PageIntro
              kicker="Actionable arrival instructions"
              title="Lodging & access"
              text="Addresses, contacts, entry steps, Wi-Fi, checkout, luggage, and direct actions."
            />
            <div className="stack">
              {trip.lodging.map((stay) => (
                <article className="lodging-card" key={stay.city}>
                  <div className="lodging-head">
                    <div>
                      <span className="kicker">{stay.city}</span>
                      <h2>{stay.display_name}</h2>
                      <p>{stay.address}</p>
                    </div>
                    <a
                      className="map-button"
                      href={mapUrl(stay.address)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Map
                    </a>
                  </div>
                  <div className="action-row">
                    <a href={`tel:${stay.host_phone.replace(/\s/g, "")}`}>
                      Call {stay.host}
                    </a>
                    <a
                      href={`https://wa.me/${stay.host_phone.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      WhatsApp
                    </a>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(stay.address)
                      }
                    >
                      Copy address
                    </button>
                  </div>
                  <dl className="detail-grid">
                    <div>
                      <dt>Confirmation</dt>
                      <dd>{stay.confirmation}</dd>
                    </div>
                    <div>
                      <dt>Guests</dt>
                      <dd>{stay.guests}</dd>
                    </div>
                    <div>
                      <dt>Check-in</dt>
                      <dd>
                        {clock(stay.check_in)} •{" "}
                        {readableDate(stay.check_in.slice(0, 10))}
                      </dd>
                    </div>
                    <div>
                      <dt>Check-out</dt>
                      <dd>
                        {clock(stay.check_out)} •{" "}
                        {readableDate(stay.check_out.slice(0, 10))}
                      </dd>
                    </div>
                    <div>
                      <dt>Host</dt>
                      <dd>
                        {stay.host} • {stay.host_phone}
                      </dd>
                    </div>
                  </dl>
                  {Array.isArray(stay.check_in_process) && (
                    <div className="instruction-box">
                      <h3>Demonstration check-in sequence</h3>
                      <ol>
                        {stay.check_in_process.map((step: string) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {stay.private_access && (
                    <div className="secret-grid">
                      {Object.entries(stay.private_access).map(([label, value]) => (
                        <Secret
                          key={label}
                          label={label.replaceAll("_", " ")}
                          value={String(value)}
                          shareMode={shareMode}
                        />
                      ))}
                      {stay.wifi &&
                        Object.entries(stay.wifi).map(([label, value]) => (
                          <Secret
                            key={label}
                            label={`Wi-Fi ${label}`}
                            value={String(value)}
                            shareMode={shareMode}
                          />
                        ))}
                    </div>
                  )}
                  {(stay.manager_contact_plan || stay.possible_early_check_in) && (
                    <div className="notice">
                      <strong>Demonstration check-in:</strong>{" "}
                      {stay.manager_contact_plan} {stay.possible_early_check_in}
                    </div>
                  )}
                  <p>
                    <strong>Luggage:</strong> {stay.luggage_plan}
                  </p>
                  <div className="notice">
                    <strong>Equipment note:</strong> {stay.power_note}
                  </div>
                  <div className="instruction-columns">
                    <div>
                      <h3>Demonstration luggage options</h3>
                      {stay.nearby_luggage_storage_addresses.map(
                        (address: string) => (
                          <a
                            key={address}
                            href={mapUrl(address)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {address}
                          </a>
                        ),
                      )}
                    </div>
                    <div>
                      <h3>Checkout</h3>
                      {stay.checkout_steps.map((step: string) => (
                        <span key={step}>{step}</span>
                      ))}
                    </div>
                  </div>
                  {stay.pending && (
                    <div className="pending-list">
                      {(Array.isArray(stay.pending)
                        ? stay.pending
                        : [stay.pending]
                      ).map((item: string) => (
                        <span key={item}>Pending live update: {item}</span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "cruise" && (
          <section className="page">
            <PageIntro
               kicker={`${trip.cruise.ship} • ${trip.cruise.dates}`}
               title="Coastal vessel command center"
               text="Fictional reservations, cabins, port schedule, dining, and a general safety reminder."
            />
            <div className="room-grid">
              {trip.cruise.staterooms.map((room: LooseRecord) => (
                <article className="room-card" key={room.reservation}>
                  <span>
                    Deck {room.deck} • {room.location}
                  </span>
                  <h2>Stateroom {room.stateroom}</h2>
                  <p>{room.category}</p>
                  <Secret
                    label="Reservation"
                    value={room.reservation}
                    shareMode={shareMode}
                  />
                  <strong>{room.assigned_travelers.join(" + ")}</strong>
                </article>
              ))}
            </div>
            <p className="notice">{trip.cruise.sleeping_note}</p>
            <div className="ports-table">
              {trip.cruise.ports.map((port: LooseRecord) => (
                <div key={port.date}>
                  <b>{readableDate(port.date)}</b>
                  <strong>{port.port}</strong>
                  <span>
                    {port.arrive ? `Arrive ${port.arrive}` : ""}
                    {port.depart ? ` • Depart ${port.depart}` : ""}
                    {port.tender ? " • Tender port" : ""}
                  </span>
                </div>
              ))}
            </div>
            <div className="card-grid">
              {trip.cruise.dining.map((meal: LooseRecord) => (
                <article className="card" key={meal.restaurant}>
                  <span className="kicker">Dining reservation</span>
                  <h2>{meal.restaurant}</h2>
                  <p>
                    {readableDate(meal.date)} • {meal.time} • party of{" "}
                    {meal.party}
                  </p>
                </article>
              ))}
              <article className="card warning-card">
                <span className="kicker">Safety rule</span>
                <h2>Posted ship time controls</h2>
                <p>{trip.cruise.safety_rule}</p>
              </article>
            </div>
          </section>
        )}

        {tab === "tours" && (
          <section className="page">
            <PageIntro
              kicker="Booked excursions"
              title="Tours & tickets"
              text="References, timing, meeting instructions, payment, cancellation, and return protection."
            />
            <div className="card-grid">
              {trip.tours.map((tour) => (
                <article className="tour-card" key={tour.name}>
                  <div>
                    <span
                      className={`status-badge ${"status" in tour ? "active" : ""}`}
                    >
                      {"status" in tour
                        ? tour.status.replaceAll("_", " ")
                        : "Confirmed"}
                    </span>
                    <b>{readableDate(tour.date)}</b>
                  </div>
                  <h2>{tour.name}</h2>
                  {"time" in tour && (
                    <p>
                      <strong>{tour.time}</strong>
                    </p>
                  )}
                  {"duration" in tour && (
                    <p>
                      <strong>Duration / type:</strong> {tour.duration} • {tour.type}
                    </p>
                  )}
                  {"travelers" in tour && (
                    <p>
                      <strong>Guests:</strong> {String(tour.travelers)}
                    </p>
                  )}
                  {"provider" in tour && (
                    <p>
                      <strong>Provider:</strong> {tour.provider}
                    </p>
                  )}
                  {"contact" in tour && (
                    <p className="private-field">
                      <strong>Host / contact:</strong> {tour.contact}
                    </p>
                  )}
                  {"booking_reference" in tour && (
                    <Secret
                      label="Booking reference"
                      value={tour.booking_reference}
                      shareMode={shareMode}
                    />
                  )}
                  {"confirmation" in tour && (
                    <Secret
                      label="Confirmation"
                      value={tour.confirmation}
                      shareMode={shareMode}
                    />
                  )}
                  {"pin" in tour && (
                    <Secret
                      label="Private PIN"
                      value={tour.pin}
                      shareMode={shareMode}
                    />
                  )}
                  <p>
                    <strong>Meeting:</strong>{" "}
                    {tour.meeting || tour.meeting_return || tour.ticket_pickup}
                  </p>
                  {"location_details" in tour && (
                    <p>
                      <strong>Find it:</strong> {tour.location_details}
                    </p>
                  )}
                  {"arrival_required" in tour && (
                    <p>
                      <strong>Arrival:</strong> {tour.arrival_required}
                    </p>
                  )}
                  {"boat_timing" in tour && (
                    <p>
                      <strong>Boat timing:</strong> {tour.boat_timing}
                    </p>
                  )}
                  {"ticket_pickup" in tour && (
                    <p>
                      <strong>Ticket pickup:</strong> {tour.ticket_pickup}
                    </p>
                  )}
                  {"payment" in tour && (
                    <p>
                      <strong>Payment:</strong> {tour.payment}
                    </p>
                  )}
                  {"pier_transfer" in tour && (
                    <p>
                      <strong>Pier transfer:</strong> {tour.pier_transfer}
                    </p>
                  )}
                  {"coordinates" in tour && (
                    <a
                      className="map-button"
                      href={mapUrl(
                        `${tour.coordinates.lat},${tour.coordinates.lng}`,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open meeting map
                    </a>
                  )}
                  {("phone" in tour || "map_address" in tour) && (
                    <div className="action-row private-field">
                      {"phone" in tour && (
                        <>
                          <a href={`tel:${tour.phone.replace(/\s/g, "")}`}>
                            Call {tour.contact || tour.provider}
                          </a>
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(tour.phone)
                            }
                          >
                            Copy phone
                          </button>
                        </>
                      )}
                      {"map_address" in tour && (
                        <a
                          href={mapUrl(tour.map_address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open meeting map
                        </a>
                      )}
                    </div>
                  )}
                  {"bring" in tour && (
                    <div className="tour-bring">
                      <strong>Bring</strong>
                      {tour.bring.map((item: string) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  )}
                  {"souvenir_photos" in tour && (
                    <p className="notice">
                      <strong>Photos:</strong> {tour.souvenir_photos}
                    </p>
                  )}
                  {"provider_confirmation" in tour && (
                    <p>
                      <strong>Confirmed:</strong> {tour.provider_confirmation}
                    </p>
                  )}
                  {"ship_schedule" in tour && (
                    <p>
                      <strong>Ship / tender:</strong> {tour.ship_schedule}
                    </p>
                  )}
                  {"tender_warning" in tour && (
                    <div className="tender-warning">
                      <strong>Verify onboard before going ashore</strong>
                      <span>{tour.tender_warning}</span>
                    </div>
                  )}
                  {"safety_note" in tour && (
                    <div className="safety-note">
                      <strong>General safety reminder</strong>
                      <span>{tour.safety_note}</span>
                    </div>
                  )}
                  {"cancellation" in tour && (
                    <small className="fineprint">{tour.cancellation}</small>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "packing" && (
          <section className="page print-packing">
            <PageIntro
              kicker="Fictional individual lists"
              title="Team packing"
              text="Each reference item preserves its category, pack-in location, timing, and notes. Checked items remain visible and can be reopened."
            />
            <div className="person-tabs">
              {packingPeople.map((name) => (
                <button
                  key={name}
                  className={person === name ? "active" : ""}
                  onClick={() => setPerson(name)}
                >
                  {name}
                  <span>{packing[name].length}</span>
                </button>
              ))}
            </div>
            <div className="packing-toolbar">
              <div>
                <strong>
                  {completed}/{packing[person].length} complete
                </strong>
                <span>{packing[person].length - completed} remaining</span>
              </div>
              <div className="filter-tabs">
                {(["all", "remaining", "completed"] as const).map((filter) => (
                  <button
                    key={filter}
                    className={packFilter === filter ? "active" : ""}
                    onClick={() => setPackFilter(filter)}
                  >
                    {filter}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this packing list…"
              />
              <button className="print-button" onClick={() => window.print()}>
                Print {person}’s list
              </button>
            </div>
            <div className="packing-list">
              {Object.entries(groupedPack).map(([category, items]) => (
                <article className="pack-group" key={category}>
                  <h2>
                    {category}
                    <span>{items?.length}</span>
                  </h2>
                  {items?.map((item) => (
                    <div className="packing-item" key={item.id}>
                      <CheckButton
                        id={item.id}
                        text={item.item}
                        checked={Boolean(shared.state.checks[item.id])}
                        onChange={shared.setCheck}
                      />
                      <dl>
                        <div>
                          <dt>Pack in</dt>
                          <dd>{item.packIn}</dd>
                        </div>
                        <div>
                          <dt>When</dt>
                          <dd>{item.when}</dd>
                        </div>
                        {item.notes && (
                          <div>
                            <dt>Notes</dt>
                            <dd>{item.notes}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  ))}
                </article>
              ))}
            </div>
            {!packRows.length && (
              <div className="empty-state">No items match this view.</div>
            )}
          </section>
        )}

        {tab === "connectivity" && (
          <section className="page">
            <PageIntro
              kicker={`${trip.connectivity.provider} • inert examples`}
              title="Connectivity & eSIMs"
              text="Non-activatable profile records exercise the shared assignment control without exposing real connectivity data."
            />
            <div className="notice">
              {"order" in trip.connectivity && (
                <strong>Order {trip.connectivity.order}: </strong>
              )}
              {trip.connectivity.assignment_status}.
              <span>{trip.connectivity.demo_notice}</span>
            </div>
            <div className="esim-grid">
              {trip.connectivity.profiles.map((esim: LooseRecord) => (
                <article className="esim-card" key={esim.slot}>
                  <span>eSIM {esim.slot}</span>
                  <h2>{esim.phone}</h2>
                  <Secret
                     label="Inert demo identifier"
                     value={esim.demo_identifier}
                    shareMode={shareMode}
                  />
                  <label>
                    Installed for
                    <select
                      value={shared.state.assignments[String(esim.slot)] || ""}
                      onChange={(event) =>
                        shared.setAssignment(esim.slot, event.target.value)
                      }
                    >
                      <option value="">Unassigned</option>
                      {travelerNames.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
            </div>
            <div className="card-grid">
              {trip.connectivity.instructions.map((instruction: string) => (
                <article className="card mini" key={instruction}>
                  <strong>{instruction}</strong>
                </article>
              ))}
              <article className="card mini">
                <strong>{trip.connectivity.vessel_connectivity}</strong>
              </article>
            </div>
          </section>
        )}

        {tab === "safety" && (
          <section className="page">
            <PageIntro
              kicker="Generalized planning preferences"
              title="Safety & accessibility"
              text="Harmless pacing, wayfinding, and accessibility reminders for the fictional field team. No private medical details are included."
            />
            <div className="emergency">
              <strong>Public emergency guidance</strong>
              <span>{trip.safety_accessibility.public_emergency_guidance}</span>
            </div>
            <div className="health-grid">
              {trip.safety_accessibility.traveler_preferences.map(
                (profile: LooseRecord) => (
                <article className="health-card" key={profile.traveler}>
                  <h2>{profile.traveler}</h2>
                  {profile.items.map((item: string) => (
                    <span key={item}>{item}</span>
                  ))}
                </article>
                ),
              )}
            </div>
            <div className="notice">
              {trip.safety_accessibility.general_guidance.map((rule: string) => (
                <span key={rule}>{rule}</span>
              ))}
            </div>
          </section>
        )}

        {tab === "vault" && (
          <section className="page vault-page">
            <PageIntro
              kicker="Obvious demonstration • masked by default"
              title="Demo bookings & inert access"
              text="These fictional values exercise reveal and copy interactions. Every booking starts with DEMO-, and every access value is inert."
            />
            <div className="privacy-banner">
              Demonstration values are hidden in print and share-safe modes. This
              interface does not encrypt values and must never be used as a real
              password, access-code, or booking vault.
            </div>
            {trip.demo_vault_groups.map((group: LooseRecord) => (
              <div key={group.title}>
                <h2 className="section-title">{group.title}</h2>
                <div className="secret-grid">
                  {group.items.map((item: LooseRecord) => (
                    <Secret
                      key={`${group.title}-${item.label}`}
                      label={item.label}
                      value={item.value}
                      shareMode={shareMode}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {tab === "pending" && (
          <section className="page">
            <PageIntro
              kicker="Known unknowns"
              title="Pending live updates"
              text="Each fictional missing detail names what is pending and when it should arrive. Saved values synchronize across reference devices."
            />
            <div className="pending-grid">
              {trip.pending_updates.map((update) => (
                <PendingEditor
                  key={`${update.id}:${shared.state.pending[update.id] || ""}`}
                  update={update}
                  value={shared.state.pending[update.id]}
                  save={shared.setPending}
                />
              ))}
            </div>
          </section>
        )}

        {tab === "home" && (
          <section className="page">
            <PageIntro
              kicker="Departure and return"
              title="Preparation & return"
              text="Generic shared checklists for departure preparation, home handoff, field readiness, and return."
            />
            <div className="check-columns">
              {Object.entries(prepGroups).map(([group, items]) => (
                <article className="check-card" key={group}>
                  <h2>{group}</h2>
                  {items.map((text) => {
                    const id = `prep:${slug(group)}:${slug(text)}`;
                    return (
                      <CheckButton
                        key={id}
                        id={id}
                        text={text}
                        checked={Boolean(shared.state.checks[id])}
                        onChange={shared.setCheck}
                      />
                    );
                  })}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
      <nav className="mobile-nav">
        {nav.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => go(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <footer>
        <span>{trip.identity.application_name}</span>
        <span>{trip.identity.footer_note}</span>
      </footer>
    </main>
  );
}

function PageIntro({
  kicker,
  title,
  text,
}: {
  kicker: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-intro">
      <span className="kicker">{kicker}</span>
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import tripSeed from "./data/trip-share.json";

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
type ShareTripV1 = {
  schema_version: 1;
  identity: {
    application_name: string;
    short_name: string;
    share_title: string;
    date_label: string;
    summary: string;
  };
  days: { date: string; place_label: string; summary: string }[];
  transport: {
    date: string;
    route_label: string;
    service_label: string;
    status: string;
  }[];
  ports: { date: string; port: string }[];
  tours: { date: string; name: string; status: string }[];
};
type PrivateData = {
  trip: TripData;
  packing: Record<PackingPerson, PackingItem[]>;
};
type PrivateDataCache = PrivateData & { version: 1 };
type BootstrapState =
  | { mode: "resolving" }
  | { mode: "share" }
  | { mode: "private-loading" }
  | { mode: "private-ready"; data: PrivateData }
  | { mode: "private-unavailable" };
const initialShareTrip = tripSeed as ShareTripV1;
const CACHE_KEY = "travel-reference-state-v1";
const QUEUE_KEY = "travel-reference-queue-v1";
const PRIVATE_DATA_CACHE_KEY = "travel-reference-private-data-v1";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): LooseRecord {
  return isObject(value) ? (value as LooseRecord) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecordArray(value: unknown): LooseRecord[] {
  return asArray(value).filter(isObject) as LooseRecord[];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim()),
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function text(value: unknown, fallback = "") {
  return hasText(value) ? value : fallback;
}

function normalizePrivateTrip(value: unknown): TripData {
  const trip = asRecord(value);
  const cruise = asRecord(trip.cruise);
  const connectivity = asRecord(trip.connectivity);
  const safety = asRecord(trip.safety_accessibility);
  const preparationGroups = Object.fromEntries(
    Object.entries(asRecord(trip.preparation_groups)).map(([group, items]) => [
      group,
      asStringArray(items),
    ]),
  );
  return {
    identity: asRecord(trip.identity),
    travelers: asRecordArray(trip.travelers),
    airports: Object.fromEntries(
      Object.entries(asRecord(trip.airports)).filter(
        ([, label]) => typeof label === "string",
      ),
    ) as Record<string, string>,
    onward_steps: Object.fromEntries(
      Object.entries(asRecord(trip.onward_steps)).filter(
        ([, step]) => typeof step === "string",
      ),
    ) as Record<string, string>,
    flights: asRecordArray(trip.flights),
    ground_transport: asRecordArray(trip.ground_transport),
    lodging: asRecordArray(trip.lodging),
    cruise: {
      ...cruise,
      staterooms: asRecordArray(cruise.staterooms),
      ports: asRecordArray(cruise.ports),
      dining: asRecordArray(cruise.dining),
    },
    tours: asRecordArray(trip.tours),
    connectivity: {
      ...connectivity,
      profiles: asRecordArray(connectivity.profiles),
      instructions: asStringArray(connectivity.instructions),
    },
    safety_accessibility: {
      ...safety,
      traveler_preferences: asRecordArray(safety.traveler_preferences).map(
        (profile) => ({ ...profile, items: asStringArray(profile.items) }),
      ),
      general_guidance: asStringArray(safety.general_guidance),
    },
    pending_updates: asRecordArray(trip.pending_updates),
    daily_plan: asRecordArray(trip.daily_plan).map((day) => ({
      ...day,
      events: asArray(day.events),
      flights: asArray(day.flights),
    })),
    preparation_groups: preparationGroups,
    demo_vault_groups: asRecordArray(trip.demo_vault_groups)
      .map((group) => ({
        ...group,
        items: asRecordArray(group.items).filter(
          (item) => hasText(item.label) && hasText(item.value),
        ),
      }))
      .filter((group) => group.items.length > 0),
  };
}

function normalizePacking(value: unknown): Record<PackingPerson, PackingItem[]> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([person, items]) => [
      person,
      asRecordArray(items) as PackingItem[],
    ]),
  );
}

function normalizePrivateData(trip: unknown, packing: unknown): PrivateData {
  return {
    trip: normalizePrivateTrip(trip),
    packing: normalizePacking(packing),
  };
}

function readPrivateDataCache(): PrivateData | null {
  try {
    const cached = JSON.parse(localStorage.getItem(PRIVATE_DATA_CACHE_KEY) || "null") as unknown;
    if (
      !isObject(cached) ||
      cached.version !== 1 ||
      !isObject(cached.trip) ||
      !isObject(cached.packing)
    ) {
      return null;
    }
    return normalizePrivateData(cached.trip, cached.packing);
  } catch {
    return null;
  }
}

function writePrivateDataCache(data: PrivateData) {
  try {
    const cached: PrivateDataCache = { version: 1, ...data };
    localStorage.setItem(PRIVATE_DATA_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // A storage quota or browser policy failure must not hide fresh private data.
  }
}

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
function readableDate(value: unknown) {
  if (!hasText(value)) return "Date pending";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}
function clock(value?: unknown) {
  if (!hasText(value)) return "Pending live update";
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return value;
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours >= 12 ? "PM" : "AM"}`;
}
function getQueue(): QueueItem[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}
function setQueue(queue: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}
function cachedState(): SharedState {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return { checks: {}, assignments: {}, pending: {} };
  }
}

function useSharedState() {
  const [state, setState] = useState<SharedState>({
    checks: {},
    assignments: {},
    pending: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queueSize, setQueueSize] = useState(0);

  const remember = useCallback((next: SharedState) => {
    setState(next);
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  }, []);

  const request = useCallback(async (item: QueueItem) => {
    const route =
      item.kind === "checklist"
        ? "/api/checklist"
        : item.kind === "assignment"
          ? "/api/esim-assignment"
          : "/api/pending";
    const response = await fetch(route, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item.payload),
    });
    if (!response.ok) throw new Error("The server did not save this change.");
  }, []);

  const retry = useCallback(async () => {
    const queue = getQueue();
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
    setQueue(remaining);
    setQueueSize(remaining.length);
    setError(
      remaining.length
        ? `${remaining.length} change${remaining.length === 1 ? "" : "s"} still waiting to sync.`
        : "",
    );
  }, [request]);

  const refresh = useCallback(
    async (quiet = false) => {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error("Shared state unavailable");
        let server = await response.json();
        const local = cachedState();
        const importable = Object.fromEntries(
          Object.entries(local.checks || {}).filter(([id]) => id.includes(":")),
        );
        if (!server.hasChecklistState && Object.keys(importable).length) {
          const imported = await fetch("/api/checklist/import", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ checks: importable }),
          });
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
    [remember, retry],
  );

  useEffect(() => {
    const kickoff = window.setTimeout(() => {
      const local = cachedState();
      setState({
        checks: local.checks || {},
        assignments: local.assignments || {},
        pending: local.pending || {},
        syncedAt: local.syncedAt,
      });
      setQueueSize(getQueue().length);
      setError("");
      refresh();
    }, 0);
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
        localStorage.setItem(CACHE_KEY, JSON.stringify(next));
        return next;
      });
      try {
        await request(item);
        setError("");
        setState((old) => ({ ...old, syncedAt: new Date().toISOString() }));
      } catch {
        const queue = [
          ...getQueue().filter(
            (queued) =>
              !(
                queued.kind === item.kind &&
                JSON.stringify(queued.payload) === JSON.stringify(item.payload)
              ),
          ),
          item,
        ];
        setQueue(queue);
        setQueueSize(queue.length);
        setError(
          "A change is saved on this device but has not reached the reference server yet.",
        );
      }
    },
    [request],
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
  const route = asRecord(flight.route);
  const from = text(route.from, "Origin pending");
  const to = text(route.to, "Destination pending");
  const number =
    text(flight.flight_number) ||
    [flight.marketed_flight_number, flight.operated_flight_number]
      .filter(hasText)
      .join(" / ") ||
    "Service number pending";
  const airline = hasText(flight.marketing_airline)
    ? `${flight.marketing_airline} marketed${hasText(flight.operating_airline) ? ` • ${flight.operating_airline} operated` : ""}`
    : text(flight.operating_airline, "Carrier pending");
  const seats =
    typeof flight.seats === "string"
      ? flight.seats
      : Object.entries(asRecord(flight.seats))
          .map(
            ([name, seat]) =>
              `${name ? `${name[0].toUpperCase()}${name.slice(1)}` : "Traveler"} ${seat}`,
          )
          .join(" • ");
  const onward = onwardSteps[`${from}-${to}`];
  return (
    <article className={`flight-card ${compact ? "compact" : ""}`}>
      <div className="route-head">
        <span>{readableDate(flight.date)}</span>
        <strong>
          {from} → {to}
        </strong>
        <b>{number}</b>
      </div>
      <div className="flight-times">
        <div>
          <small>Depart</small>
          <strong>{clock(flight.departure_local)}</strong>
          <span>
            {airports[from] || "Location pending"} ({from})
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
            {airports[to] || "Location pending"} ({to})
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
        {hasText(flight.duration) && (
          <div>
            <dt>Duration</dt>
            <dd>{flight.duration}</dd>
          </div>
        )}
        {!shareMode && hasText(flight.aircraft) && (
          <div>
            <dt>Aircraft</dt>
            <dd>{flight.aircraft}</dd>
          </div>
        )}
        {!shareMode && hasText(flight.fare) && (
          <div>
            <dt>Fare / class</dt>
            <dd>{flight.fare}</dd>
          </div>
        )}
        {!shareMode && Boolean(seats) && (
          <div className="private-field">
            <dt>Seats</dt>
            <dd>{seats}</dd>
          </div>
        )}
        {!shareMode && hasText(flight.confirmation) && (
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
      {!compact && hasText(flight.baggage_note) && (
        <p className="notice">
          <strong>Baggage:</strong> {flight.baggage_note}
        </p>
      )}
      {!compact && isObject(flight.e_tickets) && (
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
          {asStringArray(flight.notes).map((note) => (
            <span key={note}>{note}</span>
          ))}
          {hasText(flight.critical_note) && <span>{flight.critical_note}</span>}
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
  const events = asArray<[string, string, string?]>(day.events);
  const flightIndexes = asArray<number>(day.flights).filter(
    (index) => Number.isInteger(index) && Boolean(flights[index]),
  );
  const tone = hasText(day.tone) ? slug(day.tone) : "";
  return (
    <details
      className={`day-card${tone ? ` tone-${tone}` : ""}`}
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
        {events.map(([time, title, detail]) => (
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
        {flightIndexes.map((index) => (
            <FlightCard
              key={index}
              flight={flights[index]}
              airports={airports}
              onwardSteps={onwardSteps}
              shareMode={shareMode}
              compact
            />
          ))}
        {!events.length && !flightIndexes.length && (
          <div className="empty-state">No timed events supplied for this day.</div>
        )}
        {hasText(day.know) && (
          <div className="know">
            <strong>What to know</strong>
            <p>{day.know}</p>
          </div>
        )}
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

function ShareView({ trip }: { trip: ShareTripV1 }) {
  const hasDetails =
    trip.days.length + trip.transport.length + trip.ports.length + trip.tours.length > 0;

  return (
    <main className="share-mode" data-testid="share-safe-view">
      <header className="topbar">
        <div className="brand" aria-label={trip.identity.application_name}>
          <span>FT</span>
          <div>
            <strong>{trip.identity.short_name}</strong>
            <small>Read-only share-safe view</small>
          </div>
        </div>
        <div className="privacy-toggle" aria-label="Share-safe mode">
          Share-safe • read only
        </div>
      </header>
      <div className="shell share-shell">
        <section>
          <div className="hero">
            <span className="eyebrow">{trip.identity.date_label || "Limited trip overview"}</span>
            <h1>{trip.identity.share_title}</h1>
            <p>{trip.identity.summary}</p>
            <div className="privacy-banner">
              This view contains only details explicitly approved in the canonical sharing profile.
              It has no packing lists, traveler identities, bookings, private state, or editing controls.
            </div>
          </div>
        </section>

        {!hasDetails && (
          <section className="page">
            <div className="empty-state">No details approved for sharing.</div>
          </section>
        )}

        {trip.days.length > 0 && (
          <section className="page" aria-labelledby="share-days-title">
            <PageIntro
              kicker="Approved overview"
              title="Trip outline"
              text="Dates, broad place labels, and summaries only. Minute-level movement is omitted."
            />
            <div className="card-grid" id="share-days-title">
              {trip.days.map((day) => (
                <article className="card" key={`${day.date}:${day.place_label}`}>
                  <span className="kicker">{readableDate(day.date)}</span>
                  <h2>{day.place_label}</h2>
                  <p>{day.summary}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {trip.transport.length > 0 && (
          <section className="page">
            <PageIntro
              kicker="Broad routing only"
              title="Transportation outline"
              text="Flight numbers, exact times, tickets, bookings, seats, and addresses are omitted."
            />
            <div className="card-grid">
              {trip.transport.map((record) => (
                <article className="card" key={`${record.date}:${record.route_label}`}>
                  <span className="kicker">{readableDate(record.date)}</span>
                  <h2>{record.route_label}</h2>
                  <p>{record.service_label}</p>
                  <small>{record.status}</small>
                </article>
              ))}
            </div>
          </section>
        )}

        {trip.ports.length > 0 && (
          <section className="page">
            <PageIntro
              kicker="Approved place labels"
              title="Ports"
              text="Arrival and departure times are intentionally omitted."
            />
            <div className="card-grid">
              {trip.ports.map((record) => (
                <article className="card mini" key={`${record.date}:${record.port}`}>
                  <span>{readableDate(record.date)}</span>
                  <strong>{record.port}</strong>
                </article>
              ))}
            </div>
          </section>
        )}

        {trip.tours.length > 0 && (
          <section className="page">
            <PageIntro
              kicker="Approved activity names"
              title="Activities"
              text="Providers, times, contacts, traveler lists, and booking details are omitted."
            />
            <div className="card-grid">
              {trip.tours.map((record) => (
                <article className="card" key={`${record.date}:${record.name}`}>
                  <span className="kicker">{readableDate(record.date)}</span>
                  <h2>{record.name}</h2>
                  <p>{record.status}</p>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
      <footer>
        <span>{trip.identity.application_name}</span>
        <span>Explicitly approved ShareTripV1 data • read only</span>
      </footer>
    </main>
  );
}

export default function Home() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ mode: "resolving" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const resolveMode = window.setTimeout(() => {
      if (!active) return;
      if (new URLSearchParams(window.location.search).get("share") === "1") {
        setBootstrap({ mode: "share" });
        return;
      }

      setBootstrap({ mode: "private-loading" });
      void Promise.all([
        fetch("/api/trip", { cache: "no-store" }),
        fetch("/api/packing", { cache: "no-store" }),
      ])
        .then(async ([tripResponse, packingResponse]) => {
          if (!tripResponse.ok || !packingResponse.ok) {
            throw new Error("Private trip data unavailable");
          }
          const data = normalizePrivateData(
            await tripResponse.json(),
            await packingResponse.json(),
          );
          writePrivateDataCache(data);
          if (active) setBootstrap({ mode: "private-ready", data });
        })
        .catch(() => {
          if (!active) return;
          const cached = readPrivateDataCache();
          setBootstrap(
            cached
              ? { mode: "private-ready", data: cached }
              : { mode: "private-unavailable" },
          );
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(resolveMode);
    };
  }, [retry]);

  if (bootstrap.mode === "share") return <ShareView trip={initialShareTrip} />;
  if (bootstrap.mode === "private-ready") {
    return <PrivateHome trip={bootstrap.data.trip} packing={bootstrap.data.packing} />;
  }
  if (bootstrap.mode === "private-unavailable") {
    return (
      <main className="private-bootstrap" data-testid="private-reconnect-view">
        <section className="page">
          <div className="empty-state">
            <h1>Reconnect to load this trip</h1>
            <p>
              Private mode has not saved an offline trip on this device yet. Reconnect, then try
              again.
            </p>
            <button className="primary-button" onClick={() => setRetry((value) => value + 1)}>
              Try again
            </button>
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="private-bootstrap" data-testid="private-loading-view">
      <section className="page">
        <div className="empty-state">Loading private trip…</div>
      </section>
    </main>
  );
}

function PrivateHome({
  trip,
  packing,
}: {
  trip: TripData;
  packing: Record<PackingPerson, PackingItem[]>;
}) {
  const packingPeople = Object.keys(packing) as PackingPerson[];
  const [tab, setTab] = useState<Tab>("today");
  const [person, setPerson] = useState<PackingPerson>(packingPeople[0] || "");
  const [packFilter, setPackFilter] = useState<
    "all" | "remaining" | "completed"
  >("all");
  const [query, setQuery] = useState("");
  const shareMode = false;
  const shared = useSharedState();
  const sampleData = Boolean(trip.identity.sample_data);
  const heroTitle = asStringArray(trip.identity.hero_title);
  const tripDates = asRecord(trip.identity.trip_dates);

  const travelers = trip.travelers;
  const travelerNames = travelers.map(
    ({ display_name: name }) => name as string,
  );
  const airports = trip.airports;
  const onwardSteps = trip.onward_steps;
  const dailyPlan = trip.daily_plan;
  const prepGroups = trip.preparation_groups;
  const selectedPacking = useMemo(
    () => packing[person] || [],
    [packing, person],
  );

  useEffect(() => {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "/manifest.webmanifest?v=3";
    manifest.dataset.privatePwa = "true";
    document.head.append(manifest);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js?v=5", { updateViaCache: "none" })
        .catch(() => undefined);
    }
    return () => manifest.remove();
  }, []);

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
  const openShareMode = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("share", "1");
    window.location.assign(url);
  };

  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayPlan =
    dailyPlan.find((day) => day.date === todayIso) ||
    dailyPlan.find((day) => day.date >= todayIso) ||
    dailyPlan.at(-1) ||
    { date: "", place: "Trip overview", events: [] };
  const todayEvents = asArray<[string, string, string?]>(todayPlan.events);
  const packRows = useMemo(
    () =>
      selectedPacking.filter((item) => {
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
    [selectedPacking, packFilter, query, shared.state.checks],
  );
  const groupedPack = Object.groupBy(packRows, (item) => item.category);
  const completed = selectedPacking.filter(
    (item) => shared.state.checks[item.id],
  ).length;

  return (
    <main data-testid="private-trip-view">
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
          onClick={openShareMode}
        >
          Open share-safe view
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
              ? "Connecting to private trip state…"
              : `Private state synced${shared.state.syncedAt ? ` • ${new Date(shared.state.syncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}
          </div>
        )}

        {tab === "today" && (
          <section>
            <div className="hero">
              <span className="eyebrow">
                {text(tripDates.label, "Trip dates pending")}
              </span>
              <h1>
                {heroTitle.length ? heroTitle[0] : trip.identity.trip_name}
                {heroTitle.length > 1 && (
                  <>
                    <br />
                    {heroTitle[1]}
                  </>
                )}
              </h1>
              {hasText(trip.identity.hero_description) && (
                <p>{trip.identity.hero_description}</p>
              )}
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
                {todayEvents.length ? (
                  <div className="next-event">
                    <b>{todayEvents[0][0]}</b>
                    <strong>{todayEvents[0][1]}</strong>
                    {todayEvents[0][2] && <p>{todayEvents[0][2]}</p>}
                  </div>
                ) : (
                  <div className="empty-state">
                    No timed events supplied for this day.
                  </div>
                )}
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
                  Checklist progress is shared across this private app and
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
              kicker={`${trip.flights.length} ${sampleData ? "fictional " : ""}flight legs`}
              title="Flights & transportation"
              text={
                sampleData
                  ? "Fictional terminal snapshots, seats, transport records, and onward steps in one reference view."
                  : "Known flight and transport details, pending fields, and onward steps in one private reference view."
              }
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
                    {text(record.status, "Pending").replaceAll("_", " ")}
                  </span>
                  <h2>{record.route}</h2>
                  <p>
                    <strong>{readableDate(record.date)}</strong>
                  </p>
                  {hasText(record.service) && (
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
                      {!shareMode &&
                        (hasText(record.pnr) || hasText(record.coach)) && (
                        <div>
                          <dt>PNR / coach</dt>
                          <dd>
                            {record.pnr} • Coach {record.coach}
                          </dd>
                        </div>
                      )}
                      {!shareMode && isObject(record.seats) && (
                        <div>
                          <dt>Seats</dt>
                          <dd>
                            {Object.entries(record.seats)
                              .map(([name, seat]) => `${name} ${seat}`)
                              .join(" • ")}
                          </dd>
                        </div>
                      )}
                      {!shareMode && isObject(record.boarding_codes) && (
                        <div>
                          <dt>Boarding codes</dt>
                          <dd>
                            {Object.entries(record.boarding_codes)
                              .map(([name, code]) => `${name} ${code}`)
                              .join(" • ")}
                          </dd>
                        </div>
                      )}
                      {!shareMode &&
                        [record.fare, record.class, record.price_total].some(
                          hasText,
                        ) && (
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
              {trip.lodging.map((stay, index) => {
                const address = text(stay.address);
                const host = text(stay.host);
                const hostPhone = text(stay.host_phone);
                const checkInSteps = asStringArray(stay.check_in_process);
                const luggageOptions = asStringArray(
                  stay.nearby_luggage_storage_addresses,
                );
                const checkoutSteps = asStringArray(stay.checkout_steps);
                const pending = Array.isArray(stay.pending)
                  ? asStringArray(stay.pending)
                  : hasText(stay.pending)
                    ? [stay.pending]
                    : [];
                return (
                  <article
                    className="lodging-card"
                    key={`${text(stay.city, "lodging")}-${index}`}
                  >
                    <div className="lodging-head">
                      <div>
                        <span className="kicker">
                          {text(stay.city, "Location pending")}
                        </span>
                        <h2>{text(stay.display_name, "Lodging details pending")}</h2>
                        {address && <p>{address}</p>}
                      </div>
                      {address && (
                        <a
                          className="map-button"
                          href={mapUrl(address)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Map
                        </a>
                      )}
                    </div>
                    {(hostPhone || address) && (
                      <div className="action-row">
                        {hostPhone && (
                          <>
                            <a href={`tel:${hostPhone.replace(/\s/g, "")}`}>
                              Call {host || "lodging contact"}
                            </a>
                            <a
                              href={`https://wa.me/${hostPhone.replace(/[^0-9]/g, "")}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              WhatsApp
                            </a>
                          </>
                        )}
                        {address && (
                          <button
                            onClick={() => navigator.clipboard.writeText(address)}
                          >
                            Copy address
                          </button>
                        )}
                      </div>
                    )}
                    <dl className="detail-grid">
                      {hasText(stay.confirmation) && (
                        <div>
                          <dt>Confirmation</dt>
                          <dd>{stay.confirmation}</dd>
                        </div>
                      )}
                      {hasText(stay.guests) && (
                        <div>
                          <dt>Guests</dt>
                          <dd>{stay.guests}</dd>
                        </div>
                      )}
                      {hasText(stay.check_in) && (
                        <div>
                          <dt>Check-in</dt>
                          <dd>
                            {clock(stay.check_in)} •{" "}
                            {readableDate(stay.check_in.slice(0, 10))}
                          </dd>
                        </div>
                      )}
                      {hasText(stay.check_out) && (
                        <div>
                          <dt>Check-out</dt>
                          <dd>
                            {clock(stay.check_out)} •{" "}
                            {readableDate(stay.check_out.slice(0, 10))}
                          </dd>
                        </div>
                      )}
                      {(host || hostPhone) && (
                        <div>
                          <dt>Host</dt>
                          <dd>{[host, hostPhone].filter(Boolean).join(" • ")}</dd>
                        </div>
                      )}
                    </dl>
                    {checkInSteps.length > 0 && (
                      <div className="instruction-box">
                        <h3>{sampleData ? "Demonstration check-in sequence" : "Check-in sequence"}</h3>
                        <ol>
                          {checkInSteps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {(isObject(stay.private_access) || isObject(stay.wifi)) && (
                      <div className="secret-grid">
                        {Object.entries(asRecord(stay.private_access)).map(
                          ([label, value]) => (
                            <Secret
                              key={label}
                              label={label.replaceAll("_", " ")}
                              value={String(value)}
                              shareMode={shareMode}
                            />
                          ),
                        )}
                        {Object.entries(asRecord(stay.wifi)).map(
                          ([label, value]) => (
                            <Secret
                              key={label}
                              label={`Wi-Fi ${label}`}
                              value={String(value)}
                              shareMode={shareMode}
                            />
                          ),
                        )}
                      </div>
                    )}
                    {(hasText(stay.manager_contact_plan) ||
                      hasText(stay.possible_early_check_in)) && (
                      <div className="notice">
                        <strong>{sampleData ? "Demonstration check-in:" : "Check-in:"}</strong>{" "}
                        {[stay.manager_contact_plan, stay.possible_early_check_in]
                          .filter(hasText)
                          .join(" ")}
                      </div>
                    )}
                    {hasText(stay.luggage_plan) && (
                      <p>
                        <strong>Luggage:</strong> {stay.luggage_plan}
                      </p>
                    )}
                    {hasText(stay.power_note) && (
                      <div className="notice">
                        <strong>Equipment note:</strong> {stay.power_note}
                      </div>
                    )}
                    {(luggageOptions.length > 0 || checkoutSteps.length > 0) && (
                      <div className="instruction-columns">
                        {luggageOptions.length > 0 && (
                          <div>
                            <h3>{sampleData ? "Demonstration luggage options" : "Luggage options"}</h3>
                            {luggageOptions.map((item) => (
                              <a
                                key={item}
                                href={mapUrl(item)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {item}
                              </a>
                            ))}
                          </div>
                        )}
                        {checkoutSteps.length > 0 && (
                          <div>
                            <h3>Checkout</h3>
                            {checkoutSteps.map((step) => (
                              <span key={step}>{step}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {pending.length > 0 && (
                      <div className="pending-list">
                        {pending.map((item) => (
                          <span key={item}>Pending live update: {item}</span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
              {!trip.lodging.length && (
                <div className="empty-state">No lodging records added.</div>
              )}
            </div>
          </section>
        )}

        {tab === "cruise" && (
          <section className="page">
            <PageIntro
              kicker={`${text(trip.cruise.ship, "No vessel added")}${hasText(trip.cruise.dates) ? ` • ${trip.cruise.dates}` : ""}`}
              title="Coastal vessel command center"
              text={
                sampleData
                  ? "Fictional reservations, cabins, port schedule, dining, and a general safety reminder."
                  : "Known vessel, room, port, dining, and safety details for this private trip."
              }
            />
            <div className="room-grid">
              {trip.cruise.staterooms.map((room: LooseRecord, index: number) => (
                <article
                  className="room-card"
                  key={`${text(room.reservation, "room")}-${index}`}
                >
                  <span>
                    {[hasText(room.deck) ? `Deck ${room.deck}` : "", room.location]
                      .filter(hasText)
                      .join(" • ") || "Room location pending"}
                  </span>
                  <h2>
                    {hasText(room.stateroom)
                      ? `Stateroom ${room.stateroom}`
                      : "Stateroom details pending"}
                  </h2>
                  {hasText(room.category) && <p>{room.category}</p>}
                  {hasText(room.reservation) && (
                    <Secret
                      label="Reservation"
                      value={room.reservation}
                      shareMode={shareMode}
                    />
                  )}
                  {asStringArray(room.assigned_travelers).length > 0 && (
                    <strong>
                      {asStringArray(room.assigned_travelers).join(" + ")}
                    </strong>
                  )}
                </article>
              ))}
            </div>
            {hasText(trip.cruise.sleeping_note) && (
              <p className="notice">{trip.cruise.sleeping_note}</p>
            )}
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
              {hasText(trip.cruise.safety_rule) && (
                <article className="card warning-card">
                  <span className="kicker">Safety rule</span>
                  <h2>Posted ship time controls</h2>
                  <p>{trip.cruise.safety_rule}</p>
                </article>
              )}
            </div>
            {!trip.cruise.staterooms.length &&
              !trip.cruise.ports.length &&
              !trip.cruise.dining.length &&
              !hasText(trip.cruise.safety_rule) && (
                <div className="empty-state">
                  No cruise or vessel details added for this trip.
                </div>
              )}
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
                      className={`status-badge ${hasText(tour.status) ? "active" : ""}`}
                    >
                      {text(tour.status, "Status pending").replaceAll("_", " ")}
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
                  {hasText(tour.booking_reference) && (
                    <Secret
                      label="Booking reference"
                      value={tour.booking_reference}
                      shareMode={shareMode}
                    />
                  )}
                  {hasText(tour.confirmation) && (
                    <Secret
                      label="Confirmation"
                      value={tour.confirmation}
                      shareMode={shareMode}
                    />
                  )}
                  {hasText(tour.pin) && (
                    <Secret
                      label="Private PIN"
                      value={tour.pin}
                      shareMode={shareMode}
                    />
                  )}
                  {[tour.meeting, tour.meeting_return, tour.ticket_pickup].some(
                    hasText,
                  ) && (
                    <p>
                      <strong>Meeting:</strong>{" "}
                      {text(
                        tour.meeting,
                        text(tour.meeting_return, text(tour.ticket_pickup)),
                      )}
                    </p>
                  )}
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
                  {isObject(tour.coordinates) &&
                    tour.coordinates.lat !== undefined &&
                    tour.coordinates.lng !== undefined && (
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
                  {(hasText(tour.phone) || hasText(tour.map_address)) && (
                    <div className="action-row private-field">
                      {hasText(tour.phone) && (
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
                      {hasText(tour.map_address) && (
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
                  {asStringArray(tour.bring).length > 0 && (
                    <div className="tour-bring">
                      <strong>Bring</strong>
                      {asStringArray(tour.bring).map((item) => (
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
              {!trip.tours.length && (
                <div className="empty-state">No activities added.</div>
              )}
            </div>
          </section>
        )}

        {tab === "packing" && (
          <section className="page print-packing">
            <PageIntro
              kicker={sampleData ? "Fictional individual lists" : "Private individual lists"}
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
                  <span>{packing[name]?.length || 0}</span>
                </button>
              ))}
            </div>
            <div className="packing-toolbar">
              <div>
                <strong>
                  {completed}/{selectedPacking.length} complete
                </strong>
                <span>{selectedPacking.length - completed} remaining</span>
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
              kicker={`${text(trip.connectivity.provider, "Provider not selected")} • ${sampleData ? "inert examples" : "private planning"}`}
              title="Connectivity & eSIMs"
              text={sampleData
                ? "Non-activatable profile records exercise the shared assignment control without exposing real connectivity data."
                : "Private connectivity planning. Never store activation tokens, ICCIDs, QR payloads, or carrier credentials here."}
            />
            {(hasText(trip.connectivity.order) ||
              hasText(trip.connectivity.assignment_status) ||
              hasText(trip.connectivity.demo_notice)) && (
              <div className="notice">
              {hasText(trip.connectivity.order) && (
                <strong>Order {trip.connectivity.order}: </strong>
              )}
              {text(trip.connectivity.assignment_status)}
              {hasText(trip.connectivity.demo_notice) && (
                <span>{trip.connectivity.demo_notice}</span>
              )}
              </div>
            )}
            <div className="esim-grid">
              {trip.connectivity.profiles.map((esim: LooseRecord) => (
                <article className="esim-card" key={esim.slot}>
                  <span>eSIM {esim.slot}</span>
                  <h2>{text(esim.phone, "Profile details pending")}</h2>
                  {hasText(esim.demo_identifier) && (
                    <Secret
                      label={sampleData ? "Inert demo identifier" : "Profile label"}
                      value={esim.demo_identifier}
                      shareMode={shareMode}
                    />
                  )}
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
            {!trip.connectivity.profiles.length && (
              <div className="empty-state">No connectivity profiles added.</div>
            )}
            <div className="card-grid">
              {trip.connectivity.instructions.map((instruction: string) => (
                <article className="card mini" key={instruction}>
                  <strong>{instruction}</strong>
                </article>
              ))}
              {hasText(trip.connectivity.vessel_connectivity) && (
                <article className="card mini">
                  <strong>{trip.connectivity.vessel_connectivity}</strong>
                </article>
              )}
            </div>
          </section>
        )}

        {tab === "safety" && (
          <section className="page">
            <PageIntro
              kicker="Generalized planning preferences"
              title="Safety & accessibility"
              text={sampleData
                ? "Harmless pacing, wayfinding, and accessibility reminders for the fictional field team. No private medical details are included."
                : "Private pacing, wayfinding, and accessibility preferences. Keep diagnoses and highly sensitive medical details outside this app."}
            />
            <div className="emergency">
              <strong>Public emergency guidance</strong>
              <span>
                {text(
                  trip.safety_accessibility.public_emergency_guidance,
                  "No trip-specific guidance supplied. Use current official local emergency information.",
                )}
              </span>
            </div>
            <div className="health-grid">
              {trip.safety_accessibility.traveler_preferences.map(
                (profile: LooseRecord) => (
                <article className="health-card" key={profile.traveler}>
                  <h2>{profile.traveler}</h2>
                  {asStringArray(profile.items).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </article>
                ),
              )}
            </div>
            {!trip.safety_accessibility.traveler_preferences.length && (
              <div className="empty-state">
                No traveler-specific operational preferences added.
              </div>
            )}
            {trip.safety_accessibility.general_guidance.length > 0 && (
              <div className="notice">
                {trip.safety_accessibility.general_guidance.map((rule: string) => (
                  <span key={rule}>{rule}</span>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "vault" && (
          <section className="page vault-page">
            <PageIntro
              kicker={sampleData ? "Obvious demonstration • masked by default" : "Private browser-delivered references"}
              title={sampleData ? "Demo bookings & inert access" : "Private booking references"}
              text={sampleData
                ? "These fictional values exercise reveal and copy interactions. Every booking starts with DEMO-, and every access value is inert."
                : "Values here are delivered to the browser and are not encrypted by this app. Keep passwords, access codes, ticket payloads, and other secrets in the provider's protected system."}
            />
            <div className="privacy-banner">
              {sampleData
                ? "Demonstration values are hidden in print and share-safe modes. This interface does not encrypt values and must never be used as a real password, access-code, or booking vault."
                : "These private references are omitted from share-safe mode. This interface does not encrypt values; keep passwords, access codes, and ticket payloads in the provider's protected system."}
            </div>
            {trip.demo_vault_groups.map((group: LooseRecord, groupIndex: number) => (
              <div key={`${text(group.title, "private-references")}-${groupIndex}`}>
                {hasText(group.title) && (
                  <h2 className="section-title">{group.title}</h2>
                )}
                <div className="secret-grid">
                  {asRecordArray(group.items).map((item: LooseRecord) => (
                    <Secret
                      key={`${group.title}-${item.label}`}
                      label={text(item.label)}
                      value={text(item.value)}
                      shareMode={shareMode}
                    />
                  ))}
                </div>
              </div>
            ))}
            {!trip.demo_vault_groups.length && (
              <div className="empty-state">No booking references stored here.</div>
            )}
          </section>
        )}

        {tab === "pending" && (
          <section className="page">
            <PageIntro
              kicker="Known unknowns"
              title="Pending live updates"
              text={sampleData
                ? "Each fictional missing detail names what is pending and when it should arrive. Saved values synchronize across reference devices."
                : "Each missing detail names what is pending and when it should arrive. Saved values synchronize across authorized private devices."}
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
            {!trip.pending_updates.length && (
              <div className="empty-state">No pending details tracked.</div>
            )}
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
        <button onClick={openShareMode}>Share-safe</button>
      </nav>
      <footer>
        <span>{trip.identity.application_name}</span>
        <span>
          {sampleData
            ? trip.identity.footer_note
            : "Private personal-trip data • protect this server with access control before remote use"}
        </span>
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

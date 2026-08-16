const clone = (value) => JSON.parse(JSON.stringify(value));

function shareSafeFlight(flight) {
  return {
    date: flight.date,
    route: clone(flight.route),
    flight_number: flight.flight_number,
    operating_airline: flight.operating_airline,
    departure_local: flight.departure_local,
    arrival_local: flight.arrival_local,
    duration: flight.duration,
  };
}

function shareSafeGroundTransport(record) {
  return Object.fromEntries(
    [
      "date",
      "route",
      "status",
      "service",
      "departure_local",
      "arrival_local",
      "primary_plan",
      "backup_plan",
      "preferred_plan",
      "target_airport_arrival",
      "suggested_departure_window",
    ]
      .filter((key) => key in record)
      .map((key) => [key, clone(record[key])]),
  );
}

function shareSafeTour(tour) {
  return Object.fromEntries(
    [
      "date",
      "name",
      "type",
      "status",
      "provider",
      "time",
      "duration",
      "travelers",
      "bring",
      "safety_note",
      "cancellation",
    ]
      .filter((key) => key in tour)
      .map((key) => [key, clone(tour[key])]),
  );
}

export function toShareSafeTrip(source) {
  return {
    identity: clone(source.identity),
    travelers: clone(source.travelers),
    airports: clone(source.airports),
    onward_steps: {},
    flights: source.flights.map(shareSafeFlight),
    ground_transport: source.ground_transport.map(shareSafeGroundTransport),
    lodging: [],
    cruise: {
      ship: source.cruise.ship,
      dates: source.cruise.dates,
      embarkation_port: source.cruise.embarkation_port,
      staterooms: [],
      sleeping_note:
        "Cabin assignments and reservation details are structurally omitted in share-safe mode.",
      ports: clone(source.cruise.ports),
      dining: clone(source.cruise.dining),
      safety_rule: source.cruise.safety_rule,
    },
    tours: source.tours.map(shareSafeTour),
    connectivity: {
      provider: source.connectivity.provider,
      assignment_status:
        "Connectivity profiles and assignments are structurally omitted in share-safe mode",
      demo_notice: source.connectivity.demo_notice,
      profiles: [],
      instructions: clone(source.connectivity.instructions),
      vessel_connectivity: source.connectivity.vessel_connectivity,
    },
    safety_accessibility: {
      public_emergency_guidance:
        source.safety_accessibility.public_emergency_guidance,
      traveler_preferences: [],
      general_guidance: clone(source.safety_accessibility.general_guidance),
    },
    pending_updates: [],
    daily_plan: source.daily_plan.map((day) => ({
      ...clone(day),
      events: day.events.map(([time, title]) => [time, title]),
    })),
    preparation_groups: {},
    demo_vault_groups: [],
  };
}

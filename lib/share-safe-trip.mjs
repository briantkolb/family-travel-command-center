const IDENTITY_KEYS = [
  "application_name",
  "short_name",
  "share_title",
  "date_label",
  "summary",
];
const DAY_KEYS = ["date", "place_label", "summary"];
const TRANSPORT_KEYS = ["date", "route_label", "service_label", "status"];
const PORT_KEYS = ["date", "port"];
const TOUR_KEYS = ["date", "name", "status"];
const ROOT_KEYS = ["schema_version", "identity", "days", "transport", "ports", "tours"];

const MINIMAL_SHARE_TRIP = Object.freeze({
  schema_version: 1,
  identity: Object.freeze({
    application_name: "Family Travel Command Center",
    short_name: "Family Travel",
    share_title: "Share-safe trip view",
    date_label: "",
    summary: "No details approved for sharing.",
  }),
  days: Object.freeze([]),
  transport: Object.freeze([]),
  ports: Object.freeze([]),
  tours: Object.freeze([]),
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isStringRecord(value, keys) {
  return hasExactKeys(value, keys) && keys.every((key) => typeof value[key] === "string");
}

function isStringRecordArray(value, keys) {
  return Array.isArray(value) && value.every((item) => isStringRecord(item, keys));
}

function diagnoseObject(value, path, keys, problems) {
  if (!isPlainObject(value)) {
    problems.push(`${path} must be an object`);
    return false;
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) problems.push(`${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) problems.push(`${path}.${key} is not permitted`);
  }
  return true;
}

function diagnoseStringRecord(value, path, keys, problems) {
  if (!diagnoseObject(value, path, keys, problems)) return;
  for (const key of keys) {
    if (Object.hasOwn(value, key) && typeof value[key] !== "string") {
      problems.push(`${path}.${key} must be a string`);
    }
  }
}

function diagnoseStringRecordArray(value, path, keys, problems) {
  if (!Array.isArray(value)) {
    problems.push(`${path} must be an array`);
    return;
  }
  value.forEach((item, index) =>
    diagnoseStringRecord(item, `${path}[${index}]`, keys, problems),
  );
}

export function isShareTripV1(value) {
  return (
    hasExactKeys(value, ROOT_KEYS) &&
    value.schema_version === 1 &&
    isStringRecord(value.identity, IDENTITY_KEYS) &&
    isStringRecordArray(value.days, DAY_KEYS) &&
    isStringRecordArray(value.transport, TRANSPORT_KEYS) &&
    isStringRecordArray(value.ports, PORT_KEYS) &&
    isStringRecordArray(value.tours, TOUR_KEYS)
  );
}

export function diagnoseShareProfile(source) {
  if (!isPlainObject(source) || !Object.hasOwn(source, "sharing")) {
    return { status: "absent", problems: [], counts: null };
  }

  const profile = source.sharing;
  const problems = [];
  if (diagnoseObject(profile, "sharing", ROOT_KEYS, problems)) {
    if (profile.schema_version !== 1) {
      problems.push("sharing.schema_version must equal 1");
    }
    diagnoseStringRecord(profile.identity, "sharing.identity", IDENTITY_KEYS, problems);
    diagnoseStringRecordArray(profile.days, "sharing.days", DAY_KEYS, problems);
    diagnoseStringRecordArray(
      profile.transport,
      "sharing.transport",
      TRANSPORT_KEYS,
      problems,
    );
    diagnoseStringRecordArray(profile.ports, "sharing.ports", PORT_KEYS, problems);
    diagnoseStringRecordArray(profile.tours, "sharing.tours", TOUR_KEYS, problems);
  }

  if (problems.length || !isShareTripV1(profile)) {
    return {
      status: "invalid",
      problems: problems.length ? problems : ["sharing does not match ShareTripV1"],
      counts: null,
    };
  }

  return {
    status: "valid",
    problems: [],
    counts: {
      days: profile.days.length,
      transport: profile.transport.length,
      ports: profile.ports.length,
      tours: profile.tours.length,
    },
  };
}

export function formatShareProfileDiagnostic(source) {
  const diagnostic = diagnoseShareProfile(source);
  if (diagnostic.status === "absent") {
    return "sharing=disabled: no canonical sharing profile is present; no details are approved";
  }
  if (diagnostic.status === "invalid") {
    return `WARNING sharing=invalid: share mode will fail closed; ${diagnostic.problems.join("; ")}`;
  }
  const { days, transport, ports, tours } = diagnostic.counts;
  return `sharing=accepted: days=${days} transport=${transport} ports=${ports} tours=${tours}`;
}

function minimalShareTrip() {
  return {
    schema_version: MINIMAL_SHARE_TRIP.schema_version,
    identity: {
      application_name: MINIMAL_SHARE_TRIP.identity.application_name,
      short_name: MINIMAL_SHARE_TRIP.identity.short_name,
      share_title: MINIMAL_SHARE_TRIP.identity.share_title,
      date_label: MINIMAL_SHARE_TRIP.identity.date_label,
      summary: MINIMAL_SHARE_TRIP.identity.summary,
    },
    days: [],
    transport: [],
    ports: [],
    tours: [],
  };
}

/**
 * Construct ShareTripV1 only from an explicitly reviewed canonical `sharing`
 * profile. Every permitted leaf is copied individually. Unknown keys, missing
 * keys, and incorrect types invalidate the complete profile and fail closed.
 */
export function toShareSafeTrip(source) {
  const profile = source?.sharing;
  if (!isShareTripV1(profile)) return minimalShareTrip();

  return {
    schema_version: 1,
    identity: {
      application_name: profile.identity.application_name,
      short_name: profile.identity.short_name,
      share_title: profile.identity.share_title,
      date_label: profile.identity.date_label,
      summary: profile.identity.summary,
    },
    days: profile.days.map((day) => ({
      date: day.date,
      place_label: day.place_label,
      summary: day.summary,
    })),
    transport: profile.transport.map((record) => ({
      date: record.date,
      route_label: record.route_label,
      service_label: record.service_label,
      status: record.status,
    })),
    ports: profile.ports.map((record) => ({
      date: record.date,
      port: record.port,
    })),
    tours: profile.tours.map((record) => ({
      date: record.date,
      name: record.name,
      status: record.status,
    })),
  };
}

export const shareTripV1Keys = Object.freeze({
  root: Object.freeze([...ROOT_KEYS]),
  identity: Object.freeze([...IDENTITY_KEYS]),
  day: Object.freeze([...DAY_KEYS]),
  transport: Object.freeze([...TRANSPORT_KEYS]),
  port: Object.freeze([...PORT_KEYS]),
  tour: Object.freeze([...TOUR_KEYS]),
});

export const PRIVATE_BUILD_VALIDATION_CANARY =
  "SECRET_CANARY_GENERATED_PRIVATE_ONLY";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requirePlainObject(value, path) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function requireNonEmptyString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function validateOptionalArray(container, key, path) {
  if (Object.hasOwn(container, key)) {
    return requireArray(container[key], `${path}.${key}`);
  }
  return [];
}

function validateOptionalRecordArray(container, key, path) {
  const values = validateOptionalArray(container, key, path);
  values.forEach((value, index) =>
    requirePlainObject(value, `${path}.${key}[${index}]`),
  );
  return values;
}

function validateOptionalStringArray(container, key, path) {
  const values = validateOptionalArray(container, key, path);
  values.forEach((value, index) => {
    if (typeof value !== "string") {
      throw new Error(`${path}.${key}[${index}] must be a string.`);
    }
  });
  return values;
}

function validateOptionalObject(container, key, path) {
  if (Object.hasOwn(container, key)) {
    requirePlainObject(container[key], `${path}.${key}`);
  }
}

export function validateCanonicalTrip(trip) {
  requirePlainObject(trip, "The canonical trip");
  const identity = requirePlainObject(trip.identity, "identity");
  requireNonEmptyString(identity.trip_name, "identity.trip_name");
  if (typeof identity.sample_data !== "boolean") {
    throw new Error("identity.sample_data must be true or false.");
  }

  const travelers = requireArray(trip.travelers, "travelers");
  if (travelers.length < 1) {
    throw new Error("The canonical trip must define at least one traveler.");
  }
  const travelerIds = [];
  const travelerNames = [];
  travelers.forEach((traveler, index) => {
    requirePlainObject(traveler, `travelers[${index}]`);
    travelerIds.push(
      requireNonEmptyString(traveler.id, `travelers[${index}].id`),
    );
    travelerNames.push(
      requireNonEmptyString(
        traveler.display_name,
        `travelers[${index}].display_name`,
      ),
    );
  });
  if (
    new Set(travelerIds).size !== travelerIds.length ||
    new Set(travelerNames).size !== travelerNames.length
  ) {
    throw new Error("Traveler IDs and display names must be unique.");
  }

  const dailyPlan = requireArray(trip.daily_plan, "daily_plan");
  if (dailyPlan.length < 1) {
    throw new Error("The canonical trip must define at least one daily-plan entry.");
  }
  dailyPlan.forEach((day, dayIndex) => {
    requirePlainObject(day, `daily_plan[${dayIndex}]`);
    requireNonEmptyString(day.date, `daily_plan[${dayIndex}].date`);
    requireNonEmptyString(day.place, `daily_plan[${dayIndex}].place`);
    if (!Object.hasOwn(day, "events")) return;
    requireArray(day.events, `daily_plan[${dayIndex}].events`).forEach(
      (event, eventIndex) => {
        if (
          !Array.isArray(event) ||
          event.length < 2 ||
          event.length > 3 ||
          event.some((value) => typeof value !== "string")
        ) {
          throw new Error(
            `daily_plan[${dayIndex}].events[${eventIndex}] must contain two or three strings.`,
          );
        }
      },
    );
  });

  for (const key of [
    "flights",
    "ground_transport",
    "lodging",
    "tours",
    "pending_updates",
    "demo_vault_groups",
  ]) {
    validateOptionalRecordArray(trip, key, "trip");
  }
  for (const key of [
    "airports",
    "onward_steps",
    "cruise",
    "connectivity",
    "safety_accessibility",
    "preparation_groups",
  ]) {
    validateOptionalObject(trip, key, "trip");
  }

  const cruise = isPlainObject(trip.cruise) ? trip.cruise : {};
  for (const key of ["staterooms", "ports", "dining"]) {
    validateOptionalRecordArray(cruise, key, "cruise");
  }

  const connectivity = isPlainObject(trip.connectivity)
    ? trip.connectivity
    : {};
  const connectivityProfiles = validateOptionalRecordArray(
    connectivity,
    "profiles",
    "connectivity",
  );
  validateOptionalStringArray(connectivity, "instructions", "connectivity");
  const connectivitySlots = connectivityProfiles.map((profile) => profile.slot);
  if (
    connectivitySlots.some(
      (slot) => !Number.isInteger(slot) || slot < 1 || slot > 4,
    ) ||
    new Set(connectivitySlots).size !== connectivitySlots.length
  ) {
    throw new Error(
      "Connectivity profile slots must be unique integers from 1 to 4.",
    );
  }

  const safety = isPlainObject(trip.safety_accessibility)
    ? trip.safety_accessibility
    : {};
  const travelerPreferences = validateOptionalRecordArray(
    safety,
    "traveler_preferences",
    "safety_accessibility",
  );
  travelerPreferences.forEach((profile, index) => {
    if (Object.hasOwn(profile, "items")) {
      validateOptionalStringArray(
        profile,
        "items",
        `safety_accessibility.traveler_preferences[${index}]`,
      );
    }
  });
  validateOptionalStringArray(
    safety,
    "general_guidance",
    "safety_accessibility",
  );

  const preparationGroups = isPlainObject(trip.preparation_groups)
    ? trip.preparation_groups
    : {};
  for (const [group, items] of Object.entries(preparationGroups)) {
    requireArray(items, `preparation_groups.${group}`).forEach((item, index) => {
      if (typeof item !== "string") {
        throw new Error(`preparation_groups.${group}[${index}] must be a string.`);
      }
    });
  }

  for (const [index, update] of (trip.pending_updates || []).entries()) {
    requireNonEmptyString(update.id, `pending_updates[${index}].id`);
    requireNonEmptyString(update.text, `pending_updates[${index}].text`);
    requireNonEmptyString(update.due, `pending_updates[${index}].due`);
  }

  return { travelerIds, travelerNames, connectivitySlots };
}

export function withPrivateBuildValidationCanary(trip) {
  return {
    ...trip,
    identity: {
      ...trip.identity,
      private_validation_canary: PRIVATE_BUILD_VALIDATION_CANARY,
    },
  };
}

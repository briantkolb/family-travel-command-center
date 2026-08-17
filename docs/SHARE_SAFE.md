# Share-safe Data Contract (ShareTripV1)

Share-safe mode is a deliberately limited, read-only presentation at `/?share=1`. It is useful for an already-authorized friend or family member, but it is not authentication and cannot protect an otherwise reachable private `/` route.

## Fail-closed rule

The generator constructs `app/data/trip-share.json` only from the canonical trip JSON's top-level `sharing` object. It never copies, spreads, deep-clones, or falls back to `identity`, `travelers`, `daily_plan`, flights, lodging, packing, or any other private container.

The `sharing` object must match ShareTripV1 exactly. Every listed key is required, types must match, and unknown keys are rejected. A missing or invalid profile produces only a generic page saying **No details approved for sharing**. This is intentional: a field added by an AI or future application version is private until a human explicitly maps and reviews it.

## Exact permitted schema

```json
{
  "schema_version": 1,
  "identity": {
    "application_name": "string",
    "short_name": "string",
    "share_title": "string",
    "date_label": "string",
    "summary": "string"
  },
  "days": [
    { "date": "string", "place_label": "string", "summary": "string" }
  ],
  "transport": [
    {
      "date": "string",
      "route_label": "string",
      "service_label": "string",
      "status": "string"
    }
  ],
  "ports": [
    { "date": "string", "port": "string" }
  ],
  "tours": [
    { "date": "string", "name": "string", "status": "string" }
  ]
}
```

Empty arrays are valid. Keep any string empty rather than substituting a private value. Do not add keys to this object; the validator treats additional properties as an invalid profile.

## Always omitted

ShareTripV1 has no fields for:

- Traveler names, roles, party assignments, or accessibility/medical preferences
- Packing items, notes, completion state, preparation lists, or state identifiers
- Dining, lodging, rooms, contacts, addresses, maps, Wi-Fi, or access data
- Flight numbers, ticket/booking references, seats, gates, terminals, or minute-level times
- Minute-level daily events or private movement details
- Connectivity profiles, pending updates, vault data, mutable state, or offline queues
- The versioned private offline trip/packing cache (`travel-reference-private-data-v1`)

Packing is private by default and has no share-safe representation.

## Browser and PWA behavior

A fresh direct share navigation does not request `/api/trip`, `/api/packing`, or `/api/state`; it has no mutation controls or private-view link. It does not advertise a manifest, register a service worker, write local/session storage, or create a share queue. An already installed private service worker keeps private and share navigation cache keys separate and never falls back from share to private content.

Private mode includes an explicit **Open share-safe view** control on desktop and mobile. Share-safe mode intentionally has no reverse navigation control.

## Review checklist

Before distributing a link, inspect the canonical `sharing` block and the generated `app/data/trip-share.json`. Run `npm run check`, open a fresh private-browser context directly at `/?share=1`, and verify that each retained date/place/activity label is genuinely appropriate for every intended recipient.

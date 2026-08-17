import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  startProductionServer,
  stopProductionServer,
  waitForResponse,
} from "./helpers/production-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const referenceTrip = JSON.parse(
  await readFile(path.join(root, "data", "northstar-isles-trip.json"), "utf8"),
);

test("neutral production HTML and every referenced local asset are available", { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "travel-reference-html-"));
  const port = 25200 + Math.floor(Math.random() * 500);
  let running;
  try {
    running = await startProductionServer({ dataDir, port, appPort: port + 1 });
    const response = await waitForResponse(`${running.origin}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /Family Travel Command Center/);
    assert.match(html, /Loading private trip/);
    assert.equal(html.includes(referenceTrip.sharing.identity.share_title), false);
    assert.doesNotMatch(html, /Your whole trip/);
    assert.doesNotMatch(html, /manifest\.webmanifest/);
    assert.doesNotMatch(html, /fonts\.googleapis|codex-preview/i);
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");

    const references = [
      ...html.matchAll(/(?:src|href)=["'](\/[^"']+)["']/g),
    ]
      .map((match) => match[1])
      .filter((value) => /\.(?:js|css|png|svg|webmanifest)(?:\?|$)/.test(value));
    assert.ok(references.some((value) => value.endsWith(".js")));
    for (const reference of new Set(references)) {
      const asset = await fetch(new URL(reference, running.origin));
      assert.equal(asset.status, 200, reference);
      assert.ok(Number(asset.headers.get("content-length") || 1) > 0, reference);
    }

    const shareResponse = await fetch(`${running.origin}/?share=1`);
    assert.equal(shareResponse.status, 200);
    const shareHtml = await shareResponse.text();
    const shareScripts = [
      ...shareHtml.matchAll(/src=["'](\/assets\/[^"']+\.js(?:\?[^"']*)?)["']/g),
    ].map((match) => match[1]);
    const browserDelivered = [shareHtml];
    for (const reference of new Set(shareScripts)) {
      const asset = await fetch(new URL(reference, running.origin));
      assert.equal(asset.status, 200, reference);
      browserDelivered.push(await asset.text());
    }
    const deliveredText = browserDelivered.join("\n");
    const excludedValues = [
      referenceTrip.identity.private_validation_canary,
      ...referenceTrip.flights.map((record) => record.confirmation),
      ...referenceTrip.lodging.flatMap((record) => [
        record.confirmation,
        record.host_phone,
        record.wifi?.network,
      ]),
      ...referenceTrip.cruise.staterooms.map((record) => record.reservation),
      ...referenceTrip.ground_transport.flatMap((record) => [
        record.pnr,
        ...Object.values(record.boarding_codes || {}),
      ]),
    ].filter(Boolean);
    for (const excluded of excludedValues) {
      assert.equal(deliveredText.includes(excluded), false, excluded);
    }

    const shareState = await fetch(`${running.origin}/api/state?share=1`);
    assert.equal(shareState.status, 403);
    assert.deepEqual(await shareState.json(), {
      error: "Private state is unavailable in share-safe mode.",
    });
  } finally {
    await stopProductionServer(running?.child);
    await rm(dataDir, { recursive: true, force: true });
  }
});

// Online demolitions drawn on the server's event (RV-84).
import { describe, expect, it } from "vitest";
import { ServerDemolitions } from "./serverDemolitions";

describe("the cars drawn demolished online", () => {
  it("a predicted demolition without the server's event: drawn as it was (visible, its effects alive)", () => {
    const demolitions = new ServerDemolitions();
    // (the prediction says demoed; nothing from the server)
    expect(demolitions.demoed(7, 1)).toBe(false);
  });

  it("on the event: demolished from that frame on, until the car respawns", () => {
    const demolitions = new ServerDemolitions();
    demolitions.event(7, 1);
    expect(demolitions.demoed(7, 1)).toBe(true);
    expect(demolitions.demoed(8, 1)).toBe(false); // (only the victim)
    expect(demolitions.demoed(7, 1)).toBe(true);
    // (respawned: a new spawn count)
    expect(demolitions.demoed(7, 2)).toBe(false);
    expect(demolitions.demoed(7, 2)).toBe(false);
    // (demolished again later)
    demolitions.event(7, 2);
    expect(demolitions.demoed(7, 2)).toBe(true);
    demolitions.forget(7);
    expect(demolitions.demoed(7, 2)).toBe(false);
  });
});

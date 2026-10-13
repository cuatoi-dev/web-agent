import { describe, expect, it } from "vitest";
import {
  applyNetworkEvent,
  base64ByteLength,
  cap,
  formatHeaders,
  networkLine,
  originOf,
} from "./debugger-network";
import type { NetworkEntry, TabDebugState } from "./debugger-tools.types";

function freshState(): TabDebugState {
  return {
    status: "debugging",
    host: "h",
    dialogs: [],
    dialogPlan: null,
    lastDialog: null,
    emulation: null,
    originalUserAgent: "",
    network: [],
    nextSeq: 1,
  };
}

describe("debugger-network (124/003)", () => {
  it("U1.1: requestWillBeSent pushes an entry and increments nextSeq", () => {
    const s = freshState();
    applyNetworkEvent(s, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Fetch",
      request: {
        method: "POST",
        url: "http://localhost:10040/api/coupon",
        headers: { "content-type": "application/json" },
        postData: "{}",
        hasPostData: true,
      },
    });
    expect(s.network[0]).toEqual({
      seq: 1,
      requestId: "r1",
      method: "POST",
      url: "http://localhost:10040/api/coupon",
      resourceType: "Fetch",
      startTs: 1,
      requestHeaders: { "content-type": "application/json" },
      postData: "{}",
      hasPostData: true,
    });
    expect(s.nextSeq).toBe(2);
  });

  it("U1.2: missing type gives Other and missing hasPostData gives false", () => {
    const s = freshState();
    applyNetworkEvent(s, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      request: {
        method: "GET",
        url: "http://localhost:10040/a",
      },
    });
    expect(s.network[0].resourceType).toBe("Other");
    expect(s.network[0].hasPostData).toBe(false);
  });

  it("U1.3: responseReceived updates status, mimeType and responseHeaders", () => {
    const s = freshState();
    applyNetworkEvent(s, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Fetch",
      request: { method: "GET", url: "http://localhost:10040/a" },
    });
    applyNetworkEvent(s, "Network.responseReceived", {
      requestId: "r1",
      response: { status: 500, mimeType: "application/json", headers: { a: "b" } },
    });
    expect(s.network[0].status).toBe(500);
    expect(s.network[0].mimeType).toBe("application/json");
    expect(s.network[0].responseHeaders).toEqual({ a: "b" });
  });

  it("U1.4: loadingFinished and loadingFailed set endTs and failed", () => {
    const s = freshState();
    applyNetworkEvent(s, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      request: { method: "GET", url: "http://localhost:10040/1" },
    });
    applyNetworkEvent(s, "Network.requestWillBeSent", {
      requestId: "r2",
      timestamp: 2,
      request: { method: "GET", url: "http://localhost:10040/2" },
    });
    applyNetworkEvent(s, "Network.loadingFinished", { requestId: "r1", timestamp: 1.25 });
    applyNetworkEvent(s, "Network.loadingFailed", {
      requestId: "r2",
      timestamp: 3,
      errorText: "net::ERR_FAILED",
    });
    expect(s.network[0].endTs).toBe(1.25);
    expect(s.network[1].failed).toBe("net::ERR_FAILED");
    expect(s.network[1].endTs).toBe(3);
  });

  it("U1.5: redirect updates previous entry and pushes new entry with shared requestId", () => {
    const s = freshState();
    applyNetworkEvent(s, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      request: { method: "GET", url: "http://localhost:10040/a" },
    });
    applyNetworkEvent(s, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 2,
      redirectResponse: { status: 302, mimeType: "text/html", headers: { location: "/b" } },
      request: { method: "GET", url: "http://localhost:10040/b" },
    });
    expect(s.network).toHaveLength(2);
    expect(s.network[0].status).toBe(302);
    expect(s.network[0].endTs).toBe(2);
    expect(s.network[0].responseHeaders).toEqual({ location: "/b" });
    expect(s.network[1].seq).toBe(2);
    expect(s.network[1].startTs).toBe(2);

    applyNetworkEvent(s, "Network.responseReceived", {
      requestId: "r1",
      response: { status: 200 },
    });
    expect(s.network[0].status).toBe(302);
    expect(s.network[1].status).toBe(200);
  });

  it("U1.6: events for unknown requestId or no requestId change nothing", () => {
    const s = freshState();
    applyNetworkEvent(s, "Network.responseReceived", { requestId: "r-unknown" });
    applyNetworkEvent(s, "Network.requestWillBeSent", {});
    expect(s.network).toHaveLength(0);
  });

  it("U1.7: buffer capacity caps at 200 entries and drops oldest", () => {
    const s = freshState();
    for (let i = 0; i <= 200; i++) {
      applyNetworkEvent(s, "Network.requestWillBeSent", {
        requestId: `r${i}`,
        timestamp: i,
        request: { method: "GET", url: `/item/${i}` },
      });
    }
    expect(s.network).toHaveLength(200);
    expect(s.network[0].seq).toBe(2);
    expect(s.network[199].seq).toBe(201);
  });

  it("U1.8: networkLine same origin formats as path + query", () => {
    const entry: NetworkEntry = {
      seq: 1,
      requestId: "r1",
      method: "GET",
      url: "http://localhost:10040/api/x?y=1",
      resourceType: "Fetch",
      status: 200,
      startTs: 1,
      endTs: 1.25,
      requestHeaders: {},
      hasPostData: false,
    };
    expect(networkLine(entry, "http://localhost:10040")).toBe(
      "#1 GET /api/x?y=1 → 200 fetch (250 ms)",
    );
  });

  it("U1.9: networkLine another origin or empty origin shows full URL", () => {
    const entry: NetworkEntry = {
      seq: 1,
      requestId: "r1",
      method: "GET",
      url: "http://example.com/api/x",
      resourceType: "Fetch",
      status: 200,
      startTs: 1,
      endTs: 1.1,
      requestHeaders: {},
      hasPostData: false,
    };
    expect(networkLine(entry, "http://localhost:10040")).toBe(
      "#1 GET http://example.com/api/x → 200 fetch (100 ms)",
    );
    expect(networkLine(entry, "")).toBe(
      "#1 GET http://example.com/api/x → 200 fetch (100 ms)",
    );
  });

  it("U1.10: networkLine formats pending, failed and Document", () => {
    const pending: NetworkEntry = {
      seq: 1,
      requestId: "r1",
      method: "GET",
      url: "/a",
      resourceType: "Fetch",
      startTs: 1,
      requestHeaders: {},
      hasPostData: false,
    };
    expect(networkLine(pending, "")).toBe("#1 GET /a → pending");

    const failed: NetworkEntry = {
      seq: 1,
      requestId: "r1",
      method: "GET",
      url: "/a",
      resourceType: "Fetch",
      startTs: 1,
      endTs: 1.005,
      failed: "net::ERR_FAILED",
      requestHeaders: {},
      hasPostData: false,
    };
    expect(networkLine(failed, "")).toBe("#1 GET /a → failed: net::ERR_FAILED (5 ms)");

    const doc: NetworkEntry = {
      seq: 1,
      requestId: "r1",
      method: "GET",
      url: "/checkout.html",
      resourceType: "Document",
      status: 200,
      startTs: 1,
      requestHeaders: {},
      hasPostData: false,
    };
    expect(networkLine(doc, "")).toBe("#1 GET /checkout.html → 200 document");
  });

  it("U1.11: formatHeaders formats dictionary or returns (none)", () => {
    expect(formatHeaders({})).toBe("(none)");
    expect(formatHeaders({ a: "1", b: "2" })).toBe("a: 1\nb: 2");
  });

  it("U1.12: cap cuts string to max and reports cut count", () => {
    expect(cap("abcdef", 4)).toBe("abcd… (2 more characters)");
    expect(cap("ab", 4)).toBe("ab");
  });

  it("U1.13: base64ByteLength computes byte length accurately", () => {
    expect(base64ByteLength("aGk=")).toBe(2);
    expect(base64ByteLength("aGVsbG8=")).toBe(5);
    expect(base64ByteLength("aGVsbG8h")).toBe(6);
    expect(base64ByteLength("")).toBe(0);
  });

  it("U1.14: originOf returns origin or empty string", () => {
    expect(originOf("http://localhost:10040/checkout.html")).toBe("http://localhost:10040");
    expect(originOf("")).toBe("");
  });
});

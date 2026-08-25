// End-to-end contract tests: spawn the built server and speak MCP to it over stdio.
//
// Everything else in this suite tests functions. This file tests the product —
// the tool schemas and the JSON the handlers actually emit — because that is the
// only surface a client ever sees, and the discrepancies worth catching (a
// description promising a field nothing returns, an assertion passing on evidence
// it should reject) live exactly there.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
// The handlers shell out to the bundled Swift helper for OCR.
const runnable = process.platform === "darwin" && existsSync(SERVER);

let child: ChildProcessWithoutNullStreams;
let nextId = 1;
const pending = new Map<number, (m: Record<string, unknown>) => void>();

const send = (method: string, params: unknown) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await send("tools/call", { name, arguments: args });
  return (r.result ?? r.error) as ToolResult;
};

const json = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args);
  expect(r.isError, `${name} returned an error: ${r.content?.[0]?.text}`).toBeFalsy();
  return JSON.parse(r.content[0].text);
};

describe.skipIf(!runnable)("MCP server contract", () => {
  interface ToolSchema {
    type: string;
    required?: string[];
    properties: Record<string, Record<string, unknown>>;
  }
  let tools: { name: string; description: string; inputSchema: ToolSchema }[];

  beforeAll(async () => {
    child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      for (let i; (i = buf.indexOf("\n")) >= 0; ) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        const resolve = typeof msg.id === "number" && pending.get(msg.id);
        if (resolve) {
          pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "contract-test", version: "0" },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    tools = ((await send("tools/list", {})).result as { tools: typeof tools }).tools;
  }, 30_000);

  afterAll(() => child?.kill());

  const tool = (name: string) => tools.find((t) => t.name === name)!;

  describe("schemas", () => {
    it("exposes every UI tool added in 0.5.0", () => {
      for (const name of [
        "vision_capabilities",
        "list_windows",
        "capture_screen",
        "read_screen_text",
        "find_element",
        "assert_text",
      ]) {
        expect(tool(name), `${name} is missing`).toBeDefined();
      }
    });

    it("advertises expect as string-or-array, so a client cannot flatten it to a string", () => {
      // A stringified array is searched verbatim and yields a confident pass for
      // text nobody put on screen; the schema is what stops a client doing that.
      expect(tool("assert_text").inputSchema.properties.expect.anyOf).toEqual([
        { type: "string", minLength: 1 },
        { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      ]);
    });

    it("carries the defaults and bounds a client needs, including the falsy ones", () => {
      const p = tool("find_element").inputSchema.properties;
      expect(p.case_sensitive.default).toBe(false);
      expect(p.fuzzy_threshold).toMatchObject({ default: 0.75, minimum: 0, maximum: 1 });
      expect(p.min_confidence).toMatchObject({ default: 0.3, minimum: 0, maximum: 1 });
      expect(tool("list_windows").inputSchema.properties.include_all.default).toBe(false);
    });

    it("requires only what the handler cannot default", () => {
      expect(tool("find_element").inputSchema.required).toEqual(["query"]);
      expect(tool("assert_text").inputSchema.required).toEqual(["expect"]);
      expect(tool("capture_screen").inputSchema.required ?? []).toEqual([]);
    });
  });

  describe("vision_capabilities", () => {
    it("returns every field its description promises", async () => {
      // The 0.6.7 description promised `uiHelper`, which nothing ever produced.
      const promised = tool("vision_capabilities")
        .description.split("Returns: JSON {")[1]
        .split("}.")[0]
        .match(/[a-zA-Z]+(?=\s*[,:}])/g)!;
      const keys = new Set<string>();
      const collect = (v: unknown) => {
        if (Array.isArray(v)) return v.forEach(collect);
        if (v && typeof v === "object")
          for (const [k, child] of Object.entries(v)) {
            keys.add(k);
            collect(child);
          }
      };
      collect(await json("vision_capabilities"));
      for (const field of promised) {
        expect(keys.has(field), `promised "${field}" is not returned`).toBe(true);
      }
    });

    it("never claims a capture ability that contradicts the permissions it reports", async () => {
      const r = await json("vision_capabilities");
      if (r.error) return; // helper unavailable: no claims to check
      const usable = r.permissions.screenRecording && !r.permissions.screenLocked;
      expect(r.capture.windowCapture).toBe(usable);
      expect(r.capture.regionCapture).toBe(usable);
      expect(r.ready).toBe(usable);
      expect(Array.isArray(r.blockers)).toBe(true);
      expect(r.blockers.length === 0).toBe(usable);
    });
  });

  describe("list_windows", () => {
    it("marks whether the empty titles are real or withheld", async () => {
      const r = await json("list_windows");
      expect(Array.isArray(r.windows)).toBe(true);
      expect(typeof r.titlesAvailable).toBe("boolean");
      // Silence here is the bug: without the flag, "" is indistinguishable from
      // a window that genuinely has no title.
      if (!r.titlesAvailable) {
        expect(r.note).toMatch(/Screen Recording/);
        expect(r.windows.every((w: { title: string }) => w.title === "")).toBe(true);
      }
    });
  });

  describe("find_element on a fixture", () => {
    const path = FIXTURES + "dialog-ambiguous.png";

    it("does not offer the destructive button as the best answer to 'Save'", async () => {
      // The image has "Don't Save" and "Save Changes" and no exact "Save".
      const r = await json("find_element", {
        path,
        query: "Save",
        frame: { x: 0, y: 0, w: 900, h: 400 },
      });
      expect(r.found).toBe(true);
      expect(r.matches[0].text).toBe("Save Changes");
      expect(r.matches[0].score).toBeGreaterThan(r.matches[1].score);
    }, 30_000);

    it("maps a match to an integer clickPoint inside the frame", async () => {
      const r = await json("find_element", {
        path,
        query: "Save Changes",
        frame: { x: 100, y: 50, w: 900, h: 400 },
      });
      const { x, y } = r.matches[0].clickPoint;
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(x).toBeGreaterThan(100);
      expect(x).toBeLessThan(1000);
      expect(y).toBeGreaterThan(50);
      expect(y).toBeLessThan(450);
    }, 30_000);

    it("returns a null clickPoint when no frame ties the image to the screen", async () => {
      const r = await json("find_element", { path, query: "Save Changes" });
      expect(r.matches[0].clickPoint).toBeNull();
    }, 30_000);

    it("reports not-found rather than inventing a match", async () => {
      const r = await json("find_element", { path, query: "Preferences" });
      expect(r.found).toBe(false);
      expect(r.matches).toEqual([]);
    }, 30_000);

    it("fails loudly on a path that does not exist", async () => {
      const r = await call("find_element", { path: FIXTURES + "missing.png", query: "Save" });
      expect(r.isError).toBeTruthy();
    }, 30_000);
  });

  describe("assert_text on a fixture", () => {
    // Shows "Unsaved changes" and "…has been autosaved." — and no Save button.
    const path = FIXTURES + "dialog-autosaved.png";

    it("does not pass 'present' on a mid-word coincidence", async () => {
      const r = await json("assert_text", { path, expect: "Save", mode: "present" });
      expect(r.pass).toBe(false);
      expect(r.results[0].incidental.length).toBeGreaterThan(0);
    }, 30_000);

    it("passes 'absent' for a button that really is gone", async () => {
      const r = await json("assert_text", { path, expect: "Save", mode: "absent" });
      expect(r.pass).toBe(true);
      expect(r.results[0].incidental.length).toBeGreaterThan(0);
    }, 30_000);

    it("evaluates every element of an array of expectations", async () => {
      const r = await json("assert_text", {
        path,
        expect: ["Unsaved changes", "OK"],
        mode: "present",
      });
      expect(r.results.map((x: { expect: string }) => x.expect)).toEqual(["Unsaved changes", "OK"]);
      expect(r.pass).toBe(true);
    }, 30_000);

    it("fails the whole assertion when one expectation is unmet", async () => {
      const r = await json("assert_text", {
        path,
        expect: ["Unsaved changes", "Print"],
        mode: "present",
      });
      expect(r.pass).toBe(false);
      expect(r.results.map((x: { satisfied: boolean }) => x.satisfied)).toEqual([true, false]);
    }, 30_000);

    it("rejects an empty expectation instead of passing vacuously", async () => {
      expect((await call("assert_text", { path, expect: [] })).isError).toBeTruthy();
      expect((await call("assert_text", { path, expect: "" })).isError).toBeTruthy();
    }, 30_000);
  });
});

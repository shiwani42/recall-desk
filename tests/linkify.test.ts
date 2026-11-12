import { describe, expect, it } from "vitest";
import { splitLinks } from "@/lib/linkify";

describe("splitLinks", () => {
  it("returns plain text untouched", () => {
    expect(splitLinks("Hi Quinn,\nno links here")).toEqual([{ type: "text", value: "Hi Quinn,\nno links here" }]);
  });

  it("links the buyer URL in a recall notice and keeps the surrounding text", () => {
    const body = "Choose your remedy:\nhttps://recall-desk.example/r/TP0K4CXAcJT9\n\nRecall reference RC-49A00C.";
    expect(splitLinks(body)).toEqual([
      { type: "text", value: "Choose your remedy:\n" },
      { type: "link", value: "https://recall-desk.example/r/TP0K4CXAcJT9" },
      { type: "text", value: "\n\nRecall reference RC-49A00C." },
    ]);
  });

  it("leaves sentence punctuation outside the link", () => {
    expect(splitLinks("See https://a.example/r/x.")).toEqual([
      { type: "text", value: "See " },
      { type: "link", value: "https://a.example/r/x" },
      { type: "text", value: "." },
    ]);
  });

  it("handles several links and round-trips the original text", () => {
    const body = "A http://a.example/1, then https://b.example/2 (done)";
    const segs = splitLinks(body);
    expect(segs.filter((s) => s.type === "link").map((s) => s.value)).toEqual(["http://a.example/1", "https://b.example/2"]);
    expect(segs.map((s) => s.value).join("")).toBe(body);
  });

  it("only links http(s) URLs", () => {
    const body = "javascript:alert(1) and ftp://x.example/file";
    expect(splitLinks(body)).toEqual([{ type: "text", value: body }]);
  });
});

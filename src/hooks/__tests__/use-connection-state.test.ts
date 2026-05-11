import { describe, expect, test } from "bun:test"
import { classifyConnectionState } from "@/hooks/use-connection-state.ts"

describe("classifyConnectionState", () => {
  test("returns 'live' when realtimeError is undefined", () => {
    expect(classifyConnectionState({ realtimeError: undefined })).toBe("live")
  })

  test("returns 'live' when realtimeError is null", () => {
    expect(classifyConnectionState({ realtimeError: null })).toBe("live")
  })

  test("returns 'lost' when realtimeError is an Error instance", () => {
    expect(classifyConnectionState({ realtimeError: new Error("ws closed") })).toBe("lost")
  })

  test("returns 'lost' for any non-null/undefined value", () => {
    // Only `undefined` and `null` mean "no error". Any other value — even
    // falsy primitives — counts as the SDK having raised something.
    expect(classifyConnectionState({ realtimeError: "" })).toBe("lost")
    expect(classifyConnectionState({ realtimeError: 0 })).toBe("lost")
    expect(classifyConnectionState({ realtimeError: false })).toBe("lost")
    expect(classifyConnectionState({ realtimeError: { message: "boom" } })).toBe("lost")
  })
})

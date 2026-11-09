import { describe, expect, test } from "bun:test";
import { resolveDriverTripContact } from "../src/lib/driver-trip-contacts";

const endpoints = [
  { kind: "pickup", contact_name: "Sender QA", contact_phone: "+919876543210" },
  { kind: "drop", contact_name: "Receiver QA", contact_phone: "+919876543211" },
];

describe("driver trip endpoint contacts", () => {
  test("reads the sender from a single-stop trip without contact text in notes", () => {
    expect(resolveDriverTripContact(endpoints, "accepted", null)).toEqual({
      name: "Sender QA",
      phone: "+919876543210",
    });
  });

  test("reads the receiver after pickup verification", () => {
    expect(resolveDriverTripContact(endpoints, "in_progress", "Handle carefully")).toEqual({
      name: "Receiver QA",
      phone: "+919876543211",
    });
  });

  test("uses the structured contact instead of obsolete note contacts", () => {
    expect(
      resolveDriverTripContact(endpoints, "accepted", "Sender: Old sender (9999999999)"),
    ).toEqual({ name: "Sender QA", phone: "+919876543210" });
  });

  test("keeps historic sender and receiver note contacts available", () => {
    const notes = "Sender: Historic sender (9876543210) · Receiver: Historic receiver (9876543211)";
    expect(resolveDriverTripContact([], "accepted", notes)).toEqual({
      name: "Historic sender",
      phone: "9876543210",
    });
    expect(resolveDriverTripContact([], "in_progress", notes)).toEqual({
      name: "Historic receiver",
      phone: "9876543211",
    });
  });

  test("does not substitute an intermediate stop contact for the receiver", () => {
    expect(
      resolveDriverTripContact(
        [{ kind: "stop", contact_name: "Intermediate", contact_phone: "9876543212" }, ...endpoints],
        "in_progress",
        null,
      ),
    ).toEqual({ name: "Receiver QA", phone: "+919876543211" });
  });

  test("never fabricates a contact when no endpoint or historic number exists", () => {
    expect(resolveDriverTripContact([], "accepted", "Handle carefully")).toEqual({
      name: "",
      phone: "",
    });
  });

  test("retains the historic fallback for endpoints with a blank phone", () => {
    expect(
      resolveDriverTripContact(
        [{ kind: "pickup", contact_name: "", contact_phone: "  " }],
        "accepted",
        "Sender: Historic sender (9876543210)",
      ),
    ).toEqual({ name: "Historic sender", phone: "9876543210" });
  });
});

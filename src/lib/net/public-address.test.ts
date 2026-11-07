import assert from "node:assert/strict";
import { test } from "node:test";
import { pinnedFetch } from "./pinned-fetch";
import { isBlockedAddress } from "./public-address";

test("private, reserved and IPv4-carrying IPv6 addresses are blocked", () => {
  for (const ip of [
    "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0",
    "192.0.0.8", "192.0.2.1", "198.18.0.1", "198.19.255.1", "198.51.100.7", "203.0.113.9", "224.0.0.1",
    "::1", "::", "fc00::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "2001::1", "2001:db8::1", "100::1",
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test("public addresses pass", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "64:ff9b::808:808", "2002:808:808::1", "198.20.0.1"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("a pinned request never connects to a name that resolves inside", async () => {
  await assert.rejects(pinnedFetch(new URL("https://localhost:9/")), /blocked_address/);
  await assert.rejects(pinnedFetch(new URL("http://example.com/")), /https_only/);
});

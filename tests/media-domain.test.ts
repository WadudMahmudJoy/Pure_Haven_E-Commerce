import assert from "node:assert/strict";
import test from "node:test";
import {
  canAttachManagedMedia,
  assertMediaObjectRoleAccessClass,
  isManagedProductImage,
  isLegacyProductImage,
} from "../lib/media/domain";

test("canAttachManagedMedia permits only unsuspended READY or CLEANUP_PENDING media", () => {
  assert.equal(canAttachManagedMedia("READY", null), true);
  assert.equal(canAttachManagedMedia("CLEANUP_PENDING", null), true);

  // Suspended media must never attach
  const now = new Date();
  assert.equal(canAttachManagedMedia("READY", now), false);
  assert.equal(canAttachManagedMedia("CLEANUP_PENDING", now), false);

  // Non-ready lifecycle states must never attach even if unsuspended
  assert.equal(canAttachManagedMedia("PENDING", null), false);
  assert.equal(canAttachManagedMedia("PROCESSING", null), false);
  assert.equal(canAttachManagedMedia("FAILED", null), false);
  assert.equal(canAttachManagedMedia("DELETING", null), false);
  assert.equal(canAttachManagedMedia("DELETED", null), false);
});

test("assertMediaObjectRoleAccessClass enforces strict role-to-access-class pairings", () => {
  // Valid pairings must not throw
  assert.doesNotThrow(() => assertMediaObjectRoleAccessClass("MASTER", "PRIVATE_SOURCE"));
  assert.doesNotThrow(() => assertMediaObjectRoleAccessClass("RENDITION", "PUBLIC_DELIVERY"));

  // Invalid pairings must throw MEDIA_OBJECT_ROLE_ACCESS_CLASS_INVALID
  assert.throws(
    () => assertMediaObjectRoleAccessClass("MASTER", "PUBLIC_DELIVERY"),
    /MEDIA_OBJECT_ROLE_ACCESS_CLASS_INVALID/
  );
  assert.throws(
    () => assertMediaObjectRoleAccessClass("RENDITION", "PRIVATE_SOURCE"),
    /MEDIA_OBJECT_ROLE_ACCESS_CLASS_INVALID/
  );
});

test("isManagedProductImage and isLegacyProductImage correctly distinguish source kinds", () => {
  assert.equal(isManagedProductImage("MANAGED", "med_12345"), true);
  assert.equal(isManagedProductImage("MANAGED", ""), false);
  assert.equal(isManagedProductImage("MANAGED", null), false);
  assert.equal(isManagedProductImage("MANAGED", undefined), false);
  assert.equal(isManagedProductImage("LEGACY_LOCAL", "med_12345"), false);
  assert.equal(isManagedProductImage("LEGACY_EXTERNAL", "med_12345"), false);

  assert.equal(isLegacyProductImage("LEGACY_LOCAL"), true);
  assert.equal(isLegacyProductImage("LEGACY_EXTERNAL"), true);
  assert.equal(isLegacyProductImage("MANAGED"), false);
  assert.equal(isLegacyProductImage(null), false);
  assert.equal(isLegacyProductImage(undefined), false);
});

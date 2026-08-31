package com.easychat.utils;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PasswordHasherTest {
    @Test
    void hashesAndVerifiesWithoutLeakingThePassword() {
        String hash = PasswordHasher.hash("Passw0rd!");
        assertTrue(hash.startsWith("pbkdf2-sha256$v1$310000$"));
        assertTrue(PasswordHasher.matches("Passw0rd!", hash));
        assertFalse(PasswordHasher.matches("wrong", hash));
        assertNotEquals(hash, PasswordHasher.hash("Passw0rd!"));
    }

    @Test
    void createsOpaqueTokenAndStableLookupKey() {
        String token = PasswordHasher.newAccessToken();
        assertTrue(token.length() >= 43);
        assertNotEquals(token, PasswordHasher.tokenKey(token));
        assertTrue(PasswordHasher.tokenKey(token).equals(PasswordHasher.tokenKey(token)));
    }
}
